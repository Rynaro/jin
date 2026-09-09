/**
 * lib/notes/markdown.ts — single sanitize chokepoint for note-body markdown.
 *
 * THIS IS THE ONLY MODULE that may import markdown-it or dompurify.
 * No other module in jin-gui/src may import these libraries (enforced by G-CHOKEPOINT).
 *
 * Defense-in-depth chain:
 *   1. markdown-it html:false  → raw HTML in source is escaped to literal text (XSS by construction)
 *   2. markdown-it validateLink (default, kept) → [x](javascript:…) never becomes an anchor
 *   3. DOMPurify allow-list + ALLOWED_URI_REGEXP → strips anything that slips through
 *
 * The returned DocumentFragment MUST be inserted via appendChild/replaceChildren.
 * App code MUST NEVER assign innerHTML from user-supplied markdown.
 */

import MarkdownIt from 'markdown-it';
import DOMPurify, { type Config as DOMPurifyConfig } from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { decorateCodeBlocks } from './codeChrome';

// ── Highlight.js size guard ────────────────────────────────────────────────────
// Fenced code blocks larger than this byte threshold skip syntax highlighting
// (highlight() returns '' → markdown-it falls back to escapeHtml wrapping).
// This prevents the render thread from stalling on very large code blocks.
// Guard value: 50 000 characters (~50 KB), per D-LARGE-BLOCK / G-CODE-LARGE-SKIP.
const MAX_HIGHLIGHT_BYTES = 50_000;
const ASSET_REFERENCE_RE = /^jin-asset:\/\/sha256\/[a-f0-9]{64}$/;

// ── GFM task-list rule (inline, no extra dependency) ──────────────────────────
// markdown-it does NOT render GFM task lists by default, so `- [ ] foo` / `- [x] foo`
// would otherwise reach the reading view as the literal text "[ ] foo" / "[x] foo".
// This core rule (registered after the `inline` ruler so list structure + inline
// content are already tokenised) rewrites the leading "[ ] " / "[x] " marker of each
// list item into an inert checkbox <input>, and tags the <li> + parent list with
// classes the reading-view CSS styles (the "Jin" checkbox). Mirrors the well-trodden
// markdown-it-task-lists algorithm but inlined so the chokepoint keeps a single
// markdown dependency (G-CHOKEPOINT). The emitted <input> is `disabled` (reading view
// is read-only; the live-preview editor owns toggling) and survives DOMPurify because
// `input` + `type`/`checked`/`disabled`/`class` are already allow-listed below.

// markdown-it exposes its Token/StateCore types only via `export =` (no value-side
// namespace under bundler resolution), so we describe the slice we touch structurally.
// The real Token/StateCore are structurally richer, so they remain assignable here.
interface MdToken {
  type: string;
  level: number;
  content: string;
  children: MdToken[] | null;
  attrGet(name: string): string | null;
  attrJoin(name: string, value: string): void;
}
interface MdStateCore {
  tokens: MdToken[];
  Token: new (type: string, tag: string, nesting: -1 | 0 | 1) => MdToken;
}

/** Leading task marker: "[ ]", "[x]" or "[X]" followed by a space (incl. NBSP). */
const TASK_MARKER_RE = /^\[[ xX]\][  ]/;
/** Checked marker only ("[x]" / "[X]"). */
const TASK_CHECKED_RE = /^\[[xX]\][  ]/;

/** Build an inert checkbox token (raw html_inline; rendered verbatim, then sanitized). */
function makeCheckboxToken(state: MdStateCore, checked: boolean): MdToken {
  const token = new state.Token('html_inline', '', 0);
  token.content = checked
    ? '<input class="task-list-item-checkbox" type="checkbox" checked disabled>'
    : '<input class="task-list-item-checkbox" type="checkbox" disabled>';
  return token;
}

/** True when tokens[i] is the inline body of a list item whose text starts with a task marker. */
function isTaskItemInline(tokens: MdToken[], i: number): boolean {
  return (
    tokens[i].type === 'inline' &&
    i >= 2 &&
    tokens[i - 1].type === 'paragraph_open' &&
    tokens[i - 2].type === 'list_item_open' &&
    tokens[i].children !== null &&
    tokens[i].children!.length > 0 &&
    tokens[i].children![0].type === 'text' &&
    TASK_MARKER_RE.test(tokens[i].content)
  );
}

