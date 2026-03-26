'use strict';

// ── Role subtree traversal ────────────────────────────────────────────────────

function getRoleSubtree(rootRoleIds, allRoles) {
  const subtree = new Set(rootRoleIds.map(String));
  let changed = true;
  while (changed) {
    changed = false;
    for (const role of allRoles) {
      if (!subtree.has(String(role.id)) && role.managerRoleId && subtree.has(String(role.managerRoleId))) {
        subtree.add(String(role.id));
        changed = true;
      }
    }
  }
  return subtree;
}

// ── JWT role → AI tier ────────────────────────────────────────────────────────
// Maps the five JWT roles to the three-tier context used by the AI assistant.

function roleToTier(role) {
  if (['super_admin', 'org_admin', 'hr'].includes(role)) return 'admin';
  if (role === 'manager') return 'manager';
  return 'employee';
}

// ── Role-scoped data filtering ────────────────────────────────────────────────
// Removes sensitive person fields the requesting user is not permitted to see.
// Org structure (departments, roles, assignments) is always fully visible.
//
// Rules:
//   super_admin / org_admin / hr  → full access including all salaries
//   manager                       → salary visible only for direct-report subtree
//   employee                      → own record complete; others stripped of sensitive fields

const PERSON_SENSITIVE = ['salary', 'employeeId', 'dateOfBirth', 'nationalId'];

function stripSensitive(p) {
  const out = { ...p };
  PERSON_SENSITIVE.forEach(f => delete out[f]);
  return out;
}

function scopeDataForUser(data, user) {
  const { role, personId } = user;

  if (['super_admin', 'org_admin', 'hr'].includes(role)) return data;

  if (role === 'manager' && personId) {
    const myRoleIds = (data.roleAssignments || [])
      .filter(a => String(a.personId) === String(personId))
      .map(a => String(a.roleId));
    const subtreeRoleIds = getRoleSubtree(myRoleIds, data.roles || []);
    const subtreePersonIds = new Set(
      (data.roleAssignments || [])
        .filter(a => subtreeRoleIds.has(String(a.roleId)))
        .map(a => String(a.personId))
    );
    return {
      ...data,
      persons: (data.persons || []).map(p =>
        subtreePersonIds.has(String(p.id)) ? p : stripSensitive(p)
      ),
    };
  }

  // employee (or manager without a personId link)
  return {
    ...data,
    persons: (data.persons || []).map(p =>
      String(p.id) === String(personId) ? p : stripSensitive(p)
    ),
    salaryBands: {}, // employees do not see band values
  };
}

module.exports = { getRoleSubtree, roleToTier, scopeDataForUser };
