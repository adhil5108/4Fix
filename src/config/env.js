import dotenv from 'dotenv';

dotenv.config({ quiet: true });

function readPositiveInteger(name) {
  const value = process.env[name] ? Number(process.env[name]) : undefined;

  return value;
}

export const env = {
  port: process.env.PORT ? Number(process.env.PORT) : undefined,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongodbUri: process.env.MONGODB_URI,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN,
  passwordSaltRounds: readPositiveInteger('PASSWORD_SALT_ROUNDS'),
};

export function validateEnv() {
  const missingVariables = [
    'PORT',
    'MONGODB_URI',
    'JWT_ACCESS_SECRET',
    'JWT_ACCESS_EXPIRES_IN',
    'PASSWORD_SALT_ROUNDS',
  ].filter((name) => !process.env[name]);

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVariables.join(', ')}`,
    );
  }

  if (!Number.isInteger(env.port) || env.port <= 0) {
    throw new Error('PORT must be a positive integer');
  }

  const positiveIntegerSettings = {
    PASSWORD_SALT_ROUNDS: env.passwordSaltRounds,
  };

  for (const [name, value] of Object.entries(positiveIntegerSettings)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
}
