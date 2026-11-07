/**
 * Fail closed before running database-mutating integration tests.
 *
 * Local XAMPP development may use its root account. That account has server-wide
 * privileges; this check limits the configured target but is NOT permission isolation.
 * Never use these integration commands against a server with valuable production data.
 */
export interface IntegrationDatabaseTarget {
  nodeEnv?: string;
  database?: string;
  username?: string;
}

export function assertIsolatedIntegrationDatabase(target: IntegrationDatabaseTarget): void {
  const database = target.database?.trim() ?? '';
  const username = target.username?.trim() ?? '';
  if (target.nodeEnv !== 'test') {
    throw new Error('Integration tests require NODE_ENV=test.');
  }
  // Exact allowlist: a suffix alone could accidentally authorize another database.
  if (database !== 'erp_inshaat_test') {
    throw new Error('Integration tests require DB_DATABASE=erp_inshaat_test.');
  }
  if (!username) {
    throw new Error('Integration tests require a nonempty DB_USERNAME.');
  }
}
