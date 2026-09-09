// @vitest-environment jsdom
/**
 * markdown.test.ts — adversarial sanitization tests for the notes markdown chokepoint.
 *
 * Gates covered:
 *   G-SANITIZE          — adversarial: script/img-onerror/js-link/svg/iframe/obfuscated/entities
 *   G-XSS               — <script> body → literal text, no execution
 *   G-CHOKEPOINT (K-B3) — no module other than lib/notes/markdown.ts imports markdown-it/dompurify
 *   G-CODE-READING-HLJS — ```js fence renders with hljs-* class spans
 *   G-CODE-HLJS-SANITIZE— <script> in a fence stays inert AND hljs spans survive DOMPurify
 *   G-CODE-LARGE-SKIP   — fences exceeding MAX_HIGHLIGHT_BYTES render plain (no hljs spans)
 *   G-CHOKEPOINT-HLJS   — no module other than markdown.ts imports highlight.js
 *   G-CODE-COPY         — .code-block__copy click → navigator.clipboard.writeText with raw code
 *   G-CODE-BADGE        — .code-block__lang badge text === fence language; absent when no lang
 *   G-CODE-WRAP         — .code-block__wrap toggle flips .is-wrapped + aria-pressed
 *   G-CODE-HEADER-INERT — decorated fragment passes assertInert (no svg/script/on*)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderMarkdownFragment, hydrateManagedImages, _getMdInstance } from '../lib/notes/markdown';

if (!URL.createObjectURL) {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:test' });
}
if (!URL.revokeObjectURL) {
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * fragmentText — get all text content from the fragment.
 */
function fragmentText(frag: DocumentFragment): string {
  const div = document.createElement('div');
  div.appendChild(frag.cloneNode(true));
  return div.textContent ?? '';
}

/**
 * fragmentHTML — serialize fragment to HTML string for assertions.
 */
function fragmentHTML(frag: DocumentFragment): string {
  const div = document.createElement('div');
  div.appendChild(frag.cloneNode(true));
  return div.innerHTML;
}

/**
 * queryFrag — querySelector on a fragment (mount in a div, query, unmount).
 */
function queryFrag(frag: DocumentFragment, selector: string): Element | null {
  const div = document.createElement('div');
  div.appendChild(frag.cloneNode(true));
  return div.querySelector(selector);
}

/**
 * queryAllFrag — querySelectorAll on a fragment.
 */
function queryAllFrag(frag: DocumentFragment, selector: string): Element[] {
  const div = document.createElement('div');
  div.appendChild(frag.cloneNode(true));
  return Array.from(div.querySelectorAll(selector));
}

/**
 * assertInert — assert that a fragment contains no dangerous tags, no on* attributes,
 * and no javascript:/data: hrefs. Used as a shared assertion across adversarial cases.
 */
function assertInert(frag: DocumentFragment): void {
  const html = fragmentHTML(frag);

  // No dangerous tag nodes.
  for (const tag of ['script', 'iframe', 'object', 'embed', 'svg', 'math', 'style', 'link', 'meta', 'base', 'form']) {
    expect(queryFrag(frag, tag), `No <${tag}> node should exist`).toBeNull();
  }

  // No element with any on* attribute.
  const allEls = queryAllFrag(frag, '*');
  for (const el of allEls) {
    for (const attr of Array.from(el.attributes)) {
      expect(attr.name.toLowerCase().startsWith('on'), `Attribute "${attr.name}" on <${el.tagName}> must not be an event handler`).toBe(false);
    }
  }

  // No javascript:/data:/vbscript: href.
  const anchors = queryAllFrag(frag, 'a[href]') as HTMLAnchorElement[];
  for (const a of anchors) {
    const href = (a.getAttribute('href') ?? '').toLowerCase().replace(/\s+/g, '');
    expect(href.startsWith('javascript:'), `href "${href}" must not be javascript:`).toBe(false);
    expect(href.startsWith('data:'), `href "${href}" must not be data:`).toBe(false);
    expect(href.startsWith('vbscript:'), `href "${href}" must not be vbscript:`).toBe(false);
  }

  // No img tags (not in the allow-list).
  expect(queryFrag(frag, 'img'), 'No <img> node should exist').toBeNull();

  // Confirm no global XSS side-effects fired.
  const win = window as Record<string, unknown>;
  const xssKeys = Object.keys(win).filter(k => k.startsWith('__xss') || k.startsWith('__x'));
  expect(xssKeys.filter(k => win[k] !== undefined)).toHaveLength(0);

  // Silence unused variable warning — html used for debug context.
  void html;
}

