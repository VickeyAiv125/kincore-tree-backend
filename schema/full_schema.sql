-- =============================================================================
-- Kincore — Full Database Schema (structure only, no user/family seed data)
-- Target: Supabase (PostgreSQL 15+) or compatible Postgres
-- Run once on an empty database. Safe to re-run (IF NOT EXISTS / IF NOT EXISTS cols).
-- =============================================================================
-- Auth: public.users.id → auth.users(id). Sign-up flow creates both rows.
-- Storage buckets (create in Supabase UI): media, avatars
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Extensions
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- 1. Core platform users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    avatar_url VARCHAR(500),
    wallet_id INTEGER,
    wallet_handle VARCHAR(100),
    language VARCHAR(10) DEFAULT 'en',
    theme VARCHAR(10) DEFAULT 'light',
    status VARCHAR(20) DEFAULT 'active',
    person_id UUID,
    date_of_birth DATE,
    bio TEXT,
    place_of_birth VARCHAR(255),
    gender VARCHAR(20),
    hide_birth_date BOOLEAN DEFAULT false,
    hide_location BOOLEAN DEFAULT false,
    hide_living_status BOOLEAN DEFAULT false,
    protect_as_minor BOOLEAN DEFAULT false,
    last_login_at TIMESTAMPTZ,
    occupation VARCHAR(255),
    designation VARCHAR(255),
    company_name VARCHAR(255),
    website VARCHAR(500),
    linkedin VARCHAR(500),
    instagram VARCHAR(500),
    facebook VARCHAR(500),
    other_link VARCHAR(500),
    death_date DATE,
    level INTEGER DEFAULT 1,
    community_level INTEGER DEFAULT 1,
    level_title VARCHAR(100),
    xp INTEGER DEFAULT 0,
    xp_points INTEGER DEFAULT 0,
    family_id UUID,
    family_name VARCHAR(255),
    suspended_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_wallet_handle ON public.users(wallet_handle);

CREATE TABLE IF NOT EXISTS public.admin_users (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    email VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);
CREATE INDEX IF NOT EXISTS idx_admin_users_role ON public.admin_users(role);

-- -----------------------------------------------------------------------------
-- 2. Family spaces & membership
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.family_spaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    cover_image VARCHAR(500),
    code VARCHAR(50) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    visibility VARCHAR(50) DEFAULT 'private',
    region VARCHAR(100),
    category VARCHAR(50),
    contact_email VARCHAR(255),
    max_members INTEGER,
    subscription_tier VARCHAR(50) DEFAULT 'free',
    plan_tier VARCHAR(50) DEFAULT 'free',
    storage_quota_bytes BIGINT DEFAULT 10737418240,
    storage_used_bytes BIGINT DEFAULT 0,
    settings JSONB DEFAULT '{}'::jsonb,
    risk_level VARCHAR(20),
    risk_score INTEGER,
    status_reason TEXT,
    features_gated BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);
CREATE INDEX IF NOT EXISTS idx_family_spaces_owner ON public.family_spaces(owner_id);
CREATE INDEX IF NOT EXISTS idx_family_spaces_code ON public.family_spaces(code);

CREATE TABLE IF NOT EXISTS public.family_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID NOT NULL REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'member',
    status VARCHAR(20) DEFAULT 'active',
    branch_id UUID,
    joined_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    UNIQUE(family_space_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_family_memberships_user ON public.family_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_family_memberships_space ON public.family_memberships(family_space_id);

CREATE TABLE IF NOT EXISTS public.family_space_staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID NOT NULL REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'admin',
    is_active BOOLEAN DEFAULT true,
    assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    UNIQUE(family_space_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.family_branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID NOT NULL REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50),
    description TEXT,
    region VARCHAR(100),
    branch_admin_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    root_person_id UUID,
    head_person_id UUID,
    founding_year INTEGER,
    migration_origin VARCHAR(255),
    emblem_url VARCHAR(500),
    visibility VARCHAR(50) DEFAULT 'family',
    invite_policy VARCHAR(50) DEFAULT 'admin_approval',
    can_add_members BOOLEAN DEFAULT true,
    can_edit_history BOOLEAN DEFAULT true,
    can_upload_media BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);
