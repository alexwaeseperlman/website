import type { Chapter, Level, Tutorial } from '../../src/core/course/types';
import { apply, assumption, casesAnd, constructor, intro, split } from '../script';

export const chapter: Chapter = {
  id: 'logic',
  title: 'Logic',
  blurb: 'And, if-then and not. No numbers, just statements and how to take them apart and put them together.',
};

const level = (l: Omit<Level, 'chapter' | 'revision'>): Level => ({ ...l, chapter: 'logic', revision: 1 });

export const levels: Level[] = [
  level({
    id: 'logic.and_swap',
    title: 'Swap an and',
    prerequisites: [],
    intro: 'Unpack h, then build Q ∧ P out of the pieces.',
    theoremName: 'and_swap',
    header: 'theorem and_swap (P Q : Prop) (h : P ∧ Q) : Q ∧ P := by',
    policy: { tactics: ['cases', 'constructor', 'assumption'], facts: [] },
    solution: [...casesAnd('h', 'hp', 'hq', [...split(constructor, [assumption], [assumption])])],
  }),
  level({
    id: 'logic.imp_trans',
    title: 'Chain two arrows',
    prerequisites: ['logic.and_swap'],
    intro: 'P gets you Q, and Q gets you R. Show that P gets you R.',
    theoremName: 'imp_trans',
    header: 'theorem imp_trans (P Q R : Prop) (hPQ : P → Q) (hQR : Q → R) : P → R := by',
    policy: { tactics: ['intro', 'apply', 'assumption'], facts: [] },
    solution: [intro('hp'), apply('hQR'), apply('hPQ'), assumption],
  }),
  level({
    id: 'logic.fork',
    title: 'One input, two outputs',
    prerequisites: ['logic.imp_trans'],
    intro: 'If P gives you Q and P gives you R, then P gives you both.',
    theoremName: 'fork',
    header: 'theorem fork (P Q R : Prop) (hPQ : P → Q) (hPR : P → R) : P → Q ∧ R := by',
    policy: { tactics: ['intro', 'constructor', 'apply', 'assumption'], facts: [] },
    solution: [intro('hp'), ...split(constructor, [apply('hPQ'), assumption], [apply('hPR'), assumption])],
  }),
  level({
    id: 'logic.fork_swapped',
    title: 'Use fork',
    prerequisites: ['logic.fork'],
    intro: 'The same as the last level with Q and R swapped. intro and constructor are off the menu, so use fork.',
    theoremName: 'fork_swapped',
    header: 'theorem fork_swapped (P Q R : Prop) (hPQ : P → Q) (hPR : P → R) : P → R ∧ Q := by',
    policy: { tactics: ['apply', 'assumption'], facts: 'all' },
    solution: [...split(apply('fork'), [assumption], [assumption])],
  }),
  level({
    id: 'logic.and_regroup',
    title: 'Move the brackets',
    prerequisites: ['logic.and_swap'],
    intro: 'h has an and inside an and. You will need to unpack twice.',
    theoremName: 'and_regroup',
    header: 'theorem and_regroup (P Q R : Prop) (h : (P ∧ Q) ∧ R) : P ∧ (Q ∧ R) := by',
    policy: { tactics: ['cases', 'constructor', 'assumption'], facts: [] },
    solution: [
      ...casesAnd('h', 'hpq', 'hr', [
        ...casesAnd('hpq', 'hp', 'hq', [...split(constructor, [assumption], [...split(constructor, [assumption], [assumption])])]),
      ]),
    ],
  }),
  level({
    id: 'logic.and_map',
    title: 'Both halves at once',
    prerequisites: ['logic.fork'],
    intro: 'Turn P into R and Q into S, side by side.',
    theoremName: 'and_map',
    header: 'theorem and_map (P Q R S : Prop) (hPR : P → R) (hQS : Q → S) (h : P ∧ Q) : R ∧ S := by',
    policy: { tactics: ['cases', 'constructor', 'apply', 'assumption'], facts: [] },
    solution: [...casesAnd('h', 'hp', 'hq', [...split(constructor, [apply('hPR'), assumption], [apply('hQS'), assumption])])],
  }),
  level({
    id: 'logic.curry',
    title: 'One at a time',
    prerequisites: ['logic.fork'],
    intro: 'If P and Q together give R, then P on its own gives you a way to turn Q into R. intro can take two names at once.',
    theoremName: 'curry',
    header: 'theorem curry (P Q R : Prop) (h : P ∧ Q → R) : P → Q → R := by',
    policy: { tactics: ['intro', 'apply', 'constructor', 'assumption'], facts: [] },
    solution: [intro('hp', 'hq'), apply('h'), ...split(constructor, [assumption], [assumption])],
  }),
  level({
    id: 'logic.uncurry',
    title: 'Both at once',
    prerequisites: ['logic.curry'],
    intro: 'The other direction. apply h asks for two things this time.',
    theoremName: 'uncurry',
    header: 'theorem uncurry (P Q R : Prop) (h : P → Q → R) : P ∧ Q → R := by',
    policy: { tactics: ['intro', 'cases', 'apply', 'assumption'], facts: [] },
    solution: [intro('hpq'), ...casesAnd('hpq', 'hp', 'hq', [...split(apply('h'), [assumption], [assumption])])],
  }),
  level({
    id: 'logic.contrapositive',
    title: 'Contrapositive',
    prerequisites: ['logic.imp_trans'],
    intro: 'If P gives Q, and Q is false, then P is false too.',
    theoremName: 'contrapositive',
    header: 'theorem contrapositive (P Q : Prop) (hPQ : P → Q) : ¬Q → ¬P := by',
    policy: { tactics: ['intro', 'apply', 'assumption'], facts: [] },
    solution: [intro('hnq', 'hp'), apply('hnq'), apply('hPQ'), assumption],
  }),
];

