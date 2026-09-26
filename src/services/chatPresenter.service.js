import { toIdString } from '../utils/objectId.js';
import { isPopulated, toCustomerContact } from './requestPresenter.service.js';
import { toUserSummary } from './userPresenter.service.js';

function customerName(conversation) {
  const request = isPopulated(conversation.bookingId) ? conversation.bookingId.requestId : null;
  return toCustomerContact(request, conversation.customerId)?.name ?? null;
}

export function toConversation(conversation, { unreadCount } = {}) {
  return {
    id: conversation.id,
    bookingId: toIdString(conversation.bookingId),
    // Participants (and admin) only: the customer's name, never their phone.
    customer: customerName(conversation) ? { name: customerName(conversation) } : null,
    provider: isPopulated(conversation.providerId)
      ? toUserSummary(conversation.providerId)
      : null,
    customerId: toIdString(conversation.customerId),
    providerId: toIdString(conversation.providerId),
    unreadCount: unreadCount ?? 0,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

// `isMine` is computed for the requesting participant (by side: CUSTOMER or PROVIDER).
export function toMessage(message, viewer) {
  return {
    id: message.id,
    conversationId: toIdString(message.conversationId),
    senderId: toIdString(message.senderId),
    senderRole: message.senderRole,
    isMine: message.senderRole === viewer.role,
    message: message.message,
    attachments: message.attachments,
    readAt: message.readAt,
    createdAt: message.createdAt,
  };
}
