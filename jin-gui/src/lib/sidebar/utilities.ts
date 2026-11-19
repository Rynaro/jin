import { resolveEventLocale } from '../events/locale';

/** Keep header utility names and the live unread count in the same language. */
export function updateSidebarUtilities(root: ParentNode = document, count?: number): void {
  const notification = root.querySelector<HTMLElement>('[data-notifications-nav]');
  const settings = root.querySelector<HTMLElement>('[data-section="settings"]');
  const portuguese = resolveEventLocale() === 'pt-BR';
  if (settings) {
    const name = portuguese ? 'Ajustes' : 'Settings';
    settings.setAttribute('aria-label', name);
    settings.setAttribute('title', name);
    settings.dataset.tooltip = name;
    const label = settings.querySelector('.sr-only');
    if (label) label.textContent = name;
  }
  if (!notification) return;
  if (count !== undefined) notification.dataset.unreadCount = String(count);
  const unread = Number(notification.dataset.unreadCount ?? 0);
  const name = portuguese ? 'Notificações' : 'Notifications';
  const summary = portuguese
    ? `${unread} ${unread === 1 ? 'notificação não lida' : 'notificações não lidas'}`
    : `${unread} unread notification${unread === 1 ? '' : 's'}`;
  notification.setAttribute('aria-label', portuguese
    ? `${name}, ${unread} ${unread === 1 ? 'não lida' : 'não lidas'}`
    : `${name}, ${unread} unread`);
  notification.setAttribute('title', summary);
  notification.dataset.tooltip = name;
  const badge = notification.querySelector<HTMLElement>('[data-notifications-badge]');
  if (badge) {
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.hidden = unread === 0;
  }
  const label = notification.querySelector('[data-notifications-badge-label]');
  if (label) label.textContent = summary;
  const nameLabel = notification.querySelector('.sr-only:not([data-notifications-badge-label])');
  if (nameLabel) nameLabel.textContent = name;
}
