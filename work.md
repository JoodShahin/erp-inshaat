# Project Technical Map

## Production Order Titles & Combination-Aware Draft Editor (in progress)

- Production orders now define a required `title` separate from optional `description` and `notes`. The new migration `1710000000030-AddProductionOrderTitle.ts` backfills existing orders using their description (or order number) and makes the new title non-null. Creation, draft header editing, order lists/detail and search use the new field.
- Draft editor `src/public/js/production-order-edit.js` retains the search-first template selection and existing full-configuration duplicate validation. It now preselects an UNUSED complete combination, and filters dependent pattern selections by the chosen prefix, offering only options that still admit at least one unused full combination. A template with no patterns may be selected once per order.
- The server's existing `PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION` validation and atomic `PUT /api/production/orders/:orderId/draft-lines` route remain authoritative. No runtime room allocation, order approval behavior, or existing room snapshot is changed by this UI task.
- **Post-test report repairs:** registered migration 0030 explicitly in `src/config/database.config.ts` (previous omission caused `No pending migrations to run` and `Unknown column title` in integration). Updated the option-picker regression test to normalize CRLF/LF on Windows; updated order-foundation test fixtures to supply the newly required title and added migration-registration coverage. These source/test corrections must be re-verified by the dedicated execution agent before release.
- **Verification pending:** run typecheck, build, unit and MySQL integration tests on `erp_inshaat_test` only, check manual editor scenarios for 2x2 patterns, zero patterns, exhaustions, deletion, modification and historic selections. Never connect to `erp_db1`.


## Production Template Versioning — Current Architecture

- **`src/modules/production/template-editing/production-template-editing.service.ts` — `ProductionTemplateEditingService`**: Atomic editing session manager and preview. `commitEditingSession(templateId, dto, userId?)` and `previewEditingSession(templateId, dto, userId?)` assert the **latest** active template version, compute a revision hash, normalize the requested operations, and apply structural/minor version decisions. Sessions are applied transactionally and support idempotency; preview remains read-only. Historical versions cannot be edited even when unused.
  - **`hasProductionUnitForTemplateVersion(templateId, manager?, versionId?)`**: Returns whether a physical room has ever been created from the specified template version; by default checks the latest version. SQL relation: `production_unit u → production_execution_plan p` (`u.plan_id = p.id`) and `production_order_line l` (`u.order_line_id = l.id`, `p.order_line_id = l.id`), filtering `p.template_id`, `l.template_id`, and `l.template_version_id`. It counts soft-deleted and cancelled units too, and excludes order lines/plans that have no unit.
  - **Version rules**: If the latest version has never supplied a room, all changes remain within that same version even if older versions supplied rooms or the client requests `NEW_VERSION`. Once the latest version supplied a room, STRUCTURAL changes create the next version automatically; MINOR changes can update the latest version or create a new version by user decision. No existing production room snapshots are updated.
  - **Dependencies**: `ProductionTemplateVersionService`, `ProductionTemplateEditingNormalizer`, `ProductionTemplateVersionCloner`, `ProductionTemplateGuardService`, TypeORM `EntityManager`, execution plan and order line records.
- **`src/modules/production/template/production-template.route.ts`**: `/:id/editing/preview` and `/:id/editing/commit` are the version-aware editing routes. Legacy direct workflow mutation endpoints reject edits when the **latest version** has supplied a room, forcing changes through versioned editing; this guard calls `hasProductionUnitForTemplateVersion(templateId)`.
- **`src/public/js/production-template-detail.js` and `src/views/dashboard/production/templates/show.ejs`**: Mobile-friendly workspace. Save preview checks `isTemplateUsedByRoom` for the current latest version. Unused versions save immediately, required structural forks save automatically, and only eligible minor changes prompt the user. Successful saves clear the editing session, hide the floating toolbar, and refresh the latest snapshot in the current tab. Historical versions are read-only.
- **`tests/production-template-versioning.integration.test.ts` and `tests/production-template-version-ui.test.ts`**: Regression coverage for immutable history, structural/minor decisions, per-version room usage (including archived rooms), guarded legacy API routes, and UI behavior. Fixtures use `linkTemplateToRoom(templateId)` to bind a real production unit to the **currently latest version** via its order line. Multi-fork tests create a new room after each new version when they expect another structural fork; an unused latest version must instead remain editable in place. Integration tests require the dedicated `erp_inshaat_test` database and must never touch `erp_db1`.


- **نظام صياغة أوامر الإنتاج وتحديد الأنماط — Production Order Drafting & Pattern Selection Foundation** (`src/modules/production/order/`):
  - **طبيعة أوامر الإنتاج وحالاتها (Production Order Aggregate & Approval Lifecycle)**:
    > ProductionOrder statuses: DRAFT, APPROVED.
    > New orders default to DRAFT.
    > Saving draft lines leaves the order in DRAFT.
    > APPROVED is administrative approval only.
    > APPROVED does NOT create production runtime, does NOT create snapshots, and does NOT release units.
    > Transitions: DRAFT -> APPROVED, APPROVED -> DRAFT.
    > Only DRAFT orders are mutable. APPROVED content is immutable; priority is administrative scheduling metadata and remains mutable through its dedicated authorized endpoint.
    - حالة أمر الإنتاج تحكمها قاعدة البيانات بقيد Check محدث في الهجرة 0015: `CHK_production_order_status CHECK (status IN ('DRAFT', 'APPROVED'))`.
    - هجرة 0015 (`AddProductionOrderApprovalStatus`):
      - تضيف العمودين `approved_at DATETIME(6) NULL` و `approved_by_user_id VARCHAR(36) NULL` مع فهرس وعلاقة أجنبية إلى `system_user`.
      - التراجع عن الهجرة (Down migration) يفشل بصرامة وبصوت عالٍ (Fail Loudly) عند وجود أي طلبات بحالة `APPROVED` في قاعدة البيانات لمنع أي تلاعب صامت بالبيانات.
    - مسار الاعتماد الصريح `POST /api/production/orders/:orderId/approve`:
      - يتطلب صلاحية مخصصة مستقلة `production.order.approve` (لا تكفي صلاحية `order.update`).
      - ينفذ داخل معاملة وتحت قفل تشاؤمي `pessimistic_write` على صف الطلب.
      - يعيد التحقق الصارم من جاهزية الطلب `validateOrderReadinessInternal` ويرفض الاعتماد بالرمز `PRODUCTION_ORDER_NOT_READY_FOR_APPROVAL` إذا كان الطلب فارغاً أو يحتوي اختيارات غير متوافقة أو معطلة.
      - يسجل `approvedAt = NOW()` و `approvedByUserId = authenticatedUserId`.
    - مسار إعادة الفتح `POST /api/production/orders/:orderId/reopen`:
      - يتطلب صلاحية `production.order.approve`.
      - ينفذ داخل معاملة وتحت قفل تشاؤمي `pessimistic_write` على صف الطلب.
      - يشترط أن يكون الطلب بحالة `APPROVED` ويعيده إلى `DRAFT` ويصفر `approvedAt = null` و `approvedByUserId = null`.
    - حظر التعديل التام على محتوى الطلب المعتمد واستثناء الأولوية الإدارية (APPROVED Content Immutability & Priority Exception):
      - ترفض كافة مسارات تعديل المحتوى التشغيلي (تعديل الترويسة، الحفظ الذري للبنود، إضافة بند، تعديل كمية، تغيير نمط، مزامنة، إعادة ترتيب، أرشفة بند، وأرشفة الطلب) أي طلب غير موجود بحالة `DRAFT` بالرمز الثابت `PRODUCTION_ORDER_NOT_DRAFT`.
      - الاستثناء الصريح الوحيد: أولوية أمر الإنتاج هي بيانات جدولة إدارية وتبقى قابلة للتعديل حتى أثناء كون الطلب `APPROVED` عبر مسارها المخصص والمصرح `PATCH /api/production/orders/:orderId/priority` دون إعادة فتح الطلب أو المساس بمحتواه.
  - **عقد أولوية أمر الإنتاج (Production Order Priority Contract)**:
    > Production Order Priority values: CRITICAL, HIGH, NORMAL, LOW.
    > Default priority: NORMAL.
    > Priority belongs to ProductionOrder ONLY; no duplicated priority on lines or future units/tasks.
    > Initial priority may be selected during creation.
    > Post-creation mutation requires production.order.update_priority.
    > Priority remains mutable while APPROVED; priority update is independent of content mutability.
    > APPROVED content is immutable; priority is administrative scheduling metadata and remains mutable through its dedicated authorized endpoint.
    > Dedicated endpoint: PATCH /api/production/orders/:orderId/priority.
    > Default list order: priority descending by business rank (CRITICAL -> HIGH -> NORMAL -> LOW), then oldest created first (created_at ASC), then ID (id ASC).
    > List supports server-side priority filtering; KPI summary respects active priority filter.
    - قيم الأولوية المعتمدة والتسميات باللغة العربية:
      - `CRITICAL` = حرجة (أعلى رتبة إدارية).
      - `HIGH` = عالية.
      - `NORMAL` = عادية (القيمة الافتراضية).
      - `LOW` = منخفضة.
    - الهجرة 0016 (`AddProductionOrderPriority`):
      - تضيف العمود `priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL'` إلى جدول `production_order`.
      - قيد فحص على مستوى قاعدة البيانات: `CHK_production_order_priority CHECK (priority IN ('CRITICAL', 'HIGH', 'NORMAL', 'LOW'))`.
      - فهرس أداء للفلترة: `IDX_production_order_priority (priority)`.
      - جميع السجلات القائمة في قاعدة البيانات تتحول تلقائياً وبأمان إلى `NORMAL` مع التحقق الصارم من عدم وجود قيم غير معروفة (Fail Loudly).
      - تعافٍ مستقل للمكونات (Independent Invariant Recovery) للعمود وقيد الفحص والفهرس لتفادي الأعطال الجزئية في DDL.
      - التراجع عن الهجرة (Down migration) يعكس التعديل بأمان وبشكل متسامح مع الحالات الجزئية.
    - الإنشاء والتحديث الإداري للأولوية:
      - أثناء الإنشاء: يقبل `CreateProductionOrderDto` حقلاً اختيارياً `priority` ويتحقق منه عبر `@IsEnum(ProductionOrderPriority)`، وفي حال عدم إرساله يُضبط افتراضياً على `NORMAL` على مستوى الـ Service والـ Database.
      - حظر إدراج الأولوية في `UpdateProductionOrderDto`: تعديل الترويسة العام مخصص للمسودات فقط (`DRAFT` only) ولا يقبل الأولوية إطلاقاً لمنع المساس بها أو تقييدها بحالة المسودة.
      - التعديل الإداري المستقل: مسار مخصص `PATCH /api/production/orders/:orderId/priority` يستقبل `UpdateProductionOrderPriorityDto` الذي يشترط `priority` كحقل إلزامي مدقق.
      - بروتوكول القفل للتحديث الإداري: استخدام `guardService.lockExistingOrder(orderId, manager)` للحصول على قفل تشاؤمي `pessimistic_write` على صف الطلب النشط دون اشتراط حالة `DRAFT`، وتعديل حقل `priority` فقط ذرياً دون أي مساس بالحالة أو بنود الطلب أو بيانات الاعتماد أو الترويسة، ولا يعيد فتح الطلب المعتمد نهائياً.
    - محرك الصلاحيات (Authorization):
      - الصلاحية المخصصة: `PRODUCTION_ORDER_UPDATE_PRIORITY` (`production.order.update_priority`) مسجلة في `SystemPermission` وتتبع لوحدة `production` ومسندة لقالب النطاق `[AccessScopePreset.ALL]`.
    - الفلترة والترتيب التلقائي في القائمة:
      - فلترة الخادم: يقبل مسار القائمة معامل `priority` اختياري يتم التحقق منه في `ListProductionOrdersQueryDto` ويطبق بصرامة على استعلام العناصر واستعلام ملخص مؤشرات الأداء `summary` معاً للحفاظ على اتساق الـ KPIs.
      - الترتيب الافتراضي للأعمال: رتبة الأولوية الإدارية تنازلياً عبر تعبير SQL CASE (`CRITICAL`=4، `HIGH`=3، `NORMAL`=2، `LOW`=1)، ثم الأقدم إنشاءً `created_at ASC`، ثم المعرف تصاعدياً `id ASC` لضمان حتمية الترتيب وتفضيل الطلبات الأقدم ضمن نفس الأولوية دون أي اعتماد على الترتيب الأبجدي.
    - الواجهات وتجربة المستخدم:
      - شاشة الإنشاء: قائمة اختيار الأولويات باللغة العربية مع اختيار "عادية" افتراضياً وإرسال القيمة الإنجليزية للـ API.
      - شاشة القائمة: شارة أولوية مرئية تعتمد على النص العربي صراحة (`[حرجة]`, `[عالية]`, `[عادية]`, `[منخفضة]`) مع فلتر خادم تفاعلي يعيد ضبط الترقيم للصفحة الأولى ويحتفظ بالبحث.
      - شاشة التفاصيل: شارة الأولوية في الترويسة، وبطاقة تحكم إدارية لتغيير الأولوية للمستخدمين المصرح لهم مع تحديث فوري وآمن.
      - شاشة التعديل: عرض الأولوية كقراءة فقط لضمان الفصل المعماري التام عن محرر بنود المسودة وعدم التأثير على حالة التغييرات غير المحفوظة.
      - الحماية من XSS: بناء وعرض نصوص وشارات الأولوية حصراً عبر Native DOM APIs (`textContent`, `createElement`).
  - **الحفظ الذري الموحد لبنود المسودة (Atomic Draft Lines Commit Endpoint)**:
    > Unified editor commits the target active line set atomically in one transaction.
    > ONE HTTP Request: PUT /api/production/orders/:orderId/draft-lines
    > ONE Database Transaction under ONE ProductionOrder pessimistic_write lock root.
    > ALL-OR-NOTHING: Zero partial saves possible.
    - يستقبل الطلب الحالة النهائية المستهدفة الكاملة (`target lines[]`):
      - البند الذي يحمل `id`: بند قائم يتم التحقق من تبعيته لنفس الطلب وثبات قالبه وعدم أرشفته مسبقاً.
      - البند بدون `id`: بند جديد مضاف للمسودة.
      - أي بند نشط في قاعدة البيانات غير موجود في الـ Payload: يُعتبر محذوفاً ويتم أرشفته ناعماً (`softDelete`) وتصفير الـ Hash الخاص به داخل نفس المعاملة.
    - بروتوكول التبديل الآمن للفهرس الفريد (Safe Configuration Swap Protocol):
      - لتفادي الاصطدام بالفهرس الفريد `UQ_prod_order_line_order_config_hash` عند تبديل التركيبات بين البنود القائمة (Swap Configs):
        - المرحلة A: تصفير مؤقت للـ Hash لجميع البنود النشطة المعنية في المعاملة (`activeConfigurationHash = NULL`).
        - المرحلة B: تطبيق التعديلات (تحديث الكميات، اختيارات الأنماط، الترتيب المكثف `1..N`، أرشفة البنود المحذوفة، وإدخال البنود الجديدة).
        - المرحلة C: كتابة رموز الـ Hashes النهائية المعتمدة والتحقق الصارم من عدم خروج أي بند نشط بدون Hash.
    - التحقق المسبق الشامل لكامل الحالة المستهدفة (Pre-Validation Before Mutation):
      - يتم فحص صحة جميع الكميات، ووجود القوالب وفعاليتها، وصحة اختيارات الأنماط، وعدم تكرار الـ Hashes داخل الـ Target State (`PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION`)، وصلاحية المعرفات القائمة قبل إجراء أي تعديل في قاعدة البيانات.
  - **معاينة المزامنة وعقد الخيارات التاريخية والتلف الهيكلي (Sync Preview & Historical Option Contract)**:
    > availableOptions contains active options only.
    > Historical selected option is preserved separately and is never treated as active.
    > Stale line must be synchronized before atomic save.
    > Sync Preview is read-only, mutates ZERO database rows, and fails closed on structural corruption.
    > Line reorder is performed in-memory and persisted only through atomic draft commit.
    > Approver identity must be authenticated; strictly NO fake "system-user" fallback.
    - مسار المعاينة `GET /api/production/orders/:orderId/lines/:lineId/sync-preview`:
      - يتحقق أولاً من عدم وجود أي تلف هيكلي (Fail Closed): إذا كان النمط أو الخيار مفقوداً فيزيائياً، أو كان النمط أجنبياً لا ينتمي لقالب البند، أو كان الخيار أجنبياً لا ينتمي للنمط، تفشل العملية فوراً بالرمز `PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT`.
      - الأنماط والخيارات المؤرشفة التي تنتمي للقالب الصحيح تُعامل كـ STALE فقط وليست تلفاً هيكلياً؛ يقترح النظام الخيار الفعال الافتراضي أو يضع تحذيراً بحذف النمط القديم.
      - لا يقوم المسار بأي كتابة أو تعديل في قاعدة البيانات إطلاقاً (Zero DB mutations).
    - عقد الخيارات التاريخية في الواجهة ومحرك الحفظ:
      - حقل `availableOptions` يحتوي حصراً على الخيارات الفعالة الحالية (`active options only`) ولا يحتوي إطلاقاً على خيارات مؤرشفة.
      - كائن الاختيار `ProductionOrderLinePatternSelectionDto` يعيد حقول دورة الحياة صراحة: `isPatternActive`, `isSelectedOptionActive`, `isHistorical`.
      - تُعرض الخيارات التاريخية غير الفعالة بوضوح كـ شارة تاريخية ("الخيار السابق: X (غير فعال)")، ولا يدرج الخيار المؤرشف كخيار فعال وهمي داخل قائمة `<select>`.
      - يمنع حفظ البند طالما يحتوي على خيار تاريخي أو غير فعال أو لا ينتمي الخيار إلى الخيارات الفعالة المتاحة؛ يجب على المستخدم الضغط على "مزامنة مع القالب" لتوليد تركيبة فعالة صالحة للحفظ.
    - إعادة ترتيب البنود في المحرر (In-Memory Line Reorder):
      - تتيح الواجهة أزرار تحريك للأعلى والأسفل `[↑] / [↓]` على كل بطاقة بند لتبديل الترتيب محلياً في الذاكرة.
      - يعتبر تغيير الترتيب تغييراً غير محفوظ (`dirty = true`) ويخضع لحارس المغادرة.
      - يتم إرسال الترتيب الجديد النهائي ضمن مصفوفة `lines[]` في طلب الحفظ الذري الموحد وتعيين `sortOrder: 1..N` حتمياً ومكثفاً.
    - هوية المعتمد في مسار الاعتماد (`approveOrder`):
      - يشترط وجود معرف مستخدم موثق وصالح (`currentUser.id`)؛ وفي حال غيابه تفشل العملية فوراً بالرمز `PRODUCTION_ORDER_APPROVER_REQUIRED` دون أي استخدام لبدائل وهمية مثل `system-user`.
  - **تحسينات تجربة المستخدم والأمان لواجهات أوامر الإنتاج**:
    - **سلامة إدخال الكميات (Quantity Typing UX & No-parseInt Invariant)**:
      - حظر تام لـ `parseInt` في معالجة كميات الأوامر؛ الاعتماد حصراً على `Number(value)` وفحص `Number.isInteger(value) && value >= 1 && value <= 10000`.
      - الأعداد العشرية (مثل `2.5`) ترفض صراحة كقيمة غير صالحة ولا تتحول بصمت إلى `2`.
      - عدم إعادة بناء كامل DOM (`no renderLines() on input`) عند الكتابة في حقل الكمية، مما يحافظ على تركيز المؤشر (Focus & Caret) وسلاسة الكتابة.
    - **القضاء التام على ثغرات XSS الديناميكية (Zero Dynamic XSS Invariants)**:
      - حظر دمج أي نصوص ديناميكية أو رسائل خطأ من الـ API أو أسماء القوالب والأنماط داخل `innerHTML`.
      - بناء عناصر التنبيهات ورسائل الأخطاء في المحرر وقائمة الأوامر (`renderErrorState`) حصراً عبر Native DOM APIs الآمنة (`document.createElement`, `textContent`, `append`).
    - **حماية التغييرات غير المحفوظة (Unsaved Changes Navigation Guard)**:
      - دالة `hasUnsavedLineChanges()` تراقب بدقة أي تعديل على الكميات، أو خيارات الأنماط، أو البنود المضافة، أو المحذوفة، أو المزامنة، أو إعادة الترتيب.
      - عند محاولة مغادرة الصفحة عبر أزرار التنقل أو الإلغاء، يُعرض تحذير SweetAlert2 لمنع فقدان البيانات.
      - تفعيل حارس `beforeunload` فقط عندما تكون الصفحة متغيرة (`dirty`).
    - **عرض تفاصيل الطلب على الهاتف المحمول (Mobile Show Stacked Cards)**:
      - في الشاشات العريضة (Desktop): جدول تفصيلي منظم ومرن.
      - في شاشات الجوال (`max-width: 767.98px`): تحويل صفوف الجدول إلى بطاقات مكدسة (Stacked Cards) معتمدة على `data-label` وعرض مرن يمنع التمرير الأفقي تماماً (No horizontal scrolling).
    - **مؤشرات الأداء الشاملة وعقد قائمة الأوامر والترقيم (List KPI Aggregates & Safe Pagination)**:
      - 4 بطاقات KPI في ترويسة قائمة الأوامر (`إجمالي الأوامر`, `المسودات`, `المعتمدة`, `إجمالي الكميات`).
      - القيم مستمدة مباشرة من التجميع العام في قاعدة البيانات (`summary` من الـ SQL Aggregate) والمطابقة لكلمة البحث الحالية، وليست مقصورة على الصفحة المعروضة فقط.
      - عقد استجابة قائمة أوامر الإنتاج الموحد:
        ```text
        {
          items: ProductionOrderListItemDto[],
          total: number,
          page: number,
          limit: number,
          totalPages: number,
          summary: {
            totalOrders: number,
            draftOrders: number,
            approvedOrders: number,
            totalQuantity: number
          }
        }
        ```
      - استخراج بيانات التصفح في العميل يتم صراحة من كائن الاستجابة (`const { items, total, page, totalPages, summary } = data`) مع التحقق المسبق من سلامة العقد (`items` مصفوفة، `total` غير سالب، `page >= 1`، `totalPages >= 1`) لمنع أخطاء `ReferenceError` وتفادي الانهيار الصامت.
    - **نصوص ومصطلحات الجاهزية والاعتماد في الواجهة (Readiness & Approval UI Wording)**:
      - تستخدم الواجهات حصراً النصوص الدقيقة: "جاهز للاعتماد" و "يحتاج مراجعة قبل الاعتماد".
      - حظر تام لظهور مصطلح "جاهز للإطلاق" في شاشات تأسيس أوامر الإنتاج (`index.ejs`, `show.ejs`, `edit.ejs`).
      - المسميات البرمجية الداخلية الموروثة (مثل `validateDraftForRelease` و `/release-readiness`) تبقى كدين تقني داخلي مؤقت لتوافق الـ API دون أن تعني وجود وظيفة إطلاق في هذه المرحلة.
  - **هيكل وتجميعة أمر الإنتاج (Order Aggregate Structure)**:
    ```text
    ProductionOrder
    └── ProductionOrderLine
        └── ProductionOrderLinePatternSelection
    ```
    - الجداول المعتمدة (4 جداول): `production_order`, `production_order_sequence`, `production_order_line`, `production_order_line_pattern_selection`.
    - النماذج مقسمة إلى 3 مجلدات مستقلة تماماً:
      ```text
      src/modules/production/order/
      src/modules/production/order-line/
      src/modules/production/order-line-pattern-selection/
      ```
  - **توليد رقم الطلب الآمن للتزامن وحتمية صف العداد (Concurrency-Safe Order Number Generation & Mandatory Sequence Row)**:
    - رقم الطلب بشري ومقروء بصيغة تسلسلية فريدة ثابتة: `PO-XXXXXX` (مثل `PO-000001`).
    - غير مشتق من `MAX() + 1` غير الآمن تحت التزامن.
    - يعتمد جدول عداد مخصص `production_order_sequence` مع قفل تشاؤمي `pessimistic_write` على صف `'PRODUCTION_ORDER'` داخل معاملة الإنشاء.
    - **حتمية وجود صف العداد (Mandatory Sequence Row Invariant)**: يتم تهيئة صف العداد عبر الـ Migration حصراً، وفي حال غيابه يفشل `createOrder()` فوراً بالرمز الثابت `PRODUCTION_ORDER_SEQUENCE_NOT_INITIALIZED` دون أي إنشاء تلقائي متأخر (No lazy creation).
    - تم إثبات الأمان التزامني تجريبياً عبر سكريبت التحقق `scripts/verify-production-order-concurrency.ts` بـ 20 معاملة متزامنة نتج عنها 20 رقماً فريداً متتالياً بدقة دون أي تكرار.
    - `orderNumber` غير قابل للتعديل إطلاقاً بعد الإنشاء (Immutable).
  - **قفل التزامن الموحد للتجميعة (Unified Pessimistic Lock Root Protocol)**:
    > ProductionOrderEntity is the unified pessimistic lock root for all draft-order mutations.
    - كل عملية تعديل داخل التجميعة (`updateOrder`, `archiveOrder`, `addLine`, `updateLineQuantity`, `archiveLine`, `reorderLines`, `changePatternSelection`, `syncDraftLineSelections`) تبدأ بقفل تشاؤمي `pessimistic_write` على صف أمر الإنتاج `ProductionOrderEntity` داخل المعاملة عبر `guardService.lockMutableOrder(orderId, manager)`.
    - القوالب تملك جذر قفل مستقل بها ولا تستخدم كجذر قفل للأمر لتفادي التعارض وتداخل الأقفال.
  - **قاعدة فرادة تركيبة البند ومنع التكرار (Line Configuration Uniqueness Invariant)**:
    > Within a single Production Order, no two active lines may share the exact same configuration (Template + Pattern Option Selections).
    > Quantity is NOT part of line identity; changing quantity does not create a distinct configuration.
    > Matching is order-agnostic: selections sent in any order represent the identical configuration.
    > Templates without patterns cannot be repeated on the same order.
    > Uniqueness applies strictly to active lines (`deleted_at IS NULL`). Archived lines do not block reuse.
    - **رمز التحقق الهيكلي وفرادة قاعدة البيانات (active_configuration_hash & Database Index)**:
      - عمود `active_configuration_hash CHAR(64) NULL` في جدول `production_order_line`.
      - فهرس فريد مركب `UQ_prod_order_line_order_config_hash UNIQUE (order_id, active_configuration_hash)`.
      - للبند النشط: يحسب الرمز الحتمي عبر `hashLineConfiguration(templateId, selections)` (SHA-256 بتنسيق 64 hex lowercase بعد فرز الأنماط حتمياً).
      - للبند المؤرشف: يتم تصفير الرمز حتماً إلى `NULL` عند الأرشفة (`archiveLine`) لتفادي أي حجز للتركيبة من قبل البنود المحذوفة في محرك MySQL.
      - هجرة الترقية `1710000000014-AddProductionOrderLineConfigurationUniqueness`:
        - تعمل بكفاءة على قواعد البيانات الجديدة والترقية من 0013.
        - تقوم بعمل Backfill لجميع البنود النشطة القائمة بحساب الـ Hash من اختياراتها.
        - تفشل بصرامة وتوقف الهجرة فوراً (Fail Loudly) مع تفاصيل تشخيصية إذا كانت قاعدة البيانات تحتوي مسبقاً على بنود نشطة مكررة.
    - **تطبيق القاعدة برمجياً في خدمة الطلب (Service-Level Duplicate Prevention)**:
      - في `addLine()`: يتم فحص وجود بند نشط مسبقاً بنفس الـ Hash قبل الإدخال؛ إذا وجد يفشل الطلب فوراً بالرمز الثابت `PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION` مع إرجاع `existingLineId` في التفاصيل لتوجيه العميل نحو تعديل كمية البند القائم.
      - في `changePatternSelection()`: يتم حساب الـ Hash للتركيبة المعدلة، وفحص عدم تعارضها مع أي بند نشط آخر في نفس الطلب (`id != lineId`). عند وجود تعارض تفشل العملية بالرمز `PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION`.
      - في `syncDraftLineSelections()`: عند إعادة مزامنة البند مع تحديثات القالب، إذا أسفرت المزامنة عن تركيبة مطابقة لبند آخر، تتراجع المعاملة ذرياً وتفشل بالرمز `PRODUCTION_ORDER_LINE_DUPLICATE_CONFIGURATION`.
      - في `getOrderByIdInternal()`: التحقق الصارم من وجود `active_configuration_hash` لأي بند نشط؛ وفي حال غيابه يفشل الاستعلام بالرمز `PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT`.
    - **فحص التكرار الاستباقي في الواجهة (Client-Side Pre-check)**:
      - يحسب الـ JS في مساحة العمل كود التركيبة المختار ويقارنه فورياً مع البنود الحالية للطلب.
      - عند تطابق التركيبة، يُعرض تنبيه مباشر: "هذه التركيبة موجودة مسبقًا في البند #X. عدّل كمية البند الموجود بدل إضافة بند مكرر"، ويُعطل زر الإضافة تلقائياً.
  - **فصل مساحات العمل في واجهات الويب وتدفق التحرير الموحد (Web UI Architecture & Unified Draft Editor)**:
    > Production Order Show = content-read-only details + lifecycle actions
    > Production Order Edit = unified draft workspace with atomic target-state commit
    - **صفحة العرض العامة (`/production/orders/:id` — `show.ejs` + `production-order-show.js`)**:
      > Production Order Show is content-read-only.
      > Server-rendered with EJS for order details, KPI cards, and line items.
      > Client script (production-order-show.js) is used exclusively for lifecycle workflow actions.
      - صفحة قراءة فقط ومستقرة تماماً ومصيرة خادمياً بالكامل عبر EJS لمحتويات وتفاصيل الطلب وبنوده.
      - لا تحتوي على أي أزرار أو حقول لتحرير محتويات الطلب (لا تعديل للترويسة، لا تعديل للكميات، لا تغيير للأنماط، لا إضافة أو حذف أو إعادة ترتيب للبنود).
      - تستخدم الصفحة ملف عميل خفيف (`production-order-show.js`) مخصص حصرياً لإجراءات سير العمل ودورة الحياة (Lifecycle Workflow Actions):
        - اعتماد أمر الإنتاج (`POST /api/production/orders/:orderId/approve` بصلاحية `production.order.approve`).
        - إعادة فتح أمر الإنتاج المعتمد لمسودة (`POST /api/production/orders/:orderId/reopen` بصلاحية `production.order.approve`).
        - إدارة حوارات التأكيد عبر SweetAlert2، واستخراج الأخطاء الموحد، وعرض الإشعارات المعلقة (`pendingToast`)، وإعادة تحميل الصفحة بعد نجاح الإجراء.
      - عدم تكرار رقم الطلب بصرياً؛ يعرض كرقم رئيسي في ترويسة الصفحة القياسية وفق `ui-design-rules.md`.
      - بطاقات KPI القياسية تقتصر على مؤشرين أساسيين: عدد البنود وإجمالي الكمية.
      - بنود الإنتاج تعرض في جدول منظم بدقة يبرز القالب والكود والكمية وشارات الأنماط المختارة وشارات الجاهزية ("جاهز للاعتماد" / "يحتاج مراجعة قبل الاعتماد").
      - تحتوي على زر تنقل مباشر للمحرر: `تعديل الطلب` يوجه إلى `/production/orders/:id/edit` (متاح لأوامر المسودة `DRAFT` فقط).
    - **صفحة محرر المسودة الشامل (`/production/orders/:id/edit` — `edit.ejs` + `production-order-edit.js`)**:
      > The Unified Draft Editor manages the complete target state of order lines in-memory.
      > Primary persistence path: PUT /api/production/orders/:orderId/draft-lines (Atomic Draft Commit).
      > ONE request, ONE database transaction, ONE ProductionOrder pessimistic_write lock.
      - **منتقي القوالب المعتمد على البحث أولاً (Search-First Composer)**:
        > No template data is loaded before the user provides a search keyword.
        - تبدأ واجهة إضافة البنود بمربع بحث مركزي فقط دون تحميل أي قوالب مسبقاً (No fetch on initial boot, no spinner, no empty panels).
        - البحث يبدأ حصراً عند إدخال نص غير فارغ (`searchTerm.trim().length > 0`) بعد Debounce مدته 300ms عبر `GET /api/production/templates/reference-options`.
        - حماية السباق عبر عداد تسلسلي متزايد حتماً `templatePickerRequestSeq`.
        - نتائج البحث تظهر مباشرة أسفل مربع البحث كأزرار متوافقة مع لوحة المفاتيح (`<button type="button">`) وتقتصر على اسم القالب وكوده ورقمه المرجعي.
      - **نموذج الحالة المستهدفة الموحدة في الذاكرة (Unified In-Memory Target State Model)**:
        > Unified Editor maintains the complete order lines target state in-memory until atomic commit.
        - لم يعد المحرر يعتمد على مسار منفصل لحفظ البنود الجديدة ومسارات أخرى للبنود القائمة.
        - المصدر الحقيقي للحقيقة أثناء التحرير هو الحالة المستهدفة الشاملة في الذاكرة (`target lines[]`):
          - البنود القائمة (`existing lines`): معرفاتها، كمياتها، خيارات أنماطها، وحالتها الحية.
          - البنود الجديدة: تضاف من نتائج البحث وتبقى محلياً في الذاكرة بدون معرف (`id: null`) حتى الحفظ.
          - البنود المحذوفة: تُزال محلياً من القائمة وتعتبر محذوفة ليتم أرشفة سجلاتها ذرياً عند الحفظ.
          - إعادة الترتيب: يتم محلياً في الذاكرة عبر أزرار `[↑] / [↓]`.
          - نتائج المزامنة: تطبق على البند محلياً في الذاكرة عبر `GET sync-preview`.
      - **قواعد منع التكرار في الحالة المستهدفة (Target State Duplicate Detection)**:
        > Template + exact Pattern Options = unique within active lines. Quantity is not identity.
        - حساب المفتاح المعياري للتركيبة: `templateId|sorted(patternId:optionId)`.
        - فحص التكرار مقابل كافة بنود الحالة المستهدفة (القائمة والجديدة معاً): عند تطابق التركيبة، يعرض تنبيه تكرار فوري داخل البند ويوجه لتعديل كمية البند القائم ويُعطل زر الحفظ.
        - يسمح لنفس القالب بالوجود أكثر من مرة إذا كانت خيارات الأنماط مختلفة؛ ويمنع تكرار القالب بدون أنماط.
      - **مسار الحفظ الذري الموحد الأساسي (Primary Persistence: PUT /draft-lines)**:
        > Primary save path: PUT /api/production/orders/:orderId/draft-lines
        > Older single-line endpoints and POST /lines/batch remain available for compatibility/explicit API use, but are NOT the editor's primary save flow.
        - زر الحفظ العام `حفظ مسودة أمر الإنتاج` يرسل كافة بنود الحالة المستهدفة في طلب HTTP واحد:
          `PUT /api/production/orders/:orderId/draft-lines`.
        - تنفذ العملية داخل معاملة قاعدة بيانات واحدة وتحت قفل أمر الإنتاج التشاؤمي (`ProductionOrder lock root`):
          إما تنجح بالكامل أو تتراجع بالكامل (All-or-Nothing).
        - يطبق الحفظ ذرياً:
          - أرشفة البنود المستبعدة من المسودة وتصفير الهاش الخاص بها.
          - تحديث كميات وخيارات الأنماط للبنود القائمة.
          - إدخال البنود الجديدة دفعة واحدة.
          - حفظ الترتيب الجديد وتعيين `sortOrder: 1..N` حتمياً ومكثفاً.
          - إعادة حساب وتثبيت الهاشات النشطة (`active_configuration_hash`).
        - حفظ المسودة يترك حالة أمر الإنتاج `DRAFT` كما هي دون أي اعتماد تلقائي.
      - **إعادة ترتيب البنود في الذاكرة (In-Memory Client-Side Reordering)**:
        - تتيح الواجهة أزرار تحريك للأعلى والأسفل `[↑] / [↓]` على كل بطاقة بند.
        - الترتيب يتم حصراً في الذاكرة دون أي استدعاء شبكي فوري (Client-side in-memory swap).
        - الزر `[↑]` معطل للبند الأول، والزر `[↓]` معطل للبند الأخير.
        - يعتبر تغيير الترتيب تغييراً غير محفوظ (`dirty = true`) ويخضع لحارس المغادرة.
        - يتم إرسال الترتيب النهائي للبنود ضمن مصفوفة `lines[]` في طلب الحفظ الذري وحفظه بتسلسل كثيف `1..N`.
      - **التوافق التام مع SweetAlert2 وإلغاء النوافذ البدائية (SweetAlert2 Invariants)**:
        - حظر تام لـ `confirm()` و `alert()` البدائية للمتصفح.
        - أرشفة البند، ومزامنة البند، وأرشفة الطلب تستخدم حصراً `Swal.fire` بألوان النظام المعتمدة (`#EE5253` للحذف/الأرشفة، `#0984E3` للمزامنة).
        - إلغاء الـ Modals القديمة للأرشفة (`archiveOrderModal`) في كافة شاشات الأوامر (`edit.ejs` و `index.ejs`).
        - استخراج موحد للأخطاء عبر `extractApiErrorMessage`، والتوجيه بعد أرشفة الطلب يعتمد نمط `pendingToast`.
        - حماية المغادرة: تحذير المستخدم عبر SweetAlert2 عند وجود تعديلات غير محفوظة عند محاولة التنقل.
  - **صحة وسلامة الكمية (Line Quantity Invariant)**:
    - الكمية عدد صحيح موجب حصراً `1 <= quantity <= 10000`، ويتم التحقق منها على 3 مستويات: DTO Validation و Service Invariant (`validateLineQuantity` تطلق `PRODUCTION_ORDER_LINE_QUANTITY_INVALID` للأعداد العشرية أو السالبة أو الصفر أو التي تتجاوز 10,000) وقيد Check في قاعدة البيانات `CHK_production_order_line_quantity`.
    - الترتيب مكثف `sortOrder: 1..N` ومدعوم بإعادة ترتيب كامل `PATCH /api/production/orders/:orderId/lines/reorder` بتبديل كامل دقيق (Exact Permutation).
    - `templateId` ثابت وغير قابل للتعديل للبند القائم لمنع بقاء اختيارات أنماط يتيمة.
  - **تحديد خيارات الأنماط وعقد القصد الصريح (Pattern Selection Intent Contract)**:
    > Draft order lines reference live template configuration.
    > Every active Pattern in the Template requires exactly one Selection.
    > The default option is the first active option by sortOrder ASC.
    - **تمييز قصد العميل بدقة**:
      - غياب الحقل (`patternSelections === undefined`): يولد النظام الخيارات الافتراضية تلقائياً (أول خيار فعال حسب `sortOrder ASC`).
      - إرسال الحقل صراحة (`patternSelections !== undefined`): يُعامل كـ Explicit Set ويخضع للتحقق الصارم كـ Exact Set حتى لو أُرسل كمصفوفة فارغة `[]`.
      - إذا كان القالب يملك أنماطاً وأرسل العميل `patternSelections: []`، يرفض الطلب فوراً بالرمز `PRODUCTION_ORDER_LINE_PATTERN_SELECTION_SET_INVALID`.
      - إذا كان القالب بلا أنماط وأرسل العميل `patternSelections: []`، يُقبل كـ Explicit Set صالح.
    - التحقق من صلاحية القالب عند تغيير الخيار `changePatternSelection`: يتم التحقق صراحة من أن القالب موجود وغير مؤرشف وفعال (`template.isActive === true`)؛ وإلا تفشل العملية فوراً بالرمز `PRODUCTION_ORDER_TEMPLATE_INACTIVE`.
    - إذا احتوى القالب على نمط فعال بدون أي خيار فعال، تفشل إضافة البند ذرياً مع Rollback بالرمز `PRODUCTION_ORDER_TEMPLATE_PATTERN_HAS_NO_ACTIVE_OPTIONS`.
  - **التعامل مع تلف البيانات الهيكلي مقابل الحالات القديمة (Structural Corruption vs Stale State Contract)**:
    - **الحالات القديمة المقبولة (Stale State)**:
      - نمط مؤرشف: يتم الاحتفاظ بالاسم التاريخي للنمط والاسم التاريخي للخيار المختار، وتعيين `availableOptions = []` وخفض الجاهزية (`ready: false`).
      - نمط فعال لكن الخيار المختار أصبح مؤرشفاً: يتم الاحتفاظ بالاسم التاريخي للخيار المختار مع بقاء الخيارات الفعالة البديلة متاحة للاختيار، وخفض الجاهزية (`ready: false`) حتى يتم تصحيح أو مزامنة الاختيار.
      - البند القديم/غير المتزامن (Stale Line) يمنع حفظ المسودة في المحرر حتى تتم مزامنته عبر معاينة المزامنة.
    - **التلف الهيكلي غير المقبول (Structural Corruption — Fail Closed)**:
      - إذا كان سجل النمط أو الخيار مفقوداً تماماً من قاعدة البيانات، أو كان النمط أجنبياً لا ينتمي لقالب البند (`pattern.templateId !== line.templateId`)، أو كان الخيار أجنبياً لا ينتمي لنمطه المحدد (`option.patternId !== sel.templatePatternId`): تفشل القراءة وعمليات الجاهزية ومعاينة المزامنة والمزامنة فوراً ومنغلقة أمنياً بالرمز `PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT`.
      - يُمنع إخفاء التلف أو معالجته صامتاً (No Silent Repair).
  - **قواعد المزامنة مع القالب ومعاينة المزامنة (Template Sync & Sync Preview Contract)**:
    > Template changes do not modify Draft Orders silently.
    > GET requests strictly never perform automatic or silent repairs.
    > Unified Editor sync flow is read-only GET sync-preview; persistent commit occurs only through atomic draft save.
    - التعديلات اللاحقة على القالب أثناء وجود الطلب في حالة المسودة يتم فحصها والتعامل معها حصراً عبر مسار المعاينة والتحقق:
      1. خدمة التحقق من الجاهزية `validateDraftForRelease`: قراءة فقط وتكشف أي نقص أو عدم توافق كـ issues دون تعديل قاعدة البيانات.
      2. مسار معاينة المزامنة للمحرر الموحد `GET /api/production/orders/:orderId/lines/:lineId/sync-preview`:
         - مسار قراءة فقط تماماً (READ ONLY) وينفذ صفر تعديلات في قاعدة البيانات (ZERO DB writes).
         - يتحقق مسبقاً وبشكل صارم من السلامة الهيكلية للاختيارات ويرفض أي تلف هيكلي أجنبي أو مفقود فيزيائياً منغلقاً أمنياً (Fail Closed) بالرمز `PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT`.
         - إذا كانت الأنماط أو الخيارات المؤرشفة تنتمي للقالب والنمط الصحيحين، تُعامل كـ STALE (وليس تلفاً)، ويحسب الخادم الاختيارات الفعالة البديلة المقترحة.
         - يستقبل المتصفح نتيجة المعاينة ويطبقها على البند في الذاكرة فقط (In-memory update)، مما يزيل حالة عدم التزامن ويجعل البند صالحاً للحفظ.
         - التثبيت الدائم للتعديلات في قاعدة البيانات يحدث حصراً عند حفظ المسودة الذري عبر `PUT /draft-lines`.
      3. مسار المزامنة الصريح المباشر `POST /api/production/orders/:orderId/lines/:lineId/sync-template`:
         - مسار قديم / صريح لإجراء المزامنة الفورية وتعديل قاعدة البيانات مباشرة، ويبقى متاحاً للتوافق أو الاستخدام المباشر للـ API، لكنه ليس المسار المعتمد للمحرر الموحد.
         - يطبق نفس قواعد فحص التلف الهيكلي `PRODUCTION_ORDER_DRAFT_CONFIGURATION_CORRUPT` واستبدال الخيارات المؤرشفة.
  - **الاستعلام الخفيف لإعدادات القالب (Lightweight Order Configuration)**:
    - استعلام `getOrderConfiguration(templateId)` يستعلم حصراً عن الأنماط وخياراتها دون استدعاء `listPatterns()` التي كانت تجلب المهام والمواد والمرفقات، مما يمنع فرط جلب البيانات (No Over-fetching) تماماً.
  - **ترقيم وتصفح منتقي القوالب في الواجهة (Template Picker Server-Side Pagination & Race Protection)**:
    - يدعم منتقي القوالب الترقيم الخادمي المكتمل مع زر `تحميل المزيد` عند وجود صفحات إضافية (`currentPage < totalPages`).
    - مزود بـ Debounce (300ms) وتتبع رقم تسلسلي للطلبات (`templatePickerRequestSeq`) لمنع تداخل الاستجابات غير المرتبة (Race Condition Protection).
    - يعتمد على `Set` لمعرفات القوالب لمنع تكرار البطاقات نهائياً.
  - **عقد الصلاحيات لمسارات مراجع القوالب (Permissions Contract for Reference Endpoints)**:
    - تم منح صلاحية `PRODUCTION_ORDER_UPDATE` إمكانية الوصول لمسارات `GET /api/production/templates/reference-options` و `GET /api/production/templates/:id/order-configuration` بجانب `VIEW` و `CREATE` لتسهيل عمل محرري الأوامر.
  - **العقد المستقبلي للمرحلة الثانية (Future Release Contract — Phase 2)**:
    - عملية الإطلاق `releaseProductionOrder(orderId)` ستكون في المرحلة التالية معاملة ذرية كاملة تنفذ بالتزامن:
      `lock Order -> validateDraftForRelease -> create immutable snapshots -> generate Production Units (1 unit per quantity) -> generate ProductionPatternSelections -> generate Runtime Stages -> mark order RELEASED -> commit`.

