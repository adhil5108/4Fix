import dotenv from 'dotenv';

dotenv.config({ quiet: true });

export const env = {
  port: process.env.PORT ? Number(process.env.PORT) : undefined,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongodbUri: process.env.MONGODB_URI,
};

export function validateEnv() {
  const missingVariables = ['PORT', 'MONGODB_URI'].filter(
    (name) => !process.env[name],
  );

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVariables.join(', ')}`,
    );
  }

  if (!Number.isInteger(env.port) || env.port <= 0) {
    throw new Error('PORT must be a positive integer');
  }
}
