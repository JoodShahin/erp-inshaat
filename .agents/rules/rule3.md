---
trigger: always_on
---

# UI_DESIGN_RULES.md

> المرجع القياسي لتصميم الواجهات وتجربة المستخدم (UI/UX) لكامل مشروع نظام ERP.
>
> لوحة تحكم إدارة النظام (`src/views/dashboard/system/` و `src/public/js/users.js` / `roles.js`) هي المقياس والمعيار المعتمد الذي يجب تطبيقه ومطابقته بدقة في كافة أقسام ووحدات النظام (المستودعات، الإنتاج، إلخ).

---

## 1. الهوية البصرية ونظام التصميم العام (Visual Design System)

- **الخط الأساسي**: خط `Cairo` عبر Google Fonts لكافة النصوص، مع اعتماد الأوزان: 400 (عادي)، 500 (متوسط)، 600 (شبه عريض)، 700 (عريض).
- **الاتجاه**: عربي كامل من اليمين لليسار (`dir="rtl"`).
- **ألوان الوحدات (Dynamic Module Primary Colors)**:
  - إدارة النظام (System): `#714B67`
  - إدارة المستودعات (Inventory): `#10AC84`
  - إدارة الإنتاج (Production): `#0984E3`
- **ألوان الحالات والنظام القياسية**:
  - النجاح والتفعيل (Success): `#10AC84` / `bg-success-subtle text-success`
  - الحذف والخطأ والخطر (Danger): `#EE5253` / `bg-danger-subtle text-danger`
  - التحذير والتعطيل (Warning): `#FF9F43` / `bg-warning-subtle text-warning-emphasis`
  - المعلومات والتصفح (Info): `#2E86DE` / `bg-info-subtle text-info-emphasis`
  - الحياد والرمادي (Secondary): `#6B7280` / `bg-secondary-subtle text-secondary-emphasis`
  - لون النصوص الرئيسي: `#1F2937`
  - خلفية الصفحات: `#F9FAFB`

---

## 2. ترويسة الصفحات (Page Headers)

### أ. ترويسة صفحات القوائم والجداول (List Pages):

```html
<div
  class="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-3"
>
  <div>
    <h3 class="fw-bold mb-1" style="color: #1F2937;">
      [اسم الصفحة / الوحدة]
      <i class="fa-solid fa-[icon] text-muted fs-5 ms-2"></i>
    </h3>
    <p class="text-muted mb-0 small">
      [وصف موجز لوظيفة الصفحة ودورها التشغيلي]
    </p>
  </div>
  <% if (typeof canCreate !== 'undefined' && canCreate) { %>
  <div>
    <a
      href="[مسار الإنشاء]"
      class="btn btn-primary d-inline-flex align-items-center gap-2 shadow-sm px-4 py-2"
      style="background-color: var(--primary-color); border-color: var(--primary-color); border-radius: 8px;"
    >
      <i class="fa-solid fa-plus"></i>
      <span>[نص زر الإضافة]</span>
    </a>
  </div>
  <% } %>
</div>
```

### ب. ترويسة صفحات النماذج والتعديل (Form / Create / Edit Pages):

- زر العودة يستخدم أيقونة السهم المتجه لليمين في اللغة العربية (`fa-arrow-right`):

```html
<div class="d-flex justify-content-between align-items-center mb-4">
  <div>
    <h3 class="fw-bold mb-1" style="color: #1F2937;">
      [عنوان النموذج] <i class="fa-solid fa-[icon] text-muted fs-5 ms-2"></i>
    </h3>
    <p class="text-muted mb-0 small">[وصف موجز للعملية]</p>
  </div>
  <a
    href="[مسار القائمة]"
    class="btn btn-outline-secondary d-inline-flex align-items-center gap-2"
    style="border-radius: 8px;"
  >
    <i class="fa-solid fa-arrow-right"></i>
    <span>العودة للقائمة</span>
  </a>
</div>
```

