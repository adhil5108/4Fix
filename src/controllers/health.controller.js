import { getHealthStatus } from '../services/health.service.js';

export function getHealth(_req, res) {
  const health = getHealthStatus();

  res.status(health.ready ? 200 : 503).json(health);
}
