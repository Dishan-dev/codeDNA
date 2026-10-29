'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Explorer } from './explorer';
import {
  SESSION_KEY,
  learningSessionKey,
  type ExplorerSession,
} from '@/lib/explorer-session';
export function ExplorerSessionLoader({
  source,
  sample,
}: {
  source: 'sample' | 'github';
  sample: ExplorerSession;
}) {
  const [session, setSession] = useState<ExplorerSession | null>(
    source === 'sample' ? sample : null,
  );
  const [error, setError] = useState('');
  useEffect(() => {
    if (source === 'sample') {
      setSession(sample);
      setError('');
      return;
    }
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) {
        setError('No imported repository is available in this browser tab.');
        return;
      }
      const stored: unknown = JSON.parse(raw);
      if (
        !stored ||
        typeof stored !== 'object' ||
        !('snapshot' in stored) ||
        !('uiFlow' in stored) ||
        !('result' in stored)
      )
        throw new Error('Invalid session');
      setSession(stored as ExplorerSession);
      setError('');
    } catch {
      setError('The imported repository session could not be loaded.');
    }
  }, [source, sample]);
  if (error)
    return (
      <main className="workspace-state" role="alert">
        <h1>Repository unavailable</h1>
        <p>{error}</p>
        <Link href="/">Return home</Link>
      </main>
    );
  if (!session)
    return (
      <main className="workspace-state" role="status">
        Loading repository session...
      </main>
    );
  return (
    <Explorer
      key={learningSessionKey(
        session.source,
        session.repositoryName,
        session.snapshot.id,
        session.snapshot.revision,
      )}
      snapshot={session.snapshot}
      result={session.result}
      uiFlow={session.uiFlow}
      repositoryName={session.repositoryName}
      source={session.source}
      completeness={session.completeness}
      acquisitionDiagnostics={session.acquisitionDiagnostics}
    />
  );
}