- **قوالب ومراحل الإنتاج وسير العمل المختلط — Production Template Core & Mixed Workflow Workspace** (`src/modules/production/`):
  - **الهيكلية المعمارية والمجلدات المستقلة (Modular Monolith Structure)**:
    - القوالب جزء أصيل من تطبيق الإنتاج (`Production Application`)، ولا يوجد تطبيق مستقل باسم Studies.
    - النماذج مقسمة إلى 11 مجلداً مستقلاً تماماً:
      ```text
      src/modules/production/template/
      src/modules/production/template-specification/
      src/modules/production/template-stage/
      src/modules/production/template-stage-material/
      src/modules/production/template-stage-attachment/
      src/modules/production/template-workflow-item/
      src/modules/production/template-pattern/
      src/modules/production/template-pattern-option/
      src/modules/production/template-pattern-option-task/
      src/modules/production/template-pattern-option-task-material/
      src/modules/production/template-pattern-option-task-attachment/
      ```
    - الجداول المعتمدة في قاعدة البيانات (11 جدولاً بنكيث وتكامل تام):
      `production_template`, `production_template_specification`, `production_template_stage`, `production_template_stage_material`, `production_template_stage_attachment`, `production_template_workflow_item`, `production_template_pattern`, `production_template_pattern_option`, `production_template_pattern_option_task`, `production_template_pattern_option_task_material`, `production_template_pattern_option_task_attachment`.
  - **تجربة المستخدم ومساحة العمل المتكاملة (Two-Step Flow & Single-Page Mixed Workflow Workspace)**:
    > Template creation is intentionally a two-step user flow:
    > 1. Create minimal template identity.
    > 2. Redirect directly to the Template Builder workspace where specifications, mixed workflow (stages and patterns), planned materials and reference documents are managed without leaving the page.
    - صفحة الإنشاء `/production/templates/create` تقتصر فقط على الهوية الأساسية (الاسم، الكود، الرقم المرجعي، الوصف، الحالة)، وزر المتابعة `إنشاء ومتابعة إعداد القالب` ينقل المستخدم مباشرة إلى `/production/templates/:id`.
    - صفحة القالب `/production/templates/:id` هي **Template Builder Workspace** متكاملة:
      - تعديل البيانات الأساسية يتم عبر Modal فوري وحفظ API دون مغادرة الصفحة.
      - شريط تنقل سلس وSticky بين أقسام الصفحة (`#template-info`, `#template-specifications`, `#template-workflow`).
      - إدارة المواصفات وإعادة ترتيبها عبر Modals مخصصة.
      - إضافة عناصر سير العمل بالأزرار العلوية المباشرة: `[+ إضافة نمط]` و `[+ إضافة مرحلة]`.
      - النقر على أي مرحلة يفتح **نافذة المرحلة المنبثقة المتمركزة (Centered Stage Modal)** من 3 تبويبات:
        1. معلومات المرحلة وتعديل القسم التشغيلي.
        2. المواد المخططة مع أداة بحث في الكتالوج (Debounced Search) وترقيم (Pagination) وتحميل الوحدات عند الطلب.
        3. الوثائق التنفيذية المرجعية مع الرفع والمشاهدة والتحميل والتنزيل وإعادة الترتيب.
      - النقر على أي مهمة داخل خيار النمط يفتح **نافذة المهمة المنبثقة المتمركزة (Centered Task Modal)** من 3 تبويبات:
        1. معلومات المهمة وتعديل القسم التشغيلي والمدة والتكلفة التقديرية.
        2. المواد المخططة للمهمة مع نفس تجربة كتالوج المستودعات بدون تسريب للبيانات الداخلية.
        3. الوثائق التنفيذية المرجعية للمهمة عبر خدمة التخزين المشتركة والتحميل الآمن.
  - **معمارية سير العمل المختلط وحيد المرجع (Mixed Workflow & Single Source of Truth)**:
    > Single source of truth for top-level workflow ordering is ProductionTemplateWorkflowItemEntity.sortOrder.
    > No sub-stages exist. No generic recursive trees are permitted.
    > Database column sort_order was permanently removed from production_template_stage in Migration 0011.
    - ترتيب عناصر المستوى الأول في سير العمل يخضع حصراً لجدول `production_template_workflow_item`:
      - الترتيب مكثف ومتسلسل `sortOrder: 1..N`.
      - كل عنصر في سير العمل هو إما مرحلة مباشرة `STAGE` (`stage_id IS NOT NULL AND pattern_id IS NULL`) أو عقدة قرار/نمط `PATTERN` (`pattern_id IS NOT NULL AND stage_id IS NULL`).
      - محمي على مستوى قاعدة البيانات عبر Check Constraint: `CHK_production_workflow_item_polymorphic`.
      - سلامة وتتابع الترتيب مضمونان حصراً عبر قفل التزامن التشاؤمي لسجل القالب الأب (`ProductionTemplateEntity pessimistic write lock`) مع التحقق الدقيق من التبديل الكامل لعناصر الترتيب (`exact permutation validation`) وإعادة الترتيب المكثف (`dense reorder/compaction`). لا يوجد قيد UNIQUE مركب على `(template_id, sort_order)` على مستوى قاعدة البيانات لتفادي التعارض مع السجلات المؤرشفة ناعماً والاصطدام المؤقت أثناء التحديثات.
      - `stage_id` فريد عالمياً داخل جدول عناصر سير العمل، فلا يمكن ربط نفس Stage بأكثر من Workflow Item.
      - `pattern_id` فريد عالمياً داخل جدول عناصر سير العمل، فلا يمكن ربط نفس Pattern بأكثر من Workflow Item.
      - تم حذف عمود `sort_order` نهائياً من جدول `production_template_stage`؛ وأي ترتيب قديم للمراحل أصبح مشتقاً بصرياً ودلالياً من `workflowItem.sortOrder`.
  - **مجال الأنماط والخيارات والمهام (Pattern Domain: Pattern -> Options -> Tasks)**:
    > Pattern and Option have NO departmentId.
    > DepartmentId strictly belongs to Stage and Task.
    > Options are branch alternatives; Tasks are sequential execution steps within an option.
    - النمط (`ProductionTemplatePattern`) هو نقطة تفرع/قرار هيكلي في مسار الإنتاج (مثل "نوع الصب: مسبق الصنع / صب في الموقع" أو "طريقة العزل").
    - النمط لا يملك قسماً تشغيلياً (`No departmentId on Pattern`).
    - الخيار (`ProductionTemplatePatternOption`) هو أحد البدائل التفرعية داخل النمط (مثل "صب مسبق الصنع" أو "صب رطب").
    - الخيار لا يملك قسماً تشغيلياً (`No departmentId on Option`). الخيارات مرتبة داخل النمط مكثفاً `sortOrder: 1..N`.
    - المهمة (`ProductionTemplatePatternOptionTask`) هي وحدة التنفيذ الإجرائية داخل الخيار؛ وهي التي تملك القسم التشغيلي حصراً (`departmentId belongs to Task`).
    - المهام مرتبة داخل الخيار مكثفاً `sortOrder: 1..N`.
    - لا توجد مستويات فرعية عودية (Strict 4-tier model: `Template -> WorkflowItem -> Stage | (Pattern -> Option -> Task)`).
  - **الخيار الافتراضي المستقبلي (Default Option Suggestion Invariant)**:
    > The first active option by sortOrder (sortOrder = 1) is the future default suggestion when generating Production Orders.
    - أول خيار نشط حسب الترتيب (`sortOrder = 1`) يتم تمييزه في واجهة المستخدم ببادية "الخيار الافتراضي"، وهو الخيار الذي سيقترحه النظام تلقائياً عند توليد أوامر الإنتاج مع إمكانية التبديل من قبل مهندس التخطيط.
  - **التجميع البصري للأقسام المتتالية وانقطاعه بالأنماط (Visual Consecutive Grouping & Pattern Interruption)**:
    > Only consecutive stages belonging to the same department are visually grouped.
    > A Pattern boundary strictly interrupts consecutive department grouping, even if the stages before and after belong to the same department.
    - دالة `deriveMixedWorkflowGroups` تحافظ على منطق تجميع المراحل المتتالية التي تملك نفس `departmentId`.
    - وجود أي نمط (`Pattern`) يمثل فاصلاً بنيوياً صريحاً (Decision Node)، فيقطع التجميع فوراً؛ فلا يمكن دمج مرحلة صب تسبق النمط مع مرحلة صب تليه في نفس الكتلة البصرية.
  - **إعادة الترتيب وحماية المسار القديم (Workflow Reorder & Legacy Reorder Protection)**:
    - تم توفير مسار موحد لإعادة ترتيب سير العمل بالكامل: `PATCH /api/production/templates/:id/workflow/reorder`.
    - يرسل العميل مصفوفة كاملة لمعرفات عناصر سير العمل (`workflowItemIds: string[]`).
    - مسار إعادة ترتيب المراحل القديم `PATCH /api/production/templates/:id/stages/reorder`:
      - تم تعديله ليعمل عبر جدول `production_template_workflow_item`.
      - إذا كان القالب يحتوي على أي نمط نشط (`hasActivePatterns = true`)، يتم حظر استدعاء المسار القديم فوراً بـ `BusinessRuleError` والرمز الثابت `PRODUCTION_TEMPLATE_MIXED_WORKFLOW_REORDER_REQUIRED`.
  - **خدمة التخزين المرجعية المشتركة (Shared Reference File Storage Abstraction)**:
    - تم استخراج فئة أساسية مجردة `ProductionTemplateReferenceFileStorageService` لتنظيم إدارة الملفات المرجعية للمراحل والمهام بقواعد موحدة:
      - المسارات المعزولة والمحمية بمفاتيح مبهمة مولدة دون كشف مسارات الخادم الفيزيائية.
      - فحص Path Traversal التام بـ `path.relative` ضد الـ Root.
      - فحص توافق MIME Type مع الامتداد وقائمة الامتدادات البيضاء المعتمدة (PDF, PNG, JPG, JPEG, WEBP بحد أقصى 20 ميغابايت).
      - دورة الحياة الآمنة للتراجع وحذف الملفات المؤقتة والنهائية عند فشل المعاملات لمنع الملفات اليتيمة.
      - الحذف الناعم للوثائق المرجعية لحفظ الجاهزية التاريخية لأخذ اللقطات.
    - يعتمد التخزين جذر التخزين المشترك `Shared FILE_STORAGE_ROOT` بالمسار الافتراضي المتوافق مع السجلات القديمة:
      `storage/template-stage-attachments/`
      مع استخدام بادئات منطقية مستقلة:
      - `production-template-stage/` لوثائق مراحل القوالب.
      - `production-template-pattern-task/` لوثائق مهام أنماط القوالب.
  - **حظر تسريب بيانات المستودعات في مواد المرحلة ومواد المهمة (Zero Inventory Data Leakage)**:
    - مسارات مواد المرحلة ومواد المهمة تعتمد خدمة `InventoryProductReferenceService` وترجع DTOs مخصصة:
      `ProductionTemplateStageMaterialDto` و `ProductionTemplatePatternOptionTaskMaterialDto`.
    - يمنع كلياً تسريب الحقول الداخلية لكتالوج المستودعات مثل: `price`, `barcode`, `locationName`, `specifications`, `conversionQuantity`.
    - معالجة تعارض القيود الفريدة عند إضافة المادة لنفس الوحدة مرتين وتحويل خطأ MySQL ER_DUP_ENTRY إلى `ConflictError` برمز خطأ واضح (`PRODUCTION_TEMPLATE_STAGE_MATERIAL_EXISTS` أو `PRODUCTION_TEMPLATE_TASK_MATERIAL_EXISTS`).
  - **حماية دورة حياة القالب الأب وقفل التزامن الموحد (Unified Pessimistic Lock Root Protocol)**:
    > ProductionTemplateEntity is the unified pessimistic lock root for every mutation in the Production Template aggregate.
    > All mutations across templates, stages, specifications, workflow items, patterns, options, tasks, materials, and attachments serialize through parent template row lock.
    - تم توسيع `ProductionTemplateGuardService` بدوال حماية التبعية الكاملة:
      - `requireExistingTemplate`, `requireMutableTemplate`, `lockMutableTemplate`.
      - `requireStageBelongsToTemplate`.
      - `requirePatternBelongsToTemplate`.
      - `requireOptionBelongsToPattern`.
      - `requireTaskBelongsToOption`.
    - كافة عمليات التعديل (18 مساراً جديداً للأنماط والخيارات والمهام وسير العمل) تبدأ وجوباً باستدعاء `lockMutableTemplate(templateId, manager)` للحصول على قفل `pessimistic_write` على سجل القالب الأب داخل المعاملة.
    - أي محاولة لتعديل مورد تابع لقالب محذوف ناعماً تفشل مغلقة فوراً بـ `NotFoundError` والرمز `PRODUCTION_TEMPLATE_NOT_FOUND`.
  - **عقود التشغيل واللقطات ومسارات التعديل المستقبلية (Runtime Readiness & Snapshot Contracts)**:
    > Formal contract for Phase 3 (Production Order Execution):
    > 1. Selection Model: ProductionPatternSelection { orderId, patternId, selectedOptionId, selectedAt, selectedByUserId }.
    >    - Default selection automatically resolves to the first active option by sortOrder (sortOrder = 1).
    > 2. Snapshot Model: Execution tasks are instantiated into production_order_task with full snapshots of task details, planned materials, and reference documents, keeping origin references (originTemplatePatternId, originTemplateOptionId, originTemplateTaskId).
    > 3. Option Change Semantics:
    >    - Pre-execution (no tasks in the pattern started): Direct option switch allowed. Old order tasks are soft-deleted/replaced, new option snapshot is created, and the switch is recorded in the audit trail.
    >    - In-execution / Post-execution (at least one task started, logged progress, or consumed materials): Direct switch is strictly blocked. Requires a Formal Engineering Revision Request (Engineering Change Order) to review scrapped work, rework costs, and material variance.
  - **الصلاحيات والأمان (Permissions & Authorization Invariants)**:
    - صلاحيات القوالب تتبع موديول `production`:
      - `production.template.view`: تتيح استعراض القوالب والمواصفات وسير العمل والمراحل والأنماط والخيارات والمهام والمواد وتنزيل الوثائق المرجعية.
      - `production.template.create`: تتيح إنشاء قالب جديد.
      - `production.template.update`: تتيح تعديل القالب، والمواصفات، وسير العمل المختلط، والمراحل، والأنماط، والخيارات، والمهام، والمواد المخططة، ورفع وأرشفة وترتيب كافة الوثائق المرجعية.
      - `production.template.delete`: تتيح أرشفة القالب بالكامل.
    - مدير النظام `SYSTEM_ADMIN` يحصل عليها تلقائياً عبر المصالحة الزمنية `reconcileSystemPermissions`.
    - جميع العمليات التعديلية تمر عبر `window.erpFetch` مع التحقق من الـ CSRF، وحظر XSS عبر Native DOM APIs و `safeJsonStringify`.

