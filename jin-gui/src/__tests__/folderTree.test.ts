/**
 * folderTree.test.ts — pure unit tests for lib/notes/folderTree.ts.
 *
 * No DOM, no Stimulus. Tests:
 *   G-TREE-BUILD: buildFolderTree nested shape + ancestor synthesis
 *   flattenVisible: honors the expanded Set
 *   resolveTreeKey: WAI-ARIA APG keyboard nav (pure unit cases)
 */

import { describe, it, expect } from 'vitest';
import type { FolderDto } from '../types/dto';
import {
  buildFolderTree,
  flattenVisible,
  resolveTreeKey,
  type TreeNode,
  type TreeKeyContext,
} from '../lib/notes/folderTree';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFolder(path: string, name: string, noteCount = 0): FolderDto {
  return { path, name, note_count: noteCount };
}

/** Build a flat isParentMap from a tree for resolveTreeKey. */
function makeParentMap(nodes: TreeNode[]): Map<string, boolean> {
  const map = new Map<string, boolean>();
  function walk(ns: TreeNode[]): void {
    for (const n of ns) {
      map.set(n.path, n.isParent);
      walk(n.children);
    }
  }
  walk(nodes);
  return map;
}

// ── G-TREE-BUILD ──────────────────────────────────────────────────────────────

describe('G-TREE-BUILD — buildFolderTree nested shape', () => {
  it('produces correct top-level peers: ["", "Personal", "Work"] (sorted, "" first)', () => {
    const folders = [
      makeFolder('', 'Notes', 2),
      makeFolder('Work', 'Work', 5),
      makeFolder('Work/Projects', 'Projects', 3),
      makeFolder('Personal', 'Personal', 1),
    ];
    const tree = buildFolderTree(folders);
    expect(tree.map((n) => n.path)).toEqual(['', 'Personal', 'Work']);
  });

  it('Work node has children=[Work/Projects] and isParent=true', () => {
    const folders = [
      makeFolder('', 'Notes', 0),
      makeFolder('Work', 'Work', 5),
      makeFolder('Work/Projects', 'Projects', 3),
      makeFolder('Personal', 'Personal', 1),
    ];
    const tree = buildFolderTree(folders);
    const work = tree.find((n) => n.path === 'Work')!;
    expect(work.isParent).toBe(true);
    expect(work.children).toHaveLength(1);
    expect(work.children[0].path).toBe('Work/Projects');
  });

  it('depth: ""=0, Work=0, Work/Projects=1, Personal=0', () => {
    const folders = [
      makeFolder('', 'Notes', 0),
      makeFolder('Work', 'Work', 0),
      makeFolder('Work/Projects', 'Projects', 0),
      makeFolder('Personal', 'Personal', 0),
    ];
    const tree = buildFolderTree(folders);
    const flat = flattenVisible(tree, new Set(['Work']));
    const depthMap = Object.fromEntries(flat.map((n) => [n.path, n.depth]));
    expect(depthMap['']).toBe(0);
    expect(depthMap['Work']).toBe(0);
    expect(depthMap['Work/Projects']).toBe(1);
    expect(depthMap['Personal']).toBe(0);
  });

  it('maps note_count correctly from input DTO', () => {
    const folders = [
      makeFolder('', 'Notes', 7),
      makeFolder('Work', 'Work', 3),
    ];
    const tree = buildFolderTree(folders);
    expect(tree[0].note_count).toBe(7); // '' pinned first
    const work = tree.find((n) => n.path === 'Work')!;
    expect(work.note_count).toBe(3);
  });

  it('"" node has no children (it is a top-level peer, NOT the parent of Work)', () => {
    const folders = [
      makeFolder('', 'Notes', 0),
      makeFolder('Work', 'Work', 0),
    ];
    const tree = buildFolderTree(folders);
    const root = tree.find((n) => n.path === '')!;
    expect(root.children).toHaveLength(0);
    expect(root.isParent).toBe(false);
  });

  it('Work/Projects isParent=false (leaf), depth=1', () => {
    const folders = [makeFolder('Work', 'Work', 0), makeFolder('Work/Projects', 'Projects', 0)];
    const tree = buildFolderTree(folders);
    const work = tree[0];
    const proj = work.children[0];
    expect(proj.path).toBe('Work/Projects');
    expect(proj.depth).toBe(1);
    expect(proj.isParent).toBe(false);
  });
});

