// Reading views that print Markdown-authored content as plain preformatted text
// (e.g. the test-case detail page) must agree with the Markdown renderer about
// backslash escapes. Authors and AI tools often write `kyc\_failure\_reason`
// to stop intraword underscores becoming emphasis; a Markdown renderer shows
// that as `kyc_failure_reason`, so plain-text views must strip the backslashes
// too instead of printing them literally.

// CommonMark only allows escaping ASCII punctuation with a backslash. The class
// below covers the ASCII punctuation ranges `!`-`/`, `:`-`@`, `[`-`` ` ``, `{`-`~`.
const MARKDOWN_ESCAPE = /\\([!-/:-@[-`{-~])/g;

/** Remove CommonMark backslash escapes (e.g. `\_` → `_`) for plain-text views. */
export function unescapeMarkdown(value: string | null | undefined): string {
  if (!value) return value || '';
  return value.replace(MARKDOWN_ESCAPE, '$1');
}
