const db = require('../config/database');

class GameEngine {
  constructor(io) {
    this.io = io;
    this.activeGames = new Map();
    this.gameTimers = new Map();
    this.missionTimers = new Map();
    this.shrinkTimers = new Map();
  }

  async startGame(sessionId) {
    console.log(`🎮 Starting game engine for session ${sessionId}`);
    
    try {
      const roomId = String(sessionId);
      
      // Initialize game state
      const gameState = {
        sessionId,
        startTime: Date.now(),
        duration: 3600000, // 60 minutes
        missionInterval: 300000, // 5 minutes
        shrinkInterval: 600000, // 10 minutes
        lastMissionSpawn: Date.now(),
        lastShrink: Date.now(),
        isActive: true
      };
      
      this.activeGames.set(sessionId, gameState);
      
      // Start game timer (check every second)
      const gameTimer = setInterval(() => {
        this.gameLoop(sessionId);
      }, 1000);
      
      this.gameTimers.set(sessionId, gameTimer);
      
      // Spawn initial missions
      setTimeout(() => {
        this.spawnMissions(sessionId);
      }, 30000); // First missions after 30 seconds
      
      // First boundary shrink after 10 minutes
      const shrinkTimer = setInterval(() => {
        this.shrinkBoundary(sessionId);
      }, 600000); // 10 minutes
      
      this.shrinkTimers.set(sessionId, shrinkTimer);
      
      console.log(`✅ Game engine started for session ${sessionId}`);
      
    } catch (error) {
      console.error(`Failed to start game ${sessionId}:`, error);
    }
  }

  async gameLoop(sessionId) {
    const gameState = this.activeGames.get(sessionId);
    if (!gameState || !gameState.isActive) return;
    
    const elapsed = Date.now() - gameState.startTime;
    const roomId = String(sessionId);
    
    try {
      // Check game duration
      if (elapsed >= gameState.duration) {
        await this.endGame(sessionId, 'time_up');
        return;
      }
      
      // Check if all hiders caught
      const result = await db.query(
        `SELECT COUNT(*) FROM game_players 
         WHERE session_id = $1 AND role = 'hider' AND status = 'active'`,
        [sessionId]
      );
      
      if (result.rows[0].count === '0') {
        await this.endGame(sessionId, 'all_caught');
        return;
      }
      
      // Spawn missions every 5 minutes
      if (elapsed - gameState.lastMissionSpawn >= gameState.missionInterval) {
        this.spawnMissions(sessionId);
        gameState.lastMissionSpawn = elapsed;
      }
      
      // Award survival points every minute
      if (elapsed % 60000 === 0) {
        await this.awardSurvivalPoints(sessionId);
      }
      
      // Check immunity drain
      await this.drainImmunityPoints(sessionId);
      
      // Enable communication in final 10 minutes
      if (elapsed >= gameState.duration - 600000 && elapsed < gameState.duration - 599000) {
        this.io.to(roomId).emit('communication:enabled', {
          message: 'Communication now available!'
        });
      }
      
    } catch (error) {
      console.error(`Game loop error for ${sessionId}:`, error);
    }
  }

  async spawnMissions(sessionId) {
    try {
      const roomId = String(sessionId);
      
      // Get all active hiders
      const hiders = await db.query(
        `SELECT id FROM game_players 
         WHERE session_id = $1 AND role = 'hider' AND status = 'active'`,
        [sessionId]
      );
      
      if (hiders.rows.length === 0) return;
      
      // Mission templates
      const missionTypes = [
        {
          description: 'Stay in one location for 2 minutes',
          pointValue: 50,
          riskLevel: 'low',
          duration: 120000
        },
        {
          description: 'Visit the immunity spot (don\'t claim)',
          pointValue: 75,
          riskLevel: 'medium',
          duration: 300000
        },
        {
          description: 'Get within 50m of seeker and escape',
          pointValue: 100,
          riskLevel: 'high',
          duration: 300000
        },
        {
          description: 'Reach the opposite corner of boundary',
          pointValue: 60,
          riskLevel: 'medium',
          duration: 300000
        },
        {
          description: 'Take a photo of something green',
          pointValue: 40,
          riskLevel: 'low',
          duration: 300000
        }
      ];
      
      // Assign random mission to each hider
      for (const hider of hiders.rows) {
        const mission = missionTypes[Math.floor(Math.random() * missionTypes.length)];
        
        await db.query(
          `INSERT INTO missions 
           (session_id, assigned_to, description, point_value, risk_level, deadline, status)
           VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '${mission.duration / 1000} seconds', 'assigned')`,
          [sessionId, hider.id, mission.description, mission.pointValue, mission.riskLevel]
        );
      }
      
      this.io.to(roomId).emit('missions:spawned', {
        message: 'New missions available!'
      });
      
      console.log(`📋 Spawned missions for session ${sessionId}`);
      
    } catch (error) {
      console.error(`Mission spawn error for ${sessionId}:`, error);
    }
  }