CREATE INDEX IF NOT EXISTS idx_family_branches_space ON public.family_branches(family_space_id);

-- Legacy alias used in roleMiddleware
CREATE OR REPLACE VIEW public.memberships AS
    SELECT * FROM public.family_memberships;

-- -----------------------------------------------------------------------------
-- 3. Genealogy / tree
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clan_trees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.persons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clan_tree_id UUID REFERENCES public.clan_trees(id) ON DELETE CASCADE,
    family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES public.family_branches(id) ON DELETE SET NULL,
    full_name VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    chinese_name VARCHAR(255),
    email VARCHAR(255),
    birth_date DATE,
    date_of_birth DATE,
    death_date DATE,
    is_alive BOOLEAN DEFAULT true,
    gender VARCHAR(20),
    bio TEXT,
    avatar_url VARCHAR(500),
    privacy_mode VARCHAR(20) DEFAULT 'private',
    profile_visibility VARCHAR(50),
    claimed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'active',
    role VARCHAR(50),
    member_status VARCHAR(50),
    pending_role VARCHAR(50),
    birth_place VARCHAR(255),
    place_of_birth VARCHAR(255),
    death_place VARCHAR(255),
    current_location VARCHAR(255),
    school_college VARCHAR(255),
    qualification VARCHAR(255),
    study_location VARCHAR(255),
    occupation VARCHAR(255),
    bio_notes TEXT,
    hide_sensitive_details BOOLEAN DEFAULT false,
    hide_birth_date BOOLEAN DEFAULT false,
    hide_location BOOLEAN DEFAULT false,
    hide_living_status BOOLEAN DEFAULT false,
    protect_as_minor BOOLEAN DEFAULT false,
    latitude DECIMAL(9, 6),
    longitude DECIMAL(9, 6),
    anniversary_date DATE,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);
CREATE INDEX IF NOT EXISTS idx_persons_clan_tree ON public.persons(clan_tree_id);
CREATE INDEX IF NOT EXISTS idx_persons_family_space ON public.persons(family_space_id);
CREATE INDEX IF NOT EXISTS idx_persons_claimed_by ON public.persons(claimed_by);
CREATE INDEX IF NOT EXISTS idx_persons_email ON public.persons(email);

-- root_person_id / head_person_id on family_branches are plain UUIDs (avoid circular FK with persons)

CREATE TABLE IF NOT EXISTS public.person_relations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clan_tree_id UUID REFERENCES public.clan_trees(id) ON DELETE CASCADE,
    person_id_1 UUID NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
    person_id_2 UUID NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
    relation_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.person_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID NOT NULL REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    person_id UUID NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
    related_person_id UUID NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
    relationship_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.branch_edit_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID NOT NULL REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES public.family_branches(id) ON DELETE SET NULL,
    requested_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    request_type VARCHAR(50) NOT NULL,
    target_person_id UUID REFERENCES public.persons(id) ON DELETE SET NULL,
    current_value JSONB,
    proposed_value JSONB,
    reason TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    reviewer_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reviewer_comment TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    person_id UUID NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
    family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending',
    type VARCHAR(50),
    details JSONB,
    requested_by_name VARCHAR(255),
    confidence_score INTEGER,
    evidence_url TEXT,
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.migration_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID NOT NULL REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    from_location VARCHAR(255),
    to_location VARCHAR(255),
    from_lat DECIMAL(9, 6),
    from_lng DECIMAL(9, 6),
    to_lat DECIMAL(9, 6),
    to_lng DECIMAL(9, 6),
    reason TEXT,
    is_branch_migration BOOLEAN DEFAULT false,
    date_type VARCHAR(20),
    date_value DATE,
    approximate_period VARCHAR(100),
    description TEXT,
    visibility VARCHAR(50) DEFAULT 'family',
    tags JSONB DEFAULT '[]'::jsonb,
    persons JSONB DEFAULT '[]'::jsonb,
    branches JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.family_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT,
    cover_image VARCHAR(500),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- Legacy table referenced in old backups
