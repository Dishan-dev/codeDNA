import { StartPage } from '@/components/start-page';
import { developerModeOn } from '@/lib/developer-mode';

export default function Home() {
  return (
    <>
      {developerModeOn() ? (
        <p className="border-b border-accent/20 bg-accent-soft px-4 py-2 text-center text-[13px] text-ink">
          <span className="font-semibold text-accent">Developer mode</span> · CodeDNA is being built — have a look around; the full app opens soon.
        </p>
      ) : null}
      <StartPage />
    </>
  );
}
