import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
