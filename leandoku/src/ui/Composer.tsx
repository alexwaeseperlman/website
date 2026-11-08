import { useEffect, useRef, useState } from 'react';
import type { TacticCatalog } from '../core/catalog/registry';
import { fillWithName, stageHypothesis, suggestTactics } from '../core/catalog/suggest';
import type { SlotSpec, SlotValue, TacticCategory } from '../core/catalog/types';
import type { Fact } from '../core/course/facts';
import type { Definition } from '../core/course/types';
import { paletteFor, type LevelPolicy } from '../core/policy/policy';
import { Lean } from './Lean';
import type { Goal } from '../engine/protocol';

interface Props {
  catalog: TacticCatalog;
  policy: LevelPolicy;
  goal: Goal | null;
  facts: Fact[];
  definitions: Definition[];
  /** A name tapped in the proof state; `n` changes on every tap. */
  pick: { name: string; n: number } | null;
  /** Lean's names for the goal's hidden (✝) hypotheses, to start rename_i with; empty when there are none. */
  renameNames: string[];
  onAdd: (tactic: string, args: Record<string, SlotValue>) => void;
}

const CATEGORY_ORDER: TacticCategory[] = ['finish', 'intro', 'rewrite', 'apply', 'split', 'simplify', 'other'];
const CATEGORY_LABEL: Record<TacticCategory, string> = {
  finish: 'Finish',
  intro: 'Assume',
  rewrite: 'Rewrite',
  apply: 'Use a fact',
  split: 'Split',
  simplify: 'Unfold',
  other: 'Other',
};

/**
 * One composer for every tactic: pick a tactic, fill its slots from what is
 * on screen, then add it. Nothing enters the proof until it is complete.
 */
