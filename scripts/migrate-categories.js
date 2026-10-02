// One-off migration to first-class categories. Before this, a service stored its
// category as free text (e.g. "AC", "PLUMBING"). For every service that has no
// `categoryId` yet, this finds or creates a Category with that name and links the
// service to it, then drops the old text field. No service is deleted or deactivated.
// Services with no old category text are left as they are (they still render, under no
// category) and listed so admin can assign one.
// Providers are NOT given categories: they choose their own from their profile.
// Usage: npm run migrate:categories   (reads MONGODB_URI from .env; safe to run repeatedly)
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import Category from '../src/models/Category.js';
import Service from '../src/models/Service.js';

// "PLUMBING" → "Plumbing"; short codes such as "AC" stay upper-case.
function displayName(legacy) {
  const text = legacy.trim().replace(/[_\s]+/g, ' ');
  return text.length <= 3 ? text.toUpperCase() : text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

await mongoose.connect(env.mongodbUri);

const services = Service.collection;
const unlinked = await services
  .find({ $or: [{ categoryId: { $exists: false } }, { categoryId: null }] })
  .toArray();

let created = 0;
let linked = 0;
const skipped = [];

for (const service of unlinked) {
  if (typeof service.category !== 'string' || !service.category.trim()) {
    skipped.push(service.name);
    continue;
  }

  const name = displayName(service.category);
  let category = await Category.findOne({ name }).collation({ locale: 'en', strength: 2 });

  if (!category) {
    category = await Category.create({ name });
    created += 1;
  }

  await services.updateOne(
    { _id: service._id },
    { $set: { categoryId: category._id }, $unset: { category: '' } },
  );
  linked += 1;
}

console.log(`Categories created: ${created}`);
console.log(`Services linked to a category: ${linked}`);

if (skipped.length > 0) {
  console.log(`Services with no category to migrate (assign one in admin): ${skipped.join(', ')}`);
}

await mongoose.disconnect();
