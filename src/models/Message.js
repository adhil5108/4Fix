import mongoose from 'mongoose';
import { USER_ROLES } from './User.js';

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
    },
    // The provider's user id; null for the anonymous customer (who has no account).
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // A conversation has exactly one customer and one provider, so the role alone
    // identifies the sender (and drives isMine / unread counts).
    senderRole: {
      type: String,
      enum: [USER_ROLES.CUSTOMER, USER_ROLES.PROVIDER],
      required: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    attachments: {
      type: [String],
      default: [],
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });

const Message = mongoose.model('Message', messageSchema);

export default Message;
