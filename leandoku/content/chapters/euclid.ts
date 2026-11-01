import type { Chapter, Definition, Level, Tutorial } from '../../src/core/course/types';
import { apply, assumption, byCases, casesAnd, constructor, exact, intro, rw, split, unfold } from '../script';

export const chapter: Chapter = {
  id: 'euclid',
  title: "Euclid's algorithm",
  blurb: 'The oldest algorithm still in use. Prove it always stops and always gives the greatest common divisor.',
};

const system = `/-- Everything Euclid's algorithm needs from a number system. -/
structure EuclideanSystem where
  Carrier : Type
  zero : Carrier
  rem : Carrier → Carrier → Carrier
  divides : Carrier → Carrier → Prop
  smaller : Carrier → Carrier → Prop
  wellFounded : WellFounded smaller
  divides_zero : ∀ d, divides d zero
  divides_refl : ∀ d, divides d d
  divides_rem_iff : ∀ {d a b}, divides d a → (divides d (rem b a) ↔ divides d b)
  remainder_smaller : ∀ {a b}, a ≠ zero → smaller (rem b a) a`;

const commonDivisor = `def CommonDivisor (E : EuclideanSystem) (d a b : E.Carrier) : Prop :=
  E.divides d a ∧ E.divides d b`;

const mutuallyDivides = `def MutuallyDivides (E : EuclideanSystem) (a b : E.Carrier) : Prop :=
  E.divides a b ∧ E.divides b a`;

const isGCD = `/-- g divides a and b, and so does nothing bigger. -/
structure IsGCD (E : EuclideanSystem) (g a b : E.Carrier) : Prop where
  common : CommonDivisor E g a b
  greatest : ∀ d, CommonDivisor E d a b → E.divides d g`;

const euclidRun = `/-- Starting from (a, b), the algorithm stops with answer g. -/
inductive EuclidRun (E : EuclideanSystem) : E.Carrier → E.Carrier → E.Carrier → Prop where
  | done (b : E.Carrier) : EuclidRun E E.zero b b
  | step (a b g : E.Carrier) (ha : a ≠ E.zero) (next : EuclidRun E (E.rem b a) a g) :
      EuclidRun E a b g`;

const euclidCorrect = `structure EuclidCorrect (E : EuclideanSystem) : Prop where
  terminates : ∀ a b, ∃ g, EuclidRun E a b g
  sound : ∀ a b g, EuclidRun E a b g → IsGCD E g a b
  agree : ∀ a b g h, EuclidRun E a b g → EuclidRun E a b h → MutuallyDivides E g h`;

const terminates = `/-- Given: every run stops. Each remainder is smaller than the last, and
\`smaller\` has no infinite descending chains. -/
theorem euclid_terminates (E : EuclideanSystem) (a b : E.Carrier) : ∃ g, EuclidRun E a b g := by
  induction a using E.wellFounded.induction generalizing b with
  | h a ih =>
    by_cases ha : a = E.zero
    · rw [ha]
      exact ⟨b, EuclidRun.done b⟩
    · cases ih (E.rem b a) (E.remainder_smaller ha) a with
      | intro g run => exact ⟨g, EuclidRun.step a b g ha run⟩`;

export const prelude = [system, commonDivisor, mutuallyDivides, isGCD, euclidRun, euclidCorrect, terminates].join('\n\n');

export const definitions: Definition[] = [
  { name: 'EuclideanSystem', source: system },
  { name: 'CommonDivisor', source: commonDivisor },
  { name: 'MutuallyDivides', source: mutuallyDivides },
  { name: 'IsGCD', source: isGCD },
  { name: 'EuclidRun', source: euclidRun },
  { name: 'EuclidCorrect', source: euclidCorrect },
  { name: 'euclid_terminates', source: terminates },
];

const level = (l: Omit<Level, 'chapter' | 'revision'>): Level => ({ ...l, chapter: 'euclid', revision: 1 });

