#!/usr/bin/env node
// seed-demo-changelog.js
// Replaces changelog.json with 18 months of synthetic demo history.
// Usage: node scripts/seed-demo-changelog.js [--months=18]
// Supports both file mode and PostgreSQL (DATABASE_URL env var).
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db  = require('../db');
const { generateDemoHistory } = require('../lib/demo-history-generator');

async function main() {
  const monthsArg = process.argv.find(a => a.startsWith('--months='));
  const monthsBack = monthsArg ? parseInt(monthsArg.split('=')[1], 10) : 18;

  console.log(`[seed-demo] Reading current org data…`);
  const orgData = await db.getData('default');

  const personsCount = (orgData.persons || []).length;
  console.log(`[seed-demo] Found ${personsCount} persons in current data.`);
  console.log(`[seed-demo] Generating ${monthsBack}-month synthetic history…`);

  const { entries, summary } = generateDemoHistory(orgData, { monthsBack });

  console.log(`[seed-demo] Generated ${entries.length} changelog entries.`);
  console.log(`[seed-demo] Summary:`);
  console.log(`  Persons seeded:            ${summary.personsSeeded}`);
  console.log(`  Ghost employees added:     ${summary.ghostEmployeesAdded} (${summary.hardDeleteTerminations} hard-delete, ${summary.softTerminations} noLongerHired)`);
  console.log(`  Salary update events:      ${summary.salaryUpdateEvents} (${summary.payReviewRounds} review rounds)`);
  console.log(`  Date range:                ${summary.dateRange.from} → ${summary.dateRange.to}`);

  const isPostgres = !!process.env.DATABASE_URL;
  if (isPostgres) {
    console.log(`[seed-demo] PostgreSQL mode: deleting existing audit_log rows and inserting ${entries.length} new entries…`);
  } else {
    console.log(`[seed-demo] File mode: backing up changelog.json → changelog.backup.json and writing ${entries.length} entries…`);
  }

  await db.replaceChangelog(entries, 'default');

  if (!isPostgres) {
    console.log(`[seed-demo] Backup saved. Open reports.html and run the trend reports to test.`);
  }
  console.log(`[seed-demo] Done.`);
}

main().catch(err => {
  console.error('[seed-demo] Error:', err.message);
  process.exit(1);
});
