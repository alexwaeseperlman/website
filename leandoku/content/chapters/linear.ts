import type { Chapter, Definition, Level, Tutorial } from '../../src/core/course/types';
import { apply, assumption, constructor, exact, intro, rw, split, unfold } from '../script';

export const chapter: Chapter = {
  id: 'linear',
  title: 'Linear maps',
  blurb: 'Maps that keep zero, sums and scaling. Compose them, and pull subspaces back through them.',
};

const signature = `/-- A type with a zero, an addition, and scaling by K. -/
structure LinearSignature (K : Type) where
  Carrier : Type
  zero : Carrier
  add : Carrier → Carrier → Carrier
  smul : K → Carrier → Carrier`;

const isLinear = `structure IsLinear (K : Type) (V W : LinearSignature K) (f : V.Carrier → W.Carrier) : Prop where
  map_zero : f V.zero = W.zero
  map_add : ∀ x y, f (V.add x y) = W.add (f x) (f y)
  map_smul : ∀ a x, f (V.smul a x) = W.smul a (f x)`;

const subspaceLaws = `structure SubspaceLaws (K : Type) (V : LinearSignature K) (S : V.Carrier → Prop) : Prop where
  zero_mem : S V.zero
  add_mem : ∀ x y, S x → S y → S (V.add x y)
  smul_mem : ∀ a x, S x → S (V.smul a x)`;

const preimage = `/-- x is in the preimage when f x is in S. -/
def preimage {A B : Type} (f : A → B) (S : B → Prop) (x : A) : Prop := S (f x)`;

const inter = `/-- x is in the intersection when it is in every S i. -/
def inter {I A : Type} (S : I → A → Prop) (x : A) : Prop := ∀ i, S i x`;

export const prelude = [signature, isLinear, subspaceLaws, preimage, inter].join('\n\n');

export const definitions: Definition[] = [
  { name: 'LinearSignature', source: signature },
  { name: 'IsLinear', source: isLinear },
  { name: 'SubspaceLaws', source: subspaceLaws },
  { name: 'preimage', source: preimage },
  { name: 'inter', source: inter },
];

const level = (l: Omit<Level, 'chapter' | 'revision'>): Level => ({ ...l, chapter: 'linear', revision: 1 });

