/**
 * Single app-navigation guard slot.
 *
 * Companion (and any future dirty surface) installs one guard while open.
 * RouterController consults it before committing a section change. Companion
 * modes themselves never write location.hash or history — only app routes do.
 */

import type { ViewKind } from '../router';

export interface NavigationIntent {
  kind: ViewKind;
  detailId?: string;
}

export type NavigationGuard = (
  intent: NavigationIntent,
) => boolean | Promise<boolean>;

let activeGuard: NavigationGuard | null = null;

/** Install or clear the single navigation guard. Pass null to uninstall. */
export function installNavigationGuard(guard: NavigationGuard | null): void {
  activeGuard = guard;
}

/**
 * Ask the installed guard whether navigation may proceed.
 * Returns true when no guard is installed (unguarded paths stay synchronous).
 */
export function consultNavigationGuard(
  intent: NavigationIntent,
): boolean | Promise<boolean> {
  if (!activeGuard) return true;
  return activeGuard(intent);
}
