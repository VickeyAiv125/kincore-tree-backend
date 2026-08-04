-- Add Active Comms fields to system_incidents
ALTER TABLE public.system_incidents
ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS next_update_time TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS user_notice_published BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS internal_notes TEXT;

-- Create an internal incident notes table for the comms log if needed, or we can just use the audit_logs
-- Let's use audit_logs with action = 'INCIDENT_NOTE'
