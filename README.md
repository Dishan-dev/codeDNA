# CodeDNA

CodeDNA helps developers explore unfamiliar TypeScript and JavaScript repositories. Its shared, snapshot-based analyzer powers the Architecture Map, framework-aware UI Flow Map, Impact Analysis and Learning Mode in a Next.js web app and a local VS Code extension. Static evidence describes possible relationships; it does not prove runtime behavior or reachability.

## Quick start

Use Node.js `^20.19.0`, `^22.13.0` or `>=24` and pnpm `9.15.9` (specified in `packageManager`). From the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Dependencies are installed with pnpm. After that, `npm run dev` (development server) or `npm start` (production build, then serve) also work from the root without pnpm on the PATH. Both build the workspace packages first. Pass a different port with `npm run dev -- -p 3001` or `npm start -- -p 3001`.

Open http://localhost:3000. Local development can acquire public GitHub repositories, subject to the limits in [security and privacy](docs/security.md). The bundled demo requires no token. `GITHUB_TOKEN` is optional and server-only; see [.env.example](.env.example). Never expose it as a `NEXT_PUBLIC_` variable.

Production runs in **demo-only** mode: GitHub acquisition always returns 503, and the landing page says import is disabled. A full import deployment is not implemented. The trusted local VS Code extension does not upload source.

## Supported analysis

File-level dependencies cover `.ts`, `.tsx`, `.js`, `.jsx` and relevant TypeScript/JavaScript configuration files. UI-flow adapters support statically detectable Next.js App Router, React Router, Expo Router and React Navigation patterns. Dynamic and ambiguous constructs can remain unresolved; results can be partial. See [architecture](docs/architecture.md) for detailed boundaries and limitations.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:e2e` for code and browser checks. See the [demo deployment guide](docs/deployment.md), [extension guide](apps/vscode/README.md), [release checklist](docs/release-checklist.md), and [roadmap](docs/roadmap.md). The project license is awaiting owner approval; do not assume distribution rights.

### Exploring a repository

Open Discover for a documentation-aware introduction, detected modules and suggested first steps. README statements are labeled documented and may be wrong; source links let you check them. Architecture starts with path-based module cards. Select a module, browse its files, and choose a file to inspect imports and source evidence. The 2D and 3D buttons open contextual maps; **Advanced / Raw graph** is an explicit option for the complete file graph. Features lists source-backed routes, conventional entry points and exported functions/classes with direct supported references. Routes & Features provides detected screen navigation. Learning and Impact Analysis provide guided lessons and possible downstream effects. These are static observations, not proof of runtime behavior; partial snapshots and unsupported patterns are reported.

From Features, open **Static Walkthrough** to follow bounded, source-located references one step at a time. Branch choices show alternative static references and source conditions; CodeDNA does not run the repository, evaluate conditions or invent runtime responses. The Studio retains the selected feature when you return to Features or Architecture.

### Behavior-first views and Ask CodeDNA

The Explorer opens on **Understand**: a short description of the repository (from its documentation when it has any, otherwise generated from detected routes and exports), a recommended starting behavior, and questions generated from detected evidence. **Explore** follows one behavior at a time, one step at a time, with a contextual "Why does this happen?" and "Show the code". **Ask CodeDNA** answers questions from detected behaviors and retrieved source excerpts. Architecture, Features, Static Walkthrough, UI Flow, Impact Analysis and Learning are under **Advanced tools**.

Behaviors, stories and deterministic answers need no AI service. Steps are static references; they do not prove runtime execution.

Optional AI answers are off unless a server-side provider is configured with environment variables (never committed or sent to the browser): `CODEDNA_AI_PROVIDER` (`anthropic` or `openai-compatible`), `CODEDNA_AI_MODEL`, `CODEDNA_AI_API_KEY` (not needed for a local endpoint), and `CODEDNA_AI_BASE_URL` (required for `openai-compatible`; HTTPS unless local). `CODEDNA_AI_DISABLED=1` turns AI off. In production AI also requires `CODEDNA_AI_ALLOW_PRODUCTION=1`. Each request needs your explicit permission and sends only up to 12 short, secret-redacted excerpts plus your question; the Ask view lists the files used. Responses must cite the retrieved evidence; unmatched citations are removed and uncited answers are discarded in favor of the deterministic answer.
