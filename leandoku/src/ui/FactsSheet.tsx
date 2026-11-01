import type { Fact } from '../core/course/facts';
import type { Definition } from '../core/course/types';

export function FactsSheet({ facts, definitions, onClose }: { facts: Fact[]; definitions: Definition[]; onClose: () => void }) {
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
        {facts.length === 0 && <p className="slot-empty">None yet. Each level you finish becomes a fact here.</p>}
        {facts.map((f) => (
          <div key={f.name} className="fact">
            <div className="fact-name">{f.name}</div>
            <pre className="fact-source">{f.statement}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