---

## 3. البطاقات ومربعات البحث والإحصائيات (Cards & KPI Components)

- **بطاقات الإحصائيات (KPI Cards)**:
  - حواف دائرية `border-radius: 12px;` وبدون حواف عامة `border-0 shadow-sm`.
  - شريط لوني جانبي بعرض 5 بكسل من جهة اليمين: `border-right: 5px solid [Color] !important;`.
  - أيقونة دائرية في الزاوية اليسرى بقياس 50x50 بكسل مع خلفية شفافة بنسبة 10%:
    ```html
    <div
      class="rounded-circle d-flex justify-content-center align-items-center"
      style="width: 50px; height: 50px; background-color: rgba([r, g, b], 0.1);"
    >
      <i class="fa-solid fa-[icon] fs-4" style="color: [Color];"></i>
    </div>
    ```

- **بطاقة البحث والتصفية (Search & Filter Card)**:
  - مغلفة في بطاقة مستقلة: `card border-0 shadow-sm mb-4` مع `style="border-radius: 12px;"`.
  - حقل البحث يحتوي أيقونة عدسة بيضاء في اليمين:
    ```html
    <div class="input-group">
      <span class="input-group-text bg-white border-end-0 text-muted"
        ><i class="fa-solid fa-magnifying-glass"></i
      ></span>
      <input
        type="text"
        class="form-control border-start-0 ps-0"
        placeholder="..."
      />
    </div>
    ```
  - زر بحث `btn btn-outline-secondary px-3` وزر إلغاء البحث `btn btn-link text-muted text-decoration-none`.

---

## 4. الجداول والقوائم (Tables & Pagination)

- **حاوية الجدول**:
  - `card border-0 shadow-sm` مع `style="border-radius: 12px; overflow: hidden;"`.
  - رأس البطاقة (اختياري) يعرض عنوان الجدول وشارة إجمالي السجلات:
    `<span class="badge bg-secondary-subtle text-secondary-emphasis px-3 py-2 rounded-pill">[N] عنصر</span>`.
- **هيكل الجدول**:
  - الكلاس الأساسي: `table table-hover align-middle mb-0`.
  - الترويسة: `<thead class="table-light"><tr class="text-muted small">...`.
  - التوسيط: الأرقام والحالات والإجراءات توسّط في المنتصف (`text-center`).
- **الشارات (Badges)**:
  - استخدام النمط الدائري الناعم دائماً: `rounded-pill px-2 py-1` أو `px-3 py-1`.
  - النشط: `<span class="badge bg-success-subtle text-success px-2 py-1 rounded-pill"><i class="fa-solid fa-circle-check me-1"></i> نشط</span>`.
  - المعطل: `<span class="badge bg-danger-subtle text-danger px-2 py-1 rounded-pill"><i class="fa-solid fa-circle-xmark me-1"></i> معطل</span>`.
- **أزرار الإجراءات في الجداول (Action Buttons)**:
  - جمع الأزرار داخل `<div class="d-inline-flex gap-1">`.
  - استخدام أزرار صغيرة ذات إطار مع أيقونات وتلميحات (`title`):
    - تعديل: `btn btn-sm btn-outline-primary` مع أيقونة `<i class="fa-solid fa-pen-to-square"></i>`.
    - أرشفة / حذف: `btn btn-sm btn-outline-danger` مع أيقونة `<i class="fa-solid fa-trash-can"></i>`.
    - عرض / تفاصيل: `btn btn-sm btn-outline-info` مع أيقونة `<i class="fa-solid fa-eye"></i>` أو `<i class="fa-solid fa-id-card"></i>`.
    - تفعيل / تعطيل: `btn btn-sm btn-outline-warning` أو `btn btn-sm btn-outline-success`.