- **كتالوج المنتجات والمستودعات الأساسية (Inventory Product Catalog Core & Administration UI)** (`src/modules/inventory/`):
  - **البيانات المرجعية (Master Data Architecture)**:
    - كتالوج مركزي للمواد والمنتجات ووحدات القياس التابعة لها، تم بناؤه كمتطلب أساسي وحصري يسبق بناء قوالب المنتجات والغرف (Product / Room Templates) بحيث ستشير قوالب المواد والمهام لاحقاً إلى `inventory_product.id` و `inventory_product_unit.id`.
    - لا يشمل أي مفاهيم مخزنية متقدمة (No Warehouses, No Stock Balances, No Movements, No Receipts/Issues, No Costing/Price History). حقل "مكان وجود المادة" `locationName` مجرد نص وصفي اختياري داخل المنتج.
  - **معالجة عقود Null في PATCH DTOs (Strict PATCH Null Semantics)**:
    - التحقق الصارم من الحقول عبر `class-validator` باستخدام `@ValidateIf((_obj, val) => val !== undefined)` لمنع وصول `null` إلى الحقول الإلزامية وتفادي استثناءات التشغيل (Runtime errors) في `.trim()` أو تلوث قاعدة البيانات.
    - الحقول التي ترفض `null` بشكل قطعي: `name` و `isActive` في الفئات والمنتجات، و `name` و `price` و `conversionQuantity` و `equivalentToUnitId` في الوحدات.
    - الحقول التي تسمح بـ `null` لمسح القيمة أو فك الارتباط: `description` و `parentId` في الفئات، و `description` و `locationName` و `categoryId` في المنتجات، و `barcode` و `specifications` في الوحدات.
  - **شجرة الفئات وإدارتها (Category Hierarchy & Clean Lifecycle)**:
    - جدول `inventory_category` يعتمد قائمة الجوار (Adjacency List عبر `parent_id`) مع قيد فرادة الرمز `code` الدائم بما يشمل السجلات المؤرشفة ناعماً (`withDeleted: true`).
    - رمز الفئة `code` ثابت وغير قابل للتعديل بعد الإنشاء (Immutable).
    - حظر الحلقات الدائرية (Cycle Detection) عبر تتبع شجرة الأسلاف والانغلاق الآمن فوراً (`Fail Closed` بـ `INVENTORY_CATEGORY_CYCLE` أو `INVENTORY_CATEGORY_HIERARCHY_INCONSISTENT` عند وجود أسلاف مفقودة أو محذوفة ناعماً).
    - اشتراط فعالية الفئة الأب عند إنشاء أو تفعيل فئة تابعة لها، ومنع تعطيل أو أرشفة الفئة إذا كانت تحتوي على أي فئات فرعية أو أي منتجات مرتبطة بها باستخدام `InventoryProductEntity` مباشرة دون الاعتماد على استعلامات فحص الجداول الانتقالية.
    - خيارات الفئات مع ترقيم الصفحات (`CategoryOptionsQueryDto` عبر `page`, `limit`, `search`) مع دالة عميل `fetchAllActiveCategoryOptions` لجلب كافة الفئات النشطة ومنع البتر الصامت لما بعد أول 100 خيار، مع الحفاظ على الفئة المعطلة المرتبطة حالياً كخيار محدد مع وسام `(معطلة)`.
  - **كتالوج المنتجات والوحدة الأساسية (Product Master & Base Unit Fail-Closed Invariant)**:
    - جدول `inventory_product` وجدول `inventory_product_unit` مع قيد فرادة الرمز الدائم ورمز الباركود عالمياً.
    - رمز المنتج `code` ثابت وغير قابل للتعديل بعد الإنشاء.
    - قاعدة اتساق الوحدة الأساسية (Base Unit Invariant): كل منتج صالح يملك وحدة أساسية واحدة إلزامية ومشار إليها عبر `base_unit_id` وتتبع لنفس المنتج وغير محذوفة ناعماً.
    - الإنشاء الذري (Atomic Creation): يتم إنشاء سجل المنتج أولاً داخل Transaction مع base_unit_id = null، ثم إنشاء الوحدة الأساسية التابعة للمنتج، ثم تحديث base_unit_id للإشارة إلى الوحدة الأساسية. ويتم Rollback كامل للعملية إذا فشلت أي خطوة.
    - القراءة الآمنة المنغلقة (Fail-Closed Read): يتم جلب الوحدة الأساسية ضمن استعلام القائمة `listProducts` عبر `LEFT JOIN` بدون N+1، والتحقق الصارم من اتساقها لكل منتج، والرمي الفوري لخطأ `INVENTORY_PRODUCT_BASE_UNIT_INCONSISTENT` في حال تلف أي سجل دون إخفائه بصمت.
    - ثبات الوحدة الأساسية: يُحظر نهائياً حذف الوحدة الأساسية أو تعديل معادلة تحويلها.
  - **سلسلة تحويل الوحدات والمواصفات المرنة (Unit Conversion Chain & Specifications JSON)**:
    - الوحدات الإضافية تعرّف حصراً بالنسبة لوحدة أخرى من نفس المنتج (`1 current unit = conversionQuantity × equivalentToUnit`).
    - حظر الإشارة لوحدة خارج نفس المنتج (`INVENTORY_PRODUCT_UNIT_REFERENCE_OUTSIDE_PRODUCT`).
    - التحقق الصارم من انتهاء سلسلة التحويل بالوحدة الأساسية وخلوها من الحلقات الدائرية (`INVENTORY_PRODUCT_UNIT_CONVERSION_CYCLE` / `INVENTORY_PRODUCT_UNIT_CONVERSION_INCONSISTENT`).
    - ترتيب الأقفال ومنع التعارضات: كل تعديل لوحدات المنتج يتسلسل عبر قفل سجل المنتج أولاً (`Product row` via `pessimistic_write` كـ Lock Root) ثم قفل سجلات الوحدات المعنية.
    - منع حذف أي وحدة تعتمد عليها وحدات أخرى في سلسلة التحويل (`INVENTORY_PRODUCT_UNIT_HAS_DEPENDENTS`).
    - المواصفات الفنية المرنة: حقل JSON `specifications` يدعم حتى 50 خاصية لكل وحدة بصيغة `{ name, value, unit }` مع منع تكرار أسماء الخصائص داخل نفس الوحدة، والتحقق في واجهة العميل لمنع فقدان البيانات عند إدخال صفوف جزئية.
  - **معالجة تعارضات المفاتيح المكررة في MySQL (Race Condition 1062 Mapping)**:
    - استخراج خطأ التكرار بدقة من `QueryFailedError.driverError` لـ `ER_DUP_ENTRY` (errno 1062) وتحويله إلى `ConflictError` برمز خطأ موحد (409) لرمز المنتج والباركود واسم الوحدة لمنع تحول أخطاء التزامن إلى 500 Internal Server Error.
  - **ترقية المخطط وقيود الفحص (Reconciliation Migration)**:
    - توفير `1710000000006-HardenInventoryCatalogConstraints.ts` لضمان وجود قيود الـ CHECK في البيئات القائمة مسبقاً بشكل Idempotent.
  - **الاختبارات الآلية (Regression Tests)**:
    - اختبارات شاملة تغطي الخدمات الحقيقية لـ Category و Product والوحدات وعقود Null والتكرارات وكسور Decimal وسلسلة التحويل متاحة عبر `npm test`.
  - **الصلاحيات والأمان والواجهات**:
    - صلاحيات النظام: `inventory.category.view/create/update/delete` و `inventory.product.view/create/update/delete`، وتخضع لنطاق الوصول الشامل `ALL`.
    - مسارات آمنة عبر `window.erpFetch` لكافة العمليات التعديلية مع التحقق المركزي من CSRF ومصادقة الجلسة.
    - واجهات Bootstrap متجاوبة وثيم المستودعات الأخضر `#10AC84`، مع منع حقن النصوص واستخدام Native DOM APIs لحظر ثغرات XSS.
    - **شجرة الفئات (Hierarchical Category Tree)** (`/inventory/categories`): شجرة فئات هرمية مبنية بالكامل في الواجهة، وحالتها الافتراضية مفتوحة بالكامل (`Default State: Fully Expanded`) عند تحميل الصفحة وعند الضغط على زر "تحديث الشجرة"، مع دعم الطي والتوسيع اليدوي، والحفاظ على الشجرة وتوسعها عند البحث وإلغاء البحث.
    - **لوحة المنتجات وشجرة الفئات الجانبية (Products Listing with Category Tree Filter)** (`/inventory/products`):
      - عرض شجرة الفئات في لوحة جانبية على الشاشات الكبيرة بجانب جدول المنتجات، مفتوحة بالكامل افتراضياً (`Expanded`).
      - خيار "جميع المنتجات" في أعلى الشجرة لإلغاء التصفية (`selectedCategoryId = null`).
      - تصفية المنتجات مباشرة بالضغط على أي فئة مع إعادة تعيين الصفحة تلقائياً إلى 1 (`page = 1`).
      - إزالة القائمة المنسدلة `categoryFilterSelect` من صفحة Listing فقط، مع الحفاظ عليها في شاشات الإنشاء والتعديل.
      - تكامل فلاتر البحث النصي، وفلتر الحالة، والترقيم Pagination مع الفئة المحددة دون تعارض.
      - بحث محلي داخل شجرة الفئات (`بحث في الفئات...`) يفلتر عناصر الشجرة مباشرة دون التأثير على بحث المنتجات.
      - التجاوب مع الهواتف والشاشات الصغيرة: تحويل الشجرة الجانبية إلى Bootstrap Offcanvas منبثق عبر زر "الفئات"، ويتم إغلاقه تلقائياً عند اختيار الفئة مع إظهار شريط الفئة المحددة أعلى الجدول.
    - **صفحة تفاصيل المنتج (Product Detail Page)** (`/inventory/products/:id` عبر `src/views/dashboard/inventory/products/show.ejs`): موجودة ومعتمدة بتصميم تفاعلي يبرز الوحدة الأساسية والوحدات الإضافية وسلسلة التحويل والمواصفات الفنية.

- **حماية CSRF المرتبطة بالجلسة (Session-Bound CSRF Protection)** (`src/modules/system/auth/csrf.service.ts`, `src/modules/system/auth/csrf.middleware.ts`, `src/modules/system/auth/auth.middleware.ts`):
  - **نموذج أمني مشتق من الجلسة (Session-Bound HMAC Token)**:
    - توليد رمز CSRF باستخدام HMAC-SHA256 مع مفتاح سري مستقل وإلزامي `AUTH_CSRF_SECRET` (32 حرفاً على الأقل ومختلف وجوباً عن `AUTH_JWT_SECRET`) مرتبط بمعرف الجلسة الموثقة `sessionId` (`erp-csrf-v1:${sessionId}`).
    - الرمز غير مخزن في قاعدة البيانات ولا يحتوي على الـ JWT ولا يسمح باشتقاقه، ولا يُعرض الـ JWT للـ JavaScript إطلاقاً.
    - التحقق من الرمز Server-side باستخدام `crypto.timingSafeEqual` بعد مطابقة الطول لمنع هجمات التوقيت (Timing Attacks).
  - **الاستثناءات والطرائق المحمية والمدقق المركزي (Canonical Validator & Safe Methods)**:
    - إعفاء الطرق الآمنة فقط: `GET`, `HEAD`, `OPTIONS`.
    - استخدام مدقق مركزي وحيد `validateCsrfToken` في `src/modules/system/auth/csrf.middleware.ts` يتم تركيبه بعد المصادقة في `requireApiAuth` و `requireWebAuth`.
    - مسار تسجيل الدخول `POST /api/auth/login` مستثنى لكونه pre-authentication ويُحمى عبر معدل الطلبات (Rate Limiting).
    - مسار تسجيل الخروج `POST /api/auth/logout` محمي برمز CSRF.
    - الطلبات غير الموثقة لـ endpoints محمية ترجع 401 (فشل مصادقة) أولاً قبل فحص الـ CSRF لمنع كشف حالة الـ Token.
    - أخطاء CSRF ترجع 403 برمز `CSRF_TOKEN_MISSING` أو `CSRF_TOKEN_INVALID`.
  - **تكامل القوالب والعميل (EJS & Client erpFetch Integration)**:
    - وسيط `requireWebAuth` يضع `res.locals.csrfToken` للمستخدم الموثق فقط ليتم تضمينه في `<meta name="csrf-token">` داخل لوحة التحكم مع ترويسة `Cache-Control: no-store`.
    - دالة العميل المركزية الإلزامية `window.erpFetch` في `src/public/js/app.js` تعتمد Native Fetch وتضمن حصر الرمز في نفس الـ Origin (`window.location.origin`) وتطبيع الطريقة (Trimmed Uppercase) وإرسال ترويسة `X-CSRF-Token` في الطرق غير الآمنة مع حظر الرجوع إلى raw fetch في حال غياب الـ helper (`No Fallback`).
    - اعتماد `window.erpFetch` لكافة العمليات التعديلية في: `users.js`, `roles.js`, `user-permissions.js`, `production-departments.js`, `production-yards.js`, `production-team.js`, و `app.js` (logout).
- **حماية تسجيل الدخول من التزوير (Login CSRF Protection)** (`src/modules/system/auth/login-json-content-type.middleware.ts`, `src/common/errors/unsupported-media-type.error.ts`):
  - **حصر مسار تسجيل الدخول في طلبات JSON حصراً (JSON-Only Invariant)**:
    - مسار `POST /api/auth/login` يقبل فقط `Content-Type: application/json` (بما فيها الصيغ الطبيعية كـ `application/json; charset=utf-8`).
    - يتم رفض الطلبات بصيغة `application/x-www-form-urlencoded` و `multipart/form-data` و `text/plain` وغياب الترويسة برمز HTTP 415 ورمز الخطأ الثابت `AUTH_LOGIN_JSON_REQUIRED` عبر `UnsupportedMediaTypeError` ومعالج الأخطاء المركزي `errorHandlerMiddleware`.
    - إغلاق سيناريو الـ Login CSRF عبر النماذج الخارجية (Cross-Origin HTML Form Submissions) التي لا تستطيع إرسال طلبات JSON من المتصفح دون CORS Preflight.
    - ترتيب وسائط المسار الصارم: محدد المعدل `loginRateLimiter` أولاً (لتضمين كافة المحاولات في الحصة) -> مدقق نوع المحتوى `requireLoginJsonContentType` ثانياً -> التحقق من الـ DTO `validateDto(LoginDto)` ثالثاً -> وحدة التحكم `authController.login` وخدمة التشفير `bcrypt` أخيراً.
    - يبقى مسار تسجيل الدخول محلياً لنفس النطاق (Same-Origin) مع استمرار استخدام `fetch` المباشر لعدم وجود جلسة موثقة بعد، مع حظر كشف مسارات المصادقة عبر سياسات CORS متساهلة اعتمادية مستقبلاً.
- **حماية معدل تسجيل الدخول والبروكسي (Login Rate Limiting & Proxy Controls)** (`src/modules/system/auth/login-rate-limit.middleware.ts`, `src/config/env.config.ts`, `src/app.ts`):
  - **حماية مسبقة لمسار الدخول (Pre-DTO & Pre-Bcrypt Protection)**:
    - تركيب وسيط `loginRateLimiter` على مسار `POST /api/auth/login` قبل التحقق من الـ DTO وقبل تشفير الـ Bcrypt لمنع استنزاف المعالج (CPU Exhaustion) والتخمين المتكرر.
    - استخدام مكتبة `express-rate-limit 8.7.0` بنافذة زمنية افتراضية 15 دقيقة وحد أقصى 15 محاولة قابلة للضبط عبر المتغيرات البيئية (`AUTH_LOGIN_RATE_LIMIT_WINDOW_MINUTES`, `AUTH_LOGIN_RATE_LIMIT_MAX`) مع فحص رقمي صارم (`parseStrictIntegerEnv`) يفشل التشغيل عند تمرير قيم مشوهة.
    - استخدام `MemoryStore` الافتراضي المحلي للعملية الحالية (process-local) المناسب للنشر الفردي الحالي، مع اشتراط الترقية إلى مخزن مشترك (Shared Store مثل Redis) مستقبلاً عند النشر المتعدد (Multi-Instance Scaling).
    - استثناء المحاولات الناجحة من احتساب حصة الاستهلاك (`skipSuccessfulRequests: true`).
    - تفعيل ترويسات المعيار الحديثة (`draft-7`) وإرسال ترويسة `Retry-After` بالثواني مع رمز الحالة HTTP 429 ورمز الخطأ الثابت `AUTH_LOGIN_RATE_LIMITED` الممرر عبر `TooManyRequestsError` إلى معالج الأخطاء المركزي `errorHandlerMiddleware`.
  - **التحكم الصريح بالبروكسي الموثوق (Proxy-Aware IP Handling)**:
    - ضبط `app.set('trust proxy', envConfig.trustProxyHops)` حصراً عند تعريف عدد قفزات موثوق موجب (`TRUST_PROXY_HOPS > 0`) لتفادي انتحال العناوين عند العمل خلف Reverse Proxy مثل Nginx (مع اشتراط حظر الوصول المباشر لمنفذ التطبيق من الإنترنت عند تفعيلها)، مع ترك الإعداد الافتراضي الآمن عند 0.
    - الاعتماد حصراً على `req.ip` المدار عبر Express ومنع التحليل اليدوي لـ `X-Forwarded-For`.
  - **تكامل واجهة تسجيل الدخول (Login Client Integration)**:
    - معالجة صريحة للرمز 429 في `src/public/js/login.js` واستخراج ترويسة `Retry-After` وتحويلها لدقائق تقريبية باللغة العربية مع إعادة تفعيل زر الإرسال.
- **الملف الإداري الموحد للمستخدم (User Portfolio / Central User Administration Profile)** (`src/modules/system/user/portfolio/`, `src/modules/production/team/production-user-responsibility-read.service.ts`):
  - **طبقة قراءة وتجميع (Read / Composition Layer)**: توفر مركزاً إدارياً شاملاً لفهم هوية المستخدم، حالة حسابه، دوره، ملخص صلاحياته، تنبيهات الأمان، ومسؤوليته التشغيلية في تطبيق الإنتاج دون تكرار أو مساس بمنطق الأعمال للوحدات المدمجة.
  - **أقسام الملف الإداري (Portfolio Tabs)**:
    - `نظرة عامة (Overview)`: ملخص حالة الحساب، الدور، عدد الصلاحيات الموروثة والمباشرة، التنبيهات الأمنية والتشغيلية المجمعة، وملخص المسؤولية التشغيلية للإنتاج.
    - `الحساب (Account)`: عرض تفاصيل الحساب للقراءة فقط (الاسم، الهاتف، الدور، الحالة، التواريخ) مع زر تعديل مشروط بصلاحية `USER_UPDATE`.
    - `الصلاحيات والوصول (Permissions)`: دمج واجهة إدارة الصلاحيات وقواعد الوصول الحالية داخل إطار الملف الإداري مع شريط السياق التشغيلي.
    - `المسؤولية التشغيلية (Production Responsibility)`: عرض القسم والساحات المسندة للمستخدم في تطبيق الإنتاج مع التحقق من نطاق الوصول وحظر تسريب البيانات.
  - **خدمة استعلام المسؤولية التشغيلية الآمنة `ProductionUserResponsibilityReadService`**:
    - ترجع حالة المسؤولية (`VISIBLE` | `NONE` | `NOT_VISIBLE` | `INCONSISTENT`) بالاعتماد على `ProductionResponsibilityResolver.resolveByUserId` مع إعادة التحقق الحتمي للبيانات المقروءة ضد الـ TOCTOU.
    - تفرض التحقق من نطاق القسم المستهدف دائماً عبر `canAccessDepartment(viewPolicy, targetDeptId)` ولا تعتمد إطلاقاً على `allowAll` بمفرده لضمان تفوق قواعد `DENY`.
    - تعيد التحقق من ملكية رئاسة القسم (`dept.id = targetDeptId`, `dept.headUserId = targetUserId`, `dept.deletedAt IS NULL`) وإعادة فحص صلاحية القسم قبل العرض.
    - تقيد استعلام المهندس الثاني بمعرف المستخدم والحالة النشطة والقسم المصرح به (`eng.userId = targetUserId`, `eng.isActive = true`, `eng.departmentId = targetDeptId`) لمنع تسريب أقسام أخرى في حال إعادة الإسناد المتزامن.
    - تتحقق من صحة كافة ارتباطات الساحات دون فلترة صامتة، وتجلب الساحات المرجعية بما فيها المؤرشفة (`withDeleted()`) لتحديد القسم الأصلي؛ وفي حال كانت الساحة مفقودة تماماً (`Hard Missing`) أو تعذر حلها تفشل مغلقة فوراً إلى `NOT_VISIBLE`؛ وفي حال كانت الساحة المؤرشفة أو النشطة تتبع قسماً آخر يتم فحص صلاحية كلا القسمين ولا تُعرض حالة عدم الاتساق `INCONSISTENT` إلا إذا كان كلا القسمين ضمن نطاق وصول الفاعل وإلا تفشل مغلقة `NOT_VISIBLE`.
    - تحظر كشف حالة انعدام المسؤولية `NONE` إلا إذا امتلك الفاعل وصولاً شاملاً غير مقيد للأقسام (`hasUnrestrictedDepartmentVisibility(viewPolicy)`)؛ والمشاهد المقيد يحصل على `NOT_VISIBLE` لمنع التمييز بين انعدام المسؤولية ووجودها خارج النطاق.
    - تفحص إمكانية إدارة الفريق عبر `canAccessDepartment(managePolicy, targetDeptId)` لعرض زر وإجراءات إدارة الفريق المشروطة.
  - **تجميع التنبيهات الذكي (`Smart Derived Warnings`)**:
    - اشتقاق تنبيهات فورية غير مخزنة في قاعدة البيانات لحالات الحساب المعطل، الصلاحيات المفعلة بدون منح، القواعد غير الصالحة، وعدم اتساق المسؤولية التشغيلية.
  - **مسارات الويب المعتمدة**:
    - `GET /system/users/:id` (نظرة عامة - محمي بـ `USER_VIEW`).
    - `GET /system/users/:id/account` (بيانات الحساب - محمي بـ `USER_VIEW`).
    - `GET /system/users/:id/permissions` (الصلاحيات - محمي بـ `USER_VIEW`).
    - `GET /system/users/:id/production` (المسؤولية التشغيلية - محمي بـ `USER_VIEW` و `PRODUCTION_ASSIGNMENT_VIEW`).
- **إدارة الصلاحيات وقواعد الوصول الكاملة (Complete Permission & Access Rule Administration)** (`src/modules/system/authorization/access-administration/`, `src/modules/system/role/`, `src/modules/system/user/`):
  - **فصل دلالة التفعيل (Checkbox Semantics)**:
    - خانة الاختيار بجانب الصلاحية تعني حصراً: هل توجد منحة نشطة (`PermissionGrant.isActive = true`) لهذا الدور أو المستخدم؟
    - تفعيل الصلاحية **لا ينشئ إطلاقاً** قاعدة `ALLOW ALL` ولا ينشئ أي قواعد وصول تلقائياً.
    - الصلاحية المفعلة بدون أي قاعدة منح (`ALLOW`) فعالة تؤدي تلقائياً إلى انعدام الوصول (Fail Closed) وتُظهر الواجهة تحذيراً صريحاً.
  - **دعم تعدد قواعد الوصول (Multiple Access Rules 0..N)**:
    - يمكن للمنحة الواحدة امتلاك عدة قواعد وصول تجمع بين المنح (`ALLOW`) والحظر/الاستثناء (`DENY`).
    - صيغة التقييم القطعية: `(ALLOW 1 OR ALLOW 2 ...) AND NOT (DENY 1 OR DENY 2 ...)`. قاعدة `DENY ALL` تلغي الوصول تماماً وتتفوق على كافة المنح.
  - **سجل قدرات الصلاحيات المركزي (Centralized Capability Registry)**:
    - تعريف `AccessScopeCapabilityRegistry` لتحديد القوالب المسموحة (`Allowed Presets`) لكل صلاحية في الـ Backend.
    - صلاحيات النظام تقبل حصراً القالب الشامل `ALL`.
    - صلاحيات الإنتاج تدعم القوالب التشغيلية المحددة:
      - `production.department.view/update/delete`: `ALL`, `CURRENT_PRODUCTION_DEPARTMENT`, `SPECIFIC_PRODUCTION_DEPARTMENTS`.
      - `production.department.create`: `ALL` فقط.
      - `production.yard.view/update/delete`: `ALL`, `CURRENT_PRODUCTION_DEPARTMENT`, `CURRENT_PRODUCTION_YARDS`, `SPECIFIC_PRODUCTION_DEPARTMENTS`, `SPECIFIC_PRODUCTION_YARDS`.
      - `production.yard.create`: `ALL`, `CURRENT_PRODUCTION_DEPARTMENT`, `SPECIFIC_PRODUCTION_DEPARTMENTS`.
      - `production.assignment.view/manage`: `ALL`, `CURRENT_PRODUCTION_DEPARTMENT`, `SPECIFIC_PRODUCTION_DEPARTMENTS`.
  - **قوالب الإدارة المهيكلة ومطابقة التخزين (Typed Presets & Persistence Mapping)**:
    - العميل لا يرسل JSON خام أو SQL؛ بل يرسل القالب `preset` وقائمة المعرفات `targetIds`.
    - `ALL`: `scopeType = 'ALL'`, `scope = null`. (عقد النطاق الشامل الصارم: صالحة حصراً عندما يكون `scope = null`؛ أي قاعدة `ALLOW ALL` تالفة `scope !== null` تُهمل ولا تمنح شيئاً، وأي قاعدة `DENY ALL` تالفة تفشل مغلقة وتمنع الوصول تماماً).
    - `CURRENT_PRODUCTION_DEPARTMENT`: `scopeType = 'PRODUCTION_DEPARTMENT'`, `scope = { source: 'CURRENT_PRODUCTION_RESPONSIBILITY' }`.
    - `CURRENT_PRODUCTION_YARDS`: `scopeType = 'PRODUCTION_YARD'`, `scope = { source: 'CURRENT_PRODUCTION_RESPONSIBILITY' }`.
    - `SPECIFIC_PRODUCTION_DEPARTMENTS`: `scopeType = 'PRODUCTION_DEPARTMENT'`, `scope = { source: 'SPECIFIC_IDS', departmentIds: [...] }`.
    - `SPECIFIC_PRODUCTION_YARDS`: `scopeType = 'PRODUCTION_YARD'`, `scope = { source: 'SPECIFIC_IDS', yardIds: [...] }`.
  - **التحقق الصارم من الأهداف المحددة (Specific IDs Validation)**:
    - التحقق في قاعدة البيانات عند الإنشاء والتعديل من وجود الأقسام والساحات المحددة وعدم أرشفاتها (`deletedAt IS NULL`).
    - إزالة التكرارات وترتيب المعرفات حتمياً والتأكد من أنها ضمن الحد المسموح (1 إلى 200 معرف).
  - **توسيع محرك تقييم السياسة `ProductionAccessPolicyService`**:
    - دعم مصدر `SPECIFIC_IDS` في تقييم نطاقات الأقسام والساحات بإضافة المعرفات مباشرة إلى `allowDepartmentIds` / `denyDepartmentIds` / `allowYardIds` / `denyYardIds`.
    - القواعد المحددة لا تتأثر بفساد المسؤولية التشغيلية؛ بينما القواعد الديناميكية فقط تخضع لفحص `responsibility.isConsistent`.
    - أي قاعدة حظر (`DENY`) تالفة أو غير معروفة تؤدي إلى `denyAll = true` (Fail Closed).
  - **خدمة البحث والاستعلام الإدارية `ProductionAdminLookupService`**:
    - توفير بحث سريع ومحدد للأقسام والساحات غير المؤرشفة لإدارة القواعد المحددة دون تسريب وبدون N+1.
  - **بروتوكول القفل التشاؤمي للموضوع (Subject Serialization Lock Protocol)**:
    - جميع عمليات تعديل الصلاحيات وقواعد الوصول للأدوار تتسلسل عبر قفل تشاؤمي على صف الدور (`Role row` via `pessimistic_write`).
    - جميع عمليات تعديل الصلاحيات وقواعد الوصول للمستخدمين تتسلسل عبر قفل تشاؤمي على صف المستخدم (`User row` via `pessimistic_write`).
  - **حماية مدير النظام والذات (SYSTEM_ADMIN & Self Protection)**:
    - منع تعديل صلاحيات وقواعد دور `SYSTEM_ADMIN` (`SYSTEM_ADMIN_PERMISSIONS_MANAGED_BY_SYSTEM`).
    - منع المستخدم من تعديل صلاحياته المباشرة بنفسه (`CANNOT_MANAGE_OWN_PERMISSIONS`).
  - **واجهات مستخدم تفاعلية ومتجاوبة (Responsive Bootstrap UI)**:
    - بطاقات صلاحيات متجاوبة (2-columns على الشاشات الكبيرة، 1-column على الهواتف).
    - درج جانبي Offcanvas منبثق لإدارة قواعد الوصول مع دعم كامل للهواتف (Full Width).
    - محدد أهداف ذكي Native JS مع بحث debounced وشرائح مختارة (Chips) قابلة للحذف السريع.
    - فصل واضح في شاشة المستخدم بين الصلاحيات الموروثة من الدور والصلاحيات المباشرة والنتيجة الفعالة.
  - **إلغاء مسار التعديل القديم غير الآمن (Legacy Removal)**:
    - إزالة مسارات وخدمات `/global-permissions` و `setRoleGlobalPermissions` و `setUserGlobalPermissions` واستبدالها بنظام إدارة الصلاحيات وقواعد الوصول الدقيق الجديد.
  - **مطابقة وتسوية الصلاحيات التشغيلية وقت التشغيل (Runtime Permission Reconciliation & System Registry)**:
    - اعتماد السجل المركزي الموحد للصلاحيات في `src/modules/system/permission/constants/system-permission.registry.ts` كمرجع أحادي وموثوق (Single Source of Truth) لكافة الصلاحيات وقدرات النطاقات في النظام.
    - خدمة المطابقة التلقائية `PermissionReconciliationService` في `src/modules/system/permission/services/permission-reconciliation.service.ts`.
    - التسوية التلقائية أثناء إقلاع الخادم (Runtime reconciliation in server startup / `src/server.ts` عبر `reconcileSystemPermissions`): مقارنة السجل مع قاعدة البيانات وإدراج أي صلاحيات جديدة تلقائياً عند التشغيل.
    - لم تعد الصلاحيات تعتمد حصراً على الـ Seed الأولي؛ أي صلاحية جديدة تُضاف إلى الـ Registry تصبح فوراً جزءاً من النظام الفعلي دون الحاجة لإعادة تشغيل الـ Seed أو المساس بالبيانات القائمة.
    - منح دور مدير النظام `SYSTEM_ADMIN` الصلاحيات الفعالة وقواعد الوصول الشامل `ALLOW ALL` تلقائياً لكل صلاحية نظام مستجدة ضمن عملية المطابقة لضمان استمرارية الإدارة وصلاحية الوصول.

- **نطاقات الوصول الديناميكية والصلاحيات على مستوى الصفوف (Dynamic Production Access Scopes & Row-Level Authorization Core)** (`src/modules/production/authorization/`):
  - **فصل المسؤوليات المعماري**:
    - المصادقة (`Authentication`): من هو المستخدم؟ (`AuthPrincipal`).
    - الصلاحية (`Permission`): ماذا يستطيع أن يفعل؟ (مثل `production.department.view`).
    - نطاق الوصول (`Access Scope`): على أي بيانات يستطيع فعل ذلك؟ (`ALL`, `PRODUCTION_DEPARTMENT`, `PRODUCTION_YARD`).
    - المسؤولية التشغيلية (`Operational Responsibility`): ما القسم أو الساحات التي تقع ضمن مسؤوليته الحالية؟
  - **التحقق الدقيق والصارم من شكل كائن النطاق (`Strict Exact-Shape Scope Validation`)**:
    - التحقق عبر `isCurrentProductionResponsibilityScope` يفرض أن يكون الكائن مطابقاً تماماً للشكل `{ "source": "CURRENT_PRODUCTION_RESPONSIBILITY" }` بدون أي خصائص إضافية (`Object.keys(scope).length === 1`). أي خصائص إضافية تجعل النطاق غير صالح (`Invalid Scope`).
    - قواعد الـ ALLOW غير الصالحة لا تمنح أي وصول، وقواعد الـ DENY غير الصالحة تؤدي للرفض التام (`denyAll = true` / Fail Closed).
  - **حل النطاقات الديناميكي وقت الطلب (`Dynamic Scope Resolution at Request Time`)**:
    - لا يتم تخزين معرفات الأقسام أو الساحات في `AccessRule` ولا في الـ JWT ولا في الـ Session.
    - يُخزن فقط نوع النطاق والمصدر الديناميكي `{ "source": "CURRENT_PRODUCTION_RESPONSIBILITY" }`.
    - عند تنفيذ الطلب، يقوم `ProductionResponsibilityResolver` بحل المسؤوليات الفعلية للمستخدم من قاعدة البيانات بـ استعلامين مستهدفين فقط بدون N+1:
      1. استعلام رئاسة القسم (`Head query`): على `production_department` حيث `head_user_id = principal.id` و `deleted_at IS NULL`.
      2. استعلام إسناد المهندس الموحد المدمج (`Engineer joined query`): استعلام واحد يضم `ProductionDepartmentEngineerEntity` مع القسم `department` وارتباطات الساحات `yardMappings` وساحاتها `yard` حيث `eng.userId = :userId` و `eng.isActive = true`.
    - **فحوصات النزاهة والانغلاق الآمن للمسؤوليات (Resolver Consistency Checks & Fail-Closed)**:
      - التحقق من وجود علاقة قسم المهندس وعدم أرشفته (`eng.department.deletedAt === null`).
      - التحقق من امتلاك المهندس النشط لساحة واحدة على الأقل مسندة إليه (`yardMappings.length > 0`) واعتبار وجود مهندس نشط بلا ساحات حالة تشغيلية فاسدة وتناقضاً في البيانات.
      - التحقق من وجود كافة الساحات المسندة وعدم أرشفتها (`yard.deletedAt === null`).
      - التحقق من تطابق تبعية كافة الساحات لقسم المهندس نفسه (`yard.departmentId === eng.departmentId`).
      - التحقق من عدم تعارض الأدوار التشغيلية وجمع رئاسة قسم مع إسناد مهندس نشط (`headDepartmentId !== null && engineerDepartmentId !== null`).
      - في حال فشل أي شرط نزاهة، تعتبر الحالة غير سليمة (`isConsistent = false`) ويتم تصفير ساحات المهندس (`engineerYardIds = []`) لإبطال النطاقات الديناميكية تلقائياً دون تصليح صامت للبيانات الفاسدة.
  - **محرك تقييم سياسة الوصول `ProductionAccessPolicyService`**:
    - تقييم القواعد المطبقة (منح الدور + المنح المباشرة).
    - تفوق الرفض التام (`DENY ALL` wins / `DENY` overrides `ALLOW`).
    - قواعد الحظر أو المنح غير الصالحة أو غير المدعومة تخضع لسياسة الـ Fail Closed (الـ DENY غير المفهوم يتحول إلى `denyAll = true`، والـ ALLOW غير المفهوم لا يمنح شيئاً).
    - إنتاج سياسة وصول قطعية وموحدة `ResolvedProductionAccessPolicy` تحتوي على معرفات الأقسام والساحات المسموحة والمحظورة (`allowDepartmentIds`, `denyDepartmentIds`, `allowYardIds`, `denyYardIds`, `allowAll`, `denyAll`, `hasAnyAccess`).
  - **كاش الصلاحيات والمسؤوليات على مستوى الطلب `ProductionAuthorizationContext`**:
    - استخدام `WeakMap<Request, ...>` لضمان انتهاء الكاش تلقائياً بانتهاء دورة حياة الطلب دون تسريب في الذاكرة وبدون الحاجة لـ Redis.
    - حل المسؤولية التشغيلية مرة واحدة فقط لكل Request.
    - حل سياسة الوصول لكل صلاحية مرة واحدة فقط لكل Request، مما يمنع تكرار الاستعلامات بين الوسيط (Middleware) ووحدات التحكم (Controllers) وواجهات الويب (Views).
  - **إنفاذ الشروط على مستوى `QueryBuilder` للبيانات والبيانات الوصفية (`Resource & Metadata Query Scoping`)**:
    - `applyDepartmentAccessScope`: تطبيق شروط الوصول على استعلامات الأقسام على مستوى SQL قبل الـ Pagination والـ Counting.
    - `applyYardAccessScope`: تطبيق شروط الوصول على استعلامات الساحات مع دعم أقسام المهندسين وساحاتهم عبر `Brackets` آمنة.
    - `listActiveDepartmentsForPolicy`: جلب الأقسام النشطة المسموحة للأهداف (Target Departments) بتطبيق `applyDepartmentAccessScope` داخل الـ QueryBuilder مباشرة لمنع تسريب بيانات الأقسام غير المسموحة.
    - `listAccessibleDepartmentOptions`: جلب خيارات الأقسام لفلتر الساحات عبر استعلام مدمج للساحات المسموحة (`applyYardAccessScope`) واستخراج الأقسام الفريدة منها لمنع تسريب أسماء أقسام لا يملك المستخدم ساحات ضمنها.
    - حظر الفلترة اللاحقة بعد الجلب (`No post-fetch security filtering`) لخيارات القوائم المنسدلة والفلاتر.
    - استعلامات `getById`: تطبيق نطاق الوصول داخل استعلام الـ SQL وإرجاع 404 برمز `NOT_FOUND` في حال كان السجل خارج النطاق لمنع تسريب وجود البيانات (`Prevent Information Leakage`).
    - العمليات التعديلية والحذف: التحقق المسبق من النطاق عبر Scoped Pre-Read لرفض الطلبات غير المصرح بها (404) قبل الدخول في Transactions أو حيازة أقفال تشاؤمية، مع إعادة التحقق القطعي الحتمي من النطاق (`canAccessDepartment`, `canAccessYard`) على السجل المقفول داخل الـ Transaction لمنع ثغرات الـ TOCTOU.
    - ترتيب التحقق في `updateYard`: قفل الأقسام ثم قفل الساحة والتحقق من صلاحية الوصول للساحة المصدر (`canAccessYard`) أولاً قبل التحقق من فعالية أو صلاحية الوصول للقسم الهدف لمنع تسريب معلومات القسم الهدف لمستخدم لا يملك الساحة المصدر.
    - إنشاء قسم جديد: يبقى صلاحية عامة شاملة (`requirePermission(PRODUCTION_DEPARTMENT_CREATE)`).
    - إنشاء ساحة جديدة: التحقق من وقوع القسم المستهدف ضمن نطاق وصول المستخدم (`canAccessDepartment(policy, dto.departmentId)`).
    - نقل ساحة لقسم آخر: التحقق من امتلاك المستخدم وصولاً للقسم الجديد المستهدف على مستوى القسم (`canAccessDepartment(policy, targetDepartment.id)`).
