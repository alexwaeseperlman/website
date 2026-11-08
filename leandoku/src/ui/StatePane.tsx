import type { Checkpoint } from '../core/play/play';
import { Lean } from './Lean';
import type { Goal } from '../engine/protocol';

interface Props {
  checkpoint: Checkpoint;
  stale: boolean;
  offline: boolean;
  /** Tapping a hypothesis offers it to the tactic composer. */
  onPick: (name: string) => void;
}

/**
 * Lean's goal list at the selected point, as Lean reports it: the main goal
 * in full, then the goals after it. The next step works on the main goal.
 */
export function StatePane({ checkpoint, stale, offline, onPick }: Props) {
  const { goals } = checkpoint;
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
  if (goals.length === 0) {
    return (
      <div className={`state ${stale ? 'is-stale' : ''}`}>
        <div className="state-done">No goals left.</div>
      </div>
    );
  }
  return (
    <div className={`state ${stale ? 'is-stale' : ''}`}>
      {goals.length > 1 && <div className="state-count">Goal 1 of {goals.length}</div>}
      <GoalView goal={goals[0]!} onPick={onPick} />
      {goals.length > 1 && (
        <div className="state-later">
          <div className="state-count">After this one</div>
          {goals.slice(1).map((g) => (
            <div key={g.id} className="target is-later">
              {g.tag && <span className="case-tag">{g.tag}</span>}
              <span className="turnstile">⊢</span>
              <span>
                <Lean text={g.target} />
              </span>
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
      {goal.tag && <div className="goal-case">case <span className="case-tag">{goal.tag}</span></div>}
      {goal.hyps.map((h) =>
        h.inaccessible ? (
          <button
            key={h.id}
            type="button"
            className="hyp is-inaccessible is-tappable"
            onClick={() => onPick(h.name)}
            title="Lean hides this name. Tap to name it with rename_i."
          >
            <span className="hyp-name">{h.name}</span>
            <span className="hyp-colon">:</span>
            <span className="hyp-type"><Lean text={h.type} /></span>
          </button>
        ) : (
          <button key={h.id} type="button" className="hyp is-tappable" onClick={() => onPick(h.name)} title={`Use ${h.name}`}>
            <span className="hyp-name">{h.name}</span>
            <span className="hyp-colon">:</span>
            <span className="hyp-type"><Lean text={h.type} /></span>
          </button>
        ),
      )}
      <div className="target">
        <span className="turnstile">⊢</span>
        <span><Lean text={goal.target} /></span>
      </div>
    </div>
  );
}
