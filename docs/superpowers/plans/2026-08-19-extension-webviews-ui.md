# Webview Security and UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development and complete each checkbox with focused tests, self-review, spec review, and quality review.

**Goal:** Remove executable-content boundaries, make long-form problem content comfortable to read, wire submission history, and correct accessibility/profile behavior.

**Architecture:** Centralize nonce CSP, escaping, sanitization, URL allowlisting, and runtime message parsing. Render pure HTML models with delegated opaque-ID actions; authoritative values live in providers. Extract profile and history computations into pure testable modules.

**Tech Stack:** TypeScript, VS Code webviews, Node built-in tests, Markdown-it, first-party bundled browser scripts.

---

## Task 1: Add trusted webview primitives

**Files:** create `src/webview/webviewSecurity.ts`, `src/webview/webviewMessages.ts`, `test/webview/webviewSecurity.test.cjs`, `test/webview/webviewMessages.test.cjs`; modify `src/webview/LeetCodeWebview.ts`, `src/webview/markdownEngine.ts`.

- [ ] Test script/event/SVG/CSS payload removal and HTTPS/fragment preservation.
- [ ] Test rejection of `javascript:`, `command:`, `file:`, protocol-relative, and malformed URLs.
- [ ] Implement a deterministic character-by-character HTML tokenizer/tree emitter, never a tag-removal regex. It must decode character references before URL checks, maintain raw-text/drop-content states for executable/foreign/form/embed elements, balance allowed elements, and discard comments, declarations, malformed attributes, SVG/MathML, CSS/style/srcset/id, `on*`, and unknown attributes. URL-bearing attributes are reconstructed only after the shared HTTPS/fragment allowlist accepts them.
- [ ] Add adversarial fixtures for broken nesting/quotes, NULs, mixed-case and encoded protocols, nested raw-text payloads, SVG/MathML namespaces, `srcdoc`, CSS URLs, duplicate attributes, and entity-encoded event/URL attacks.
- [ ] Implement context-specific escaping, safe JSON serialization, nonce creation, and strict CSP with no unsafe directives.
- [ ] Disable command URIs and sanitize Markdown output.
- [ ] Test malformed/oversized messages and unexpected identity fields.
- [ ] Run `rtk npm test -- test/webview/webviewSecurity.test.cjs test/webview/webviewMessages.test.cjs` and `rtk npm run typecheck`.
- [ ] Commit as `feat(webview): add trusted webview boundary`.

## Task 2: Secure and reflow problem/solution previews

**Files:** create `src/webview/previewHtml.ts`, `src/webview/webviewActions.mts`, `test/webview/previewHtml.test.cjs`; modify `src/webview/leetCodePreviewProvider.ts`, `src/webview/leetCodeSolutionProvider.ts`, `scripts/build.mjs`.

- [ ] Sanitize LeetCode description and rendered NeetCode/JIT content before insertion.
- [ ] Render labels as text with opaque `data-action-id`; use delegated listeners and provider-owned lookup maps.
- [ ] Restore valid `details/summary` for Tags, Companies, Sheets, hints, articles, and resources.
- [ ] Apply `.reading-column { max-width: 68ch; margin-inline: auto; }` to description, learning resources, NeetCode article, and hints.
- [ ] Allow code/table wrappers to scroll horizontally.
- [ ] Test `Lowe's`, XSS fragments, balanced disclosures, no inline handlers, matching CSP nonces, and reading-column coverage.
- [ ] Run `rtk npm test -- test/webview/previewHtml.test.cjs`, `rtk npm run typecheck`, and `rtk npm run compile`.
- [ ] Commit as `fix(preview): secure labels disclosures and long-form content`.

## Task 3: Make the submission form secure and accessible

**Files:** create `src/webview/submissionFormState.ts`, `test/webview/submissionFormState.test.cjs`, `test/webview/submissionFormHtml.test.cjs`; modify `src/webview/leetnotionEngine.ts`, `src/webview/leetCodeSubmissionProvider.ts`, `public/scripts/script.js`, `public/styles/style.css`.

