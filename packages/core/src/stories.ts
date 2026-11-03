import type {
  Behavior,
  BehaviorStory,
  EvidenceItem,
  ExplanationCertainty,
  FeatureDiscovery,
  RepositorySnapshot,
  StaticFlowRelationship,
  StaticFlowStep,
  StepRole,
  StoryStep,
} from '@codedna/shared';
import { buildStaticFlow } from './static-flow.js';
import { makeEvidence } from './evidence.js';

const certaintyOf = (step: StaticFlowStep): ExplanationCertainty =>
  step.verification === 'source-evidenced' ? 'verified' : step.verification === 'inferred-entry' ? 'inferred' : 'unresolved';

const WHY: Record<StaticFlowRelationship['kind'], string> = {
  call: 'A direct call means the caller depends on the callee. Static analysis shows the call exists, not that it runs for every input.',
  'jsx-reference': 'Rendering a component builds the screen from smaller parts. It does not show when, or whether, the part is displayed.',
  'event-handler': 'Event handlers connect what a user does to the code that responds. Static analysis shows the connection, not that the event happens.',
  'hook-reference': 'Hooks give a component state or behavior. Static analysis shows the hook is used, not what values it holds.',
  'http-request': 'A request is how one part of the application asks another to do work. Only an exact, literal match to a route is treated as verified.',
  import: 'An import makes code available to another file. It does not mean the code runs.',
};

/**
 * Turns a bounded static flow into plain-language steps. Wording stays conservative: a step only
 * claims what its relationship kind and source location support. Roles are assigned only when the
 * relationship supports them; otherwise the step is a neutral hand-off.
 */
