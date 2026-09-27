import Booking from '../models/Booking.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import { USER_ROLES } from '../models/User.js';
import { emitToBooking, emitToInbox, providerInbox, requestInbox } from '../realtime/socket.js';
import { ApiError } from '../utils/ApiError.js';
import { requiredText, stringList } from '../utils/text.js';
import { findBookingForUser } from './booking.service.js';
import { toConversation, toMessage } from './chatPresenter.service.js';

const MAX_MESSAGES = 200;
// The booking's request carries the (account-less) customer's name for the chat header.
const CONVERSATION_POPULATE = [
  { path: 'customerId' },
  { path: 'providerId' },
  { path: 'bookingId', populate: { path: 'requestId' } },
];

// Messages from "the other side": each conversation has one customer and one provider,
// so sides are identified by role (the anonymous customer has no user id).
function fromOtherSide(user) {
  return { senderRole: { $ne: user.role } };
}

function countUnread(conversation, user) {
  return Message.countDocuments({
    conversationId: conversation.id,
    ...fromOtherSide(user),
    readAt: null,
  });
}

// The inbox room of one side of a booking (see realtime/socket.js).
function inboxOf(booking, role) {
  return role === USER_ROLES.PROVIDER ? providerInbox(booking.providerId) : requestInbox(booking.requestId);
}

const otherRole = (role) => (role === USER_ROLES.PROVIDER ? USER_ROLES.CUSTOMER : USER_ROLES.PROVIDER);

// `unreadCount` is always the absolute, persisted count (never a "+1"), so a client
// that receives the same event twice — or after a reconnect — can't double-count.
function emitUnread(booking, conversation, role, unreadCount, message = null) {
  emitToInbox(inboxOf(booking, role), 'chat:unread', {
    bookingId: String(booking.id),
    conversationId: String(conversation.id),
    unreadCount,
    message,
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
          customerId: booking.customerId ?? null,
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
    senderId: user.id ?? null,
    senderRole: user.role,
    message: text,
    attachments,
    readAt: null,
  });

  await Conversation.updateOne({ _id: conversation.id }, { $currentDate: { updatedAt: true } });

  // `isMine` in toMessage() is computed for one specific viewer, which is wrong for
  // everyone else in the room, so the broadcast omits it — each client compares
  // senderRole against its own side instead.
  const { isMine: _isMine, ...broadcastMessage } = toMessage(message, user);
  emitToBooking(bookingId, 'message:new', broadcastMessage);
  await notifyRecipient(booking, conversation, message);

  return {
    message: toMessage(message, user),
  };
}

// Tells the other side (wherever they are in the app) their unread count for this
// conversation, with just enough about the new message for an in-app notification.
// If they are looking at the conversation, their client marks it read right away,
// which pushes the count back to 0.
async function notifyRecipient(booking, conversation, message) {
  const recipientRole = otherRole(message.senderRole);
  const [unreadCount, populated] = await Promise.all([
    countUnread(conversation, { role: recipientRole }),
    Conversation.findById(conversation.id).populate(CONVERSATION_POPULATE),
  ]);
  const summary = toConversation(populated);
  const sender = message.senderRole === USER_ROLES.PROVIDER ? summary.provider : summary.customer;

  emitUnread(booking, conversation, recipientRole, unreadCount, {
    id: message.id,
    senderRole: message.senderRole,
    senderName: sender?.name ?? null,
    createdAt: message.createdAt,
  });
}

// Unread counts across every conversation this participant can access: all of a
// provider's own jobs, or the one job of an anonymous customer's request. Used on page
// load and after a socket reconnect so counts survive refreshes.
export async function getUnreadSummary(user) {
  const bookingFilter =
    user.role === USER_ROLES.PROVIDER ? { providerId: user.id } : { requestId: user.requestId };
  const bookingIds = await Booking.find(bookingFilter).distinct('_id');
  const conversations = await Conversation.find({ bookingId: { $in: bookingIds } }).select('_id bookingId');

  if (conversations.length === 0) {
    return { total: 0, conversations: [] };
  }

  const counts = await Message.aggregate([
    {
      $match: {
        conversationId: { $in: conversations.map((conversation) => conversation._id) },
        ...fromOtherSide(user),
        readAt: null,
      },
    },
    { $group: { _id: '$conversationId', unreadCount: { $sum: 1 }, lastMessageAt: { $max: '$createdAt' } } },
  ]);
  const byConversation = new Map(counts.map((row) => [String(row._id), row]));

  const items = conversations
    .filter((conversation) => byConversation.has(conversation.id))
    .map((conversation) => {
      const row = byConversation.get(conversation.id);
      return {
        bookingId: String(conversation.bookingId),
        conversationId: conversation.id,
        unreadCount: row.unreadCount,
        lastMessageAt: row.lastMessageAt,
      };
    });

  return {
    total: items.reduce((sum, item) => sum + item.unreadCount, 0),
    conversations: items,
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
    { conversationId: conversation.id, ...fromOtherSide(user), readAt: null },
    { $set: { readAt: new Date() } },
  );

  if (result.modifiedCount > 0) {
    emitToBooking(bookingId, 'messages:read', { bookingId, readBy: user.role });
    // Clears this conversation's badge in the reader's other tabs/devices too.
    emitUnread(booking, conversation, user.role, 0);
  }

  return { updatedCount: result.modifiedCount };
}
