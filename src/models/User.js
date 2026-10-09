import mongoose from 'mongoose';

// CUSTOMER is kept for legacy accounts and as the role of the anonymous request-owner
// principal; V1 creates no customer accounts and customers cannot log in.
export const USER_ROLES = {
  CUSTOMER: 'CUSTOMER',
  PROVIDER: 'PROVIDER',
  ADMIN: 'ADMIN',
};

// A provider's registered shop/business location. It is a fixed profile field, never a
// live position: 4Fix does not track providers.
// Providers give their shop address only; coordinates are no longer collected (they stay
// null, or keep whatever an older profile already stored). Never geocoded.
// Before `shopName` existed, providers typed their shop name and address together into
// `address`; that combined text is left as the address, never split or guessed.
const shopLocationSchema = new mongoose.Schema(
  {
    latitude: {
      type: Number,
      min: -90,
      max: 90,
      default: null,
    },
    longitude: {
      type: Number,
      min: -180,
      max: 180,
      default: null,
    },
    address: {
      type: String,
      trim: true,
      maxlength: 240,
      default: null,
    },
  },
  {
    _id: false,
  },
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
    },
    username: {
      type: String,
      required: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      required: true,
      index: true,
    },
    phoneVerifiedAt: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    // Public provider profile. Only meaningful for PROVIDER accounts.
    profileImage: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    bio: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    // The categories this provider works in. They only see and accept requests for
    // services in these categories. Empty for providers registered before categories.
    categories: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
      default: [],
    },
    experienceYears: {
      type: Number,
      min: 0,
      max: 60,
      default: null,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    // Shop/business name, e.g. "Cool Air Services". Required at provider signup; null
    // for providers registered before it existed until they add it from their profile.
    shopName: {
      type: String,
      trim: true,
      maxlength: 120,
      default: null,
    },
    // Required at provider signup; null for providers registered before V1 until they
    // set it from their profile.
    shopLocation: {
      type: shopLocationSchema,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

userSchema.index({ username: 1 }, { unique: true });

const User = mongoose.model('User', userSchema);

export default User;
