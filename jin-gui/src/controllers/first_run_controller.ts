import { Controller } from '@hotwired/stimulus';

import {
  chooseFirstRunRoot,
  completeFirstRun,
  getLaunchState,
  recoverStoreRoot,
  retryRootUnavailable,
  saveFirstRunStep,
  selectFirstRunRoot,
} from '../invoke';
import {
  type Appearance,
  type AppearancePrefs,
  applyToRoot,
  clampTextScale,
  loadPrefs,
  savePrefs,
} from '../lib/appearance/state';
import type { FirstRunStateDto, FirstRunStepDto, LaunchStateDto } from '../types/dto';

const STEPS: FirstRunStepDto[] = ['welcome', 'storage', 'functions', 'settings', 'review'];

/**
 * The only product controller allowed before a root is initialized. It keeps
 * setup presentation local while native commands own durable progress and
 * initialization. Normal controllers are registered only after Ready.
 */
export default class FirstRunController extends Controller {
  static targets = [
    'step', 'railItem', 'heading', 'error', 'selectedRoot', 'reviewRoot',
    'appearanceButton', 'textSize', 'reduceMotion', 'finish', 'recovery', 'reviewAppearance', 'reviewTextSize', 'reviewMotion', 'eyebrow',
  ];

  declare stepTargets: HTMLElement[];
  declare railItemTargets: HTMLElement[];
  declare headingTargets: HTMLElement[];
  declare errorTarget: HTMLElement;
  declare selectedRootTarget: HTMLElement;
  declare reviewRootTarget: HTMLElement;
  declare appearanceButtonTargets: HTMLButtonElement[];
  declare textSizeTarget: HTMLInputElement;
  declare reduceMotionTarget: HTMLInputElement;
  declare finishTarget: HTMLButtonElement;
  declare recoveryTarget: HTMLElement;
  declare reviewAppearanceTarget: HTMLElement;
  declare reviewTextSizeTarget: HTMLElement;
  declare reviewMotionTarget: HTMLElement;
  declare eyebrowTarget: HTMLElement;

  private state: FirstRunStateDto | null = null;
  private suggestedRoot = '';
  private prefs: AppearancePrefs = loadPrefs();

  async connect(): Promise<void> {
    this.applyPrefs();
    try {
      const launch = await getLaunchState();
      this.renderLaunch(launch);
    } catch (error) {
      this.showError(this.message(error, 'Jin could not load setup. Reload and try again.'));
    }
  }

  async next(): Promise<void> {
    if (!this.state) return;
    const index = STEPS.indexOf(this.state.step);
    if (this.state.step === 'storage' && !this.state.selected_root) {
      this.showError('Choose a storage folder to continue.');
      return;
    }
    await this.moveTo(STEPS[Math.min(index + 1, STEPS.length - 1)]);
  }

  async previous(): Promise<void> {
    if (!this.state) return;
    const index = STEPS.indexOf(this.state.step);
    await this.moveTo(STEPS[Math.max(index - 1, 0)]);
  }

  async chooseFolder(): Promise<void> {
    this.clearError();
    try {
      const path = await chooseFirstRunRoot();
      if (!path) return;
      this.state = await selectFirstRunRoot(path);
      this.render();
    } catch (error) {
      this.showError(this.message(error, 'That folder could not be selected.'));
    }
  }

  async useSuggestedFolder(): Promise<void> {
    if (!this.suggestedRoot) return;
    this.clearError();
    try {
      this.state = await selectFirstRunRoot(this.suggestedRoot);
      this.render();
    } catch (error) {
      this.showError(this.message(error, 'That folder could not be selected.'));
    }
  }

