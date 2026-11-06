import type { FrameworkInfo, ImportEdge, PageRoute, RepositoryText } from '@codedna/shared';

/** Dependency names from package.json text. Parsed as data only; never required or executed. */
export function manifestDependencies(manifests: readonly RepositoryText[]): Set<string> {
  const names = new Set<string>();
  for (const manifest of manifests) {
    if (!/(?:^|\/)package\.json$/.test(manifest.path)) continue;
    try {
      const json = JSON.parse(manifest.content) as Record<string, unknown>;
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
        const value = json[field];
        if (value && typeof value === 'object' && !Array.isArray(value)) for (const name of Object.keys(value)) names.add(name);
      }
    } catch {
      // An unreadable manifest is not evidence either way.
    }
  }
  return names;
}

export function detectFramework(manifests: readonly RepositoryText[], imports: readonly ImportEdge[], routes: readonly PageRoute[]): FrameworkInfo {
  const dependencies = manifestDependencies(manifests);
  const packages = new Set(imports.flatMap((edge) => (edge.package ? [edge.package] : [])));
  const pages = routes.filter((route) => route.kind === 'page').length;
  const evidence: string[] = [];
  if (dependencies.has('next')) evidence.push('package.json depends on next');
  if (packages.has('next')) evidence.push('the code imports from next');
  if (pages) evidence.push(`${pages} page${pages === 1 ? '' : 's'} in an app folder`);
  if (pages) return { id: 'next-app-router', label: 'Next.js (App Router)', support: 'full', evidence };

  const reactEvidence: string[] = [];
  if (dependencies.has('react')) reactEvidence.push('package.json depends on react');
  if (packages.has('react')) reactEvidence.push('the code imports from react');
  if (evidence.length || reactEvidence.length)
    return { id: 'react', label: evidence.length ? 'Next.js (without an app folder)' : 'React', support: 'limited', evidence: [...evidence, ...reactEvidence] };
  return { id: 'unknown', label: 'JavaScript / TypeScript', support: 'limited', evidence: [] };
}