- **حالة الجدول الفارغ (Empty State)**:
  ```html
  <tr>
    <td colspan="[N]" class="text-center py-5 text-muted">
      <div class="py-3">
        <i
          class="fa-solid fa-[empty-icon] fs-1 text-secondary mb-3 d-block"
        ></i>
        <p class="mb-0 fw-bold">[رسالة عدم وجود سجلات متطابقة مع البحث]</p>
      </div>
    </td>
  </tr>
  ```
- **تذييل الترقيم (Pagination Footer)**:
  - وضع شريط الترقيم داخل `card-footer bg-white border-top py-3 px-4 d-flex flex-wrap justify-content-between align-items-center`.
  - نص توضيحي في الجانب الأيمن: `عرض الصفحة X من إجمالي Y (إجمالي السجلات: Z)`.
  - روابط ترقيم في الجانب الأيسر: `pagination pagination-sm mb-0`.

---

## 5. النماذج والتحقق (Forms & Validation)

- **كلاسات النماذج**:
  - كل نموذج يحمل: `class="needs-validation" novalidate`.
- **حقول الإدخال ومجموعات التحقق**:
  - مجموعات الإدخال الإلزامية تحمل: `input-group has-validation`.
  - كل حقل إلزامي يحتوي `<div class="invalid-feedback">[رسالة خطأ واضحة باللغة العربية]</div>`.
- **حاوية أخطاء النموذج**:
  - بطاقة النموذج تحتوي على تنبيه خطأ علوي:
    `<div id="formAlert" class="alert alert-danger d-none mb-4" role="alert"></div>`.
- **أزرار الحفظ والإرسال**:
  ```html
  <div class="d-flex justify-content-end gap-2 pt-3 border-top">
    <a
      href="[مسار الإلغاء]"
      class="btn btn-light px-4"
      style="border-radius: 8px;"
      >إلغاء</a
    >
    <button
      type="submit"
      id="submitBtn"
      class="btn btn-primary d-inline-flex align-items-center gap-2 px-4"
      style="background-color: var(--primary-color); border-color: var(--primary-color); border-radius: 8px;"
    >
      <span
        class="spinner-border spinner-border-sm d-none"
        role="status"
        aria-hidden="true"
      ></span>
      <i class="fa-solid fa-check"></i>
      <span id="btnText">[نص الحفظ]</span>
    </button>
  </div>
  ```

---

## 6. معيار رسائل التنبيه وتأكيد الحذف (SweetAlert2 Invariants)

يُمنع منعاً باتاً استخدام `confirm()` أو `alert()` البدائية للمتصفح. يجب الالتزام بالمعايير التالية عبر مكتبة `SweetAlert2`:

### أ. رسائل النجاح التلقائية عبر (Pending Toast Pattern):

- عند نجاح أي عملية حفظ أو تعديل أو أرشفة تستوجب إعادة تحميل الصفحة أو التوجيه لصفحة أخرى، يتم حفظ نص الرسالة في `sessionStorage`:
  ```javascript
  sessionStorage.setItem("pendingToast", "تم [العملية] بنجاح");
  window.location.reload(); // أو window.location.href = '...';
  ```
