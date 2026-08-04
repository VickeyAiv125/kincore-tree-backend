import express from 'express';
import { searchPublicPersons, getPublicPerson } from '../controllers/publicController.js';

const router = express.Router();

router.get('/persons/search', searchPublicPersons);
router.get('/persons/:id', getPublicPerson);

export default router;
