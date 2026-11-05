import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AppDataSource } from '../src/database/data-source.js';

/**
 * Run only after migrations complete on an isolated integration database.
 * Checks actual FK metadata rather than trusting the declared CREATE TABLE text.
 */
describe('Template versioning migration foreign-key collations', () => {
  before(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  });

  after(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it('keeps both sides of template-versioning string foreign keys compatible', async () => {
    const expectedConstraints = [
      'FK_prod_template_version_template',
      'FK_stored_file_template',
      'FK_stored_file_user',
      'FK_editing_idempotency_template',
      'FK_upload_token_template',
      'FK_upload_token_user',
      'FK_prod_template_stage_version',
      'FK_prod_template_pattern_version',
      'FK_prod_template_workflow_version',
    ];

    const rows: Array<{
      CONSTRAINT_NAME: string;
      COLUMN_NAME: string;
      REFERENCED_COLUMN_NAME: string;
      child_charset: string | null;
      parent_charset: string | null;
      child_collation: string | null;
      parent_collation: string | null;
    }> = await AppDataSource.query(`
      SELECT fk.CONSTRAINT_NAME,
             fk.COLUMN_NAME,
             fk.REFERENCED_COLUMN_NAME,
             child.CHARACTER_SET_NAME AS child_charset,
             parent.CHARACTER_SET_NAME AS parent_charset,
             child.COLLATION_NAME AS child_collation,
             parent.COLLATION_NAME AS parent_collation
        FROM information_schema.KEY_COLUMN_USAGE fk
        JOIN information_schema.COLUMNS child
          ON child.TABLE_SCHEMA = fk.TABLE_SCHEMA
         AND child.TABLE_NAME = fk.TABLE_NAME
         AND child.COLUMN_NAME = fk.COLUMN_NAME
        JOIN information_schema.COLUMNS parent
          ON parent.TABLE_SCHEMA = fk.REFERENCED_TABLE_SCHEMA
         AND parent.TABLE_NAME = fk.REFERENCED_TABLE_NAME
         AND parent.COLUMN_NAME = fk.REFERENCED_COLUMN_NAME
       WHERE fk.TABLE_SCHEMA = DATABASE()
         AND fk.CONSTRAINT_NAME IN (${expectedConstraints.map(() => '?').join(', ')})
         AND fk.REFERENCED_TABLE_NAME IS NOT NULL
    `, expectedConstraints);

    for (const name of expectedConstraints) {
      assert.ok(rows.some((row) => row.CONSTRAINT_NAME === name), `Expected foreign key ${name} must exist`);
    }

    for (const row of rows) {
      assert.ok(row.child_charset && row.parent_charset,
        `Both columns of ${row.CONSTRAINT_NAME} must use character types`);
      assert.equal(row.child_charset, row.parent_charset,
        `Character set mismatch in ${row.CONSTRAINT_NAME}`);
      assert.equal(row.child_collation, row.parent_collation,
        `Collation mismatch in ${row.CONSTRAINT_NAME}: ${row.COLUMN_NAME} -> ${row.REFERENCED_COLUMN_NAME}`);
    }
  });
});