// ── Reset XSS canaries ────────────────────────────────────────────────────────

beforeEach(() => {
  const win = window as Record<string, unknown>;
  delete win['__xss_notes'];
  delete win['__xss_block'];
  delete win['__xss_row'];
  delete win['__x'];
  delete win['__xss'];
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── AC-B1.8 — Return type is DocumentFragment ─────────────────────────────────

describe('renderMarkdownFragment — return type', () => {
  it('returns a DocumentFragment for any input', () => {
    const frag = renderMarkdownFragment('# Hello');
    expect(frag).toBeInstanceOf(DocumentFragment);
  });

  it('returns a DocumentFragment for empty string', () => {
    const frag = renderMarkdownFragment('');
    expect(frag).toBeInstanceOf(DocumentFragment);
  });

  it('returns a DocumentFragment for malicious input', () => {
    const frag = renderMarkdownFragment('<script>alert(1)</script>');
    expect(frag).toBeInstanceOf(DocumentFragment);
  });
});

// ── AC-B1.1 — Positive controls (real markdown DOES render) ──────────────────

describe('renderMarkdownFragment — positive controls (real markdown renders)', () => {
  const complexMd = '# H\n\n**b** *i* `c`\n\n- a\n- b\n\n> q\n\n```js\nx\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |';

  it('renders h1 from # heading', () => {
    const frag = renderMarkdownFragment(complexMd);
    expect(queryFrag(frag, 'h1')).not.toBeNull();
    expect(queryFrag(frag, 'h1')?.textContent).toBe('H');
  });

  it('renders strong from **bold**', () => {
    const frag = renderMarkdownFragment(complexMd);
    expect(queryFrag(frag, 'strong')).not.toBeNull();
  });

  it('renders em from *italic*', () => {
    const frag = renderMarkdownFragment(complexMd);
    expect(queryFrag(frag, 'em')).not.toBeNull();
  });

  it('renders inline code from `backtick`', () => {
    const frag = renderMarkdownFragment(complexMd);
    expect(queryFrag(frag, 'code')).not.toBeNull();
  });

  it('renders ul>li from - list', () => {
    const frag = renderMarkdownFragment(complexMd);
    expect(queryFrag(frag, 'ul')).not.toBeNull();
    expect(queryAllFrag(frag, 'li').length).toBeGreaterThan(0);
  });

  it('renders blockquote from > quote', () => {
    const frag = renderMarkdownFragment(complexMd);
    expect(queryFrag(frag, 'blockquote')).not.toBeNull();
  });

  it('renders pre>code with language class from ```js fence', () => {
    const frag = renderMarkdownFragment(complexMd);
    const pre = queryFrag(frag, 'pre');
    expect(pre).not.toBeNull();
    const codeEl = pre?.querySelector('code');
    expect(codeEl).not.toBeNull();
    expect(codeEl?.className).toContain('language-js');
  });

  it('renders table from GFM table syntax', () => {
    const frag = renderMarkdownFragment(complexMd);
    expect(queryFrag(frag, 'table')).not.toBeNull();
  });

  it('AC-B1.2 — safe https link survives as a[href]', () => {
    const frag = renderMarkdownFragment('[ok](https://example.com)');
    const a = queryFrag(frag, 'a') as HTMLAnchorElement | null;
    expect(a).not.toBeNull();
    expect(a?.getAttribute('href')).toBe('https://example.com');
  });

  it('renders an allowlisted Jin asset reference as an inert local placeholder', () => {
    const hash = 'a'.repeat(64);
    const frag = renderMarkdownFragment(`[clip](jin-asset://sha256/${hash})`);
    const placeholder = queryFrag(frag, '.jin-asset-placeholder') as HTMLElement | null;
    expect(placeholder).not.toBeNull();
    expect(placeholder?.dataset.jinAssetHash).toBe(hash);
    expect(queryFrag(frag, 'a')).toBeNull();
    expect(queryFrag(frag, 'img')).toBeNull();
    expect(queryFrag(frag, 'video')).toBeNull();
  });

  it('preserves a managed image label in an inert placeholder for verified hydration', () => {
    const hash = 'a'.repeat(64);
    const frag = renderMarkdownFragment(`![Diagram](jin-asset://sha256/${hash})`);
    const placeholder = queryFrag(frag, '.jin-asset-placeholder') as HTMLElement | null;
    expect(placeholder?.dataset.jinAssetHash).toBe(hash);
    expect(placeholder?.dataset.jinAssetLabel).toBe('Diagram');
    expect(queryFrag(frag, 'img')).toBeNull();
  });

  it('keeps plain, labelled, and explicit card links as distinct portable forms', () => {
    const plain = queryFrag(renderMarkdownFragment('https://example.com'), 'a')!;
    const inline = queryFrag(renderMarkdownFragment('[Example](https://example.com)'), 'a')!;
    const card = queryFrag(renderMarkdownFragment('[Example](https://example.com "jin-card")'), 'a')!;
    expect(plain.classList.contains('jin-plain-link')).toBe(true);
    expect(inline.classList.contains('jin-inline-link')).toBe(true);
    expect(inline.classList.contains('jin-link-card')).toBe(false);
    expect(card.classList.contains('jin-link-card')).toBe(true);
    expect(card.hasAttribute('title')).toBe(false);
  });
});

describe('managed image hydration lifecycle', () => {
  it('creates and revokes only an app-owned Blob URL', async () => {
    const hash = 'a'.repeat(64);
    const host = document.createElement('div');
    host.append(renderMarkdownFragment(`![Diagram](jin-asset://sha256/${hash})`));
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:verified-image');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const dispose = await hydrateManagedImages(host, async () => ({
      mime: 'image/png', bytes: [137, 80, 78, 71],
    }));
    const image = host.querySelector<HTMLImageElement>('img');
    expect(image?.src).toContain('blob:verified-image');
    expect(image?.alt).toBe('Diagram');
    expect(create).toHaveBeenCalledTimes(1);
    dispose();
    expect(revoke).toHaveBeenCalledWith('blob:verified-image');
  });

  it('revokes a resolved URL when its placeholder was detached while loading', async () => {
    const hash = 'a'.repeat(64);
    const host = document.createElement('div');
    host.append(renderMarkdownFragment(`![Diagram](jin-asset://sha256/${hash})`));
    let finish!: (asset: { mime: string; bytes: number[] }) => void;
    const resolved = new Promise<{ mime: string; bytes: number[] }>((resolve) => { finish = resolve; });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stale-image');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const hydration = hydrateManagedImages(host, () => resolved);
    host.replaceChildren();
    finish({ mime: 'image/png', bytes: [137, 80, 78, 71] });
    await hydration;
    expect(revoke).toHaveBeenCalledWith('blob:stale-image');
    expect(host.querySelector('img')).toBeNull();
  });
});

