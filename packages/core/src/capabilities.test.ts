import { describe, expect, it } from 'vitest';
import type { RepositorySnapshot } from '@codedna/shared';
import {
  analyzeSnapshot,
  analyzeUIFlows,
  SnapshotValidationError,
} from './index.js';
import { assessCapabilities } from './capabilities.js';
import { runUIFlowStage } from './ui-flow-stage.js';
const snapshot: RepositorySnapshot = {
  schemaVersion: '1.0',
  id: 'fixture',
  revision: 'abc',
  files: [{ id: 'a.ts', path: 'a.ts', content: "import './missing';" }],
};
const status = (value: ReturnType<typeof assessCapabilities>, kind: string) =>
  value.capabilities.find((item) => item.kind === kind)!;
describe('capability assessment', () => {
  it('distinguishes partial diagnostics, missing documentation and unconfigured services', () => {
    const result = assessCapabilities(
      snapshot,
      analyzeSnapshot(snapshot),
      analyzeUIFlows(snapshot),
      { complete: false, skippedFiles: 2 },
    );
    expect(result).toMatchObject({
      schemaVersion: '1.0',
      snapshotId: 'fixture',
      revision: 'abc',
      snapshotComplete: false,
    });
    expect(status(result, 'dependencies')).toMatchObject({
      status: 'partial',
      diagnosticCount: 1,
    });
    expect(status(result, 'snapshot').reason).toContain('2');
    expect(status(result, 'documentation').status).toBe('not_run');
    expect(status(result, 'ai_explanations').status).toBe('not_configured');
    expect(status(result, 'runtime_qa').status).toBe('not_run');
    expect(status(result, 'visualization_3d').status).toBe('not_run');
    expect(status(result, 'architecture_map').status).toBe('partial');
    expect(status(result, 'dependencies').evidence[0]?.location?.path).toBe(
      'a.ts',
    );
  });
  it('does not confuse empty results, failed stages, missing analysis or another revision', () => {
    const empty: RepositorySnapshot = {
      schemaVersion: '1.0',
      id: 'empty',
      files: [],
    };
    const checked = assessCapabilities(
      empty,
      analyzeSnapshot(empty),
      analyzeUIFlows(empty),
      { complete: true },
    );
    expect(status(checked, 'dependencies').status).toBe('unsupported');
    expect(status(checked, 'ui_flow').status).toBe('available');
    expect(status(checked, 'ui_flow').reason).toContain('does not prove');
    expect(
      status(assessCapabilities(snapshot, undefined, undefined), 'snapshot')
        .status,
    ).toBe('not_run');
    expect(
      status(assessCapabilities(snapshot, undefined, undefined), 'dependencies')
        .status,
    ).toBe('not_run');
    expect(
      status(assessCapabilities(snapshot, null, null), 'ui_flow').status,
    ).toBe('failed');
    expect(
      status(
        assessCapabilities(empty, analyzeSnapshot(snapshot), undefined),
        'dependencies',
      ).status,
    ).toBe('failed');
  });
  it('isolates a route-stage error without leaking its contents or discarding dependency results', () => {
    const dependency = analyzeSnapshot(snapshot);
    const flow = runUIFlowStage(snapshot, () => {
      throw new Error('secret example');
    });
    const assessment = assessCapabilities(snapshot, dependency, flow);
    expect(status(assessment, 'ui_flow').status).toBe('failed');
    expect(status(assessment, 'dependencies').status).toBe('partial');
    expect(JSON.stringify(flow)).not.toContain('secret example');
    expect(flow.graph.nodes).toEqual([]);
  });
  it('does not swallow snapshot validation errors', () => {
    expect(() =>
      runUIFlowStage(snapshot, () => {
        throw new SnapshotValidationError('invalid');
      }),
    ).toThrow(SnapshotValidationError);
  });
  it('is deterministic and caps the number of displayed diagnostic evidence items', () => {
    const analysis = analyzeSnapshot(snapshot);
    analysis.diagnostics = Array.from({ length: 25 }, (_, i) => ({
      id: `d${String(i).padStart(2, '0')}`,
      severity: 'warning' as const,
      message: 'issue',
    }));
    const a = assessCapabilities(snapshot, analysis, undefined);
    expect(a).toEqual(assessCapabilities(snapshot, analysis, undefined));
    expect(status(a, 'dependencies')).toMatchObject({ diagnosticCount: 25 });
    expect(status(a, 'dependencies').evidence).toHaveLength(10);
  });
});
