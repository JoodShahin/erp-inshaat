/**
 * Production Template Builder Workspace Script
 * 
 * Features:
 * - Single-page Template Builder workspace
 * - In-place basic info editing (Modal + PUT API without reload)
 * - Dynamic specifications CRUD & dense reordering (Up/Down + Reorder API)
 * - Stages workflow with consecutive department grouping (presentation only)
 * - Dense stages reordering (Drag & Drop + Up/Down buttons)
 * - Unified Stage Drawer (Offcanvas) with 3 integrated tabs:
 *     1. Stage Information & Department Mutation
 *     2. Planned Materials with debounced catalog search, pagination, and on-demand units
 *     3. Reference Documents with upload, soft-delete, authenticated download, and reordering
 * - Real-time count badges synchronization on Stage Cards and Drawer tabs
 * - Native DOM APIs for XSS safety (no innerHTML with user strings)
 */

document.addEventListener('DOMContentLoaded', () => {
  function extractApiErrorMessage(responseBody, fallback) {
    if (!responseBody) return fallback || 'حدث خطأ غير متوقع';
    var errorMessages = [];
    if (responseBody.errors && typeof responseBody.errors === 'object' && !Array.isArray(responseBody.errors)) {
      Object.keys(responseBody.errors).forEach(function (key) {
        var val = responseBody.errors[key];
        if (Array.isArray(val)) {
          val.forEach(function (msg) {
            if (typeof msg === 'string' && msg.trim()) errorMessages.push(msg.trim());
          });
        } else if (typeof val === 'string' && val.trim()) {
          errorMessages.push(val.trim());
        }
      });
    } else if (Array.isArray(responseBody.errors)) {
      responseBody.errors.forEach(function (msg) {
        if (typeof msg === 'string' && msg.trim()) errorMessages.push(msg.trim());
      });
    }
    if (errorMessages.length === 0 && responseBody.message && typeof responseBody.message === 'string') {
      errorMessages.push(responseBody.message);
    }
    var uniqueMessages = Array.from(new Set(errorMessages));
    return uniqueMessages.length > 0 ? uniqueMessages.join('، ') : fallback || 'حدث خطأ أثناء معالجة الطلب';
  }
  function formatTaskDurationText(val, unit, minutes) {
    if (val != null && unit) {
      if (unit === 'DAYS') {
        return (val >= 3 && val <= 10) ? `${val} أيام` : `${val} يوم`;
      }
      if (unit === 'HOURS') {
        return (val >= 3 && val <= 10) ? `${val} ساعات` : `${val} ساعة`;
      }
      if (unit === 'MINUTES') {
        return `${val} دقيقة`;
      }
    }
    if (minutes != null && minutes > 0) {
      return `${minutes} دقيقة`;
    }
    return '';
  }

  // 1. Safely parse configuration from script[type="application/json"]
  let config = {};
  const configScript = document.getElementById('productionTemplateConfigData');
  if (configScript) {
    try {
      config = JSON.parse(configScript.textContent || '{}');
    } catch (err) {
      console.error('Failed to parse production template configuration:', err);
    }
  }

  const templateId = config.templateId;
  let currentTemplate = {
    name: config.templateName || '',
    code: config.templateCode || '',
    referenceNumber: config.templateReferenceNumber || null,
    description: config.templateDescription || null,
    isActive: Boolean(config.templateIsActive),
  };

  const canUpdate = Boolean(config.canUpdateTemplate);
  const canDelete = Boolean(config.canDeleteTemplate);

  const departmentsMap = new Map();
  (config.departments || []).forEach((d) => departmentsMap.set(d.id, d));

  let currentWorkflowItems = Array.isArray(config.initialWorkflowItems) ? [...config.initialWorkflowItems] : [];
  let currentPatterns = Array.isArray(config.initialPatterns) ? [...config.initialPatterns] : [];
  let currentStages = Array.isArray(config.initialStages) ? [...config.initialStages] : [];

  if (currentWorkflowItems.length === 0 && currentStages.length > 0) {
    currentWorkflowItems = currentStages.map((stage, idx) => ({
      id: stage.workflowItemId || stage.id,
      itemType: 'STAGE',
      sortOrder: idx + 1,
      stage: stage,
    }));
  }

  currentWorkflowItems.sort((a, b) => a.sortOrder - b.sortOrder);
  currentPatterns.forEach((p) => {
    if (p.options) {
      p.options.sort((a, b) => a.sortOrder - b.sortOrder);
      p.options.forEach((o) => {
        if (o.tasks) {
          o.tasks.sort((a, b) => a.sortOrder - b.sortOrder);
          o.tasks.forEach((t) => {
            const dept = departmentsMap.get(t.departmentId);
            if (dept) {
              t.departmentName = dept.name;
              t.departmentCode = dept.code;
            }
          });
        }
      });
    }
  });

  let currentSpecifications = Array.isArray(config.initialSpecifications) ? [...config.initialSpecifications] : [];
  currentSpecifications.sort((a, b) => a.sortOrder - b.sortOrder);

  let activeDrawerStage = null;
  let activeModalTask = null; // { patternId, optionId, task }
  let draggedWorkflowItemId = null;
  let draggedTaskId = null;
  let draggedTaskOptionId = null;

  // Catalog picker state
  let catalogSearchQuery = '';
  let catalogCurrentPage = 1;
  let catalogTotalPages = 1;
  let catalogSearchDebounceTimer = null;
  let selectedCatalogProduct = null;
  const productUnitsCache = new Map();

  // Helper: Toast notification
  function showToast(message, icon = 'success') {
    if (typeof Swal !== 'undefined') {
      const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
      });
      Toast.fire({ icon, title: message });
    }
  }

  // Check pending toast from previous action (e.g. create redirect)
  const pendingToast = sessionStorage.getItem('pendingToast');
  if (pendingToast) {
    showToast(pendingToast);
    sessionStorage.removeItem('pendingToast');
  }

  // ========================================================
  // 2. TEMPLATE BASIC INFO MANAGEMENT
  // ========================================================

  const editBasicInfoModalEl = document.getElementById('editBasicInfoModal');
  const editBasicInfoModal = editBasicInfoModalEl ? new bootstrap.Modal(editBasicInfoModalEl) : null;
  const editBasicInfoForm = document.getElementById('editBasicInfoForm');
  const btnOpenEditBasicInfo = document.getElementById('btnOpenEditBasicInfo');
  const btnQuickEditBasicInfo = document.getElementById('btnQuickEditBasicInfo');
  const btnToggleTemplateStatus = document.getElementById('btnToggleTemplateStatus');
  const btnArchiveTemplate = document.getElementById('btnArchiveTemplate');

  function openEditBasicInfo() {
    if (!editBasicInfoForm) return;
    document.getElementById('modalEditName').value = currentTemplate.name;
    document.getElementById('modalEditReference').value = currentTemplate.referenceNumber || '';
    document.getElementById('modalEditDescription').value = currentTemplate.description || '';
    document.getElementById('modalEditIsActive').checked = currentTemplate.isActive;
    editBasicInfoForm.classList.remove('was-validated');
    if (editBasicInfoModal) editBasicInfoModal.show();
  }

  if (btnOpenEditBasicInfo) btnOpenEditBasicInfo.addEventListener('click', openEditBasicInfo);
  if (btnQuickEditBasicInfo) btnQuickEditBasicInfo.addEventListener('click', openEditBasicInfo);

  if (editBasicInfoForm) {
    editBasicInfoForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!editBasicInfoForm.checkValidity()) {
        editBasicInfoForm.classList.add('was-validated');
        return;
      }

      const name = document.getElementById('modalEditName').value.trim();
      const referenceNumber = document.getElementById('modalEditReference').value.trim() || null;
      const description = document.getElementById('modalEditDescription').value.trim() || null;
      const isActive = document.getElementById('modalEditIsActive').checked;

      try {
        const res = await window.erpFetch(`/api/production/templates/${templateId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, referenceNumber, description, isActive }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          currentTemplate.name = name;
          currentTemplate.referenceNumber = referenceNumber;
          currentTemplate.description = description;
          currentTemplate.isActive = isActive;
          updateTemplateHeaderAndCards();
          if (editBasicInfoModal) editBasicInfoModal.hide();
          showToast('تم تحديث البيانات الأساسية للقالب بنجاح');
        } else {
          Swal.fire('خطأ', data.message || 'تعذر تحديث بيانات القالب', 'error');
        }
      } catch {
        Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
      }
    });
  }

  function updateTemplateHeaderAndCards() {
    const elHeaderName = document.getElementById('headerTemplateName');
    if (elHeaderName) elHeaderName.textContent = currentTemplate.name;

    const elCardName = document.getElementById('cardTemplateName');
    if (elCardName) elCardName.textContent = currentTemplate.name;

    const elHeaderRef = document.getElementById('headerTemplateReference');
    if (elHeaderRef) elHeaderRef.textContent = currentTemplate.referenceNumber || 'غير محدد';

    const elCardRef = document.getElementById('cardTemplateReference');
    if (elCardRef) elCardRef.textContent = currentTemplate.referenceNumber || 'غير محدد';

    const elHeaderDesc = document.getElementById('headerTemplateDescription');
    if (elHeaderDesc) elHeaderDesc.textContent = currentTemplate.description || 'لا يوجد وصف مضاف للقالب.';

    const elCardDesc = document.getElementById('cardTemplateDescription');
    if (elCardDesc) elCardDesc.textContent = currentTemplate.description || 'لا يوجد وصف مضاف لهذا القالب.';

    const badge = document.getElementById('headerStatusBadge');
    const text = document.getElementById('headerStatusText');
    const btnToggleText = document.getElementById('btnToggleStatusText');

    if (badge && text) {
      if (currentTemplate.isActive) {
        badge.className = 'badge bg-success-subtle text-success px-3 py-1 rounded-pill';
        badge.querySelector('i').className = 'fa-solid fa-circle-check me-1';
        text.textContent = 'نشط';
      } else {
        badge.className = 'badge bg-danger-subtle text-danger px-3 py-1 rounded-pill';
        badge.querySelector('i').className = 'fa-solid fa-circle-xmark me-1';
        text.textContent = 'معطل';
      }
    }

    if (btnToggleTemplateStatus && btnToggleText) {
      if (currentTemplate.isActive) {
        btnToggleTemplateStatus.className = 'btn btn-outline-warning d-inline-flex align-items-center gap-2';
        btnToggleTemplateStatus.querySelector('i').className = 'fa-solid fa-ban';
        btnToggleText.textContent = 'تعطيل القالب';
      } else {
        btnToggleTemplateStatus.className = 'btn btn-outline-success d-inline-flex align-items-center gap-2';
        btnToggleTemplateStatus.querySelector('i').className = 'fa-solid fa-check';
        btnToggleText.textContent = 'تفعيل القالب';
      }
    }
  }

  // Toggle Status
  if (btnToggleTemplateStatus) {
    btnToggleTemplateStatus.addEventListener('click', async () => {
      const nextActive = !currentTemplate.isActive;
      const actionTitle = nextActive ? 'تفعيل القالب' : 'تعطيل القالب';
      const actionText = nextActive
        ? 'هل أنت متأكد من تفعيل هذا القالب ليكون متاحاً في أوامر الإنتاج؟'
        : 'هل أنت متأكد من تعطيل هذا القالب؟';

      const result = await Swal.fire({
        title: actionTitle,
        text: actionText,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'نعم، تابع',
        cancelButtonText: 'إلغاء',
      });

      if (result.isConfirmed) {
        try {
          const res = await window.erpFetch(`/api/production/templates/${templateId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive: nextActive }),
          });
          const data = await res.json();
          if (res.ok && data.success) {
            currentTemplate.isActive = nextActive;
            updateTemplateHeaderAndCards();
            showToast(nextActive ? 'تم تفعيل القالب بنجاح' : 'تم تعطيل القالب بنجاح');
          } else {
            Swal.fire('خطأ', data.message || 'تعذر تعديل حالة القالب', 'error');
          }
        } catch {
          Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
        }
      }
    });
  }

  // Archive Template
  if (btnArchiveTemplate) {
    btnArchiveTemplate.addEventListener('click', async () => {
      const result = await Swal.fire({
        title: 'أرشفة القالب بالكامل',
        text: 'هل أنت متأكد من أرشفة هذا القالب ومراحله ومواصفاته؟ لن يمكن استخدامه في أوامر إنتاج جديدة.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc3545',
        confirmButtonText: 'نعم، أرشفة القالب',
        cancelButtonText: 'إلغاء',
      });

      if (result.isConfirmed) {
        try {
          const res = await window.erpFetch(`/api/production/templates/${templateId}`, {
            method: 'DELETE',
          });
          const data = await res.json();
          if (res.ok && data.success) {
            sessionStorage.setItem('pendingToast', 'تمت أرشفة القالب بنجاح');
            window.location.href = '/production/templates';
          } else {
            Swal.fire('خطأ', data.message || 'تعذر أرشفة القالب', 'error');
          }
        } catch {
          Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
        }
      }
    });
  }

  // ========================================================
  // 3. SPECIFICATIONS MANAGEMENT & REORDERING
  // ========================================================

  const specsContainer = document.getElementById('specificationsContainer');
  const btnOpenAddSpecModal = document.getElementById('btnOpenAddSpecModal');
  const addSpecModalEl = document.getElementById('addSpecModal');
  const addSpecModal = addSpecModalEl ? new bootstrap.Modal(addSpecModalEl) : null;
  const addSpecForm = document.getElementById('addSpecForm');

  const editSpecModalEl = document.getElementById('editSpecModal');
  const editSpecModal = editSpecModalEl ? new bootstrap.Modal(editSpecModalEl) : null;
  const editSpecForm = document.getElementById('editSpecForm');

  if (btnOpenAddSpecModal) {
    btnOpenAddSpecModal.addEventListener('click', () => {
      if (addSpecForm) {
        addSpecForm.reset();
        addSpecForm.classList.remove('was-validated');
      }
      if (addSpecModal) addSpecModal.show();
    });
  }

  if (addSpecForm) {
    addSpecForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!addSpecForm.checkValidity()) {
        addSpecForm.classList.add('was-validated');
        return;
      }

      const name = document.getElementById('newSpecName').value.trim();
      const value = document.getElementById('newSpecValue').value.trim();
      const unit = document.getElementById('newSpecUnit').value.trim() || undefined;

      try {
        const res = await window.erpFetch(`/api/production/templates/${templateId}/specifications`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, value, unit }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          currentSpecifications.push(data.data);
          currentSpecifications.sort((a, b) => a.sortOrder - b.sortOrder);
          renderSpecifications();
          if (addSpecModal) addSpecModal.hide();
          showToast('تمت إضافة الخاصية بنجاح');
        } else {
          Swal.fire('خطأ', data.message || 'تعذر إضافة الخاصية', 'error');
        }
      } catch {
        Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
      }
    });
  }

  if (editSpecForm) {
    editSpecForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!editSpecForm.checkValidity()) {
        editSpecForm.classList.add('was-validated');
        return;
      }

      const specId = document.getElementById('editSpecId').value;
      const name = document.getElementById('editSpecName').value.trim();
      const value = document.getElementById('editSpecValue').value.trim();
      const unit = document.getElementById('editSpecUnit').value.trim() || null;

      try {
        const res = await window.erpFetch(`/api/production/templates/${templateId}/specifications/${specId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, value, unit }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          const idx = currentSpecifications.findIndex((s) => s.id === specId);
          if (idx !== -1) {
            currentSpecifications[idx] = data.data;
            renderSpecifications();
          }
          if (editSpecModal) editSpecModal.hide();
          showToast('تم تعديل الخاصية بنجاح');
        } else {
          Swal.fire('خطأ', data.message || 'تعذر تعديل الخاصية', 'error');
        }
      } catch {
        Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
      }
    });
  }

  function renderSpecifications() {
    if (!specsContainer) return;
    specsContainer.replaceChildren();

    const specCountEl = document.getElementById('headerSpecCount');
    if (specCountEl) specCountEl.textContent = currentSpecifications.length;
    const navSpecBadge = document.getElementById('navSpecCountBadge');
    if (navSpecBadge) navSpecBadge.textContent = currentSpecifications.length;

    if (currentSpecifications.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'text-center py-4 text-muted border border-dashed rounded-3 bg-light bg-opacity-50';
      const icon = document.createElement('i');
      icon.className = 'fa-solid fa-ruler-combined fs-2 mb-2 text-secondary opacity-50';
      const p1 = document.createElement('p');
      p1.className = 'mb-1 fw-bold';
      p1.textContent = 'لم تتم إضافة مواصفات لهذا القالب بعد.';
      const p2 = document.createElement('p');
      p2.className = 'small text-muted mb-2';
      p2.textContent = 'انقر على زر "إضافة خاصية" لإدخال أبعاد ومواصفات المنتج.';
      emptyDiv.append(icon, p1, p2);

      if (canUpdate) {
        const btnAdd = document.createElement('button');
        btnAdd.type = 'button';
        btnAdd.className = 'btn btn-sm btn-outline-primary';
        btnAdd.textContent = 'إضافة أول مواصفة';
        btnAdd.addEventListener('click', () => {
          if (addSpecModal) addSpecModal.show();
        });
        emptyDiv.appendChild(btnAdd);
      }
      specsContainer.appendChild(emptyDiv);
      return;
    }

    currentSpecifications.forEach((spec, index) => {
      const card = document.createElement('div');
      card.className = 'card border p-2 spec-item';
      card.style.borderRadius = '8px';
      card.dataset.specId = spec.id;

      const innerFlex = document.createElement('div');
      innerFlex.className = 'd-flex justify-content-between align-items-center';

      const infoDiv = document.createElement('div');
      const nameStrong = document.createElement('strong');
      nameStrong.className = 'text-dark spec-display-name';
      nameStrong.textContent = spec.name;

      const valDiv = document.createElement('div');
      valDiv.className = 'text-muted small';
      const valBadge = document.createElement('span');
      valBadge.className = 'badge bg-light text-dark border spec-display-value';
      valBadge.textContent = spec.value;
      valDiv.appendChild(valBadge);

      if (spec.unit) {
        const unitSpan = document.createElement('span');
        unitSpan.className = 'ms-1 spec-display-unit';
        unitSpan.textContent = spec.unit;
        valDiv.appendChild(unitSpan);
      }
      infoDiv.append(nameStrong, valDiv);
      innerFlex.appendChild(infoDiv);

      if (canUpdate) {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'd-flex align-items-center gap-1';

        // Up Button
        const btnUp = document.createElement('button');
        btnUp.type = 'button';
        btnUp.className = 'btn btn-sm btn-light p-1 btn-move-spec-up';
        btnUp.title = 'تحريك لأعلى';
        btnUp.disabled = index === 0;
        const iconUp = document.createElement('i');
        iconUp.className = 'fa-solid fa-arrow-up text-secondary';
        btnUp.appendChild(iconUp);
        btnUp.addEventListener('click', () => moveSpec(index, -1));

        // Down Button
        const btnDown = document.createElement('button');
        btnDown.type = 'button';
        btnDown.className = 'btn btn-sm btn-light p-1 btn-move-spec-down';
        btnDown.title = 'تحريك لأسفل';
        btnDown.disabled = index === currentSpecifications.length - 1;
        const iconDown = document.createElement('i');
        iconDown.className = 'fa-solid fa-arrow-down text-secondary';
        btnDown.appendChild(iconDown);
        btnDown.addEventListener('click', () => moveSpec(index, 1));

        // Edit Button
        const btnEdit = document.createElement('button');
        btnEdit.type = 'button';
        btnEdit.className = 'btn btn-sm btn-light p-1 btn-edit-spec';
        btnEdit.title = 'تعديل';
        const iconEdit = document.createElement('i');
        iconEdit.className = 'fa-solid fa-pen text-primary';
        btnEdit.appendChild(iconEdit);
        btnEdit.addEventListener('click', () => {
          document.getElementById('editSpecId').value = spec.id;
          document.getElementById('editSpecName').value = spec.name;
          document.getElementById('editSpecValue').value = spec.value;
          document.getElementById('editSpecUnit').value = spec.unit || '';
          if (editSpecModal) editSpecModal.show();
        });

        // Delete Button
        const btnDelete = document.createElement('button');
        btnDelete.type = 'button';
        btnDelete.className = 'btn btn-sm btn-light p-1 btn-delete-spec';
        btnDelete.title = 'حذف';
        const iconDelete = document.createElement('i');
        iconDelete.className = 'fa-solid fa-trash-can text-danger';
        btnDelete.appendChild(iconDelete);
        btnDelete.addEventListener('click', async () => {
          const resConfirm = await Swal.fire({
            title: 'حذف الخاصية',
            text: `هل أنت متأكد من حذف خاصية "${spec.name}"؟`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc3545',
            confirmButtonText: 'نعم، حذف',
            cancelButtonText: 'إلغاء',
          });
          if (resConfirm.isConfirmed) {
            try {
              const res = await window.erpFetch(`/api/production/templates/${templateId}/specifications/${spec.id}`, {
                method: 'DELETE',
              });
              const data = await res.json();
              if (res.ok && data.success) {
                currentSpecifications = currentSpecifications.filter((s) => s.id !== spec.id);
                currentSpecifications.forEach((s, idx) => {
                  s.sortOrder = idx + 1;
                });
                renderSpecifications();
                showToast('تم حذف الخاصية بنجاح');
              } else {
                Swal.fire('خطأ', data.message || 'تعذر حذف الخاصية', 'error');
              }
            } catch {
              Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
            }
          }
        });

        actionsDiv.append(btnUp, btnDown, btnEdit, btnDelete);
        innerFlex.appendChild(actionsDiv);
      }

      card.appendChild(innerFlex);
      specsContainer.appendChild(card);
    });
  }

  async function moveSpec(index, offset) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= currentSpecifications.length) return;

    const previousOrder = [...currentSpecifications];
    const item = currentSpecifications.splice(index, 1)[0];
    currentSpecifications.splice(targetIndex, 0, item);

    currentSpecifications.forEach((s, idx) => {
      s.sortOrder = idx + 1;
    });
    renderSpecifications();

    const specIds = currentSpecifications.map((s) => s.id);
    try {
      const res = await window.erpFetch(`/api/production/templates/${templateId}/specifications/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specIds }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        currentSpecifications = previousOrder;
        renderSpecifications();
        Swal.fire('خطأ', data.message || 'تعذر إعادة ترتيب المواصفات', 'error');
      }
    } catch {
      currentSpecifications = previousOrder;
      renderSpecifications();
      Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
    }
  }

  // ========================================================
  // 4. MIXED WORKFLOW & PATTERNS & STAGES
  // ========================================================

  const workflowContainer = document.getElementById('workflowGroupsContainer');
  const emptyStagesNotice = document.getElementById('emptyStagesNotice');
  const headerStageCount = document.getElementById('headerStageCount');
  const headerPatternCount = document.getElementById('headerPatternCount');
  const btnOpenAddStageModal = document.getElementById('btnOpenAddStageModal');
  const btnOpenAddPatternModal = document.getElementById('btnOpenAddPatternModal');

  // Modals
  const addStageModalEl = document.getElementById('addStageModal');
  const addStageModal = addStageModalEl ? new bootstrap.Modal(addStageModalEl) : null;
  const addStageForm = document.getElementById('addStageForm');

  const addPatternModalEl = document.getElementById('addPatternModal');
  const addPatternModal = addPatternModalEl ? new bootstrap.Modal(addPatternModalEl) : null;
  const addPatternForm = document.getElementById('addPatternForm');

  const editPatternModalEl = document.getElementById('editPatternModal');
  const editPatternModal = editPatternModalEl ? new bootstrap.Modal(editPatternModalEl) : null;
  const editPatternForm = document.getElementById('editPatternForm');

  const addOptionModalEl = document.getElementById('addOptionModal');
  const addOptionModal = addOptionModalEl ? new bootstrap.Modal(addOptionModalEl) : null;
  const addOptionForm = document.getElementById('addOptionForm');

  const editOptionModalEl = document.getElementById('editOptionModal');
  const editOptionModal = editOptionModalEl ? new bootstrap.Modal(editOptionModalEl) : null;
  const editOptionForm = document.getElementById('editOptionForm');

  const addTaskModalEl = document.getElementById('addTaskModal');
  const addTaskModal = addTaskModalEl ? new bootstrap.Modal(addTaskModalEl) : null;
  const addTaskForm = document.getElementById('addTaskForm');

  const taskModalEl = document.getElementById('taskModal');
  const taskModal = taskModalEl ? new bootstrap.Modal(taskModalEl) : null;
  const taskInfoForm = document.getElementById('taskInfoForm');

  // Add Stage Button & Form
  if (btnOpenAddStageModal) {
    btnOpenAddStageModal.addEventListener('click', () => {
      if (addStageForm) {
        addStageForm.reset();
        addStageForm.classList.remove('was-validated');
      }
      if (addStageModal) addStageModal.show();
    });
  }

  if (addStageForm) {
    addStageForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!addStageForm.checkValidity()) {
        addStageForm.classList.add('was-validated');
        return;
      }

      const name = document.getElementById('newStageName').value.trim();
      const departmentId = document.getElementById('newStageDepartmentId').value;
      const durationVal = document.getElementById('newStageDuration').value.trim();
      const durationUnitSelect = document.getElementById('newStageDurationUnit');
      const durationUnit = durationUnitSelect ? durationUnitSelect.value : 'MINUTES';
      const costVal = document.getElementById('newStageCost').value.trim();
      const description = document.getElementById('newStageDescription').value.trim() || undefined;

      const payload = {
        name,
        departmentId,
        estimatedDurationValue: durationVal ? parseInt(durationVal, 10) : null,
        estimatedDurationUnit: durationVal ? durationUnit : null,
        estimatedCost: costVal ? costVal : undefined,
        description,
      };

      try {
        const res = await window.erpFetch(`/api/production/templates/${templateId}/stages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          const wfRes = await window.erpFetch(`/api/production/templates/${templateId}/workflow`);
          const wfData = await wfRes.json();
          if (wfRes.ok && wfData.success) {
            currentWorkflowItems = wfData.data;
            currentWorkflowItems.sort((a, b) => a.sortOrder - b.sortOrder);
            currentStages = currentWorkflowItems.filter((w) => w.itemType === 'STAGE').map((w) => w.stage);
            renderWorkflow();
          }
          if (addStageModal) addStageModal.hide();
          showToast('تمت إضافة المرحلة بنجاح');
        } else {
          Swal.fire('خطأ', data.message || 'تعذر إضافة المرحلة', 'error');
        }
      } catch {
        Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
      }
    });
  }

  // Add Pattern Button & Form
  if (btnOpenAddPatternModal) {
    btnOpenAddPatternModal.addEventListener('click', () => {
      if (addPatternForm) {
        addPatternForm.reset();
        addPatternForm.classList.remove('was-validated');
      }
      if (addPatternModal) addPatternModal.show();
    });
  }

  if (addPatternForm) {
    addPatternForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!addPatternForm.checkValidity()) {
        addPatternForm.classList.add('was-validated');
        return;
      }

      const name = document.getElementById('newPatternName').value.trim();
      try {
        const res = await window.erpFetch(`/api/production/templates/${templateId}/patterns`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          currentPatterns.push({ ...data.data, options: [] });
          const wfRes = await window.erpFetch(`/api/production/templates/${templateId}/workflow`);
          const wfData = await wfRes.json();
          if (wfRes.ok && wfData.success) {
            currentWorkflowItems = wfData.data;
            currentWorkflowItems.sort((a, b) => a.sortOrder - b.sortOrder);
            renderWorkflow();
          }
          if (addPatternModal) addPatternModal.hide();
          showToast('تمت إضافة النمط بنجاح');
        } else {
          Swal.fire('خطأ', data.message || 'تعذر إضافة النمط', 'error');
        }
      } catch {
        Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
      }
    });
  }

  // Edit Pattern Form
  if (editPatternForm) {
    editPatternForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!editPatternForm.checkValidity()) {
        editPatternForm.classList.add('was-validated');
        return;
      }

      const patternId = document.getElementById('editPatternId').value;
      const name = document.getElementById('editPatternName').value.trim();

      try {
        const res = await window.erpFetch(`/api/production/templates/${templateId}/patterns/${patternId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          const p = currentPatterns.find((x) => x.id === patternId);
          if (p) p.name = name;
          const wfItem = currentWorkflowItems.find(
            (w) => w.itemType === 'PATTERN' && (w.pattern?.id === patternId || w.patternId === patternId)
          );
          if (wfItem && wfItem.pattern) wfItem.pattern.name = name;
          renderWorkflow();
          if (editPatternModal) editPatternModal.hide();
          showToast('تم تحديث النمط بنجاح');
        } else {
          Swal.fire('خطأ', data.message || 'تعذر تحديث النمط', 'error');
        }
      } catch {
        Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
      }
    });
  }

  // Add Option Form
  if (addOptionForm) {
    addOptionForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!addOptionForm.checkValidity()) {
        addOptionForm.classList.add('was-validated');
        return;
      }

      const patternId = document.getElementById('addOptionPatternId').value;
      const name = document.getElementById('newOptionName').value.trim();

      try {
        const res = await window.erpFetch(`/api/production/templates/${templateId}/patterns/${patternId}/options`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          const pattern = currentPatterns.find((p) => p.id === patternId);
          if (pattern) {
            if (!pattern.options) pattern.options = [];
            pattern.options.push({ ...data.data, tasks: [] });
            pattern.options.sort((a, b) => a.sortOrder - b.sortOrder);
          }
          const wfItem = currentWorkflowItems.find(
            (w) => w.itemType === 'PATTERN' && (w.pattern?.id === patternId || w.patternId === patternId)
          );
          if (wfItem && wfItem.pattern) {
            wfItem.pattern.optionsCount = (pattern?.options || []).length;
          }
          renderWorkflow();
          if (addOptionModal) addOptionModal.hide();
          showToast('تمت إضافة الخيار بنجاح');
        } else {
          Swal.fire('خطأ', data.message || 'تعذر إضافة الخيار', 'error');
        }
      } catch {
        Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
      }
    });
  }

  // Edit Option Form
  if (editOptionForm) {
    editOptionForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!editOptionForm.checkValidity()) {
        editOptionForm.classList.add('was-validated');
        return;
      }

      const patternId = document.getElementById('editOptionPatternId').value;
      const optionId = document.getElementById('editOptionId').value;
      const name = document.getElementById('editOptionName').value.trim();

      try {
        const res = await window.erpFetch(
          `/api/production/templates/${templateId}/patterns/${patternId}/options/${optionId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          }
        );
        const data = await res.json();
        if (res.ok && data.success) {
          const pattern = currentPatterns.find((p) => p.id === patternId);
          if (pattern && pattern.options) {
            const opt = pattern.options.find((o) => o.id === optionId);
            if (opt) opt.name = name;
          }
          renderWorkflow();
          if (editOptionModal) editOptionModal.hide();
          showToast('تم تحديث الخيار بنجاح');
        } else {
          Swal.fire('خطأ', data.message || 'تعذر تحديث الخيار', 'error');
        }
      } catch {
        Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
      }
    });
  }

  // Add Option Task Form
  if (addTaskForm) {
    addTaskForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!addTaskForm.checkValidity()) {
        addTaskForm.classList.add('was-validated');
        return;
      }

      const patternId = document.getElementById('addTaskPatternId').value;
      const optionId = document.getElementById('addTaskOptionId').value;
      const name = document.getElementById('newOptionTaskName').value.trim();
      const departmentId = document.getElementById('newOptionTaskDeptId').value;
      const durationVal = document.getElementById('newOptionTaskDuration').value.trim();
      const costVal = document.getElementById('newOptionTaskCost').value.trim();
      const description = document.getElementById('newOptionTaskDescription').value.trim() || undefined;

      try {
        const res = await window.erpFetch(
          `/api/production/templates/${templateId}/patterns/${patternId}/options/${optionId}/tasks`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name,
              departmentId,
              estimatedDurationValue: durationVal ? parseInt(durationVal, 10) : null,
              estimatedDurationUnit: durationVal ? (document.getElementById('newOptionTaskDurationUnit')?.value || 'MINUTES') : null,
              estimatedCost: costVal ? costVal : undefined,
              description,
            }),
          }
        );
        const data = await res.json();
        if (res.ok && data.success) {
          const pattern = currentPatterns.find((p) => p.id === patternId);
          if (pattern && pattern.options) {
            const opt = pattern.options.find((o) => o.id === optionId);
            if (opt) {
              if (!opt.tasks) opt.tasks = [];
              const newTask = data.data;
              const dept = departmentsMap.get(newTask.departmentId);
              newTask.departmentName = dept ? dept.name : 'قسم غير محدد';
              newTask.departmentCode = dept ? dept.code : 'N/A';
              newTask.plannedMaterialsCount = 0;
              newTask.attachmentsCount = 0;
              opt.tasks.push(newTask);
              opt.tasks.sort((a, b) => a.sortOrder - b.sortOrder);
            }
          }
          renderWorkflow();
          if (addTaskModal) addTaskModal.hide();
          showToast('تمت إضافة المهمة بنجاح');
        } else {
          Swal.fire('خطأ', data.message || 'تعذر إضافة المهمة', 'error');
        }
      } catch {
        Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
      }
    });
  }

  // Derive Mixed Workflow Presentation Elements
  function deriveMixedGroups(workflowItems) {
    if (!workflowItems || workflowItems.length === 0) return [];
    const sorted = [...workflowItems].sort((a, b) => a.sortOrder - b.sortOrder);
    const groups = [];
    let currentGroup = null;

    sorted.forEach((item) => {
      if (item.itemType === 'STAGE' && item.stage) {
        const stage = { ...item.stage, workflowItemId: item.id, sortOrder: item.sortOrder };
        const dept = departmentsMap.get(stage.departmentId) || {
          id: stage.departmentId,
          name: stage.departmentName || stage.department?.name || 'قسم غير محدد',
          code: stage.departmentCode || stage.department?.code || 'N/A',
        };

        if (!currentGroup || currentGroup.departmentId !== stage.departmentId) {
          currentGroup = {
            type: 'DEPARTMENT_GROUP',
            departmentId: stage.departmentId,
            departmentName: dept.name,
            departmentCode: dept.code,
            stages: [stage],
          };
          groups.push(currentGroup);
        } else {
          currentGroup.stages.push(stage);
        }
      } else if (item.itemType === 'PATTERN') {
        // Pattern breaks consecutive department stage grouping!
        currentGroup = null;
        const patternObj =
          currentPatterns.find((p) => p.id === (item.pattern?.id || item.patternId)) || item.pattern;
        groups.push({
          type: 'PATTERN',
          workflowItemId: item.id,
          sortOrder: item.sortOrder,
          pattern: patternObj,
        });
      }
    });

    return groups;
  }

  // Render Workflow Container
  function renderWorkflow() {
    if (!workflowContainer) return;
    workflowContainer.replaceChildren();

    const stageCount = currentWorkflowItems.filter((w) => w.itemType === 'STAGE').length;
    const patternCount = currentWorkflowItems.filter((w) => w.itemType === 'PATTERN').length;

    if (headerStageCount) headerStageCount.textContent = stageCount;
    if (headerPatternCount) headerPatternCount.textContent = patternCount;
    const navStageBadge = document.getElementById('navStageCountBadge');
    if (navStageBadge) navStageBadge.textContent = currentWorkflowItems.length;

    if (emptyStagesNotice) {
      if (currentWorkflowItems.length === 0) {
        emptyStagesNotice.classList.remove('d-none');
      } else {
        emptyStagesNotice.classList.add('d-none');
      }
    }

    const mixedElements = deriveMixedGroups(currentWorkflowItems);

    mixedElements.forEach((element) => {
      if (element.type === 'DEPARTMENT_GROUP') {
        const groupCard = document.createElement('div');
        groupCard.className = 'department-workflow-group';

        const groupHeader = document.createElement('div');
        groupHeader.className = 'department-workflow-header';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'department-workflow-title';
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-industry text-primary';
        const nameText = document.createTextNode(` ${element.departmentName} `);
        const codeBadge = document.createElement('span');
        codeBadge.className = 'badge bg-white text-secondary border font-monospace small';
        codeBadge.textContent = element.departmentCode;
        titleDiv.append(icon, nameText, codeBadge);

        const countBadge = document.createElement('span');
        countBadge.className = 'badge bg-light text-dark border small';
        countBadge.textContent = `${element.stages.length} مراحل`;

        groupHeader.append(titleDiv, countBadge);
        groupCard.appendChild(groupHeader);

        const groupBody = document.createElement('div');
        groupBody.className = 'department-workflow-body';

        element.stages.forEach((stage) => {
          const stageCard = createStageCardElement(stage);
          groupBody.appendChild(stageCard);
        });

        groupCard.appendChild(groupBody);
        workflowContainer.appendChild(groupCard);
      } else if (element.type === 'PATTERN') {
        const patternCard = createPatternCardElement(element);
        workflowContainer.appendChild(patternCard);
      }
    });
  }

  // Create Stage Card Element
  function createStageCardElement(stage) {
    const card = document.createElement('div');
    card.className = 'stage-card';
    card.dataset.stageId = stage.id;
    card.dataset.workflowItemId = stage.workflowItemId;
    card.dataset.sortOrder = stage.sortOrder;

    // Drag events for top-level workflow reordering
    if (canUpdate) {
      card.draggable = true;
      card.addEventListener('dragstart', (e) => {
        draggedWorkflowItemId = stage.workflowItemId;
        card.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', stage.workflowItemId);
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('is-dragging');
        document
          .querySelectorAll('.stage-card, .pattern-workflow-card')
          .forEach((el) => el.classList.remove('drag-over'));
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        card.classList.add('drag-over');
      });

      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over');
      });

      card.addEventListener('drop', async (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');
        if (!draggedWorkflowItemId || draggedWorkflowItemId === stage.workflowItemId) return;
        await handleWorkflowItemDrop(draggedWorkflowItemId, stage.workflowItemId);
      });
    }

    // Drag Handle
    if (canUpdate) {
      const dragHandle = document.createElement('span');
      dragHandle.className = 'stage-drag-handle';
      dragHandle.title = 'اسحب لإعادة الترتيب';
      const handleIcon = document.createElement('i');
      handleIcon.className = 'fa-solid fa-grip-vertical';
      dragHandle.appendChild(handleIcon);
      card.appendChild(dragHandle);
    }

    // Order Badge
    const orderBadge = document.createElement('span');
    orderBadge.className = 'stage-order-badge';
    orderBadge.textContent = stage.sortOrder;
    card.appendChild(orderBadge);

    // Stage Info
    const stageInfo = document.createElement('div');
    stageInfo.className = 'stage-info';

    const stageName = document.createElement('div');
    stageName.className = 'stage-name text-dark';
    stageName.textContent = stage.name;
    stageInfo.appendChild(stageName);

    const stageMeta = document.createElement('div');
    stageMeta.className = 'stage-meta';

    const stageDurText = formatTaskDurationText(stage.estimatedDurationValue, stage.estimatedDurationUnit, stage.estimatedDurationMinutes);
    if (stageDurText) {
      const durItem = document.createElement('span');
      durItem.className = 'stage-meta-item';
      const durIcon = document.createElement('i');
      durIcon.className = 'fa-solid fa-clock text-secondary';
      durItem.append(durIcon, ` ${stageDurText}`);
      stageMeta.appendChild(durItem);
    }

    if (stage.estimatedCost) {
      const costItem = document.createElement('span');
      costItem.className = 'stage-meta-item';
      const costIcon = document.createElement('i');
      costIcon.className = 'fa-solid fa-coins text-secondary';
      costItem.append(costIcon, ` ${parseFloat(stage.estimatedCost).toLocaleString()} ر.س`);
      stageMeta.appendChild(costItem);
    }

    // Materials Badge Button
    const matBtn = document.createElement('button');
    matBtn.type = 'button';
    matBtn.className = 'btn btn-sm btn-outline-primary py-0 px-2 rounded-pill small';
    matBtn.style.fontSize = '0.78rem';
    const matIcon = document.createElement('i');
    matIcon.className = 'fa-solid fa-boxes-stacked me-1';
    const matCountSpan = document.createElement('span');
    matCountSpan.className = 'stage-mat-count-badge';
    matCountSpan.textContent = stage.plannedMaterialsCount || 0;
    matBtn.append(matIcon, matCountSpan, ' مواد');
    matBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openStageDrawer(stage, 'tab-stage-materials');
    });
    stageMeta.appendChild(matBtn);

    // Attachments Badge Button
    const attBtn = document.createElement('button');
    attBtn.type = 'button';
    attBtn.className = 'btn btn-sm btn-outline-info py-0 px-2 rounded-pill small';
    attBtn.style.fontSize = '0.78rem';
    const attIcon = document.createElement('i');
    attIcon.className = 'fa-solid fa-paperclip me-1';
    const attCountSpan = document.createElement('span');
    attCountSpan.className = 'stage-att-count-badge';
    attCountSpan.textContent = stage.attachmentsCount || 0;
    attBtn.append(attIcon, attCountSpan, ' وثائق');
    attBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openStageDrawer(stage, 'tab-stage-attachments');
    });
    stageMeta.appendChild(attBtn);

    stageInfo.appendChild(stageMeta);
    card.appendChild(stageInfo);

    // Actions
    const stageActions = document.createElement('div');
    stageActions.className = 'stage-actions';

    const btnOpenDrawer = document.createElement('button');
    btnOpenDrawer.type = 'button';
    btnOpenDrawer.className = 'btn btn-sm btn-primary d-inline-flex align-items-center gap-1';
    btnOpenDrawer.style.borderRadius = '6px';
    const iconDrawer = document.createElement('i');
    iconDrawer.className = 'fa-solid fa-arrow-left-long';
    btnOpenDrawer.append(iconDrawer, ' فتح');
    btnOpenDrawer.addEventListener('click', () => openStageDrawer(stage, 'tab-stage-info'));
    stageActions.appendChild(btnOpenDrawer);

    if (canUpdate) {
      const globalIdx = currentWorkflowItems.findIndex((w) => w.id === stage.workflowItemId);

      const btnUp = document.createElement('button');
      btnUp.type = 'button';
      btnUp.className = 'btn btn-sm btn-light p-1';
      btnUp.title = 'تحريك لأعلى';
      btnUp.disabled = globalIdx === 0;
      const iconUp = document.createElement('i');
      iconUp.className = 'fa-solid fa-arrow-up text-secondary';
      btnUp.appendChild(iconUp);
      btnUp.addEventListener('click', () => moveWorkflowItem(globalIdx, -1));
      stageActions.appendChild(btnUp);

      const btnDown = document.createElement('button');
      btnDown.type = 'button';
      btnDown.className = 'btn btn-sm btn-light p-1';
      btnDown.title = 'تحريك لأسفل';
      btnDown.disabled = globalIdx === currentWorkflowItems.length - 1;
      const iconDown = document.createElement('i');
      iconDown.className = 'fa-solid fa-arrow-down text-secondary';
      btnDown.appendChild(iconDown);
      btnDown.addEventListener('click', () => moveWorkflowItem(globalIdx, 1));
      stageActions.appendChild(btnDown);

      const btnDelete = document.createElement('button');
      btnDelete.type = 'button';
      btnDelete.className = 'btn btn-sm btn-light p-1';
      btnDelete.title = 'أرشفة المرحلة';
      const iconDelete = document.createElement('i');
      iconDelete.className = 'fa-solid fa-trash-can text-danger';
      btnDelete.appendChild(iconDelete);
      btnDelete.addEventListener('click', () => archiveStage(stage));
      stageActions.appendChild(btnDelete);
    }

    card.appendChild(stageActions);
    return card;
  }

  // Create Pattern Card Element (Decision Node with Options Tree)
  function createPatternCardElement(element) {
    const pattern = element.pattern || {};
    const card = document.createElement('div');
    card.className = 'pattern-workflow-card';
    card.dataset.patternId = pattern.id;
    card.dataset.workflowItemId = element.workflowItemId;
    card.dataset.sortOrder = element.sortOrder;

    // Drag events for top-level workflow reordering
    if (canUpdate) {
      card.draggable = true;
      card.addEventListener('dragstart', (e) => {
        draggedWorkflowItemId = element.workflowItemId;
        card.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', element.workflowItemId);
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('is-dragging');
        document
          .querySelectorAll('.stage-card, .pattern-workflow-card')
          .forEach((el) => el.classList.remove('drag-over'));
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        card.classList.add('drag-over');
      });

      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over');
      });

      card.addEventListener('drop', async (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');
        if (!draggedWorkflowItemId || draggedWorkflowItemId === element.workflowItemId) return;
        await handleWorkflowItemDrop(draggedWorkflowItemId, element.workflowItemId);
      });
    }

    // Pattern Header
    const header = document.createElement('div');
    header.className = 'pattern-workflow-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'd-flex align-items-center gap-2';

    if (canUpdate) {
      const dragHandle = document.createElement('span');
      dragHandle.className = 'stage-drag-handle text-indigo';
      dragHandle.title = 'اسحب لإعادة الترتيب';
      const handleIcon = document.createElement('i');
      handleIcon.className = 'fa-solid fa-grip-vertical';
      dragHandle.appendChild(handleIcon);
      headerLeft.appendChild(dragHandle);
    }

    const orderBadge = document.createElement('span');
    orderBadge.className = 'badge bg-indigo-subtle text-primary border px-2 py-1 fs-6 rounded-pill';
    orderBadge.textContent = `#${element.sortOrder}`;
    headerLeft.appendChild(orderBadge);

    const titleH5 = document.createElement('h6');
    titleH5.className = 'pattern-workflow-title mb-0';
    const patternIcon = document.createElement('i');
    patternIcon.className = 'fa-solid fa-shapes text-indigo';
    const titleText = document.createTextNode(` نمط: ${pattern.name || 'بدون اسم'} `);
    const decisionPill = document.createElement('span');
    decisionPill.className = 'badge bg-primary-subtle text-primary border small';
    decisionPill.textContent = 'نمط قرار';

    const optionsCount = pattern.options ? pattern.options.length : pattern.optionsCount || 0;
    const countBadge = document.createElement('span');
    countBadge.className = 'badge bg-light text-secondary border small';
    countBadge.textContent = `${optionsCount} خيارات`;

    titleH5.append(patternIcon, titleText, decisionPill, countBadge);
    headerLeft.appendChild(titleH5);
    header.appendChild(headerLeft);

    // Pattern Actions
    const actions = document.createElement('div');
    actions.className = 'd-flex align-items-center gap-2';

    if (canUpdate) {
      const btnAddOption = document.createElement('button');
      btnAddOption.type = 'button';
      btnAddOption.className = 'btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1';
      btnAddOption.style.borderRadius = '6px';
      const addOptIcon = document.createElement('i');
      addOptIcon.className = 'fa-solid fa-plus';
      btnAddOption.append(addOptIcon, ' إضافة خيار');
      btnAddOption.addEventListener('click', () => {
        document.getElementById('addOptionPatternId').value = pattern.id;
        document.getElementById('newOptionName').value = '';
        if (addOptionForm) addOptionForm.classList.remove('was-validated');
        if (addOptionModal) addOptionModal.show();
      });
      actions.appendChild(btnAddOption);

      const globalIdx = currentWorkflowItems.findIndex((w) => w.id === element.workflowItemId);

      const btnUp = document.createElement('button');
      btnUp.type = 'button';
      btnUp.className = 'btn btn-sm btn-light p-1';
      btnUp.title = 'تحريك لأعلى';
      btnUp.disabled = globalIdx === 0;
      const iconUp = document.createElement('i');
      iconUp.className = 'fa-solid fa-arrow-up text-secondary';
      btnUp.appendChild(iconUp);
      btnUp.addEventListener('click', () => moveWorkflowItem(globalIdx, -1));
      actions.appendChild(btnUp);

      const btnDown = document.createElement('button');
      btnDown.type = 'button';
      btnDown.className = 'btn btn-sm btn-light p-1';
      btnDown.title = 'تحريك لأسفل';
      btnDown.disabled = globalIdx === currentWorkflowItems.length - 1;
      const iconDown = document.createElement('i');
      iconDown.className = 'fa-solid fa-arrow-down text-secondary';
      btnDown.appendChild(iconDown);
      btnDown.addEventListener('click', () => moveWorkflowItem(globalIdx, 1));
      actions.appendChild(btnDown);

      const btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'btn btn-sm btn-light p-1';
      btnEdit.title = 'تعديل النمط';
      const iconEdit = document.createElement('i');
      iconEdit.className = 'fa-solid fa-pen text-primary';
      btnEdit.appendChild(iconEdit);
      btnEdit.addEventListener('click', () => {
        document.getElementById('editPatternId').value = pattern.id;
        document.getElementById('editPatternName').value = pattern.name || '';
        if (editPatternForm) editPatternForm.classList.remove('was-validated');
        if (editPatternModal) editPatternModal.show();
      });
      actions.appendChild(btnEdit);

      const btnDelete = document.createElement('button');
      btnDelete.type = 'button';
      btnDelete.className = 'btn btn-sm btn-light p-1';
      btnDelete.title = 'أرشفة النمط';
      const iconDelete = document.createElement('i');
      iconDelete.className = 'fa-solid fa-trash-can text-danger';
      btnDelete.appendChild(iconDelete);
      btnDelete.addEventListener('click', () => archivePattern(pattern));
      actions.appendChild(btnDelete);
    }

    header.appendChild(actions);
    card.appendChild(header);

    // Pattern Body (Options Tree)
    const body = document.createElement('div');
    body.className = 'pattern-workflow-body';

    const treeContainer = document.createElement('div');
    treeContainer.className = 'pattern-options-tree';

    const optionsList = Array.isArray(pattern.options) ? pattern.options : [];

    if (optionsList.length === 0) {
      const emptyOptNotice = document.createElement('div');
      emptyOptNotice.className =
        'text-center py-3 text-muted border border-dashed rounded-3 bg-light bg-opacity-50 small';
      const noticeText = document.createTextNode('لم تتم إضافة خيارات لهذا النمط بعد. ');
      emptyOptNotice.appendChild(noticeText);

      if (canUpdate) {
        const btnAddFirst = document.createElement('button');
        btnAddFirst.type = 'button';
        btnAddFirst.className = 'btn btn-sm btn-outline-primary ms-2';
        btnAddFirst.textContent = 'إضافة أول خيار';
        btnAddFirst.addEventListener('click', () => {
          document.getElementById('addOptionPatternId').value = pattern.id;
          document.getElementById('newOptionName').value = '';
          if (addOptionModal) addOptionModal.show();
        });
        emptyOptNotice.appendChild(btnAddFirst);
      }
      treeContainer.appendChild(emptyOptNotice);
    } else {
      optionsList.forEach((option, optIdx) => {
        const optionItem = createPatternOptionElement(pattern, option, optIdx, optionsList.length);
        treeContainer.appendChild(optionItem);
      });
    }

    body.appendChild(treeContainer);
    card.appendChild(body);
    return card;
  }

  // Create Pattern Option Element
  function createPatternOptionElement(pattern, option, optIdx, totalOptions) {
    const item = document.createElement('div');
    item.className = 'pattern-option-item is-expanded';
    item.dataset.optionId = option.id;

    // Header
    const header = document.createElement('div');
    header.className = 'pattern-option-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'd-flex align-items-center gap-2';

    const toggleIcon = document.createElement('i');
    toggleIcon.className = 'fa-solid fa-chevron-down text-secondary small toggle-option-icon';
    toggleIcon.style.transition = 'transform 0.2s';
    headerLeft.appendChild(toggleIcon);

    const titleH6 = document.createElement('h6');
    titleH6.className = 'pattern-option-title mb-0';
    const optName = document.createTextNode(option.name);
    titleH6.appendChild(optName);

    if (option.sortOrder === 1) {
      const defaultPill = document.createElement('span');
      defaultPill.className = 'badge bg-success-subtle text-success border small ms-2';
      defaultPill.textContent = 'الخيار الافتراضي المقترح';
      titleH6.appendChild(defaultPill);
    }

    const tasksCount = option.tasks ? option.tasks.length : 0;
    const taskCountBadge = document.createElement('span');
    taskCountBadge.className = 'badge bg-white text-secondary border small ms-2';
    taskCountBadge.textContent = `${tasksCount} مهام`;
    titleH6.appendChild(taskCountBadge);

    headerLeft.appendChild(titleH6);
    header.appendChild(headerLeft);

    // Option Actions
    const actions = document.createElement('div');
    actions.className = 'd-flex align-items-center gap-1';
    actions.addEventListener('click', (e) => e.stopPropagation());

    if (canUpdate) {
      const btnAddTask = document.createElement('button');
      btnAddTask.type = 'button';
      btnAddTask.className = 'btn btn-sm btn-outline-success py-0 px-2 rounded-pill small';
      btnAddTask.style.fontSize = '0.78rem';
      btnAddTask.append(document.createTextNode('+ إضافة مهمة'));
      btnAddTask.addEventListener('click', () => {
        document.getElementById('addTaskPatternId').value = pattern.id;
        document.getElementById('addTaskOptionId').value = option.id;
        document.getElementById('newOptionTaskName').value = '';
        document.getElementById('newOptionTaskDeptId').value = '';
        document.getElementById('newOptionTaskDuration').value = '';
        document.getElementById('newOptionTaskCost').value = '';
        document.getElementById('newOptionTaskDescription').value = '';
        if (addTaskForm) addTaskForm.classList.remove('was-validated');
        if (addTaskModal) addTaskModal.show();
      });
      actions.appendChild(btnAddTask);

      const btnUp = document.createElement('button');
      btnUp.type = 'button';
      btnUp.className = 'btn btn-sm btn-light p-1';
      btnUp.title = 'تحريك لأعلى';
      btnUp.disabled = optIdx === 0;
      const iconUp = document.createElement('i');
      iconUp.className = 'fa-solid fa-arrow-up text-secondary';
      btnUp.appendChild(iconUp);
      btnUp.addEventListener('click', () => moveOption(pattern.id, optIdx, -1));
      actions.appendChild(btnUp);

      const btnDown = document.createElement('button');
      btnDown.type = 'button';
      btnDown.className = 'btn btn-sm btn-light p-1';
      btnDown.title = 'تحريك لأسفل';
      btnDown.disabled = optIdx === totalOptions - 1;
      const iconDown = document.createElement('i');
      iconDown.className = 'fa-solid fa-arrow-down text-secondary';
      btnDown.appendChild(iconDown);
      btnDown.addEventListener('click', () => moveOption(pattern.id, optIdx, 1));
      actions.appendChild(btnDown);

      const btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'btn btn-sm btn-light p-1';
      btnEdit.title = 'تعديل الخيار';
      const iconEdit = document.createElement('i');
      iconEdit.className = 'fa-solid fa-pen text-primary';
      btnEdit.appendChild(iconEdit);
      btnEdit.addEventListener('click', () => {
        document.getElementById('editOptionPatternId').value = pattern.id;
        document.getElementById('editOptionId').value = option.id;
        document.getElementById('editOptionName').value = option.name;
        if (editOptionForm) editOptionForm.classList.remove('was-validated');
        if (editOptionModal) editOptionModal.show();
      });
      actions.appendChild(btnEdit);

      const btnDelete = document.createElement('button');
      btnDelete.type = 'button';
      btnDelete.className = 'btn btn-sm btn-light p-1';
      btnDelete.title = 'أرشفة الخيار';
      const iconDelete = document.createElement('i');
      iconDelete.className = 'fa-solid fa-trash-can text-danger';
      btnDelete.appendChild(iconDelete);
      btnDelete.addEventListener('click', () => archiveOption(pattern.id, option));
      actions.appendChild(btnDelete);
    }

    header.appendChild(actions);

    // Expand/Collapse toggle on header click
    header.addEventListener('click', () => {
      const isExpanded = item.classList.contains('is-expanded');
      if (isExpanded) {
        item.classList.remove('is-expanded');
        toggleIcon.className = 'fa-solid fa-chevron-left text-secondary small toggle-option-icon';
        optionBody.style.display = 'none';
      } else {
        item.classList.add('is-expanded');
        toggleIcon.className = 'fa-solid fa-chevron-down text-secondary small toggle-option-icon';
        optionBody.style.display = 'flex';
      }
    });

    item.appendChild(header);

    // Option Body (Tasks Container)
    const optionBody = document.createElement('div');
    optionBody.className = 'pattern-option-body';

    const tasksList = Array.isArray(option.tasks) ? option.tasks : [];

    if (tasksList.length === 0) {
      const emptyTasksNotice = document.createElement('div');
      emptyTasksNotice.className =
        'text-center py-2 text-muted border border-dashed rounded bg-white small';
      emptyTasksNotice.textContent = 'لا توجد مهام لهذا الخيار بعد.';
      optionBody.appendChild(emptyTasksNotice);
    } else {
      tasksList.forEach((task, taskIdx) => {
        const taskCard = createOptionTaskCardElement(pattern, option, task, taskIdx, tasksList.length);
        optionBody.appendChild(taskCard);
      });
    }

    item.appendChild(optionBody);
    return item;
  }

  // Create Option Task Card Element
  function createOptionTaskCardElement(pattern, option, task, taskIdx, totalTasks) {
    const card = document.createElement('div');
    card.className = 'option-task-card';
    card.dataset.taskId = task.id;
    card.dataset.optionId = option.id;
    card.dataset.patternId = pattern.id;

    // Draggable within same option
    if (canUpdate) {
      card.draggable = true;
      card.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        draggedTaskId = task.id;
        draggedTaskOptionId = option.id;
        card.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', task.id);
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('is-dragging');
        document.querySelectorAll('.option-task-card').forEach((el) => el.classList.remove('drag-over'));
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (draggedTaskOptionId === option.id) {
          e.dataTransfer.dropEffect = 'move';
          card.classList.add('drag-over');
        }
      });

      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over');
      });

      card.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        card.classList.remove('drag-over');
        if (!draggedTaskId || draggedTaskId === task.id || draggedTaskOptionId !== option.id) return;
        await handleOptionTaskDrop(pattern.id, option.id, draggedTaskId, task.id);
      });
    }

    // Drag Handle
    if (canUpdate) {
      const dragHandle = document.createElement('span');
      dragHandle.className = 'stage-drag-handle small';
      dragHandle.title = 'اسحب لإعادة الترتيب';
      const handleIcon = document.createElement('i');
      handleIcon.className = 'fa-solid fa-grip-vertical';
      dragHandle.appendChild(handleIcon);
      card.appendChild(dragHandle);
    }

    // Order Badge
    const orderBadge = document.createElement('span');
    orderBadge.className = 'badge bg-light text-dark border px-2 py-1 rounded-pill small';
    orderBadge.textContent = task.sortOrder;
    card.appendChild(orderBadge);

    // Task Info & Department
    const infoDiv = document.createElement('div');
    infoDiv.className = 'flex-grow-1 min-w-0';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'fw-bold text-dark text-truncate';
    nameDiv.textContent = task.name;
    infoDiv.appendChild(nameDiv);

    const metaDiv = document.createElement('div');
    metaDiv.className = 'd-flex flex-wrap align-items-center gap-2 small text-muted mt-1';

    const dept = departmentsMap.get(task.departmentId);
    const deptBadge = document.createElement('span');
    deptBadge.className = 'badge bg-secondary-subtle text-secondary small';
    deptBadge.textContent = dept ? dept.name : task.departmentName || 'قسم غير محدد';
    metaDiv.appendChild(deptBadge);

    const taskDurText = formatTaskDurationText(task.estimatedDurationValue, task.estimatedDurationUnit, task.estimatedDurationMinutes);
    if (taskDurText) {
      const durSpan = document.createElement('span');
      durSpan.append(
        document.createTextNode(`• ${taskDurText}`)
      );
      metaDiv.appendChild(durSpan);
    }

    if (task.estimatedCost) {
      const costSpan = document.createElement('span');
      costSpan.append(
        document.createTextNode(`• ${parseFloat(task.estimatedCost).toLocaleString()} ر.س`)
      );
      metaDiv.appendChild(costSpan);
    }

    // Materials Badge Button
    const matBtn = document.createElement('button');
    matBtn.type = 'button';
    matBtn.className = 'btn btn-sm btn-outline-primary py-0 px-2 rounded-pill small';
    matBtn.style.fontSize = '0.75rem';
    const matIcon = document.createElement('i');
    matIcon.className = 'fa-solid fa-boxes-stacked me-1';
    matBtn.append(matIcon, `${task.plannedMaterialsCount || 0} مواد`);
    matBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTaskModal(pattern.id, option.id, task, 'tab-task-materials');
    });
    metaDiv.appendChild(matBtn);

    // Attachments Badge Button
    const attBtn = document.createElement('button');
    attBtn.type = 'button';
    attBtn.className = 'btn btn-sm btn-outline-info py-0 px-2 rounded-pill small';
    attBtn.style.fontSize = '0.75rem';
    const attIcon = document.createElement('i');
    attIcon.className = 'fa-solid fa-paperclip me-1';
    attBtn.append(attIcon, `${task.attachmentsCount || 0} وثائق`);
    attBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTaskModal(pattern.id, option.id, task, 'tab-task-attachments');
    });
    metaDiv.appendChild(attBtn);

    infoDiv.appendChild(metaDiv);
    card.appendChild(infoDiv);

    // Actions
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'd-flex align-items-center gap-1';

    const btnOpenTask = document.createElement('button');
    btnOpenTask.type = 'button';
    btnOpenTask.className = 'btn btn-sm btn-primary py-1 px-2 d-inline-flex align-items-center gap-1';
    btnOpenTask.style.borderRadius = '6px';
    const iconOpen = document.createElement('i');
    iconOpen.className = 'fa-solid fa-arrow-left-long';
    btnOpenTask.append(iconOpen, ' فتح');
    btnOpenTask.addEventListener('click', () => {
      openTaskModal(pattern.id, option.id, task, 'tab-task-info');
    });
    actionsDiv.appendChild(btnOpenTask);

    if (canUpdate) {
      const btnUp = document.createElement('button');
      btnUp.type = 'button';
      btnUp.className = 'btn btn-sm btn-light p-1';
      btnUp.title = 'تحريك لأعلى';
      btnUp.disabled = taskIdx === 0;
      const iconUp = document.createElement('i');
      iconUp.className = 'fa-solid fa-arrow-up text-secondary';
      btnUp.appendChild(iconUp);
      btnUp.addEventListener('click', () => moveOptionTask(pattern.id, option.id, taskIdx, -1));
      actionsDiv.appendChild(btnUp);

      const btnDown = document.createElement('button');
      btnDown.type = 'button';
      btnDown.className = 'btn btn-sm btn-light p-1';
      btnDown.title = 'تحريك لأسفل';
      btnDown.disabled = taskIdx === totalTasks - 1;
      const iconDown = document.createElement('i');
      iconDown.className = 'fa-solid fa-arrow-down text-secondary';
      btnDown.appendChild(iconDown);
      btnDown.addEventListener('click', () => moveOptionTask(pattern.id, option.id, taskIdx, 1));
      actionsDiv.appendChild(btnDown);

      const btnDelete = document.createElement('button');
      btnDelete.type = 'button';
      btnDelete.className = 'btn btn-sm btn-light p-1';
      btnDelete.title = 'أرشفة المهمة';
      const iconDelete = document.createElement('i');
      iconDelete.className = 'fa-solid fa-trash-can text-danger';
      btnDelete.appendChild(iconDelete);
      btnDelete.addEventListener('click', () => archiveOptionTask(pattern.id, option.id, task));
      actionsDiv.appendChild(btnDelete);
    }

    card.appendChild(actionsDiv);
    return card;
  }

  // Top-Level Workflow Drag & Drop
  async function handleWorkflowItemDrop(sourceId, targetId) {
    const sourceIndex = currentWorkflowItems.findIndex((w) => w.id === sourceId);
    const targetIndex = currentWorkflowItems.findIndex((w) => w.id === targetId);
    if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return;

    const previousOrder = JSON.parse(JSON.stringify(currentWorkflowItems));
    const movedItem = currentWorkflowItems.splice(sourceIndex, 1)[0];
    currentWorkflowItems.splice(targetIndex, 0, movedItem);

    currentWorkflowItems.forEach((w, idx) => {
      w.sortOrder = idx + 1;
      if (w.stage) w.stage.sortOrder = idx + 1;
    });
    renderWorkflow();

    const workflowItemIds = currentWorkflowItems.map((w) => w.id);
    try {
      const res = await window.erpFetch(`/api/production/templates/${templateId}/workflow/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowItemIds }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        currentWorkflowItems = previousOrder;
        renderWorkflow();
        Swal.fire('خطأ', data.message || 'تعذر إعادة ترتيب سير العمل', 'error');
      }
    } catch {
      currentWorkflowItems = previousOrder;
      renderWorkflow();
      Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
    }
  }

  // Top-Level Workflow Move Up/Down
  async function moveWorkflowItem(index, offset) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= currentWorkflowItems.length) return;

    const previousOrder = JSON.parse(JSON.stringify(currentWorkflowItems));
    const movedItem = currentWorkflowItems.splice(index, 1)[0];
    currentWorkflowItems.splice(targetIndex, 0, movedItem);

    currentWorkflowItems.forEach((w, idx) => {
      w.sortOrder = idx + 1;
      if (w.stage) w.stage.sortOrder = idx + 1;
    });
    renderWorkflow();

    const workflowItemIds = currentWorkflowItems.map((w) => w.id);
    try {
      const res = await window.erpFetch(`/api/production/templates/${templateId}/workflow/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowItemIds }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        currentWorkflowItems = previousOrder;
        renderWorkflow();
        Swal.fire('خطأ', data.message || 'تعذر إعادة ترتيب سير العمل', 'error');
      }
    } catch {
      currentWorkflowItems = previousOrder;
      renderWorkflow();
      Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
    }
  }

  // Option Move Up/Down
  async function moveOption(patternId, optionIndex, offset) {
    const pattern = currentPatterns.find((p) => p.id === patternId);
    if (!pattern || !pattern.options) return;
    const targetIndex = optionIndex + offset;
    if (targetIndex < 0 || targetIndex >= pattern.options.length) return;

    const previousOrder = [...pattern.options];
    const moved = pattern.options.splice(optionIndex, 1)[0];
    pattern.options.splice(targetIndex, 0, moved);
    pattern.options.forEach((opt, idx) => (opt.sortOrder = idx + 1));
    renderWorkflow();

    const optionIds = pattern.options.map((o) => o.id);
    try {
      const res = await window.erpFetch(
        `/api/production/templates/${templateId}/patterns/${patternId}/options/reorder`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ optionIds }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        pattern.options = previousOrder;
        renderWorkflow();
        Swal.fire('خطأ', data.message || 'تعذر إعادة ترتيب الخيارات', 'error');
      }
    } catch {
      pattern.options = previousOrder;
      renderWorkflow();
      Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
    }
  }

  // Option Task Move Up/Down
  async function moveOptionTask(patternId, optionId, taskIndex, offset) {
    const pattern = currentPatterns.find((p) => p.id === patternId);
    if (!pattern) return;
    const option = (pattern.options || []).find((o) => o.id === optionId);
    if (!option || !option.tasks) return;
    const targetIndex = taskIndex + offset;
    if (targetIndex < 0 || targetIndex >= option.tasks.length) return;

    const previousOrder = [...option.tasks];
    const moved = option.tasks.splice(taskIndex, 1)[0];
    option.tasks.splice(targetIndex, 0, moved);
    option.tasks.forEach((t, idx) => (t.sortOrder = idx + 1));
    renderWorkflow();

    const taskIds = option.tasks.map((t) => t.id);
    try {
      const res = await window.erpFetch(
        `/api/production/templates/${templateId}/patterns/${patternId}/options/${optionId}/tasks/reorder`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskIds }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        option.tasks = previousOrder;
        renderWorkflow();
        Swal.fire('خطأ', data.message || 'تعذر إعادة ترتيب المهام', 'error');
      }
    } catch {
      option.tasks = previousOrder;
      renderWorkflow();
      Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
    }
  }

  // Option Task Drop
  async function handleOptionTaskDrop(patternId, optionId, sourceTaskId, targetTaskId) {
    const pattern = currentPatterns.find((p) => p.id === patternId);
    if (!pattern) return;
    const option = (pattern.options || []).find((o) => o.id === optionId);
    if (!option || !option.tasks) return;

    const sourceIndex = option.tasks.findIndex((t) => t.id === sourceTaskId);
    const targetIndex = option.tasks.findIndex((t) => t.id === targetTaskId);
    if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return;

    const previousOrder = [...option.tasks];
    const moved = option.tasks.splice(sourceIndex, 1)[0];
    option.tasks.splice(targetIndex, 0, moved);
    option.tasks.forEach((t, idx) => (t.sortOrder = idx + 1));
    renderWorkflow();

    const taskIds = option.tasks.map((t) => t.id);
    try {
      const res = await window.erpFetch(
        `/api/production/templates/${templateId}/patterns/${patternId}/options/${optionId}/tasks/reorder`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskIds }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        option.tasks = previousOrder;
        renderWorkflow();
        Swal.fire('خطأ', data.message || 'تعذر إعادة ترتيب المهام', 'error');
      }
    } catch {
      option.tasks = previousOrder;
      renderWorkflow();
      Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
    }
  }

  // Archive Pattern
  async function archivePattern(pattern) {
    const resConfirm = await Swal.fire({
      title: 'أرشفة النمط',
      text: `هل أنت متأكد من أرشفة نمط "${pattern.name}"؟`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      confirmButtonText: 'نعم، أرشفة',
      cancelButtonText: 'إلغاء',
    });

    if (resConfirm.isConfirmed) {
      try {
        const res = await window.erpFetch(
          `/api/production/templates/${templateId}/patterns/${pattern.id}`,
          {
            method: 'DELETE',
          }
        );
        const data = await res.json();
        if (res.ok && data.success) {
          currentPatterns = currentPatterns.filter((p) => p.id !== pattern.id);
          currentWorkflowItems = currentWorkflowItems.filter(
            (w) =>
              !(
                w.itemType === 'PATTERN' &&
                (w.pattern?.id === pattern.id || w.patternId === pattern.id)
              )
          );
          currentWorkflowItems.forEach((w, idx) => {
            w.sortOrder = idx + 1;
            if (w.stage) w.stage.sortOrder = idx + 1;
          });
          renderWorkflow();
          showToast('تمت أرشفة النمط بنجاح');
        } else {
          Swal.fire('خطأ', data.message || 'تعذر أرشفة النمط', 'error');
        }
      } catch {
        Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
      }
    }
  }

  // Archive Option
  async function archiveOption(patternId, option) {
    const resConfirm = await Swal.fire({
      title: 'أرشفة الخيار',
      text: `هل أنت متأكد من أرشفة خيار "${option.name}"؟`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      confirmButtonText: 'نعم، أرشفة',
      cancelButtonText: 'إلغاء',
    });

    if (resConfirm.isConfirmed) {
      try {
        const res = await window.erpFetch(
          `/api/production/templates/${templateId}/patterns/${patternId}/options/${option.id}`,
          {
            method: 'DELETE',
          }
        );
        const data = await res.json();
        if (res.ok && data.success) {
          const pattern = currentPatterns.find((p) => p.id === patternId);
          if (pattern && pattern.options) {
            pattern.options = pattern.options.filter((o) => o.id !== option.id);
            pattern.options.forEach((o, idx) => (o.sortOrder = idx + 1));
          }
          const wfItem = currentWorkflowItems.find(
            (w) =>
              w.itemType === 'PATTERN' &&
              (w.pattern?.id === patternId || w.patternId === patternId)
          );
          if (wfItem && wfItem.pattern) {
            wfItem.pattern.optionsCount = (pattern?.options || []).length;
          }
          renderWorkflow();
          showToast('تمت أرشفة الخيار بنجاح');
        } else {
          Swal.fire('خطأ', data.message || 'تعذر أرشفة الخيار', 'error');
        }
      } catch {
        Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
      }
    }
  }

  // Archive Option Task
  async function archiveOptionTask(patternId, optionId, task) {
    const resConfirm = await Swal.fire({
      title: 'أرشفة المهمة',
      text: `هل أنت متأكد من أرشفة مهمة "${task.name}"؟`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      confirmButtonText: 'نعم، أرشفة',
      cancelButtonText: 'إلغاء',
    });

    if (resConfirm.isConfirmed) {
      try {
        const res = await window.erpFetch(
          `/api/production/templates/${templateId}/patterns/${patternId}/options/${optionId}/tasks/${task.id}`,
          {
            method: 'DELETE',
          }
        );
        const data = await res.json();
        if (res.ok && data.success) {
          const pattern = currentPatterns.find((p) => p.id === patternId);
          if (pattern && pattern.options) {
            const opt = pattern.options.find((o) => o.id === optionId);
            if (opt && opt.tasks) {
              opt.tasks = opt.tasks.filter((t) => t.id !== task.id);
              opt.tasks.forEach((t, idx) => (t.sortOrder = idx + 1));
            }
          }
          renderWorkflow();
          if (activeModalTask && activeModalTask.task.id === task.id && taskModal) {
            taskModal.hide();
          }
          showToast('تمت أرشفة المهمة بنجاح');
        } else {
          Swal.fire('خطأ', data.message || 'تعذر أرشفة المهمة', 'error');
        }
      } catch {
        Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
      }
    }
  }

  // Archive Stage
  async function archiveStage(stage) {
    const resConfirm = await Swal.fire({
      title: 'أرشفة المرحلة',
      text: `هل أنت متأكد من أرشفة مرحلة "${stage.name}"؟`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      confirmButtonText: 'نعم، أرشفة',
      cancelButtonText: 'إلغاء',
    });

    if (resConfirm.isConfirmed) {
      try {
        const res = await window.erpFetch(`/api/production/templates/${templateId}/stages/${stage.id}`, {
          method: 'DELETE',
        });
        const data = await res.json();
        if (res.ok && data.success) {
          currentWorkflowItems = currentWorkflowItems.filter(
            (w) =>
              !(
                w.itemType === 'STAGE' &&
                (w.stage?.id === stage.id || w.stageId === stage.id)
              )
          );
          currentWorkflowItems.forEach((w, idx) => {
            w.sortOrder = idx + 1;
            if (w.stage) w.stage.sortOrder = idx + 1;
          });
          currentStages = currentWorkflowItems.filter((w) => w.itemType === 'STAGE').map((w) => w.stage);
          renderWorkflow();
          if (activeDrawerStage && activeDrawerStage.id === stage.id && stageDrawer) {
            stageDrawer.hide();
          }
          showToast('تمت أرشفة المرحلة بنجاح');
        } else {
          Swal.fire('خطأ', data.message || 'تعذر أرشفة المرحلة', 'error');
        }
      } catch {
        Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
      }
    }
  }

  // ========================================================
  // 5. UNIFIED STAGE WORKSPACE MODAL
  // ========================================================

  const stageModalEl = document.getElementById('stageModal') || document.getElementById('stageDrawer');
  const stageModal = stageModalEl ? new bootstrap.Modal(stageModalEl) : null;
  const stageDrawer = stageModal; // backward compatible alias for all operations

  const stageDrawerTitle = document.getElementById('stageDrawerTitle');
  const stageDrawerOrderBadge = document.getElementById('stageDrawerOrderBadge');
  const stageDrawerDeptBadge = document.getElementById('stageDrawerDeptBadge');
  const drawerTabMaterialsBadge = document.getElementById('drawerTabMaterialsBadge');
  const drawerTabAttachmentsBadge = document.getElementById('drawerTabAttachmentsBadge');

  // Form Elements inside Drawer Tab 1
  const drawerStageInfoForm = document.getElementById('drawerStageInfoForm');
  const drawerStageName = document.getElementById('drawerStageName');
  const drawerStageDepartmentId = document.getElementById('drawerStageDepartmentId');
  const drawerStageDuration = document.getElementById('drawerStageDuration');
  const drawerStageDurationUnit = document.getElementById('drawerStageDurationUnit');
  const drawerStageCost = document.getElementById('drawerStageCost');
  const drawerStageDescription = document.getElementById('drawerStageDescription');
  const btnDrawerArchiveStage = document.getElementById('btnDrawerArchiveStage');

  function openStageDrawer(stage, activeTabId = 'tab-stage-info') {
    activeDrawerStage = stage;

    // Header info
    if (stageDrawerTitle) stageDrawerTitle.textContent = stage.name;
    if (stageDrawerOrderBadge) stageDrawerOrderBadge.textContent = `#${stage.sortOrder}`;
    const dept = departmentsMap.get(stage.departmentId);
    if (stageDrawerDeptBadge) stageDrawerDeptBadge.textContent = dept ? dept.name : stage.departmentName || 'القسم';

    // Tab badges
    if (drawerTabMaterialsBadge) drawerTabMaterialsBadge.textContent = stage.plannedMaterialsCount || 0;
    if (drawerTabAttachmentsBadge) drawerTabAttachmentsBadge.textContent = stage.attachmentsCount || 0;

    // Fill Tab 1 Form
    if (drawerStageName) drawerStageName.value = stage.name;
    if (drawerStageDepartmentId) drawerStageDepartmentId.value = stage.departmentId;
    if (drawerStageDuration) drawerStageDuration.value = stage.estimatedDurationValue ?? stage.estimatedDurationMinutes ?? '';
    if (drawerStageDurationUnit) drawerStageDurationUnit.value = stage.estimatedDurationUnit ?? 'MINUTES';
    if (drawerStageCost) drawerStageCost.value = stage.estimatedCost ?? '';
    if (drawerStageDescription) drawerStageDescription.value = stage.description || '';

    // Activate Requested Tab
    const tabTriggerEl = document.getElementById(activeTabId);
    if (tabTriggerEl) {
      const tab = new bootstrap.Tab(tabTriggerEl);
      tab.show();
    }

    // Load materials and attachments for this stage
    loadDrawerStageMaterials(stage.id);
    loadDrawerStageAttachments(stage.id);

    if (stageDrawer) stageDrawer.show();
  }

  // Save Tab 1: Stage Info
  if (drawerStageInfoForm) {
    drawerStageInfoForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!activeDrawerStage) return;

      if (!drawerStageInfoForm.checkValidity()) {
        drawerStageInfoForm.classList.add('was-validated');
        return;
      }

      const name = drawerStageName.value.trim();
      const departmentId = drawerStageDepartmentId.value;
      const durationVal = drawerStageDuration.value.trim();
      const durationUnit = drawerStageDurationUnit ? drawerStageDurationUnit.value : 'MINUTES';
      const costVal = drawerStageCost.value.trim();
      const description = drawerStageDescription.value.trim() || undefined;

      const payload = {
        name,
        departmentId,
        estimatedDurationValue: durationVal ? parseInt(durationVal, 10) : null,
        estimatedDurationUnit: durationVal ? durationUnit : null,
        estimatedCost: costVal ? costVal : null,
        description: description ? description : null,
      };

      try {
        const res = await window.erpFetch(`/api/production/templates/${templateId}/stages/${activeDrawerStage.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          activeDrawerStage.name = name;
          activeDrawerStage.departmentId = departmentId;
          const dept = departmentsMap.get(departmentId);
          activeDrawerStage.departmentName = dept ? dept.name : 'قسم غير محدد';
          activeDrawerStage.departmentCode = dept ? dept.code : 'N/A';
          activeDrawerStage.estimatedDurationValue = durationVal ? parseInt(durationVal, 10) : null;
          activeDrawerStage.estimatedDurationUnit = durationVal ? durationUnit : null;
          activeDrawerStage.estimatedDurationMinutes = durationVal ? (durationUnit === 'DAYS' ? parseInt(durationVal, 10) * 1440 : durationUnit === 'HOURS' ? parseInt(durationVal, 10) * 60 : parseInt(durationVal, 10)) : null;
          activeDrawerStage.estimatedCost = costVal ? costVal : null;
          activeDrawerStage.description = description || null;

          // Sync currentWorkflowItems so renderWorkflow() reflects updated stage data
          const wfItem = currentWorkflowItems.find((w) => w.stage && w.stage.id === activeDrawerStage.id);
          if (wfItem && wfItem.stage) {
            Object.assign(wfItem.stage, data.data, {
              departmentName: activeDrawerStage.departmentName,
              departmentCode: activeDrawerStage.departmentCode,
              estimatedDurationValue: activeDrawerStage.estimatedDurationValue,
              estimatedDurationUnit: activeDrawerStage.estimatedDurationUnit,
              estimatedDurationMinutes: activeDrawerStage.estimatedDurationMinutes,
              estimatedCost: activeDrawerStage.estimatedCost,
              description: activeDrawerStage.description,
            });
          }

          if (stageDrawerTitle) stageDrawerTitle.textContent = name;
          if (stageDrawerDeptBadge) stageDrawerDeptBadge.textContent = activeDrawerStage.departmentName;

          renderWorkflow();
          showToast('تم حفظ تعديلات المرحلة بنجاح');
        } else {
          Swal.fire('خطأ', extractApiErrorMessage(data, 'تعذر تعديل المرحلة'), 'error');
        }
      } catch {
        Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
      }
    });
  }

  if (btnDrawerArchiveStage) {
    btnDrawerArchiveStage.addEventListener('click', () => {
      if (activeDrawerStage) archiveStage(activeDrawerStage);
    });
  }

  // ========================================================
  // 6. DRAWER TAB 2: PLANNED MATERIALS & SEARCH PICKER
  // ========================================================

  const drawerMaterialsTableBody = document.getElementById('drawerStageMaterialsTableBody');
  const catalogSearchInput = document.getElementById('catalogProductSearchInput');
  const catalogResultsBox = document.getElementById('catalogSearchResultsBox');
  const catalogResultsList = document.getElementById('catalogSearchResultsList');
  const catalogLoadMoreContainer = document.getElementById('catalogLoadMoreContainer');
  const btnCatalogLoadMore = document.getElementById('btnCatalogLoadMore');

  const selectedProductContainer = document.getElementById('selectedProductContainer');
  const selectedProductCode = document.getElementById('selectedProductCode');
  const selectedProductName = document.getElementById('selectedProductName');
  const btnDeselectProduct = document.getElementById('btnDeselectProduct');

  const drawerMaterialUnitSelect = document.getElementById('drawerMaterialUnitSelect');
  const drawerMaterialQuantityInput = document.getElementById('drawerMaterialQuantityInput');
  const btnSubmitDrawerMaterial = document.getElementById('btnSubmitDrawerMaterial');
  const drawerAddMaterialForm = document.getElementById('drawerAddMaterialForm');

  async function loadDrawerStageMaterials(stageId) {
    if (!drawerMaterialsTableBody) return;
    drawerMaterialsTableBody.replaceChildren();

    try {
      const res = await window.erpFetch(`/api/production/templates/${templateId}/stages/${stageId}/materials`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          if (activeDrawerStage) {
            activeDrawerStage.plannedMaterials = data.data;
            activeDrawerStage.plannedMaterialsCount = data.data.length;
            if (drawerTabMaterialsBadge) drawerTabMaterialsBadge.textContent = data.data.length;
            updateStageCardCounts(activeDrawerStage.id);
          }
          renderDrawerMaterialsTable(data.data);
        }
      }
    } catch (err) {
      console.warn('Failed to load stage materials:', err);
    }
  }

  function renderDrawerMaterialsTable(materials) {
    if (!drawerMaterialsTableBody) return;
    drawerMaterialsTableBody.replaceChildren();

    if (!materials || materials.length === 0) {
      const row = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = canUpdate ? 5 : 4;
      td.className = 'text-center py-4 text-muted small';
      td.textContent = 'لا توجد مواد مخططة محددة لهذه المرحلة بعد.';
      row.appendChild(td);
      drawerMaterialsTableBody.appendChild(row);
      return;
    }

    materials.forEach((mat) => {
      const tr = document.createElement('tr');

      // Product Name
      const tdName = document.createElement('td');
      tdName.className = 'fw-bold text-dark';
      tdName.textContent = mat.product ? mat.product.name : 'مادة';
      tr.appendChild(tdName);

      // Product Code
      const tdCode = document.createElement('td');
      const spanCode = document.createElement('span');
      spanCode.className = 'badge bg-light text-dark border font-monospace';
      spanCode.textContent = mat.product ? mat.product.code : '—';
      tdCode.appendChild(spanCode);
      tr.appendChild(tdCode);

      // Unit
      const tdUnit = document.createElement('td');
      tdUnit.textContent = mat.productUnit ? mat.productUnit.name : '—';
      tr.appendChild(tdUnit);

      // Quantity
      const tdQty = document.createElement('td');
      tdQty.className = 'text-center fw-bold text-primary';
      tdQty.textContent = parseFloat(mat.plannedQuantity).toLocaleString();
      tr.appendChild(tdQty);

      // Delete action
      if (canUpdate) {
        const tdActions = document.createElement('td');
        tdActions.className = 'text-center';
        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'btn btn-sm btn-light p-1 text-danger';
        btnDel.title = 'حذف المادة';
        const iconDel = document.createElement('i');
        iconDel.className = 'fa-solid fa-trash-can';
        btnDel.appendChild(iconDel);
        btnDel.addEventListener('click', async () => {
          const resConfirm = await Swal.fire({
            title: 'حذف المادة المخططة',
            text: `هل تريد إزالة مادة "${mat.product ? mat.product.name : ''}" من هذه المرحلة؟`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc3545',
            confirmButtonText: 'نعم، حذف',
            cancelButtonText: 'إلغاء',
          });
          if (resConfirm.isConfirmed) {
            try {
              const res = await window.erpFetch(
                `/api/production/templates/${templateId}/stages/${activeDrawerStage.id}/materials/${mat.id}`,
                { method: 'DELETE' }
              );
              const data = await res.json();
              if (res.ok && data.success) {
                if (activeDrawerStage && Array.isArray(activeDrawerStage.plannedMaterials)) {
                  activeDrawerStage.plannedMaterials = activeDrawerStage.plannedMaterials.filter((m) => m.id !== mat.id);
                  activeDrawerStage.plannedMaterialsCount = activeDrawerStage.plannedMaterials.length;
                  if (drawerTabMaterialsBadge) drawerTabMaterialsBadge.textContent = activeDrawerStage.plannedMaterialsCount;
                  updateStageCardCounts(activeDrawerStage.id);
                  renderDrawerMaterialsTable(activeDrawerStage.plannedMaterials);
                }
                showToast('تم حذف المادة المخططة بنجاح');
              } else {
                Swal.fire('خطأ', data.message || 'تعذر حذف المادة', 'error');
              }
            } catch {
              Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
            }
          }
        });
        tdActions.appendChild(btnDel);
        tr.appendChild(tdActions);
      }

      drawerMaterialsTableBody.appendChild(tr);
    });
  }

  // Catalog Search Debounce & Pagination
  if (catalogSearchInput) {
    catalogSearchInput.addEventListener('input', () => {
      clearTimeout(catalogSearchDebounceTimer);
      catalogSearchDebounceTimer = setTimeout(() => {
        catalogSearchQuery = catalogSearchInput.value.trim();
        catalogCurrentPage = 1;
        fetchCatalogProducts(true);
      }, 300);
    });

    catalogSearchInput.addEventListener('focus', () => {
      if (catalogResultsList && catalogResultsList.children.length > 0) {
        catalogResultsBox.classList.remove('d-none');
      } else {
        fetchCatalogProducts(true);
      }
    });
  }

  if (btnCatalogLoadMore) {
    btnCatalogLoadMore.addEventListener('click', () => {
      if (catalogCurrentPage < catalogTotalPages) {
        catalogCurrentPage++;
        fetchCatalogProducts(false);
      }
    });
  }

  async function fetchCatalogProducts(reset) {
    if (!catalogResultsBox || !catalogResultsList) return;

    if (reset) {
      catalogResultsList.replaceChildren();
      const loading = document.createElement('div');
      loading.className = 'p-3 text-center text-muted small';
      loading.textContent = 'جاري البحث في الكتالوج...';
      catalogResultsList.appendChild(loading);
      catalogResultsBox.classList.remove('d-none');
    }

    try {
      const q = encodeURIComponent(catalogSearchQuery);
      const res = await window.erpFetch(`/api/inventory/products/reference-options?search=${q}&page=${catalogCurrentPage}&limit=20`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          catalogTotalPages = data.data.totalPages || 1;
          const items = data.data.items || [];

          if (reset) catalogResultsList.replaceChildren();

          if (items.length === 0 && reset) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'p-3 text-center text-muted small';
            emptyEl.textContent = 'لا توجد منتجات مطابقة لنتيجة البحث.';
            catalogResultsList.appendChild(emptyEl);
          } else {
            items.forEach((prod) => {
              const itemDiv = document.createElement('div');
              itemDiv.className = 'catalog-search-item';

              const infoSpan = document.createElement('div');
              const nameSpan = document.createElement('strong');
              nameSpan.className = 'text-dark small d-block';
              nameSpan.textContent = prod.name;
              const codeSpan = document.createElement('span');
              codeSpan.className = 'badge bg-light text-secondary font-monospace border small';
              codeSpan.textContent = prod.code;
              infoSpan.append(nameSpan, codeSpan);

              const btnPick = document.createElement('button');
              btnPick.type = 'button';
              btnPick.className = 'btn btn-xs btn-outline-primary py-0 px-2 small';
              btnPick.textContent = 'اختيار';

              itemDiv.append(infoSpan, btnPick);
              itemDiv.addEventListener('click', () => selectCatalogProduct(prod));
              catalogResultsList.appendChild(itemDiv);
            });
          }

          if (catalogLoadMoreContainer) {
            if (catalogCurrentPage < catalogTotalPages) {
              catalogLoadMoreContainer.classList.remove('d-none');
            } else {
              catalogLoadMoreContainer.classList.add('d-none');
            }
          }
          catalogResultsBox.classList.remove('d-none');
        }
      }
    } catch {
      if (reset) {
        catalogResultsList.replaceChildren();
        const errDiv = document.createElement('div');
        errDiv.className = 'p-3 text-center text-danger small';
        errDiv.textContent = 'حدث خطأ أثناء تحميل الكتالوج.';
        catalogResultsList.appendChild(errDiv);
      }
    }
  }

  async function selectCatalogProduct(product) {
    selectedCatalogProduct = product;
    if (catalogResultsBox) catalogResultsBox.classList.add('d-none');
    if (catalogSearchInput) catalogSearchInput.value = '';

    if (selectedProductContainer) {
      selectedProductContainer.classList.remove('d-none');
      if (selectedProductCode) selectedProductCode.textContent = product.code;
      if (selectedProductName) selectedProductName.textContent = product.name;
    }

    document.getElementById('selectedProductId').value = product.id;

    // Load units on demand
    if (drawerMaterialUnitSelect) {
      drawerMaterialUnitSelect.replaceChildren();
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = 'جاري تحميل الوحدات...';
      drawerMaterialUnitSelect.appendChild(defaultOpt);
      drawerMaterialUnitSelect.disabled = true;

      let units = productUnitsCache.get(product.id);
      if (!units) {
        try {
          const res = await window.erpFetch(`/api/inventory/products/${product.id}/units/reference-options`);
          if (res.ok) {
            const data = await res.json();
            if (data.success && Array.isArray(data.data)) {
              units = data.data;
              productUnitsCache.set(product.id, units);
            }
          }
        } catch {
          units = [];
        }
      }

      drawerMaterialUnitSelect.replaceChildren();
      const optSelect = document.createElement('option');
      optSelect.value = '';
      optSelect.textContent = '-- اختر وحدة القياس --';
      drawerMaterialUnitSelect.appendChild(optSelect);

      if (units && units.length > 0) {
        units.forEach((u) => {
          const opt = document.createElement('option');
          opt.value = u.id;
          opt.textContent = `${u.name}${u.isBase ? ' (الوحدة الأساسية)' : ''}`;
          drawerMaterialUnitSelect.appendChild(opt);
        });
        drawerMaterialUnitSelect.disabled = false;
        if (drawerMaterialQuantityInput) drawerMaterialQuantityInput.disabled = false;
        if (btnSubmitDrawerMaterial) btnSubmitDrawerMaterial.disabled = false;
      } else {
        const noUnitsOpt = document.createElement('option');
        noUnitsOpt.value = '';
        noUnitsOpt.textContent = 'لا توجد وحدات معرفة لهذا المنتج';
        drawerMaterialUnitSelect.appendChild(noUnitsOpt);
      }
    }
  }

  function deselectCatalogProduct() {
    selectedCatalogProduct = null;
    document.getElementById('selectedProductId').value = '';
    if (selectedProductContainer) selectedProductContainer.classList.add('d-none');
    if (drawerMaterialUnitSelect) {
      drawerMaterialUnitSelect.replaceChildren();
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = '-- اختر الوحدة --';
      drawerMaterialUnitSelect.appendChild(defaultOpt);
      drawerMaterialUnitSelect.disabled = true;
    }
    if (drawerMaterialQuantityInput) {
      drawerMaterialQuantityInput.value = '';
      drawerMaterialQuantityInput.disabled = true;
    }
    if (btnSubmitDrawerMaterial) btnSubmitDrawerMaterial.disabled = true;
  }

  if (btnDeselectProduct) btnDeselectProduct.addEventListener('click', deselectCatalogProduct);

  // Submit Drawer Add Material
  if (drawerAddMaterialForm) {
    drawerAddMaterialForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!activeDrawerStage || !selectedCatalogProduct) return;

      if (!drawerAddMaterialForm.checkValidity()) {
        drawerAddMaterialForm.classList.add('was-validated');
        return;
      }

      const productId = selectedCatalogProduct.id;
      const productUnitId = drawerMaterialUnitSelect.value;
      const plannedQuantity = drawerMaterialQuantityInput.value.trim();

      try {
        const res = await window.erpFetch(`/api/production/templates/${templateId}/stages/${activeDrawerStage.id}/materials`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId, productUnitId, plannedQuantity }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          if (!activeDrawerStage.plannedMaterials) activeDrawerStage.plannedMaterials = [];
          activeDrawerStage.plannedMaterials.push(data.data);
          activeDrawerStage.plannedMaterialsCount = activeDrawerStage.plannedMaterials.length;
          if (drawerTabMaterialsBadge) drawerTabMaterialsBadge.textContent = activeDrawerStage.plannedMaterialsCount;
          updateStageCardCounts(activeDrawerStage.id);

          renderDrawerMaterialsTable(activeDrawerStage.plannedMaterials);
          deselectCatalogProduct();
          showToast('تمت إضافة المادة المخططة للمرحلة بنجاح');
        } else {
          Swal.fire('خطأ', data.message || 'تعذر إضافة المادة', 'error');
        }
      } catch {
        Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
      }
    });
  }

  // ========================================================
  // 7. DRAWER TAB 3: REFERENCE DOCUMENTS MANAGEMENT
  // ========================================================

  const drawerAttachmentsList = document.getElementById('drawerStageAttachmentsList');
  const drawerUploadAttachmentForm = document.getElementById('drawerUploadAttachmentForm');
  const attachmentFileInput = document.getElementById('attachmentFileInput');
  const attachmentDescriptionInput = document.getElementById('attachmentDescriptionInput');
  const btnUploadAttachment = document.getElementById('btnUploadAttachment');
  const uploadSpinner = document.getElementById('uploadSpinner');

  async function loadDrawerStageAttachments(stageId) {
    if (!drawerAttachmentsList) return;
    drawerAttachmentsList.replaceChildren();

    try {
      const res = await window.erpFetch(`/api/production/templates/${templateId}/stages/${stageId}/attachments`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          if (activeDrawerStage) {
            activeDrawerStage.attachments = data.data;
            activeDrawerStage.attachmentsCount = data.data.length;
            if (drawerTabAttachmentsBadge) drawerTabAttachmentsBadge.textContent = data.data.length;
            updateStageCardCounts(activeDrawerStage.id);
          }
          renderDrawerAttachmentsList(data.data);
        }
      }
    } catch (err) {
      console.warn('Failed to load stage attachments:', err);
    }
  }

  function renderDrawerAttachmentsList(attachments) {
    if (!drawerAttachmentsList) return;
    drawerAttachmentsList.replaceChildren();

    if (!attachments || attachments.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'text-center py-4 text-muted border border-dashed rounded-3 bg-light bg-opacity-50';
      const icon = document.createElement('i');
      icon.className = 'fa-solid fa-paperclip fs-2 mb-2 text-secondary opacity-50';
      const p1 = document.createElement('p');
      p1.className = 'mb-1 fw-bold';
      p1.textContent = 'لا توجد وثائق مرجعية لهذه المرحلة بعد.';
      const p2 = document.createElement('p');
      p2.className = 'small text-muted mb-0';
      p2.textContent = 'يمكن إرفاق مخطط أو PDF أو صورة توضيحية تساعد على تنفيذ المرحلة.';
      emptyDiv.append(icon, p1, p2);
      drawerAttachmentsList.appendChild(emptyDiv);
      return;
    }

    attachments.forEach((att, index) => {
      const card = document.createElement('div');
      card.className = 'attachment-item-card d-flex justify-content-between align-items-center gap-2';

      // Left info
      const infoDiv = document.createElement('div');
      infoDiv.className = 'd-flex align-items-center gap-3 overflow-hidden';

      // Icon based on mime
      const iconDiv = document.createElement('div');
      iconDiv.className = 'fs-3';
      if (att.mimeType === 'application/pdf') {
        const pdfIcon = document.createElement('i');
        pdfIcon.className = 'fa-solid fa-file-pdf text-danger';
        iconDiv.appendChild(pdfIcon);
      } else {
        const imgIcon = document.createElement('i');
        imgIcon.className = 'fa-solid fa-file-image text-primary';
        iconDiv.appendChild(imgIcon);
      }
      infoDiv.appendChild(iconDiv);

      const textDiv = document.createElement('div');
      textDiv.className = 'text-truncate';

      const nameA = document.createElement('a');
      nameA.href = `/api/production/templates/${templateId}/stages/${activeDrawerStage.id}/attachments/${att.id}/file`;
      nameA.target = '_blank';
      nameA.className = 'fw-bold text-dark text-decoration-none d-block text-truncate';
      nameA.textContent = att.originalFileName;
      textDiv.appendChild(nameA);

      const metaSpan = document.createElement('span');
      metaSpan.className = 'text-muted small';
      const sizeKb = (att.sizeBytes / 1024).toFixed(1);
      const sizeStr = att.sizeBytes > 1048576 ? `${(att.sizeBytes / 1048576).toFixed(2)} MB` : `${sizeKb} KB`;
      metaSpan.textContent = `${sizeStr} • #${att.sortOrder}`;

      if (att.description) {
        const descSpan = document.createElement('span');
        descSpan.className = 'ms-2 text-secondary fst-italic';
        descSpan.textContent = `— ${att.description}`;
        metaSpan.appendChild(descSpan);
      }
      textDiv.appendChild(metaSpan);
      infoDiv.appendChild(textDiv);
      card.appendChild(infoDiv);

      // Actions
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'd-flex align-items-center gap-1 flex-shrink-0';

      // Download button
      const btnDownload = document.createElement('a');
      btnDownload.href = `/api/production/templates/${templateId}/stages/${activeDrawerStage.id}/attachments/${att.id}/file`;
      btnDownload.target = '_blank';
      btnDownload.className = 'btn btn-sm btn-light p-1';
      btnDownload.title = 'فتح / تحميل الملف';
      const iconDown = document.createElement('i');
      iconDown.className = 'fa-solid fa-arrow-up-right-from-square text-primary';
      btnDownload.appendChild(iconDown);
      actionsDiv.appendChild(btnDownload);

      if (canUpdate) {
        // Move Up
        const btnUp = document.createElement('button');
        btnUp.type = 'button';
        btnUp.className = 'btn btn-sm btn-light p-1';
        btnUp.title = 'تحريك لأعلى';
        btnUp.disabled = index === 0;
        const iconUp = document.createElement('i');
        iconUp.className = 'fa-solid fa-arrow-up text-secondary';
        btnUp.appendChild(iconUp);
        btnUp.addEventListener('click', () => moveAttachment(index, -1));
        actionsDiv.appendChild(btnUp);

        // Move Down
        const btnDown = document.createElement('button');
        btnDown.type = 'button';
        btnDown.className = 'btn btn-sm btn-light p-1';
        btnDown.title = 'تحريك لأسفل';
        btnDown.disabled = index === attachments.length - 1;
        const iconD = document.createElement('i');
        iconD.className = 'fa-solid fa-arrow-down text-secondary';
        btnDown.appendChild(iconD);
        btnDown.addEventListener('click', () => moveAttachment(index, 1));
        actionsDiv.appendChild(btnDown);

        // Delete
        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'btn btn-sm btn-light p-1 text-danger';
        btnDel.title = 'حذف الوثيقة';
        const iconDel = document.createElement('i');
        iconDel.className = 'fa-solid fa-trash-can';
        btnDel.appendChild(iconDel);
        btnDel.addEventListener('click', async () => {
          const resConfirm = await Swal.fire({
            title: 'حذف الوثيقة المرجعية',
            text: `هل تريد أرشفة وثيقة "${att.originalFileName}"؟`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc3545',
            confirmButtonText: 'نعم، حذف',
            cancelButtonText: 'إلغاء',
          });
          if (resConfirm.isConfirmed) {
            try {
              const res = await window.erpFetch(
                `/api/production/templates/${templateId}/stages/${activeDrawerStage.id}/attachments/${att.id}`,
                { method: 'DELETE' }
              );
              const data = await res.json();
              if (res.ok && data.success) {
                if (activeDrawerStage && Array.isArray(activeDrawerStage.attachments)) {
                  activeDrawerStage.attachments = activeDrawerStage.attachments.filter((a) => a.id !== att.id);
                  activeDrawerStage.attachments.forEach((a, idx) => {
                    a.sortOrder = idx + 1;
                  });
                  activeDrawerStage.attachmentsCount = activeDrawerStage.attachments.length;
                  if (drawerTabAttachmentsBadge) drawerTabAttachmentsBadge.textContent = activeDrawerStage.attachmentsCount;
                  updateStageCardCounts(activeDrawerStage.id);
                  renderDrawerAttachmentsList(activeDrawerStage.attachments);
                }
                showToast('تم حذف الوثيقة بنجاح');
              } else {
                Swal.fire('خطأ', data.message || 'تعذر حذف الوثيقة', 'error');
              }
            } catch {
              Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
            }
          }
        });
        actionsDiv.appendChild(btnDel);
      }

      card.appendChild(actionsDiv);
      drawerAttachmentsList.appendChild(card);
    });
  }

  async function moveAttachment(index, offset) {
    if (!activeDrawerStage || !Array.isArray(activeDrawerStage.attachments)) return;
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= activeDrawerStage.attachments.length) return;

    const previousOrder = [...activeDrawerStage.attachments];
    const movedItem = activeDrawerStage.attachments.splice(index, 1)[0];
    activeDrawerStage.attachments.splice(targetIndex, 0, movedItem);

    activeDrawerStage.attachments.forEach((a, idx) => {
      a.sortOrder = idx + 1;
    });
    renderDrawerAttachmentsList(activeDrawerStage.attachments);

    const attachmentIds = activeDrawerStage.attachments.map((a) => a.id);
    try {
      const res = await window.erpFetch(
        `/api/production/templates/${templateId}/stages/${activeDrawerStage.id}/attachments/reorder`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attachmentIds }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        activeDrawerStage.attachments = previousOrder;
        renderDrawerAttachmentsList(activeDrawerStage.attachments);
        Swal.fire('خطأ', data.message || 'تعذر إعادة ترتيب الوثائق', 'error');
      }
    } catch {
      activeDrawerStage.attachments = previousOrder;
      renderDrawerAttachmentsList(activeDrawerStage.attachments);
      Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
    }
  }

  // Upload Reference Document
  if (drawerUploadAttachmentForm) {
    drawerUploadAttachmentForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!activeDrawerStage) return;

      if (!drawerUploadAttachmentForm.checkValidity()) {
        drawerUploadAttachmentForm.classList.add('was-validated');
        return;
      }

      const file = attachmentFileInput.files[0];
      if (!file) {
        Swal.fire('تنبيه', 'يرجى اختيار ملف لرفعه', 'warning');
        return;
      }

      if (file.size > 20 * 1024 * 1024) {
        Swal.fire('خطأ', 'حجم الملف يتجاوز 20 ميغابايت المسموح بها', 'error');
        return;
      }

      const formData = new FormData();
      formData.append('file', file);
      const desc = attachmentDescriptionInput.value.trim();
      if (desc) formData.append('description', desc);

      if (btnUploadAttachment) btnUploadAttachment.disabled = true;
      if (uploadSpinner) uploadSpinner.classList.remove('d-none');

      try {
        const res = await window.erpFetch(
          `/api/production/templates/${templateId}/stages/${activeDrawerStage.id}/attachments`,
          {
            method: 'POST',
            body: formData,
          }
        );
        const data = await res.json();
        if (res.ok && data.success) {
          if (!activeDrawerStage.attachments) activeDrawerStage.attachments = [];
          activeDrawerStage.attachments.push(data.data);
          activeDrawerStage.attachmentsCount = activeDrawerStage.attachments.length;
          if (drawerTabAttachmentsBadge) drawerTabAttachmentsBadge.textContent = activeDrawerStage.attachmentsCount;
          updateStageCardCounts(activeDrawerStage.id);

          renderDrawerAttachmentsList(activeDrawerStage.attachments);
          drawerUploadAttachmentForm.reset();
          drawerUploadAttachmentForm.classList.remove('was-validated');
          showToast('تم رفع الوثيقة المرجعية بنجاح');
        } else {
          Swal.fire('خطأ', data.message || 'تعذر رفع الوثيقة', 'error');
        }
      } catch {
        Swal.fire('خطأ', 'تعذر الاتصال بالخادم أثناء رفع الملف', 'error');
      } finally {
        if (btnUploadAttachment) btnUploadAttachment.disabled = false;
        if (uploadSpinner) uploadSpinner.classList.add('d-none');
      }
    });
  }

  // Update counts on Stage Card in real-time
  function updateStageCardCounts(stageId) {
    const stageCard = document.querySelector(`.stage-card[data-stage-id="${stageId}"]`);
    if (!stageCard) return;

    const stage = currentStages.find((s) => s.id === stageId);
    if (!stage) return;

    const matBadge = stageCard.querySelector('.stage-mat-count-badge');
    if (matBadge) matBadge.textContent = stage.plannedMaterialsCount || 0;

    const attBadge = stageCard.querySelector('.stage-att-count-badge');
    if (attBadge) attBadge.textContent = stage.attachmentsCount || 0;
  }

  // ========================================================
  // 7. TASK WORKSPACE MODAL (Centered Modal for Option Task)
  // ========================================================

  const taskModalTitle = document.getElementById('taskModalTitle');
  const taskModalOrderBadge = document.getElementById('taskModalOrderBadge');
  const taskModalDeptBadge = document.getElementById('taskModalDeptBadge');
  const taskTabMaterialsBadge = document.getElementById('taskTabMaterialsBadge');
  const taskTabAttachmentsBadge = document.getElementById('taskTabAttachmentsBadge');

  // Form Elements inside Task Modal Tab 1
  const drawerTaskName = document.getElementById('drawerTaskName');
  const drawerTaskDeptId = document.getElementById('drawerTaskDeptId');
  const drawerTaskDuration = document.getElementById('drawerTaskDuration');
  const drawerTaskDurationUnit = document.getElementById('drawerTaskDurationUnit');
  const drawerTaskCost = document.getElementById('drawerTaskCost');
  const drawerTaskDescription = document.getElementById('drawerTaskDescription');
  const btnArchiveTaskModal = document.getElementById('btnArchiveTaskModal');

  // Task Materials elements
  const taskMaterialSearchInput = document.getElementById('taskMaterialSearchInput');
  const taskCatalogSearchResults = document.getElementById('taskCatalogSearchResults');
  const taskCatalogSearchResultsList = document.getElementById('taskCatalogSearchResultsList');
  const taskCatalogLoadMoreContainer = document.getElementById('taskCatalogLoadMoreContainer');
  const btnTaskCatalogLoadMore = document.getElementById('btnTaskCatalogLoadMore');
  const taskSelectedProductContainer = document.getElementById('taskSelectedProductContainer');
  const taskSelectedProductCode = document.getElementById('taskSelectedProductCode');
  const taskSelectedProductName = document.getElementById('taskSelectedProductName');
  const btnTaskDeselectProduct = document.getElementById('btnTaskDeselectProduct');
  const taskAddMaterialForm = document.getElementById('taskAddMaterialForm');
  const taskMaterialUnitSelect = document.getElementById('taskMaterialUnitSelect');
  const taskMaterialQuantityInput = document.getElementById('taskMaterialQuantityInput');
  const btnSubmitTaskMaterial = document.getElementById('btnSubmitTaskMaterial');
  const taskMaterialsTableBody = document.getElementById('taskMaterialsTableBody');

  // Task Attachments elements
  const taskUploadAttachmentForm = document.getElementById('taskUploadAttachmentForm');
  const taskAttachmentFileInput = document.getElementById('taskAttachmentFileInput');
  const taskAttachmentDescInput = document.getElementById('taskAttachmentDescInput');
  const btnUploadTaskAttachment = document.getElementById('btnUploadTaskAttachment');
  const taskUploadSpinner = document.getElementById('taskUploadSpinner');
  const taskAttachmentsListContainer = document.getElementById('taskAttachmentsListContainer');

  let selectedTaskCatalogProduct = null;
  let taskSearchDebounceTimer = null;
  let taskCatalogCurrentPage = 1;
  let taskCatalogTotalPages = 1;
  let taskCatalogSearchQuery = '';

  async function openTaskModal(patternId, optionId, task, activeTabId = 'tab-task-info') {
    activeModalTask = { patternId, optionId, task };

    if (taskModalTitle) taskModalTitle.textContent = task.name;
    if (taskModalOrderBadge) taskModalOrderBadge.textContent = `#${task.sortOrder}`;
    const dept = departmentsMap.get(task.departmentId);
    if (taskModalDeptBadge) taskModalDeptBadge.textContent = dept ? dept.name : task.departmentName || 'القسم';

    if (taskTabMaterialsBadge) taskTabMaterialsBadge.textContent = task.plannedMaterialsCount || 0;
    if (taskTabAttachmentsBadge) taskTabAttachmentsBadge.textContent = task.attachmentsCount || 0;

    if (drawerTaskName) drawerTaskName.value = task.name;
    if (drawerTaskDeptId) drawerTaskDeptId.value = task.departmentId;
    if (drawerTaskDuration) drawerTaskDuration.value = task.estimatedDurationValue ?? task.estimatedDurationMinutes ?? '';
    if (drawerTaskDurationUnit) drawerTaskDurationUnit.value = task.estimatedDurationUnit ?? 'MINUTES';
    if (drawerTaskCost) drawerTaskCost.value = task.estimatedCost ?? '';
    if (drawerTaskDescription) drawerTaskDescription.value = task.description || '';

    // Switch to requested tab
    const tabTriggerEl = document.getElementById(activeTabId);
    if (tabTriggerEl) {
      const tab = new bootstrap.Tab(tabTriggerEl);
      tab.show();
    }

    // Reset material picker inputs
    deselectTaskCatalogProduct();
    if (taskMaterialSearchInput) taskMaterialSearchInput.value = '';
    if (taskCatalogSearchResults) taskCatalogSearchResults.classList.add('d-none');

    // Load materials and attachments
    loadTaskMaterials();
    loadTaskAttachments();

    if (taskModal) taskModal.show();
  }

  // Task Info Form Submit
  if (taskInfoForm) {
    taskInfoForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!taskInfoForm.checkValidity() || !activeModalTask) {
        taskInfoForm.classList.add('was-validated');
        return;
      }

      const name = drawerTaskName.value.trim();
      const departmentId = drawerTaskDeptId.value;
      const durationVal = drawerTaskDuration.value.trim();
      const durationUnit = drawerTaskDurationUnit ? drawerTaskDurationUnit.value : 'MINUTES';
      const costVal = drawerTaskCost.value.trim();
      const description = drawerTaskDescription.value.trim() || undefined;

      const payload = {
        name,
        departmentId,
        estimatedDurationValue: durationVal ? parseInt(durationVal, 10) : null,
        estimatedDurationUnit: durationVal ? durationUnit : null,
        estimatedCost: costVal ? costVal : null,
        description: description ? description : null,
      };

      try {
        const { patternId, optionId, task } = activeModalTask;
        const res = await window.erpFetch(
          `/api/production/templates/${templateId}/patterns/${patternId}/options/${optionId}/tasks/${task.id}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        );
        const data = await res.json();
        if (res.ok && data.success) {
          Object.assign(task, data.data);
          const dept = departmentsMap.get(task.departmentId);
          task.departmentName = dept ? dept.name : 'قسم غير محدد';
          task.departmentCode = dept ? dept.code : 'N/A';

          // Sync task in currentPatterns so renderWorkflow() reflects updated task data
          const targetPattern = currentPatterns.find((p) => p.id === patternId);
          if (targetPattern && Array.isArray(targetPattern.options)) {
            const targetOption = targetPattern.options.find((o) => o.id === optionId);
            if (targetOption && Array.isArray(targetOption.tasks)) {
              const targetTask = targetOption.tasks.find((t) => t.id === task.id);
              if (targetTask) {
                Object.assign(targetTask, data.data, {
                  departmentName: task.departmentName,
                  departmentCode: task.departmentCode,
                });
              }
            }
          }

          if (taskModalTitle) taskModalTitle.textContent = task.name;
          if (taskModalDeptBadge) taskModalDeptBadge.textContent = task.departmentName;

          renderWorkflow();
          showToast('تم حفظ تعديلات المهمة بنجاح');
        } else {
          Swal.fire('خطأ', extractApiErrorMessage(data, 'تعذر تعديل المهمة'), 'error');
        }
      } catch {
        Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
      }
    });
  }

  if (btnArchiveTaskModal) {
    btnArchiveTaskModal.addEventListener('click', () => {
      if (!activeModalTask) return;
      archiveOptionTask(activeModalTask.patternId, activeModalTask.optionId, activeModalTask.task);
    });
  }

  // Load Task Materials
  async function loadTaskMaterials() {
    if (!activeModalTask) return;
    const { patternId, optionId, task } = activeModalTask;

    try {
      const res = await window.erpFetch(
        `/api/production/templates/${templateId}/patterns/${patternId}/options/${optionId}/tasks/${task.id}/materials`
      );
      const data = await res.json();
      if (res.ok && data.success) {
        task.materials = data.data;
        task.plannedMaterialsCount = data.data.length;
        if (taskTabMaterialsBadge) taskTabMaterialsBadge.textContent = task.plannedMaterialsCount;
        renderTaskMaterialsTable(task.materials);
      }
    } catch (err) {
      console.error('Failed to load task materials:', err);
    }
  }

  function renderTaskMaterialsTable(materials) {
    if (!taskMaterialsTableBody) return;
    taskMaterialsTableBody.replaceChildren();

    if (!materials || materials.length === 0) {
      const emptyRow = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = canUpdate ? 5 : 4;
      emptyCell.className = 'text-center py-4 text-muted';
      emptyCell.textContent = 'لم يتم تحديد أي مواد مطلوبة لهذه المهمة بعد.';
      emptyRow.appendChild(emptyCell);
      taskMaterialsTableBody.appendChild(emptyRow);
      return;
    }

    materials.forEach((mat) => {
      const tr = document.createElement('tr');

      const tdName = document.createElement('td');
      tdName.className = 'fw-bold text-dark';
      tdName.textContent = mat.product?.name || 'مادة غير محددة';

      const tdCode = document.createElement('td');
      tdCode.className = 'font-monospace small text-muted';
      tdCode.textContent = mat.product?.code || '—';

      const tdUnit = document.createElement('td');
      tdUnit.className = 'small';
      tdUnit.textContent = mat.productUnit?.name || '—';

      const tdQty = document.createElement('td');
      tdQty.className = 'text-center font-monospace fw-bold text-primary';
      tdQty.textContent = parseFloat(mat.plannedQuantity).toLocaleString();

      tr.append(tdName, tdCode, tdUnit, tdQty);

      if (canUpdate) {
        const tdActions = document.createElement('td');
        tdActions.className = 'text-center';
        const btnDelete = document.createElement('button');
        btnDelete.type = 'button';
        btnDelete.className = 'btn btn-sm btn-light text-danger p-1';
        btnDelete.title = 'إزالة المادة';
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-trash-can';
        btnDelete.appendChild(icon);
        btnDelete.addEventListener('click', () => removeTaskMaterial(mat.id));
        tdActions.appendChild(btnDelete);
        tr.appendChild(tdActions);
      }

      taskMaterialsTableBody.appendChild(tr);
    });
  }

  // Task Material Catalog Search & Unit Selection
  if (taskMaterialSearchInput) {
    taskMaterialSearchInput.addEventListener('input', () => {
      clearTimeout(taskSearchDebounceTimer);
      taskSearchDebounceTimer = setTimeout(() => {
        taskCatalogSearchQuery = taskMaterialSearchInput.value.trim();
        taskCatalogCurrentPage = 1;
        fetchTaskCatalogProducts(true);
      }, 300);
    });
  }

  if (btnTaskCatalogLoadMore) {
    btnTaskCatalogLoadMore.addEventListener('click', () => {
      if (taskCatalogCurrentPage < taskCatalogTotalPages) {
        taskCatalogCurrentPage++;
        fetchTaskCatalogProducts(false);
      }
    });
  }

  async function fetchTaskCatalogProducts(reset = true) {
    if (!taskCatalogSearchResults || !taskCatalogSearchResultsList) return;
    if (reset) {
      taskCatalogCurrentPage = 1;
      taskCatalogSearchResultsList.replaceChildren();
      const loadingEl = document.createElement('div');
      loadingEl.className = 'p-3 text-center text-muted small';
      loadingEl.textContent = 'جاري البحث في الكتالوج...';
      taskCatalogSearchResultsList.appendChild(loadingEl);
      taskCatalogSearchResults.classList.remove('d-none');
    }

    try {
      const q = encodeURIComponent(taskCatalogSearchQuery);
      const res = await window.erpFetch(`/api/inventory/products/reference-options?search=${q}&page=${taskCatalogCurrentPage}&limit=20`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          taskCatalogTotalPages = data.data.totalPages || 1;
          const items = data.data.items || [];

          if (reset) taskCatalogSearchResultsList.replaceChildren();

          if (items.length === 0 && reset) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'p-3 text-center text-muted small';
            emptyEl.textContent = 'لا توجد منتجات مطابقة لنتيجة البحث.';
            taskCatalogSearchResultsList.appendChild(emptyEl);
          } else {
            items.forEach((prod) => {
              const itemDiv = document.createElement('div');
              itemDiv.className = 'catalog-search-item';

              const infoSpan = document.createElement('div');
              const nameSpan = document.createElement('strong');
              nameSpan.className = 'text-dark small d-block';
              nameSpan.textContent = prod.name;
              const codeSpan = document.createElement('span');
              codeSpan.className = 'badge bg-light text-secondary font-monospace border small';
              codeSpan.textContent = prod.code;
              infoSpan.append(nameSpan, codeSpan);

              const btnPick = document.createElement('button');
              btnPick.type = 'button';
              btnPick.className = 'btn btn-xs btn-outline-primary py-0 px-2 small';
              btnPick.textContent = 'اختيار';

              itemDiv.append(infoSpan, btnPick);
              itemDiv.addEventListener('click', () => selectTaskCatalogProduct(prod));
              taskCatalogSearchResultsList.appendChild(itemDiv);
            });
          }

          if (taskCatalogLoadMoreContainer) {
            if (taskCatalogCurrentPage < taskCatalogTotalPages) {
              taskCatalogLoadMoreContainer.classList.remove('d-none');
            } else {
              taskCatalogLoadMoreContainer.classList.add('d-none');
            }
          }
          taskCatalogSearchResults.classList.remove('d-none');
        }
      }
    } catch {
      if (reset) {
        taskCatalogSearchResultsList.replaceChildren();
        const errDiv = document.createElement('div');
        errDiv.className = 'p-3 text-center text-danger small';
        errDiv.textContent = 'حدث خطأ أثناء تحميل الكتالوج.';
        taskCatalogSearchResultsList.appendChild(errDiv);
      }
    }
  }

  async function selectTaskCatalogProduct(product) {
    selectedTaskCatalogProduct = product;
    if (taskCatalogSearchResults) taskCatalogSearchResults.classList.add('d-none');
    if (taskMaterialSearchInput) taskMaterialSearchInput.value = '';

    if (taskSelectedProductContainer) {
      taskSelectedProductContainer.classList.remove('d-none');
      if (taskSelectedProductCode) taskSelectedProductCode.textContent = product.code;
      if (taskSelectedProductName) taskSelectedProductName.textContent = product.name;
    }

    // Load units on demand
    if (taskMaterialUnitSelect) {
      taskMaterialUnitSelect.replaceChildren();
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = 'جاري تحميل الوحدات...';
      taskMaterialUnitSelect.appendChild(defaultOpt);
      taskMaterialUnitSelect.disabled = true;

      let units = productUnitsCache.get(product.id);
      if (!units) {
        try {
          const res = await window.erpFetch(`/api/inventory/products/${product.id}/units/reference-options`);
          if (res.ok) {
            const data = await res.json();
            if (data.success && Array.isArray(data.data)) {
              units = data.data;
              productUnitsCache.set(product.id, units);
            }
          }
        } catch {
          units = [];
        }
      }

      taskMaterialUnitSelect.replaceChildren();
      const optSelect = document.createElement('option');
      optSelect.value = '';
      optSelect.textContent = '-- اختر وحدة القياس --';
      taskMaterialUnitSelect.appendChild(optSelect);

      if (units && units.length > 0) {
        units.forEach((u) => {
          const opt = document.createElement('option');
          opt.value = u.id;
          opt.textContent = `${u.name}${u.isBase ? ' (الوحدة الأساسية)' : ''}`;
          taskMaterialUnitSelect.appendChild(opt);
        });
        taskMaterialUnitSelect.disabled = false;
        if (taskMaterialQuantityInput) taskMaterialQuantityInput.disabled = false;
        if (btnSubmitTaskMaterial) btnSubmitTaskMaterial.disabled = false;
      } else {
        const noUnitsOpt = document.createElement('option');
        noUnitsOpt.value = '';
        noUnitsOpt.textContent = 'لا توجد وحدات معرفة لهذا المنتج';
        taskMaterialUnitSelect.appendChild(noUnitsOpt);
      }
    }
  }

  function deselectTaskCatalogProduct() {
    selectedTaskCatalogProduct = null;
    if (taskSelectedProductContainer) taskSelectedProductContainer.classList.add('d-none');
    if (taskMaterialUnitSelect) {
      taskMaterialUnitSelect.replaceChildren();
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = '-- اختر الوحدة --';
      taskMaterialUnitSelect.appendChild(defaultOpt);
      taskMaterialUnitSelect.disabled = true;
    }
    if (taskMaterialQuantityInput) {
      taskMaterialQuantityInput.value = '';
      taskMaterialQuantityInput.disabled = true;
    }
    if (btnSubmitTaskMaterial) btnSubmitTaskMaterial.disabled = true;
  }

  if (btnTaskDeselectProduct) btnTaskDeselectProduct.addEventListener('click', deselectTaskCatalogProduct);

  // Hide taskCatalogSearchResults on click outside
  document.addEventListener('click', (e) => {
    if (
      taskCatalogSearchResults &&
      !taskCatalogSearchResults.contains(e.target) &&
      e.target !== taskMaterialSearchInput
    ) {
      taskCatalogSearchResults.classList.add('d-none');
    }
  });

  // Submit Task Add Material
  if (taskAddMaterialForm) {
    taskAddMaterialForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!activeModalTask || !selectedTaskCatalogProduct) return;

      if (!taskAddMaterialForm.checkValidity()) {
        taskAddMaterialForm.classList.add('was-validated');
        return;
      }

      const productId = selectedTaskCatalogProduct.id;
      const productUnitId = taskMaterialUnitSelect.value;
      const plannedQuantity = taskMaterialQuantityInput.value.trim();

      const { patternId, optionId, task } = activeModalTask;
      try {
        const res = await window.erpFetch(
          `/api/production/templates/${templateId}/patterns/${patternId}/options/${optionId}/tasks/${task.id}/materials`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId, productUnitId, plannedQuantity }),
          }
        );
        const data = await res.json();
        if (res.ok && data.success) {
          if (!task.materials) task.materials = [];
          task.materials.push(data.data);
          task.plannedMaterialsCount = task.materials.length;
          if (taskTabMaterialsBadge) taskTabMaterialsBadge.textContent = task.plannedMaterialsCount;
          renderTaskMaterialsTable(task.materials);
          renderWorkflow();
          deselectTaskCatalogProduct();
          taskAddMaterialForm.classList.remove('was-validated');
          showToast('تمت إضافة المادة للمهمة بنجاح');
        } else {
          Swal.fire('خطأ', data.message || 'تعذر إضافة المادة', 'error');
        }
      } catch {
        Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
      }
    });
  }

  async function removeTaskMaterial(materialId) {
    if (!activeModalTask) return;
    const { patternId, optionId, task } = activeModalTask;

    const resConfirm = await Swal.fire({
      title: 'إزالة المادة',
      text: 'هل أنت متأكد من إزالة هذه المادة من المهمة؟',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      confirmButtonText: 'نعم، إزالة',
      cancelButtonText: 'إلغاء',
    });

    if (resConfirm.isConfirmed) {
      try {
        const res = await window.erpFetch(
          `/api/production/templates/${templateId}/patterns/${patternId}/options/${optionId}/tasks/${task.id}/materials/${materialId}`,
          {
            method: 'DELETE',
          }
        );
        const data = await res.json();
        if (res.ok && data.success) {
          if (task.materials) {
            task.materials = task.materials.filter((m) => m.id !== materialId);
            task.plannedMaterialsCount = task.materials.length;
          }
          if (taskTabMaterialsBadge) taskTabMaterialsBadge.textContent = task.plannedMaterialsCount || 0;
          renderTaskMaterialsTable(task.materials);
          renderWorkflow();
          showToast('تمت إزالة المادة بنجاح');
        } else {
          Swal.fire('خطأ', data.message || 'تعذر إزالة المادة', 'error');
        }
      } catch {
        Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
      }
    }
  }

  // Load Task Attachments
  async function loadTaskAttachments() {
    if (!activeModalTask) return;
    const { patternId, optionId, task } = activeModalTask;

    try {
      const res = await window.erpFetch(
        `/api/production/templates/${templateId}/patterns/${patternId}/options/${optionId}/tasks/${task.id}/attachments`
      );
      const data = await res.json();
      if (res.ok && data.success) {
        task.attachments = data.data;
        task.attachmentsCount = data.data.length;
        if (taskTabAttachmentsBadge) taskTabAttachmentsBadge.textContent = task.attachmentsCount;
        renderTaskAttachmentsList(task.attachments);
      }
    } catch (err) {
      console.error('Failed to load task attachments:', err);
    }
  }

  function renderTaskAttachmentsList(attachments) {
    if (!taskAttachmentsListContainer) return;
    taskAttachmentsListContainer.replaceChildren();

    if (!attachments || attachments.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'text-center py-4 text-muted border border-dashed rounded-3 bg-light bg-opacity-50';
      const icon = document.createElement('i');
      icon.className = 'fa-solid fa-paperclip fs-2 mb-2 text-secondary opacity-50';
      const p1 = document.createElement('p');
      p1.className = 'mb-1 fw-bold';
      p1.textContent = 'لا توجد وثائق مرجعية لهذه المهمة بعد.';
      const p2 = document.createElement('p');
      p2.className = 'small text-muted mb-0';
      p2.textContent = 'يمكن إرفاق مخطط أو PDF أو صورة توضيحية تساعد على تنفيذ المهمة.';
      emptyDiv.append(icon, p1, p2);
      taskAttachmentsListContainer.appendChild(emptyDiv);
      return;
    }

    attachments.forEach((att, index) => {
      const card = document.createElement('div');
      card.className = 'attachment-item-card d-flex justify-content-between align-items-center gap-2';

      // Left info
      const infoDiv = document.createElement('div');
      infoDiv.className = 'd-flex align-items-center gap-3 overflow-hidden';

      // Icon based on mime
      const iconDiv = document.createElement('div');
      iconDiv.className = 'fs-3';
      if (att.mimeType === 'application/pdf') {
        const pdfIcon = document.createElement('i');
        pdfIcon.className = 'fa-solid fa-file-pdf text-danger';
        iconDiv.appendChild(pdfIcon);
      } else {
        const imgIcon = document.createElement('i');
        imgIcon.className = 'fa-solid fa-file-image text-primary';
        iconDiv.appendChild(imgIcon);
      }
      infoDiv.appendChild(iconDiv);

      const textDiv = document.createElement('div');
      textDiv.className = 'text-truncate';

      const fileUrl = `/api/production/templates/${templateId}/patterns/${activeModalTask.patternId}/options/${activeModalTask.optionId}/tasks/${activeModalTask.task.id}/attachments/${att.id}/file`;

      const nameA = document.createElement('a');
      nameA.href = fileUrl;
      nameA.target = '_blank';
      nameA.className = 'fw-bold text-dark text-decoration-none d-block text-truncate';
      nameA.textContent = att.originalFileName;
      textDiv.appendChild(nameA);

      const metaSpan = document.createElement('span');
      metaSpan.className = 'text-muted small';
      const sizeKb = (att.sizeBytes / 1024).toFixed(1);
      const sizeStr = att.sizeBytes > 1048576 ? `${(att.sizeBytes / 1048576).toFixed(2)} MB` : `${sizeKb} KB`;
      metaSpan.textContent = `${sizeStr} • #${att.sortOrder}`;

      if (att.description) {
        const descSpan = document.createElement('span');
        descSpan.className = 'ms-2 text-secondary fst-italic';
        descSpan.textContent = `— ${att.description}`;
        metaSpan.appendChild(descSpan);
      }
      textDiv.appendChild(metaSpan);
      infoDiv.appendChild(textDiv);
      card.appendChild(infoDiv);

      // Actions
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'd-flex align-items-center gap-1 flex-shrink-0';

      // Download/open button
      const btnDownload = document.createElement('a');
      btnDownload.href = fileUrl;
      btnDownload.target = '_blank';
      btnDownload.className = 'btn btn-sm btn-light p-1';
      btnDownload.title = 'فتح / تحميل الملف';
      const iconDown = document.createElement('i');
      iconDown.className = 'fa-solid fa-arrow-up-right-from-square text-primary';
      btnDownload.appendChild(iconDown);
      actionsDiv.appendChild(btnDownload);

      if (canUpdate) {
        // Move Up
        const btnUp = document.createElement('button');
        btnUp.type = 'button';
        btnUp.className = 'btn btn-sm btn-light p-1';
        btnUp.title = 'تحريك لأعلى';
        btnUp.disabled = index === 0;
        const iconUp = document.createElement('i');
        iconUp.className = 'fa-solid fa-arrow-up text-secondary';
        btnUp.appendChild(iconUp);
        btnUp.addEventListener('click', () => moveTaskAttachment(index, -1));
        actionsDiv.appendChild(btnUp);

        // Move Down
        const btnDown = document.createElement('button');
        btnDown.type = 'button';
        btnDown.className = 'btn btn-sm btn-light p-1';
        btnDown.title = 'تحريك لأسفل';
        btnDown.disabled = index === attachments.length - 1;
        const iconD = document.createElement('i');
        iconD.className = 'fa-solid fa-arrow-down text-secondary';
        btnDown.appendChild(iconD);
        btnDown.addEventListener('click', () => moveTaskAttachment(index, 1));
        actionsDiv.appendChild(btnDown);

        // Delete
        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'btn btn-sm btn-light p-1 text-danger';
        btnDel.title = 'حذف الوثيقة';
        const iconDel = document.createElement('i');
        iconDel.className = 'fa-solid fa-trash-can';
        btnDel.appendChild(iconDel);
        btnDel.addEventListener('click', () => removeTaskAttachment(att.id, att.originalFileName));
        actionsDiv.appendChild(btnDel);
      }

      card.appendChild(actionsDiv);
      taskAttachmentsListContainer.appendChild(card);
    });
  }

  async function moveTaskAttachment(index, offset) {
    if (!activeModalTask || !Array.isArray(activeModalTask.task.attachments)) return;
    const { patternId, optionId, task } = activeModalTask;
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= task.attachments.length) return;

    const previousOrder = [...task.attachments];
    const movedItem = task.attachments.splice(index, 1)[0];
    task.attachments.splice(targetIndex, 0, movedItem);

    task.attachments.forEach((a, idx) => {
      a.sortOrder = idx + 1;
    });
    renderTaskAttachmentsList(task.attachments);

    const attachmentIds = task.attachments.map((a) => a.id);
    try {
      const res = await window.erpFetch(
        `/api/production/templates/${templateId}/patterns/${patternId}/options/${optionId}/tasks/${task.id}/attachments/reorder`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attachmentIds }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        task.attachments = previousOrder;
        renderTaskAttachmentsList(task.attachments);
        Swal.fire('خطأ', data.message || 'تعذر إعادة ترتيب الوثائق', 'error');
      }
    } catch {
      task.attachments = previousOrder;
      renderTaskAttachmentsList(task.attachments);
      Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
    }
  }

  // Upload Task Attachment
  if (taskUploadAttachmentForm) {
    taskUploadAttachmentForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!activeModalTask) return;

      if (!taskUploadAttachmentForm.checkValidity()) {
        taskUploadAttachmentForm.classList.add('was-validated');
        return;
      }

      const file = taskAttachmentFileInput ? taskAttachmentFileInput.files[0] : null;
      if (!file) {
        Swal.fire('تنبيه', 'يرجى اختيار ملف لرفعه', 'warning');
        return;
      }

      if (file.size > 20 * 1024 * 1024) {
        Swal.fire('خطأ', 'حجم الملف يتجاوز 20 ميغابايت المسموح بها', 'error');
        return;
      }

      const formData = new FormData();
      formData.append('file', file);
      const desc = taskAttachmentDescInput ? taskAttachmentDescInput.value.trim() : '';
      if (desc) formData.append('description', desc);

      if (btnUploadTaskAttachment) btnUploadTaskAttachment.disabled = true;
      if (taskUploadSpinner) taskUploadSpinner.classList.remove('d-none');
      const { patternId, optionId, task } = activeModalTask;

      try {
        const res = await window.erpFetch(
          `/api/production/templates/${templateId}/patterns/${patternId}/options/${optionId}/tasks/${task.id}/attachments`,
          {
            method: 'POST',
            body: formData,
          }
        );
        const data = await res.json();
        if (res.ok && data.success) {
          if (!task.attachments) task.attachments = [];
          task.attachments.push(data.data);
          task.attachmentsCount = task.attachments.length;
          if (taskTabAttachmentsBadge) taskTabAttachmentsBadge.textContent = task.attachmentsCount;
          renderTaskAttachmentsList(task.attachments);
          renderWorkflow();

          taskUploadAttachmentForm.reset();
          taskUploadAttachmentForm.classList.remove('was-validated');
          showToast('تم رفع الوثيقة المرجعية بنجاح');
        } else {
          Swal.fire('خطأ', data.message || 'تعذر رفع الوثيقة', 'error');
        }
      } catch {
        Swal.fire('خطأ', 'تعذر الاتصال بالخادم أثناء رفع الملف', 'error');
      } finally {
        if (btnUploadTaskAttachment) btnUploadTaskAttachment.disabled = false;
        if (taskUploadSpinner) taskUploadSpinner.classList.add('d-none');
      }
    });
  }

  async function removeTaskAttachment(attachmentId, fileName) {
    if (!activeModalTask) return;
    const { patternId, optionId, task } = activeModalTask;

    const resConfirm = await Swal.fire({
      title: 'حذف الوثيقة المرجعية',
      text: fileName ? `هل تريد أرشفة وثيقة "${fileName}"؟` : 'هل أنت متأكد من حذف هذه الوثيقة المرجعية؟',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      confirmButtonText: 'نعم، حذف',
      cancelButtonText: 'إلغاء',
    });

    if (resConfirm.isConfirmed) {
      try {
        const res = await window.erpFetch(
          `/api/production/templates/${templateId}/patterns/${patternId}/options/${optionId}/tasks/${task.id}/attachments/${attachmentId}`,
          {
            method: 'DELETE',
          }
        );
        const data = await res.json();
        if (res.ok && data.success) {
          if (task.attachments) {
            task.attachments = task.attachments.filter((a) => a.id !== attachmentId);
            task.attachments.forEach((a, idx) => {
              a.sortOrder = idx + 1;
            });
            task.attachmentsCount = task.attachments.length;
          }
          if (taskTabAttachmentsBadge) taskTabAttachmentsBadge.textContent = task.attachmentsCount || 0;
          renderTaskAttachmentsList(task.attachments);
          renderWorkflow();
          showToast('تم حذف الوثيقة بنجاح');
        } else {
          Swal.fire('خطأ', data.message || 'تعذر حذف الوثيقة', 'error');
        }
      } catch {
        Swal.fire('خطأ', 'تعذر الاتصال بالخادم', 'error');
      }
    }
  }

  // ========================================================
  // 8. WORKSPACE TABS & URL HASH SYNCHRONIZATION
  // ========================================================
  const workspaceTabs = document.getElementById('templateWorkspaceTabs');
  if (workspaceTabs) {
    // Sync tab switch with URL hash
    const tabTriggers = workspaceTabs.querySelectorAll('button[data-bs-toggle="pill"]');
    tabTriggers.forEach((trigger) => {
      trigger.addEventListener('shown.bs.tab', (e) => {
        const targetId = e.target.getAttribute('data-bs-target');
        if (targetId === '#pane-template-workflow') {
          history.replaceState(null, '', '#workflow');
        } else if (targetId === '#pane-template-specifications') {
          history.replaceState(null, '', '#specifications');
        } else if (targetId === '#pane-template-info') {
          history.replaceState(null, '', '#info');
        }
      });
    });

    // Handle deep linking from URL hash
    const currentHash = window.location.hash.toLowerCase();
    if (currentHash === '#workflow' || currentHash === '#stages') {
      const tab = document.getElementById('tab-template-workflow');
      if (tab) bootstrap.Tab.getOrCreateInstance(tab).show();
    } else if (currentHash === '#specifications' || currentHash === '#specs') {
      const tab = document.getElementById('tab-template-specifications');
      if (tab) bootstrap.Tab.getOrCreateInstance(tab).show();
    } else if (currentHash === '#info') {
      const tab = document.getElementById('tab-template-info');
      if (tab) bootstrap.Tab.getOrCreateInstance(tab).show();
    }

    // Header stat links click to switch tabs
    document.querySelectorAll('.header-stat-link').forEach((el) => {
      el.addEventListener('click', () => {
        const targetTabSelector = el.getAttribute('data-tab-target');
        if (targetTabSelector) {
          const tabBtn = document.querySelector(targetTabSelector);
          if (tabBtn) {
            bootstrap.Tab.getOrCreateInstance(tabBtn).show();
          }
        }
      });
    });
  }

  // ========================================================
  // 9. INITIAL RENDERING
  // ========================================================
  renderSpecifications();
  renderWorkflow();
});
