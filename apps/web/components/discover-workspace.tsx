'use client';

import type {
  FeatureDiscovery,
  RepositoryUnderstanding,
} from '@codedna/shared';

export function DiscoverWorkspace({
  understanding,
  features,
  onModule,
  onFeature,
  onFile,
}: {
  understanding: RepositoryUnderstanding;
  features: FeatureDiscovery;
  onModule: (path: string) => void;
  onFeature: (id: string) => void;
  onFile: (path: string, line: number) => void;
}) {
  const topModules = understanding.modules.slice(0, 4);
  const topFeatures = features.features.slice(0, 3);
  const documented = understanding.capabilities.slice(0, 3);
  return (
    <div className="discover-workspace guided-page">
      <header className="guided-hero">
        <span className="guide-eyebrow">01 / DISCOVER</span>
        <h2>What does this repository do?</h2>
        <p>{understanding.introduction.text}</p>
        <small>
          {understanding.introduction.certainty === 'documented'
            ? 'Described by repository documentation; verify in source.'
            : 'Summarized from available source evidence.'}
        </small>
        <button
          type="button"
          className="guide-action"
          onClick={() => onModule('')}
        >
          Explore the architecture →
        </button>
      </header>
      <div className="guided-grid">
        <section
          className="guided-section"
          aria-labelledby="discover-capabilities"
        >
          <span className="guide-eyebrow">WHAT IT DOES</span>
          <h3 id="discover-capabilities">Key capabilities</h3>
          {documented.length ? (
            <ul>
              {documented.map((claim, index) => (
                <li key={`${claim.text}:${index}`}>
                  {claim.text}
                  <small>Documented</small>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No capability claims were found in the available documentation.
              Detected source entries are listed below.
            </p>
          )}
          {topFeatures.map((feature) => (
            <button
              key={feature.id}
              type="button"
              className="guide-entry"
              onClick={() => onFeature(feature.id)}
            >
              <span>
                <strong>{feature.name}</strong>
                <small>Detected {feature.kind}</small>
              </span>
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </section>
        <section className="guided-section" aria-labelledby="discover-modules">
          <span className="guide-eyebrow">HOW IT IS ORGANIZED</span>
          <h3 id="discover-modules">Start with these modules</h3>
          {topModules.length ? (
            topModules.map((module) => (
              <button
                className="guide-entry"
                key={module.id}
                type="button"
                onClick={() => onModule(module.path)}
              >
                <span>
                  <strong>{module.path || 'Root files'}</strong>
                  <small>{module.description.text}</small>
                </span>
                <span aria-hidden="true">→</span>
              </button>
            ))
          ) : (
            <p>No supported source modules were found in this snapshot.</p>
          )}
        </section>
      </div>
      <details className="guided-secondary">
        <summary>Documentation, entry points and analysis limits</summary>
        <div className="guided-secondary-grid">
          <section>
            <h3>Read the source</h3>
            {understanding.exploration.slice(0, 5).map((step) => (
              <button
                className="guide-entry"
                key={`${step.label}:${step.path}`}
                type="button"
                onClick={() => onFile(step.path, 1)}
              >
                <span>
                  <strong>{step.label}</strong>
                  <small>{step.reason}</small>
                </span>
              </button>
            ))}
            {understanding.introduction.evidence.map(
              (item, index) =>
                item.location && (
                  <button
                    key={index}
                    type="button"
                    className="guide-more"
                    onClick={() =>
                      onFile(item.location!.path, item.location!.start.line)
                    }
                  >
                    Documentation: {item.location.path}:
                    {item.location.start.line}
                  </button>
                ),
            )}
          </section>
          <section>
            <h3>Coverage</h3>
            <ul>
              {understanding.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <h3>Declared and detected technology</h3>
            <ul>
              {understanding.technologies.slice(0, 8).map((item, index) => (
                <li key={`${item.text}:${index}`}>
                  {item.text} <small>{item.certainty}</small>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </details>
    </div>
  );
}
