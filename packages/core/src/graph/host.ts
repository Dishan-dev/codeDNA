import ts from 'typescript';
import type { AnalysisDiagnostic, RepositoryText } from '@codedna/shared';
import type { ReadyFile } from '../snapshot/validate.js';
import { diagnostic } from '../snapshot/validate.js';

/** Virtual root for the in-memory host; never a real directory. */
export const ROOT = '/repo';
const CONFIG = /(?:^|\/)(?:tsconfig|jsconfig)\.json$/;
export const BASE_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.Latest,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: true,
  jsx: ts.JsxEmit.Preserve,
  resolveJsonModule: true,
  noLib: true,
  types: [],
};

export const dirname = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const join = (...parts: string[]) => parts.filter(Boolean).join('/');
/** Repository path for a virtual host path; other paths are returned unchanged. */
export const toRepoPath = (path: string) => (path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path);
export const toHostPath = (path: string) => `${ROOT}/${path}`;

/** Resolution host over snapshot text only. Nothing touches the real filesystem. */
export function createHost(texts: ReadonlyMap<string, string>): ts.ModuleResolutionHost {
  const directories = new Set<string>([ROOT]);
  for (const path of texts.keys()) for (let dir = dirname(path); dir; dir = dirname(dir)) directories.add(toHostPath(dir));
  const local = (path: string) => (path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : '\0');
  return {
    fileExists: (path) => texts.has(local(path)),
    readFile: (path) => texts.get(local(path)),
    directoryExists: (path) => directories.has(path.replace(/\/$/, '')),
    getCurrentDirectory: () => ROOT,
    realpath: (path) => path,
  };
}

/**
 * Only `baseUrl` and `paths` are read from a config. `extends`, plugins and everything else are
 * ignored on purpose: repository configuration is untrusted and is never loaded or executed.
 */
function readConfig(path: string, text: string, diagnostics: AnalysisDiagnostic[]): ts.CompilerOptions {
  const parsed = ts.parseConfigFileTextToJson(path, text);
  const raw = parsed.config as { compilerOptions?: Record<string, unknown>; extends?: unknown } | undefined;
  if (parsed.error || !raw || typeof raw !== 'object') {
    diagnostics.push(diagnostic('config-unreadable', 'info', `${path} could not be read, so import aliases from it are not used.`, path));
    return BASE_OPTIONS;
  }
  if (raw.extends !== undefined) diagnostics.push(diagnostic('config-extends', 'info', `${path} extends another config; CodeDNA only reads the aliases written in this file.`, path));
  const compilerOptions = raw.compilerOptions && typeof raw.compilerOptions === 'object' ? raw.compilerOptions : {};
  const dir = dirname(path);
  const baseUrl = typeof compilerOptions.baseUrl === 'string' ? compilerOptions.baseUrl : undefined;
  const paths: ts.MapLike<string[]> = {};
  if (compilerOptions.paths && typeof compilerOptions.paths === 'object')
    for (const [pattern, targets] of Object.entries(compilerOptions.paths as Record<string, unknown>))
      if (Array.isArray(targets) && targets.every((target) => typeof target === 'string')) paths[pattern] = targets as string[];
  const hasPaths = Object.keys(paths).length > 0;
  if (baseUrl === undefined && !hasPaths) return BASE_OPTIONS;
  // Without baseUrl, `paths` are relative to the config's folder, which baseUrl expresses equally.
  const base = baseUrl === undefined ? join(ROOT, dir) : `${ROOT}/${join(dir, baseUrl)}`.replace(/\/\.(?=\/|$)/g, '').replace(/\/$/, '');
  return { ...BASE_OPTIONS, baseUrl: base, ...(hasPaths ? { paths } : {}) };
}

export interface Resolution {
  host: ts.ModuleResolutionHost;
  /** Snapshot text by repository path, including manifests. */
  texts: ReadonlyMap<string, string>;
  /** Settings from the nearest tsconfig/jsconfig above a file. */
  optionsFor: (path: string) => ts.CompilerOptions;
  /** Resolve a specifier from a repository file. */
  resolve: (specifier: string, from: string) => ts.ResolvedModuleWithFailedLookupLocations;
  diagnostics: AnalysisDiagnostic[];
}

export function createResolution(files: readonly ReadyFile[], manifests: readonly RepositoryText[]): Resolution {
  const diagnostics: AnalysisDiagnostic[] = [];
  const texts = new Map<string, string>();
  for (const manifest of manifests) texts.set(manifest.path, manifest.content);
  for (const file of files) texts.set(file.path, file.content);
  const host = createHost(texts);
  const configs = new Map<string, ts.CompilerOptions>();
  for (const file of files) {
    if (!CONFIG.test(file.path)) continue;
    const dir = dirname(file.path);
    // tsconfig wins over jsconfig in the same folder.
    if (file.path.endsWith('jsconfig.json') && texts.has(join(dir, 'tsconfig.json'))) continue;
    configs.set(dir, readConfig(file.path, file.content, diagnostics));
  }
  const optionsFor = (path: string): ts.CompilerOptions => {
    for (let dir = dirname(path); ; dir = dirname(dir)) {
      const found = configs.get(dir);
      if (found) return found;
      if (!dir) return BASE_OPTIONS;
    }
  };
  const caches = new Map<ts.CompilerOptions, ts.ModuleResolutionCache>();
  const resolve = (specifier: string, from: string) => {
    const options = optionsFor(from);
    let cache = caches.get(options);
    if (!cache) caches.set(options, (cache = ts.createModuleResolutionCache(ROOT, (name) => name, options)));
    return ts.resolveModuleName(specifier, toHostPath(from), options, host, cache);
  };
  return { host, texts, optionsFor, resolve, diagnostics };
}

export function matchesAlias(specifier: string, options: ts.CompilerOptions): boolean {
  return Object.keys(options.paths ?? {}).some((pattern) => {
    const star = pattern.indexOf('*');
    return star < 0 ? pattern === specifier : specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1));
  });
}
