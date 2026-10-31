/**
 * Production Order Show Page Workflow Actions
 *
 * Implements:
 * 1. Approve workflow action (DRAFT -> APPROVED)
 * 2. Reopen workflow action (APPROVED -> DRAFT)
 * 3. Pending toast display from sessionStorage
 * 4. Read-only invariants (no editing line contents)
 * 5. SweetAlert2 native modal confirmation and error feedback
 */
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('productionOrderShowContainer');
  const orderId = container ? container.dataset.orderId : null;

  // Show pending toast if present
  const pendingToast = sessionStorage.getItem('pendingToast');
  if (pendingToast) {
    sessionStorage.removeItem('pendingToast');
    if (typeof Swal !== 'undefined') {
      Swal.mixin({
        toast: true,
        position: 'top-start',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
      }).fire({
        icon: 'success',
        title: pendingToast,
      });
    }
  }

  if (!orderId) return;

  function getErrorMessage(json, fallback) {
    if (typeof window.extractApiErrorMessage === 'function') {
      return window.extractApiErrorMessage(json, fallback);
    }
    return (json && json.message) || fallback || 'حدث خطأ غير متوقع';
  }

  // 1. Approve Order Handler
  const approveBtn = document.getElementById('approveOrderBtn');
  if (approveBtn) {
    approveBtn.addEventListener('click', () => {
      Swal.fire({
        title: 'اعتماد أمر الإنتاج',
        text: 'سيتم اعتماد أمر الإنتاج وتحويله إلى مذكرة إنتاج جاهزة للتصنيع وإيقاف تعديل بنوده. هل تريد المتابعة؟',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#10AC84',
        cancelButtonColor: '#6B7280',
        confirmButtonText: 'نعم، اعتماد',
        cancelButtonText: 'إلغاء',
      }).then(async (result) => {
        if (!result.isConfirmed) return;

        approveBtn.disabled = true;
        const originalContent = approveBtn.innerHTML;
        approveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> جاري الاعتماد...';

        try {
          const res = await window.erpFetch(`/api/production/orders/${orderId}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          const json = await res.json();

          if (!res.ok || !json.success) {
            throw new Error(getErrorMessage(json, 'فشل اعتماد أمر الإنتاج'));
          }

          sessionStorage.setItem('pendingToast', 'تم اعتماد أمر الإنتاج وتحويله إلى مذكرة إنتاج جاهزة للتصنيع');
          window.location.reload();
        } catch (err) {
          approveBtn.disabled = false;
          approveBtn.innerHTML = originalContent;

          Swal.fire({
            icon: 'error',
            title: 'تعذر اعتماد أمر الإنتاج',
            text: err.message || 'حدث خطأ أثناء اعتماد أمر الإنتاج',
            confirmButtonText: 'حسناً',
            confirmButtonColor: '#0984E3',
          });
        }
      });
    });
  }

  // 2. Reopen Order Handler
  const reopenBtn = document.getElementById('reopenOrderBtn');
  if (reopenBtn) {
    reopenBtn.addEventListener('click', () => {
      Swal.fire({
        title: 'إعادة أمر الإنتاج إلى المسودة',
        text: 'سيصبح الطلب قابلاً للتعديل مرة أخرى، وسيتطلب إعادة الاعتماد بعد الانتهاء من التعديلات.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#F39C12',
        cancelButtonColor: '#6B7280',
        confirmButtonText: 'نعم، إعادة إلى مسودة',
        cancelButtonText: 'إلغاء',
      }).then(async (result) => {
        if (!result.isConfirmed) return;

        reopenBtn.disabled = true;
        const originalContent = reopenBtn.innerHTML;
        reopenBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> جاري الإعادة...';

        try {
          const res = await window.erpFetch(`/api/production/orders/${orderId}/reopen`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          const json = await res.json();

          if (!res.ok || !json.success) {
            throw new Error(getErrorMessage(json, 'فشل إعادة أمر الإنتاج إلى المسودة'));
          }

          sessionStorage.setItem('pendingToast', 'تمت إعادة أمر الإنتاج إلى المسودة بنجاح');
          window.location.reload();
        } catch (err) {
          reopenBtn.disabled = false;
          reopenBtn.innerHTML = originalContent;

          Swal.fire({
            icon: 'error',
            title: 'تعذر إعادة فتح أمر الإنتاج',
            text: err.message || 'حدث خطأ أثناء إعادة فتح أمر الإنتاج',
            confirmButtonText: 'حسناً',
            confirmButtonColor: '#0984E3',
          });
        }
      });
    });
  }

  // 3. Priority Update Handler (Admin mutation, independent of DRAFT/APPROVED lifecycle)
  const updatePriorityBtn = document.getElementById('updatePriorityBtn');
  const prioritySelect = document.getElementById('changePrioritySelect');
  if (updatePriorityBtn && prioritySelect) {
    updatePriorityBtn.addEventListener('click', async () => {
      const selectedPriority = prioritySelect.value;
      const currentPriority = prioritySelect.dataset.currentPriority;
      if (selectedPriority === currentPriority) {
        return;
      }

      updatePriorityBtn.disabled = true;
      const originalHtml = updatePriorityBtn.innerHTML;
      updatePriorityBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> جاري الحفظ...';

      try {
        const res = await window.erpFetch(`/api/production/orders/${orderId}/priority`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ priority: selectedPriority }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(getErrorMessage(json, 'فشل تحديث أولوية أمر الإنتاج'));
        }

        sessionStorage.setItem('pendingToast', 'تم تحديث أولوية أمر الإنتاج بنجاح');
        window.location.reload();
      } catch (err) {
        updatePriorityBtn.disabled = false;
        updatePriorityBtn.innerHTML = originalHtml;
        Swal.fire({
          icon: 'error',
          title: 'تعذر تحديث أولوية أمر الإنتاج',
          text: err.message || 'حدث خطأ أثناء تحديث الأولوية',
          confirmButtonText: 'حسناً',
          confirmButtonColor: '#0984E3',
        });
      }
    });
  }
  // 4. Execution Plan Inspection Modal Handler
  document.querySelectorAll('.view-plan-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const planId = btn.dataset.planId;
      const lineOrder = btn.dataset.lineOrder || '1';
      const templateName = btn.dataset.templateName || '—';
      const templateCode = btn.dataset.templateCode || '—';
      const tasksCount = btn.dataset.tasksCount || '—';

      const lineBadge = document.getElementById('planModalLineBadge');
      if (lineBadge) lineBadge.textContent = 'بند #' + lineOrder;
      const metaName = document.getElementById('planMetaTemplateName');
      if (metaName) metaName.textContent = templateName;
      const metaCode = document.getElementById('planMetaTemplateCode');
      if (metaCode) metaCode.textContent = templateCode;
      const metaTasks = document.getElementById('planMetaTasksCount');
      if (metaTasks) metaTasks.textContent = tasksCount;

      const loadingElem = document.getElementById('planTasksLoading');
      const containerElem = document.getElementById('planTasksContainer');
      const tbodyElem = document.getElementById('planTasksTbody');

      if (loadingElem) loadingElem.classList.remove('d-none');
      if (containerElem) containerElem.classList.add('d-none');
      if (tbodyElem) tbodyElem.replaceChildren();

      const modalElement = document.getElementById('executionPlanTasksModal');
      if (typeof bootstrap !== 'undefined' && modalElement) {
        bootstrap.Modal.getOrCreateInstance(modalElement).show();
      }

      try {
        const res = await window.erpFetch('/api/production/orders/' + orderId + '/execution-plans/' + planId);
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(getErrorMessage(json, 'فشل استرجاع تفاصيل الخطة التنفيذية'));
        }

        const plan = json.data;
        const metaQty = document.getElementById('planMetaQuantity');
        if (metaQty) metaQty.textContent = plan.lineQuantity + ' وحدة';
        if (metaTasks) metaTasks.textContent = (plan.tasks ? plan.tasks.length : 0) + ' مهمة';

        // Render technical specifications snapshot if present
        const specsSection = document.getElementById('planSpecsSection');
        const specsContainer = document.getElementById('planSpecsContainer');
        if (specsSection && specsContainer) {
          specsContainer.replaceChildren();
          if (plan.specifications && plan.specifications.length > 0) {
            specsSection.classList.remove('d-none');
            plan.specifications.forEach((spec) => {
              const badge = document.createElement('span');
              badge.className = 'badge bg-white text-dark border px-2 py-1 small shadow-sm';
              badge.textContent = spec.name + ': ' + spec.value + (spec.unit ? ' ' + spec.unit : '');
              specsContainer.appendChild(badge);
            });
          } else {
            specsSection.classList.add('d-none');
          }
        }

        if (tbodyElem) {
          tbodyElem.replaceChildren();
          const tasks = plan.tasks || [];
          if (tasks.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.setAttribute('colspan', '5');
            td.className = 'text-center py-4 text-muted';
            td.textContent = 'لا توجد مهام محددة لهذه الخطة التنفيذية';
            tr.appendChild(td);
            tbodyElem.appendChild(tr);
          } else {
            tasks.forEach((task) => {
              const tr = document.createElement('tr');

              // 1. Sort Order
              const tdSeq = document.createElement('td');
              tdSeq.className = 'text-center font-monospace text-muted fw-bold small';
              tdSeq.textContent = '#' + task.sortOrder;
              tr.appendChild(tdSeq);

              // 2. Name & Description
              const tdName = document.createElement('td');
              const divName = document.createElement('div');
              divName.className = 'fw-bold text-dark';
              divName.textContent = task.name;
              tdName.appendChild(divName);
              if (task.description) {
                const divDesc = document.createElement('div');
                divDesc.className = 'text-muted small';
                divDesc.textContent = task.description;
                tdName.appendChild(divDesc);
              }
              tr.appendChild(tdName);

              // 3. Department
              const tdDept = document.createElement('td');
              tdDept.className = 'small';
              tdDept.textContent = task.departmentName || '—';
              tr.appendChild(tdDept);

              // 4. Source Badge
              const tdSource = document.createElement('td');
              tdSource.className = 'text-center';
              const badge = document.createElement('span');
              if (task.taskSource === 'PATTERN_OPTION') {
                badge.className = 'badge bg-warning-subtle text-warning-emphasis px-2 py-1 rounded-pill small';
                badge.textContent = 'خاصة بالنمط: ' + (task.patternName || '') + ' (' + (task.optionName || '') + ')';
              } else {
                badge.className = 'badge bg-primary-subtle text-primary px-2 py-1 rounded-pill small';
                badge.textContent = 'مهمة عامة';
              }
              tdSource.appendChild(badge);
              tr.appendChild(tdSource);

              // 5. Estimated Duration
              const tdDuration = document.createElement('td');
              tdDuration.className = 'text-center font-monospace small';
              let durText = '—';
              if (task.estimatedDurationValue != null && task.estimatedDurationUnit) {
                if (task.estimatedDurationUnit === 'DAYS') {
                  durText = (task.estimatedDurationValue >= 3 && task.estimatedDurationValue <= 10) ? task.estimatedDurationValue + ' أيام' : task.estimatedDurationValue + ' يوم';
                } else if (task.estimatedDurationUnit === 'HOURS') {
                  durText = (task.estimatedDurationValue >= 3 && task.estimatedDurationValue <= 10) ? task.estimatedDurationValue + ' ساعات' : task.estimatedDurationValue + ' ساعة';
                } else {
                  durText = task.estimatedDurationValue + ' دقيقة';
                }
              } else if (task.estimatedDurationMinutes != null) {
                durText = task.estimatedDurationMinutes + ' دقيقة';
              }
              tdDuration.textContent = durText;
              tr.appendChild(tdDuration);

              tbodyElem.appendChild(tr);
            });
          }
        }

        if (loadingElem) loadingElem.classList.add('d-none');
        if (containerElem) containerElem.classList.remove('d-none');
      } catch (err) {
        if (loadingElem) loadingElem.classList.add('d-none');
        Swal.fire({
          icon: 'error',
          title: 'تعذر عرض الخطة التنفيذية',
          text: err.message || 'حدث خطأ أثناء تحميل الخطة التنفيذية',
          confirmButtonText: 'حسناً',
          confirmButtonColor: '#0984E3',
        });
      }
    });
  });

  // 5. Production Units Inspection Modal Handler
  document.querySelectorAll('.view-units-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const lineId = btn.dataset.lineId;
      const lineOrder = btn.dataset.lineOrder || '1';

      const unitsBadge = document.getElementById('unitsModalBadge');
      if (unitsBadge) unitsBadge.textContent = 'بند #' + lineOrder;

      const loadingElem = document.getElementById('unitsLoading');
      const containerElem = document.getElementById('unitsContainer');
      const tbodyElem = document.getElementById('orderUnitsTbody');

      if (loadingElem) loadingElem.classList.remove('d-none');
      if (containerElem) containerElem.classList.add('d-none');
      if (tbodyElem) tbodyElem.replaceChildren();

      const modalElement = document.getElementById('orderUnitsModal');
      if (typeof bootstrap !== 'undefined' && modalElement) {
        bootstrap.Modal.getOrCreateInstance(modalElement).show();
      }

      try {
        const queryParams = new URLSearchParams();
        if (lineId) queryParams.set('orderLineId', lineId);
        queryParams.set('limit', '100');
        const res = await window.erpFetch('/api/production/orders/' + orderId + '/units?' + queryParams.toString());
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(getErrorMessage(json, 'فشل استرجاع غرف أمر الإنتاج'));
        }

        const units = json.data?.items || json.data || [];

        if (tbodyElem) {
          tbodyElem.replaceChildren();
          if (units.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.setAttribute('colspan', '6');
            td.className = 'text-center py-4 text-muted';
            td.textContent = 'لم يتم إنشاء غرف لهذا الأمر بعد';
            tr.appendChild(td);
            tbodyElem.appendChild(tr);
          } else {
            units.forEach((unit) => {
              const tr = document.createElement('tr');

              // Sequence
              const tdSeq = document.createElement('td');
              tdSeq.className = 'text-center font-monospace text-muted fw-bold';
              tdSeq.textContent = '#' + unit.unitSequence;
              tr.appendChild(tdSeq);

              // Unit Number
              const tdNum = document.createElement('td');
              const strongNum = document.createElement('strong');
              strongNum.className = 'font-monospace text-dark';
              strongNum.textContent = unit.unitNumber;
              tdNum.appendChild(strongNum);
              tr.appendChild(tdNum);

              // Code
              const tdCode = document.createElement('td');
              tdCode.className = 'text-center';
              if (unit.code) {
                const spanCode = document.createElement('span');
                spanCode.className = 'badge bg-light text-dark border font-monospace';
                spanCode.textContent = unit.code;
                tdCode.appendChild(spanCode);
              } else {
                const spanEmpty = document.createElement('span');
                spanEmpty.className = 'text-muted small';
                spanEmpty.textContent = 'لم يُحدد بعد';
                tdCode.appendChild(spanEmpty);
              }
              tr.appendChild(tdCode);

              // Yard
              const tdYard = document.createElement('td');
              tdYard.className = 'text-center';
              if (unit.currentYardName) {
                const spanYard = document.createElement('span');
                spanYard.className = 'badge bg-info-subtle text-info-emphasis px-2 py-1 rounded-pill';
                spanYard.textContent = unit.currentYardName;
                tdYard.appendChild(spanYard);
              } else {
                const spanEmptyYard = document.createElement('span');
                spanEmptyYard.className = 'text-muted small';
                spanEmptyYard.textContent = 'لم تُحدد بعد';
                tdYard.appendChild(spanEmptyYard);
              }
              tr.appendChild(tdYard);

              // Status
              const tdStatus = document.createElement('td');
              tdStatus.className = 'text-center';
              const badgeStatus = document.createElement('span');
              badgeStatus.className = 'badge bg-primary-subtle text-primary px-2 py-1 rounded-pill';
              badgeStatus.textContent = 'جديدة (CREATED)';
              tdStatus.appendChild(badgeStatus);
              tr.appendChild(tdStatus);

              // Events Action
              const tdAction = document.createElement('td');
              tdAction.className = 'text-center';
              const btnEvents = document.createElement('button');
              btnEvents.type = 'button';
              btnEvents.className = 'btn btn-sm btn-outline-info py-0 px-2 d-inline-flex align-items-center gap-1';
              btnEvents.style.fontSize = '0.78rem';
              btnEvents.style.borderRadius = '6px';
              btnEvents.setAttribute('data-unit-id', unit.id);
              btnEvents.setAttribute('data-unit-number', unit.unitNumber);

              const iconEvents = document.createElement('i');
              iconEvents.className = 'fa-solid fa-clock-rotate-left';
              btnEvents.appendChild(iconEvents);

              const spanEvents = document.createElement('span');
              spanEvents.textContent = 'الأحداث';
              btnEvents.appendChild(spanEvents);

              btnEvents.addEventListener('click', (e) => {
                e.stopPropagation();
                openUnitEventsModal(unit.id, unit.unitNumber);
              });

              tdAction.appendChild(btnEvents);
              tr.appendChild(tdAction);

              tbodyElem.appendChild(tr);
            });
          }
        }

        if (loadingElem) loadingElem.classList.add('d-none');
        if (containerElem) containerElem.classList.remove('d-none');
      } catch (err) {
        if (loadingElem) loadingElem.classList.add('d-none');
        Swal.fire({
          icon: 'error',
          title: 'تعذر عرض الغرف',
          text: err.message || 'حدث خطأ أثناء استرجاع غرف أمر الإنتاج',
          confirmButtonText: 'حسناً',
          confirmButtonColor: '#0984E3',
        });
      }
    });
  });

  // 6. Unit Events Trail Modal Handler
  async function openUnitEventsModal(unitId, unitNumber) {
    const numBadge = document.getElementById('unitEventsModalNumber');
    if (numBadge) numBadge.textContent = unitNumber;

    const loadingElem = document.getElementById('unitEventsLoading');
    const containerElem = document.getElementById('unitEventsContainer');
    const tbodyElem = document.getElementById('unitEventsTbody');

    if (loadingElem) loadingElem.classList.remove('d-none');
    if (containerElem) containerElem.classList.add('d-none');
    if (tbodyElem) tbodyElem.replaceChildren();

    const modalElement = document.getElementById('unitEventsModal');
    if (typeof bootstrap !== 'undefined' && modalElement) {
      bootstrap.Modal.getOrCreateInstance(modalElement).show();
    }

    try {
      const res = await window.erpFetch('/api/production/orders/' + orderId + '/units/' + unitId + '/events?limit=100');
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(getErrorMessage(json, 'فشل استرجاع سجل أحداث الغرفة'));
      }

      const events = json.data?.items || json.data || [];
      if (tbodyElem) {
        tbodyElem.replaceChildren();
        if (events.length === 0) {
          const tr = document.createElement('tr');
          const td = document.createElement('td');
          td.setAttribute('colspan', '5');
          td.className = 'text-center py-4 text-muted';
          td.textContent = 'لا توجد أحداث مسجلة لهذه الغرفة';
          tr.appendChild(td);
          tbodyElem.appendChild(tr);
        } else {
          events.forEach((ev, idx) => {
            const tr = document.createElement('tr');

            // Sequence
            const tdSeq = document.createElement('td');
            tdSeq.className = 'text-center font-monospace text-muted small';
            tdSeq.textContent = '#' + (idx + 1);
            tr.appendChild(tdSeq);

            // Type
            const tdType = document.createElement('td');
            const badgeType = document.createElement('span');
            badgeType.className = 'badge bg-success-subtle text-success px-2 py-1 rounded-pill small';
            badgeType.textContent = ev.eventType === 'UNIT_CREATED' ? 'إنشاء الغرفة' : ev.eventType;
            tdType.appendChild(badgeType);
            tr.appendChild(tdType);

            // Performed By
            const tdUser = document.createElement('td');
            tdUser.className = 'small text-dark';
            tdUser.textContent = ev.createdByUser ? ev.createdByUser.fullName : 'النظام';
            tr.appendChild(tdUser);

            // Date
            const tdDate = document.createElement('td');
            tdDate.className = 'text-center font-monospace small text-muted';
            try {
              tdDate.textContent = new Date(ev.occurredAt).toLocaleString('ar-EG');
            } catch {
              tdDate.textContent = String(ev.occurredAt);
            }
            tr.appendChild(tdDate);

            // Details
            const tdDetails = document.createElement('td');
            tdDetails.className = 'small text-muted';
            if (ev.newData && ev.newData.unitNumber) {
              tdDetails.textContent = 'توليد الغرفة برقم تسلسلي #' + (ev.newData.unitSequence || '') + ' بحالة أولية CREATED';
            } else {
              tdDetails.textContent = '—';
            }
            tr.appendChild(tdDetails);

            tbodyElem.appendChild(tr);
          });
        }
      }

      if (loadingElem) loadingElem.classList.add('d-none');
      if (containerElem) containerElem.classList.remove('d-none');
    } catch (err) {
      if (loadingElem) loadingElem.classList.add('d-none');
      Swal.fire({
        icon: 'error',
        title: 'تعذر عرض سجل الأحداث',
        text: err.message || 'حدث خطأ أثناء استرجاع سجل أحداث الغرفة',
        confirmButtonText: 'حسناً',
        confirmButtonColor: '#0984E3',
      });
    }
  }

});
