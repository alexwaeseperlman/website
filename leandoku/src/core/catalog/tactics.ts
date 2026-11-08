import type { TacticSpec } from './types';

/**
 * Initial catalog entries. These are a starting vocabulary, not the limit of
 * the editor: `raw` covers any tactic without a dedicated entry, and new
 * entries need only be added here.
 */
export const BUILTIN_TACTICS: readonly TacticSpec[] = [
  {
    id: 'rfl',
    label: 'rfl',
    category: 'finish',
    help: 'Close a goal whose two sides are equal by computation.',
    slots: [],
    template: 'rfl',
  },
  {
    id: 'exact',
    label: 'exact',
    category: 'finish',
    help: 'Close the goal with a term of exactly its type.',
    slots: [{ id: 'term', kind: 'term', label: 'proof' }],
    template: 'exact {term}',
  },
  {
    id: 'assumption',
    label: 'assumption',
    category: 'finish',
    help: 'Close the goal with a hypothesis that matches it.',
    slots: [],
    template: 'assumption',
  },
  {
    id: 'intro',
    label: 'intro',
    category: 'intro',
    help: 'Move a hypothesis or variable from the goal into the context.',
    slots: [{ id: 'names', kind: 'names', label: 'names', optional: true }],
    template: 'intro{ |names}',
  },
  {
    id: 'rename_i',
    label: 'rename_i',
    category: 'intro',
    help: 'Name the hypotheses Lean shows with ✝, such as the new number and ih after induction.',
    slots: [{ id: 'names', kind: 'names', label: 'names, in order' }],
    template: 'rename_i {names}',
  },
  {
    id: 'funext',
    label: 'funext',
    category: 'intro',
    help: 'Prove two functions equal by showing they agree on an input you name.',
    slots: [{ id: 'names', kind: 'names', label: 'input name' }],
    template: 'funext {names}',
  },
  {
    id: 'apply',
    label: 'apply',
    category: 'apply',
    help: 'Use a fact whose conclusion matches the goal; its premises become new goals.',
    slots: [{ id: 'term', kind: 'term', label: 'fact' }],
    template: 'apply {term}',
  },
  {
    id: 'constructor',
    label: 'constructor',
    category: 'split',
    help: 'Split a goal such as A ∧ B into one goal per part.',
    slots: [],
    template: 'constructor',
  },
  {
    id: 'rw',
    label: 'rw',
    category: 'rewrite',
    help: 'Rewrite with equalities, left to right unless reversed.',
    slots: [
      { id: 'rules', kind: 'rules', label: 'equalities' },
      { id: 'at', kind: 'location', label: 'where', optional: true },
    ],
    template: 'rw [{rules}]{ at |at}',
  },
  {
    id: 'unfold',
    label: 'unfold',
    category: 'simplify',
    help: 'Replace a definition by its body.',
    slots: [
      { id: 'defs', kind: 'definitions', label: 'definitions' },
      { id: 'at', kind: 'location', label: 'where', optional: true },
    ],
    template: 'unfold {defs}{ at |at}',
  },
  {
    id: 'show',
    label: 'show',
    category: 'simplify',
    help: 'Restate the goal in an equal form Lean can check by computation.',
    slots: [{ id: 'term', kind: 'term', label: 'goal' }],
    template: 'show {term}',
  },
  {
    id: 'induction',
    label: 'induction',
    category: 'split',
    help: 'Prove a statement for every value: one goal for each way the value is built.',
    slots: [{ id: 'target', kind: 'local', label: 'variable' }],
    template: 'induction {target}',
  },
  {
    id: 'cases',
    label: 'cases',
    category: 'split',
    help: 'Split on how a value or hypothesis was built.',
    slots: [{ id: 'target', kind: 'local', label: 'value' }],
    template: 'cases {target}',
  },
  {
    id: 'raw',
    label: 'Lean',
    category: 'other',
    help: 'Type any tactic. Lean still checks it.',
    slots: [{ id: 'text', kind: 'raw', label: 'tactic' }],
    template: '{text}',
  },
];
