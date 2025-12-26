const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const MissionGenerator = require('../../services/MissionGenerator');

// Generate missions for all hiders (seeker-triggered)
router.post('/generate/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const missions = await MissionGenerator.generateMissionsForAllHiders(sessionId);

    // Notify via WebSocket
    const io = req.app.get('io');
    io.to(sessionId).emit('missions:assigned', {
      count: missions.length,
      missions: missions.map(m => ({
        id: m.id,
        assignedTo: m.assigned_to,
        description: m.description,
        points: m.point_value,
        riskLevel: m.risk_level,
        deadline: m.deadline
      }))
    });

    res.json({
      success: true,
      missions
    });
  } catch (error) {
    console.error('Generate missions error:', error);
    res.status(500).json({ error: error.message });
  }
});

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
      'UPDATE missions SET status = $1, completed_at = NOW(), verification_data = $2 WHERE id = $3',
      ['completed', JSON.stringify(verificationData), missionId]
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

    res.json({
      success: true,
      pointsEarned: m.point_value
    });
  } catch (error) {
    console.error('Complete mission error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get active missions for player
router.get('/player/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params;

    const missions = await db.query(
      `SELECT m.* FROM missions m
       JOIN game_players p ON m.assigned_to = p.id
       WHERE p.player_id = $1 
       AND m.status IN ('assigned', 'in_progress')
       ORDER BY m.deadline ASC`,
      [playerId]
    );

    res.json({ missions: missions.rows });
  } catch (error) {
    console.error('Get missions error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
