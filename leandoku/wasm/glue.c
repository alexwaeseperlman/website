/*
 * Browser entry points for the Leandoku bridge.
 *
 * The worker calls ld_start once (after writing the .olean files into the
 * in-memory file system), then ld_check for each request. Both return a
 * malloc'd UTF-8 string the caller frees with ld_free. Lean exceptions come
 * back as a JSON object with an "error" field; a trap aborts the module and
 * the worker reports the runtime as crashed.
 */
#include <lean/lean.h>
#include <emscripten.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>

extern lean_object *initialize_Bridge(uint8_t builtin, lean_object *w);
extern lean_object *leandoku_setup(lean_object *sysroot, lean_object *w);
extern lean_object *leandoku_handle(lean_object *line, lean_object *w);

static char *copy_out(const char *s) {
  size_t n = strlen(s);
  char *out = malloc(n + 1);
  memcpy(out, s, n + 1);
  return out;
}

static char *error_json(lean_object *res) {
  lean_object *err = lean_io_result_get_error(res);
  lean_inc(err); /* lean_io_error_to_string consumes its argument */
  lean_object *msg = lean_io_error_to_string(err);
  const char *text = lean_string_cstr(msg);
  /* Escape just enough for a JSON string: quotes, backslashes, control chars. */
  size_t n = strlen(text);
  char *buf = malloc(n * 6 + 32);
  char *p = buf;
  p += sprintf(p, "{\"error\":\"");
  for (const unsigned char *c = (const unsigned char *)text; *c; c++) {
    if (*c == '"' || *c == '\\') { *p++ = '\\'; *p++ = *c; }
    else if (*c < 0x20) p += sprintf(p, "\\u%04x", *c);
    else *p++ = *c;
  }
  p += sprintf(p, "\"}");
  *p = 0;
  lean_dec(msg);
  return buf;
}

EMSCRIPTEN_KEEPALIVE char *ld_start(const char *sysroot) {
  lean_initialize();
  lean_set_panic_messages(false);
  lean_object *res = initialize_Bridge(1 /* builtin */, lean_io_mk_world());
  lean_set_panic_messages(true);
  lean_io_mark_end_initialization();
  if (!lean_io_result_is_ok(res)) return error_json(res);
  lean_dec_ref(res);
  res = leandoku_setup(lean_mk_string(sysroot), lean_io_mk_world());
  if (!lean_io_result_is_ok(res)) return error_json(res);
  lean_dec_ref(res);
  return copy_out("{\"ok\":true}");
}

EMSCRIPTEN_KEEPALIVE char *ld_check(const char *request) {
  lean_object *res = leandoku_handle(lean_mk_string(request), lean_io_mk_world());
  if (!lean_io_result_is_ok(res)) return error_json(res);
  lean_object *s = lean_io_result_get_value(res);
  char *out = copy_out(lean_string_cstr(s));
  lean_dec_ref(res);
  return out;
}

EMSCRIPTEN_KEEPALIVE void ld_free(char *p) { free(p); }
