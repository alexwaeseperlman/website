import type { Chapter, Definition, Level, Tutorial } from '../../src/core/course/types';
import { apply, assumption, intro, rw, split, unfold } from '../script';

export const chapter: Chapter = {
  id: 'maps',
  needs: ['equality'], // compose
  title: 'Maps and products',
  blurb: 'Functions that respect an operation, whatever the operation is. Compose them, pair them up, then both.',
};

const isHom = `/-- f respects the operations: combine then map, or map then combine. -/
def IsHom {A B : Type} (opA : A → A → A) (opB : B → B → B) (f : A → B) : Prop :=
  ∀ x y, f (opA x y) = opB (f x) (f y)`;

const prodOp = `/-- Combine two pairs part by part. -/
def prodOp {A B : Type} (opA : A → A → A) (opB : B → B → B) (p q : A × B) : A × B :=
  (opA p.1 q.1, opB p.2 q.2)`;

const pairMap = `/-- Send x to the pair (f x, g x). -/
def pairMap {A B C : Type} (f : A → B) (g : A → C) (x : A) : B × C := (f x, g x)`;

export const prelude = [isHom, prodOp, pairMap].join('\n\n');

export const definitions: Definition[] = [
  { name: 'IsHom', source: isHom },
  { name: 'prodOp', source: prodOp },
  { name: 'pairMap', source: pairMap },
];

const level = (l: Omit<Level, 'chapter' | 'revision'>): Level => ({ ...l, chapter: 'maps', revision: 1 });

export const levels: Level[] = [
  level({
    id: 'maps.hom_comp',
    title: 'Compose two maps',
    prerequisites: [],
    intro: 'If f and g each respect the operations, so does doing f and then g.',
    theoremName: 'hom_comp',
    header: `theorem hom_comp (A B C : Type) (opA : A → A → A) (opB : B → B → B) (opC : C → C → C)
    (f : A → B) (g : B → C) (hf : IsHom opA opB f) (hg : IsHom opB opC g) :
    IsHom opA opC (compose g f) := by`,
    policy: { tactics: ['unfold', 'intro', 'rw'], facts: [] },
    solution: [unfold(['IsHom']), intro('x', 'y'), unfold(['compose']), rw('hf', 'hg')],
  }),
  level({
    id: 'maps.hom_pair',
    title: 'Pair two maps',
    prerequisites: ['maps.hom_comp'],
    intro: 'f and g start from the same place. Sending x to (f x, g x) respects the operations, with pairs combined part by part.',
    theoremName: 'hom_pair',
    header: `theorem hom_pair (A B C : Type) (opA : A → A → A) (opB : B → B → B) (opC : C → C → C)
    (f : A → B) (g : A → C) (hf : IsHom opA opB f) (hg : IsHom opA opC g) :
    IsHom opA (prodOp opB opC) (pairMap f g) := by`,
    policy: { tactics: ['unfold', 'intro', 'rw'], facts: [] },
    solution: [unfold(['IsHom']), intro('x', 'y'), unfold(['pairMap', 'prodOp']), rw('hf', 'hg')],
  }),
  level({
    id: 'maps.hom_fanout',
    title: 'Compose, then pair',
    prerequisites: ['maps.hom_pair'],
    intro:
      'Go from A to B with f, then split into C and D with g and h. Both earlier levels fit together here. apply hom_comp can\'t guess the operation on B from the goal, so name it: hom_comp (opB := opB).',
    theoremName: 'hom_fanout',
    header: `theorem hom_fanout (A B C D : Type) (opA : A → A → A) (opB : B → B → B) (opC : C → C → C)
    (opD : D → D → D) (f : A → B) (g : B → C) (h : B → D)
    (hf : IsHom opA opB f) (hg : IsHom opB opC g) (hh : IsHom opB opD h) :
    IsHom opA (prodOp opC opD) (compose (pairMap g h) f) := by`,
    policy: { tactics: ['apply', 'assumption'], facts: 'all' },
    solution: [...split(apply('hom_comp (opB := opB)'), [assumption], [...split(apply('hom_pair'), [assumption], [assumption])])],
  }),
];

export const tutorials: Tutorial[] = [
  {
    id: 'tutorial.operations',
    before: 'maps.hom_comp',
    title: 'An operation you can’t see inside',
    blocks: [
      {
        text: '`op : A → A → A` takes two things of type A and gives back one. It might be addition, or multiplication, or something else. The levels in this chapter never say which, so a proof can only use what the statement hands it.',
      },
      {
        text: '`IsHom opA opB f` says f respects the operations. Combining two things and then applying f gives the same answer as applying f to each and then combining.',
      },
      { code: isHom },
      {
        text: '`unfold IsHom` swaps the name for its definition. Then `intro x y` names the two inputs, and `rw [hf]` works the way it would for any equation.',
      },
    ],
    definitions: ['IsHom', 'compose'],
  },
  {
    id: 'tutorial.pairs',
    before: 'maps.hom_pair',
    title: 'Pairs',
    blocks: [
      { text: '`A × B` is the type of pairs `(a, b)` with `a : A` and `b : B`. If p is a pair, `p.1` is its first part and `p.2` its second.' },
      { text: '`pairMap f g` sends x to `(f x, g x)`. `prodOp opB opC` combines two pairs by using opB on the first parts and opC on the second.' },
      { code: 'prodOp opB opC (a, c) (b, d) = (opB a b, opC c d)' },
      { text: 'Once both are unfolded, each side of the goal is a pair, and each part is something `hf` or `hg` can rewrite.' },
    ],
    definitions: ['prodOp', 'pairMap'],
  },
];
