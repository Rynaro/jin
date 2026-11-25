import type { ListDto, TaskDto } from '../../types/dto';
import { isJinErrorDto, toSyntheticErrorDto } from '../../types/error';
import {
  changeBoardColumnType,
  createBoardColumn,
  deleteBoardColumn,
  listTasks,
  renameBoardColumn,
  reorderBoardColumn,
  setBoardColumnColor,
  setInitialBoardColumn,
} from '../../invoke';
import { applyJinColor, createJinColorPicker, type JinColorPicker } from '../ui/color_picker';
import { between, compareRank } from './rank';

type BoardColumnDto = ListDto['columns'][number];

const TYPE_LABELS: Record<BoardColumnDto['type'], string> = {
  queue: 'Queue',
  none: 'No status change',
  in_progress: 'In Progress',
  done: 'Done',
};

const TYPE_EFFECTS: Record<BoardColumnDto['type'], string> = {
  queue: 'Dropped tasks become unchecked.',
  none: 'Open tasks keep their status. Completed tasks reopen.',
  in_progress: 'Dropped tasks become In Progress.',
  done: 'Dropped tasks become complete.',
};

const DEFAULT_STAGE_COLORS: Record<BoardColumnDto['type'], string> = {
  queue: 'accent',
  none: 'sky',
  in_progress: 'orange',
  done: 'success',
};

interface BoardColumnsManagerOptions {
  list: ListDto;
  members: TaskDto[];
  onUpdated: (list: ListDto) => Promise<void>;
  editColumnId?: string;
}

export interface BoardColumnsManager {
  element: HTMLElement;
  destroy: () => void;
  focusInitial: () => void;
}

