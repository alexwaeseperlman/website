import type { Chapter, Definition, Level, LibraryFact, Tutorial } from '../../src/core/course/types';
import { apply, constructor, intro, rw, split, unfold } from '../script';

export const chapter: Chapter = {
  id: 'groups',
  title: 'Groups',
  blurb: 'Five rules about multiplication, and what follows from them: unique inverses, maps between groups, and kernels.',
};

const group = `/-- A type with a multiplication, a unit and inverses, following five rules. -/
structure Group where
  Carrier : Type
  one : Carrier
  mul : Carrier → Carrier → Carrier
  inv : Carrier → Carrier
  assoc : ∀ a b c, mul (mul a b) c = mul a (mul b c)
  one_mul : ∀ a, mul one a = a
  mul_one : ∀ a, mul a one = a
  inv_mul : ∀ a, mul (inv a) a = one
  mul_inv : ∀ a, mul a (inv a) = one`;

const groupHom = `/-- A function between groups that respects multiplication and one. -/
structure GroupHom (G H : Group) where
  toFun : G.Carrier → H.Carrier
  map_mul : ∀ x y, toFun (G.mul x y) = H.mul (toFun x) (toFun y)
  map_one : toFun G.one = H.one`;

const kernel = `/-- Everything F sends to one. -/
def kernel {G H : Group} (F : GroupHom G H) (x : G.Carrier) : Prop := F.toFun x = H.one`;

const subgroupLaws = `structure SubgroupLaws (G : Group) (S : G.Carrier → Prop) : Prop where
  one_mem : S G.one
  mul_mem : ∀ x y, S x → S y → S (G.mul x y)
  inv_mem : ∀ x, S x → S (G.inv x)`;

const normalLaws = `structure NormalSubgroupLaws (G : Group) (S : G.Carrier → Prop) : Prop
    extends SubgroupLaws G S where
  conj_mem : ∀ a x, S x → S (G.mul (G.mul a x) (G.inv a))`;

export const prelude = [group, groupHom, kernel, subgroupLaws, normalLaws].join('\n\n');

export const definitions: Definition[] = [
  { name: 'Group', source: group },
  { name: 'GroupHom', source: groupHom },
  { name: 'kernel', source: kernel },
  { name: 'SubgroupLaws', source: subgroupLaws },
  { name: 'NormalSubgroupLaws', source: normalLaws },
];

/** The group rules, as the pickers offer them. */
const rulesOf = (g: string): LibraryFact[] => [
  { name: `${g}.assoc`, statement: `(a b c) : ${g}.mul (${g}.mul a b) c = ${g}.mul a (${g}.mul b c)` },
  { name: `${g}.one_mul`, statement: `(a) : ${g}.mul ${g}.one a = a` },
  { name: `${g}.mul_one`, statement: `(a) : ${g}.mul a ${g}.one = a` },
  { name: `${g}.inv_mul`, statement: `(a) : ${g}.mul (${g}.inv a) a = ${g}.one` },
  { name: `${g}.mul_inv`, statement: `(a) : ${g}.mul a (${g}.inv a) = ${g}.one` },
];
const homRules: LibraryFact[] = [
  { name: 'F.map_mul', statement: '(x y) : F.toFun (G.mul x y) = H.mul (F.toFun x) (F.toFun y)' },
  { name: 'F.map_one', statement: ': F.toFun G.one = H.one' },
];

const level = (l: Omit<Level, 'chapter' | 'revision'>): Level => ({ ...l, chapter: 'groups', revision: 1 });

