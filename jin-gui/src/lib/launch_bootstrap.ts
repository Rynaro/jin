import type { LaunchStateDto } from '../types/dto';

/** Keeps the native launch gate explicit and independently testable. */
export function applyLaunchMode(
  launch: LaunchStateDto | null,
  actions: { startReady(): void; startSetup(): void },
): void {
  if (launch?.mode === 'ready') {
    actions.startReady();
    return;
  }
  // An unavailable bridge is treated as setup/recovery only. Product
  // controllers must never attach until a native Ready launch is confirmed.
  actions.startSetup();
}
