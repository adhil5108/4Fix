import app from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { env, validateEnv } from './config/env.js';

let server;

async function startServer() {
  try {
    validateEnv();
    await connectDatabase();

    server = app.listen(env.port, () => {
      console.log(`4Fix API is running on port ${env.port}`);
    });
  } catch (error) {
    console.error('Failed to start 4Fix API:', error.message);
    process.exit(1);
  }
}

async function shutdown(signal) {
  console.log(`${signal} received. Shutting down 4Fix API...`);

  if (server) {
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });

    return;
  }

  await disconnectDatabase();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startServer();
