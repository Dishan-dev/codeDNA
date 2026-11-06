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
```

Your code is read on your computer only: nothing is uploaded and nothing in your project runs. CodeDNA reads TypeScript/JavaScript sources, tsconfig/jsconfig, package.json and READMEs; it skips `.env*` files, anything in `.gitignore`, build output and symlinks. The local page answers only on localhost. (`npx codedna` will work once the package is published.)

## Learn from a public GitHub repo

Paste a link like `https://github.com/owner/repo` on the start page. The server downloads the repo at its current commit (its code is only read, never run), builds lessons and opens `/r/gh-<owner>-<repo>`. Imports are cached for 10 minutes per repo (and on disk in the system temp folder), limited to 5 per visitor every 10 minutes and 60 per hour overall, with at most 2 running at once.

It is on with `pnpm dev` and with the CLI. On a public deployment it is **off** until you set:

| Setting | Meaning |
| --- | --- |
| `CODEDNA_GITHUB_IMPORT=on` | Allow imports on a production server. |
| `GITHUB_TOKEN=<token>` | Optional. A read-only token raises GitHub's limit from 60 to 5,000 requests an hour. |

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

Not built yet: the "Test it" stage, the AI helper, browsing repos on the Explore page, and the VS Code extension (see the [roadmap](docs/roadmap.md)). Progress is saved only in this browser, so clearing site data resets it.

## Checks

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @codedna/web e2e   # Playwright + axe; first run: pnpm --filter @codedna/web exec playwright install chromium
```

No environment variables are required. See [architecture](docs/architecture.md) for boundaries and [roadmap](docs/roadmap.md) for planned phases.
