import { getBackgroundJobs, triggerJob, pauseJob } from '../src/admin/controllers/devopsController.js';

const mockReq = (params = {}, body = {}) => ({
    params,
    body,
    user: { id: '00000000-0000-0000-0000-000000000000' }
});

const mockRes = () => {
    const res = {};
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => { res.data = data; };
    return res;
};

async function runTests() {
    console.log("=== Testing getBackgroundJobs ===");
    let req = mockReq();
    let res = mockRes();
    
    await getBackgroundJobs(req, res);
    console.log("Status:", res.statusCode || 200);
    console.log("Jobs seeded:", res.data?.jobs?.length);
    console.log("Found JOB-BACKUP:", !!res.data?.jobs?.find(j => j.id === 'JOB-BACKUP'));
    
    const requiredJobs = [
        'JOB-BACKUP', 'JOB-THUMBNAIL', 'JOB-STORAGE', 'JOB-SUBSCRIPTION', 
        'JOB-ABUSE', 'JOB-PDF', 'JOB-AUDIT', 'JOB-KCC-RECONCILIATION', 
        'JOB-WEBHOOK-RETRY', 'JOB-DEADLETTER-RECOVERY', 'JOB-STORY-EXPIRY', 
        'JOB-NOTIFICATION', 'JOB-MALL-SYNC', 'JOB-XP-ACHIEVEMENT', 'JOB-PUBLIC-SEARCH-INDEX'
    ];
    
    for (const jobId of requiredJobs) {
        console.log(`\n=== Testing triggerJob on ${jobId} ===`);
        req = mockReq({ id: jobId });
        res = mockRes();
        await triggerJob(req, res);
        console.log(`Trigger Status [${jobId}]:`, res.statusCode || 200);
        if (res.statusCode !== 200) console.error(res.data);
    }
    
    process.exit(0);
}

runTests();
