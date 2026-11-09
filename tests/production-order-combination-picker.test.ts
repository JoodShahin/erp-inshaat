import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

interface Pattern { patternId: string; selectedOptionId: string | null; availableOptions: Array<{ id: string }> }
interface Line { template: { id: string }; patterns: Pattern[] }
interface Picker {
  optionHasUnusedCompletion(line: Line, index: number, optionId: string): boolean;
  pickUnusedCombination(line: Line): boolean;
}

const source = readFileSync('src/public/js/production-order-edit.js', 'utf8');
const start = source.indexOf('  function optionHasUnusedCompletion(');
const end = source.indexOf('  /**\n   * Evaluates all lines', start);
assert.ok(start >= 0 && end > start, 'combination picker source must be present');
const functions = source.slice(start, end);

function createPicker(lines: Line[]): Picker {
  return runInNewContext(
    functions + '\n({ optionHasUnusedCompletion, pickUnusedCombination })',
    { lines },
  ) as Picker;
}

function makeLine(casting: string | null, paint: string | null): Line {
  return {
    template: { id: 'A' },
    patterns: [
      { patternId: 'casting', selectedOptionId: casting, availableOptions: [{ id: 'normal' }, { id: 'reinforced' }] },
      { patternId: 'paint', selectedOptionId: paint, availableOptions: [{ id: 'normal' }, { id: 'good' }] },
    ],
  };
}

describe('Production order pattern combination picker', () => {
  it('allows shared choices across distinct combinations', () => {
    const lines = [makeLine('normal', 'normal')];
    const draft = makeLine('normal', null);
    const picker = createPicker(lines);
    assert.equal(picker.optionHasUnusedCompletion(draft, 1, 'normal'), false);
    assert.equal(picker.optionHasUnusedCompletion(draft, 1, 'good'), true);
    assert.equal(picker.optionHasUnusedCompletion(draft, 0, 'normal'), true);
  });

  it('moves to the next available prefix once a prefix is exhausted', () => {
    const lines = [makeLine('normal', 'normal'), makeLine('normal', 'good')];
    const draft = makeLine('normal', 'normal');
    const picker = createPicker(lines);
    assert.equal(picker.optionHasUnusedCompletion(draft, 0, 'normal'), false);
    assert.equal(picker.pickUnusedCombination(draft), true);
    assert.equal(draft.patterns[0].selectedOptionId, 'reinforced');
  });

  it('refuses the fifth item after using all four 2x2 combinations', () => {
    const lines = [
      makeLine('normal', 'normal'), makeLine('normal', 'good'),
      makeLine('reinforced', 'normal'), makeLine('reinforced', 'good'),
    ];
    assert.equal(createPicker(lines).pickUnusedCombination(makeLine(null, null)), false);
  });

  it('allows a zero-pattern template only once', () => {
    const line: Line = { template: { id: 'B' }, patterns: [] };
    assert.equal(createPicker([]).pickUnusedCombination(line), true);
    assert.equal(createPicker([line]).pickUnusedCombination({ template: { id: 'B' }, patterns: [] }), false);
  });

  it('does not count a different template as a duplicate', () => {
    const other = makeLine('normal', 'normal');
    other.template.id = 'B';
    const line = makeLine('normal', 'normal');
    assert.equal(createPicker([other]).pickUnusedCombination(line), true);
  });
});
