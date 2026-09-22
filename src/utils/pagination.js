import { ApiError } from './ApiError.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// Shared by the admin list endpoints, the only ones in this API that page results.
export function parsePagination(query) {
  const page = query?.page !== undefined ? Number(query.page) : 1;
  const pageSize = query?.pageSize !== undefined ? Number(query.pageSize) : DEFAULT_PAGE_SIZE;

  if (!Number.isInteger(page) || page < 1) {
    throw new ApiError(400, 'page must be a positive integer', 'VALIDATION_ERROR');
  }

  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new ApiError(400, `pageSize must be an integer from 1 to ${MAX_PAGE_SIZE}`, 'VALIDATION_ERROR');
  }

  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function toPageResult(key, items, { page, pageSize }, total) {
  return {
    [key]: items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
