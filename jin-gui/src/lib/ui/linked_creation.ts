/** Review contextual creation before one durable create-and-link operation. */
import { createEventPrepNote, listLists, newOperationId } from '../../invoke';
import type { EventDetailDto, NoteDto } from '../../types/dto';
import { eventMessage, resolveEventLocale, type EventLocaleKey } from '../events/locale';
import { JinModal } from './modal';

let sequence = 0;

interface CreationOptions<T> {
  title: string;
  action: string;
  initialTitle: string;
  explanation: string;
  initialBody?: string;
  excerpt?: string;
  chooseList?: boolean;
  submit: (input: { title: string; body: string; list: string; operationId: string }) => Promise<T>;
  onCreated: (value: T, openAfterCreate: boolean) => void;
  stayAction?: string;
  locale?: EventLocaleKey;
  onReturnToSource?: () => void;
}

export function openLinkedCreation<T>(options: CreationOptions<T>): void {
  const locale = options.locale ?? resolveEventLocale();
  const modal = new CreationModal({ title: options.title, ariaLabel: options.title });
  const form = document.createElement('form');
  form.className = 'linked-creation';
  modal.setCloseLabel(locale === 'pt-BR' ? 'Fechar' : 'Close');
  const explanation = document.createElement('p');
  explanation.className = 'text-footnote color-secondary';
  explanation.textContent = options.explanation;
  form.append(explanation);
  const field = (label: string, element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void => {
    const group = document.createElement('div');
    group.className = 'form-group';
    const caption = document.createElement('label');
    caption.className = 'form-label';
    element.id = `linked-create-${++sequence}`;
    caption.htmlFor = element.id;
    caption.textContent = label;
    element.className = 'form-input';
    group.append(caption, element);
    form.append(group);
  };
  const title = document.createElement('input');
  title.value = options.initialTitle;
  title.maxLength = 500;
  title.required = true;
  field(locale === 'pt-BR' ? 'Título' : 'Title', title);
  const body = document.createElement('textarea');
  body.rows = 8;
  body.value = options.initialBody ?? '';
  if (options.initialBody !== undefined) field(locale === 'pt-BR' ? 'Conteúdo da nota' : 'Note content', body);
  if (options.excerpt !== undefined) {
    const label = document.createElement('p');
    label.className = 'form-label';
    label.textContent = locale === 'pt-BR' ? 'Texto selecionado' : 'Selected text';
    const excerpt = document.createElement('blockquote');
    excerpt.className = 'linked-creation__excerpt';
    excerpt.tabIndex = 0;
    excerpt.setAttribute('aria-label', locale === 'pt-BR' ? 'Texto selecionado' : 'Selected text');
    excerpt.textContent = options.excerpt;
    form.append(label, excerpt);
  }
  const list = document.createElement('select');
  list.append(new Option('Inbox', 'inbox'));
  if (options.chooseList) {
    field(locale === 'pt-BR' ? 'Lista' : 'List', list);
    void listLists().then(lists => {
      if (!modal.connected || modal.attempted) return;
      for (const item of lists) {
        if (item.id !== 'inbox') list.append(new Option(item.name, item.id));
      }
    }).catch(() => {
      if (!modal.connected || modal.attempted) return;
      status.textContent = locale === 'pt-BR' ? 'Outras listas indisponíveis. A Caixa de entrada está disponível.' : 'Other lists could not be loaded. Inbox is available.';
    });
  }
  const status = document.createElement('p');
  status.className = 'jin-status-message';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  form.append(status);
  const footer = document.createElement('div');
  footer.className = 'linked-creation__actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn-secondary';
  cancel.textContent = eventMessage('cancel', locale);
  cancel.addEventListener('click', () => modal.close());
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn-primary';
  save.textContent = options.stayAction ?? options.action;
  const openButton = document.createElement('button');
  openButton.type = 'submit';
  openButton.className = 'btn-secondary';
  openButton.textContent = options.action;
  form.append(footer);
  footer.append(cancel);
  if (options.stayAction) footer.append(openButton);
  footer.append(save);
  let operationId = newOperationId('linked-create');
  let attemptedInput: Parameters<CreationOptions<T>['submit']>[0] | null = null;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (modal.pending || !title.value.trim()) return;
    attemptedInput ??= { title: title.value.trim(), body: body.value, list: list.value, operationId };
    const openAfterCreate = !options.stayAction || (event as SubmitEvent).submitter === openButton;
    modal.pending = true;
    modal.attempted = true;
    title.disabled = body.disabled = list.disabled = true;
    save.disabled = cancel.disabled = openButton.disabled = true;
    status.textContent = eventMessage('saving', locale);
    try {
      const created = await options.submit(attemptedInput);
      modal.pending = false;
      modal.close({ restoreFocus: false });
      options.onCreated(created, openAfterCreate);
    } catch (error) {
      modal.pending = false;
      save.disabled = cancel.disabled = openButton.disabled = false;
      save.textContent = locale === 'pt-BR' ? 'Tentar novamente' : 'Try again';
      status.textContent = error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : locale === 'pt-BR' ? 'Não foi possível criar. Tente novamente.' : 'Could not create this item. Try again.';
      status.dataset.state = 'error';
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      const details = error && typeof error === 'object' && 'details' in error ? error.details : undefined;
      const staleNote = details && typeof details === 'object' && 'type' in details && details.type === 'stale_note';
      const missingList = code === 3 && options.chooseList && /list|board/i.test(status.textContent ?? '');
      if (code === 2 || missingList) {
        // Rejected validation never began the operation. A corrected intent gets
        // a new id, while uncertain writes keep their immutable retry payload.
        attemptedInput = null;
        operationId = newOperationId('linked-create');
        modal.attempted = false;
        title.disabled = body.disabled = list.disabled = false;
        save.textContent = options.stayAction ?? options.action;
        title.focus();
      } else if (staleNote || code === 3) {
        save.disabled = openButton.disabled = true;
        modal.onReturnToSource = options.onReturnToSource;
        cancel.textContent = locale === 'pt-BR' ? 'Voltar à origem' : 'Return to source';
        if (staleNote) status.textContent += locale === 'pt-BR'
          ? ' Volte à nota e use Recarregar versão mais recente para resolver o conflito. Seu texto permanece na nota.'
          : ' Return to the note and use Reload latest to resolve the conflict. Your selected text remains in the note.';
      }
    }
  });
  modal.setBody(form);
  modal.setFooter(document.createDocumentFragment());
  modal.open();
  title.focus();
  title.select();
}

