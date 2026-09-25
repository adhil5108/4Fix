import { toDateOnlyString } from '../utils/dateTime.js';

function toAddress(address) {
  if (!address) {
    return null;
  }

  return {
    label: address.label,
    addressLine: address.addressLine,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
  };
}

export function toExternalJob(job) {
  return {
    id: job.id,
    source: 'EXTERNAL',
    status: job.status,
    customer: { name: job.customerName, phone: job.customerPhone },
    serviceLabel: job.serviceLabel,
    description: job.description,
    attachments: job.attachments,
    address: toAddress(job.address),
    scheduledDate: toDateOnlyString(job.scheduledDate),
    scheduledTime: job.scheduledTime,
    timeline: {
      onTheWayAt: job.onTheWayAt,
      arrivedAt: job.arrivedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    },
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

// Shaped to slot into the same "My Jobs" array as toProviderJob(): bookingId,
// bookingStatus, service, issueLabel, preferredDate/Time are always null since an
// external job has no ServiceRequest/Booking behind it.
export function toExternalJobSummary(job) {
  return {
    id: job.id,
    source: 'EXTERNAL',
    status: job.status,
    bookingId: null,
    bookingStatus: null,
    service: null,
    serviceLabel: job.serviceLabel,
    issueLabel: null,
    description: job.description,
    customer: { name: job.customerName, phone: job.customerPhone },
    address: toAddress(job.address),
    scheduledDate: toDateOnlyString(job.scheduledDate),
    scheduledTime: job.scheduledTime,
    preferredDate: null,
    preferredTime: null,
    attachments: job.attachments,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
