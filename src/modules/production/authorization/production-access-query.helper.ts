import { Brackets, SelectQueryBuilder, ObjectLiteral } from 'typeorm';
import {
  ResolvedProductionAccessPolicy,
  ProductionResponsibility,
} from './production-access-policy.types.js';
import { AuthPrincipal } from '../../system/auth/auth.types.js';

/**
 * Pure evaluation helper: checks if the policy grants access to a specific department ID.
 */
export function canAccessDepartment(
  policy: ResolvedProductionAccessPolicy,
  departmentId: string
): boolean {
  if (policy.denyAll) {
    return false;
  }
  if (policy.denyDepartmentIds.includes(departmentId)) {
    return false;
  }
  if (policy.allowAll) {
    return true;
  }
  return policy.allowDepartmentIds.includes(departmentId);
}

/**
 * Pure evaluation helper: checks if the policy grants access to a specific yard.
 */
export function canAccessYard(
  policy: ResolvedProductionAccessPolicy,
  yard: { id: string; departmentId: string }
): boolean {
  if (policy.denyAll) {
    return false;
  }
  if (policy.denyDepartmentIds.includes(yard.departmentId)) {
    return false;
  }
  if (policy.denyYardIds.includes(yard.id)) {
    return false;
  }
  if (policy.allowAll) {
    return true;
  }
  if (policy.allowDepartmentIds.includes(yard.departmentId)) {
    return true;
  }
  if (policy.allowYardIds.includes(yard.id)) {
    return true;
  }
  return false;
}

/**
 * Pure evaluation helper: checks if the policy grants access to a specific unit.
 *
 * Invariants & Business Rules:
 * 1. Default Deny / Global Deny: if policy.denyAll or !policy.hasAnyAccess -> false.
 * 2. If unit is assigned to a yard (unit.currentYardId):
 *    - Must have currentYard loaded with a valid departmentId. If missing -> fail closed (false).
 *    - Delegates to canAccessYard(policy, { id: unit.currentYardId, departmentId: unit.currentYard.departmentId }).
 * 3. If unit is unassigned (unit.currentYardId is null):
 *    - Accessible ONLY if policy.allowAll is true (and not denied by global rules).
 *    - Engineers and scoped users with specific yard/department permissions CANNOT access unassigned units.
 */
export function canAccessUnit(
  policy: ResolvedProductionAccessPolicy,
  unit: {
    currentYardId: string | null;
    currentYard?: { id: string; departmentId: string } | null;
  }
): boolean {
  if (policy.denyAll || !policy.hasAnyAccess) {
    return false;
  }

  if (unit.currentYardId) {
    if (!unit.currentYard || !unit.currentYard.departmentId) {
      // Fail closed if yard relation or departmentId is missing
      return false;
    }
    return canAccessYard(policy, {
      id: unit.currentYardId,
      departmentId: unit.currentYard.departmentId,
    });
  }

  // Unassigned unit (currentYardId is null):
  // Engineers scoped ONLY to yards cannot access unassigned units (Default Deny).
  // Accessible only to users with ALLOW ALL or explicit Department-level scope
  // (events are subsequently filtered by applyUnitEventAccessScope at Level 3).
  if (policy.allowAll) {
    return true;
  }

  if (policy.allowDepartmentIds.length > 0) {
    return true;
  }

  return false;
}

/**
 * Translates a ResolvedProductionAccessPolicy into Department QueryBuilder WHERE conditions.
 * Ensures row-level authorization is enforced before pagination, count, and sorting.
 */
export function applyDepartmentAccessScope<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  policy: ResolvedProductionAccessPolicy,
  alias = 'dept'
): void {
  if (policy.denyAll) {
    qb.andWhere('1 = 0');
    return;
  }

  if (!policy.allowAll) {
    if (policy.allowDepartmentIds.length === 0) {
      qb.andWhere('1 = 0');
      return;
    }
    qb.andWhere(`${alias}.id IN (:...authAllowDepartmentIds)`, {
      authAllowDepartmentIds: policy.allowDepartmentIds,
    });
  }

  if (policy.denyDepartmentIds.length > 0) {
    qb.andWhere(`${alias}.id NOT IN (:...authDenyDepartmentIds)`, {
      authDenyDepartmentIds: policy.denyDepartmentIds,
    });
  }
}

/**
 * Translates a ResolvedProductionAccessPolicy into Yard QueryBuilder WHERE conditions.
 * Correctly evaluates both Department-level scope (covers all yards in department) and Yard-level scope.
 */
