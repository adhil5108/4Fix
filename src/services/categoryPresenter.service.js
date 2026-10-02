import { toIdString } from '../utils/objectId.js';

function isPopulatedCategory(value) {
  return Boolean(value) && typeof value === 'object' && value.name !== undefined;
}

export function toPublicCategory(category, { serviceCount } = {}) {
  if (!category) {
    return null;
  }

  return {
    id: category.id,
    name: category.name,
    description: category.description ?? null,
    image: category.image ?? null,
    ...(serviceCount === undefined ? {} : { serviceCount }),
  };
}

export function toAdminCategory(category, { serviceCount } = {}) {
  return {
    ...toPublicCategory(category, { serviceCount }),
    isActive: category.isActive,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

// The short form embedded in services and providers. An unpopulated reference still
// yields its id (with no name) so callers never lose the link.
export function toCategoryRef(category) {
  if (!category) {
    return null;
  }

  return isPopulatedCategory(category)
    ? { id: toIdString(category), name: category.name, image: category.image ?? null }
    : { id: toIdString(category), name: null, image: null };
}
