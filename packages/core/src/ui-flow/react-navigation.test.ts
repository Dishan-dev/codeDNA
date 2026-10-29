import { describe, expect, it } from 'vitest';
import type { RepositorySnapshot } from '@codedna/shared';
import { analyzeUIFlows, reactNavigationAdapter } from '../index.js';
function snapshot(files: Record<string, string>): RepositorySnapshot {
  return {
    schemaVersion: '1.0',
    id: 'react-navigation-fixture',
    files: Object.entries(files).map(([path, content]) => ({
      id: path,
      path,
      content,
    })),
  };
}
const fixture = snapshot({
  'App.tsx': `import {createNativeStackNavigator} from '@react-navigation/native-stack'; import {createBottomTabNavigator} from '@react-navigation/bottom-tabs'; import Home from './Home'; import Profile from './Profile'; import Feed from './Feed';
    const Stack=createNativeStackNavigator(); const Tab=createBottomTabNavigator();
    function Tabs(){return <Tab.Navigator><Tab.Screen name="Feed" component={Feed}/><Tab.Screen name="Profile" component={Profile}/></Tab.Navigator>}
    export default function App(){return <Stack.Navigator><Stack.Screen name="Home" component={Home}/><Stack.Screen name="Tabs" component={Tabs}/><Stack.Screen name="Profile" component={Profile}/></Stack.Navigator>}`,
  'Home.tsx': `export default function Home({navigation}){navigation.navigate('Profile'); navigation.navigate('Tabs',{screen:'Feed'}); navigation.push('Profile'); navigation.replace('Profile'); navigation.goBack(); navigation.navigate(target); return null}`,
  'Profile.tsx': `import {useNavigation} from '@react-navigation/native'; export default function Profile(){const navigation=useNavigation(); navigation.navigate('Feed'); return null}`,
  'Feed.tsx': `import {useNavigation as useNav} from '@react-navigation/native'; export default function Feed(){const nav=useNav(); nav.navigate('Home'); nav.navigate('Profile'); return null}`,
});
describe('React Navigation UI flow', () => {
  it('maps stack and nested tab registrations with scoped identities', () => {
    const result = analyzeUIFlows(fixture);
    expect(result.framework).toBe('react-navigation');
    expect(result.graph.nodes).toHaveLength(5);
    const profiles = result.graph.nodes.filter((n) => n.label === 'Profile');
    expect(profiles).toHaveLength(2);
    expect(profiles[0]?.id).not.toBe(profiles[1]?.id);
    expect(new Set(profiles.map((n) => n.navigator?.id)).size).toBe(2);
    const feed = result.graph.nodes.find((n) => n.label === 'Feed')!;
    expect(feed.navigator?.parentIds).toHaveLength(1);
    const home = result.graph.nodes.find((n) => n.label === 'Home')!;
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        sourceId: home.id,
        targetId: feed.id,
        kind: 'navigate',
        destination: 'Tabs',
        navigationPath: ['Tabs', 'Feed'],
      }),
    );
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        sourceId: feed.id,
        targetId: home.id,
        kind: 'navigate',
      }),
    );
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        sourceId: feed.id,
        targetId: profiles.find((n) => n.navigator?.name === 'Tab')!.id,
      }),
    );
  });
  it('detects push, replace, back, dynamic actions and shared screen ownership', () => {
    const result = analyzeUIFlows(fixture),
      events = result.graph.navigationEvents!;
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'push', resolution: 'internal' }),
        expect.objectContaining({ kind: 'replace', resolution: 'internal' }),
        expect.objectContaining({ kind: 'back', resolution: 'unresolved' }),
        expect.objectContaining({ kind: 'navigate', resolution: 'dynamic' }),
      ]),
    );
    const shared = events.find((e) => e.location.path === 'Profile.tsx');
    expect(shared?.sourceId).toBeUndefined();
    expect(
      result.diagnostics.some(
        (d) => d.code === 'react-navigation-source-ambiguous',
      ),
    ).toBe(true);
    expect(
      result.graph.edges.some(
        (e) => e.kind === 'back' || e.location?.path === 'Profile.tsx',
      ),
    ).toBe(false);
  });
  it('supports static screen objects, stack and drawer factories and common re-exports', () => {
    const data = snapshot({
      'nav.tsx': `import {createStackNavigator as createStack} from '@react-navigation/stack'; import {createDrawerNavigator} from '@react-navigation/drawer'; import {ScreenA} from './screens';
      export const Stack=createStack({screens:{A:ScreenA, B:{screen:ScreenA}},groups:{Public:{screens:{C:ScreenA}}}}); const Drawer=createDrawerNavigator({screens:{D:ScreenA}});`,
      'screens.ts': `export {default as ScreenA} from './screen';`,
      'screen.tsx': `export default function ScreenA(){return null}`,
    });
    const result = analyzeUIFlows(data);
    expect(result.graph.nodes.map((n) => n.label).sort()).toEqual([
      'A',
      'B',
      'C',
      'D',
    ]);
    expect(result.graph.nodes.every((n) => n.sourceFile === 'screen.tsx')).toBe(
      true,
    );
    expect(
      result.graph.nodes.find((n) => n.label === 'C')?.navigator?.group,
    ).toBe('Public');
    expect(new Set(result.graph.nodes.map((n) => n.navigator?.kind))).toEqual(
      new Set(['createStackNavigator', 'createDrawerNavigator']),
    );
  });
  it('reports duplicate names, generated screens and unknown destinations', () => {
    const data = snapshot({
      'app.tsx': `import {createNativeStackNavigator} from '@react-navigation/native-stack'; const Stack=createNativeStackNavigator(); function Home({navigation}){navigation.navigate('Duplicate'); navigation.navigate('Missing');return null} function X(){return null} export function App(){return <Stack.Navigator><Stack.Screen name="Home" component={Home}/><Stack.Screen name="Duplicate" component={X}/><Stack.Screen name="Duplicate" component={X}/><Stack.Screen name={dynamic} component={X}/>{screens.map(x=><Stack.Screen {...x}/>)}</Stack.Navigator>}`,
    });
    const result = analyzeUIFlows(data);
    expect(result.graph.edges).toHaveLength(0);
    expect(result.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining([
        'react-navigation-screen-collision',
        'react-navigation-registration-dynamic',
        'react-navigation-destination-unresolved',
      ]),
    );
  });
  it('does not resolve a child navigator without an explicit child screen', () => {
    const data = snapshot({
      ...Object.fromEntries(fixture.files.map((f) => [f.path, f.content])),
      'Home.tsx': `export default function Home({navigation}){navigation.navigate('Tabs'); return null}`,
    });
    const result = analyzeUIFlows(data);
    expect(result.graph.edges).toHaveLength(2);
    expect(
      result.graph.navigationEvents?.find((e) => e.location.path === 'Home.tsx')
        ?.resolution,
    ).toBe('unresolved');
  });
  it('keeps reset and dynamic nested navigation unresolved', () => {
    const data = snapshot({
      ...Object.fromEntries(fixture.files.map((f) => [f.path, f.content])),
      'Home.tsx': `export default function Home({navigation}){navigation.reset({index:0,routes:[{name:'Profile'}]});navigation.navigate('Tabs',{screen:target});navigation.navigate('Tabs',{screen:'Feed',initial:unknown});return null}`,
    });
    const result = analyzeUIFlows(data);
    expect(result.graph.navigationEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'history', resolution: 'dynamic' }),
        expect.objectContaining({ kind: 'navigate', resolution: 'dynamic' }),
      ]),
    );
    expect(
      result.graph.edges.some((e) => e.location?.path === 'Home.tsx'),
    ).toBe(false);
  });
  it('retains events in shared directly rendered components without fabricated edges', () => {
    const data = snapshot({
      'nav.tsx': `import {createNativeStackNavigator} from '@react-navigation/native-stack';import A from './A';import B from './B';const Stack=createNativeStackNavigator();export default function App(){return <Stack.Navigator><Stack.Screen name="A" component={A}/><Stack.Screen name="B" component={B}/></Stack.Navigator>}`,
      'A.tsx': `import Shared from './Shared';export default function A(){return <Shared/>}`,
      'B.tsx': `import Shared from './Shared';export default function B(){return <Shared/>}`,
      'Shared.tsx': `import {useNavigation} from '@react-navigation/native';export default function Shared(){const nav=useNavigation();nav.navigate('A');return null}`,
    });
    const result = analyzeUIFlows(data);
    expect(result.graph.edges).toHaveLength(0);
    expect(result.graph.navigationEvents?.[0]?.sourceId).toBeUndefined();
    expect(
      result.diagnostics.some(
        (d) => d.code === 'react-navigation-source-ambiguous',
      ),
    ).toBe(true);
  });
  it('preserves Expo precedence with a mixed-framework diagnostic and supports explicit selection', () => {
    const data = snapshot({
      ...Object.fromEntries(fixture.files.map((f) => [f.path, f.content])),
      'app/_layout.tsx': `import {Stack} from 'expo-router';export default function Layout(){return <Stack/>}`,
      'app/index.tsx': `export default function Index(){return null}`,
    });
    const result = analyzeUIFlows(data);
    expect(result.framework).toBe('expo-router');
    expect(
      result.diagnostics.some((d) => d.code === 'ui-mixed-frameworks'),
    ).toBe(true);
    expect(analyzeUIFlows(data, {}, reactNavigationAdapter).framework).toBe(
      'react-navigation',
    );
  });
  it('does not detect unused navigator imports, and handles malformed files locally', () => {
    expect(
      analyzeUIFlows(
        snapshot({
          'foo.ts': `import {createStackNavigator} from '@react-navigation/stack';`,
        }),
      ).framework,
    ).not.toBe('react-navigation');
    const data = snapshot({
      ...Object.fromEntries(fixture.files.map((f) => [f.path, f.content])),
      'bad.tsx': `const bad = ;`,
    });
    const result = analyzeUIFlows(data);
    expect(result.graph.nodes).toHaveLength(5);
    expect(
      result.diagnostics.some((d) => d.code?.startsWith('react-navigation-TS')),
    ).toBe(true);
  });
  it('produces deterministic output for reordered snapshots', () => {
    expect(analyzeUIFlows(fixture)).toEqual(
      analyzeUIFlows({ ...fixture, files: [...fixture.files].reverse() }),
    );
  });
  it('handles a medium-sized navigator', () => {
    const files: Record<string, string> = {};
    const screens: string[] = [];
    for (let i = 0; i < 500; i++) {
      files[`Screen${i}.tsx`] =
        `export default function Screen({navigation}){navigation.navigate('Screen${(i + 1) % 500}');return null}`;
      screens.push(`import S${i} from './Screen${i}';`);
    }
    files['App.tsx'] =
      `import {createNativeStackNavigator} from '@react-navigation/native-stack';${screens.join('')} const Stack=createNativeStackNavigator({screens:{${Array.from({ length: 500 }, (_, i) => `Screen${i}:S${i}`).join(',')}}});`;
    const start = Date.now(),
      result = analyzeUIFlows(snapshot(files));
    expect(result.graph.nodes).toHaveLength(500);
    expect(result.graph.edges).toHaveLength(500);
    expect(Date.now() - start).toBeLessThan(15000);
  }, 20000);
});
