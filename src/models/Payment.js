import mongoose from 'mongoose';

export const PAYMENT_STATUSES = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
};

// How an offline payment was collected. A gateway integration can extend this later.
export const PAYMENT_METHODS = {
  CASH: 'CASH',
  UPI: 'UPI',
  CARD: 'CARD',
  OTHER: 'OTHER',
};

export const PAYMENT_CURRENCY = 'INR';

const paymentSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      enum: [PAYMENT_CURRENCY],
      default: PAYMENT_CURRENCY,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUSES),
      default: PAYMENT_STATUSES.PENDING,
      required: true,
      index: true,
    },
    method: {
      type: String,
      enum: [...Object.values(PAYMENT_METHODS), null],
      default: null,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    transactionReference: {
      type: String,
      trim: true,
      maxlength: 120,
      default: null,
    },
    // Who recorded the payment as received (provider or admin).
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

paymentSchema.index({ bookingId: 1 }, { unique: true });

const Payment = mongoose.model('Payment', paymentSchema);

export default Payment;
