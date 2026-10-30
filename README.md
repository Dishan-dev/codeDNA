# CodeDNA

CodeDNA helps developers explore unfamiliar TypeScript and JavaScript repositories. Its shared, snapshot-based analyzer powers the Architecture Map, framework-aware UI Flow Map, Impact Analysis and Learning Mode in a Next.js web app and a local VS Code extension. Static evidence describes possible relationships; it does not prove runtime behavior or reachability.

## Quick start

Use Node.js `^20.19.0`, `^22.13.0` or `>=24` and pnpm `9.15.9` (specified in `packageManager`). From the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:3000. Local development can acquire public GitHub repositories, subject to the limits in [security and privacy](docs/security.md). The bundled demo requires no token. `GITHUB_TOKEN` is optional and server-only; see [.env.example](.env.example). Never expose it as a `NEXT_PUBLIC_` variable.

Production runs in **demo-only** mode: GitHub acquisition always returns 503, and the landing page says import is disabled. A full import deployment is not implemented. The trusted local VS Code extension does not upload source.

## Supported analysis

File-level dependencies cover `.ts`, `.tsx`, `.js`, `.jsx` and relevant TypeScript/JavaScript configuration files. UI-flow adapters support statically detectable Next.js App Router, React Router, Expo Router and React Navigation patterns. Dynamic and ambiguous constructs can remain unresolved; results can be partial. See [architecture](docs/architecture.md) for detailed boundaries and limitations.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:e2e` for code and browser checks. See the [demo deployment guide](docs/deployment.md), [extension guide](apps/vscode/README.md), [release checklist](docs/release-checklist.md), and [roadmap](docs/roadmap.md). The project license is awaiting owner approval; do not assume distribution rights.
