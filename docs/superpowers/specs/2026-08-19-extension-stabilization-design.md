# Extension Stabilization Design

Date: 2026-08-19

## Objective

Stabilize the `zoypk/vscode-leetnotion` fork so its review, study, submission, enrichment, and packaged-extension workflows are correct, maintainable, and usable in the installed VS Code extension.

The implementation will address every confirmed review finding except:

- third-party redistribution or licensing work;
- dependency-vulnerability remediation or dependency version upgrades.

Dependency versions remain unchanged. Build-only dependencies may be reclassified or excluded from the VSIX when that does not change runtime behavior.

## Delivery Strategy

Use targeted stabilization rather than a broad rewrite. Preserve existing commands, extension identity, Notion integration, local data, and user-facing workflows. Refactor only where a shared boundary is needed to remove a confirmed defect.

Work will run on a dedicated branch and be split into bounded implementation streams. Each stream receives spec-compliance and code-quality review. A separate final-validation agent will verify the integrated branch and packaged VSIX.

## Functional Contracts

### Review and study state

- A review rating is applied exactly once per explicit user action.
- Saving unrelated notes, tags, or flags cannot reschedule a review.
- Review and study state updates cannot lose unrelated concurrent mutations.
- State writes use validated versioned data, unique temporary files, and serialized transactions.
- Study refresh computes and persists a daily plan once per refresh snapshot; read helpers are side-effect-free.
- Active filters apply consistently to the visible daily plan.
- Daily problem limits are non-negative integers.
- Review and study sessions are mutually exclusive and have a reachable Stop Session command.
- Moving a completed backlog problem to Reviews cannot lose the problem. The review is created and initially scheduled before backlog removal, with idempotent recovery behavior.

### Submission and Notion integration

- The extension correlates the submitted file, problem, and exact new LeetCode submission before displaying or syncing data.
- The same validated submission object is used by the result view and Notion upload.
- Custom filename templates continue to work by resolving the problem ID from the source marker when necessary.
- Notes, Optimal state, tags, review dates, and flags can be both set and cleared.
- Client-side initial state is refreshed after every successful save.
- Review date and rating inputs are mutually exclusive and cleared after successful scheduling.
- Webview messages are runtime-validated; page IDs and question identity remain authoritative extension-side state.
- Bulk submission import reports actual added and skipped counts and tolerates malformed legacy rows.

### Webview security and accessibility

- Remote LeetCode and imported content is sanitized with an explicit allowlist before insertion.
- Webviews use nonce-based CSPs without `unsafe-inline` or `unsafe-eval` where executable scripts are present.
- `command:` URIs are disabled unless a narrowly scoped command is explicitly required. Rendered links allow only approved schemes.
- Serialized state cannot terminate a script element; preferably it is stored in a non-executable JSON element.
- Labels are rendered as text/data attributes, never interpolated into inline JavaScript. Names such as `Lowe's` work correctly.
- Companies, Sheets, hints, and other disclosures use valid `<details>/<summary>` markup.
- Review inputs have correct labels, pressed/selected states, and keyboard behavior.
- The activity heatmap provides a screen-reader-readable textual alternative and does not rely on color alone.
- All long-form description content, including NeetCode articles and hints, shares the comfortable reading width. Code and tables may scroll horizontally.
- Dashboard refresh preserves useful view state or announces state replacement appropriately.

### Past submissions and profile

- Past-submission retrieval follows pagination up to the documented cap of 100.
- The in-extension history and detail providers are either fully wired and tested or removed; no dead commands or unreachable providers remain.
- Generated buttons use safe event listeners and valid attributes.
- Profile recent-submission links resolve to the actual problem.
- The activity grid includes the current partial week, and a streak ending yesterday remains current until the user has had a reasonable opportunity to submit today.

### Data pipelines

- Company reverse tags use the union of all source windows. Forward and reverse mappings are validated before output replacement.
- The NeetCode snapshot is regenerated from the current source revision, including the known `construct-quad-tree` corrections.
- Generated data validation checks schema, duplicate IDs/slugs, canonical list counts, reverse-map completeness, URL schemes, and required resources.
- NeetCode metadata is separated from large article/hint bodies. Metadata is loaded once; content is loaded and cached per requested problem.
- Missing or malformed installed data emits an actionable diagnostic rather than silently disabling features.
- The JIT importer records deterministic provenance such as a source hash and has a source-independent validation command.
- Network sync helpers have timeouts and response-size limits, accept an explicit source revision, and write only after validation.

