import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync('src/public/js/production-template-detail.js', 'utf8');
const view = readFileSync('src/views/dashboard/production/templates/show.ejs', 'utf8');
const controller = readFileSync('src/modules/production/template/production-template.web.controller.ts', 'utf8');

describe('Template version navigation and historical mode regression', () => {
  it('keeps the selected information, specifications, or workflow workspace tab', () => {
    assert.match(view, /template-version-link/);
    assert.doesNotMatch(view, /versionId=<%= v\.id %>#workflow/);
    assert.match(script, /function currentWorkspaceHash\(\)/);
    assert.match(script, /#pane-template-info/);
    assert.match(script, /#pane-template-specifications/);
    assert.match(script, /#pane-template-workflow/);
    assert.match(script, /link\.href = link\.href\.split\('#'\)\[0\] \+ currentWorkspaceHash\(\)/);
    assert.match(script, /encodeURIComponent\(selectedVerId\) \+ currentWorkspaceHash\(\)/);
    assert.match(script, /const currentHash = window\.location\.hash\.toLowerCase\(\)/);
  });

  it('returns to latest version in the currently selected tab', () => {
    assert.match(script, /templateId \+ currentWorkspaceHash\(\)/);
  });

  it('keeps workflow open after saving a workflow editing session', () => {
    assert.match(script, /encodeURIComponent\(json\.data\.targetVersionId\) \+ currentWorkspaceHash\(\)/);
  });

  it('prevents version switching with unsaved draft changes', () => {
    assert.match(script, /if \(editingSession\.getPendingCount\(\) > 0\)/);
    assert.match(script, /تعديلات غير محفوظة/);
  });

  it('hides manual new-version creation while no production room references the template', () => {
    assert.match(script, /const templateHasRoom = Boolean\(previewData\.isTemplateUsedByRoom\)/);
    assert.match(script, /if \(radioNewVersion\) radioNewVersion\.disabled = !templateHasRoom/);
    assert.match(script, /لم يرتبط القالب بغرفة إنتاج/);
  });

  it('does not display the historical warning on the latest version', () => {
    assert.match(view, /!template\.currentVersion\.isLatest\) \? 'd-flex' : 'd-none'/);
  });

  it('removes mutation permissions for historical version rendering', () => {
    assert.match(controller, /canUpdateTemplate: canUpdateTemplate && Boolean\(template\.currentVersion\?\.isLatest\)/);
    assert.match(controller, /canDeleteTemplate: canDeleteTemplate && Boolean\(template\.currentVersion\?\.isLatest\)/);
    assert.match(script, /const canUpdate = Boolean\(config\.canUpdateTemplate\) && !isHistoricalView/);
    assert.match(script, /if \(!canUpdate\) return;/);
    assert.match(view, /#stageModal button\[type="submit"\]/);
    assert.match(view, /#taskModal button\[type="submit"\]/);
  });
});
