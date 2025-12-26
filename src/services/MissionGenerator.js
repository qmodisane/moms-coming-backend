const db = require('../config/database');
const GoogleMapsService = require('./GoogleMapsService');

class MissionGenerator {
  constructor() {
    this.missionTemplates = {
      location: [
        'Move to {room} within {time} seconds',
        'Enter the {room} area',
        'Reach {landmark} without being seen'
      ],
      task: [
        'Turn lights on/off in {room}',
        'Take a photo of {object}',
        'Do {count} jumping jacks silently',
        'Stand completely still for {duration} seconds'
      ],
      proximity: [
        'Get within 10 meters of the seeker',
        'Stay near immunity spot for 2 minutes',
        'Enter same room as seeker'
      ],
      stealth: [
        'Cross the open area without detection',
        'Enter and exit {room} unseen',
        'Make a noise to draw seeker away'
      ],
      nightmare: [
        'Tag the seeker (Hunt the Hunter mode)',
        'Retrieve object from seeker\'s last location',
        'Survive in seeker\'s line of sight for 45 seconds'
      ]
    };
  }

  /**
   * Generate mission for a hider
   */
  async generateMission(sessionId, playerId, seekerLocation) {
    // Get player info
    const playerData = await db.query(
      'SELECT * FROM game_players WHERE id = $1',
      [playerId]
    );
    
    if (playerData.rows.length === 0) return null;
    
    const player = playerData.rows[0];
    const playerLocation = player.last_location;

    if (!playerLocation || !seekerLocation) {
      // Can't calculate risk, give safe mission
      return this.createSafeMission(sessionId, playerId);
    }

    // Calculate risk based on distance to seeker
    const distance = GoogleMapsService.calculateDistance(
      playerLocation,
      seekerLocation
    );

    let riskLevel, pointMultiplier;
    if (distance < 10) {
      riskLevel = 'nightmare';
      pointMultiplier = 3;
    } else if (distance < 20) {
      riskLevel = 'high';
      pointMultiplier = 2;
    } else if (distance < 40) {
      riskLevel = 'medium';
      pointMultiplier = 1.5;
    } else {
      riskLevel = 'safe';
      pointMultiplier = 1;
    }

    // Select mission type based on risk
    const missionType = this.selectMissionType(riskLevel);
    const template = this.selectTemplate(missionType);
    const description = this.fillTemplate(template);
    
    const basePoints = this.calculateBasePoints(missionType);
    const points = Math.floor(basePoints * pointMultiplier);
    const deadline = new Date(Date.now() + 180000); // 3 minutes

    // Insert mission
    const result = await db.query(
      `INSERT INTO missions 
       (session_id, assigned_to, mission_type, description, point_value, risk_level, deadline)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [sessionId, playerId, missionType, description, points, riskLevel, deadline]
    );

    return result.rows[0];
  }

  /**
   * Generate missions for all hiders
   */
  async generateMissionsForAllHiders(sessionId) {
    // Get seeker location
    const seekerData = await db.query(
      'SELECT * FROM game_players WHERE session_id = $1 AND role = $2',
      [sessionId, 'seeker']
    );

    if (seekerData.rows.length === 0) return [];

    const seeker = seekerData.rows[0];
    const seekerLocation = seeker.last_location;

    // Get all active hiders
    const hiders = await db.query(
      'SELECT * FROM game_players WHERE session_id = $1 AND role = $2 AND status = $3',
      [sessionId, 'hider', 'active']
    );

    const missions = [];
    for (const hider of hiders.rows) {
      const mission = await this.generateMission(sessionId, hider.id, seekerLocation);
      if (mission) missions.push(mission);
    }

    return missions;
  }

  /**
   * Helper methods
   */
  selectMissionType(riskLevel) {
    if (riskLevel === 'nightmare') {
      return Math.random() > 0.5 ? 'nightmare' : 'proximity';
    } else if (riskLevel === 'high') {
      return Math.random() > 0.6 ? 'proximity' : 'stealth';
    } else if (riskLevel === 'medium') {
      return Math.random() > 0.5 ? 'task' : 'location';
    } else {
      return Math.random() > 0.5 ? 'location' : 'task';
    }
  }

  selectTemplate(missionType) {
    const templates = this.missionTemplates[missionType] || this.missionTemplates.location;
    return templates[Math.floor(Math.random() * templates.length)];
  }

  fillTemplate(template) {
    const rooms = ['kitchen', 'living room', 'bedroom', 'bathroom', 'hallway'];
    const objects = ['a window', 'a door', 'a chair', 'a plant', 'the ceiling'];
    
    return template
      .replace('{room}', rooms[Math.floor(Math.random() * rooms.length)])
      .replace('{time}', Math.floor(60 + Math.random() * 120))
      .replace('{count}', Math.floor(5 + Math.random() * 15))
      .replace('{duration}', Math.floor(30 + Math.random() * 60))
      .replace('{object}', objects[Math.floor(Math.random() * objects.length)])
      .replace('{landmark}', 'the marked location');
  }

  calculateBasePoints(missionType) {
    const basePoints = {
      location: 30,
      task: 40,
      proximity: 80,
      stealth: 60,
      nightmare: 150
    };
    return basePoints[missionType] || 30;
  }

  createSafeMission(sessionId, playerId) {
    // Fallback safe mission
    const description = 'Take a photo of any object near you';
    const deadline = new Date(Date.now() + 180000);
    
    return db.query(
      `INSERT INTO missions 
       (session_id, assigned_to, mission_type, description, point_value, risk_level, deadline)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [sessionId, playerId, 'task', description, 25, 'safe', deadline]
    ).then(r => r.rows[0]);
  }
}

module.exports = new MissionGenerator();