export const levels: Level[] = [
  level({
    id: 'euclid.gcd_agree',
    title: 'Two answers agree',
    prerequisites: [],
    intro: 'If g and h both fit the definition of a gcd of a and b, each divides the other. Use the greatest part of one with the common part of the other.',
    theoremName: 'gcd_agree',
    header: `theorem gcd_agree (E : EuclideanSystem) (g h a b : E.Carrier)
    (hg : IsGCD E g a b) (hh : IsGCD E h a b) : MutuallyDivides E g h := by`,
    policy: { tactics: ['unfold', 'constructor', 'apply', 'exact'], facts: [] },
    solution: [
      unfold(['MutuallyDivides']),
      split(constructor, [apply('hh.greatest'), exact('hg.common')], [apply('hg.greatest'), exact('hh.common')]),
    ],
  }),
  level({
    id: 'euclid.gcd_zero',
    title: 'When to stop',
    prerequisites: ['euclid.gcd_agree'],
    intro: 'The algorithm stops when the first number is zero and answers with the second. Check that this answer is right.',
    theoremName: 'gcd_zero',
    header: 'theorem gcd_zero (E : EuclideanSystem) (b : E.Carrier) : IsGCD E b E.zero b := by',
    policy: { tactics: ['constructor', 'unfold', 'apply', 'intro', 'cases', 'assumption'], facts: [] },
    library: [
      { name: 'E.divides_zero', statement: '(d) : E.divides d E.zero' },
      { name: 'E.divides_refl', statement: '(d) : E.divides d d' },
    ],
    solution: [
      split(
        constructor,
        [unfold(['CommonDivisor']), split(constructor, [apply('E.divides_zero')], [apply('E.divides_refl')])],
        [intro('d', 'hd'), unfold(['CommonDivisor'], 'hd'), casesAnd('hd', 'h0', 'hb', [assumption])],
      ),
    ],
  }),
  level({
    id: 'euclid.common_step',
    title: 'A step keeps the divisors',
    prerequisites: ['euclid.gcd_zero'],
    intro: 'd divides a and b exactly when it divides b mod a and a. This is why each step of the algorithm is safe.',
    theoremName: 'common_step',
    header: `theorem common_step (E : EuclideanSystem) (d a b : E.Carrier) :
    CommonDivisor E d a b ↔ CommonDivisor E d (E.rem b a) a := by`,
    policy: { tactics: ['unfold', 'constructor', 'intro', 'cases', 'rw', 'assumption'], facts: [] },
    library: [{ name: 'E.divides_rem_iff', statement: '(h : E.divides d a) : E.divides d (E.rem b a) ↔ E.divides d b' }],
    solution: [
      unfold(['CommonDivisor']),
      split(
        constructor,
        [intro('h'), casesAnd('h', 'hda', 'hdb', [split(constructor, [rw('E.divides_rem_iff hda'), assumption], [assumption])])],
        [intro('h'), casesAnd('h', 'hdr', 'hda', [split(constructor, [assumption], [rw('← E.divides_rem_iff hda'), assumption])])],
      ),
    ],
  }),
  level({
    id: 'euclid.gcd_step',
    title: 'A step keeps the gcd',
    prerequisites: ['euclid.common_step'],
    intro: 'Same common divisors means same gcd. Rewrite with common_step, in whichever direction the goal needs.',
    theoremName: 'gcd_step',
    header: `theorem gcd_step (E : EuclideanSystem) (g a b : E.Carrier) :
    IsGCD E g a b ↔ IsGCD E g (E.rem b a) a := by`,
    policy: { tactics: ['constructor', 'intro', 'apply', 'rw', 'exact'], facts: 'all' },
    solution: [
      split(
        constructor,
        [
          intro('hg'),
          split(
            constructor,
            [rw('← common_step'), exact('hg.common')],
            [intro('d', 'hd'), apply('hg.greatest'), rw('common_step'), exact('hd')],
          ),
        ],
        [
          intro('hg'),
          split(
            constructor,
            [rw('common_step'), exact('hg.common')],
            [intro('d', 'hd'), apply('hg.greatest'), rw('← common_step'), exact('hd')],
          ),
        ],
      ),
    ],
  }),
  level({
    id: 'euclid.sound',
    title: 'Every run is right',
    prerequisites: ['euclid.gcd_step'],
    intro: 'Induction on the run: one case for stopping, one for taking a step.',
    theoremName: 'euclid_sound',
    header: 'theorem euclid_sound (E : EuclideanSystem) (a b g : E.Carrier) (run : EuclidRun E a b g) : IsGCD E g a b := by',
    policy: { tactics: ['induction', 'apply', 'rw', 'exact'], facts: 'all' },
    solution: [
      byCases('induction', 'run', [
        ['done', ['b'], [apply('gcd_zero')]],
        ['step', ['a', 'b', 'g', 'ha', 'next', 'ih'], [rw('gcd_step'), exact('ih')]],
      ]),
    ],
  }),
  level({
    id: 'euclid.agree',
    title: 'Every run gives the same answer',
    prerequisites: ['euclid.sound'],
    intro: 'Two runs from the same start give answers that divide each other. apply gcd_agree needs to be told a and b: gcd_agree E g h a b.',
    theoremName: 'euclid_agree',
    header: `theorem euclid_agree (E : EuclideanSystem) (a b g h : E.Carrier)
    (r1 : EuclidRun E a b g) (r2 : EuclidRun E a b h) : MutuallyDivides E g h := by`,
    policy: { tactics: ['apply', 'exact'], facts: 'all' },
    solution: [split(apply('gcd_agree E g h a b'), [apply('euclid_sound'), exact('r1')], [apply('euclid_sound'), exact('r2')])],
  }),
  level({
    id: 'euclid.correct',
    title: 'Euclid is correct',
    prerequisites: ['euclid.agree'],
    intro: 'It stops, its answer is a gcd, and any two answers agree. You have all three.',
    theoremName: 'euclid_correct',
    header: 'theorem euclid_correct (E : EuclideanSystem) : EuclidCorrect E := by',
    policy: { tactics: ['constructor', 'apply'], facts: 'all' },
    library: [{ name: 'euclid_terminates', statement: '(E : EuclideanSystem) (a b : E.Carrier) : ∃ g, EuclidRun E a b g' }],
    solution: [split(constructor, [apply('euclid_terminates')], [apply('euclid_sound')], [apply('euclid_agree')])],
  }),
];

