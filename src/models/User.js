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
// Providers who register give their shop address only (coordinates null); coordinates
// are added if they later set the location from their profile. Never geocoded.
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
    serviceCategories: {
      type: [String],
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