export function createBoardColumnsManager({ list, members, onUpdated, editColumnId }: BoardColumnsManagerOptions): BoardColumnsManager {
  const body = document.createElement('div');
  body.className = 'tasks-column-manager';
  const feedback = document.createElement('p');
  feedback.className = 'jin-status-message';
  feedback.setAttribute('role', 'alert');
  let currentMembers = members;
  let editingColumnId: string | null = list.columns.some((column) => column.id === editColumnId) ? editColumnId ?? null : null;
  let addingColumn = false;
  let focusAfterDraw: { columnId: string; field: string } | 'new-name' | null = editingColumnId
    ? { columnId: editingColumnId, field: 'name' }
    : null;
  let colorPickers: JinColorPicker[] = [];
  let currentList = list;
  let busy = false;
  let disposed = false;
  const destroyColorPickers = (): void => {
    colorPickers.forEach((picker) => picker.destroy());
    colorPickers = [];
  };
  const destroy = (): void => {
    if (disposed) return;
    disposed = true;
    destroyColorPickers();
  };
  const ordered = (current: ListDto) => [...current.columns].sort((a, b) => compareRank(a.position, b.position) || a.id.localeCompare(b.id));

  const draw = (current: ListDto): void => {
    destroyColorPickers();
    body.replaceChildren();

    const description = document.createElement('p');
    description.textContent = 'Arrange stages in work order. Dropping a card onto a stage applies its status effect.';
    body.append(description);

    const columns = ordered(current);
    const initialColumnId = current.initial_column_id
      ?? columns.find((column) => column.type === 'queue')?.id
      ?? columns.find((column) => column.type === 'none')?.id;

    for (const [index, column] of columns.entries()) {
      const row = document.createElement('section');
      row.className = 'tasks-column-manager__row';

      const overview = document.createElement('div');
      overview.className = 'tasks-column-manager__overview';
      const marker = document.createElement('span');
      marker.className = 'tasks-column-manager__marker';
      marker.setAttribute('aria-hidden', 'true');
      marker.dataset.columnType = column.type;
      if (column.color) applyJinColor(marker, column.color, '--tasks-board-stage-color');

      const summary = document.createElement('div');
      summary.className = 'tasks-column-manager__summary';
      const name = document.createElement('strong');
      name.textContent = column.name;
      const effect = document.createElement('span');
      effect.textContent = TYPE_EFFECTS[column.type];
      summary.append(name, effect);
      overview.append(marker, summary);

      if (initialColumnId === column.id) {
        const starting = document.createElement('span');
        starting.className = 'tasks-column-manager__initial';
        starting.textContent = 'New tasks';
        overview.append(starting);
      }

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'jin-control jin-control--secondary';
      edit.textContent = editingColumnId === column.id ? 'Hide details' : 'Edit';
      edit.setAttribute('aria-label', `${editingColumnId === column.id ? 'Hide' : 'Edit'} ${column.name} details`);
      edit.setAttribute('aria-expanded', String(editingColumnId === column.id));
      edit.dataset.columnId = column.id;
      edit.dataset.columnField = 'edit';
      edit.addEventListener('click', () => {
        editingColumnId = editingColumnId === column.id ? null : column.id;
        addingColumn = false;
        focusAfterDraw = editingColumnId ? { columnId: column.id, field: 'name' } : null;
        draw(current);
      });
      overview.append(edit);
      row.append(overview);

      if (editingColumnId === column.id) {
        row.append(createColumnEditor(current, column, index, columns, currentMembers, initialColumnId));
      }
      body.append(row);
    }

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'jin-control jin-control--secondary';
    addButton.textContent = addingColumn ? 'Cancel' : 'Add a stage';
    addButton.setAttribute('aria-expanded', String(addingColumn));
    addButton.addEventListener('click', () => {
      addingColumn = !addingColumn;
      editingColumnId = null;
      focusAfterDraw = addingColumn ? 'new-name' : null;
      draw(current);
    });
    body.append(addButton);

    if (addingColumn) body.append(createNewColumnEditor(current));
    body.append(feedback);
    restoreFocus();
  };

  const run = async (
    operation: () => Promise<ListDto>,
    options: { onError?: () => void; onSuccess?: (updated: ListDto) => void } = {},
  ): Promise<void> => {
    if (busy || disposed) return;
    busy = true;
    const previousDisabled = Array.from(body.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select'))
      .map((control) => [control, control.disabled] as const);
    previousDisabled.forEach(([control]) => { control.disabled = true; });
    feedback.textContent = '';
    try {
      const updated = await operation();
      currentList = updated;
      options.onSuccess?.(updated);
      try {
        await onUpdated(updated);
      } catch {
        feedback.textContent = 'Stage saved. The board could not refresh just now.';
      }
      if (disposed) return;
      try {
        currentMembers = await listTasks({ list: updated.id });
      } catch {
        feedback.textContent = 'Stage saved. Task counts may be out of date until the board refreshes.';
      }
      if (disposed) return;
      draw(updated);
    } catch (cause) {
      feedback.textContent = isJinErrorDto(cause)
        ? cause.message
        : toSyntheticErrorDto(cause, 'Could not change this stage.').message;
      if (disposed) return;
      options.onError?.();
      if (editingColumnId) draw(currentList);
    } finally {
      busy = false;
      if (!disposed) {
        previousDisabled.forEach(([control, wasDisabled]) => {
          if (control.isConnected) control.disabled = wasDisabled;
        });
        restoreFocus();
      }
    }
  };

  function createColumnEditor(
    current: ListDto,
    column: BoardColumnDto,
    index: number,
    columns: BoardColumnDto[],
    currentTasks: TaskDto[],
    initialColumnId: string | undefined,
  ): HTMLElement {
    const editor = document.createElement('div');
    editor.className = 'tasks-column-manager__editor';
    editor.dataset.boardColumnEditor = column.id;
    editor.dataset.columnType = column.type;
    if (column.color) applyJinColor(editor, column.color, '--tasks-board-stage-color');

    const identity = document.createElement('div');
    identity.className = 'tasks-column-manager__identity';

    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Name';
    const name = document.createElement('input');
    name.className = 'form-input';
    name.value = column.name;
    name.setAttribute('aria-label', `Column name: ${column.name}`);
    name.dataset.columnId = column.id;
    name.dataset.columnField = 'name';
    nameLabel.append(name);
    const saveName = () => {
      const next = name.value.trim();
      if (!next || next === column.name) return;
      focusAfterDraw = { columnId: column.id, field: 'name' };
      void run(() => renameBoardColumn(current.id, column.id, next));
    };
    name.addEventListener('change', saveName);
    name.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveName();
      }
    });

    const typeLabel = document.createElement('label');
    typeLabel.textContent = 'Status effect';
    const type = document.createElement('select');
    type.className = 'form-select';
    type.setAttribute('aria-label', `${column.name} status effect`);
    type.dataset.columnId = column.id;
    type.dataset.columnField = 'type';
    for (const [value, label] of Object.entries(TYPE_LABELS)) type.add(new Option(label, value));
    type.value = column.type;
    type.addEventListener('change', () => {
      focusAfterDraw = { columnId: column.id, field: 'type' };
      void run(() => changeBoardColumnType(current.id, column.id, type.value as BoardColumnDto['type']));
    });
    typeLabel.append(type);

    const colorLabel = document.createElement('div');
    colorLabel.className = 'tasks-column-manager__color-field';
    const colorTitle = document.createElement('span');
    colorTitle.textContent = 'Stage color';
    const picker = createJinColorPicker({
      value: column.color ?? DEFAULT_STAGE_COLORS[column.type],
      label: `${column.name} stage color`,
      onPick: (color) => {
        focusAfterDraw = { columnId: column.id, field: 'color' };
        void run(() => setBoardColumnColor(current.id, column.id, color));
      },
    });
    if (!column.color) {
      picker.element.querySelectorAll<HTMLButtonElement>('.jin-color-swatch')
        .forEach((swatch) => swatch.setAttribute('aria-pressed', 'false'));
    }
    picker.element.dataset.columnId = column.id;
    picker.element.dataset.columnField = 'color';
    colorPickers.push(picker);
    const automatic = document.createElement('button');
    automatic.type = 'button';
    automatic.className = 'jin-control jin-control--secondary tasks-column-manager__automatic';
    automatic.textContent = 'Automatic';
    automatic.setAttribute('aria-label', `Reset ${column.name} color to Automatic`);
    automatic.setAttribute('aria-pressed', String(!column.color));
    automatic.dataset.columnId = column.id;
    automatic.dataset.columnField = 'automatic';
    automatic.addEventListener('click', () => {
      focusAfterDraw = { columnId: column.id, field: 'automatic' };
      void run(() => setBoardColumnColor(current.id, column.id, null));
    });
    const colorControls = document.createElement('div');
    colorControls.className = 'tasks-column-manager__color-controls';
    colorControls.append(picker.element, automatic);
    colorLabel.append(colorTitle, colorControls);
    identity.append(nameLabel, typeLabel);

    const actions = document.createElement('div');
    actions.className = 'tasks-column-manager__actions';
    if (initialColumnId !== column.id && (column.type === 'queue' || column.type === 'none')) {
      const initial = document.createElement('button');
      initial.type = 'button';
      initial.className = 'jin-control jin-control--secondary';
      initial.textContent = 'Use for new tasks';
      initial.setAttribute('aria-label', `Use ${column.name} for new tasks`);
      initial.dataset.columnId = column.id;
      initial.dataset.columnField = 'initial';
      initial.addEventListener('click', () => {
        focusAfterDraw = { columnId: column.id, field: 'initial' };
        void run(() => setInitialBoardColumn(current.id, column.id));
      });
      actions.append(initial);
    }

    const move = (delta: -1 | 1) => {
      const before = delta < 0 ? columns[index - 2]?.position ?? null : columns[index + 1]?.position ?? null;
      const after = delta < 0 ? columns[index - 1]?.position ?? null : columns[index + 2]?.position ?? null;
      const field = delta < 0 ? 'move-left' : 'move-right';
      focusAfterDraw = { columnId: column.id, field };
      void run(() => reorderBoardColumn(current.id, column.id, between(before, after)));
    };
    const up = document.createElement('button');
    up.type = 'button'; up.textContent = '←';
    up.className = 'jin-control jin-control--secondary jin-control--icon';
    up.setAttribute('aria-label', `Move ${column.name} left`);
    up.dataset.columnId = column.id; up.dataset.columnField = 'move-left';
    up.disabled = index === 0;
    up.addEventListener('click', () => move(-1));
    const down = document.createElement('button');
    down.type = 'button'; down.textContent = '→';
    down.className = 'jin-control jin-control--secondary jin-control--icon';
    down.setAttribute('aria-label', `Move ${column.name} right`);
    down.dataset.columnId = column.id; down.dataset.columnField = 'move-right';
    down.disabled = index === columns.length - 1;
    down.addEventListener('click', () => move(1));
    actions.append(up, down);

    const assigned = currentTasks.filter((task) => task.board_column_id === column.id && task.deleted_at === null);
    const candidates = columns.filter((peer) => peer.id !== column.id
      && (initialColumnId !== column.id || peer.type === 'queue' || peer.type === 'none')
      && assigned.every((task) => task.status === 'todo'
        ? peer.type === 'queue' || peer.type === 'none'
        : task.status === 'doing' ? peer.type === 'in_progress' || peer.type === 'none'
          : task.status === 'done' && peer.type === 'done'));
    const replacement = document.createElement('select');
    replacement.className = 'form-select';
    replacement.setAttribute('aria-label', `Move ${column.name} tasks to`);
    replacement.dataset.columnId = column.id;
    replacement.dataset.columnField = 'replacement';
    replacement.hidden = true;
    replacement.add(new Option('Choose destination', ''));
    for (const peer of candidates) replacement.add(new Option(`${peer.name} · ${TYPE_LABELS[peer.type]}`, peer.id));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button'; deleteButton.textContent = 'Delete';
    deleteButton.className = 'jin-control jin-control--secondary';
    deleteButton.setAttribute('aria-label', `Delete ${column.name}`);
    if (column.type === 'done' && columns.filter((item) => item.type === 'done').length === 1) {
      deleteButton.disabled = true;
      deleteButton.title = 'Keep at least one Done column';
    } else if ((assigned.length > 0 || initialColumnId === column.id) && candidates.length === 0) {
      deleteButton.disabled = true;
      deleteButton.title = 'Move tasks or choose another eligible starting column first';
    }
    deleteButton.addEventListener('click', () => {
      if ((assigned.length > 0 || initialColumnId === column.id) && replacement.hidden) {
        replacement.hidden = false;
        replacement.focus();
        return;
      }
      if (!replacement.hidden && !replacement.value) {
        replacement.focus();
        return;
      }
      void run(() => deleteBoardColumn(current.id, column.id, replacement.value || undefined), {
        onError: () => {
          if (candidates.length) { replacement.hidden = false; replacement.focus(); }
        },
        onSuccess: () => { editingColumnId = null; },
      });
    });
    actions.append(deleteButton);

    const editorPanel = document.createElement('div');
    editorPanel.className = 'tasks-column-manager__editor';
    editorPanel.dataset.boardColumnEditor = column.id;
    editorPanel.dataset.columnType = column.type;
    if (column.color) applyJinColor(editorPanel, column.color, '--tasks-board-stage-color');
    editorPanel.append(identity, colorLabel, actions, replacement);
    return editorPanel;
  }

  function createNewColumnEditor(current: ListDto): HTMLElement {
    const add = document.createElement('div');
    add.className = 'tasks-column-manager__add';
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'New stage';
    const name = document.createElement('input');
    name.className = 'form-input';
    name.placeholder = 'Name';
    name.setAttribute('aria-label', 'New stage name');
    name.dataset.columnField = 'new-name';
    nameLabel.append(name);
    const typeLabel = document.createElement('label');
    typeLabel.textContent = 'Status effect';
    const type = document.createElement('select');
    type.className = 'form-select';
    type.setAttribute('aria-label', 'New stage status effect');
    for (const [value, label] of Object.entries(TYPE_LABELS)) type.add(new Option(label, value));
    type.value = 'queue';
    typeLabel.append(type);
    const submit = document.createElement('button');
    submit.type = 'button'; submit.textContent = 'Add stage';
    submit.className = 'jin-control jin-control--primary';
    submit.disabled = true;
    name.addEventListener('input', () => { submit.disabled = !name.value.trim(); });
    submit.addEventListener('click', () => {
      const title = name.value.trim();
      if (!title) return;
      void run(() => createBoardColumn(current.id, title, type.value as BoardColumnDto['type']), {
        onSuccess: (updated) => {
          const created = updated.columns.find((candidate) => !current.columns.some((existing) => existing.id === candidate.id));
          addingColumn = false;
          editingColumnId = created?.id ?? null;
          focusAfterDraw = created ? { columnId: created.id, field: 'name' } : null;
        },
      });
    });
    add.append(nameLabel, typeLabel, submit);
    return add;
  }

  function restoreFocus(): void {
    if (!focusAfterDraw) return;
    if (focusAfterDraw === 'new-name') {
      const field = body.querySelector<HTMLInputElement>('[data-column-field="new-name"]');
      field?.focus();
      if (document.activeElement === field) focusAfterDraw = null;
      return;
    }
    const target = focusAfterDraw;
    const field = Array.from(body.querySelectorAll<HTMLElement>('[data-column-id][data-column-field]'))
      .find((candidate) => candidate.dataset.columnId === target.columnId
        && candidate.dataset.columnField === target.field);
    if (field instanceof HTMLDivElement) field.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    else field?.focus();
    if (document.activeElement === field || (field instanceof HTMLDivElement && field.contains(document.activeElement))) focusAfterDraw = null;
  }

  draw(currentList);
  return {
    element: body,
    destroy,
    focusInitial: () => {
      if (editingColumnId) Array.from(body.querySelectorAll<HTMLInputElement>('[data-column-field="name"]'))
        .find((field) => field.dataset.columnId === editingColumnId)?.focus();
    },
  };
}
