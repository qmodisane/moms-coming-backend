const db = require('../config/database');

class ViolationHandler {
  /**
   * Handle out of bounds violation
   */
  async handleOutOfBounds(sessionId, playerId, location) {
    // Record violation
    await db.query(
      `INSERT INTO violations 
       (session_id, player_id, violation_type, penalty_applied, location)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        sessionId,
        playerId,
        'out_of_bounds',
        JSON.stringify({ type: 'location_reveal', duration: 5 }),
        JSON.stringify(location)
      ]
    );

    // Increment violation count
    await db.query(
      'UPDATE game_players SET violations = violations + 1 WHERE id = $1',
      [playerId]
    );

    return {
      type: 'out_of_bounds',
      penalty: 'location_reveal',
      duration: 5
    };
  }

  /**
   * Handle failed mission
   */
  async handleMissionFailed(sessionId, mission) {
    // Mark mission as failed
    await db.query(
      'UPDATE missions SET status = $1 WHERE id = $2',
      ['failed', mission.id]
    );

    // Record violation
    await db.query(
      `INSERT INTO violations 
       (session_id, player_id, violation_type, penalty_applied)
       VALUES ($1, $2, $3, $4)`,
      [
        sessionId,
        mission.assigned_to,
        'mission_failed',
        JSON.stringify({ type: 'point_penalty', amount: -20 })
      ]
    );

    // Deduct points and increment violations
    await db.query(
      'UPDATE game_players SET points = points - 20, violations = violations + 1 WHERE id = $1',
      [mission.assigned_to]
    );

    // Log transaction
    await db.query(
      `INSERT INTO point_transactions 
       (session_id, from_player_id, amount, transaction_type, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, mission.assigned_to, -20, 'mission_penalty', `Failed mission: ${mission.description}`]
    );

    return { type: 'mission_failed', penalty: -20 };
  }

  /**
   * Check if collective violations trigger chaos mode
   */
  async checkChaosMode(sessionId) {
    const result = await db.query(
      `SELECT 
        COUNT(DISTINCT player_id) as violator_count,
        (SELECT COUNT(*) FROM game_players WHERE session_id = $1 AND status = 'active') as total_players
       FROM violations 
       WHERE session_id = $1 
       AND timestamp > NOW() - INTERVAL '5 minutes'`,
      [sessionId]
    );

    const { violator_count, total_players } = result.rows[0];

    // If everyone violated in last 5 minutes = CHAOS MODE
    if (violator_count >= total_players && total_players > 0) {
      return { triggered: true, duration: 10 };
    }

    return { triggered: false };
  }

  /**
   * Apply chaos mode effects
   */
  async applyChaosMode(sessionId, io) {
    console.log(`⚡ CHAOS MODE activated for game: ${sessionId}`);

    // Log event
    await db.query(
      `INSERT INTO game_events (session_id, event_type, event_data)
       VALUES ($1, $2, $3)`,
      [sessionId, 'chaos_mode', JSON.stringify({ duration: 10 })]
    );

    // Get all player locations
    const players = await db.query(
      'SELECT id, player_name, last_location FROM game_players WHERE session_id = $1',
      [sessionId]
    );

    // Reveal all locations
    io.to(sessionId).emit('chaos:mode_activated', {
      duration: 10000,
      players: players.rows.map(p => ({
        id: p.id,
        name: p.player_name,
        location: p.last_location
      }))
    });

    // Auto-resolve after 10 seconds
    setTimeout(async () => {
      io.to(sessionId).emit('chaos:mode_ended');
    }, 10000);
  }
}

module.exports = new ViolationHandler();
