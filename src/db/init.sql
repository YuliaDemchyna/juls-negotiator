-- Optimized database schema for negotiator application

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- For better hashing

-- ========================================
-- ENUMS (Domain Value Objects)
-- ========================================

CREATE TYPE call_outcome AS ENUM ('SUCCESS', 'PARTIAL', 'REFUSED');
CREATE TYPE call_channel AS ENUM ('VAPI', 'MANUAL', 'INBOUND');
CREATE TYPE integration_status AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'RETRYING');

-- ========================================
-- CORE DOMAIN TABLES
-- ========================================

-- Users (Debtors) - Core Entity
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Identity
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(320), -- RFC 5322 max length
    
    -- Financial State
    total_debt DECIMAL(12, 2) NOT NULL CHECK (total_debt >= 0),
    remaining_debt DECIMAL(12, 2) NOT NULL CHECK (remaining_debt >= 0),
    
    -- Business Rules
    CONSTRAINT debt_consistency CHECK (remaining_debt <= total_debt),
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Call Sessions - Business Process Aggregate Root
CREATE TABLE IF NOT EXISTS call_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Relationships
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    
    -- Session Identity
    external_session_id VARCHAR(100) NOT NULL, -- VAPI session ID
    call_channel call_channel NOT NULL DEFAULT 'VAPI',
    
    -- Timeline
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER GENERATED ALWAYS AS (
        CASE 
            WHEN ended_at IS NOT NULL 
            THEN EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER
            ELSE NULL 
        END
    ) STORED,
    
    -- Business Outcome
    outcome call_outcome,
    initial_offer DECIMAL(12, 2) NOT NULL CHECK (initial_offer >= 0),
    final_amount DECIMAL(12, 2) NOT NULL CHECK (final_amount >= 0),
    
    -- Financial Impact
    debt_before DECIMAL(12, 2) NOT NULL CHECK (debt_before >= 0),
    debt_after DECIMAL(12, 2) NOT NULL CHECK (debt_after >= 0),
    
    -- Negotiation Process (Embedded Value Object)
    negotiation_data JSONB NOT NULL DEFAULT '{}',
    
    -- External Integration Tracking (Embedded Value Object)
    integrations JSONB NOT NULL DEFAULT '{}',
    
    -- Analytics
    success_rate DECIMAL(5, 2) GENERATED ALWAYS AS (
        CASE 
            WHEN initial_offer > 0 
            THEN ROUND(((final_amount - initial_offer) / initial_offer * 100)::NUMERIC, 2)
            ELSE 0 
        END
    ) STORED,
    
    -- Business Rules
    CONSTRAINT financial_consistency CHECK (debt_after <= debt_before),
    CONSTRAINT outcome_amount_consistency CHECK (
        (outcome = 'REFUSED' AND final_amount = 0) OR
        (outcome IN ('SUCCESS', 'PARTIAL') AND final_amount > 0)
    ),
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- INFRASTRUCTURE TABLES
-- ========================================

-- API Keys for M2M Authentication
CREATE TABLE IF NOT EXISTS api_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Identity
    name VARCHAR(100) NOT NULL,
    key_hash TEXT NOT NULL, -- bcrypt hash
    
    -- Access Control
    scopes TEXT[] NOT NULL DEFAULT '{}', -- ['userinfo', 'negotiation', 'call_result']
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    -- Usage Tracking
    last_used_at TIMESTAMPTZ,
    request_count BIGINT NOT NULL DEFAULT 0,
    
    -- Lifecycle
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Business Rules
    CONSTRAINT valid_scopes CHECK (
        scopes <@ ARRAY['userinfo', 'negotiation', 'call_result', 'admin']
    )
);

-- Webhook Delivery Tracking (Optional - for monitoring)
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Source
    call_session_id UUID REFERENCES call_sessions(id) ON DELETE CASCADE,
    webhook_type VARCHAR(50) NOT NULL, -- 'call-started', 'call-ended', etc.
    
    -- Delivery
    payload JSONB NOT NULL,
    response_status INTEGER,
    response_body TEXT,
    delivered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Retry Logic
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ
);

-- ========================================
-- PERFORMANCE INDEXES
-- ========================================

-- Primary query patterns
CREATE INDEX IF NOT EXISTS idx_users_phone_number ON users(phone_number);
CREATE INDEX IF NOT EXISTS idx_users_remaining_debt ON users(remaining_debt) WHERE remaining_debt > 0;

-- Call session queries
CREATE INDEX IF NOT EXISTS idx_call_sessions_user_outcome ON call_sessions(user_id, outcome);
CREATE INDEX IF NOT EXISTS idx_call_sessions_started_at ON call_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_sessions_external_session ON call_sessions(external_session_id);
CREATE INDEX IF NOT EXISTS idx_call_sessions_channel_outcome ON call_sessions(call_channel, outcome);

-- Analytics queries
CREATE INDEX IF NOT EXISTS idx_call_sessions_success_rate ON call_sessions(success_rate DESC) 
    WHERE outcome IN ('SUCCESS', 'PARTIAL');


-- API credentials
CREATE INDEX IF NOT EXISTS idx_api_credentials_active ON api_credentials(is_active, expires_at) 
    WHERE is_active = true;

-- ========================================
-- TRIGGERS & AUTOMATION
-- ========================================

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_call_sessions_updated_at 
    BEFORE UPDATE ON call_sessions  
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Auto-update user debt after successful call
CREATE OR REPLACE FUNCTION update_user_debt()
RETURNS TRIGGER AS $$
BEGIN
    -- Only update if call was successful and ended
    IF NEW.outcome IN ('SUCCESS', 'PARTIAL') AND OLD.outcome IS DISTINCT FROM NEW.outcome THEN
        UPDATE users 
        SET remaining_debt = NEW.debt_after,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.user_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER call_sessions_update_debt
    AFTER UPDATE ON call_sessions
    FOR EACH ROW EXECUTE FUNCTION update_user_debt();

-- ========================================
-- BUSINESS LOGIC CONSTRAINTS
-- ========================================

-- Prevent overlapping active sessions per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_call_sessions 
    ON call_sessions(user_id) 
    WHERE ended_at IS NULL;

