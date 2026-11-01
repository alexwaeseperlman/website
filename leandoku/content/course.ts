import type { Course } from '../src/core/course/types';
import type { Definition } from '../src/core/course/types';
import * as equality from './chapters/equality';
import * as euclid from './chapters/euclid';
import * as groups from './chapters/groups';
import * as linear from './chapters/linear';
import * as logic from './chapters/logic';
import * as maps from './chapters/maps';
import * as naturals from './chapters/naturals';

/**
 * The whole game. Each chapter file exports its `chapter`, `levels` and
 * `tutorials`, and may export a `prelude` (Lean definitions its levels need)
 * with matching `definitions`. This file puts them in order and joins the
 * preludes after the shared one, so a chapter can use definitions from any
 * chapter before it.
 */
interface ChapterModule {
  chapter: Course['chapters'][number];
  levels: Course['levels'];
  tutorials: Course['tutorials'];
  prelude?: string;
  definitions?: Definition[];
}

const chapters: ChapterModule[] = [naturals, logic, equality, maps, groups, euclid, linear];

const basePrelude = `set_option autoImplicit false

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

const prelude = [basePrelude, ...chapters.flatMap((c) => (c.prelude ? [c.prelude] : []))].join('\n\n');

const definitions: Definition[] = [
  {
    name: 'Natural',
    source: `inductive Natural where
  | zero : Natural
  | succ : Natural → Natural`,
  },
  {
    name: 'Natural.add',
    source: `def add : Natural → Natural → Natural
  | n, zero => n
  | n, succ m => succ (add n m)

instance : Add Natural := ⟨add⟩  -- so a + b means add a b`,
  },
];

export const course: Course = {
  id: 'proof-paths',
  title: 'Proof Paths',
  prelude,
  definitions: [...definitions, ...chapters.flatMap((c) => c.definitions ?? [])],
  chapters: chapters.map((c) => c.chapter),
  levels: chapters.flatMap((c) => c.levels),
  tutorials: chapters.flatMap((c) => c.tutorials),
};