- **فرق عمل ومسؤوليات الإنتاج (Production Department Team & Engineer Assignments Core)** (`src/modules/production/team/`):
  - **هيكل مسؤوليات تشغيلي مستقل**: يربط المستخدمين بالكيانات التشغيلية داخل تطبيق الإنتاج حصراً ومستقل تماماً عن HR.
  - **تعارض الأدوار التشغيلية (Mutual Exclusivity)**: لا يجوز للمستخدم في نفس الوقت أن يكون رئيساً لأي قسم إنتاج ومهندساً مسنداً لساحات إنتاج (A user cannot simultaneously hold a current Production Department Head responsibility and a current Yard Engineer assignment).
  - **رئيس القسم (`Department Head`)**: لكل قسم إنتاج رئيس قسم واحد (`head_user_id` في `production_department`) بقيد فرادة في قاعدة البيانات (`UQ_production_department_head_user`)، ويكون مسؤولاً تلقائياً عن جميع ساحات القسم الحالية والمستقبلية دون الحاجة لصفوف إسناد ساحات منفصلة.
  - **قواعد ترشيح رئيس القسم (Department Head Candidate Rules)**:
    - المستخدم يجب أن يكون: نشطاً (`isActive = true`)، غير محذوف ناعماً (`deletedAt IS NULL`)، ليس رئيساً لأي قسم إنتاج غير مؤرشف (بما في ذلك القسم الحالي في واجهة الاختيار)، ليس مهندساً نشطاً في أي قسم إنتاج (`PRODUCTION_ENGINEER_CANNOT_BE_DEPARTMENT_HEAD`)، وليس لديه أي ارتباطات بساحات إنتاج (`PRODUCTION_USER_HAS_EXISTING_YARD_ASSIGNMENTS`).
    - المستخدم الذي كان مهندساً سابقاً بسجل تاريخي معطل ونظيف (0 ارتباطات ساحات) مؤهل لتولي رئاسة القسم.
  - **دورة حياة رئيس القسم عند أرشفة القسم (Department Soft Delete Head Release)**:
    - عند أرشفة قسم إنتاج (`softDeleteDepartment`)، يتم تصفير حقل رئيس القسم (`head_user_id = null`) مع ضبط `deleted_at` وتعيين `is_active = false` داخل نفس الـ Transaction لتحرير قيد الفرادة وتمكين المستخدم من تولي رئاسة قسم آخر.
  - **المهندسون وتوزيع الساحات (`Engineers & Yard Assignments`)**:
    - المهندس ينتمي لقسم إنتاج واحد فقط (`userId` فريد في `production_department_engineer` عبر `UQ_production_department_engineer_user`).
    - المهندس يُسند لساحة واحدة أو أكثر تتبع لنفس قسمه (`production_yard_engineer` مع قيد فرادة الزوج `UQ_production_yard_engineer_assignment`).
    - يمكن للساحة الواحدة أن تضم أكثر من مهندس مسؤول عنها.
    - يُمنع إسناد مهندس لساحات تتبع قسماً آخر (`PRODUCTION_ENGINEER_YARD_DEPARTMENT_MISMATCH`).
    - يُمنع نقل أو أرشفة ساحة مسندة لمهندسين حالياً (`PRODUCTION_YARD_HAS_ENGINEERS`).
    - لا يتم حذف صف المهندس صلبياً بل يُعطّل (`isActive = false`) مع حذف ارتباطات ساحاته، وعند إعادة تعيينه يُعاد تفعيل نفس السجل بشرط ألا يكون لديه ارتباطات قديمة (`PRODUCTION_ENGINEER_HAS_EXISTING_YARD_ASSIGNMENTS`).
  - **قواعد ترشيح المهندس (Engineer Candidate Rules)**:
    - المستخدم يجب أن يكون: نشطاً، غير مؤرشف، ليس رئيساً لأي قسم إنتاج (`PRODUCTION_DEPARTMENT_HEAD_CANNOT_BE_ENGINEER`)، ليس مهندساً نشطاً في القسم المستهدف (`PRODUCTION_ENGINEER_ALREADY_ASSIGNED`) ولا في أي قسم إنتاج آخر (`PRODUCTION_ENGINEER_ASSIGNED_TO_OTHER_DEPARTMENT`)، ولا يملك أي ارتباطات ساحات متعارضة أو قديمة (`PRODUCTION_ENGINEER_HAS_EXISTING_YARD_ASSIGNMENTS`).
  - **خدمة فريق عمل الإنتاج `ProductionTeamService`** (`src/modules/production/team/production-team.service.ts`):
    - `getDepartmentTeam`: استرجاع بيانات فريق القسم (رئيس القسم والمهندسين والساحات المسندة لكل مهندس).
    - `listAvailableDepartmentHeadUsers`: استرجاع المستخدمين المتاحين لرئاسة القسم (نشطون، غير محذوفين، ليسوا رؤساء أقسام، ليسوا مهندسين نشطين، وبلا ساحات مسندة).
    - `listAvailableEngineerUsers`: استرجاع المستخدمين المتاحين للإسناد كمهندسين (نشطون، غير محذوفين، ليسوا رؤساء أقسام، لا يملكون إسناد مهندس نشط في أي قسم، وبلا ساحات مسندة متعارضة، مع إمكانية إعادة استخدام السجل التاريخي المعطل النظيف).
    - `setDepartmentHead`: تعيين أو تغيير رئيس القسم داخل Transaction بقفل تشاؤمي بترتيب (`Department -> User`).
    - `addEngineerToDepartment`: إسناد مهندس وتحديد ساحاته داخل Transaction بقفل تشاؤمي بترتيب (`Department -> User -> Assignment -> Yards sorted`).
    - `updateEngineerYards`: تعديل الساحات المسندة للمهندس داخل Transaction بقفل تشاؤمي بترتيب (Department -> User -> Assignment -> فحص الارتباطات الحالية والانغلاق الآمن Fail-Closed -> اتحاد الساحات الحالية والمطلوبة -> أقفال الساحات التسلسلية الفردية بترتيب المعرفات تصاعدياً -> إعادة التحقق -> استبدال ذري للارتباطات).
    - `removeEngineerFromDepartment`: إزالة المهندس وتعطيل السجل وحذف ارتباطات الساحات داخل Transaction بقفل تشاؤمي بترتيب (`Department -> User -> Assignment`).
  - **بروتوكول قفل سجلات فريق الإنتاج الموحد (Production Team Lock Order Protocol)**:
    - كافة عمليات فريق الإنتاج تلتزم بترتيب القفل التشاؤمي الموحد دون أي انعكاس:
      1. قسم الإنتاج (`Department row` via `pessimistic_write`)
      2. سجل المستخدم (`User row` via `pessimistic_write`)
      3. سجل تعيين المهندس (`Assignment row` via `pessimistic_write`)
      4. سجلات الساحات مرتبة تصاعدياً حسب المعرف (`Yards sorted ascending by ID` via `pessimistic_write`)
      5. كتابة المخططات والروابط (`Mapping writes / mutations`)
  - **تحكم الويب لفريق العمل `ProductionTeamWebController`**:
    - `renderDepartmentTeam`: يعتمد على `viewPolicy` لعرض الفريق، ويحسب `canManage` عبر `canAccessDepartment(managePolicy, departmentId)`؛ وفي حال كان `canManage === false` يتم تخطي استعلامات ترشيح المستخدمين والساحات وإرجاع مصفوفات فارغة لتوفير الموارد ومنع كشف البيانات.
    - `renderAddEngineerForm` و `renderEditEngineerYardsForm`: تعتمد حصراً على `managePolicy` في جلب الفريق والتحقق من الوصول دون اشتراط صلاحية `PRODUCTION_ASSIGNMENT_VIEW` ضمنياً.
- **الهيكل التشغيلي للإنتاج - الأقسام والساحات (Production Departments & Yards Core)** (`src/modules/production/`):
  - **فصل تشغيلي تام عن الموارد البشرية**: بيانات الأقسام والساحات هنا هي بيانات تشغيلية تخص تطبيق الإنتاج (`Production Application`) حصراً ومستقلة تماماً عن الهيكل التنظيمي للموارد البشرية (`HR Structure`).
  - **بيانات أعمال ديناميكية**: بيانات الأقسام والساحات ديناميكية بالكامل وتُدار عبر الواجهة وقاعدة البيانات ولا تحتوي على أي Enums صلبة.
  - **خدمة أقسام الإنتاج `ProductionDepartmentService`** (`src/modules/production/department/production-department.service.ts`):
    - `listDepartments`: استرجاع قائمة أقسام الإنتاج مع ترقيم الصفحات (Pagination) والبحث بالاسم أو الرمز، واسترجاع رئيس القسم، وحساب إجمالي الساحات (`yardCount`) والساحات النشطة (`activeYardCount`) في استعلام تجميعي واحد بدون N+1، واستبعاد المحذوفين ناعماً وتطبيق `applyDepartmentAccessScope`.
    - `getDepartmentById`: استرجاع تفاصيل قسم إنتاج محدد مع رئيس القسم وحساب عدد الساحات وتطبيق نطاق الوصول ورمي `NotFoundError` برمز `PRODUCTION_DEPARTMENT_NOT_FOUND` إذا لم يوجد أو كان خارج النطاق.
    - `createDepartment`: إنشاء قسم إنتاج جديد مع تحديد رئيس القسم الإلزامي (`headUserId`)، والتحقق من نشاط المستخدم وصلاحيته عبر قفل سجل المستخدم أولاً (`User row` via `pessimistic_write` ثم `Department INSERT`)، مع فحص مسبق لفرادة الرمز التقني (`code.trim().toUpperCase()`) متضمناً السجلات المحذوفة ناعماً (`withDeleted()`) والتقاط تضارب المفتاح الفريد وتحويله إلى `ConflictError` برمز `PRODUCTION_DEPARTMENT_CODE_ALREADY_EXISTS` (409).
    - `updateDepartment`: تحديث بيانات القسم (الاسم، الوصف، حالة التفعيل) داخل Transaction مع قفل تشاؤمي للكتابة (`pessimistic_write`) على سجل القسم (`Department row`)، مع ثبات الرمز التقني وعدم السماح بتعديله، والتحقق من `canAccessDepartment(policy, department.id)`، وتطبيق قاعدة منع تعطيل القسم طالما يمتلك ساحات نشطة (`PRODUCTION_DEPARTMENT_HAS_ACTIVE_YARDS`).
    - `softDeleteDepartment`: أرشفة القسم (Soft Delete) وضبط `headUserId = null` و `isActive = false` و `deletedAt = new Date()` داخل Transaction مع قفل تشاؤمي على سجل القسم، وتطبيق قاعدة منع أرشفة القسم طالما يمتلك أي ساحات غير مؤرشفة سواء كانت نشطة أو معطلة (`PRODUCTION_DEPARTMENT_HAS_YARDS`) وتطبيق قاعدة منع أرشفة القسم طالما يمتلك مهندسين نشطين (`PRODUCTION_DEPARTMENT_HAS_ENGINEERS`).
    - `listActiveDepartmentsForPolicy`: استرجاع الأقسام النشطة غير المؤرشفة المسموحة لسياسة الوصول المحددة عبر `applyDepartmentAccessScope` داخل الـ QueryBuilder مباشرة للاستخدام في القوائم المنسدلة للإنشاء ونقل الساحات.
    - `findAssignableDepartmentForUpdate`: دالة مساعدة لقفل والتحقق من نشاط وصلاحية القسم قبل ربط الساحات به.
    - `listActiveDepartments`: استرجاع قائمة كافة الأقسام النشطة غير المؤرشفة بدون سياسة وصول (Unscoped)، وتستخدم حصراً في السياقات الداخلية التي لا تعتمد على فلترة الصلاحيات.
  - **خدمة ساحات الإنتاج `ProductionYardService`** (`src/modules/production/yard/production-yard.service.ts`):
    - `listYards`: استرجاع قائمة ساحات الإنتاج مع Pagination والبحث، والفلترة الاختيارية بالقسم (`departmentId`)، وضم القسم التابع (`department`) بدون N+1، مع تطبيق `applyYardAccessScope`.
    - `listAccessibleDepartmentOptions`: استرجاع خيارات الأقسام المتاحة للفلترة بناءً على الساحات المسموح للمستخدم رؤيتها ضمن `viewPolicy` عبر استعلام SQL موحد مستند إلى `applyYardAccessScope` دون كشف أسماء أو معرفات أقسام غير مسموحة.
    - `getYardById`: استرجاع تفاصيل الساحة مع قسمها التابع وتطبيق نطاق الوصول عبر `applyYardAccessScope` ورمي `NotFoundError` برمز `PRODUCTION_YARD_NOT_FOUND` عند عدم وجودها أو خروجها عن النطاق.
    - `createYard`: إنشاء ساحة جديدة داخل Transaction متزامنة مع قفل تشاؤمي للكتابة (`pessimistic_write`) على سجل قسم الإنتاج التابع عبر `findAssignableDepartmentForUpdate` بعد التحقق من `canAccessDepartment(policy, dto.departmentId)`، لضمان فعالية القسم ومنع التزامن مع تعطيله، وفحص فرادة رمز الساحة عبر `withDeleted()` والتقاط خطأ 409 برمز `PRODUCTION_YARD_CODE_ALREADY_EXISTS`.
    - `updateYard`: تحديث بيانات الساحة (القسم، الاسم، السعة، الوصف، حالة التفعيل):
      1. قراءة استطلاعية مقيدة بالصلاحيات (`Scoped Pre-Read`) خارج الـ Transaction عبر `applyYardAccessScope` لرفض الساحات غير المسموحة فوراً برمز `PRODUCTION_YARD_NOT_FOUND` (404) قبل حيازة أي أقفال تشاؤمية.
      2. فتح الـ Transaction وقفل الأقسام المعنية تشاؤمياً واحداً تلو الآخر بترتيب تصاعدي حتمي لمعرفاتها (`for (const deptId of sortedDeptIds)`).
      3. قفل سجل الساحة تشاؤمياً (`Yard row` via `pessimistic_write`).
      4. إعادة التحقق من تطابق التبعية للقسم المقفول (`PRODUCTION_YARD_CONCURRENTLY_CHANGED`).
      5. إعادة التحقق القطعي من صلاحية الوصول للساحة المصدر المقفولة (`canAccessYard`) لمنع ثغرات الـ TOCTOU ورمي `PRODUCTION_YARD_NOT_FOUND` في حال خروجها عن النطاق.
      6. التحقق من صحة القسم الهدف وصلاحية الوصول إليه (`canAccessDepartment`) فقط بعد ثبوت صلاحية الساحة المصدر لمنع تسريب بيانات الأقسام الأخرى.
      7. التحقق من عدم وجود مهندسين مسندين للساحة عند نقلها لقسم آخر (`PRODUCTION_YARD_HAS_ENGINEERS`).
      8. التحقق من فعالية القسم التابع عند تفعيل الساحة وحفظ التعديلات.
    - `softDeleteYard`: أرشفة الساحة (Soft Delete) وضبط `isActive = false` و `deletedAt = new Date()`:
      1. قراءة استطلاعية مقيدة بالصلاحيات (`Scoped Pre-Read`) خارج الـ Transaction عبر `applyYardAccessScope` ورمي `PRODUCTION_YARD_NOT_FOUND` (404) إذا كانت خارج النطاق.
      2. فتح الـ Transaction وقفل القسم التابع تشاؤمياً.
      3. قفل سجل الساحة تشاؤمياً.
      4. إعادة التحقق من تبعية الساحة للقسم المقفول.
      5. إعادة التحقق القطعي من صلاحية الوصول للساحة المقفولة (`canAccessYard`).
      6. التحقق من عدم وجود مهندسين مسندين للساحة (`PRODUCTION_YARD_HAS_ENGINEERS`).
      7. الأرشفة والتعطيل وحفظ السجل.
  - **مفهوم السعة الاستيعابية للساحات (`Yard Capacity`)**:
    - السعة الاستيعابية تمثل أقصى عدد من الغرف التي تستطيع الساحة استيعابها (`1 Room = 1 Capacity Unit`) كعدد صحيح موجب (`capacity >= 1`) بغض النظر عن نوع الغرفة أو أبعادها.
    - لا يتم تخزين الإشغال الحالي (`Occupancy`) أو السعة المتبقية كأعمدة في قاعدة البيانات؛ بل تُحسب لاحقاً عند بناء دورة حياة الغرف وحركات الإنتاج.
  - **واجهات برمجة التطبيقات (API Endpoints)**:
    - `GET /api/production/departments` (محمي بـ `PRODUCTION_DEPARTMENT_VIEW`).
    - `GET /api/production/departments/:id` (محمي بـ `PRODUCTION_DEPARTMENT_VIEW` و UUID).
    - `POST /api/production/departments` (محمي بـ `PRODUCTION_DEPARTMENT_CREATE` و `CreateProductionDepartmentDto`).
    - `PATCH /api/production/departments/:id` (محمي بـ `PRODUCTION_DEPARTMENT_UPDATE` و UUID و `UpdateProductionDepartmentDto` مع وسيط `validateDepartmentUpdatePayload`).
    - `DELETE /api/production/departments/:id` (محمي بـ `PRODUCTION_DEPARTMENT_DELETE` و UUID).
    - `GET /api/production/yards` (محمي بـ `PRODUCTION_YARD_VIEW` و `ListProductionYardsQueryDto`).
    - `GET /api/production/yards/:id` (محمي بـ `PRODUCTION_YARD_VIEW` و UUID).
    - `POST /api/production/yards` (محمي بـ `PRODUCTION_YARD_CREATE` و `CreateProductionYardDto`).
    - `PATCH /api/production/yards/:id` (محمي بـ `PRODUCTION_YARD_UPDATE` و UUID و `UpdateProductionYardDto` مع وسيط `validateYardUpdatePayload`).
    - `DELETE /api/production/yards/:id` (محمي بـ `PRODUCTION_YARD_DELETE` و UUID).
  - **واجهات الويب المعروضة من الخادم (Server-rendered EJS)**:
    - `GET /production`: لوحة تحكم تطبيق الإنتاج مع بطاقات التنقل للأقسام والساحات.
    - `GET /production/departments`: جدول أقسام الإنتاج مع إجمالي والساحات النشطة وشارات الحالة، مع أزرار إجراءات مقتصرة بدقة على صلاحيات الصف (`dept.canViewTeam`, `dept.canUpdate`, `dept.canDelete`) بدون fallbacks عامة.
    - `GET /production/departments/create`: نموذج إنشاء قسم إنتاج جديد مع التحقق بواسطة المتصفح وبواسطة Bootstrap.
    - `GET /production/departments/:id/edit`: نموذج تعديل بيانات القسم مع قفل الرمز التقني كـ Read-only.
    - `GET /production/yards`: جدول ساحات الإنتاج مع فلتر الأقسام المشتق من الساحات المسموحة (`listAccessibleDepartmentOptions`)، وحساب `canCreate = creatableDepartments.length > 0`، وأزرار إجراءات مشروطة بصلاحيات الصف (`yard.canUpdate`, `yard.canDelete`).
    - `GET /production/yards/create`: نموذج إنشاء ساحة إنتاج جديدة مع قائمة اختيار الأقسام النشطة المسموحة المشتقة من `listActiveDepartmentsForPolicy`.
    - `GET /production/yards/:id/edit`: نموذج تعديل ساحة الإنتاج مع قائمة الأقسام المستهدفة المسموحة المشتقة من `listActiveDepartmentsForPolicy` مضافاً إليها القسم الحالي فقط.
  - **تفاعل العميل (Client Scripts)**:
    - `src/public/js/production-departments.js`: إدارة الأقسام عبر Native Fetch وتأكيد الحذف والتعطيل ومعالجة الأخطاء.
    - `src/public/js/production-yards.js`: إدارة الساحات عبر Native Fetch وتأكيد الحذف والتعطيل ومعالجة الأخطاء.
- **إدارة الصلاحيات وقواعد الوصول للمستخدمين (Direct User Permission & Access Rule Administration)** (`src/modules/system/user/`, `src/modules/system/authorization/access-administration/`):
  - خدمة الصلاحيات المباشرة للمستخدم `UserPermissionService` (`src/modules/system/user/user-permission.service.ts`):
    - `getUserPermissionsState`: استرجاع قائمة الصلاحيات النشطة مع تفصيل الصلاحيات الموروثة من الدور، والصلاحيات المباشرة للمستخدم، والنتيجة الفعالة لكل صلاحية دون N+1.
    - `setUserPermissionState`: تفعيل أو تعطيل منحة الصلاحية المباشرة للمستخدم داخل TypeORM Transaction مع قفل تشاؤمي (`pessimistic_write`) على سجل المستخدم، وحظر إدارة الصلاحيات الذاتية (`CANNOT_MANAGE_OWN_PERMISSIONS`).
    - `getUserPermissionAccessRules`: استرجاع قواعد الوصول المباشرة للمستخدم مع قواعد الدور الأساسي وقدرات الصلاحية المسموحة (`capabilities`).
    - `createUserAccessRule`: إنشاء قاعدة وصول مباشرة جديدة للمستخدم مع التحقق من مطابقة القالب لقدرات الصلاحية، والتحقق من صحة المعرفات المحددة في قاعدة البيانات، وفرض قفل تشاؤمي على سجل المستخدم.
    - `updateUserAccessRule`: تعديل قاعدة وصول مباشرة للمستخدم مع التحقق من التبعية وقفل سجل المستخدم تشاؤمياً.
    - `deleteUserAccessRule`: تعطيل قاعدة وصول مباشرة للمستخدم (`isActive = false`) دون حذف السجل.
  - واجهات برمجة التطبيقات (API Endpoints):
    - `GET /api/system/users/:id/permissions` (محمي بـ `USER_VIEW` و UUID).
    - `PUT /api/system/users/:id/permissions/:permissionId/state` (محمي بـ `USER_PERMISSION_MANAGE`, UUIDs, و `SetPermissionStateDto`).
    - `GET /api/system/users/:id/permissions/:permissionId/access-rules` (محمي بـ `USER_VIEW` و UUIDs).
    - `POST /api/system/users/:id/permissions/:permissionId/access-rules` (محمي بـ `USER_PERMISSION_MANAGE`, UUIDs, و `CreateAccessRuleDto`).
    - `PUT /api/system/users/:id/permissions/:permissionId/access-rules/:ruleId` (محمي بـ `USER_PERMISSION_MANAGE`, UUIDs, و `UpdateAccessRuleDto`).
    - `DELETE /api/system/users/:id/permissions/:permissionId/access-rules/:ruleId` (محمي بـ `USER_PERMISSION_MANAGE` و UUIDs).
    - `GET /api/system/users/lookups/departments` (محمي بـ `USER_PERMISSION_MANAGE` و `ListProductionDepartmentAdminLookupQueryDto`).
    - `GET /api/system/users/lookups/yards` (محمي بـ `USER_PERMISSION_MANAGE` و `ListProductionYardAdminLookupQueryDto`).
  - واجهات الويب المعروضة من الخادم (Server-rendered EJS):
    - `GET /system/users/:id/permissions`: واجهة إدارة الصلاحيات وقواعد الوصول المباشرة للمستخدم مجمعة حسب التطبيق والمورد، مع فصل واضح بين الصلاحيات الموروثة من الدور والصلاحيات المباشرة والنتيجة الفعالة، ودرج جانبي تفاعلي متجاوب (Offcanvas) لإدارة القواعد، وقفل الواجهة كـ Read-only للمستخدم على حسابه الشخصي.
  - تفاعل العميل (Client Scripts):
    - `src/public/js/user-permissions.js`: استخدام Native Fetch لتبديل حالة التفعيل وإدارة قواعد الوصول والبحث عن الأقسام والساحات، وحماية تامة ضد DOM XSS بالاعتماد الحصري على Native DOM APIs و `textContent`.
- **إدارة الأدوار وصلاحيات وقواعد الوصول (Role Management & Permission/Access Rule Administration)** (`src/modules/system/role/`, `src/modules/system/permission/`, `src/modules/system/authorization/access-administration/`):
  - خدمة الأدوار المركزية `RoleService` (`src/modules/system/role/role.service.ts`):
    - `listRoles`: استرجاع قائمة الأدوار مع Pagination، والبحث بالاسم أو الرمز التقني، وحساب عدد المستخدمين غير المحذوفين المرتبطين بكل دور (`userCount`) بكفاءة دون N+1، واستبعاد السجلات المحذوفة ناعماً.
    - `getRoleById`: استرجاع تفاصيل دور محدد مع حساب `userCount` ورمي `NotFoundError` إذا لم يوجد أو كان محذوفاً ناعماً.
    - `createRole`: إنشاء دور جديد بعد تنظيف وتوحيد الرمز التقني بالأحرف الإنجليزية الكبيرة (`code.trim().toUpperCase()`)، والتحقق المسبق من عدم وجود الرمز مسبقاً (مع فحص السجلات المحذوفة ناعماً `withDeleted()`)، والتقاط أخطاء الـ Race Condition في قاعدة البيانات (`ER_DUP_ENTRY` / 1062) وتحويلها إلى `ConflictError` برمز `ROLE_CODE_ALREADY_EXISTS`.
    - `updateRole`: تحديث بيانات الدور (الاسم، الوصف، حالة التفعيل) داخل Transaction مع فرض قفل تشاؤمي (`pessimistic_write`) على سجل الدور (`Role row`)، وثبات الرمز التقني وعدم السماح بتعديله نهائياً، والتعامل الآمن مع الوصف (`undefined` لا يغير، `null` يمسح، `string` يقص والمسافات تصبح `null`)، وتطبيق حظر تعطيل دور مدير النظام (`SYSTEM_ADMIN`)، ومنع تعطيل أي دور مرتبط بمستخدمين حاليين غير محذوفين (`ROLE_HAS_ASSIGNED_USERS`).
    - `softDeleteRole`: أرشفة الدور (Soft Delete) عبر `deletedAt` وضبط `isActive = false` داخل Transaction مع فرض قفل تشاؤمي (`pessimistic_write`) على سجل الدور لمنع أي تزامن مع إسناد مستخدمين جدد، وتطبيق حظر أرشفة دور مدير النظام (`SYSTEM_ADMIN`)، ومنع أرشفة أو حذف أي دور مرتبط بمستخدمين حاليين غير محذوفين (`ROLE_HAS_ASSIGNED_USERS`). منع الحذف الصلب (Hard Delete) نهائياً والاحتفاظ بسجلات المنح وقواعد الوصول دون حذف.
    - `findAssignableRoleForUpdate`: دالة مركزية لقفل والتحقق من صلاحية ونشاط الدور (`pessimistic_write`, `isActive = true`, `deletedAt IS NULL`) لاستخدامها أثناء إسناد الأدوار للمستخدمين.
    - `countAssignedUsers`: حساب عدد المستخدمين الفعليين غير المحذوفين ناعماً (`deletedAt IS NULL`) المرتبطين بالدور.
    - `findActiveRoleById` و `listActiveRoles`: دوال مساعدة لاسترجاع الأدوار النشطة الصالحة للاختيار عند إنشاء أو تعديل المستخدمين.
  - خدمة صلاحيات الأدوار `RolePermissionService` (`src/modules/system/role/role-permission.service.ts`):
    - `getRolePermissionsState`: استرجاع قائمة جميع الصلاحيات النشطة في النظام مع حالة المنحة وقواعد الوصول وملخص الوصول للدور دون N+1.
    - `setRolePermissionState`: تفعيل أو تعطيل منحة الصلاحية للدور داخل TypeORM Transaction مع قفل تشاؤمي (`pessimistic_write`) على سجل الدور، وحظر تعديل صلاحيات دور مدير النظام (`SYSTEM_ADMIN_PERMISSIONS_MANAGED_BY_SYSTEM`).
    - `getRolePermissionAccessRules`: استرجاع قواعد الوصول المسجلة للدور مع القدرات المسموحة للصلاحية (`capabilities`).
    - `createRoleAccessRule`: إنشاء قاعدة وصول جديدة للدور مع التحقق من مطابقة القالب للقدرات المسموحة والتحقق من المعرفات المحددة وقفل سجل الدور تشاؤمياً.
    - `updateRoleAccessRule`: تعديل قاعدة وصول للدور مع التحقق من التبعية وقفل سجل الدور تشاؤمياً.
    - `deleteRoleAccessRule`: تعطيل قاعدة وصول للدور (`isActive = false`) دون حذف السجل.
  - خدمة استعلام الصلاحيات `PermissionService` (`src/modules/system/permission/permission.service.ts`):
    - `listActivePermissions`: استرجاع الصلاحيات النشطة غير المحذوفة ناعماً كمرجع للنظام دون بناء CRUD للصلاحيات.
  - واجهات برمجة التطبيقات (API Endpoints) المحمية بالصلاحيات:
    - `GET /api/system/roles` (محمي بـ `ROLE_VIEW` و `ListRolesQueryDto`).
    - `GET /api/system/roles/:id` (محمي بـ `ROLE_VIEW` و UUID).
    - `POST /api/system/roles` (محمي بـ `ROLE_CREATE` و `CreateRoleDto`).
    - `PATCH /api/system/roles/:id` (محمي بـ `ROLE_UPDATE` و UUID و `UpdateRoleDto` مع وسيط `validateRoleUpdatePayload` لرفض الـ PATCH الفارغ).
    - `DELETE /api/system/roles/:id` (محمي بـ `ROLE_DELETE` و UUID).
    - `GET /api/system/roles/:id/permissions` (محمي بـ `ROLE_VIEW` و UUID).
    - `PUT /api/system/roles/:id/permissions/:permissionId/state` (محمي بـ `ROLE_PERMISSION_MANAGE`, UUIDs, و `SetPermissionStateDto`).
    - `GET /api/system/roles/:id/permissions/:permissionId/access-rules` (محمي بـ `ROLE_VIEW` و UUIDs).
    - `POST /api/system/roles/:id/permissions/:permissionId/access-rules` (محمي بـ `ROLE_PERMISSION_MANAGE`, UUIDs, و `CreateAccessRuleDto`).
    - `PUT /api/system/roles/:id/permissions/:permissionId/access-rules/:ruleId` (محمي بـ `ROLE_PERMISSION_MANAGE`, UUIDs, و `UpdateAccessRuleDto`).
    - `DELETE /api/system/roles/:id/permissions/:permissionId/access-rules/:ruleId` (محمي بـ `ROLE_PERMISSION_MANAGE` و UUIDs).
    - `GET /api/system/roles/lookups/departments` (محمي بـ `ROLE_PERMISSION_MANAGE` و `ListProductionDepartmentAdminLookupQueryDto`).
    - `GET /api/system/roles/lookups/yards` (محمي بـ `ROLE_PERMISSION_MANAGE` و `ListProductionYardAdminLookupQueryDto`).
  - واجهات الويب المعروضة من الخادم (Server-rendered EJS):
    - `GET /system/roles`: جدول الأدوار مع عدد المستخدمين المرتبطين، شارات الحالة، والإجراءات المشروطة بحالة الاستخدام وصلاحيات المستخدم.
    - `GET /system/roles/create`: نموذج إنشاء دور جديد مع كلاسات `needs-validation` والتحقق بالمتصفح وبواسطة Bootstrap وتوجيهات الرمز التقني.
    - `GET /system/roles/:id/edit`: نموذج تعديل الدور مع كلاسات `needs-validation` وقفل الرمز التقني كـ Read-only وقفل التعطيل لـ `SYSTEM_ADMIN`.
    - `GET /system/roles/:id/permissions`: واجهة إدارة الصلاحيات وقواعد الوصول للأدوار مجمعة حسب التطبيق والمورد، مع شارات الحالة وقفل التعديل لدور مدير النظام، ودرج جانبي تفاعلي متجاوب لإدارة قواعد الوصول (تدير تفعيل المنح، وتعدد القواعد ALLOW/DENY، والنطاق الشامل ALL، والنطاقات التشغيلية والمحددة للأقسام والساحات وفق Registry).
  - تفاعل العميل (Client Scripts):
    - `src/public/js/roles.js`: استخدام Native Fetch لعمليات الإنشاء، التعديل، تبديل الحالة، الأرشفة، وإدارة قواعد الوصول، وحماية تامة ضد DOM XSS بالاعتماد الحصري على Native DOM APIs و `textContent`.
