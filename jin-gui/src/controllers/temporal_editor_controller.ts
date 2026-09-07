import { Controller } from '@hotwired/stimulus';
import { composeDueString, decomposeDueString } from '../lib/calendar/transform';
import { normalizeClockInput } from '../lib/calendar/clock';
import {
  formatNaturalDateResult,
  naturalDateErrorMessage,
  parseNaturalDateTime,
  type NaturalDateResult,
} from '../lib/calendar/natural_language';
import { eventMessage, resolveEventLocale } from '../lib/events/locale';
import type CalendarController from './calendar_controller';

export type TemporalEditorCommit =
  | { kind: 'set'; due: string; date: string; time: string }
  | { kind: 'clear' };

export interface TemporalEditorSession {
  initialDue: string | null;
  onCommit: (result: TemporalEditorCommit) => void;
  restoreFocusTo?: HTMLElement | null;
  presentation?: 'task' | 'event' | 'notification';
  requireDate?: boolean;
  requireTime?: boolean;
  validate?: (result: Extract<TemporalEditorCommit, { kind: 'set' }>) => string | null;
}

/** Owns the draft/commit lifecycle around the shared CalendarController grid. */
export default class TemporalEditorController extends Controller<HTMLDialogElement> {
  static targets = ['title', 'calendar', 'naturalLabel', 'natural', 'naturalPreview', 'naturalUse', 'timeLabel', 'time', 'summary', 'error', 'confirm'];

  declare titleTarget: HTMLElement;
  declare calendarTarget: HTMLElement;
  declare naturalLabelTarget: HTMLLabelElement;
  declare naturalTarget: HTMLInputElement;
  declare naturalPreviewTarget: HTMLElement;
  declare naturalUseTarget: HTMLButtonElement;
  declare timeLabelTarget: HTMLElement;
  declare timeTarget: HTMLInputElement;
  declare summaryTarget: HTMLElement;
  declare errorTarget: HTMLElement;
  declare confirmTarget: HTMLButtonElement;

  private draftDate = '';
  private session: TemporalEditorSession | null = null;
  private restoreFocusTo: HTMLElement | null = null;
  private naturalResult: Extract<NaturalDateResult, { ok: true }> | null = null;

  disconnect(): void {
    this.session = null;
    this.restoreFocusTo = null;
  }

  open(session: TemporalEditorSession): void {
    if (this.session) this.finish(false);

    const parts = decomposeDueString(session.initialDue);
    this.session = session;
    this.restoreFocusTo = session.restoreFocusTo
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    this.draftDate = parts.date;
    this.timeTarget.value = parts.time;
    this.naturalTarget.value = '';
    this.naturalResult = null;
    this.applyPresentation(session.presentation ?? 'task');
    this.localizeNaturalInput();
    this.calendarController()?.setInitial(parts.date || null);
    this.clearValidation();
    this.updateSummary();
    this.element.showModal();
    setTimeout(() => {
      if (this.session === session) this.calendarController()?.focusSelected();
    }, 0);
  }

  select(event: CustomEvent<{ iso?: string }>): void {
    if (!this.session) return;
    this.draftDate = event.detail.iso ?? '';
    if (!this.draftDate) this.timeTarget.value = '';
    this.clearValidation();
    this.updateSummary();
  }

  timeChanged(): void {
    if (!this.session) return;
    this.clearValidation();
    this.updateSummary();
  }

  normalizeTime(): void {
    if (!this.session) return;
    const normalized = normalizeClockInput(this.timeTarget.value);
    if (!normalized.ok) {
      this.showValidation(eventMessage('invalidTime', resolveEventLocale()));
      return;
    }
    this.timeTarget.value = normalized.time ?? '';
    this.clearValidation();
    this.updateSummary();
  }

  naturalChanged(): void {
    if (!this.session) return;
    const locale = resolveEventLocale();
    const result = parseNaturalDateTime({
      input: this.naturalTarget.value,
      today: this.todayIso(),
      locale,
    });
    if (result.ok) {
      this.naturalResult = result;
      this.naturalPreviewTarget.textContent = formatNaturalDateResult(result, locale);
      this.naturalPreviewTarget.dataset.state = 'valid';
    } else {
      this.naturalResult = null;
      this.naturalPreviewTarget.textContent = naturalDateErrorMessage(result.code, locale);
      this.naturalPreviewTarget.dataset.state = 'error';
    }
  }

  applyNatural(event?: Event): void {
    event?.preventDefault();
    if (!this.session) return;
    this.naturalChanged();
    const result = this.naturalResult;
    if (!result) return;
    this.draftDate = result.date;
    if (result.time) this.timeTarget.value = result.time;
    this.calendarController()?.setInitial(result.date);
    this.clearValidation();
    this.updateSummary();
  }

