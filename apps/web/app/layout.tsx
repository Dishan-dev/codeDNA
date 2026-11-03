import '@codedna/graph-ui/styles.css';
import './globals.css';
import './tokens.css';
import './flow.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'CodeDNA', description: 'Understand unfamiliar codebases.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
