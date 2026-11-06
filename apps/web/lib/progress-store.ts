'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyEvent, dayString, emptyProgress, reconcile } from '@codedna/learn-ui';
import type { LearnerEvent, LearningPlan, Progress } from '@codedna/shared';

/**
 * Progress lives only in this browser (IndexedDB), keyed by repository. No account, no server.
 * If IndexedDB is unavailable (private mode, blocked storage) it falls back to localStorage,
 * and then to memory, so the app always works.
 */
const DB_NAME = 'codedna';
const STORE = 'progress';
const LOCAL_PREFIX = 'codedna.progress.';

let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('No IndexedDB'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'repoKey' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB failed'));
  });
  return database;
}

async function readStored(repoKey: string): Promise<Progress | undefined> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(repoKey);
      request.onsuccess = () => resolve(request.result as Progress | undefined);
      request.onerror = () => reject(request.error ?? new Error('read failed'));
    });
  } catch {
    try {
      const raw = localStorage.getItem(LOCAL_PREFIX + repoKey);
      return raw ? (JSON.parse(raw) as Progress) : undefined;
    } catch {
      return undefined;
    }
  }
}

async function writeStored(progress: Progress): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(progress);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('write failed'));
    });
  } catch {
    try {
      localStorage.setItem(LOCAL_PREFIX + progress.repoKey, JSON.stringify(progress));
    } catch {
      // Memory only: progress lasts until the tab closes.
    }
  }
}

/** Progress for one repository: loaded once, reconciled with the current lessons, saved on change. */
export function useProgress(repoKey: string, plan: LearningPlan | undefined) {
  const [progress, setProgress] = useState<Progress>(() => emptyProgress(repoKey));
  const [loaded, setLoaded] = useState(false);
  const planRef = useRef(plan);
  planRef.current = plan;

  useEffect(() => {
    let active = true;
    setLoaded(false);
    void readStored(repoKey).then((stored) => {
      if (!active) return;
      const base = stored && stored.repoKey === repoKey ? { ...emptyProgress(repoKey), ...stored } : emptyProgress(repoKey);
      setProgress(planRef.current ? reconcile(base, planRef.current) : base);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [repoKey]);

  // Save every change straight away: a delayed save can be lost if the learner reloads or leaves.
  useEffect(() => {
    if (loaded) void writeStored(progress);
  }, [progress, loaded]);

  const dispatch = useCallback((event: LearnerEvent) => setProgress((current) => applyEvent(current, event, dayString(new Date()))), []);
  return { progress, loaded, dispatch };
}
