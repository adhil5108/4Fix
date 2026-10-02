import {
  listCategoryServices as listCategoryServicesService,
  listPublicCategories,
} from '../services/category.service.js';

export async function listCategories(_req, res) {
  res.status(200).json(await listPublicCategories());
}

export async function listCategoryServices(req, res) {
  res.status(200).json(await listCategoryServicesService(req.params.categoryId));
}