/** Find the enclosing list (bullet/ordered) open token for a list_item_open at index. */
function parentListOpen(tokens: MdToken[], itemOpenIndex: number): MdToken | null {
  const targetLevel = tokens[itemOpenIndex].level - 1;
  for (let j = itemOpenIndex - 1; j >= 0; j--) {
    const t = tokens[j];
    if (t.level === targetLevel && (t.type === 'bullet_list_open' || t.type === 'ordered_list_open')) {
      return t;
    }
  }
  return null;
}

/** markdown-it core rule: rewrite task-list markers into inert Jin checkboxes. */
function jinTaskListsRule(state: MdStateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (!isTaskItemInline(tokens, i)) continue;

    const inline = tokens[i];
    const checked = TASK_CHECKED_RE.test(inline.content);

    // Strip the marker from the aggregate content AND the leading text child so the
    // rendered label no longer shows "[x] ", then prepend the checkbox token.
    inline.content = inline.content.replace(TASK_MARKER_RE, '');
    inline.children![0].content = inline.children![0].content.replace(TASK_MARKER_RE, '');
    inline.children!.unshift(makeCheckboxToken(state, checked));

    // Tag the <li> (idempotent: attrJoin de-dups only across calls, so guard).
    const itemOpen = tokens[i - 2];
    if (!(itemOpen.attrGet('class') ?? '').includes('task-list-item')) {
      itemOpen.attrJoin('class', 'task-list-item');
    }

    // Tag the parent list so the CSS can drop bullets + left padding.
    const listOpen = parentListOpen(tokens, i - 2);
    if (listOpen && !(listOpen.attrGet('class') ?? '').includes('contains-task-list')) {
      listOpen.attrJoin('class', 'contains-task-list');
    }
  }
}

// ── markdown-it singleton (one instance, module-level) ────────────────────────

const md = new MarkdownIt({
  html: false,        // LOCKED: raw HTML in source → escaped literal text; XSS gate by construction
  linkify: true,      // autolink bare http/https/mailto URLs (linkify-it never autolinks javascript:)
  breaks: false,      // CommonMark default — single \n is NOT <br>
  typographer: false, // deterministic, source-faithful output (no smartquote mangling)
  /**
   * highlight — syntax-highlight fenced code blocks using highlight.js.
   *
   * Security constraints (R1-SANITIZER-VS-HIGHLIGHTER / G-CODE-HLJS-SANITIZE):
   *   - NEVER use highlightAuto (blindly runs all grammars → higher XSS surface).
   *   - hljs escapes HTML entities in code text before tokenising; combined with
   *     the existing DOMPurify pass that runs AFTER md.render(), a <script> in
   *     a code fence is entity-escaped by hljs AND then stripped by DOMPurify.
   *   - Returns '' for unknown/unsupported languages → markdown-it falls back to
   *     escapeHtml + plain <pre><code class="language-x"> wrapping.
   *   - Returns '' for blocks exceeding MAX_HIGHLIGHT_BYTES (perf guard).
   *   - DOMPurify config is UNCHANGED: ALLOWED_ATTR includes 'class', FORBID_ATTR
   *     includes 'style' → hljs-* CLASS spans survive; Shiki inline style= would
   *     be stripped (the decisive reason hljs is used instead of Shiki).
   *
   * Output: when the returned string starts with '<pre', markdown-it uses it
   * verbatim (no additional wrapping). The <pre class="hljs"> and the nested
   * <code class="hljs language-<lang>"> both carry 'class' attributes that
   * survive DOMPurify's allow-list.
   */
  highlight(code: string, lang: string): string {
    if (lang && code.length <= MAX_HIGHLIGHT_BYTES && hljs.getLanguage(lang)) {
      try {
        const highlighted = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        return `<pre class="hljs"><code class="hljs language-${lang}">${highlighted}</code></pre>`;
      } catch {
        // Grammar failed to tokenise — fall through to plain rendering
      }
    }
    // Empty string → markdown-it calls escapeHtml(code) + wraps in
    // <pre><code class="language-<lang>"> (plain, no hljs spans)
    return '';
  },
});
// markdown-it's DEFAULT validateLink (blocks javascript:/vbscript:/file:/data:) is KEPT — do NOT override.
// The one narrow extension is Jin's content-addressed attachment scheme. It
// is converted into an inert placeholder after sanitization below; it never
// becomes a network or filesystem URL in the DOM.
const defaultValidateLink = md.validateLink.bind(md);
md.validateLink = (url: string): boolean => ASSET_REFERENCE_RE.test(url) || defaultValidateLink(url);

// Register the GFM task-list rule after the inline ruler (list structure is already built).
md.core.ruler.after('inline', 'jin_task_lists', jinTaskListsRule);

// ── DOMPurify config (tight allow-list) ──────────────────────────────────────

