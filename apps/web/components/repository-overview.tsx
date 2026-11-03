'use client';
import { useState } from 'react';
import { CapabilitySummary } from './capability-summary';
import type {
  CapabilityAssessment,
  RepositoryUnderstanding,
} from '@codedna/shared';
import type { RepositoryOverview as Overview } from '@codedna/core/repository-overview';

export function RepositoryOverview({
  overview,
  understanding,
  capabilities,
  name,
  onModule,
  onScreen,
  onLearning,
  onEvidence,
  routeDiagnostics,
}: {
  overview: Overview;
  understanding: RepositoryUnderstanding;
  capabilities: CapabilityAssessment;
  name: string;
  onModule: (path: string) => void;
  onScreen: (id: string) => void;
  onLearning: () => void;
  onEvidence: (path: string, line: number) => void;
  routeDiagnostics: number;
}) {
  const [moduleLimit, setModuleLimit] = useState(8);
  return (
    <section
      className="architecture-guide repository-overview guided-page"
      aria-label="Repository overview"
    >
      <header className="guided-heading">
        <span className="guide-eyebrow">02 / ARCHITECTURE</span>
        <h2>How is {name} organized?</h2>
        <p>
          Each block is a source folder. Open one to see its purpose, files and
          direct connections.
        </p>
        <small>
          {overview.fileCount} source files · {overview.modules.length} modules
          · {overview.screens.length} detected screens
        </small>
      </header>
      {!overview.complete && (
        <p className="guide-warning">
          Partial snapshot: omitted files and relationships may change this
          overview.
        </p>
      )}
      {!overview.analysisAvailable && (
        <p className="guide-warning">
          Dependency analysis is unavailable. Folders can still be explored.
        </p>
      )}
      <div className="module-map" aria-label="Repository modules">
        {overview.modules.slice(0, moduleLimit).map((module) => (
          <button
            className="module-card"
            type="button"
            key={module.id}
            onClick={() => onModule(module.path)}
          >
            <strong>{module.path || 'Root files'}</strong>
            <span>
              {understanding.modules.find((item) => item.id === module.id)
                ?.description.text ?? 'Source folder'}
            </span>
            <small>
              {module.fileCount} files · {module.incoming + module.outgoing}{' '}
              direct cross-module links
            </small>
            <span className="module-card-action">Open module →</span>
          </button>
        ))}
        {!overview.modules.length && (
          <p>No supported source modules were found in this snapshot.</p>
        )}
      </div>
      {overview.modules.length > moduleLimit && (
        <button
          type="button"
          className="guide-more"
          onClick={() => setModuleLimit((limit) => limit + 8)}
        >
          Show more modules ({overview.modules.length - moduleLimit} remaining)
        </button>
      )}
      <div className="guided-secondary-grid">
        <details className="guided-secondary">
          <summary>Cross-module connections</summary>
          <p>
            Links aggregate detected static imports. Open a module for
            file-level source evidence.
          </p>
          {overview.relationships.length ? (
            <ul>
              {overview.relationships.slice(0, 20).map((link) => (
                <li key={link.id}>
                  {overview.modules.find((item) => item.id === link.sourceId)
                    ?.path || 'Root'}{' '}
                  →{' '}
                  {overview.modules.find((item) => item.id === link.targetId)
                    ?.path || 'Root'}{' '}
                  · {link.edges.length} dependencies
                </li>
              ))}
            </ul>
          ) : (
            <p>No cross-module dependencies detected.</p>
          )}
        </details>
        <details className="guided-secondary">
          <summary>Routes, technology and analysis status</summary>
          <h3>Detected screens</h3>
          {overview.screens.slice(0, 8).map((screen) => (
            <button
              key={screen.id}
              type="button"
              className="guide-entry"
              onClick={() => onScreen(screen.id)}
            >
              {screen.routePath ?? screen.label} ·{' '}
              {screen.sourceFile ?? 'source unknown'} →
            </button>
          ))}
          {!overview.screens.length && <p>No supported screens detected.</p>}
          <h3>Detected frameworks</h3>
          {overview.frameworks.map((item) => (
            <div key={item.id}>
              <strong>{item.id}</strong>
              {item.evidence.slice(0, 2).map((e) => (
                <button
                  className="guide-more"
                  type="button"
                  key={`${e.path}:${e.line ?? 0}`}
                  onClick={() => onEvidence(e.path, e.line ?? 1)}
                >
                  {e.path}
                  {e.line ? `:${e.line}` : ''}
                </button>
              ))}
            </div>
          ))}
          <h3>Analysis status</h3>
          <CapabilitySummary
            assessment={capabilities}
            onEvidence={onEvidence}
          />
          <p>
            {overview.diagnostics} dependency diagnostics ·{' '}
            {overview.unresolved} unresolved dependencies · {routeDiagnostics}{' '}
            route diagnostics. Static analysis cannot prove runtime behavior.
          </p>
          <button type="button" className="guide-more" onClick={onLearning}>
            Open guided learning →
          </button>
        </details>
      </div>
    </section>
  );
}
