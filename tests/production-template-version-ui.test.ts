import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync('src/public/js/production-template-detail.js', 'utf8');
const view = readFileSync('src/views/dashboard/production/templates/show.ejs', 'utf8');
const controller = readFileSync('src/modules/production/template/production-template.web.controller.ts', 'utf8');

describe('Template version navigation and historical mode regression', () => {
  it('opens the workflow tab after selecting any template version', () => {
    assert.match(view, /versionId=<%= v\.id %>#workflow/);
    assert.match(script, /encodeURIComponent\(selectedVerId\) \+ '#workflow'/);
    assert.match(script, /const currentHash = window\.location\.hash\.toLowerCase\(\)/);
    assert.match(script, /currentHash === '#workflow'/);
  });

  it('returns to the latest version in workflow rather than the info tab', () => {
    assert.match(script, /templateId \+ '#workflow'/);
  });

  it('does not display the historical warning on the latest version', () => {
    assert.match(view, /!template\.currentVersion\.isLatest\) \? 'd-flex' : 'd-none'/);
  });

  it('removes mutation permissions for historical version rendering', () => {
    assert.match(controller, /canUpdateTemplate: canUpdateTemplate && Boolean\(template\.currentVersion\?\.isLatest\)/);
    assert.match(controller, /canDeleteTemplate: canDeleteTemplate && Boolean\(template\.currentVersion\?\.isLatest\)/);
    assert.match(script, /const canUpdate = Boolean\(config\.canUpdateTemplate\) && !isHistoricalView/);
    assert.match(script, /if \(!canUpdate\) return;/);
    assert.match(view, /#stageModal button:not\(\[data-bs-dismiss\]\)/);
    assert.match(view, /#taskModal button:not\(\[data-bs-dismiss\]\)/);
  });
});
