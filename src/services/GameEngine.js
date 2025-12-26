const db = require('../config/database');
const GoogleMapsService = require('./GoogleMapsService');
const MissionGenerator = require('./MissionGenerator');
const ViolationHandler = require('./ViolationHandler');

class GameEngine {
  constructor(io) {
    this.io = io;
    this.activeGames = new Map();
    this.updateInterval = 1000; // 1 second
  }

  /**
   * Start game loop for a session
   */
  async startGame(sessionId) {
    if (this.activeGames.has(sessionId)) {
      console.log(`Game ${sessionId} already running`);
      return;
    }

    console.log(`🎮 Starting game: ${sessionId}`);

    // Update session status
    await db.query(
      'UPDATE game_sessions SET status = $1, started_at = NOW() WHERE id = $2',
      ['active', sessionId]
    );

    // Initialize game state
    const gameState = {
      sessionId,
      interval: setInterval(() => this.gameLoop(sessionId), this.updateInterval),
      lastUpdate: Date.now(),
      gameStartTime: Date.now(),
      communicationEnabled: false
    };

    this.activeGames.set(sessionId, gameState);

    // Log game start event
    await this.logEvent(sessionId, 'game_started', null, {
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Stop game loop
   */
  async stopGame(sessionId) {
    const gameState = this.activeGames.get(sessionId);
    if (gameState) {
      clearInterval(gameState.interval);
      this.activeGames.delete(sessionId);
      
      await db.query(
        'UPDATE game_sessions SET status = $1, ended_at = NOW() WHERE id = $2',
        ['finished', sessionId]
      );

      console.log(`🛑 Stopped game: ${sessionId}`);
    }
  }

  /**
   * Main game loop - runs every second
   */
  async gameLoop(sessionId) {
    try {
      const gameState = this.activeGames.get(sessionId);
      if (!gameState) return;

      // Get game session info
      const session = await this.getSession(sessionId);
      if (!session) {
        this.stopGame(sessionId);
        return;
      }

      // Calculate game elapsed time
      const elapsed = Date.now() - gameState.gameStartTime;
      const totalDuration = session.settings.duration || 3600000; // Default 1 hour
      const remaining = totalDuration - elapsed;

      // Check if game should end
      if (remaining <= 0) {
        await this.endGame(sessionId);
        return;
      }

      // Enable communication in final 10 minutes
      const finalPhaseThreshold = 10 * 60 * 1000; // 10 minutes
      if (remaining <= finalPhaseThreshold && !gameState.communicationEnabled) {
        gameState.communicationEnabled = true;
        this.io.to(sessionId).emit('communication:enabled', {
          messagesAllowed: 3,
          pointTradingEnabled: true
        });
      }

      // 1. Check boundary violations
      await this.checkBoundaryViolations(sessionId);

      // 2. Check mission deadlines
      await this.checkMissionDeadlines(sessionId);

      // 3. Check boundary shrink schedule
      await this.checkBoundaryShrink(sessionId, elapsed);

      // 4. Check immunity spot drain
      await this.checkImmunitySpotDrain(sessionId);

      // 5. Update end-game immunity costs
      await this.updateImmunityCosts(sessionId, remaining, totalDuration);

      // 6. Broadcast game state
      await this.broadcastGameState(sessionId);

    } catch (error) {
      console.error(`Game loop error (${sessionId}):`, error);
    }
  }

  /**
   * Check if players are out of bounds
   */
  async checkBoundaryViolations(sessionId) {
    const players = await this.getActivePlayers(sessionId);
    const boundary = await this.getCurrentBoundary(sessionId);

    if (!boundary) return;

    for (const player of players) {
      if (!player.last_location) continue;

      const location = player.last_location;
      const inBounds = GoogleMapsService.isPointInBounds(location, boundary);

      if (!inBounds) {
        await ViolationHandler.handleOutOfBounds(sessionId, player.id, location);
        
        // Emit violation to all players
        this.io.to(sessionId).emit('violation:out_of_bounds', {
          playerId: player.id,
          playerName: player.player_name,
          location: location,
          revealDuration: 5000
        });
      }
    }
  }

  /**
   * Check mission deadlines
   */
  async checkMissionDeadlines(sessionId) {
    const result = await db.query(
      `SELECT * FROM missions 
       WHERE session_id = $1 
       AND status = 'assigned' 
       AND deadline < NOW()`,
      [sessionId]
    );

    for (const mission of result.rows) {
      await ViolationHandler.handleMissionFailed(sessionId, mission);
      
      // Notify player
      this.io.to(sessionId).emit('mission:failed', {
        missionId: mission.id,
        playerId: mission.assigned_to,
        penalty: -20
      });
    }
  }

  /**
   * Check if boundary should shrink
   */
  async checkBoundaryShrink(sessionId, elapsedTime) {
    const boundaryData = await db.query(
      'SELECT * FROM game_boundaries WHERE session_id = $1',
      [sessionId]
    );

    if (boundaryData.rows.length === 0) return;

    const boundary = boundaryData.rows[0];
    const shrinkInterval = 10 * 60 * 1000; // 10 minutes

    const timeSinceLastShrink = boundary.last_shrink_at 
      ? Date.now() - new Date(boundary.last_shrink_at).getTime()
      : elapsedTime;

    if (timeSinceLastShrink >= shrinkInterval) {
      await this.shrinkBoundary(sessionId);
    }
  }

  /**
   * Shrink the game boundary
   */
  async shrinkBoundary(sessionId) {
    console.log(`📉 Shrinking boundary for game: ${sessionId}`);

    const result = await db.query(
      'SELECT current_boundary FROM game_boundaries WHERE session_id = $1',
      [sessionId]
    );

    if (result.rows.length === 0) return;

    const currentBoundary = result.rows[0].current_boundary;
    const newBoundary = GoogleMapsService.shrinkBoundary(currentBoundary, 0.8); // Shrink to 80%

    await db.query(
      `UPDATE game_boundaries 
       SET current_boundary = $1, last_shrink_at = NOW() 
       WHERE session_id = $2`,
      [JSON.stringify(newBoundary), sessionId]
    );

    // Log event
    await this.logEvent(sessionId, 'boundary_shrink', null, { newBoundary });

    // Notify all players with 30-second warning
    this.io.to(sessionId).emit('boundary:shrinking', {
      newBoundary,
      warningSec: 30
    });

    // Actually apply shrink after warning
    setTimeout(() => {
      this.io.to(sessionId).emit('boundary:shrunk', { newBoundary });
    }, 30000);
  }

  /**
   * Check immunity spot point drain
   */
  async checkImmunitySpotDrain(sessionId) {
    const result = await db.query(
      `SELECT i.*, p.points, p.id as player_id, p.player_name
       FROM immunity_spots i
       JOIN game_players p ON i.occupied_by = p.id
       WHERE i.session_id = $1 AND i.occupied_by IS NOT NULL`,
      [sessionId]
    );

    for (const spot of result.rows) {
      const drainAmount = spot.drain_rate;
      const newPoints = spot.points - drainAmount;

      // Deduct points
      await db.query(
        'UPDATE game_players SET points = points - $1 WHERE id = $2',
        [drainAmount, spot.player_id]
      );

      // Log transaction
      await db.query(
        `INSERT INTO point_transactions 
         (session_id, from_player_id, amount, transaction_type, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, spot.player_id, -drainAmount, 'immunity_cost', 'Immunity spot occupation drain']
      );

      // If out of points, eject from immunity spot
      if (newPoints < 0) {
        await db.query(
          'UPDATE immunity_spots SET occupied_by = NULL, occupied_at = NULL WHERE id = $1',
          [spot.id]
        );

        this.io.to(sessionId).emit('immunity:ejected', {
          playerId: spot.player_id,
          playerName: spot.player_name,
          reason: 'Insufficient points'
        });
      }
    }
  }

  /**
   * Update immunity costs for end game
   */
  async updateImmunityCosts(sessionId, remaining, totalDuration) {
    const finalPhaseThreshold = totalDuration * 0.3; // Last 30% of game

    if (remaining <= finalPhaseThreshold) {
      // End game - increase costs
      await db.query(
        `UPDATE immunity_spots 
         SET activation_cost = 100, drain_rate = 2 
         WHERE session_id = $1`,
        [sessionId]
      );
    }
  }

  /**
   * Broadcast current game state to all players
   */
  async broadcastGameState(sessionId) {
    const players = await this.getActivePlayers(sessionId);
    const boundary = await this.getCurrentBoundary(sessionId);
    const immunitySpot = await this.getImmunitySpotStatus(sessionId);

    const gameState = {
      timestamp: Date.now(),
      players: players.map(p => ({
        id: p.id,
        name: p.player_name,
        role: p.role,
        points: p.points,
        violations: p.violations,
        status: p.status,
        // Only reveal location if they have violations or are seeker
        location: (p.violations > 0 || p.role === 'seeker') ? p.last_location : null
      })),
      boundary,
      immunitySpot
    };

    this.io.to(sessionId).emit('game:state', gameState);
  }

  /**
   * End the game
   */
  async endGame(sessionId) {
    console.log(`🏁 Ending game: ${sessionId}`);

    // Determine winners
    const players = await db.query(
      `SELECT * FROM game_players 
       WHERE session_id = $1 AND status = 'active' 
       ORDER BY points DESC`,
      [sessionId]
    );

    const winners = players.rows.filter(p => p.role === 'hider');
    
    await this.logEvent(sessionId, 'game_ended', null, {
      winners: winners.map(w => ({ id: w.id, name: w.player_name, points: w.points }))
    });

    this.io.to(sessionId).emit('game:ended', {
      winners,
      finalScores: players.rows
    });

    this.stopGame(sessionId);
  }

  // Helper methods
  async getSession(sessionId) {
    const result = await db.query('SELECT * FROM game_sessions WHERE id = $1', [sessionId]);
    return result.rows[0];
  }

  async getActivePlayers(sessionId) {
    const result = await db.query(
      'SELECT * FROM game_players WHERE session_id = $1 AND status = $2',
      [sessionId, 'active']
    );
    return result.rows;
  }

  async getCurrentBoundary(sessionId) {
    const result = await db.query(
      'SELECT current_boundary FROM game_boundaries WHERE session_id = $1',
      [sessionId]
    );
    return result.rows[0]?.current_boundary;
  }

  async getImmunitySpotStatus(sessionId) {
    const result = await db.query(
      'SELECT * FROM immunity_spots WHERE session_id = $1',
      [sessionId]
    );
    return result.rows[0] || null;
  }

  async logEvent(sessionId, eventType, playerId, data) {
    await db.query(
      `INSERT INTO game_events (session_id, event_type, player_id, event_data)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, eventType, playerId, JSON.stringify(data)]
    );
  }
}

module.exports = GameEngine;
