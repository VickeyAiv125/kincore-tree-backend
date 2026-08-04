-- Kincore Tree - DB Update Script (v3.0 -> v3.2)
-- Run this on top of your existing v3.0 schema to add missing features.

-- 1. admin_users (Platform-wide Governance)
CREATE TABLE IF NOT EXISTS admin_users (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL, -- owner, council, business, devops, auditor, super_admin
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 2. family_history (Chronological Chapters)
CREATE TABLE IF NOT EXISTS family_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID REFERENCES family_spaces(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT,
    cover_image VARCHAR(500),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 3. albums (Digital Media Groupings)
CREATE TABLE IF NOT EXISTS albums (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID REFERENCES family_spaces(id) ON DELETE CASCADE,
    creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    cover_url VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 4. Linking Media to Albums
ALTER TABLE media ADD COLUMN IF NOT EXISTS album_id UUID REFERENCES albums(id) ON DELETE SET NULL;

-- 5. Governance Indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_stories_expiry ON stories(expires_at);

-- RLS Enablement for new tables
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE albums ENABLE ROW LEVEL SECURITY;

-- 6. Events & Engagement Modernization (v3.2)
ALTER TABLE events 
ADD COLUMN IF NOT EXISTS visibility VARCHAR(50) DEFAULT 'Family visible',
ADD COLUMN IF NOT EXISTS cover_image VARCHAR(500),
ADD COLUMN IF NOT EXISTS event_type VARCHAR(100),
ADD COLUMN IF NOT EXISTS event_time VARCHAR(50),
ADD COLUMN IF NOT EXISTS rsvp_deadline TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS branch_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS audience VARCHAR(50) DEFAULT 'Entire family',
ADD COLUMN IF NOT EXISTS invite_methods JSONB DEFAULT '{"notification": true, "email": false}'::jsonb,
ADD COLUMN IF NOT EXISTS reminders JSONB DEFAULT '["1d before"]'::jsonb,
ADD COLUMN IF NOT EXISTS guests_allowed INTEGER DEFAULT 0;

-- 7. Secret Santa / Gift Exchange System
CREATE TABLE IF NOT EXISTS secret_santa_exchanges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    budget_min NUMERIC DEFAULT 0,
    budget_max NUMERIC DEFAULT 0,
    gift_deadline TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    anonymous_mode BOOLEAN DEFAULT TRUE,
    is_drawn BOOLEAN DEFAULT FALSE,
    is_locked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(event_id)
);

CREATE TABLE IF NOT EXISTS secret_santa_pairings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exchange_id UUID REFERENCES secret_santa_exchanges(id) ON DELETE CASCADE,
    giver_id UUID REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(exchange_id, giver_id)
);

CREATE TABLE IF NOT EXISTS secret_santa_wishlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exchange_id UUID REFERENCES secret_santa_exchanges(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(exchange_id, user_id)
);
