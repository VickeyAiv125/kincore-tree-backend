import express from 'express';
import {
    signup,
    login,
    oauthLogin,
    logout,
    refreshToken,
    requestOtp,
    verifyOtp,
    changePassword,
    completeInvite,
    webForgotPassword,
    appForgotPassword,
    appResetPassword,
    googleAuthStart,
    googleAuthCallback,
    googleAuthStatus,
    facebookAuthStart,
    facebookAuthCallback,
    facebookAuthStatus,
    kccLogin,
    kccAuthStatus
} from '../controllers/authController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = express.Router();

router.post('/signup', signup);
router.post('/login', login);
router.post('/oauth-login', oauthLogin);
router.post('/logout', logout);
router.post('/refresh-token', refreshToken);

// Google SSO (signup + login)
router.get('/google', googleAuthStart);
router.get('/google/callback', googleAuthCallback);
router.get('/google/status', googleAuthStatus);

// Facebook / Meta SSO (signup + login)
router.get('/facebook', facebookAuthStart);
router.get('/facebook/callback', facebookAuthCallback);
router.get('/facebook/status', facebookAuthStatus);

// KCC ID (ecosystem passport) — credential login with client_id=kincore
router.post('/kcc/login', kccLogin);
router.get('/kcc/status', kccAuthStatus);

router.post('/request-otp', requestOtp);
router.post('/verify-otp', verifyOtp);
router.post('/change-password', authMiddleware, changePassword);
router.post('/complete-invite', authMiddleware, completeInvite);

router.post('/web/forgot-password', webForgotPassword);
router.post('/app/forgot-password', appForgotPassword);
router.post('/app/reset-password', appResetPassword);

export default router;