const SANITIZE_CONFIG: DOMPurifyConfig = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr', 'blockquote', 'pre', 'code', 'span', 'div',
    'em', 'strong', 'del', 's', 'sub', 'sup',
    'ul', 'ol', 'li',
    'input',   // forward-compat: inert task-list checkbox (no on* survive)
    'a',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  ],
  ALLOWED_ATTR: ['href', 'title', 'class', 'type', 'checked', 'disabled'],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto|jin-asset):/i,
  // DOMPurify URI-checks `type` against ALLOWED_URI_REGEXP, which would strip
  // `type="checkbox"` (not a URI) from task-list <input>s. `type` is an enumerated
  // attribute, never a URI, so marking it URI-safe is sound and does NOT weaken the
  // href/src URI gate above (javascript:/data: hrefs are still stripped).
  ADD_URI_SAFE_ATTR: ['type'],
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'svg', 'math', 'link', 'meta', 'base'],
  FORBID_ATTR: ['style', 'srcset', 'formaction', 'xlink:href'],  // on* stripped by default
  RETURN_DOM_FRAGMENT: true,
  // img/video are intentionally NOT allowed. Locally-managed image/video
  // assets currently render as inert placeholders (no raw media loading).
};

/**
 * Replace the one allowlisted Jin asset URI with inert, app-owned DOM. This is
 * deliberately a placeholder, not an <img>/<video>: no user markdown can make
 * the renderer load arbitrary remote URLs, files, iframes, scripts, or codecs.
 * A future Tauri asset resolver may upgrade this exact element only after it
 * verifies the manifest hash and local MIME allow-list.
 */
function replaceAssetLinksWithPlaceholders(fragment: DocumentFragment): void {
  for (const anchor of fragment.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = anchor.getAttribute('href') ?? '';
    if (!ASSET_REFERENCE_RE.test(href)) continue;
    const hash = href.slice('jin-asset://sha256/'.length);
    const placeholder = document.createElement('span');
    placeholder.className = 'jin-asset-placeholder';
    placeholder.dataset.jinAssetHash = hash;
    const label = anchor.textContent?.trim() || `Attachment ${hash.slice(0, 12)}`;
    placeholder.dataset.jinAssetLabel = label;
    placeholder.setAttribute('role', 'img');
    placeholder.setAttribute('aria-label', `Locally managed attachment: ${label}`);
    placeholder.textContent = label;
    anchor.replaceWith(placeholder);
  }
  // markdown-it renders image syntax as <img>, which is deliberately excluded
  // from DOMPurify's allow-list.  Promote only a managed `jin-asset` image to
  // the same inert, app-owned placeholder before sanitization removes it.
  // No image element or user supplied src survives this chokepoint.
  for (const image of fragment.querySelectorAll<HTMLElement>('.jin-asset-image-source')) {
    const hash = image.dataset.jinAssetHash ?? '';
    if (!/^[a-f0-9]{64}$/.test(hash)) continue;
    const placeholder = document.createElement('span');
    placeholder.className = 'jin-asset-placeholder';
    placeholder.dataset.jinAssetHash = hash;
    const label = image.dataset.jinAssetLabel || `Attachment ${hash.slice(0, 12)}`;
    placeholder.dataset.jinAssetLabel = label;
    placeholder.setAttribute('role', 'img');
    placeholder.setAttribute('aria-label', `Locally managed attachment: ${label}`);
    placeholder.textContent = label;
    image.replaceWith(placeholder);
  }
}

/**
 * Convert only markdown-it's managed image output into inert spans *before*
 * sanitization. The parser output is detached and still sent through DOMPurify;
 * arbitrary raw HTML images remain forbidden.
 */
function promoteManagedImageMarkup(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const image of template.content.querySelectorAll<HTMLImageElement>('img[src]')) {
    const src = image.getAttribute('src') ?? '';
    if (!ASSET_REFERENCE_RE.test(src)) continue;
    const owned = document.createElement('span');
    owned.className = 'jin-asset-image-source';
    owned.dataset.jinAssetHash = src.slice('jin-asset://sha256/'.length);
    owned.dataset.jinAssetLabel = image.getAttribute('alt') || '';
    image.replaceWith(owned);
  }
  return template.innerHTML;
}

/**
 * Turn post-sanitization, app-owned attachment placeholders into images. This
 * deliberately accepts only the placeholder produced above and takes bytes
 * from a caller that has already verified the managed asset store. Markdown
 * itself can never supply a src, data URI, Blob URI, file path or remote URL.
 * Returns a revoker for every object URL created during this hydration pass.
 */
