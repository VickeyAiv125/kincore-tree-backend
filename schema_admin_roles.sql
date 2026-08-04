-- Kincore Tree - Admin Role Support Tables
-- Supporting DevOps, Auditor, and Business roles

-- 1. system_incidents (DevOps)
CREATE TABLE IF NOT EXISTS system_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    severity VARCHAR(20) DEFAULT 'low', -- low, medium, high, critical
    status VARCHAR(20) DEFAULT 'open', -- open, investigating, resolved, closed
    reported_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 2. incident_timeline (DevOps)
CREATE TABLE IF NOT EXISTS incident_timeline (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID REFERENCES system_incidents(id) ON DELETE CASCADE,
    update_text TEXT NOT NULL,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 3. abuse_reports (Auditor)
CREATE TABLE IF NOT EXISTS abuse_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID REFERENCES users(id) ON DELETE SET NULL,
    target_type VARCHAR(50) NOT NULL, -- post, comment, user, story
    target_id VARCHAR(255) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    details TEXT,
    status VARCHAR(20) DEFAULT 'pending', -- pending, reviewing, resolved, dismissed
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 4. platform_subscriptions (Business)
CREATE TABLE IF NOT EXISTS platform_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    plan_type VARCHAR(50) DEFAULT 'free', -- free, premium, business
    status VARCHAR(20) DEFAULT 'active',
    amount_paid DECIMAL(18, 2) DEFAULT 0.00,
    currency VARCHAR(10) DEFAULT 'USD',
    next_billing_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_incidents_status ON system_incidents(status);
CREATE INDEX IF NOT EXISTS idx_reports_status ON abuse_reports(status);
CREATE INDEX IF NOT EXISTS idx_sub_user ON platform_subscriptions(user_id);

-- 5. support_tickets (Member Support)
CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    subject VARCHAR(255) NOT NULL,
    priority VARCHAR(20) DEFAULT 'medium', -- low, medium, high, urgent
    status VARCHAR(20) DEFAULT 'open', -- open, in_progress, resolved, closed
    category VARCHAR(50), -- tree_bug, payment, account_access
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 6. ticket_messages (Member Support)
CREATE TABLE IF NOT EXISTS ticket_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID REFERENCES support_tickets(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES users(id),
    message TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status);

-- 7. announcements (Content Creator)
CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    category VARCHAR(50) DEFAULT 'news', -- news, maintenance, feature, community
    is_public BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_announcements_category ON announcements(category);

-- 8. Migration Support (Update persons)
ALTER TABLE persons ADD COLUMN IF NOT EXISTS birth_place VARCHAR(255);
ALTER TABLE persons ADD COLUMN IF NOT EXISTS death_place VARCHAR(255);
ALTER TABLE persons ADD COLUMN IF NOT EXISTS latitude DECIMAL(9, 6);
ALTER TABLE persons ADD COLUMN IF NOT EXISTS longitude DECIMAL(9, 6);

-- 9. Admin Configuration (Global Settings)
CREATE TABLE IF NOT EXISTS platform_settings (
    key VARCHAR(50) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);
