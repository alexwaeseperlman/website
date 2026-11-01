/-
  leandoku-bridge: reads one JSON request per line on stdin and writes one
  JSON response per line on stdout. The process stays alive between requests
  so the native engine pays Lean's startup cost once.
-/
import Bridge
open Lean

partial def loop (stdin : IO.FS.Stream) (stdout : IO.FS.Stream) : IO Unit := do
  let line ← stdin.getLine
  if line.isEmpty then return
  if line.trim.isEmpty then loop stdin stdout else
  stdout.putStrLn (← Bridge.handleLine line.trim)
  stdout.flush
  loop stdin stdout

unsafe def main : IO Unit := do
  -- LEAN_SYSROOT avoids shelling out to `lean --print-prefix` when lean is not on PATH.
  let sysroot ← match (← IO.getEnv "LEAN_SYSROOT") with
    | some dir => pure (System.FilePath.mk dir)
    | none => Lean.findSysroot
  Bridge.setup sysroot
  loop (← IO.getStdin) (← IO.getStdout)
