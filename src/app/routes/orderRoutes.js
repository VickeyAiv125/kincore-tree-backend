import express from 'express';
import { getProducts, createOrder, getOrderHistory } from '../controllers/orderController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = express.Router();

router.get('/products', getProducts);
router.post('/checkout', authMiddleware, createOrder);
router.get('/history', authMiddleware, getOrderHistory);

export default router;
