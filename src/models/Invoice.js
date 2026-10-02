import mongoose from 'mongoose';

const contactSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 120, default: null },
    phone: { type: String, trim: true, maxlength: 20, default: null },
  },
  { _id: false },
);

// A record of a completed 4Fix job, created once when the job completes. 4Fix does not
// process payments and records no agreed price, so an invoice carries no amount — the
// price is agreed directly between customer and provider. Details are copied from the
// job at completion so the document doesn't change if a name is edited later.
// Only 4Fix jobs (Booking) get invoices; provider-recorded external jobs do not.
const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, trim: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceRequest', required: true },
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    provider: { type: contactSchema, required: true },
    customer: { type: contactSchema, default: null },
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    serviceName: { type: String, required: true, trim: true, maxlength: 120 },
    issueKey: { type: String, trim: true, maxlength: 60, default: null },
    issueLabel: { type: String, trim: true, maxlength: 120, default: null },
    description: { type: String, trim: true, maxlength: 2000, default: null },
    completedAt: { type: Date, required: true },
  },
  {
    timestamps: true,
  },
);

// Exactly one invoice per job; the unique index makes creation idempotent under retries.
invoiceSchema.index({ bookingId: 1 }, { unique: true });
invoiceSchema.index({ invoiceNumber: 1 }, { unique: true });

const Invoice = mongoose.model('Invoice', invoiceSchema);

// Sequential invoice numbers (4F-000001, …) from a single atomic counter document.
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });

export const Counter = mongoose.model('Counter', counterSchema);

export default Invoice;
