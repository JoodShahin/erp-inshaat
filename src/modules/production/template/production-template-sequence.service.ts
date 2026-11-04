import { EntityManager, Repository } from 'typeorm';
import { ProductionTemplateSequenceEntity } from './production-template-sequence.entity.js';
import { ProductionTemplateEntity } from './production-template.entity.js';
import { BusinessRuleError } from '../../../common/errors/business-rule.error.js';

export class ProductionTemplateSequenceService {
  /**
   * Generates a unique, monotonically increasing technical code for a new production template.
   * Format: PT-XXXXXX (e.g. PT-000001, PT-000002).
   *
   * Invariants:
   * 1. Concurrency-safe: acquires a pessimistic_write lock on the sequence row.
   * 2. Collision-free: verifies against production_template (including soft-deleted rows) and advances if needed.
   * 3. Atomic: runs inside the calling transaction manager.
   */
  async generateNextCode(manager: EntityManager): Promise<string> {
    const seqRepo = manager.getRepository(ProductionTemplateSequenceEntity);
    const templateRepo = manager.getRepository(ProductionTemplateEntity);

    let seq = await seqRepo.findOne({
      where: { id: 'PRODUCTION_TEMPLATE' },
      lock: { mode: 'pessimistic_write' },
    });

    if (!seq) {
      // Fallback auto-initialization if migration wasn't run
      seq = seqRepo.create({
        id: 'PRODUCTION_TEMPLATE',
        currentValue: '0',
      });
      await seqRepo.save(seq);

      // Re-lock
      seq = await seqRepo.findOne({
        where: { id: 'PRODUCTION_TEMPLATE' },
        lock: { mode: 'pessimistic_write' },
      });
    }

    if (!seq) {
      throw new BusinessRuleError(
        'تعذر تهيئة العداد التسلسلي لقوالب الإنتاج',
        'PRODUCTION_TEMPLATE_SEQUENCE_ERROR'
      );
    }

    let nextVal = BigInt(seq.currentValue || '0');
    let candidateCode: string;
    let isUnique = false;

    // Loop to ensure candidateCode is not colliding with any historical template
    while (!isUnique) {
      nextVal += 1n;
      candidateCode = `PT-${nextVal.toString().padStart(6, '0')}`;

      const existing = await templateRepo.findOne({
        where: { code: candidateCode },
        withDeleted: true,
      });

      if (!existing) {
        isUnique = true;
      }
    }

    seq.currentValue = nextVal.toString();
    await seqRepo.save(seq);

    return candidateCode!;
  }
}

export const productionTemplateSequenceService = new ProductionTemplateSequenceService();
