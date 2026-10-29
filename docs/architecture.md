# Architecture

- `apps/web`: Next.js web entry point, with Tailwind and configuration ready for shadcn/ui components.
- `apps/vscode`: placeholder for a future VS Code extension.
- `packages/shared`: versioned, framework-independent snapshot and analysis contracts.
- `packages/core`: snapshot-in, result-out analysis engine; no filesystem fetching, browser, React, Next.js, or VS Code dependencies.
- `packages/github`: future repository acquisition adapter; currently empty.
- `packages/graph-ui`: reusable React Flow architecture map, graph adapter and ELK layout; independent of Next.js and repository acquisition.

Both clients will supply snapshots to the same core and render its results. Acquisition and presentation stay outside the engine. Package exports point at generated JavaScript and declarations; Turbo builds dependencies before dependent checks and builds.

## Analysis pipeline

`analyzeSnapshot(snapshot, options?)` validates the version 1.0 snapshot before analysis. Invalid schema, entries, IDs, duplicate normalized paths, absolute paths, backslashes, traversal, unsupported extensions, or limits throw `SnapshotValidationError`. Inputs contain `.ts`, `.tsx`, `.js`, `.jsx`, and `tsconfig.json` / `jsconfig.json` only. Paths use POSIX separators; redundant `.` and separators are normalized. Defaults are 10,000 files, 2 MiB per file, and 50 MiB total UTF-8 content; callers can lower or raise them with `maxFiles`, `maxFileBytes`, and `maxTotalBytes`. Files are sorted, indexed in memory and parsed once with the TypeScript Compiler API. Syntax diagnostics retain one-based, end-exclusive locations; analysis continues across parse errors.

The resolver uses TypeScript's module resolution against an in-memory host containing only snapshot files and directories. It supports relative extension and index lookup, TypeScript extension substitution, and the nearest snapshot `tsconfig.json` or `jsconfig.json` compiler options including `baseUrl` and `paths`. Configuration parsing errors are diagnostics. Configuration inheritance and project references are not followed and produce warnings. Default resolution uses Node10 conventions; supplied resolution options can alter behavior. No host filesystem is consulted.

Edges point **from importer to dependency**. Each source file is `file:<normalized path>`; external packages use `package:<package name>` (subpaths aggregate to the package). Edge IDs contain the encoded importer path, source offset, kind, and target ID. They are deterministic for identical source text, but edits before a reference can change its edge ID. Nodes, edges, and diagnostics are sorted. Each edge records kind, original specifier, location, and evidence. Shared types add these fields optionally for compatibility with 1.0 consumers; this engine always supplies them. File IDs from the input validate snapshot identity but do not determine graph identities.

Static imports, re-exports, literal dynamic imports and literal `require` calls are captured. Missing relative or matched alias targets and nonliteral calls are diagnostics without edges. Bare specifiers not matching an alias are modeled as external packages, not verified as installed; unresolved package subpaths and package exports cannot be established without package metadata. Dynamic expressions, require shadowing, semantic/type errors, package manifests, config inheritance, and UI flow analysis are not modeled. The empty UI-flow graph is a placeholder, not a finding. Confidence reflects syntactic evidence, not proof of runtime behavior. Further resolution modes and incremental caches can be added behind the snapshot boundary.

## Web shell

The web app owns route composition, design primitives, repository URL validation, and Explorer interaction state. `lib/example.ts` contains a clearly labeled bundled source snapshot. The Explorer route analyzes that snapshot once at the server module boundary and passes the resulting shared `AnalysisResult` to the client; no repository is fetched. Other modes remain placeholders.

## Architecture map

`@codedna/graph-ui` adapts `DependencyGraph` into React Flow elements without changing node or edge IDs, importer-to-dependency direction, or source metadata. File and external package nodes have different treatments; counts represent immediate incoming and outgoing edges. The Explorer owns one selected graph ID. File-list selection and graph selection update it, and the inspector shows source for files or context for packages. The map highlights the selected node and its immediate incoming and outgoing neighbors; clicking the canvas clears selection.

ELK's layered left-to-right layout receives sorted IDs and fixed node dimensions. It runs asynchronously, ignores stale completions, and falls back to a deterministic non-overlapping grid on failure. Selection changes do not relayout. The canvas offers pan, zoom, fit and reset. A warning appears at 250 nodes and React Flow limits rendering to visible elements; data is not truncated. Layout runs on the browser's main thread, so large or dense graphs can still pause interaction; a worker and incremental layout are future improvements. Edge routes are React Flow paths based on laid-out node positions rather than ELK's routed edge sections. The bundled ELK layout test covers a 500-file chain, not every topology.

Analysis diagnostics remain visible above the map. Empty graphs, single files, cycles, and disconnected components are supported. Repository acquisition is deliberately separate: a future adapter can supply a validated `RepositorySnapshot`, call `analyzeSnapshot` once per snapshot revision, and pass the result into the same map. UI flows, impact analysis, learning mode, and repository importing remain out of scope.