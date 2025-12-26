# QUICK START - Get Running in 5 Minutes

## Prerequisites Installed?
- ✓ Node.js 16+
- ✓ PostgreSQL 13+
- ✓ Git

If not, see `docs/SETUP.md` for installation instructions.

## 1. Extract Project
```bash
# Navigate to where you extracted the files
cd moms-coming-game
```

## 2. Install Dependencies
```bash
npm install
```

## 3. Setup Environment
```bash
# Copy environment template
cp .env.example .env

# Edit .env and add:
# - Your PostgreSQL password
# - Your Google Maps API key
nano .env
```

## 4. Create Database
```bash
npm run db:setup
```

## 5. Start Server
```bash
npm run dev
```

## 6. Test It Works
```bash
# In another terminal:
curl http://localhost:3000/health
```

## Done! 🎉

Server is running at: http://localhost:3000

## Next Steps

### Create Your First Game:
```bash
curl -X POST http://localhost:3000/api/game/create \
  -H "Content-Type: application/json" \
  -d '{
    "hostPlayerId": "player1",
    "hostPlayerName": "TestPlayer",
    "gameMode": "standard"
  }'
```

This will return a 6-digit game code.

### Join the Game:
```bash
curl -X POST http://localhost:3000/api/game/join \
  -H "Content-Type: application/json" \
  -d '{
    "sessionCode": "123456",
    "playerName": "Player2",
    "playerId": "player2"
  }'
```

### Check Game State:
```bash
curl http://localhost:3000/api/game/<SESSION_ID>/state
```

## What's Next?

1. **Read the README** - Full documentation
2. **Check API docs** - Available in `docs/` folder  
3. **Build the mobile app** - Connect to this backend
4. **Test gameplay** - Create test games

## Need Help?

- Full setup guide: `docs/SETUP.md`
- API documentation: `docs/API.md`
- Troubleshooting: Check `docs/SETUP.md` troubleshooting section

---

**You're ready to build!** 🚀
