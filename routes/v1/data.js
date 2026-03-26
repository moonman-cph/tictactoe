'use strict';

const express = require('express');
const db      = require('../../db');
const { generateUUID, diffState } = require('../../lib/changelog-diff');
const { scopeDataForUser }        = require('../../lib/data-scope');
const { requireRole }             = require('../../lib/auth');

const router = express.Router();

// ── Write roles ───────────────────────────────────────────────────────────────
// Only these roles may POST data changes.
const WRITE_ROLES = ['super_admin', 'org_admin', 'hr'];

// ── Input validation ───────────────────────────────────────────────────────────

function validateOrgData(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be a JSON object.';
  }

  const arrays = ['departments', 'teams', 'roles', 'persons', 'roleAssignments'];
  for (const key of arrays) {
    if (body[key] !== undefined && !Array.isArray(body[key])) {
      return `"${key}" must be an array.`;
    }
  }

  for (const dept of (body.departments || [])) {
    if (!dept.id || !dept.name) return 'Each department must have "id" and "name".';
  }
  for (const role of (body.roles || [])) {
    if (!role.id || !role.title) return 'Each role must have "id" and "title".';
  }
  for (const person of (body.persons || [])) {
    if (!person.id || !person.name) return 'Each person must have "id" and "name".';
    if (person.salary !== undefined && person.salary !== null && typeof person.salary !== 'number') {
      return 'Person "salary" must be a number or null.';
    }
  }
  for (const ra of (body.roleAssignments || [])) {
    if (!ra.roleId || !ra.personId) return 'Each roleAssignment must have "roleId" and "personId".';
  }
  if (body.settings !== undefined && (typeof body.settings !== 'object' || Array.isArray(body.settings))) {
    return '"settings" must be an object.';
  }

  return null; // valid
}

// ── GET /api/v1/data ──────────────────────────────────────────────────────────
// Returns org data scoped to the requesting user's role.

router.get('/', async (req, res) => {
  try {
    const data   = await db.getData(req.user.orgId);
    const scoped = scopeDataForUser(data, req.user);
    res.json(scoped);
  } catch (e) {
    res.json({});
  }
});

// ── POST /api/v1/data ─────────────────────────────────────────────────────────
// Writes full org state. Restricted to write roles.

router.post('/', requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    // 1. Validate input
    const validationError = validateOrgData(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    // 2. Read current state for diffing
    const prev = await db.getData(req.user.orgId);

    // 3. Write new state
    const next = req.body;
    await db.setData(next, req.user.orgId);

    // 4. Extract metadata from headers
    const correlationId  = generateUUID();
    const rawReason      = (req.headers['x-change-reason'] || '').trim();
    const changeReason   = rawReason.slice(0, 500) || null;
    const rawSource      = req.headers['x-source'] || '';
    const source         = ['ui', 'csv_import', 'api', 'system'].includes(rawSource) ? rawSource : 'ui';
    const bulkId         = req.headers['x-bulk-id'] || null;
    const actorIp        = req.ip || req.headers['x-forwarded-for'] || null;
    const actorUserAgent = (req.headers['user-agent'] || '').slice(0, 500) || null;

    const meta = {
      changeReason,
      source,
      bulkId,
      actorIp,
      actorUserAgent,
      actorId:    req.user.userId,
      actorEmail: req.user.email,
      actorRole:  req.user.role,
    };

    // 5. Diff and append changelog (non-fatal)
    try {
      const entries = diffState(prev, next, correlationId, meta);
      await db.appendChangelogEntries(entries);
    } catch (clErr) {
      console.error('[changelog] diff/append failed:', clErr);
    }

    res.json({ ok: true, correlationId });
  } catch (e) {
    console.error('[api/data POST]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
