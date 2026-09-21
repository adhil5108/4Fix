import mongoose from 'mongoose';

// The "what's wrong?" options a customer picks from after choosing a service.
const serviceIssueSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 60,
    },
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 300,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    _id: false,
  },
);

// Issue key customers use when none of the listed problems fit.
export const OTHER_ISSUE_KEY = 'OTHER';

const serviceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 60,
      index: true,
    },
    image: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    startingPrice: {
      type: Number,
      min: 0,
      default: null,
    },
    isPopular: {
      type: Boolean,
      default: false,
    },
    issues: {
      type: [serviceIssueSchema],
      default: [],
    },
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

serviceSchema.index({ name: 1 }, { unique: true });

const Service = mongoose.model('Service', serviceSchema);

export default Service;
