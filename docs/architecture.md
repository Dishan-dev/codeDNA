# Architecture

- `apps/web`: Next.js web entry point, with Tailwind and configuration ready for shadcn/ui components.
- `apps/vscode`: placeholder for a future VS Code extension.
- `packages/shared`: versioned, framework-independent snapshot and analysis contracts.
- `packages/core`: snapshot-in, result-out analysis engine; no filesystem fetching, browser, React, Next.js, or VS Code dependencies.
- `packages/github`: future repository acquisition adapter; currently empty.
- `packages/graph-ui`: future graph presentation package; currently empty.

Both clients will supply snapshots to the same core and render its results. Acquisition and presentation stay outside the engine. Package exports point at generated JavaScript and declarations; Turbo builds dependencies before dependent checks and builds.

Contracts use opaque identifiers, repository-relative paths, 1-based positions and exclusive end positions. Producers must choose IDs consistently for a given snapshot; an ID's exact derivation is not yet specified. Schema version `1.0` marks the initial contract. Confidence is in [0, 1] and evidence can point to source locations. Types describe these conventions but do not validate untrusted input at runtime.

Phase 1 supports snapshots carrying arbitrary source text; it parses no programming language. Language-specific support and runtime validation will be defined when analysis is implemented. Empty graphs from the placeholder are not evidence that a repository has no dependencies or flows.
