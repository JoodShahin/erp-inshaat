/**
 * Production Orders List Client JS
 */
document.addEventListener('DOMContentLoaded', () => {
  let currentPage = 1;
  const limit = 15;
  let currentSearch = '';
  let currentPriority = '';
  let searchTimeout = null;

  const tableBody = document.getElementById('ordersTableBody');
  const emptyState = document.getElementById('emptyOrdersState');
  const paginationList = document.getElementById('ordersPaginationList');
  const paginationInfo = document.getElementById('ordersPaginationInfo');
  const searchInput = document.getElementById('orderSearchInput');
  const priorityFilter = document.getElementById('orderPriorityFilter');
  const refreshBtn = document.getElementById('refreshOrdersBtn');

  const kpiTotalOrders = document.getElementById('kpiTotalOrders');
  const kpiDraftOrders = document.getElementById('kpiDraftOrders');
  const kpiApprovedOrders = document.getElementById('kpiApprovedOrders');
  const kpiTotalQuantity = document.getElementById('kpiTotalQuantity');

  // Initial load
  loadOrders();

  // Search input with debounce
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        currentSearch = e.target.value.trim();
        currentPage = 1;
        loadOrders();
      }, 350);
    });
  }

  // Priority filter dropdown
  if (priorityFilter) {
    priorityFilter.addEventListener('change', (e) => {
      currentPriority = e.target.value.trim();
      currentPage = 1;
      loadOrders();
    });
  }

  // Refresh button
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadOrders();
    });
  }

  function getErrorMessage(json, fallback) {
    if (typeof window.extractApiErrorMessage === 'function') {
      return window.extractApiErrorMessage(json, fallback);
    }
    return (json && json.message) || fallback;
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

  async function loadOrders() {
    setLoadingState();

    try {
      const url = new URL('/api/production/orders', window.location.origin);
      url.searchParams.set('page', currentPage.toString());
      url.searchParams.set('limit', limit.toString());
      if (currentSearch) {
        url.searchParams.set('search', currentSearch);
      }
      if (currentPriority) {
        url.searchParams.set('priority', currentPriority);
      }

      const res = await window.erpFetch(url.toString());
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(getErrorMessage(data, 'فشل جلب أوامر الإنتاج'));
      }

      renderOrdersTable(data.data);
    } catch (err) {
      renderErrorState(err.message || 'تعذر تحميل أوامر الإنتاج');
    }
  }

  function setLoadingState() {
    tableBody.innerHTML = `
      <tr>
        <td colspan="9" class="text-center py-5 text-muted">
          <div class="spinner-border text-primary spinner-border-sm me-2" role="status"></div>
          جاري تحميل أوامر الإنتاج...
        </td>
      </tr>
    `;
    emptyState.classList.add('d-none');
  }

  function renderErrorState(errorMessage) {
    tableBody.replaceChildren();

    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 9;
    td.className = 'text-center py-5 text-danger';

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-triangle-exclamation fs-3 mb-2 d-block';

    const msgDiv = document.createElement('div');
    msgDiv.textContent = errorMessage;

    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn btn-outline-secondary btn-sm mt-3';
    retryBtn.textContent = 'إعادة المحاولة';
    retryBtn.addEventListener('click', () => {
      loadOrders();
    });

    td.append(icon, msgDiv, retryBtn);
    tr.appendChild(td);
    tableBody.appendChild(tr);
    emptyState.classList.add('d-none');
  }

  function updateKPIs(summary, total) {
    if (summary) {
      if (kpiTotalOrders) kpiTotalOrders.textContent = (summary.totalOrders ?? total ?? 0).toString();
      if (kpiDraftOrders) kpiDraftOrders.textContent = (summary.draftOrders ?? 0).toString();
      if (kpiApprovedOrders) kpiApprovedOrders.textContent = (summary.approvedOrders ?? 0).toString();
      if (kpiTotalQuantity) kpiTotalQuantity.textContent = (summary.totalQuantity ?? 0).toString();
    } else {
      if (kpiTotalOrders) kpiTotalOrders.textContent = (total || 0).toString();
      if (kpiDraftOrders) kpiDraftOrders.textContent = (total || 0).toString();
      if (kpiApprovedOrders) kpiApprovedOrders.textContent = '0';
      if (kpiTotalQuantity) kpiTotalQuantity.textContent = '0';
    }
  }

  function renderOrdersTable(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('بيانات الاستجابة غير صالحة');
    }

    const { items, total, page, limit, totalPages, summary } = data;

    if (!Array.isArray(items)) {
      throw new Error('هيكل قائمة أوامر الإنتاج غير صالح');
    }
    if (!Number.isInteger(total) || total < 0) {
      throw new Error('إجمالي عدد أوامر الإنتاج غير صالح');
    }
    if (!Number.isInteger(page) || page < 1) {
      throw new Error('رقم الصفحة في الاستجابة غير صالح');
    }
    if (!Number.isInteger(totalPages) || totalPages < 1) {
      throw new Error('إجمالي عدد الصفحات غير صالح');
    }

    updateKPIs(summary, total);

    tableBody.innerHTML = '';

    if (items.length === 0) {
      emptyState.classList.remove('d-none');
      paginationInfo.textContent = 'عرض 0 من إجمالي 0 أمر';
      paginationList.innerHTML = '';
      return;
    }

    emptyState.classList.add('d-none');

    items.forEach((order) => {
      const tr = document.createElement('tr');

      // 1. Order Number
      const tdNumber = document.createElement('td');
      tdNumber.className = 'py-3 px-3';
      const orderLink = document.createElement('a');
      orderLink.href = `/production/orders/${order.id}`;
      orderLink.className = 'fw-bold text-primary font-monospace text-decoration-none';
      orderLink.textContent = order.orderNumber;
      tdNumber.appendChild(orderLink);
      tr.appendChild(tdNumber);

      // 2. Priority Badge
      const tdPriority = document.createElement('td');
      tdPriority.className = 'py-3 px-3';
      const pBadge = document.createElement('span');
      if (order.priority === 'CRITICAL') {
        pBadge.className = 'badge bg-danger-subtle text-danger-emphasis px-2 py-1 rounded-pill';
        pBadge.style.fontSize = '0.75rem';
        pBadge.textContent = 'حرجة';
      } else if (order.priority === 'HIGH') {
        pBadge.className = 'badge bg-warning-subtle text-warning-emphasis px-2 py-1 rounded-pill';
        pBadge.style.fontSize = '0.75rem';
        pBadge.textContent = 'عالية';
      } else if (order.priority === 'LOW') {
        pBadge.className = 'badge bg-secondary-subtle text-secondary-emphasis px-2 py-1 rounded-pill';
        pBadge.style.fontSize = '0.75rem';
        pBadge.textContent = 'منخفضة';
      } else {
        // NORMAL
        pBadge.className = 'badge bg-primary-subtle text-primary-emphasis px-2 py-1 rounded-pill';
        pBadge.style.fontSize = '0.75rem';
        pBadge.textContent = 'عادية';
      }
      tdPriority.appendChild(pBadge);
      tr.appendChild(tdPriority);

      // 3. Status Badge
      const tdStatus = document.createElement('td');
      tdStatus.className = 'py-3 px-3';
      const badge = document.createElement('span');
      if (order.status === 'APPROVED') {
        badge.className = 'badge bg-success-subtle text-success-emphasis px-2 py-1 rounded-pill';
        badge.style.fontSize = '0.75rem';
        badge.textContent = 'معتمد';
      } else {
        badge.className = 'badge bg-warning-subtle text-warning-emphasis px-2 py-1 rounded-pill';
        badge.style.fontSize = '0.75rem';
        badge.textContent = 'مسودة';
      }
      tdStatus.appendChild(badge);
      tr.appendChild(tdStatus);

      // 3. Description
      const tdDesc = document.createElement('td');
      tdDesc.className = 'py-3 px-3 text-muted small';
      tdDesc.style.maxWidth = '250px';
      tdDesc.textContent = order.title || '—';
      tr.appendChild(tdDesc);

      // 4. Line Count
      const tdLines = document.createElement('td');
      tdLines.className = 'py-3 px-3 text-center fw-bold text-dark';
      tdLines.textContent = order.summary.lineCount.toString();
      tr.appendChild(tdLines);

      // 5. Total Quantity
      const tdQty = document.createElement('td');
      tdQty.className = 'py-3 px-3 text-center fw-bold text-primary';
      tdQty.textContent = order.summary.totalQuantity.toString();
      tr.appendChild(tdQty);

      // 6. Created By
      const tdUser = document.createElement('td');
      tdUser.className = 'py-3 px-3 small text-secondary';
      tdUser.textContent = order.createdByUser ? order.createdByUser.fullName : '—';
      tr.appendChild(tdUser);

      // 7. Created At
      const tdDate = document.createElement('td');
      tdDate.className = 'py-3 px-3 small text-muted';
      tdDate.textContent = new Date(order.createdAt).toLocaleDateString('ar-EG');
      tr.appendChild(tdDate);

      // 8. Actions
      const tdActions = document.createElement('td');
      tdActions.className = 'py-3 px-3 text-end text-nowrap';

      // View Button -> /production/orders/:id (Read-Only)
      const viewBtn = document.createElement('a');
      viewBtn.href = `/production/orders/${order.id}`;
      viewBtn.className = 'btn btn-sm btn-outline-secondary me-1';
      viewBtn.setAttribute('title', 'عرض تفاصيل الطلب');
      const viewIcon = document.createElement('i');
      viewIcon.className = 'fa-solid fa-eye me-1';
      viewBtn.appendChild(viewIcon);
      const viewText = document.createElement('span');
      viewText.textContent = 'عرض';
      viewBtn.appendChild(viewText);
      tdActions.appendChild(viewBtn);

      // Edit Button -> /production/orders/:id/edit (Draft Editor)
      if (window.canUpdateOrder && order.status === 'DRAFT') {
        const editBtn = document.createElement('a');
        editBtn.href = `/production/orders/${order.id}/edit`;
        editBtn.className = 'btn btn-sm btn-outline-primary me-1';
        editBtn.setAttribute('title', 'تعديل وإعداد الطلب');
        const editIcon = document.createElement('i');
        editIcon.className = 'fa-solid fa-pen-to-square me-1';
        editBtn.appendChild(editIcon);
        const editText = document.createElement('span');
        editText.textContent = 'تعديل';
        editBtn.appendChild(editText);
        tdActions.appendChild(editBtn);
      }

      // Archive Button (if permitted) -> SweetAlert2
      if (window.canDeleteOrder && order.status === 'DRAFT') {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn-sm btn-outline-danger';
        delBtn.setAttribute('title', 'أرشفة الطلب');
        const delIcon = document.createElement('i');
        delIcon.className = 'fa-solid fa-trash-can';
        delBtn.appendChild(delIcon);

        delBtn.addEventListener('click', () => {
          Swal.fire({
            title: `أرشفة أمر الإنتاج ${order.orderNumber}`,
            text: `هل أنت متأكد من أرشفة أمر الإنتاج "${order.orderNumber}"؟ سيختفي من الأوامر النشطة ولن تتمكن من تعديل مسودته من القوائم العادية.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#EE5253',
            cancelButtonColor: '#6B7280',
            confirmButtonText: 'نعم، أرشفة',
            cancelButtonText: 'إلغاء',
          }).then(async (result) => {
            if (result.isConfirmed) {
              try {
                const response = await window.erpFetch(`/api/production/orders/${order.id}`, {
                  method: 'DELETE',
                });
                const resJson = await response.json();
                if (!response.ok || !resJson.success) {
                  throw new Error(getErrorMessage(resJson, 'فشل أرشفة الطلب'));
                }
                showSuccessToast('تمت أرشفة أمر الإنتاج بنجاح');
                loadOrders();
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

        tdActions.appendChild(delBtn);
      }
      tr.appendChild(tdActions);

      tableBody.appendChild(tr);
    });

    renderPagination(total, page, totalPages);
  }

  function renderPagination(total, page, totalPages) {
    paginationInfo.textContent = `عرض صفحة ${page} من إجمالي ${totalPages} (إجمالي الأوامر: ${total})`;
    paginationList.innerHTML = '';

    if (totalPages <= 1) return;

    // Prev Button
    const prevLi = document.createElement('li');
    prevLi.className = `page-item ${page <= 1 ? 'disabled' : ''}`;
    const prevLink = document.createElement('button');
    prevLink.className = 'page-link';
    prevLink.textContent = 'السابق';
    prevLink.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        loadOrders();
      }
    });
    prevLi.appendChild(prevLink);
    paginationList.appendChild(prevLi);

    // Page Numbers
    for (let p = 1; p <= totalPages; p++) {
      const pageLi = document.createElement('li');
      pageLi.className = `page-item ${p === page ? 'active' : ''}`;
      const pageLink = document.createElement('button');
      pageLink.className = 'page-link';
      pageLink.textContent = p.toString();
      pageLink.addEventListener('click', () => {
        if (currentPage !== p) {
          currentPage = p;
          loadOrders();
        }
      });
      pageLi.appendChild(pageLink);
      paginationList.appendChild(pageLi);
    }

    // Next Button
    const nextLi = document.createElement('li');
    nextLi.className = `page-item ${page >= totalPages ? 'disabled' : ''}`;
    const nextLink = document.createElement('button');
    nextLink.className = 'page-link';
    nextLink.textContent = 'التالي';
    nextLink.addEventListener('click', () => {
      if (currentPage < totalPages) {
        currentPage++;
        loadOrders();
      }
    });
    nextLi.appendChild(nextLink);
    paginationList.appendChild(nextLi);
  }
});
