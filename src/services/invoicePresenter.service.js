import { toIdString } from '../utils/objectId.js';

function toContact(contact) {
  return contact ? { name: contact.name ?? null, phone: contact.phone ?? null } : null;
}

// The same document for all three audiences: everything on it is already visible to
// each of them on the job itself (customer ↔ provider contacts, service, issue).
export function toInvoice(invoice) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    bookingId: toIdString(invoice.bookingId),
    requestId: toIdString(invoice.requestId),
    providerId: toIdString(invoice.providerId),
    issuedAt: invoice.createdAt,
    completedAt: invoice.completedAt,
    provider: toContact(invoice.provider),
    customer: toContact(invoice.customer),
    service: { id: toIdString(invoice.serviceId), name: invoice.serviceName },
    issueKey: invoice.issueKey ?? null,
    issueLabel: invoice.issueLabel ?? null,
    description: invoice.description ?? null,
  };
}
