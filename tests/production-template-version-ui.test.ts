import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync('src/public/js/production-template-detail.js', 'utf8');
const view = readFileSync('src/views/dashboard/production/templates/show.ejs', 'utf8');
const controller = readFileSync('src/modules/production/template/production-template.web.controller.ts', 'utf8');
const routes = readFileSync('src/modules/production/template/production-template.route.ts', 'utf8');

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

  it('saves edits directly when the template has no production room', () => {
    assert.match(script, /!previewData\.isTemplateUsedByRoom \|\| previewData\.isNewVersionMandatory/);
    assert.match(script, /await editingSession\.commit\('AUTO'\)/);
    assert.match(script, /if \(previewData\.classification === 'NONE'/);
  });

  it('automatically forks structural edits after the first room, without a decision dialog', () => {
    assert.match(script, /if \(!previewData\.isTemplateUsedByRoom \|\| previewData\.isNewVersionMandatory\) \{/);
    assert.match(script, /await editingSession\.commit\('AUTO'\);\s*return;/);
  });

  it('shows only two choices for MINOR edits on a template linked to a room', () => {
    assert.match(script, /const radioOverwrite = document\.getElementById\('radioDecisionOverwrite'\)/);
    assert.match(script, /const radioNewVersion = document\.getElementById\('radioDecisionNewVersion'\)/);
    assert.match(script, /radioOverwrite\.checked = true/);
    assert.match(script, /bootstrap\.Modal\.getOrCreateInstance\(modalEl\)\.show\(\)/);
    assert.match(view, /id="radioDecisionOverwrite" value="OVERWRITE_CURRENT" checked/);
    assert.match(view, /id="radioDecisionNewVersion" value="NEW_VERSION"/);
    assert.doesNotMatch(view, /id="radioDecisionAuto"/);
  });

  it('requires versioned editing for direct workflow API mutations once a room exists', () => {
    assert.match(routes, /productionTemplateApiRouter\.use\('\/:id', async \(req, _res, next\)/);
    assert.match(routes, /hasEverBeenAssignedToProductionUnit\(templateId\)/);
    assert.match(routes, /PRODUCTION_TEMPLATE_VERSIONED_EDIT_REQUIRED/);
    assert.ok(routes.indexOf("'/:id/editing/commit'") < routes.indexOf("productionTemplateApiRouter.use('/:id'"));
    assert.ok(routes.indexOf("productionTemplateApiRouter.use('/:id'") < routes.indexOf("'/:id/stages'"));
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