export const tutorials: Tutorial[] = [
  {
    id: 'tutorial.statements',
    before: 'logic.and_swap',
    title: 'Statements',
    blocks: [
      { text: 'This chapter has no numbers in it. The goals are made of statements joined by "and", "if-then" and "not".' },
      {
        text: "`P : Prop` means P is a statement. You don't know whether it is true, and the proofs here never need to know.",
      },
      { text: '`hp : P` means you have a proof of P, named hp. If the goal is something you already have, `assumption` finishes it.' },
      { code: 'P : Prop\nhp : P\n⊢ P' },
    ],
  },
  {
    id: 'tutorial.and',
    before: 'logic.and_swap',
    title: 'And',
    blocks: [
      { text: 'A proof of `P ∧ Q` is a proof of P and a proof of Q stuck together.' },
      { text: 'If you have `h : P ∧ Q`, `cases h` pulls it apart into its two halves. Lean marks their names with ✝, which you can\'t type, so follow it with rename_i to choose your own.' },
      { code: 'h : P ∧ Q\n\n-- after cases h\nleft✝ : P\nright✝ : Q\n\n-- after rename_i hp hq\nhp : P\nhq : Q' },
      { text: 'If the goal is `P ∧ Q`, `constructor` splits it into two goals, P and Q, and you prove them one at a time.' },
    ],
  },
  {
    id: 'tutorial.implies',
    before: 'logic.imp_trans',
    title: 'If-then',
    blocks: [
      { text: '`P → Q` means "if P, then Q". Think of it as a machine: put a proof of P in, get a proof of Q out.' },
      { text: 'To prove `P → Q`, use `intro hp`. You get `hp : P` to work with, and the goal becomes Q.' },
      { code: '⊢ P → Q\n\n-- after intro hp\nhp : P\n⊢ Q' },
      {
        text: 'To use `h : P → Q`, wait until the goal is Q and `apply h`. The goal becomes P. You are working backwards: to get Q out, it is enough to put P in.',
      },
    ],
  },
  {
    id: 'tutorial.reuse',
    before: 'logic.fork_swapped',
    title: 'Using a finished level',
    blocks: [
      {
        text: 'A level you have finished is a theorem, and you can use it later the same way you use a hypothesis. `fork` says: if P gives Q and P gives R, then P gives Q ∧ R.',
      },
      { code: 'fork (P Q R : Prop) (hPQ : P → Q) (hPR : P → R) : P → Q ∧ R' },
      {
        text: "`apply fork` matches the end of `fork` against your goal to work out what P, Q and R are, then asks for whatever is still missing. Here that's the two arrows.",
      },
    ],
  },
  {
    id: 'tutorial.not',
    before: 'logic.contrapositive',
    title: 'Not',
    blocks: [
      { text: 'False is a statement with no proof. `¬P` is shorthand for `P → False`: if you had a proof of P, you could prove something impossible.' },
      {
        text: 'Since `¬P` is really an arrow, the moves you already know still work. `intro` on a goal `¬P` gives you `hp : P` and leaves False to prove.',
      },
      { text: 'Nothing proves False directly, but a hypothesis like `hnq : ¬Q` does, as soon as you feed it a Q. So `apply hnq`, and prove Q instead.' },
    ],
  },
];