export const tutorials: Tutorial[] = [
  {
    id: 'tutorial.euclid',
    before: 'euclid.gcd_agree',
    title: "Euclid's algorithm",
    blocks: [
      {
        text: 'To find the greatest common divisor of a and b: if a is zero, the answer is b. If not, replace the pair (a, b) with (b mod a, a) and go again.',
      },
      { code: '(12, 18) → (6, 12) → (0, 6)   -- answer: 6' },
      {
        text: "This chapter proves that the algorithm works. It doesn't build division out of `Natural`. Instead, `EuclideanSystem` lists what the algorithm relies on: a zero, a remainder, divisibility, and a notion of smaller that remainders always respect. Any number system with those works.",
      },
      {
        text: '`IsGCD E g a b` says g divides both a and b, and every other common divisor divides g. That can be true of more than one g (in the integers, 6 and −6), so the most you can say about two of them is that each divides the other.',
      },
    ],
    definitions: ['EuclideanSystem', 'CommonDivisor', 'IsGCD', 'MutuallyDivides'],
  },
  {
    id: 'tutorial.euclid_step',
    before: 'euclid.common_step',
    title: 'Why a step is safe',
    blocks: [
      {
        text: 'Anything that divides a and b also divides b mod a, and the other way round. So a step of the algorithm never changes the common divisors, and so never changes the answer.',
      },
      { text: '`E.divides_rem_iff h`, for `h : E.divides d a`, says that d divides b mod a if and only if d divides b.' },
      { text: 'You can rewrite with an ↔ just like an =. It swaps one statement for the other.' },
    ],
  },
  {
    id: 'tutorial.runs',
    before: 'euclid.sound',
    title: 'Runs of the algorithm',
    blocks: [
      {
        text: '`EuclidRun E a b g` means: start from (a, b) and the algorithm finishes with g. There are two ways to build one, matching the two things the algorithm can do.',
      },
      { code: euclidRun },
      {
        text: '`induction run` follows the algorithm. In the done case you check the answer when it stops. In the step case you get `ih`, saying the rest of the run was right, and you show this step keeps it right. As with numbers, start each case with rename_i to name what it gives you.',
      },
      {
        aside: 'That every run actually stops is `euclid_terminates`, which is given. Its proof uses a kind of induction this game does not cover yet. You can read it in the definitions list.',
      },
    ],
    definitions: ['EuclidRun', 'EuclidCorrect', 'euclid_terminates'],
  },
];
