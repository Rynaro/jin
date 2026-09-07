/**
 * lib/notes/codeChrome.ts — reading-view code-block dynamic header.
 *
 * Exports decorateCodeBlocks(root), which iterates every <pre> in the given
 * ParentNode and wraps it in a <figure class="code-block"> with a header
 * containing a language badge, a soft-wrap toggle, and a copy button.
 *
 * Security constraints (G-CHOKEPOINT / G-CODE-HEADER-INERT):
 *   - This module MUST NOT import markdown-it, dompurify, or highlight.js.
 *   - All DOM construction uses document.createElement + .textContent ONLY —
 *     never innerHTML of any user-supplied content.
 *   - Event listeners are attached via addEventListener (no on* attributes).
 *   - Icons use <i data-lucide="…"> (not inline SVG); Lucide's createIcons
 *     hydrates them in the live DOM after the fragment is inserted (initIcons()
 *     in editor.ts), keeping the DocumentFragment assertInert-clean.
 *
 * Structure produced per <pre> block:
 *
 *   <figure class="code-block">
 *     <div class="code-block__header">
 *       <span class="code-block__lang">python</span>   ← only when a language is known
 *       <button class="code-block__wrap" aria-label="Toggle soft wrap" aria-pressed="false">
 *         <i data-lucide="wrap-text"></i>
 *       </button>
 *       <button class="code-block__copy" aria-label="Copy code">
 *         <i data-lucide="copy"></i>
 *       </button>
 *     </div>
 *     <pre>…</pre>
 *   </figure>
 */

/**
 * decorateCodeBlocks — wrap every <pre> in root with the code-block chrome.
 *
 * @param root  The already-sanitized ParentNode (DocumentFragment or Element)
 *              returned by renderMarkdownFragment. Called POST-DOMPurify so
 *              the nodes are safe; any DOM we add here is app-constructed and
 *              sanitizer-safe by construction.
 */
export function decorateCodeBlocks(root: ParentNode): void {
  // Snapshot the list first — we will be moving nodes while iterating.
  const preElements = Array.from(root.querySelectorAll('pre'));

  for (const pre of preElements) {
    const codeEl = pre.querySelector('code');

    // ── Derive language from the <code> element's class ────────────────────
    // markdown-it / hljs produce classes like "language-js" or "hljs language-js".
    let lang = '';
    if (codeEl) {
      const langClass = Array.from(codeEl.classList).find(c => c.startsWith('language-'));
      if (langClass) {
        lang = langClass.slice('language-'.length);
      }
    }

    // ── Capture plain code text (hljs spans do not alter textContent) ──────
    // Strip a single trailing newline — markdown-it fence rules append one.
    const rawText = codeEl?.textContent ?? pre.textContent ?? '';
    const codeText = rawText.endsWith('\n') ? rawText.slice(0, -1) : rawText;

    // ── Build the figure wrapper ────────────────────────────────────────────
    const figure = document.createElement('figure');
    figure.className = 'code-block';

    // ── Build the header ────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'code-block__header';

    // Language badge (omitted when no fence language was declared)
    if (lang) {
      const badge = document.createElement('span');
      badge.className = 'code-block__lang';
      badge.textContent = lang;
      header.appendChild(badge);
    }

    // Soft-wrap toggle button
    const wrapBtn = document.createElement('button');
    wrapBtn.className = 'code-block__wrap';
    wrapBtn.setAttribute('type', 'button');
    wrapBtn.setAttribute('aria-label', 'Toggle soft wrap');
    wrapBtn.setAttribute('title', 'Toggle soft wrap');
    wrapBtn.setAttribute('aria-pressed', 'false');
    const wrapIcon = document.createElement('i');
    wrapIcon.setAttribute('data-lucide', 'wrap-text');
    wrapBtn.appendChild(wrapIcon);
    header.appendChild(wrapBtn);

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'code-block__copy';
    copyBtn.setAttribute('type', 'button');
    copyBtn.setAttribute('aria-label', 'Copy code');
    copyBtn.setAttribute('title', 'Copy code');
    const copyIcon = document.createElement('i');
    copyIcon.setAttribute('data-lucide', 'copy');
    copyBtn.appendChild(copyIcon);
    header.appendChild(copyBtn);

    // ── Assemble: insert figure before <pre>, move <pre> inside ────────────
    // pre.parentNode is guaranteed non-null here (it is a child of root or a
    // descendant of root after DOMPurify serialisation).
    pre.parentNode!.insertBefore(figure, pre);
    figure.appendChild(header);
    figure.appendChild(pre);

    // ── Event listeners ─────────────────────────────────────────────────────

    // Soft-wrap toggle: toggles .is-wrapped on the figure + flips aria-pressed
    wrapBtn.addEventListener('click', () => {
      const isWrapped = figure.classList.toggle('is-wrapped');
      wrapBtn.setAttribute('aria-pressed', String(isWrapped));
    });

    // Copy: writes captured code text to clipboard (user-gesture → OK for writeText)
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(codeText).catch(() => {
        // Clipboard unavailable; surface a transient accessible label + tooltip.
        const originalLabel = copyBtn.getAttribute('aria-label') ?? 'Copy code';
        copyBtn.setAttribute('aria-label', 'Copy unavailable');
        copyBtn.setAttribute('title', 'Copy unavailable');
        setTimeout(() => {
          copyBtn.setAttribute('aria-label', originalLabel);
          copyBtn.setAttribute('title', originalLabel);
        }, 2000);
      });
    });
  }
}
