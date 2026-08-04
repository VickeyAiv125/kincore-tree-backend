import express from 'express';
import {
    getPrivacySettings,
    updatePrivacySettings,
    getNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    deleteNotification,
    getSavedPosts,
    savePost,
    unsavePost,
} from '../controllers/settingsController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = express.Router();

// --- Privacy ---
router.get('/privacy', authMiddleware, getPrivacySettings);
router.patch('/privacy', authMiddleware, updatePrivacySettings);

// --- Notifications ---
router.get('/notifications', authMiddleware, getNotifications);
router.patch('/notifications/mark-all-read', authMiddleware, markAllNotificationsRead);
router.patch('/notifications/:id/read', authMiddleware, markNotificationRead);
router.delete('/notifications/:id', authMiddleware, deleteNotification);

// --- Saved Posts (Bookmarks) ---
router.get('/saved-posts', authMiddleware, getSavedPosts);
router.post('/saved-posts', authMiddleware, savePost);
router.delete('/saved-posts/:post_id', authMiddleware, unsavePost);

export default router;
