'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../../db');
const { signToken, setCookie, clearCookie, requireAuth } = require('../../lib/auth');

const router = express.Router();

// POST /api/v1/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Email is required.' });
    if (!password || typeof password !== 'string') return res.status(400).json({ error: 'Password is required.' });

    const user = await db.getUserByEmail(email.trim());
    // Constant-time failure: always run bcrypt even when no user found to prevent timing attacks
    const hash = user?.password_hash || '$2a$12$invalidhashpaddingtomakeitconstanttime000000000000000000';
    const valid = await bcrypt.compare(password, hash);

    if (!user || !valid) return res.status(401).json({ error: 'Invalid email or password.' });
    if (user.status === 'suspended') return res.status(403).json({ error: 'This account has been suspended. Contact your administrator.' });
    if (user.status === 'locked')    return res.status(403).json({ error: 'This account is locked. Contact your administrator.' });

    await db.updateUserLastLogin(user.id);

    const token = signToken({
      userId:   user.id,
      orgId:    user.org_id,
      email:    user.email,
      role:     user.role,
      personId: user.person_id || null,
    });

    setCookie(res, token);
    res.json({ ok: true, user: { email: user.email, role: user.role, personId: user.person_id || null } });
  } catch (e) {
    console.error('[auth/login]', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/v1/auth/logout
router.post('/logout', (req, res) => {
  clearCookie(res);
  res.json({ ok: true });
});

// GET /api/v1/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({
    userId:   req.user.userId,
    orgId:    req.user.orgId,
    email:    req.user.email,
    role:     req.user.role,
    personId: req.user.personId || null,
  });
});

// POST /api/v1/auth/change-password
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword are required.' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });

    const user = await db.getUserByEmail(req.user.email);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

    const hash = await bcrypt.hash(newPassword, 12);
    await db.updateUserPassword(user.id, hash);
    res.json({ ok: true });
  } catch (e) {
    console.error('[auth/change-password]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
