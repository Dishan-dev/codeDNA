# Demo deployment and full deployment prerequisites

## Release modes

- **Local development**: `pnpm dev` serves the bundled examples and permits the bounded public GitHub acquisition path. This is for trusted local use, not public hosting.
- **Demo-only production**: `pnpm build` followed by `pnpm --filter @codedna/web start` serves the bundled examples. `POST /api/repositories/acquire` unconditionally returns 503 in production; there is no switch to bypass that protection. The landing page explicitly says import is disabled. `/api/health` returns `{ "status": "ok", "mode": "demo-only" }` as a liveness check, not a security-readiness assertion.
- **Full deployment**: not implemented. Do not run the development server publicly or substitute `NODE_ENV=development` to enable imports.

## Reproduce and run locally

Use Node `^20.19.0`, `^22.13.0` or `>=24` and pnpm 9.15.9. Run from a clean checkout:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter codedna-vscode test:worker
pnpm --filter codedna-vscode package
pnpm release:check
pnpm --filter @codedna/web start
```

Open http://localhost:3000 and check `/api/health`. In PowerShell use `pnpm.cmd` if command resolution requires it. The web process must start with `apps/web` as its working directory; the filtered `start` script does this. The deployment must include the workspace installation, compiled package `dist` directories, `.next`, and `apps/web/workers/analysis.mjs`. `release:check` tests the source worker entrypoint and Next production server with the workspace installation; it does **not** validate standalone or serverless packaging. The production route is disabled and does not launch the worker. Verify packaging again in any chosen deployment platform before enabling acquisition.

The package script normalizes VSIX ZIP entry order and timestamps. Two consecutive local packages produced identical hashes during this check; byte-for-byte reproducibility across operating systems and toolchains has not been established. Validate the normalized VSIX in a real VS Code installation before distribution.

The demo needs no secrets. `PORT` and `HOSTNAME` are Next server settings when supported by the chosen launch command. `GITHUB_TOKEN` is optional for local public-repository acquisition only and must remain server-side. Do not set it for demo-only production. Never put credentials in `NEXT_PUBLIC_` variables. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and `VSCODE_EXECUTABLE_PATH` are optional test-runner paths, not application configuration.

## Distributed protection design for a future full deployment

Select the hosting platform and threat model first. A trusted ingress must identify clients without accepting forged forwarded headers, block direct origin access, cap body size/read time, and use a shared, atomic rate-limit store across all instances. Apply separate per-client and global token buckets, plus a global leased semaphore for concurrent acquisitions. Leases need unique job IDs, expiry, bounded renewal, idempotent release, and conservative handling of store outages; reject requests if a limiter or semaphore is unavailable. Keep the existing per-process limits as secondary safeguards. Set budgets based on observed traffic and capacity rather than treating example numbers as production policy.

Track request count, file count, source bytes, upstream requests, queue depth, elapsed time and worker failures per job, without recording source or secrets. Enforce acquisition, queue, worker and overall deadlines; propagate cancellation and release leases on all paths. Monitor rate-limit rejections, failed leases, provider rate limits, queue age, memory, CPU, timeout rates and abuse patterns. Validate multi-instance concurrency, counter atomicity, failover, expiry, cancellation and bypass resistance before enabling the route. No store, provider or paid service is configured today.

## Isolated analysis design for a future full deployment

A separate supervisor should send a versioned, size-bounded snapshot over authenticated private IPC to an ephemeral process/container per job, and receive only a bounded result. Use an unprivileged identity, read-only root filesystem, empty bounded scratch space, no host mounts, dropped capabilities, a restrictive syscall profile where available, and no outbound network. Apply OS-enforced CPU quota, memory and process limits, file-descriptor limits and a hard wall-clock deadline; cap workers and queue capacity globally. The supervisor must terminate and reap jobs on timeout, client cancellation, crash or budget breach, remove scratch data and release the lease even on failures. Do not log repository contents. Worker threads and V8 heap limits are not a substitute for this isolation.

Choose and test concrete limits on the target host using realistic and hostile snapshots; the existing 15-second worker timeout and 256 MiB V8 heap are not proven container limits. Verify that cancellation, hard kills, out-of-memory conditions, filesystem/network restrictions, cleanup, process-tree termination and cross-request isolation hold on that host. Until these controls and the distributed limiter pass end-to-end tests, full acquisition remains blocked.

## Vercel demo-only setup

Import this repository as a Vercel project and set its Root Directory to `apps/web`. Enable **Include source files outside of the Root Directory in the Build Step**, because the app imports workspace packages and a bundled example from the repository. Select the Next.js framework preset and Node.js 24 in the project settings. The checked-in `apps/web/vercel.json` runs `pnpm exec turbo run build --filter=@codedna/web`, which builds the web app and its workspace dependencies. Vercel should discover `pnpm-lock.yaml` and the root `packageManager` setting; use frozen-lockfile installation where supported and do not add GitHub credentials to the demo.

Run `pnpm build` followed by `pnpm verify:web-output` locally to inspect Next.js server traces for workspace test files. Tests remain in the repository and CI; Vercel may still access them during its source checkout and build. The bundled Next.js example fixture is app data and is required by the Explorer. After a deployment is actually created, independently verify the landing page, `/api/health`, Explorer and the 503 acquisition response in the target environment. This configuration has not been validated by a Vercel cloud build, and it does not enable GitHub import.