CREATE TABLE IF NOT EXISTS public.family_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- -----------------------------------------------------------------------------
-- 4. Social / content
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    post_type VARCHAR(50) DEFAULT 'text',
    media_urls JSONB DEFAULT '[]'::jsonb,
    tagged_users JSONB DEFAULT '[]'::jsonb,
    visibility VARCHAR(20) DEFAULT 'family',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_posts_family_space ON public.posts(family_space_id);

CREATE TABLE IF NOT EXISTS public.comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    UNIQUE(post_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.stories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    media_url VARCHAR(500) NOT NULL,
    media_type VARCHAR(20) NOT NULL,
    text_content TEXT,
    visibility VARCHAR(20) DEFAULT 'family',
    status VARCHAR(20) DEFAULT 'active',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);
CREATE INDEX IF NOT EXISTS idx_stories_expiry ON public.stories(expires_at);

CREATE TABLE IF NOT EXISTS public.bookmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    UNIQUE(user_id, post_id)
);

CREATE TABLE IF NOT EXISTS public.saved_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
    saved_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    UNIQUE(user_id, post_id)
);

CREATE TABLE IF NOT EXISTS public.albums (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    creator_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    cover_url VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    album_id UUID REFERENCES public.albums(id) ON DELETE SET NULL,
    url VARCHAR(500) NOT NULL,
    thumbnail_url VARCHAR(500),
    file_path VARCHAR(500),
    type VARCHAR(20) NOT NULL,
    size BIGINT,
    storage_size BIGINT DEFAULT 0,
    visibility VARCHAR(20) DEFAULT 'family',
    metadata JSONB DEFAULT '{}'::jsonb,
    attach_to_type VARCHAR(50),
    attach_to_id UUID,
    is_deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);
CREATE INDEX IF NOT EXISTS idx_media_family_space ON public.media(family_space_id);

CREATE TABLE IF NOT EXISTS public.media_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id UUID NOT NULL REFERENCES public.media(id) ON DELETE CASCADE,
    person_id UUID REFERENCES public.persons(id) ON DELETE SET NULL,
    tagged_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    x_percent DECIMAL(5, 2),
    y_percent DECIMAL(5, 2),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.family_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID NOT NULL REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    uploaded_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    file_size_bytes BIGINT NOT NULL DEFAULT 0,
    file_url TEXT NOT NULL,
    file_type VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.family_bios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID NOT NULL REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    location VARCHAR(255),
    bio_date DATE,
    content TEXT,
    cover_image_url VARCHAR(500),
    gallery_urls JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.content_moderation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID NOT NULL REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    target_type VARCHAR(50) NOT NULL,
    target_id UUID NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    moderator_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- -----------------------------------------------------------------------------
-- 5. Events & Secret Santa
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    creator_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ,
    location VARCHAR(255),
    max_participants INTEGER,
    status VARCHAR(20) DEFAULT 'upcoming',
    visibility VARCHAR(50) DEFAULT 'Family visible',
    cover_image VARCHAR(500),
    cover_photo_url VARCHAR(500),
    event_type VARCHAR(100),
    event_time VARCHAR(50),
    rsvp_deadline TIMESTAMPTZ,
    branch_name VARCHAR(100),
    audience VARCHAR(50) DEFAULT 'Entire family',
    invite_methods JSONB DEFAULT '{"notification": true, "email": false}'::jsonb,
    reminders JSONB DEFAULT '["1d before"]'::jsonb,
    guests_allowed INTEGER DEFAULT 0,
    request_rsvp BOOLEAN DEFAULT false,
    include_gift_exchange BOOLEAN DEFAULT false,
    send_reminders BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.event_rsvps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL,
    guest_count INTEGER DEFAULT 0,
    responded_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    UNIQUE(event_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.secret_santa_exchanges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
    budget_min NUMERIC DEFAULT 0,
    budget_max NUMERIC DEFAULT 0,
    gift_deadline TIMESTAMPTZ,
    notes TEXT,
    anonymous_mode BOOLEAN DEFAULT TRUE,
    is_drawn BOOLEAN DEFAULT FALSE,
    is_locked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id)
);

