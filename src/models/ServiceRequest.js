import mongoose from 'mongoose';

export const REQUEST_STATUSES = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

const addressSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      trim: true,
      maxlength: 40,
      default: 'Home',
    },
    addressLine: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
    },
    city: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    state: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    pincode: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    _id: false,
  },
);

// Device-captured service location. Coordinates are the authoritative navigation
// target; `address` is an optional human-readable hint (flat no., landmark). Absent on
// requests created before this field existed.
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
    address: {
      type: String,
      trim: true,
      maxlength: 240,
      default: null,
    },
  },
  {
    _id: false,
  },
);

// Optional customer voice note captured at request creation. Absent on every request
// created before this field existed, and on any request created without recording one.
const voiceNoteSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    format: {
      type: String,
      trim: true,
      maxlength: 40,
      default: null,
    },
    durationSeconds: {
      type: Number,
      default: null,
      min: 0,
      max: 600,
    },
  },
  {
    _id: false,
  },
);

const serviceRequestSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
      index: true,
    },
    issueKey: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 60,
      default: null,
    },
    issueLabel: {
      type: String,
      trim: true,
      maxlength: 120,
      default: null,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    attachments: {
      type: [String],
      default: [],
    },
    voiceNote: {
      type: voiceNoteSchema,
      default: null,
    },
    // A request carries a captured `location`, a typed `address`, or both; the
    // service layer enforces that at least one is present.
    address: {
      type: addressSchema,
      default: null,
    },
    location: {
      type: locationSchema,
      default: null,
    },
    // Legacy only: requests created before the V1 accept flow carried a preferred slot.
    // New requests leave these null; the provider sets the visit via schedule.
    preferredDate: {
      type: Date,
      default: null,
    },
    preferredTime: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(REQUEST_STATUSES),
      default: REQUEST_STATUSES.PENDING,
      required: true,
      index: true,
    },
    // The provider who accepted the request (the assigned provider). Set exactly once,
    // atomically, by the accept endpoint.
    selectedProviderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    scheduledDate: {
      type: Date,
      default: null,
    },
    scheduledTime: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

const ServiceRequest = mongoose.model('ServiceRequest', serviceRequestSchema);

export default ServiceRequest;
