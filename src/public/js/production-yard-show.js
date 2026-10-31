/**
 * Production Yard Show & Template Management Client Scripts
 * Compliant with PROJECT_RULES.md, UI_DESIGN_RULES.md, and SweetAlert2 Invariants
 */

(function () {
  'use strict';

  function extractApiErrorMessage(responseBody, fallback) {
    if (!responseBody) return fallback || 'حدث خطأ غير متوقع';

    var errorMessages = [];

    if (
      responseBody.errors &&
      typeof responseBody.errors === 'object' &&
      !Array.isArray(responseBody.errors)
    ) {
      Object.keys(responseBody.errors).forEach(function (key) {
        var val = responseBody.errors[key];
        if (Array.isArray(val)) {
          val.forEach(function (msg) {
            if (typeof msg === 'string' && msg.trim() !== '') {
              errorMessages.push(msg.trim());
            }
          });
        } else if (typeof val === 'string' && val.trim() !== '') {
          errorMessages.push(val.trim());
        }
      });
    } else if (Array.isArray(responseBody.errors)) {
      responseBody.errors.forEach(function (msg) {
        if (typeof msg === 'string' && msg.trim() !== '') {
          errorMessages.push(msg.trim());
        }
      });
    }

    if (
      errorMessages.length === 0 &&
      responseBody.message &&
      typeof responseBody.message === 'string'
    ) {
      errorMessages.push(responseBody.message);
    }

    var uniqueMessages = [];
    errorMessages.forEach(function (msg) {
      if (uniqueMessages.indexOf(msg) === -1) {
        uniqueMessages.push(msg);
      }
    });

    if (uniqueMessages.length > 0) {
      return uniqueMessages.join('، ');
    }

    return fallback || 'حدث خطأ أثناء معالجة الطلب';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var yardContextEl = document.getElementById('yardContext');
    if (!yardContextEl) return;

    var yardId = yardContextEl.getAttribute('data-yard-id');
    var yardName = yardContextEl.getAttribute('data-yard-name') || '';
    var canAdd = yardContextEl.getAttribute('data-can-add') === 'true';
    var canRemove = yardContextEl.getAttribute('data-can-remove') === 'true';

    // -------------------------------------------------------------
    // Removal of Template Link (SweetAlert2 Confirmation)
    // -------------------------------------------------------------
    if (canRemove) {
      var removeBtns = document.querySelectorAll('.remove-template-btn');
      removeBtns.forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          var templateId = this.getAttribute('data-template-id');
          var templateName = this.getAttribute('data-template-name') || 'القالب';

          if (typeof Swal === 'undefined') {
            return;
          }

          Swal.fire({
            title: 'فك ارتباط القالب',
            text:
              'هل أنت متأكد من فك ارتباط القالب "' +
              templateName +
              '" من الساحة "' +
              yardName +
              '"؟ لن يؤثر ذلك على القالب أو الساحة أو الخطط القائمة.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#EE5253',
            cancelButtonColor: '#6B7280',
            confirmButtonText: 'نعم، فك الارتباط',
            cancelButtonText: 'إلغاء',
          }).then(async function (result) {
            if (result.isConfirmed) {
              try {
                var response = await window.erpFetch(
                  '/api/production/yards/' + yardId + '/templates/' + templateId,
                  {
                    method: 'DELETE',
                  }
                );

                var json = await response.json().catch(function () {
                  return null;
                });

                if (response.ok && json && json.success) {
                  sessionStorage.setItem('pendingToast', 'تم فك ارتباط القالب بنجاح');
                  window.location.reload();
                } else {
                  var errMsg = extractApiErrorMessage(json, 'فشل في فك ارتباط القالب');
                  Swal.fire({
                    icon: 'error',
                    title: 'تعذر فك الارتباط',
                    text: errMsg,
                    confirmButtonText: 'حسناً',
                    confirmButtonColor: '#0984E3',
                  });
                }
              } catch (networkErr) {
                Swal.fire({
                  icon: 'error',
                  title: 'خطأ في الاتصال',
                  text: 'تعذر الاتصال بالخادم، يرجى المحاولة لاحقاً.',
                  confirmButtonText: 'حسناً',
                  confirmButtonColor: '#0984E3',
                });
              }
            }
          });
        });
      });
    }

    // -------------------------------------------------------------
    // Modal: Adding Templates
    // -------------------------------------------------------------
    if (canAdd) {
      var modalEl = document.getElementById('assignTemplatesModal');
      var loadingEl = document.getElementById('modalTemplatesLoading');
      var listContainerEl = document.getElementById('modalTemplatesList');
      var modalAlertEl = document.getElementById('modalAlert');
      var searchInput = document.getElementById('templateSearchInput');
      var selectAllBtn = document.getElementById('selectAllBtn');
      var deselectAllBtn = document.getElementById('deselectAllBtn');
      var selectedCountBadge = document.getElementById('selectedCountBadge');
      var submitBtn = document.getElementById('submitAssignTemplatesBtn');
      var submitSpinner = document.getElementById('submitSpinner');
      var submitIcon = document.getElementById('submitIcon');
      var submitBtnText = document.getElementById('submitBtnText');

      var allTemplates = [];

      function showModalAlert(message) {
        if (!modalAlertEl) return;
        modalAlertEl.textContent = message;
        modalAlertEl.classList.remove('d-none');
      }

      function hideModalAlert() {
        if (!modalAlertEl) return;
        modalAlertEl.textContent = '';
        modalAlertEl.classList.add('d-none');
      }

      function updateSelectionState() {
        var checkedBoxes = listContainerEl.querySelectorAll(
          '.template-checkbox:checked:not(:disabled)'
        );
        var count = checkedBoxes.length;

        if (selectedCountBadge) {
          selectedCountBadge.textContent = count + ' قالب محدد';
        }

        if (submitBtn) {
          submitBtn.disabled = count === 0;
        }
      }

      function filterTemplates(searchTerm) {
        var term = (searchTerm || '').trim().toLowerCase();
        var rows = listContainerEl.querySelectorAll('.template-list-item');

        var matchCount = 0;
        rows.forEach(function (row) {
          var name = (row.getAttribute('data-template-name') || '').toLowerCase();
          var code = (row.getAttribute('data-template-code') || '').toLowerCase();

          if (!term || name.indexOf(term) !== -1 || code.indexOf(term) !== -1) {
            row.classList.remove('d-none');
            matchCount++;
          } else {
            row.classList.add('d-none');
          }
        });

        var noResultsEl = document.getElementById('noResultsMsg');
        if (matchCount === 0 && rows.length > 0) {
          if (!noResultsEl) {
            noResultsEl = document.createElement('div');
            noResultsEl.id = 'noResultsMsg';
            noResultsEl.className = 'text-center py-4 text-muted small';
            noResultsEl.textContent = 'لا توجد قوالب تطابق مصطلح البحث.';
            listContainerEl.appendChild(noResultsEl);
          }
          noResultsEl.classList.remove('d-none');
        } else if (noResultsEl) {
          noResultsEl.classList.add('d-none');
        }
      }

      function renderTemplatesList(templates) {
        // Clear safely
        while (listContainerEl.firstChild) {
          listContainerEl.removeChild(listContainerEl.firstChild);
        }

        if (!templates || templates.length === 0) {
          var emptyDiv = document.createElement('div');
          emptyDiv.className = 'text-center py-4 text-muted';
          var emptyIcon = document.createElement('i');
          emptyIcon.className = 'fa-solid fa-layer-group fs-2 mb-2 d-block text-secondary';
          var emptyText = document.createElement('p');
          emptyText.className = 'mb-0 small';
          emptyText.textContent = 'لا توجد قوالب معتمدة متاحة للربط حالياً.';
          emptyDiv.appendChild(emptyIcon);
          emptyDiv.appendChild(emptyText);
          listContainerEl.appendChild(emptyDiv);
          return;
        }

        var listGroup = document.createElement('div');
        listGroup.className = 'list-group list-group-flush border rounded';

        templates.forEach(function (tmpl) {
          var label = document.createElement('label');
          label.className =
            'list-group-item list-group-item-action d-flex align-items-center justify-content-between p-3 template-list-item';
          label.setAttribute('data-template-name', tmpl.name);
          label.setAttribute('data-template-code', tmpl.code);
          label.setAttribute('data-template-id', tmpl.id);

          var rightSide = document.createElement('div');
          rightSide.className = 'd-flex align-items-center gap-3';

          var checkbox = document.createElement('input');
          checkbox.className = 'form-check-input template-checkbox mt-0';
          checkbox.type = 'checkbox';
          checkbox.value = tmpl.id;

          if (tmpl.isAssigned) {
            checkbox.disabled = true;
            checkbox.checked = true;
            label.style.backgroundColor = '#F8F9FA';
            label.style.cursor = 'not-allowed';
          } else {
            label.style.cursor = 'pointer';
            checkbox.addEventListener('change', updateSelectionState);
          }

          var textContainer = document.createElement('div');
          var titleDiv = document.createElement('div');
          titleDiv.className = 'fw-bold text-dark';
          titleDiv.textContent = tmpl.name;

          var codeSpan = document.createElement('code');
          codeSpan.className = 'bg-light text-muted px-2 py-0.5 rounded border small ms-2';
          codeSpan.textContent = tmpl.code;
          titleDiv.appendChild(codeSpan);

          textContainer.appendChild(titleDiv);

          if (tmpl.description) {
            var descDiv = document.createElement('div');
            descDiv.className = 'text-muted small text-truncate';
            descDiv.style.maxWidth = '380px';
            descDiv.textContent = tmpl.description;
            textContainer.appendChild(descDiv);
          }

          rightSide.appendChild(checkbox);
          rightSide.appendChild(textContainer);

          var leftSide = document.createElement('div');
          leftSide.className = 'd-flex align-items-center gap-2';

          if (tmpl.isAssigned) {
            var assignedBadge = document.createElement('span');
            assignedBadge.className = 'badge bg-secondary-subtle text-secondary-emphasis px-2 py-1 rounded-pill small';
            var linkIcon = document.createElement('i');
            linkIcon.className = 'fa-solid fa-link me-1';
            assignedBadge.appendChild(linkIcon);
            assignedBadge.appendChild(document.createTextNode('مرتبط مسبقاً'));
            leftSide.appendChild(assignedBadge);
          } else {
            var activeBadge = document.createElement('span');
            activeBadge.className = 'badge bg-success-subtle text-success px-2 py-1 rounded-pill small';
            activeBadge.textContent = 'متاح';
            leftSide.appendChild(activeBadge);
          }

          label.appendChild(rightSide);
          label.appendChild(leftSide);
          listGroup.appendChild(label);
        });

        listContainerEl.appendChild(listGroup);
        updateSelectionState();
      }

      async function loadAvailableTemplates() {
        hideModalAlert();
        loadingEl.classList.remove('d-none');
        listContainerEl.classList.add('d-none');
        if (searchInput) searchInput.value = '';

        try {
          var response = await window.erpFetch(
            '/api/production/yards/' + yardId + '/templates/available'
          );
          var json = await response.json().catch(function () {
            return null;
          });

          if (response.ok && json && json.success) {
            allTemplates = json.data || [];
            loadingEl.classList.add('d-none');
            listContainerEl.classList.remove('d-none');
            renderTemplatesList(allTemplates);
          } else {
            loadingEl.classList.add('d-none');
            var errMsg = extractApiErrorMessage(json, 'فشل في تحميل قائمة القوالب');
            showModalAlert(errMsg);
          }
        } catch (err) {
          loadingEl.classList.add('d-none');
          showModalAlert('تعذر الاتصال بالخادم لتحميل القوالب.');
        }
      }

      if (modalEl) {
        modalEl.addEventListener('show.bs.modal', function () {
          loadAvailableTemplates();
        });
      }

      if (searchInput) {
        searchInput.addEventListener('input', function () {
          filterTemplates(this.value);
        });
      }

      if (selectAllBtn) {
        selectAllBtn.addEventListener('click', function () {
          var visibleBoxes = listContainerEl.querySelectorAll(
            '.template-list-item:not(.d-none) .template-checkbox:not(:disabled)'
          );
          visibleBoxes.forEach(function (box) {
            box.checked = true;
          });
          updateSelectionState();
        });
      }

      if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', function () {
          var allBoxes = listContainerEl.querySelectorAll(
            '.template-checkbox:not(:disabled)'
          );
          allBoxes.forEach(function (box) {
            box.checked = false;
          });
          updateSelectionState();
        });
      }

      if (submitBtn) {
        submitBtn.addEventListener('click', async function () {
          hideModalAlert();
          var checkedBoxes = listContainerEl.querySelectorAll(
            '.template-checkbox:checked:not(:disabled)'
          );
          var selectedIds = [];
          checkedBoxes.forEach(function (box) {
            selectedIds.push(box.value);
          });

          if (selectedIds.length === 0) {
            showModalAlert('يرجى تحديد قالب واحد على الأقل للربط بالساحة.');
            return;
          }

          submitBtn.disabled = true;
          submitSpinner.classList.remove('d-none');
          submitIcon.classList.add('d-none');
          submitBtnText.textContent = 'جاري الحفظ...';

          try {
            var response = await window.erpFetch(
              '/api/production/yards/' + yardId + '/templates',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  templateIds: selectedIds,
                }),
              }
            );

            var json = await response.json().catch(function () {
              return null;
            });

            if (response.ok && json && json.success) {
              sessionStorage.setItem(
                'pendingToast',
                'تم ربط ' + selectedIds.length + ' قالب بنجاح بالساحة'
              );
              window.location.reload();
            } else {
              submitBtn.disabled = false;
              submitSpinner.classList.add('d-none');
              submitIcon.classList.remove('d-none');
              submitBtnText.textContent = 'ربط القوالب المحددة';

              var errMsg = extractApiErrorMessage(json, 'فشل في ربط القوالب بالساحة');
              showModalAlert(errMsg);
            }
          } catch (networkErr) {
            submitBtn.disabled = false;
            submitSpinner.classList.add('d-none');
            submitIcon.classList.remove('d-none');
            submitBtnText.textContent = 'ربط القوالب المحددة';
            showModalAlert('تعذر الاتصال بالخادم، يرجى التحقق من اتصالك والمحاولة لاحقاً.');
          }
        });
      }
    }
  });
})();