export const levels: Level[] = [
  level({
    id: 'groups.inv_unique',
    title: 'Inverses are unique',
    prerequisites: [],
    intro: 'If a times b is one, then b has to be the inverse of a. Five rewrites, following the chain in the tutorial.',
    theoremName: 'inv_unique',
    header: 'theorem inv_unique (G : Group) (a b : G.Carrier) (h : G.mul a b = G.one) : b = G.inv a := by',
    policy: { tactics: ['rw'], facts: 'all' },
    library: rulesOf('G'),
    solution: [rw('← G.one_mul b', '← G.inv_mul a', 'G.assoc', 'h', 'G.mul_one')],
  }),
  level({
    id: 'groups.inv_one',
    title: 'The inverse of one',
    prerequisites: ['groups.inv_unique'],
    intro: 'One times one is one, so by the last level one is its own inverse. The sides are the wrong way round for inv_unique, so flip them first with Eq.symm.',
    theoremName: 'inv_one',
    header: 'theorem inv_one (G : Group) : G.inv G.one = G.one := by',
    policy: { tactics: ['apply', 'rw'], facts: 'all' },
    library: [{ name: 'Eq.symm', statement: '(h : a = b) : b = a' }, ...rulesOf('G')],
    solution: [apply('Eq.symm'), apply('inv_unique'), rw('G.mul_one')],
  }),
  level({
    id: 'groups.hom_inv',
    title: 'Maps keep inverses',
    prerequisites: ['groups.inv_unique'],
    intro: 'F sends the inverse of a to the inverse of F a. Start with apply inv_unique.',
    theoremName: 'hom_inv',
    header: 'theorem hom_inv (G H : Group) (F : GroupHom G H) (a : G.Carrier) : F.toFun (G.inv a) = H.inv (F.toFun a) := by',
    policy: { tactics: ['apply', 'rw'], facts: 'all' },
    library: [...homRules, ...rulesOf('G'), ...rulesOf('H')],
    solution: [apply('inv_unique'), rw('← F.map_mul', 'G.mul_inv', 'F.map_one')],
  }),
  level({
    id: 'groups.kernel_subgroup',
    title: 'The kernel is a subgroup',
    prerequisites: ['groups.inv_one', 'groups.hom_inv'],
    intro: 'Three things to check. In each, unfold kernel wherever it appears, then rewrite.',
    theoremName: 'kernel_subgroup',
    header: 'theorem kernel_subgroup (G H : Group) (F : GroupHom G H) : SubgroupLaws G (kernel F) := by',
    policy: { tactics: ['constructor', 'intro', 'unfold', 'rw'], facts: 'all' },
    library: [...homRules, ...rulesOf('H')],
    solution: [
      split(
        constructor,
        [unfold(['kernel']), rw('F.map_one')],
        [intro('x', 'y', 'hx', 'hy'), unfold(['kernel'], 'hx'), unfold(['kernel'], 'hy'), unfold(['kernel']), rw('F.map_mul', 'hx', 'hy', 'H.one_mul')],
        [intro('x', 'hx'), unfold(['kernel'], 'hx'), unfold(['kernel']), rw('hom_inv', 'hx', 'inv_one')],
      ),
    ],
  }),
  level({
    id: 'groups.kernel_normal',
    title: 'The kernel is normal',
    prerequisites: ['groups.kernel_subgroup'],
    intro: 'A normal subgroup is a subgroup that also contains a·x·a⁻¹ whenever it contains x. You already have the first part.',
    theoremName: 'kernel_normal',
    header: 'theorem kernel_normal (G H : Group) (F : GroupHom G H) : NormalSubgroupLaws G (kernel F) := by',
    policy: { tactics: ['constructor', 'intro', 'unfold', 'apply', 'rw'], facts: 'all' },
    library: [...homRules, ...rulesOf('H')],
    solution: [
      split(
        constructor,
        [apply('kernel_subgroup')],
        [intro('a', 'x', 'hx'), unfold(['kernel'], 'hx'), unfold(['kernel']), rw('F.map_mul', 'F.map_mul', 'hx', 'H.mul_one', 'hom_inv', 'H.mul_inv')],
      ),
    ],
  }),
];

export const tutorials: Tutorial[] = [
  {
    id: 'tutorial.groups',
    before: 'groups.inv_unique',
    title: 'Groups',
    blocks: [
      {
        text: 'A group is a type with a way to multiply, an element called one, and an inverse for every element, following five rules. In Lean it is a structure. `G.mul a b` is a times b, and `G.inv a` is the inverse of a.',
      },
      { text: 'The rules are part of G, so `G.assoc`, `G.one_mul` and the others are equations you can rewrite with.' },
      {
        text: "The first level shows that a has only one inverse. On paper, if a·b = 1, then b = 1·b = (a⁻¹·a)·b = a⁻¹·(a·b) = a⁻¹·1 = a⁻¹. Each equals sign is one rewrite.",
      },
      { aside: 'Most of those rewrites go backwards, putting something in rather than taking it out. `← G.one_mul b` turns b into one times b.' },
    ],
    definitions: ['Group'],
  },
  {
    id: 'tutorial.group_maps',
    before: 'groups.hom_inv',
    title: 'Maps between groups',
    blocks: [
      { text: 'A `GroupHom G H` is a function from G to H that respects multiplication and sends one to one. `F.toFun x` is F applied to x.' },
      {
        text: "It says nothing about inverses, and it doesn't have to. Inverses are unique, so to show `F.toFun (G.inv a)` is the inverse of `F.toFun a`, it's enough to show their product is one. That's what `apply inv_unique` leaves you with.",
      },
    ],
    definitions: ['GroupHom'],
  },
  {
    id: 'tutorial.kernel',
    before: 'groups.kernel_subgroup',
    title: 'The kernel',
    blocks: [
      { text: 'The kernel of F is everything F sends to one. `kernel F x` is the statement `F.toFun x = H.one`.' },
      {
        text: '`SubgroupLaws` asks for three things: one is in it, a product of two members is a member, and the inverse of a member is a member. `constructor` gives you a goal for each.',
      },
      { text: '`unfold kernel` turns membership into the plain equation so you can rewrite. Pick a hypothesis under "where" to unfold it there instead.' },
    ],
    definitions: ['kernel', 'SubgroupLaws', 'NormalSubgroupLaws'],
  },
];