CREATE TABLE IF NOT EXISTS public.secret_santa_pairings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exchange_id UUID REFERENCES public.secret_santa_exchanges(id) ON DELETE CASCADE,
    giver_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    receiver_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(exchange_id, giver_id)
);

CREATE TABLE IF NOT EXISTS public.secret_santa_wishlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exchange_id UUID REFERENCES public.secret_santa_exchanges(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(exchange_id, user_id)
);

-- -----------------------------------------------------------------------------
-- 6. Chat
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    name VARCHAR(255),
    is_group BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.chat_room_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    UNIQUE(room_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- -----------------------------------------------------------------------------
-- 7. Notifications & privacy
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL DEFAULT 'INFO',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    notification_metadata JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(20) DEFAULT 'sent',
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);

CREATE TABLE IF NOT EXISTS public.user_privacy_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
    is_profile_locked BOOLEAN DEFAULT false,
    search_visibility VARCHAR(50) DEFAULT 'everyone',
    hide_email BOOLEAN DEFAULT false,
    hide_phone BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- -----------------------------------------------------------------------------
-- 8. Commerce / KCC / billing
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kcc_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE SET NULL,
    wallet_id INTEGER NOT NULL,
    type VARCHAR(50) NOT NULL,
    amount DECIMAL(18, 8) NOT NULL,
    reason VARCHAR(255),
    status VARCHAR(20) DEFAULT 'confirmed',
    external_transaction_id VARCHAR(255),
    external_reference VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);
CREATE INDEX IF NOT EXISTS idx_kcc_ledger_family_space_id ON public.kcc_ledger(family_space_id);
CREATE INDEX IF NOT EXISTS idx_kcc_ledger_user_id ON public.kcc_ledger(user_id);

CREATE TABLE IF NOT EXISTS public.marketplace_listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(18, 2) NOT NULL DEFAULT 0,
    category VARCHAR(100),
    condition VARCHAR(50),
    location VARCHAR(255),
    image_urls JSONB DEFAULT '[]'::jsonb,
    is_negotiable BOOLEAN DEFAULT false,
    status VARCHAR(20) DEFAULT 'pending',
    moderation_status VARCHAR(20) DEFAULT 'pending',
    family_moderation_status VARCHAR(20) DEFAULT 'pending',
    moderation_note TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.marketplace_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    listing_id UUID REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    read_status BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);
