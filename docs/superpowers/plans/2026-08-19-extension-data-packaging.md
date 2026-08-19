# Data, Storage, and Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development and complete each checkbox with focused tests, self-review, spec review, and quality review.

**Goal:** Ship complete current company/NeetCode/JIT data efficiently, migrate sensitive/large state to the correct VS Code stores, slim the VSIX, restore fork metadata, and gate releases.

**Architecture:** Make generators revision-pinned, bounded, validated, and atomic. Split NeetCode metadata from per-problem content for lazy reads. Use SecretStorage for credentials and `globalStorageUri` files for caches. Package from clean outputs and validate the artifact contract.

**Tech Stack:** TypeScript/Node scripts, VS Code SecretStorage/globalStorageUri, JSON schemas/invariants, GitHub Actions, VSCE.

---

## Task 1: Fix company reverse mappings and data validation

**Files:** create `scripts/lib/sync-utils.mjs`, `scripts/lib/data-validation.mjs`, `test/data/company-data.test.cjs`, fixtures under `test/fixtures/company-data/`; modify `scripts/sync-company-data.mjs`, `scripts/validate-data.mjs`, `package.json`; regenerate `data/companyTags.json`, `data/questionCompanyTags.json`.

- [ ] Test reverse membership equals the union of all five frequency windows, deduplication, malformed/missing CSV, unmapped slugs, reverse gaps/extras, sort order, and failed-output preservation.
- [ ] Build reverse membership from Last 30 Days, Last 3 Months, Last 6 Months, More Than 6 Months, and All Time.
- [ ] Validate both outputs before atomically replacing either.
- [ ] Resolve `refs/heads/main` from the source remote immediately before generation, record that SHA in provenance, and fail an “up to date” run if an explicitly requested current SHA is not the live default-branch head. The reviewed reference was `03850eb5d16892514491cf1381c32ec0330a2719`, but live remote state is authoritative.
- [ ] Run `rtk npm test -- test/data/company-data.test.cjs` and `rtk npm run validate:data`; expect zero forward/reverse gaps.
- [ ] Commit as `fix: build complete company reverse mappings`.

## Task 2: Bound network syncs and atomically publish generators

**Files:** modify `scripts/lib/sync-utils.mjs`, `scripts/sync-company-data.mjs`, `scripts/sync-neetcode-data.ts`, `scripts/import-jit-learning-resources.mjs`; create `test/data/sync-utils.test.cjs`.

- [ ] Add 30-second timeout, explicit byte caps, at most five redirects, exact revision checkout, unique same-directory temp files, and validated multi-output replacement.
- [ ] Test timeout, oversize, redirect exhaustion, unique temp names, rename cleanup, and preservation of old files.
- [ ] Run `rtk npm test -- test/data/sync-utils.test.cjs` and `rtk npm run typecheck`.
- [ ] Commit as `fix: bound and atomically publish data syncs`.

## Task 3: Split NeetCode metadata from lazy content and refresh upstream

**Files:** generate `data/neetcode-index.json`, `data/neetcode-content/<question-id>.json`; create `test/data/neetcode-data.test.cjs`, `test/integrations/neetcode-service.test.cjs`, fixtures under `test/fixtures/neetcode-source/`; modify `scripts/sync-neetcode-data.ts`, `scripts/lib/data-validation.mjs`, `scripts/validate-data.mjs`, `src/integrations/neetcode/types.ts`, `src/integrations/neetcode/service.ts`, `src/utils/dataUtils.ts`, `.vscodeignore`; remove `data/neetcode-enrichment.json` only after validation.

