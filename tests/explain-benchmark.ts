import { AppDataSource } from '../src/database/data-source';

async function main() {
  await AppDataSource.initialize();

  const queries = [
    {
      name: 'Active templates list',
      sql: 'EXPLAIN SELECT * FROM production_template WHERE deleted_at IS NULL AND is_active = 1',
    },
    {
      name: 'Template active versions lookup',
      sql: "EXPLAIN SELECT * FROM production_template_version WHERE template_id = 'test-id' AND deleted_at IS NULL",
    },
    {
      name: 'Version stages lookup',
      sql: "EXPLAIN SELECT * FROM production_template_stage WHERE version_id = 'test-id' AND deleted_at IS NULL",
    },
    {
      name: 'Version patterns lookup',
      sql: "EXPLAIN SELECT * FROM production_template_pattern WHERE version_id = 'test-id' AND deleted_at IS NULL",
    },
    {
      name: 'Workflow items sorted fetch',
      sql: "EXPLAIN SELECT * FROM production_template_workflow_item WHERE version_id = 'test-id' AND deleted_at IS NULL ORDER BY sort_order ASC",
    },
    {
      name: 'Pattern options sorted fetch',
      sql: "EXPLAIN SELECT * FROM production_template_pattern_option WHERE pattern_id = 'test-id' AND deleted_at IS NULL ORDER BY sort_order ASC",
    },
    {
      name: 'Option tasks sorted fetch',
      sql: "EXPLAIN SELECT * FROM production_template_pattern_option_task WHERE option_id = 'test-id' AND deleted_at IS NULL ORDER BY sort_order ASC",
    },
    {
      name: 'Stage attachments sorted fetch',
      sql: "EXPLAIN SELECT * FROM production_template_stage_attachment WHERE stage_id = 'test-id' AND deleted_at IS NULL ORDER BY sort_order ASC",
    },
    {
      name: 'Upload token lookup',
      sql: "EXPLAIN SELECT * FROM production_template_upload_token WHERE template_id = 'test-id' AND is_used = 0 AND expires_at > NOW()",
    },
    {
      name: 'Upload token expired cleanup query',
      sql: "EXPLAIN SELECT * FROM production_template_upload_token WHERE expires_at < NOW() AND is_used = 0",
    },
    {
      name: 'Order line by template and version',
      sql: "EXPLAIN SELECT * FROM production_order_line WHERE template_id = 'test-id' AND template_version_id = 'test-ver-id' AND deleted_at IS NULL",
    },
  ];

  console.log('--- EXPLAIN Query Optimization Results ---');
  for (const q of queries) {
    const res: any[] = await AppDataSource.query(q.sql);
    const row = res[0];
    console.log(`\nQuery: ${q.name}`);
    console.log(`Table: ${row.table} | Type: ${row.type} | Key: ${row.key} | Ref: ${row.ref} | Rows: ${row.rows} | Extra: ${row.Extra}`);
  }

  await AppDataSource.destroy();
}

main().catch(console.error);
