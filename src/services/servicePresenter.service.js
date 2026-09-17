export function toPublicService(service) {
  if (!service) {
    return null;
  }

  return {
    id: service.id,
    name: service.name,
    description: service.description,
    category: service.category,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  };
}
