import type { Course } from '../src/core/course/types';
import * as naturals from './chapters/naturals';

/**
 * The whole game. Each chapter file exports its `chapter`, `levels` and
 * `tutorials`; this file only puts them in order and holds the Lean shared
 * by every level.
 */
const chapters = [naturals];

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

const definitions = [
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
  definitions,
  chapters: chapters.map((c) => c.chapter),
  levels: chapters.flatMap((c) => c.levels),
  tutorials: chapters.flatMap((c) => c.tutorials),
};
