import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProductionTemplateChangeClassifier } from '../src/modules/production/template-editing/production-template-change-classifier.js';

describe('Production Template Atomic Editing & Classification Tests', () => {
  describe('1. ProductionTemplateChangeClassifier', () => {
    const classifier = new ProductionTemplateChangeClassifier();

    it('classifies empty operations as NONE', () => {
      const res = classifier.classify([]);
      assert.strictEqual(res.classification, 'NONE');
    });

    it('classifies ADD_STAGE as STRUCTURAL', () => {
      const res = classifier.classify([
        { type: 'ADD_STAGE', tempClientId: 'temp-1', payload: { name: 'Cutting', departmentId: 'dept-1' } },
      ]);
      assert.strictEqual(res.classification, 'STRUCTURAL');
      assert.strictEqual(res.structuralCount, 1);
    });

    it('classifies DELETE_STAGE as STRUCTURAL', () => {
      const res = classifier.classify([
        { type: 'DELETE_STAGE', targetId: 'stg-1' },
      ]);
      assert.strictEqual(res.classification, 'STRUCTURAL');
      assert.strictEqual(res.structuralCount, 1);
    });

    it('classifies UPDATE_STAGE with departmentId change as STRUCTURAL', () => {
      const res = classifier.classify([
        { type: 'UPDATE_STAGE', targetId: 'stg-1', payload: { departmentId: 'dept-2' } },
      ]);
      assert.strictEqual(res.classification, 'STRUCTURAL');
    });

    it('classifies UPDATE_STAGE with duration change as STRUCTURAL', () => {
      const res = classifier.classify([
        { type: 'UPDATE_STAGE', targetId: 'stg-1', payload: { estimatedDurationMinutes: 120 } },
      ]);
      assert.strictEqual(res.classification, 'STRUCTURAL');
    });

    it('classifies UPDATE_STAGE with only name/description as MINOR', () => {
      const res = classifier.classify([
        { type: 'UPDATE_STAGE', targetId: 'stg-1', payload: { name: 'New Name', description: 'New Desc' } },
      ]);
      assert.strictEqual(res.classification, 'MINOR');
      assert.strictEqual(res.minorCount, 1);
    });

    it('classifies REORDER_WORKFLOW as MINOR', () => {
      const res = classifier.classify([
        { type: 'REORDER_WORKFLOW', payload: { itemIds: ['item-2', 'item-1'] } },
      ]);
      assert.strictEqual(res.classification, 'MINOR');
    });

    it('classifies specification additions and edits as MINOR', () => {
      const res = classifier.classify([
        { type: 'ADD_SPEC', payload: { name: 'Width', value: '50' } },
        { type: 'UPDATE_SPEC', targetId: 'spec-1', payload: { value: '60' } },
      ]);
      assert.strictEqual(res.classification, 'MINOR');
      assert.strictEqual(res.minorCount, 2);
    });

    it('classifies attachment additions and deletes as MINOR', () => {
      const res = classifier.classify([
        { type: 'ADD_STAGE_ATTACHMENT', parentId: 'stg-1', payload: { storageKey: 'abc.pdf' } },
        { type: 'DELETE_STAGE_ATTACHMENT', targetId: 'att-1' },
      ]);
      assert.strictEqual(res.classification, 'MINOR');
    });

    it('prioritizes STRUCTURAL when mixing structural and minor operations', () => {
      const res = classifier.classify([
        { type: 'UPDATE_STAGE', targetId: 'stg-1', payload: { name: 'Renamed' } }, // Minor
        { type: 'ADD_STAGE', tempClientId: 'temp-2', payload: { name: 'New Stage', departmentId: 'dept-1' } }, // Structural
        { type: 'REORDER_WORKFLOW', payload: { itemIds: ['stg-1', 'temp-2'] } }, // Minor
      ]);
      assert.strictEqual(res.classification, 'STRUCTURAL');
      assert.strictEqual(res.structuralCount, 1);
      assert.strictEqual(res.minorCount, 2);
    });
  });
});
