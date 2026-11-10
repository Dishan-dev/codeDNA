# CodeDNA

CodeDNA helps beginners and vibe coders understand real apps — including the one their AI built for them — through animated feature stories and hands-on challenges, instead of videos. Lessons are built only from real code, and anything CodeDNA can't follow is shown as an unknown part, never invented.

## Getting started

Install Node.js 20.19+, 22.13+, or 24+ and pnpm 9.15.9 (Corepack can provision the version in `packageManager`). Then run:

```sh
pnpm install
pnpm dev
```

Open http://localhost:3000 and pick the Snackshop starter repo.

## Learn your own app

Build once, then point CodeDNA at your project folder:

```sh
pnpm build
pnpm codedna path/to/your-app        # opens http://localhost:3737/r/local-<your-app>
pnpm codedna analyze path/to/your-app  # a summary in the terminal (--json, --plan, --out)
pnpm codedna qa path/to/your-app       # the QA agent: your tests, then (with --url) a browser walk
pnpm codedna ci path/to/your-app       # a GitHub Actions workflow that tests every flow after each deploy
```

Your code is read on your computer only: nothing is uploaded, and nothing in your project runs and nothing acts in your app except through `codedna qa` (or the Test buttons on the local QA flows page), after you say yes. CodeDNA reads TypeScript/JavaScript sources, tsconfig/jsconfig, package.json and READMEs; it skips `.env*` files, anything in `.gitignore`, build output and symlinks. The local page answers only on localhost. (`npx codedna` will work once the package is published.)

## Check requirements and quality

- **Requirements** — drop an SRS or client brief (PDF, Word .docx, text or Markdown) on the Requirements page. It is read in the browser, never uploaded, and each requirement is matched to the traced flows as built, partly built or not found.
- **Quality** — findings and edge cases read from the code, plus the results of the QA agent.
- **QA agent** — `codedna qa` shows its plan and asks before running anything:
  - `tests` runs the project's own `test` script and reads the pass/fail counts (Vitest, Jest, Mocha, node:test).
  - `walk` (with `--url`, your running app like `http://localhost:3000` or a deployed site like `https://my-app.vercel.app`) opens each traced page in a hidden Chrome or Edge and reports crashes, server errors and console errors. It never sends data.
  - `flows` runs every traced feature as a person would, step by step (open the page → find the button → fill the form → press → request → server answer → result), with a screenshot. Without `--interact` it only looks: each flow is reached and links are followed, and any request that would send data is blocked. With `--interact` it runs each case: filled in properly, empty, wrong formats, very long text, emoji and a double press. What each case should do comes from the code (the request it sends, where it redirects, the checks it makes). This sends test data to your app — use a test copy; deleting, paying, transferring and signing out are always skipped. Pages behind a sign-in are reported, not tested, for now.
  - `journeys` runs **user journeys** end to end in one browser session: features joined in the order a person uses them (home → a link → another link → the task → its result), worked out from the links and redirects in the code. When a page sends the browser to sign in, it signs in with your **test account** (saved on the QA flows page into the git-ignored `.codedna` folder, or the `CODEDNA_QA_EMAIL` / `CODEDNA_QA_PASSWORD` environment variables and CI secrets) and carries on. Every point records what happened, the HTTP request it saw (method, address, status, time) and a screenshot, and the journey stops at the first broken point. Look only follows links and signs in, but presses no other button. Journeys can be renamed, reordered, extended or hidden on the QA flows page; changes go to `codedna.journeys.json` at the project root (commit it so CI uses them).
  - **Deployed sites** (https) can always be looked at. `--interact` on a deployed site needs its owner's agreement: the site publishes `/.well-known/codedna.txt` containing the line `codedna: allow-testing` (in Next.js, `public/.well-known/codedna.txt`). Pages of a deployed site are opened at a slower pace, and the app's own requests carry an `x-codedna-qa` header. `--header "name: value"` adds a header for the app only (e.g. `x-vercel-protection-bypass` for protected previews).
  - The **QA flows** page opens on **User journeys**: each journey drawn as a map, left to right (page → button → request → server answer → next page), whose points light up live as it runs — grey, blue while testing, green, red where it broke, with the HTTP status under request points. Click a point for what happened, the request and answer, the line of code and the screenshot. The **Single features** tab lists every feature by part, and for each case shows which step broke, the matching line in the code and the screenshot. Opened with `codedna`, it has **Test all flows** and **Test this flow** buttons: the run happens on your computer through the local CodeDNA server (token-protected, localhost only), the steps fill in live, and a full test asks before sending data. On the hosted site, for a GitHub repo, **Test all flows** starts the repo's CodeDNA QA workflow on GitHub Actions (see below) and loads the results — with screenshots of what broke — when it finishes. You press **Connect GitHub** and approve the CodeDNA GitHub App (see the table below); without the app set up, you paste a fine-grained token for that repo with "Actions: Read and write" instead. The sign-in stays in your browser and goes only to GitHub, plus once per run to CodeDNA's server to fetch the results zip (GitHub doesn't let browsers download it; the zip is only read, never run, and the token isn't stored). The hosted site itself never drives a browser.
  - **Automated QA:** `codedna ci` adds `.github/workflows/codedna-qa.yml`. GitHub then tests every flow after each successful deploy (with a pull-request comment and job summary), every night against the `CODEDNA_QA_URL` variable, and by hand. It looks only unless `CODEDNA_QA_INTERACT` is `true`; the report and screenshots are kept as the `codedna-qa` artifact, and the report loads on that repo's QA flows page (`--github owner/repo` gives it the repo's id).
  - The report is saved to `.codedna/qa-report.json` (screenshots in `.codedna/qa/<run>/`, last 5 runs kept, git-ignored) in the project. `codedna` in the same folder shows it, or load the file on the QA flows or Quality page. Testing one flow from the page updates only that flow's results. New checks are added as runners in `apps/cli/src/qa/` that write the shared `QaReport` format.
