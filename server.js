import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose, { connectDatabase } from './config/database.js';
import asyncHandler from './middleware/asyncHandler.js';
import authRoutes from './routes/authRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import productRoutes from './routes/productRoutes.js';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be set to a random value of at least 32 characters. Copy .env.example to .env and configure it.');
  process.exit(1);
}

const app = express();
const backendDirectory = path.dirname(fileURLToPath(import.meta.url));
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '100kb' }));
app.use('/uploads', express.static(path.join(backendDirectory, 'uploads'), {
  fallthrough: false,
  index: false,
  maxAge: '1d',
}));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }));

app.get('/api/health', asyncHandler(async (_request, response) => {
  await mongoose.connection.db.admin().ping();
  return response.json({ status: 'ok', database: 'connected' });
}));
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use((_request, response) => response.status(404).json({ message: 'We could not find that page.' }));
app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) return response.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'Image must be 5 MB or smaller.' : 'Upload one image at a time.' });
  if (error.statusCode === 400) return response.status(400).json({ message: error.message });
  if (error.code === 11000) return response.status(409).json({ message: 'An account with this email already exists.' });
  if (error.type === 'entity.parse.failed') return response.status(400).json({ message: 'Please send valid JSON.' });
  console.error(error);
  return response.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : 'Something went wrong on our end. Please try again.',
  });
});

const port = Number(process.env.PORT || 4000);
try {
  await connectDatabase();
  app.listen(port, () => console.log(`Farmstead API listening on http://localhost:${port}`));
} catch (error) {
  console.error('Could not connect to MongoDB. Check MONGODB_URI and make sure the server is running and reachable.', error.message);
  process.exit(1);
}
