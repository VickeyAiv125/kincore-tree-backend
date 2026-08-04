import rateLimit from 'express-rate-limit';
import { getDynamicConfig } from './dynamicConfigCache.js';

let activeRequests = 0;

// Dynamic Rate Limiter
export const dynamicRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: () => {
        const config = getDynamicConfig();
        return Number(config.global_rate_limit) || 1000;
    },
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Virtual Load Balancer Middleware
export const virtualLoadBalancer = (req, res, next) => {
    const config = getDynamicConfig();

    // 1. Maintenance Mode
    // Check if maintenance mode is enabled and user is not hitting admin/auth routes
    // For safety, allow devops routes through so we can disable maintenance mode!
    const isMaintenanceMode = String(config.maintenance_mode) === '1' || config.maintenance_mode === true || config.maintenance_mode === 'true';
    if (isMaintenanceMode) {
        if (!req.path.startsWith('/api/admin/devops') && !req.path.startsWith('/api/auth')) {
            return res.status(503).json({
                error: 'Service Unavailable',
                message: 'The platform is currently undergoing maintenance. Please try again later.'
            });
        }
    }

    // 2. Max Concurrent Connections
    const maxConns = Number(config.max_connections) || 5000;
    if (activeRequests >= maxConns) {
        return res.status(429).json({
            error: 'Too Many Requests',
            message: 'Server is at maximum capacity. Please try again.'
        });
    }

    // 3. API Timeout
    const apiTimeout = Number(config.api_timeout) || 30000;
    req.setTimeout(apiTimeout, () => {
        if (!res.headersSent) {
            res.status(408).json({ error: 'Request Timeout' });
        }
    });

    // Track active requests
    activeRequests++;
    
    // Decrement when request finishes
    res.on('finish', () => {
        activeRequests--;
    });
    
    res.on('close', () => {
        // If close fires before finish, we still need to decrement
        if (!res.writableEnded) {
            activeRequests--;
        }
    });

    next();
};
