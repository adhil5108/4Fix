import { Server } from 'socket.io';
import User from '../models/User.js';
import { findBookingForUser } from '../services/booking.service.js';
import { verifyAccessToken } from '../services/token.service.js';

let io = null;

function roomName(bookingId) {
  return `booking:${bookingId}`;
}

// Same JWT the REST API uses, just read from the handshake instead of a header —
// no parallel auth mechanism.
async function authenticateSocket(socket, next) {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      next(new Error('Authentication required'));
      return;
    }

    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);

    if (!user || !user.isActive) {
      next(new Error('Invalid authentication token'));
      return;
    }

    socket.user = user;
    next();
  } catch (_error) {
    next(new Error('Invalid authentication token'));
  }
}

function registerConversationEvents(socket) {
  // Reuses the exact access rule the REST chat endpoints use (participant, or ADMIN
  // reading platform-wide) so a socket can never reach a conversation the REST API
  // would refuse it.
  socket.on('conversation:join', async ({ bookingId } = {}, callback) => {
    try {
      const booking = await findBookingForUser(bookingId, socket.user);
      socket.join(roomName(booking.id));
      callback?.({ ok: true });
    } catch (error) {
      callback?.({ ok: false, error: error.message || 'Access denied' });
    }
  });

  socket.on('conversation:leave', ({ bookingId } = {}) => {
    if (bookingId) {
      socket.leave(roomName(bookingId));
    }
  });
}

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  io.use(authenticateSocket);
  io.on('connection', (socket) => {
    registerConversationEvents(socket);
  });

  return io;
}

// No-op when sockets haven't been initialized (e.g. tests that don't wrap app.js
// in an HTTP server) so chat.service.js can call this unconditionally.
export function emitToBooking(bookingId, event, payload) {
  io?.to(roomName(bookingId)).emit(event, payload);
}

export function closeSocket() {
  return new Promise((resolve) => {
    if (!io) {
      resolve();
      return;
    }

    io.close(() => resolve());
    io = null;
  });
}