CREATE INDEX IF NOT EXISTS idx_marketplace_messages_family ON public.marketplace_messages(family_space_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_messages_listing ON public.marketplace_messages(listing_id);

CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    order_number VARCHAR(50) UNIQUE,
    external_order_id INTEGER,
    items JSONB DEFAULT '[]'::jsonb,
    subtotal DECIMAL(18, 2) DEFAULT 0,
    shipping_fee DECIMAL(18, 2) DEFAULT 0,
    kcc_discount DECIMAL(18, 2) DEFAULT 0,
    total DECIMAL(18, 2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    shipping_address JSONB,
    tracking_number VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.mall_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE SET NULL,
    listing_id UUID REFERENCES public.marketplace_listings(id) ON DELETE SET NULL,
    amount DECIMAL(18, 2),
    status VARCHAR(20) DEFAULT 'completed',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.ad_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    advertiser_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    placement VARCHAR(50),
    start_date DATE,
    end_date DATE,
    total_cost_kcc DECIMAL(18, 2),
    daily_kcc_rate DECIMAL(18, 2),
    status VARCHAR(20) DEFAULT 'pending',
    payment_status VARCHAR(20) DEFAULT 'pending',
    target_audience JSONB DEFAULT '{}'::jsonb,
    media_url VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.fee_structures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    p2p_transfer_fee DECIMAL(5, 2) DEFAULT 0,
    mall_transaction_fee DECIMAL(5, 2) DEFAULT 0,
    liquidity_exit_fee DECIMAL(5, 2) DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.subscription_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    price DECIMAL(18, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    interval VARCHAR(20) DEFAULT 'month',
    features JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.platform_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE SET NULL,
    plan_type VARCHAR(50) DEFAULT 'free',
    status VARCHAR(20) DEFAULT 'active',
    amount_paid DECIMAL(18, 2) DEFAULT 0.00,
    currency VARCHAR(10) DEFAULT 'USD',
    next_billing_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    feature_gates JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);
CREATE INDEX IF NOT EXISTS idx_sub_user ON public.platform_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'active',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- -----------------------------------------------------------------------------
-- 9. Governance / safety / merge
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(100) NOT NULL,
    target_id VARCHAR(255),
    details JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);

CREATE TABLE IF NOT EXISTS public.abuse_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reported_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    target_type VARCHAR(50) NOT NULL,
    target_id VARCHAR(255) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    report_type VARCHAR(50),
    details TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    priority_level VARCHAR(20) DEFAULT 'medium',
    assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,
    sla_status VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON public.abuse_reports(status);

CREATE TABLE IF NOT EXISTS public.disputes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    person_id UUID REFERENCES public.persons(id) ON DELETE SET NULL,
    person_name VARCHAR(255),
    claimed_by_1 UUID REFERENCES public.users(id) ON DELETE SET NULL,
    claimed_by_2 UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reason_1 TEXT,
    reason_2 TEXT,
    status VARCHAR(20) DEFAULT 'open',
    resolved_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.governance_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID NOT NULL REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    proposed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'open',
    stage VARCHAR(50),
    votes_for INTEGER DEFAULT 0,
    votes_against INTEGER DEFAULT 0,
    threshold INTEGER DEFAULT 60,
    ends_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.sensitive_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID NOT NULL REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    requested_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    change_type VARCHAR(100) NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.family_governance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID NOT NULL UNIQUE REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    rule_1 TEXT DEFAULT '',
    rule_2 TEXT DEFAULT '',
    rule_3 TEXT DEFAULT '',
    financial_authority INTEGER DEFAULT 100,
    asset_authority INTEGER DEFAULT 100,
    permissions JSONB DEFAULT '{}'::jsonb,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.voting_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID NOT NULL UNIQUE REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    majority_rule VARCHAR(50) DEFAULT 'simple',
    threshold_percentage INTEGER DEFAULT 60,
    min_quorum INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.council_family_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    council_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    family_space_id UUID NOT NULL REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'active',
    assigned_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    UNIQUE(council_user_id, family_space_id)
);

CREATE TABLE IF NOT EXISTS public.family_merge_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_space_id UUID NOT NULL REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    source_space_name VARCHAR(255),
    target_space_id UUID NOT NULL REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    target_space_name VARCHAR(255),
    requested_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.family_merge_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    source_space_id UUID NOT NULL REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    target_space_id UUID NOT NULL REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    evidence_text TEXT,
    evidence_urls JSONB DEFAULT '[]'::jsonb,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.family_custom_labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID NOT NULL REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    role_key VARCHAR(50) NOT NULL,
    custom_label VARCHAR(100) NOT NULL,
    UNIQUE(family_space_id, role_key)
);

CREATE TABLE IF NOT EXISTS public.custom_label_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID NOT NULL REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    label_key VARCHAR(50) NOT NULL,
    label_value VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.family_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_space_id UUID NOT NULL REFERENCES public.family_spaces(id) ON DELETE CASCADE,
    requested_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    report_type VARCHAR(50) NOT NULL,
    config JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(20) DEFAULT 'completed',
    file_url TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- -----------------------------------------------------------------------------
-- 10. Admin / support / platform config
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    severity VARCHAR(20) DEFAULT 'low',
    status VARCHAR(20) DEFAULT 'open',
    reported_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    owner_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    next_update_time TIMESTAMPTZ,
    user_notice_published BOOLEAN DEFAULT false,
    internal_notes TEXT,
    affected_services JSONB DEFAULT '[]'::jsonb,
    sla_deadline TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON public.system_incidents(status);

