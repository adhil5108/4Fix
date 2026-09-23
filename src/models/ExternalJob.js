import mongoose from 'mongoose';

export const EXTERNAL_JOB_STATUSES = {
  SCHEDULED: 'SCHEDULED',
  ON_THE_WAY: 'ON_THE_WAY',
  ARRIVED: 'ARRIVED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
};

// Mirrors ServiceRequest's addressSchema so the same presenter/UI shape (AddressBlock,
// AddressForm) works unchanged for both.
const addressSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, maxlength: 40, default: 'Home' },
    addressLine: { type: String, required: true, trim: true, maxlength: 240 },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    state: { type: String, required: true, trim: true, maxlength: 80 },
    pincode: { type: String, required: true, trim: true },
  },
  { _id: false },
);

// A job a provider records themselves — work that came in outside 4Fix (a direct call,
// a walk-in). Deliberately not a ServiceRequest/Quote/Booking: there is no customer
// account, no quote, no payment flow, and the "customer" here is just a name/phone the
// provider typed in, not a User document.
const externalJobSchema = new mongoose.Schema(
  {
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    customerName: { type: String, required: true, trim: true, maxlength: 120 },
    customerPhone: { type: String, trim: true, maxlength: 20, default: null },
    serviceLabel: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    attachments: { type: [String], default: [] },
    address: { type: addressSchema, required: true },
    // Optional and never required to be in the future — providers may record work
    // that already happened.
    scheduledDate: { type: Date, default: null },
    scheduledTime: { type: String, trim: true, default: null },
    status: {
      type: String,
      enum: Object.values(EXTERNAL_JOB_STATUSES),
      default: EXTERNAL_JOB_STATUSES.SCHEDULED,
      required: true,
      index: true,
    },
    onTheWayAt: { type: Date, default: null },
    arrivedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  },
);

const ExternalJob = mongoose.model('ExternalJob', externalJobSchema);

export default ExternalJob;
