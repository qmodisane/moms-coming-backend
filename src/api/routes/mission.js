const express = require('express');
const router = express.Router();
const db = require('../../config/database');

// Complete mission
router.post('/:missionId/complete', async (req, res) => {
  try {
    const { missionId } = req.params;
    const { verificationData } = req.body;

    const mission = await db.query(
      'SELECT * FROM missions WHERE id = $1',
      [missionId]
    );

    if (mission.rows.length === 0) {
      return res.status(404).json({ error: 'Mission not found' });
    }

    const m = mission.rows[0];

    // Mark complete
    await db.query(
      'UPDATE missions SET status = $1, completed_at = NOW() WHERE id = $2',
      ['completed', missionId]
    );

    // Award points
    await db.query(
      'UPDATE game_players SET points = points + $1 WHERE id = $2',
      [m.point_value, m.assigned_to]
    );

    // Log transaction
    await db.query(
      `INSERT INTO point_transactions 
       (session_id, to_player_id, amount, transaction_type, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [m.session_id, m.assigned_to, m.point_value, 'mission_reward', m.description]
    );

    const io = req.app.get('io');
    const roomId = String(m.session_id);
    io.to(roomId).emit('mission:completed', {
      missionId,
      points: m.point_value,
      playerId: m.assigned_to
    });

    console.log(`✅ Mission ${missionId} completed via API`);

    res.json({ 
      success: true, 
      points: m.point_value,
      message: 'Mission completed successfully'
    });
  } catch (error) {
    console.error('Complete mission error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all missions for a session
router.get('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const missions = await db.query(
      `SELECT m.*, gp.player_name 
       FROM missions m
       LEFT JOIN game_players gp ON m.assigned_to = gp.id
       WHERE m.session_id = $1
       ORDER BY m.created_at DESC`,
      [sessionId]
    );

    res.json({ missions: missions.rows });
  } catch (error) {
    console.error('Get missions error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;