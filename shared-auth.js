/**
 * shared-auth.js — Client-side authentication for all Teampura pages.
 *
 * Include as the FIRST <script> on every page that requires login.
 * - Installs a global fetch interceptor that redirects to / on any 401 response.
 * - Checks auth on load and sets window.__currentUser.
 * - Dispatches 'auth:ready' custom event once user is confirmed.
 * - Does nothing on the login page itself (/).
 */
(function () {
  'use strict';

  window.__currentUser = null;

  // ── Skip on the login page ─────────────────────────────────────────────────
  const isLoginPage = ['/', '/index.html', '/index.html#'].includes(location.pathname) ||
                      location.pathname === '';
  if (isLoginPage) return;

  // ── Global fetch interceptor — redirect to login on 401 ───────────────────
  const _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    return _fetch(input, init).then(function (res) {
      if (res.status === 401) {
        location.replace('/');
        // Return a promise that never resolves so downstream handlers don't run
        return new Promise(function () {});
      }
      return res;
    });
  };

  // ── Initial auth check ─────────────────────────────────────────────────────
  _fetch('/api/v1/auth/me', { credentials: 'same-origin' })
    .then(function (res) {
      if (res.status === 401 || res.status === 403) {
        location.replace('/');
        return null;
      }
      return res.json();
    })
    .then(function (user) {
      if (!user) return;
      window.__currentUser = user;
      document.dispatchEvent(new CustomEvent('auth:ready', { detail: user }));
    })
    .catch(function () {
      location.replace('/');
    });
})();
