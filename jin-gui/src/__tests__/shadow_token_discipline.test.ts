/** Guards a CSS value-category boundary: complete shadow tokens are values, not colors. */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';

const STYLES_DIR = fileURLToPath(new URL('../styles', import.meta.url));
const COMPLETE_SHADOW_TOKEN = /^var\(--(?:elevation|dialog)-[a-z0-9-]+\)$/i;
const COMPLETE_SHADOW_TOKEN_REFERENCE = /var\(--(?:elevation|dialog)-[a-z0-9-]+\)/i;

function invalidShadowDeclarations(css: string): string[] {
  const invalid: string[] = [];
  postcss.parse(css).walkDecls('box-shadow', (declaration) => {
    const value = declaration.value.trim();
    if (COMPLETE_SHADOW_TOKEN_REFERENCE.test(value) && !COMPLETE_SHADOW_TOKEN.test(value)) {
      invalid.push(`${declaration.prop}: ${declaration.value};`);
    }
  });
  return invalid;
}

function rawColorDeclarations(css: string): string[] {
  const invalid: string[] = [];
  postcss.parse(css).walkDecls((declaration) => {
    const functions: string[] = [];
    valueParser(declaration.value).walk((node) => {
      if (node.type === 'function') functions.push(node.value.toLowerCase());
    });
    if (functions.some((name) => ['rgb', 'rgba', 'hsl', 'hsla'].includes(name))) {
      invalid.push(`${declaration.prop}: ${declaration.value};`);
    }
  });
  return invalid;
}

describe('shadow token discipline', () => {
  it('rejects composing a complete shadow token with extra shadow geometry', () => {
    expect(invalidShadowDeclarations('x { box-shadow: 0 2px 8px var(--elevation-shadow); }'))
      .toEqual(['box-shadow: 0 2px 8px var(--elevation-shadow);']);
  });

  it('uses complete elevation tokens as complete box-shadow values', () => {
    const violations: string[] = [];
    for (const file of readdirSync(STYLES_DIR).filter((name) => name.endsWith('.css'))) {
      const css = readFileSync(join(STYLES_DIR, file), 'utf8');
      for (const declaration of invalidShadowDeclarations(css)) violations.push(`${file}: ${declaration}`);
    }
    expect(violations).toEqual([]);
  });

  it('rejects raw color functions while allowing semantic variable composition', () => {
    expect(rawColorDeclarations('x { color: rgba(0, 0, 0, .5); }'))
      .toEqual(['color: rgba(0, 0, 0, .5);']);
    expect(rawColorDeclarations('x { background: var(--fill, rgba(0, 0, 0, .5)); }'))
      .toEqual(['background: var(--fill, rgba(0, 0, 0, .5));']);
    expect(rawColorDeclarations('x { color: color-mix(in srgb, var(--accent), rgba(0, 0, 0, .5)); }'))
      .toEqual(['color: color-mix(in srgb, var(--accent), rgba(0, 0, 0, .5));']);
    expect(rawColorDeclarations('x { color: color-mix(in srgb, var(--accent), transparent); }'))
      .toEqual([]);
  });

  it('keeps feature CSS color values semantic', () => {
    const violations: string[] = [];
    for (const file of readdirSync(STYLES_DIR).filter((name) => name.endsWith('.css') && name !== 'tokens.css')) {
      const css = readFileSync(join(STYLES_DIR, file), 'utf8');
      for (const declaration of rawColorDeclarations(css)) violations.push(`${file}: ${declaration}`);
    }
    expect(violations).toEqual([]);
  });
});