export const levels: Level[] = [
  level({
    id: 'linear.comp',
    title: 'Compose linear maps',
    prerequisites: [],
    intro: 'Doing f and then g keeps zero, sums and scaling, because each of them does. Three goals, each two rewrites once compose is unfolded.',
    theoremName: 'comp_linear',
    header: `theorem comp_linear (K : Type) (U V W : LinearSignature K)
    (f : U.Carrier → V.Carrier) (g : V.Carrier → W.Carrier)
    (hf : IsLinear K U V f) (hg : IsLinear K V W g) : IsLinear K U W (compose g f) := by`,
    policy: { tactics: ['constructor', 'intro', 'unfold', 'rw'], facts: [] },
    library: [
      { name: 'hf.map_zero', statement: ': f U.zero = V.zero' },
      { name: 'hf.map_add', statement: '(x y) : f (U.add x y) = V.add (f x) (f y)' },
      { name: 'hf.map_smul', statement: '(a x) : f (U.smul a x) = V.smul a (f x)' },
      { name: 'hg.map_zero', statement: ': g V.zero = W.zero' },
      { name: 'hg.map_add', statement: '(x y) : g (V.add x y) = W.add (g x) (g y)' },
      { name: 'hg.map_smul', statement: '(a x) : g (V.smul a x) = W.smul a (g x)' },
    ],
    solution: [
      split(
        constructor,
        [unfold(['compose']), rw('hf.map_zero', 'hg.map_zero')],
        [intro('x', 'y'), unfold(['compose']), rw('hf.map_add', 'hg.map_add')],
        [intro('a', 'x'), unfold(['compose']), rw('hf.map_smul', 'hg.map_smul')],
      ),
    ],
  }),
  level({
    id: 'linear.preimage',
    title: 'Pull a subspace back',
    prerequisites: ['linear.comp'],
    intro: 'If S is a subspace of W and f is linear, the points that f sends into S form a subspace of V. In each goal: unfold, rewrite with what f keeps, then use what S is closed under.',
    theoremName: 'preimage_subspace',
    header: `theorem preimage_subspace (K : Type) (V W : LinearSignature K) (f : V.Carrier → W.Carrier)
    (hf : IsLinear K V W f) (S : W.Carrier → Prop) (hS : SubspaceLaws K W S) :
    SubspaceLaws K V (preimage f S) := by`,
    policy: { tactics: ['constructor', 'intro', 'unfold', 'rw', 'apply', 'exact'], facts: [] },
    library: [
      { name: 'hf.map_zero', statement: ': f V.zero = W.zero' },
      { name: 'hf.map_add', statement: '(x y) : f (V.add x y) = W.add (f x) (f y)' },
      { name: 'hf.map_smul', statement: '(a x) : f (V.smul a x) = W.smul a (f x)' },
      { name: 'hS.zero_mem', statement: ': S W.zero' },
      { name: 'hS.add_mem', statement: '(x y) (hx : S x) (hy : S y) : S (W.add x y)' },
      { name: 'hS.smul_mem', statement: '(a x) (hx : S x) : S (W.smul a x)' },
    ],
    solution: [
      split(
        constructor,
        [unfold(['preimage']), rw('hf.map_zero'), exact('hS.zero_mem')],
        [intro('x', 'y', 'hx', 'hy'), unfold(['preimage']), rw('hf.map_add'), split(apply('hS.add_mem'), [exact('hx')], [exact('hy')])],
        [intro('a', 'x', 'hx'), unfold(['preimage']), rw('hf.map_smul'), apply('hS.smul_mem'), exact('hx')],
      ),
    ],
  }),
  level({
    id: 'linear.inter',
    title: 'Intersect any number of subspaces',
    prerequisites: ['linear.comp'],
    intro: 'S is a whole family of subspaces, one for each i, maybe infinitely many. Their intersection is a subspace too. Being in inter S means being in S i for every i, so intro i works on it.',
    theoremName: 'inter_subspace',
    header: `theorem inter_subspace (K I : Type) (V : LinearSignature K) (S : I → V.Carrier → Prop)
    (laws : ∀ i, SubspaceLaws K V (S i)) : SubspaceLaws K V (inter S) := by`,
    policy: { tactics: ['constructor', 'intro', 'apply', 'exact'], facts: [] },
    library: [
      { name: '(laws i).zero_mem', statement: ': S i V.zero' },
      { name: '(laws i).add_mem', statement: '(x y) (hx : S i x) (hy : S i y) : S i (V.add x y)' },
      { name: '(laws i).smul_mem', statement: '(a x) (hx : S i x) : S i (V.smul a x)' },
    ],
    solution: [
      split(
        constructor,
        [intro('i'), exact('(laws i).zero_mem')],
        [intro('x', 'y', 'hx', 'hy', 'i'), split(apply('(laws i).add_mem'), [exact('hx i')], [exact('hy i')])],
        [intro('a', 'x', 'hx', 'i'), apply('(laws i).smul_mem'), exact('hx i')],
      ),
    ],
  }),
  level({
    id: 'linear.pullback_family',
    title: 'Everything at once',
    prerequisites: ['linear.preimage', 'linear.inter'],
    intro: 'Take a family of subspaces of W, intersect them, and pull the result back through f then g. It is a subspace of U. No unfolding needed: the three earlier levels fit together.',
    theoremName: 'pullback_family',
    header: `theorem pullback_family (K I : Type) (U V W : LinearSignature K)
    (f : U.Carrier → V.Carrier) (g : V.Carrier → W.Carrier)
    (hf : IsLinear K U V f) (hg : IsLinear K V W g)
    (S : I → W.Carrier → Prop) (laws : ∀ i, SubspaceLaws K W (S i)) :
    SubspaceLaws K U (preimage (compose g f) (inter S)) := by`,
    policy: { tactics: ['apply', 'assumption'], facts: 'all' },
    solution: [
      split(apply('preimage_subspace'), [split(apply('comp_linear'), [assumption], [assumption])], [apply('inter_subspace'), assumption]),
    ],
  }),
];

export const tutorials: Tutorial[] = [
  {
    id: 'tutorial.linear',
    before: 'linear.comp',
    title: 'Linear maps',
    blocks: [
      {
        text: "`LinearSignature K` is a type with a zero, an addition, and a way to scale by things in K. That's all. None of the usual vector space rules are included, because none of these proofs need them.",
      },
      { text: '`IsLinear K V W f` says f keeps all three: f 0 = 0, f (x + y) = f x + f y, and f (a • x) = a • f x.' },
      {
        text: '`constructor` splits an `IsLinear` goal into those three. If you have `hf : IsLinear K V W f`, its three parts are `hf.map_zero`, `hf.map_add` and `hf.map_smul`, and you can rewrite with them.',
      },
    ],
    definitions: ['LinearSignature', 'IsLinear'],
  },
  {
    id: 'tutorial.subspaces',
    before: 'linear.preimage',
    title: 'Subspaces',
    blocks: [
      {
        text: 'Here a subspace is described by a statement S x, true for the points inside it. `SubspaceLaws` asks that zero is inside, and that adding or scaling points inside keeps you inside.',
      },
      { code: 'preimage f S x  means  S (f x)\ninter S x        means  ∀ i, S i x' },
      {
        text: 'To use a rule like `hS.add_mem`, apply it when the goal is S (something + something). It then asks you to show each of the two parts is in S.',
      },
    ],
    definitions: ['SubspaceLaws', 'preimage', 'inter'],
  },
];
