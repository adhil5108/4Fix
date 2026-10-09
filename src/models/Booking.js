import mongoose from 'mongoose';

// Job lifecycle: the provider accepts (ASSIGNED), reaches the customer's location
// (LOCATION_REACHED), starts work (IN_PROGRESS) and completes it. Pre-V1 statuses
// (CONFIRMED/ON_THE_WAY/ARRIVED/IN_SERVICE) are mapped onto these by
// scripts/migrate-v1-accept-flow.js; LOCATION_REACHED is deliberately a different name
// from the legacy ARRIVED so re-running that script never rewrites it.
export const BOOKING_STATUSES = {
  ASSIGNED: 'ASSIGNED',
  LOCATION_REACHED: 'LOCATION_REACHED',
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
    // Null on jobs started before the Location Reached step existed.
    locationReachedAt: {
      type: Date,
      default: null,
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
