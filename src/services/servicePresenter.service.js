import { OTHER_ISSUE_KEY } from '../models/Service.js';
import { toIdString } from '../utils/objectId.js';
import { toCategoryRef } from './categoryPresenter.service.js';

export function toPublicService(service) {
  if (!service) {
    return null;
  }

  return {
    id: service.id,
    name: service.name,
    description: service.description,
    // `{ id, name, image }` when the category was populated, `{ id, name: null }` when
    // not, and null for a service that has no category yet.
    categoryId: toIdString(service.categoryId),
    category: toCategoryRef(service.categoryId),
    image: service.image ?? null,
    startingPrice: service.startingPrice ?? null,
    isPopular: Boolean(service.isPopular),
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  };
}

function toServiceIssue(issue) {
  return {
    key: issue.key,
    label: issue.label,
    description: issue.description ?? null,
  };
}

// Service details additionally list the active "what's wrong?" options.
export function toServiceDetail(service) {
  if (!service) {
    return null;
  }

  const issues = (service.issues || []).filter((issue) => issue.isActive).map(toServiceIssue);

  // "Something else" is always offered so the customer can describe a problem freely.
  if (!issues.some((issue) => issue.key === OTHER_ISSUE_KEY)) {
    issues.push({ key: OTHER_ISSUE_KEY, label: 'Something else', description: null });
  }

  return {
    ...toPublicService(service),
    issues,
  };
}