- **إدارة المستخدمين الأساسية (User Management Core)** (`src/modules/system/user/`):
  - خدمة المستخدمين المركزية `UserService` (`src/modules/system/user/user.service.ts`):
    - `listUsers`: استرجاع قائمة المستخدمين مع Pagination، والبحث بالاسم أو رقم الهاتف، وضم الدور (Role) بكفاءة بدون N+1، واستبعاد المحذوفين ناعماً.
    - `getUserById`: استرجاع تفاصيل مستخدم محدد مع دوره واستبعاد `passwordHash`.
    - `createUser`: إنشاء مستخدم جديد داخل Transaction متزامنة مع قفل تشاؤمي (`pessimistic_write`) على سجل الدور المستهدف عبر `findAssignableRoleForUpdate` (وتشفير كلمة المرور مسبقاً قبل فتح الـ Transaction)، والتحقق المسبق من فرادية رقم الهاتف (حتى مع المحذوفين ناعماً)، والتقاط أخطاء الـ Race Condition في قاعدة البيانات (`ER_DUP_ENTRY` / 1062) وتحويلها إلى `ConflictError` برمز `USER_PHONE_ALREADY_EXISTS`، وإرجاع كائن مستخدم آمن.
    - `updateUser`: تحديث جزئي (PATCH) لبيانات المستخدم داخل Transaction مع فرض قفل تشاؤمي للكتابة (`pessimistic_write`) على سجل المستخدم المستهدف (`User row`)، وتطبيق حماية الذات، وحماية آخر مدير نظام فعال بالقفل التشاؤمي، وقفل تشاؤمي (`pessimistic_write`) على الدور الجديد المستهدف عند تغيير الدور، والتحقق من فرادية الهاتف مع التقاط خطأ 409، وإلغاء الجلسات النشطة تلقائياً عند التعطيل.
    - `softDeleteUser`: أرشفة المستخدم (Soft Delete) عبر `deletedAt` وتعطيله مع إلغاء كافة جلساته النشطة داخل Transaction مع فرض قفل تشاؤمي للكتابة (`pessimistic_write`) على سجل المستخدم المستهدف (`User row`) وتطبيق حظر حذف الذات وحظر حذف آخر مدير نظام فعال بالقفل التشاؤمي. منع الحذف الصلب (Hard Delete) نهائياً.
  - واجهات برمجة التطبيقات (API Endpoints) المحمية بالصلاحيات:
    - `GET /api/system/users` (محمي بـ `USER_VIEW` والتحقق من الـ Query DTO وتخزين النتيجة في `req.validatedQuery` دون تعديل `req.query`).
    - `GET /api/system/users/:id` (محمي بـ `USER_VIEW` والتحقق من UUID).
    - `POST /api/system/users` (محمي بـ `USER_CREATE` و `CreateUserDto` مع Trim للمدخلات النصية).
    - `PATCH /api/system/users/:id` (محمي بـ `USER_UPDATE` و UUID و `UpdateUserDto` مع وسيط `validateUserUpdatePayload` لرفض الـ PATCH الفارغ).
    - `DELETE /api/system/users/:id` (محمي بـ `USER_DELETE` و UUID).
  - واجهات الويب المعروضة من الخادم (Server-rendered EJS):
    - `GET /system/users`: قائمة المستخدمين مع جدول متجاوب، بحث، ترقيم صفحات، زر الصلاحيات، وشارات الحالة وإجراءات سريعة باستخدام `data-*` attributes دون أي inline JavaScript string interpolation لمنع Stored XSS.
    - `GET /system/users/create`: نموذج إنشاء مستخدم مع التحقق بالمتصفح وبواسطة Bootstrap.
    - `GET /system/users/:id/edit`: نموذج تعديل المستخدم مع قفل الحقول الحساسة عند تعديل الحساب الشخصي.
  - تفاعل العميل (Client Scripts):
    - `src/public/js/users.js`: استخدام Native Fetch لجميع عمليات الإنشاء والتعديل والأرشفة، واستخدام Event Delegation على مستوى المستند، وتأكيد الحذف عبر SweetAlert2، ومعالجة رسائل الأخطاء والـ Validation Arrays وعرضها بشكل مفهوم للمستخدم، وحظر استخدام HTMX.
- **محرك الصلاحيات (Authorization Core - Phase 1)** (`src/modules/system/authorization/`):
  - خدمة الصلاحيات المركزية `AuthorizationService` (`src/modules/system/authorization/authorization.service.ts`) المسؤولة عن تقييم وصول المستخدمين عبر `hasPermission` واسترجاع قائمة الصلاحيات الفعالة الشاملة عبر `getEffectivePermissions`.
  - وسيط التحقق من الصلاحيات `requirePermission` (`src/modules/system/authorization/authorization.middleware.ts`) الذي يتحقق من هوية المستخدم الموثق ويمرر `ForbiddenError` برمز `PERMISSION_DENIED` عند عدم امتلاك الصلاحية.
  - دمج وتقييم منح الدور الأساسي للمستخدم (`Role Grants`) مع المنح المباشرة للمستخدم (`Direct User Grants`) في استعلام واحد محكم بدون N+1.
  - استبعاد المنح غير النشطة أو المنتهية زمنياً (`expires_at <= now`) والمنح التابعة لصلاحيات معطلة أو محذوفة ناعماً.
  - تطبيق قاعدة التفوق للرفض (`DENY ALL` wins) والانغلاق التلقائي (Default Deny / Fail Closed).
  - عدم وجود أي تجاوز برمجي صلب لدور مدير النظام (`No SYSTEM_ADMIN hardcoded bypass`)؛ بل يخضع لتقييم المنح والقواعد المسندة إليه في الـ Seed كأي مستخدم آخر.
  - خدمة الصلاحيات الشاملة `AuthorizationService` تقيّم الوصول الشامل (Global Access) حصراً عبر قواعد `ALL` الصالحة (`scopeType = 'ALL'` و `scope = null`)، ولا تمنح النطاقات المكانية والفرعية غير الشاملة (مثل `PRODUCTION_DEPARTMENT`, `PRODUCTION_YARD`) وصولاً شاملاً؛ بينما تتولى محركات السياسات الخاصة بالموارد مثل `ProductionAccessPolicyService` تفسير النطاقات الديناميكية والمحددة وتطبيقها على مستوى الصفوف.
  - قرار معماري: لا يتم فحص `role.isActive` داخل `AuthorizationService` لأن بروتوكول قفل الأدوار وقواعد الأعمال تمنع تماماً إنشاء أو بقاء أي مستخدم غير محذوف مرتبط بدور معطل أو محذوف ناعماً (In-use Role Protection & Concurrency Invariant).
- **وحدة المصادقة (Auth Module)** (`src/modules/system/auth/`) تشمل مسارات التحقق وتسجيل الدخول `POST /api/auth/login`، واسترجاع هوية المستخدم الموثق `GET /api/auth/me`، وتسجيل الخروج وإلغاء الجلسة `POST /api/auth/logout`.
- **خدمة الجلسات (SessionService)** (`src/modules/system/session/session.service.ts`) مسؤولة عن إنشاء الجلسات، والتحقق من صحتها وتطابق الهاش، والتحديث المؤجل لآخر استخدام (Throttled `touchSession`)، وإلغاء الجلسات الفردية (`revokeSession`)، وإلغاء كافة جلسات المستخدم عند التعطيل أو الأرشفة (`revokeUserSessions`).
- **أمان التوكن والجلسة (JWT & Session Security)**:
  - التوكن موقّع حصراً بخوارزمية `HS256` (توقيع وليس تشفيراً)، ولذلك لا يحتوي الـ Payload على أي بيانات حساسة أو صلاحيات، ويقتصر فقط على: `sub: userId` و `sid: sessionId` مع تحديد `issuer: 'erp-inshaat'` و `audience: 'erp-users'`.
  - الـ JWT الخام لا يُخزن في قاعدة البيانات مطلقاً، بل يُخزن فقط الهاش الناتج عن SHA-256 بطول 64 محرفاً داخل حقل `system_session.token_hash`.
  - الـ JWT لا يُرسل في استجابات الـ JSON ولا يُخزن في `localStorage` أو `sessionStorage`، بل يُدار حصراً عبر كوكيز `HttpOnly` باسم `erp_session` بخصائص `SameSite: Lax`, `Path: /`, `Secure: isProduction`.
  - متغير البيئة `AUTH_JWT_SECRET` إلزامي ويشترط ألا يقل طوله عن 32 محرفاً بدون أي قيمة افتراضية في الكود المصدري.
  - مدة الجلسة موحدة عبر `AUTH_SESSION_TTL_DAYS` (افتراضياً 30 يوماً) لكل من انتهاء JWT، وانتهاء سجل الجلسة، وانتهاء الكوكيز.
- **استراتيجية Passport JWT** (`src/modules/system/auth/passport-jwt.strategy.ts`):
  - قراءة التوكن من كوكيز `erp_session` بواسطة Custom Cookie Extractor.
  - التحقق من توقيع الـ JWT بخوارزمية `HS256` الصريحة، ثم التحقق من وجود الجلسة في `system_session` ومطابقة الهاش والفعالية `is_active = true` وعدم الإلغاء وعدم الانتهاء الزمني، ثم التحقق من وجود المستخدم وفعاليته وعدم حذفه ناعماً.
  - تمرير هوية المستخدم الآمنة كـ `AuthPrincipal` (`id`, `fullName`, `phone`, `roleId`, `roleCode`, `sessionId`) داخل سياق الطلب `req.user`.
- **حماية المسارات (Route Protection)**:
  - صفحات الويب الإدارية (`GET /`, `GET /system`, `GET /system/users/*`, `GET /system/roles/*`) محمية بوسيط `requireWebAuth` مع التوجيه التلقائي للمستخدمين غير المسجلين إلى `/login`، وتمرير أي أخطاء نظام إلى المعالج المركزي، وتعيين `res.locals.user` وإلغاء التخزين المؤقت `Cache-Control: no-store`.
  - صفحة تسجيل الدخول `GET /login` تستخدم وسيط `redirectIfAuthenticated` لإعادة توجيه المسجلين مسبقاً إلى `/`.
  - مسارات الـ API المحمية تستخدم `requireApiAuth` وتعيد خطأ 401 بصيغة JSON المعيارية.
  - نقطة الفحص الصحي `GET /api/health` والملفات الثابتة تبقى عامة (Public).

---

## Project Structure

```text
src/
├── bootstrap/
│   ├── database.bootstrap.ts
│   └── passport.bootstrap.ts
├── common/
│   ├── errors/
│   │   ├── app.error.ts
│   │   ├── business-rule.error.ts
│   │   ├── conflict.error.ts
│   │   ├── forbidden.error.ts
│   │   ├── not-found.error.ts
│   │   ├── unauthorized.error.ts
│   │   └── validation.error.ts
│   ├── logging/
│   │   └── logger.ts
│   ├── middleware/
│   │   ├── error-handler.middleware.ts
│   │   ├── not-found.middleware.ts
│   │   ├── validate-dto.middleware.ts
│   │   ├── validate-query-dto.middleware.ts
│   │   └── validate-uuid-param.middleware.ts
│   ├── responses/
│   │   └── api-response.ts
│   ├── security/
│   │   ├── password.util.ts
│   │   └── token-hash.util.ts
│   └── types/
│       └── express.d.ts
├── config/
│   ├── database.config.ts
│   ├── env.config.ts
│   └── multer.config.ts
├── database/
│   ├── migrations/
│   │   ├── 1710000000000-CreateSystemCoreTables.ts
│   │   ├── 1710000000001-CreateSystemSessionTable.ts
│   │   ├── 1710000000002-CreateProductionDepartmentsAndYards.ts
│   │   ├── 1710000000003-CreateProductionTeamAssignments.ts
│   │   ├── 1710000000004-CreateInventoryCategories.ts
│   │   ├── 1710000000005-CreateInventoryProductsAndUnits.ts
│   │   └── 1710000000006-HardenInventoryCatalogConstraints.ts
│   ├── seeds/
│   │   └── system-initial.seed.ts
│   └── data-source.ts
├── modules/
│   ├── production/
│   │   ├── authorization/
│   │   │   ├── production-access-policy.service.ts
│   │   │   ├── production-access-policy.types.ts
│   │   │   ├── production-access-query.helper.ts
│   │   │   ├── production-access-scope.constants.ts
│   │   │   ├── production-authorization-context.ts
│   │   │   ├── production-authorization.middleware.ts
│   │   │   └── production-responsibility.resolver.ts
│   │   ├── department/
│   │   │   ├── dto/
│   │   │   │   ├── create-production-department.dto.ts
│   │   │   │   ├── list-production-departments-query.dto.ts
│   │   │   │   └── update-production-department.dto.ts
│   │   │   ├── production-department.controller.ts
│   │   │   ├── production-department.entity.ts
│   │   │   ├── production-department.middleware.ts
│   │   │   ├── production-department.route.ts
│   │   │   ├── production-department.service.ts
│   │   │   ├── production-department.types.ts
│   │   │   └── production-department.web.controller.ts
│   │   ├── team/
│   │   │   ├── dto/
│   │   │   │   ├── create-production-engineer-assignment.dto.ts
│   │   │   │   ├── set-production-department-head.dto.ts
│   │   │   │   └── update-production-engineer-yards.dto.ts
│   │   │   ├── entities/
│   │   │   │   ├── production-department-engineer.entity.ts
│   │   │   │   └── production-yard-engineer.entity.ts
│   │   │   ├── production-team.controller.ts
│   │   │   ├── production-team.route.ts
│   │   │   ├── production-team.service.ts
│   │   │   ├── production-team.types.ts
│   │   │   └── production-team.web.controller.ts
│   │   └── yard/
│   │       ├── dto/
│   │       │   ├── create-production-yard.dto.ts
│   │       │   ├── list-production-yards-query.dto.ts
│   │       │   └── update-production-yard.dto.ts
│   │       ├── production-yard.controller.ts
│   │       ├── production-yard.entity.ts
│   │       ├── production-yard.middleware.ts
│   │       ├── production-yard.route.ts
│   │       ├── production-yard.service.ts
│   │       ├── production-yard.types.ts
│   │       └── production-yard.web.controller.ts
│   └── system/
│       ├── access-rule/
│       │   ├── dto/
│       │   │   ├── create-access-rule.dto.ts
│       │   │   └── update-access-rule.dto.ts
│       │   ├── seeds/
│       │   │   └── system-admin-access-rules.seed.ts
│       │   └── access-rule.entity.ts
│       ├── auth/
│       │   ├── dto/
│       │   │   └── login.dto.ts
│       │   ├── auth.constants.ts
│       │   ├── auth.controller.ts
│       │   ├── auth.middleware.ts
│       │   ├── auth.route.ts
│       │   ├── auth.service.ts
│       │   ├── auth.types.ts
│       │   └── passport-jwt.strategy.ts
│       ├── authorization/
│       │   ├── access-administration/
│       │   │   ├── access-rule-administration.service.ts
│       │   │   ├── access-rule-administration.types.ts
│       │   │   ├── access-scope-capability.registry.ts
│       │   │   └── access-scope-preset.constants.ts
│       │   ├── authorization.middleware.ts
│       │   ├── authorization.service.ts
│       │   └── authorization.types.ts
│       ├── permission/
│       │   ├── constants/
│       │   │   └── system-permission.enum.ts
│       │   ├── seeds/
│       │   │   └── system-user-permissions.seed.ts
│       │   ├── permission.entity.ts
│       │   └── permission.service.ts
│       ├── permission-grant/
│       │   ├── dto/
│       │   │   └── set-permission-state.dto.ts
│       │   ├── seeds/
│       │   │   └── system-admin-permission-grants.seed.ts
│       │   └── permission-grant.entity.ts
│       ├── role/
│       │   ├── constants/
│       │   │   └── system-role.enum.ts
│       │   ├── dto/
│       │   │   ├── create-role.dto.ts
│       │   │   ├── list-roles-query.dto.ts
│       │   │   └── update-role.dto.ts
│       │   ├── seeds/
│       │   │   └── system-admin-role.seed.ts
│       │   ├── role.controller.ts
│       │   ├── role.entity.ts
│       │   ├── role.middleware.ts
│       │   ├── role.route.ts
│       │   ├── role.service.ts
│       │   ├── role.types.ts
│       │   ├── role.web.controller.ts
│       │   └── role-permission.service.ts
│       ├── session/
│       │   ├── session.entity.ts
│       │   └── session.service.ts
│       └── user/
│           ├── dto/
│           │   ├── create-user.dto.ts
│           │   ├── list-users-query.dto.ts
│           │   └── update-user.dto.ts
│           ├── seeds/
│           │   └── system-admin-user.seed.ts
│           ├── user.controller.ts
│           ├── user.entity.ts
│           ├── user.middleware.ts
│           ├── user.route.ts
│           ├── user.service.ts
│           ├── user.types.ts
│           ├── user.web.controller.ts
│           └── user-permission.service.ts
├── public/
│   ├── css/
│   │   ├── app.css
│   │   └── auth.css
│   └── js/
│       ├── app.js
│       ├── login.js
│       ├── production-departments.js
│       ├── production-team.js
│       ├── production-yards.js
│       ├── roles.js
│       ├── user-permissions.js
│       └── users.js
├── routes/
│   ├── api.route.ts
│   ├── index.ts
│   └── web.route.ts
├── views/
│   ├── dashboard/
│   │   ├── partials/
│   │   │   ├── footer.ejs
│   │   │   ├── head.ejs
│   │   │   ├── navbar.ejs
│   │   │   └── scripts.ejs
│   │   ├── production/
│   │   │   ├── departments/
│   │   │   │   ├── create.ejs
│   │   │   │   ├── edit.ejs
│   │   │   │   └── index.ejs
│   │   │   ├── partials/
│   │   │   │   └── sidebar.ejs
│   │   │   ├── team/
│   │   │   │   ├── create-engineer.ejs
│   │   │   │   ├── edit-engineer.ejs
│   │   │   │   └── index.ejs
│   │   │   ├── yards/
│   │   │   │   ├── create.ejs
│   │   │   │   ├── edit.ejs
│   │   │   │   └── index.ejs
│   │   │   ├── index.ejs
│   │   │   └── layout.ejs
│   │   ├── system/
│   │   │   ├── partials/
│   │   │   │   └── sidebar.ejs
│   │   │   ├── roles/
│   │   │   │   ├── create.ejs
│   │   │   │   ├── edit.ejs
│   │   │   │   └── index.ejs
│   │   │   │   └── permissions.ejs
│   │   │   ├── users/
│   │   │   │   ├── create.ejs
│   │   │   │   ├── edit.ejs
│   │   │   │   └── index.ejs
│   │   │   │   └── permissions.ejs
│   │   │   ├── index.ejs
│   │   │   └── layout.ejs
│   │   ├── index.ejs
│   │   └── layout.ejs
│   ├── error.ejs
│   └── login.ejs
├── app.ts
└── server.ts
```

---

## Constants & Enums

### `SystemRole`
- **File**: `src/modules/system/role/constants/system-role.enum.ts`
- **Purpose**: المصدر الثابت لتعريف كودات أدوار النظام.
- **Values**:
  - `SYSTEM_ADMIN = 'SYSTEM_ADMIN'` (مدير النظام)

### `SystemPermission`
- **File**: `src/modules/system/permission/constants/system-permission.enum.ts`
- **Purpose**: المصدر الثابت والوحيد (Single Source of Truth) لكودات صلاحيات النظام.
- **Values**:
  - `USER_VIEW = 'system.user.view'` (عرض المستخدمين)
  - `USER_CREATE = 'system.user.create'` (إنشاء مستخدم)
  - `USER_UPDATE = 'system.user.update'` (تعديل بيانات المستخدم)
  - `USER_DELETE = 'system.user.delete'` (حذف المستخدم)
  - `USER_PERMISSION_MANAGE = 'system.user.permission.manage'` (إدارة وإسناد صلاحيات المستخدم المباشرة)
  - `ROLE_VIEW = 'system.role.view'` (عرض الأدوار والصلاحيات)
  - `ROLE_CREATE = 'system.role.create'` (إنشاء دور جديد)
  - `ROLE_UPDATE = 'system.role.update'` (تعديل بيانات الدور)
  - `ROLE_DELETE = 'system.role.delete'` (أرشفة / حذف الدور)
  - `ROLE_PERMISSION_MANAGE = 'system.role.permission.manage'` (إدارة وإسناد صلاحيات الدور)
  - `PRODUCTION_DEPARTMENT_VIEW = 'production.department.view'` (عرض أقسام الإنتاج)
  - `PRODUCTION_DEPARTMENT_CREATE = 'production.department.create'` (إنشاء قسم إنتاج)
  - `PRODUCTION_DEPARTMENT_UPDATE = 'production.department.update'` (تعديل بيانات قسم الإنتاج)
  - `PRODUCTION_DEPARTMENT_DELETE = 'production.department.delete'` (أرشفة / حذف قسم الإنتاج)
  - `PRODUCTION_YARD_VIEW = 'production.yard.view'` (عرض ساحات الإنتاج)
  - `PRODUCTION_YARD_CREATE = 'production.yard.create'` (إنشاء ساحة إنتاج)
  - `PRODUCTION_YARD_UPDATE = 'production.yard.update'` (تعديل بيانات ساحة الإنتاج)
  - `PRODUCTION_YARD_DELETE = 'production.yard.delete'` (أرشفة / حذف ساحة الإنتاج)
  - `PRODUCTION_ASSIGNMENT_VIEW = 'production.assignment.view'` (عرض تعيينات فرق الإنتاج)
  - `PRODUCTION_ASSIGNMENT_MANAGE = 'production.assignment.manage'` (إدارة رؤساء الأقسام والمهندسين وساحات مسؤوليتهم)

### `AuthConstants`
- **File**: `src/modules/system/auth/auth.constants.ts`
- **Purpose**: الثوابت الخاصة بالمصادقة والكوكيز.
- **Values**:
  - `AUTH_COOKIE_NAME = 'erp_session'`
  - `AUTH_JWT_ISSUER = 'erp-inshaat'`
  - `AUTH_JWT_AUDIENCE = 'erp-users'`

---

## Production Infrastructure (Departments, Yards & Teams)

### `ProductionDepartmentService` (`src/modules/production/department/production-department.service.ts`)
- **Purpose**: تنفيذ منطق الأعمال، والتحقق من فرادة الرمز التقني، وتعيين رئيس القسم الإلزامي، وحماية الأقسام التي تمتلك ساحات أو مهندسين، وإدارة دورة حياة أقسام الإنتاج التشغيلية مع قفل تشاؤمي موحد لمنع التزامن غير المتسق، وإنفاذ سياسة الوصول على مستوى QueryBuilder والعمليات التعديلية.
- **Methods**:
  - `listDepartments(query: ListProductionDepartmentsQueryDto, policy: ResolvedProductionAccessPolicy): Promise<PaginatedProductionDepartmentsResult>`
    - **Input**: `query` (`page`, `limit`, `search`), `policy` (`ResolvedProductionAccessPolicy`).
    - **Action**: استعلام مقسم لصفحات مع تطبيق `applyDepartmentAccessScope` على `QueryBuilder` قبل الـ Pagination والـ Counting، البحث بالاسم أو الرمز، تجميع وحساب عدد الساحات الإجمالي (`yardCount`) والساحات النشطة (`activeYardCount`) واسترجاع اسم رئيس القسم (`headUserName`) لكل قسم مسموح، استبعاد الأقسام المحذوفة ناعماً، وترتيب النتائج تصاعدياً.
    - **Output**: `{ items: SafeProductionDepartmentOutput[], total, page, limit, totalPages }`.
  - `getDepartmentById(id: string, policy: ResolvedProductionAccessPolicy): Promise<SafeProductionDepartmentOutput>`
    - **Input**: `id` (UUID), `policy`.
    - **Action**: استرجاع قسم الإنتاج غير المحذوف ناعماً مع تطبيق `applyDepartmentAccessScope` ورمي `NotFoundError` برمز `PRODUCTION_DEPARTMENT_NOT_FOUND` إذا لم يوجد أو كان خارج نطاق وصول المستخدم لمنع تسريب وجود السجل.
    - **Output**: `SafeProductionDepartmentOutput`.
  - `createDepartment(dto: CreateProductionDepartmentDto): Promise<SafeProductionDepartmentOutput>`
    - **Input**: `CreateProductionDepartmentDto` (`name`, `code`, `headUserId`, `description`, `isActive`).
    - **Action**: صلاحية عامة شاملة (`PRODUCTION_DEPARTMENT_CREATE`) لإنشاء قسم جديد مع قفل سجل المستخدم المرشح للرئاسة أولاً ثم حفظ القسم.
    - **Output**: `SafeProductionDepartmentOutput`.
  - `updateDepartment(id: string, dto: UpdateProductionDepartmentDto, policy: ResolvedProductionAccessPolicy): Promise<SafeProductionDepartmentOutput>`
    - **Input**: `id`, `dto`, `policy`.
    - **Action**: بدء Transaction، قفل سجل القسم بـ `pessimistic_write`، التحقق من نطاق الوصول `canAccessDepartment(policy, department.id)` ورمي 404 في حال عدم الصلاحية، ثم تطبيق قواعد التحقق وحفظ التعديلات.
    - **Output**: `SafeProductionDepartmentOutput`.
  - `softDeleteDepartment(id: string, policy: ResolvedProductionAccessPolicy): Promise<{ success: boolean; message: string }>`
    - **Input**: `id`, `policy`.
    - **Action**: بدء Transaction، قفل سجل القسم بـ `pessimistic_write`، التحقق من نطاق الوصول `canAccessDepartment(policy, department.id)`، التحقق من عدم وجود ساحات أو مهندسين، تحرير رئيس القسم، وضبط الأرشفة.
    - **Output**: `{ success: true, message: 'تم أرشفة قسم الإنتاج بنجاح' }`.
  - `listActiveDepartments(): Promise<Array<{ id: string; name: string; code: string }>>`:
    - **Action**: استرجاع جميع أقسام الإنتاج النشطة وغير المحذوفة ناعماً (`isActive = true`, `deletedAt IS NULL`) بدون تطبيق Access Policy. هذه الدالة غير مقيدة بالصلاحيات (Unscoped) وتُستخدم حصراً في السياقات الداخلية التي لا تعتمد على فلترة الصلاحيات.
  - `listActiveDepartmentsForPolicy(policy: ResolvedProductionAccessPolicy): Promise<Array<{ id: string; name: string; code: string }>>`:
    - **Input**: `policy` (`ResolvedProductionAccessPolicy`).
    - **Action**: استرجاع الأقسام النشطة غير المؤرشفة المسموحة ضمن `policy` بتطبيق `applyDepartmentAccessScope` على `QueryBuilder` مباشرة، وتستخدم في القوائم المنسدلة للإنشاء ونقل الساحات.
    - **Output**: `Array<{ id: string; name: string; code: string }>`.

