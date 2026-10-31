/** Discover candidate App Router roots without assuming a workspace directory name. */
export function discoverNextAppRoots(paths: Iterable<string>): string[] {
  const roots = new Set<string>();
  for (const path of paths) {
    if (!/(?:^|\/)page\.(?:ts|tsx|js|jsx)$/.test(path)) continue;
    const parts = path.split('/');
    const index = parts.indexOf('app');
    if (index >= 0 && index < parts.length - 1)
      roots.add(parts.slice(0, index + 1).join('/'));
  }
  return [...roots].sort();
}
