import fetch from 'node-fetch';

async function testScheduleJob() {
    const token = process.env.TOKEN || 'DEV_TOKEN'; // Replace with a valid Super Admin token if testing remotely
    
    // Testing JOB-PDF schedule update
    const payload = {
        cron: "0 12 * * *", // Every day at noon
        priority: 10,
        worker_group: "PDF Worker",
        timeout_limit: 600000, // 10 minutes
        reason: "Daily scheduled descendant reports"
    };

    console.log('Sending schedule payload:', payload);

    try {
        const response = await fetch('http://localhost:5000/api/admin/devops/jobs/JOB-PDF/schedule', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log('Status Code:', response.status);
        console.log('Response Body:', data);

        if (response.status === 200) {
            console.log('✅ Schedule API test passed!');
        } else {
            console.error('❌ Schedule API test failed:', data);
        }
    } catch (error) {
        console.error('❌ Connection failed. Ensure backend is running.', error);
    }
}

testScheduleJob();
