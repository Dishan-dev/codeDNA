'use client';
import type { ActionIndex, AnalysisDiagnostic, CapabilityAssessment } from '@codedna/shared';
import type { UIFlowAnalysis } from '@codedna/core';
import { CapabilitySummary } from './capability-summary';

/** What the analyzer could and couldn't run, reusing the capability and diagnostic records. */
export function DiagnosticsView({
  capabilities,
  diagnostics,
  uiFlow,
  actions,
  acquisition,
  onEvidence,
}: {
  capabilities: CapabilityAssessment;
  diagnostics: AnalysisDiagnostic[];
  uiFlow: UIFlowAnalysis;
  actions: ActionIndex | undefined;
  acquisition: { code: string; path: string; message: string }[];
  onEvidence: (path: string, line: number) => void;
}) {
  return (
    <div className="flow-page" data-testid="diagnostics">
      <header className="flow-intro"><h1>Diagnostics</h1><p className="flow-lead">What the analyzer could and couldn’t run on this snapshot.</p></header>
      <section className="flow-card flow-pad"><CapabilitySummary assessment={capabilities} onEvidence={onEvidence} /></section>
      <section className="flow-card flow-pad" aria-labelledby="diag-actions">
        <h2 id="diag-actions">Page and action analysis</h2>
        {actions ? (
          <ul>
            <li>{actions.pages.length} page groups, {actions.actions.length} actions, {actions.traces.length} traces{actions.partial ? ' (partial)' : ''}.</li>
            {actions.limitations.map((text) => <li key={text}>{text}</li>)}
          </ul>
        ) : <p>Not run for this session. Import the repository again to analyze pages and actions.</p>}
      </section>
      {[{ title: 'Analysis diagnostics', items: diagnostics.map((d) => ({ key: d.id, text: `${d.severity}: ${d.location ? `${d.location.path}:${d.location.start.line} — ` : ''}${d.message}` })) },
        { title: 'Route and navigation diagnostics', items: uiFlow.diagnostics.map((d, i) => ({ key: `${d.id}:${i}`, text: `${d.location ? `${d.location.path}:${d.location.start.line} — ` : ''}${d.message}` })) },
        { title: 'Skipped while importing', items: acquisition.map((d, i) => ({ key: `${d.path}:${i}`, text: `${d.path}: ${d.message}` })) }]
        .filter((group) => group.items.length)
        .map((group) => (
          <details key={group.title} className="flow-card flow-pad">
            <summary>{group.items.length} {group.title.toLowerCase()}</summary>
            <ul>{group.items.slice(0, 500).map((item) => <li key={item.key}>{item.text}</li>)}</ul>
          </details>
        ))}
    </div>
  );
}
