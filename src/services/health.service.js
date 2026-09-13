import { getDatabaseStatus } from '../config/database.js';

export function getHealthStatus() {
  const database = getDatabaseStatus();

  return {
    status: database.connected ? 'ready' : 'degraded',
    ready: database.connected,
    api: {
      status: 'running',
    },
    database,
  };
}
