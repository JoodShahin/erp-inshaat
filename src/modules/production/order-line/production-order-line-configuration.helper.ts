import { createHash } from 'node:crypto';

export interface PatternSelectionReference {
  templatePatternId: string;
  selectedOptionId: string;
}

/**
 * Produces a stable, deterministic canonical string representation of a production order line's configuration.
 *
 * Rules:
 * 1. Only immutable IDs are used (templateId, templatePatternId, selectedOptionId, versionId). Names are NEVER used.
 * 2. Quantity is strictly excluded from configuration identity.
 * 3. Selections are always sorted deterministically by templatePatternId ASC.
 * 4. Backward compatibility: if versionId is omitted/undefined, hash remains 100% identical to legacy format.
 */
export function canonicalizeLineConfiguration(
  templateId: string,
  selections: PatternSelectionReference[] = [],
  versionId?: string
): string {
  const versionPrefix = versionId ? `${versionId}:` : '';
  if (!selections || selections.length === 0) {
    return `${versionPrefix}${templateId}`;
  }

  const sortedSelections = [...selections].sort((a, b) =>
    a.templatePatternId.localeCompare(b.templatePatternId)
  );

  const parts = sortedSelections.map((s) => `${s.templatePatternId}:${s.selectedOptionId}`);
  return `${versionPrefix}${templateId}|${parts.join('|')}`;
}

/**
 * Computes a 64-character lowercase hexadecimal SHA-256 hash of the canonical line configuration.
 */
export function hashLineConfiguration(
  templateId: string,
  selections: PatternSelectionReference[] = [],
  versionId?: string
): string {
  const canonical = canonicalizeLineConfiguration(templateId, selections, versionId);
  return createHash('sha256').update(canonical, 'utf8').digest('hex').toLowerCase();
}
