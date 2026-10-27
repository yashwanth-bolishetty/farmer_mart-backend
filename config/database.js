import mongoose from 'mongoose';

export async function connectDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set. Copy .env.example to .env and configure a MongoDB connection.');
  await mongoose.connect(uri);
  return mongoose.connection;
}

export default mongoose;
