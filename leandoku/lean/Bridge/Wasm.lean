/-
  Entry points for the WebAssembly build. `wasm/glue.c` calls these after
  Lean's runtime and this module are initialized; the browser worker calls
  the glue. The library files are written to the in-memory file system at
  `<sysroot>/lib/lean` before `leandoku_setup` runs.
-/
import Bridge.Server

namespace Bridge.Wasm

@[export leandoku_setup]
unsafe def setupExport (sysroot : String) : IO Unit :=
  Bridge.setup sysroot

@[export leandoku_handle]
def handleExport (line : String) : IO String :=
  Bridge.handleLine line

end Bridge.Wasm
