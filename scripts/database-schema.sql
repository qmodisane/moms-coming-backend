-- Mom's Coming Game Database Schema
-- PostgreSQL 13+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Game Sessions Table
CREATE TABLE game_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_code VARCHAR(6) UNIQUE NOT NULL,
    host_player_id VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'lobby',
    game_mode VARCHAR(50) NOT NULL DEFAULT 'standard',
    created_at TIMESTAMP DEFAULT NOW(),
    started_at TIMESTAMP,
    ended_at TIMESTAMP,
    settings JSONB DEFAULT '{}',
    CONSTRAINT status_check CHECK (status IN ('lobby', 'active', 'finished', 'cancelled'))
);

-- Players in Game
CREATE TABLE game_players (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES game_sessions(id) ON DELETE CASCADE,
    player_id VARCHAR(50) NOT NULL,
    player_name VARCHAR(50) NOT NULL,
    role VARCHAR(20) NOT NULL,
    points INTEGER DEFAULT 0,
    violations INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active',
    last_location JSONB,
    joined_at TIMESTAMP DEFAULT NOW(),
    tagged_at TIMESTAMP,
    CONSTRAINT role_check CHECK (role IN ('seeker', 'hider')),
    CONSTRAINT status_check CHECK (status IN ('active', 'caught', 'disconnected', 'eliminated'))
);

-- Game Boundaries
CREATE TABLE game_boundaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES game_sessions(id) ON DELETE CASCADE,
    original_boundary JSONB NOT NULL,
    current_boundary JSONB NOT NULL,
    shrink_schedule JSONB,
    last_shrink_at TIMESTAMP,
    next_shrink_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Missions
CREATE TABLE missions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES game_sessions(id) ON DELETE CASCADE,
    assigned_to UUID REFERENCES game_players(id),
    mission_type VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    target_location JSONB,
    point_value INTEGER NOT NULL,
    risk_level VARCHAR(20),
    status VARCHAR(20) DEFAULT 'assigned',
    assigned_at TIMESTAMP DEFAULT NOW(),
    deadline TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,
    verification_data JSONB,
    CONSTRAINT mission_type_check CHECK (mission_type IN ('location', 'task', 'photo', 'proximity', 'stealth', 'nightmare')),
    CONSTRAINT risk_level_check CHECK (risk_level IN ('safe', 'medium', 'high', 'nightmare')),
    CONSTRAINT status_check CHECK (status IN ('assigned', 'in_progress', 'completed', 'failed', 'expired'))
);

-- Violations
CREATE TABLE violations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES game_sessions(id) ON DELETE CASCADE,
    player_id UUID REFERENCES game_players(id),
    violation_type VARCHAR(50) NOT NULL,
    penalty_applied JSONB,
    location JSONB,
    timestamp TIMESTAMP DEFAULT NOW(),
    resolved BOOLEAN DEFAULT FALSE
);

-- Immunity Spots
CREATE TABLE immunity_spots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES game_sessions(id) ON DELETE CASCADE,
    location JSONB NOT NULL,
    unlock_threshold INTEGER DEFAULT 50,
    activation_cost INTEGER DEFAULT 0,
    drain_rate INTEGER DEFAULT 1,
    occupied_by UUID REFERENCES game_players(id),
    occupied_at TIMESTAMP,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Game Events (for replay and analytics)
CREATE TABLE game_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES game_sessions(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    player_id UUID REFERENCES game_players(id),
    event_data JSONB,
    location JSONB,
    timestamp TIMESTAMP DEFAULT NOW()
);

-- Point Transactions (for tracking economy)
CREATE TABLE point_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES game_sessions(id) ON DELETE CASCADE,
    from_player_id UUID REFERENCES game_players(id),
    to_player_id UUID REFERENCES game_players(id),
    amount INTEGER NOT NULL,
    transaction_type VARCHAR(50) NOT NULL,
    reason TEXT,
    timestamp TIMESTAMP DEFAULT NOW(),
    CONSTRAINT transaction_type_check CHECK (transaction_type IN ('mission_reward', 'mission_penalty', 'transfer', 'immunity_cost', 'violation_penalty'))
);

-- Communication Messages (end game only)
CREATE TABLE game_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES game_sessions(id) ON DELETE CASCADE,
    from_player_id UUID REFERENCES game_players(id),
    to_player_id UUID REFERENCES game_players(id),
    message_text TEXT NOT NULL,
    is_broadcast BOOLEAN DEFAULT FALSE,
    timestamp TIMESTAMP DEFAULT NOW()
);

-- Indexes for Performance
CREATE INDEX idx_game_sessions_status ON game_sessions(status);
CREATE INDEX idx_game_sessions_code ON game_sessions(session_code);
CREATE INDEX idx_game_players_session ON game_players(session_id);
CREATE INDEX idx_game_players_status ON game_players(status);
CREATE INDEX idx_missions_session ON missions(session_id);
CREATE INDEX idx_missions_assigned ON missions(assigned_to);
CREATE INDEX idx_missions_status ON missions(status);
CREATE INDEX idx_violations_session ON violations(session_id);
CREATE INDEX idx_game_events_session ON game_events(session_id);
CREATE INDEX idx_game_events_timestamp ON game_events(timestamp);
CREATE INDEX idx_point_transactions_session ON point_transactions(session_id);

-- Comments
COMMENT ON TABLE game_sessions IS 'Main game session data';
COMMENT ON TABLE game_players IS 'Players participating in games';
COMMENT ON TABLE missions IS 'Individual missions assigned to hiders';
COMMENT ON TABLE immunity_spots IS 'Safe zones that cost points to access';
COMMENT ON COLUMN game_players.points IS 'Current point balance for purchasing immunity';
COMMENT ON COLUMN immunity_spots.drain_rate IS 'Points drained per 5 seconds of occupation';
