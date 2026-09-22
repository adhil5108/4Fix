import http from 'node:http';
import app from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { env, validateEnv } from './config/env.js';
import { closeSocket, initSocket } from './realtime/socket.js';

let server;

async function startServer() {
  try {
    validateEnv();
    await connectDatabase();

    // Socket.IO needs the raw HTTP server (not just the Express app) to upgrade
    // connections; app.listen(...) is replaced with that server's listen(...).
    server = http.createServer(app);
    initSocket(server);

    server.listen(env.port, () => {
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
    await closeSocket();
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
