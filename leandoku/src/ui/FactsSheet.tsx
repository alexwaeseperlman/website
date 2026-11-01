import type { Fact } from '../core/course/facts';
import type { Definition } from '../core/course/types';

interface Props {
  facts: Fact[];
  definitions: Definition[];
  onClose: () => void;
  /** Offer a fact to the tactic composer, as tapping a hypothesis does. */
  onUse: (name: string) => void;
}

export function FactsSheet({ facts, definitions, onClose, onUse }: Props) {
  const proved = facts.filter((f) => f.level !== null);
  const library = facts.filter((f) => f.level === null);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="Definitions and facts" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Definitions and facts</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <h3>Definitions</h3>
        {definitions.map((d) => (
          <div key={d.name} className="fact">
            <div className="fact-name">{d.name}</div>
            <pre className="fact-source">{d.source}</pre>
          </div>
        ))}
        <h3>Facts you have proved</h3>
        {proved.length === 0 && <p className="slot-empty">None yet. Each level you finish becomes a fact here.</p>}
        {proved.map((f) => (
          <div key={f.name} className="fact">
            <div className="fact-name">
              {f.name}
              <button type="button" className="link" onClick={() => onUse(f.name)}>
                Use
              </button>
            </div>
            <pre className="fact-source">{f.statement}</pre>
          </div>
        ))}
        {library.length > 0 && <h3>From Lean's library</h3>}
        {library.map((f) => (
          <div key={f.name} className="fact">
            <div className="fact-name">
              {f.name}
              <button type="button" className="link" onClick={() => onUse(f.name)}>
                Use
              </button>
            </div>
            <pre className="fact-source">{f.statement}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
