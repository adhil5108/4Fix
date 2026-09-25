import mongoose from 'mongoose';

// New bookings start ASSIGNED (the provider accepted the job themselves). CONFIRMED
// only exists on bookings created by the pre-V1 quote flow.
export const BOOKING_STATUSES = {
  CONFIRMED: 'CONFIRMED',
  ASSIGNED: 'ASSIGNED',
  ON_THE_WAY: 'ON_THE_WAY',
  ARRIVED: 'ARRIVED',
  IN_SERVICE: 'IN_SERVICE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

// Latest known technician position only; no location history is kept in V1.
const locationSchema = new mongoose.Schema(
  {
    latitude: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },
    longitude: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },
    updatedAt: {
      type: Date,
      required: true,
    },
  },
  {
    _id: false,
  },
);

// The job created when a provider accepts a request: the customer/provider relationship. Request details
// (service, address, description) stay on the ServiceRequest and are not copied.
const bookingSchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
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
      index: true,
    },
    bookingStatus: {
      type: String,
      enum: Object.values(BOOKING_STATUSES),
      default: BOOKING_STATUSES.ASSIGNED,
      required: true,
      index: true,
    },
    confirmedAt: {
      type: Date,
      required: true,
    },
    // Mirrors of the request schedule so booking lists can filter by date.
    scheduledDate: {
      type: Date,
      default: null,
    },
    scheduledTime: {
      type: String,
      default: null,
      trim: true,
    },
    arrivalCode: {
      type: String,
      required: true,
    },
    technicianAssignedAt: {
      type: Date,
      default: null,
    },
    onTheWayAt: {
      type: Date,
      default: null,
    },
    arrivedAt: {
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
    lastLocation: {
      type: locationSchema,
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
