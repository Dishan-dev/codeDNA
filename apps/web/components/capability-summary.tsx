'use client';
import type { CapabilityAssessment, CapabilityKind } from '@codedna/shared';
const labels: Record<CapabilityKind, string> = {
  snapshot: 'Repository snapshot',
  dependencies: 'File dependencies',
  ui_flow: 'Routes and navigation',
  architecture_map: '2D architecture map',
  visualization_3d: '3D device support',
  documentation: 'Documentation understanding',
  symbols: 'Function and symbol analysis',
  static_simulation: 'Static walkthrough simulation',
  runtime_qa: 'Runtime QA',
  ai_explanations: 'AI explanations',
};
const statusNames = {
  available: 'Available',
  partial: 'Partial',
  unsupported: 'Unsupported',
  not_configured: 'Not configured',
  failed: 'Failed',
  not_run: 'Not run',
} as const;
export function CapabilitySummary({
  assessment,
  onEvidence,
}: {
  assessment: CapabilityAssessment;
  onEvidence: (path: string, line: number) => void;
}) {
  const attention = assessment.capabilities.filter(
    (item) => item.status === 'partial' || item.status === 'failed',
  ).length;
  const available = assessment.capabilities.filter(
    (item) => item.status === 'available',
  ).length;
  return (
    <details className="capability-summary">
      <summary>
        Analysis status{' '}
        <span>
          {attention
            ? `${attention} ${attention === 1 ? 'area needs' : 'areas need'} attention`
            : `${available} capabilities available; others may not have run`}
        </span>
      </summary>
      <p>
        Availability describes what was assessed; it is not proof of runtime
        behavior.
      </p>
      <ul>
        {assessment.capabilities.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{labels[item.kind]}</strong>
              <span
                className={`capability-status capability-status--${item.status}`}
              >
                {statusNames[item.status]}
              </span>
            </div>
            <p>{item.reason}</p>
            <small>Next: {item.nextAction}</small>
            {item.missingPrerequisites.length > 0 && (
              <small>Needed: {item.missingPrerequisites.join(', ')}</small>
            )}
            {item.evidence.length > 0 && (
              <details>
                <summary>Evidence ({item.evidence.length})</summary>
                <ul>
                  {item.evidence.map((e, index) => (
                    <li key={`${e.diagnosticId ?? e.type}:${index}`}>
                      {e.description}
                      {e.location && (
                        <button
                          type="button"
                          onClick={() =>
                            onEvidence(e.location!.path, e.location!.start.line)
                          }
                        >
                          {e.location.path}:{e.location.start.line}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {item.diagnosticCount > 10 && (
                  <small>
                    Showing up to 10 of {item.diagnosticCount} diagnostics; the
                    full list is available in the workspace.
                  </small>
                )}
              </details>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
