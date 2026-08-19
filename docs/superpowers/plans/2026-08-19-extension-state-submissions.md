# State and Submission Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development and complete each checkbox with focused tests, self-review, spec review, and quality review.

**Goal:** Make review/study state durable and deterministic, and ensure every post-submit/Notion mutation targets one exact LeetCode submission with complete set/clear semantics.

**Architecture:** Put review and study mutations behind a versioned transactional JSON store, compute one study snapshot per refresh, and coordinate review/study through one session controller. Resolve one submission identity before invoking side effects, retain authoritative IDs in the extension host, and accept only validated editable fields from webviews.

**Tech Stack:** TypeScript, VS Code Extension API, Node built-in test runner, existing Rolldown/TypeScript toolchain, `ts-fsrs`.

---

## Task 1: Add the dependency-free regression harness

- [ ] Create `tsconfig.test.json` to emit testable CommonJS modules into `out-test/`.
- [ ] Create `scripts/run-tests.mjs` to compile/discover `test/**/*.test.cjs` and invoke `node --test`.
- [ ] Add only `test` to `package.json`; do not change dependency versions or licensing files.
- [ ] Add a smoke test proving discovery and failure propagation.
- [ ] Run `rtk npm test` and `rtk npm run typecheck`.
- [ ] Commit as `test: add dependency-free unit test harness`.

## Task 2: Add transactional versioned JSON storage

**Files:** create `src/state/versionedJsonStore.ts`, `test/state/versionedJsonStore.test.cjs`; modify `src/reviews/reviewStorage.ts`, `src/reviews/types.ts`, `src/study/studyStorage.ts`, `src/study/types.ts`.

- [ ] Write failing tests for concurrent mutations, unique temp names, stale/fresh locks, malformed versions, mutator failure, cleanup, and read-only reads.
- [ ] Implement `VersionedJsonStore<T>.read()` and `.transaction(mutator)` with in-process serialization, exclusive lock creation, stale-lock recovery, reread-after-lock, strict parse/validation, same-directory unique temp files, atomic rename, and `finally` cleanup.
- [ ] Export strict nested review/study parsers with actionable paths.
- [ ] Replace public load/save mutation paths with read/transaction interfaces.
- [ ] Run `rtk npm test -- test/state/versionedJsonStore.test.cjs` and `rtk npm run typecheck`.
- [ ] Commit as `fix(state): add transactional versioned JSON storage`.

## Task 3: Serialize review/study services and materialize one daily plan

**Files:** modify `src/reviews/reviewService.ts`, `src/study/studyService.ts`, `src/study/studyTreeDataProvider.ts`, `src/utils/settingUtils.ts`, `package.json`; create `test/reviews/reviewService.test.cjs`, `test/study/studyService.test.cjs`.

- [ ] Test parallel ratings/snapshot changes and backlog additions/deferrals retaining both updates.
- [ ] Test `addAndApplyRating` increments FSRS exactly once and unrelated edits never invoke rating.
- [ ] Make services injectable with storage and clock while preserving extension singletons.
- [ ] Add atomic `addAndApplyRating`, `ensureInitiallyScheduled`, `scheduleAt`, and `removeProblem` operations.
- [ ] Implement `StudyService.refresh()` as the only plan-writing method; derive Today, Backlog, and filter summaries from one returned snapshot.
- [ ] Reapply active filters to existing planned items, remove missing/deferred items, then refill deterministically.
- [ ] Normalize limits to finite nonnegative integers and declare the setting as `integer`.
- [ ] Test one first-refresh write, zero read writes, filter changes, deferral, concurrent additions, and limits `-1`, `0`, `2.7`, and `NaN`.
- [ ] Run `rtk npm test -- test/reviews/reviewService.test.cjs test/study/studyService.test.cjs`, `rtk npm run typecheck`, and `rtk npm run lint`.
- [ ] Commit as `fix(state): serialize review and study mutations`.

## Task 4: Make backlog-to-review transfers recoverable

**Files:** create `src/study/backlogTransfer.ts`, `test/study/backlogTransfer.test.cjs`; modify `src/study/commands.ts`, `src/reviews/commands.ts`.

- [ ] Test review-creation failure leaves backlog untouched.
- [ ] Test backlog deletion failure leaves a recoverable duplicate and retry does not re-rate.
- [ ] Reuse one initial-rating picker.
- [ ] Schedule the review idempotently before deleting backlog.
- [ ] Continue the study session only after successful removal; ensure the just-completed item is not immediately due.
- [ ] Run `rtk npm test -- test/study/backlogTransfer.test.cjs` and `rtk npm run typecheck`.
- [ ] Commit as `fix(study): make review transfers recoverable`.

## Task 5: Coordinate review and study sessions

**Files:** create `src/sessions/sessionState.ts`, `test/sessions/sessionState.test.cjs`; modify `src/reviews/commands.ts`, `src/study/session.ts`, `src/study/commands.ts`, `src/extension.ts`, `package.json`.

- [ ] Test mutual exclusion, Stop, completed-session cleanup, and correct continuation routing.
- [ ] Remove independent module booleans and use one `SessionState` with `review | study | undefined`.
- [ ] Register `leetnotion.stopSession`, context keys, and title menu visibility for both views.
- [ ] Clear session state on empty/completed/cancelled flows and deactivation.
- [ ] Run `rtk npm test -- test/sessions/sessionState.test.cjs`, `rtk npm run typecheck`, `rtk npm run lint`, and `rtk npm run compile`.
- [ ] Commit as `fix(sessions): coordinate review and study sessions`.

