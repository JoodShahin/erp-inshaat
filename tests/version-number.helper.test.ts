import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVersion,
  formatVersion,
  compareVersions,
  sortVersionsDescending,
  getNextMinorVersion,
  isValidVersionFormat,
} from '../src/modules/production/template-version/version-number.helper.js';
import { BusinessRuleError } from '../src/common/errors/business-rule.error.js';

describe('Production Template Logical Version Number Helper', () => {
  it('1. validates standard version format (major.minor)', () => {
    assert.strictEqual(isValidVersionFormat('1.0'), true);
    assert.strictEqual(isValidVersionFormat('1.9'), true);
    assert.strictEqual(isValidVersionFormat('1.10'), true);
    assert.strictEqual(isValidVersionFormat('2.150'), true);

    assert.strictEqual(isValidVersionFormat(''), false);
    assert.strictEqual(isValidVersionFormat('1'), false);
    assert.strictEqual(isValidVersionFormat('1.0.0'), false);
    assert.strictEqual(isValidVersionFormat('v1.0'), false);
    assert.strictEqual(isValidVersionFormat('1.a'), false);
  });

  it('2. parses valid version string into major and minor numbers', () => {
    const p1 = parseVersion('1.0');
    assert.deepStrictEqual(p1, { major: 1, minor: 0 });

    const p2 = parseVersion('1.10');
    assert.deepStrictEqual(p2, { major: 1, minor: 10 });

    const p3 = parseVersion('15.42');
    assert.deepStrictEqual(p3, { major: 15, minor: 42 });
  });

  it('3. throws BusinessRuleError when parsing invalid version string', () => {
    assert.throws(
      () => parseVersion('invalid'),
      (err: any) => err instanceof BusinessRuleError && err.code === 'INVALID_VERSION_FORMAT'
    );
    assert.throws(
      () => parseVersion('1.2.3'),
      (err: any) => err instanceof BusinessRuleError && err.code === 'INVALID_VERSION_FORMAT'
    );
  });

  it('4. formats major and minor correctly into string', () => {
    assert.strictEqual(formatVersion(1, 0), '1.0');
    assert.strictEqual(formatVersion(1, 10), '1.10');
    assert.strictEqual(formatVersion(3, 25), '3.25');
  });

  it('5. strictly compares versions numerically so 1.10 is greater than 1.9 (no string sorting traps)', () => {
    // 1.10 > 1.9
    assert.strictEqual(compareVersions('1.10', '1.9'), 1);
    assert.strictEqual(compareVersions('1.9', '1.10'), -1);

    // 1.0 === 1.0
    assert.strictEqual(compareVersions('1.0', '1.0'), 0);

    // 2.0 > 1.99
    assert.strictEqual(compareVersions('2.0', '1.99'), 1);
    assert.strictEqual(compareVersions('1.99', '2.0'), -1);

    // 1.2 > 1.1
    assert.strictEqual(compareVersions('1.2', '1.1'), 1);
  });

  it('6. sorts array of version strings in descending order', () => {
    const list = ['1.0', '1.9', '1.1', '1.10', '1.2', '2.0'];
    const sorted = sortVersionsDescending(list);
    assert.deepStrictEqual(sorted, ['2.0', '1.10', '1.9', '1.2', '1.1', '1.0']);
  });

  it('7. computes next minor version correctly', () => {
    // 1.0 -> 1.1
    assert.strictEqual(getNextMinorVersion('1.0', ['1.0']), '1.1');

    // 1.9 -> 1.10
    assert.strictEqual(getNextMinorVersion('1.9', ['1.0', '1.9']), '1.10');

    // If 1.10 was in historical versions, advances to 1.11 to prevent version reuse
    assert.strictEqual(getNextMinorVersion('1.9', ['1.0', '1.9', '1.10']), '1.11');

    // If 1.10 and 1.11 were historical, advances to 1.12
    assert.strictEqual(getNextMinorVersion('1.9', ['1.0', '1.9', '1.10', '1.11']), '1.12');
  });
});
