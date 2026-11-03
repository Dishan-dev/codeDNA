import type { AnalysisResult, Evidence, RepositorySnapshot, RepositoryUnderstanding, UIFlowGraph, UnderstandingClaim } from '@codedna/shared';
import { validateSnapshot } from './validation.js';
import { summarizeRepository } from './repository-overview.js';

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const claim = (text: string, certainty: UnderstandingClaim['certainty'], evidence: Evidence[] = []): UnderstandingClaim => ({ text, certainty, evidence });
const at = (path: string, line: number): Evidence => ({ description: `${path}:${line}`, location: { path, start: { line, column: 1 }, end: { line, column: 1 } } });
const moduleFor = (path: string) => {
  const parts = path.split('/');
  return (parts[0] === 'apps' || parts[0] === 'packages') && parts.length > 2 ? parts.slice(0, 2).join('/') : parts.length > 1 ? parts[0]! : '';
};
/** Deterministic, bounded document and source summary. Documentation is a claim, not verification. */
export function understandRepository(snapshot: RepositorySnapshot, result: AnalysisResult | undefined, flow: UIFlowGraph, complete = true): RepositoryUnderstanding {
  const checked = validateSnapshot(snapshot, {});
  const overview = summarizeRepository(checked, result, flow, complete);
  const docs = checked.documents ?? [];
  const root = docs.find((d) => /^readme(?:\.[\w.-]+)?\.md$/i.test(d.path));
  const paragraphs = (root?.content ?? '').split(/\r?\n\s*\r?\n/).map((s) => s.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim()).filter((s) => s && !/^(?:!\[|\[!\[|```|<!--)/.test(s));
  const title = paragraphs.find((s) => !s.includes('\n') && s.length <= 140);
  const purpose = paragraphs.find((s) => s !== title && s.length >= 35 && s.length <= 600 && !/^(?:install|usage|getting started)$/i.test(s));
  const introduction = purpose && root ? claim(purpose, 'documented', [at(root.path, root.content.split('\n').findIndex((l) => purpose.startsWith(l.trim().replace(/^#+\s*/, ''))) + 1 || 1)]) : claim('Purpose is not established from the available documentation. Explore detected structure and source evidence below.', 'unverified');
  const capabilities: UnderstandingClaim[] = [];
  for (const doc of docs.slice(0, 30)) {
    const lines = doc.content.split(/\r?\n/).slice(0, 300);
    for (let i = 0; i < lines.length; i++) {
      const match = /^#{2,3}\s+(.{4,100})$/.exec(lines[i]!.trim());
      if (match && !/^(install|usage|setup|contribut|licen|develop|test|build|require|prerequisit)/i.test(match[1]!)) capabilities.push(claim(match[1]!, 'documented', [at(doc.path, i + 1)]));
      if (capabilities.length >= 20) break;
    }
    if (capabilities.length >= 20) break;
  }
  const technologies = overview.technologies.slice(0, 30).map((tech) => claim(`${tech.name} is referenced by source imports.`, 'verified', tech.evidence.slice(0, 3).map((e) => at(e.path, e.line))));
  for (const manifest of (checked.manifests ?? []).slice(0, 50)) {
    try {
      const data: unknown = JSON.parse(manifest.content);
      if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
      const obj = data as Record<string, unknown>;
      for (const key of ['dependencies', 'devDependencies'] as const) {
        const deps = obj[key];
        if (!deps || typeof deps !== 'object' || Array.isArray(deps)) continue;
        for (const name of Object.keys(deps).sort(compare).slice(0, 30)) {
          if (!technologies.some((item) => item.text.startsWith(`${name} `))) technologies.push(claim(`${name} is declared in ${key}.`, 'documented', [at(manifest.path, 1)]));
          if (technologies.length >= 40) break;
        }
      }
    } catch { /* Malformed manifests are untrusted optional text. */ }
  }
  const modules = overview.modules.map((item) => {
    const moduleReadme = docs.find((doc) => doc.path.toLowerCase() === `${item.path ? `${item.path}/` : ''}readme.md`.toLowerCase());
    const description = moduleReadme?.content.split(/\r?\n\s*\r?\n/).map((value) => value.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim()).find((value) => value.length >= 30 && value.length <= 500);
    return {
      id: item.id, path: item.path, fileCount: item.fileCount,
      description: description && moduleReadme ? claim(description, 'documented', [at(moduleReadme.path, 1)]) : claim(`${item.fileCount} analyzed source file${item.fileCount === 1 ? '' : 's'}${item.screens.length ? ` and ${item.screens.length} detected screen${item.screens.length === 1 ? '' : 's'}` : ''}. ${item.outgoing} outgoing and ${item.incoming} incoming cross-module imports.`, 'verified', item.fileIds.slice(0, 2).map((id) => at(id.slice(5), 1))),
    };
  });
  const source = new Set(checked.files.map((f) => f.path));
  const entryPoints = [...source].filter((path) => /(?:^|\/)(?:main|index|app|server|page|route)\.(?:tsx?|jsx?)$/.test(path)).sort(compare).slice(0, 60).map((path) => ({ path, evidence: [at(path, 1)] }));
  const routes = [...flow.nodes].sort((a, b) => compare(a.id, b.id)).slice(0, 100).map((node) => ({ id: node.id, path: node.routePath ?? node.label, ...(node.sourceFile ? { sourceFile: node.sourceFile } : {}), evidence: node.metadata.evidence }));
  const exploration = [...routes.filter((r) => r.sourceFile).slice(0, 4).map((r) => ({ label: `Explore ${r.path}`, path: r.sourceFile!, reason: 'Detected route source' })), ...entryPoints.slice(0, 4).map((e) => ({ label: `Open ${e.path}`, path: e.path, reason: 'Conventional entry-point filename' })), ...modules.filter((m) => m.path).slice(0, 4).flatMap((m) => { const path = [...source].find((s) => moduleFor(s) === m.path); return path ? [{ label: `Explore ${m.path}`, path, reason: 'Structural module' }] : []; })].slice(0, 10);
  const limitations = [
    ...(!root ? ['No root README was available; repository purpose is unknown.'] : ['README statements are untrusted documentation and may contradict source.']),
    ...(!complete ? ['The repository snapshot is partial; omitted files can change these findings.'] : []),
    ...(!result ? ['Dependency analysis is unavailable.'] : []),
    'Static imports and routes do not prove runtime execution or reachability.',
  ];
  return { schemaVersion: '1.0', snapshotId: checked.id, ...(checked.revision ? { revision: checked.revision } : {}), introduction, capabilities, technologies: technologies.slice(0, 40), modules, entryPoints, routes, exploration, limitations };
}
