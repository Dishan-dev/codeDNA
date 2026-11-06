import { StarterList } from '@/components/start-page';
import { Brand } from '@/components/ui';

export const metadata = { title: 'Starter repos' };

export default function ExplorePage() {
  return (
    <>
      <header className="mx-auto flex max-w-6xl items-center px-4 py-3 sm:px-6">
        <Brand />
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight text-ink">Starter repos</h1>
        <p className="mb-8 mt-2 max-w-2xl text-muted">Real apps with lessons ready to go. Pick one to see how CodeDNA turns code into stories and challenges.</p>
        <StarterList />
      </main>
    </>
  );
}
