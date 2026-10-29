'use client';
import type { LearningPlan } from '@codedna/shared';
export interface LearningProgress {
  currentStepId: string | null;
  completed: string[];
  answers: Record<string, string>;
}
export const emptyLearningProgress: LearningProgress = {
  currentStepId: null,
  completed: [],
  answers: {},
};
export function LearningWorkspace({
  plan,
  progress,
  onProgress,
  onInspect,
  onExplore,
}: {
  plan: LearningPlan;
  progress: LearningProgress;
  onProgress: (value: LearningProgress) => void;
  onInspect: (file: string) => void;
  onExplore: (
    mode: 'Architecture' | 'UI Flow' | 'Impact Analysis',
    file?: string,
    screenId?: string,
  ) => void;
}) {
  if (!plan.steps.length)
    return (
      <div className="workspace-state">
        <h2>No learning plan available</h2>
        <p>
          {plan.warnings.join(' ') || 'Analyze source files to create a plan.'}
        </p>
      </div>
    );
  const index = Math.max(
    0,
    plan.steps.findIndex((s) => s.id === progress.currentStepId),
  );
  const current = plan.steps[index]!;
  const setStep = (id: string) =>
    onProgress({ ...progress, currentStepId: id });
  const complete = () =>
    onProgress({
      ...progress,
      currentStepId: current.id,
      completed: progress.completed.includes(current.id)
        ? progress.completed
        : [...progress.completed, current.id],
    });
  return (
    <div className="learning-workspace">
      {plan.warnings.length > 0 && (
        <details className="analysis-diagnostics" open>
          <summary>Analysis may be incomplete ({plan.warnings.length})</summary>
          <ul>
            {plan.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="learning-layout">
        <nav className="learning-steps" aria-label="Learning roadmap">
          <div className="learning-kicker">YOUR LEARNING ROADMAP</div>
          <h2>Understand the codebase</h2>
          <p>
            {
              progress.completed.filter((id) =>
                plan.steps.some((step) => step.id === id),
              ).length
            }{' '}
            of {plan.steps.length} steps completed
          </p>
          <ol>
            {plan.steps.map((step, i) => (
              <li key={step.id}>
                <button
                  type="button"
                  aria-current={step.id === current.id ? 'step' : undefined}
                  onClick={() => setStep(step.id)}
                >
                  <span>
                    {progress.completed.includes(step.id)
                      ? '✓'
                      : String(i + 1).padStart(2, '0')}
                  </span>
                  <span>
                    {step.title}
                    <small>{step.complexity}</small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <article className="learning-lesson" aria-labelledby="learning-title">
          <div className="learning-kicker">
            STEP {index + 1} / {plan.steps.length} ·{' '}
            {current.complexity.toUpperCase()}
          </div>
          <h2 id="learning-title">{current.title}</h2>
          <p className="learning-description">{current.explanation}</p>
          <div className="learning-block">
            <h3>Objective</h3>
            <p>{current.objective}</p>
            <h3>Try this</h3>
            <p>{current.action}</p>
          </div>
          {current.files.length > 0 && (
            <div className="learning-block">
              <h3>Source files</h3>
              <p>Open a file in the inspector without leaving this lesson.</p>
              {current.files.map((file) => (
                <button
                  key={file}
                  className="learning-file"
                  type="button"
                  onClick={() => onInspect(file)}
                >
                  {file}
                </button>
              ))}
            </div>
          )}
          {current.evidence.length > 0 && (
            <details className="learning-evidence">
              <summary>View evidence ({current.evidence.length})</summary>
              <ul>
                {current.evidence.map((e, i) => (
                  <li key={i}>
                    {e.description}
                    {e.location && (
                      <>
                        {' '}
                        —{' '}
                        <button
                          type="button"
                          onClick={() => onInspect(e.location!.path)}
                        >
                          {e.location.path}:{e.location.start.line}:
                          {e.location.start.column}
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {current.questions?.map((question) => {
            const answer = progress.answers[question.id];
            return (
              <section className="learning-question" key={question.id}>
                <h3>Knowledge check</h3>
                <p>{question.prompt}</p>
                <div role="group" aria-label={question.prompt}>
                  {question.choices.map((choice) => (
                    <button
                      type="button"
                      key={choice.id}
                      className="learning-choice"
                      aria-pressed={answer === choice.id}
                      onClick={() =>
                        onProgress({
                          ...progress,
                          answers: {
                            ...progress.answers,
                            [question.id]: choice.id,
                          },
                        })
                      }
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
                {answer && (
                  <div role="status" className="learning-answer">
                    <strong>
                      {answer === question.answerId ? 'Correct' : 'Not quite'}
                    </strong>
                    <p>{question.explanation}</p>
                    {question.evidence.map((e, i) => (
                      <small key={i}>
                        {e.description}
                        {e.location && (
                          <>
                            {' '}
                            -{' '}
                            <button
                              type="button"
                              onClick={() => onInspect(e.location!.path)}
                            >
                              {e.location.path}:{e.location.start.line}
                            </button>
                          </>
                        )}
                      </small>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
          <div className="learning-crosslinks">
            {current.files.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => onExplore('Architecture', current.files[0])}
                >
                  Open Architecture
                </button>
                <button
                  type="button"
                  onClick={() => onExplore('Impact Analysis', current.files[0])}
                >
                  Explore impact
                </button>
              </>
            )}
            {current.screenIds?.[0] && (
              <button
                type="button"
                onClick={() =>
                  onExplore('UI Flow', current.files[0], current.screenIds![0])
                }
              >
                Open UI Flow
              </button>
            )}
          </div>
          <div className="learning-controls">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => setStep(plan.steps[index - 1]!.id)}
            >
              Previous
            </button>
            <button type="button" onClick={complete}>
              {progress.completed.includes(current.id)
                ? 'Completed'
                : 'Mark complete'}
            </button>
            <button
              type="button"
              disabled={index === plan.steps.length - 1}
              onClick={() => setStep(plan.steps[index + 1]!.id)}
            >
              Skip
            </button>
            <button
              type="button"
              disabled={index === plan.steps.length - 1}
              onClick={() => setStep(plan.steps[index + 1]!.id)}
            >
              Next
            </button>
          </div>
          <p className="learning-note">
            Progress is kept in this Explorer session and is lost when it
            closes. Source evidence is static, not a guarantee of runtime
            behavior.
          </p>
        </article>
      </div>
    </div>
  );
}