export function Composer({ catalog, policy, goal, facts, definitions, pick, renameNames, onAdd }: Props) {
  const [tactic, setTacticState] = useState<string | null>(null);
  const [args, setArgs] = useState<Record<string, SlotValue>>({});
  const [hint, setHint] = useState<string | null>(null);
  const [showLocked, setShowLocked] = useState(false);
  const setTactic = (id: string | null, initial: Record<string, SlotValue> = {}) => {
    setTacticState(id);
    setArgs(initial);
    setHint(null);
  };
  // rename_i only means something while Lean is hiding names.
  const palette = paletteFor(catalog, policy).filter((p) => p.spec.id !== 'rename_i' || renameNames.length > 0).sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.spec.category) - CATEGORY_ORDER.indexOf(b.spec.category),
  );
  const allowed = new Set(palette.filter((p) => p.availability.state === 'available').map((p) => p.spec.id));
  const naming: Record<string, SlotValue> = { names: { kind: 'names', names: renameNames } };
  const suggested = [...(renameNames.length ? ['rename_i'] : []), ...suggestTactics(goal, allowed)];
  const spec = tactic ? catalog.get(tactic) : undefined;
  const preview = tactic ? catalog.render(tactic, args) : null;

  // A name tapped in the proof state goes into the open tactic, or opens
  // the tactic that uses it most directly.
  const lastPick = useRef(pick?.n);
  useEffect(() => {
    if (!pick || pick.n === lastPick.current) return;
    lastPick.current = pick.n;
    // A ✝ name can't be typed; tapping one offers to name it instead.
    if (goal?.hyps.some((h) => h.name === pick.name && h.inaccessible)) {
      if (renameNames.length) setTactic('rename_i', naming);
      return;
    }
    if (spec) {
      const next = fillWithName(spec, args, pick.name);
      if (next) setArgs(next);
      else setHint(`${spec.label} doesn't take a name. Close it to use ${pick.name} another way.`);
      return;
    }
    const hyp = goal?.hyps.find((h) => h.name === pick.name);
    const fact = facts.find((f) => f.name === pick.name);
    const staged = goal && (hyp ?? fact) ? stageHypothesis({ name: pick.name, type: hyp?.type ?? conclusionOf(fact!.statement) }, goal, allowed) : null;
    if (staged) setTactic(staged.tactic, staged.args);
    else setHint(`Pick a tactic first, then tap ${pick.name} to use it there.`);
  }, [pick]); // eslint-disable-line react-hooks/exhaustive-deps

  // On a phone the tray covers the bottom of the page; keep the proof state
  // (the last thing above the tray) in view while a tactic is being built.
  useEffect(() => {
    if (tactic && !matchMedia('(min-width: 1000px)').matches) {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    }
  }, [tactic]);

  const locals = goal?.hyps.filter((h) => !h.inaccessible) ?? [];
  const groups = CATEGORY_ORDER.map((c) => ({
    category: c,
    items: palette.filter((p) => p.spec.category === c && p.availability.state === 'available'),
  })).filter((g) => g.items.length > 0);
  const locked = palette.filter((p) => p.availability.state === 'locked');

  const chip = (id: string, label: string, help: string, group: string) => (
    <button
      key={id}
      type="button"
      className={`chip tactic-chip ${tactic === id ? 'is-on' : ''} ${suggested.includes(id) ? 'is-suggested' : ''}`}
      title={`${group}: ${help}${suggested.includes(id) ? ' Fits this goal.' : ''}`}
      onClick={() => setTactic(tactic === id ? null : id, id === 'rename_i' ? naming : {})}
    >
      {label}
    </button>
  );

  return (
    <section className="composer" aria-label="Add a tactic">
      <div className="palette" role="toolbar">
        {groups.map((g, i) => [
          i > 0 && <span key={`sep-${g.category}`} className="palette-sep" aria-hidden="true" />,
          ...g.items.map(({ spec: s }) => chip(s.id, s.label, s.help, CATEGORY_LABEL[g.category])),
        ])}
        {locked.length > 0 && (
          <button
            type="button"
            className="chip palette-more"
            aria-expanded={showLocked}
            onClick={() => setShowLocked((v) => !v)}
          >
            {showLocked ? 'Hide locked' : `${locked.length} locked`}
          </button>
        )}
        {showLocked &&
          locked.map(({ spec: s }) => (
            <span key={s.id} className="chip tactic-chip is-locked" title="Not available in this level">
              {s.label}
            </span>
          ))}
      </div>
      {hint && <p className="builder-note">{hint}</p>}

      {spec && (
        <div className="builder">
          <div className="builder-actions">
            <code className="builder-preview" aria-label="Lean">
              <Lean text={preview ?? `${spec.label} …`} />
            </code>
            <button
              type="button"
              className="primary"
              disabled={preview === null}
              onClick={() => {
                onAdd(spec.id, args);
                setTactic(null);
              }}
            >
              Add
            </button>
            <button type="button" className="icon-button" aria-label="Cancel" onClick={() => setTactic(null)}>
              ✕
            </button>
          </div>
          <p className="builder-help">{spec.help}</p>
          {spec.slots.map((slot) => (
            <SlotEditor
              key={slot.id}
              slot={slot}
              value={args[slot.id]}
              locals={locals}
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
        </div>
      )}
    </section>
  );
}

interface SlotProps {
  slot: SlotSpec;
  value: SlotValue | undefined;
  locals: { name: string; type: string }[];
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
          <Options
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
          <Options
            options={[...locals, ...facts.map((f) => ({ name: f.name, type: f.statement }))]}
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
          <Options
            options={[...locals, ...facts.map((f) => ({ name: f.name, type: f.statement }))].filter((o) => o.type.includes('=') || o.type.includes('↔'))}
            selected={[]}
            onPick={(term) => set([...rules, { term, reverse: false }])}
            empty="No equations available yet."
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
            options={['goal', ...locals.map((l) => l.name)]}
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

/** Names to pick from, each with its type or statement so the choice is informed. */
function Options(props: {
  options: { name: string; type: string }[];
  selected: string[];
  onPick: (name: string) => void;
  empty?: string;
}) {
  const seen = new Set<string>();
  const unique = props.options.filter((o) => !seen.has(o.name) && seen.add(o.name));
  if (unique.length === 0) return props.empty ? <p className="slot-empty">{props.empty}</p> : null;
  return (
    <div className="options">
      {unique.map((o) => (
        <button
          key={o.name}
          type="button"
          className={`option ${props.selected.includes(o.name) ? 'is-on' : ''}`}
          onClick={() => props.onPick(o.name)}
        >
          <span className="option-name">{o.name}</span>
          <span className="option-type"><Lean text={o.type} /></span>
        </button>
      ))}
    </div>
  );
}

/** `(n : Natural) : n + zero = n` → `n + zero = n`, for guessing how a fact is used. */
function conclusionOf(statement: string): string {
  let depth = 0;
  let last = -1;
  for (let i = 0; i < statement.length; i++) {
    const c = statement[i]!;
    if ('([{⟨'.includes(c)) depth++;
    else if (')]}⟩'.includes(c)) depth--;
    else if (c === ':' && depth === 0 && statement[i + 1] !== '=') last = i;
  }
  return last < 0 ? statement : statement.slice(last + 1).trim();
}
