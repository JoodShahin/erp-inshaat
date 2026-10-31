/**
 * Production Order Line Quantity Calculation Helper
 *
 * Centralized, standardized computation of requested, linked, remaining,
 * and excess quantities for production memorandum lines.
 *
 * Rules:
 * - difference = requestedQuantity - linkedQuantity
 * - remainingQuantity = Math.max(0, difference)
 * - excessQuantity = Math.max(0, -difference)
 * - hasQuantityViolation = excessQuantity > 0
 *
 * Examples:
 * - requested: 10, linked: 4  => remaining: 6, excess: 0, violation: false
 * - requested: 10, linked: 10 => remaining: 0, excess: 0, violation: false
 * - requested: 10, linked: 12 => remaining: 0, excess: 2, violation: true
 */

export interface ProductionLineQuantities {
  requestedQuantity: number;
  linkedQuantity: number;
  remainingQuantity: number;
  excessQuantity: number;
  hasQuantityViolation: boolean;
}

export function calculateLineQuantities(
  requestedQuantity: number,
  linkedQuantity: number
): ProductionLineQuantities {
  const safeRequested = Number.isFinite(requestedQuantity) && requestedQuantity >= 0 ? requestedQuantity : 0;
  const safeLinked = Number.isFinite(linkedQuantity) && linkedQuantity >= 0 ? linkedQuantity : 0;

  const difference = safeRequested - safeLinked;
  const remainingQuantity = Math.max(0, difference);
  const excessQuantity = Math.max(0, -difference);
  const hasQuantityViolation = excessQuantity > 0;

  return {
    requestedQuantity: safeRequested,
    linkedQuantity: safeLinked,
    remainingQuantity,
    excessQuantity,
    hasQuantityViolation,
  };
}