export function applyYardAccessScope<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  policy: ResolvedProductionAccessPolicy,
  alias = 'yard'
): void {
  if (policy.denyAll) {
    qb.andWhere('1 = 0');
    return;
  }

  if (!policy.allowAll) {
    const hasAllowDept = policy.allowDepartmentIds.length > 0;
    const hasAllowYards = policy.allowYardIds.length > 0;

    if (!hasAllowDept && !hasAllowYards) {
      qb.andWhere('1 = 0');
      return;
    }

    qb.andWhere(
      new Brackets((subQb) => {
        if (hasAllowDept && hasAllowYards) {
          subQb
            .where(`${alias}.departmentId IN (:...authAllowYardDeptIds)`, {
              authAllowYardDeptIds: policy.allowDepartmentIds,
            })
            .orWhere(`${alias}.id IN (:...authAllowYardIds)`, {
              authAllowYardIds: policy.allowYardIds,
            });
        } else if (hasAllowDept) {
          subQb.where(`${alias}.departmentId IN (:...authAllowYardDeptIds)`, {
            authAllowYardDeptIds: policy.allowDepartmentIds,
          });
        } else {
          subQb.where(`${alias}.id IN (:...authAllowYardIds)`, {
            authAllowYardIds: policy.allowYardIds,
          });
        }
      })
    );
  }

  const hasDenyDept = policy.denyDepartmentIds.length > 0;
  const hasDenyYards = policy.denyYardIds.length > 0;

  if (hasDenyDept || hasDenyYards) {
    qb.andWhere(
      new Brackets((subQb) => {
        if (hasDenyDept) {
          subQb.andWhere(`${alias}.departmentId NOT IN (:...authDenyYardDeptIds)`, {
            authDenyYardDeptIds: policy.denyDepartmentIds,
          });
        }
        if (hasDenyYards) {
          subQb.andWhere(`${alias}.id NOT IN (:...authDenyYardIds)`, {
            authDenyYardIds: policy.denyYardIds,
          });
        }
      })
    );
  }
}

/**
 * Translates a ResolvedProductionAccessPolicy into Unit Event QueryBuilder WHERE conditions.
 * Ensures row-level authorization is enforced before pagination, count, and sorting.
 *
 * Invariants & Business Rules:
 * 1. Default Deny: if policy.denyAll or !policy.hasAnyAccess, 1 = 0.
 * 2. Company President / Admin (policy.allowAll): sees full event log (respecting DENY overrides).
 * 3. Scoped Users (!policy.allowAll):
 *    - No default access to department_id IS NULL events.
 *    - Administrative events (UNIT_CREATED, UNIT_CODE_ASSIGNED, UNIT_CANCELLED) are NOT visible to scoped users.
 *    - Department Head: sees events of departments within their scope (department_id IN (:...allowDepts)).
 *    - Engineer: sees their own events only (created_by_user_id = :authUserId).
 *    - Other scoped users: subject to explicit ALLOW and DENY rules.
 * 4. DENY overrides ALLOW: Any department in denyDepartmentIds is strictly excluded.
 */
export function applyUnitEventAccessScope<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  policy: ResolvedProductionAccessPolicy,
  currentUser?: AuthPrincipal,
  responsibility?: ProductionResponsibility,
  alias = 'event'
): void {
  // 1. Default Deny / Global Deny
  if (policy.denyAll || !policy.hasAnyAccess) {
    qb.andWhere('1 = 0');
    return;
  }

  // 2. Full Access (e.g. System Admin / General Manager / Company President)
  if (policy.allowAll) {
    if (policy.denyDepartmentIds.length > 0) {
      qb.andWhere(
        new Brackets((subQb) => {
          subQb
            .where(`${alias}.department_id IS NULL`)
            .orWhere(`${alias}.department_id NOT IN (:...authDenyEventDeptIds)`, {
              authDenyEventDeptIds: policy.denyDepartmentIds,
            });
        })
      );
    }
    return;
  }

  // 3. Scoped Users (!policy.allowAll)
  // Administrative events are strictly restricted to ALLOW ALL / Admin roles.
  // Neither engineers nor department heads automatically see administrative events.
  const administrativeEventTypes = [
    'UNIT_CREATED',
    'UNIT_CODE_ASSIGNED',
    'UNIT_CANCELLED',
  ];
  qb.andWhere(`${alias}.event_type NOT IN (:...authAdminEventTypes)`, {
    authAdminEventTypes: administrativeEventTypes,
  });

  const isEngineer = Boolean(
    (responsibility?.engineerDepartmentId || policy.allowYardIds.length > 0) &&
    !responsibility?.headDepartmentId &&
    currentUser?.id
  );

  const hasAllowDept = policy.allowDepartmentIds.length > 0;

  if (isEngineer && currentUser?.id) {
    // Engineer sees only events created by them:
    qb.andWhere(`${alias}.created_by_user_id = :authUserId`, {
      authUserId: currentUser.id,
    });
  } else if (hasAllowDept) {
    // Department Head sees events of accessible department(s) only:
    qb.andWhere(`${alias}.department_id IN (:...authAllowEventDeptIds)`, {
      authAllowEventDeptIds: policy.allowDepartmentIds,
    });
  } else {
    // Scoped user with no allowed department and not an engineer -> Default Deny
    qb.andWhere('1 = 0');
    return;
  }

  // DENY overrides ALLOW
  if (policy.denyDepartmentIds.length > 0) {
    qb.andWhere(
      new Brackets((subQb) => {
        subQb
          .where(`${alias}.department_id IS NULL`)
          .orWhere(`${alias}.department_id NOT IN (:...authDenyEventDeptIds)`, {
            authDenyEventDeptIds: policy.denyDepartmentIds,
          });
      })
    );
  }
}
