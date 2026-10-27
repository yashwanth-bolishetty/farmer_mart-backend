import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import asyncHandler from './asyncHandler.js';

export const authenticate = asyncHandler(async (request, response, next) => {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    return response.status(401).json({ message: 'Please sign in to continue.' });
  }

  try {
    const payload = jwt.verify(authorization.slice(7), process.env.JWT_SECRET);
    if (typeof payload.user_id !== 'string' || !/^[a-f\d]{24}$/i.test(payload.user_id)
        || !mongoose.isValidObjectId(payload.user_id)) {
      return response.status(401).json({ message: 'Your session has expired. Please sign in again.' });
    }
    request.user = { user_id: payload.user_id, role: payload.role, name: payload.name };
  } catch {
    return response.status(401).json({ message: 'Your session has expired. Please sign in again.' });
  }
  return next();
});

export function requireRole(...roles) {
  return (request, response, next) => {
    if (!roles.includes(request.user.role)) {
      return response.status(403).json({ message: 'You do not have permission to perform this action.' });
    }
    return next();
  };
}
