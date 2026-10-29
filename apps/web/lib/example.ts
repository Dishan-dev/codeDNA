import type { RepositorySnapshot } from '@codedna/shared';

/** Bundled source only. The shell does not claim it has analyzed this snapshot. */
export const exampleSnapshot: RepositorySnapshot = {
  schemaVersion: '1.0',
  id: 'codedna-example-v1',
  files: [
    {
      id: 'src/app.ts',
      path: 'src/app.ts',
      content:
        "import { greet } from './lib/greet';\nconsole.log(greet('world'));\n",
    },
    {
      id: 'src/lib/greet.ts',
      path: 'src/lib/greet.ts',
      content: 'export const greet = (name: string) => `Hello, ${name}`;\n',
    },
    {
      id: 'src/types.ts',
      path: 'src/types.ts',
      content: 'export type User = { name: string };\n',
    },
  ],
};