### Extension packaging and repository health

- Restore a fork-specific README describing installation, review/study workflows, data refresh, and limitations.
- Point repository and homepage metadata to `zoypk/vscode-leetnotion` while preserving the current extension identifier for local upgrade compatibility.
- Repair `.vscode/tasks.json` and remove nonfunctional test launch configuration unless backed by actual tests.
- Declare a truthful VS Code compatibility floor or explicit activation events. The preferred minimal change is a modern engine floor compatible with contribution-derived activation.
- Dispose every registered listener, URI handler, provider emitter, and recurring task.
- Move authentication credentials from `globalState` to VS Code `SecretStorage` with one-time migration and deletion of legacy values.
- Move large cache payloads out of Memento/global state into `globalStorageUri`, retaining only small preferences and indexes in Memento.
- Clean generated output before packaging and include only runtime-required files. Preserve separately executed runtime dependencies such as the LeetCode CLI and FSRS package.
- Remove obsolete build artifacts and exclude build-only tooling from the VSIX without changing dependency versions.
- Main-branch CI runs typecheck, lint, automated tests, data validation, compilation, and VSIX contract checks.
- GitHub releases are created from semantic version tags rather than every main push. Packaging uses a pinned local VSCE command when available without upgrading dependency versions.

## Architecture

### Versioned JSON state store

Introduce one reusable persistence primitive for review and study state:

1. acquire a short-lived per-state lock with stale-lock recovery;
2. load and validate the current version;
3. apply one synchronous mutator to the in-memory snapshot;
4. write a uniquely named temporary file;
5. atomically replace the state file;
6. release the lock in `finally`.

Services expose domain-specific operations rather than raw `load()` and `save()` pairs. Cross-file backlog-to-review movement uses safe ordering and idempotency: create and schedule the review first, remove the backlog entry second, and treat an already-created review as recoverable rather than destructive.

### Trusted webview boundary

Each provider owns trusted server-side context. The webview sends only editable values and opaque action identifiers. A shared utility provides:

- HTML/text/attribute escaping;
- remote HTML sanitization;
- nonce generation and CSP construction;
- safe JSON transport;
- runtime message parsing and bounds validation;
- link-scheme filtering.

Inline `onclick` handlers are replaced with delegated listeners on `data-*` attributes.

### Enrichment storage

Generate:

- a compact `neetcode-index.json` containing identifiers and small metadata;
- per-problem content files containing article/hint bodies only where present;
- the existing separate JIT resource dataset.

The synchronous preview API remains compatible by loading only the selected small content file, then caching it. Generation and VSIX tests guarantee all referenced files exist.

### Test seams

Extract pure functions and injectable boundaries for clocks, filesystem state, submission polling, API responses, Markdown/content transformation, and data generators. Production behavior remains unchanged while unit tests use temporary directories and fixtures.

## Testing and Validation

Automated coverage will include:

- concurrent review/study updates and fixed-temp-file regression cases;
- first refresh of a new daily plan, filter changes, integer limits, deferral, and session exclusivity;
- backlog-to-review failure injection and successful initial scheduling;
- one-shot rating/date handling and A-to-B-to-A tag changes;
- custom filenames and exact submission correlation under stale/concurrent recent results;
- Notion notes/Optimal clearing and bulk-import malformed rows/counts;
- company all-window reverse mapping and source anomalies;
- NeetCode/JIT schema, coverage, provenance, lazy content, and malformed package data;
- XSS payloads, quote-containing labels, command/file URI rejection, CSP/nonce presence, and runtime message validation;
- Past Submissions pagination and list/detail rendering;
- profile date-range, streak, links, and accessible heatmap output;
- extension activation registrations, disposal, SecretStorage migration, cache storage, and manifest validity;
- VSIX required-file, forbidden-file, file-count, and size budgets.

The final validation agent will independently run the complete test/typecheck/lint/build/data-validation/package suite, inspect the VSIX, install it with `--force`, confirm the installed version and required assets, and inspect extension-host logs for activation failures. Live LeetCode submission and Notion mutation will not be performed; those paths will use deterministic integration fakes to avoid altering user data.

## Completion Criteria

- All in-scope confirmed findings have a code fix and regression test or explicit package-level assertion.
- Typecheck, lint, automated tests, data validation, compilation, and VSIX contract checks pass with zero failures.
- The packaged extension installs over the existing local extension and activates without logged errors.
- The final validation agent reports no unresolved high-confidence functional defect.
- Dependency versions and third-party licensing content remain unchanged as requested.

