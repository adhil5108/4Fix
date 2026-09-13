import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import healthRoutes from './routes/health.routes.js';

const app = express();

app.use(
  cors({
    origin: env.corsOrigin,
  }),
);
app.use(express.json());

app.use('/api/health', healthRoutes);

export default app;