// ── G-XSS / AC-B1.3 — <script> tag ──────────────────────────────────────────

describe('G-XSS — script tag is literal text, not executed', () => {
  it('AC-B1.3: <script> body → literal text in fragment; window.__x undefined', () => {
    const frag = renderMarkdownFragment('<script>window.__x=1</script>');
    // No script node.
    expect(queryFrag(frag, 'script')).toBeNull();
    // Literal text of the escaped source appears.
    expect(fragmentText(frag)).toContain('<script>');
    // Not executed.
    expect((window as Record<string, unknown>)['__x']).toBeUndefined();
    assertInert(frag);
  });

  it('AC-B1.3 variant: window.__xss_notes variant', () => {
    const frag = renderMarkdownFragment('<script>window.__xss_notes = true</script>');
    expect(fragmentText(frag)).toContain('<script>');
    expect((window as Record<string, unknown>)['__xss_notes']).toBeUndefined();
    assertInert(frag);
  });
});

// ── G-SANITIZE adversarial suite ─────────────────────────────────────────────

describe('G-SANITIZE — adversarial payloads (all must be inert)', () => {
  it('AC-B1.4: <img src=x onerror=alert(1)> — no img, no onerror', () => {
    const frag = renderMarkdownFragment('<img src=x onerror=alert(1)>');
    expect(queryFrag(frag, 'img')).toBeNull();
    assertInert(frag);
  });

  it('AC-B1.5: [click](javascript:alert(1)) — no anchor with javascript: href', () => {
    const frag = renderMarkdownFragment('[click](javascript:alert(1))');
    const a = queryFrag(frag, 'a') as HTMLAnchorElement | null;
    // Either no anchor at all, or anchor without javascript: href.
    if (a) {
      const href = (a.getAttribute('href') ?? '').toLowerCase();
      expect(href.startsWith('javascript:')).toBe(false);
    }
    assertInert(frag);
  });

  it('AC-B1.6: raw <a href="javascript:alert(1)">x</a> — no anchor executes', () => {
    // html:false escapes this to literal text; DOMPurify is defense-in-depth.
    const frag = renderMarkdownFragment('<a href="javascript:alert(1)">x</a>');
    // Either no a tag, or href is not javascript:.
    const anchors = queryAllFrag(frag, 'a') as HTMLAnchorElement[];
    for (const a of anchors) {
      const href = (a.getAttribute('href') ?? '').toLowerCase();
      expect(href.startsWith('javascript:')).toBe(false);
    }
    assertInert(frag);
  });

  it('AC-B1.7a: <scr<script>ipt> obfuscation — no script node, no execution', () => {
    const frag = renderMarkdownFragment('<scr<script>ipt>alert(1)</script>');
    assertInert(frag);
  });

  it('AC-B1.7b: <svg onload=alert(1)> — no svg, no onload', () => {
    const frag = renderMarkdownFragment('<svg onload=alert(1)>');
    expect(queryFrag(frag, 'svg')).toBeNull();
    assertInert(frag);
  });

  it('AC-B1.7c: <iframe src=javascript:alert(1)> — no iframe', () => {
    const frag = renderMarkdownFragment('<iframe src=javascript:alert(1)>');
    expect(queryFrag(frag, 'iframe')).toBeNull();
    assertInert(frag);
  });

  it('AC-B1.7d: <a href="jAvAsCrIpT:alert(1)">x</a> — case-variant javascript: blocked', () => {
    const frag = renderMarkdownFragment('<a href="jAvAsCrIpT:alert(1)">x</a>');
    const anchors = queryAllFrag(frag, 'a') as HTMLAnchorElement[];
    for (const a of anchors) {
      const href = (a.getAttribute('href') ?? '').toLowerCase().replace(/\s+/g, '');
      expect(href.startsWith('javascript:')).toBe(false);
    }
    assertInert(frag);
  });

  it('AC-B1.7e: <details open ontoggle=alert(1)> — no on* survives', () => {
    const frag = renderMarkdownFragment('<details open ontoggle=alert(1)><summary>x</summary></details>');
    assertInert(frag);
  });

  it('AC-B1.7f: HTML entity &lt;script&gt; — literal text, not parsed as tag', () => {
    const frag = renderMarkdownFragment('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(queryFrag(frag, 'script')).toBeNull();
    assertInert(frag);
  });

  it('nested/stacked script tags — no execution', () => {
    const frag = renderMarkdownFragment('<script><script>alert(1)</script></script>');
    expect(queryFrag(frag, 'script')).toBeNull();
    assertInert(frag);
  });

  it('data: URI href — blocked by ALLOWED_URI_REGEXP', () => {
    const frag = renderMarkdownFragment('[x](data:text/html,<script>alert(1)</script>)');
    const anchors = queryAllFrag(frag, 'a') as HTMLAnchorElement[];
    for (const a of anchors) {
      const href = (a.getAttribute('href') ?? '').toLowerCase();
      expect(href.startsWith('data:')).toBe(false);
    }
    assertInert(frag);
  });

  it('vbscript: href — blocked', () => {
    const frag = renderMarkdownFragment('<a href="vbscript:msgbox(1)">click</a>');
    const anchors = queryAllFrag(frag, 'a') as HTMLAnchorElement[];
    for (const a of anchors) {
      const href = (a.getAttribute('href') ?? '').toLowerCase();
      expect(href.startsWith('vbscript:')).toBe(false);
    }
    assertInert(frag);
  });

  it('<object> tag — stripped', () => {
    const frag = renderMarkdownFragment('<object data="http://evil.com/x.swf"></object>');
    expect(queryFrag(frag, 'object')).toBeNull();
    assertInert(frag);
  });

  it('<form> tag — stripped', () => {
    const frag = renderMarkdownFragment('<form action="javascript:void(0)"><input type="submit"></form>');
    expect(queryFrag(frag, 'form')).toBeNull();
    assertInert(frag);
  });

  it('<embed> tag — stripped', () => {
    const frag = renderMarkdownFragment('<embed src="javascript:alert(1)">');
    expect(queryFrag(frag, 'embed')).toBeNull();
    assertInert(frag);
  });

  it('style attribute — stripped (FORBID_ATTR)', () => {
    const frag = renderMarkdownFragment('<p style="background:url(javascript:alert(1))">x</p>');
    const allEls = queryAllFrag(frag, '*');
    for (const el of allEls) {
      expect(el.hasAttribute('style'), `<${el.tagName}> must not have style attribute`).toBe(false);
    }
  });

  it('formaction attribute — stripped', () => {
    const frag = renderMarkdownFragment('<button formaction="javascript:alert(1)">x</button>');
    const allEls = queryAllFrag(frag, '*');
    for (const el of allEls) {
      expect(el.hasAttribute('formaction')).toBe(false);
    }
  });

  it('xlink:href attribute — stripped', () => {
    // In the context of html:false, SVG would be literal text; but if somehow a tag came through:
    const frag = renderMarkdownFragment('<a xlink:href="javascript:alert(1)">x</a>');
    // Either no anchor or no xlink:href.
    const allEls = queryAllFrag(frag, '*');
    for (const el of allEls) {
      // xlink:href would be serialised as-is or dropped; should not survive.
      const xhref = el.getAttributeNS?.('http://www.w3.org/1999/xlink', 'href');
      expect(xhref ?? null).toBeNull();
    }
    assertInert(frag);
  });

  it('<math> tag — stripped', () => {
    const frag = renderMarkdownFragment('<math><mtext>x</mtext></math>');
    expect(queryFrag(frag, 'math')).toBeNull();
    assertInert(frag);
  });
});

// ── G-CHOKEPOINT (K-B3) — singleton + no-bypass guard ───────────────────────

describe('G-CHOKEPOINT (K-B3) — markdown-it/dompurify singleton and no-bypass', () => {
  it('_getMdInstance returns the same object on every call (singleton)', () => {
    const a = _getMdInstance();
    const b = _getMdInstance();
    expect(a).toBe(b);
  });

  it('no source file other than lib/notes/markdown.ts imports markdown-it', () => {
    // Scan all .ts files under jin-gui/src, excluding:
    //   - markdown.ts itself (the only authorised consumer)
    //   - __tests__ directory (test files may import types/helpers from the chokepoint module itself,
    //     but they must NOT import markdown-it or dompurify directly)
    const srcDir = resolve(process.cwd(), 'src');
    const files = globSync(`${srcDir}/**/*.ts`);

    const violations: string[] = [];
    for (const file of files) {
      // Skip the chokepoint itself.
      if (file.endsWith('lib/notes/markdown.ts')) continue;
      // Skip test files — the test imports _getMdInstance from markdown.ts (the chokepoint),
      // not markdown-it directly.
      if (file.includes('__tests__')) continue;
      const content = readFileSync(file, 'utf-8');
      if (content.includes("from 'markdown-it'") || content.includes('from "markdown-it"') ||
          content.includes("require('markdown-it')") || content.includes('require("markdown-it")')) {
        violations.push(file);
      }
    }
    expect(violations, `These files bypass the chokepoint by importing markdown-it directly: ${violations.join(', ')}`).toHaveLength(0);
  });

  it('no source file other than lib/notes/markdown.ts imports dompurify', () => {
    const srcDir = resolve(process.cwd(), 'src');
    const files = globSync(`${srcDir}/**/*.ts`);

    const violations: string[] = [];
    for (const file of files) {
      if (file.endsWith('lib/notes/markdown.ts')) continue;
      if (file.includes('__tests__')) continue;
      const content = readFileSync(file, 'utf-8');
      if (content.includes("from 'dompurify'") || content.includes('from "dompurify"') ||
          content.includes("require('dompurify')") || content.includes('require("dompurify")')) {
        violations.push(file);
      }
    }
    expect(violations, `These files bypass the chokepoint by importing dompurify directly: ${violations.join(', ')}`).toHaveLength(0);
  });

  it('G-CHOKEPOINT-HLJS: no source file other than lib/notes/markdown.ts imports highlight.js', () => {
    // Extending the chokepoint: highlight.js is a sanitizer-adjacent lib and
    // MUST only be imported through the markdown.ts chokepoint module.
    const srcDir = resolve(process.cwd(), 'src');
    const files = globSync(`${srcDir}/**/*.ts`);

    const violations: string[] = [];
    for (const file of files) {
      if (file.endsWith('lib/notes/markdown.ts')) continue;
      if (file.includes('__tests__')) continue;
      const content = readFileSync(file, 'utf-8');
      if (content.includes("from 'highlight.js'") || content.includes('from "highlight.js"') ||
          content.includes("require('highlight.js')") || content.includes('require("highlight.js")') ||
          content.includes("from 'highlight.js/") || content.includes('from "highlight.js/')) {
        violations.push(file);
      }
    }
    expect(violations, `These files bypass the chokepoint by importing highlight.js directly: ${violations.join(', ')}`).toHaveLength(0);
  });
});

// ── G-CODE-READING-HLJS — highlight.js spans in rendered fence ───────────────

describe('G-CODE-READING-HLJS — highlight.js colorizes fenced code in the reading view', () => {
  it('AC-CODE-2.1: ```js fence renders with language-js class AND hljs-* spans', () => {
    const frag = renderMarkdownFragment('```js\nconst x = 1;\n```');
    const div = document.createElement('div');
    div.appendChild(frag.cloneNode(true));

    const codeEl = div.querySelector('pre code');
    expect(codeEl, 'code element inside pre must exist').not.toBeNull();
    // The code element's className must contain language-js (existing control)
    expect(codeEl!.className).toContain('language-js');
    // At least one <span> with an hljs-* class must be present (highlight applied)
    const hlSpans = div.querySelectorAll('pre code span[class*="hljs-"]');
    expect(hlSpans.length, 'Expected >=1 hljs-* span inside the rendered code').toBeGreaterThan(0);
  });

  it('AC-CODE-2.3: hljs-* class spans survive DOMPurify (class is in ALLOWED_ATTR)', () => {
    const frag = renderMarkdownFragment('```python\ndef hello():\n    return 1\n```');
    const div = document.createElement('div');
    div.appendChild(frag.cloneNode(true));

    const hlSpans = div.querySelectorAll('pre code span[class*="hljs-"]');
    expect(hlSpans.length, 'hljs-* spans must survive the DOMPurify sanitizer').toBeGreaterThan(0);
  });
});

// ── G-CODE-HLJS-SANITIZE — security: <script> in fence stays inert ───────────

describe('G-CODE-HLJS-SANITIZE — <script> in a code fence is inert after highlighting + sanitizing', () => {
  it('AC-CODE-2.2a: <script> inside a fence → no live script node, literal text, canary undefined', () => {
    const src = '```js\n<script>window.__x=1</script>\n```';
    const frag = renderMarkdownFragment(src);
    const div = document.createElement('div');
    div.appendChild(frag.cloneNode(true));

    // No live <script> node
    expect(div.querySelector('script'), 'No <script> node in rendered fence').toBeNull();
    // The literal text appears as escaped text content, not as a tag
    const codeEl = div.querySelector('pre code');
    expect(codeEl, 'code element must exist').not.toBeNull();
    expect(codeEl!.textContent).toContain('<script>');
    // Not executed
    expect((window as Record<string, unknown>)['__x']).toBeUndefined();
    // Full inert assertion
    assertInert(frag.cloneNode(true) as DocumentFragment);
  });

  it('AC-CODE-2.2b: hljs-* spans survive alongside the inert script text', () => {
    // Highlighting + sanitization must coexist: the text is escaped AND the surrounding
    // code tokens are still colorized (DOMPurify must not strip span.hljs-*)
    const src = '```js\nconst y = 2;\n<script>window.__x=1</script>\n```';
    const frag = renderMarkdownFragment(src);
    const div = document.createElement('div');
    div.appendChild(frag.cloneNode(true));

    expect(div.querySelector('script')).toBeNull();
    // hljs spans must still be present around the surrounding valid tokens
    const hlSpans = div.querySelectorAll('pre code span[class*="hljs-"]');
    expect(hlSpans.length, 'hljs-* spans must survive even when fence contains script-like text').toBeGreaterThan(0);
  });
});

// ── G-CODE-LARGE-SKIP — fences >50KB skip highlighting ───────────────────────

describe('G-CODE-LARGE-SKIP — very large code blocks skip highlighting for performance', () => {
  it('AC-CODE-2.4: a fence whose body exceeds MAX_HIGHLIGHT_BYTES renders plain (no hljs spans)', () => {
    // Build a code block that exceeds 50 000 characters
    const bigCode = 'x'.repeat(51_000);
    const src = `\`\`\`js\n${bigCode}\n\`\`\``;
    const frag = renderMarkdownFragment(src);
    const div = document.createElement('div');
    div.appendChild(frag.cloneNode(true));

    const codeEl = div.querySelector('pre code');
    expect(codeEl, 'code element must still render for large blocks').not.toBeNull();
    // No hljs-* spans — highlighting was skipped
    const hlSpans = div.querySelectorAll('pre code span[class*="hljs-"]');
    expect(hlSpans.length, 'Large code blocks must NOT have hljs spans (plain fallback)').toBe(0);
  });
});

// ── G-CODE-COPY / G-CODE-BADGE / G-CODE-WRAP / G-CODE-HEADER-INERT ──────────

describe('G-CODE-COPY — copy button writes the raw code text to the clipboard', () => {
  it('AC-CODE-3.1: clicking .code-block__copy calls navigator.clipboard.writeText with raw code text', async () => {
    const writeText = vi.fn<[string], Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const frag = renderMarkdownFragment('```js\nconst x = 1;\n```');
    const div = document.createElement('div');
    // appendChild moves nodes from frag into div (event listeners preserved)
    div.appendChild(frag);
    document.body.appendChild(div);

    const copyBtn = div.querySelector<HTMLButtonElement>('.code-block__copy');
    expect(copyBtn, '.code-block__copy button must exist').not.toBeNull();
    copyBtn!.click();
    // writeText is async; let the microtask settle
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledTimes(1);
    // The raw code text with trailing \n stripped
    expect(writeText).toHaveBeenCalledWith('const x = 1;');

    document.body.removeChild(div);
  });
});

describe('G-CODE-BADGE — language badge displays the fence language', () => {
  it('AC-CODE-3.2a: .code-block__lang badge textContent === fence language', () => {
    const frag = renderMarkdownFragment('```python\ndef f(): pass\n```');
    const div = document.createElement('div');
    div.appendChild(frag.cloneNode(true));

    const badge = div.querySelector('.code-block__lang');
    expect(badge, '.code-block__lang badge must exist for a python fence').not.toBeNull();
    expect(badge!.textContent).toBe('python');
  });

  it('AC-CODE-3.2b: no badge when fence has no language', () => {
    const frag = renderMarkdownFragment('```\nplain code\n```');
    const div = document.createElement('div');
    div.appendChild(frag.cloneNode(true));

    const badge = div.querySelector('.code-block__lang');
    expect(badge, 'No .code-block__lang badge for a fence with no language').toBeNull();
  });
});

describe('G-CODE-WRAP — wrap toggle flips .is-wrapped and aria-pressed', () => {
  it('AC-CODE-3.3: clicking wrap button toggles .is-wrapped + aria-pressed (both directions)', () => {
    const frag = renderMarkdownFragment('```js\nconst x = 1;\n```');
    const div = document.createElement('div');
    div.appendChild(frag);
    document.body.appendChild(div);

    const figure = div.querySelector<HTMLElement>('figure.code-block');
    expect(figure, 'figure.code-block must exist').not.toBeNull();
    const wrapBtn = div.querySelector<HTMLButtonElement>('.code-block__wrap');
    expect(wrapBtn, '.code-block__wrap button must exist').not.toBeNull();

    // Initial state: not wrapped
    expect(figure!.classList.contains('is-wrapped')).toBe(false);
    expect(wrapBtn!.getAttribute('aria-pressed')).toBe('false');

    // First click: wrap ON
    wrapBtn!.click();
    expect(figure!.classList.contains('is-wrapped')).toBe(true);
    expect(wrapBtn!.getAttribute('aria-pressed')).toBe('true');

    // Second click: wrap OFF
    wrapBtn!.click();
    expect(figure!.classList.contains('is-wrapped')).toBe(false);
    expect(wrapBtn!.getAttribute('aria-pressed')).toBe('false');

    document.body.removeChild(div);
  });
});

describe('G-CODE-HEADER-INERT — decorated fragment passes assertInert (no svg/script/on*)', () => {
  it('AC-CODE-3.4: a code-fence fragment passes assertInert after decoration', () => {
    // <i data-lucide> elements are not <svg> — assertInert must pass.
    // Buttons use addEventListener (no on* attributes) — assertInert must pass.
    const frag = renderMarkdownFragment('```js\nconst x = 1;\n```');
    assertInert(frag);
  });

  it('AC-CODE-3.4 variant: unfenced code block also passes assertInert', () => {
    const frag = renderMarkdownFragment('```\nplain code\n```');
    assertInert(frag);
  });

  it('code-block copy + wrap buttons carry a title tooltip', () => {
    const frag = renderMarkdownFragment('```js\nconst x = 1;\n```');
    const copyBtn = queryFrag(frag, '.code-block__copy');
    const wrapBtn = queryFrag(frag, '.code-block__wrap');
    expect(copyBtn?.getAttribute('title')).toBe('Copy code');
    expect(wrapBtn?.getAttribute('title')).toBe('Toggle soft wrap');
  });
});

// ── G-TASK-LIST — GFM task-list markers render as inert Jin checkboxes ────────

describe('G-TASK-LIST — `- [ ]` / `- [x]` render as inert checkboxes, not literal text', () => {
  it('an unchecked item produces a disabled, unchecked input.task-list-item-checkbox', () => {
    const frag = renderMarkdownFragment('- [ ] buy milk');
    const cb = queryFrag(frag, 'input.task-list-item-checkbox') as HTMLInputElement | null;
    expect(cb, 'checkbox input must exist').not.toBeNull();
    expect(cb!.hasAttribute('disabled'), 'reading-view checkbox must be inert').toBe(true);
    expect(cb!.hasAttribute('checked'), 'unchecked marker must not be checked').toBe(false);
  });

  it('the input survives sanitization with type="checkbox" (not stripped by ALLOWED_URI_REGEXP)', () => {
    // Regression guard: ALLOWED_URI_REGEXP URI-checks `type` and would strip
    // "checkbox" without ADD_URI_SAFE_ATTR. Without type=checkbox the element
    // renders as a text input and the :checked Jin styling never applies.
    const frag = renderMarkdownFragment('- [x] ship it');
    const cb = queryFrag(frag, 'input.task-list-item-checkbox') as HTMLInputElement | null;
    expect(cb, 'checkbox input must exist').not.toBeNull();
    expect(cb!.getAttribute('type'), 'type="checkbox" must survive the sanitizer').toBe('checkbox');
  });

  it('a checked item ([x]) produces a checked input', () => {
    const frag = renderMarkdownFragment('- [x] ship it');
    const cb = queryFrag(frag, 'input.task-list-item-checkbox') as HTMLInputElement | null;
    expect(cb, 'checkbox input must exist').not.toBeNull();
    expect(cb!.hasAttribute('checked'), '[x] marker must render checked').toBe(true);
  });

  it('uppercase [X] is also treated as checked', () => {
    const frag = renderMarkdownFragment('- [X] done');
    const cb = queryFrag(frag, 'input.task-list-item-checkbox') as HTMLInputElement | null;
    expect(cb?.hasAttribute('checked')).toBe(true);
  });

  it('the literal "[x]"/"[ ]" marker text is removed (only the label remains)', () => {
    const frag = renderMarkdownFragment('- [x] write tests');
    const text = fragmentText(frag);
    expect(text).toContain('write tests');
    expect(text).not.toContain('[x]');
    expect(text).not.toContain('[ ]');
  });

  it('tags the <li> with task-list-item and the parent <ul> with contains-task-list', () => {
    const frag = renderMarkdownFragment('- [ ] a\n- [x] b');
    expect(queryFrag(frag, 'ul.contains-task-list'), 'parent list class').not.toBeNull();
    expect(queryAllFrag(frag, 'li.task-list-item').length, 'both items tagged').toBe(2);
    expect(queryAllFrag(frag, 'input.task-list-item-checkbox').length).toBe(2);
  });

  it('the parent list class is applied exactly once for a multi-item list (no dup)', () => {
    const frag = renderMarkdownFragment('- [ ] a\n- [ ] b\n- [x] c');
    const ul = queryFrag(frag, 'ul.contains-task-list') as HTMLUListElement | null;
    expect(ul).not.toBeNull();
    expect(ul!.className.match(/contains-task-list/g)?.length, 'class added once, not per item').toBe(1);
  });

  it('a plain (non-task) list item is NOT converted to a checkbox', () => {
    const frag = renderMarkdownFragment('- just a bullet');
    expect(queryFrag(frag, 'input.task-list-item-checkbox')).toBeNull();
    expect(queryFrag(frag, 'li.task-list-item')).toBeNull();
    expect(fragmentText(frag)).toContain('just a bullet');
  });

  it('mixed task + non-task items: only task items get checkboxes', () => {
    const frag = renderMarkdownFragment('- [ ] task one\n- plain item\n- [x] task two');
    expect(queryAllFrag(frag, 'input.task-list-item-checkbox').length).toBe(2);
    expect(queryAllFrag(frag, 'li.task-list-item').length).toBe(2);
    expect(queryAllFrag(frag, 'li').length).toBe(3);
  });

  it('the rendered task list passes assertInert (input is allow-listed, no on*/script)', () => {
    const frag = renderMarkdownFragment('- [x] done\n- [ ] todo');
    assertInert(frag);
  });
});
