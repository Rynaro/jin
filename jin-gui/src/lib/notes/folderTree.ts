/**
 * notes/folderTree.ts — PURE tree builder, flatten-visible, and keyboard-nav resolver.
 *
 * NO DOM imports. NO render-lib imports. Zero side effects.
 * Tested by: src/__tests__/folderTree.test.ts (pure), notes_controller.test.ts (integrated)
 *
 * D-ROOT-NODE: '' ("Notes") is a top-level peer at depth 0, NOT the parent of user folders.
 * Depth = path.split('/').length - 1  ('' -> 0, 'Work' -> 0, 'Work/Projects' -> 1).
 */

import type { FolderDto } from '../../types/dto';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TreeNode {
  path: string;
  name: string;
  note_count: number;
  depth: number;
  children: TreeNode[];
  isParent: boolean;
}

export interface TreeKeyContext {
  /** Ordered visible paths (from flattenVisible). */
  visiblePaths: string[];
  /** Path of the currently focused treeitem. */
  focusedPath: string;
  /** Set of currently expanded parent paths. */
  expandedSet: Set<string>;
  /** Map path -> isParent (true = has children). */
  isParentMap: Map<string, boolean>;
}

export interface TreeKeyResult {
  /** Move focus to this path (roving tabindex + .focus()). */
  nextFocusPath?: string;
  /** Expand this path (add to expanded Set + show group). */
  expand?: string;
  /** Collapse this path (remove from expanded Set + hide group). */
  collapse?: string;
  /** Fire select / activate for the focused path. */
  select?: boolean;
}

// ── buildFolderTree ───────────────────────────────────────────────────────────

/**
 * buildFolderTree — build a nested TreeNode tree from the flat FolderDto[] returned
 * by list_folders. Synthesizes missing ancestor nodes (note_count=0, name=segment).
 *
 * Siblings are sorted lexicographically; '' is pinned first at the top level.
 */
export function buildFolderTree(folders: FolderDto[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();

  /** Get or create a node; real note_count always wins over a synthesized 0. */
  function getOrCreate(path: string, name: string, noteCount: number): TreeNode {
    if (nodeMap.has(path)) {
      const existing = nodeMap.get(path)!;
      if (noteCount > 0) existing.note_count = noteCount;
      if (name && !existing.name) existing.name = name;
      return existing;
    }
    const depth = path === '' ? 0 : path.split('/').length - 1;
    const node: TreeNode = { path, name, note_count: noteCount, depth, children: [], isParent: false };
    nodeMap.set(path, node);
    return node;
  }

  for (const folder of folders) {
    if (folder.path !== '') {
      // Ensure all ancestors exist (synthesize missing ones defensively).
      const segments = folder.path.split('/');
      for (let i = 1; i < segments.length; i++) {
        const ancestorPath = segments.slice(0, i).join('/');
        if (!nodeMap.has(ancestorPath)) {
          getOrCreate(ancestorPath, segments[i - 1], 0);
        }
      }
    }
    getOrCreate(folder.path, folder.name, folder.note_count);
  }

  // Wire parent-child relationships and collect top-level nodes.
  const topLevel: TreeNode[] = [];
  for (const [path, node] of nodeMap) {
    if (path === '') {
      // Root peer '' is always top-level.
      topLevel.push(node);
    } else {
      const segments = path.split('/');
      if (segments.length === 1) {
        // 1-segment paths (e.g. 'Work') are top-level user folders.
        topLevel.push(node);
      } else {
        // N>=2: parent = first N-1 segments joined.
        const parentPath = segments.slice(0, -1).join('/');
        const parent = nodeMap.get(parentPath);
        if (parent) {
          parent.children.push(node);
          parent.isParent = true;
        }
      }
    }
  }

  // Sort: '' first, then lexicographic; sort children recursively.
  function sortNodes(nodes: TreeNode[]): void {
    nodes.sort((a, b) => {
      if (a.path === '') return -1;
      if (b.path === '') return 1;
      return a.path.localeCompare(b.path);
    });
    for (const node of nodes) sortNodes(node.children);
  }
  sortNodes(topLevel);

  return topLevel;
}

// ── flattenVisible ────────────────────────────────────────────────────────────

/**
 * flattenVisible — depth-first preorder traversal that includes a node's children
 * only if node.path is in the expanded Set.
 *
 * Returns the ordered list of visible TreeNodes (drives keyboard nav prev/next order
 * and the row rendering sequence).
 */
export function flattenVisible(tree: TreeNode[], expanded: Set<string>): TreeNode[] {
  const result: TreeNode[] = [];

  function traverse(nodes: TreeNode[]): void {
    for (const node of nodes) {
      result.push(node);
      if (node.isParent && expanded.has(node.path)) {
        traverse(node.children);
      }
    }
  }

  traverse(tree);
  return result;
}

// ── resolveTreeKey ────────────────────────────────────────────────────────────

/**
 * resolveTreeKey — PURE WAI-ARIA Tree View keyboard resolver (APG pattern).
 *
 * Given the current navigation context and a key name, returns the state changes
 * to apply. NO DOM access, NO side effects.
 *
 * Key map (WAI-ARIA APG Tree View):
 *   ↓/↑     — move focus to next/prev visible node
 *   →       — expand collapsed parent ELSE move to first child; leaf: no-op
 *   ←       — collapse expanded parent ELSE move to parent; top-level: no-op
 *   Home    — first visible node
 *   End     — last visible node
 *   Enter/Space — select (activate) the focused node
 */
export function resolveTreeKey(key: string, ctx: TreeKeyContext): TreeKeyResult {
  const { visiblePaths, focusedPath, expandedSet, isParentMap } = ctx;
  const focusedIdx = visiblePaths.indexOf(focusedPath);

  switch (key) {
    case 'ArrowDown': {
      if (focusedIdx < visiblePaths.length - 1) {
        return { nextFocusPath: visiblePaths[focusedIdx + 1] };
      }
      return {};
    }
    case 'ArrowUp': {
      if (focusedIdx > 0) {
        return { nextFocusPath: visiblePaths[focusedIdx - 1] };
      }
      return {};
    }
    case 'ArrowRight': {
      const isParent = isParentMap.get(focusedPath) ?? false;
      if (!isParent) return {}; // leaf: no-op
      if (!expandedSet.has(focusedPath)) {
        return { expand: focusedPath };
      }
      // Already expanded: move to first child (next in visible list).
      if (focusedIdx + 1 < visiblePaths.length) {
        return { nextFocusPath: visiblePaths[focusedIdx + 1] };
      }
      return {};
    }
    case 'ArrowLeft': {
      const isParent = isParentMap.get(focusedPath) ?? false;
      if (isParent && expandedSet.has(focusedPath)) {
        return { collapse: focusedPath };
      }
      // Move to parent — only possible for multi-segment paths.
      if (focusedPath !== '' && focusedPath.includes('/')) {
        const parentPath = focusedPath.split('/').slice(0, -1).join('/');
        if (visiblePaths.includes(parentPath)) {
          return { nextFocusPath: parentPath };
        }
      }
      return {};
    }
    case 'Home': {
      if (visiblePaths.length > 0) return { nextFocusPath: visiblePaths[0] };
      return {};
    }
    case 'End': {
      if (visiblePaths.length > 0) return { nextFocusPath: visiblePaths[visiblePaths.length - 1] };
      return {};
    }
    case 'Enter':
    case ' ':
      return { select: true };
    default:
      return {};
  }
}
