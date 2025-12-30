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
      
      const gameState = {
        sessionId,
        startTime: Date.now(),
        duration: 3600000,
        missionInterval: 300000,
        shrinkInterval: 600000,
        lastMissionSpawn: Date.now(),
        lastShrink: Date.now(),
        isActive: true
      };
      
      this.activeGames.set(sessionId, gameState);
      
      const gameTimer = setInterval(() => {
        this.gameLoop(sessionId);
      }, 1000);
      
      this.gameTimers.set(sessionId, gameTimer);
      
      setTimeout(() => {
        this.spawnMissions(sessionId);
      }, 30000);
      
      const shrinkTimer = setInterval(() => {
        this.shrinkBoundary(sessionId);
      }, 600000);
      
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
      if (elapsed >= gameState.duration) {
        await this.endGame(sessionId, 'time_up');
        return;
      }
      
      const result = await db.query(
        'SELECT COUNT(*) FROM game_players WHERE session_id = $1 AND role = $2 AND status = $3',
        [sessionId, 'hider', 'active']
      );
      
      if (result.rows[0].count === '0') {
        await this.endGame(sessionId, 'all_caught');
        return;
      }
      
      if (elapsed - gameState.lastMissionSpawn >= gameState.missionInterval) {
        this.spawnMissions(sessionId);
        gameState.lastMissionSpawn = elapsed;
      }
      
      if (elapsed % 60000 === 0) {
        await this.awardSurvivalPoints(sessionId);
      }
      
      await this.drainImmunityPoints(sessionId);
      
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
      
      const hiders = await db.query(
        'SELECT id FROM game_players WHERE session_id = $1 AND role = $2 AND status = $3',
        [sessionId, 'hider', 'active']
      );
      
      if (hiders.rows.length === 0) return;
      
      const missionTypes = [
        {
          description: 'Stay in one location for 2 minutes',
          pointValue: 50,
          riskLevel: 'low',
          duration: 120000
        },
        {
          description: 'Visit the immunity spot (do not claim)',
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
      
      for (const hider of hiders.rows) {
        const mission = missionTypes[Math.floor(Math.random() * missionTypes.length)];
        
        const durationSeconds = mission.duration / 1000;
        await db.query(
          `INSERT INTO missions (session_id, assigned_to, description, point_value, risk_level, deadline, status)
           VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '${durationSeconds} seconds', 'assigned')`,
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
      
      const result = await db.query(
        'SELECT current_boundary FROM game_boundaries WHERE session_id = $1',
        [sessionId]
      );
      
      if (result.rows.length === 0) return;
      
      const currentBoundary = result.rows[0].current_boundary;
      
      this.io.to(roomId).emit('boundary:shrinking', {
        message: 'Boundary shrinking in 30 seconds!'
      });
      
      setTimeout(async () => {
        const newBoundary = this.calculateSmallerBoundary(currentBoundary, 0.8);
        
        await db.query(
          'UPDATE game_boundaries SET current_boundary = $1 WHERE session_id = $2',
          [JSON.stringify(newBoundary), sessionId]
        );
        
        this.io.to(roomId).emit('boundary:shrunk', {
          newBoundary
        });
        
        await this.checkBoundaryViolations(sessionId, newBoundary);
        
        console.log(`📍 Boundary shrunk for session ${sessionId}`);
      }, 30000);
      
    } catch (error) {
      console.error(`Boundary shrink error for ${sessionId}:`, error);
    }
  }

  calculateSmallerBoundary(boundary, scale) {
    const coords = boundary.coordinates;
    
    const centerLat = coords.reduce((sum, c) => sum + c.lat, 0) / coords.length;
    const centerLng = coords.reduce((sum, c) => sum + c.lng, 0) / coords.length;
    
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
        'SELECT id, player_id, last_location FROM game_players WHERE session_id = $1 AND status = $2',
        [sessionId, 'active']
      );
      
      for (const player of players.rows) {
        if (!player.last_location) continue;
        
        const location = player.last_location;
        const isInBounds = this.isPointInBounds(location, boundary);
        
        if (!isInBounds) {
          await db.query(
            'UPDATE game_players SET violations = violations + 1 WHERE id = $1',
            [player.id]
          );
          
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
    const lat = point.lat;
    const lng = point.lng;
    const polygon = boundary.coordinates;
    
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lng;
      const yi = polygon[i].lat;
      const xj = polygon[j].lng;
      const yj = polygon[j].lat;
      
      const intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    
    return inside;
  }

  async awardSurvivalPoints(sessionId) {
    try {
      await db.query(
        'UPDATE game_players SET points = points + 10 WHERE session_id = $1 AND role = $2 AND status = $3',
        [sessionId, 'hider', 'active']
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
      const isFinalPhase = elapsed >= gameState.duration - 600000;
      
      const result = await db.query(
        `SELECT gp.id, gp.player_id, gp.points, isp.id as spot_id
         FROM game_players gp
         JOIN immunity_spots isp ON isp.occupied_by = gp.id
         WHERE gp.session_id = $1 AND isp.session_id = $1`,
        [sessionId]
      );
      
      for (const player of result.rows) {
        const drainRate = isFinalPhase ? 10 : 1;
        
        if (player.points > 0) {
          await db.query(
            'UPDATE game_players SET points = GREATEST(0, points - $1) WHERE id = $2',
            [drainRate, player.id]
          );
        } else {
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
      
      const gameTimer = this.gameTimers.get(sessionId);
      const shrinkTimer = this.shrinkTimers.get(sessionId);
      if (gameTimer) clearInterval(gameTimer);
      if (shrinkTimer) clearInterval(shrinkTimer);
      
      await db.query(
        'UPDATE game_sessions SET status = $1, ended_at = NOW() WHERE id = $2',
        ['ended', sessionId]
      );
      
      const players = await db.query(
        'SELECT player_id, player_name, role, points, status FROM game_players WHERE session_id = $1 ORDER BY points DESC',
        [sessionId]
      );
      
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
          missions: 0,
          shrinks: Math.floor((Date.now() - gameState.startTime) / 600000)
        }
      };
      
      this.io.to(roomId).emit('game:ended', gameResult);
      
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