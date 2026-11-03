# Roadmap

1. **Foundation:** workspace, contracts, web entry point and CI.
2. **Static analysis:** snapshot-based TypeScript/JavaScript dependency analysis.
3. **Explorer:** architecture and UI-flow maps, public GitHub acquisition, and framework adapters for Next.js App Router, React Router, Expo Router and React Navigation.
4. **Impact analysis:** bounded reverse dependency traversal with explainable paths and screen source attribution. Results identify possible effects, and incomplete or unresolved data is reported.
5. **Learning mode:** deterministic, evidence-grounded lessons and knowledge checks with session-local progress.
6. **VS Code extension:** local snapshot acquisition, shared analysis, Explorer webview and editor navigation.
7. **Future work:** broader language and framework coverage, incremental analysis, and performance and compatibility hardening.

Later phases are directional, not a commitment to a specific parser or service.

8. **Experimental 3D architecture:** optional, bounded directory-cluster view of existing static dependency evidence. Future refinement may add smoother camera transitions and browser/device validation; guided tours and 3D impact analysis remain future work.

9. **Module-first understanding:** evidence-backed repository structure, focused file exploration, bounded route context and optional scoped visualizations. Future work includes deeper language coverage and validation of large-repository usability.

## Product experience upgrade plan

- **A — Reliability foundation:** versioned capability assessment, evidence and safe UI-flow stage fallback. Worker failures and invalid snapshots still fail closed.
- **B — Discover and guided architecture:** design a bounded documentation input and acquisition path, then add source-linked documented versus verified explanations. Preserve the existing module-first architecture and source navigation.
- **C — Feature and function analysis:** add bounded symbol, call and feature-association analysis with explicit unresolved cases and fixtures.
- **D — Static walkthrough simulation:** define evidence-grounded flow contracts and implement bounded, non-executing walkthroughs with accessible controls.
- **E — Guided Explorer UX:** make Discover, Architecture, Features and Static Walkthrough a clear progression with contextual evidence, compact navigation, responsive panels and theme support.
- **F — QA foundation and polish:** define unexecuted versus observed test evidence and a future isolated, explicitly authorized runtime adapter; complete accessibility, performance and browser verification.

Each phase needs its own verification before the next. No AI provider, arbitrary repository execution, or paid infrastructure is required for the deterministic foundation.

### B and C implementation status

The working tree includes optional bounded documentation and manifest acquisition, deterministic repository understanding, default Discover, bounded static symbol/feature discovery, a Features workspace, and additive simulation-ready flow contracts. These changes are uncommitted and require full workspace and browser verification before closing the combined cycle.

### B+C stabilization and Phase D implementation

Discover, Architecture, Features and Static Walkthrough share the same repository snapshot, revision and selected feature. Documentation claims remain labeled documented; imports, symbols and direct references retain source evidence. B+C now supports a simple same-file export alias and exact literal `fetch('/api/path')` matching to a unique exported Next.js App Router handler. Ambiguous, dynamic and shadowed requests do not produce verified edges. Feature lists window visible rows; file search renders matches in explicit batches. The 2D Architecture and UI Flow map components are loaded only when opened; 3D was already lazy.

Phase D adds bounded deterministic static flows from supported feature entries, source-located steps, optional syntactic conditions, explicit branch choices and unresolved boundaries. The Studio offers play, pause, next, previous, restart, speed, step/source inspection and return navigation. It never runs repository code or supplies runtime values. Full workspace and browser gates remain required before marking this cycle complete; runtime QA is not implemented.

### Phase E guided Explorer presentation

The working tree now starts with a concise Discover view, a bounded module map in Architecture, a searchable feature choice/detail view, and a current-step-centered Static Walkthrough. File navigation and source evidence remain contextual, while advanced graph options and long evidence lists are available on demand. The existing analyzers, snapshot, diagnostics and lazy graph loading remain in use. Browser interaction and visual review remain outstanding; this phase does not add runtime QA.

### Behavior-first transformation (Understand, Explore, Ask CodeDNA)

