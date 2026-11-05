import mysql from 'mysql2/promise';
import { envConfig } from '../../src/config/env.config.js';
import { assertIsolatedIntegrationDatabase } from './integration-db-safety.js';

// This module is preloaded via --import before any integration test can mutate the database.
// Environment variables set in the invoking shell override values in .env (dotenv default).
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
  // The server-side account must also be a non-administrator account.
  assertIsolatedIntegrationDatabase({
    nodeEnv: envConfig.nodeEnv,
    database: connectedDatabase,
    username: authenticatedUser.split('@')[0],
  });
} finally {
  await connection.end();
}
