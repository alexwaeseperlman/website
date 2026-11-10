import type { Chapter, Definition, Level, Tutorial } from '../../src/core/course/types';
import { induction, renameI, rfl, rw } from '../script';

export const chapter: Chapter = {
  id: 'naturals',
  title: 'Natural numbers',
  blurb: 'Build the counting numbers out of zero and "one more", then prove the rules of addition and multiplication from scratch.',
};

const mul = `namespace Natural

/-- Multiplication is repeated addition. It recurses on its second argument too. -/
def mul : Natural → Natural → Natural
  | _, zero => zero
  | n, succ m => mul n m + n

instance : Mul Natural := ⟨mul⟩

end Natural`;

const mulFacts = `theorem mul_zero (n : Natural) : n * zero = zero := rfl

theorem mul_succ (n m : Natural) : n * succ m = n * m + n := rfl`;

export const prelude = [mul, mulFacts].join('\n\n');

export const definitions: Definition[] = [
  {
    name: 'Natural.mul',
    source: `def mul : Natural → Natural → Natural
  | _, zero => zero
  | n, succ m => mul n m + n

instance : Mul Natural := ⟨mul⟩  -- so a * b means mul a b`,
  },
];

/** The two lines of the definition of multiplication, given rather than proved. */
const mulRules = [
  { name: 'mul_zero', statement: '(n : Natural) : n * zero = zero' },
  { name: 'mul_succ', statement: '(n m : Natural) : n * succ m = n * m + n' },
];

const basics = { tactics: ['rfl'], facts: [] };
const withInduction = { tactics: ['rfl', 'rw', 'induction'], facts: 'all' as const };

