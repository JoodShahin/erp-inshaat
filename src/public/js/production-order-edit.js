/**
 * Production Order Draft Editor Workspace
 *
 * Implements:
 * 1. Unified lines editor: All lines (both pre-existing and newly added) are rendered
 *    in the unified workspace under the search input with identical horizontal card layout.
 * 2. Search-first template picker: NO initial fetch on boot, debounced (300ms) query search,
 *    monotonic race protection counter, results displayed directly below search input.
 * 3. Immediate client duplicate detection across ALL lines:
 *    Canonical key = templateId + '|' + sorted(patternId:optionId).
 *    Blocks saving if any duplicate configurations exist.
 * 4. Single Atomic Draft Save:
 *    Sends ONE PUT /api/production/orders/:id/draft-lines request with target active lines state.
 *    Single DB transaction, single pessimistic_write lock on backend, all-or-nothing.
 *    Redirects to Order Show page (/production/orders/:id) on success with toast.
 * 5. Quantity UX:
 *    Number(val) and Number.isInteger(val) validation (1..10000).
 *    Strictly NO parseInt (decimals like 2.5 rejected).
 *    Zero DOM rebuilding on input keystrokes to preserve user focus and caret position.
 * 6. Template Sync Preview:
 *    Restores "مزامنة مع القالب" using GET /api/production/orders/:id/lines/:lineId/sync-preview.
 *    Updates in-memory draft state only until final atomic save.
 * 7. Unsaved Changes Guard:
 *    hasUnsavedLineChanges() protects header links, bottom cancel button, and beforeunload.
 * 8. Zero XSS:
 *    Native DOM APIs (createElement, textContent, append) exclusively for user and API texts.
 * 9. SweetAlert2 Invariants: Zero native window dialogs; all prompts use Swal.
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initial State Initialization
  const initialDataEl = document.getElementById('initialOrderData');
  if (!initialDataEl) return;

  let currentOrder = null;
  try {
    currentOrder = JSON.parse(initialDataEl.textContent || '{}');
  } catch (err) {
    console.error('Failed to parse initial order JSON:', err);
    return;
  }

  const orderId = currentOrder.id;

  // 2. Monotonic Sequence Counters (NEVER reset to zero)
  let templatePickerRequestSeq = 0;
  let templateConfigurationRequestSeq = 0;

  // Search State
  let templateSearchTerm = '';
  let templateCurrentPage = 1;
  let templateTotalPages = 1;
  let templateSearchDebounceTimer = null;
  const loadedTemplateIds = new Set();

  // Navigation Guard Bypass Flag (set to true right before intentional redirect)
  let isBypassingUnloadGuard = false;

  // Unified In-Memory Lines State
  // Each line: { id, isNew, template: { id, name, code, referenceNumber }, quantity, originalQuantity, patterns: [...], originalSelections: Map, isSynced: boolean, validationErrors: [] }
  let lines = (currentOrder.lines || []).map((line) => ({
    id: line.id,
    isNew: false,
    template: {
      id: line.templateId,
      name: line.template ? line.template.name : 'قالب',
      code: line.template ? line.template.code : '—',
      referenceNumber: line.template?.referenceNumber || null,
    },
    quantity: line.quantity,
    originalQuantity: line.quantity,
    patterns: (line.patternSelections || []).map((sel) => ({
      patternId: sel.templatePatternId,
      patternName: sel.patternName,
      selectedOptionId: sel.selectedOptionId,
      availableOptions: sel.availableOptions || [],
      isPatternActive: sel.isPatternActive !== false,
      isSelectedOptionActive: sel.isSelectedOptionActive !== false,
      isHistorical: sel.isHistorical === true,
      historicalOptionName: sel.isHistorical ? sel.selectedOptionName : null,
    })),
    originalSelections: new Map(
      (line.patternSelections || []).map((sel) => [sel.templatePatternId, sel.selectedOptionId])
    ),
    isSynced: false,
    validationErrors: [],
  }));

  const initialLineCount = lines.length;
  const initialLineIds = lines.map((l) => l.id);

  // DOM Elements - Workspace & Summary
  const orderAlert = document.getElementById('orderAlert');
  const readinessStatusBadge = document.getElementById('readinessStatusBadge');
  const readinessPanel = document.getElementById('readinessPanel');
  const readinessIssuesList = document.getElementById('readinessIssuesList');
  const recheckReadinessBtn = document.getElementById('recheckReadinessBtn');
  const headerLineCount = document.getElementById('headerLineCount');
  const headerTotalQuantity = document.getElementById('headerTotalQuantity');
  const existingLinesCountBadge = document.getElementById('existingLinesCountBadge');
  const orderLinesContainer = document.getElementById('orderLinesContainer');
  const emptyLinesState = document.getElementById('emptyLinesState');

  // DOM Elements - Search-First Composer
  const templateSearchInput = document.getElementById('templateSearchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const searchResultsWrapper = document.getElementById('searchResultsWrapper');
  const searchResultsList = document.getElementById('searchResultsList');
  const templateLoadMoreBtn = document.getElementById('templateLoadMoreBtn');
  const composerAlert = document.getElementById('composerAlert');

  // DOM Elements - Bottom Save Action
  const submitPendingLinesBtn = document.getElementById('submitPendingLinesBtn');
  const submitPendingLinesBtnText = document.getElementById('submitPendingLinesBtnText');
  const submitPendingSpinner = document.getElementById('submitPendingSpinner');
  const submitPendingIcon = document.getElementById('submitPendingIcon');

  // DOM Elements - Navigation & Actions
  const viewOrderNavBtn = document.getElementById('viewOrderNavBtn');
  const backToListNavBtn = document.getElementById('backToListNavBtn');
  const bottomCancelBtn = document.getElementById('bottomCancelBtn');
  const archiveOrderBtn = document.getElementById('archiveOrderBtn');

  // DOM Elements - Edit Header Modal
  const editHeaderBtn = document.getElementById('editHeaderBtn');
  const editHeaderModalEl = document.getElementById('editHeaderModal');
  const editHeaderModal = editHeaderModalEl ? new bootstrap.Modal(editHeaderModalEl) : null;
  const editHeaderForm = document.getElementById('editHeaderForm');
  const editDescriptionInput = document.getElementById('editDescriptionInput');
  const editNotesInput = document.getElementById('editNotesInput');
  const editHeaderAlert = document.getElementById('editHeaderAlert');
  const confirmEditHeaderBtn = document.getElementById('confirmEditHeaderBtn');
  const orderDescriptionText = document.getElementById('orderDescriptionText');
  const orderNotesBox = document.getElementById('orderNotesBox');

  // =========================================================================
  // Helpers: API Error Extraction & Feedback
  // =========================================================================
  function getErrorMessage(json, fallback) {
    if (typeof window.extractApiErrorMessage === 'function') {
      return window.extractApiErrorMessage(json, fallback);
    }
    return (json && json.message) || fallback || 'حدث خطأ غير متوقع';
  }

  function showSuccessToast(message) {
    if (typeof Swal !== 'undefined') {
      Swal.mixin({
        toast: true,
        position: 'top-start',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
      }).fire({
        icon: 'success',
        title: message,
      });
    }
  }

  function showComposerAlert(message) {
    if (!composerAlert) return;
    composerAlert.textContent = message;
    composerAlert.classList.remove('d-none');
  }

  function clearComposerAlert() {
    if (!composerAlert) return;
    composerAlert.textContent = '';
    composerAlert.classList.add('d-none');
  }

  // =========================================================================
  // Dirty State Detection (Unsaved Changes)
  // =========================================================================
  function hasUnsavedLineChanges() {
    // 1. Line count changed (additions or deletions)
    if (lines.length !== initialLineCount) {
      return true;
    }

    // 2. New lines added
    if (lines.some((l) => l.isNew)) {
      return true;
    }

    // 3. Line order changed or deleted lines replaced
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].id !== initialLineIds[i]) {
        return true;
      }
    }

    // 4. Existing line modifications (quantity, pattern selection, sync)
    for (const line of lines) {
      if (line.isSynced) {
        return true;
      }
      if (line.quantity !== line.originalQuantity) {
        return true;
      }
      for (const pat of line.patterns) {
        const orig = line.originalSelections.get(pat.patternId);
        if (pat.selectedOptionId !== orig) {
          return true;
        }
      }
    }

    return false;
  }

  // =========================================================================
  // Canonical Key & Duplication Rules
  // Key format: templateId + '|' + sorted(patternId:optionId). Quantity is NOT part of key.
  // =========================================================================
  function canonicalizeConfiguration(templateId, selections) {
    if (!selections || selections.length === 0) {
      return templateId;
    }
    const sorted = [...selections].sort((a, b) => a.patternId.localeCompare(b.patternId));
    const parts = sorted.map((s) => `${s.patternId}:${s.optionId}`);
    return `${templateId}|${parts.join('|')}`;
  }

  // The exclusion rule applies to COMPLETE template/option combinations.
  // Prefix filtering leaves an option visible only if at least one unused
  // completion remains for the patterns that follow it.
  function optionHasUnusedCompletion(line, patternIndex, optionId) {
    const prefix = line.patterns.slice(0, patternIndex).map((p) => p.selectedOptionId);
    if (prefix.some((id) => !id)) return true;
    prefix.push(optionId);

    const otherLines = lines.filter((other) =>
      other !== line && other.template.id === line.template.id &&
      other.patterns.length === line.patterns.length
    );
    const usedSuffixes = new Set();
    for (const other of otherLines) {
      const samePrefix = prefix.every((id, i) =>
        other.patterns[i].patternId === line.patterns[i].patternId &&
        other.patterns[i].selectedOptionId === id
      );
      if (samePrefix) {
        usedSuffixes.add(other.patterns.slice(patternIndex + 1)
          .map((p) => p.patternId + ':' + p.selectedOptionId).join('|'));
      }
    }

    const remaining = line.patterns.slice(patternIndex + 1);
    const combinations = remaining.reduce((count, p) =>
      count * (p.availableOptions || []).length, 1);
    return combinations > usedSuffixes.size;
  }

  function pickUnusedCombination(line) {
    if (!line.patterns.length) {
      return !lines.some((l) => l !== line && l.template.id === line.template.id);
    }
    for (let i = 0; i < line.patterns.length; i++) {
      const pat = line.patterns[i];
      const available = (pat.availableOptions || []).filter((opt) =>
        optionHasUnusedCompletion(line, i, opt.id));
      if (!available.length) return false;
      if (!available.some((opt) => opt.id === pat.selectedOptionId)) {
        pat.selectedOptionId = available[0].id;
      }
    }
    return true;
  }

  /**
   * Evaluates all lines for validity and duplicates across the entire order.
   * Returns true if all lines are valid.
   */
  function evaluateLines() {
    let allValid = true;
    const keyMap = new Map();

    lines.forEach((line) => {
      line.validationErrors = [];

      // 1. Validate Quantity (Strictly NO parseInt! Decimal 2.5 rejected)
      const q = line.quantity;
      const numQ = typeof q === 'number' ? q : Number(q);
      if (typeof q === 'string' && q.trim() === '') {
        line.validationErrors.push('الكمية مطلوبة.');
        allValid = false;
      } else if (isNaN(numQ) || !Number.isInteger(numQ) || numQ < 1 || numQ > 10000) {
        line.validationErrors.push('الكمية يجب أن تكون عدداً صحيحاً بين 1 و 10,000.');
        allValid = false;
      }

      // 2. Validate Pattern Selections
      for (const pat of line.patterns) {
        if (!pat.availableOptions || pat.availableOptions.length === 0) {
          if (pat.isPatternActive === false) {
            line.validationErrors.push(`النمط "${pat.patternName}" لم يعد جزءاً من القالب الحالي. قم بمزامنة البند مع القالب.`);
          } else {
            line.validationErrors.push(`النمط "${pat.patternName}" لا يحتوي على خيارات فعالة. قم بمزامنة البند مع القالب.`);
          }
          allValid = false;
        } else if (!pat.selectedOptionId) {
          line.validationErrors.push(`يرجى تحديد خيار للنمط "${pat.patternName}".`);
          allValid = false;
        } else {
          const selectedExistsInActiveOptions = pat.availableOptions.some(
            (opt) => opt.id === pat.selectedOptionId
          );
          if (pat.isHistorical || !selectedExistsInActiveOptions) {
            line.validationErrors.push(
              `الخيار المحدد للنمط "${pat.patternName}" لم يعد فعالاً. قم بمزامنة البند مع القالب قبل الحفظ.`
            );
            allValid = false;
          }
        }
      }

      // 3. Compute Canonical Key
      const selections = line.patterns.map((p) => ({
        patternId: p.patternId,
        optionId: p.selectedOptionId,
      }));
      const lineKey = canonicalizeConfiguration(line.template.id, selections);
      line.canonicalKey = lineKey;

      if (!keyMap.has(lineKey)) {
        keyMap.set(lineKey, []);
      }
      keyMap.get(lineKey).push(line);
    });

    // 4. Duplicate Collision Check across ALL lines in order
    keyMap.forEach((matchedLines) => {
      if (matchedLines.length > 1) {
        allValid = false;
        matchedLines.forEach((l) => {
          l.validationErrors.push(
            'هذه التركيبة (نفس القالب ونفس خيارات الأنماط) مكررة. لا يمكن حفظ أكثر من بند بنفس التركيبة في نفس الطلب.'
          );
        });
      }
    });

    return allValid;
  }

  /**
   * Revalidates editor state WITHOUT rebuilding DOM inputs on typing keystrokes.
   * Updates error badges, input invalid classes, header summary, and save button state.
   */
  function revalidateEditor() {
    const isValid = evaluateLines();
    const isDirty = hasUnsavedLineChanges();

    // Update Header Summary
    if (headerTotalQuantity) {
      const totalQty = lines.reduce((acc, cur) => {
        const n = typeof cur.quantity === 'number' ? cur.quantity : Number(cur.quantity);
        return acc + (Number.isInteger(n) && n > 0 ? n : 0);
      }, 0);
      headerTotalQuantity.textContent = String(totalQty);
    }

    // Update each line card's error UI in-place
    const cardEls = orderLinesContainer.querySelectorAll('.editor-line-card');
    lines.forEach((line, index) => {
      const card = cardEls[index];
      if (!card) return;

      const hasErrors = line.validationErrors && line.validationErrors.length > 0;
      card.classList.toggle('is-invalid', hasErrors);

      const qtyInput = card.querySelector('input[type="number"]');
      if (qtyInput) {
        const numQ = typeof line.quantity === 'number' ? line.quantity : Number(line.quantity);
        const qtyValid = typeof line.quantity !== 'string' || line.quantity.trim() !== ''
          ? (Number.isInteger(numQ) && numQ >= 1 && numQ <= 10000)
          : false;
        qtyInput.classList.toggle('is-invalid', !qtyValid);
      }

      // Update or create error box safely
      let alertBox = card.querySelector('.line-error-box');
      if (hasErrors) {
        if (!alertBox) {
          alertBox = document.createElement('div');
          alertBox.className = 'line-error-box alert alert-warning py-2 px-3 small mt-3 mb-0';
          const body = card.querySelector('.editor-line-body');
          if (body) body.appendChild(alertBox);
        }
        alertBox.replaceChildren();
        line.validationErrors.forEach((msg) => {
          const alertItem = document.createElement('div');
          alertItem.className = 'd-flex align-items-center gap-2';

          const icon = document.createElement('i');
          icon.className = 'fa-solid fa-triangle-exclamation text-warning-emphasis';

          const span = document.createElement('span');
          span.textContent = msg;

          alertItem.append(icon, span);
          alertBox.appendChild(alertItem);
        });
      } else if (alertBox) {
        alertBox.remove();
      }
    });

    // Update Bottom Save Button State
    // Enabled only when dirty and valid
    submitPendingLinesBtn.disabled = !isDirty || !isValid;
  }

  // =========================================================================
  // Unified Lines Render
  // =========================================================================
  function renderLines() {
    const isValid = evaluateLines();
    const isDirty = hasUnsavedLineChanges();

    // Update Counter Badges & Summary
    if (existingLinesCountBadge) {
      existingLinesCountBadge.textContent = `${lines.length} بند`;
    }
    if (headerLineCount) {
      headerLineCount.textContent = String(lines.length);
    }
    if (headerTotalQuantity) {
      const totalQty = lines.reduce((acc, cur) => {
        const n = typeof cur.quantity === 'number' ? cur.quantity : Number(cur.quantity);
        return acc + (Number.isInteger(n) && n > 0 ? n : 0);
      }, 0);
      headerTotalQuantity.textContent = String(totalQty);
    }

    // Toggle Empty State
    if (lines.length === 0) {
      emptyLinesState.classList.remove('d-none');
    } else {
      emptyLinesState.classList.add('d-none');
    }

    orderLinesContainer.replaceChildren();

    lines.forEach((line, index) => {
      const card = document.createElement('div');
      const hasErrors = line.validationErrors && line.validationErrors.length > 0;
      card.className = `card editor-line-card ${hasErrors ? 'is-invalid' : ''}`;

      // 1. Card Header
      const header = document.createElement('div');
      header.className = 'editor-line-header';

      const rightDiv = document.createElement('div');
      rightDiv.className = 'd-flex align-items-center gap-2 flex-wrap';

      const badge = document.createElement('span');
      badge.className = line.isNew
        ? 'badge bg-primary text-white rounded-pill px-2 py-1 small'
        : 'badge bg-secondary-subtle text-secondary-emphasis border rounded-pill px-2 py-1 small font-monospace';
      badge.textContent = `بند #${index + 1}`;
      rightDiv.appendChild(badge);

      const nameEl = document.createElement('span');
      nameEl.className = 'fw-bold text-dark fs-6';
      nameEl.textContent = line.template.name;
      rightDiv.appendChild(nameEl);

      const codeEl = document.createElement('span');
      codeEl.className = 'text-muted small font-monospace';
      codeEl.textContent = `${line.template.code}${line.template.referenceNumber ? ' • المرجع: ' + line.template.referenceNumber : ''}`;
      rightDiv.appendChild(codeEl);

      header.appendChild(rightDiv);

      // Header Actions (Sync Button for existing lines + Remove Button [X])
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'd-flex align-items-center gap-2';

      // Reorder Buttons (Move Up / Move Down)
      if (lines.length > 1) {
        const reorderGroup = document.createElement('div');
        reorderGroup.className = 'btn-group btn-group-sm me-1';

        const moveUpBtn = document.createElement('button');
        moveUpBtn.type = 'button';
        moveUpBtn.className = 'btn btn-outline-secondary btn-sm py-1 px-2';
        moveUpBtn.style.fontSize = '0.75rem';
        moveUpBtn.title = 'تحريك للأعلى';
        moveUpBtn.setAttribute('aria-label', 'تحريك للأعلى');
        moveUpBtn.disabled = index === 0;
        const upIcon = document.createElement('i');
        upIcon.className = 'fa-solid fa-arrow-up';
        moveUpBtn.appendChild(upIcon);
        moveUpBtn.addEventListener('click', () => {
          if (index > 0) {
            const temp = lines[index];
            lines[index] = lines[index - 1];
            lines[index - 1] = temp;
            renderLines();
          }
        });

        const moveDownBtn = document.createElement('button');
        moveDownBtn.type = 'button';
        moveDownBtn.className = 'btn btn-outline-secondary btn-sm py-1 px-2';
        moveDownBtn.style.fontSize = '0.75rem';
        moveDownBtn.title = 'تحريك للأسفل';
        moveDownBtn.setAttribute('aria-label', 'تحريك للأسفل');
        moveDownBtn.disabled = index === lines.length - 1;
        const downIcon = document.createElement('i');
        downIcon.className = 'fa-solid fa-arrow-down';
        moveDownBtn.appendChild(downIcon);
        moveDownBtn.addEventListener('click', () => {
          if (index < lines.length - 1) {
            const temp = lines[index];
            lines[index] = lines[index + 1];
            lines[index + 1] = temp;
            renderLines();
          }
        });

        reorderGroup.append(moveUpBtn, moveDownBtn);
        actionsDiv.appendChild(reorderGroup);
      }

      // "مزامنة مع القالب" Button for Existing Lines
      if (!line.isNew) {
        const syncBtn = document.createElement('button');
        syncBtn.type = 'button';
        syncBtn.className = 'btn btn-outline-secondary btn-sm sync-line-btn py-1 px-2 d-inline-flex align-items-center gap-1';
        syncBtn.style.fontSize = '0.75rem';
        syncBtn.style.borderRadius = '6px';
        syncBtn.setAttribute('title', 'مزامنة خيارات الأنماط مع أحدث إعدادات القالب');

        const syncIcon = document.createElement('i');
        syncIcon.className = 'fa-solid fa-arrows-rotate';

        const syncText = document.createElement('span');
        syncText.textContent = 'مزامنة مع القالب';

        syncBtn.append(syncIcon, syncText);

        syncBtn.addEventListener('click', () => {
          onSyncLineWithTemplate(line, index, syncBtn);
        });

        actionsDiv.appendChild(syncBtn);
      }

      // Remove Button [X]
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn remove-line-btn';
      removeBtn.setAttribute('title', 'حذف هذا البند');
      removeBtn.setAttribute('aria-label', `حذف بند ${line.template.name}`);

      const removeIcon = document.createElement('i');
      removeIcon.className = 'fa-solid fa-xmark';
      removeBtn.appendChild(removeIcon);

      removeBtn.addEventListener('click', () => {
        if (line.isNew) {
          // Instant removal without confirmation for new unsaved line
          lines.splice(index, 1);
          renderLines();
        } else {
          // SweetAlert confirmation for existing line
          Swal.fire({
            title: 'حذف البند من الطلب',
            text: `هل أنت متأكد من حذف البند #${index + 1} (${line.template.name})؟ سيتم تطبيق الحذف عند حفظ أمر الإنتاج.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#EE5253',
            cancelButtonColor: '#6B7280',
            confirmButtonText: 'نعم، حذف',
            cancelButtonText: 'إلغاء',
          }).then((result) => {
            if (result.isConfirmed) {
              lines.splice(index, 1);
              renderLines();
            }
          });
        }
      });

      actionsDiv.appendChild(removeBtn);
      header.appendChild(actionsDiv);
      card.appendChild(header);

      // 2. Card Body (Horizontal Aligned Controls)
      const body = document.createElement('div');
      body.className = 'editor-line-body';

      const fieldsRow = document.createElement('div');
      fieldsRow.className = 'editor-line-fields';

      // Quantity Control
      const qtyField = document.createElement('div');
      qtyField.className = 'editor-line-field';

      const qtyLabel = document.createElement('label');
      qtyLabel.textContent = 'الكمية المخططة:';
      qtyField.appendChild(qtyLabel);

      const qtyInput = document.createElement('input');
      qtyInput.type = 'number';
      qtyInput.className = 'form-control form-control-sm font-monospace text-center';
      qtyInput.min = '1';
      qtyInput.max = '10000';
      qtyInput.step = '1';
      qtyInput.value = String(line.quantity);
      qtyInput.style.width = '100px';

      // Quantity Input Event Listener:
      // STRICTLY NO parseInt and NO renderLines() on input keystroke!
      qtyInput.addEventListener('input', (e) => {
        const raw = e.target.value;
        const num = Number(raw);
        if (raw.trim() !== '' && Number.isInteger(num) && num >= 1 && num <= 10000) {
          line.quantity = num;
        } else {
          line.quantity = raw; // stores raw value so revalidateEditor flags error
        }
        revalidateEditor();
      });

      qtyField.appendChild(qtyInput);
      fieldsRow.appendChild(qtyField);

      // Pattern Options Controls
      if (!line.patterns || line.patterns.length === 0) {
        const noPatField = document.createElement('div');
        noPatField.className = 'editor-line-field';
        const noPatBadge = document.createElement('span');
        noPatBadge.className = 'badge bg-secondary-subtle text-secondary px-3 py-2 rounded-pill mt-3';
        noPatBadge.textContent = 'بدون أنماط اختيارية';
        noPatField.appendChild(noPatBadge);
        fieldsRow.appendChild(noPatField);
      } else {
        line.patterns.forEach((pat) => {
          const patField = document.createElement('div');
          patField.className = 'editor-line-field';

          const patLabel = document.createElement('label');
          patLabel.textContent = pat.patternName;
          patField.appendChild(patLabel);

          // If option is historical/inactive, show historical note
          if (pat.isHistorical) {
            const histBadge = document.createElement('span');
            histBadge.className = 'badge bg-danger-subtle text-danger px-2 py-1 mb-1 small text-wrap';
            histBadge.textContent = pat.isPatternActive === false
              ? `النمط "${pat.patternName}" لم يعد في القالب (غير فعال)`
              : `الخيار السابق: ${pat.historicalOptionName || 'غير فعال'}`;
            patField.appendChild(histBadge);
          }

          const select = document.createElement('select');
          select.className = 'form-select form-select-sm';
          select.style.minWidth = '160px';

          const isSelectedInActive = (pat.availableOptions || []).some(
            (opt) => opt.id === pat.selectedOptionId
          );

          if (!isSelectedInActive) {
            const placeholderOpt = document.createElement('option');
            placeholderOpt.value = '';
            placeholderOpt.textContent = pat.isHistorical ? '— يحتاج مزامنة —' : '— اختر الخيار —';
            placeholderOpt.selected = true;
            placeholderOpt.disabled = true;
            select.appendChild(placeholderOpt);
          }

          const patternIndex = line.patterns.indexOf(pat);
          const availableForPrefix = (pat.availableOptions || []).filter((opt) =>
            optionHasUnusedCompletion(line, patternIndex, opt.id)
          );
          availableForPrefix.forEach((opt) => {
            const optEl = document.createElement('option');
            optEl.value = opt.id;
            optEl.textContent = opt.name;
            if (opt.id === pat.selectedOptionId) optEl.selected = true;
            select.appendChild(optEl);
          });
          if (!availableForPrefix.some((opt) => opt.id === pat.selectedOptionId)) {
            select.value = '';
            if (!select.options.length) {
              const noOptions = document.createElement('option');
              noOptions.value = '';
              noOptions.textContent = '— لا توجد تركيبة متاحة —';
              select.appendChild(noOptions);
            }
          }

          if (pat.isHistorical || pat.availableOptions.length === 0) {
            select.disabled = true;
          }

          select.addEventListener('change', (e) => {
            pat.selectedOptionId = e.target.value;
            pat.isHistorical = false;
            // Reconcile dependent choices after changing an earlier pattern.
            for (const later of line.patterns.slice(line.patterns.indexOf(pat) + 1)) {
              later.selectedOptionId = null;
            }
            pickUnusedCombination(line);
            renderLines();
          });

          patField.appendChild(select);
          fieldsRow.appendChild(patField);
        });
      }

      body.appendChild(fieldsRow);

      // Duplicate / Validation Alert
      if (hasErrors) {
        const alertBox = document.createElement('div');
        alertBox.className = 'line-error-box alert alert-warning py-2 px-3 small mt-3 mb-0';
        line.validationErrors.forEach((msg) => {
          const alertItem = document.createElement('div');
          alertItem.className = 'd-flex align-items-center gap-2';

          const icon = document.createElement('i');
          icon.className = 'fa-solid fa-triangle-exclamation text-warning-emphasis';

          const span = document.createElement('span');
          span.textContent = msg;

          alertItem.append(icon, span);
          alertBox.appendChild(alertItem);
        });
        body.appendChild(alertBox);
      }

      card.appendChild(body);
      orderLinesContainer.appendChild(card);
    });

    // Update Bottom Save Button State
    submitPendingLinesBtn.disabled = !isDirty || !isValid;
  }

  // =========================================================================
  // Template Sync Preview Action
  // Fetches preview from server and updates in-memory line state ONLY
  // =========================================================================
  async function onSyncLineWithTemplate(line, index, syncBtn) {
    Swal.fire({
      title: 'مزامنة البند مع القالب',
      text: `هل تريد مزامنة خيارات أنماط البند #${index + 1} (${line.template.name}) مع أحدث خيارات القالب؟ سيتم تحديث الخيارات في المحرر فقط ولن يتم الحفظ في قاعدة البيانات حتى تضغط حفظ أمر الإنتاج.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#0984E3',
      cancelButtonColor: '#6B7280',
      confirmButtonText: 'نعم، مزامنة',
      cancelButtonText: 'إلغاء',
    }).then(async (result) => {
      if (!result.isConfirmed) return;

      syncBtn.disabled = true;
      const originalText = syncBtn.innerHTML;
      syncBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> جاري المزامنة...';

      try {
        const res = await window.erpFetch(`/api/production/orders/${orderId}/lines/${line.id}/sync-preview`);
        const json = await res.json();

        if (!res.ok || !json.success || !json.data) {
          throw new Error(getErrorMessage(json, 'فشل جلب معاينة المزامنة مع القالب'));
        }

        const previewData = json.data;

        // Apply reconciled pattern selections to in-memory line
        line.patterns = (previewData.patternSelections || []).map((p) => ({
          patternId: p.patternId,
          patternName: p.patternName,
          selectedOptionId: p.selectedOptionId,
          availableOptions: p.availableOptions || [],
          isHistorical: p.isHistorical || false,
          historicalOptionName: p.selectedOptionName || null,
        }));
        line.isSynced = true;

        showSuccessToast('تمت مزامنة البند مع القالب في الذاكرة بنجاح');
        renderLines();
      } catch (err) {
        syncBtn.disabled = false;
        syncBtn.innerHTML = originalText;
        Swal.fire({
          icon: 'error',
          title: 'خطأ في المزامنة',
          text: err.message || 'تعذر مزامنة البند مع القالب',
          confirmButtonText: 'حسناً',
          confirmButtonColor: '#0984E3',
        });
      }
    });
  }

  // =========================================================================
  // Search-First Composer: Fetch Templates with Race Protection
  // =========================================================================
  async function executeTemplateSearch(isLoadMore = false) {
    const seq = ++templatePickerRequestSeq;
    const requestedPage = isLoadMore ? templateCurrentPage + 1 : 1;

    clearComposerAlert();

    if (!isLoadMore) {
      templateCurrentPage = 1;
      loadedTemplateIds.clear();
      searchResultsList.replaceChildren();

      const loader = document.createElement('div');
      loader.className = 'text-center py-3 text-muted small';
      loader.innerHTML = '<div class="spinner-border spinner-border-sm me-1 text-primary"></div> جاري البحث...';
      searchResultsList.appendChild(loader);
      searchResultsWrapper.classList.remove('d-none');
    } else {
      templateLoadMoreBtn.disabled = true;
      templateLoadMoreBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> جاري التحميل...';
    }

    try {
      const url = new URL('/api/production/templates/reference-options', window.location.origin);
      url.searchParams.set('page', String(requestedPage));
      url.searchParams.set('limit', '20');
      if (templateSearchTerm) {
        url.searchParams.set('search', templateSearchTerm);
      }

      const res = await window.erpFetch(url.pathname + url.search);
      const json = await res.json();

      // Discard stale out-of-order responses
      if (seq !== templatePickerRequestSeq) return;

      if (!res.ok || !json.success || !json.data) {
        throw new Error(getErrorMessage(json, 'تعذر جلب نتائج البحث'));
      }

      const { items, page, totalPages } = json.data;

      if (!Array.isArray(items) || typeof page !== 'number' || typeof totalPages !== 'number') {
        throw new Error('بيانات استجابة القوالب غير صالحة من الخادم');
      }

      templateCurrentPage = page;
      templateTotalPages = totalPages;

      if (!isLoadMore) {
        searchResultsList.replaceChildren();
      }

      if (items.length === 0 && templateCurrentPage === 1) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'text-center py-3 text-muted small';
        emptyEl.textContent = 'لم يتم العثور على قوالب تطابق البحث.';
        searchResultsList.appendChild(emptyEl);
        templateLoadMoreBtn.classList.add('d-none');
        return;
      }

      items.forEach((tmpl) => {
        if (loadedTemplateIds.has(tmpl.id)) return;
        loadedTemplateIds.add(tmpl.id);

        const resultBtn = document.createElement('button');
        resultBtn.type = 'button';
        resultBtn.className = 'list-group-item list-group-item-action search-result-btn d-flex justify-content-between align-items-center';

        const infoDiv = document.createElement('div');
        const nameEl = document.createElement('div');
        nameEl.className = 'fw-bold text-dark small';
        nameEl.textContent = tmpl.name;
        infoDiv.appendChild(nameEl);

        const metaEl = document.createElement('div');
        metaEl.className = 'text-muted small font-monospace';
        metaEl.textContent = `${tmpl.code}${tmpl.referenceNumber ? ' • المرجع: ' + tmpl.referenceNumber : ''}`;
        infoDiv.appendChild(metaEl);

        const chevron = document.createElement('i');
        chevron.className = 'fa-solid fa-chevron-left text-muted small';

        resultBtn.appendChild(infoDiv);
        resultBtn.appendChild(chevron);

        resultBtn.addEventListener('click', () => {
          onSelectTemplateFromSearch(tmpl);
        });

        searchResultsList.appendChild(resultBtn);
      });

      // Update Load More Button visibility
      if (templateCurrentPage < templateTotalPages) {
        templateLoadMoreBtn.classList.remove('d-none');
        templateLoadMoreBtn.disabled = false;
        templateLoadMoreBtn.innerHTML = '<i class="fa-solid fa-arrow-down me-1"></i> تحميل المزيد';
      } else {
        templateLoadMoreBtn.classList.add('d-none');
      }
    } catch (err) {
      if (seq !== templatePickerRequestSeq) return;

      if (!isLoadMore) {
        searchResultsList.replaceChildren();
        const errorEl = document.createElement('div');
        errorEl.className = 'text-center py-2 text-danger small';
        errorEl.textContent = err.message || 'حدث خطأ أثناء البحث';
        searchResultsList.appendChild(errorEl);
        templateLoadMoreBtn.classList.add('d-none');
      } else {
        templateLoadMoreBtn.disabled = false;
        templateLoadMoreBtn.innerHTML = '<i class="fa-solid fa-arrow-down me-1"></i> تحميل المزيد';
        showComposerAlert(err.message || 'تعذر تحميل المزيد من النتائج');
      }
    }
  }

  /**
   * User clicks a search result:
   * 1. Fetch order configuration for the template.
   * 2. Clear search input and hide search results.
   * 3. Add new line directly to lines list.
   * 4. Re-render unified lines.
   */
  async function onSelectTemplateFromSearch(tmpl) {
    const configSeq = ++templateConfigurationRequestSeq;

    // Clear search UI immediately
    templateSearchInput.value = '';
    templateSearchTerm = '';
    clearSearchBtn.classList.add('d-none');
    searchResultsWrapper.classList.add('d-none');
    searchResultsList.replaceChildren();

    try {
      const res = await window.erpFetch(`/api/production/templates/${tmpl.id}/order-configuration`);
      const json = await res.json();

      if (configSeq !== templateConfigurationRequestSeq) return;

      if (!res.ok || !json.success) {
        throw new Error(getErrorMessage(json, 'تعذر جلب إعدادات القالب'));
      }

      const config = json.data;

      // Build New Line object
      const newLine = {
        id: 'new_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        isNew: true,
        template: {
          id: tmpl.id,
          name: tmpl.name,
          code: tmpl.code,
          referenceNumber: tmpl.referenceNumber || null,
        },
        quantity: 1,
        patterns: (config.patterns || []).map((pat) => ({
          patternId: pat.id,
          patternName: pat.name,
          selectedOptionId:
            pat.defaultOptionId || (pat.options && pat.options.length > 0 ? pat.options[0].id : null),
          availableOptions: pat.options || [],
          isHistorical: false,
        })),
        originalSelections: new Map(),
        isSynced: false,
        validationErrors: [],
      };

      // A template without patterns can occur once only. For templates
      // with patterns choose the first unused full combination, not blindly
      // the first default option (which may already be occupied).
      if (!pickUnusedCombination(newLine)) {
        showComposerAlert('جميع تركيبات الأنماط لهذا القالب مستخدمة في بنود أمر الإنتاج.');
        return;
      }
      lines.push(newLine);
      renderLines();

      // Scroll smoothly to the newly added line
      const allCards = orderLinesContainer.querySelectorAll('.editor-line-card');
      if (allCards.length > 0) {
        allCards[allCards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } catch (err) {
      if (configSeq !== templateConfigurationRequestSeq) return;
      showComposerAlert(err.message || 'فشل تحميل إعدادات القالب المختار');
    }
  }

  // =========================================================================
  // Atomic Draft Commit (Single HTTP Request, Single Transaction)
  // PUT /api/production/orders/:orderId/draft-lines
  // =========================================================================
  submitPendingLinesBtn.addEventListener('click', async () => {
    clearComposerAlert();

    const isValid = evaluateLines();
    if (!isValid) {
      renderLines();
      Swal.fire({
        icon: 'warning',
        title: 'تنبيه',
        text: 'يرجى تصحيح الأخطاء والبنود المكررة قبل حفظ الطلب.',
        confirmButtonText: 'حسناً',
        confirmButtonColor: '#0984E3',
      });
      return;
    }

    submitPendingLinesBtn.disabled = true;
    submitPendingSpinner.classList.remove('d-none');
    submitPendingIcon.classList.add('d-none');
    submitPendingLinesBtnText.textContent = 'جاري الحفظ...';

    // Build Target State Payload
    const payload = {
      lines: lines.map((l) => ({
        ...(l.isNew ? {} : { id: l.id }),
        templateId: l.template.id,
        quantity: typeof l.quantity === 'number' ? l.quantity : Number(l.quantity),
        patternSelections: l.patterns.map((p) => ({
          patternId: p.patternId,
          optionId: p.selectedOptionId,
        })),
      })),
    };

    try {
      const res = await window.erpFetch(`/api/production/orders/${orderId}/draft-lines`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(getErrorMessage(json, 'فشل حفظ أمر الإنتاج'));
      }

      // Success: Bypass navigation guard, set pending toast, redirect to Order Show Page
      isBypassingUnloadGuard = true;
      sessionStorage.setItem('pendingToast', 'تم حفظ أمر الإنتاج بنجاح');
      window.location.href = `/production/orders/${orderId}`;
    } catch (err) {
      submitPendingSpinner.classList.add('d-none');
      submitPendingIcon.classList.remove('d-none');
      submitPendingLinesBtn.disabled = false;
      submitPendingLinesBtnText.textContent = 'حفظ أمر الإنتاج';

      Swal.fire({
        icon: 'error',
        title: 'خطأ أثناء الحفظ',
        text: err.message || 'حدث خطأ أثناء حفظ أمر الإنتاج',
        confirmButtonText: 'حسناً',
        confirmButtonColor: '#0984E3',
      });
    }
  });

  // =========================================================================
  // Unsaved Changes Navigation Guards
  // Protects viewOrderNavBtn, backToListNavBtn, bottomCancelBtn, and window.beforeunload
  // =========================================================================
  function guardNavigation(anchorEl) {
    if (!anchorEl) return;
    anchorEl.addEventListener('click', (e) => {
      if (hasUnsavedLineChanges()) {
        e.preventDefault();
        const targetHref = anchorEl.href;
        Swal.fire({
          title: 'لديك تغييرات غير محفوظة',
          text: 'سيتم فقدان التغييرات التي أجريتها على بنود أمر الإنتاج إذا غادرت الصفحة الآن.',
          icon: 'warning',
          showCancelButton: true,
          confirmButtonColor: '#EE5253',
          cancelButtonColor: '#6B7280',
          confirmButtonText: 'متابعة المغادرة',
          cancelButtonText: 'البقاء',
        }).then((result) => {
          if (result.isConfirmed) {
            isBypassingUnloadGuard = true;
            window.location.href = targetHref;
          }
        });
      }
    });
  }

  guardNavigation(viewOrderNavBtn);
  guardNavigation(backToListNavBtn);
  guardNavigation(bottomCancelBtn);

  window.addEventListener('beforeunload', (e) => {
    if (!isBypassingUnloadGuard && hasUnsavedLineChanges()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // =========================================================================
  // Readiness Fetch
  // =========================================================================
  async function fetchReadiness() {
    try {
      const res = await window.erpFetch(`/api/production/orders/${orderId}/release-readiness`);
      const json = await res.json();
      if (!res.ok || !json.success || !json.data) return;

      const { ready, issues } = json.data;

      if (readinessStatusBadge) {
        readinessStatusBadge.innerHTML = ready
          ? '<span class="badge bg-success-subtle text-success px-3 py-1 rounded-pill"><i class="fa-solid fa-circle-check me-1"></i> جاهز للاعتماد</span>'
          : '<span class="badge bg-danger-subtle text-danger px-3 py-1 rounded-pill"><i class="fa-solid fa-triangle-exclamation me-1"></i> يحتاج مراجعة قبل الاعتماد</span>';
      }

      if (!ready && issues && issues.length > 0) {
        readinessPanel.classList.remove('d-none');
        readinessIssuesList.replaceChildren();
        issues.forEach((issue) => {
          const li = document.createElement('li');
          li.className = 'small text-danger mb-1';
          li.textContent = issue.message;
          readinessIssuesList.appendChild(li);
        });
      } else {
        readinessPanel.classList.add('d-none');
      }
    } catch (err) {
      console.warn('Failed to fetch release readiness:', err);
    }
  }

  // =========================================================================
  // Edit Header Modal Handler
  // =========================================================================
  if (editHeaderBtn) {
    editHeaderBtn.addEventListener('click', () => {
      editDescriptionInput.value = currentOrder.description || '';
      editNotesInput.value = currentOrder.notes || '';
      editHeaderAlert.classList.add('d-none');
      editHeaderAlert.textContent = '';
      editHeaderModal.show();
    });
  }

  if (editHeaderForm) {
    editHeaderForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      confirmEditHeaderBtn.disabled = true;
      confirmEditHeaderBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> جاري الحفظ...';

      try {
        const res = await window.erpFetch(`/api/production/orders/${orderId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: editDescriptionInput.value.trim() || null,
            notes: editNotesInput.value.trim() || null,
          }),
        });

        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(getErrorMessage(json, 'فشل تحديث البيانات'));

        currentOrder.description = editDescriptionInput.value.trim() || null;
        currentOrder.notes = editNotesInput.value.trim() || null;

        if (orderDescriptionText) {
          orderDescriptionText.textContent = currentOrder.description || 'لا يوجد وصف محدد لهذا الطلب.';
        }
        if (orderNotesBox) {
          if (currentOrder.notes) {
            orderNotesBox.replaceChildren();
            const noteIcon = document.createElement('i');
            noteIcon.className = 'fa-solid fa-note-sticky me-1 text-warning';
            const strongTag = document.createElement('strong');
            strongTag.textContent = 'ملاحظات: ';
            const noteText = document.createTextNode(currentOrder.notes);
            orderNotesBox.append(noteIcon, strongTag, noteText);
            orderNotesBox.classList.remove('d-none');
          } else {
            orderNotesBox.classList.add('d-none');
          }
        }

        editHeaderModal.hide();
        showSuccessToast('تم تحديث بيانات الطلب بنجاح');
      } catch (err) {
        editHeaderAlert.textContent = err.message || 'تعذر حفظ التعديلات';
        editHeaderAlert.classList.remove('d-none');
      } finally {
        confirmEditHeaderBtn.disabled = false;
        confirmEditHeaderBtn.textContent = 'حفظ التعديلات';
      }
    });
  }

  // =========================================================================
  // Archive Order Handler (SweetAlert2)
  // =========================================================================
  if (archiveOrderBtn) {
    archiveOrderBtn.addEventListener('click', () => {
      Swal.fire({
        title: `أرشفة أمر الإنتاج ${currentOrder.orderNumber}`,
        text: `هل أنت متأكد من أرشفة أمر الإنتاج "${currentOrder.orderNumber}"؟ سيختفي من الأوامر النشطة ولن تتمكن من تعديل مسودته من القوائم العادية.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#EE5253',
        cancelButtonColor: '#6B7280',
        confirmButtonText: 'نعم، أرشفة',
        cancelButtonText: 'إلغاء',
      }).then(async (result) => {
        if (result.isConfirmed) {
          try {
            const res = await window.erpFetch(`/api/production/orders/${orderId}`, {
              method: 'DELETE',
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(getErrorMessage(json, 'فشلت أرشفة الطلب'));

            isBypassingUnloadGuard = true;
            sessionStorage.setItem('pendingToast', 'تمت أرشفة أمر الإنتاج بنجاح');
            window.location.href = '/production/orders';
          } catch (err) {
            Swal.fire({
              icon: 'error',
              title: 'تعذر الأرشفة',
              text: err.message || 'حدث خطأ أثناء أرشفة الطلب',
              confirmButtonText: 'حسناً',
              confirmButtonColor: '#0984E3',
            });
          }
        }
      });
    });
  }

  // =========================================================================
  // Search Input Event Listeners
  // =========================================================================
  templateSearchInput.addEventListener('input', (e) => {
    clearTimeout(templateSearchDebounceTimer);
    const val = e.target.value.trim();

    if (val.length === 0) {
      ++templatePickerRequestSeq;
      templateSearchTerm = '';
      clearSearchBtn.classList.add('d-none');
      searchResultsWrapper.classList.add('d-none');
      searchResultsList.replaceChildren();
      templateLoadMoreBtn.classList.add('d-none');
      return;
    }

    clearSearchBtn.classList.remove('d-none');

    templateSearchDebounceTimer = setTimeout(() => {
      templateSearchTerm = val;
      executeTemplateSearch(false);
    }, 300);
  });

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      ++templatePickerRequestSeq;
      templateSearchInput.value = '';
      templateSearchTerm = '';
      clearSearchBtn.classList.add('d-none');
      searchResultsWrapper.classList.add('d-none');
      searchResultsList.replaceChildren();
      templateLoadMoreBtn.classList.add('d-none');
      templateSearchInput.focus();
    });
  }

  templateLoadMoreBtn.addEventListener('click', () => {
    if (templateCurrentPage < templateTotalPages) {
      executeTemplateSearch(true);
    }
  });

  if (recheckReadinessBtn) {
    recheckReadinessBtn.addEventListener('click', () => {
      fetchReadiness();
    });
  }

  // =========================================================================
  // Initial Boot:
  // Render lines and readiness ONLY.
  // NO fetchTemplates() is called before user types a search keyword!
  // =========================================================================
  renderLines();
  fetchReadiness();
});
