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
  onCancel?: () => void;
  restoreFocusTo?: HTMLElement | null;
  presentation?: 'task' | 'event' | 'notification' | 'recurrence' | 'review';
  requireDate?: boolean;
  requireTime?: boolean;
  validate?: (result: Extract<TemporalEditorCommit, { kind: 'set' }>) => string | null;
  /** Workspace civil date for the review workflow's today/floor semantics. */
  reviewToday?: string;
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
    const onCancel = this.session?.onCancel;
    this.session = null;
    this.restoreFocusTo = null;
    onCancel?.();
  }

  open(session: TemporalEditorSession): void {
    if (this.session) {
      const onCancel = this.session.onCancel; this.finish(false); onCancel?.();
    }

    const parts = decomposeDueString(session.initialDue);
    const reviewToday = this.reviewToday(session);
    const initialDate = parts.date && (!reviewToday || parts.date >= reviewToday) ? parts.date : '';
    this.session = session;
    this.restoreFocusTo = session.restoreFocusTo
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    this.draftDate = initialDate;
    this.timeTarget.value = parts.time;
    this.naturalTarget.value = '';
    this.naturalResult = null;
    this.applyPresentation(session.presentation ?? 'task');
    this.localizeNaturalInput();
    const calendar = this.calendarController();
    calendar?.setDateContext({ min: reviewToday || null, today: reviewToday || null });
    calendar?.setInitial(initialDate || null);
    this.clearValidation();
    this.updateSummary();
    this.element.showModal();
    setTimeout(() => {
      if (this.session === session) this.calendarController()?.focusSelected();
    }, 0);
  }

  select(event: CustomEvent<{ iso?: string }>): void {
    if (!this.session) return;
    const date = event.detail.iso ?? '';
    if (date && this.isBeforeMinimum(date)) {
      this.showValidation('Choose today or a future date for check back.');
      return;
    }
    this.draftDate = date;
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
      if (this.isBeforeMinimum(result.date)) {
        this.naturalResult = null;
        this.naturalPreviewTarget.textContent = 'Choose today or a future date for check back.';
        this.naturalPreviewTarget.dataset.state = 'error';
        return;
      }
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
    if (this.session.presentation !== 'recurrence' && this.session.presentation !== 'review' && result.time) this.timeTarget.value = result.time;
    this.calendarController()?.setInitial(result.date);
    this.clearValidation();
    this.updateSummary();
  }

  confirm(): void {
    if (!this.session) return;
    const dateOnly = this.session.presentation === 'recurrence' || this.session.presentation === 'review';
    const normalized = normalizeClockInput(dateOnly ? '' : this.timeTarget.value);
    if (!normalized.ok) {
      this.showValidation(eventMessage('invalidTime', resolveEventLocale()));
      this.timeTarget.focus();
      return;
    }
    const time = dateOnly ? '' : normalized.time ?? '';
    this.timeTarget.value = time;
    if (this.draftDate && this.isBeforeMinimum(this.draftDate)) {
      this.showValidation('Choose today or a future date for check back.');
      this.calendarController()?.focusSelected();
      return;
    }
    if (time && !this.draftDate) {
      this.showValidation('Choose a date before adding a time.');
      this.timeTarget.focus();
      return;
    }
    if (this.session.requireDate && !this.draftDate) {
      this.showValidation(this.session.presentation === 'notification'
        ? 'Choose a date to defer this notification.'
        : this.session.presentation === 'review'
          ? 'Choose a check-back date.'
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
    const onCancel = this.session.onCancel;
    this.finish(true);
    onCancel?.();
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
    const recurrencePresentation = this.session?.presentation === 'recurrence';
    const reviewPresentation = this.session?.presentation === 'review';
    this.confirmTarget.disabled = reviewPresentation && !this.draftDate;
    if (!this.draftDate) {
      this.summaryTarget.textContent = notificationPresentation
        ? 'Choose a date and time'
        : eventPresentation || recurrencePresentation || reviewPresentation ? 'Choose a date' : 'No due date selected';
      return;
    }
    const time = this.timeTarget.value.trim();
    this.summaryTarget.textContent = notificationPresentation
      ? (time ? `Defer until ${this.draftDate} at ${time}` : `Defer on ${this.draftDate}; choose a time`)
      : eventPresentation
      ? (time ? `${this.draftDate} at ${time}` : `${this.draftDate} · All day`)
      : recurrencePresentation ? `Ends on ${this.draftDate}`
      : reviewPresentation ? `Check back on ${this.draftDate}`
      : (time ? `Due ${this.draftDate} at ${time}` : `Due ${this.draftDate}, no time`);
  }

  private applyPresentation(presentation: 'task' | 'event' | 'notification' | 'recurrence' | 'review'): void {
    const eventPresentation = presentation === 'event';
    const notificationPresentation = presentation === 'notification';
    const recurrencePresentation = presentation === 'recurrence';
    const reviewPresentation = presentation === 'review';
    this.element.dataset.temporalEditorPresentation = presentation;
    this.titleTarget.textContent = notificationPresentation ? 'Custom defer time' : eventPresentation ? 'When' : recurrencePresentation ? 'Repeat until' : reviewPresentation ? 'Check back' : 'Set Due Date';
    this.element.setAttribute('aria-label', notificationPresentation
      ? 'Choose custom defer date and time'
      : eventPresentation ? 'Set event date and time' : recurrencePresentation ? 'Choose repeat end date' : reviewPresentation ? 'Choose check-back date' : 'Set due date');
    this.timeLabelTarget.textContent = notificationPresentation
      ? 'Time'
      : eventPresentation ? 'Time (leave blank for all day)' : 'Time (optional)';
    this.timeTarget.setAttribute('aria-label', notificationPresentation
      ? 'Defer time'
      : eventPresentation ? 'Event time (optional)' : 'Due time (optional)');
    const timeRow = this.timeTarget.closest('.calendar-dialog__time-row, label') as HTMLElement | null;
    if (recurrencePresentation || reviewPresentation) {
      this.timeTarget.value = '';
      this.timeTarget.disabled = true;
      timeRow?.setAttribute('hidden', '');
    } else {
      this.timeTarget.disabled = false;
      timeRow?.removeAttribute('hidden');
    }
    this.confirmTarget.textContent = notificationPresentation ? 'Defer notification' : eventPresentation ? 'Set When' : recurrencePresentation ? 'Set date' : reviewPresentation ? 'Apply' : 'Set Date';
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
    if (this.session?.presentation === 'recurrence' || this.session?.presentation === 'review') {
      const portuguese = locale === 'pt-BR';
      this.naturalLabelTarget.textContent = eventMessage('date', locale);
      this.naturalTarget.placeholder = portuguese ? 'Amanhã' : 'Tomorrow';
      this.naturalUseTarget.textContent = eventMessage('use', locale);
      this.naturalPreviewTarget.textContent = portuguese
        ? 'Digite uma data naturalmente ou escolha uma data abaixo.'
        : 'Type a date naturally, or choose a date below.';
      this.naturalPreviewTarget.dataset.state = '';
      return;
    }
    this.naturalLabelTarget.textContent = eventMessage('dateTime', locale);
    this.naturalTarget.placeholder = eventMessage('relativePlaceholder', locale);
    this.naturalUseTarget.textContent = eventMessage('use', locale);
    this.naturalPreviewTarget.textContent = eventMessage('relativeHint', locale);
    this.naturalPreviewTarget.dataset.state = '';
  }

  private todayIso(): string {
    const minimum = this.reviewToday();
    if (minimum) return minimum;
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  }

  private reviewToday(session = this.session): string {
    if (session?.presentation !== 'review') return '';
    const date = session.reviewToday ?? '';
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
  }

  private isBeforeMinimum(date: string): boolean {
    const minimum = this.reviewToday();
    return Boolean(minimum && date < minimum);
  }

  private calendarController(): CalendarController | null {
    return this.application.getControllerForElementAndIdentifier(
      this.calendarTarget,
      'calendar',
    ) as CalendarController | null;
  }
}
