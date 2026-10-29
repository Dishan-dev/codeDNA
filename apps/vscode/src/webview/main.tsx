import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArchitectureMap, UIFlowMap } from '@codedna/graph-ui';
import '@codedna/graph-ui/styles.css';
import type { LearningPlan } from '@codedna/shared';
import type { ExplorerMode, WebviewRequest } from '../protocol.js';
import './webview.css';
declare function acquireVsCodeApi(): {
  postMessage(value: WebviewRequest): void;
};
const vscode = acquireVsCodeApi();
import { validState, type WebviewState as State } from './state.js';
const send = (message: WebviewRequest) => vscode.postMessage(message);
function App() {
  const [state, setState] = useState<State>({
    version: 1,
    type: 'state',
    status: 'empty',
    mode: 'Architecture',
  });
  const [screen, setScreen] = useState<string | null>(null),
    [large, setLarge] = useState(false),
    [query, setQuery] = useState('');
  const [step, setStep] = useState(0),
    [completed, setCompleted] = useState<string[]>([]),
    [answers, setAnswers] = useState<Record<string, string>>({});
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (validState(event.data)) setState(event.data);
    };
    window.addEventListener('message', receive);
    send({ version: 1, type: 'ready' });
    return () => window.removeEventListener('message', receive);
  }, []);
  useEffect(() => {
    setStep(state.progress?.step ?? 0);
    setCompleted(state.progress?.completed ?? []);
    setAnswers(state.progress?.answers ?? {});
    setScreen(null);
    setLarge(false);
  }, [state.identity]);
  const select = (path: string) => send({ version: 1, type: 'select', path });
  const open = (path: string, line?: number, column?: number) =>
    send({
      version: 1,
      type: 'open',
      path,
      ...(line ? { line } : {}),
      ...(column ? { column } : {}),
    });
  const changeMode = (mode: ExplorerMode) => {
    setLarge(false);
    send({ version: 1, type: 'mode', mode });
  };
  const selectedScreen = state.uiFlow?.graph.nodes.find((n) => n.id === screen);
  const graph =
    state.mode === 'Impact Analysis'
      ? state.impact?.dependencyGraph
      : state.result?.dependencyGraph;
  const graphCount =
    state.mode === 'UI Flow'
      ? (state.uiFlow?.graph.nodes.length ?? 0)
      : (graph?.nodes.length ?? 0);
  return (
    <main>
      <header>
        <strong>CodeDNA</strong>
        <span>Local workspace analysis</span>
        <button onClick={() => send({ version: 1, type: 'refresh' })}>
          Refresh
        </button>
      </header>
      <nav aria-label="Explorer modes">
        {(
          [
            'Architecture',
            'UI Flow',
            'Impact Analysis',
            'Learning Mode',
          ] as ExplorerMode[]
        ).map((mode) => (
          <button
            key={mode}
            aria-pressed={state.mode === mode}
            onClick={() => changeMode(mode)}
          >
            {mode}
          </button>
        ))}
      </nav>
      {state.status !== 'ready' ? (
        <section className="state">
          <h2>
            {state.status === 'loading'
              ? 'Analyzing workspace'
              : state.status === 'stale'
                ? 'Analysis needs refresh'
                : state.status === 'error'
                  ? 'Analysis failed'
                  : 'No analysis yet'}
          </h2>
          <p>{state.message ?? 'Run CodeDNA: Analyze Workspace to begin.'}</p>
          {state.status !== 'loading' && (
            <button onClick={() => send({ version: 1, type: 'refresh' })}>
              Analyze workspace
            </button>
          )}
        </section>
      ) : (
        <>
          {!state.complete && (
            <details className="warning" open>
              <summary>Partial snapshot: some files were skipped</summary>
              <ul>
                {state.diagnostics?.map((d, i) => (
                  <li key={i}>
                    {d.path}: {d.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {(state.result?.diagnostics.length ?? 0) > 0 && (
            <details className="warning">
              <summary>
                {state.result?.diagnostics.length} dependency diagnostics
              </summary>
              <ul>
                {state.result?.diagnostics
                  .slice(0, 50)
                  .map((d) => <li key={d.id}>{d.message}</li>)}
              </ul>
            </details>
          )}
          <div className="layout">
            <aside>
              <label>
                Filter files
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search paths"
                />
              </label>
              <div className="files">
                {state.files
                  ?.filter((path) =>
                    path.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((path) => (
                    <button
                      key={path}
                      aria-pressed={state.selection === path}
                      onClick={() => select(path)}
                    >
                      {path}
                    </button>
                  ))}
              </div>
            </aside>
            <section className="canvas">
              {state.mode === 'Learning Mode' ? (
                <Learning
                  plan={state.learning}
                  step={step}
                  setStep={(value) => {
                    setStep(value);
                    send({
                      version: 1,
                      type: 'progress',
                      step: value,
                      completed,
                      answers,
                    });
                  }}
                  completed={completed}
                  setCompleted={(value) => {
                    setCompleted(value);
                    send({
                      version: 1,
                      type: 'progress',
                      step,
                      completed: value,
                      answers,
                    });
                  }}
                  answers={answers}
                  setAnswers={(value) => {
                    setAnswers(value);
                    send({
                      version: 1,
                      type: 'progress',
                      step,
                      completed,
                      answers: value,
                    });
                  }}
                  open={open}
                />
              ) : (
                <>
                  {state.mode === 'Impact Analysis' && (
                    <div className="impact">
                      <strong>
                        Change target:{' '}
                        {state.impact?.selectedFilePath ?? 'none'}
                      </strong>
                      <button
                        disabled={!state.selection}
                        onClick={() =>
                          state.selection &&
                          send({
                            version: 1,
                            type: 'impact',
                            path: state.selection,
                          })
                        }
                      >
                        Analyze selected file impact
                      </button>
                      {state.impact && (
                        <>
                          <span>
                            {state.impact.summary.direct} direct;{' '}
                            {state.impact.summary.transitive} transitive;{' '}
                            {state.impact.summary.screens} screens
                          </span>
                          {state.impact.diagnostics.map((d) => (
                            <small key={d.id}>{d.message}</small>
                          ))}
                          <details>
                            <summary>Evidence paths and screens</summary>
                            {state.impact.files
                              .filter((f) => f.category !== 'selected')
                              .map((f) => (
                                <div key={f.id}>
                                  <button onClick={() => select(f.path)}>
                                    {f.path} ({f.distance})
                                  </button>
                                  {f.paths.map((p) => (
                                    <p key={p.id}>
                                      {p.fileIds.join(' -> ')} {p.certainty}
                                    </p>
                                  ))}
                                </div>
                              ))}
                            {state.impact.screens.map((s) => (
                              <p key={s.id}>
                                {s.screen.label}: {s.sourceFile}
                              </p>
                            ))}
                          </details>
                        </>
                      )}
                    </div>
                  )}
                  {graphCount >= 250 && !large ? (
                    <div className="state">
                      <p>
                        Large graph: {graphCount} nodes. Layout may take time.
                      </p>
                      <button onClick={() => setLarge(true)}>Show graph</button>
                    </div>
                  ) : state.mode === 'UI Flow' && state.uiFlow ? (
                    <UIFlowMap
                      graph={state.uiFlow.graph}
                      diagnostics={state.uiFlow.diagnostics}
                      selectedId={screen}
                      onSelectionChange={(id) => {
                        setScreen(id);
                        const node = state.uiFlow?.graph.nodes.find(
                          (n) => n.id === id,
                        );
                        if (node?.sourceFile) select(node.sourceFile);
                      }}
                      frameworkDetected={
                        !!state.uiFlow.framework ||
                        state.uiFlow.graph.nodes.length > 0
                      }
                    />
                  ) : graph ? (
                    <ArchitectureMap
                      graph={graph}
                      selectedId={
                        state.selection ? `file:${state.selection}` : null
                      }
                      onSelectionChange={(id) => {
                        if (id?.startsWith('file:')) select(id.slice(5));
                      }}
                    />
                  ) : (
                    <div className="state">
                      Select a source file and analyze its impact.
                    </div>
                  )}
                </>
              )}
            </section>
            <aside className="inspector">
              <h2>Inspector</h2>
              {state.selection ? (
                <>
                  <strong>{state.selection}</strong>
                  <button onClick={() => open(state.selection!)}>
                    Open source in editor
                  </button>
                  <button
                    onClick={() =>
                      send({
                        version: 1,
                        type: 'impact',
                        path: state.selection!,
                      })
                    }
                  >
                    Analyze impact
                  </button>
                </>
              ) : (
                <p>Select a file.</p>
              )}
              {state.mode === 'UI Flow' && selectedScreen && (
                <>
                  <h3>{selectedScreen.routePath ?? selectedScreen.label}</h3>
                  <p>{selectedScreen.framework}</p>
                  {state.uiFlow?.graph.navigationEvents
                    ?.filter((e) => e.sourceId === selectedScreen.id)
                    .map((e) => (
                      <div key={e.id}>
                        <p>
                          {e.kind}: {e.destination ?? e.resolution}
                        </p>
                        <button
                          onClick={() =>
                            open(
                              e.location.path,
                              e.location.start.line,
                              e.location.start.column,
                            )
                          }
                        >
                          Open evidence {e.location.path}:
                          {e.location.start.line}
                        </button>
                      </div>
                    ))}
                </>
              )}
            </aside>
          </div>
        </>
      )}
    </main>
  );
}
function Learning({
  plan,
  step,
  setStep,
  completed,
  setCompleted,
  answers,
  setAnswers,
  open,
}: {
  plan: LearningPlan | undefined;
  step: number;
  setStep: (v: number) => void;
  completed: string[];
  setCompleted: (v: string[]) => void;
  answers: Record<string, string>;
  setAnswers: (v: Record<string, string>) => void;
  open: (path: string, line?: number, column?: number) => void;
}) {
  if (!plan?.steps.length)
    return <div className="state">No learning plan is available.</div>;
  const current = plan.steps[Math.min(step, plan.steps.length - 1)]!;
  return (
    <div className="learning">
      <p>
        Step {step + 1} of {plan.steps.length} - {completed.length} completed
      </p>
      {plan.warnings.map((w) => (
        <p className="warning" key={w}>
          {w}
        </p>
      ))}
      <h2>{current.title}</h2>
      <p>{current.explanation}</p>
      <strong>Objective</strong>
      <p>{current.objective}</p>
      <strong>Next action</strong>
      <p>{current.action}</p>
      {current.files.map((path) => (
        <button key={path} onClick={() => open(path)}>
          {path}
        </button>
      ))}
      <details>
        <summary>Evidence</summary>
        {current.evidence.map((e, i) => (
          <p key={i}>
            {e.description}{' '}
            {e.location && (
              <button
                onClick={() =>
                  open(
                    e.location!.path,
                    e.location!.start.line,
                    e.location!.start.column,
                  )
                }
              >
                {e.location.path}:{e.location.start.line}
              </button>
            )}
          </p>
        ))}
      </details>
      {current.questions?.map((q) => (
        <section key={q.id}>
          <h3>{q.prompt}</h3>
          {q.choices.map((c) => (
            <button
              key={c.id}
              aria-pressed={answers[q.id] === c.id}
              onClick={() => setAnswers({ ...answers, [q.id]: c.id })}
            >
              {c.label}
            </button>
          ))}
          {answers[q.id] && (
            <p>
              {answers[q.id] === q.answerId ? 'Correct.' : 'Not quite.'}{' '}
              {q.explanation}
            </p>
          )}
        </section>
      ))}
      <div className="controls">
        <button disabled={step === 0} onClick={() => setStep(step - 1)}>
          Previous
        </button>
        <button
          onClick={() =>
            setCompleted(
              completed.includes(current.id)
                ? completed
                : [...completed, current.id],
            )
          }
        >
          Mark complete
        </button>
        <button
          disabled={step >= plan.steps.length - 1}
          onClick={() => setStep(step + 1)}
        >
          Skip
        </button>
        <button
          disabled={step >= plan.steps.length - 1}
          onClick={() => setStep(step + 1)}
        >
          Next
        </button>
      </div>
      <p>Progress lasts for this extension session.</p>
    </div>
  );
}
const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
