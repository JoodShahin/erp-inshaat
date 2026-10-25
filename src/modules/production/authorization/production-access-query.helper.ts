import { Brackets, SelectQueryBuilder, ObjectLiteral } from 'typeorm';
import { ResolvedProductionAccessPolicy } from './production-access-policy.types.js';

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
 * Invariants:
 * 1. Default Deny: if policy.denyAll or !policy.hasAnyAccess, 1 = 0.
 * 2. If !policy.allowAll, events with department_id must be in allowDepartmentIds.
 *    General unit events (where department_id IS NULL) are allowed if user has department access.
 * 3. Any department in denyDepartmentIds is strictly excluded.
 */
export function applyUnitEventAccessScope<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  policy: ResolvedProductionAccessPolicy,
  alias = 'event'
): void {
  if (policy.denyAll || !policy.hasAnyAccess) {
    qb.andWhere('1 = 0');
    return;
  }

  if (!policy.allowAll) {
    const hasAllowDept = policy.allowDepartmentIds.length > 0;
    if (hasAllowDept) {
      qb.andWhere(
        new Brackets((subQb) => {
          subQb
            .where(`${alias}.department_id IS NULL`)
            .orWhere(`${alias}.department_id IN (:...authAllowEventDeptIds)`, {
              authAllowEventDeptIds: policy.allowDepartmentIds,
            });
        })
      );
    } else {
      qb.andWhere(`${alias}.department_id IS NULL`);
    }
  }

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
