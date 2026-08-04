import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './src/shared/routes/authRoutes.js';
import { virtualLoadBalancer, dynamicRateLimiter } from './src/middleware/loadBalancerMiddleware.js';
import userRoutes from './src/shared/routes/userRoutes.js';
import treeRoutes from './src/shared/routes/treeRoutes.js';
import familyRoutes from './src/admin/routes/familyRoutes.js';
import claimRoutes from './src/shared/routes/claimRoutes.js';
import eventRoutes from './src/app/routes/eventRoutes.js';
import historyRoutes from './src/app/routes/historyRoutes.js';
import albumRoutes from './src/app/routes/albumRoutes.js';
import ledgerRoutes from './src/shared/routes/ledgerRoutes.js';
import orderRoutes from './src/app/routes/orderRoutes.js';
import postRoutes from './src/app/routes/postRoutes.js';
import storyRoutes from './src/app/routes/storyRoutes.js';
import requestRoutes from './src/app/routes/requestRoutes.js';
import memoryRoutes from './src/app/routes/memoryRoutes.js';
import mediaRoutes from './src/shared/routes/mediaRoutes.js';
import notificationRoutes from './src/shared/routes/notificationRoutes.js';
import publicRoutes from './src/shared/routes/publicRoutes.js';
import adminRoutes from './src/admin/routes/adminRoutes.js';
import { startTelemetryCron } from './src/admin/controllers/devopsController.js';
import { initWorkerHeartbeat } from './src/services/workerHeartbeatService.js';
import bioRoutes from './src/app/routes/bioRoutes.js';
import marketplaceRoutes from './src/app/routes/marketplaceRoutes.js';
import settingsRoutes from './src/shared/routes/settingsRoutes.js';
import chatRoutes from './src/app/routes/chatRoutes.js';
import giftRoutes from './src/app/routes/giftRoutes.js';
import branchRoutes from './src/shared/routes/branchRoutes.js';
import branchAdminRoutes from './src/admin/routes/branchAdminRoutes.js';
import familyAdminRoutes from './src/admin/routes/familyAdminRoutes.js';
import governanceRoutes from './src/shared/routes/governanceRoutes.js';
import reportRoutes from './src/shared/routes/reportRoutes.js';
import campaignRoutes from './src/shared/routes/campaignRoutes.js';
import mergeRoutes from './src/shared/routes/mergeRoutes.js';
import spaceRoutes from './src/app/routes/spaceRoutes.js';
import appPrivacyRoutes from './src/app/routes/appPrivacyRoutes.js';
import profileRoutes from './src/app/routes/profileRoutes.js';
import memberRoutes from './src/app/routes/memberRoutes.js';
import calculatorRoutes from './src/app/routes/calculatorRoutes.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.use(virtualLoadBalancer);
app.use(dynamicRateLimiter);

// Auth Foundation
app.use('/api/auth', authRoutes);

// Main Modular Routes
app.use('/api/users', userRoutes);
app.use('/api/families', familyRoutes);
app.use('/api/clantree', treeRoutes);
app.use('/api/claims', claimRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/app/history', historyRoutes);
app.use('/api/albums', albumRoutes);
app.use('/api/ledger', ledgerRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/app/requests', requestRoutes);
app.use('/api/memories', memoryRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/merge', mergeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/families', bioRoutes); // Merge bio routes into family context
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/tree', treeRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/events/:id/gift-exchange', giftRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/admin/branch', branchAdminRoutes);
app.use('/api/family-admin', familyAdminRoutes);
app.use('/api/governance', governanceRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/app/spaces', spaceRoutes);
app.use('/api/app/privacy', appPrivacyRoutes);
app.use('/api/app/profile', profileRoutes);
app.use('/api/app/members', memberRoutes);
app.use('/api/app/calculator', calculatorRoutes);

app.get('/health', (req, res) => {
    res.json({ status: 'v3.1.foundation.active', timestamp: new Date().toISOString() });
});

// Global API Error Logger
import { logSystemEvent } from './src/utils/logger.js';
app.use((err, req, res, next) => {
    const status = err.status || 500;
    logSystemEvent('ERROR', 'API_GLOBAL', `API Error: ${req.method} ${req.originalUrl}`, {
        user_id: req.user?.id || null,
        request_id: req.headers['x-request-id'] || null,
        status_code: status,
        error_message: err.message || 'Internal Server Error',
        metadata: {
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
            body: req.body,
            query: req.query
        }
    });

    res.status(status).json({
        error: 'Internal Server Error',
        message: err.message
    });
});

app.listen(PORT, async () => {
    console.log(`Kincore Tree v3.0 API running on port ${PORT}`);
    startTelemetryCron(); // Start tracking telemetry in the background
    await initWorkerHeartbeat(); // Start background worker heartbeat
});

export default app;
