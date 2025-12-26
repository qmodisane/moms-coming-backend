# SETUP GUIDE - Mom's Coming Game

Complete step-by-step instructions to get the game server running.

## System Requirements

- **OS:** Ubuntu 20.04+, macOS 11+, or Windows 10+ with WSL2
- **Node.js:** v16.0.0 or higher
- **PostgreSQL:** v13 or higher
- **RAM:** 2GB minimum
- **Storage:** 500MB minimum

## Step 1: Install Prerequisites

### Ubuntu/Debian:
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### macOS:
```bash
# Install Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js
brew install node

# Install PostgreSQL
brew install postgresql@14
brew services start postgresql@14
```

### Windows (WSL2):
```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install PostgreSQL
sudo apt install postgresql postgresql-contrib
sudo service postgresql start
```

## Step 2: Set Up PostgreSQL

### Create database user:
```bash
# Switch to postgres user
sudo -u postgres psql

# Create user (replace 'yourpassword' with a secure password)
CREATE USER moms_coming_user WITH PASSWORD 'yourpassword';

# Grant privileges
ALTER USER moms_coming_user CREATEDB;

# Exit psql
\q
```

## Step 3: Clone and Setup Project

```bash
# Create project directory
mkdir ~/projects
cd ~/projects

# Extract the project files here
# (or git clone if you have a repository)

cd moms-coming-game

# Install dependencies
npm install
```

## Step 4: Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit with your favorite editor
nano .env  # or: vim .env, code .env
```

**Update these values in .env:**
```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=moms_coming_game
DB_USER=moms_coming_user
DB_PASSWORD=yourpassword  # Use the password you set earlier

# Google Maps API Key
GOOGLE_MAPS_API_KEY=your_api_key_here  # Get from Google Cloud Console

# Server
PORT=3000
NODE_ENV=development
```

## Step 5: Get Google Maps API Key

1. **Go to Google Cloud Console:**
   - Visit: https://console.cloud.google.com

2. **Create New Project:**
   - Click "Select a project" → "New Project"
   - Name: "Moms Coming Game"
   - Click "Create"

3. **Enable APIs:**
   - Go to "APIs & Services" → "Library"
   - Search and enable:
     - ✓ Maps JavaScript API
     - ✓ Geolocation API
     - ✓ Geocoding API
     - ✓ Maps Static API

4. **Create API Key:**
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "API Key"
   - Copy the key
   - Paste into `.env` file as `GOOGLE_MAPS_API_KEY`

5. **Restrict API Key (Important!):**
   - Click on your API key to edit
   - Under "Application restrictions":
     - Select "HTTP referrers" (for web)
     - Add your domain (e.g., `localhost:3000/*`)
   - Under "API restrictions":
     - Select "Restrict key"
     - Choose the 4 APIs you enabled
   - Click "Save"

## Step 6: Initialize Database

```bash
# Run database setup script
npm run db:setup
```

**Expected output:**
```
Connected to PostgreSQL
Creating database: moms_coming_game
✓ Database created
Connected to moms_coming_game
Running database schema...
✓ Schema created successfully

✅ Database setup complete!

You can now run: npm run dev
```

**If you see errors:**
- Check PostgreSQL is running: `sudo systemctl status postgresql`
- Verify credentials in `.env` match database user
- Check logs: `sudo journalctl -u postgresql -n 50`

## Step 7: Start Development Server

```bash
# Start server in development mode (auto-restart on changes)
npm run dev
```

**Expected output:**
```
╔════════════════════════════════════════╗
║                                        ║
║     MOM'S COMING - GAME SERVER         ║
║                                        ║
║     🎮 Server running on port 3000     ║
║     🗺️  GTA-style GPS hide and seek    ║
║     ⚡ Real-time tracking active       ║
║                                        ║
╚════════════════════════════════════════╝

Environment: development
Database: moms_coming_game
API: http://localhost:3000
Health: http://localhost:3000/health

✓ Database connected
```

## Step 8: Test the Server

### Test health endpoint:
```bash
curl http://localhost:3000/health
```

**Expected response:**
```json
{
  "status": "ok",
  "timestamp": "2024-...",
  "uptime": 1.234
}
```

### Create a test game:
```bash
curl -X POST http://localhost:3000/api/game/create \
  -H "Content-Type: application/json" \
  -d '{
    "hostPlayerId": "test-player-1",
    "hostPlayerName": "Test Player",
    "gameMode": "standard"
  }'
```

**Expected response:**
```json
{
  "success": true,
  "session": {
    "id": "...",
    "code": "123456",
    "hostPlayerId": "test-player-1",
    "status": "lobby",
    "settings": {...}
  }
}
```

## Step 9: Configure Firewall (Production)

If deploying to a server:

```bash
# Allow HTTP
sudo ufw allow 3000/tcp

# Allow HTTPS (for production)
sudo ufw allow 443/tcp

# Enable firewall
sudo ufw enable
```

## Troubleshooting

### Issue: "Cannot connect to database"
**Solution:**
```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# If not running, start it
sudo systemctl start postgresql

# Verify connection
psql -U moms_coming_user -d moms_coming_game -c "\l"
```

### Issue: "Port 3000 already in use"
**Solution:**
```bash
# Find process using port 3000
lsof -i :3000

# Kill process
kill -9 <PID>

# Or use different port in .env
PORT=3001
```

### Issue: "Google Maps API error"
**Solution:**
1. Verify API key is correct in `.env`
2. Check APIs are enabled in Google Cloud Console
3. Check billing is enabled (required even for free tier)
4. Verify API restrictions match your domain

### Issue: "Module not found"
**Solution:**
```bash
# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

## Production Deployment

### Using PM2 (Process Manager):
```bash
# Install PM2 globally
npm install -g pm2

# Start app with PM2
pm2 start src/server.js --name moms-coming

# Set to start on system boot
pm2 startup
pm2 save

# View logs
pm2 logs moms-coming

# Monitor
pm2 monit
```

### Using Docker:
```bash
# Build image
docker build -t moms-coming .

# Run container
docker run -d \
  --name moms-coming \
  -p 3000:3000 \
  --env-file .env \
  moms-coming

# View logs
docker logs -f moms-coming
```

### Environment Variables for Production:
```bash
NODE_ENV=production
PORT=3000
DB_HOST=your-production-db-host
DB_NAME=moms_coming_game
GOOGLE_MAPS_API_KEY=your-production-key
```

## Next Steps

1. **Test the API** - Use Postman or curl to test endpoints
2. **Build Frontend** - Create React Native mobile app
3. **Add Authentication** - Implement user accounts
4. **Deploy** - Push to production server
5. **Monitor** - Set up logging and monitoring

## Support

If you encounter issues:
1. Check this troubleshooting guide
2. Review server logs: `npm run dev` output
3. Check database logs: `sudo journalctl -u postgresql`
4. Verify all prerequisites are installed correctly

---

**Setup complete! Your game server is ready.** 🎮

Now you can start building the mobile app that connects to this backend.