- **Overview and Projects** — each project has an Overview (learning, coverage, risks, last QA run, what to do next), and `/projects` lists every project opened in this browser.

## Learn from a public GitHub repo

Paste a link like `https://github.com/owner/repo` on the start page. The server downloads the repo at its current commit (its code is only read, never run), builds lessons and opens `/r/gh-<owner>-<repo>`. Imports are cached for 10 minutes per repo (and on disk in the system temp folder), limited to 5 per visitor every 10 minutes and 60 per hour overall, with at most 2 running at once.

It is on with `pnpm dev` and with the CLI. On a public deployment it is **off** until you set:

| Setting | Meaning |
| --- | --- |
| `CODEDNA_GITHUB_IMPORT=on` | Allow imports on a production server. |
| `GITHUB_TOKEN=<token>` | Optional. A read-only token raises GitHub's limit from 60 to 5,000 requests an hour. |
| `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_SLUG` | Optional. Turns on **Connect GitHub** on the QA flows page. Register a GitHub App with the callback URL `https://<your-site>/api/github/auth/callback`, "Expire user authorization tokens" on, no webhook, and the repository permission **Actions: Read and write** only. |

## Developer mode

While CodeDNA is being built, the public site shows **only the landing page**. Any other page (a lesson, a repo, `/explore`) shows an animated “CodeDNA is being built” screen at the same address, and the API answers `503` with a short message (the GitHub form on the landing page shows it).

It is on automatically for Vercel builds of the `main` branch, and off for `pnpm dev`, local builds and the CLI. `CODEDNA_DEVELOPER_MODE=on` or `off` decides it anywhere; set it to `off` in Vercel (and redeploy) to open the full app.

## Limitations

What CodeDNA can learn from:

- **Full lessons** need a Next.js app that uses the App Router, written in JavaScript or TypeScript. Other JavaScript/TypeScript projects are read, but they may give few or no lessons.
- **Only `.js`, `.jsx`, `.ts` and `.tsx` files** are read, plus `package.json`, `tsconfig`/`jsconfig` and READMEs. PHP, Python, Ruby, Go, Java and other languages are not read, and neither are `.vue`, `.svelte`, `.mjs` or `.cjs` files. A GitHub import of a repo that is mostly another language says so on its page.
- **Anything decided while the app runs** (a setting, a value from the user, a function picked at runtime) is shown as an unknown part, never guessed.
- **Repos with many separate apps** (course repos, big monorepos) can give repeated or noisy lessons.

GitHub imports:

- Public repos only, at the latest commit on the default branch. Unpushed work and other branches aren't seen.
- Folders like `node_modules`, `dist`, `build`, `vendor` and `.next` are skipped, and so are minified files, symbolic links and submodules.
- Up to 1,000 code files, 2 MB per file and 50 MB in total. The download and the analysis each stop after 60 seconds.
- 5 imports per visitor every 10 minutes, 60 per hour overall and 2 at once. The same repo imported again within 10 minutes reuses the first result.
- Without `GITHUB_TOKEN`, GitHub allows this server 60 API requests an hour. Most imports use the single archive download, which doesn't count toward that limit, but repos that are mostly images fetch files one by one.
- The rate limits are kept in the server's memory: they reset when it restarts and aren't shared between server instances. Visitors are told apart by the `x-forwarded-for` header, which a client can fake, so put a trusted proxy in front of a public deployment.

Learning your own folder (`pnpm codedna`):

- Same file types as above. `.env*` files, anything in `.gitignore`, build output and symlinks are skipped.
- It doesn't yet report other languages, so a folder of PHP just shows "no lessons yet".

Not built yet: generating test files, the "Test it" stage, the opt-in AI helper, browsing repos on the Explore page, and the VS Code extension (see the [roadmap](docs/roadmap.md)). Progress is saved only in this browser, so clearing site data resets it.

## Checks

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @codedna/web e2e   # Playwright + axe; first run: pnpm --filter @codedna/web exec playwright install chromium
```

No environment variables are required. See [architecture](docs/architecture.md) for boundaries and [roadmap](docs/roadmap.md) for planned phases.
