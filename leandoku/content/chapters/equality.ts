import type { Chapter, Definition, Level, Tutorial } from '../../src/core/course/types';
import { apply, assumption, casesAnd, constructor, exact, funext, intro, rfl, rw, split } from '../script';

export const chapter: Chapter = {
  id: 'equality',
  title: 'Equality',
  blurb: 'What it means for two things to be equal, for any type at all, and how to use an equation once you have one.',
};

const composeSource = `/-- Do f, then g. -/
def compose {A B C : Type} (g : B → C) (f : A → B) (x : A) : C := g (f x)`;

/** Lean added before every level. Chapters after this one use compose too. */
export const prelude = composeSource;

export const definitions: Definition[] = [{ name: 'compose', source: composeSource }];

const level = (l: Omit<Level, 'chapter' | 'revision'>): Level => ({ ...l, chapter: 'equality', revision: 1 });

export const levels: Level[] = [
  level({
    id: 'equality.eq_symm',
    title: 'Flip an equation',
    prerequisites: [],
    intro: "An equation can be read in either direction. a and b could be anything, as long as they have the same type.",
    hints: [
      "Rewriting with `h` turns every `a` in the goal into `b`.",
      "After that both sides are identical, and `rw` closes the goal by itself.",
    ],
    theoremName: 'eq_symm',
    header: 'theorem eq_symm (A : Type) (a b : A) (h : a = b) : b = a := by',
    policy: { tactics: ['rw'], facts: [] },
    solution: [rw('h')],
  }),
  level({
    id: 'equality.eq_trans',
    title: 'Chain two equations',
    prerequisites: ['equality.eq_symm'],
    intro: "a is b and b is c, so a is c.",
    hints: [
      "`rw` can take more than one equation, used in order.",
      "Rewrite with `hab`, then `hbc`.",
    ],
    theoremName: 'eq_trans',
    header: 'theorem eq_trans (A : Type) (a b c : A) (hab : a = b) (hbc : b = c) : a = c := by',
    policy: { tactics: ['rw'], facts: [] },
    solution: [rw('hab', 'hbc')],
  }),
  level({
    id: 'equality.eq_bridge',
    title: 'Meet in the middle',
    prerequisites: ['equality.eq_trans'],
    intro: "Two equations that meet at b. `rw` is locked this time, so use the two levels before this one.",
    hints: [
      "`eq_trans` chains two equations through a middle point.",
      "`apply eq_trans` can't tell which middle point you mean, so say it: `eq_trans A a b c`.",
      "One of the two goals has its sides the wrong way round. `eq_symm` fixes that.",
    ],
    theoremName: 'eq_bridge',
    header: 'theorem eq_bridge (A : Type) (a b c : A) (hab : a = b) (hcb : c = b) : a = c := by',
    policy: { tactics: ['apply', 'assumption'], facts: 'all' },
    solution: [...split(apply('eq_trans A a b c'), [assumption], [apply('eq_symm'), assumption])],
  }),
  level({
    id: 'equality.eq_both_ways',
    title: 'Equal either way round',
    prerequisites: ['equality.eq_symm'],
    intro: "a = b and b = a say the same thing.",
    hints: [
      "An ↔ is two if-thens. `constructor` gives you one goal for each.",
      "In each, `intro` the equation, then `apply eq_symm`.",
    ],
    theoremName: 'eq_both_ways',
    header: 'theorem eq_both_ways (A : Type) (a b : A) : a = b ↔ b = a := by',
    policy: { tactics: ['constructor', 'intro', 'apply', 'assumption'], facts: 'all' },
    solution: [...split(constructor, [intro('h'), apply('eq_symm'), assumption], [intro('h'), apply('eq_symm'), assumption])],
  }),
  level({
    id: 'equality.compose_assoc',
    title: 'Composing three functions',
    prerequisites: ['equality.eq_both_ways'],
    intro: "Doing f then g, then h, is the same function as doing f, then g then h.",
    hints: [
      "Two functions are equal when they agree on every input. `funext` lets you name one.",
      "After `funext x`, both sides compute to the same thing.",
    ],
    theoremName: 'compose_assoc',
    header: `theorem compose_assoc (A B C D : Type) (f : A → B) (g : B → C) (h : C → D) :
    compose h (compose g f) = compose (compose h g) f := by`,
    policy: { tactics: ['funext', 'rfl'], facts: [] },
    solution: [funext('x'), rfl],
  }),
  level({
    id: 'equality.and_iff',
    title: 'Swap both halves',
    prerequisites: ['equality.eq_both_ways'],
    intro: "P is as good as R and Q is as good as S, so P ∧ Q is as good as R ∧ S. Any tactic is allowed.",
    hints: [
      "Split the ↔. In each direction, assume the and and take it apart.",
      "`hPR.mp` turns a proof of P into a proof of R, and `hPR.mpr` goes back.",
      "You can build an and in one go: `exact ⟨…, …⟩`.",
    ],
    theoremName: 'and_iff',
    header: 'theorem and_iff (P Q R S : Prop) (hPR : P ↔ R) (hQS : Q ↔ S) : P ∧ Q ↔ R ∧ S := by',
    policy: { tactics: 'all', facts: 'all' },
    library: [
      { name: 'Iff.mp', statement: '(h : P ↔ Q) (hp : P) : Q' },
      { name: 'Iff.mpr', statement: '(h : P ↔ Q) (hq : Q) : P' },
    ],
    solution: [
      ...split(
        constructor,
        [intro('h'), ...casesAnd('h', 'hp', 'hq', [exact('⟨hPR.mp hp, hQS.mp hq⟩')])],
        [intro('h'), ...casesAnd('h', 'hr', 'hs', [exact('⟨hPR.mpr hr, hQS.mpr hs⟩')])],
      ),
    ],
  }),
];

