import type { Fact } from '../core/course/facts';
import { Lean } from './Lean';
import type { Definition } from '../core/course/types';

interface Props {
  facts: Fact[];
  definitions: Definition[];
  /** Offer a fact to the tactic composer, as tapping a hypothesis does. */
  onUse: (name: string) => void;
}

/** The theorems this level may cite, listed under the proof state, with the definitions folded away. */
export function FactsPanel({ facts, definitions, onUse }: Props) {
  const proved = facts.filter((f) => f.level !== null);
  const library = facts.filter((f) => f.level === null);
  const fact = (f: Fact) => (
    <div key={f.name} className="fact">
      <div className="fact-name">
        {f.name}
        <button type="button" className="link" onClick={() => onUse(f.name)}>
          Use
        </button>
      </div>
      <pre className="fact-source"><Lean text={f.statement} /></pre>
    </div>
  );
  return (
    <section className="panel facts" id="facts" aria-label="Theorems you can use">
      <div className="panel-head">
        <span>Theorems you can use</span>
      </div>
      {proved.length === 0 && library.length === 0 && (
        <p className="slot-empty">None yet. Each level you finish becomes a theorem here.</p>
      )}
      {proved.map(fact)}
      {library.length > 0 && <h3>From Lean's library</h3>}
      {library.map(fact)}
      {definitions.length > 0 && (
        <details className="definitions">
          <summary>Definitions</summary>
          {definitions.map((d) => (
            <div key={d.name} className="fact">
              <div className="fact-name">{d.name}</div>
              <pre className="fact-source"><Lean text={d.source} /></pre>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
