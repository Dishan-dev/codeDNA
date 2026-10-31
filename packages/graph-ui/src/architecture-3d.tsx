'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { QuadraticBezierCurve3, Quaternion, Vector3 } from 'three';
import {
  Html,
  Line,
  OrbitControls,
  PerspectiveCamera,
} from '@react-three/drei';
import { describeDependency, type DependencyGraph } from '@codedna/shared';
import {
  buildSceneGraph,
  canRender3D,
  folderOf,
  MAX_3D_EDGES,
  MAX_3D_NODES,
  visibleSelectionId,
  type SceneEdge,
} from './architecture-3d-data.js';
function Architecture3DScene({
  graph,
  selectedId,
  onSelectionChange,
}: {
  graph: DependencyGraph;
  selectedId: string | null;
  onSelectionChange: (id: string | null) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [edge, setEdge] = useState<SceneEdge | null>(null);
  const [cameraKey, setCameraKey] = useState(0);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    const node = graph.nodes.find((item) => item.id === selectedId);
    if (node) setExpanded((current) => new Set([...current, folderOf(node)]));
  }, [graph, selectedId]);
  const scene = useMemo(
    () => buildSceneGraph(graph, expanded),
    [graph, expanded],
  );
  const byId = useMemo(
    () => new Map(scene.nodes.map((node) => [node.id, node])),
    [scene.nodes],
  );
  const visibleSelectedId = useMemo(
    () => visibleSelectionId(scene, graph, selectedId),
    [scene, graph, selectedId],
  );
  const connected = useMemo(() => {
    const ids = new Set<string>();
    if (visibleSelectedId)
      for (const item of scene.edges)
        if (
          item.sourceId === visibleSelectedId ||
          item.targetId === visibleSelectedId
        ) {
          ids.add(item.sourceId);
          ids.add(item.targetId);
        }
    return ids;
  }, [scene.edges, visibleSelectedId]);
  const center = useMemo(() => {
    if (!scene.nodes.length) return [0, 0, 0] as [number, number, number];
    return [
      (Math.min(...scene.nodes.map((n) => n.position[0])) +
        Math.max(...scene.nodes.map((n) => n.position[0]))) /
        2,
      0,
      (Math.min(...scene.nodes.map((n) => n.position[2])) +
        Math.max(...scene.nodes.map((n) => n.position[2]))) /
        2,
    ] as [number, number, number];
  }, [scene.nodes]);
  const focus = focusId ? byId.get(focusId) : undefined;
  const target = focus?.position ?? center;
  const extent = Math.max(
    0,
    ...scene.nodes.map((node) =>
      Math.max(
        Math.abs(node.position[0] - center[0]),
        Math.abs(node.position[2] - center[2]),
      ),
    ),
  );
  const size = focus ? 9 : Math.max(16, extent * 1.8 + 10);
  const detailed = scene.nodes.length <= 120;
  if (!graph.nodes.length)
    return (
      <div className="dna-3d-fallback">
        No dependencies or source files to display.
      </div>
    );
  const toggle = (folder: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  return (
    <div className="dna-3d-root">
      <div className="dna-3d-toolbar">
        <span>
          ARCHITECTURE / 3D <small>Importer → dependency</small>
        </span>
        <button
          type="button"
          onClick={() => {
            setFocusId(null);
            setCameraKey((v) => v + 1);
          }}
        >
          Fit / reset camera
        </button>
        <button
          type="button"
          disabled={!selectedId || !byId.has(selectedId)}
          onClick={() => {
            setFocusId(selectedId);
            setCameraKey((v) => v + 1);
          }}
        >
          Focus selected
        </button>
        <button type="button" onClick={() => setExpanded(new Set())}>
          Collapse folders
        </button>
      </div>
      <Canvas
        key={cameraKey}
        frameloop="demand"
        dpr={[1, 1.5]}
        fallback={
          <div className="dna-3d-fallback">
            WebGL is unavailable. Switch to 2D to explore this repository.
          </div>
        }
      >
        <PerspectiveCamera
          makeDefault
          position={[target[0] + size, target[1] + size, target[2] + size]}
          fov={50}
        />
        <ambientLight intensity={1.3} />
        <directionalLight position={[10, 20, 10]} intensity={2} />
        <pointLight
          position={[center[0], 15, center[2]]}
          color="#5668ff"
          intensity={120}
          distance={80}
        />
        <gridHelper
          args={[Math.max(80, extent * 4 + 30), 40, '#263f67', '#18263d']}
          position={[center[0], -1.35, center[2]]}
        />
        <Suspense fallback={null}>
          {scene.edges.map((item) => {
            const a = byId.get(item.sourceId),
              b = byId.get(item.targetId);
            if (!a || !b || a.id === b.id) return null;
            const selected =
              !visibleSelectedId ||
              item.sourceId === visibleSelectedId ||
              item.targetId === visibleSelectedId;
            const start = a.position,
              end = b.position;
            const from = new Vector3(start[0], start[1] + 0.9, start[2]);
            const to = new Vector3(end[0], end[1] + 0.9, end[2]);
            const curve = new QuadraticBezierCurve3(
              from,
              new Vector3(
                (start[0] + end[0]) / 2,
                Math.max(from.y, to.y) +
                  Math.min(5, 1.5 + from.distanceTo(to) * 0.12),
                (start[2] + end[2]) / 2,
              ),
              to,
            );
            const midpoint = curve.getPoint(0.76);
            const direction = curve.getTangent(0.76).normalize();
            const arrowRotation = new Quaternion().setFromUnitVectors(
              new Vector3(0, 1, 0),
              direction,
            );
            return (
              <group key={item.id}>
                <Line
                  points={curve.getPoints(detailed ? 20 : 8)}
                  color={selected ? '#79d9ff' : '#6683ad'}
                  transparent
                  opacity={selected ? 0.95 : 0.45}
                  lineWidth={selected ? 2.5 : 1.5}
                  onClick={(event: { stopPropagation: () => void }) => {
                    event.stopPropagation();
                    setEdge(item);
                  }}
                />
                <mesh
                  position={midpoint}
                  quaternion={arrowRotation}
                  onClick={(event) => {
                    event.stopPropagation();
                    setEdge(item);
                  }}
                >
                  <coneGeometry args={[0.28, 0.7, 8]} />
                  <meshBasicMaterial color={selected ? '#a1ecff' : '#7999c5'} />
                </mesh>
              </group>
            );
          })}
          {scene.nodes.map((node) => {
            const active = visibleSelectedId === node.id,
              dim =
                !!visibleSelectedId &&
                !active &&
                !connected.has(node.id) &&
                node.kind !== 'folder';
            const folder = node.kind === 'folder';
            const accent = active
              ? '#a9f3ff'
              : hovered === node.id
                ? '#7fe4d5'
                : folder
                  ? '#8b85ff'
                  : node.kind === 'external'
                    ? '#56d6c8'
                    : '#68b7ff';
            return (
              <group
                key={node.id}
                position={node.position}
                onPointerOver={(event) => {
                  event.stopPropagation();
                  setHovered(node.id);
                }}
                onPointerOut={() => setHovered(null)}
                onClick={(event) => {
                  event.stopPropagation();
                  if (node.kind === 'folder') toggle(node.folder);
                  else onSelectionChange(node.id);
                }}
              >
                {detailed && (
                  <>
                    <mesh position={[0, -0.63, 0]}>
                      <cylinderGeometry
                        args={[
                          folder ? 2.05 : 0.95,
                          folder ? 2.15 : 1.03,
                          0.12,
                          6,
                        ]}
                      />
                      <meshBasicMaterial
                        color={accent}
                        transparent
                        opacity={dim ? 0.08 : 0.22}
                      />
                    </mesh>
                    <mesh position={[0, -0.54, 0]}>
                      <cylinderGeometry
                        args={[
                          folder ? 1.85 : 0.82,
                          folder ? 1.85 : 0.82,
                          0.025,
                          6,
                        ]}
                      />
                      <meshBasicMaterial
                        color={accent}
                        transparent
                        opacity={dim ? 0.06 : 0.13}
                      />
                    </mesh>
                  </>
                )}
                <mesh>
                  <boxGeometry
                    args={
                      node.kind === 'folder'
                        ? [2.65, 1.05, 1.75]
                        : [1.1, 0.68, 1.0]
                    }
                  />
                  <meshStandardMaterial
                    color={folder ? '#29285e' : '#173453'}
                    emissive={accent}
                    emissiveIntensity={
                      active || hovered === node.id ? 0.65 : 0.18
                    }
                    metalness={0.5}
                    roughness={0.35}
                    transparent
                    opacity={dim ? 0.22 : 1}
                  />
                </mesh>
                <mesh position={[0, folder ? 0.54 : 0.35, 0]}>
                  <boxGeometry
                    args={folder ? [2.55, 0.06, 1.65] : [1.04, 0.04, 0.94]}
                  />
                  <meshBasicMaterial
                    color={accent}
                    transparent
                    opacity={dim ? 0.18 : 0.8}
                  />
                </mesh>
                {(node.kind === 'folder' ||
                  active ||
                  hovered === node.id ||
                  scene.nodes.length < 50) && (
                  <Html
                    position={[0, folder ? 1.25 : 0.95, 0]}
                    center
                    distanceFactor={20}
                    style={{ pointerEvents: 'none' }}
                  >
                    <span
                      className={`dna-3d-label ${folder ? 'dna-3d-label--folder' : ''} ${active ? 'dna-3d-label--active' : ''}`}
                    >
                      <span className="dna-3d-label-type">
                        {folder
                          ? 'FOLDER'
                          : node.kind === 'external'
                            ? 'PACKAGE'
                            : 'FILE'}
                      </span>
                      <strong>
                        {folder ? node.label : node.label.split('/').at(-1)}
                      </strong>
                      {folder && (
                        <small>{node.count} files · click to expand</small>
                      )}
                    </span>
                  </Html>
                )}
              </group>
            );
          })}
        </Suspense>
        <OrbitControls makeDefault target={target} enableDamping={false} />
      </Canvas>
      <details className="dna-3d-access">
        <summary>Folders and files (keyboard accessible)</summary>
        {scene.folders.map((folder) => (
          <div key={folder}>
            <button
              type="button"
              aria-expanded={expanded.has(folder)}
              onClick={() => toggle(folder)}
            >
              {expanded.has(folder) ? '−' : '+'} {folder}
            </button>
            {!expanded.has(folder) &&
              scene.edges
                .filter(
                  (item) =>
                    item.sourceId === `cluster:${encodeURIComponent(folder)}` &&
                    item.targetId === item.sourceId,
                )
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setEdge(item)}
                  >
                    Inspect {item.evidence.length} internal dependencies
                  </button>
                ))}
            {expanded.has(folder) &&
              scene.nodes
                .filter(
                  (node) => node.folder === folder && node.kind !== 'folder',
                )
                .map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => onSelectionChange(node.id)}
                  >
                    {node.label}
                  </button>
                ))}
          </div>
        ))}
      </details>
      <details className="dna-3d-edge-list">
        <summary>Dependency evidence ({scene.edges.length})</summary>
        {scene.edges.map((item) => (
          <button type="button" key={item.id} onClick={() => setEdge(item)}>
            {byId.get(item.sourceId)?.label} to {byId.get(item.targetId)?.label}{' '}
            ({item.evidence.length})
          </button>
        ))}
      </details>
      {edge && (
        <div className="dna-3d-evidence">
          <button
            type="button"
            onClick={() => setEdge(null)}
            aria-label="Close dependency evidence"
          >
            ×
          </button>
          <strong>
            {edge.evidence.length} detected{' '}
            {edge.evidence.length === 1 ? 'dependency' : 'dependencies'}
          </strong>
          <p>
            Importer → dependency. Static imports do not prove runtime
            execution.
          </p>
          <ul>
            {edge.evidence.map((item) => (
              <li key={item.id}>
                {describeDependency(
                  item,
                  graph.nodes.find((node) => node.id === item.sourceId)
                    ?.label ?? item.sourceId,
                  graph.nodes.find((node) => node.id === item.targetId)
                    ?.label ?? item.targetId,
                )}{' '}
                {item.location
                  ? ` · ${item.location.path}:${item.location.start.line}:${item.location.start.column}`
                  : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="dna-3d-hint">
        Drag to orbit · right-drag to pan · scroll to zoom · select a folder to
        expand
      </p>
    </div>
  );
}

export function Architecture3D(props: {
  graph: DependencyGraph;
  selectedId: string | null;
  onSelectionChange: (id: string | null) => void;
}) {
  if (!canRender3D(props.graph))
    return (
      <div className="dna-3d-fallback" role="status">
        <strong>Graph is too large for 3D</strong>
        <p>
          The 3D view supports up to {MAX_3D_NODES} nodes and {MAX_3D_EDGES}{' '}
          dependencies. Switch to 2D to explore the complete graph.
        </p>
      </div>
    );
  return <Architecture3DScene {...props} />;
}
