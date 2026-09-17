import { updateCurrentUser } from '../services/user.service.js';

export async function updateMe(req, res) {
  const result = await updateCurrentUser(req.user, req.body);

  res.status(200).json(result);
}
