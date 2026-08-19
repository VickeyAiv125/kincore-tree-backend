-- Mall / marketplace columns for UAT. Run in Supabase SQL Editor, then retry Mall APIs.

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

NOTIFY pgrst, 'reload schema';
