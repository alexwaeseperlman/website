import { useEffect, useState } from 'react';
import type { TacticCatalog } from '../core/catalog/registry';
import type { SlotSpec, SlotValue, TacticCategory } from '../core/catalog/types';
import type { Fact } from '../core/course/facts';
import type { Definition } from '../core/course/types';
import { paletteFor, type LevelPolicy } from '../core/policy/policy';
import type { Goal } from '../engine/protocol';

interface Props {
  catalog: TacticCatalog;
  policy: LevelPolicy;
  goal: Goal | null;
  facts: Fact[];
  definitions: Definition[];
  disabled: string | null;
  onAdd: (tactic: string, args: Record<string, SlotValue>) => void;
}

const CATEGORY_ORDER: TacticCategory[] = ['finish', 'intro', 'rewrite', 'apply', 'split', 'simplify', 'other'];

/**
 * One composer for every tactic: pick a tactic, fill its slots from what is
 * on screen, then add it. Nothing enters the proof until it is complete.
 */
export function Composer({ catalog, policy, goal, facts, definitions, disabled, onAdd }: Props) {
  const [tactic, setTactic] = useState<string | null>(null);
  const [args, setArgs] = useState<Record<string, SlotValue>>({});
  const palette = paletteFor(catalog, policy).sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.spec.category) - CATEGORY_ORDER.indexOf(b.spec.category),
  );
  const spec = tactic ? catalog.get(tactic) : undefined;
  const preview = tactic ? catalog.render(tactic, args) : null;

  useEffect(() => {
    setArgs({});
  }, [tactic]);

  const locals = goal?.hyps.filter((h) => !h.inaccessible) ?? [];

  return (
    <section className="composer" aria-label="Add a tactic">
      <div className="palette" role="toolbar">
        {palette.map(({ spec: s, availability }) => {
          const locked = availability.state === 'locked';
          return (
            <button
              key={s.id}
              type="button"
              className={`chip tactic-chip ${tactic === s.id ? 'is-on' : ''} ${locked ? 'is-locked' : ''}`}
              disabled={locked}
              title={locked ? 'Not available in this level' : s.help}
              onClick={() => setTactic(tactic === s.id ? null : s.id)}
            >
              {locked && <span aria-hidden="true">🔒 </span>}
              {s.label}
            </button>
          );
        })}
      </div>

      {spec && (
        <div className="builder">
          <p className="builder-help">{spec.help}</p>
          {spec.slots.map((slot) => (
            <SlotEditor
              key={slot.id}
              slot={slot}
              value={args[slot.id]}
              locals={locals.map((h) => h.name)}
              facts={facts}
              definitions={definitions}
              onChange={(v) =>
                setArgs((a) => {
                  const next = { ...a };
                  if (v === undefined) delete next[slot.id];
                  else next[slot.id] = v;
                  return next;
                })
              }
            />
          ))}
          <div className="builder-actions">
            <code className="builder-preview">{preview ?? `${spec.label} …`}</code>
            <button
              type="button"
              className="primary"
              disabled={preview === null || disabled !== null}
              title={disabled ?? undefined}
              onClick={() => {
                onAdd(spec.id, args);
                setTactic(null);
              }}
            >
              Add
            </button>
          </div>
          {disabled && <p className="builder-note">{disabled}</p>}
        </div>
      )}
    </section>
  );
}

interface SlotProps {
  slot: SlotSpec;
  value: SlotValue | undefined;
  locals: string[];
  facts: Fact[];
  definitions: Definition[];
  onChange: (v: SlotValue | undefined) => void;
}

function SlotEditor({ slot, value, locals, facts, definitions, onChange }: SlotProps) {
  const label = (
    <span className="slot-label">
      {slot.label}
      {slot.optional ? ' (optional)' : ''}
    </span>
  );
  switch (slot.kind) {
    case 'local':
      return (
        <div className="slot">
          {label}
          <Chips
            options={locals}
            selected={value?.kind === 'local' ? [value.name] : []}
            onPick={(name) => onChange({ kind: 'local', name })}
            empty="No variables in this goal."
          />
        </div>
      );
    case 'term': {
      const text = value?.kind === 'term' ? value.text : '';
      return (
        <div className="slot">
          {label}
          <Chips
            options={[...locals, ...facts.map((f) => f.name)]}
            selected={[text]}
            onPick={(t) => onChange({ kind: 'term', text: t })}
          />
          <input
            className="text-input"
            value={text}
            placeholder="or type a term"
            onChange={(e) => onChange(e.target.value ? { kind: 'term', text: e.target.value } : undefined)}
          />
        </div>
      );
    }
    case 'rules': {
      const rules = value?.kind === 'rules' ? value.rules : [];
      const set = (next: typeof rules) => onChange(next.length ? { kind: 'rules', rules: next } : undefined);
      return (
        <div className="slot">
          {label}
          {rules.length > 0 && (
            <ol className="rules">
              {rules.map((r, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className={`chip ${r.reverse ? 'is-on' : ''}`}
                    aria-label="Rewrite right to left"
                    onClick={() => set(rules.map((x, j) => (j === i ? { ...x, reverse: !x.reverse } : x)))}
                  >
                    ←
                  </button>
                  <code>{r.term}</code>
                  <button type="button" className="chip" aria-label="Remove" onClick={() => set(rules.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </li>
              ))}
            </ol>
          )}
          <Chips
            options={[...locals, ...facts.map((f) => f.name)]}
            selected={[]}
            onPick={(term) => set([...rules, { term, reverse: false }])}
            empty="No equalities available yet."
          />
        </div>
      );
    }
    case 'location': {
      const hyp = value?.kind === 'location' ? value.hyp : null;
      return (
        <div className="slot">
          {label}
          <Chips
            options={['goal', ...locals]}
            selected={[hyp ?? 'goal']}
            onPick={(o) => onChange(o === 'goal' ? undefined : { kind: 'location', hyp: o })}
          />
        </div>
      );
    }
    case 'definitions': {
      const names = value?.kind === 'definitions' ? value.names : [];
      return (
        <div className="slot">
          {label}
          <Chips
            options={definitions.map((d) => d.name)}
            selected={names}
            onPick={(n) => {
              const next = names.includes(n) ? names.filter((x) => x !== n) : [...names, n];
              onChange(next.length ? { kind: 'definitions', names: next } : undefined);
            }}
          />
        </div>
      );
    }
    case 'names': {
      const text = value?.kind === 'names' ? value.names.join(' ') : '';
      return (
        <div className="slot">
          {label}
          <input
            className="text-input"
            value={text}
            placeholder="names, separated by spaces"
            onChange={(e) => {
              const names = e.target.value.split(/\s+/);
              onChange(e.target.value.trim() ? { kind: 'names', names } : undefined);
            }}
          />
        </div>
      );
    }
    case 'raw': {
      const text = value?.kind === 'raw' ? value.text : '';
      return (
        <div className="slot">
          {label}
          <input
            className="text-input mono"
            value={text}
            placeholder="any Lean tactic"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => onChange(e.target.value ? { kind: 'raw', text: e.target.value } : undefined)}
          />
        </div>
      );
    }
  }
}

function Chips(props: { options: string[]; selected: string[]; onPick: (o: string) => void; empty?: string }) {
  const unique = [...new Set(props.options)];
  if (unique.length === 0) return props.empty ? <p className="slot-empty">{props.empty}</p> : null;
  return (
    <div className="chips">
      {unique.map((o) => (
        <button
          key={o}
          type="button"
          className={`chip mono ${props.selected.includes(o) ? 'is-on' : ''}`}
          onClick={() => props.onPick(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
