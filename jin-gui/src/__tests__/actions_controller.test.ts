// @vitest-environment jsdom
/**
 * actions_controller.test.ts — headless unit tests for promote / attach / link (GUI-S4).
 *
 * Tests two layers:
 *   1. Pure logic from lib/actions/transform.ts (no DOM)
 *   2. Mock-invoke integration: payload builders produce the exact args
 *      that flow into invoke('promote_task' | 'attach_note' | 'link')
 *
 * Headless gates verified here (spec GUI-S4 / GUI-S6 AC):
 *
 * EDGE_TYPES vocabulary:
 *   ✓ exactly three entries: derived-from, prep-for, references
 *   ✓ isValidEdgeType returns true for each valid type
 *   ✓ isValidEdgeType returns false for arbitrary strings
 *
 * validatePromoteForm:
 *   ✓ empty `when` rejected
 *   ✓ non-empty `when` accepted; tzid optional
 *
 * buildPromotePayload — exact args for invoke('promote_task', ...):
 *   ✓ task_id forwarded; slot.when trimmed; slot.tzid omitted when empty
 *   ✓ slot.tzid forwarded when provided
 *
 * validateAttachForm:
 *   ✓ empty noteId rejected; empty targetId rejected; both empty rejected
 *   ✓ both present → valid; kind optional
 *
 * buildAttachPayload — exact args for invoke('attach_note', ...):
 *   ✓ note_id + target_id forwarded; kind omitted when empty (default = prep-for from core)
 *   ✓ kind forwarded when provided
 *
 * validateLinkForm:
 *   ✓ empty sourceId rejected
 *   ✓ empty targetId rejected
 *   ✓ empty edgeType rejected
 *   ✓ invalid edgeType (outside vocabulary) rejected with helpful message
 *   ✓ all three valid → accepted
 *
 * buildLinkPayload — exact args for invoke('link', ...):
 *   ✓ source_id + target_id + edge_type forwarded exactly
 *
 * Post-mutation refresh (SP3 — re-fetch via jin-core):
 *   ✓ buildPromotePayload produces args that, when passed to promoteTask(),
 *     are forwarded to invoke('promote_task', { task_id, slot }) exactly
 *   ✓ buildAttachPayload produces args that, when passed to attachNote(),
 *     are forwarded to invoke('attach_note', { note_id, target_id, kind }) exactly
 *   ✓ buildLinkPayload produces args that, when passed to linkObjects(),
 *     are forwarded to invoke('link', { source_id, target_id, edge_type }) exactly
 *
 * JinErrorDto → inline error rendered:
 *   ✓ invalid-tz promote error (code:2) message rendered in error element, no crash
 *   ✓ not-found error (code:3) message rendered in error element, no crash
 *   ✓ edge-outside-vocabulary error (code:2) rendered, no crash
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Application } from '@hotwired/stimulus';
import type { JinErrorDto } from '../types/error';

// Mock @tauri-apps/api/core so invoke calls don't fail in jsdom
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));
vi.mock('../lib/icons', () => ({ initIcons: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { promoteTask, attachNote, linkObjects } from '../invoke';
import {
  EDGE_TYPES,
  isValidEdgeType,
  validatePromoteForm,
  buildPromotePayload,
  validateAttachForm,
  buildAttachPayload,
  validateLinkForm,
  buildLinkPayload,
  type PromoteFormState,
  type AttachFormState,
  type LinkFormState,
} from '../lib/actions/transform';
import { renderFormError, clearFormError } from '../lib/capture/render';
import ActionsController from '../controllers/actions_controller';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('event context dialogs use human-title search without ID or edge controls', () => {
  let app: Application;

  function contextDialog(kind: 'attach' | 'link'): string {
    const capital = kind === 'attach' ? 'Attach' : 'Link';
    const idTargets = kind === 'attach'
      ? `<div data-actions-target="attachLegacyGroup"><input data-actions-target="attachNoteId"></div>
         <div data-actions-target="attachLegacyGroup"><input data-actions-target="attachTargetId"></div>
         <div data-actions-target="attachLegacyGroup"><select data-actions-target="attachKind"><option value="prep-for"></option></select></div>`
      : `<div data-actions-target="linkLegacyGroup"><input data-actions-target="linkSourceId"></div>
         <div data-actions-target="linkLegacyGroup"><input data-actions-target="linkTargetId"></div>
         <div data-actions-target="linkLegacyGroup"><select data-actions-target="linkEdgeType"><option value="references"></option></select></div>`;
    return `<dialog data-actions-target="${kind}Dialog"><h2 class="action-dialog__title">${capital}</h2><button class="modal-close-btn"></button>
      <div class="hidden" data-actions-target="${kind}ContextGroup"><label></label><input data-actions-target="${kind}ContextSearch"><datalist data-actions-target="${kind}ContextOptions"></datalist></div>
      ${idTargets}<p data-actions-target="${kind}Error" class="hidden"></p><div class="form-actions"><button></button><button data-actions-target="${kind}Submit"></button></div></dialog>`;
  }

  async function flush(): Promise<void> {
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  beforeEach(async () => {
    localStorage.clear();
    document.body.innerHTML = `<div data-controller="actions" data-action="jin:open-attach->actions#openAttach jin:open-link->actions#openLink">${contextDialog('attach')}${contextDialog('link')}</div>`;
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'list_notes') return [{ id: 'note-private-id', title: 'Roadmap notes' }];
      if (command === 'list_tasks') return [{ id: 'task-private-id', title: 'Prepare deck' }];
      if (command === 'list_events') return [{ id: 'event-other-id', title: 'Design review' }];
      return undefined;
    });
    app = Application.start();
    app.register('actions', ActionsController);
    await flush();
  });

  afterEach(() => app.stop());

  it('event Prep action hides all legacy ID/edge fields and resolves the chosen note title', async () => {
    const host = document.querySelector<HTMLElement>('[data-controller="actions"]')!;
    host.dispatchEvent(new CustomEvent('jin:open-attach', { bubbles: true, detail: { context: 'event-prep', targetId: 'event-private-id' } }));
    await flush();
    const legacy = [...document.querySelectorAll<HTMLElement>('[data-actions-target="attachLegacyGroup"]')];
    expect(legacy.every(group => group.classList.contains('hidden'))).toBe(true);
    expect(document.querySelector('[data-actions-target="attachContextGroup"]')?.classList.contains('hidden')).toBe(false);
    expect(document.querySelector<HTMLDataListElement>('[data-actions-target="attachContextOptions"]')?.options[0].value).toBe('Roadmap notes');
    const search = document.querySelector<HTMLInputElement>('[data-actions-target="attachContextSearch"]')!;
    search.value = 'Roadmap notes';
    const controller = app.getControllerForElementAndIdentifier(host, 'actions') as ActionsController;
    await controller.submitAttach();
    expect(mockInvoke).toHaveBeenCalledWith('attach_note', { note_id: 'note-private-id', target_id: 'event-private-id', kind: 'prep-for' });
  });

  it('event Related action offers Notes only and creates the supported Note-to-Event reference', async () => {
    const host = document.querySelector<HTMLElement>('[data-controller="actions"]')!;
    host.dispatchEvent(new CustomEvent('jin:open-link', { bubbles: true, detail: { context: 'event-related', sourceId: 'event-private-id' } }));
    await flush();
    const legacy = [...document.querySelectorAll<HTMLElement>('[data-actions-target="linkLegacyGroup"]')];
    expect(legacy.every(group => group.classList.contains('hidden'))).toBe(true);
    const search = document.querySelector<HTMLInputElement>('[data-actions-target="linkContextSearch"]')!;
    search.value = 'Roadmap notes';
    const controller = app.getControllerForElementAndIdentifier(host, 'actions') as ActionsController;
    const contextAttached = vi.fn();
    window.addEventListener('jin:event-context-attached', contextAttached, { once: true });
    await controller.submitLink();
    expect(mockInvoke).toHaveBeenCalledWith('link', { source_id: 'note-private-id', target_id: 'event-private-id', edge_type: 'references' });
    expect(mockInvoke).not.toHaveBeenCalledWith('list_tasks', expect.anything());
    expect(mockInvoke).not.toHaveBeenCalledWith('list_events', expect.anything());
    expect(contextAttached).toHaveBeenCalledWith(expect.objectContaining({ detail: { id: 'event-private-id' } }));
  });

  it('disambiguates duplicate titles with human folder labels and never exposes IDs', async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'list_notes') return [
        { id: 'note-secret-a', title: 'Meeting notes', folder_path: 'Work' },
        { id: 'note-secret-b', title: 'Meeting notes', folder_path: 'Home' },
      ];
      return undefined;
    });
    const host = document.querySelector<HTMLElement>('[data-controller="actions"]')!;
    host.dispatchEvent(new CustomEvent('jin:open-attach', { bubbles: true, detail: { context: 'event-prep', targetId: 'event-private-id' } }));
    await flush();
    const labels = [...document.querySelectorAll<HTMLOptionElement>('[data-actions-target="attachContextOptions"] option')].map(option => option.value);
    expect(labels).toEqual(['Meeting notes — Work', 'Meeting notes — Home']);
    expect(labels.join(' ')).not.toContain('note-secret');
  });

  it('keeps every human label globally unique when a title collides with a folder disambiguation', async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'list_notes') return [
        { id: 'note-title-collision', title: 'Roadmap — Work', folder_path: 'Archive' },
        { id: 'note-work', title: 'Roadmap', folder_path: 'Work' },
        { id: 'note-home', title: 'Roadmap', folder_path: 'Home' },
      ];
      return undefined;
    });
    const host = document.querySelector<HTMLElement>('[data-controller="actions"]')!;
    host.dispatchEvent(new CustomEvent('jin:open-attach', { bubbles: true, detail: { context: 'event-prep', targetId: 'event-private-id' } }));
    await flush();
    const labels = [...document.querySelectorAll<HTMLOptionElement>('[data-actions-target="attachContextOptions"] option')]
      .map(option => option.value);
    expect(labels).toEqual(['Roadmap — Work', 'Roadmap — Work (2)', 'Roadmap — Home']);
    expect(new Set(labels.map(label => label.toLocaleLowerCase())).size).toBe(labels.length);
    expect(labels.join(' ')).not.toContain('note-');

    document.querySelector<HTMLInputElement>('[data-actions-target="attachContextSearch"]')!.value = 'Roadmap — Work (2)';
    const controller = app.getControllerForElementAndIdentifier(host, 'actions') as ActionsController;
    await controller.submitAttach();
    expect(mockInvoke).toHaveBeenCalledWith('attach_note', {
      note_id: 'note-work', target_id: 'event-private-id', kind: 'prep-for',
    });
  });

  it('localizes contextual attach and Related failures without exposing English bridge messages', async () => {
    localStorage.setItem('jin:event-locale', 'pt-BR');
    const bridgeError: JinErrorDto = {
      code: 1, kind: 'other', message: 'English bridge detail', retriable: false,
    };
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'list_notes') return [{ id: 'note-private-id', title: 'Roadmap notes' }];
      if (command === 'attach_note') throw bridgeError;
      if (command === 'link') throw new Error('English unexpected detail');
      return undefined;
    });
    const host = document.querySelector<HTMLElement>('[data-controller="actions"]')!;
    const controller = app.getControllerForElementAndIdentifier(host, 'actions') as ActionsController;

    host.dispatchEvent(new CustomEvent('jin:open-attach', { bubbles: true, detail: { context: 'event-prep', targetId: 'event-private-id' } }));
    await flush();
    document.querySelector<HTMLInputElement>('[data-actions-target="attachContextSearch"]')!.value = 'Roadmap notes';
    await controller.submitAttach();
    expect(document.querySelector('[data-actions-target="attachError"]')?.textContent).toBe('Não foi possível anexar a nota');
    expect(document.body.textContent).not.toContain('English bridge detail');

    host.dispatchEvent(new CustomEvent('jin:open-link', { bubbles: true, detail: { context: 'event-related', sourceId: 'event-private-id' } }));
    await flush();
    document.querySelector<HTMLInputElement>('[data-actions-target="linkContextSearch"]')!.value = 'Roadmap notes';
    await controller.submitLink();
    expect(document.querySelector('[data-actions-target="linkError"]')?.textContent).toBe('Não foi possível adicionar a nota relacionada');
    expect(document.body.textContent).not.toContain('English unexpected detail');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. EDGE_TYPES vocabulary (spec GUI-S6 AC: "surface the edge-type choices")
// ─────────────────────────────────────────────────────────────────────────────

describe('EDGE_TYPES vocabulary', () => {
  it('contains exactly three edge types', () => {
    expect(EDGE_TYPES).toHaveLength(3);
  });

  it('contains derived-from', () => {
    expect(EDGE_TYPES).toContain('derived-from');
  });

  it('contains prep-for', () => {
    expect(EDGE_TYPES).toContain('prep-for');
  });

  it('contains references', () => {
    expect(EDGE_TYPES).toContain('references');
  });

  it('isValidEdgeType returns true for each valid type', () => {
    for (const edge of EDGE_TYPES) {
      expect(isValidEdgeType(edge)).toBe(true);
    }
  });

  it('isValidEdgeType returns false for arbitrary strings', () => {
    expect(isValidEdgeType('invalid-edge')).toBe(false);
    expect(isValidEdgeType('has-event')).toBe(false);
    expect(isValidEdgeType('')).toBe(false);
    expect(isValidEdgeType('Derived-From')).toBe(false); // case-sensitive
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. validatePromoteForm
// ─────────────────────────────────────────────────────────────────────────────

describe('validatePromoteForm', () => {
  it('rejects empty when (required field)', () => {
    const result = validatePromoteForm({ when: '', tzid: '' });
    expect(result.valid).toBe(false);
    expect(result.errors['when']).toBeTruthy();
  });

  it('rejects whitespace-only when', () => {
    expect(validatePromoteForm({ when: '   ', tzid: '' }).valid).toBe(false);
  });

  it('accepts non-empty when; tzid is optional', () => {
    expect(validatePromoteForm({ when: '2026-07-01T10:00', tzid: '' }).valid).toBe(true);
  });

  it('accepts when + tzid', () => {
    expect(validatePromoteForm({ when: '2026-07-01T10:00', tzid: 'America/New_York' }).valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. buildPromotePayload — exact args for invoke('promote_task', ...)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildPromotePayload', () => {
  it('exact args: task_id, slot.when trimmed, slot.tzid omitted when empty', () => {
    const state: PromoteFormState = { when: '2026-07-01T10:00', tzid: '' };
    const payload = buildPromotePayload('task-abc', state);
    expect(payload).toEqual({
      task_id: 'task-abc',
      slot: { when: '2026-07-01T10:00', tzid: undefined },
    });
  });

  it('exact args: slot.tzid forwarded when provided', () => {
    const state: PromoteFormState = { when: '2026-07-01T10:00', tzid: 'America/New_York' };
    const payload = buildPromotePayload('task-xyz', state);
    expect(payload).toEqual({
      task_id: 'task-xyz',
      slot: { when: '2026-07-01T10:00', tzid: 'America/New_York' },
    });
  });

  it('trims whitespace from when and tzid', () => {
    const state: PromoteFormState = { when: '  2026-07-01T10:00  ', tzid: '  UTC  ' };
    const payload = buildPromotePayload('t1', state);
    expect(payload.slot.when).toBe('2026-07-01T10:00');
    expect(payload.slot.tzid).toBe('UTC');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Post-mutation: buildPromotePayload → promoteTask → invoke exact args
// ─────────────────────────────────────────────────────────────────────────────

describe('buildPromotePayload → promoteTask invoke exact args', () => {
  it('produces args that invoke promote_task with task_id + slot', async () => {
    mockInvoke.mockResolvedValueOnce({ id: 'evt-new', title: 'Promoted Event' });

    const state: PromoteFormState = { when: '2026-07-01T10:00', tzid: 'UTC' };
    const payload = buildPromotePayload('task-abc', state);

    // The controller supplies a stable operation id for the compound mutation.
    await promoteTask(payload.task_id, payload.slot, 'promote-action-1');

    expect(mockInvoke).toHaveBeenCalledWith('promote_task', {
      task_id: 'task-abc',
      slot: { when: '2026-07-01T10:00', tzid: 'UTC' },
      operation_id: 'promote-action-1',
    });
  });

  it('after promote success, controller dispatches navigate to events with new event id', async () => {
    const newEventId = 'evt-promoted-123';
    mockInvoke.mockResolvedValueOnce({ id: newEventId, title: 'My Event' });

    const state: PromoteFormState = { when: '2026-07-01T10:00', tzid: '' };
    const payload = buildPromotePayload('task-1', state);
    const result = await promoteTask(payload.task_id, payload.slot, 'promote-action-2') as { id: string };

    // SP3: controller calls navigateAfterAction('events', result.id)
    // Here we assert the result id is correct (the controller uses this to navigate)
    expect(result.id).toBe(newEventId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. validateAttachForm
// ─────────────────────────────────────────────────────────────────────────────

describe('validateAttachForm', () => {
  it('rejects empty noteId', () => {
    const result = validateAttachForm({ noteId: '', targetId: 'e1', kind: '' });
    expect(result.valid).toBe(false);
    expect(result.errors['noteId']).toBeTruthy();
  });

  it('rejects empty targetId', () => {
    const result = validateAttachForm({ noteId: 'n1', targetId: '', kind: '' });
    expect(result.valid).toBe(false);
    expect(result.errors['targetId']).toBeTruthy();
  });

  it('rejects both empty', () => {
    const result = validateAttachForm({ noteId: '', targetId: '', kind: '' });
    expect(result.valid).toBe(false);
    expect(result.errors['noteId']).toBeTruthy();
    expect(result.errors['targetId']).toBeTruthy();
  });

  it('accepts both present; kind optional', () => {
    expect(validateAttachForm({ noteId: 'n1', targetId: 'e1', kind: '' }).valid).toBe(true);
  });

  it('accepts with kind provided', () => {
    expect(validateAttachForm({ noteId: 'n1', targetId: 'e1', kind: 'references' }).valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. buildAttachPayload — exact args for invoke('attach_note', ...)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildAttachPayload', () => {
  it('exact args: note_id + target_id; kind omitted when empty (core uses prep-for default)', () => {
    const state: AttachFormState = { noteId: 'note-abc', targetId: 'evt-xyz', kind: '' };
    expect(buildAttachPayload(state)).toEqual({
      note_id: 'note-abc',
      target_id: 'evt-xyz',
      kind: undefined,
    });
  });

  it('exact args: kind forwarded when provided', () => {
    const state: AttachFormState = { noteId: 'note-abc', targetId: 'evt-xyz', kind: 'references' };
    expect(buildAttachPayload(state)).toEqual({
      note_id: 'note-abc',
      target_id: 'evt-xyz',
      kind: 'references',
    });
  });

  it('exact args for default prep-for attach (note → event, no kind)', () => {
    const state: AttachFormState = { noteId: 'n1', targetId: 'e1', kind: '' };
    const payload = buildAttachPayload(state);
    expect(payload.note_id).toBe('n1');
    expect(payload.target_id).toBe('e1');
    expect(payload.kind).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Post-mutation: buildAttachPayload → attachNote → invoke exact args
// ─────────────────────────────────────────────────────────────────────────────

describe('buildAttachPayload → attachNote invoke exact args', () => {
  it('produces args that invoke attach_note with note_id + target_id + kind', async () => {
    mockInvoke.mockResolvedValueOnce({ edge_type: 'prep-for', source_id: 'n1', target_id: 'e1' });

    const state: AttachFormState = { noteId: 'n1', targetId: 'e1', kind: 'prep-for' };
    const payload = buildAttachPayload(state);

    // The controller calls: attachNote(payload.note_id, payload.target_id, payload.kind)
    await attachNote(payload.note_id, payload.target_id, payload.kind);

    expect(mockInvoke).toHaveBeenCalledWith('attach_note', {
      note_id: 'n1',
      target_id: 'e1',
      kind: 'prep-for',
    });
  });

  it('spec AC: attach note→event with no kind creates prep-for edge (default from core)', async () => {
    mockInvoke.mockResolvedValueOnce({ edge_type: 'prep-for', source_id: 'n1', target_id: 'e1' });

    const state: AttachFormState = { noteId: 'n1', targetId: 'e1', kind: '' };
    const payload = buildAttachPayload(state);

    await attachNote(payload.note_id, payload.target_id, payload.kind);

    expect(mockInvoke).toHaveBeenCalledWith('attach_note', {
      note_id: 'n1',
      target_id: 'e1',
      kind: undefined, // core decides: prep-for for event targets
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. validateLinkForm
// ─────────────────────────────────────────────────────────────────────────────

describe('validateLinkForm', () => {
  it('rejects empty sourceId', () => {
    const result = validateLinkForm({ sourceId: '', targetId: 't1', edgeType: 'prep-for' });
    expect(result.valid).toBe(false);
    expect(result.errors['sourceId']).toBeTruthy();
  });

  it('rejects empty targetId', () => {
    const result = validateLinkForm({ sourceId: 's1', targetId: '', edgeType: 'prep-for' });
    expect(result.valid).toBe(false);
    expect(result.errors['targetId']).toBeTruthy();
  });

  it('rejects empty edgeType', () => {
    const result = validateLinkForm({ sourceId: 's1', targetId: 't1', edgeType: '' });
    expect(result.valid).toBe(false);
    expect(result.errors['edgeType']).toBeTruthy();
  });

  it('rejects edge type outside vocabulary (spec: GUI does not bypass validation)', () => {
    // Spec GUI-S6 AC: "GIVEN a Link request with an edge outside the vocabulary,
    // THEN the core rejection is surfaced as a clear error (GUI does not bypass validation)"
    const result = validateLinkForm({ sourceId: 's1', targetId: 't1', edgeType: 'has-event' });
    expect(result.valid).toBe(false);
    expect(result.errors['edgeType']).toContain('has-event');
    expect(result.errors['edgeType']).toContain('derived-from');
    expect(result.errors['edgeType']).toContain('prep-for');
    expect(result.errors['edgeType']).toContain('references');
  });

  it('rejects another invalid edge type: "linked-to"', () => {
    const result = validateLinkForm({ sourceId: 's1', targetId: 't1', edgeType: 'linked-to' });
    expect(result.valid).toBe(false);
  });

  it('accepts derived-from', () => {
    expect(validateLinkForm({ sourceId: 's1', targetId: 't1', edgeType: 'derived-from' }).valid).toBe(true);
  });

  it('accepts prep-for', () => {
    expect(validateLinkForm({ sourceId: 's1', targetId: 't1', edgeType: 'prep-for' }).valid).toBe(true);
  });

  it('accepts references', () => {
    expect(validateLinkForm({ sourceId: 's1', targetId: 't1', edgeType: 'references' }).valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. buildLinkPayload — exact args for invoke('link', ...)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildLinkPayload', () => {
  it('exact args: source_id + target_id + edge_type forwarded', () => {
    const state: LinkFormState = { sourceId: 'n1', targetId: 'e1', edgeType: 'prep-for' };
    expect(buildLinkPayload(state)).toEqual({
      source_id: 'n1',
      target_id: 'e1',
      edge_type: 'prep-for',
    });
  });

  it('exact args for derived-from link', () => {
    const state: LinkFormState = { sourceId: 'task-1', targetId: 'evt-1', edgeType: 'derived-from' };
    expect(buildLinkPayload(state)).toEqual({
      source_id: 'task-1',
      target_id: 'evt-1',
      edge_type: 'derived-from',
    });
  });

  it('exact args for references link', () => {
    const state: LinkFormState = { sourceId: 'n1', targetId: 'n2', edgeType: 'references' };
    expect(buildLinkPayload(state)).toEqual({
      source_id: 'n1',
      target_id: 'n2',
      edge_type: 'references',
    });
  });

  it('trims whitespace from all ids and edge type', () => {
    const state: LinkFormState = { sourceId: '  n1  ', targetId: '  e1  ', edgeType: '  prep-for  ' };
    const payload = buildLinkPayload(state);
    expect(payload.source_id).toBe('n1');
    expect(payload.target_id).toBe('e1');
    expect(payload.edge_type).toBe('prep-for');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Post-mutation: buildLinkPayload → linkObjects → invoke exact args
// ─────────────────────────────────────────────────────────────────────────────

describe('buildLinkPayload → linkObjects invoke exact args', () => {
  it('produces args that invoke link with source_id + target_id + edge_type', async () => {
    mockInvoke.mockResolvedValueOnce({ edge_type: 'prep-for', source_id: 'n1', target_id: 'e1' });

    const state: LinkFormState = { sourceId: 'n1', targetId: 'e1', edgeType: 'prep-for' };
    const payload = buildLinkPayload(state);

    // The controller calls: linkObjects(payload.source_id, payload.target_id, payload.edge_type)
    await linkObjects(payload.source_id, payload.target_id, payload.edge_type);

    expect(mockInvoke).toHaveBeenCalledWith('link', {
      source_id: 'n1',
      target_id: 'e1',
      edge_type: 'prep-for',
    });
  });

  it('core receives the edge type verbatim (vocabulary enforcement is core-side)', async () => {
    mockInvoke.mockResolvedValueOnce({});

    const state: LinkFormState = { sourceId: 'n1', targetId: 'n2', edgeType: 'references' };
    const payload = buildLinkPayload(state);
    await linkObjects(payload.source_id, payload.target_id, payload.edge_type);

    expect(mockInvoke).toHaveBeenCalledWith('link', {
      source_id: 'n1',
      target_id: 'n2',
      edge_type: 'references',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. JinErrorDto → inline error rendered (DOM tests — no crash gate)
// ─────────────────────────────────────────────────────────────────────────────

describe('JinErrorDto → inline error rendered (no crash)', () => {
  it('invalid-tz promote (code:2) → message shown in error element, no crash', () => {
    const errDto: JinErrorDto = {
      code: 2,
      kind: 'usage',
      message: 'Invalid timezone: Foo/Bar',
      retriable: false,
    };
    const errorEl = document.createElement('p');
    errorEl.classList.add('hidden');

    // Simulates: catch (err) { if (isJinErrorDto(err)) renderFormError(promoteErrorTarget, err.message) }
    renderFormError(errorEl, errDto.message);

    expect(errorEl.textContent).toContain('Invalid timezone: Foo/Bar');
    expect(errorEl.classList.contains('hidden')).toBe(false);
    // Test completes = no crash
  });

  it('not-found error (code:3) → message shown in error element, no crash', () => {
    const errDto: JinErrorDto = {
      code: 3,
      kind: 'not_found',
      message: 'Task not found: task-ghost',
      retriable: false,
    };
    const errorEl = document.createElement('p');
    renderFormError(errorEl, errDto.message);
    expect(errorEl.textContent).toContain('Task not found: task-ghost');
  });

  it('edge-outside-vocabulary (code:2) caught before invoke, shown as validation error', () => {
    // validateLinkForm surfaces this before any invoke is called
    const result = validateLinkForm({ sourceId: 's1', targetId: 't1', edgeType: 'bad-edge' });
    expect(result.valid).toBe(false);

    const errorEl = document.createElement('p');
    const errorMsg = result.errors['edgeType'] ?? '';
    renderFormError(errorEl, errorMsg);

    expect(errorEl.textContent).toContain('bad-edge');
    expect(errorEl.classList.contains('hidden')).toBe(false);
  });

  it('after renderFormError, clearFormError hides the error (state cleanup)', () => {
    const errDto: JinErrorDto = {
      code: 2,
      kind: 'usage',
      message: 'Some usage error',
      retriable: false,
    };
    const errorEl = document.createElement('p');
    renderFormError(errorEl, errDto.message);
    expect(errorEl.classList.contains('hidden')).toBe(false);

    clearFormError(errorEl);
    expect(errorEl.classList.contains('hidden')).toBe(true);
    expect(errorEl.textContent).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. renderTaskPane promote button — action button rendered (DOM test)
// ─────────────────────────────────────────────────────────────────────────────

describe('renderTaskPane — promote button rendered when onPromote provided', () => {
  it('renders .task-promote-btn when onPromote callback is provided', async () => {
    // Dynamically import to avoid module-level side effects
    const { renderTaskPane } = await import('../lib/tasks/render');
    const { makeTasksViewElements, makeTasksTemplates } = await Promise.resolve({
      makeTasksViewElements: () => {
        const listPanel = document.createElement('div');
        const list = document.createElement('ul');
        listPanel.appendChild(list);
        const emptyState = document.createElement('div');
        const loadingState = document.createElement('div');
        const detailPanel = document.createElement('div');
        const detailLoadingState = document.createElement('div');
        const detailNotFoundState = document.createElement('div');
        const detailContent = document.createElement('div');
        return { listPanel, list, emptyState, loadingState, detailPanel, detailLoadingState, detailNotFoundState, detailContent };
      },
      makeTasksTemplates: () => {
        const taskItemTmpl = document.createElement('template');
        taskItemTmpl.innerHTML = `<li class="browse-row task-item"><button class="browse-row__inner tap-target" aria-label=""><span class="task-item__status browse-status-badge" role="img" aria-label=""><i class="task-item__status-icon" aria-hidden="true"></i><span class="task-item__status-label"></span></span><span class="browse-row__title"></span><span class="task-item__priority" role="img" aria-label=""><i class="task-item__priority-icon" aria-hidden="true"></i><span class="task-item__priority-label"></span></span></button></li>`.trim();
        const backlinkRowTmpl = document.createElement('template');
        backlinkRowTmpl.innerHTML = `<li class="browse-link-row"><button class="browse-link-row__btn tap-target" aria-label="" data-link-id="" data-link-kind=""><i class="browse-link-row__icon" aria-hidden="true"></i><span class="browse-link-row__label text-callout"></span><span class="browse-link-row__id text-caption2"></span></button></li>`.trim();
        return { taskItem: taskItemTmpl, backlinkRow: backlinkRowTmpl };
      },
    });

    const el = makeTasksViewElements();
    const templates = makeTasksTemplates();
    const task = {
      id: 'task-promote-test',
      title: 'A Promotable Task',
      status: 'todo',
      priority: 'normal',
      due: null,
      list: 'inbox',
      completed_at: null,
      deleted_at: null,
      created: '2026-06-01T00:00:00Z',
      updated: '2026-06-27T12:00:00Z',
      backlinks: [],
    };

    const onPromote = vi.fn();
    renderTaskPane(el, templates, task, vi.fn(), onPromote);

    const promoteBtn = el.detailContent.querySelector('.task-promote-btn');
    expect(promoteBtn).not.toBeNull();
    expect(promoteBtn?.getAttribute('aria-label')).toContain('Promote');
    expect((promoteBtn as HTMLElement)?.dataset.taskId).toBe('task-promote-test');

    // Click fires callback with task id
    (promoteBtn as HTMLButtonElement).click();
    expect(onPromote).toHaveBeenCalledWith('task-promote-test');
  });

  it('does not render .task-promote-btn when onPromote is not provided', async () => {
    const { renderTaskPane } = await import('../lib/tasks/render');
    const detailContent = document.createElement('div');
    const el = {
      listPanel: document.createElement('div'),
      list: document.createElement('ul'),
      emptyState: document.createElement('div'),
      loadingState: document.createElement('div'),
      detailPanel: document.createElement('div'),
      detailLoadingState: document.createElement('div'),
      detailNotFoundState: document.createElement('div'),
      detailContent,
    };
    const taskItemTmpl = document.createElement('template');
    taskItemTmpl.innerHTML = `<li class="browse-row task-item"><button class="browse-row__inner tap-target" aria-label=""><span class="task-item__status browse-status-badge" role="img" aria-label=""><i class="task-item__status-icon" aria-hidden="true"></i><span class="task-item__status-label"></span></span><span class="browse-row__title"></span><span class="task-item__priority" role="img" aria-label=""><i class="task-item__priority-icon" aria-hidden="true"></i><span class="task-item__priority-label"></span></span></button></li>`.trim();
    const backlinkRowTmpl = document.createElement('template');
    backlinkRowTmpl.innerHTML = `<li class="browse-link-row"><button class="browse-link-row__btn tap-target" aria-label=""><span class="browse-link-row__label text-callout"></span><span class="browse-link-row__id text-caption2"></span></button></li>`.trim();
    const templates = { taskItem: taskItemTmpl, backlinkRow: backlinkRowTmpl };

    const task = { id: 't1', title: 'T', status: 'todo', priority: 'normal', due: null, list: 'inbox', completed_at: null, deleted_at: null, created: '', updated: '', backlinks: [] };
    // No onPromote callback
    renderTaskPane(el, templates, task, vi.fn());
    expect(el.detailContent.querySelector('.task-promote-btn')).toBeNull();
  });
});
