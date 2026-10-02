import mongoose from 'mongoose';

// A group of services customers browse first (AC, Electrical, Plumbing…). Services
// reference one category by id; providers list the categories they work in.
const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 60,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 300,
      default: null,
    },
    // Icon, same treatment as a service's `image`: small, square, scaled to fit.
    image: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    // Inactive categories (and their services) are hidden from customers.
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

// Case-insensitive uniqueness, so "AC" and "ac" cannot both exist.
categorySchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);

const Category = mongoose.model('Category', categorySchema);

export default Category;
