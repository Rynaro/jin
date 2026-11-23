import type { CaptureReviewItemDto, EventDto } from '../../types/dto';
import { formatEventDate, formatEventTime, sourceBadgeLabel } from '../events/transform';

export interface CaptureReviewActions {
  toggle(item: CaptureReviewItemDto): void;
  open(item: CaptureReviewItemDto): void;
  process(item: CaptureReviewItemDto): void;
  pickCheckback(item: CaptureReviewItemDto, trigger: HTMLButtonElement): void;
  task(item: CaptureReviewItemDto): void;
  loadEvents(item: CaptureReviewItemDto): void;
  selectEvent(item: CaptureReviewItemDto, eventId: string): void;
  attach(item: CaptureReviewItemDto, eventId: string): void;
}

export function eventOptionLabel(event: EventDto): string {
  const date = formatEventDate(event.start, event.is_all_day || event.floating, event.start_tzid);
  const time = formatEventTime(event.start, event.end, event.is_all_day, event.floating, event.start_tzid);
  const calendar = event.sync_context?.calendar_name || sourceBadgeLabel(event.source);
  return `${event.title} — ${date} · ${time} · ${calendar}`;
}

/** Render controls only for one selected capture, keeping the review shelf quiet. */
export function renderCaptureReview(
  target: HTMLElement,
  items: CaptureReviewItemDto[],
  events: EventDto[] | null,
  expandedId: string | null,
  selectedEventId: string | null,
  actions: CaptureReviewActions,
): HTMLButtonElement | null {
  const rows = items.map(item => {
    const row = document.createElement('li');
    row.className = 'capture-review__item';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'capture-review__title';
    open.textContent = item.title;
    open.setAttribute('aria-expanded', String(item.id === expandedId));
    const chevron = document.createElement('i');
    chevron.className = 'capture-review__chevron';
    chevron.setAttribute('data-lucide', 'chevron-down');
    chevron.setAttribute('aria-hidden', 'true');
    open.append(chevron);
    open.dataset.reviewId = item.id;
    open.addEventListener('click', () => actions.toggle(item));
    const meta = document.createElement('p');
    meta.className = 'capture-review__meta';
    meta.textContent = `${item.kind === 'note' ? 'Note' : 'Task'} · captured ${new Date(item.created).toLocaleDateString()}`;
    row.append(open, meta);
    if (item.id !== expandedId) return row;

    const controls = document.createElement('div');
    controls.className = 'capture-review__actions';
    const openItem = document.createElement('button');
    openItem.type = 'button';
    openItem.className = 'btn-secondary';
    openItem.textContent = item.kind === 'note' ? 'Open note' : 'Open task';
    openItem.addEventListener('click', () => actions.open(item));
    controls.append(openItem);
    const process = document.createElement('button');
    process.type = 'button';
    process.className = 'btn-secondary';
    process.textContent = item.kind === 'note' ? 'Keep reference' : 'Keep in Inbox';
    process.addEventListener('click', () => actions.process(item));
    controls.append(process);
    if (item.kind === 'note') {
      const task = document.createElement('button');
      task.type = 'button';
      task.className = 'btn-secondary';
      task.textContent = 'Create linked task';
      task.addEventListener('click', () => actions.task(item));
      controls.append(task);
      const eventGroup = document.createElement('div');
      eventGroup.className = 'capture-review__event';
      const eventLabel = document.createElement('label');
      eventLabel.textContent = 'Attach to event';
      if (events === null) {
        const choose = document.createElement('button');
        choose.type = 'button';
        choose.className = 'btn-secondary';
        choose.textContent = 'Choose event';
        choose.addEventListener('click', () => actions.loadEvents(item));
        eventGroup.append(eventLabel, choose);
      } else {
        const eventSelect = document.createElement('select');
        const selectId = `capture-review-event-${item.id}`;
        eventSelect.id = selectId;
        eventLabel.htmlFor = selectId;
        eventSelect.className = 'form-select';
        eventSelect.append(new Option('Choose an event', ''));
        for (const event of events) eventSelect.append(new Option(eventOptionLabel(event), event.id));
        eventSelect.value = selectedEventId ?? '';
        eventSelect.addEventListener('change', () => actions.selectEvent(item, eventSelect.value));
        const attach = document.createElement('button');
        attach.type = 'button';
        attach.className = 'btn-secondary';
        attach.textContent = 'Attach';
        attach.disabled = !selectedEventId;
        attach.addEventListener('click', () => {
          if (selectedEventId) actions.attach(item, selectedEventId);
        });
        eventGroup.append(eventLabel, eventSelect, attach);
      }
      controls.append(eventGroup);
    }
    const date = document.createElement('button');
    date.type = 'button';
    date.id = `capture-review-checkback-picker-${item.id}`;
    date.className = 'btn-secondary capture-review__checkback-action';
    date.setAttribute('aria-haspopup', 'dialog');
    date.setAttribute('aria-controls', 'jin-due-date-dialog');
    const dateIcon = document.createElement('i');
    dateIcon.setAttribute('data-lucide', 'calendar');
    dateIcon.setAttribute('aria-hidden', 'true');
    const dateText = document.createElement('span');
    dateText.textContent = item.return_on ? `Check back ${item.return_on}` : 'Check back';
    date.append(dateIcon, dateText);
    date.addEventListener('click', () => actions.pickCheckback(item, date));
    controls.append(date);
    row.append(controls);
    return row;
  });
  target.replaceChildren(...rows);
  return target.querySelector<HTMLButtonElement>('.capture-review__title');
}
