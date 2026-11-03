import { useEffect, useState } from 'react';
import type { AiStatus, Answer, EvidenceBundle } from '@codedna/shared';

const UNAVAILABLE: AiStatus = { configured: false, enabled: true, external: false, reason: 'Checking AI availability…' };

/** Availability only; the server never returns credentials. */
export function useAiStatus(): AiStatus {
  const [status, setStatus] = useState<AiStatus>(UNAVAILABLE);
  useEffect(() => {
    let live = true;
    fetch('/api/ai/status', { cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<AiStatus>) : Promise.reject(new Error('status'))))
      .then((value) => { if (live) setStatus(value); })
      .catch(() => { if (live) setStatus({ configured: false, enabled: true, external: false, reason: 'AI availability could not be determined.' }); });
    return () => { live = false; };
  }, []);
  return status;
}
export type AiResult = { ok: true; answer: Answer } | { ok: false; code: string; message: string };

/** Sends only the already-bounded bundle, and only with explicit consent. Never throws. */
export async function requestAiAnswer(question: string, bundle: EvidenceBundle, behaviors: { id: string; title: string }[], consent: boolean, signal?: AbortSignal): Promise<AiResult> {
  if (!consent) return { ok: false, code: 'consent_required', message: 'Permission to send excerpts has not been given.' };
  try {
    const response = await fetch('/api/ai/explain', {
      method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ question, consent: true, bundle: { items: bundle.items }, behaviors }), ...(signal ? { signal } : {}),
    });
    const data = (await response.json().catch(() => null)) as { answer?: Answer; error?: { code?: string; message?: string } } | null;
    if (response.ok && data?.answer) return { ok: true, answer: data.answer };
    return { ok: false, code: data?.error?.code ?? 'provider_error', message: data?.error?.message ?? 'The AI service is unavailable.' };
  } catch {
    return { ok: false, code: signal?.aborted ? 'cancelled' : 'provider_error', message: 'The AI service could not be reached.' };
  }
}