CREATE TABLE IF NOT EXISTS public.incident_timeline (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID REFERENCES public.system_incidents(id) ON DELETE CASCADE,
    update_text TEXT NOT NULL,
    actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE SET NULL,
    subject VARCHAR(255) NOT NULL,
    description TEXT,
    priority VARCHAR(20) DEFAULT 'medium',
    status VARCHAR(20) DEFAULT 'open',
    category VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON public.support_tickets(status);

CREATE TABLE IF NOT EXISTS public.ticket_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    message TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    category VARCHAR(50) DEFAULT 'news',
    is_public BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);
CREATE INDEX IF NOT EXISTS idx_announcements_category ON public.announcements(category);

CREATE TABLE IF NOT EXISTS public.platform_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(100) UNIQUE NOT NULL,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.system_configs (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    category VARCHAR(50),
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.platform_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    prefix VARCHAR(20),
    key_hash TEXT NOT NULL,
    environment VARCHAR(20) NOT NULL DEFAULT 'production',
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.system_alert_channels (
    channel VARCHAR(50) PRIMARY KEY,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT true,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_url TEXT NOT NULL,
    event_type VARCHAR(100),
    payload JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(20) DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.system_backups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    initiated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
    reason TEXT,
    coverage TEXT DEFAULT 'Full Database Snapshot',
    retention_period TEXT DEFAULT '30 Days',
    file_path TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    error_message TEXT
);

-- -----------------------------------------------------------------------------
-- 11. DevOps jobs & telemetry
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.background_jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    job_type TEXT NOT NULL,
    schedule TEXT NOT NULL,
    schedule_cron TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    last_run TIMESTAMPTZ,
    next_run TIMESTAMPTZ,
    last_run_duration TEXT,
    failure_reason TEXT,
    retry_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.system_workers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_name TEXT NOT NULL,
    worker_group TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'offline',
    current_job_id TEXT,
    last_heartbeat TIMESTAMPTZ,
    environment TEXT DEFAULT 'production',
    version TEXT,
    hostname TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.system_jobs_registry (
    job_id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    schedule_cron VARCHAR(50),
    is_enabled BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,
    retry_policy JSONB DEFAULT '{"max_retries": 3, "backoff": "exponential"}',
    worker_group VARCHAR(100) DEFAULT 'Main Worker',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.system_jobs_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id VARCHAR(100) REFERENCES public.system_jobs_registry(job_id) ON DELETE CASCADE,
    payload JSONB DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'pending',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    next_retry_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.system_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    level TEXT NOT NULL,
    service TEXT NOT NULL,
    action TEXT NOT NULL,
    user_id UUID,
    family_space_id UUID,
    request_id TEXT,
    status_code INT,
    error_message TEXT,
    metadata JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_system_logs_timestamp ON public.system_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_level ON public.system_logs(level);
CREATE INDEX IF NOT EXISTS idx_system_logs_service ON public.system_logs(service);
CREATE INDEX IF NOT EXISTS idx_system_logs_action ON public.system_logs(action);
CREATE INDEX IF NOT EXISTS idx_system_logs_request_id ON public.system_logs(request_id);

CREATE TABLE IF NOT EXISTS public.system_telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    db_latency_ms INTEGER,
    storage_latency_ms INTEGER,
    api_status VARCHAR(50),
    recorded_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- -----------------------------------------------------------------------------
-- 12. Idempotent column patches (safe if tables already existed)
-- -----------------------------------------------------------------------------
ALTER TABLE public.family_spaces ADD COLUMN IF NOT EXISTS cover_image VARCHAR(500);

ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS evidence_url TEXT;

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS cover_photo_url VARCHAR(500);
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS include_gift_exchange BOOLEAN DEFAULT false;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS request_rsvp BOOLEAN DEFAULT false;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS send_reminders BOOLEAN DEFAULT false;

ALTER TABLE public.marketplace_listings ADD COLUMN IF NOT EXISTS family_moderation_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE public.marketplace_listings ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE public.marketplace_listings ADD COLUMN IF NOT EXISTS moderation_note TEXT;
ALTER TABLE public.marketplace_listings ADD COLUMN IF NOT EXISTS is_negotiable BOOLEAN DEFAULT false;
ALTER TABLE public.marketplace_listings ADD COLUMN IF NOT EXISTS image_urls JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.marketplace_listings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW());

ALTER TABLE public.marketplace_messages ADD COLUMN IF NOT EXISTS family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE CASCADE;
ALTER TABLE public.marketplace_messages ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE public.marketplace_messages ADD COLUMN IF NOT EXISTS read_status BOOLEAN DEFAULT false;

ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS place_of_birth VARCHAR(255);
ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS school_college VARCHAR(255);
ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS qualification VARCHAR(255);
ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS study_location VARCHAR(255);
ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS occupation VARCHAR(255);
ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS bio_notes TEXT;
ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS hide_sensitive_details BOOLEAN DEFAULT false;
ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS hide_birth_date BOOLEAN DEFAULT false;
ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS hide_location BOOLEAN DEFAULT false;
ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS hide_living_status BOOLEAN DEFAULT false;
ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS protect_as_minor BOOLEAN DEFAULT false;

ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS tagged_users JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS post_type VARCHAR(50) DEFAULT 'text';
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS media_urls JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS person_id UUID;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS website VARCHAR(500);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS linkedin VARCHAR(500);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS instagram VARCHAR(500);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS facebook VARCHAR(500);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS other_link VARCHAR(500);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS family_space_id UUID;
ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);
ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS is_alive BOOLEAN DEFAULT true;
ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS branch_id UUID;
ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS date_of_birth DATE;

