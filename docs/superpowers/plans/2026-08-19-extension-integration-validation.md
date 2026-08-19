# Integration and Installation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development for remediation and a fresh independent agent for final functional validation.

**Goal:** Integrate every approved stream, prove the packaged extension is coherent, install it into the user’s VS Code, and push the exact validated commit to the remote.

**Architecture:** Merge only reviewed stream commits on `zcdx/stabilize-extension`, run reproducible source/data/package gates, then give the produced VSIX and commit SHA to a separate validation agent. Install only that validated artifact and verify activation from VS Code state/logs without mutating live LeetCode or Notion data.

**Tech Stack:** Git, npm scripts, VSCE, VS Code CLI and extension-host logs.

---

## Task 1: Integrate reviewed streams

- [ ] Ensure each implementation task has a focused passing test, implementer self-review, spec-compliance review, and code-quality review.
- [ ] Resolve only intentional overlaps in `package.json`, `src/extension.ts`, build scripts, test harness, and webview submission files.
- [ ] Preserve exclusions: no licensing remediation and no dependency version upgrades/vulnerability remediation.
- [ ] Run `rtk git diff --check` and inspect the complete branch diff against `origin/main`.
- [ ] Commit integration-only conflict resolutions with a narrow message.

## Task 2: Run complete source and data verification

- [ ] `rtk npm ci`
- [ ] `rtk npm test`
- [ ] `rtk npm run typecheck`
- [ ] `rtk npm run lint`
- [ ] `rtk npm run validate:data`
- [ ] `rtk npm run compile`
- [ ] Run the authored-webview security scan from the webview plan.
- [ ] Confirm company reverse gaps are zero, NeetCode counts are 150/75, Construct Quad Tree mapping is correct, JIT count/hash schema is valid, and every lazy content file exists.

## Task 3: Package and inspect the exact VSIX

- [ ] Build once with `rtk npm run package`.
- [ ] Validate the exact output with `rtk npm run verify:vsix -- --file <absolute-vsix-path>`.
- [ ] Record SHA-256, compressed/unpacked size, file count, extension version, and required/forbidden contract results.
- [ ] Confirm README/fork metadata and runtime packages/assets are present.
- [ ] Confirm source/tests/scripts/build-only packages and stale monolithic data are absent.

## Task 4: Independent final functional validation agent

- [ ] Give a fresh agent the exact commit SHA and VSIX path; it must not rely on implementer claims.
- [ ] Have it rerun test, typecheck, lint, data validation, compile, VSIX validation, and `git diff --check`.
- [ ] Record a timestamp/log boundary, install with `code --install-extension <absolute-vsix-path> --force`, and launch a fresh isolated VS Code window/profile rooted at a temporary Extension Development Host workspace so the validated build must activate after that boundary.
- [ ] Verify `code --list-extensions --show-versions` reports the new version.
- [ ] Open Explorer/Reviews/Study, run a non-mutating profile/preview action, exercise Past Submissions via its empty or fixture-driven path, and request packaged company/NeetCode/JIT data so activation and lazy assets are actually used.
- [ ] Inspect only extension-host logs created after the recorded boundary; capture the activation event/version/path and verify no Leetnotion error occurred during those actions.
- [ ] Do not perform a live LeetCode submission or Notion write; use deterministic fakes/tests for mutation workflows.
- [ ] If any check fails, return to a fresh remediation agent and repeat independent validation.

## Task 5: Push and verify remote state

- [ ] Ensure the working tree is clean.
- [ ] Push `zcdx/stabilize-extension` to `origin`.
- [ ] Verify `git ls-remote origin refs/heads/zcdx/stabilize-extension` equals the locally validated SHA.
- [ ] If the user’s remote default branch must contain the release, fast-forward/merge only after all checks and explicit branch policy allow it; otherwise retain the reviewed stabilization branch.
- [ ] Report the installed extension version, VSIX hash, validated commit, remote ref, and any intentionally excluded findings.
