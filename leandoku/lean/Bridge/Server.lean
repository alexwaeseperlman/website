/-
  One request in, one response out, as JSON text. Shared by the native
  executable (`Main.lean`) and the WebAssembly build (`Bridge/Wasm.lean`).
-/
import Lean
import Bridge.Protocol
import Bridge.Check

namespace Bridge
open Lean

def handleLine (line : String) : IO String := do
  let out : Json ← match Json.parse line >>= fromJson? (α := CheckRequest) with
    | .error e => pure (Json.mkObj [("error", s!"bad request: {e}")])
    | .ok req =>
      if req.version != protocolVersion then
        pure (Json.mkObj [("requestId", req.requestId),
          ("error", s!"protocol version {req.version}, bridge speaks {protocolVersion}")])
      else
        try
          pure (toJson (← check req))
        catch e =>
          pure (Json.mkObj [("requestId", req.requestId), ("error", toString e)])
  return out.compress

/-- Point Lean at `<sysroot>/lib/lean`, where `Init` and the other `.olean` files live. -/
unsafe def setup (sysroot : System.FilePath) : IO Unit := do
  Lean.initSearchPath sysroot
  Lean.enableInitializersExecution

end Bridge