### `ProductionYardService` (`src/modules/production/yard/production-yard.service.ts`)
- **Purpose**: إدارة ساحات الإنتاج التشغيلية، وسعاتها الاستيعابية، وربطها بأقسام الإنتاج، ومنع نقل أو أرشفة الساحات المسندة لمهندسين مع فرض قواعد التسلسل والتزامن عبر بروتوكول القفل الموحد، وإنفاذ سياسة الوصول على مستوى QueryBuilder والعمليات التعديلية.
- **Methods**:
  - `listYards(query: ListProductionYardsQueryDto, policy: ResolvedProductionAccessPolicy): Promise<PaginatedProductionYardsResult>`
    - **Input**: `query` (`page`, `limit`, `search`, `departmentId`), `policy` (`ResolvedProductionAccessPolicy`).
    - **Action**: استعلام مقسم لصفحات مع تطبيق `applyYardAccessScope` على `QueryBuilder` قبل الـ Pagination والـ Counting، والبحث بالاسم أو الرمز، والفلترة الاختيارية بالقسم (Intersection)، واسترجاع الساحات المسموحة فقط.
    - **Output**: `{ items: SafeProductionYardOutput[], total, page, limit, totalPages }`.
  - `listAccessibleDepartmentOptions(policy: ResolvedProductionAccessPolicy): Promise<Array<{ id: string; name: string; code: string }>>`:
    - **Input**: `policy` (`ResolvedProductionAccessPolicy`).
    - **Action**: استخراج خيارات الأقسام المميزة المتاحة لفلتر الساحات من الساحات المسموح للمستخدم رؤيتها فقط عبر تطبيق `applyYardAccessScope` داخل `QueryBuilder` لمنع كشف أسماء أو معرفات أقسام غير مصرح بها.
    - **Output**: `Array<{ id: string; name: string; code: string }>`.
  - `getYardById(id: string, policy: ResolvedProductionAccessPolicy): Promise<SafeProductionYardOutput>`
    - **Input**: `id` (UUID), `policy`.
    - **Action**: استرجاع تفاصيل الساحة مع تطبيق `applyYardAccessScope` ورمي `NotFoundError` برمز `PRODUCTION_YARD_NOT_FOUND` إذا لم توجد أو كانت خارج نطاق الوصول.
    - **Output**: `SafeProductionYardOutput`.
  - `createYard(dto: CreateProductionYardDto, policy: ResolvedProductionAccessPolicy): Promise<SafeProductionYardOutput>`
    - **Input**: `CreateProductionYardDto`, `policy`.
    - **Action**: التحقق من امتلاك المستخدم صلاحية الوصول على مستوى القسم المستهدف `canAccessDepartment(policy, dto.departmentId)` ورمي `ForbiddenError('ACCESS_SCOPE_DENIED')` في حال عدم الصلاحية، ثم فتح Transaction وقفل القسم المستهدف بـ `pessimistic_write` وحفظ الساحة.
    - **Output**: `SafeProductionYardOutput`.
  - `updateYard(id: string, dto: UpdateProductionYardDto, policy: ResolvedProductionAccessPolicy): Promise<SafeProductionYardOutput>`
    - **Input**: `id`, `dto`, `policy`.
    - **Action**:
      1. قراءة استطلاعية مقيدة بالصلاحيات (`Scoped Pre-Read`) خارج الـ Transaction باستخدام `applyYardAccessScope` على `QueryBuilder` لرفض الساحات غير المسموحة أو غير الموجودة فوراً برمز `PRODUCTION_YARD_NOT_FOUND` (404) قبل الدخول إلى Transaction أو حيازة أي أقفال تشاؤمية.
      2. فتح Transaction وقفل الأقسام المعنية تشاؤمياً واحداً تلو الآخر بترتيب تصاعدي حتمي لمعرفاتها (`pessimistic_write`).
      3. قفل سجل الساحة تشاؤمياً (`Yard row` via `pessimistic_write`) وفق بروتوكول القفل الموحد (`Department(s) -> Yard`).
      4. إعادة التحقق من تطابق تبعية الساحة للقسم المقفول (`PRODUCTION_YARD_CONCURRENTLY_CHANGED`).
      5. إعادة التحقق القطعي من صلاحية الوصول للساحة المصدر المقفولة `canAccessYard(policy, yard)` كتحقق نهائي موثوق ضد ثغرات الـ TOCTOU ورمي 404 في حال عدم الصلاحية.
      6. فقط بعد إثبات صلاحية الساحة المصدر، يتم التحقق من وجود ونشاط القسم المستهدف والتحقق من صلاحية الوصول إليه `canAccessDepartment(policy, targetDeptId)` ورمي 403 `ACCESS_SCOPE_DENIED` لمنع تسريب بيانات الأقسام الأخرى.
      7. عند النقل لقسم آخر، التحقق من عدم وجود مهندسين مسندين للساحة (`PRODUCTION_YARD_HAS_ENGINEERS`).
      8. التحقق من فعالية القسم التابع عند إعادة تفعيل الساحة وتطبيق التعديلات وحفظها.
    - **Output**: `SafeProductionYardOutput`.
  - `softDeleteYard(id: string, policy: ResolvedProductionAccessPolicy): Promise<{ success: boolean; message: string }>`
    - **Input**: `id`, `policy`.
    - **Action**:
      1. قراءة استطلاعية مقيدة بالصلاحيات (`Scoped Pre-Read`) خارج الـ Transaction باستخدام `applyYardAccessScope` على `QueryBuilder` ورمي 404 برمز `PRODUCTION_YARD_NOT_FOUND` في حال كانت الساحة خارج النطاق قبل بدء الـ Transaction.
      2. فتح Transaction وقفل القسم التابع تشاؤمياً بـ `pessimistic_write`.
      3. قفل سجل الساحة تشاؤمياً بـ `pessimistic_write` وفق بروتوكول القفل (`Department -> Yard`).
      4. إعادة التحقق من تطابق تبعية الساحة للقسم المقفول.
      5. إعادة التحقق القطعي من صلاحية الوصول للساحة المقفولة `canAccessYard(policy, yard)`.
      6. التحقق من عدم وجود مهندسين مسندين للساحة (`PRODUCTION_YARD_HAS_ENGINEERS`).
      7. ضبط `isActive = false` و `deletedAt = new Date()` وحفظ التعديلات.
    - **Output**: `{ success: true, message: 'تم أرشفة ساحة الإنتاج بنجاح' }`.

### `ProductionTeamService` (`src/modules/production/team/production-team.service.ts`)
- **Purpose**: إدارة فريق عمل ومسؤوليات قسم الإنتاج، بما فيها تعيين رئيس القسم وتوزيع المهندسين وساحات مسؤوليتهم مع الالتزام بترتيب القفل التشاؤمي الموحد وسياسة الوصول على مستوى القسم.
- **Methods**:
  - `getDepartmentTeam(departmentId: string, policy: ResolvedProductionAccessPolicy): Promise<DepartmentTeamOutput>`
    - **Input**: `departmentId`, `policy`.
    - **Action**: التحقق من صلاحية الوصول للقسم `canAccessDepartment(policy, departmentId)` ورمي 404 في حال عدم الصلاحية، ثم استرجاع بيانات القسم ورئيس القسم وقائمة المهندسين النشطين مع ساحاتهم.
    - **Output**: `{ department, head, engineers }`.
  - `listAvailableDepartmentHeadUsers(): Promise<AvailableHeadUserSelectOption[]>`
    - **Action**: استرجاع المستخدمين النشطين غير المحذوفين المؤهلين لرئاسة الأقسام.
    - **Output**: `AvailableHeadUserSelectOption[]`.
  - `listAvailableEngineerUsers(): Promise<AvailableEngineerSelectOption[]>`
    - **Action**: استرجاع المستخدمين النشطين غير المحذوفين المؤهلين للإسناد كمهندسين.
    - **Output**: `AvailableEngineerSelectOption[]`.
  - `setDepartmentHead(departmentId: string, userId: string, policy: ResolvedProductionAccessPolicy): Promise<{ success: boolean; message: string; head: SafeHeadUserOutput }>`
    - **Input**: `departmentId`, `userId`, `policy`.
    - **Action**: فتح Transaction، قفل القسم والتحقق من `canAccessDepartment(policy, department.id)`، ثم قفل المستخدم والتحقق وتعيين رئيس القسم.
    - **Output**: `{ success: true, message, head }`.
  - `addEngineerToDepartment(departmentId: string, dto: CreateProductionEngineerAssignmentDto, policy: ResolvedProductionAccessPolicy): Promise<SafeEngineerAssignmentOutput>`
    - **Input**: `departmentId`, `dto`, `policy`.
    - **Action**: فتح Transaction، قفل القسم والتحقق من `canAccessDepartment(policy, department.id)`، ثم تنفيذ بروتوكول القفل وإسناد المهندس.
    - **Output**: `SafeEngineerAssignmentOutput`.
  - `updateEngineerYards(departmentId: string, assignmentId: string, dto: UpdateProductionEngineerYardsDto, policy: ResolvedProductionAccessPolicy): Promise<SafeEngineerAssignmentOutput>`
    - **Input**: `departmentId`, `assignmentId`, `dto`, `policy`.
    - **Action**: فتح Transaction، قفل القسم والتحقق من `canAccessDepartment(policy, department.id)`، ثم تنفيذ بروتوكول القفل وتحديث ساحات المهندس.
    - **Output**: `SafeEngineerAssignmentOutput`.
  - `removeEngineerFromDepartment(departmentId: string, assignmentId: string, policy: ResolvedProductionAccessPolicy): Promise<{ success: boolean; message: string }>`
    - **Input**: `departmentId`, `assignmentId`, `policy`.
    - **Action**: فتح Transaction، قفل القسم والتحقق من `canAccessDepartment(policy, department.id)`، ثم تعطيل التعيين وحذف ارتباطات الساحات.
    - **Output**: `{ success: true, message: 'تمت إزالة المهندس من قسم الإنتاج بنجاح' }`.
  - `listDepartmentActiveYards(departmentId: string)`: استرجاع الساحات النشطة التابعة للقسم.

### `Production DTOs`
- `CreateProductionDepartmentDto`: التحقق من الاسم (2-100 مع Trim)، الرمز التقني (`^[A-Z][A-Z0-9_]*$` بطول 2-50 مع تحويل تلقائي للأحرف الكبيرة والتنظيف)، معرف رئيس القسم (`headUserId` UUID v4 إلزامي)، الوصف الاختياري، وحالة التفعيل.
- `UpdateProductionDepartmentDto`: يدعم التحديث الجزئي (PATCH) للاسم، الوصف، وحالة التفعيل، مع قفل تام لتعديل الرمز التقني.
- `ListProductionDepartmentsQueryDto`: التحقق من معاملات الاستعلام (`page`, `limit`, `search`).
- `SetProductionDepartmentHeadDto`: التحقق من معرف المستخدم (`userId` UUID v4).
- `CreateProductionEngineerAssignmentDto`: التحقق من معرف المهندس (`userId` UUID v4) ومصفوفة معرفات الساحات (`yardIds` UUID v4 مع ساحة واحدة على الأقل).
- `UpdateProductionEngineerYardsDto`: التحقق من مصفوفة معرفات الساحات (`yardIds` UUID v4 مع ساحة واحدة على الأقل).
- `CreateProductionYardDto`: التحقق من معرف القسم (`departmentId` UUID v4)، الاسم، الرمز التقني، السعة (`capacity >= 1` كعدد صحيح موجب)، الوصف، وحالة التفعيل.
- `UpdateProductionYardDto`: يدعم التحديث الجزئي للقسم، الاسم، السعة، الوصف، وحالة التفعيل، مع قفل تام لتعديل الرمز.
- `ListProductionYardsQueryDto`: التحقق من معاملات الاستعلام مع فلتر اختياري لمعرف القسم (`departmentId`).

### `Production Controllers & Web Controllers`
- `ProductionDepartmentController` & `ProductionYardController`: معالجة طلبات الـ JSON API لمسارات `/api/production/departments` و `/api/production/yards`.
- `ProductionTeamController`: معالجة طلبات الـ JSON API لمسارات فريق العمل `/api/production/departments/:departmentId/team/...`.
- `ProductionDepartmentWebController` & `ProductionYardWebController`: معالجة وعرض صفحات الـ EJS لمسارات `/production/departments` و `/production/yards`.
- `ProductionTeamWebController`: معالجة وعرض صفحات الـ EJS لمسارات إدارة فريق العمل `/production/departments/:departmentId/team/...`.

---

## Role Management Core Infrastructure

### `RoleService` (`src/modules/system/role/role.service.ts`)
- **Purpose**: تنفيذ منطق الأعمال، والتحقق من فرادة الرمز التقني، وحماية الأدوار المستخدمة، وإدارة دورة حياة الأدوار مع قفل تشاؤمي موحد لمنع التزامن غير المتسق.
- **Methods**:
  - `listRoles(query: ListRolesQueryDto): Promise<PaginatedRolesResult>`
    - **Input**: `query` (`page`, `limit`, `search`).
    - **Action**: استعلام مقسم لصفحات مع البحث بالاسم أو الرمز، تجميع وحساب عدد المستخدمين غير المحذوفين ناعماً لكل دور (`userCount`) بكفاءة، استبعاد الأدوار المحذوفة ناعماً، وترتيب النتائج تصاعدياً حسب تاريخ الإنشاء.
    - **Output**: `{ items: SafeRoleOutput[], total, page, limit, totalPages }`.
  - `getRoleById(id: string): Promise<SafeRoleOutput>`
    - **Input**: `id` (UUID).
    - **Action**: استرجاع الدور غير المحذوف ناعماً مع حسابه لـ `userCount` ورمي `NotFoundError` إذا لم يوجد.
    - **Output**: `SafeRoleOutput`.
  - `createRole(dto: CreateRoleDto): Promise<SafeRoleOutput>`
    - **Input**: `CreateRoleDto` (`name`, `code`, `description`, `isActive`).
    - **Action**:
      1. تنظيف الرمز التقني وتحويله إلى أحرف إنجليزية كبيرة.
      2. معالجة الوصف (`string` يقص ويتحول الفارغ إلى `null`).
      3. التحقق المسبق من عدم وجود الرمز (مع المحذوفين ناعماً) ورمي `ConflictError` (`ROLE_CODE_ALREADY_EXISTS`).
      4. حفظ الكيان مع التقاط أخطاء الـ Race Condition في قاعدة البيانات وتحويلها إلى 409 `ROLE_CODE_ALREADY_EXISTS`.
    - **Output**: `SafeRoleOutput`.
  - `updateRole(id: string, dto: UpdateRoleDto): Promise<SafeRoleOutput>`
    - **Input**: `id`, `UpdateRoleDto` (`name`, `description`, `isActive`).
    - **Action**:
      1. بدء Transaction وإعادة تحميل الدور المستهدف مع قفل تشاؤمي (`pessimistic_write`).
      2. منع تعديل الرمز التقني نهائياً (`code` is immutable).
      3. معالجة الوصف بشكل آمن: `undefined` يبقي القيمة الحالية دون تغيير، `null` يمسح الوصف (`targetRole.description = null`)، و `string` يتم تنظيفه وتحويل الفراغات إلى `null`.
      4. إذا كان المطلوب تعطيل الدور: منع تعطيل `SYSTEM_ADMIN` (`CANNOT_DEACTIVATE_SYSTEM_ADMIN_ROLE`)، والتحقق من عدم ارتباط الدور بأي مستخدم غير محذوف (`ROLE_HAS_ASSIGNED_USERS`).
      5. حفظ التعديلات وإرجاع الكائن المحدث مع `userCount`.
    - **Output**: `SafeRoleOutput`.
  - `softDeleteRole(id: string): Promise<{ success: boolean; message: string }>`
    - **Input**: `id`.
    - **Action**:
      1. بدء Transaction وإعادة تحميل الدور المستهدف مع قفل تشاؤمي (`pessimistic_write`).
      2. منع أرشفة أو حذف دور `SYSTEM_ADMIN` (`CANNOT_DELETE_SYSTEM_ADMIN_ROLE`).
      3. التحقق من عدم وجود أي مستخدم غير محذوف مرتبط بالدور (`ROLE_HAS_ASSIGNED_USERS`).
      4. ضبط `isActive = false` وتنفيذ `softDelete` دون حذف منح الصلاحيات التابعة للدور.
    - **Output**: `{ success: true, message: 'تم أرشفة الدور بنجاح' }`.
  - `findAssignableRoleForUpdate(roleId: string, manager: EntityManager): Promise<RoleEntity | null>`:
    - **Input**: `roleId`, `manager`.
    - **Action**: البحث عن دور نشط وغير محذوف ناعماً (`role.id = :roleId AND role.deletedAt IS NULL AND role.isActive = true`) مع فرض قفل تشاؤمي للكتابة (`setLock('pessimistic_write')`) لنقطة تسلسل موحدة أثناء إسناد الأدوار للمستخدمين.
    - **Output**: `RoleEntity | null`.
  - `countAssignedUsers(roleId: string, manager?: EntityManager): Promise<number>`:
    - **Action**: استعلام سريع لعدد سجلات `system_user` غير المحذوفة ناعماً المرتبطة بالدور.
  - `findActiveRoleById` و `listActiveRoles`: استرجاع الأدوار النشطة غير المحذوفة.

### `RolePermissionService` (`src/modules/system/role/role-permission.service.ts`)
- **Purpose**: إدارة وتقييم الصلاحيات وقواعد الوصول للأدوار مع تطبيق حماية مدير النظام وقفل الدور التشاؤمي.
- **Methods**:
  - `getRolePermissionsState(roleId: string): Promise<RolePermissionsAdminResponse>`:
    - **Input**: `roleId`.
    - **Action**: جلب الدور وكافة الصلاحيات النشطة، واستخراج المنح الفعالة وقواعد الوصول المسجلة للدور، وحساب ملخص الوصول وإحصائيات القواعد لكل صلاحية في استعلام تجميعي محكم بدون N+1، مع استبعاد المنح غير النشطة أو المنتهية زمنياً.
    - **Output**: `{ role: SafeRoleOutput, permissions: RolePermissionAdminItem[], isSystemAdmin: boolean }`.
  - `setRolePermissionState(roleId: string, permissionId: string, enabled: boolean, actor: AuthPrincipal): Promise<{ success: boolean; message: string }>`:
    - **Input**: `roleId`, `permissionId`, `enabled`, `actor`.
    - **Action**: تفعيل أو تعطيل منحة الصلاحية للدور داخل Transaction مع قفل تشاؤمي على سجل الدور، وحظر تعديل صلاحيات دور مدير النظام.
  - `getRolePermissionAccessRules(roleId: string, permissionId: string)`: استرجاع القواعد المسجلة وقدرات الصلاحية.
  - `createRoleAccessRule(roleId: string, permissionId: string, dto: CreateAccessRuleDto, actor: AuthPrincipal)`: إنشاء قاعدة وصول جديدة مع التحقق من القالب والمعرفات المحددة وقفل الدور تشاؤمياً.
  - `updateRoleAccessRule(roleId: string, permissionId: string, ruleId: string, dto: UpdateAccessRuleDto, actor: AuthPrincipal)`: تعديل قاعدة وصول مع التحقق وقفل الدور تشاؤمياً.
  - `deleteRoleAccessRule(roleId: string, permissionId: string, ruleId: string, actor: AuthPrincipal)`: تعطيل قاعدة وصول (`isActive = false`).

### `PermissionService` (`src/modules/system/permission/permission.service.ts`)
- **Purpose**: خدمة استعلامية لقراءة الصلاحيات النشطة المتاحة في النظام.
- **Methods**:
  - `listActivePermissions(manager?: EntityManager): Promise<PermissionEntity[]>`: استرجاع جميع الصلاحيات النشطة غير المحذوفة مرتبة بالاسم.

### `Role DTOs` (`src/modules/system/role/dto/`)
- `CreateRoleDto`: التحقق من الاسم (2-100 مع Trim)، الرمز التقني (`^[A-Z][A-Z0-9_]*$` بطول 2-50 مع تحويل تلقائي للأحرف الكبيرة والتنظيف)، الوصف الاختياري، وحالة التفعيل.
- `UpdateRoleDto`: يدعم التحديث الجزئي (PATCH) للاسم، الوصف (`string | null` بحيث `undefined` لا يغير، `null` يمسح، و `string` يتم تنظيفه)، وحالة التفعيل، مع قفل تام وعدم إتاحة تعديل الرمز التقني.
- `ListRolesQueryDto`: التحقق وتحويل معاملات الاستعلام (`page`, `limit`, `search`).

### `Role Controllers & Web Controllers`
- `RoleController` (`src/modules/system/role/role.controller.ts`): معالجة طلبات الـ JSON API لمسارات `/api/system/roles` بما فيها إدارة الصلاحيات وقواعد الوصول واستعلامات الـ Lookups.
- `RoleWebController` (`src/modules/system/role/role.web.controller.ts`): معالجة وعرض صفحات الـ EJS لمسارات `/system/roles` مع تمرير الصلاحيات الفعالة وشارات الحماية.

---

## User Management Core Infrastructure

### `UserService` (`src/modules/system/user/user.service.ts`)
- **Purpose**: تنفيذ منطق الأعمال، وقواعد التحقق، وحماية الحسابات، وإدارة دورة حياة المستخدمين مع قفل تشاؤمي على الأدوار لمنع التزامن غير المتسق.
- **Methods**:
  - `listUsers(query: ListUsersQueryDto): Promise<PaginatedUsersResult>`
    - **Input**: `query` (`page`, `limit`, `search`).
    - **Action**: استعلام مقسم لصفحات مع البحث بالاسم أو رقم الهاتف، وضم الدور (Role) بكفاءة بدون N+1، واستبعاد المحذوفين ناعماً.
    - **Output**: `{ items: SafeUserOutput[], total, page, limit, totalPages }`.
  - `getUserById(id: string): Promise<SafeUserOutput>`
    - **Input**: `id` (UUID).
    - **Action**: استرجاع المستخدم غير المحذوف ناعماً مع دوره ورمي `NotFoundError` إذا لم يوجد.
    - **Output**: `SafeUserOutput` (بدون `passwordHash`).
  - `createUser(dto: CreateUserDto): Promise<SafeUserOutput>`
    - **Input**: `CreateUserDto` (`fullName`, `phone`, `password`, `roleId`, `isActive`).
    - **Action**:
      1. تشفير كلمة المرور مسبقاً (`hashPassword`) لتقليل زمن حجز القفل في قاعدة البيانات.
      2. فتح Transaction:
         - التحقق من عدم وجود رقم الهاتف مسبقاً (مع فحص السجلات المحذوفة ناعماً `withDeleted()`) ورمي `ConflictError` عند التكرار.
         - قفل سجل الدور المستهدف بـ `pessimistic_write` عبر `RoleService.findAssignableRoleForUpdate` والتحقق من كونه نشطاً وغير محذوف ناعماً ورمي `NotFoundError('ROLE_NOT_FOUND_OR_INACTIVE')` في حال عدم صلاحيته.
         - حفظ المستخدم داخل نفس الـ Transaction وإرجاع بياناته الآمنة.
      3. التقاط أخطاء الـ Race Condition في قاعدة البيانات (`ER_DUP_ENTRY` / 1062) وتحويلها إلى `ConflictError` برمز `USER_PHONE_ALREADY_EXISTS`.
    - **Output**: `SafeUserOutput`.
  - `updateUser(id: string, dto: UpdateUserDto, currentPrincipal: AuthPrincipal): Promise<SafeUserOutput>`
    - **Input**: `id`, `UpdateUserDto` (`fullName`, `phone`, `roleId`, `isActive`), `currentPrincipal`.
    - **Action**:
      1. **حماية الذات**: التحقق المبدئي من منع المستخدم من تعطيل حسابه الحالي.
      2. **Transaction**: بدء Transaction وإعادة تحميل المستخدم المستهدف من قاعدة البيانات.
      3. **حماية الدور الشخصي**: منع المستخدم من تغيير دوره الخاص على السجل المحمل حديثاً.
      4. **حماية آخر مدير نظام بقفل تشاؤمي**: إذا كانت العملية ستؤدي لتعطيل مدير نظام فعال أو نقله لدور آخر، يتم فرض Pessimistic Write Lock (`setLock('pessimistic_write')`) على سجلات مدراء النظام الفعالة والتحقق من أن عددهم يتجاوز 1 لمنع أي Race Condition متزامن.
      5. **التحقق من الدور الجديد وقفله**: في حال تغيير الدور، يتم قفل الدور الجديد بـ `pessimistic_write` عبر `findAssignableRoleForUpdate` والتحقق من كونه نشطاً وغير محذوف ناعماً.
      6. **فرادية الهاتف**: التحقق من عدم استخدام الهاتف الجديد من قبل حساب آخر (يشمل المحذوفين ناعماً) والتقاط خطأ التكرار 409.
      7. **حفظ التعديلات**: حفظ الكيان وإلغاء الجلسات النشطة تلقائياً عبر `SessionService.revokeUserSessions` في حال تحول المستخدم إلى غير نشط (`isActive = false`).
    - **Output**: `SafeUserOutput`.
  - `softDeleteUser(id: string, currentPrincipal: AuthPrincipal): Promise<{ success: boolean; message: string }>`
    - **Input**: `id`, `currentPrincipal`.
    - **Action**:
      1. منع حذف المستخدم لنفسه (`Self Protection`).
      2. **Transaction**: إعادة تحميل المستخدم وفرض Pessimistic Write Lock على مدراء النظام في حال كان المستهدف مدير نظام فعال للتحقق من عدم كونه الأخير.
      3. إلغاء الجلسات النشطة، ضبط `isActive = false`، وتنفيذ `softDelete` للكيان.
    - **Output**: `{ success: true, message: 'تم أرشفة المستخدم بنجاح' }`.

### `UserPermissionService` (`src/modules/system/user/user-permission.service.ts`)
- **Purpose**: إدارة وتقييم الصلاحيات وقواعد الوصول المباشرة للمستخدمين مع تطبيق حماية الذات وقفل المستخدم التشاؤمي.
- **Methods**:
  - `getUserPermissionsState(userId: string): Promise<UserPermissionsAdminResponse>`:
    - **Input**: `userId`.
    - **Action**: استرجاع الصلاحيات النشطة مع تفصيل منح وقواعد الدور، والمنح والقواعد المباشرة، والنتيجة الفعالة لكل صلاحية دون N+1.
  - `setUserPermissionState(userId: string, permissionId: string, enabled: boolean, actor: AuthPrincipal): Promise<{ success: boolean; message: string }>`:
    - **Input**: `userId`, `permissionId`, `enabled`, `actor`.
    - **Action**: تفعيل أو تعطيل منحة الصلاحية المباشرة للمستخدم داخل Transaction مع قفل تشاؤمي على سجل المستخدم وحظر إدارة الصلاحيات الذاتية (`CANNOT_MANAGE_OWN_PERMISSIONS`).
  - `getUserPermissionAccessRules(userId: string, permissionId: string)`: استرجاع القواعد المباشرة وقواعد الدور وقدرات الصلاحية.
  - `createUserAccessRule(userId: string, permissionId: string, dto: CreateAccessRuleDto, actor: AuthPrincipal)`: إنشاء قاعدة وصول مباشرة للمستخدم مع قفل المستخدم تشاؤمياً.
  - `updateUserAccessRule(userId: string, permissionId: string, ruleId: string, dto: UpdateAccessRuleDto, actor: AuthPrincipal)`: تعديل قاعدة وصول مباشرة للمستخدم مع قفل المستخدم تشاؤمياً.
  - `deleteUserAccessRule(userId: string, permissionId: string, ruleId: string, actor: AuthPrincipal)`: تعطيل قاعدة وصول مباشرة للمستخدم (`isActive = false`).

### `User DTOs` (`src/modules/system/user/dto/`)
- `CreateUserDto`: التحقق من الاسم الكامل (2-150 مع Trim تلقائي عبر `@Transform`)، الهاتف (`^09[0-9]{8}$` مع Trim)، كلمة المرور (6 محارف على الأقل بدون Trim)، `roleId` (UUID v4)، وحالة التفعيل الاختيارية.
- `UpdateUserDto`: يدعم التحديث الجزئي (PATCH) مع Trim للمدخلات النصية وخلوه التام من حقول كلمات المرور أو الصلاحيات.
- `ListUsersQueryDto`: التحقق وتحويل معاملات الاستعلام (`page` افتراضي 1، `limit` افتراضي 20 بحد أقصى 100، `search` نصي مع Trim).

### `Generic Middlewares & Types` (`src/common/middleware/`)
- `validateQueryDto(DtoClass)`: وسيط لإجراء التحقق من استعلامات الـ URL (`req.query`) باستخدام `class-transformer` و `class-validator` وتخزين الكائن المحقق داخل `req.validatedQuery` دون التعديل على `req.query`.
- `validateUuidParam(paramName)`: وسيط للتحقق من صحة معاملات الـ URL (`req.params`) وتطابقها مع نمط UUID v4.
- `validateUserUpdatePayload`: وسيط مخصص للتحقق من احتواء طلب الـ PATCH على حقل واحد على الأقل مع قبول `isActive: false` كقيمة صحيحة.
- `validateRoleUpdatePayload`: وسيط مخصص للتحقق من احتواء طلب تعديل الدور على حقل واحد على الأقل.

---

### `User Controllers & Web Controllers`
- `UserController` (`src/modules/system/user/user.controller.ts`): معالجة طلبات الـ JSON API لمسارات `/api/system/users` بما فيها إدارة الصلاحيات وقواعد الوصول واستعلامات الـ Lookups.
- `UserWebController` (`src/modules/system/user/user.web.controller.ts`): معالجة وعرض صفحات الـ EJS لمسارات `/system/users` بما فيها واجهة إدارة الصلاحيات وقواعد الوصول المباشرة `renderUserPermissionsForm`.

---

## Authentication & Core Services

### `AuthService` (`src/modules/system/auth/auth.service.ts`)
- **Purpose**: تنفيذ منطق التحقق من بيانات الدخول، وتوليد JWT، وإنشاء سجلات الجلسات في قاعدة البيانات.
- **Methods**:
  - `login(dto: LoginDto, context: AuthContext): Promise<LoginResult>`
    - **Input**: `LoginDto` (`phone`, `password`), `context` (`ipAddress`, `userAgent`).
    - **Action**:
      1. البحث عن المستخدم في جدول `system_user` برقم الهاتف (مع استبعاد المحذوفين ناعماً).
      2. التحقق من تطابق كلمة المرور باستخدام `comparePassword` (bcrypt).
      3. إذا لم يوجد المستخدم أو كانت كلمة المرور غير متطابقة، يتم إرجاع `UnauthorizedError` موحدة لحماية النظام من هجمات تخمين الحسابات (User Enumeration).
      4. التحقق من فعالية المستخدم `user.isActive`، ورمي `ForbiddenError` إذا كان الحساب معطلاً.
      5. توليد `sessionId` كـ UUID v4.
      6. توقيع JWT بخوارزمية `HS256` يحتوي فقط على `{ sub: user.id, sid: sessionId }` مع مدة صلاحية محددة.
      7. حساب الهاش SHA-256 للـ JWT وتمريره لخدمة الجلسات لإنشاء سجل `system_session`.
    - **Output**: `{ user: SafeUser, token: string, expiresAt: Date, sessionId: string }`.

### `SessionService` (`src/modules/system/session/session.service.ts`)
- **Purpose**: إدارة دورة حياة الجلسات في قاعدة البيانات (`system_session`).
- **Methods**:
  - `createSession(params: CreateSessionParams, manager?: EntityManager): Promise<SessionEntity>`: إنشاء وحفظ سجل جلسة جديد.
  - `validateSession(sessionId: string, userId: string, rawToken: string): Promise<SessionEntity | null>`:
    - حساب SHA-256 للـ `rawToken`.
    - التحقق من وجود الجلسة ومطابقة `id`, `user_id`, `token_hash`, وكونها `is_active: true`, و `revoked_at IS NULL`, و `expires_at > now`.
  - `touchSession(sessionId: string, currentLastUsedAt: Date): Promise<void>`:
    - تحديث مؤجل (Throttled) لحقل `last_used_at` إذا كان الفارق الزمني 5 دقائق أو أكثر لتجنب الضغط على قاعدة البيانات.
  - `revokeSession(sessionId: string, reason: string = 'LOGOUT', manager?: EntityManager): Promise<void>`:
    - إلغاء الجلسة بوضع `is_active = false`, `revoked_at = now()`, `revoked_reason = reason`.
  - `revokeUserSessions(userId: string, reason: string = 'USER_DEACTIVATED', manager?: EntityManager): Promise<void>`:
    - إلغاء كافة الجلسات النشطة لمستخدم معين عند تعطيل حسابه أو أرشفته ناعماً.

---

## Authorization Core Services (Phase 1)

