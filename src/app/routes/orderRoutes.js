import express from 'express';
import { getProducts, getProductById, createOrder, getOrderHistory, getShippingRates } from '../controllers/orderController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = express.Router();

router.get('/products', getProducts);
router.get('/products/:id', getProductById);
router.post('/checkout/shipping-rates', authMiddleware, getShippingRates);
router.post('/checkout', authMiddleware, createOrder);
router.get('/history', authMiddleware, getOrderHistory);

export default router;