## Task 6: Resolve source identity and correlate the exact new submission

**Files:** create `src/submissions/types.ts`, `src/submissions/submissionCorrelation.ts`, `test/submissions/submissionCorrelation.test.cjs`, `test/utils/toolUtils.test.cjs`; modify `src/utils/toolUtils.ts`, `src/leetCodeClient.ts`.

- [ ] Test custom filenames via the `@lc ... id=` marker.
- [ ] Test rejection of stale, other-problem, and same-problem/different-code submissions.
- [ ] Before CLI submit, capture the source ID/code, baseline IDs, expected slug, and start time.
- [ ] Poll the problem-specific API and accept only a new matching slug/time whose detail code matches normalized submitted code.
- [ ] Return a typed `ValidatedSubmission`; timeout with a diagnostic rather than guessing.
- [ ] Run `rtk npm test -- test/submissions/submissionCorrelation.test.cjs test/utils/toolUtils.test.cjs` and `rtk npm run typecheck`.
- [ ] Commit as `fix(submit): correlate the exact LeetCode submission`.

## Task 7: Use one validated submission throughout the workflow

**Files:** modify `src/commands/submit.ts`, `src/types.ts`, `src/webview/leetCodeSubmissionProvider.ts`, `src/leetnotionClient.ts`, `src/modules/leetnotion/converter.ts`; create `test/submissions/submitWorkflow.test.cjs`.

- [ ] Test view and Notion receive the same submission ID/object.
- [ ] Test rejected or uncorrelated results never upload.
- [ ] Remove every post-submit global `getRecentSubmission()` lookup.
- [ ] Derive acceptance from validated detail, not output-string matching.
- [ ] Always reach the final explorer refresh, including custom filenames and correlation failures.
- [ ] Run `rtk npm test -- test/submissions/submitWorkflow.test.cjs`, `rtk npm run typecheck`, and `rtk npm run compile`.
- [ ] Commit as `fix(notion): sync only the validated submission`.

## Task 8: Validate property saves and implement complete set/clear semantics

**Files:** create `src/webview/submissionMessages.ts`, `test/webview/submissionMessages.test.cjs`, `test/notion/submissionProperties.test.cjs`; modify `src/types.ts`, `src/webview/leetCodeSubmissionProvider.ts`, `src/webview/leetnotionEngine.ts`, `src/leetnotionClient.ts`, `public/scripts/script.js`.

- [ ] Define `unchanged | clear | date | rating` review edits and a strict runtime parser.
- [ ] Reject forged IDs, unknown commands, invalid dates/ratings, oversized notes, and invalid/duplicate tags.
- [ ] Keep question/page/submission IDs extension-side.
- [ ] Always write current notes, flag, Optimal, and complete tag arrays, including empty/false/white states.
- [ ] Make review date/rating mutually exclusive in both UI and backend; clear uses Notion null plus local review removal.
- [ ] Return and install authoritative saved state after success; clear one-shot rating/date inputs.
- [ ] Test A→B→A tags, Optimal true→false, note/flag clearing, review clearing, and notes-only save after rating not re-rating.
- [ ] Run `rtk npm test -- test/webview/submissionMessages.test.cjs test/notion/submissionProperties.test.cjs`, `rtk npm run typecheck`, `rtk npm run lint`, and `rtk npm run compile`.
- [ ] Commit as `fix(notion): validate and refresh submission properties`.

## Task 9: Make bulk import tolerant and truthful

**Files:** create `src/submissions/bulkImport.ts`, `test/submissions/bulkImport.test.cjs`; modify `src/leetnotionManager.ts`, `src/leetnotionClient.ts`.

- [ ] Validate root/rows and safely tolerate blank or malformed Notion rich text.
- [ ] Return actual counts for added, existing, malformed, and missing-question rows.
- [ ] Increment progress only after creation and report partial completion accurately on cancellation.
- [ ] Test mixed malformed input, empty rich text, missing mappings, zero-added runs, and final messages.
- [ ] Run `rtk npm test -- test/submissions/bulkImport.test.cjs` and all stream verification.
- [ ] Commit as `fix(notion): report bulk submission imports accurately`.

## Task 10: Make Explorer refresh generation-safe

**Files:** create `src/explorer/refreshCoordinator.ts`, `test/explorer/refreshCoordinator.test.cjs`; modify `src/explorer/explorerNodeManager.ts`, `src/explorer/LeetCodeTreeDataProvider.ts`.

- [ ] Write failing tests for overlapping status/timer/manual/submit refreshes, proving consumers never see an empty intermediate map and an older generation never replaces a newer one.
- [ ] Build the complete node map in a local snapshot, then atomically swap only the latest requested generation.
- [ ] Coalesce redundant refresh requests while one generation is running and issue one tree event for the installed snapshot.
- [ ] Preserve the last good tree when a refresh fails and emit the existing diagnostic.
- [ ] Run `rtk npm test -- test/explorer/refreshCoordinator.test.cjs`, `rtk npm run typecheck`, and `rtk npm run lint`.
- [ ] Commit as `fix(explorer): publish refreshes atomically`.

## Stream verification

- [ ] `rtk npm test`
- [ ] `rtk npm run typecheck`
- [ ] `rtk npm run lint`
- [ ] `rtk npm run compile`
- [ ] `rtk git diff --check`
- [ ] Confirm no dependency version or licensing-file change.
