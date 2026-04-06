'use strict';

const crypto = require('crypto');

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

// Mulberry32 — simple seeded PRNG for reproducible results
function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// Add realistic intra-day time variation to a date
function withWorkHour(date, rng) {
  const d = new Date(date);
  d.setUTCHours(randInt(rng, 8, 17), randInt(rng, 0, 59), randInt(rng, 0, 59), 0);
  return d;
}

/**
 * Generate synthetic 18-month changelog history suitable for testing the reports page.
 *
 * What gets generated:
 *   - Person CREATE events for all current employees, distributed over the time window
 *   - Salary UPDATE events for ~40% of staff twice a year (June & December)
 *   - 8 "ghost" employees who joined and left — 4 via hard DELETE (visible to hc-trend
 *     after fix), 4 via noLongerHired UPDATE (visible ONLY after the hc-trend bug fix)
 *     This allows you to compare trend vs snapshot headcount and verify the fix.
 *
 * @param {Object} orgData   Full org data from db.getData()
 * @param {Object} [opts]
 * @param {number} [opts.monthsBack=18]  How many months of history to simulate
 * @param {number} [opts.seed=42]        RNG seed for reproducibility
 * @returns {{ entries: Array, summary: Object }}
 */
function generateDemoHistory(orgData, { monthsBack = 18, seed = 42 } = {}) {
  const rng = seededRng(seed);
  const entries = [];

  const now     = new Date();
  const winStart = new Date(now);
  winStart.setMonth(winStart.getMonth() - monthsBack);
  winStart.setHours(0, 0, 0, 0);

  const persons = orgData.persons || [];

  // ── 1. Assign each current employee a "system-entry date" ──────────────────
  //   Use their hireDate if it falls inside the window; otherwise assign to the
  //   first 12 months of the window (weighted toward the earlier half).

  const enriched = persons.map(p => {
    let entryDate;
    if (p.hireDate) {
      const hd = new Date(p.hireDate);
      if (hd >= winStart && hd <= now) entryDate = hd;
    }
    if (!entryDate) {
      // Veteran: random date in first 12 months, skewed early (sqrt distribution)
      const early = new Date(winStart);
      early.setMonth(early.getMonth() + 12);
      const span = early - winStart;
      const r = rng();
      entryDate = new Date(winStart.getTime() + r * r * span); // r² → skewed early
    }
    return { ...p, _entryDate: entryDate };
  });

  enriched.sort((a, b) => a._entryDate - b._entryDate);

  // ── 2. Ghost employees (fictional, not in current data) ────────────────────
  //   IDs use negative strings to avoid any collision with real person IDs.
  //   First 4 are terminated via hard DELETE  → hc-trend correctly shows -1 delta
  //   Last 4 are terminated via noLongerHired → hc-trend only reflects after bug fix

  const GHOSTS = [
    { id: 'ghost-1', name: 'Elena Vasquez',     gender: 'female', salary: 72000 },
    { id: 'ghost-2', name: 'Tom Whitfield',      gender: 'male',   salary: 85000 },
    { id: 'ghost-3', name: 'Priya Nair',          gender: 'female', salary: 91000 },
    { id: 'ghost-4', name: 'Marcus Johansson',   gender: 'male',   salary: 68000 },
    { id: 'ghost-5', name: 'Sophie Chen',         gender: 'female', salary: 79000 },
    { id: 'ghost-6', name: 'Ibrahim Al-Rashid',  gender: 'male',   salary: 95000 },
    { id: 'ghost-7', name: 'Natalie Brooks',      gender: 'female', salary: 88000 },
    { id: 'ghost-8', name: 'Kenji Tanaka',        gender: 'male',   salary: 74000 },
  ];

  const ghosts = GHOSTS.map((g, i) => {
    const hireMonthsAgo = randInt(rng, 5, monthsBack - 2);
    const hireDate = new Date(now);
    hireDate.setMonth(hireDate.getMonth() - hireMonthsAgo);
    hireDate.setDate(randInt(rng, 1, 28));

    const stayMonths = randInt(rng, 2, Math.min(hireMonthsAgo - 1, 8));
    const termDate   = new Date(hireDate);
    termDate.setMonth(termDate.getMonth() + stayMonths);

    return { ...g, orgId: 'default', _hireDate: hireDate, _termDate: termDate, _hardDelete: i < 4 };
  });

  // ── 3. Pre-compute salary history (roll back from current salaries) ────────
  //   Process review rounds newest-first so we can correctly derive oldValue
  //   by working backwards.

  const payReviewDates = [];
  for (let yr = winStart.getFullYear(); yr <= now.getFullYear(); yr++) {
    [
      new Date(`${yr}-06-15T10:00:00.000Z`),
      new Date(`${yr}-12-15T10:00:00.000Z`),
    ].forEach(d => { if (d > winStart && d < now) payReviewDates.push(d); });
  }
  payReviewDates.sort((a, b) => a - b); // ascending

  // Track "salary at time T" — start from current, roll back
  const trackSal = {};
  persons.forEach(p => { trackSal[String(p.id)] = p.salary || 0; });

  // salaryEvents[personId] = [ {date, oldSal, newSal}, ... ] — forward order
  const salaryEvents = {}; // built in reverse then reversed

  // Iterate review rounds from NEWEST to OLDEST
  [...payReviewDates].reverse().forEach(reviewDate => {
    const employed = enriched.filter(p => p._entryDate <= reviewDate);
    employed.forEach(p => {
      if (rng() > 0.40) return; // skip ~60%
      const pId = String(p.id);
      const curSal = trackSal[pId];
      if (!curSal) return;
      const pct = 0.08 + rng() * 0.07; // 8–15% raise
      const priorSal = Math.round(curSal / (1 + pct) / 500) * 500; // round to nearest 500
      if (!salaryEvents[pId]) salaryEvents[pId] = [];
      salaryEvents[pId].push({ date: reviewDate, oldSal: priorSal, newSal: curSal });
      trackSal[pId] = priorSal; // rewind for earlier rounds
    });
  });
  // Reverse so each person's events are in chronological order
  Object.values(salaryEvents).forEach(arr => arr.reverse());

  // ── 4. Emit person CREATE events ───────────────────────────────────────────
  //   Group by day to form realistic "save batches" with a shared correlationId.

  const byDay = {};
  enriched.forEach(p => {
    const key = p._entryDate.toISOString().slice(0, 10);
    (byDay[key] = byDay[key] || []).push({ ...p, _isGhost: false });
  });
  ghosts.forEach(g => {
    const key = g._hireDate.toISOString().slice(0, 10);
    (byDay[key] = byDay[key] || []).push({ ...g, _isGhost: true });
  });

  Object.keys(byDay).sort().forEach(dateKey => {
    const batch      = byDay[dateKey];
    const batchTs    = withWorkHour(new Date(dateKey + 'T09:00:00Z'), rng);
    const corrId     = uuid();
    const isBulk     = batch.length > 10;
    const bulkId     = isBulk ? uuid() : null;
    let personsCreated = 0;

    batch.forEach(p => {
      const ts = new Date(batchTs.getTime() + rng() * 120000).toISOString(); // ±2 min spread

      // Strip internal planning fields from the stored object
      const obj = Object.fromEntries(
        Object.entries(p).filter(([k]) => !k.startsWith('_'))
      );

      entries.push({
        id: uuid(), orgId: 'default', correlationId: corrId,
        timestamp: ts,
        actorId: null, actorEmail: null, actorRole: null, actorIp: null, actorUserAgent: null,
        operation: 'CREATE', entityType: 'person',
        entityId: String(p.id), entityLabel: p.name,
        field: null, oldValue: null, newValue: obj,
        changeReason: null, source: 'system', bulkId, isSensitive: false,
      });
      personsCreated++;
    });

    if (isBulk) {
      entries.push({
        id: uuid(), orgId: 'default', correlationId: corrId,
        timestamp: batchTs.toISOString(),
        actorId: null, actorEmail: null, actorRole: null, actorIp: null, actorUserAgent: null,
        operation: 'BULK_SUMMARY', entityType: null,
        entityId: null, entityLabel: null,
        field: null, oldValue: null,
        newValue: { personsCreated, personsUpdated: 0, rolesCreated: 0, totalEntries: personsCreated },
        changeReason: null, source: 'system', bulkId, isSensitive: false,
      });
    }
  });

  // ── 5. Emit salary UPDATE events ───────────────────────────────────────────

  payReviewDates.forEach(reviewDate => {
    const corrId = uuid();
    persons.forEach(p => {
      const pId = String(p.id);
      const evt  = (salaryEvents[pId] || []).find(e => e.date.getTime() === reviewDate.getTime());
      if (!evt) return;
      const ts = new Date(reviewDate.getTime() + rng() * 7200000).toISOString(); // spread over 2h
      entries.push({
        id: uuid(), orgId: 'default', correlationId: corrId,
        timestamp: ts,
        actorId: null, actorEmail: null, actorRole: null, actorIp: null, actorUserAgent: null,
        operation: 'UPDATE', entityType: 'person',
        entityId: pId, entityLabel: p.name,
        field: 'salary', oldValue: evt.oldSal, newValue: evt.newSal,
        changeReason: 'Annual pay review', source: 'system', bulkId: null, isSensitive: true,
      });
    });
  });

  // ── 6. Emit ghost termination events ───────────────────────────────────────

  // Assign ghost employees to random departments for attrition report attribution
  const deptIds = (orgData.departments || []).map(d => d.id);

  ghosts.forEach(g => {
    const ts     = withWorkHour(g._termDate, rng).toISOString();
    const corrId = uuid();
    const ghostDeptId = deptIds.length ? deptIds[randInt(rng, 0, deptIds.length - 1)] : null;

    if (g._hardDelete) {
      // Hard DELETE → hc-trend counts this as −1 (both before and after the bug fix)
      entries.push({
        id: uuid(), orgId: 'default', correlationId: corrId,
        timestamp: ts,
        actorId: null, actorEmail: null, actorRole: null, actorIp: null, actorUserAgent: null,
        operation: 'DELETE', entityType: 'person',
        entityId: g.id, entityLabel: g.name,
        field: null, oldValue: { id: g.id, name: g.name, salary: g.salary, gender: g.gender, orgId: 'default', departmentId: ghostDeptId }, newValue: null,
        changeReason: 'Employee offboarded', source: 'system', bulkId: null, isSensitive: false,
      });
    } else {
      // noLongerHired UPDATE → ONLY counted as −1 after the hc-trend bug fix
      entries.push({
        id: uuid(), orgId: 'default', correlationId: corrId,
        timestamp: ts,
        actorId: null, actorEmail: null, actorRole: null, actorIp: null, actorUserAgent: null,
        operation: 'UPDATE', entityType: 'person',
        entityId: g.id, entityLabel: g.name,
        field: 'noLongerHired', oldValue: null, newValue: true,
        changeReason: 'Employee offboarded', source: 'system', bulkId: null, isSensitive: false,
      });
    }
  });

  // ── 7. Sort all entries chronologically ────────────────────────────────────

  entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const summary = {
    monthsBack,
    totalEntries:            entries.length,
    personsSeeded:           persons.length,
    ghostEmployeesAdded:     ghosts.length,
    hardDeleteTerminations:  ghosts.filter(g => g._hardDelete).length,
    softTerminations:        ghosts.filter(g => !g._hardDelete).length,
    salaryUpdateEvents:      entries.filter(e => e.field === 'salary').length,
    payReviewRounds:         payReviewDates.length,
    dateRange: {
      from: winStart.toISOString().slice(0, 10),
      to:   now.toISOString().slice(0, 10),
    },
  };

  return { entries, summary };
}

module.exports = { generateDemoHistory };