### `AuthorizationService` (`src/modules/system/authorization/authorization.service.ts`)
- **Purpose**: تقييم الصلاحيات الفعالة الشاملة للمستخدمين بناءً على المنح المطبقة (منح الدور + المنح المباشرة) وقواعد الوصول المقترنة بها ذات النطاق الشامل الصالح (`scopeType = 'ALL'`, `scope = null`).
- **Methods**:
  - `hasPermission(principal: AuthPrincipal, permissionName: string): Promise<boolean>`
    - **Input**: `principal` (`AuthPrincipal`), `permissionName` (`string`).
    - **Action**:
      1. يستعلم عن جميع القواعد الفعالة (`rule.isActive = true`, `rule.scopeType = 'ALL'`) التابعة لمنح فعالة (`grant.isActive = true`, `grant.expiresAt > now OR NULL`) الموجهة لدور المستخدم (`roleId`) أو للمستخدم مباشرة (`userId`) مع جلب `rule.scope`.
      2. يتأكد من كون الصلاحية نشطة (`permission.isActive = true`) وغير محذوفة ناعماً (`permission.deletedAt IS NULL`).
      3. التحقق الصارم من عقد ALL (`isValidAllScope: scope === null`):
         - قواعد `ALLOW ALL` الصالحة (`scope === null`) تسجل منحاً فعالاً. وقواعد `ALLOW ALL` التالفة (`scope !== null`) تُهمل تماماً ولا تمنح أي وصول.
         - قواعد `DENY ALL` الصالحة أو التالفة تسجل حظراً فعالاً وتفشل مغلقة (`Effective DENY ALL` wins).
      4. إذا وجدت أي قاعدة حظر فعالة، ترجع الدالة `false` فوراً (`DENY ALL` wins).
      5. إذا وجدت قاعدة منح صالحة واحدة على الأقل `ALLOW ALL` ولم يوجد أي `DENY ALL`، ترجع الدالة `true`.
      6. في حال غياب قواعد `ALLOW ALL` الصالحة، ترجع الدالة `false` (Fail Closed / Default Deny).
      7. ملاحظة معمارية: فحص الصلاحيات العالمية في `AuthorizationService.hasPermission()` يقتصر على النطاق الشامل (`ALL`)؛ بينما الوصول المقيد على مستوى الصفوف (Row-Level Scopes) كالأقسام والساحات يتم تقييمه وفحصه عبر `getApplicableAccessRules()` وسياسات النطاقات المتخصصة مثل `ProductionAccessPolicyService`.
    - **Output**: `boolean`.
  - `getEffectivePermissions(principal: AuthPrincipal): Promise<string[]>`
    - **Input**: `principal` (`AuthPrincipal`).
    - **Action**: استعلام تجميعي موحد (Single aggregated QueryBuilder without N+1) يستخرج كافة أسماء الصلاحيات التي يمتلك المستخدم عليها قاعدة `ALLOW ALL` صالحة (`scope === null`) نشطة بدون أي قاعدة `DENY ALL` (صالحة أو تالفة).
    - **Output**: `string[]` (مثل `['system.user.view', 'system.user.create', 'system.role.view', ...]`).
  - `getApplicableAccessRules(principal: AuthPrincipal, permissionName: string): Promise<ApplicableAccessRule[]>`
    - **Input**: `principal` (`AuthPrincipal`), `permissionName` (`string`).
    - **Action**: استرجاع كافة قواعد الوصول الفعالة (`rule.isActive = true`) المرتبطة بمنح سارية للمستخدم أو دوره لصلاحية نشطة محددة بدون تقييد نوع النطاق على `ALL` فقط، لخدمة تقييم النطاقات التشغيلية والديناميكية والمحددة.
    - **Output**: `ApplicableAccessRule[]` (`ruleId`, `grantId`, `effect`, `scopeType`, `scope`).

### `Authorization Middleware` (`src/modules/system/authorization/authorization.middleware.ts`)
- `requirePermission(permissionName: string)`:
  - **Input**: `permissionName` (اسم الصلاحية المطلوب فحصها).
  - **Action**:
    1. يتحقق من وجود المستخدم الموثق `req.user`، وإذا لم يوجد يمرر `UnauthorizedError` (HTTP 401).
    2. يستدعي `authorizationService.hasPermission(req.user, permissionName)`.
    3. إذا كانت النتيجة `true`، يمرر التنفيذ للوسيط التالي عبر `next()`.
    4. إذا كانت النتيجة `false`، يمرر `ForbiddenError('ليس لديك صلاحية لتنفيذ هذا الإجراء', 'PERMISSION_DENIED')` (HTTP 403) إلى معالج الأخطاء المركزي.

---

## Dynamic Production Access Scopes & Row-Level Authorization Infrastructure (Phase 2)

### `ApplicableAccessRule` (`src/modules/system/authorization/authorization.types.ts`)
- **Purpose**: واجهة تمثل قاعدة الوصول الفعالة المسترجعة من محرك الصلاحيات لتقييم النطاقات.
- **Fields**: `ruleId: string`, `grantId: string`, `effect: 'ALLOW' | 'DENY'`, `scopeType: string`, `scope: Record<string, unknown> | null`.

### `Production Access Scope Constants` (`src/modules/production/authorization/production-access-scope.constants.ts`)
- **Purpose**: تعريف الثوابت المعتمدة لنطاقات وصول تطبيق الإنتاج ومصادرها الديناميكية.
- **Values**:
  - `ProductionAccessScopeType`: `{ DEPARTMENT: 'PRODUCTION_DEPARTMENT', YARD: 'PRODUCTION_YARD' }`.
  - `ProductionAccessScopeSource`: `{ CURRENT_RESPONSIBILITY: 'CURRENT_PRODUCTION_RESPONSIBILITY' }`.

### `Production Access Policy Types` (`src/modules/production/authorization/production-access-policy.types.ts`)
- **Purpose**: تعريف كائنات المسؤولية التشغيلية وسياسة الوصول الناتجة ودوال التحقق النوعية الصارمة.
- **Types**:
  - `ProductionResponsibility`: `{ headDepartmentId: string | null, engineerDepartmentId: string | null, engineerYardIds: string[], isConsistent: boolean }`.
  - `ResolvedProductionAccessPolicy`: `{ permissionName: string, allowAll: boolean, denyAll: boolean, allowDepartmentIds: string[], denyDepartmentIds: string[], allowYardIds: string[], denyYardIds: string[], hasAnyAccess: boolean }`.
  - `isCurrentProductionResponsibilityScope(scope: unknown): boolean`: Type Guard صارم يتحقق من أن كائن النطاق يطابق بالضبط الشكل `{ "source": "CURRENT_PRODUCTION_RESPONSIBILITY" }` بمفتاح وحيد فقط (`Object.keys(scope).length === 1`). أي خصائص إضافية تجعل النطاق غير صالح (`Invalid Scope`).

### `ProductionResponsibilityResolver` (`src/modules/production/authorization/production-responsibility.resolver.ts`)
- **Purpose**: استرجاع وحل المسؤوليات التشغيلية الحالية للمستخدم من قاعدة البيانات بـ استعلامين مستهدفين فقط دون N+1، مع التحقق الصارم من النزاهة والانغلاق الآمن (Fail Closed).
- **Methods**:
  - `resolve(principal: AuthPrincipal): Promise<ProductionResponsibility>`:
    - **استعلام رئاسة القسم (`Head Query`)**: على جدول `production_department` حيث `head_user_id = principal.id` و `deleted_at IS NULL`.
    - **استعلام تعيين المهندس الموحد (`Engineer Joined Query`)**: استعلام واحد يضم `ProductionDepartmentEngineerEntity` مع القسم `department` وارتباطات الساحات `yardMappings` وساحاتها `yard` حيث `eng.userId = principal.id` و `eng.isActive = true`.
    - **قواعد فحص النزاهة والانغلاق الآمن (`Consistency Rules`)**:
      يتم ضبط `isConsistent = false` وتصفير ساحات المهندس (`engineerYardIds = []`) دون أي إصلاح تلقائي صامت للبيانات في الحالات التالية:
      1. المستخدم رئيس قسم ومهندس نشط في نفس الوقت (`headDepartmentId !== null && engineerDepartmentId !== null`).
      2. علاقة قسم المهندس غير موجودة أو فارغة.
      3. قسم المهندس مؤرشف (`department.deletedAt !== null`).
      4. المهندس النشط لديه صفر ساحات مسندة (`yardMappings.length === 0`).
      5. أي ارتباط ساحة لا يحتوي على كيان ساحة صالح.
      6. الساحة المسندة مؤرشفة (`yard.deletedAt !== null`).
      7. الساحة المسندة تتبع لقسم مختلف عن قسم المهندس (`yard.departmentId !== engineerAssignment.departmentId`).

### `ProductionAccessPolicyService` (`src/modules/production/authorization/production-access-policy.service.ts`)
- **Purpose**: دمج قواعد الوصول المطبقة مع المسؤولية التشغيلية للمستخدم لإنتاج سياسة وصول قطعية وموحدة.
- **Methods**:
  - `resolvePolicy(rules: ApplicableAccessRule[], responsibility: ProductionResponsibility, permissionName: string): ResolvedProductionAccessPolicy`:
    - تطبيق قواعد `ALL`: `ALLOW ALL` تضبط `allowAll = true`، و `DENY ALL` تضبط `denyAll = true`.
    - تطبيق قواعد `PRODUCTION_DEPARTMENT`: إذا كان رئيس قسم، تُضاف لرخص أو حظر الأقسام.
    - تطبيق قواعد `PRODUCTION_YARD`: إذا كان مهندساً نشطاً، تُضاف ساحاته لرخص أو حظر الساحات.
    - انغلاق الأمان: القواعد غير المفهومة للـ ALLOW تُهمل، وللـ DENY تُغلق بالكامل (`denyAll = true`). التعارض التشغيلي (`!isConsistent`) يبطل الـ dynamic ALLOW.
    - حساب `hasAnyAccess = !denyAll && (allowAll || allowDepartmentIds.length > 0 || allowYardIds.length > 0)`.

### `ProductionAuthorizationContext` (`src/modules/production/authorization/production-authorization-context.ts`)
- **Purpose**: إدارة الكاش التشغيلي المؤقت على مستوى دورة حياة الطلب الواحد باستخدام `WeakMap<Request, ...>`.
- **Functions**:
  - `getProductionResponsibility(req, principal)`: كاش المسؤولية التشغيلية مرة واحدة لكل طلب.
  - `getProductionAccessPolicy(req, principal, permissionName)`: كاش سياسة الوصول لكل صلاحية مرة واحدة لكل طلب لمنع تكرار استعلامات الصلاحيات بين Middleware و Controllers.

### `ProductionAuthorizationMiddleware` (`src/modules/production/authorization/production-authorization.middleware.ts`)
- **Purpose**: وسيط التحقق من امتلاك المستخدم لأي وصول فعال (`hasAnyAccess === true`) لصلاحية إنتاج معينة.
- **Functions**:
  - `requireProductionAccess(permissionName: string)`: يتحقق من المصادقة، يسترجع السياسة من سياق الطلب، ويرمي `ForbiddenError('ليس لديك صلاحية وصول على أي نطاق بيانات في هذا القسم', 'ACCESS_SCOPE_DENIED')` في حال `!policy.hasAnyAccess`.

### `ProductionAccessQueryHelper` (`src/modules/production/authorization/production-access-query.helper.ts`)
- **Purpose**: ترجمة سياسة الوصول إلى شروط SQL صريحة على استعلامات TypeORM QueryBuilder ودوال فحص الأهداف المباشرة.
- **Functions**:
  - `applyDepartmentAccessScope(qb, policy)`: تطبيق شروط الأقسام قبل Pagination/Count (`dept.id IN (...)` و `dept.id NOT IN (...)`).
  - `applyYardAccessScope(qb, policy)`: تطبيق شروط الساحات عبر `Brackets` تجمع أقسام وساحات المهندس ورئيس القسم مع شروط الحظر.
  - `canAccessDepartment(policy, departmentId)`: دالة نقية للتحقق من صلاحية الوصول لقسم معين.
  - `canAccessYard(policy, { id, departmentId })`: دالة نقية للتحقق من صلاحية الوصول لساحة معينة.

---

## Seed Infrastructure

### Seed Execution Order & Module Ownership
1. **System Admin Role Seed** (`src/modules/system/role/seeds/system-admin-role.seed.ts`) $\rightarrow$ ينشئ أو يسترجع دور `SystemRole.SYSTEM_ADMIN`.
2. **System User Permissions Seed** (`src/modules/system/permission/seeds/system-user-permissions.seed.ts`) $\rightarrow$ ينشئ أو يسترجع الصلاحيات المعرفة في `SystemPermission` (صلاحيات المستخدمين وصلاحيات الأدوار).
3. **System Admin User Seed** (`src/modules/system/user/seeds/system-admin-user.seed.ts`) $\rightarrow$ ينشئ مستخدم مدير النظام `0912312312` ويستدعي منح الصلاحيات وقواعد الوصول.
4. **SYSTEM_ADMIN Permission Grants Seed** (`src/modules/system/permission-grant/seeds/system-admin-permission-grants.seed.ts`) $\rightarrow$ يضمن في كل تشغيل أن دور `SYSTEM_ADMIN` يمتلك منحة نشطة وغير منتهية مع `can_delegate: true` و `userId = null` لكل صلاحية نشطة.
5. **SYSTEM_ADMIN Access Rules Seed** (`src/modules/system/access-rule/seeds/system-admin-access-rules.seed.ts`) $\rightarrow$ يضمن وجود وتفعيل قواعد `ALLOW` / `ALL` لكل منحة صلاحية خاصة بمدير النظام دون حذف قواعد الـ DENY الصريحة.

### Seed Idempotency & Security Rules
- **Idempotency**: يعتمد التحقق على المفاتيح الطبيعية (`Role.code`, `Permission.name`, `User.phone`, `Grant(roleId + permissionId)`, `Rule(grantId + effect + scopeType)`).
- **Password Security**:
  - متغير البيئة `SEED_SYSTEM_ADMIN_PASSWORD` إلزامي فقط عند إنشاء مستخدم المدير لأول مرة.
  - لا توجد أي كلمة مرور افتراضية (No fallback) في الكود المصدري.
  - تشفير كلمة المرور بـ `bcrypt` قبل التخزين.
  - حماية كلمات مرور المستخدمين المنشئين مسبقاً من إعادة التعيين أثناء إعادة تشغيل الـ Seed.
- **SYSTEM_ADMIN Auto-Grants & Safe Updates**: عند تشغيل الـ Seed، يتم تحديث أي منح قديمة معطلة أو منتهية لمدير النظام لتصبح نشطة ودائمة مع قواعد `ALLOW ALL`، مع الحفاظ على أي قواعد `DENY` صريحة أضافها المستخدم يدوياً.

---

## Database Structure

### `system_role`
- **Entity**: `RoleEntity` (`src/modules/system/role/role.entity.ts`)
- **Purpose**: تعريف الأدوار الأساسية للمستخدمين في النظام.
- **Fields**:
  - `id`: varchar(36) UUID, Primary Key
  - `name`: varchar(100), NOT NULL
  - `code`: varchar(50), NOT NULL, UNIQUE (`UQ_system_role_code`)
  - `description`: text, NULL
  - `is_active`: tinyint(1), NOT NULL, default: 1
  - `created_at`: datetime(6), NOT NULL, default: CURRENT_TIMESTAMP(6)
  - `updated_at`: datetime(6), NOT NULL, default: CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
  - `deleted_at`: datetime(6), NULL (Soft Delete)
- **Relations**:
  - `users`: OneToMany $\rightarrow$ `UserEntity` (`eager: false`, `cascade: false`)
  - `permissionGrants`: OneToMany $\rightarrow$ `PermissionGrantEntity` (`eager: false`, `cascade: false`)
- **Constraints / Indexes**:
  - `UQ_system_role_code`: UNIQUE(`code`)

---

### `system_user`
- **Entity**: `UserEntity` (`src/modules/system/user/user.entity.ts`)
- **Purpose**: تمثيل حسابات المستخدمين في النظام مع ارتباط كل مستخدم بدور أساسي واحد.
- **Fields**:
  - `id`: varchar(36) UUID, Primary Key
  - `full_name`: varchar(150), NOT NULL
  - `phone`: varchar(20), NOT NULL, UNIQUE (`UQ_system_user_phone`)
  - `password_hash`: varchar(255), NOT NULL
  - `role_id`: varchar(36) UUID, NOT NULL, FK $\rightarrow$ `system_role.id`
  - `is_active`: tinyint(1), NOT NULL, default: 1
  - `created_at`: datetime(6), NOT NULL, default: CURRENT_TIMESTAMP(6)
  - `updated_at`: datetime(6), NOT NULL, default: CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
  - `deleted_at`: datetime(6), NULL (Soft Delete)
- **Relations**:
  - `role`: ManyToOne $\rightarrow$ `RoleEntity` (`role_id`, `onDelete: RESTRICT`, `onUpdate: CASCADE`, `eager: false`)
  - `permissionGrants`: OneToMany $\rightarrow$ `PermissionGrantEntity` (Direct grants to user, `eager: false`, `cascade: false`)
  - `grantedPermissions`: OneToMany $\rightarrow$ `PermissionGrantEntity` (Grants issued by this user, `eager: false`, `cascade: false`)
  - `sessions`: OneToMany $\rightarrow$ `SessionEntity` (Active and past user sessions, `eager: false`, `cascade: false`)
- **Constraints / Indexes**:
  - `UQ_system_user_phone`: UNIQUE(`phone`)
  - `IDX_system_user_role_id`: INDEX(`role_id`)
  - `FK_system_user_role_id`: FOREIGN KEY (`role_id`) REFERENCES `system_role`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE

---

### `system_permission`
- **Entity**: `PermissionEntity` (`src/modules/system/permission/permission.entity.ts`)
- **Purpose**: تعريف الصلاحيات المتاحة في النظام بنمط `<application>.<resource>.<action>`.
- **Fields**:
  - `id`: varchar(36) UUID, Primary Key
  - `name`: varchar(150), NOT NULL, UNIQUE (`UQ_system_permission_name`)
  - `description`: text, NULL
  - `is_active`: tinyint(1), NOT NULL, default: 1
  - `created_at`: datetime(6), NOT NULL, default: CURRENT_TIMESTAMP(6)
  - `updated_at`: datetime(6), NOT NULL, default: CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
  - `deleted_at`: datetime(6), NULL (Soft Delete)
- **Relations**:
  - `permissionGrants`: OneToMany $\rightarrow$ `PermissionGrantEntity` (`eager: false`, `cascade: false`)
- **Constraints / Indexes**:
  - `UQ_system_permission_name`: UNIQUE(`name`)

---

### `system_permission_grant`
- **Entity**: `PermissionGrantEntity` (`src/modules/system/permission-grant/permission-grant.entity.ts`)
- **Purpose**: تمثيل منح صلاحية محددة إما لمستخدم مباشرة أو لدور معين (Exactly one target via XOR check).
- **Fields**:
  - `id`: varchar(36) UUID, Primary Key
  - `permission_id`: varchar(36) UUID, NOT NULL, FK $\rightarrow$ `system_permission.id`
  - `user_id`: varchar(36) UUID, NULL, FK $\rightarrow$ `system_user.id`
  - `role_id`: varchar(36) UUID, NULL, FK $\rightarrow$ `system_role.id`
  - `can_delegate`: tinyint(1), NOT NULL, default: 0
  - `granted_by`: varchar(36) UUID, NULL, FK $\rightarrow$ `system_user.id`
  - `granted_at`: datetime(6), NOT NULL, default: CURRENT_TIMESTAMP(6)
  - `expires_at`: datetime(6), NULL
  - `is_active`: tinyint(1), NOT NULL, default: 1
  - `reason`: text, NULL
  - `created_at`: datetime(6), NOT NULL, default: CURRENT_TIMESTAMP(6)
  - `updated_at`: datetime(6), NOT NULL, default: CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
- **Relations**:
  - `permission`: ManyToOne $\rightarrow$ `PermissionEntity` (`permission_id`, `onDelete: RESTRICT`, `onUpdate: CASCADE`)
  - `user`: ManyToOne $\rightarrow$ `UserEntity` (`user_id`, `onDelete: RESTRICT`, `onUpdate: CASCADE`, nullable: true)
  - `role`: ManyToOne $\rightarrow$ `RoleEntity` (`role_id`, `onDelete: RESTRICT`, `onUpdate: CASCADE`, nullable: true)
  - `grantedByUser`: ManyToOne $\rightarrow$ `UserEntity` (`granted_by`, `onDelete: SET NULL`, `onUpdate: CASCADE`, nullable: true)
  - `accessRules`: OneToMany $\rightarrow$ `AccessRuleEntity` (`eager: false`, `cascade: false`)
- **Constraints / Indexes**:
  - `CHK_system_permission_grant_target`: CHECK `((user_id IS NOT NULL AND role_id IS NULL) OR (user_id IS NULL AND role_id IS NOT NULL))`
  - `IDX_system_permission_grant_permission_id`: INDEX(`permission_id`)
  - `IDX_system_permission_grant_user_id`: INDEX(`user_id`)
  - `IDX_system_permission_grant_role_id`: INDEX(`role_id`)
  - `IDX_system_permission_grant_granted_by`: INDEX(`granted_by`)
  - `IDX_system_permission_grant_is_active`: INDEX(`is_active`)
  - `IDX_system_permission_grant_expires_at`: INDEX(`expires_at`)

---

### `system_access_rule`
- **Entity**: `AccessRuleEntity` (`src/modules/system/access-rule/access-rule.entity.ts`)
- **Purpose**: تحديد نطاق البيانات (Row/Scope Filter) المسموح أو الممنوع لمنحة صلاحية معينة.
- **Fields**:
  - `id`: varchar(36) UUID, Primary Key
  - `permission_grant_id`: varchar(36) UUID, NOT NULL, FK $\rightarrow$ `system_permission_grant.id`
  - `effect`: varchar(10), NOT NULL ('ALLOW' | 'DENY')
  - `scope_type`: varchar(50), NOT NULL
  - `scope`: json, NULL (Business metadata for scope filtering)
  - `is_active`: tinyint(1), NOT NULL, default: 1
  - `description`: text, NULL
  - `created_at`: datetime(6), NOT NULL, default: CURRENT_TIMESTAMP(6)
  - `updated_at`: datetime(6), NOT NULL, default: CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
- **Relations**:
  - `permissionGrant`: ManyToOne $\rightarrow$ `PermissionGrantEntity` (`permission_grant_id`, `onDelete: CASCADE`, `onUpdate: CASCADE`)
- **Constraints / Indexes**:
  - `CHK_system_access_rule_effect`: CHECK `(effect IN ('ALLOW', 'DENY'))`
  - `IDX_system_access_rule_permission_grant_id`: INDEX(`permission_grant_id`)
  - `IDX_system_access_rule_effect`: INDEX(`effect`)
  - `IDX_system_access_rule_scope_type`: INDEX(`scope_type`)
  - `IDX_system_access_rule_is_active`: INDEX(`is_active`)

---

### `system_session`
- **Entity**: `SessionEntity` (`src/modules/system/session/session.entity.ts`)
- **Purpose**: تخزين جلسات تسجيل دخول المستخدمين بشكل دائم مع التحقق من الهاش، وتعدد الأجهزة، وتتبع آخر استخدام، وتاريخ الإلغاء.
- **Fields**:
  - `id`: varchar(36) UUID, Primary Key
  - `user_id`: varchar(36) UUID, NOT NULL, FK $\rightarrow$ `system_user.id`
  - `token_hash`: varchar(64), NOT NULL, UNIQUE (`UQ_system_session_token_hash`)
  - `device_type`: varchar(50), NULL (نوع الجهاز بصورة عامة للعرض)
  - `device_name`: varchar(150), NULL (اسم وصفي للجهاز للعرض)
  - `browser`: varchar(50), NULL (اسم المتصفح)
  - `os`: varchar(50), NULL (نظام التشغيل)
  - `user_agent`: text, NULL (نص User-Agent الخام القادم من الطلب)
  - `ip_address`: varchar(45), NULL (عنوان IP للطلب يدعم IPv4 و IPv6)
  - `last_used_at`: datetime(6), NOT NULL (آخر وقت تم فيه استخدام الجلسة بنجاح)
  - `expires_at`: datetime(6), NOT NULL (وقت الانتهاء التلقائي للجلسة)
  - `is_active`: tinyint(1), NOT NULL, default: 1 (حالة فعالية الجلسة)
  - `revoked_at`: datetime(6), NULL (تاريخ ووقت إلغاء الجلسة يدوياً إن وُجد)
  - `revoked_reason`: text, NULL (سبب إلغاء الجلسة مثل Logout أو Admin Revoke)
  - `created_at`: datetime(6), NOT NULL, default: CURRENT_TIMESTAMP(6)
  - `updated_at`: datetime(6), NOT NULL, default: CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
- **Relations**:
  - `user`: ManyToOne $\rightarrow$ `UserEntity` (`user_id`, `onDelete: RESTRICT`, `onUpdate: CASCADE`, `eager: false`, `cascade: false`)
- **Constraints / Indexes**:
  - `UQ_system_session_token_hash`: UNIQUE(`token_hash`)
  - `IDX_system_session_user_id`: INDEX(`user_id`)
  - `IDX_system_session_expires_at`: INDEX(`expires_at`)
  - `IDX_system_session_is_active`: INDEX(`is_active`)
  - `IDX_system_session_user_is_active`: INDEX(`user_id`, `is_active`)

---

### `production_department`
- **Entity**: `ProductionDepartmentEntity` (`src/modules/production/department/production-department.entity.ts`)
- **Purpose**: تمثيل الهيكل التنظيمي التشغيلي لأقسام تطبيق الإنتاج (مثل الصب، الإكساء، الجودة، النقل) كبيانات أعمال ديناميكية منفصلة تماماً عن HR، مع ارتباط كل قسم برئيس قسم واحد.
- **Fields**:
  - `id`: varchar(36) UUID, Primary Key
  - `name`: varchar(100), NOT NULL
  - `code`: varchar(50), NOT NULL, UNIQUE (`UQ_production_department_code`), Immutable
  - `head_user_id`: varchar(36) UUID, NULL, UNIQUE (`UQ_production_department_head_user`), FK $\rightarrow$ `system_user.id` (Department Head)
  - `description`: text, NULL
  - `is_active`: tinyint(1), NOT NULL, default: 1
  - `created_at`: datetime(6), NOT NULL, default: CURRENT_TIMESTAMP(6)
  - `updated_at`: datetime(6), NOT NULL, default: CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
  - `deleted_at`: datetime(6), NULL (Soft Delete)
- **Relations**:
  - `headUser`: ManyToOne $\rightarrow$ `UserEntity` (`head_user_id`, `onDelete: RESTRICT`, `onUpdate: CASCADE`, `eager: false`, `cascade: false`)
  - `yards`: OneToMany $\rightarrow$ `ProductionYardEntity` (`eager: false`, `cascade: false`)
  - `engineers`: OneToMany $\rightarrow$ `ProductionDepartmentEngineerEntity` (`eager: false`, `cascade: false`)
- **Constraints / Indexes**:
  - `UQ_production_department_code`: UNIQUE(`code`)
  - `UQ_production_department_head_user`: UNIQUE(`head_user_id`)
  - `IDX_production_department_is_active`: INDEX(`is_active`)
  - `IDX_production_department_deleted_at`: INDEX(`deleted_at`)
  - `FK_production_department_head_user_id`: FOREIGN KEY (`head_user_id`) REFERENCES `system_user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE

---

### `production_yard`
- **Entity**: `ProductionYardEntity` (`src/modules/production/yard/production-yard.entity.ts`)
- **Purpose**: تمثيل ساحات الإنتاج التشغيلية التابعة لأقسام الإنتاج، مع تحديد السعة الاستيعابية بوحدات الغرف (`1 Room = 1 Capacity Unit`).
- **Fields**:
  - `id`: varchar(36) UUID, Primary Key
  - `department_id`: varchar(36) UUID, NOT NULL, FK $\rightarrow$ `production_department.id`
  - `name`: varchar(100), NOT NULL
  - `code`: varchar(50), NOT NULL, UNIQUE (`UQ_production_yard_code`), Immutable
  - `capacity`: int, NOT NULL (`CHK_production_yard_capacity`: capacity >= 1)
  - `description`: text, NULL
  - `is_active`: tinyint(1), NOT NULL, default: 1
  - `created_at`: datetime(6), NOT NULL, default: CURRENT_TIMESTAMP(6)
  - `updated_at`: datetime(6), NOT NULL, default: CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
  - `deleted_at`: datetime(6), NULL (Soft Delete)
- **Relations**:
  - `department`: ManyToOne $\rightarrow$ `ProductionDepartmentEntity` (`department_id`, `onDelete: RESTRICT`, `onUpdate: CASCADE`, `eager: false`, `cascade: false`)
  - `engineerMappings`: OneToMany $\rightarrow$ `ProductionYardEngineerEntity` (`eager: false`, `cascade: false`)
- **Constraints / Indexes**:
  - `UQ_production_yard_code`: UNIQUE(`code`)
  - `IDX_production_yard_department_id`: INDEX(`department_id`)
  - `IDX_production_yard_is_active`: INDEX(`is_active`)
  - `IDX_production_yard_deleted_at`: INDEX(`deleted_at`)
  - `CHK_production_yard_capacity`: CHECK `(capacity >= 1)`
  - `FK_production_yard_department_id`: FOREIGN KEY (`department_id`) REFERENCES `production_department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE

---

### `production_department_engineer`
- **Entity**: `ProductionDepartmentEngineerEntity` (`src/modules/production/team/entities/production-department-engineer.entity.ts`)
- **Purpose**: تمثيل إسناد المهندس لقسم إنتاج تشغيلي محدد، مع حظر انتماء المهندس لأكثر من قسم في نفس الوقت (`user_id` فريد).
- **Fields**:
  - `id`: varchar(36) UUID, Primary Key
  - `department_id`: varchar(36) UUID, NOT NULL, FK $\rightarrow$ `production_department.id`
  - `user_id`: varchar(36) UUID, NOT NULL, UNIQUE (`UQ_production_department_engineer_user`), FK $\rightarrow$ `system_user.id`
  - `is_active`: tinyint(1), NOT NULL, default: 1
  - `created_at`: datetime(6), NOT NULL, default: CURRENT_TIMESTAMP(6)
  - `updated_at`: datetime(6), NOT NULL, default: CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
- **Relations**:
  - `department`: ManyToOne $\rightarrow$ `ProductionDepartmentEntity` (`department_id`, `onDelete: RESTRICT`, `onUpdate: CASCADE`, `eager: false`)
  - `user`: ManyToOne $\rightarrow$ `UserEntity` (`user_id`, `onDelete: RESTRICT`, `onUpdate: CASCADE`, `eager: false`)
  - `yardMappings`: OneToMany $\rightarrow$ `ProductionYardEngineerEntity` (`eager: false`, `cascade: false`)
- **Constraints / Indexes**:
  - `UQ_production_department_engineer_user`: UNIQUE(`user_id`)
  - `IDX_production_department_engineer_dept_id`: INDEX(`department_id`)
  - `IDX_production_department_engineer_is_active`: INDEX(`is_active`)
  - `FK_production_department_engineer_dept_id`: FOREIGN KEY (`department_id`) REFERENCES `production_department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
  - `FK_production_department_engineer_user_id`: FOREIGN KEY (`user_id`) REFERENCES `system_user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE

---

### `production_yard_engineer`
- **Entity**: `ProductionYardEngineerEntity` (`src/modules/production/team/entities/production-yard-engineer.entity.ts`)
- **Purpose**: جدول ربط الوسيط بين إسناد المهندس في القسم وساحات الإنتاج التابعة لنفس القسم المسندة لمسؤوليته.
- **Fields**:
  - `id`: varchar(36) UUID, Primary Key
  - `department_engineer_id`: varchar(36) UUID, NOT NULL, FK $\rightarrow$ `production_department_engineer.id`
  - `yard_id`: varchar(36) UUID, NOT NULL, FK $\rightarrow$ `production_yard.id`
  - `created_at`: datetime(6), NOT NULL, default: CURRENT_TIMESTAMP(6)
