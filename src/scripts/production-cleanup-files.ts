import 'reflect-metadata';
import { AppDataSource } from '../database/data-source.js';
import { productionTemplateSharedFileService } from '../modules/production/template/production-template-shared-file.service.js';
import { logger } from '../common/logging/logger.js';

async function main() {
  logger.info('[Cleanup CLI] Starting production template file cleanup worker...');
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  try {
    const summary = await productionTemplateSharedFileService.processDueCleanupTasks(50);
    logger.info(
      `[Cleanup CLI] Completed cleanup batch: ${summary.processed} tasks processed, ${summary.succeeded} succeeded, ${summary.failed} failed.`
    );
  } catch (err) {
    logger.error('[Cleanup CLI] Unexpected error during cleanup batch:', err);
    process.exit(1);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

main().catch((err) => {
  console.error('[Cleanup CLI] Fatal error:', err);
  process.exit(1);
});
