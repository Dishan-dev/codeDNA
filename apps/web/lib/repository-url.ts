export function validateRepositoryUrl(value: string): string | null {
  const input = value.trim();
  if (!input) return 'Enter a repository URL to continue.';
  try {
    const url = new URL(input);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'github.com' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !/^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname)
    )
      return 'Use a GitHub repository URL like https://github.com/owner/repo.';
    return null;
  } catch {
    return 'Use a GitHub repository URL like https://github.com/owner/repo.';
  }
}
