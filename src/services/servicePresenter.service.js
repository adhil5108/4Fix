export function toPublicService(service) {
  if (!service) {
    return null;
  }

  return {
    id: service.id,
    name: service.name,
    description: service.description,
    category: service.category,
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

  return {
    ...toPublicService(service),
    issues: (service.issues || []).filter((issue) => issue.isActive).map(toServiceIssue),
  };
}
