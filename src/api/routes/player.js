const express = require('express');
const router = express.Router();
const db = require('../../config/database');

// Update player location
router.post('/:playerId/location', async (req, res) => {
  try {
    const { playerId } = req.params;
    const { lat, lng, accuracy } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'Invalid location data' });
    }

    const location = { lat, lng, accuracy, timestamp: new Date().toISOString() };

    await db.query(
      'UPDATE game_players SET last_location = $1 WHERE player_id = $2',
      [JSON.stringify(location), playerId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get player info
router.get('/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params;

    const result = await db.query(
      'SELECT * FROM game_players WHERE player_id = $1',
      [playerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    res.json({ player: result.rows[0] });
  } catch (error) {
    console.error('Get player error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get player stats
router.get('/:playerId/stats', async (req, res) => {
  try {
    const { playerId } = req.params;

    const player = await db.query(
      'SELECT * FROM game_players WHERE player_id = $1',
      [playerId]
    );

    if (player.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const missions = await db.query(
      'SELECT COUNT(*) as completed FROM missions WHERE assigned_to = $1 AND status = $2',
      [player.rows[0].id, 'completed']
    );

    const violations = await db.query(
      'SELECT COUNT(*) FROM violations WHERE player_id = $1',
      [player.rows[0].id]
    );

    res.json({
      player: player.rows[0],
      missionsCompleted: missions.rows[0].completed,
      totalViolations: violations.rows[0].count
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
