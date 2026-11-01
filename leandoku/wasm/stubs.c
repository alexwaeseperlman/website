/*
 * Lean 4.24's runtime does not define these networking primitives on
 * emscripten, but Std refers to them. Nothing in Leandoku uses sockets, so
 * they just fail the call with an IO error.
 */
#include <lean/lean.h>

static lean_object *unsupported(void) {
  return lean_io_result_mk_error(lean_mk_io_user_error(lean_mk_string("networking is not available in the browser")));
}

lean_object *lean_uv_tcp_wait_readable(lean_object *a, lean_object *w) { (void)a; (void)w; return unsupported(); }
lean_object *lean_uv_tcp_cancel_recv(lean_object *a, lean_object *w) { (void)a; (void)w; return unsupported(); }
lean_object *lean_uv_udp_wait_readable(lean_object *a, lean_object *w) { (void)a; (void)w; return unsupported(); }
lean_object *lean_uv_udp_cancel_recv(lean_object *a, lean_object *w) { (void)a; (void)w; return unsupported(); }
