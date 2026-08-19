# Leetnotion for VS Code

Leetnotion lets you browse and solve LeetCode problems in VS Code, keep structured review and study queues, and optionally sync accepted submissions to a Notion tracker.

This fork keeps the bundled company lists, NeetCode metadata, and inline learning resources current while preserving the extension identity `Leetnotion.vscode-leetnotion`.

## Install or upgrade

Download `vscode-leetnotion-<version>.vsix` from the matching `v<version>` GitHub release, then install it from VS Code with **Extensions: Install from VSIX...**. You can also use the command line:

```powershell
code --install-extension ".\vscode-leetnotion-<version>.vsix" --force
```

Reload VS Code after installation. The `--force` flag replaces an older installed build with the selected VSIX.

## Review and study

- Add a problem to **Reviews** when you want spaced-repetition scheduling, then rate it after another attempt.
- Add a problem to the **Study** backlog when you want it considered for a daily study plan.
- Start a review or study session from its view. Only one guided session runs at a time.
- Run **Leetnotion: Stop Session** at any point to stop the active session cleanly.

Session actions use the exact problem and submission selected by the extension. The problem preview also includes available NeetCode explanations and JIT learning links.

## Accounts and local storage

LeetCode cookies and the Notion integration token are stored in VS Code SecretStorage. Larger downloaded caches are stored as versioned files under the extension's VS Code global storage directory. Small preferences remain in VS Code global state. Review and study schedules are workspace data under `.leetnotion/reviews.json` and `.leetnotion/study.json` in the configured problem workspace, so include that directory when backing up or moving a study setup.

Signing out or clearing extension data removes the corresponding extension-managed values. The extension does not place credentials in workspace files.

## Data refresh and provenance

The checked-in company and NeetCode datasets are generated from revision-pinned upstream snapshots. Their provenance records identify the source repository and resolved commit. JIT learning resources also record the SHA-256 of the imported source document.

Maintainers can refresh and validate the snapshots with:

```powershell
npm run sync:companies
npm run sync:neetcode
npm run import:jit-resources -- "C:\path\to\resources.md"
npm run validate:data
```

Generators validate complete outputs before publishing them. A failed refresh leaves the last valid installed generation in place.

## Diagnostics

If a view cannot load:

1. Run the relevant **Refresh** command and check the VS Code notification for the failing data path or operation.
2. Confirm you are signed in to the expected LeetCode endpoint.
3. For Notion sync, verify the integration token and database configuration.
4. If a data refresh reports a publication lock, confirm no generator is running before following the reported manual recovery path.
5. Reinstall the VSIX if packaged data is missing or malformed.

Open an issue in the [fork repository](https://github.com/zoypk/vscode-leetnotion/issues) with the exact diagnostic message and extension version.

## Development and test boundary

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run validate:data
npm run compile
```

Automated tests and release validation must not make live LeetCode submissions or write to a real Notion workspace. They use fixtures, mocks, temporary storage, and non-mutating checks. Live account mutations require an explicit manual action by the user.

Release artifacts derive their package version, semantic tag, installed extension identity, and VSIX filename from `package.json`. Release validation rejects any disagreement.

## License

MIT. See [LICENSE](LICENSE).
