# CodeDNA

CodeDNA is an open-source-first developer platform for understanding unfamiliar codebases. The shared engine performs snapshot-based TypeScript and JavaScript file dependency analysis.

## Getting started

Install Node.js 20.19+, 22.13+, or 24+ and pnpm 9.15.9 (Corepack can provision the version in `packageManager`). Then run:

```sh
pnpm install
pnpm dev
```

Open http://localhost:3000. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` to verify the workspace. No environment variables are required.

See [architecture](docs/architecture.md) for boundaries and [roadmap](docs/roadmap.md) for planned phases.