  async shrinkBoundary(sessionId) {
    try {
      const roomId = String(sessionId);
      
      // Get current boundary
      const result = await db.query(
        'SELECT current_boundary FROM game_boundaries WHERE session_id = $1',
        [sessionId]
      );
      
      if (result.rows.length === 0) return;
      
      const currentBoundary = result.rows[0].current_boundary;
      
      // Warn 30 seconds before
      this.io.to(roomId).emit('boundary:shrinking', {
        message: 'Boundary shrinking in 30 seconds!'
      });
      
      setTimeout(async () => {
        // Calculate new smaller boundary (shrink by 20%)
        const newBoundary = this.calculateSmallerBoundary(currentBoundary, 0.8);
        
        // Update database
        await db.query(
          'UPDATE game_boundaries SET current_boundary = $1 WHERE session_id = $2',
          [JSON.stringify(newBoundary), sessionId]
        );
        
        // Notify players
        this.io.to(roomId).emit('boundary:shrunk', {
          newBoundary
        });
        
        // Check for out-of-bounds players
        await this.checkBoundaryViolations(sessionId, newBoundary);
        
        console.log(`📍 Boundary shrunk for session ${sessionId}`);
      }, 30000);
      
    } catch (error) {
      console.error(`Boundary shrink error for ${sessionId}:`, error);
    }
  }

  calculateSmallerBoundary(boundary, scale) {
    const coords = boundary.coordinates;
    
    // Find center point
    const centerLat = coords.reduce((sum, c) => sum + c.lat, 0) / coords.length;
    const centerLng = coords.reduce((sum, c) => sum + c.lng, 0) / coords.length;
    
    // Scale coordinates toward center
    const newCoords = coords.map(coord => ({
      lat: centerLat + (coord.lat - centerLat) * scale,
      lng: centerLng + (coord.lng - centerLng) * scale
    }));
    
    return { coordinates: newCoords };
  }

  async checkBoundaryViolations(sessionId, boundary) {
    try {
      const roomId = String(sessionId);
      
      const players = await db.query(
        `SELECT id, player_id, last_location FROM game_players 
         WHERE session_id = $1 AND status = 'active'`,
        [sessionId]
      );
      
      for (const player of players.rows) {
        if (!player.last_location) continue;
        
        const location = player.last_location;
        const isInBounds = this.isPointInBounds(location, boundary);
        
        if (!isInBounds) {
          // Increment violations
          await db.query(
            'UPDATE game_players SET violations = violations + 1 WHERE id = $1',
            [player.id]
          );
          
          // Emit violation event
          this.io.to(roomId).emit('violation', {
            playerId: player.player_id,
            location
          });
          
          console.log(`⚠️ Player ${player.player_id} out of bounds`);
        }
      }
      
    } catch (error) {
      console.error(`Boundary check error for ${sessionId}:`, error);
    }
  }

  isPointInBounds(point, boundary) {
    const { lat, lng } = point;
    const polygon = boundary.coordinates;
    
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lng, yi = polygon[i].lat;
      const xj = polygon[j].lng, yj = polygon[j].lat;
      
      const intersect = ((yi > lat) !== (yj > lat))
        && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    
    return inside;
  }

