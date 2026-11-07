# ERP Inshaat — Agent Entry Point

The **authoritative, always-on project rules** are in `.agents/rules/`. Read **all four files** before each implementation task:

1. `.agents/rules/rule1.md` — core engineering architecture and conventions.
2. `.agents/rules/rule2.md` — security, module rules, testing, minimal changes, and mandatory `work.md` maintenance.
3. `.agents/rules/rule3.md` — shared UI and interaction guidelines.
4. `.agents/rules/ui-design-rules.md` — approved UI design system.

Also read `PROJECT_OVERVIEW.md`, `work.md`, and the current source files that will be changed. Use `rule1.md` as the project's canonical engineering rule document (the standalone `PROJECT_RULES.md` is not present).

This entry point adds **no alternative rules**. If any guidance here appears different from `.agents/rules/`, the original files in `.agents/rules/` take precedence.

Before completing a change: run relevant validation/tests, update the current-state technical map in `work.md` within the same task, and report any unrun checks. Never run tests against `erp_db1`; never merge without explicit approval.