class CreationModal extends JinModal {
  pending = false;
  attempted = false;
  get connected(): boolean { return this.dialog.isConnected; }
  setCloseLabel(label: string): void { this.dialog.querySelector('button.modal-close-btn')?.setAttribute('aria-label', label); }
  onReturnToSource?: () => void;
  override close(options: { restoreFocus?: boolean } = {}): void {
    if (this.pending) return;
    super.close(options);
    this.destroy();
    if (options.restoreFocus !== false) this.onReturnToSource?.();
  }
}

export function openEventPrepNote(detail: EventDetailDto, onCreated: (note: NoteDto) => void, locale = resolveEventLocale()): void {
  const event = detail.event;
  const scope = event.original_start || event.recurring_event_id || event.master_id
    ? locale === 'pt-BR' ? 'Esta nota será vinculada a este registro de evento.' : 'This note will be linked to this saved event record.'
    : event.recurrence?.length || event.recurrence_unexpanded
      ? locale === 'pt-BR' ? 'Esta nota será compartilhada por toda a série recorrente.' : 'This note will be shared across this repeating event series.'
      : '';
  openLinkedCreation({
    title: eventMessage('newPrepNote', locale),
    action: eventMessage('createAndOpenNote', locale),
    initialTitle: `${event.title} — ${locale === 'pt-BR' ? 'Notas' : 'Meeting notes'}`.slice(0, 500),
    explanation: `${eventMessage('privateCopy', locale)} ${scope}`.trim(),
    initialBody: locale === 'pt-BR' ? '## Pauta\n\n\n## Notas\n\n\n## Ações\n\n- [ ] ' : '## Agenda\n\n\n## Notes\n\n\n## Action items\n\n- [ ] ',
    submit: input => createEventPrepNote({ operation_id: input.operationId, event_id: event.id, title: input.title, body: input.body }),
    onCreated: note => onCreated(note),
    locale,
  });
}
