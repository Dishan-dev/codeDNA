# Release acceptance checklist

Status definitions: **PASS** means the named test was actually performed and met its expected result; **FAIL** means it was performed and did not; **BLOCKED** means a prerequisite prevents it; **NOT TESTED** means it has not been performed. Automated coverage does not replace the manual visual checks below. Record tester, date, environment, outcome and issue links before changing any status.

## Web manual acceptance

| Status     | Scenario                            | Expected result                                                                                                     |
| ---------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| NOT TESTED | Production demo landing and example | Demo-only message is visible; example opens; import is unavailable.                                                 |
| NOT TESTED | Architecture Map                    | Pan, zoom, fit, reset, node selection and file-tree/inspector synchronization work.                                 |
| NOT TESTED | UI Flow                             | Next.js and React Router samples show sourced screens and navigation, including unresolved events.                  |
| NOT TESTED | Impact                              | Select a changed file and inspect direct/transitive dependents and evidence paths.                                  |
| NOT TESTED | Learning                            | Navigate lessons, answer a question and follow links into other modes.                                              |
| NOT TESTED | Repository/revision isolation       | In a controlled development setup, new revisions do not inherit a previous session's progress or selection.         |
| NOT TESTED | Partial data and errors             | Partial analysis is clearly labeled; invalid URLs, timeouts and failed imports produce safe messages.               |
| NOT TESTED | Accessibility and responsive layout | Navigate tabs, nodes, controls and inspector by keyboard; inspect focus, labels, reduced motion and narrow layouts. |

## VS Code manual acceptance

| Status     | Scenario                         | Expected result                                                                               |
| ---------- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| NOT TESTED | Install from VSIX                | Install the local package in a disposable VS Code profile and activate the extension.         |
| NOT TESTED | Trusted and untrusted workspaces | Trusted local analysis works; untrusted and virtual workspaces do not run analysis.           |
| NOT TESTED | Graph interactions and modes     | Architecture and UI Flow maps, Impact and Learning views display and respond correctly.       |
| NOT TESTED | Source navigation                | Open a source-located event and verify the file, line and column in the editor.               |
| NOT TESTED | Refresh and workspace switching  | Change files, refresh and switch folders; stale results are not shown in another workspace.   |
| NOT TESTED | Webview and keyboard             | Select files and graph nodes, change modes and use controls with keyboard and visible focus.  |
| NOT TESTED | Errors and cancellation          | Missing or unreadable files, limits and cancellation produce actionable partial/error states. |

## Release gates

| Status     | Gate                                               | Evidence needed                                                                                                                  |
| ---------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| BLOCKED    | Owner-approved license                             | Approved license and distribution terms; none is assumed.                                                                        |
| BLOCKED    | Public GitHub acquisition                          | Distributed rate/queue budgets and target-host process/container isolation verified end to end; see [deployment](deployment.md). |
| BLOCKED    | Production environment validation                  | Verify packaging, liveness, direct-origin protection and secret handling in the selected environment.                            |
| BLOCKED    | VSIX publishing                                    | Resolve licensing, packaging-tool advisory and complete manual host checks.                                                      |
| NOT TESTED | Independent manual visual and accessibility checks | Complete the manual scenarios above.                                                                                             |
| NOT TESTED | GitHub Actions execution for this candidate        | Confirm Linux POSIX test, unit, E2E, host, worker, build, package, audit and release checks on the actual candidate.             |

Do not deploy or publish as part of running these checks.
