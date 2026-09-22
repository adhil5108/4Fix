import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

// Self-contained: loads env independently so this module works regardless of
// where it sits in the import graph relative to config/env.js.
dotenv.config({ quiet: true });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export default cloudinary;
