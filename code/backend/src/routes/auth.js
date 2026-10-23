const express = require('express');
const bcrypt = require('bcrypt');
const { prisma } = require('../db');
const { ah, unauthorized, invalid } = require('../errors');
const { requireAuth, signToken } = require('../middleware/auth');

const router = express.Router();

const STAFF_NAMES = { analyst1: 'Analyst One', analyst2: 'Analyst Two', manager1: 'Manager One', manager2: 'Manager Two' };

async function publicUser(userId) {
  const u = await prisma.user.findUnique({ where: { user_id: userId }, include: { customer: true } });
  if (!u) return null;
  return {
    user_id: u.user_id, username: u.username, role: u.role, customer_id: u.customer_id,
    display_name: u.customer ? u.customer.full_name : STAFF_NAMES[u.username] || u.username,
  };
}

router.post('/login', ah(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) throw invalid('Invalid input', { username: 'required', password: 'required' });
  const u = await prisma.user.findUnique({ where: { username: String(username) } });
  if (!u || !(await bcrypt.compare(String(password), u.password_hash))) throw unauthorized('Wrong username or password');
  res.json({ token: signToken(u), user: await publicUser(u.user_id) });
}));

router.get('/me', requireAuth, ah(async (req, res) => {
  const user = await publicUser(req.user.sub);
  if (!user) throw unauthorized();
  res.json(user);
}));

module.exports = router;