  confirm(): void {
    if (!this.session) return;
    const normalized = normalizeClockInput(this.timeTarget.value);
    if (!normalized.ok) {
      this.showValidation(eventMessage('invalidTime', resolveEventLocale()));
      this.timeTarget.focus();
      return;
    }
    const time = normalized.time ?? '';
    this.timeTarget.value = time;
    if (time && !this.draftDate) {
      this.showValidation('Choose a date before adding a time.');
      this.timeTarget.focus();
      return;
    }
    if (this.session.requireDate && !this.draftDate) {
      this.showValidation(this.session.presentation === 'notification'
        ? 'Choose a date to defer this notification.'
        : 'Choose a date for this event.');
      this.calendarController()?.focusSelected();
      return;
    }
    if (this.session.requireTime && !time) {
      this.showValidation('Choose a time to defer this notification.');
      this.timeTarget.focus();
      return;
    }

    const callback = this.session.onCommit;
    const result: TemporalEditorCommit = this.draftDate
      ? {
          kind: 'set',
          due: composeDueString(this.draftDate, time),
          date: this.draftDate,
          time,
        }
      : { kind: 'clear' };
    if (result.kind === 'set') {
      const validation = this.session.validate?.(result);
      if (validation) {
        this.showValidation(validation);
        return;
      }
    }
    this.finish(true);
    callback(result);
  }

  cancelDraft(event?: Event): void {
    event?.preventDefault();
    if (!this.session) return;
    this.finish(true);
  }

  backdrop(event: MouseEvent): void {
    if (event.target === this.element) this.cancelDraft(event);
  }

  private finish(restoreFocus: boolean): void {
    const focusTarget = this.restoreFocusTo;
    this.session = null;
    this.restoreFocusTo = null;
    this.draftDate = '';
    this.naturalResult = null;
    this.naturalTarget.value = '';
    this.timeTarget.value = '';
    this.clearValidation();
    if (this.element.open) this.element.close();
    if (restoreFocus && focusTarget?.isConnected) focusTarget.focus();
  }

  private updateSummary(): void {
    const eventPresentation = this.session?.presentation === 'event';
    const notificationPresentation = this.session?.presentation === 'notification';
    if (!this.draftDate) {
      this.summaryTarget.textContent = notificationPresentation
        ? 'Choose a date and time'
        : eventPresentation ? 'Choose a date' : 'No due date selected';
      return;
    }
    const time = this.timeTarget.value.trim();
    this.summaryTarget.textContent = notificationPresentation
      ? (time ? `Defer until ${this.draftDate} at ${time}` : `Defer on ${this.draftDate}; choose a time`)
      : eventPresentation
      ? (time ? `${this.draftDate} at ${time}` : `${this.draftDate} · All day`)
      : (time ? `Due ${this.draftDate} at ${time}` : `Due ${this.draftDate}, no time`);
  }

  private applyPresentation(presentation: 'task' | 'event' | 'notification'): void {
    const eventPresentation = presentation === 'event';
    const notificationPresentation = presentation === 'notification';
    this.titleTarget.textContent = notificationPresentation ? 'Custom defer time' : eventPresentation ? 'When' : 'Set Due Date';
    this.element.setAttribute('aria-label', notificationPresentation
      ? 'Choose custom defer date and time'
      : eventPresentation ? 'Set event date and time' : 'Set due date');
    this.timeLabelTarget.textContent = notificationPresentation
      ? 'Time'
      : eventPresentation ? 'Time (leave blank for all day)' : 'Time (optional)';
    this.timeTarget.setAttribute('aria-label', notificationPresentation
      ? 'Defer time'
      : eventPresentation ? 'Event time (optional)' : 'Due time (optional)');
    this.confirmTarget.textContent = notificationPresentation ? 'Defer notification' : eventPresentation ? 'Set When' : 'Set Date';
  }

  private showValidation(message: string): void {
    this.errorTarget.textContent = message;
    this.errorTarget.classList.remove('hidden');
  }

  private clearValidation(): void {
    this.errorTarget.textContent = '';
    this.errorTarget.classList.add('hidden');
  }

  private localizeNaturalInput(): void {
    const locale = resolveEventLocale();
    this.naturalLabelTarget.textContent = eventMessage('dateTime', locale);
    this.naturalTarget.placeholder = eventMessage('relativePlaceholder', locale);
    this.naturalUseTarget.textContent = eventMessage('use', locale);
    this.naturalPreviewTarget.textContent = eventMessage('relativeHint', locale);
    this.naturalPreviewTarget.dataset.state = '';
  }

  private todayIso(): string {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  }

  private calendarController(): CalendarController | null {
    return this.application.getControllerForElementAndIdentifier(
      this.calendarTarget,
      'calendar',
    ) as CalendarController | null;
  }
}
