// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import FirstRunController from '../controllers/first_run_controller';

const mockInvoke = vi.mocked(invoke);

function view() {
  document.body.innerHTML = `
    <section>
      <ol><li data-first-run-rail="welcome"></li><li data-first-run-rail="storage"></li><li data-first-run-rail="functions"></li><li data-first-run-rail="settings"></li><li data-first-run-rail="review"></li></ol>
      <p data-first-run-eyebrow></p>
      <section data-first-run-step="welcome"><h1 tabindex="-1"></h1></section>
      <section data-first-run-step="storage"><h1 tabindex="-1"></h1></section>
      <section data-first-run-step="functions"><h1 tabindex="-1"></h1></section>
      <section data-first-run-step="settings"><h1 tabindex="-1"></h1></section>
      <section data-first-run-step="review"><h1 tabindex="-1"></h1></section>
      <output></output><output></output><output></output><output></output><output></output>
      <button data-appearance="auto"></button><button data-appearance="light"></button><button data-appearance="dark"></button>
      <input type="range"><input type="checkbox"><button>Finish setup</button><aside><p data-first-run-recovery-message></p><button data-first-run-retry></button><button data-first-run-replace></button></aside><p role="alert"></p>
    </section>`;
  const root = document.body.firstElementChild as HTMLElement;
  const outputs = root.querySelectorAll('output');
  const context = {
    element: root,
    state: { schema_version: 1, status: 'in_progress', step: 'settings', selected_root: '/Users/fixture/Jin' },
    suggestedRoot: '/Users/fixture/Jin',
    prefs: { appearance: 'dark', reduceTransparency: false, increaseContrast: false, reduceMotion: true, textSizeScale: 1.24 },
    stepTargets: [...root.querySelectorAll<HTMLElement>('[data-first-run-step]')],
    railItemTargets: [...root.querySelectorAll<HTMLElement>('[data-first-run-rail]')],
    headingTargets: [...root.querySelectorAll<HTMLElement>('h1')],
    selectedRootTarget: outputs[0], reviewRootTarget: outputs[1], reviewAppearanceTarget: outputs[2], reviewTextSizeTarget: outputs[3], reviewMotionTarget: outputs[4],
    appearanceButtonTargets: [...root.querySelectorAll<HTMLButtonElement>('[data-appearance]')],
    textSizeTarget: root.querySelector<HTMLInputElement>('[type=range]')!, reduceMotionTarget: root.querySelector<HTMLInputElement>('[type=checkbox]')!,
    finishTarget: root.querySelectorAll<HTMLButtonElement>('button')[3], recoveryTarget: root.querySelector<HTMLElement>('aside')!, errorTarget: root.querySelector<HTMLElement>('[role=alert]')!,
    eyebrowTarget: root.querySelector<HTMLElement>('[data-first-run-eyebrow]')!,
  };
  return context;
}

beforeEach(() => { mockInvoke.mockReset(); localStorage.clear(); });

describe('FirstRunController', () => {
  it('renders only the durable current step, completed rail, selected storage, and effective preferences', () => {
    const context = view();
    (FirstRunController.prototype as unknown as { render(): void }).render.call(context);
    expect(context.stepTargets.find((step) => !step.hidden)?.dataset.firstRunStep).toBe('settings');
    expect(context.railItemTargets[3].getAttribute('aria-current')).toBe('step');
    expect(context.railItemTargets[0].classList.contains('is-complete')).toBe(true);
    expect(context.selectedRootTarget.textContent).toBe('/Users/fixture/Jin');
    expect(context.reviewAppearanceTarget.textContent).toBe('Dark');
    expect(context.reviewTextSizeTarget.textContent).toBe('124%');
    expect(context.reviewMotionTarget.textContent).toBe('Reduced motion');
    expect(document.activeElement).toBe(context.headingTargets[3]);
  });

  it('keeps storage unchanged when the native picker is cancelled', async () => {
    const context = view();
    context.state.step = 'storage';
    context.state.selected_root = null;
    context.clearError = vi.fn(); context.showError = vi.fn(); context.render = vi.fn();
    mockInvoke.mockResolvedValueOnce(null);
    await (FirstRunController.prototype as unknown as { chooseFolder(): Promise<void> }).chooseFolder.call(context);
    expect(mockInvoke).toHaveBeenCalledWith('choose_first_run_root', {});
    expect(context.state.selected_root).toBeNull();
    expect(context.render).not.toHaveBeenCalled();
  });

  it('disables all setup buttons when Finish begins and surfaces a retryable failure', async () => {
    const context = view();
    context.clearError = vi.fn(); context.showError = vi.fn(); context.message = (error: { message: string }) => error.message;
    mockInvoke.mockRejectedValueOnce({ message: 'Folder is temporarily unavailable.' });
    await (FirstRunController.prototype as unknown as { finish(): Promise<void> }).finish.call(context);
    expect(mockInvoke).toHaveBeenCalledWith('complete_first_run', {});
    expect([...context.element.querySelectorAll<HTMLButtonElement>('button')].every((button) => !button.disabled)).toBe(true);
    expect(context.showError).toHaveBeenCalledWith('Folder is temporarily unavailable.');
  });

  it('uses native restart recovery rather than revealing the product shell in this process', async () => {
    const context = view();
    context.clearError = vi.fn(); context.showError = vi.fn(); context.message = (error: { message: string }) => error.message;
    mockInvoke.mockResolvedValueOnce(undefined);
    await (FirstRunController.prototype as unknown as { retry(): Promise<void> }).retry.call(context);
    expect(mockInvoke).toHaveBeenCalledWith('retry_root_unavailable', {});
    expect(context.recoveryTarget.querySelector('[data-first-run-recovery-message]')?.textContent).toBe('Restarting Jin…');
    expect(context.element.querySelector('.jin-shell')).toBeNull();
  });
});
