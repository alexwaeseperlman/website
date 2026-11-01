import type { Chapter, Level, Tutorial } from '../../src/core/course/types';
import { local, renameI, rfl, rw } from '../script';

export const chapter: Chapter = {
  id: 'naturals',
  title: 'Natural numbers',
  blurb: 'Build the counting numbers out of zero and "one more", then prove the rules of addition from scratch.',
};

const basics = { tactics: ['rfl'], facts: [] };
const withInduction = { tactics: ['rfl', 'rw', 'induction'], facts: 'all' as const };

export const levels: Level[] = [
  {
    id: 'natural.add_zero',
    chapter: 'naturals',
    title: 'Zero on the right',
    revision: 1,
    prerequisites: [],
    intro: 'Adding zero is the first line of the definition, so Lean can check this by computing.',
    theoremName: 'add_zero',
    header: 'theorem add_zero (n : Natural) : n + zero = n := by',
    policy: basics,
    solution: [rfl],
  },
  {
    id: 'natural.add_succ',
    chapter: 'naturals',
    title: 'Successor on the right',
    revision: 1,
    prerequisites: ['natural.add_zero'],
    intro: 'This is the second line of the definition. Proving it once gives you a fact to rewrite with later.',
    theoremName: 'add_succ',
    header: 'theorem add_succ (n m : Natural) : n + succ m = succ (n + m) := by',
    policy: basics,
    solution: [rfl],
  },
  {
    id: 'natural.zero_add',
    chapter: 'naturals',
    title: 'Zero on the left',
    revision: 1,
    prerequisites: ['natural.add_succ'],
    intro: 'rfl fails here, because addition looks at its second number and that is the unknown n. Use induction on n.',
    theoremName: 'zero_add',
    header: 'theorem zero_add (n : Natural) : zero + n = n := by',
    policy: withInduction,
    solution: [
      {
        tactic: 'induction',
        args: { target: local('n') },
        branches: [[rfl], [renameI('n', 'ih'), rw('add_succ', 'ih')]],
      },
    ],
  },
  {
    id: 'natural.succ_add',
    chapter: 'naturals',
    title: 'Successor on the left',
    revision: 1,
    prerequisites: ['natural.zero_add'],
    intro: 'The mirror image of add_succ. Pick the number that addition looks at.',
    theoremName: 'succ_add',
    header: 'theorem succ_add (n m : Natural) : succ n + m = succ (n + m) := by',
    policy: withInduction,
    solution: [
      {
        tactic: 'induction',
        args: { target: local('m') },
        branches: [[rfl], [renameI('k', 'ih'), rw('add_succ', 'add_succ', 'ih')]],
      },
    ],
  },
  {
    id: 'natural.add_assoc',
    chapter: 'naturals',
    title: 'Associativity',
    revision: 1,
    prerequisites: ['natural.succ_add'],
    intro: 'Where the brackets go does not change a sum. Three variables this time; only one of them is worth inducting on.',
    theoremName: 'add_assoc',
    header: 'theorem add_assoc (a b c : Natural) : a + b + c = a + (b + c) := by',
    policy: withInduction,
    solution: [
      {
        tactic: 'induction',
        args: { target: local('c') },
        branches: [[rfl], [renameI('k', 'ih'), rw('add_succ', 'add_succ', 'add_succ', 'ih')]],
      },
    ],
  },
  {
    id: 'natural.add_comm',
    chapter: 'naturals',
    title: 'Commutativity',
    revision: 1,
    prerequisites: ['natural.add_assoc'],
    intro: 'Order does not matter either. Nothing computes on its own here, so every step is a rewrite with something you already proved.',
    theoremName: 'add_comm',
    header: 'theorem add_comm (a b : Natural) : a + b = b + a := by',
    policy: { tactics: ['rw', 'induction'], facts: 'all' },
    solution: [
      {
        tactic: 'induction',
        args: { target: local('b') },
        branches: [[rw('add_zero', 'zero_add')], [renameI('k', 'ih'), rw('add_succ', 'succ_add', 'ih')]],
      },
    ],
  },
];

