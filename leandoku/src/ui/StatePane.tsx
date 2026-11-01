import type { Checkpoint } from '../core/play/play';
import type { Goal } from '../engine/protocol';

interface Props {
  checkpoint: Checkpoint;
  stale: boolean;
  offline: boolean;
}

export function StatePane({ checkpoint, stale, offline }: Props) {
  const { goals, split } = checkpoint;
  if (offline) {
    return <div className="state state-empty">The proof state appears once Lean checks the proof.</div>;
  }
  if (goals === null) {
    return (
      <div className="state state-empty">
        {stale ? 'Checking…' : 'Lean did not reach this point. Fix the step marked in red first.'}
      </div>
    );
  }
  if (split) {
    return <div className="state state-empty">This step split the goal. Pick a case in the code above.</div>;
  }
  if (goals.length === 0) {
    return <div className={`state state-done ${stale ? 'is-stale' : ''}`}>No goals left here.</div>;
  }
  return (
    <div className={`state ${stale ? 'is-stale' : ''}`}>
      {goals.length > 1 && (
        <div className="state-count">
          Goal 1 of {goals.length}
          {goals[0]!.tag ? ` · case ${goals[0]!.tag}` : ''}
        </div>
      )}
      <GoalView goal={goals[0]!} />
      {goals.length > 1 && (
        <details className="state-more">
          <summary>{goals.length - 1} more {goals.length === 2 ? 'goal' : 'goals'}</summary>
          {goals.slice(1).map((g) => (
            <GoalView key={g.id} goal={g} />
          ))}
        </details>
      )}
    </div>
  );
}

function GoalView({ goal }: { goal: Goal }) {
  return (
    <div className="goal">
      {goal.hyps.map((h) => (
        <div key={h.id} className={`hyp ${h.inaccessible ? 'is-inaccessible' : ''}`}>
          <span className="hyp-name">{h.name}</span>
          <span className="hyp-colon">:</span>
          <span className="hyp-type">{h.type}</span>
        </div>
      ))}
      <div className="target">
        <span className="turnstile">⊢</span>
        <span>{goal.target}</span>
      </div>
    </div>
  );
}
