import cors from 'cors';
import express from 'express';
import adminRoutes from './routes/admin.routes.js';
import authRoutes from './routes/auth.routes.js';
import bookingRoutes from './routes/booking.routes.js';
import healthRoutes from './routes/health.routes.js';
import providerRoutes from './routes/provider.routes.js';
import providersRoutes from './routes/providers.routes.js';
import quoteRoutes from './routes/quote.routes.js';
import requestRoutes from './routes/request.routes.js';
import serviceRoutes from './routes/service.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import userRoutes from './routes/user.routes.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/quotes', quoteRoutes);
app.use('/api/provider', providerRoutes);
app.use('/api/providers', providersRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/users', userRoutes);

app.use(errorHandler);

export default app;
