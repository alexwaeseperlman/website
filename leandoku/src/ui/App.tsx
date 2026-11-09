import { useEffect, useMemo, useState } from 'react';
import { course } from '../../content/course';
import { chooseEngine, createEngine } from '../engine/config';
import type { StartupProgress } from '../engine/wasm-client';
import { Session } from '../session/session';
import { warmUpChecks } from '../core/course/warm-up';
import { defaultCatalog } from '../core/catalog/registry';
import { courseNodes, nextNode, tutorialsBefore } from '../core/course/nodes';
import { loadProgress, loadReadTutorials, saveSetting } from '../storage/storage';
import { EngineSettings } from './EngineSettings';
import { MapScreen } from './MapScreen';
import { TutorialScreen } from './TutorialScreen';
import { Workspace } from './Workspace';


/** `#/level/<id>` opens a level, `#/learn/<id>` a tutorial; anything else shows the map. */
function routeFromHash(): string | null {
  const m = /^#\/(?:level|learn)\/(.+)$/.exec(location.hash);
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
      choice.kind === 'none' ? null : new Session({ createEngine: () => createEngine(choice, setStartup, () => warmUpChecks(course, defaultCatalog())) }),
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

  const go = (id: string | null) => {
    if (!id) location.hash = '#/';
    else if (course.tutorials.some((t) => t.id === id)) location.hash = `#/learn/${encodeURIComponent(id)}`;
    else location.hash = `#/level/${encodeURIComponent(id)}`;
  };
  /** From the map: a level whose tutorials are unread opens on the first of them. */
  const openFromMap = (id: string) => {
    const read = loadReadTutorials();
    go(tutorialsBefore(course, id).find((t) => !read.has(t.id))?.id ?? id);
  };

  const node = courseNodes(course).find((n) => (n.kind === 'level' ? n.level.id : n.tutorial.id) === levelId);
  const level = node?.kind === 'level' ? node.level : undefined;
  // The map reopens on the chapter of the level played last.
  useEffect(() => {
    if (level) saveSetting('last-level', level.id);
  }, [level]);
  const progress = useMemo(() => loadProgress(), [progressTick, levelId]);
  const readTutorials = useMemo(() => loadReadTutorials(), [progressTick, levelId]);

  return (
    <>
      {node?.kind === 'tutorial' ? (
        <TutorialScreen
          key={node.tutorial.id}
          tutorial={node.tutorial}
          chapter={node.chapter}
          definitions={course.definitions}
          next={nextNode(course, node.tutorial.id)}
          onBack={() => go(null)}
          onOpen={go}
        />
      ) : level ? (
        <Workspace
          key={level.id}
          course={course}
          level={level}
          session={session}
          startup={startup}
          next={nextNode(course, level.id)}
          onBack={() => go(null)}
          onOpen={go}
          onEngineSettings={() => setSettingsOpen(true)}
        />
      ) : (
        <MapScreen
          course={course}
          progress={progress}
          readTutorials={readTutorials}
          engineLabel={
            choice.kind === 'native' ? 'running on this computer' : choice.kind === 'wasm' ? 'in your browser' : 'not available'
          }
          onOpen={openFromMap}
          onEngineSettings={() => setSettingsOpen(true)}
        />
      )}
      {settingsOpen && (
        <EngineSettings choice={choice.kind} onClose={() => setSettingsOpen(false)} />
      )}
    </>
  );
}
