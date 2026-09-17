import mongoose from 'mongoose';

export const QUOTE_STATUSES = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
};

export const ACTIVE_QUOTE_STATUSES = [
  QUOTE_STATUSES.PENDING,
  QUOTE_STATUSES.ACCEPTED,
];

const quoteSchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      required: true,
      index: true,
    },
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: Object.values(QUOTE_STATUSES),
      default: QUOTE_STATUSES.PENDING,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

quoteSchema.index({ requestId: 1, providerId: 1 });

const Quote = mongoose.model('Quote', quoteSchema);

export default Quote;