export const tutorials: Tutorial[] = [
  {
    id: 'tutorial.funext',
    before: 'equality.compose_assoc',
    title: 'When two functions are equal',
    blocks: [
      { text: '`compose g f` is the function that does f and then g. Here is the whole definition:' },
      { code: composeSource },
      { text: 'Two functions are equal when they give the same answer for every input. `funext x` turns the goal `f = g` into `f x = g x`, for a new input x.' },
      { text: 'Once there is an x to feed in, both sides of the next level work out to `h (g (f x))`, and `rfl` can see that.' },
    ],
    definitions: ['compose'],
  },
  {
    id: 'tutorial.any_type',
    before: 'equality.eq_symm',
    title: 'Equality for any type',
    blocks: [
      {
        text: '`A : Type` means A is a type, and you are not told which. It could be Natural, or pairs of functions, or something nobody has thought of. `a b : A` are two things of that type.',
      },
      { text: "Because A is unknown, you can't compute anything. What you can do is rewrite: with `h : a = b`, `rw [h]` replaces a with b everywhere in the goal." },
      { code: 'h : a = b\n⊢ b = a\n\n-- after rw [h]\n⊢ b = b   -- rw closes this on its own' },
    ],
  },
  {
    id: 'tutorial.iff',
    before: 'equality.eq_both_ways',
    title: 'If and only if',
    blocks: [
      { text: '`P ↔ Q` means `P → Q` and `Q → P`, both at once.' },
      { text: 'To prove one, `constructor` splits it into the two arrows. Each is an ordinary if-then: start with `intro`.' },
      { code: '⊢ P ↔ Q\n\n-- after constructor\n⊢ P → Q\n⊢ Q → P' },
    ],
  },
  {
    id: 'tutorial.open_level',
    before: 'equality.and_iff',
    title: 'No limits',
    blocks: [
      {
        text: "Until now each level offered only the tactics it was about. This one offers everything, including the Lean button, which takes any tactic you type. There's no intended proof.",
      },
      {
        text: 'You will need to use an ↔ you have. If `h : P ↔ R`, then `h.mp` turns a proof of P into a proof of R, and `h.mpr` goes the other way.',
      },
      { text: '`⟨a, b⟩` builds an and out of its two halves in one go, if you want to skip `constructor`.' },
    ],
  },
];