export function buildBehaviorStory(behavior: Behavior, discovery: FeatureDiscovery, snapshot: RepositorySnapshot, complete = true): BehaviorStory {
  const flow = buildStaticFlow(discovery, behavior.flowFeatureId, { snapshotComplete: complete });
  const symbols = new Map(discovery.symbols.map((item) => [item.id, item]));
  const relations = new Map<string, StaticFlowRelationship>([...flow.relationships, ...flow.unresolved].map((item) => [item.id, item]));
  const parentOf = new Map<string, { step: StaticFlowStep; branch: StaticFlowStep['branches'][number] }>();
  for (const step of flow.steps) for (const branch of step.branches) if (!parentOf.has(branch.targetStepId)) parentOf.set(branch.targetStepId, { step, branch });
  const nameOf = (step: StaticFlowStep) => (step.symbolId ? symbols.get(step.symbolId)?.name : undefined) ?? step.file.split('/').pop() ?? step.file;
  const evidence = new Map<string, EvidenceItem>();
  const addEvidence = (item: EvidenceItem | undefined) => { if (item) evidence.set(item.id, item); return item?.id; };
  const where = behavior.entryPoint.route ? (behavior.entryPoint.methods?.length ? `${behavior.entryPoint.methods.join('/')} ${behavior.entryPoint.route}` : behavior.entryPoint.route) : behavior.entryPoint.path;

  const steps: StoryStep[] = flow.steps.map((step, index): StoryStep => {
    const name = nameOf(step);
    const incoming = parentOf.get(step.id);
    const relation = (step.relationshipId ? relations.get(step.relationshipId) : undefined) ?? (incoming ? relations.get(incoming.branch.id.replace(/^branch:/, '')) : undefined);
    const source = incoming ? nameOf(incoming.step) : undefined;
    const condition = incoming?.branch.condition;
    let role: StepRole = 'handoff', title: string, narrative: string, why: string;
    if (index === 0 || !incoming) {
      switch (behavior.category) {
        case 'api':
          role = 'server'; title = `${name} is where requests to ${behavior.entryPoint.route ?? where} are handled`;
          narrative = `${name} in ${step.file} is exported as the handler for ${where}. This is where the code for this endpoint begins.`;
          why = 'Everything that follows is reached by direct references from this handler.'; break;
        case 'page':
          role = 'interface'; title = `${name} is the code behind ${behavior.entryPoint.route ?? where}`;
          narrative = `The ${behavior.entryPoint.route ?? 'page'} route is registered from ${step.file}. ${name} is the code this story starts from.`;
          why = 'A page is the starting point for what a user sees there; the next steps are what this code references.'; break;
        case 'cli':
          role = 'user-action'; title = `A user starts the command through ${name}`;
          narrative = `The package declares a command that points to ${step.file}. ${name} is where this story starts.`;
          why = 'A command line program begins where its declared entry file begins.'; break;
        case 'interaction':
          role = 'interface'; title = `${name} is the interface this story starts from`;
          narrative = `${name} in ${step.file} is a component that attaches event handlers. The next steps show which code those handlers use.`;
          why = 'Handlers are how interface events reach the rest of the code.'; break;
        case 'library':
          role = 'start'; title = `${name} is available to callers`;
          narrative = `${name} is exported from ${step.file}, so other code can call it. The next steps are what it references directly.`;
          why = 'Exported functions are the public surface of a library.'; break;
        default:
          role = 'start'; title = `${name} is a conventional entry file`;
          narrative = `${step.file} has an entry-point style name. Its real role at runtime is not verified.`;
          why = 'Entry files are usually where execution begins, but the filename alone does not prove it.';
      }
    } else if (step.verification === 'unresolved' || !relation || relation.status === 'unresolved') {
      role = 'unresolved'; title = 'Where this goes next could not be determined';
      narrative = relation?.destination
        ? `${source} sends a request to ${relation.destination}, but analysis could not match it to exactly one handler.`
        : `${source} makes a ${relation?.kind ?? 'reference'} that analysis could not resolve to a single declaration.`;
      why = 'Dynamic or ambiguous references are left unresolved instead of guessed, so this part of the behavior is unknown.';
    } else {
      why = WHY[relation.kind];
      switch (relation.kind) {
        case 'call': role = 'handoff'; title = `${source} calls ${name}`; narrative = `${source} passes control to ${name} (${step.file}, line ${step.location.start.line}).`; break;
        case 'jsx-reference': role = 'interface'; title = `${source} shows ${name}`; narrative = `${source} includes the ${name} component in what it renders.`; break;
        case 'event-handler': role = 'user-action'; title = `${name} is attached to a user event`; narrative = `${source} attaches ${name} as an event handler, so ${name} is the code meant to respond when that event occurs.`; break;
        case 'hook-reference': role = 'handoff'; title = `${source} uses ${name}`; narrative = `${source} uses ${name} to supply behavior or state.`; break;
        case 'http-request': role = 'server'; title = `The request reaches ${name}`; narrative = `${source} sends a request to ${relation.destination ?? 'a route'}. The route handler matching that exact address is ${name} in ${step.file}.`; break;
        default: title = `${source} references ${name}`; narrative = `${source} refers to ${name}.`;
      }
    }
    if (condition) why += ` This reference sits behind the condition \`${condition}\`; its value is not known statically.`;
    const evidenceIds = [
      addEvidence(makeEvidence(snapshot, 'flow-step', title, step.location)),
      ...(relation ? [addEvidence(makeEvidence(snapshot, 'reference', `${relation.kind} reference`, relation.location))] : []),
    ].filter((id): id is string => !!id);
    return {
      id: `story-step:${step.id}`, flowStepId: step.id, role, title, narrative, why, certainty: certaintyOf(step),
      file: step.file, location: step.location, evidenceIds,
      next: step.branches.map((branch) => ({ stepId: `story-step:${branch.targetStepId}`, label: branch.label, ...(branch.condition ? { condition: branch.condition } : {}) })),
    };
  });
  const known = new Set(steps.map((step) => step.id));
  for (const step of steps) step.next = step.next.filter((item) => known.has(item.stepId));
  const limitations = [...behavior.limitations, 'These steps follow static references. They are not proof of an actual runtime execution path.'];
  return {
    schemaVersion: '1.0', id: `story:${behavior.id}`, behaviorId: behavior.id, title: behavior.title,
    overview: steps.length > 1 ? `${behavior.title}: ${steps.length} steps follow direct references from ${where}.` : `${behavior.title}: analysis found only the starting point at ${where}.`,
    steps, evidence: [...evidence.values()], limitations: [...new Set(limitations)], truncated: flow.truncated,
  };
}
