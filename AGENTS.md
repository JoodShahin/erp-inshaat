# ERP Inshaat — Project Engineering Rules

Read this file before editing the repository, and follow the existing code in the affected module.

## Architecture and consistency
- Preserve the existing **modular monolith** architecture: TypeScript / Node.js / Express, TypeORM / MySQL-compatible database, server-rendered EJS and vanilla JavaScript/CSS.
- Keep changes in the existing `src/modules/<domain>/` organization, using established **entity → DTO/validation → service → controller → route** boundaries. Reuse existing services, entities and permission checks; do not introduce parallel implementations.
- Match the codebase conventions for errors, transactional updates, revisions, version ordering, soft deletion, idempotency and permission enforcement. Avoid broad refactors for small fixes.
- Preserve the Arabic RTL interface and accessibility. Test responsive UI behavior, particularly mobile layouts.
- Prefer a minimal, focused change accompanied by relevant unit or real integration regression tests.

## Production template and room versioning
- Only the **latest active template version** can be edited. Every historical version is read-only, even if it has no associated room.
- Whether the latest version requires versioning depends on whether a **physical production unit/room was created from that specific version**, not whether any room has ever used the template in another version.
- Determine this through the existing production unit → execution plan → production order line relationship and the order line's `template_version_id`. A memorandum/order line or plan with no real unit is not room usage. Historical (soft-deleted/cancelled) units still count for their source version.
- If no room has ever used the latest version, **all edits remain in that same version**, regardless of edit classification or an explicit NEW_VERSION choice; do not display a version-choice dialog.
- After a room has used the latest version: STRUCTURAL edits must fork a version automatically; MINOR edits offer the choice between modifying latest in place and creating a new version.
- Never alter already snapshotted production plans/rooms when changing a template. Maintain historical attachment retention and existing authorization safeguards.
- Preview, commit and legacy routes must enforce the **same version-specific rule** server-side; do not rely on UI-only guards.

## Testing, safety and source control
- Never run test suites, migrations or seeds against the real `erp_db1` database. Integration tests use the dedicated `erp_inshaat_test` database with the project's existing test safety guards.
- Before proposing a merge, require successful typecheck, unit tests, build and dedicated-DB integration tests. Do not report unrun tests as passing.
- Modify the active feature branch, keep commits scoped, and **do not merge into main without explicit authorization**.
- Read project-specific guidance and surrounding implementation before **every** change, then inspect the resulting diff and test the affected behavior.
