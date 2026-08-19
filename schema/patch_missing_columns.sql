-- Kincore UAT — patch missing columns (run once on Supabase SQL Editor)
-- Fixes: events, claims, marketplace_messages, persons (tree)

-- Events: app + admin use both cover_image and cover_photo_url
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS cover_photo_url VARCHAR(500);
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS include_gift_exchange BOOLEAN DEFAULT false;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS request_rsvp BOOLEAN DEFAULT false;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS send_reminders BOOLEAN DEFAULT false;

-- Family spaces cover photo
ALTER TABLE public.family_spaces ADD COLUMN IF NOT EXISTS cover_image VARCHAR(500);

-- Claims: identity approval flow
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS evidence_url TEXT;

-- Marketplace listings + chat
ALTER TABLE public.marketplace_listings ADD COLUMN IF NOT EXISTS family_moderation_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE public.marketplace_listings ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE public.marketplace_listings ADD COLUMN IF NOT EXISTS moderation_note TEXT;
ALTER TABLE public.marketplace_listings ADD COLUMN IF NOT EXISTS is_negotiable BOOLEAN DEFAULT false;
ALTER TABLE public.marketplace_listings ADD COLUMN IF NOT EXISTS image_urls JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.marketplace_listings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW());

ALTER TABLE public.marketplace_messages ADD COLUMN IF NOT EXISTS family_space_id UUID REFERENCES public.family_spaces(id) ON DELETE CASCADE;
ALTER TABLE public.marketplace_messages ALTER COLUMN family_space_id DROP NOT NULL;
ALTER TABLE public.marketplace_messages ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE public.marketplace_messages ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE public.marketplace_messages ADD COLUMN IF NOT EXISTS read_status BOOLEAN DEFAULT false;

-- Persons: tree add-child / add-member / admin member editor
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

-- Backfill place_of_birth from legacy birth_place if present
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'persons' AND column_name = 'birth_place'
    ) THEN
        UPDATE public.persons SET place_of_birth = birth_place WHERE place_of_birth IS NULL AND birth_place IS NOT NULL;
    END IF;
END $$;

-- Backfill message from legacy content column if present
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'marketplace_messages' AND column_name = 'content'
    ) THEN
        UPDATE public.marketplace_messages SET message = content WHERE message IS NULL AND content IS NOT NULL;
        UPDATE public.marketplace_messages SET content = message WHERE content IS NULL AND message IS NOT NULL;
    END IF;
END $$;

-- Posts
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS tagged_users JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS post_type VARCHAR(50) DEFAULT 'text';
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS media_urls JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_marketplace_messages_family ON public.marketplace_messages(family_space_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_messages_listing ON public.marketplace_messages(listing_id);

-- Refresh PostgREST schema cache (required or APIs keep saying column not found)
NOTIFY pgrst, 'reload schema';
