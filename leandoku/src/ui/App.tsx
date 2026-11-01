import { useEffect, useMemo, useState } from 'react';
import { naturalCourse } from '../../content/natural/course';
import { createEngine, engineEndpoint } from '../engine/config';
import { Session } from '../session/session';
import { loadProgress } from '../storage/storage';
import { EngineSettings } from './EngineSettings';
import { MapScreen } from './MapScreen';
import { Workspace } from './Workspace';

const course = naturalCourse;

/** `#/level/<id>` opens a level; anything else shows the map. */
function routeFromHash(): string | null {
  const m = /^#\/level\/(.+)$/.exec(location.hash);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function App() {
  const [levelId, setLevelId] = useState(routeFromHash);
  const endpoint = useMemo(engineEndpoint, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [progressTick, setProgressTick] = useState(0);

  // One session (and one engine) for the whole visit; views never own it.
  const session = useMemo(
    () => (endpoint ? new Session({ createEngine: () => createEngine(endpoint) }) : null),
    [endpoint],
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
          nextLevel={course.levels[course.levels.indexOf(level) + 1]}
          onBack={() => open(null)}
          onOpen={open}
          onEngineSettings={() => setSettingsOpen(true)}
        />
      ) : (
        <MapScreen
          course={course}
          progress={progress}
          engineLabel={endpoint ? 'running on this computer' : 'not in the browser yet'}
          onOpen={open}
          onEngineSettings={() => setSettingsOpen(true)}
        />
      )}
      {settingsOpen && (
        <EngineSettings connected={endpoint !== undefined} onClose={() => setSettingsOpen(false)} />
      )}
    </>
  );
}