Implemented and tested: shared versioned contracts (`packages/shared/src/behavior.ts`); deterministic behavior discovery with route/method grouping, documentation-title reuse only on shared distinctive words, CLI/library/interaction categories and stable ids (`behaviors.ts`); bounded, redacted, deterministic evidence retrieval (`evidence.ts`); conservative step stories over the existing static flows with roles assigned only where the relationship supports them (`stories.ts`); deterministic Ask answers with story/source/architecture/unresolved actions and selected-step context (`ask.ts`); provider-independent grounded AI with prompt construction, schema and citation validation and disclosure (`ai-grounding.ts`, web `ai-config.ts` and `/api/ai/*`); the Understand, Explore and Ask views, with the previous seven tools under Advanced tools. A comprehension evaluation covers frontend, full-stack, backend API, library, CLI, monorepo and minimal-documentation fixtures.

Known limits and remaining work: story wording is relationship-based, so titles are accurate but plain; the analyzer does not resolve handlers declared inside components, dynamic calls or non-TypeScript/JavaScript code, and those become unresolved boundaries rather than stories. There is no semantic retrieval, streaming, persisted conversation, or runtime evidence. A live AI provider has not been exercised against a real service; only mocked provider responses are tested. Eight pre-existing browser tests (for example those assuming the file panel is open by default) fail independently of this work and need updating. Production GitHub import stays disabled until a distributed limiter exists.


## Page → action → trace redesign (phase3)

The Explorer opens on **Overview**, with **Pages** next to it. The flow is Overview → page → action → trace, with source alongside, and "Who reaches this?" from any traced function. The earlier tools (Architecture, Features/module explorer, Routes, Function walkthrough, File impact, Learning, Discover, Behavior stories, Ask CodeDNA, Diagnostics and a JSON export) are under **Advanced tools**. The 3D architecture view is no longer linked; its package is unchanged. The design reference is `docs/design/codedna-ui-prototype.html`.

Done:

- Versioned contracts in `packages/shared/src/trace.ts` (`TRACE_SCHEMA_VERSION` 1.0): evidence tiers, pages, user actions, effects, trace steps with branches and gaps, reverse reach.
- `packages/core/src/actions.ts`: per-page detection of event handlers, form actions (including `useActionState`), server actions, links and route handlers; effect classification (fetch/axios, Prisma, redirect, revalidatePath/Tag, router, cookies, zod, React state); a tier on every step; explicit gap steps for dynamic `import()`, computed URLs, `obj[key]()`, environment-selected implementations, missing sources and functions passed in; branch conditions with options; templated plain text. Bounded by actions, steps, depth, components and time, and run in the existing analysis worker. Partial results are marked.
- `packages/core/src/trace-view.ts` (browser-safe): excerpt hydration, branch filtering, reverse reach, search.
- Fixture app `packages/core/fixtures/next-actions-app/` with deliberate gaps, and `scripts/build-fixture-snapshot.mjs` to regenerate its snapshot. It is also the `?example=roomly` sample (`?example=roomly-partial` drops one file to show the partial state).
- URL state for every screen (`view`, `page`, `action`, `step`, `symbol`, `mode`, `commit`), browser back support, and a trace permalink. A link made for a different commit says so.

Not done / limits:

- **"Proven" is not type-checked.** It means a call is bound through a compiler-resolved import or a declaration in scope. Moving call resolution to the TypeScript type checker is a separate phase that needs approval and a memory/time measurement inside the worker.
- Method calls on arbitrary objects are not followed (only recognised APIs and namespace imports). JSX rendered by helper functions outside components is not scanned. Pages Router API routes are not detected.
- Permalinks for imported GitHub repositories only resolve in the same browser session, because results live in session storage.
- Long action lists render progressively (60 at a time, more on scroll), not with true windowing.
- IBM Plex is not downloaded; system fonts are the fallback.
- **AI narration (Phase 4) is not started.** The header toggle is disabled.
- Explorer first-load JS is 147 kB (local `next build`), above the 138 kB recorded earlier. Behavior stories, Ask and Diagnostics are now lazy; the remaining increase was not attributed further.
- Seven older Playwright specs still fail on UI changes made before this redesign (file panel closed by default, reworked architecture guide, removed "Start guided learning", mode-tab order and labels).