export const levels: Level[] = [
  {
    id: 'natural.add_zero',
    chapter: 'naturals',
    title: 'Zero on the right',
    revision: 1,
    prerequisites: [],
    intro: 'Adding zero on the right changes nothing. This is the first line of the definition of addition.',
    hints: [
      'Lean can check this one by running the definition.',
      '`rfl` closes a goal when both sides compute to the same thing.',
    ],
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
    intro: 'The second line of the definition: adding one more gives one more. Once it is proved, it is a fact you can rewrite with.',
    hints: ['As in the last level, both sides compute to the same thing.'],
    theoremName: 'add_succ',
    header: 'theorem add_succ (n m : Natural) : n + succ m = succ (n + m) := by',
    policy: basics,
    solution: [rfl],
  },
  {
    id: 'natural.add_one',
    chapter: 'naturals',
    title: 'Adding one',
    revision: 1,
    prerequisites: ['natural.add_succ'],
    intro: 'Adding one is the same as taking the successor. `rfl` is locked here, so use the two theorems you just proved.',
    hints: [
      'The left side has the shape `n + succ m`. One of your theorems has that on its left.',
      'After rewriting with `add_succ`, look at what is inside the `succ`.',
      'Rewrite with `add_succ`, then `add_zero`.',
    ],
    theoremName: 'add_one',
    header: 'theorem add_one (n : Natural) : n + succ zero = succ n := by',
    policy: { tactics: ['rw'], facts: 'all' },
    solution: [rw('add_succ', 'add_zero')],
  },
  {
    id: 'natural.zero_add',
    chapter: 'naturals',
    title: 'Zero on the left',
    revision: 1,
    prerequisites: ['natural.add_one'],
    intro: 'Zero on the left this time. It looks like the first level, but addition looks at its second number, and here that is `n`, which could be anything.',
    hints: [
      'Try `rfl` and read what Lean says.',
      'When a number could be anything, split into the two ways it can be built.',
      'Start with `induction n`. In the succ case, name the hidden hypotheses with `rename_i`.',
      'To finish the succ case, rewrite with `add_succ`, then with the induction hypothesis.',
    ],
    theoremName: 'zero_add',
    header: 'theorem zero_add (n : Natural) : zero + n = n := by',
    policy: withInduction,
    solution: [
      induction('n'), rfl, renameI('n', 'ih'), rw('add_succ', 'ih'),
    ],
  },
  {
    id: 'natural.succ_add',
    chapter: 'naturals',
    title: 'Successor on the left',
    revision: 1,
    prerequisites: ['natural.zero_add'],
    intro: 'The mirror image of `add_succ`.',
    hints: [
      'There are two variables now. Induct on the one that addition looks at.',
      'That is `m`, the second number.',
      'In the succ case `add_succ` applies twice, once on each side.',
    ],
    theoremName: 'succ_add',
    header: 'theorem succ_add (n m : Natural) : succ n + m = succ (n + m) := by',
    policy: withInduction,
    solution: [
      induction('m'), rfl, renameI('k', 'ih'), rw('add_succ', 'add_succ', 'ih'),
    ],
  },
  {
    id: 'natural.add_assoc',
    chapter: 'naturals',
    title: 'Associativity',
    revision: 1,
    prerequisites: ['natural.succ_add'],
    intro: 'Where the brackets go does not change a sum.',
    hints: [
      'Three variables, and only one of them is worth inducting on.',
      'Addition looks at its second number. The last number added here is `c`.',
      'In the succ case, rewrite with `add_succ` until every `succ` is on the outside, then use the induction hypothesis.',
    ],
    theoremName: 'add_assoc',
    header: 'theorem add_assoc (a b c : Natural) : a + b + c = a + (b + c) := by',
    policy: withInduction,
    solution: [
      induction('c'), rfl, renameI('k', 'ih'), rw('add_succ', 'add_succ', 'add_succ', 'ih'),
    ],
  },
  {
    id: 'natural.add_comm',
    chapter: 'naturals',
    title: 'Commutativity',
    revision: 1,
    prerequisites: ['natural.add_assoc'],
    intro: 'Order does not matter either. Nothing computes on its own here, so `rfl` is locked: every step is a rewrite with something you already proved.',
    hints: [
      'Induct on `b`.',
      'The zero case needs both `add_zero` and `zero_add`.',
      'In the succ case, `add_succ` moves the `succ` out on one side and `succ_add` on the other.',
    ],
    theoremName: 'add_comm',
    header: 'theorem add_comm (a b : Natural) : a + b = b + a := by',
    policy: { tactics: ['rw', 'induction'], facts: 'all' },
    solution: [
      induction('b'), rw('add_zero', 'zero_add'), renameI('k', 'ih'), rw('add_succ', 'succ_add', 'ih'),
    ],
  },
  {
    id: 'natural.add_right_comm',
    chapter: 'naturals',
    title: 'Swap the last two',
    revision: 1,
    prerequisites: ['natural.add_comm'],
    intro: 'Swap the last two numbers of a sum. No induction this time: associativity and commutativity are enough, if you tell them where to act.',
    hints: [
      '`a + b + c` means `(a + b) + c`. Regroup it first, so that `b + c` sits together.',
      '`add_comm` on its own swaps the first sum it finds, which is the wrong one. After picking it, type the numbers it should use: `add_comm b c`.',
      'Regroup back by using `add_assoc` right to left.',
    ],
    theoremName: 'add_right_comm',
    header: 'theorem add_right_comm (a b c : Natural) : a + b + c = a + c + b := by',
    policy: { tactics: ['rw'], facts: 'all' },
    solution: [rw('add_assoc', 'add_comm b c', '← add_assoc')],
  },
  {
    id: 'natural.zero_mul',
    chapter: 'naturals',
    title: 'Zero times anything',
    revision: 1,
    prerequisites: ['natural.add_right_comm'],
    intro: 'Multiplication is repeated addition, and like addition it looks at its second number. Its two defining lines are given to you as `mul_zero` and `mul_succ`. Zero on the left takes a proof, for the same reason as before.',
    hints: [
      'This is `zero_add` again with a different operation.',
      'Induct on `n`. The zero case computes.',
      'In the succ case: `mul_succ`, then the induction hypothesis, then `add_zero`.',
    ],
    theoremName: 'zero_mul',
    header: 'theorem zero_mul (n : Natural) : zero * n = zero := by',
    policy: withInduction,
    library: mulRules,
    solution: [induction('n'), rfl, renameI('n', 'ih'), rw('mul_succ', 'ih', 'add_zero')],
  },
  {
    id: 'natural.mul_add',
    chapter: 'naturals',
    title: 'Multiplying out',
    revision: 1,
    prerequisites: ['natural.zero_mul'],
    intro: 'Multiplication spreads over addition. This is the hardest level in the chapter, and everything it needs is already proved.',
    hints: [
      'Induct on `c`, the number that both `+` and `*` look at.',
      'In the succ case, start with `add_succ` and `mul_succ`. That exposes something the induction hypothesis matches.',
      'After the induction hypothesis, one more `mul_succ` and then `add_assoc` make the two sides identical.',
    ],
    theoremName: 'mul_add',
    header: 'theorem mul_add (a b c : Natural) : a * (b + c) = a * b + a * c := by',
    policy: withInduction,
    library: mulRules,
    solution: [induction('c'), rfl, renameI('c', 'ih'), rw('add_succ', 'mul_succ', 'ih', 'mul_succ', 'add_assoc')],
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
        text: 'Under the code is the proof state. Lines above ⊢ are what you have to work with. The line after ⊢ is what is left to prove.',
      },
      { code: 'n : Natural\n⊢ n + zero = n' },
      {
        text: 'Here you have some number n, and you need to show n + zero = n. A level is done when nothing is left after ⊢.',
      },
      {
        text: 'Proof steps are called tactics. Pick one, fill in anything it asks for, and tap Add. The first tactic you get is `rfl`, which proves an equation when both sides turn into the same thing once Lean runs the definitions.',
      },
      {
        aside: 'If Lean rejects a step, it turns red and says why. Change it or delete it; the rest of the proof is untouched. If you are stuck, each level has hints.',
      },
    ],
  },
  {
    id: 'tutorial.naturals',
    before: 'natural.add_succ',
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
      {
        aside: "The first line is the level you just proved, and the second is the next one. `rfl` proves both, because it only has to run the definition. Plenty of true statements don't compute that way, and then `rfl` fails.",
      },
    ],
    definitions: ['Natural', 'Natural.add'],
  },
  {
    id: 'tutorial.rw',
    before: 'natural.add_one',
    title: 'rw: rewrite with an equation',
    blocks: [
      {
        text: 'If h says a = b, then `rw [h]` replaces a with b in the goal. Your finished levels are equations too: `add_succ` turns n + succ m into succ (n + m), whatever n and m are.',
      },
      {
        text: 'You can give `rw` several equations, and it uses them in order. When a rewrite leaves the two sides identical, `rw` closes the goal by itself.',
      },
      {
        text: 'As you pick an equation, Lean shows the goal it would leave. An equation whose left side appears nowhere in the goal is marked as not fitting.',
      },
      { aside: 'Tap ← next to a rule to use it backwards, replacing b with a.' },
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
      { code: 'induction n\nrfl          -- proves the zero goal\nrename_i n ih\n-- n : Natural\n-- ih : zero + n = n\n-- ⊢ zero + succ n = succ n' },
      {
        text: 'Each step works on the first goal in the list. When rfl closes the zero goal, the succ goal is next. Those two goals cover every number: zero directly, then 1 from 0, 2 from 1, and so on.',
      },
      { aside: 'Tap a ✝ hypothesis in the proof state to start a rename_i with the names Lean gave them.' },
    ],
  },
  {
    id: 'tutorial.rule_arguments',
    before: 'natural.add_right_comm',
    title: 'Telling a rule where to act',
    blocks: [
      {
        text: '`add_comm` says a + b = b + a for every a and b. Given just the name, `rw` uses the first sum it finds in the goal, and that is not always the one you want.',
      },
      {
        text: 'You can fix the numbers yourself. After picking a rule, tap its name in the list and type them after it:',
      },
      { code: 'rw [add_comm b c]   -- only rewrites b + c' },
      { aside: 'Remember that a + b + c means (a + b) + c. There is no b + c in it until you regroup.' },
    ],
  },
  {
    id: 'tutorial.mul',
    before: 'natural.zero_mul',
    title: 'Multiplication',
    blocks: [
      { text: 'Multiplication is repeated addition, defined the same way as addition: by looking at the second number.' },
      { code: 'n * zero   = zero\nn * succ m = n * m + n' },
      {
        text: 'These two lines hold by computation, so they are handed to you as `mul_zero` and `mul_succ`. Everything else about multiplication has to be proved from them and from what you know about addition.',
      },
    ],
    definitions: ['Natural.mul'],
  },
];