  async awardSurvivalPoints(sessionId) {
    try {
      // Award 10 points per minute to active hiders
      await db.query(
        `UPDATE game_players 
         SET points = points + 10 
         WHERE session_id = $1 AND role = 'hider' AND status = 'active'`,
        [sessionId]
      );
      
      console.log(`💰 Awarded survival points for session ${sessionId}`);
      
    } catch (error) {
      console.error(`Survival points error for ${sessionId}:`, error);
    }
  }

  async drainImmunityPoints(sessionId) {
    try {
      const roomId = String(sessionId);
      const gameState = this.activeGames.get(sessionId);
      const elapsed = Date.now() - gameState.startTime;
      const isFinalPhase = elapsed >= gameState.duration - 600000; // Last 10 min
      
      // Get players in immunity
      const result = await db.query(
        `SELECT gp.id, gp.player_id, gp.points, isp.id as spot_id
         FROM game_players gp
         JOIN immunity_spots isp ON isp.occupied_by = gp.id
         WHERE gp.session_id = $1 AND isp.session_id = $1`,
        [sessionId]
      );
      
      for (const player of result.rows) {
        const drainRate = isFinalPhase ? 10 : 1; // 10x drain in final phase
        
        if (player.points > 0) {
          await db.query(
            'UPDATE game_players SET points = GREATEST(0, points - $1) WHERE id = $2',
            [drainRate, player.id]
          );
        } else {
          // No points left, kick out of immunity
          await db.query(
            'UPDATE immunity_spots SET occupied_by = NULL, occupied_at = NULL WHERE id = $1',
            [player.spot_id]
          );
          
          this.io.to(roomId).emit('immunity:expired', {
            playerId: player.player_id
          });
        }
      }
      
    } catch (error) {
      console.error(`Immunity drain error for ${sessionId}:`, error);
    }
  }

  async endGame(sessionId, reason) {
    try {
      const roomId = String(sessionId);
      const gameState = this.activeGames.get(sessionId);
      if (!gameState) return;
      
      gameState.isActive = false;
      
      // Clear timers
      const gameTimer = this.gameTimers.get(sessionId);
      const shrinkTimer = this.shrinkTimers.get(sessionId);
      if (gameTimer) clearInterval(gameTimer);
      if (shrinkTimer) clearInterval(shrinkTimer);
      
      // Update database
      await db.query(
        'UPDATE game_sessions SET status = $1, ended_at = NOW() WHERE id = $2',
        ['ended', sessionId]
      );
      
      // Get final scores
      const players = await db.query(
        `SELECT player_id, player_name, role, points, status 
         FROM game_players WHERE session_id = $1 
         ORDER BY points DESC`,
        [sessionId]
      );
      
      // Determine winner
      let winner;
      if (reason === 'all_caught') {
        winner = 'seeker';
      } else if (reason === 'time_up') {
        winner = 'hiders';
      }
      
      const gameResult = {
        winner,
        reason: reason === 'all_caught' ? 'All hiders caught!' : 'Time ran out!',
        finalScores: players.rows,
        gameStats: {
          duration: this.formatDuration(Date.now() - gameState.startTime),
          caught: players.rows.filter(p => p.status === 'caught').length,
          missions: 0, // TODO: count from database
          shrinks: Math.floor((Date.now() - gameState.startTime) / 600000)
        }
      };
      
      // Notify all players
      this.io.to(roomId).emit('game:ended', gameResult);
      
      // Cleanup
      this.activeGames.delete(sessionId);
      this.gameTimers.delete(sessionId);
      this.shrinkTimers.delete(sessionId);
      
      console.log(`🏁 Game ended for session ${sessionId}: ${reason}`);
      
    } catch (error) {
      console.error(`End game error for ${sessionId}:`, error);
    }
  }

  formatDuration(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  async stopGame(sessionId) {
    await this.endGame(sessionId, 'manual_stop');
  }
}

module.exports = GameEngine;
```

---

### 2. server.js (UPDATE location handler)
```
C:\Users\Khumo\Desktop\branding\Moms-Coming\moms-coming-backend\moms-coming-game\src\server.js