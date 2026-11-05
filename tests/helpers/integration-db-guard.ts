import mysql from 'mysql2/promise';
import { envConfig } from '../../src/config/env.config.js';
import { assertIsolatedIntegrationDatabase } from './integration-db-safety.js';

/**
 * Standalone preflight command for npm run test:integration.
 * The npm script must finish this process successfully BEFORE launching Node's test runner.
 * Do not load this file through --import: the project's tsx CommonJS transform does not support top-level await.
 */
async function verifyIntegrationDatabase(): Promise<void> {
  // Shell-provided values override .env through dotenv's default behavior.
  // Reject unsafe targets before attempting any database connection.
  assertIsolatedIntegrationDatabase({
    nodeEnv: envConfig.nodeEnv,
    database: envConfig.db.database,
    username: envConfig.db.username,
  });

  const connection = await mysql.createConnection({
    host: envConfig.db.host,
    port: envConfig.db.port,
    user: envConfig.db.username,
    password: envConfig.db.password,
    database: envConfig.db.database,
  });

  try {
    const [rows] = await connection.query<import('mysql2').RowDataPacket[]>(
      'SELECT DATABASE() AS connected_database, CURRENT_USER() AS authenticated_user'
    );
    const connectedDatabase = String(rows[0]?.connected_database ?? '');
    const authenticatedUser = String(rows[0]?.authenticated_user ?? '');
    if (connectedDatabase !== envConfig.db.database) {
      throw new Error('Integration test database mismatch: refusing to run.');
    }

    // Validate the authenticated account returned by the database server, not just the requested account.
    assertIsolatedIntegrationDatabase({
      nodeEnv: envConfig.nodeEnv,
      database: connectedDatabase,
      username: authenticatedUser.split('@')[0],
    });
  } finally {
    await connection.end();
  }
}

// A rejected preflight must exit nonzero, so the shell's && never starts integration tests.
void verifyIntegrationDatabase().catch((error: unknown) => {
  console.error('Integration database preflight failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
