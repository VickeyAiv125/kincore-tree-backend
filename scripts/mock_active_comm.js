import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    // Get an admin user
    const { data: users } = await supabase.from('admin_users').select('user_id').limit(1);
    if (!users || users.length === 0) {
        console.log("No admin users found.");
        return;
    }
    const actor_id = users[0].user_id;

    const { error } = await supabase.from('audit_logs').insert([
        {
            actor_id,
            action: 'INCIDENT_NOTE',
            target_type: 'system_incidents',
            details: { message: "DevOps is investigating elevated CPU load affecting login performance. Identifying root cause." },
            created_at: new Date(Date.now() - 1000 * 60 * 5).toISOString() // 5 mins ago
        },
        {
            actor_id,
            action: 'OWNER_ASSIGNED',
            target_type: 'system_incidents',
            details: { message: "Assigned Primary: DevOps, Backup: Platform Admin" },
            created_at: new Date(Date.now() - 1000 * 60 * 15).toISOString() // 15 mins ago
        }
    ]);

    if (error) {
        console.error("Error inserting mock comms:", error);
    } else {
        console.log("Mock active comms inserted successfully!");
    }
}

run();