export async function hydrateManagedImages(
  root: ParentNode,
  resolve: (hash: string) => Promise<{ mime: string; bytes: number[] }>,
): Promise<() => void> {
  const objectUrls: string[] = [];
  const placeholders = Array.from(root.querySelectorAll<HTMLElement>('.jin-asset-placeholder[data-jin-asset-hash]'));
  await Promise.all(placeholders.map(async (placeholder) => {
    const hash = placeholder.dataset.jinAssetHash ?? '';
    if (!/^[a-f0-9]{64}$/.test(hash)) return;
    try {
      const asset = await resolve(hash);
      if (!matchesSafeImageMime(asset.mime) || !Array.isArray(asset.bytes)) return;
      const url = URL.createObjectURL(new Blob([new Uint8Array(asset.bytes)], { type: asset.mime }));
      if (!root.contains(placeholder)) {
        URL.revokeObjectURL(url);
        return;
      }
      objectUrls.push(url);
      const figure = document.createElement('figure');
      figure.className = 'jin-managed-image';
      const image = document.createElement('img');
      image.src = url;
      image.alt = placeholder.dataset.jinAssetLabel || 'Managed image';
      image.loading = 'lazy';
      figure.appendChild(image);
      placeholder.replaceWith(figure);
    } catch {
      // A missing, altered, or unsupported asset stays a plain inert placeholder.
    }
  }));
  return () => objectUrls.forEach((url) => URL.revokeObjectURL(url));
}

function matchesSafeImageMime(mime: string): boolean {
  return mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/gif' || mime === 'image/webp';
}

/** Add presentational hooks only after sanitization; no metadata is fetched. */
function decorateExternalLinks(fragment: DocumentFragment): void {
  for (const anchor of fragment.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = anchor.getAttribute('href') ?? '';
    if (!/^https?:\/\//i.test(href)) continue;
    let hostname = '';
    try { hostname = new URL(href).hostname.replace(/^www\./, ''); } catch { continue; }
    const label = (anchor.textContent ?? '').trim();
    if (label && label !== href) {
      anchor.classList.add('jin-inline-link');
      anchor.dataset.linkHost = hostname;
      const parent = anchor.parentElement;
      if (anchor.getAttribute('title') === 'jin-card' && parent?.tagName === 'P' && parent.childNodes.length === 1) {
        anchor.classList.remove('jin-inline-link');
        anchor.classList.add('jin-link-card');
        anchor.removeAttribute('title');
        parent.classList.add('jin-link-card-wrap');
      }
    } else {
      anchor.classList.add('jin-plain-link');
    }
  }
  for (const table of Array.from(fragment.querySelectorAll('table'))) {
    const wrap = document.createElement('div');
    wrap.className = 'jin-table-scroll';
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'Scrollable table');
    table.replaceWith(wrap);
    wrap.appendChild(table);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * renderMarkdownFragment — the SINGLE entry point for converting user markdown to DOM.
 *
 * Returns a sanitized DocumentFragment. Callers insert via appendChild/replaceChildren.
 * This function MUST NOT return an HTML string — callers must never assign innerHTML.
 *
 * @param src  Raw markdown source string (user-supplied note body)
 * @returns    A sanitized DocumentFragment safe to append to the document
 */
export function renderMarkdownFragment(src: string): DocumentFragment {
  const html = promoteManagedImageMarkup(md.render(src));
  // DOMPurify.sanitize with RETURN_DOM_FRAGMENT: true returns a DocumentFragment.
  // The cast is required because the overload for RETURN_DOM_FRAGMENT isn't always
  // narrowed by TypeScript's DOMPurify typings.
  const frag = DOMPurify.sanitize(html, SANITIZE_CONFIG) as unknown as DocumentFragment;
  replaceAssetLinksWithPlaceholders(frag);
  decorateExternalLinks(frag);
  // POST-sanitize: decorate <pre> blocks with the app-built code-block chrome
  // (copy button, language badge, soft-wrap toggle).  This runs AFTER DOMPurify
  // so we operate on already-sanitized nodes; the decoration itself uses only
  // document.createElement + textContent (no innerHTML) and is therefore safe
  // regardless (G-CODE-HEADER-INERT).  codeChrome.ts is the only home for this
  // logic — keeping markdown.ts's chokepoint purity intact (G-CHOKEPOINT).
  decorateCodeBlocks(frag);
  return frag;
}

/**
 * Exposed for the singleton guard test (G-CHOKEPOINT / K-B3).
 * Returns the single markdown-it instance — tests can confirm it is the same object
 * across calls, proving no second instance is created.
 */
export function _getMdInstance(): MarkdownIt {
  return md;
}
