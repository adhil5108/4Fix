import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import { emitToBooking } from '../realtime/socket.js';
import { ApiError } from '../utils/ApiError.js';
import { requiredText, stringList } from '../utils/text.js';
import { findBookingForUser } from './booking.service.js';
import { toConversation, toMessage } from './chatPresenter.service.js';

const MAX_MESSAGES = 200;
const CONVERSATION_POPULATE = [{ path: 'customerId' }, { path: 'providerId' }];

function countUnread(conversation, user) {
  return Message.countDocuments({
    conversationId: conversation.id,
    senderId: { $ne: user.id },
    readAt: null,
  });
}

async function presentConversation(conversation, user) {
  const [populated, unreadCount] = await Promise.all([
    Conversation.findById(conversation.id).populate(CONVERSATION_POPULATE),
    countUnread(conversation, user),
  ]);

  return toConversation(populated, { unreadCount });
}

// One conversation per booking, created on first use by either participant.
async function ensureConversation(booking) {
  try {
    return await Conversation.findOneAndUpdate(
      { bookingId: booking.id },
      {
        $setOnInsert: {
          bookingId: booking.id,
          customerId: booking.customerId,
          providerId: booking.providerId,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }

    return Conversation.findOne({ bookingId: booking.id });
  }
}

export async function openConversation(user, bookingId) {
  const booking = await findBookingForUser(bookingId, user);
  const conversation = await ensureConversation(booking);

  return {
    conversation: await presentConversation(conversation, user),
  };
}

export async function getConversation(user, bookingId) {
  const booking = await findBookingForUser(bookingId, user);
  const conversation = await Conversation.findOne({ bookingId: booking.id });

  if (!conversation) {
    throw new ApiError(404, 'Conversation not started yet', 'CONVERSATION_NOT_FOUND');
  }

  return {
    conversation: await presentConversation(conversation, user),
  };
}

function parseSince(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const since = new Date(String(value));

  if (Number.isNaN(since.getTime())) {
    throw new ApiError(400, 'since must be an ISO date-time', 'VALIDATION_ERROR');
  }

  return since;
}

// Oldest first; `since` lets a client poll for messages newer than what it has.
export async function listMessages(user, bookingId, query) {
  const since = parseSince(query?.since);
  const booking = await findBookingForUser(bookingId, user);
  const conversation = await Conversation.findOne({ bookingId: booking.id });

  if (!conversation) {
    return { messages: [] };
  }

  const filter = { conversationId: conversation.id };

  if (since) {
    filter.createdAt = { $gt: since };
  }

  const messages = await Message.find(filter).sort({ createdAt: 1 }).limit(MAX_MESSAGES);

  return {
    messages: messages.map((message) => toMessage(message, user)),
  };
}

export async function sendMessage(user, bookingId, input) {
  const text = requiredText(input?.message, 'Message', 1, 2000);
  const attachments = stringList(input?.attachments, 'Attachments', 5, 500);
  const booking = await findBookingForUser(bookingId, user);
  const conversation = await ensureConversation(booking);

  const message = await Message.create({
    conversationId: conversation.id,
    senderId: user.id,
    senderRole: user.role,
    message: text,
    attachments,
    readAt: null,
  });

  await Conversation.updateOne({ _id: conversation.id }, { $currentDate: { updatedAt: true } });

  // `isMine` in toMessage() is computed for one specific viewer, which is wrong for
  // everyone else in the room, so the broadcast omits it — each client compares
  // senderId against its own user id instead.
  const { isMine: _isMine, ...broadcastMessage } = toMessage(message, user);
  emitToBooking(bookingId, 'message:new', broadcastMessage);

  return {
    message: toMessage(message, user),
  };
}

// Marks everything the other participant sent as read.
export async function markMessagesRead(user, bookingId) {
  const booking = await findBookingForUser(bookingId, user);
  const conversation = await Conversation.findOne({ bookingId: booking.id });

  if (!conversation) {
    return { updatedCount: 0 };
  }

  const result = await Message.updateMany(
    { conversationId: conversation.id, senderId: { $ne: user.id }, readAt: null },
    { $set: { readAt: new Date() } },
  );

  if (result.modifiedCount > 0) {
    emitToBooking(bookingId, 'messages:read', { bookingId, readBy: user.id });
  }

  return { updatedCount: result.modifiedCount };
}
