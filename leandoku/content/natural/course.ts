import type { Course, Level } from '../../src/core/course/types';

/**
 * The opening chapter: a home-made natural number type, so every fact the
 * player uses is one they can see or have proved.
 */
const prelude = `set_option autoImplicit false

inductive Natural where
  | zero : Natural
  | succ : Natural → Natural
  deriving Repr

namespace Natural

/-- Addition recurses on its second argument. -/
def add : Natural → Natural → Natural
  | n, zero => n
  | n, succ m => succ (add n m)

instance : Add Natural := ⟨add⟩

end Natural

open Natural`;

const local = (name: string) => ({ kind: 'local' as const, name });
const rules = (...names: string[]) => ({
  kind: 'rules' as const,
  rules: names.map((n) => (n.startsWith('←') ? { term: n.slice(1).trim(), reverse: true } : { term: n, reverse: false })),
});

const basics = { tactics: ['rfl'], facts: [] };
const withInduction = { tactics: ['rfl', 'rw', 'induction'], facts: 'all' as const };

const levels: Level[] = [
  {
    id: 'natural.add_zero',
    title: 'Zero on the right',
    revision: 1,
    prerequisites: [],
    intro: 'Addition recurses on its second argument, so n + zero is n by the first line of the definition. Lean can check that by computation alone.',
    theoremName: 'add_zero',
    header: 'theorem add_zero (n : Natural) : n + zero = n := by',
    policy: basics,
    solution: [{ tactic: 'rfl' }],
  },
  {
    id: 'natural.add_succ',
    title: 'Successor on the right',
    revision: 1,
    prerequisites: ['natural.add_zero'],
    intro: 'The second line of the definition, as a fact you can rewrite with later.',
    theoremName: 'add_succ',
    header: 'theorem add_succ (n m : Natural) : n + succ m = succ (n + m) := by',
    policy: basics,
    solution: [{ tactic: 'rfl' }],
  },
  {
    id: 'natural.zero_add',
    title: 'Zero on the left',
    revision: 1,
    prerequisites: ['natural.add_succ'],
    intro: 'Now zero is on the left, and the definition cannot see past the unknown n. Prove it for zero, then for succ m assuming it holds for m.',
    theoremName: 'zero_add',
    header: 'theorem zero_add (n : Natural) : zero + n = n := by',
    policy: withInduction,
    solution: [
      {
        tactic: 'induction',
        args: { target: local('n') },
        cases: { zero: [], succ: ['m', 'ih'] },
        branches: [
          [{ tactic: 'rfl' }],
          [{ tactic: 'rw', args: { rules: rules('add_succ', 'ih') } }],
        ],
      },
    ],
  },
  {
    id: 'natural.succ_add',
    title: 'Successor on the left',
    revision: 1,
    prerequisites: ['natural.zero_add'],
    intro: 'The mirror image of add_succ. Induct on the right-hand number again.',
    theoremName: 'succ_add',
    header: 'theorem succ_add (n m : Natural) : succ n + m = succ (n + m) := by',
    policy: withInduction,
    solution: [
      {
        tactic: 'induction',
        args: { target: local('m') },
        cases: { zero: [], succ: ['k', 'ih'] },
        branches: [
          [{ tactic: 'rfl' }],
          [{ tactic: 'rw', args: { rules: rules('add_succ', 'add_succ', 'ih') } }],
        ],
      },
    ],
  },
  {
    id: 'natural.add_assoc',
    title: 'Associativity',
    revision: 1,
    prerequisites: ['natural.succ_add'],
    intro: 'Brackets do not matter for addition. Pick the variable the definition recurses on.',
    theoremName: 'add_assoc',
    header: 'theorem add_assoc (a b c : Natural) : a + b + c = a + (b + c) := by',
    policy: withInduction,
    solution: [
      {
        tactic: 'induction',
        args: { target: local('c') },
        cases: { zero: [], succ: ['k', 'ih'] },
        branches: [
          [{ tactic: 'rfl' }],
          [{ tactic: 'rw', args: { rules: rules('add_succ', 'add_succ', 'add_succ', 'ih') } }],
        ],
      },
    ],
  },
];

export const naturalCourse: Course = { id: 'natural', title: 'Natural numbers', prelude, levels };
