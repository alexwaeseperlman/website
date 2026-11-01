/-
  leandoku-bridge: reads one JSON request per line on stdin and writes one
  JSON response per line on stdout. The process stays alive between requests
  so the native engine pays Lean's startup cost once.
-/
import Bridge
open Lean

def handle (line : String) : IO Json := do
  match Json.parse line >>= fromJson? (α := Bridge.CheckRequest) with
  | .error e => pure (Json.mkObj [("error", s!"bad request: {e}")])
  | .ok req =>
    if req.version != Bridge.protocolVersion then
      pure (Json.mkObj [("requestId", req.requestId),
        ("error", s!"protocol version {req.version}, bridge speaks {Bridge.protocolVersion}")])
    else
      try
        pure (toJson (← Bridge.check req))
      catch e =>
        pure (Json.mkObj [("requestId", req.requestId), ("error", toString e)])

partial def loop (stdin : IO.FS.Stream) (stdout : IO.FS.Stream) : IO Unit := do
  let line ← stdin.getLine
  if line.isEmpty then return
  if line.trim.isEmpty then loop stdin stdout else
  let out ← handle line.trim
  stdout.putStrLn out.compress
  stdout.flush
  loop stdin stdout

unsafe def main : IO Unit := do
  -- LEAN_SYSROOT avoids shelling out to `lean --print-prefix` when lean is not on PATH.
  let sysroot ← match (← IO.getEnv "LEAN_SYSROOT") with
    | some dir => pure (System.FilePath.mk dir)
    | none => Lean.findSysroot
  Lean.initSearchPath sysroot
  Lean.enableInitializersExecution
  loop (← IO.getStdin) (← IO.getStdout)
