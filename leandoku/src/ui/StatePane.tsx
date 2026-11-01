import type { Checkpoint } from '../core/play/play';
import type { Goal } from '../engine/protocol';

interface Props {
  checkpoint: Checkpoint;
  stale: boolean;
  offline: boolean;
  /** Tapping a hypothesis offers it to the tactic composer. */
  onPick: (name: string) => void;
}

export function StatePane({ checkpoint, stale, offline, onPick }: Props) {
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
      <GoalView goal={goals[0]!} onPick={onPick} />
      {goals.length > 1 && (
        <div className="state-later">
          <div className="state-count">Still to prove after this one</div>
          {goals.slice(1).map((g) => (
            <div key={g.id} className="target is-later">
              <span className="turnstile">⊢</span>
              <span>{g.target}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GoalView({ goal, onPick }: { goal: Goal; onPick: (name: string) => void }) {
  return (
    <div className="goal">
      {goal.hyps.map((h) =>
        h.inaccessible ? (
          <div key={h.id} className="hyp is-inaccessible">
            <span className="hyp-name">{h.name}</span>
            <span className="hyp-colon">:</span>
            <span className="hyp-type">{h.type}</span>
          </div>
        ) : (
          <button key={h.id} type="button" className="hyp is-tappable" onClick={() => onPick(h.name)} title={`Use ${h.name}`}>
            <span className="hyp-name">{h.name}</span>
            <span className="hyp-colon">:</span>
            <span className="hyp-type">{h.type}</span>
          </button>
        ),
      )}
      <div className="target">
        <span className="turnstile">⊢</span>
        <span>{goal.target}</span>
      </div>
    </div>
  );
}
