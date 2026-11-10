import { QA_OWNER_LINE, QA_OWNER_PATH } from './qa-target.js';

/** Where CI fetches CodeDNA from, until it is published on npm. */
export const CODEDNA_SOURCE = { repository: 'Dishan-dev/codeDNA', ref: 'main' } as const;
export const QA_WORKFLOW_PATH = '.github/workflows/codedna-qa.yml';
export const QA_WORKFLOW_FILE = 'codedna-qa.yml';
export const QA_ARTIFACT_NAME = 'codedna-qa';

/**
 * The GitHub Actions workflow that runs CodeDNA QA automatically: after every successful deploy
 * (Vercel, Netlify and others report deployments to GitHub), every night, and by hand. It runs
 * on GitHub's machines for the repo's owner — never on CodeDNA's servers.
 */
export function qaWorkflowYaml(source: { repository: string; ref: string } = CODEDNA_SOURCE): string {
  return `# CodeDNA QA: tries every user flow of your deployed site in a real browser.
# Made by “codedna ci”.
#
# It runs after each successful deployment (Vercel, Netlify and others report them to GitHub),
# every night against the CODEDNA_QA_URL variable, and by hand from the Actions tab.
#
# By default it only looks: it opens every page and flow, follows links, and sends nothing.
# To also fill in forms with test data (empty, wrong, very long, emoji, pressed twice):
#   1. publish ${QA_OWNER_PATH} on the site with the line:  ${QA_OWNER_LINE}
#      (in Next.js: public${QA_OWNER_PATH}). Do this only on a test or preview copy.
#   2. set the repository variable CODEDNA_QA_INTERACT to true.
# Deleting, paying, transferring and signing out are always skipped.
#
# Vercel previews behind Vercel Authentication: add the secret VERCEL_AUTOMATION_BYPASS_SECRET
# (Project settings → Deployment Protection → Protection Bypass for Automation).
#
# User journeys that need signing in: add a test account (never a real person's) as the secrets
# CODEDNA_QA_EMAIL and CODEDNA_QA_PASSWORD. Edit journeys in codedna.journeys.json.
name: CodeDNA QA
run-name: CodeDNA QA \${{ inputs.request }}

on:
  deployment_status:
  schedule:
    - cron: '17 3 * * *'
  workflow_dispatch:
    inputs:
      url:
        description: Address of the site to test
        required: true
      interact:
        description: Also fill in forms with test data (needs ${QA_OWNER_PATH})
        type: boolean
        default: false
      request:
        description: Set by the CodeDNA page that started this run, to find it again
        required: false
        default: ''

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: codedna-qa-\${{ github.event.deployment.sha || github.ref }}
  cancel-in-progress: true

jobs:
  qa:
    if: github.event_name != 'deployment_status' || github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    timeout-minutes: 30
    env:
      APP_URL: \${{ inputs.url || github.event.deployment_status.environment_url || github.event.deployment_status.target_url || vars.CODEDNA_QA_URL }}
      INTERACT: \${{ inputs.interact || vars.CODEDNA_QA_INTERACT == 'true' }}
      BYPASS: \${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}
      CODEDNA_QA_EMAIL: \${{ secrets.CODEDNA_QA_EMAIL }}
      CODEDNA_QA_PASSWORD: \${{ secrets.CODEDNA_QA_PASSWORD }}
    steps:
      - name: Check out your app
        uses: actions/checkout@v4
        with:
          path: app
          ref: \${{ github.event.deployment.sha || github.sha }}

      - name: Check out CodeDNA
        uses: actions/checkout@v4
        with:
          repository: ${source.repository}
          ref: ${source.ref}
          path: codedna-tool

      - uses: pnpm/action-setup@v4
        with:
          package_json_file: codedna-tool/package.json

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Build CodeDNA
        working-directory: codedna-tool
        run: pnpm install --frozen-lockfile --filter "codedna..." && pnpm --filter "codedna..." build

      - name: Test every flow
        run: |
          if [ -z "$APP_URL" ]; then
            echo "::notice::No site address. Set the CODEDNA_QA_URL variable, or run this by hand with one."
            exit 0
          fi
          args=(qa app --url "$APP_URL" --only journeys,flows --yes --github "$GITHUB_REPOSITORY" --markdown codedna-qa.md)
          if [ "$INTERACT" = "true" ]; then args+=(--interact); fi
          if [ -n "$BYPASS" ]; then args+=(--header "x-vercel-protection-bypass: $BYPASS"); fi
          node codedna-tool/apps/cli/dist/cli.js "\${args[@]}"

      - name: Keep the report and screenshots
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: codedna-qa
          path: app/.codedna
          include-hidden-files: true
          if-no-files-found: ignore
          retention-days: 14

      - name: Comment on the pull request
        if: always() && github.event_name == 'deployment_status'
        env:
          GH_TOKEN: \${{ github.token }}
          SHA: \${{ github.event.deployment.sha }}
        run: |
          [ -f codedna-qa.md ] || exit 0
          pr=$(gh pr list --repo "$GITHUB_REPOSITORY" --search "$SHA" --state open --json number --jq '.[0].number')
          [ -n "$pr" ] || exit 0
          gh pr comment "$pr" --repo "$GITHUB_REPOSITORY" --body-file codedna-qa.md --edit-last 2>/dev/null \\
            || gh pr comment "$pr" --repo "$GITHUB_REPOSITORY" --body-file codedna-qa.md
`;
}
