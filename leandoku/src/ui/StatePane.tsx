import type { InsertPoint } from '../core/document/types';
import type { Checkpoint, OpenGoal } from '../core/play/play';
import { Lean } from './Lean';
import type { Goal } from '../engine/protocol';

interface Props {
  checkpoint: Checkpoint;
  stale: boolean;
  offline: boolean;
  /** Open goals elsewhere in the proof (other cases), in the order to prove them. */
  others: OpenGoal[];
  /** Tapping a hypothesis offers it to the tactic composer. */
  onPick: (name: string) => void;
  /** Tapping a later goal moves the cursor to where it is proved. */
  onJump: (at: InsertPoint) => void;
}

export function StatePane({ checkpoint, stale, offline, others, onPick, onJump }: Props) {
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
  const later = (title: string) =>
    goals.length > 1 || others.length > 0 ? (
      <div className="state-later">
        <div className="state-count">{title}</div>
        {goals.slice(1).map((g) => (
          <div key={g.id} className="target is-later">
            <span className="turnstile">⊢</span>
            <span>
              <Lean text={g.target} />
            </span>
          </div>
        ))}
        {others.map((o) => (
          <button key={`${o.at.branch}-${o.goal.id}`} type="button" className="target is-later is-tappable" onClick={() => onJump(o.at)}>
            {o.goal.tag && <span className="case-tag">{o.goal.tag}</span>}
            <span className="turnstile">⊢</span>
            <span>
              <Lean text={o.goal.target} />
            </span>
          </button>
        ))}
      </div>
    ) : null;
  if (split || goals.length === 0) {
    return (
      <div className={`state ${stale ? 'is-stale' : ''}`}>
        <div className="state-done">{split ? 'This step split the goal into cases.' : 'No goals left here.'}</div>
        {later('Still to prove · tap one to work on it')}
      </div>
    );
  }
  const total = goals.length + others.length;
  return (
    <div className={`state ${stale ? 'is-stale' : ''}`}>
      {total > 1 && (
        <div className="state-count">
          Goal 1 of {total}
        </div>
      )}
      <GoalView goal={goals[0]!} onPick={onPick} />
      {later('Still to prove after this one')}
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
            <span className="hyp-type"><Lean text={h.type} /></span>
          </div>
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
