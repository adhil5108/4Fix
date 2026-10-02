import mongoose from 'mongoose';
import Category from '../models/Category.js';
import Service from '../models/Service.js';
import { ApiError } from '../utils/ApiError.js';
import { parseObjectId, toIdString } from '../utils/objectId.js';
import { toPublicCategory } from './categoryPresenter.service.js';
import { toPublicService } from './servicePresenter.service.js';

const MAX_PROVIDER_CATEGORIES = 30;

// Customers see a service only while both it and its category are active. Services
// not yet given a category (pre-category data) stay visible.
export async function visibleServiceFilter() {
  const inactive = await Category.find({ isActive: false }).distinct('_id');

  return inactive.length > 0
    ? { isActive: true, categoryId: { $nin: inactive } }
    : { isActive: true };
}

// Active-service counts per category, for the customer category list.
async function countActiveServicesByCategory(categoryIds) {
  const rows = await Service.aggregate([
    { $match: { isActive: true, categoryId: { $in: categoryIds } } },
    { $group: { _id: '$categoryId', count: { $sum: 1 } } },
  ]);

  return new Map(rows.map((row) => [String(row._id), row.count]));
}

export async function listPublicCategories() {
  const categories = await Category.find({ isActive: true }).sort({ name: 1 });
  const counts = await countActiveServicesByCategory(categories.map((category) => category._id));

  return {
    categories: categories.map((category) =>
      toPublicCategory(category, { serviceCount: counts.get(category.id) ?? 0 }),
    ),
  };
}

export async function getActiveCategoryOrFail(categoryId) {
  const id = parseObjectId(categoryId, 'categoryId');
  const category = await Category.findOne({ _id: id, isActive: true });

  if (!category) {
    throw new ApiError(404, 'Category not found', 'CATEGORY_NOT_FOUND');
  }

  return category;
}

export async function listCategoryServices(categoryId) {
  const category = await getActiveCategoryOrFail(categoryId);
  const services = await Service.find({ categoryId: category._id, isActive: true })
    .sort({ name: 1 })
    .populate('categoryId');

  return {
    category: toPublicCategory(category),
    services: services.map(toPublicService),
  };
}

// Validates the category ids a provider picks: unique, existing and active. Ids the
// provider already holds stay valid even if that category was later disabled, so
// saving an unrelated profile change never fails because of an admin decision.
export async function parseProviderCategoryIds(value, { current = [], required = false } = {}) {
  if (!Array.isArray(value)) {
    throw new ApiError(400, 'Categories must be an array', 'VALIDATION_ERROR');
  }

  if (value.length > MAX_PROVIDER_CATEGORIES) {
    throw new ApiError(
      400,
      `Choose at most ${MAX_PROVIDER_CATEGORIES} categories`,
      'VALIDATION_ERROR',
    );
  }

  const ids = [...new Set(value.map((item) => toIdString(parseObjectId(item, 'categoryId'))))];

  if (required && ids.length === 0) {
    throw new ApiError(400, 'Choose at least one category', 'VALIDATION_ERROR');
  }

  const held = new Set(current.map(toIdString));
  const found = await Category.find({
    _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
  }).select('_id isActive');
  const usable = new Set(
    found.filter((category) => category.isActive || held.has(category.id)).map((category) => category.id),
  );

  if (ids.some((id) => !usable.has(id))) {
    throw new ApiError(400, 'One or more categories are not available', 'VALIDATION_ERROR');
  }

  return ids.map((id) => new mongoose.Types.ObjectId(id));
}
