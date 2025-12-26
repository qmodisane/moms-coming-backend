const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const GameEngine = require('./services/GameEngine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files (for future frontend)
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/game', require('./api/routes/game'));
app.use('/api/player', require('./api/routes/player'));
app.use('/api/mission', require('./api/routes/mission'));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Initialize Game Engine
const gameEngine = new GameEngine(io);

// Make game engine available to routes
app.set('gameEngine', gameEngine);
app.set('io', io);

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log(`🔌 Player connected: ${socket.id}`);

  // Player joins game session
  socket.on('game:join', async ({ sessionId, playerId, playerName }) => {
    try {
      socket.join(sessionId);
      socket.sessionId = sessionId;
      socket.playerId = playerId;
      socket.playerName = playerName;

      console.log(`Player ${playerName} joined game ${sessionId}`);

      // Notify others
      socket.to(sessionId).emit('player:joined', {
        playerId,
        playerName
      });

      // Send current game state
      socket.emit('game:joined', {
        sessionId,
        playerId
      });
    } catch (error) {
      socket.emit('error', { message: 'Failed to join game' });
    }
  });

  // Player updates location
  socket.on('location:update', async ({ sessionId, playerId, location }) => {
    try {
      const db = require('./config/database');
      await db.query(
        'UPDATE game_players SET last_location = $1 WHERE id = $2',
        [JSON.stringify(location), playerId]
      );
    } catch (error) {
      console.error('Location update error:', error);
    }
  });

  // Player claims immunity spot
  socket.on('immunity:claim', async ({ sessionId, playerId }) => {
    try {
      const db = require('./config/database');
      
      // Check if player has enough points
      const player = await db.query(
        'SELECT points FROM game_players WHERE id = $1',
        [playerId]
      );

      const immunitySpot = await db.query(
        'SELECT * FROM immunity_spots WHERE session_id = $1',
        [sessionId]
      );

      if (immunitySpot.rows.length === 0) {
        socket.emit('error', { message: 'No immunity spot available' });
        return;
      }

      const spot = immunitySpot.rows[0];
      
      if (player.rows[0].points < spot.unlock_threshold) {
        socket.emit('error', { 
          message: `Need ${spot.unlock_threshold} points to claim immunity` 
        });
        return;
      }

      // Claim spot
      await db.query(
        'UPDATE immunity_spots SET occupied_by = $1, occupied_at = NOW() WHERE id = $2',
        [playerId, spot.id]
      );

      io.to(sessionId).emit('immunity:claimed', {
        playerId,
        spotId: spot.id
      });
    } catch (error) {
      socket.emit('error', { message: 'Failed to claim immunity' });
    }
  });

  // Mission completed
  socket.on('mission:complete', async ({ missionId, verificationData }) => {
    try {
      const db = require('./config/database');
      
      const mission = await db.query(
        'SELECT * FROM missions WHERE id = $1',
        [missionId]
      );

      if (mission.rows.length === 0) {
        socket.emit('error', { message: 'Mission not found' });
        return;
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

      socket.emit('mission:completed', {
        missionId,
        points: m.point_value
      });

      io.to(m.session_id).emit('player:points_updated', {
        playerId: m.assigned_to,
        points: m.point_value
      });
    } catch (error) {
      socket.emit('error', { message: 'Failed to complete mission' });
    }
  });

  // Player tagged (seeker only)
  socket.on('player:tag', async ({ sessionId, targetId }) => {
    try {
      const db = require('./config/database');
      
      // Verify seeker
      const seeker = await db.query(
        'SELECT * FROM game_players WHERE id = $1 AND role = $2',
        [socket.playerId, 'seeker']
      );

      if (seeker.rows.length === 0) {
        socket.emit('error', { message: 'Only seeker can tag' });
        return;
      }

      // Tag player
      await db.query(
        'UPDATE game_players SET status = $1, tagged_at = NOW() WHERE id = $2',
        ['caught', targetId]
      );

      io.to(sessionId).emit('player:tagged', {
        targetId,
        seekerId: socket.playerId
      });

      // Check if game should end (all hiders caught)
      const remainingHiders = await db.query(
        'SELECT COUNT(*) FROM game_players WHERE session_id = $1 AND role = $2 AND status = $3',
        [sessionId, 'hider', 'active']
      );

      if (remainingHiders.rows[0].count === 0) {
        io.to(sessionId).emit('game:ended', {
          winner: 'seeker',
          reason: 'All hiders caught'
        });
        gameEngine.stopGame(sessionId);
      }
    } catch (error) {
      socket.emit('error', { message: 'Failed to tag player' });
    }
  });

  // Send message (end game only)
  socket.on('message:send', async ({ sessionId, toPlayerId, message, isBroadcast }) => {
    try {
      const db = require('./config/database');
      
      // Store message
      await db.query(
        `INSERT INTO game_messages 
         (session_id, from_player_id, to_player_id, message_text, is_broadcast)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, socket.playerId, toPlayerId, message, isBroadcast]
      );

      if (isBroadcast) {
        io.to(sessionId).emit('message:received', {
          fromPlayerId: socket.playerId,
          fromPlayerName: socket.playerName,
          message
        });
      } else {
        // Send to specific player (would need player socket mapping)
        socket.to(toPlayerId).emit('message:received', {
          fromPlayerId: socket.playerId,
          fromPlayerName: socket.playerName,
          message
        });
      }
    } catch (error) {
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Transfer points
  socket.on('points:transfer', async ({ sessionId, toPlayerId, amount }) => {
    try {
      const db = require('./config/database');
      
      // Get sender points
      const sender = await db.query(
        'SELECT points FROM game_players WHERE id = $1',
        [socket.playerId]
      );

      if (sender.rows[0].points < amount) {
        socket.emit('error', { message: 'Insufficient points' });
        return;
      }

      // Transfer
      await db.query(
        'UPDATE game_players SET points = points - $1 WHERE id = $2',
        [amount, socket.playerId]
      );

      await db.query(
        'UPDATE game_players SET points = points + $1 WHERE id = $2',
        [amount, toPlayerId]
      );

      // Log transaction
      await db.query(
        `INSERT INTO point_transactions 
         (session_id, from_player_id, to_player_id, amount, transaction_type, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sessionId, socket.playerId, toPlayerId, amount, 'transfer', 'Player point transfer']
      );

      io.to(sessionId).emit('points:transferred', {
        fromPlayerId: socket.playerId,
        toPlayerId,
        amount
      });
    } catch (error) {
      socket.emit('error', { message: 'Failed to transfer points' });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (socket.sessionId && socket.playerId) {
      io.to(socket.sessionId).emit('player:left', {
        playerId: socket.playerId,
        playerName: socket.playerName
      });
    }
    console.log(`🔌 Player disconnected: ${socket.id}`);
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║                                        ║
║     MOM'S COMING - GAME SERVER         ║
║                                        ║
║     🎮 Server running on port ${PORT}     ║
║     🗺️  GTA-style GPS hide and seek    ║
║     ⚡ Real-time tracking active       ║
║                                        ║
╚════════════════════════════════════════╝
  `);
  console.log(`
Environment: ${process.env.NODE_ENV}
Database: ${process.env.DB_NAME}
API: http://localhost:${PORT}
Health: http://localhost:${PORT}/health
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
