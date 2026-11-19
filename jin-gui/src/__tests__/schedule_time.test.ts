// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Application } from '@hotwired/stimulus';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../lib/icons', () => ({ initIcons: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';
import ActionsController from '../controllers/actions_controller';
import CalendarViewController from '../controllers/calendar_view_controller';
import { buildPromotePayload, validatePromoteForm } from '../lib/actions/transform';

const call = vi.mocked(invoke);
const index = readFileSync(new NodeURL('../../index.html', import.meta.url), 'utf8');
const dialogMarkup = index.slice(index.lastIndexOf('<dialog', index.indexOf('id="jin-promote-dialog"')), index.indexOf('</dialog>', index.indexOf('id="jin-promote-dialog"')) + 9);
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
let app: Application;
let host: HTMLElement;
let controller: ActionsController;

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = `<div data-controller="actions">${dialogMarkup}</div>`;
  host = document.querySelector('[data-controller=actions]')!;
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
  call.mockReset().mockImplementation(async command => {
    if (command === 'list_google_accounts' || command === 'list_events') return [];
    if (command === 'promote_task') return { id: 'block-1', title: 'Follow up' };
    return undefined;
  });
  app = Application.start();
  app.register('actions', ActionsController);
  await flush();
  controller = app.getControllerForElementAndIdentifier(host, 'actions') as ActionsController;
});
afterEach(() => { app.stop(); document.body.replaceChildren(); });

function open(): void {
  controller.openPromote(new CustomEvent('jin:open-promote', { detail: { taskId: 'task-1', when: '2026-11-19T14:30', tzid: 'America/Sao_Paulo' } }));
}

describe('review task scheduling', () => {
  it('prefills selected Calendar date and duration and cancellation performs no mutation', async () => {
    open(); await flush();
    expect(controller.promoteWhenTarget.value).toBe('2026-11-19T14:30');
    expect(controller.promoteDurationTarget.value).toBe('60');
    expect(controller.promoteTzidTarget.value).toBe('America/Sao_Paulo');
    controller.closePromote();
    expect(controller.promoteDialogTarget.open).toBe(false);
    expect(call.mock.calls.some(([command]) => command === 'promote_task')).toBe(false);
  });

  it('sends chosen length and reuses submission identity after a transient failure', async () => {
    open(); await flush();
    const operations: unknown[] = [];
    call.mockImplementation(async (command, args) => {
      if (command === 'promote_task') {
        const input = args as Record<string, unknown>;
        operations.push(input.operation_id);
        expect(input.duration_minutes).toBe(45);
        expect(input.slot).toEqual({ when: '2026-11-19T14:30', tzid: 'America/Sao_Paulo' });
        if (operations.length === 1) throw new Error('temporary failure');
        return { id: 'block-1' };
      }
      return [];
    });
    controller.promoteDurationTarget.value = '45';
    await controller.submitPromote();
    expect(controller.promoteDialogTarget.open).toBe(true);
    expect(controller.promoteDurationTarget.disabled).toBe(true);
    controller.promoteDurationTarget.value = '120';
    await controller.submitPromote();
    expect(operations).toHaveLength(2);
    expect(operations[0]).toBe(operations[1]);
    expect(controller.promoteDialogTarget.open).toBe(false);
  });

  it('opens an existing time block without presenting a false reschedule form', async () => {
    call.mockImplementation(async command => command === 'list_events'
      ? [{ id: 'existing', derived_from: 'task-1', title: 'Review', status: 'confirmed' }]
      : []);
    const navigate = vi.fn();
    host.addEventListener('jin:navigate', navigate);
    open(); await flush();
    expect(controller.promoteExistingTarget.textContent).toContain('already has a time block');
    expect(controller.promoteSubmitTarget.hidden).toBe(true);
    controller.promoteExistingTarget.querySelector('button')!.click();
    expect(navigate).toHaveBeenCalled();
    expect((navigate.mock.calls[0][0] as CustomEvent).detail.id).toBe('existing');
    expect(call.mock.calls.some(([command]) => command === 'promote_task')).toBe(false);
  });

  it('unlocks reviewed fields for a structured validation error before a write', async () => {
    open(); await flush();
    const attempts: Array<Record<string, unknown>> = [];
    call.mockImplementation(async (command, args) => {
      if (command !== 'promote_task') return [];
      attempts.push(args as Record<string, unknown>);
      if (attempts.length === 1) throw { code: 2, kind: 'usage', message: 'Choose another time outside the DST gap.', retriable: false };
      return { id: 'block-1' };
    });
    await controller.submitPromote();
    expect(controller.promoteDurationTarget.disabled).toBe(false);
    expect(controller.promoteErrorTarget.textContent).toBe('Choose another time outside the DST gap.');
    controller.promoteDurationTarget.value = '30';
    await controller.submitPromote();
    expect(attempts[1].duration_minutes).toBe(30);
    expect(attempts[1].operation_id).not.toBe(attempts[0].operation_id);
  });

  it('waits for existing block discovery before accepting a submission', async () => {
    let finish!: (value: unknown) => void;
    call.mockImplementation(async command => command === 'list_events'
      ? await new Promise(resolve => { finish = resolve; }) : []);
    open();
    await controller.submitPromote();
    expect(call.mock.calls.some(([command]) => command === 'promote_task')).toBe(false);
    expect(controller.promoteSubmitTarget.disabled).toBe(true);
    finish([]);
    await flush();
    expect(controller.promoteSubmitTarget.disabled).toBe(false);
  });

  it('requires an explicit destination when several writable calendars exist', async () => {
    call.mockImplementation(async command => {
      if (command === 'list_google_accounts') return [{ id: 'work', alias: 'Work', state: 'connected', calendars: [
        { calendar_id: 'one', name: 'One', enabled: true, available: true, writable: true },
        { calendar_id: 'two', name: 'Two', enabled: true, available: true, writable: true },
      ] }];
      if (command === 'promote_task') return { id: 'block-1' };
      return [];
    });
    open(); await flush();
    await controller.submitPromote();
    expect(controller.promoteErrorTarget.textContent).toContain('Choose an exact account and calendar');
    expect(call.mock.calls.some(([command]) => command === 'promote_task')).toBe(false);
    controller.promoteDestinationTarget.value = 'work\u0000two';
    await controller.submitPromote();
    expect(call).toHaveBeenCalledWith('promote_task', expect.objectContaining({ account_id: 'work', calendar_id: 'two' }));
  });

  it('rejects invalid lengths and keeps the legacy payload unchanged when omitted', () => {
    for (const durationMinutes of ['0', '1441', '1.5', '', '-2']) {
      expect(validatePromoteForm({ when: '2026-11-19T14:30', tzid: '', durationMinutes }).valid).toBe(false);
    }
    expect(buildPromotePayload('task-1', { when: '2026-11-19T14:30', tzid: '' }).slot).not.toHaveProperty('duration_minutes');
  });

  it('Calendar unscheduled task opens review before any write', async () => {
    const calendar = Object.create(CalendarViewController.prototype) as CalendarViewController;
    const dispatch = vi.fn();
    Object.defineProperty(calendar, 'dispatch', { value: dispatch });
    await calendar.promoteTaskToEvent('task-1', '2026-11-21');
    expect(dispatch).toHaveBeenCalledWith('open-promote', expect.objectContaining({
      prefix: 'jin', bubbles: true, detail: expect.objectContaining({ taskId: 'task-1', when: '2026-11-21T09:00:00' }),
    }));
    expect(call.mock.calls.some(([command]) => command === 'promote_task')).toBe(false);
  });
});
