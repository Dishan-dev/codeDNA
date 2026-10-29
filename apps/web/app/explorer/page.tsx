import { analyzeSnapshot } from '@codedna/core';
import { Explorer } from '@/components/explorer';
import { exampleSnapshot } from '@/lib/example';

const exampleResult = analyzeSnapshot(exampleSnapshot);
export default function ExplorerPage() {
  return <Explorer snapshot={exampleSnapshot} result={exampleResult} />;
}
