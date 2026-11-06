# Architecture

CodeDNA helps beginners and vibe coders understand real apps through animated feature stories and hands-on challenges. Lessons are built only from real code; anything the analyzer cannot follow is shown as an unknown part, never invented.

## Packages

- `packages/shared`: versioned contracts. Schema `1.0` holds the snapshot types; schema `2.0` (`analysis.ts`, `learning.ts`) holds the analysis, lesson, challenge and progress contracts.
- `packages/core`: pure engine, snapshot in → result out. No filesystem, network, React, Next.js or execution of repository code.
  - `snapshot/`: validation (safe paths, analyzable languages, size and count limits) and syntax-only parsing.
  - `graph/`: in-memory resolution host (only `baseUrl` and `paths` are read from tsconfig/jsconfig; `extends` and plugins are ignored), the import graph, and a TypeScript `Program` + `TypeChecker` over snapshot text (`noLib`, no `@types`) that resolves calls, re-exports, aliases and methods.
  - `adapters/ui/`: Next.js App Router routes (pages, layouts, route handlers).
  - `adapters/effects/`: recognises Prisma, Supabase, Drizzle, `fetch`, axios, Next.js redirect/router/cache/cookies, zod, `useState`, auth libraries, email and payments. Packages are absent from snapshots, so these match by import origin and call shape, not by type.
  - `features/`: entry points (JSX event handlers, form actions, links, unreached API routes and server actions) followed through resolved calls into steps with a journey stage, branches with exact condition text, effects, unknown parts with friendly reasons, and template captions.
  - `framework.ts`, `analyze.ts`: framework detection and the bounded `analyzeRepository` pipeline. Concepts are tagged on each step during analysis, where the syntax tree is available.
  - `learn/`: `buildLearningPlan(analysis)` turns analysis data into lessons, without needing code. It holds the hand-written concept catalog, one lesson per meaningful feature, the easy-to-hard path, the four challenge generators (Predict, Order the steps, Spot the bug, Fill the gap; all seeded and deterministic, never using unknown steps as answers), hidden lessons and the one-sentence app summary.
- `packages/node`: Node-only helpers. `runAnalysis` runs the engine in a worker thread with heap and time limits; `readLocalSnapshot` reads a folder safely (no symlinks, no `.env*`, no build output, bounded).
- `apps/cli`: `codedna analyze [folder] [--json] [--out file]`.
- `packages/github`: public GitHub acquisition at a pinned commit with request, size, count and time limits; fails closed.
- `packages/learn-ui`: React components for learning (Feature Story player, Concept Card, the four challenge views, celebration) and pure, tested logic for story paths and local progress (XP, streak, mastery, "Updated" lessons).
- `apps/web`: Next.js learning UI: Start, My App, Features, Feature Story, the lesson flow (Watch → Understand → Try → Recap), Skill Map and a Concept Card drawer. Starter repos are analysed at build time into `public/starters/*.json`; progress is stored in IndexedDB. `next dev` writes to `.next-dev`, builds to `.next`. End-to-end tests (Playwright + axe, normal and reduced motion) live in `apps/web/e2e`.
- `apps/vscode`: placeholder for a later phase.

## Where analysis runs

Analysis always runs in Node: in the CLI on the learner's machine, in a server worker for GitHub imports, or at build time for starter repos. The browser receives JSON results only, so the TypeScript compiler is never shipped to the client.

## Conventions

Paths are repository-relative with forward slashes. Lines are 1-based; `CodeRef` ranges are inclusive. Identifiers are derived from paths, names and positions, so they are stable for a commit; `Feature.key` is also stable across commits. Every step and edge carries one confidence tier: `resolved`, `conventional` (framework rule), `heuristic` or `gap` (shown to learners as Sure, Framework rule, Likely, Unknown). Hitting a limit returns a partial result marked `partial`, never a silent omission.
