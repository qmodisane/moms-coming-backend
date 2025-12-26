# MOM'S COMING - Real-World GPS Hide and Seek

🎮 A strategic, GPS-based hide-and-seek game with GTA-style satellite view, missions, point economy, and betrayal mechanics.

## 🌟 Features

- **Real-Time GPS Tracking**: Track all players on actual satellite maps
- **Strategic Missions**: Mandatory objectives that force movement and risk/reward decisions
- **Point Economy**: Earn points through missions, spend on immunity
- **Immunity Spot**: Compete for safe zones that cost points
- **Shrinking Boundaries**: Battle-royale style zones that force players together
- **End-Game Communication**: Limited messaging and point trading in final phase
- **Chaos Mode**: Collective violations reveal all players
- **Reverse Chase**: Hiders can pool points to hunt the seeker

## 🚀 Quick Start

### Prerequisites

- Node.js 16+ 
- PostgreSQL 13+
- Google Maps API Key

### Installation

```bash
# 1. Clone the repository
git clone <your-repo>
cd moms-coming-game

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env with your database credentials and Google Maps API key

# 4. Set up database
npm run db:setup

# 5. Start the server
npm run dev
```

The server will start on http://localhost:3000

### Get Google Maps API Key

1. Go to https://console.cloud.google.com
2. Create a new project or select existing
3. Enable these APIs:
   - Maps JavaScript API
   - Geolocation API
   - Geocoding API
4. Create credentials (API Key)
5. Add key to `.env` file

## 📖 How to Play

### Setup Phase

1. **Host Creates Game**
   - Open app, tap "Create Game"
   - Set game duration (30-60 min)
   - Choose settings (off-limits, win conditions)

2. **Players Join**
   - Enter 6-digit game code
   - All players must be in same physical area

3. **Define Boundary**
   - Host walks perimeter or draws on satellite map
   - Set immunity spot location
   - Assign seeker role

4. **Start Game**
   - Seeker counts to 60
   - Hiders scatter
   - Game begins!

### Gameplay Loop

**For Hiders:**
- Complete mandatory missions to earn points
- Avoid out-of-bounds areas (instant reveal)
- Reach 50+ points to access immunity spot
- Manage violations (failed missions = penalties)
- In final 10 min: communicate, trade points, form alliances

**For Seeker:**
- Hunt and tag all hiders before time runs out
- Trigger missions to force hider movement (costs immunity reveal)
- Watch for violations (out of bounds reveals locations)
- No cooldown after tagging (unless multiple seekers)

### Victory Conditions

**Hiders Win:** At least one hider survives until time expires
**Seeker Wins:** Tags all hiders before time runs out

## 🛠️ Tech Stack

**Backend:**
- Node.js + Express
- Socket.IO (real-time WebSocket)
- PostgreSQL (game data)
- Google Maps API (satellite view, geolocation)

**Frontend:** (Coming soon)
- React Native (iOS/Android)
- React (Web version)
- Socket.IO Client
- Google Maps JavaScript API

## 📁 Project Structure

```
moms-coming-game/
├── src/
│   ├── config/
│   │   └── database.js          # DB connection
│   ├── models/                  # Data models (future)
│   ├── services/
│   │   ├── GameEngine.js        # Main game loop
│   │   ├── GoogleMapsService.js # Maps integration
│   │   ├── MissionGenerator.js  # Mission creation
│   │   └── ViolationHandler.js  # Rule enforcement
│   ├── api/
│   │   └── routes/
│   │       ├── game.js          # Game CRUD
│   │       ├── player.js        # Player actions
│   │       └── mission.js       # Mission endpoints
│   └── server.js                # Entry point
├── scripts/
│   ├── database-schema.sql      # DB schema
│   └── setup-database.js        # Setup script
├── docs/                        # Documentation
├── .env.example                 # Environment template
└── package.json
```

## 🔌 API Endpoints

### Game Management

```
POST   /api/game/create              Create new game
POST   /api/game/join                Join existing game
POST   /api/game/:id/boundary        Set game boundary
POST   /api/game/:id/start           Start game
GET    /api/game/:id/state           Get game state
```

### Player Actions

```
POST   /api/player/:id/location      Update player location
GET    /api/player/:id                Get player info
GET    /api/player/:id/stats          Get player statistics
```

### Missions

```
POST   /api/mission/generate/:sessionId   Generate missions
POST   /api/mission/:id/complete          Complete mission
GET    /api/mission/player/:playerId      Get player missions
```

### WebSocket Events

**Client → Server:**
- `game:join` - Join game session
- `location:update` - Update player position
- `immunity:claim` - Claim immunity spot
- `mission:complete` - Complete mission
- `player:tag` - Tag another player (seeker)
- `message:send` - Send message (end game)
- `points:transfer` - Transfer points

**Server → Client:**
- `game:state` - Current game state
- `boundary:shrinking` - Boundary about to shrink
- `mission:failed` - Mission deadline expired
- `violation:out_of_bounds` - Player out of bounds
- `chaos:mode_activated` - Chaos mode triggered
- `communication:enabled` - End game messaging active
- `game:ended` - Game finished

## 🎮 Game Configuration

Game settings (in `settings` field when creating game):

```json
{
  "duration": 3600000,              // 1 hour in ms
  "boundaryShrinInterval": 600000,  // 10 minutes
  "missionFrequency": 300000,       // 5 minutes
  "offLimitsEnabled": false,        // Enable off-limits zones
  "seekerCount": 1,                 // Number of seekers
  "winCondition": "hybrid",         // survival|points|hybrid
  "communicationMode": "final_phase_only"
}
```

## 🐛 Troubleshooting

**Database connection fails:**
- Check PostgreSQL is running: `pg_isready`
- Verify credentials in `.env`
- Ensure database exists: `psql -l`

**Google Maps not loading:**
- Verify API key is correct in `.env`
- Check APIs are enabled in Google Cloud Console
- Check browser console for specific errors

**WebSocket connection issues:**
- Check firewall allows port 3000
- Verify CORS settings in `server.js`
- Check network connectivity

## 📝 Development Roadmap

**Phase 1: Backend (Current)** ✓
- Core game engine
- Real-time tracking
- Mission system
- Point economy

**Phase 2: Mobile App (Next)**
- React Native app
- Google Maps integration
- Graffiti UI theme
- Real-time updates

**Phase 3: Advanced Features**
- Reverse chase mode
- Replay system
- Statistics dashboard
- Leaderboards

**Phase 4: Polish**
- Sound effects
- Animations
- Tutorial
- App store launch

## 🤝 Contributing

This is currently a personal project. Contributions welcome after v1.0 launch!

## 📄 License

MIT License - See LICENSE file

## 🎨 Design Philosophy

Inspired by:
- GTA (satellite minimap, urban setting)
- Jet Set Radio (graffiti aesthetic)
- Splatoon (vibrant colors, ink mechanics)
- Mirror's Edge (clean UI, high contrast)
- PUBG/Fortnite (battle royale mechanics)

## 📧 Contact

Created by Q - Cybersecurity student and game developer
- Project: Real-world GPS gaming
- Tech Stack: Node.js, PostgreSQL, Socket.IO, Google Maps

---

**Built with ❤️ in South Africa 🇿🇦**