- [ ] Put state in safely serialized non-executable JSON, not `window.__LEETNOTION_*`.
- [ ] Use fieldset/legend and a real review-date label.
- [ ] Add `aria-pressed`; make date/rating exclusion symmetric.
- [ ] Restore valid color disclosure and roving radio keyboard navigation.
- [ ] After save, refresh notes/flag/Optimal/tags, Select2 state, review controls, and the polite live region.
- [ ] Test successful resets, A→B→A tags, clearing, pressed state, arrow keys, and failed-save preservation.
- [ ] Run `rtk npm test -- test/webview/submissionFormState.test.cjs test/webview/submissionFormHtml.test.cjs`, `rtk npm run typecheck`, `rtk npm run lint`, and `rtk npm run compile`.
- [ ] Commit as `fix(submission): validate messages and make form accessible`.

## Task 4: Paginate and wire Past Submissions

**Files:** create `src/submissions/submissionHistory.ts`, `src/webview/submissionHistoryHtml.ts`, `src/webview/submissionDetailHtml.ts`, `test/submissions/submissionHistory.test.cjs`, `test/webview/submissionHistoryHtml.test.cjs`, `test/webview/submissionDetailHtml.test.cjs`; modify `src/leetCodeClient.ts`, `src/commands/show.ts`, `src/webview/leetCodePastSubmissionsProvider.ts`, `src/webview/leetCodeSubmissionDetailProvider.ts`, `src/extension.ts`.

- [ ] Collect unique pages of 20 until partial/duplicate-only response or cap 100.
- [ ] Sort newest-first and open the rich provider, including empty state.
- [ ] Register detail command/providers and disposables.
- [ ] Accept only action plus submission ID; resolve objects/URLs from provider-owned state.
- [ ] Remove all inline handlers and use nonce CSP/delegated listeners.
- [ ] Test 45-row offsets, 100 cap, duplicate termination, empty state, forged IDs/URLs, back/open actions, and quote-bearing values.
- [ ] Run `rtk npm test -- test/submissions/submissionHistory.test.cjs test/webview/submissionHistoryHtml.test.cjs test/webview/submissionDetailHtml.test.cjs`, `rtk npm run typecheck`, and `rtk npm run compile`.
- [ ] Commit as `feat(submissions): wire paginated history and detail views`.

## Task 5: Correct and make the profile dashboard accessible

**Files:** create `src/home/profileDashboardModel.ts`, `src/home/profileDashboardHtml.ts`, `src/home/profileDashboardClient.mts`, `test/home/profileDashboardModel.test.cjs`, `test/home/profileDashboardHtml.test.cjs`; modify `src/home/profileDashboardProvider.ts`, `scripts/build.mjs`.

- [ ] Build an 18-week Sunday-based graph ending on the current UTC day, including only elapsed days in the current week.
- [ ] Correct current streak rules for today/yesterday.
- [ ] Construct recent links only from validated `titleSlug` and the configured LeetCode base URL.
- [ ] Make the visual grid decorative and add a date/count table alternative.
- [ ] Replace inline progress width with native `progress`.
- [ ] Add nonce CSP, strict actions, polite refresh status, and webview-state restoration for scroll/open disclosures.
- [ ] Test Wednesday partial week, streak variants, timezone boundaries, malicious slug, exact text alternative, and no inline handlers.
- [ ] Run `rtk npm test -- test/home/profileDashboardModel.test.cjs test/home/profileDashboardHtml.test.cjs`, `rtk npm run typecheck`, `rtk npm run lint`, and `rtk npm run compile`.
- [ ] Commit as `fix(profile): correct activity dates links and accessibility`.

## Stream verification

- [ ] `rtk npm test`
- [ ] `rtk npm run typecheck`
- [ ] `rtk npm run lint`
- [ ] `rtk npm run compile`
- [ ] Scan authored code for `unsafe-inline`, `unsafe-eval`, `enableCommandUris: true`, inline handlers, executable URI schemes, and `window.__LEETNOTION`.
- [ ] `rtk git diff --check`