describe('G-TREE-BUILD — ancestor synthesis (missing intermediate node)', () => {
  it('synthesizes Work when input has Work/Projects but not Work (no orphan, no throw)', () => {
    const folders = [makeFolder('Work/Projects', 'Projects', 2)];
    let tree: ReturnType<typeof buildFolderTree>;
    expect(() => { tree = buildFolderTree(folders); }).not.toThrow();
    const work = tree!.find((n) => n.path === 'Work');
    expect(work, 'Work should be synthesized').toBeTruthy();
    expect(work!.isParent).toBe(true);
    expect(work!.children[0].path).toBe('Work/Projects');
  });

  it('synthesized ancestor has note_count=0', () => {
    const folders = [makeFolder('Work/Projects', 'Projects', 5)];
    const tree = buildFolderTree(folders);
    const work = tree.find((n) => n.path === 'Work')!;
    expect(work.note_count).toBe(0);
  });

  it('synthesized ancestor has correct name from path segment', () => {
    const folders = [makeFolder('A/B/C', 'C', 0)];
    const tree = buildFolderTree(folders);
    const a = tree.find((n) => n.path === 'A')!;
    const b = a.children.find((n) => n.path === 'A/B')!;
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a.name).toBe('A');
    expect(b.name).toBe('B');
  });

  it('does NOT synthesize an orphan when all ancestors are present', () => {
    const folders = [
      makeFolder('Work', 'Work', 0),
      makeFolder('Work/Projects', 'Projects', 0),
    ];
    const tree = buildFolderTree(folders);
    // Should NOT create a duplicate Work node
    const workNodes = tree.filter((n) => n.path === 'Work');
    expect(workNodes).toHaveLength(1);
  });
});

// ── flattenVisible ─────────────────────────────────────────────────────────────

describe('flattenVisible — honors the expanded Set', () => {
  const folders = [
    makeFolder('', 'Notes', 0),
    makeFolder('Work', 'Work', 0),
    makeFolder('Work/Projects', 'Projects', 0),
    makeFolder('Personal', 'Personal', 0),
  ];

  it('does NOT include Work/Projects when Work is not expanded', () => {
    const tree = buildFolderTree(folders);
    const visible = flattenVisible(tree, new Set());
    expect(visible.map((n) => n.path)).not.toContain('Work/Projects');
  });

  it('DOES include Work/Projects when Work is expanded', () => {
    const tree = buildFolderTree(folders);
    const visible = flattenVisible(tree, new Set(['Work']));
    expect(visible.map((n) => n.path)).toContain('Work/Projects');
  });

  it('returns preorder: ["", "Personal", "Work", "Work/Projects"] when Work expanded', () => {
    const tree = buildFolderTree(folders);
    const visible = flattenVisible(tree, new Set(['Work']));
    expect(visible.map((n) => n.path)).toEqual(['', 'Personal', 'Work', 'Work/Projects']);
  });

  it('returns only top-level nodes when expanded is empty', () => {
    const tree = buildFolderTree(folders);
    const visible = flattenVisible(tree, new Set());
    expect(visible.map((n) => n.path)).toEqual(['', 'Personal', 'Work']);
  });
});

// ── resolveTreeKey — WAI-ARIA APG pure unit cases ────────────────────────────

describe('resolveTreeKey — ArrowDown / ArrowUp', () => {
  const visiblePaths = ['', 'Personal', 'Work'];
  const expandedSet = new Set<string>();
  const isParentMap = new Map([['', false], ['Personal', false], ['Work', false]]);

  it('ArrowDown moves to next visible node', () => {
    const ctx: TreeKeyContext = { visiblePaths, focusedPath: '', expandedSet, isParentMap };
    expect(resolveTreeKey('ArrowDown', ctx)).toEqual({ nextFocusPath: 'Personal' });
  });

  it('ArrowDown at last node is a no-op', () => {
    const ctx: TreeKeyContext = { visiblePaths, focusedPath: 'Work', expandedSet, isParentMap };
    expect(resolveTreeKey('ArrowDown', ctx)).toEqual({});
  });

  it('ArrowUp moves to previous visible node', () => {
    const ctx: TreeKeyContext = { visiblePaths, focusedPath: 'Personal', expandedSet, isParentMap };
    expect(resolveTreeKey('ArrowUp', ctx)).toEqual({ nextFocusPath: '' });
  });

  it('ArrowUp at first node is a no-op', () => {
    const ctx: TreeKeyContext = { visiblePaths, focusedPath: '', expandedSet, isParentMap };
    expect(resolveTreeKey('ArrowUp', ctx)).toEqual({});
  });
});

