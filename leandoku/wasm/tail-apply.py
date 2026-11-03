#!/usr/bin/env python3
"""
Rewrite Lean's src/runtime/apply.cpp so closure calls are tail calls.

  wasm/tail-apply.py <lean4 source dir>

`lean_apply_N` calls the closure's function and only then frees the closure,
so the call is not in tail position and every closure call leaves a
`lean_apply_N` frame on the stack. Lean code calls closures constantly, and
Safari gives WebAssembly a small stack, so these frames are a large share of
what overflows it. Here each call copies the closure's arguments out, releases
the closure, and then makes the call last, so with `-mtail-call` it compiles
to `return_call_indirect`. Releasing first is safe: the arguments are either
moved out of a closure we own (exclusive case) or have been retained.
"""
import re
import sys

path = f"{sys.argv[1]}/src/runtime/apply.cpp"
src = open(path).read()

call = re.compile(
    r"obj\* r = FN(\d+)\(f\)\(([^;]*)\); (lean_free_small_object\(f\)|lean_dec_ref\(f\)); return r;")

def rewrite(m: re.Match) -> str:
    n, args, release = m.group(1), m.group(2), m.group(3)
    copies = []
    def local(fx: re.Match) -> str:
        name = f"x{fx.group(1)}"
        copies.append(f"obj* {name} = fx({fx.group(1)});")
        return name
    args = re.sub(r"fx\((\d+)\)", local, args)
    return " ".join(copies + [f"fn{n} g = FN{n}(f);", f"{release};", f"return g({args});"])

out, count = call.subn(rewrite, src)
if count == 0 or "obj* r = FN" in out:
    sys.exit(f"tail-apply: unexpected apply.cpp ({count} calls rewritten)")
open(path, "w").write(out)
print(f"tail-apply: {count} closure calls rewritten")
