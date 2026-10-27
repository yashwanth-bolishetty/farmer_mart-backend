import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  password_hash: { type: String, required: true },
  phone: { type: String, default: null, maxlength: 15 },
  role: { type: String, required: true, enum: ['farmer', 'customer', 'admin'] },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false },
  versionKey: false,
});

export default mongoose.model('User', userSchema);
