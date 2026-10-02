import Category from '../models/Category.js';
import Service from '../models/Service.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { parseObjectId } from '../utils/objectId.js';
import { optionalText, requiredText } from '../utils/text.js';
import { toAdminCategory } from './categoryPresenter.service.js';

const NAME_COLLATION = { locale: 'en', strength: 2 };

function buildCategoryFields(input, { partial }) {
  const fields = {};

  if (!partial || input?.name !== undefined) {
    fields.name = requiredText(input?.name, 'Name', 2, 60);
  }

  if (input?.description !== undefined) {
    fields.description = optionalText(input.description, 'Description', 300);
  }

  if (input?.image !== undefined) {
    fields.image = optionalText(input.image, 'Image', 500);
  }

  if (input?.isActive !== undefined) {
    if (typeof input.isActive !== 'boolean') {
      throw new ApiError(400, 'isActive must be true or false', 'VALIDATION_ERROR');
    }

    fields.isActive = input.isActive;
  }

  return fields;
}

async function assertNameAvailable(name, exceptId) {
  const filter = { name };

  if (exceptId) {
    filter._id = { $ne: exceptId };
  }

  if (await Category.findOne(filter).collation(NAME_COLLATION)) {
    throw new ApiError(409, 'A category with this name already exists', 'CATEGORY_EXISTS');
  }
}

function rethrowDuplicate(error) {
  if (error?.code === 11000) {
    throw new ApiError(409, 'A category with this name already exists', 'CATEGORY_EXISTS');
  }

  throw error;
}

async function serviceCounts() {
  const rows = await Service.aggregate([
    { $match: { categoryId: { $ne: null } } },
    { $group: { _id: '$categoryId', count: { $sum: 1 } } },
  ]);

  return new Map(rows.map((row) => [String(row._id), row.count]));
}

export async function findAdminCategoryOrFail(categoryId) {
  const id = parseObjectId(categoryId, 'categoryId');
  const category = await Category.findById(id);

  if (!category) {
    throw new ApiError(404, 'Category not found', 'CATEGORY_NOT_FOUND');
  }

  return category;
}

// Categories are a short list, so admin gets all of them at once (no paging), each with
// how many services (active or not) belong to it.
export async function listAdminCategories() {
  const [categories, counts] = await Promise.all([
    Category.find({}).collation(NAME_COLLATION).sort({ name: 1 }),
    serviceCounts(),
  ]);

  return {
    categories: categories.map((category) =>
      toAdminCategory(category, { serviceCount: counts.get(category.id) ?? 0 }),
    ),
  };
}

export async function getAdminCategory(categoryId) {
  const category = await findAdminCategoryOrFail(categoryId);
  const serviceCount = await Service.countDocuments({ categoryId: category._id });

  return { category: toAdminCategory(category, { serviceCount }) };
}

export async function createAdminCategory(input) {
  const fields = buildCategoryFields(input, { partial: false });

  await assertNameAvailable(fields.name);
  const category = await Category.create(fields).catch(rethrowDuplicate);

  return { category: toAdminCategory(category, { serviceCount: 0 }) };
}

export async function updateAdminCategory(categoryId, input) {
  const existing = await findAdminCategoryOrFail(categoryId);
  const fields = buildCategoryFields(input, { partial: true });

  if (Object.keys(fields).length === 0) {
    throw new ApiError(400, 'No changes were provided', 'VALIDATION_ERROR');
  }

  if (fields.name) {
    await assertNameAvailable(fields.name, existing._id);
  }

  const updated = await Category.findByIdAndUpdate(
    existing._id,
    { $set: fields },
    { returnDocument: 'after' },
  ).catch(rethrowDuplicate);
  const serviceCount = await Service.countDocuments({ categoryId: updated._id });

  return { category: toAdminCategory(updated, { serviceCount }) };
}

// Only an empty category may be deleted: one with services must be disabled instead,
// so no service is ever left pointing at nothing. Providers simply lose the choice.
export async function deleteAdminCategory(categoryId) {
  const category = await findAdminCategoryOrFail(categoryId);

  if (await Service.exists({ categoryId: category._id })) {
    throw new ApiError(
      409,
      'This category still has services and cannot be deleted. Move its services or disable it instead.',
      'CATEGORY_IN_USE',
    );
  }

  await Category.deleteOne({ _id: category._id });
  await User.updateMany({ categories: category._id }, { $pull: { categories: category._id } });

  return { deleted: true };
}
