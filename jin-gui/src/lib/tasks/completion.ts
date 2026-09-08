import type { TaskDto } from '../../types/dto';

/**
 * Apply Jin's one completion-control contract wherever a task can be completed.
 * The renderer owns placement; this primitive owns the button semantics and the
 * shared `.task-completion` visual skin.
 */
export function configureTaskCompletion(
  control: HTMLButtonElement,
  task: TaskDto,
  onToggle?: (taskId: string, currentStatus: string) => void,
): void {
  const isDone = task.status === 'done';
  control.classList.add('task-completion', 'jin-check');
  control.type = 'button';
  control.setAttribute('role', 'checkbox');
  control.setAttribute('aria-checked', isDone ? 'true' : 'false');
  control.setAttribute(
    'aria-label',
    isDone ? `Reopen "${task.title}"` : `Mark "${task.title}" as done`,
  );
  if (onToggle) control.addEventListener('click', (event) => {
    event.stopPropagation();
    onToggle(task.id, task.status);
  });
}
