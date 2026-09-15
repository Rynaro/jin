import { describe, expect, it, vi } from 'vitest';
import { applyLaunchMode } from '../lib/launch_bootstrap';

describe('native launch bootstrap gate', () => {
  it('starts product controllers only for Ready', () => {
    const startReady = vi.fn(); const startSetup = vi.fn();
    applyLaunchMode({ mode: 'ready', root: '/Jin' }, { startReady, startSetup });
    expect(startReady).toHaveBeenCalledOnce();
    expect(startSetup).not.toHaveBeenCalled();
  });

  it('keeps FirstRun, root recovery, and bridge failure outside product controllers', () => {
    for (const launch of [
      { mode: 'first_run' as const, state: { schema_version: 1, status: 'in_progress' as const, step: 'welcome' as const, selected_root: null }, suggested_root: '/Jin' },
      { mode: 'root_unavailable' as const, root: '/Missing', reason: 'missing', env_locked: false },
      null,
    ]) {
      const startReady = vi.fn(); const startSetup = vi.fn();
      applyLaunchMode(launch, { startReady, startSetup });
      expect(startReady).not.toHaveBeenCalled();
      expect(startSetup).toHaveBeenCalledOnce();
    }
  });
});