describe('resolveTreeKey — ArrowRight', () => {
  it('ArrowRight on a collapsed parent returns expand', () => {
    const ctx: TreeKeyContext = {
      visiblePaths: ['Work'],
      focusedPath: 'Work',
      expandedSet: new Set(),
      isParentMap: new Map([['Work', true]]),
    };
    expect(resolveTreeKey('ArrowRight', ctx)).toEqual({ expand: 'Work' });
  });

  it('ArrowRight on an expanded parent moves to first child', () => {
    const ctx: TreeKeyContext = {
      visiblePaths: ['Work', 'Work/Projects'],
      focusedPath: 'Work',
      expandedSet: new Set(['Work']),
      isParentMap: new Map([['Work', true], ['Work/Projects', false]]),
    };
    expect(resolveTreeKey('ArrowRight', ctx)).toEqual({ nextFocusPath: 'Work/Projects' });
  });

  it('ArrowRight on a leaf is a no-op', () => {
    const ctx: TreeKeyContext = {
      visiblePaths: ['Personal'],
      focusedPath: 'Personal',
      expandedSet: new Set(),
      isParentMap: new Map([['Personal', false]]),
    };
    expect(resolveTreeKey('ArrowRight', ctx)).toEqual({});
  });
});

describe('resolveTreeKey — ArrowLeft', () => {
  it('ArrowLeft on an expanded parent returns collapse', () => {
    const ctx: TreeKeyContext = {
      visiblePaths: ['Work', 'Work/Projects'],
      focusedPath: 'Work',
      expandedSet: new Set(['Work']),
      isParentMap: new Map([['Work', true], ['Work/Projects', false]]),
    };
    expect(resolveTreeKey('ArrowLeft', ctx)).toEqual({ collapse: 'Work' });
  });

  it('ArrowLeft on a child moves focus to parent', () => {
    const ctx: TreeKeyContext = {
      visiblePaths: ['Work', 'Work/Projects'],
      focusedPath: 'Work/Projects',
      expandedSet: new Set(['Work']),
      isParentMap: new Map([['Work', true], ['Work/Projects', false]]),
    };
    expect(resolveTreeKey('ArrowLeft', ctx)).toEqual({ nextFocusPath: 'Work' });
  });

  it('ArrowLeft on a collapsed top-level node is a no-op', () => {
    const ctx: TreeKeyContext = {
      visiblePaths: ['Work'],
      focusedPath: 'Work',
      expandedSet: new Set(),
      isParentMap: new Map([['Work', true]]),
    };
    expect(resolveTreeKey('ArrowLeft', ctx)).toEqual({});
  });

  it('ArrowLeft on "" (root peer) is a no-op', () => {
    const ctx: TreeKeyContext = {
      visiblePaths: ['', 'Work'],
      focusedPath: '',
      expandedSet: new Set(),
      isParentMap: new Map([['', false], ['Work', false]]),
    };
    expect(resolveTreeKey('ArrowLeft', ctx)).toEqual({});
  });
});

describe('resolveTreeKey — Home / End', () => {
  const visiblePaths = ['', 'Personal', 'Work'];
  const expandedSet = new Set<string>();
  const isParentMap = new Map([['', false], ['Personal', false], ['Work', false]]);

  it('Home moves to first visible node', () => {
    const ctx: TreeKeyContext = { visiblePaths, focusedPath: 'Work', expandedSet, isParentMap };
    expect(resolveTreeKey('Home', ctx)).toEqual({ nextFocusPath: '' });
  });

  it('End moves to last visible node', () => {
    const ctx: TreeKeyContext = { visiblePaths, focusedPath: '', expandedSet, isParentMap };
    expect(resolveTreeKey('End', ctx)).toEqual({ nextFocusPath: 'Work' });
  });

  it('Home on empty visiblePaths is a no-op', () => {
    const ctx: TreeKeyContext = { visiblePaths: [], focusedPath: '', expandedSet, isParentMap };
    expect(resolveTreeKey('Home', ctx)).toEqual({});
  });
});

describe('resolveTreeKey — Enter / Space', () => {
  const ctx: TreeKeyContext = {
    visiblePaths: ['Work'],
    focusedPath: 'Work',
    expandedSet: new Set(),
    isParentMap: new Map([['Work', false]]),
  };

  it('Enter returns select=true', () => {
    expect(resolveTreeKey('Enter', ctx)).toEqual({ select: true });
  });

  it('Space returns select=true', () => {
    expect(resolveTreeKey(' ', ctx)).toEqual({ select: true });
  });
});

describe('resolveTreeKey — unhandled key', () => {
  it('returns empty object for unhandled keys', () => {
    const ctx: TreeKeyContext = {
      visiblePaths: ['Work'],
      focusedPath: 'Work',
      expandedSet: new Set(),
      isParentMap: new Map([['Work', false]]),
    };
    expect(resolveTreeKey('Tab', ctx)).toEqual({});
    expect(resolveTreeKey('Escape', ctx)).toEqual({});
    expect(resolveTreeKey('a', ctx)).toEqual({});
  });
});
