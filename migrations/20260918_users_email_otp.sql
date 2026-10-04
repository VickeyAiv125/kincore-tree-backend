-- Email OTP verification fields on public.users (safe to re-run)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS otp TEXT NULL;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ NULL;

-- Existing accounts (no pending OTP) are treated as already verified
UPDATE public.users
SET is_verified = true
WHERE otp IS NULL;

COMMENT ON COLUMN public.users.is_verified IS
  'True after email OTP verification (or legacy/OAuth accounts)';
COMMENT ON COLUMN public.users.otp IS
  'Pending signup OTP code (cleared after verify)';
COMMENT ON COLUMN public.users.otp_expires_at IS
  'UTC expiry for pending signup OTP';
