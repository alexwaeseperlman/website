import { useEffect, useMemo, useRef, useState } from 'react';
import { fillWithName, usesOfName, withOption } from '../core/catalog/fill';
import type { TacticCatalog } from '../core/catalog/registry';
import type { SlotSpec, SlotValue, TacticCategory } from '../core/catalog/types';
import type { Fact } from '../core/course/facts';
import type { Definition } from '../core/course/types';
import type { InsertPoint, ProofDocument, Step } from '../core/document/types';
import { errorSummary } from '../core/play/errors';
import type { Candidate, ProbeResult } from '../core/play/probe';
import { paletteFor, type LevelPolicy } from '../core/policy/policy';
import type { LevelSource } from '../core/serializer/serialize';
import type { Goal } from '../engine/protocol';
import type { Session } from '../session/session';
import { Lean } from './Lean';
import { useProbe } from './useProbe';

interface Props {
  catalog: TacticCatalog;
  policy: LevelPolicy;
  /** Lean's goals where the new step would go; null when Lean has no state there. */
  goals: Goal[] | null;
  facts: Fact[];
  definitions: Definition[];
  /** A name tapped in the proof state or the theorem list; `n` changes on every tap. */
  pick: { name: string; n: number } | null;
  /** Lean's names for the goal's hidden (✝) hypotheses, to start rename_i with; empty when there are none. */
  renameNames: string[];
  /** The step being changed, if any; the composer then replaces it instead of adding. */
  editing: Step | null;
  /** What previews need to ask Lean: the proof so far and where the step would go. */
  preview: { session: Session | null; level: LevelSource; doc: ProofDocument; at: InsertPoint; ready: boolean };
  onAdd: (tactic: string, args: Record<string, SlotValue>) => void;
  onReplace: (step: Step, tactic: string, args: Record<string, SlotValue>) => void;
  onStopEditing: () => void;
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

interface Option {
  name: string;
  type: string;
}

/** Slots filled by choosing a name, which is where a preview of each choice helps. */
const hasOptions = (s: SlotSpec) => s.kind === 'rules' || s.kind === 'term' || s.kind === 'local';

/**
 * One composer for every tactic: pick a tactic, fill its slots from what is
 * on screen, then add it. Nothing enters the proof until it is complete.
 * Before that, Lean is asked what each choice would do, and its answer is
 * shown next to the choice.
 */
export function Composer(props: Props) {
  const { catalog, policy, goals, facts, definitions, pick, renameNames, editing, preview, onAdd, onReplace, onStopEditing } = props;
  const goal = goals?.[0] ?? null;
  const [tactic, setTacticState] = useState<string | null>(null);
  const [args, setArgs] = useState<Record<string, SlotValue>>({});
  const [hint, setHint] = useState<string | null>(null);
  const [showLocked, setShowLocked] = useState(false);
  /** A tapped name waiting for a tactic to use it in. */
  const [using, setUsing] = useState<string | null>(null);
  const setTactic = (id: string | null, initial: Record<string, SlotValue> = {}) => {
    setTacticState(id);
    setArgs(initial);
    setHint(null);
    setUsing(null);
  };
  // rename_i only means something while Lean is hiding names.
  const palette = paletteFor(catalog, policy)
    .filter((p) => p.spec.id !== 'rename_i' || renameNames.length > 0 || editing?.tactic === 'rename_i')
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.spec.category) - CATEGORY_ORDER.indexOf(b.spec.category));
  const available = palette.filter((p) => p.availability.state === 'available').map((p) => p.spec);
  const naming: Record<string, SlotValue> = { names: { kind: 'names', names: renameNames } };
  const spec = tactic ? catalog.get(tactic) : undefined;
  const text = tactic ? catalog.render(tactic, args) : null;

  // Editing a step opens it here as it was written.
  const editingId = editing?.id;
  useEffect(() => {
    if (editing) setTactic(editing.tactic, { ...editing.args });
    else setTactic(null);
  }, [editingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A name tapped in the proof state goes into the open tactic. With no
  // tactic open, it lists the tactics that take a name, each with what Lean
  // says it would do.
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
    if (usesOfName(available, pick.name).length === 0) setHint(`No tactic in this level takes a name like ${pick.name}.`);
    else {
      setHint(null);
      setUsing(pick.name);
    }
  }, [pick]); // eslint-disable-line react-hooks/exhaustive-deps

  const locals: Option[] = goal?.hyps.filter((h) => !h.inaccessible) ?? [];
  const named: Option[] = [...locals, ...facts.map((f) => ({ name: f.name, type: f.statement }))];
  const optionsFor = (slot: SlotSpec): Option[] => unique(slot.kind === 'local' ? locals : named);

  // Everything worth asking Lean about right now: the tactic as built so
  // far, each name that could go into it, or each tactic a tapped name fits.
  const asked: (Candidate & { key: string })[] = [];
  if (spec) {
    if (text !== null) asked.push({ key: 'self', tactic: spec.id, args });
    for (const slot of spec.slots.filter(hasOptions)) {
      for (const o of optionsFor(slot)) {
        asked.push({ key: `${slot.id}:${o.name}`, tactic: spec.id, args: withOption(slot, args, o.name) });
        if (slot.kind === 'rules') asked.push({ key: `${slot.id}:←${o.name}`, tactic: spec.id, args: withOption(slot, args, o.name, true) });
      }
    }
  } else if (using) {
    for (const u of usesOfName(available, using)) asked.push({ key: `use:${u.spec.id}`, tactic: u.spec.id, args: u.args });
  }
  const askedKey = JSON.stringify(asked);
  const candidates = useMemo(() => asked, [askedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const results = useProbe({ ...preview, catalog, candidates, enabled: preview.ready && goals !== null });
  const outcome = (key: string): ProbeResult | undefined => results[candidates.findIndex((c) => c.key === key)];
  const before = goals?.length ?? 0;

  const groups = CATEGORY_ORDER.map((c) => ({
    category: c,
    items: palette.filter((p) => p.spec.category === c && p.availability.state === 'available'),
  })).filter((g) => g.items.length > 0);
  const locked = palette.filter((p) => p.availability.state === 'locked');

  const chip = (id: string, label: string, help: string, group: string) => (
    <button
      key={id}
      type="button"
      className={`chip tactic-chip ${tactic === id ? 'is-on' : ''}`}
      title={`${group}: ${help}`}
      onClick={() => setTactic(tactic === id ? null : id, id === 'rename_i' ? naming : {})}
    >
      {label}
    </button>
  );

  const close = () => {
    setTactic(null);
    if (editing) onStopEditing();
  };

  return (
    <section className="composer" aria-label={editing ? 'Change a step' : 'Add a tactic'}>
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

      {!spec && using && (
        <div className="builder">
          <div className="builder-actions">
            <span className="builder-title">
              Use <code>{using}</code> with
            </span>
            <button type="button" className="icon-button" aria-label="Cancel" onClick={() => setUsing(null)}>
              ✕
            </button>
          </div>
          <div className="options">
            {usesOfName(available, using).map((u) => {
              const r = outcome(`use:${u.spec.id}`);
              return (
                <button
                  key={u.spec.id}
                  type="button"
                  className={`option ${r?.kind === 'error' ? 'is-miss' : ''}`}
                  onClick={() => setTactic(u.spec.id, u.args)}
                >
                  <span className="option-name"><Lean text={catalog.render(u.spec.id, u.args) ?? u.spec.label} /></span>
                  <Outcome result={r} before={before} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {spec && (
        <div className="builder">
          <div className="builder-actions">
            <code className="builder-preview" aria-label="Lean">
              <Lean text={text ?? `${spec.label} …`} />
            </code>
            <button
              type="button"
              className="primary"
              disabled={text === null}
              onClick={() => {
                if (editing) {
                  onReplace(editing, spec.id, args);
                  onStopEditing();
                } else onAdd(spec.id, args);
                setTactic(null);
              }}
            >
              {editing ? 'Replace' : 'Add'}
            </button>
            <button type="button" className="icon-button" aria-label="Cancel" onClick={close}>
              ✕
            </button>
          </div>
          {text !== null && <Outcome result={outcome('self')} before={before} own />}
          <p className="builder-help">{spec.help}</p>
          {spec.slots.map((slot) => (
            <SlotEditor
              key={slot.id}
              slot={slot}
              value={args[slot.id]}
              locals={locals}
              options={hasOptions(slot) ? optionsFor(slot) : []}
              outcome={(name) => outcome(`${slot.id}:${name}`)}
              before={before}
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

/**
 * What Lean says a step would do, in a line: the goal it leaves, that it
 * closes the goal, or why it was rejected. `own` is the step being built,
 * where a rejection deserves its reason; next to a choice in a list, "no
 * match" is enough.
 */
function Outcome({ result, before, own }: { result: ProbeResult | undefined; before: number; own?: boolean }) {
  if (!result || result.kind === 'unknown') return own ? <p className="outcome is-pending">Asking Lean…</p> : null;
  const Tag = own ? 'p' : 'span';
  if (result.kind === 'error') {
    return <Tag className="outcome is-miss">{own ? errorSummary(result.text) : "doesn't fit as it is"}</Tag>;
  }
  const { goals } = result;
  if (goals.length === 0) return <Tag className="outcome is-done">finishes the proof</Tag>;
  if (goals.length < before) return <Tag className="outcome is-done">closes this goal</Tag>;
  const extra = goals.length - before;
  return (
    <Tag className="outcome">
      <span className="outcome-arrow" aria-label="leaves">
        ⊢
      </span>
      <span className="outcome-goal"><Lean text={goals[0]!.target} /></span>
      {extra > 0 && <span className="outcome-more"> and {extra} more {extra === 1 ? 'goal' : 'goals'}</span>}
    </Tag>
  );
}

interface SlotProps {
  slot: SlotSpec;
  value: SlotValue | undefined;
  locals: Option[];
  options: Option[];
  /** Lean's answer for choosing `name` here; `←name` asks about a rule used right to left. */
  outcome: (name: string) => ProbeResult | undefined;
  before: number;
  definitions: Definition[];
  onChange: (v: SlotValue | undefined) => void;
}

function SlotEditor({ slot, value, locals, options, outcome, before, definitions, onChange }: SlotProps) {
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
            options={options}
            selected={value?.kind === 'local' ? [value.name] : []}
            outcome={outcome}
            before={before}
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
          <input
            className="text-input mono"
            value={text}
            placeholder="pick below, or type a term"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => onChange(e.target.value ? { kind: 'term', text: e.target.value } : undefined)}
          />
          <Options
            options={options}
            selected={[text]}
            outcome={outcome}
            before={before}
            onPick={(t) => onChange({ kind: 'term', text: t })}
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
                    aria-pressed={r.reverse}
                    onClick={() => set(rules.map((x, j) => (j === i ? { ...x, reverse: !x.reverse } : x)))}
                  >
                    ←
                  </button>
                  {/* Editable, so a rule can be told what to act on: add_comm a b. */}
                  <input
                    className="text-input mono rule-term"
                    value={r.term}
                    aria-label={`Rule ${i + 1}`}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) => set(rules.map((x, j) => (j === i ? { ...x, term: e.target.value } : x)))}
                  />
                  <button type="button" className="chip" aria-label="Remove" onClick={() => set(rules.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </li>
              ))}
            </ol>
          )}
          <Options
            options={options}
            selected={[]}
            outcome={outcome}
            before={before}
            reversible
            onPick={(term, reverse) => set([...rules, { term, reverse }])}
            empty="Nothing to rewrite with yet."
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
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
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

function unique(options: Option[]): Option[] {
  const seen = new Set<string>();
  return options.filter((o) => !seen.has(o.name) && seen.add(o.name));
}

function Chips(props: { options: string[]; selected: string[]; onPick: (o: string) => void; empty?: string }) {
  const options = [...new Set(props.options)];
  if (options.length === 0) return props.empty ? <p className="slot-empty">{props.empty}</p> : null;
  return (
    <div className="chips">
      {options.map((o) => (
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

/**
 * Names to pick from. Each shows its type or statement, and under it what
 * Lean says choosing it would do. A rewrite rule that only fits right to
 * left is offered that way round.
 */
function Options(props: {
  options: Option[];
  selected: string[];
  outcome: (name: string) => ProbeResult | undefined;
  before: number;
  reversible?: boolean;
  onPick: (name: string, reverse: boolean) => void;
  empty?: string;
}) {
  if (props.options.length === 0) return props.empty ? <p className="slot-empty">{props.empty}</p> : null;
  return (
    <div className="options">
      {props.options.map((o) => {
        const forward = props.outcome(o.name);
        const backward = props.reversible ? props.outcome(`←${o.name}`) : undefined;
        const reverse = forward?.kind === 'error' && backward?.kind === 'ok';
        const shown = reverse ? backward : forward;
        return (
          <button
            key={o.name}
            type="button"
            className={`option ${props.selected.includes(o.name) ? 'is-on' : ''} ${shown?.kind === 'error' ? 'is-miss' : ''}`}
            onClick={() => props.onPick(o.name, reverse)}
          >
            <span className="option-name">{reverse ? `← ${o.name}` : o.name}</span>
            <span className="option-type"><Lean text={o.type} /></span>
            <Outcome result={shown} before={props.before} />
          </button>
        );
      })}
    </div>
  );
}
