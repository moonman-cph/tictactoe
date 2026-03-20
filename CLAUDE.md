# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

HR org chart app served by a minimal Node.js/Express server. All three HTML files are single-file apps (inline CSS + inline JS). Data is stored in `orgchart-data.json` on disk and served via `GET /POST /api/data`.

## Startup

```bash
# First time only
npm install

# Start the server (keep terminal open)
npm start

# Open in browser
http://localhost:3000/orgchart.html
```

Data is stored in `orgchart-data.json` — back it up by copying the file.

## Files

- **`server.js`** — Express server on port 3000. Serves static files + `GET /api/data` / `POST /api/data`.
- **`orgchart.html`** — Primary app. Interactive org chart with employee editing, department filtering, drag-and-drop, Add Employee modal, and salary totals. This is the source of truth for data.
- **`dashboard.html`** — Analytics dashboard. Reads data from `/api/data`.
- **`dashboard-v2.html`** — Analytics dashboard (v2, redesigned). Also reads from `/api/data`.
- **`directory.html`** — Employee directory. Reads and writes persons via `/api/data`.

## Data Model

All state is persisted to `orgchart-data.json` via the server API. The schema:

- **`departments`** `{ id, name, color, description, headRoleId }` — static list of 10 departments (executive, engineering, product, design, sales, marketing, customer-success, hr, finance, legal)
- **`teams`** `{ id, name, departmentId }` — sub-groups within departments
- **`roles`** `{ id, title, level, department, managerRoleId, teamId }` — the org hierarchy node; parent-child via `managerRoleId`; level is L1–L8
- **`persons`** `{ id, name, gender, salary, ... }` — actual people
- **`roleAssignments`** `{ roleId, personId }` — joins persons to roles (a person may hold multiple roles at fractional allocation)
- **`settings`** `{ currency, hideSalaries, viewOnly }`
- **`salaryBands`** — optional salary band config

`orgchart.html` seeds default data (120 employees, 9 departments) into these arrays at the top of its `<script>` block when the server returns an empty data file. It also auto-migrates any existing `localStorage` data to the server on first run.

## Git Workflow

After completing any major change (new feature, significant UI change, bug fix, data model update), always suggest the user commit and push with a ready-to-use commit message, e.g.:

```
git add orgchart.html && git commit -m "Your message here" && git push
```

## Key Patterns

- **Role lookup helpers** (`getPersonForRole`, `getChildRoles`, `getDescendantRoleIds`, etc.) are defined at the top of the `<script>` block and shared throughout.
- **Cycle detection** is guarded when setting `managerRoleId` to prevent infinite loops in the hierarchy tree.
- **Department color palette** is assigned via `nextAvailableColor()` / `DEPT_COLOR_PALETTE`.
- The dashboard files are **read-only views** — they load from `/api/data` but never write back. Only `orgchart.html` and `directory.html` persist changes.
- `orgchart.html` debounces saves by 300ms (collapses rapid drag-and-drop events into one POST).
- Level tiers: L1–L2 = IC entry, L3–L4 = IC mid, L5–L6 = senior/staff, L7 = director/VP, L8 = C-level.
