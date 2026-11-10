/**
 * The part of a Lean error that says what went wrong, on one line. Lean
 * follows it with a blank line and the goal it was working on, which the
 * proof state already shows.
 */
export function errorSummary(text: string): string {
  const head = text.split(/\n\s*\n/)[0] ?? text;
  return head.replace(/\s+/g, ' ').trim();
}

/** Whether the full message says more than its summary. */
export function hasMoreThanSummary(text: string): boolean {
  return text.replace(/\s+/g, ' ').trim() !== errorSummary(text);
}
