const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const { v4: uuidv4 } = require('uuid');

// Create new game session
router.post('/create', async (req, res) => {
  try {
    const { playerName, gameMode, settings } = req.body;

    if (!playerName) {
      return res.status(400).json({ error: 'Player name required' });
    }

    const hostPlayerId = uuidv4();
    const hostPlayerName = playerName;
    const sessionCode = Math.floor(100000 + Math.random() * 900000).toString();

    const defaultSettings = {
      duration: 3600000,
      boundaryShrinkInterval: 600000,
      missionFrequency: 300000,
      offLimitsEnabled: false,
      seekerCount: 1,
      winCondition: 'hybrid',
      communicationMode: 'final_phase_only'
    };

    const finalSettings = { ...defaultSettings, ...settings };

    const sessionResult = await db.query(
      `INSERT INTO game_sessions 
       (session_code, host_player_id, status, game_mode, settings)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [sessionCode, hostPlayerId, 'lobby', gameMode || 'standard', JSON.stringify(finalSettings)]
    );

    const session = sessionResult.rows[0];

    await db.query(
      `INSERT INTO game_players 
       (session_id, player_id, player_name, role, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [session.id, hostPlayerId, hostPlayerName, 'hider', 'active']
    );

    res.json({
      success: true,
      session: {
        id: session.id,
        code: session.session_code,
        hostPlayerId: session.host_player_id,
        status: session.status,
        settings: session.settings
      },
      player: {
        id: hostPlayerId,
        name: hostPlayerName
      }
    });
  } catch (error) {
    console.error('Create game error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Join existing game
router.post('/join', async (req, res) => {
  try {
    const { sessionCode, playerName, playerId } = req.body;

    if (!sessionCode || !playerName || !playerId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const session = await db.query(
      'SELECT * FROM game_sessions WHERE session_code = $1 AND status = $2',
      [sessionCode, 'lobby']
    );

    if (session.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found or already started' });
    }

    const sessionId = session.rows[0].id;

    const existingPlayer = await db.query(
      'SELECT * FROM game_players WHERE session_id = $1 AND player_id = $2',
      [sessionId, playerId]
    );

    if (existingPlayer.rows.length > 0) {
      return res.status(400).json({ error: 'Already joined this game' });
    }

    const playerResult = await db.query(
      `INSERT INTO game_players 
       (session_id, player_id, player_name, role, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [sessionId, playerId, playerName, 'hider', 'active']
    );

    res.json({
      success: true,
      sessionId,
      player: playerResult.rows[0]
    });
  } catch (error) {
    console.error('Join game error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Set game boundary
router.post('/:sessionId/boundary', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { coordinates } = req.body;

    if (!coordinates || !Array.isArray(coordinates)) {
      return res.status(400).json({ error: 'Invalid boundary coordinates' });
    }

    const boundaryData = {
      coordinates: coordinates
    };

    await db.query(
      `INSERT INTO game_boundaries 
       (session_id, original_boundary, current_boundary)
       VALUES ($1, $2, $3)`,
      [sessionId, JSON.stringify(boundaryData), JSON.stringify(boundaryData)]
    );

    const io = req.app.get('io');
    const roomId = String(sessionId);
    io.to(roomId).emit('boundary:set', {
      sessionId: roomId,
      boundary: boundaryData
    });

    console.log(`📍 Boundary set for room ${roomId}`);

    res.json({ success: true, boundary: boundaryData });
  } catch (error) {
    console.error('Set boundary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Set immunity spot
router.post('/:sessionId/immunity-spot', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { location } = req.body;

    if (!location || !location.lat || !location.lng) {
      return res.status(400).json({ error: 'Invalid location' });
    }

    await db.query(
      `INSERT INTO immunity_spots 
       (session_id, location, unlock_threshold, activation_cost, drain_rate)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, JSON.stringify(location), 50, 0, 1]
    );

    const io = req.app.get('io');
    const roomId = String(sessionId);
    io.to(roomId).emit('immunity:placed', {
      sessionId: roomId,
      location
    });

    console.log(`🛡️ Immunity spot placed in room ${roomId}`);

    res.json({ success: true });
  } catch (error) {
    console.error('Set immunity spot error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start game
router.post('/:sessionId/start', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await db.query(
      'SELECT * FROM game_sessions WHERE id = $1',
      [sessionId]
    );

    if (session.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const boundary = await db.query(
      'SELECT * FROM game_boundaries WHERE session_id = $1',
      [sessionId]
    );

    if (boundary.rows.length === 0) {
      return res.status(400).json({ error: 'Must set boundary before starting' });
    }

    await db.query(
      'UPDATE game_sessions SET status = $1, started_at = NOW() WHERE id = $2',
      ['active', sessionId]
    );

    const gameEngine = req.app.get('gameEngine');
    await gameEngine.startGame(sessionId);

    const io = req.app.get('io');
    const roomId = String(sessionId);
    io.to(roomId).emit('game:started', {
      sessionId: roomId,
      message: 'Game is starting!'
    });

    console.log(`🚀 Game ${roomId} started - emitted to room`);

    res.json({ success: true, message: 'Game started' });
  } catch (error) {
    console.error('Start game error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get game state
router.get('/:sessionId/state', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await db.query(
      'SELECT * FROM game_sessions WHERE id = $1',
      [sessionId]
    );

    if (session.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const players = await db.query(
      'SELECT * FROM game_players WHERE session_id = $1',
      [sessionId]
    );

    const boundary = await db.query(
      'SELECT current_boundary FROM game_boundaries WHERE session_id = $1',
      [sessionId]
    );

    const immunitySpot = await db.query(
      'SELECT * FROM immunity_spots WHERE session_id = $1',
      [sessionId]
    );

    res.json({
      session: session.rows[0],
      players: players.rows,
      boundary: boundary.rows[0]?.current_boundary,
      immunitySpot: immunitySpot.rows[0]
    });
  } catch (error) {
    console.error('Get state error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get player's active missions
router.get('/:sessionId/player/:playerId/missions', async (req, res) => {
  try {
    const { sessionId, playerId } = req.params;

    const missions = await db.query(
      `SELECT * FROM missions 
       WHERE session_id = $1 
       AND assigned_to = (SELECT id FROM game_players WHERE player_id = $2 AND session_id = $1)
       AND status IN ('assigned', 'in_progress')
       ORDER BY deadline ASC`,
      [sessionId, playerId]
    );

    res.json({ missions: missions.rows });
  } catch (error) {
    console.error('Get missions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Assign seeker role
router.post('/:sessionId/assign-seeker', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { playerId } = req.body;

    await db.query(
      'UPDATE game_players SET role = $1 WHERE id = $2 AND session_id = $3',
      ['seeker', playerId, sessionId]
    );

    const io = req.app.get('io');
    const roomId = String(sessionId);
    io.to(roomId).emit('seeker:assigned', {
      playerId,
      message: 'Seeker has been assigned'
    });

    console.log(`👁️ Seeker assigned in room ${roomId}: player ${playerId}`);

    res.json({ success: true });
  } catch (error) {
    console.error('Assign seeker error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;