'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { SESSION_KEY, type ExplorerSession } from '@/lib/explorer-session';
import type { AcquisitionResult } from '@codedna/github';
import type { AnalysisResult } from '@codedna/shared';
import type { UIFlowAnalysis } from '@codedna/core';
import { ArrowRight, GitBranch } from 'lucide-react';
import { Button, Input } from './ui';
import { validateRepositoryUrl } from '@/lib/repository-url';

export function RepositoryForm() {
  const [value, setValue] = useState('');
  const [message, setMessage] = useState('');
  const [valid, setValid] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateRepositoryUrl(value);
    if (error) {
      setValid(false);
      setMessage(error);
      return;
    }
    setLoading(true);
    setMessage('Acquiring and analyzing the public repository...');
    setValid(true);
    try {
      const response = await fetch('/api/repositories/acquire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: value.trim().replace(/\/$/, '') }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const reason = data as { error?: { message?: string } };
        throw new Error(
          reason.error?.message ?? 'Could not acquire this repository.',
        );
      }
      const payload = data as AcquisitionResult & {
        analysis: AnalysisResult;
        uiFlow: UIFlowAnalysis;
      };
      if (
        !payload.snapshot ||
        !payload.analysis ||
        !payload.uiFlow ||
        !payload.repository ||
        !payload.completeness
      )
        throw new Error('The acquisition response was incomplete.');
      const session: ExplorerSession = {
        snapshot: payload.snapshot,
        result: payload.analysis,
        uiFlow: payload.uiFlow,
        repositoryName: `${payload.repository.owner}/${payload.repository.repo}`,
        completeness: payload.completeness,
        acquisitionDiagnostics: payload.diagnostics,
        source: 'github',
      };
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } catch {
        throw new Error(
          'This repository is too large for browser session storage. Try a smaller repository.',
        );
      }
      router.push('/explorer?source=github');
    } catch (err) {
      setValid(false);
      setMessage(
        err instanceof Error
          ? err.message
          : 'Could not acquire this repository.',
      );
      setLoading(false);
    }
  }
  return (
    <form className="repo-form-wrap" onSubmit={submit} noValidate>
      <label htmlFor="repository-url" className="sr-only">
        GitHub repository URL
      </label>
      <div className="repo-form">
        <GitBranch size={19} aria-hidden="true" />
        <Input
          id="repository-url"
          type="url"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setMessage('');
            setValid(false);
          }}
          placeholder="github.com / owner / repository"
          aria-invalid={!!message && !valid}
          aria-describedby="repo-help"
        />
        <Button variant="primary" type="submit" disabled={loading}>
          {loading ? (
            <>
              Analyzing...{' '}
              <span className="loading-button-spinner" aria-hidden="true" />
            </>
          ) : (
            <>
              Explore <ArrowRight size={16} />
            </>
          )}
        </Button>
      </div>
      <p
        id="repo-help"
        className={
          message && !valid ? 'form-message form-error' : 'form-message'
        }
        aria-live="polite"
      >
        {message || 'Enter a public GitHub repository URL.'}
      </p>
    </form>
  );
}
