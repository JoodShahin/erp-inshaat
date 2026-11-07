import { AppDataSource } from '../src/database/data-source.js';
import { performance } from 'node:perf_hooks';

async function main() {
  await AppDataSource.initialize();

  // 1. Fetch real representative IDs from database
  const tplRow = (await AppDataSource.query(`SELECT id FROM production_template WHERE deleted_at IS NULL LIMIT 1`))[0];
  const templateId = tplRow?.id || '00000000-0000-0000-0000-000000000000';

  const verRow = (await AppDataSource.query(`SELECT id, template_id FROM production_template_version WHERE deleted_at IS NULL LIMIT 1`))[0];
  const versionId = verRow?.id || '00000000-0000-0000-0000-000000000000';

  const stageRow = (await AppDataSource.query(`SELECT id, version_id FROM production_template_stage WHERE deleted_at IS NULL LIMIT 1`))[0];
  const stageId = stageRow?.id || '00000000-0000-0000-0000-000000000000';

  const patRow = (await AppDataSource.query(`SELECT id, version_id FROM production_template_pattern WHERE deleted_at IS NULL LIMIT 1`))[0];
  const patternId = patRow?.id || '00000000-0000-0000-0000-000000000000';

  const optRow = (await AppDataSource.query(`SELECT id, pattern_id FROM production_template_pattern_option WHERE deleted_at IS NULL LIMIT 1`))[0];
  const optionId = optRow?.id || '00000000-0000-0000-0000-000000000000';

  const lineRow = (await AppDataSource.query(`SELECT template_id, template_version_id FROM production_order_line WHERE deleted_at IS NULL LIMIT 1`))[0];
  const lineTemplateId = lineRow?.template_id || templateId;
  const lineVersionId = lineRow?.template_version_id || versionId;

  const queries = [
    {
      name: 'Active templates list',
      table: 'production_template',
      sql: 'SELECT * FROM production_template WHERE deleted_at IS NULL AND is_active = 1',
      params: [],
    },
    {
      name: 'Template active versions lookup',
      table: 'production_template_version',
      sql: 'SELECT * FROM production_template_version WHERE template_id = ? AND deleted_at IS NULL',
      params: [templateId],
    },
    {
      name: 'Version stages lookup',
      table: 'production_template_stage',
      sql: 'SELECT * FROM production_template_stage WHERE version_id = ? AND deleted_at IS NULL',
      params: [versionId],
    },
    {
      name: 'Version patterns lookup',
      table: 'production_template_pattern',
      sql: 'SELECT * FROM production_template_pattern WHERE version_id = ? AND deleted_at IS NULL',
      params: [versionId],
    },
    {
      name: 'Workflow items sorted fetch',
      table: 'production_template_workflow_item',
      sql: 'SELECT * FROM production_template_workflow_item WHERE version_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC',
      params: [versionId],
    },
    {
      name: 'Pattern options sorted fetch',
      table: 'production_template_pattern_option',
      sql: 'SELECT * FROM production_template_pattern_option WHERE pattern_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC',
      params: [patternId],
    },
    {
      name: 'Option tasks sorted fetch',
      table: 'production_template_pattern_option_task',
      sql: 'SELECT * FROM production_template_pattern_option_task WHERE option_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC',
      params: [optionId],
    },
    {
      name: 'Stage attachments sorted fetch',
      table: 'production_template_stage_attachment',
      sql: 'SELECT * FROM production_template_stage_attachment WHERE stage_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC',
      params: [stageId],
    },
    {
      name: 'Upload token lookup',
      table: 'production_template_upload_token',
      sql: 'SELECT * FROM production_template_upload_token WHERE template_id = ? AND is_used = 0 AND expires_at > NOW()',
      params: [templateId],
    },
    {
      name: 'Upload token expired cleanup query',
      table: 'production_template_upload_token',
      sql: 'SELECT * FROM production_template_upload_token WHERE expires_at < NOW() AND is_used = 0',
      params: [],
    },
    {
      name: 'Order line by template and version',
      table: 'production_order_line',
      sql: 'SELECT * FROM production_order_line WHERE template_id = ? AND template_version_id = ? AND deleted_at IS NULL',
      params: [lineTemplateId, lineVersionId],
    },
  ];

  console.log('========================================================================');
  console.log('        EXPLAIN & EXECUTION PERFORMANCE BENCHMARK REPORT                ');
  console.log('========================================================================');
  console.log(`Representative IDs:`);
  console.log(`  Template ID : ${templateId}`);
  console.log(`  Version ID  : ${versionId}`);
  console.log(`  Stage ID    : ${stageId}`);
  console.log(`  Pattern ID  : ${patternId}`);
  console.log(`  Option ID   : ${optionId}`);
  console.log('------------------------------------------------------------------------');

  for (const q of queries) {
    // 1. Run EXPLAIN
    const explainSql = `EXPLAIN ${q.sql}`;
    const explainRows: any[] = await AppDataSource.query(explainSql, q.params);
    const row = explainRows[0] || {};

    // 2. Run execution timing
    const t0 = performance.now();
    await AppDataSource.query(q.sql, q.params);
    const executionDurationMs = (performance.now() - t0).toFixed(3);

    // 3. Attempt ANALYZE if supported
    let analyzeInfo = 'N/A';
    try {
      const analyzeRows = await AppDataSource.query(`ANALYZE ${q.sql}`, q.params);
      if (analyzeRows && analyzeRows[0]?.r_rows !== undefined) {
        analyzeInfo = `actual_rows=${analyzeRows[0].r_rows}, r_filtered=${analyzeRows[0].r_filtered}%`;
      }
    } catch {
      try {
        const eaRows = await AppDataSource.query(`EXPLAIN ANALYZE ${q.sql}`, q.params);
        analyzeInfo = typeof eaRows[0] === 'string' ? eaRows[0] : JSON.stringify(eaRows[0]);
      } catch {
        analyzeInfo = 'Not supported';
      }
    }

    const hasFilesort = String(row.Extra || '').includes('Using filesort');
    const hasTemporary = String(row.Extra || '').includes('Using temporary');

    console.log(`\nQuery: ${q.name}`);
    console.log(`  Target Table   : ${row.table || q.table}`);
    console.log(`  Access Type    : ${row.type}`);
    console.log(`  Key (Index)    : ${row.key || 'NONE'}`);
    console.log(`  Possible Keys  : ${row.possible_keys || 'NONE'}`);
    console.log(`  Rows Examined  : ${row.rows}`);
    console.log(`  Filesort / Temp: ${hasFilesort ? 'YES (filesort)' : 'NO'} / ${hasTemporary ? 'YES (temp)' : 'NO'}`);
    console.log(`  Extra Details  : ${row.Extra || 'none'}`);
    console.log(`  Execution Time : ${executionDurationMs} ms`);
    console.log(`  Analyze Metric : ${analyzeInfo}`);
  }

  console.log('\n========================================================================');
  await AppDataSource.destroy();
}

main().catch(console.error);
