/** Shared RSVP control contract for Event detail and Notification Center. */

export type InvitationResponseChoice = 'allow' | 'maybe' | 'refuse';

export interface InvitationResponseControlState {
  confirmedResponse: string;
  requestedResponse: string | null;
  pending: boolean;
  available: boolean;
  disabledReason?: string | null;
}

export interface InvitationResponseControlOptions {
  onRespond?: (choice: InvitationResponseChoice, control: HTMLButtonElement) => void;
  actionPrefix?: string;
}

const choices: Array<{ choice: InvitationResponseChoice; label: string; response: string }> = [
  { choice: 'allow', label: 'Accept', response: 'accepted' },
  { choice: 'maybe', label: 'Maybe', response: 'tentative' },
  { choice: 'refuse', label: 'Decline', response: 'declined' },
];

function responseLabel(response: string): string {
  switch (response) {
    case 'needsAction': return 'Awaiting your response';
    case 'accepted': return 'Accepted';
    case 'tentative': return 'Maybe';
    case 'declined': return 'Declined';
    default: return response;
  }
}

/**
 * Render one truthful RSVP group. The parent owns dispatch and recurrence
 * scope selection; this primitive owns labels, selected state and pending copy.
 */
export function renderInvitationResponseControls(
  state: InvitationResponseControlState,
  options: InvitationResponseControlOptions = {},
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'invitation-response';
  const heading = document.createElement('h3');
  heading.className = 'invitation-response__title';
  heading.textContent = 'Respond';
  section.appendChild(heading);
  const group = document.createElement('div');
  group.className = 'notifications-rsvp-actions invitation-response__actions';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Invitation response');
  group.setAttribute('aria-busy', String(state.pending));
  for (const item of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = item.choice === 'allow' ? 'btn-primary tap-target' : 'btn-secondary tap-target';
    button.textContent = item.label;
    button.dataset.notificationAction = `${options.actionPrefix ?? 'respond'}-${item.choice}`;
    button.dataset.response = item.choice;
    const selected = state.requestedResponse === item.response || (!state.pending && state.confirmedResponse === item.response);
    button.setAttribute('aria-pressed', String(selected));
    button.disabled = !state.available || state.pending;
    button.addEventListener('click', () => options.onRespond?.(item.choice, button));
    group.appendChild(button);
  }
  section.appendChild(group);
  const copy = document.createElement('p');
  copy.className = 'invitation-response__state';
  copy.setAttribute('role', 'status');
  copy.setAttribute('aria-live', 'polite');
  if (state.pending && state.requestedResponse) {
    copy.textContent = `Queued: ${responseLabel(state.requestedResponse)}. Google confirms ${responseLabel(state.confirmedResponse)}.`;
  } else if (state.disabledReason) {
    copy.textContent = `Response unavailable: ${state.disabledReason}`;
  } else {
    copy.textContent = `Current response: ${responseLabel(state.confirmedResponse)}.`;
  }
  section.appendChild(copy);
  return section;
}
