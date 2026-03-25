/**
 * notifications.js — Shared notification bell for all Teampura pages.
 * Auto-injects a bell icon into #app-header. Computes live notifications
 * from /api/data. Read state persisted in localStorage.
 */
(function () {
  'use strict';

  // ── Static Release Notes ──────────────────────────────────────────────────
  const RELEASE_NOTES = [
    {
      id: 'release-v1.5-permissions',
      date: 'Mar 2026',
      title: 'Permissions & Groups (v1.5)',
      body: 'Permission groups, assignment policies, and role-based access control are now live.',
    },
    {
      id: 'release-v1.4-assignment-preview',
      date: 'Feb 2026',
      title: 'Assignment Preview (v1.4)',
      body: 'Preview assignments before applying, with policy override support and conflict detection.',
    },
    {
      id: 'release-v1.3-changelog',
      date: 'Jan 2026',
      title: 'Changelog & Audit Log (v1.3)',
      body: 'Full audit trail of every data change with field-level detail, filters, and bulk-op grouping.',
    },
    {
      id: 'release-v1.2-paybands',
      date: 'Dec 2025',
      title: 'Pay Bands & Salary Analysis (v1.2)',
      body: 'Configure salary bands by level, add location multipliers, and spot out-of-band employees.',
    },
  ];

  // ── Constants ─────────────────────────────────────────────────────────────
  const LS_KEY = 'notif_dismissed_ids';
  const SPAN_THRESHOLD = 8;          // max direct reports before warning
  const BIRTHDAY_WINDOW_DAYS = 14;   // days ahead to show birthdays
  const NEW_HIRE_DAYS = 30;          // days since hire to show "new hire"

  // ── State ─────────────────────────────────────────────────────────────────
  let _panelOpen = false;
  let _notifications = [];
  let _dismissed = new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]'));

  function saveDismissed() {
    localStorage.setItem(LS_KEY, JSON.stringify([..._dismissed]));
  }
  function isRead(id) { return _dismissed.has(id); }

  // ── Date helpers ──────────────────────────────────────────────────────────
  function daysUntilBirthday(dateOfBirth) {
    if (!dateOfBirth) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const parts = dateOfBirth.split('-').map(Number);
    const m = parts[1], dd = parts[2];
    let next = new Date(today.getFullYear(), m - 1, dd);
    if (next < today) next = new Date(today.getFullYear() + 1, m - 1, dd);
    return Math.ceil((next - today) / 86400000);
  }

  function anniversaryYearsThisMonth(hireDate) {
    if (!hireDate) return null;
    const today = new Date();
    const parts = hireDate.split('-').map(Number);
    const hy = parts[0], hm = parts[1];
    if (hm !== today.getMonth() + 1) return null;
    const years = today.getFullYear() - hy;
    return years >= 1 ? years : null;
  }

  function daysSinceHire(hireDate) {
    if (!hireDate) return null;
    const hired = new Date(hireDate + 'T00:00:00');
    const days = Math.floor((new Date() - hired) / 86400000);
    return days;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) { return iso; }
  }

  function fmtBirthday(dateOfBirth) {
    if (!dateOfBirth) return '';
    try {
      const parts = dateOfBirth.split('-').map(Number);
      return new Date(2000, parts[1] - 1, parts[2]).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    } catch (_) { return ''; }
  }

  // ── Notification computation ──────────────────────────────────────────────
  function computeNotifications(data) {
    const notifs = [];
    const {
      persons = [],
      roles = [],
      departments = [],
      roleAssignments = [],
    } = data;

    const assignedRoleIds    = new Set(roleAssignments.map(a => String(a.roleId)));
    const assignedPersonIds  = new Set(roleAssignments.map(a => String(a.personId)));

    // ── Data Alerts ───────────────────────────────────────────────
    const salaryReview = persons.filter(p => p.salaryReviewNeeded);
    if (salaryReview.length) {
      const names = salaryReview.slice(0, 3).map(p => p.name).join(', ');
      notifs.push({
        id: `alert-salary-review-${salaryReview.length}`,
        category: 'alerts',
        icon: 'salary',
        title: `${salaryReview.length} ${salaryReview.length === 1 ? 'person needs' : 'people need'} salary review`,
        body: names + (salaryReview.length > 3 ? ` +${salaryReview.length - 3} more` : ''),
      });
    }

    const perfReview = persons.filter(p => p.performanceReviewNeeded);
    if (perfReview.length) {
      const names = perfReview.slice(0, 3).map(p => p.name).join(', ');
      notifs.push({
        id: `alert-perf-review-${perfReview.length}`,
        category: 'alerts',
        icon: 'perf',
        title: `${perfReview.length} ${perfReview.length === 1 ? 'person needs' : 'people need'} performance review`,
        body: names + (perfReview.length > 3 ? ` +${perfReview.length - 3} more` : ''),
      });
    }

    const vacantRoles = roles.filter(r => !assignedRoleIds.has(String(r.id)));
    if (vacantRoles.length) {
      const titles = vacantRoles.slice(0, 3).map(r => r.title).join(', ');
      notifs.push({
        id: `alert-vacant-${vacantRoles.length}`,
        category: 'alerts',
        icon: 'vacant',
        title: `${vacantRoles.length} vacant ${vacantRoles.length === 1 ? 'role' : 'roles'}`,
        body: titles + (vacantRoles.length > 3 ? ` +${vacantRoles.length - 3} more` : ''),
      });
    }

    const unassigned = persons.filter(p => !assignedPersonIds.has(String(p.id)));
    if (unassigned.length) {
      const names = unassigned.slice(0, 3).map(p => p.name).join(', ');
      notifs.push({
        id: `alert-unassigned-${unassigned.length}`,
        category: 'alerts',
        icon: 'person',
        title: `${unassigned.length} ${unassigned.length === 1 ? 'employee has' : 'employees have'} no role`,
        body: names + (unassigned.length > 3 ? ` +${unassigned.length - 3} more` : ''),
      });
    }

    // ── Org Health ────────────────────────────────────────────────
    const reportCount = {};
    roles.forEach(r => {
      if (r.managerRoleId != null) {
        reportCount[r.managerRoleId] = (reportCount[r.managerRoleId] || 0) + 1;
      }
    });
    Object.entries(reportCount).forEach(([mgrid, count]) => {
      if (count > SPAN_THRESHOLD) {
        const mgr = roles.find(r => String(r.id) === String(mgrid));
        const mgrTitle = mgr ? mgr.title : `Role #${mgrid}`;
        notifs.push({
          id: `health-span-${mgrid}-${count}`,
          category: 'health',
          icon: 'span',
          title: `${mgrTitle} has ${count} direct reports`,
          body: `Recommended max is ${SPAN_THRESHOLD}. Consider restructuring.`,
        });
      }
    });

    departments.forEach(dept => {
      if (!dept.headRoleId) {
        notifs.push({
          id: `health-no-head-${dept.id}`,
          category: 'health',
          icon: 'dept',
          title: `${dept.name} has no department head`,
          body: 'Assign a head role in the org chart.',
        });
      }
    });

    // ── People Milestones ─────────────────────────────────────────
    persons.forEach(p => {
      // Birthdays in the next N days
      const daysUntil = daysUntilBirthday(p.dateOfBirth);
      if (daysUntil !== null && daysUntil <= BIRTHDAY_WINDOW_DAYS) {
        const year = new Date().getFullYear();
        notifs.push({
          id: `milestone-bday-${p.id}-${year}`,
          category: 'milestones',
          icon: 'birthday',
          title: daysUntil === 0
            ? `${p.name}'s birthday is today!`
            : `${p.name}'s birthday in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`,
          body: fmtBirthday(p.dateOfBirth),
        });
      }

      // Work anniversaries this calendar month
      const years = anniversaryYearsThisMonth(p.hireDate);
      if (years !== null) {
        notifs.push({
          id: `milestone-anniv-${p.id}-${years}`,
          category: 'milestones',
          icon: 'anniversary',
          title: `${p.name} — ${years}-year work anniversary`,
          body: `Joined ${fmtDate(p.hireDate)}`,
        });
      }

      // New hires in the last 30 days
      const sinceHire = daysSinceHire(p.hireDate);
      if (sinceHire !== null && sinceHire >= 0 && sinceHire <= NEW_HIRE_DAYS) {
        // Skip if we also flagged an anniversary (hire was years ago on this month)
        if (years === null) {
          notifs.push({
            id: `milestone-newhire-${p.id}`,
            category: 'milestones',
            icon: 'newhire',
            title: `New hire: ${p.name}`,
            body: sinceHire === 0 ? 'Starts today' : `Joined ${fmtDate(p.hireDate)}`,
          });
        }
      }
    });

    // ── Release Notes (static) ────────────────────────────────────
    RELEASE_NOTES.forEach(r => {
      notifs.push({ ...r, category: 'releases', icon: 'release' });
    });

    return notifs;
  }

  // ── SVG icons ─────────────────────────────────────────────────────────────
  const ICONS = {
    salary: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><path d="M8 4.5v7M6 6a2 2 0 012-1.5 2 2 0 012 1.5c0 .8-.5 1.3-2 1.5-1.5.2-2 .8-2 1.5a2 2 0 002 1.5 2 2 0 002-1.5"/></svg>`,
    perf:   `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,12 5.5,8 8.5,10.5 12,5.5 14,7.5"/><polyline points="11,5.5 14,5.5 14,8.5"/></svg>`,
    vacant: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="12" height="12" rx="2.5"/><line x1="5" y1="8" x2="11" y2="8"/></svg>`,
    person: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="5" r="3"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg>`,
    span:   `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="3.5" r="2"/><circle cx="3" cy="12.5" r="2"/><circle cx="8" cy="12.5" r="2"/><circle cx="13" cy="12.5" r="2"/><line x1="8" y1="5.5" x2="8" y2="8"/><line x1="3" y1="8" x2="13" y2="8"/><line x1="3" y1="8" x2="3" y2="10.5"/><line x1="8" y1="8" x2="8" y2="10.5"/><line x1="13" y1="8" x2="13" y2="10.5"/></svg>`,
    dept:   `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="1.5" width="5" height="4" rx="1"/><rect x="1" y="10.5" width="5" height="4" rx="1"/><rect x="10" y="10.5" width="5" height="4" rx="1"/><line x1="8" y1="5.5" x2="8" y2="8"/><line x1="3.5" y1="8" x2="12.5" y2="8"/><line x1="3.5" y1="8" x2="3.5" y2="10.5"/><line x1="12.5" y1="8" x2="12.5" y2="10.5"/></svg>`,
    birthday:   `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="7" width="13" height="7.5" rx="1.5"/><line x1="4.5" y1="7" x2="4.5" y2="10"/><line x1="8" y1="7" x2="8" y2="10"/><line x1="11.5" y1="7" x2="11.5" y2="10"/><path d="M4.5 7C4.5 5.5 3 4 4.5 3s2 2 1.5 2.5"/><path d="M8 7C8 5.5 6.5 4 8 3s2 2 1.5 2.5"/><path d="M11.5 7C11.5 5.5 10 4 11.5 3s2 2 1.5 2.5"/></svg>`,
    anniversary:`<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polygon points="8,1.5 9.9,6 14.5,6.5 11,9.5 12.2,14 8,11.5 3.8,14 5,9.5 1.5,6.5 6.1,6"/></svg>`,
    newhire:    `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="5" r="3"/><path d="M1.5 14c0-3 2.5-5.5 5.5-5.5"/><line x1="11.5" y1="9" x2="11.5" y2="14"/><line x1="9" y1="11.5" x2="14" y2="11.5"/></svg>`,
    release:    `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5l2 4h4l-3.5 3 1.5 4.5L8 10.5 4 13l1.5-4.5L2 5.5h4z"/></svg>`,
  };

  // ── Category config ───────────────────────────────────────────────────────
  const CATEGORIES = [
    { key: 'alerts',     label: 'Data Alerts',        color: '#92400e', bg: '#fef3c7' },
    { key: 'milestones', label: 'People Milestones',  color: '#5b21b6', bg: '#ede9fe' },
    { key: 'health',     label: 'Org Health',         color: '#0e7490', bg: '#cffafe' },
    { key: 'releases',   label: "What's New",         color: '#166534', bg: '#dcfce7' },
  ];

  // ── CSS injection ─────────────────────────────────────────────────────────
  function injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      #notif-bell-btn {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: none;
        background: transparent;
        cursor: pointer;
        border-radius: 8px;
        color: #6b7280;
        transition: background 0.12s, color 0.12s;
        flex-shrink: 0;
        padding: 0;
        margin-left: auto;
      }
      #notif-bell-btn:hover { background: rgba(0,0,0,0.06); color: #111827; }
      #notif-bell-btn.active { background: rgba(0,0,0,0.08); color: #111827; }
      #notif-badge {
        position: absolute;
        top: 3px;
        right: 3px;
        min-width: 16px;
        height: 16px;
        padding: 0 3.5px;
        background: #ef4444;
        color: #fff;
        font-size: 9.5px;
        font-weight: 700;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        pointer-events: none;
        box-sizing: border-box;
        font-family: inherit;
      }
      #notif-panel {
        position: fixed;
        width: 360px;
        max-height: 520px;
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        box-shadow: 0 10px 36px rgba(0,0,0,0.13), 0 2px 8px rgba(0,0,0,0.07);
        z-index: 9998;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: notifFadeIn 0.14s ease;
        font-family: inherit;
      }
      @keyframes notifFadeIn {
        from { opacity: 0; transform: translateY(-5px) scale(0.985); }
        to   { opacity: 1; transform: none; }
      }
      #notif-panel-hd {
        display: flex;
        align-items: center;
        padding: 13px 15px 11px;
        border-bottom: 1px solid #f0f0f0;
        flex-shrink: 0;
        gap: 8px;
      }
      #notif-panel-hd h3 {
        margin: 0;
        font-size: 13.5px;
        font-weight: 600;
        color: #111827;
        flex: 1;
        font-family: inherit;
      }
      #notif-unread-count {
        font-size: 11px;
        font-weight: 600;
        color: #fff;
        background: #ef4444;
        border-radius: 10px;
        padding: 1px 7px;
        font-family: inherit;
      }
      #notif-mark-all {
        font-size: 11px;
        color: #6b7280;
        background: none;
        border: 1px solid #e5e7eb;
        cursor: pointer;
        padding: 3px 8px;
        border-radius: 5px;
        font-family: inherit;
        white-space: nowrap;
        transition: background 0.1s, color 0.1s;
      }
      #notif-mark-all:hover { background: #f3f4f6; color: #374151; border-color: #d1d5db; }
      #notif-body {
        overflow-y: auto;
        flex: 1;
        padding: 6px 0 8px;
      }
      #notif-body::-webkit-scrollbar { width: 5px; }
      #notif-body::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 3px; }
      .nc-label {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.065em;
        text-transform: uppercase;
        padding: 10px 15px 3px;
        color: #9ca3af;
        font-family: inherit;
      }
      .nc-label:not(:first-child) { border-top: 1px solid #f3f4f6; margin-top: 4px; padding-top: 12px; }
      .notif-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 7px 15px;
        transition: background 0.1s;
        position: relative;
      }
      .notif-row:hover { background: #f9fafb; }
      .notif-row.unread { background: #f8faff; }
      .notif-row.unread:hover { background: #f1f5ff; }
      .notif-ico {
        width: 28px;
        height: 28px;
        border-radius: 7px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        margin-top: 1px;
      }
      .notif-txt { flex: 1; min-width: 0; }
      .notif-title {
        font-size: 12.5px;
        font-weight: 500;
        color: #111827;
        line-height: 1.35;
        margin-bottom: 2px;
        font-family: inherit;
      }
      .notif-sub {
        font-size: 11.5px;
        color: #6b7280;
        line-height: 1.4;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-family: inherit;
      }
      .notif-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #3b82f6;
        flex-shrink: 0;
        margin-top: 6px;
      }
      .notif-empty {
        padding: 44px 20px;
        text-align: center;
        color: #9ca3af;
        font-size: 13px;
        font-family: inherit;
      }
      .notif-empty svg { display: block; margin: 0 auto 10px; opacity: 0.3; }
      #notif-overlay {
        position: fixed;
        inset: 0;
        z-index: 9997;
      }
    `;
    document.head.appendChild(s);
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function unreadCount() {
    return _notifications.filter(n => !isRead(n.id)).length;
  }

  function buildPanelHTML() {
    const uc = unreadCount();
    const hasAny = _notifications.length > 0;

    let h = `<div id="notif-panel-hd"><h3>Notifications</h3>`;
    if (uc > 0) {
      h += `<span id="notif-unread-count">${uc}</span>`;
      h += `<button id="notif-mark-all">Mark all read</button>`;
    }
    h += `</div><div id="notif-body">`;

    if (!hasAny) {
      h += `<div class="notif-empty">
        <svg width="32" height="32" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
          <path d="M8 1.5a4.5 4.5 0 014.5 4.5c0 2.5.5 4 1.5 5H2c1-1 1.5-2.5 1.5-5A4.5 4.5 0 018 1.5z"/>
          <line x1="6.5" y1="14" x2="9.5" y2="14"/>
        </svg>
        You're all caught up
      </div>`;
    } else {
      CATEGORIES.forEach(cat => {
        const items = _notifications.filter(n => n.category === cat.key);
        if (!items.length) return;
        h += `<div class="nc-label">${cat.label}</div>`;
        items.forEach(n => {
          const read = isRead(n.id);
          h += `<div class="notif-row${read ? '' : ' unread'}">
            <div class="notif-ico" style="background:${cat.bg};color:${cat.color}">${ICONS[n.icon] || ICONS.vacant}</div>
            <div class="notif-txt">
              <div class="notif-title">${n.title}</div>
              ${n.body ? `<div class="notif-sub">${n.body}</div>` : ''}
            </div>
            ${read ? '' : '<div class="notif-dot"></div>'}
          </div>`;
        });
      });
    }

    h += `</div>`;
    return h;
  }

  // ── Panel open / close ────────────────────────────────────────────────────
  function openPanel() {
    if (document.getElementById('notif-panel')) return;
    _panelOpen = true;

    const btn = document.getElementById('notif-bell-btn');
    if (btn) btn.classList.add('active');

    // Position panel below the bell button
    const overlay = document.createElement('div');
    overlay.id = 'notif-overlay';
    overlay.addEventListener('click', closePanel);
    document.body.appendChild(overlay);

    const panel = document.createElement('div');
    panel.id = 'notif-panel';
    panel.innerHTML = buildPanelHTML();
    document.body.appendChild(panel);

    // Position dynamically relative to button
    if (btn) {
      const r = btn.getBoundingClientRect();
      panel.style.top  = (r.bottom + 8) + 'px';
      panel.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    } else {
      panel.style.top   = '57px';
      panel.style.right = '12px';
    }

    // Mark all read
    panel.addEventListener('click', e => {
      if (e.target.id === 'notif-mark-all' || e.target.closest('#notif-mark-all')) {
        e.stopPropagation();
        _notifications.forEach(n => _dismissed.add(n.id));
        saveDismissed();
        panel.innerHTML = buildPanelHTML();
        updateBadge();
        // Rebind after re-render (mark all button gone now)
      }
    });
  }

  function closePanel() {
    const panel = document.getElementById('notif-panel');
    if (panel) panel.remove();
    const overlay = document.getElementById('notif-overlay');
    if (overlay) overlay.remove();
    const btn = document.getElementById('notif-bell-btn');
    if (btn) btn.classList.remove('active');
    _panelOpen = false;
  }

  // ── Badge update ──────────────────────────────────────────────────────────
  function updateBadge() {
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    const count = unreadCount();
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // ── Bell injection ────────────────────────────────────────────────────────
  function injectBell() {
    const header = document.getElementById('app-header');
    if (!header) return;

    // Remove any pre-existing manual notification icon (e.g. dashboard.html)
    const existingIconBtn = header.querySelector('.header-icon-btn');
    if (existingIconBtn) existingIconBtn.remove();

    const btn = document.createElement('button');
    btn.id = 'notif-bell-btn';
    btn.title = 'Notifications';
    btn.setAttribute('aria-label', 'Notifications');
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 1.5a4.5 4.5 0 014.5 4.5c0 2.5.5 4 1.5 5H2c1-1 1.5-2.5 1.5-5A4.5 4.5 0 018 1.5z"/>
      <line x1="6.5" y1="14" x2="9.5" y2="14"/>
    </svg><span id="notif-badge" style="display:none">0</span>`;

    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (_panelOpen) closePanel();
      else openPanel();
    });

    // Insert before the avatar if present, otherwise append
    const avatar = header.querySelector('.header-avatar');
    if (avatar) {
      header.insertBefore(btn, avatar);
    } else {
      header.appendChild(btn);
    }
  }

  // ── Data load ─────────────────────────────────────────────────────────────
  async function fetchAndCompute() {
    try {
      const res = await fetch('/api/data');
      if (!res.ok) return;
      const data = await res.json();
      _notifications = computeNotifications(data);
      updateBadge();
      // Refresh panel if open
      const panel = document.getElementById('notif-panel');
      if (panel) panel.innerHTML = buildPanelHTML();
    } catch (_) { /* silently ignore on pages without server */ }
  }

  // Pages that already load /api/data can hand it off here to avoid a second fetch
  window.notificationsSetData = function (data) {
    _notifications = computeNotifications(data);
    updateBadge();
    const panel = document.getElementById('notif-panel');
    if (panel) panel.innerHTML = buildPanelHTML();
  };

  // ── Boot ──────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    injectBell();
    fetchAndCompute();
  });

})();
