# CodeDNA for VS Code

Analyze a trusted local TypeScript or JavaScript workspace with the same CodeDNA engine used by the web app. Source stays on the local machine; the extension does not upload it, execute repository code, use GitHub authentication, or require a backend.

## Develop

From the monorepo root, install dependencies with `pnpm install --frozen-lockfile`, then run `pnpm exec turbo run build --filter=codedna-vscode`. Open the monorepo in VS Code and launch **Run CodeDNA Extension** from Run and Debug. In the Extension Development Host, open a trusted local folder and run **CodeDNA: Analyze Workspace**. Run extension unit tests with `pnpm --filter codedna-vscode test` and all workspace checks with `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.

Run `pnpm --filter codedna-vscode package` after building to create `apps/vscode/codedna.vsix`. Install it through Extensions: **Install from VSIX**. Packaging does not publish the extension.

## Usage

Use **CodeDNA: Open Explorer**, **Analyze Workspace**, **Refresh Analysis**, or **Analyze Current File Impact** from the Command Palette. For multi-root workspaces, choose a local folder when prompted; current-file impact uses the active editor's folder. Graph clicks and file selection update the inspector; source opens in VS Code. Learning progress is in memory only and isolated by folder and content fingerprint.

The extension reads `.ts`, `.tsx`, `.js`, `.jsx`, `tsconfig.json`, and `jsconfig.json`. VS Code `files.exclude` and `search.exclude` settings are respected; dependency, generated and build directories are filtered. Symbolic links are skipped, and resolved paths are checked to remain inside the selected local folder. Virtual or remote workspace providers and untrusted workspaces are unsupported. Changes mark cached analysis stale and require a manual refresh.

Acquisition defaults to 1,000 files, 2 MiB per file, 50 MiB total and a 30-second acquisition deadline; the analysis worker has a 30-second deadline. Skipped files and limits are reported as partial data. Large graphs start in a list view. Source navigation checks snapshot membership and path containment. Changes made concurrently with filesystem checks can still race those checks; use trusted workspaces. Manual Extension Development Host and accessibility verification have not yet been completed.

## Installation and release checks

Build and package locally with `pnpm build` and `pnpm --filter codedna-vscode package`; the output is `apps/vscode/codedna.vsix`. In a disposable VS Code profile, open Extensions, choose **Install from VSIX**, and select that file. The package is not published automatically. Distribution remains blocked pending an owner-approved project license and manual acceptance.

For automated host smoke verification, build first and run `pnpm --filter codedna-vscode test:host`. The runner uses `VSCODE_EXECUTABLE_PATH` if set, otherwise it downloads a VS Code test build; Linux requires a display such as `xvfb-run`. The smoke test covers activation, registered commands, a trusted fixture, impact and refresh; it does not validate the rendered webview. See the [manual release checklist](../../docs/release-checklist.md) for source-location, workspace switching, keyboard, graph and learning checks. Version notes are in [CHANGELOG.md](CHANGELOG.md).
