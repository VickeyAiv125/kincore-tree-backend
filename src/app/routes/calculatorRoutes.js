import express from 'express';
import { addStep, getResults, editPath } from '../controllers/calculatorController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = express.Router();

// 1. Calculate Relationship (Add Step)
router.post('/calculate', authMiddleware, addStep);

// 2. Kinship Results (Supports GET for easy view loading)
router.post('/results', authMiddleware, getResults);
router.get('/results', authMiddleware, getResults);

// 3. Edit Path
router.post('/edit', authMiddleware, editPath);

export default router;
