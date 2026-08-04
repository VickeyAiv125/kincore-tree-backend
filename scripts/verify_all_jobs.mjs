import fetch from 'node-fetch';

const TOKEN = process.env.TOKEN || 'DEV_TOKEN'; // Set your actual auth token here if needed
const BASE_URL = 'http://localhost:5000/api/admin/devops/jobs';

const jobsToTest = [
  'JOB-BACKUP',
  'JOB-THUMBNAIL',
  'JOB-STORAGE',
  'JOB-SUBSCRIPTION',
  'JOB-ABUSE',
  'JOB-PDF',
  'JOB-AUDIT',
  'JOB-STORY-EXPIRY',
  'JOB-NOTIFICATION',
  'JOB-WEBHOOK-RETRY',
  'JOB-DEADLETTER-RECOVERY'
];

async function triggerJob(jobId) {
    try {
        console.log(`[▶] Triggering ${jobId}...`);
        const res = await fetch(`${BASE_URL}/${jobId}/trigger`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        if (res.ok) {
            console.log(`  [✓] Successfully queued ${jobId}`);
            return true;
        } else {
            console.error(`  [✗] Failed to queue ${jobId}:`, data);
            return false;
        }
    } catch (e) {
        console.error(`  [✗] Error requesting ${jobId}:`, e.message);
        return false;
    }
}

async function verifyAllJobs() {
    console.log('--- STARTING DYNAMIC JOB VERIFICATION LOOP ---');
    console.log(`Checking ${jobsToTest.length} Jobs...\n`);

    let successCount = 0;
    for (const job of jobsToTest) {
        const success = await triggerJob(job);
        if (success) successCount++;
        // Adding a 2-second delay between triggers to let the jobsEngine poll and execute locally
        await new Promise(res => setTimeout(res, 2000));
    }

    console.log(`\n--- DYNAMIC JOB VERIFICATION COMPLETE ---`);
    console.log(`Successfully triggered ${successCount} / ${jobsToTest.length} jobs.`);
    if (successCount === jobsToTest.length) {
        console.log('✅ ALL JOBS ARE FULLY DYNAMIC AND RESPOND TO API TRIGGERS.');
    } else {
        console.log('❌ SOME JOBS FAILED TO TRIGGER. Check your backend logs.');
    }
}

verifyAllJobs();
