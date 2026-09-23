import mongoose from 'mongoose';

// A note can be attached to either a real 4Fix Booking or a provider-recorded
// ExternalJob — `jobType` says which collection `jobId` points into.
export const NOTE_JOB_TYPES = {
  BOOKING: 'BOOKING',
  EXTERNAL_JOB: 'EXTERNAL_JOB',
};

// Private to the provider who wrote it — never surfaced to the customer or admin.
// See providerJobNote.service.js for the ownership checks that enforce that.
const providerJobNoteSchema = new mongoose.Schema(
  {
    jobType: {
      type: String,
      enum: Object.values(NOTE_JOB_TYPES),
      required: true,
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

providerJobNoteSchema.index({ jobType: 1, jobId: 1, providerId: 1, updatedAt: -1 });

const ProviderJobNote = mongoose.model('ProviderJobNote', providerJobNoteSchema);

export default ProviderJobNote;