- [ ] Define versioned provenance-bearing index and per-problem content schemas.
- [ ] Load/validate index once, lazy-load and cache only the selected content file, then merge JIT metadata.
- [ ] Emit actionable installed-data diagnostics for missing/malformed paths.
- [ ] Validate unique IDs/slugs, safe content paths/URLs, referenced files, counts 150/75, and metadata-only index.
- [ ] Assert Construct Quad Tree is ID `427`, slug `construct-quad-tree`, code `0427-construct-quad-tree` with only its own content.
- [ ] Resolve the NeetCode source default-branch head immediately before generation, record the resolved SHA, and fail an “up to date” run if the supplied current SHA has drifted. The reviewed reference was `62d62811315e676691c4b8fef58af73494d58b79`, but live remote state is authoritative.
- [ ] Run `rtk npm test -- test/data/neetcode-data.test.cjs test/integrations/neetcode-service.test.cjs` and `rtk npm run validate:data`.
- [ ] Commit as `perf: load NeetCode content per problem`.

## Task 4: Add JIT provenance and source-independent validation

**Files:** modify `scripts/import-jit-learning-resources.mjs`, `scripts/lib/data-validation.mjs`, `scripts/validate-data.mjs`, `src/integrations/neetcode/types.ts`, `data/jit-learning-resources.json`; create `test/data/jit-resources.test.cjs` and fixtures under `test/fixtures/jit-resources/`.

- [ ] Store schema version, source name, SHA-256 of exact bytes, problem count, and records.
- [ ] Make `validate:data` work without source Markdown; validate hash format, 150 unique slugs/indexes, known slugs, nonempty fields, HTTPS links, and count.
- [ ] Import the authentic file `C:\Users\zohil\Downloads\NeetCode-150-full-inline-JIT-concept-resources.md`; never fabricate a hash.
- [ ] Run `rtk npm test -- test/data/jit-resources.test.cjs` and `rtk npm run validate:data`.
- [ ] Commit as `feat: validate JIT learning-resource provenance`.

## Task 5: Migrate credentials and large caches

**Files:** create `src/storage/cacheStore.ts`, `src/storage/extensionStorage.ts`, `test/storage/cacheStore.test.cjs`, `test/storage/extensionStorage.test.cjs`; modify `src/globalState.ts`, `src/extension.ts`, `src/leetCodeManager.ts`, `src/leetCodeClient.ts`, `src/leetnotionClient.ts`, `src/leetnotionManager.ts`, `src/modules/leetnotion/template-updater.ts`, `src/utils/dataUtils.ts`.

- [ ] Migrate LeetCode cookie and Notion token to `context.secrets`, preferring existing secrets and deleting legacy values only after verified write/read.
- [ ] Move topic tags, ID maps, list questions, ratings, and contests to versioned atomic files under `globalStorageUri/cache`.
- [ ] Inventory every Memento key and every `getWithBackgroundRefresh` caller before editing. Commit a named small-value allowlist for Memento; test that all list collections, question payloads, rating maps, contests, and any value above the agreed small-value threshold are file-backed and no unlisted key survives migration.
- [ ] Await credential/cache writes and clears; preserve synchronous reads through an initialized in-memory snapshot.
- [ ] Test success, failure retention, idempotence, precedence, malformed caches, atomic writes, clearing, and no remaining Memento secret.
- [ ] Run `rtk npm test -- test/storage/cacheStore.test.cjs test/storage/extensionStorage.test.cjs` and `rtk npm run typecheck`.
- [ ] Commit as `security: migrate credentials and caches to extension storage`.

## Task 6: Dispose all activation resources

**Files:** create `src/activation.ts`, `test/extension/activation.test.cjs`; modify `src/extension.ts`, `src/leetCodeManager.ts`, `src/utils/trackingUtils.ts`, `src/webview/LeetCodeWebview.ts`, `src/webview/leetnotionEngine.ts`, `src/codelens/CustomCodeLensProvider.ts`, `src/explorer/LeetCodeTreeDataProvider.ts`, `src/reviews/reviewTreeDataProvider.ts`, `src/study/studyTreeDataProvider.ts`.

- [ ] Extract injectable registration.
- [ ] Dispose status listeners, URI handlers, emitters, tracking timeout, webview listeners, engine, recurring intervals, and every provider/command/handler.
- [ ] Test every returned registration is disposed exactly once.
- [ ] Run `rtk npm test -- test/extension/activation.test.cjs` and `rtk npm run typecheck`.
- [ ] Commit as `fix: dispose extension registrations and recurring work`.

