-- Gift Exchange: event settings + participants (safe to re-run)

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS include_gift_exchange BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS budget TEXT NULL;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS draw_date TIMESTAMPTZ NULL;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS gift_deadline TIMESTAMPTZ NULL;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS exclude_same_household BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS gift_draw_completed BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.gift_exchange_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    recipient_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
    preferences TEXT NULL,
    gift_status VARCHAR(40) NOT NULL DEFAULT 'Not Started',
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    UNIQUE (event_id, user_id),
    CONSTRAINT gift_exchange_participants_status_check
      CHECK (gift_status IN ('Not Started', 'Purchased', 'Shipped', 'Delivered'))
);

CREATE INDEX IF NOT EXISTS idx_gift_exchange_participants_event
  ON public.gift_exchange_participants (event_id);

CREATE INDEX IF NOT EXISTS idx_gift_exchange_participants_user
  ON public.gift_exchange_participants (user_id);

CREATE INDEX IF NOT EXISTS idx_gift_exchange_participants_recipient
  ON public.gift_exchange_participants (recipient_id);

COMMENT ON COLUMN public.events.budget IS
  'Gift exchange budget label, e.g. "$20 - $50"';
COMMENT ON COLUMN public.events.gift_draw_completed IS
  'True after gift-exchange derangement draw is saved';
COMMENT ON TABLE public.gift_exchange_participants IS
  'Secret gift exchange: giver (user_id) assigned to recipient_id after draw';