export const tutorials: Tutorial[] = [
  {
    id: 'tutorial.how_it_works',
    before: 'natural.add_zero',
    title: 'How a level works',
    blocks: [
      {
        text: 'Each level is one theorem. Its statement sits at the top as Lean code ending in `:= by`, and you write the proof underneath, one step at a time. Lean checks the proof every time you add a step.',
      },
      {
        text: 'The box under the code is the proof state. Lines above ⊢ are what you have to work with. The line after ⊢ is what is left to prove.',
      },
      { code: 'n : Natural\n⊢ n + zero = n' },
      {
        text: 'Here you have some number n, and you need to show n + zero = n. A level is done when nothing is left after ⊢.',
      },
      {
        text: 'Proof steps are called tactics. Pick one, fill in anything it asks for, and tap Add. If Lean rejects a step, it turns red and the message says why. Change it or delete it; the rest of the proof is untouched.',
      },
    ],
  },
  {
    id: 'tutorial.naturals',
    before: 'natural.add_zero',
    title: 'Numbers from scratch',
    blocks: [
      {
        text: "This course doesn't use Lean's built-in numbers. It defines its own, so you can see exactly what they are made of.",
      },
      {
        text: 'A Natural is either zero, or succ n, which means "one more than n". Every number is built that way:',
      },
      { code: 'zero               -- 0\nsucc zero          -- 1\nsucc (succ zero)   -- 2' },
      {
        text: 'Addition is defined by looking at the second number. Adding zero gives back the first number. Adding succ m gives one more than adding m.',
      },
      { code: 'n + zero   = n\nn + succ m = succ (n + m)' },
      { aside: 'Everything in this chapter follows from these few lines. The full definitions are below.' },
    ],
    definitions: ['Natural', 'Natural.add'],
  },
  {
    id: 'tutorial.rfl',
    before: 'natural.add_zero',
    title: 'rfl: check by computing',
    blocks: [
      {
        text: 'rfl proves an equation when both sides turn into the same thing after Lean runs the definitions.',
      },
      {
        text: 'In the first level, n + zero runs the first line of addition and becomes n. The goal is then n = n, and rfl closes it.',
      },
      { code: 'theorem add_zero (n : Natural) : n + zero = n := by\n  rfl' },
      {
        aside: "rfl only computes. Plenty of true statements don't simplify that way, and then rfl fails. You'll meet one in level 3.",
      },
    ],
  },
  {
    id: 'tutorial.induction',
    before: 'natural.zero_add',
    title: 'Induction',
    blocks: [
      {
        text: "zero + n doesn't compute. Addition looks at its second number to decide what to do, and here that is n, which could be any number.",
      },
      {
        text: 'induction n replaces the goal with two goals, one for each way a Natural can be built. First you prove the statement for zero. Then you prove it for succ n, and there you may assume it already holds for n.',
      },
      {
        text: "Lean doesn't name the new number or that assumption, because you never chose names for them. It marks them with ✝, and a name with ✝ can't be typed. rename_i gives them names, in order:",
      },
      { code: 'induction n\n· rfl\n· rename_i n ih\n  -- n : Natural\n  -- ih : zero + n = n\n  -- ⊢ zero + succ n = succ n' },
      {
        text: 'The dots mark where each goal starts. Those two goals cover every number: zero directly, then 1 from 0, 2 from 1, and so on.',
      },
      { aside: 'Tap a ✝ hypothesis in the proof state and the app fills in rename_i for you.' },
    ],
  },
  {
    id: 'tutorial.rw',
    before: 'natural.zero_add',
    title: 'rw: rewrite with an equation',
    blocks: [
      {
        text: 'If h says a = b, then rw [h] replaces a with b in the goal. Your finished levels count as equations too: add_succ lets you turn n + succ m into succ (n + m).',
      },
      {
        text: 'In the succ case of the next level, rewriting with add_succ and then ih leaves succ n = succ n. When a rewrite leaves the two sides identical, rw closes the goal by itself.',
      },
      { aside: 'Tap ← next to a rule to use it backwards, replacing b with a.' },
    ],
  },
];