- **Relations**:
  - `departmentEngineer`: ManyToOne $\rightarrow$ `ProductionDepartmentEngineerEntity` (`department_engineer_id`, `onDelete: CASCADE`, `onUpdate: CASCADE`, `eager: false`)
  - `yard`: ManyToOne $\rightarrow$ `ProductionYardEntity` (`yard_id`, `onDelete: RESTRICT`, `onUpdate: CASCADE`, `eager: false`)
- **Constraints / Indexes**:
  - `UQ_production_yard_engineer_assignment`: UNIQUE(`department_engineer_id`, `yard_id`)
  - `IDX_production_yard_engineer_dept_eng_id`: INDEX(`department_engineer_id`)
  - `IDX_production_yard_engineer_yard_id`: INDEX(`yard_id`)
  - `FK_production_yard_engineer_dept_eng_id`: FOREIGN KEY (`department_engineer_id`) REFERENCES `production_department_engineer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
  - `FK_production_yard_engineer_yard_id`: FOREIGN KEY (`yard_id`) REFERENCES `production_yard`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE

---

## Architectural Rules

1. **User & Role Management & Security Invariants**:
   - حذف المستخدمين والأدوار يتم حصراً عبر الحذف الناعم (`Soft Delete`)؛ يُمنع الحذف الصلب (`Hard Delete`) نهائياً.
   - يُمنع إرجاع `passwordHash` في أي استجابات Backend (API أو Views أو List أو Detail).
   - تعطيل المستخدم أو أرشفته/حذفه ناعماً يؤدي تلقائياً إلى إلغاء كافة جلساته النشطة داخل Transaction (`Revoke Active Sessions`).
   - حماية الذات (`Self Protection`): لا يمكن للمستخدم تعطيل حسابه الحالي أو حذفه ناعماً أو تغيير دوره من خلال إدارة المستخدمين العامة.
   - حماية مدير النظام الأخير (`Last SYSTEM_ADMIN Protection`): يتم التحقق منها داخل نفس الـ Transaction الخاصة بالعملية، مع قفل سجلات مدراء النظام الفعالة عبر Database Pessimistic Write Lock (`setLock('pessimistic_write')`) لمنع حدوث أي Race Condition عند حدوث طلبات تعديل/تعطيل/حذف متزامنة.
   - ثبات الرمز التقني للدور: رمز الدور (`role.code`) هو معرّف تقني ثابت لا يمكن تعديله بعد الإنشاء.
   - حماية دور مدير النظام (`SYSTEM_ADMIN`): لا يمكن تعطيل دور مدير النظام أو حذفه ناعماً، وتُدار صلاحياته الأساسية تلقائياً عبر النظام (Seeds) ولا تُعدل من واجهة إسناد الصلاحيات (`SYSTEM_ADMIN_PERMISSIONS_MANAGED_BY_SYSTEM`).
   - منع تعطيل أو حذف الأدوار المستخدمة (Role in Use): لا يمكن تعطيل أو أرشفة/حذف أي دور طالما يوجد مستخدمون غير محذوفين مرتبطون به (`ROLE_HAS_ASSIGNED_USERS`).
   - بروتوكول قفل سجل الدور لمنع التزامن غير المتسق (`Role Lock Protocol`):
     - سجل الدور المستهدف في `system_role` هو نقطة التسلسل المركزية (`Serialization Point`) لجميع عمليات إسناد الأدوار ودورة حياة الأدوار.
     - كل عملية تسند دوراً لمستخدم (إنشاء مستخدم جديد `createUser` أو تعديل دور مستخدم `updateUser`)، وكل عملية تغير دورة حياة الدور (تعطيل الدور `updateRole` أو أرشفة الدور `softDeleteRole`)، يجب أن تنفذ داخل Transaction وتحصل على قفل تشاؤمي للكتابة (`setLock('pessimistic_write')`) على نفس سجل الدور المستهدف.
     - هذا البروتوكول يضمن رياضياً وتزامنياً استحالة وجود أي مستخدم غير محذوف مرتبط بدور معطل أو محذوف ناعماً تحت أي ظروف تزامن متوازية.
   - نطاق إدارة صلاحيات الدور: واجهة إدارة صلاحيات الأدوار تدير حالة تفعيل المنحة (`PermissionGrant.isActive`)، وتعدد قواعد الوصول (`0..N AccessRules`) بأثر `ALLOW` أو `DENY`، والنطاق الشامل `ALL`، والنطاقات التشغيلية والمحددة للأقسام والساحات وفق قيود سجل القدرات (`Capability Registry`)، ولا تدير المنح المباشرة للمستخدمين.
   - معالجة أخطاء فرادة المفاتيح في قاعدة البيانات: يتم التقاط أخطاء التزامن الخاصة بفرادة رقم الهاتف (`USER_PHONE_ALREADY_EXISTS`) وفرادة رمز الدور (`ROLE_CODE_ALREADY_EXISTS`) وتحويلها إلى أخطاء تضارب آمنة (`ConflictError` 409) دون إظهار استثناءات قاعدة البيانات الخام (500).
   - إخفاء العناصر والأزرار في واجهة المستخدم (`UI Visibility`) ليس بديلاً عن الصلاحيات الأمنية؛ يجب على الـ APIs التحقق الصارم من الصلاحيات.
   - فرادية رقم الهاتف (`Unique Phone`): يُمنع تكرار رقم الهاتف مع أي حساب موجود في النظام بما في ذلك الحسابات المحذوفة ناعماً.

2. **System Permission & Access Control Architecture (Implemented Phase 1 & Direct Permissions)**:
   - **المفاهيم الأساسية**:
     - **Authentication**: من هو المستخدم؟ (`Identity`)
     - **Authorization**: ماذا يستطيع المستخدم فعله؟ (`Permissions & Access`)
     - **Permission**: يحدد نوع العملية فقط (`WHAT`) مثل `system.user.view`، ولا يحتوي على نطاقات بيانات أو شروط.
     - **PermissionGrant**: يحدد المستفيد من المنحة (`WHO`) إما مستخدم محدد أو دور محدد (حصراً أحدهما عبر XOR constraint).
     - **AccessRule**: يحدد نطاق البيانات المتاح للمنحة (`WHICH DATA`) مع تحديد الأثر (`ALLOW` أو `DENY`).
   - **قواعد التقييم الفعال (Evaluation Rules)**:
     - **المصادر المدمجة**: تُجمع المنح المطبقة للمستخدم من مصدرين: منح دوره الأساسي (`Role Grants`) ومنحه المباشرة (`Direct User Grants`).
     - **التحقق من الصلاحية والفعالية**: تُستبعد أي منحة غير نشطة (`isActive = false`) أو منتهية زمنياً (`expiresAt <= now`) أو مرتبطة بصلاحية معطلة أو محذوفة ناعماً.
     - **قاعدة الحسم**: `(ALLOW 1 OR ALLOW 2 ...) AND NOT (DENY 1 OR DENY 2 ...)`.
     - **تفوق الرفض (`DENY ALL` wins)**: أي قاعدة `DENY ALL` على أي منحة مطبقة للمستخدم لنفس الصلاحية تلغي وتتفوق على أي `ALLOW ALL` قادمة من Role أو Direct Grant.
     - **الانغلاق الافتراضي (Fail Closed / Default Deny)**: غياب أي قاعدة `ALLOW ALL` نشطة يعني رفض الوصول مباشرة.
     - **النطاقات غير المدعومة**: النطاقات الفرعية (مثل `DEPARTMENT`, `YARD`) لا تمنح وصولاً شاملاً (`ALL`) في هذه المرحلة وتنغلق بأمان.
     - **عدم وجود استثناء لمدير النظام**: دور `SYSTEM_ADMIN` لا يمتلك أي Hardcoded Bypass، ويمر عبر نفس محرك الصلاحيات مستنداً إلى المنح والقواعد المعرفة في الـ Seed.
     - **فصل التفويض**: حقل `can_delegate` لا يؤثر على وصول المستخدم الحالي للعملية.

3. **User Role & Session Architecture**:
   - لكل مستخدم دور أساسي واحد فقط (`system_user.role_id` $\rightarrow$ `system_role.id`).
   - للمستخدم الواحد عدة جلسات نشطة في نفس الوقت (`system_user` $1 \rightarrow N$ `system_session`).
   - **قاعدة الأمان للـ Token**: الـ JWT الأصلي لا يُخزن مطلقاً داخل قاعدة البيانات، بل يُخزن `token_hash` فقط (SHA-256 بطول 64 محرفاً)، بينما يبقى الـ JWT الفعلي داخل HttpOnly Cookie.
   - **دورة حياة الجلسة (Session Lifecycle)**: تعتمد صلاحية الجلسة على `(is_active = true AND revoked_at IS NULL AND expires_at > now AND token_hash matches)`. لا يتم استخدام Soft Delete للجلسات للاحتفاظ بسجل تدقيق كامل.
   - بيانات الجهاز (`device_type`, `device_name`, `browser`, `os`, `user_agent`) هي بيانات وصفية للعرض وإدارة الأجهزة وليست مصدراً للثقة الأمنية.

4. **Authentication Flows (Implemented)**:
   - **تدفق تسجيل الدخول (Login Flow)**:
     `phone + password` $\rightarrow$ `DTO Validation (LoginDto)` $\rightarrow$ `Find User in DB` $\rightarrow$ `Verify Password (bcrypt compare)` $\rightarrow$ `Verify User Active` $\rightarrow$ `Generate Session UUID (sid)` $\rightarrow$ `Sign JWT (sub=userId, sid=sessionId, algorithm=HS256)` $\rightarrow$ `Compute Token Hash (SHA-256)` $\rightarrow$ `Create system_session in DB` $\rightarrow$ `Set HttpOnly Cookie (erp_session)` $\rightarrow$ `Return Safe User JSON`.
   - **تدفق الطلب الموثق (Authenticated Request Flow)**:
     `Request with HttpOnly Cookie (erp_session)` $\rightarrow$ `Extract JWT` $\rightarrow$ `Verify JWT Signature (Passport with algorithm HS256, issuer, audience)` $\rightarrow$ `Compute Token Hash (SHA-256)` $\rightarrow$ `Validate Session in DB (sid, sub, token_hash, isActive=true, revokedAt=null, expiresAt>now)` $\rightarrow$ `Validate User in DB (active, un-deleted)` $\rightarrow$ `Throttled Await touchSession (last_used_at)` $\rightarrow$ `Attach req.user (AuthPrincipal)` $\rightarrow$ `Set res.locals.user & No-Store Headers` $\rightarrow$ `Route Handler / Render / JSON`.
   - **تدفق تسجيل الخروج (Logout Flow)**:
     `POST /api/auth/logout (Protected)` $\rightarrow$ `Revoke Current Session (isActive=false, revokedAt=now, reason='LOGOUT')` $\rightarrow$ `Clear erp_session HttpOnly Cookie` $\rightarrow$ `Return Success JSON` $\rightarrow$ `Client Redirects to /login`.

5. **Data Integrity & Persistence**:
   - جميع المفاتيح الأساسية UUID v4.
   - جميع العلاقات `eager: false` و `cascade: false` (باستثناء حذف منحة الصلاحية الذي يحذف قواعد الوصول التابعة لها `CASCADE`).
   - الحذف الناعم (Soft Delete) عبر `deleted_at` للكيانات الأساسية (`Role`, `User`, `Permission`).
   - جميع تعديلات المخطط (Schema) تتم حصراً عبر الـ Migrations مع بقاء `synchronize: false`.

6. **Seed Architecture & Rules**:
   - كل Seeder ينتمي حصراً إلى الـ Module المالك للبيانات (`permission-grant` للـ Grants، و `access-rule` للـ Rules).
   - الـ Seed Runner مسؤول فقط عن تهيئة الاتصال وتنظيم تسلسل التنفيذ داخل Transaction.
   - الـ Seed Idempotent بالكامل ويعتمد على المفاتيح الطبيعية لمنع التكرار.
   - منع وجود أي كلمات مرور افتراضية (Fallback) في الكود، وإلزامية متغير البيئة عند إنشاء مدير النظام لأول مرة.
   - حماية كلمات مرور المستخدمين المنشئين مسبقاً من إعادة التعيين أثناء إعادة تشغيل الـ Seed.
   - استخدام ثوابت الصلاحيات من `SystemPermission` enum وثوابت الأدوار من `SystemRole` enum بدلاً من تكرار النصوص.
   - دور `SYSTEM_ADMIN` يحصل تلقائياً على جميع الصلاحيات النشطة عند تشغيل الـ Seed مع قواعد `ALLOW ALL`.

7. **Client Interaction & Views**:
   - صفحات الواجهة تعتمد على العرض من طرف الخادم (Server-rendered EJS pages).
   - التفاعل مع الواجهات البرمجية يتم باستخدام `native fetch` للعمليات التي تعتمد على JSON API.
   - استخدام `data-*` attributes والـ Event Delegation لمنع حقن نصوص المستخدم في JavaScript والوقاية من ثغرات Stored XSS.
   - المشروع لا يعتمد ولا يستخدم مكتبة HTMX.

8. **Graceful Shutdown**:
   - عند استقبال إشارات الإيقاف (`SIGINT`, `SIGTERM`)، يتم انتظار إغلاق خادم HTTP (`server.close()`) وتوقف استقبال الطلبات، ثم محاولة إغلاق اتصال قاعدة البيانات (`AppDataSource.destroy()`) بشكل مستقل حتى في حال فشل إغلاق خادم HTTP.
   - وجود حماية تمنع تنفيذ الإيقاف أكثر من مرة بالتوازي (`isShuttingDown` guard).
   - ضبط `process.exitCode` (0 عند النجاح، 1 عند وجود خطأ في أي مرحلة) بدلاً من الخروج القسري المباشر.

9. **Backend Validation Flow**:
   - `Route` $\rightarrow$ `validateDto(Dto)` $\rightarrow$ `Controller` $\rightarrow$ `Service`.
   - استخدام `class-validator` و `class-transformer`.
   - تنظيف وتجريد المدخلات النصية (`Trim via @Transform`) قبل تشغيل قواعد التحقق لمنع إدخال مسافات فارغة فقط.
   - عدم تكرار التحقق من الـ DTO داخل الـ Controllers.
   - عدم بناء استجابات HTTP مباشرة داخل وسيط التحقق، وتمرير الأخطاء عبر المعالج المركزي.
   - حظر ورفض أي حقول غير معرفة في الـ DTO تلقائياً.
   - منع استخدام `any` في تعريفات التحقق والـ Types.

10. **Known Follow-ups & Security Hardening**:
    - بناء محرك التفويض وتفويض الصلاحيات (Delegation Engine & canDelegate evaluation).
    - بناء واجهات إدارة الأجهزة والجلسات وخيار تسجيل الخروج من كافة الأجهزة (Logout all devices).

11. **Production Organizational & Concurrency Invariants**:
    - **الفصل التشغيلي**: أقسام الإنتاج وساحاته تتبع لتطبيق الإنتاج فقط، ومستقلة تماماً عن هيكل الموارد البشرية (HR) أو أي أقسام عامة في النظام.
    - **البيانات الديناميكية**: لا توجد Enums صلبة للأقسام أو الساحات، بل تُدار عبر قاعدة البيانات وتدعم التوسع المستقبلي.
    - **السعة الاستيعابية للساحات (`Yard Capacity`)**: السعة تمثل أقصى عدد من الغرف التي تستوعبها الساحة (`1 Room = 1 Capacity Unit`) كعدد صحيح موجب (`capacity >= 1`). لا يتم تخزين الإشغال الحالي أو السعة المتبقية كأعمدة في DB لتجنب تكرار البيانات.
    - **الحذف الناعم فقط**: حذف الأقسام والساحات يتم حصراً عبر الحذف الناعم (`Soft Delete` مع `deleted_at`).
    - **ثبات الرمز التقني**: الرمز التقني (`code`) لكل من القسم والساحة ثابت وغير قابل للتعديل بعد الإنشاء.
    - **بروتوكول قفل سجلات الإنتاج الموحد ومنع التعارضات (`Production Unified Lock Protocol & Deadlock Prevention`)**:
      - القاعدة الصارمة: يُمنع نهائياً طلب قفل سجل قسم (`Department`) بعد حيازة قفل سجل ساحة (`Yard`). ترتيب الأقفال دائماً `Department(s) -> Yard`.
      - لعمليات تعديل أو أرشفة الساحة (`updateYard`, `softDeleteYard`): قراءة استطلاعية للساحة، قفل الأقسام المعنية تشاؤمياً بترتيب تصاعدي حتمي لمعرفاتها لمنع التعارضات (`Deadlocks`)، ثم قفل سجل الساحة تشاؤمياً وإعادة التحقق من مطابقة التبعية (`PRODUCTION_YARD_CONCURRENTLY_CHANGED`).
      - لعمليات إنشاء الساحة (`createYard`): قفل القسم التابع تشاؤمياً ثم التحقق وإنشاء الساحة.
      - لعمليات إنشاء قسم جديد (`createDepartment`): قفل سجل المستخدم المرشح للرئاسة (`User row` via `pessimistic_write`) ثم إنشاء القسم.
      - لعمليات فريق العمل (`Production Team Operations`): `Department -> User -> Assignment -> Yards (sorted) -> Mutations`.
      - تعطيل قسم إنتاج مشروط بعدم امتلاكه أي ساحات نشطة غير محذوفة (`PRODUCTION_DEPARTMENT_HAS_ACTIVE_YARDS`).
      - أرشفة قسم إنتاج مشروطة بعدم امتلاكه أي ساحات غير محذوفة سواء كانت نشطة أو معطلة (`PRODUCTION_DEPARTMENT_HAS_YARDS`) وبعدم وجود مهندسين نشطين (`PRODUCTION_DEPARTMENT_HAS_ENGINEERS`) مع تحرير رئيس القسم تلقائياً (`headUserId = null`).

---

12. **Inventory Product Catalog & Category Tree Invariants**:
    - **نطاق الكتالوج (Master Data Scope)**: يقتصر الموديول حصراً على البيانات المرجعية للمواد والمنتجات ووحدات القياس وشجرة الفئات. لا يشمل مستودعات أو أرصدة أو حركات أو تكاليف أو قوالب. حقل locationName نص وصفي اختياري فقط.
    - **شجرة الفئات الهرمية (Category Hierarchy)**: تعتمد قائمة الجوار (Adjacency List) مع حظر الحلقات الدائرية (Cycles) والارتباط الذاتي (Self-Parenting). في حال مواجهة فئة مفقودة أو محذوفة أو حلقة أثناء تتبع الأسلاف يفشل النظام مغلقاً (Fail Closed) مع INVENTORY_CATEGORY_HIERARCHY_INCONSISTENT.
    - **قيود تعطيل وأرشفة الفئات**: لا يمكن تعطيل أو أرشفة أي فئة تمتلك أي فئات فرعية غير محذوفة (سواء كانت نشطة أو معطلة) أو أي منتجات غير محذوفة (سواء كانت نشطة أو معطلة) (INVENTORY_CATEGORY_HAS_CHILDREN و INVENTORY_CATEGORY_HAS_PRODUCTS).
    - **ثبات وفرادة الرموز التقنية والباركود**: رموز الفئات والمنتجات فريدة عالمياً بما يشمل السجلات المؤرشفة ناعماً (withDeleted: true) وثابتة وغير قابلة للتعديل بعد الإنشاء، وتخضع لنمط تحقق صارم (/^[A-Z][A-Z0-9_-]*$/). الباركود فريد عالمياً بما يشمل السجلات المؤرشفة.
    - **معالجة تعارضات القيود الفريدة في MySQL**: يتم اعتراض أخطاء ER_DUP_ENTRY (errno 1062) وتحويلها إلى ConflictError مناسب بدقة بناءً على القيد المنتهك (UQ_inventory_category_code, UQ_inventory_product_code, UQ_inventory_product_unit_barcode, UQ_inventory_product_unit_product_name).
    - **سلامة الوحدة الأساسية (Base Unit Integrity Invariant)**: كل منتج غير محذوف يمتلك وحدة أساسية واحدة مرتبطة به ذرياً وغير محذوفة وتتبع لنفس المنتج (assertProductBaseUnitIntegrity). لا يمكن حذف الوحدة الأساسية ولا تعديل معادلة تحويلها.
    - **سلسلة تحويل الوحدات (Unit Conversion Chain)**: كل وحدة إضافية يجب أن ترتبط بوحدة مقابلة تنتمي لنفس المنتج، وتخضع لتحقق صارم يمنع الحلقات الدائرية ويضمن انتهاء السلسلة حتماً بالوحدة الأساسية. أي انقطاع يفشل مغلقاً (INVENTORY_PRODUCT_UNIT_CONVERSION_INCONSISTENT).
    - **دقة الحقول العشرية (Decimal Precision & Scale)**: السعر price يطابق DECIMAL(18,4) (غير سالب، بحد أقصى 14 خانة صحيحة و4 خانات عشرية)، ومعامل التحويل conversionQuantity يطابق DECIMAL(18,6) (أكبر تماماً من الصفر، بحد أقصى 12 خانة صحيحة و6 خانات عشرية).
    - **قفل سجلات المنتجات والوحدات**: كل عملية تعديل أو إضافة أو حذف لوحدات المنتج تبدأ بقفل سجل المنتج تشاؤمياً (pessimistic_write) كجذر قفل.
    - **سلامة واجهات الإدارة (UI Invariants)**: شجرة الفئات تدعم التصفح والتحميل الموضعي (Load More Pagination) دون اقتطاع صامت. واجهات التعديل تحافظ على العلاقات الحالية المعطلة وتمنع فقدانها عند الحفظ. العمليات غير الآمنة تستخدم حصراً window.erpFetch.

---

## Implemented Infrastructure

- Dynamic Production Access Scopes & Row-Level Authorization Infrastructure (`src/modules/production/authorization/`).
- Request-Level Authorization Context & WeakMap Caching (`src/modules/production/authorization/production-authorization-context.ts`).
- Production Responsibility Resolver (`src/modules/production/authorization/production-responsibility.resolver.ts`).
- Production Access Policy Service with DENY-precedence and Fail-Closed Resolution (`src/modules/production/authorization/production-access-policy.service.ts`).
- Resource-Specific SQL Query Translation Helper for QueryBuilder Scoping (`src/modules/production/authorization/production-access-query.helper.ts`).
- Production Authorization Middleware (`src/modules/production/authorization/production-authorization.middleware.ts`).
- Production Team Assignments Module (`src/modules/production/team/`).
- Production Team Service with Ordered Lock Protocol and Mutually Exclusive Responsibility Enforcement (`src/modules/production/team/production-team.service.ts`).
- Production Organizational Structure Module (`src/modules/production/department/`, `src/modules/production/yard/`).
- Production Department Service with Yard Aggregations, Lock Protocol, and Invariants (`src/modules/production/department/production-department.service.ts`).
- Production Yard Service with Positive Capacity Invariant, Department Locking, and Invariants (`src/modules/production/yard/production-yard.service.ts`).
- Production API & Web Controllers with EJS Views & Native Fetch Client Scripts (`src/public/js/production-departments.js`, `src/public/js/production-yards.js`).
- Centralized Direct User Permissions Management Module (`src/modules/system/user/user-permission.service.ts`).
- Centralized Role Management & Permission/Access Rule Administration (`src/modules/system/role/`, `src/modules/system/permission/`).
- Role Service with Assignment Count, Pessimistic Lock Protocol, Code Immutability, and Safe Description Handling (`src/modules/system/role/role.service.ts`).
- Role Permission & Access Rule Administration Service (`src/modules/system/role/role-permission.service.ts`).
- Permission Lookup Service (`src/modules/system/permission/permission.service.ts`).
- Centralized User Management Module (`src/modules/system/user/`).
- User Service with Concurrency Phone Uniqueness Hardening, Pessimistic Locking on Role Assignment and Invariants (`src/modules/system/user/user.service.ts`).
- Centralized Authorization Module (`src/modules/system/authorization/`).
- Permission Evaluation Service `AuthorizationService` (`src/modules/system/authorization/authorization.service.ts`).
- Route Authorization Middleware `requirePermission` (`src/modules/system/authorization/authorization.middleware.ts`).
- Full Authentication Module (`src/modules/system/auth/`).
- Database Session Service (`src/modules/system/session/session.service.ts`).
- Passport JWT Authentication Strategy & Cookie Extractor with HS256 restriction (`src/bootstrap/passport.bootstrap.ts`, `passport-jwt.strategy.ts`).
- Route Protection Middlewares (`requireWebAuth`, `requireApiAuth`, `redirectIfAuthenticated`).
- Generic Validated Query Middleware (`src/common/middleware/validate-query-dto.middleware.ts`) & Type Augmentation (`src/common/types/express.d.ts`).
- Generic UUID Param Validation Middleware (`src/common/middleware/validate-uuid-param.middleware.ts`).
- Standardized `ConflictError` (HTTP 409), `BusinessRuleError` (HTTP 400), `UnauthorizedError` (HTTP 401), and `ForbiddenError` (HTTP 403).
- Token Hashing Utility (`src/common/security/token-hash.util.ts`).
- System Modules Organization (`auth`, `authorization`, `permission`, `permission-grant`, `access-rule`, `role`, `session`, `user`).
- System Session Data Model & Migration (`SessionEntity`, `system_session`).
- Initial System Seed Data & Runner (`npm run seed`).
- Password Hashing & Comparison Utilities (`src/common/security/password.util.ts`).
- Migrations:
  - `1710000000000-CreateSystemCoreTables.ts`
  - `1710000000001-CreateSystemSessionTable.ts`
  - `1710000000002-CreateProductionDepartmentsAndYards.ts`
  - `1710000000003-CreateProductionTeamAssignments.ts`
  - `1710000000004-CreateInventoryCategories.ts`
  - `1710000000005-CreateInventoryProductsAndUnits.ts`
  - `1710000000006-HardenInventoryCatalogConstraints.ts`
- Centralized DTO Validation Middleware (`src/common/middleware/validate-dto.middleware.ts`).
- Standardized `ValidationError` representation (`src/common/errors/validation.error.ts`).
- Centralized Error Handling (`AppError`, `errorHandlerMiddleware`).
- Standardized typed `ApiResponse` for API endpoints.
- EJS + `express-ejs-layouts` server-rendered views with Bootstrap validation.
- Static assets serving (`src/public`).
- Client scripts (`src/public/js/app.js`, `src/public/js/login.js`, `src/public/js/users.js`, `src/public/js/roles.js`, `src/public/js/user-permissions.js`, `src/public/js/production-departments.js`, `src/public/js/production-yards.js`, `src/public/js/inventory-categories.js`, `src/public/js/inventory-products.js`).
- TypeORM MySQL connection and robust graceful shutdown.
- Inventory Product Catalog Module (`src/modules/inventory/category/`, `src/modules/inventory/product/`).
- Inventory Category Service with Fail-Closed Ancestry Cycle Check, Deactivation Restrictions, and Unique Race Handling (`src/modules/inventory/category/inventory-category.service.ts`).
- Inventory Product Service with Atomic Base Unit Creation, Asserted Base Unit Integrity Helper, Conversion Chain Traversal, Pessimistic Locking, and MySQL Duplicate Key Mapping (`src/modules/inventory/product/inventory-product.service.ts`).
- Inventory Catalog Test Suite covering DTO validation, precision boundaries, and domain invariants (`tests/inventory-catalog.test.ts`).
- Production Template Core Hardening Test Suite covering architecture, permissions, DTOs, consecutive grouping, inventory reference fail-closed invariants, and XSS safety (`tests/production-template.test.ts`).
- Migrations:
  - `1710000000000-CreateSystemCoreTables.ts`
  - `1710000000001-CreateSystemSessionTable.ts`
  - `1710000000002-CreateProductionDepartmentsAndYards.ts`
  - `1710000000003-CreateProductionTeamAssignments.ts`
  - `1710000000004-CreateInventoryCategories.ts`
  - `1710000000005-CreateInventoryProductsAndUnits.ts`
  - `1710000000006-HardenInventoryCatalogConstraints.ts`
  - `1710000000007-CreateStudiesTemplateCoreTables.ts`
  - `1710000000008-MigrateStudiesToProductionTemplateTables.ts`

---

13. **Production Template Core Hardening & Architectural Invariants**:
    - **التصحيح المعماري الأساسي (Application Boundary Correction)**:
      - نقل قوالب التصنيع لتكون جزءاً أصيلاً من تطبيق الإنتاج (`Production Application`) تحت `src/modules/production/` بدلاً من تطبيق مستقل باسم Studies. قسم الدراسات هو مالك وظيفي (`Business Owner`) وليس مساحة تقنية مستقلة.
      - إزالة كافة الآثار الفنية القديمة لموديول الدراسات بالكامل: حذف مجلدات `src/modules/studies/` و `src/views/dashboard/studies/` وملفات الأصول `src/public/css/studies.css` و `src/public/js/studies-*.js` ومسارات `/studies/templates`.
      - المسارات المعتمدة حصراً: Web `/production/templates` و API `/api/production/templates`.
    - **التقسيم إلى 4 Submodules مستقلة ومفصولة**:
      - `src/modules/production/template/`: الكيان الرئيسي للقالب والبيانات الوصفية وأبعاد الغرفة.
      - `src/modules/production/template-specification/`: المواصفات الفنية الملحقة بالقالب وترتيبها.
      - `src/modules/production/template-stage/`: مراحل التصنيع وترتيبها الكثيف وتجميع الأقسام المتتالية.
      - `src/modules/production/template-stage-material/`: المواد المخططة لكل مرحلة مع الكميات والوحدات.
    - **بروتوكول الأقفال التشاؤمية لمنع التعارضات (Pessimistic Locking Concurrency Protocol)**:
      - استخدام قفل تشاؤمي حصري للكتابة (`pessimistic_write`) على سجل القالب الرئيسي `ProductionTemplateEntity` داخل Transactions لكافة عمليات إضافة أو إعادة ترتيب أو أرشفة المراحل والمواصفات لضمان التسلسل ومنع Race Conditions والتسلسل الكثيف (1..N).
    - **حدود الوحدات الأخرى والتحقق المنغلق أمنياً (Cross-Module Boundaries & Fail-Closed Validation)**:
      - التعامل مع أقسام الإنتاج حصراً عبر `ProductionDepartmentService.validateDepartmentForStage`.
      - التعامل مع كتالوج المواد حصراً عبر `InventoryProductReferenceService` دون استعلام مباشر لكيانات المواد:
        - `searchProductReferences`: إرجاع بيانات مرجعية مقلصة فقط للمنتجات النشطة.
        - `getProductUnitReferences`: إرجاع الوحدات الصالحة مع التحقق من سلامة الوحدة الأساسية.
        - `validatePlannedMaterialUnit`: التحقق المنغلق أمنياً من وجود ونشاط المنتج، سلامة الوحدة الأساسية ذرياً، تبعية الوحدة المختارة لنفس المنتج، وخلو سلسلة التحويل من الحلقات الدائرية وانتهاؤها حتماً بالوحدة الأساسية.
    - **صلاحيات وقدرات الوصول (Permissions & Capability Registry)**:
      - تسجيل الصلاحيات: `production.template.view`, `production.template.create`, `production.template.update`, `production.template.delete`.
      - تسجيلها في `AccessScopeCapabilityRegistry` لدعم قالب `ALL` فقط، مع بقاء أي صلاحية غير مسجلة فاشلة مغلقة (`[]`).
    - **حماية الواجهات من حقن النصوص (Stored XSS Hardening & Safe JSON Serialization)**:
      - استخدام `safeJsonStringify` لتشفير المحارف الخاصة (`<`, `>`, `&`, Line Terminators) داخل جزر السكربت الآمنة `<script type="application/json">` بدلاً من البيانات النصية المباشرة في الـ DOM.
    - **تطابق الصلاحيات في واجهة المستخدم (UI Permission Parity)**:
      - ربط تعديل المرا والمواد وحذف المراحل بصلاحية التحديث `production.template.update`.
      - ربط أرشفة القالب بصلاحية الحذف `production.template.delete`.
