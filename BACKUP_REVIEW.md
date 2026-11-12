# Sanitized backup review

Date: 2026-11-10

## Scope

This snapshot contains generic source, schema migrations, synthetic tests, placeholder configuration, and neutral SVG artwork. Original organization identifiers, known staff names, internal network addresses, and operational documents were removed or replaced. Initial department review checklists are generic examples. No original repository ancestry is included.

Environment files, database contents, uploads, build output, dependencies, private keys and runtime logs are excluded. Third-party license notices and public service URLs remain. The project is a personal code backup, without a new project-wide open-source license.

## Verification

- Frontend production build and type checking passed.
- Backend TypeScript checking passed.
- Frontend tests: 126 passed, 22 failed (148 total).
- Backend tests: 327 passed, 17 failed (344 total).
- With no private environment loaded, the source baseline has the same failures; no additional failing test names were found. Integration tests requiring a configured database were not run for this snapshot.
- Known organization/person terms, credential patterns, internal IP patterns, and exact sensitive environment values were scanned. Public model endpoint matches were reviewed as public service URLs. This is a targeted review, not a guarantee that automated scanning detects every possible sensitive value.

## Existing test failures

- Frontend: application validates narrative and charter alternative before emitting payload
- Frontend: retry retains original reviewer ids and restores uploaded charter metadata
- Frontend: inactive original reviewers can be replaced instead of trapping the form
- Frontend: peer reviewer requires opinion and transfer candidates exclude requester, GM and assigned people
- Frontend: desktop task detail hides completed return action while closure is frozen
- Frontend: report uses the same escaped document in a script-disabled sandbox
- Frontend: scripts\test-combined-progress.cjs
- Frontend: approval history renders collapsible project headings and nested records
- Frontend: pending project groups render in visible HTML rather than an inert native template
- Frontend: counts match pending inbox and approval subset; visiting retains count and fades only that menu
- Frontend: Shanghai midnight restores highlights for unchanged items until visited again
- Frontend: new identities light up even when count stays unchanged; completion clears count
- Frontend: seen state survives remount and does not leak between users or accept stale responses
- Frontend: project owner sees progress entry and submission after starting
- Frontend: weekly link opens the target form while other projects retain their real tasks
- Frontend: consumed weekly link stays unfiltered on reload and preserves task focus and unrelated query
- Frontend: an explicit project filter only shows its project; clearing restores the others
- Frontend: an explicitly selected empty project remains available to add its first task
- Frontend: task status and assignee filters do not backfill nonmatching projects as empty
- Frontend: focus-only links and department filters keep their existing scope
- Frontend: all approval kinds share the inbox and confirmation keeps its task detail link
- Frontend: all includes approvals, acceptance, execution and notices; projects and pending applications do not inflate count
- Backend: reviewed cards leave the pending inbox and open the exact result
- Backend: closure card result retains the original application after approval-center delivery
- Backend: real mentions remain interactive, disabled mentions explicitly name the owner
- Backend: concerns without an owner have no leftover separator
- Backend: administrator can apply on behalf of the owner without bypassing review or changing ownership
- Backend: unrelated ordinary users and leaders cannot apply for closure
- Backend: owner submission freezes, stays active until approval, duplicate submission rejected
- Backend: pending plan change and missing reviewer prevent submission
- Backend: only assigned reviewer can approve, not owner or unrelated admin
- Backend: approval locks project and snapshots report once; waiting is based on application facts
- Backend: changed completion evidence cannot be approved
- Backend: a changed earlier task cannot hide behind unchanged latest completion time
- Backend: rejection requires reason and restores editable state without report
- Backend: visitor approval history has global filters, without participation checks
- Backend: project owner can submit with progress but cannot bypass the progress requirement
- Backend: task result and confirmation cards identify the exact task, not just its project
- Backend: Friday 16:00 Beijing; current week only, successful group delivery deduplicates

## Incremental review — 2026-11-12

- Added a pre-submission closure report preview. Preview uses the existing report renderer and validation, creates no application, freeze, draft deletion, or notification.
- The pending task action uses the same breathing-light style as project management.
- Sanitized source audit: 420 tracked source and test files; no findings. No organization-domain, known staff-name, or private-network matches were found in the sanitized checkout.
- Backend and frontend production builds passed. Focused closure tests passed (31 backend workflow tests, 31 report tests, and 3 frontend preview tests).
