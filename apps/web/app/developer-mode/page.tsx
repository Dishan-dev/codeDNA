import { notFound } from 'next/navigation';
import { DeveloperMode } from '@/components/developer-mode';
import { developerModeOn } from '@/lib/developer-mode';

export const metadata = { title: 'Being built', robots: { index: false } };

/** The "being built" screen. Only exists while developer mode is on. */
export default function DeveloperModePage() {
  if (!developerModeOn()) notFound();
  return <DeveloperMode />;
}