  async chooseReplacement(): Promise<void> {
    this.clearError();
    try {
      const path = await chooseFirstRunRoot();
      if (!path) return;
      this.recoveryTarget.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = true; });
      await recoverStoreRoot(path);
      this.recoveryTarget.querySelector<HTMLElement>('[data-first-run-recovery-message]')!.textContent = 'Restarting Jin with the replacement folder…';
    } catch (error) {
      this.recoveryTarget.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = false; });
      this.showError(this.message(error, 'That replacement folder could not be prepared.'));
    }
  }

  setAppearance(event: Event): void {
    const appearance = (event.currentTarget as HTMLElement).dataset.appearance as Appearance | undefined;
    if (!appearance || !['auto', 'light', 'dark'].includes(appearance)) return;
    this.prefs = { ...this.prefs, appearance };
    this.applyPrefs();
  }

  setTextSize(event: Event): void {
    const scale = (event.currentTarget as HTMLInputElement).valueAsNumber;
    this.prefs = { ...this.prefs, textSizeScale: clampTextScale(scale) };
    this.applyPrefs();
  }

  setReduceMotion(event: Event): void {
    this.prefs = { ...this.prefs, reduceMotion: (event.currentTarget as HTMLInputElement).checked };
    this.applyPrefs();
  }

  async finish(): Promise<void> {
    if (!this.state?.selected_root) {
      this.showError('Choose a storage folder before finishing setup.');
      return;
    }
    this.element.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = true; });
    this.finishTarget.disabled = true;
    this.finishTarget.textContent = 'Preparing Jin…';
    this.clearError();
    try {
      await completeFirstRun();
      this.finishTarget.textContent = 'Restarting Jin…';
    } catch (error) {
      this.element.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = false; });
      this.finishTarget.textContent = 'Finish setup';
      this.showError(this.message(error, 'Jin could not prepare that folder. Your setup progress is saved; try again.'));
    }
  }

  async retry(): Promise<void> {
    this.clearError();
    try {
      await retryRootUnavailable();
      this.recoveryTarget.querySelector<HTMLElement>('[data-first-run-recovery-message]')!.textContent = 'Restarting Jin…';
    } catch (error) {
      this.showError(this.message(error, 'Jin still cannot open that storage folder.'));
    }
  }

  private async moveTo(step: FirstRunStepDto): Promise<void> {
    this.clearError();
    try {
      this.state = await saveFirstRunStep(step);
      this.render();
    } catch (error) {
      this.showError(this.message(error, 'Your setup progress could not be saved. Try again.'));
    }
  }

  private renderLaunch(launch: LaunchStateDto): void {
    if (launch.mode === 'first_run') {
      this.state = launch.state;
      this.suggestedRoot = launch.suggested_root;
      this.eyebrowTarget.textContent = 'First-time setup';
      this.render();
      return;
    }
    this.stepTargets.forEach((step) => { step.hidden = true; });
    this.railItemTargets.forEach((item) => item.hidden = true);
    this.recoveryTarget.hidden = false;
    this.eyebrowTarget.textContent = 'Storage recovery';
    this.recoveryTarget.querySelector<HTMLElement>('[data-first-run-recovery-message]')!.textContent =
      launch.mode === 'root_unavailable'
        ? `${launch.reason} ${launch.root} ${launch.env_locked ? 'Update JIN_ROOT, then restart Jin.' : 'Restore that folder, then try again.'}`
        : 'Jin is ready. Restart the window to continue.';
    this.recoveryTarget.querySelector<HTMLButtonElement>('[data-first-run-retry]')!.hidden = launch.mode !== 'root_unavailable' || launch.env_locked;
    this.recoveryTarget.querySelector<HTMLButtonElement>('[data-first-run-replace]')!.hidden = launch.mode !== 'root_unavailable' || launch.env_locked;
    this.recoveryTarget.querySelector<HTMLButtonElement>('[data-first-run-retry]')!.focus();
  }

  private render(): void {
    if (!this.state) return;
    const active = this.state.step;
    this.stepTargets.forEach((step) => { step.hidden = step.dataset.firstRunStep !== active; });
    this.railItemTargets.forEach((item) => {
      const current = item.dataset.firstRunRail === active;
      item.setAttribute('aria-current', current ? 'step' : 'false');
      item.classList.toggle('is-current', current);
      item.classList.toggle('is-complete', STEPS.indexOf(item.dataset.firstRunRail as FirstRunStepDto) < STEPS.indexOf(active));
    });
    this.selectedRootTarget.textContent = this.state.selected_root ?? 'No folder selected yet';
    this.reviewRootTarget.textContent = this.state.selected_root ?? 'No folder selected yet';
    this.appearanceButtonTargets.forEach((button) => {
      const selected = button.dataset.appearance === this.prefs.appearance;
      button.setAttribute('aria-pressed', String(selected));
    });
    this.textSizeTarget.value = String(this.prefs.textSizeScale);
    this.reduceMotionTarget.checked = this.prefs.reduceMotion;
    this.reviewAppearanceTarget.textContent = this.prefs.appearance === 'auto' ? 'Automatic' : this.prefs.appearance[0].toUpperCase() + this.prefs.appearance.slice(1);
    this.reviewTextSizeTarget.textContent = `${Math.round(this.prefs.textSizeScale * 100)}%`;
    this.reviewMotionTarget.textContent = this.prefs.reduceMotion ? 'Reduced motion' : 'Standard motion';
    const suggested = this.element.querySelector<HTMLElement>('[data-first-run-suggested]');
    if (suggested) suggested.textContent = this.suggestedRoot;
    const heading = this.headingTargets.find((item) => item.closest('[data-first-run-step]')?.getAttribute('data-first-run-step') === active);
    heading?.focus();
  }

  private applyPrefs(): void {
    applyToRoot(document.documentElement, this.prefs);
    savePrefs(this.prefs);
    this.appearanceButtonTargets?.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.appearance === this.prefs.appearance));
    });
  }

  private showError(message: string): void {
    this.errorTarget.textContent = message;
    this.errorTarget.hidden = false;
  }

  private clearError(): void {
    this.errorTarget.textContent = '';
    this.errorTarget.hidden = true;
  }

  private message(error: unknown, fallback: string): string {
    if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') return error.message;
    return typeof error === 'string' ? error : fallback;
  }
}
