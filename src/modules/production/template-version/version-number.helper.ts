import { BusinessRuleError } from '../../../common/errors/business-rule.error.js';

export interface ParsedVersion {
  major: number;
  minor: number;
}

/**
 * Validates whether a version string matches standard logical format (e.g. "1.0", "1.9", "1.10").
 */
export function isValidVersionFormat(version: string): boolean {
  if (!version || typeof version !== 'string') return false;
  return /^\d+\.\d+$/.test(version.trim());
}

/**
 * Parses a version string into numeric major and minor components.
 */
export function parseVersion(version: string): ParsedVersion {
  if (!isValidVersionFormat(version)) {
    throw new BusinessRuleError(
      `صيغة رقم الإصدار غير صالحة: ${version}. الصيغة المتوقعة هي X.Y مثل 1.0`,
      'INVALID_VERSION_FORMAT'
    );
  }
  const [majorStr, minorStr] = version.trim().split('.');
  const major = parseInt(majorStr, 10);
  const minor = parseInt(minorStr, 10);
  if (isNaN(major) || isNaN(minor) || major < 0 || minor < 0) {
    throw new BusinessRuleError(
      `أرقام الإصدار يجب أن تكون أعداداً صحيحة غير سالبة: ${version}`,
      'INVALID_VERSION_FORMAT'
    );
  }
  return { major, minor };
}

/**
 * Formats numeric major and minor into a version string.
 */
export function formatVersion(major: number, minor: number): string {
  return `${major}.${minor}`;
}

/**
 * Compares two logical version strings.
 * Returns:
 *   1 if v1 > v2
 *  -1 if v1 < v2
 *   0 if v1 === v2
 *
 * Examples:
 *   compareVersions("1.10", "1.9") === 1
 *   compareVersions("1.9", "1.10") === -1
 *   compareVersions("2.0", "1.99") === 1
 */
export function compareVersions(v1: string, v2: string): number {
  const p1 = parseVersion(v1);
  const p2 = parseVersion(v2);

  if (p1.major !== p2.major) {
    return p1.major > p2.major ? 1 : -1;
  }
  if (p1.minor !== p2.minor) {
    return p1.minor > p2.minor ? 1 : -1;
  }
  return 0;
}

/**
 * Sorts an array of logical version strings in descending order (highest/newest first).
 */
export function sortVersionsDescending(versions: string[]): string[] {
  return [...versions].sort((a, b) => compareVersions(b, a));
}

/**
 * Computes the next logical minor version number.
 * Ensures the candidate version is strictly greater than all historical versions
 * (even soft-deleted ones) so version numbers are never reused.
 *
 * Example:
 *   current = "1.0", historical = ["1.0"] => "1.1"
 *   current = "1.9", historical = ["1.0", "1.9"] => "1.10"
 *   current = "1.9", historical = ["1.0", "1.9", "1.10"] => "1.11"
 */
export function getNextMinorVersion(
  currentVersion: string,
  allHistoricalVersions: string[] = []
): string {
  const current = parseVersion(currentVersion);
  let nextMinor = current.minor + 1;
  let candidate = formatVersion(current.major, nextMinor);

  const existingSet = new Set(allHistoricalVersions.map((v) => v.trim()));

  while (existingSet.has(candidate)) {
    nextMinor++;
    candidate = formatVersion(current.major, nextMinor);
  }

  return candidate;
}
