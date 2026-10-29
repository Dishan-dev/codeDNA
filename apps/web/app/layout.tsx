// @ts-expect-error CSS is resolved by the Next.js bundler.
import './globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'CodeDNA', description: 'Understand unfamiliar codebases.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
