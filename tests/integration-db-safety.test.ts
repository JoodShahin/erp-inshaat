import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertIsolatedIntegrationDatabase } from './helpers/integration-db-safety.js';

describe('Integration database safety gate', () => {
  it('accepts a dedicated test database and unprivileged test account', () => {
    assert.doesNotThrow(() => assertIsolatedIntegrationDatabase({
      nodeEnv: 'test',
      database: 'erp_inshaat_test',
      username: 'erp_test',
    }));
  });

  for (const [label, target] of [
    ['development environment', { nodeEnv: 'development', database: 'erp_inshaat_test', username: 'erp_test' }],
    ['production environment', { nodeEnv: 'production', database: 'erp_inshaat_test', username: 'erp_test' }],
    ['development database', { nodeEnv: 'test', database: 'erp_db1', username: 'erp_test' }],
    ['test-like prefix', { nodeEnv: 'test', database: 'test_erp_db1', username: 'erp_test' }],
    ['empty database', { nodeEnv: 'test', database: '', username: 'erp_test' }],
    ['root account', { nodeEnv: 'test', database: 'erp_inshaat_test', username: 'root' }],
    ['administrator account', { nodeEnv: 'test', database: 'erp_inshaat_test', username: 'admin' }],
    ['empty username', { nodeEnv: 'test', database: 'erp_inshaat_test', username: '' }],
  ] as const) {
    it('rejects ' + label, () => {
      assert.throws(() => assertIsolatedIntegrationDatabase(target));
    });
  }
});

describe('Integration runner preflight wiring', () => {
  it('runs the database preflight in a separate process before any integration test', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    const script = packageJson.scripts['test:integration'];
    assert.match(script, /^tsx tests\/helpers\/integration-db-guard\.ts && node --import tsx --test /);
    assert.match(script, /--test-concurrency=1/);
    assert.doesNotMatch(script, /--import \.\/tests\/helpers\/integration-db-guard/);
  });

  it('does not bypass the guarded integration command in test:all', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    assert.equal(packageJson.scripts['test:all'], 'npm run test && npm run test:integration');
  });
});