ALTER TABLE public.family_memberships ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
ALTER TABLE public.family_memberships ADD COLUMN IF NOT EXISTS branch_id UUID;

ALTER TABLE public.media ADD COLUMN IF NOT EXISTS album_id UUID REFERENCES public.albums(id) ON DELETE SET NULL;
ALTER TABLE public.media ADD COLUMN IF NOT EXISTS size BIGINT;
ALTER TABLE public.media ADD COLUMN IF NOT EXISTS attach_to_type VARCHAR(50);
ALTER TABLE public.media ADD COLUMN IF NOT EXISTS attach_to_id UUID;

ALTER TABLE public.kcc_ledger ADD COLUMN IF NOT EXISTS family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE SET NULL;

ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS family_space_id UUID;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS type VARCHAR(50);
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS details JSONB;

ALTER TABLE public.system_incidents ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE public.system_incidents ADD COLUMN IF NOT EXISTS affected_services JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS family_space_id UUID;

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS notification_metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'sent';

-- -----------------------------------------------------------------------------
-- 13. Optional system defaults (not user data — DevOps job registry)
-- -----------------------------------------------------------------------------
INSERT INTO public.background_jobs (id, name, description, job_type, schedule, schedule_cron, status, is_enabled)
VALUES
    ('JOB-BACKUP', 'Daily DB Backup', 'Automated database backups and snapshots.', 'database', 'Daily at 12:00 AM', '0 0 * * *', 'idle', true),
    ('JOB-THUMBNAIL', 'Media Thumbnail Compression', 'Compress uploaded photos or videos.', 'media', 'Manual / On Demand', null, 'idle', true),
    ('JOB-STORAGE', 'Storage Usage Recalculation', 'Recalculates storage usage by Family Space.', 'storage', 'Daily at 03:00 AM', '0 3 * * *', 'idle', true),
    ('JOB-SUBSCRIPTION', 'Subscription Status Sync', 'Syncs billing and subscription status.', 'billing', 'Daily at 04:00 AM', '0 4 * * *', 'idle', true),
    ('JOB-ABUSE', 'Abuse Report Aggregation', 'Aggregates abuse reports and safety signals.', 'safety', 'Daily at 05:00 AM', '0 5 * * *', 'idle', true),
    ('JOB-PDF', 'PDF Report Generation', 'Manages descendant report generation queue.', 'reports', 'Daily at 02:00 AM', '0 2 * * *', 'idle', true),
    ('JOB-AUDIT', 'Audit Log Archival', 'Archives old audit logs to cold storage.', 'compliance', 'Monthly (1st)', '0 0 1 * *', 'idle', true),
    ('JOB-KCC-RECONCILIATION', 'KCC Coin Reconciliation', 'Reconcile KCC Coin ledger status.', 'wallet', 'Daily at 01:00 AM', '0 1 * * *', 'idle', true),
    ('JOB-WEBHOOK-RETRY', 'Webhook Retry Processor', 'Retry failed webhook deliveries.', 'webhook', 'Every 5 minutes', '*/5 * * * *', 'idle', true),
    ('JOB-NOTIFICATION', 'Notification Dispatch', 'Send in-app, email, and push notifications.', 'notifications', 'Every 15 minutes', '*/15 * * * *', 'idle', true),
    ('JOB-STORY-EXPIRY', 'Story Expiration Sweep', 'Expire stories after 24 hours.', 'content', 'Hourly', '0 * * * *', 'idle', true),
    ('JOB-MALL-SYNC', 'Mall Order Sync', 'Sync Mall orders and fulfillment status.', 'mall', 'Hourly', '0 * * * *', 'idle', true),
    ('JOB-XP-ACHIEVEMENT', 'XP Achievement Calc', 'Calculate XP and level updates.', 'gamification', 'Daily at 06:00 AM', '0 6 * * *', 'idle', true),
    ('JOB-PUBLIC-SEARCH-INDEX', 'Public Search Index Sync', 'Update opt-in public people search index.', 'search', 'Daily at 07:00 AM', '0 7 * * *', 'idle', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.system_jobs_registry (job_id, name, description, worker_group) VALUES
    ('JOB-BACKUP', 'Daily DB Backup', 'Automated database backups and snapshots.', 'Backup Worker'),
    ('JOB-THUMBNAIL', 'Media Thumbnail Compression', 'Compress uploaded photos or videos.', 'Media Worker'),
    ('JOB-STORAGE', 'Storage Usage Recalculation', 'Recalculates storage usage by Family Space.', 'Storage Worker'),
    ('JOB-SUBSCRIPTION', 'Subscription Status Sync', 'Syncs billing and subscription status.', 'Billing Worker'),
    ('JOB-ABUSE', 'Abuse Report Aggregation', 'Aggregates abuse reports and safety signals.', 'Safety Worker'),
    ('JOB-PDF', 'PDF Report Generation', 'Manages descendant report generation queue.', 'PDF Worker'),
    ('JOB-AUDIT', 'Audit Log Archival', 'Archives old audit logs to cold storage.', 'Audit Worker'),
    ('JOB-KCC-RECONCILIATION', 'KCC Coin Reconciliation', 'Reconcile KCC Coin ledger status.', 'Wallet Worker'),
    ('JOB-WEBHOOK-RETRY', 'Webhook Retry Processor', 'Retry failed webhook deliveries.', 'Webhook Worker'),
    ('JOB-DEADLETTER-RECOVERY', 'Dead-letter Queue Recovery', 'Review permanently failed jobs.', 'Main Worker'),
    ('JOB-STORY-EXPIRY', 'Story Expiration Sweep', 'Expire stories after 24 hours.', 'Main Worker'),
    ('JOB-NOTIFICATION', 'Notification Dispatch', 'Send in-app, email, and push notifications.', 'Notification Worker'),
    ('JOB-MALL-SYNC', 'Mall Order Sync', 'Sync Mall orders and fulfillment status.', 'Mall Worker'),
    ('JOB-XP-ACHIEVEMENT', 'XP Achievement Calc', 'Calculate XP and level updates.', 'Main Worker'),
    ('JOB-PUBLIC-SEARCH-INDEX', 'Public Search Index Sync', 'Update opt-in public people search index.', 'Main Worker')
ON CONFLICT (job_id) DO NOTHING;

INSERT INTO public.system_configs (key, value, category) VALUES
    ('GOVERNANCE_MODE', '"standard"', 'governance'),
    ('max_concurrent_jobs', '3', 'devops'),
    ('poll_interval_seconds', '60', 'devops'),
    ('load_alert_threshold', '80', 'devops')
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Done. Next: configure Auth providers, storage buckets, and backend .env keys.
-- -----------------------------------------------------------------------------
