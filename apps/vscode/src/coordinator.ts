export class AnalysisCoordinator<
  TSnapshot extends { snapshot: { revision?: string } },
  TResult,
> {
  private generation = 0;
  private controller: AbortController | undefined;
  private activeKey: string | undefined;
  private cache = new Map<
    string,
    { revision: string | undefined; value: TResult; snapshot: TSnapshot }
  >();
  constructor(
    private readonly acquire: (
      key: string,
      signal: AbortSignal,
    ) => Promise<TSnapshot>,
    private readonly analyze: (
      snapshot: TSnapshot,
      signal: AbortSignal,
    ) => Promise<TResult>,
  ) {}
  invalidate(key?: string) {
    if (!key || this.activeKey === key) {
      this.generation++;
      this.controller?.abort();
    }
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }
  dispose() {
    this.invalidate();
  }
  async run(
    key: string,
    force = false,
  ): Promise<{ snapshot: TSnapshot; value: TResult }> {
    const existing = this.cache.get(key);
    if (existing && !force) return existing;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.activeKey = key;
    let timedOut = false;
    const generation = ++this.generation;
    const race = <T>(work: Promise<T>) =>
      new Promise<T>((resolve, reject) => {
        const abort = () =>
          reject(
            new Error(timedOut ? 'Analysis timed out' : 'Analysis cancelled'),
          );
        if (controller.signal.aborted) {
          abort();
          return;
        }
        controller.signal.addEventListener('abort', abort, { once: true });
        work.then(
          (value) => {
            controller.signal.removeEventListener('abort', abort);
            resolve(value);
          },
          (error) => {
            controller.signal.removeEventListener('abort', abort);
            reject(error);
          },
        );
      });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 60000);
    try {
      const snapshot = await race(this.acquire(key, controller.signal));
      if (controller.signal.aborted || generation !== this.generation)
        throw new Error('Analysis cancelled');
      const value = await race(this.analyze(snapshot, controller.signal));
      if (controller.signal.aborted || generation !== this.generation)
        throw new Error('Analysis cancelled');
      const entry = { snapshot, value, revision: snapshot.snapshot.revision };
      this.cache.set(key, entry);
      return entry;
    } finally {
      clearTimeout(timer);
    }
  }
}
