import mongoose from 'mongoose';

// V1 job lifecycle: the provider accepts (ASSIGNED), starts work (IN_PROGRESS) and
// completes it. Pre-V1 statuses (CONFIRMED/ON_THE_WAY/ARRIVED/IN_SERVICE) are mapped
// onto these by scripts/migrate-v1-accept-flow.js.
export const BOOKING_STATUSES = {
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

// The job created when a provider accepts a request. Request details (service,
// location, description) stay on the ServiceRequest and are not copied. Providers
// never share a live position — navigation always targets the customer's location.
const bookingSchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      required: true,
    },
    // Legacy only: set for requests from the old customer-account flow.
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    bookingStatus: {
      type: String,
      enum: Object.values(BOOKING_STATUSES),
      default: BOOKING_STATUSES.ASSIGNED,
      required: true,
      index: true,
    },
    // When the provider accepted the job.
    confirmedAt: {
      type: Date,
      required: true,
    },
    technicianStartedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

bookingSchema.index({ requestId: 1 }, { unique: true });

const Booking = mongoose.model('Booking', bookingSchema);

export default Booking;
