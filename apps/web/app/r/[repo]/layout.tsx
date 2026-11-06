import type { ReactNode } from 'react';
import { RepoShell } from '@/components/repo-shell';

export default async function RepoLayout({ children, params }: { children: ReactNode; params: Promise<{ repo: string }> }) {
  const { repo } = await params;
  return <RepoShell repo={repo}>{children}</RepoShell>;
}
