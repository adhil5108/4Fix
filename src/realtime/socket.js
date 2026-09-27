import { Server } from 'socket.io';
import { resolveRequestOwner, resolveUserFromJwt } from '../middleware/authenticate.js';
import { USER_ROLES } from '../models/User.js';
import { findBookingForUser } from '../services/booking.service.js';

let io = null;

function roomName(bookingId) {
  return `booking:${bookingId}`;
}

// A participant's personal "inbox" room, joined automatically on connect, so unread
// updates reach them wherever they are in the app — not only inside the conversation.
// Providers are addressed by account, the anonymous customer by their request. Admin
// has no inbox: they read chats but are never a recipient.
export function providerInbox(providerId) {
  return `inbox:provider:${providerId}`;
}

export function requestInbox(requestId) {
  return `inbox:request:${requestId}`;
}

function inboxFor(user) {
  if (user.role === USER_ROLES.PROVIDER) {
    return providerInbox(user.id);
  }

  if (user.role === USER_ROLES.CUSTOMER && user.requestId) {
    return requestInbox(user.requestId);
  }

  return null;
}

// Same credentials the REST API uses, read from the handshake instead of headers — a
// provider/admin JWT (`auth.token`) or an anonymous customer's request access token
// (`auth.requestToken`). No parallel auth mechanism.
async function authenticateSocket(socket, next) {
  try {
    const { token, requestToken } = socket.handshake.auth || {};

    if (token) {
      socket.user = await resolveUserFromJwt(token);
    } else if (requestToken) {
      socket.user = await resolveRequestOwner(requestToken);
    } else {
      next(new Error('Authentication required'));
      return;
    }

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
    const inbox = inboxFor(socket.user);

    if (inbox) {
      socket.join(inbox);
    }

    registerConversationEvents(socket);
  });

  return io;
}

// No-op when sockets haven't been initialized (e.g. tests that don't wrap app.js
// in an HTTP server) so chat.service.js can call this unconditionally.
export function emitToBooking(bookingId, event, payload) {
  io?.to(roomName(bookingId)).emit(event, payload);
}

export function emitToInbox(inbox, event, payload) {
  io?.to(inbox).emit(event, payload);
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
