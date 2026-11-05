/**
 * Fail closed before running database-mutating integration tests.
 * This check is intentionally independent of the application's .env loader.
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
  if (!/^[a-zA-Z0-9_]+_test$/.test(database)) {
    throw new Error('Integration tests require a dedicated database whose name ends with _test.');
  }
  if (!username || /^(root|admin|administrator)$/i.test(username)) {
    throw new Error('Integration tests require a dedicated non-administrator DB_USERNAME.');
  }
}
