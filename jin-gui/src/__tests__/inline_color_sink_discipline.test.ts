import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd(), 'src');
const colorLiteral = /#(?:[\da-f]{3}|[\da-f]{6,8})\b|\b(?:rgb|hsl)a?\s*\(/i;
const namedColor = /\b(?:aliceblue|aqua|black|blue|cyan|fuchsia|gray|green|lime|magenta|maroon|navy|olive|orange|purple|red|rebeccapurple|silver|teal|white|yellow)\b/i;

function isRawColorValue(value: string): boolean {
  return colorLiteral.test(value) || namedColor.test(value);
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith('.ts') && !path.includes('__tests__') ? [path] : [];
  });
}

function propertyName(node: ts.Expression): string | null {
  return ts.isStringLiteral(node) ? node.text : null;
}

describe('inline color sink discipline', () => {
  it('limits raw color values in DOM styling APIs to documented custom-color owners', () => {
    const violations: string[] = [];
    for (const path of sourceFiles(root)) {
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
      const name = relative(root, path);
      const allowCalendar = name === 'lib/calendar/colors.ts';
      const allowPicker = name === 'lib/ui/color_picker.ts';
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === 'setProperty'
          && ts.isPropertyAccessExpression(node.expression.expression)
          && node.expression.expression.name.text === 'style') {
          const property = propertyName(node.arguments[0]);
          const value = node.arguments[1]?.getText(source) ?? '';
          const allowed = (allowCalendar && property === '--calendar-color-value') || allowPicker;
          if (isRawColorValue(value) && !allowed) violations.push(`${name}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === 'setAttribute'
          && propertyName(node.arguments[0]) === 'style'
          && isRawColorValue(node.arguments[1]?.getText(source) ?? '')) {
          violations.push(`${name}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
        }
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
          && ts.isPropertyAccessExpression(node.left)
          && ['backgroundColor', 'color', 'borderColor'].includes(node.left.name.text)
          && ts.isPropertyAccessExpression(node.left.expression)
          && node.left.expression.name.text === 'style'
          && isRawColorValue(node.right.getText(source)) && !allowPicker) {
          violations.push(`${name}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(violations).toEqual([]);
  });

  it('keeps literal HTML style attributes free of raw colors', () => {
    const markup = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    const attributes = [...markup.matchAll(/\sstyle=(['"])(.*?)\1/g)].map((match) => match[2]);
    expect(attributes).not.toHaveLength(0);
    expect(attributes.filter(isRawColorValue)).toEqual([]);
  });

  it('rejects literals and named colors while permitting semantic and system values', () => {
    for (const value of ["'#abc'", "'rgb(1, 2, 3)'", "'rebeccapurple'", "'red'"]) {
      expect(isRawColorValue(value)).toBe(true);
    }
    for (const value of ["'var(--label)'", "'color-mix(in srgb, var(--label), transparent)'", "'CanvasText'", "'currentColor'", "''"]) {
      expect(isRawColorValue(value)).toBe(false);
    }
  });

  it('keeps the calendar custom-color sink runtime-normalized', () => {
    const calendar = readFileSync(join(root, 'lib/calendar/colors.ts'), 'utf8');
    expect(calendar).toMatch(/const normalized = normalizeJinColor\(color\) \?\? 'accent';/);
    expect(calendar).toMatch(/setProperty\('--calendar-color-value', normalized\)/);
  });
});
