import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
const publicUser = (user) => ({
  user_id: user._id.toString(),
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
});
const createToken = (user) => jwt.sign(
  { user_id: user.user_id, role: user.role, name: user.name },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
);

router.post('/register', asyncHandler(async (request, response) => {
  const { name, email, password, phone = null, role } = request.body;
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
    return response.status(400).json({ message: 'Please enter a name between 2 and 100 characters.' });
  }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return response.status(400).json({ message: 'Please enter a valid email address.' });
  }
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    return response.status(400).json({ message: 'Password must be between 8 and 72 characters.' });
  }
  if (!['farmer', 'customer'].includes(role)) {
    return response.status(400).json({ message: 'Choose whether you are joining as a farmer or customer.' });
  }
  if (phone !== null && (typeof phone !== 'string' || phone.length > 15)) {
    return response.status(400).json({ message: 'Phone number must be 15 characters or fewer.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({
    name: name.trim(),
    email: normalizedEmail,
    password_hash: passwordHash,
    phone: phone?.trim() || null,
    role,
  });
  const result = publicUser(user);
  return response.status(201).json({ user: result, token: createToken(result) });
}));

router.post('/login', asyncHandler(async (request, response) => {
  const { email, password } = request.body;
  if (typeof email !== 'string' || typeof password !== 'string') {
    return response.status(400).json({ message: 'Enter your email and password.' });
  }
  const user = await User.findOne({ email: email.trim().toLowerCase() });
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return response.status(401).json({ message: 'That email and password do not match.' });
  }
  const result = publicUser(user);
  return response.json({ user: result, token: createToken(result) });
}));

router.get('/me', authenticate, asyncHandler(async (request, response) => {
  const user = await User.findById(request.user.user_id);
  if (!user) return response.status(404).json({ message: 'This account could not be found.' });
  return response.json({ user: publicUser(user) });
}));

export default router;