## Task 7: Slim and verify the VSIX without version changes

**Files:** create `scripts/clean.mjs`, `scripts/package-extension.mjs`, `scripts/verify-vsix.mjs`, `test/package/package-contract.test.cjs`; modify `package.json`, `package-lock.json`, `.vscodeignore`, `scripts/build.mjs`; delete obsolete `esbuild.js`.

- [ ] Clean only ignored generated targets before compile.
- [ ] Keep `bottleneck`, `ts-fsrs`, and `vsc-leetcode-cli` as disk runtime dependencies.
- [ ] Reclassify bundled/build-only packages as dev dependencies without changing version specifiers or resolved-version map.
- [ ] Package with pinned VSCE behavior.
- [ ] Assert required assets/datasets/content/runtime packages and forbid source/tests/build tools/maps/stale monolith.
- [ ] Enforce <=2,500 files, <=50 MiB unpacked, <=15 MiB VSIX.
- [ ] Run `rtk npm test -- test/package/package-contract.test.cjs`, `rtk npm run package`, and `rtk npm run verify:vsix`.
- [ ] Commit as `build: slim and verify the packaged extension`.

## Task 8: Restore fork metadata and development workflow

**Files:** create `README.md`, `test/package/manifest.test.cjs`; modify `package.json`, `package-lock.json`, `.vscode/tasks.json`, `.vscode/launch.json`.

- [ ] Document installation/upgrades, review/study/Stop, storage, data refresh/provenance, diagnostics, and no-live-mutation test boundary.
- [ ] Point repository/homepage to `zoypk/vscode-leetnotion` while preserving name/publisher/extension ID.
- [ ] Bump the extension release version to `1.6.0` in `package.json` and `package-lock.json`; test that manifest, lockfile, VSIX filename/manifest, installed version, and release tag contract agree.
- [ ] Raise VS Code engine to `^1.74.0` and use contribution-derived activation.
- [ ] Replace concatenated tasks JSON with one valid task document and remove only the nonexistent test launch entry.
- [ ] Run `rtk npm test -- test/package/manifest.test.cjs`; test all JSON, metadata, tasks/scripts, engine, identity, and version agreement.
- [ ] Commit as `docs: restore fork metadata and development workflow`.

## Task 9: Add CI and semantic-tag releases

**Files:** create `.github/workflows/ci.yml`, `test/package/workflow-contract.test.cjs`; modify `.github/workflows/release.yml`.

- [ ] CI on PR/main: install, typecheck, lint, test, data validation, compile, package, VSIX validation, artifact upload.
- [ ] Release only on `v*.*.*`; reject tag/package version mismatch and publish the one revalidated artifact.
- [ ] Remove per-main-push prerelease/tag churn.
- [ ] Run workflow contract tests and local verify/package/VSIX validation.
- [ ] Commit as `ci: validate main and release semantic tags`.

## Task 10: Bring first-party source to a zero-error lint baseline

**Files:** modify only authored source/config files reported by `npm run lint`; create `test/package/lint-contract.test.cjs` if exclusions/configuration change.

- [ ] Capture the complete pre-change lint report and classify every finding as a code defect or narrowly justified generated/vendor exclusion.
- [ ] Fix authored-code findings without blanket rule disablement, unrelated rewrites, or dependency changes.
- [ ] If generated/vendor paths are currently linted, exclude only named generated/vendor files and assert authored `src/`, `scripts/`, and `test/` remain covered.
- [ ] Run `rtk npm run lint` and require exit 0 with zero errors; run the complete test/typecheck/compile suite afterward.
- [ ] Commit as `chore: establish clean lint baseline`.

## Stream verification

- [ ] `rtk npm run verify`
- [ ] `rtk npm run package`
- [ ] `rtk npm run verify:vsix`
- [ ] `rtk git diff --check`
- [ ] Confirm dependency resolved versions and licensing files are unchanged.
