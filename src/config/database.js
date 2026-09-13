import mongoose from 'mongoose';
import { env } from './env.js';

const readyStateLabels = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

export async function connectDatabase() {
  if (!env.mongodbUri) {
    throw new Error('MONGODB_URI is required to start the API');
  }

  mongoose.connection.on('error', (error) => {
    console.error('MongoDB connection error:', error.message);
  });

  await mongoose.connect(env.mongodbUri);
  console.log('MongoDB connected');
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log('MongoDB disconnected');
  }
}

export function getDatabaseStatus() {
  const readyState = mongoose.connection.readyState;

  return {
    status: readyStateLabels[readyState] || 'unknown',
    connected: readyState === 1,
  };
}