- معالج التنبيهات العام في [scripts.ejs](file:///c:/Users/abo%20jood/Desktop/erp/src/views/dashboard/partials/scripts.ejs) يلتقطها فوراً ويعرض Toast عائم أنيق في أعلى الشاشة (`top-start`) مع شريط تقدم زمني لمدة 3 ثوانٍ.

### ب. تأكيد الحذف والأرشفة (Delete / Archive Confirmation):

```javascript
Swal.fire({
  title: "أرشفة [اسم الكيان]",
  text: 'هل أنت متأكد من رغبتك في أرشفة "[اسم العنصر]"؟ [الآثار الجانبية إن وجدت]',
  icon: "warning",
  showCancelButton: true,
  confirmButtonColor: "#EE5253", // الأحمر المعتمد للعمليات الحرجة
  cancelButtonColor: "#6B7280", // الرمادي المعتمد للإلغاء
  confirmButtonText: "نعم، أرشفة",
  cancelButtonText: "إلغاء",
}).then(async (result) => {
  if (result.isConfirmed) {
    // تنفيذ الطلب عبر window.erpFetch
  }
});
```

### ج. تأكيد تغيير الحالة (Status Toggle Confirmation):

```javascript
Swal.fire({
  title: newStatus ? "تفعيل [الكيان]" : "تعطيل [الكيان]",
  text: "هل أنت متأكد من ...",
  icon: "warning",
  showCancelButton: true,
  confirmButtonColor: newStatus ? "#10AC84" : "#FF9F43",
  cancelButtonColor: "#6B7280",
  confirmButtonText: newStatus ? "نعم، تفعيل" : "نعم، تعطيل",
  cancelButtonText: "إلغاء",
}).then(async (result) => {
  if (result.isConfirmed) {
    // تنفيذ الطلب
  }
});
```

### د. استخراج وعرض أخطاء الـ API (API Error Extraction):

- يجب استخدام الدالة الموحدة `extractApiErrorMessage(responseBody, fallback)` لاستخراج الأخطاء من الرد سواء كانت مصفوفة أو كائن حقول:
  ```javascript
  function extractApiErrorMessage(responseBody, fallback) {
    if (!responseBody) return fallback || "حدث خطأ غير متوقع";
    var errorMessages = [];
    if (
      responseBody.errors &&
      typeof responseBody.errors === "object" &&
      !Array.isArray(responseBody.errors)
    ) {
      Object.keys(responseBody.errors).forEach(function (key) {
        var val = responseBody.errors[key];
        if (Array.isArray(val)) {
          val.forEach(function (msg) {
            if (typeof msg === "string" && msg.trim())
              errorMessages.push(msg.trim());
          });
        } else if (typeof val === "string" && val.trim()) {
          errorMessages.push(val.trim());
        }
      });
    } else if (Array.isArray(responseBody.errors)) {
      responseBody.errors.forEach(function (msg) {
        if (typeof msg === "string" && msg.trim())
          errorMessages.push(msg.trim());
      });
    }
    if (
      errorMessages.length === 0 &&
      responseBody.message &&
      typeof responseBody.message === "string"
    ) {
      errorMessages.push(responseBody.message);
    }
    var uniqueMessages = Array.from(new Set(errorMessages));
    return uniqueMessages.length > 0
      ? uniqueMessages.join("، ")
      : fallback || "حدث خطأ أثناء معالجة الطلب";
  }
  ```
- عند فشل الحذف أو العمليات المنفذة عبر أزرار الجداول:
  ```javascript
  var errorMsg = extractApiErrorMessage(json, 'فشل في إتمام العملية');
  Swal.fire({
    icon: 'error',
    title: 'تعذر الحذف',
    text: errorMsg,
    confirmButtonText: 'حسناً',
    confirmButtonColor: var(--primary-color),
  });
  ```
- عند انقطاع الاتصال:
  ```javascript
  Swal.fire({
    icon: 'error',
    title: 'خطأ في الاتصال',
    text: 'تعذر الاتصال بالخادم، يرجى المحاولة لاحقاً.',
    confirmButtonText: 'حسناً',
    confirmButtonColor: var(--primary-color),
  });
  ```

---

## 7. أمن الواجهات والتفاعل البرمجي (Security & Frontend Communication)

- جميع طلبات التعديل والحذف والإنشاء تتم حصراً عبر `window.erpFetch` للاستفادة التلقائية من ترويسات الحماية والـ CSRF.
- يُحظر كلياً حقن نصوص المستخدم أو نصوص الـ API داخل `innerHTML`؛ يتم بناء عناصر الـ DOM حصراً عبر Native DOM APIs مع تعيين النصوص عبر `textContent` وتعيين الخصائص عبر `dataset` و `setAttribute`.
