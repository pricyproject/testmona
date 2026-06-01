import DOMPurify from 'dompurify';

// Rich-text content (requirement bodies, test-case descriptions, editor
// previews) is authored as HTML / rendered from Markdown and injected via
// `dangerouslySetInnerHTML`. Run every such string through DOMPurify first so
// stored or pasted content can never smuggle in scripts, event handlers, or
// `javascript:` URLs. DOMPurify is far more robust than a hand-rolled allowlist
// (it closes mutation-XSS and namespace-confusion holes a regex pass misses).

// Any link that opens in a new tab must also drop the opener reference to
// avoid reverse tabnabbing. We force this on every anchor with an href so
// user-authored links behave safely regardless of how they were written.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/**
 * Sanitize an HTML string for safe rendering via `dangerouslySetInnerHTML`.
 *
 * Restricted to the HTML profile (no inline SVG/MathML attack surface) while
 * still allowing the formatting the editors produce — headings, lists, task
 * lists (`data-*`), tables, code blocks, links, and base64 `data:` images.
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
