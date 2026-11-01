import { useEffect, useMemo, useState } from 'react';
import { course } from '../../content/course';
import { chooseEngine, createEngine } from '../engine/config';
import type { StartupProgress } from '../engine/wasm-client';
import { Session } from '../session/session';
import { loadProgress } from '../storage/storage';
import { EngineSettings } from './EngineSettings';
import { MapScreen } from './MapScreen';
import { Workspace } from './Workspace';


/** `#/level/<id>` opens a level; anything else shows the map. */
function routeFromHash(): string | null {
  const m = /^#\/level\/(.+)$/.exec(location.hash);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function App() {
  const [levelId, setLevelId] = useState(routeFromHash);
  const choice = useMemo(chooseEngine, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [progressTick, setProgressTick] = useState(0);
  const [startup, setStartup] = useState<StartupProgress | null>(null);

  // One session (and one engine) for the whole visit; views never own it.
  const session = useMemo(
    () =>
      choice.kind === 'none' ? null : new Session({ createEngine: () => createEngine(choice, setStartup) }),
    [choice],
  );
  useEffect(() => () => session?.dispose(), [session]);

  useEffect(() => {
    const onHash = () => {
      setLevelId(routeFromHash());
      setProgressTick((n) => n + 1);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const open = (id: string | null) => {
    location.hash = id ? `#/level/${encodeURIComponent(id)}` : '#/';
  };

  const level = course.levels.find((l) => l.id === levelId);
  const progress = useMemo(() => loadProgress(), [progressTick, levelId]);

  return (
    <>
      {level ? (
        <Workspace
          key={level.id}
          course={course}
          level={level}
          session={session}
          startup={startup}
          nextLevel={course.levels[course.levels.indexOf(level) + 1]}
          onBack={() => open(null)}
          onOpen={open}
          onEngineSettings={() => setSettingsOpen(true)}
        />
      ) : (
        <MapScreen
          course={course}
          progress={progress}
          engineLabel={
            choice.kind === 'native' ? 'running on this computer' : choice.kind === 'wasm' ? 'in your browser' : 'not available'
          }
          onOpen={open}
          onEngineSettings={() => setSettingsOpen(true)}
        />
      )}
      {settingsOpen && (
        <EngineSettings choice={choice.kind} onClose={() => setSettingsOpen(false)} />
      )}
    </>
  );
}
