-- Post settings: who can see / who can comment (safe to re-run)
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS comment_permission VARCHAR(40) DEFAULT 'friends';

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS visibility_except_ids JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS visibility_allowed_ids JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS comment_allowed_ids JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.posts.visibility IS
  'public | friends | friends_except | specific_friends | family | branch';
COMMENT ON COLUMN public.posts.comment_permission IS
  'followers | friends | chosen_friends';
