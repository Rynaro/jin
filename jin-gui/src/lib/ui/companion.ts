/**
 * Event Companion host — outer-workspace rail (≥920, normal text) or JinModal.
 *
 * Host decision uses the outer workspace content box, never the inner grid that
 * shrinks when the rail opens. Companion modes stay out of hash/history.
 */

import type { EventDetailDto } from '../../types/dto';
import {
  draftFromEvent,
  isDirty,
  type EventDraft,
} from '../events/draft';
import { renderEventComposer, type ComposerDestination, type ComposerView } from '../events/composer';
import { renderEventPreview } from '../events/preview';
import {
  eventMessage,
  eventMessageFormat,
  resolveEventLocale,
  type EventLocaleKey,
} from '../events/locale';
import {
  INITIAL_OPERATION_STATE,
  reduceOperationState,
  type EventOperationState,
} from '../events/operation_state';
import { operationStatusCopy as sharedOperationStatusCopy } from '../events/status_copy';
import {
  calendarMembershipIdentity,
} from '../calendar/colors';
import type { SupportedRecurrenceScope } from '../events/recurrence_scope';
import { JinModal } from './modal';
import {
  installNavigationGuard,
  type NavigationIntent,
} from './navigation_guard';

export const COMPANION_SEAM_PX = 760;
let companionHeadingSequence = 0;

export type CompanionHostKind = 'floating' | 'modal';
export type CompanionMode = 'preview' | 'create' | 'edit';

export type CompanionSaveOutcome = 'local' | 'sync_pending' | 'provider_confirmed';

export interface CompanionSaveResult {
  detail: EventDetailDto;
  outcome: CompanionSaveOutcome;
  /**
   * When true, companion closes after a successful save instead of switching to
   * Preview (full-detail Edit returns to the canonical detail surface).
   */
  closeAfterSave?: boolean;
}

export interface EventCompanionOptions {
  /** Outer workspace content box — owns host width decisions. */
  workspace: HTMLElement;
  /** Optional calendar field whose scrollTop must stay untouched on open. */
  field?: HTMLElement | null;
  /** Non-Calendar entry points keep the sheet even on a wide desktop. */
  presentation?: 'auto' | 'modal';
  locale?: EventLocaleKey;
  destination?: ComposerDestination;
  recurrenceScopes?: readonly SupportedRecurrenceScope[];
  onOpenFullDetails?: (eventId: string) => void;
  onSave?: (draft: EventDraft) => Promise<CompanionSaveResult>;
  onDestinationChange?: (destination: ComposerDestination) => void;
  onClose?: () => void;
}

export interface CompanionChangeSummary {
  before: string;
  after: string;
}

export interface CompanionEditOptions {
  changeSummary?: CompanionChangeSummary | null;
  recurrenceScopes?: readonly SupportedRecurrenceScope[];
  recurrencePatternSupported?: boolean;
  temporalDisabledReason?: string | null;
}

export function companionHostKind(
  width: number,
  textScale: string = document.documentElement.dataset.textScale ?? 'normal',
): CompanionHostKind {
  if (textScale === 'accessibility') return 'modal';
  return width >= COMPANION_SEAM_PX ? 'floating' : 'modal';
}

function outcomeStatus(
  outcome: CompanionSaveOutcome,
  detail: EventDetailDto,
  locale: EventLocaleKey,
): string {
  if (outcome === 'local') return eventMessage('savedInJin', locale);
  if (outcome === 'sync_pending') {
    const name = detail.event.sync_context?.calendar_name ?? eventMessage('calendar', locale);
    return eventMessageFormat('syncingToCalendar', { calendar: name }, locale);
  }
  return eventMessage('googleAcceptedUpdate', locale);
}

function operationStatusCopy(
  state: EventOperationState,
  detail: EventDetailDto | null,
  locale: EventLocaleKey,
): string | null {
  return sharedOperationStatusCopy(state, detail?.event ?? null, { locale });
}

export class EventCompanion {
  readonly workspace: HTMLElement;
  readonly field: HTMLElement | null;
  readonly locale: EventLocaleKey;

  /** Increments only when host kind actually changes. */
  migrationCount = 0;

  private mode: CompanionMode | null = null;
  private hostKind: CompanionHostKind | null = null;
  private contentWidth = 0;
  private draft: EventDraft | null = null;
  private detail: EventDetailDto | null = null;
  private operationState: EventOperationState = INITIAL_OPERATION_STATE;
  private statusOverride: string | null = null;

  private readonly panel: HTMLElement;
  private readonly heading: HTMLHeadingElement;
  private readonly bodySlot: HTMLElement;
  private readonly footerSlot: HTMLElement;
  private readonly statusRegion: HTMLElement;
  private readonly discardRegion: HTMLElement;
  private closeBtn: HTMLButtonElement;

  private floating: HTMLElement | null = null;
  private modal: JinModal | null = null;
  private composer: ComposerView | null = null;
  private open = false;
  private discardResolver: ((keep: boolean) => void) | null = null;
  private destination: ComposerDestination | undefined;
  private destinations: readonly ComposerDestination[] = [];
  private readonly onDestinationChange?: (destination: ComposerDestination) => void;
  private initialDraft: string | null = null;
  private initialDirty = false;
  private initialDestination = '';
  private invoker: HTMLElement | null = null;
  private anchor: HTMLElement | null = null;
  private readonly presentation: 'auto' | 'modal';
  private readonly onViewportChange = (): void => this.positionFloating();
  private floatingObserver: MutationObserver | null = null;
  private readonly onOutsideClick = (event: MouseEvent): void => {
    if (!this.floating?.isConnected || this.floating.contains(event.target as Node)) return;
    // Route changes outside Calendar are mediated by the navigation guard,
    // which can resume the original intent after a discard decision.
    if (!this.workspace.contains(event.target as Node)) return;
    if (this.isDraftDirty() || this.operationState === 'persisting') {
      event.preventDefault();
      event.stopPropagation();
    }
    void this.requestDismiss();
  };
  private recurrenceScopes: readonly SupportedRecurrenceScope[];
  private recurrencePatternSupported = false;
  private changeSummary: CompanionChangeSummary | null = null;
  private temporalDisabledReason: string | null = null;
  private onOpenFullDetails?: (eventId: string) => void;
  private onSave?: (draft: EventDraft) => Promise<CompanionSaveResult>;
  private onClose?: () => void;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.open) return;
    if (this.operationState === 'persisting') {
      event.preventDefault();
      this.announce(eventMessage('saving', this.locale));
      return;
    }
    if (this.discardResolver) {
      // Second Escape does not discard.
      event.preventDefault();
      return;
    }
    event.preventDefault();
    void this.requestDismiss();
  };

  private dialogEl(): HTMLDialogElement | null {
    return (this.modal as unknown as { dialog: HTMLDialogElement } | null)?.dialog ?? null;
  }

  private readonly onModalBackdrop = (event: Event): void => {
    const dialog = this.dialogEl();
    if (!dialog || event.target !== dialog) return;
    event.preventDefault();
    void this.requestDismiss();
  };

  constructor(options: EventCompanionOptions) {
    this.workspace = options.workspace;
    this.field = options.field ?? null;
    this.presentation = options.presentation ?? 'auto';
    this.locale = options.locale ?? resolveEventLocale();
    this.destination = options.destination;
    this.recurrenceScopes = options.recurrenceScopes ?? [];
    this.onOpenFullDetails = options.onOpenFullDetails;
    this.onSave = options.onSave;
    this.onDestinationChange = options.onDestinationChange;
    this.onClose = options.onClose;

    this.panel = document.createElement('div');
    this.panel.className = 'event-companion__panel';

    const header = document.createElement('div');
    header.className = 'event-companion__chrome';
    this.heading = document.createElement('h2');
    this.heading.className = 'event-companion__heading';
    this.heading.id = `event-companion-heading-${++companionHeadingSequence}`;
    header.appendChild(this.heading);
    this.closeBtn = document.createElement('button');
    this.closeBtn.type = 'button';
    this.closeBtn.className = 'modal-close-btn tap-target event-companion__close';
    this.closeBtn.setAttribute('aria-label', eventMessage('close', this.locale));
    this.closeBtn.textContent = '×';
    this.closeBtn.addEventListener('click', () => {
      void this.requestDismiss();
    });
    header.appendChild(this.closeBtn);
    this.panel.appendChild(header);

    this.bodySlot = document.createElement('div');
    this.bodySlot.className = 'event-companion__body';
    this.panel.appendChild(this.bodySlot);

    this.footerSlot = document.createElement('div');
    this.footerSlot.className = 'event-companion__shell-footer';

    this.statusRegion = document.createElement('p');
    this.statusRegion.className = 'event-companion__status';
    this.statusRegion.setAttribute('role', 'status');
    this.statusRegion.setAttribute('aria-live', 'polite');
    this.statusRegion.setAttribute('aria-atomic', 'true');
    this.footerSlot.appendChild(this.statusRegion);

    this.discardRegion = document.createElement('div');
    this.discardRegion.className = 'event-companion__discard hidden';
    this.footerSlot.appendChild(this.discardRegion);

    this.panel.appendChild(this.footerSlot);
  }

  getMode(): CompanionMode | null {
    return this.mode;
  }

  getHostKind(): CompanionHostKind | null {
    return this.hostKind;
  }

  getDraft(): EventDraft | null {
    return this.draft;
  }

  getPanel(): HTMLElement {
    return this.panel;
  }

  isOpen(): boolean {
    return this.open;
  }

  /** Gate a different Calendar event/slot replacing this inspector. */
  async prepareReplacement(): Promise<boolean> {
    if (!this.open) return true;
    if (this.operationState === 'persisting') {
      this.announce(eventMessage('saving', this.locale));
      return false;
    }
    if (this.isDraftDirty() && !await this.promptDiscard()) return false;
    this.close(true);
    return true;
  }

  /** Update outer content-box width; migrates host only when the band changes. */
  setContentBox(width: number): void {
    this.contentWidth = width;
    if (!this.open) return;
    const next = this.requiredHost(width);
    if (next !== this.hostKind) this.migrateHost(next);
    else this.positionFloating();
  }

  /** Anchor the inspector to the control that opened it. */
  setAnchor(anchor: HTMLElement | null): void {
    this.anchor = anchor;
    this.positionFloating();
  }

  private requiredHost(width: number): CompanionHostKind {
    return this.presentation === 'modal' ? 'modal' : companionHostKind(width);
  }

  openPreview(detail: EventDetailDto, options?: CompanionEditOptions): void {
    const scrollTop = this.field?.scrollTop;
    this.detail = detail;
    this.draft = null;
    this.mode = 'preview';
    this.operationState = INITIAL_OPERATION_STATE;
    this.statusOverride = null;
    this.changeSummary = null;
    this.temporalDisabledReason = options?.temporalDisabledReason ?? null;
    if (options?.recurrenceScopes) this.recurrenceScopes = options.recurrenceScopes;
    this.ensureOpen();
    this.renderBody();
    if (this.field && scrollTop !== undefined) this.field.scrollTop = scrollTop;
  }

  openCreate(draft: EventDraft, destination?: ComposerDestination, destinations: readonly ComposerDestination[] = []): void {
    this.destination = destination;
    this.destinations = destinations;
    this.detail = null;
    this.draft = draft;
    this.initialDraft = JSON.stringify(draft);
    this.initialDirty = Boolean(
      draft.title.trim() || draft.location || draft.description || draft.attendees?.length
      || draft.recurrence_changed || draft.conference_intent.kind !== 'preserve' || draft.reminders,
    );
    this.initialDestination = `${this.destination?.accountId ?? ''}:${this.destination?.calendarId ?? ''}`;
    this.mode = 'create';
    this.operationState = isDirty(draft) ? 'dirty' : 'draft';
    this.statusOverride = null;
    this.changeSummary = null;
    this.temporalDisabledReason = null;
    this.recurrencePatternSupported = false;
    this.ensureOpen();
    this.renderBody();
    this.initialDraft = JSON.stringify(draft);
  }

  openEdit(draft: EventDraft, detail?: EventDetailDto, options?: CompanionEditOptions): void {
    if (detail) this.detail = detail;
    this.draft = draft;
    this.initialDraft = JSON.stringify(draft);
    this.initialDirty = isDirty(draft);
    this.mode = 'edit';
    this.operationState = isDirty(draft) ? 'dirty' : 'draft';
    this.statusOverride = null;
    this.changeSummary = options?.changeSummary ?? null;
    if (options?.recurrenceScopes) this.recurrenceScopes = options.recurrenceScopes;
    if (options?.recurrencePatternSupported !== undefined) {
      this.recurrencePatternSupported = options.recurrencePatternSupported;
    } else if (detail?.capabilities.recurrence_pattern_supported !== undefined) {
      this.recurrencePatternSupported = detail.capabilities.recurrence_pattern_supported;
    }
    this.temporalDisabledReason = options?.temporalDisabledReason ?? this.temporalDisabledReason;
    this.ensureOpen();
    this.renderBody();
    this.initialDraft = JSON.stringify(draft);
  }

  /** Current detail (for controller affordance / stale checks). */
  getDetail(): EventDetailDto | null {
    return this.detail;
  }

  /** Force operation state (tests / adapters). */
  setOperationState(state: EventOperationState): void {
    this.operationState = state;
    this.announce(operationStatusCopy(state, this.detail, this.locale));
    this.composer?.setOperationState(state);
    this.applyPersistingChrome();
  }

  getOperationState(): EventOperationState {
    return this.operationState;
  }

  /**
   * Provider retry/reauth/review refreshed canonical detail while companion is open
   * (AC-CALX-060). Retains logical focus and draft edits; never clears a persisting
   * submit or starts a second save.
   */
  applyRecoveredDetail(detail: EventDetailDto): void {
    if (!this.open) return;
    const focusId = this.captureFocusId();
    this.detail = detail;
    if (this.draft && (this.mode === 'edit' || this.mode === 'create')) {
      // Refresh optimistic concurrency token without wiping in-progress edits.
      if (detail.edit_token) this.draft.edit_token = detail.edit_token;
      if (detail.event.id) this.draft.event_id = detail.event.id;
    }
    if (this.mode === 'preview') {
      this.renderBody();
    }
    // Persisting chrome stays as-is — duplicate submit remains blocked.
    this.restoreFocusId(focusId);
  }

  close(force = false): void {
    if (!this.open) return;
    if (!force && this.operationState === 'persisting') {
      this.announce(eventMessage('saving', this.locale));
      return;
    }
    this.teardownHost();
    this.open = false;
    this.mode = null;
    this.draft = null;
    this.detail = null;
    this.composer = null;
    this.changeSummary = null;
    this.temporalDisabledReason = null;
    this.recurrenceScopes = [];
    this.recurrencePatternSupported = false;
    this.initialDraft = null;
    this.initialDirty = false;
    if (this.invoker?.isConnected) this.invoker.focus({ preventScroll: true });
    this.invoker = null;
    this.anchor = null;
    this.clearDiscardPrompt();
    installNavigationGuard(null);
    this.onClose?.();
  }

  private ensureOpen(): void {
    const wasOpen = this.open;
    if (!wasOpen && document.activeElement instanceof HTMLElement) this.invoker = document.activeElement;
    this.open = true;
    installNavigationGuard((intent) => this.handleNavigation(intent));
    document.addEventListener('keydown', this.onKeyDown);
    const kind = this.requiredHost(this.contentWidth || this.workspace.getBoundingClientRect().width);
    if (!wasOpen || this.hostKind === null) {
      this.mountHost(kind);
    } else if (this.hostKind !== kind) {
      this.migrateHost(kind);
    }
  }

  private mountHost(kind: CompanionHostKind): void {
    this.hostKind = kind;
    if (kind === 'floating') this.mountFloating();
    else this.mountModal();
  }

  private migrateHost(kind: CompanionHostKind): void {
    this.composer?.setInteractionSuspended(true);
    const focusId = this.captureFocusId();
    const bodyScroll = this.bodySlot.scrollTop;
    const focusOutside = !this.panel.contains(document.activeElement);
    const outsideEl =
      focusOutside && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    this.teardownHost({ preservePanel: true });
    this.migrationCount += 1;
    this.hostKind = kind;
    if (kind === 'floating') this.mountFloating();
    else this.mountModal({ skipInitialFocus: false });
    document.addEventListener('keydown', this.onKeyDown);

    if (kind === 'floating' && focusOutside && outsideEl) {
      outsideEl.focus({ preventScroll: true });
    } else {
      this.restoreFocusId(focusId ?? (this.mode === 'preview' ? 'preview-title' : 'composer-title'));
    }
    this.bodySlot.scrollTop = bodyScroll;
    this.composer?.setInteractionSuspended(false);
  }

  private mountFloating(): void {
    this.floating = document.createElement('aside');
    this.floating.className = 'event-companion event-companion--floating';
    this.floating.setAttribute('role', 'dialog');
    this.floating.setAttribute('aria-labelledby', this.heading.id);
    this.floating.appendChild(this.panel);
    this.workspace.appendChild(this.floating);
    this.workspace.inert = false;
    window.addEventListener('resize', this.onViewportChange);
    window.addEventListener('scroll', this.onViewportChange, true);
    document.addEventListener('click', this.onOutsideClick, true);
    this.floatingObserver = new MutationObserver(this.onViewportChange);
    this.floatingObserver.observe(this.panel, { childList: true, subtree: true, attributes: true });
    this.positionFloating();
  }

  private positionFloating(): void {
    if (!this.floating) return;
    const margin = 12;
    const gap = 10;
    const width = Math.min(this.mode === 'preview' ? 360 : 420, window.innerWidth - margin * 2);
    this.floating.style.width = `${width}px`;
    const height = Math.min(this.floating.getBoundingClientRect().height || 420, window.innerHeight - margin * 2);
    const anchor = this.anchor?.isConnected ? this.anchor.getBoundingClientRect() : null;
    const preferredLeft = anchor
      ? (anchor.right + gap + width <= window.innerWidth - margin ? anchor.right + gap : anchor.left - width - gap)
      : window.innerWidth - width - margin;
    const left = Math.max(margin, Math.min(preferredLeft, window.innerWidth - width - margin));
    const top = Math.max(margin, Math.min(anchor?.top ?? margin, window.innerHeight - height - margin));
    this.floating.style.left = `${left}px`;
    this.floating.style.top = `${top}px`;
  }

  private mountModal(opts: { skipInitialFocus?: boolean } = {}): void {
    if (!this.modal) {
      this.modal = new JinModal({
        title: eventMessage('companionLabel', this.locale),
        ariaLabel: eventMessage('companionLabel', this.locale),
        closeOnBackdrop: false,
        closeOnEscape: false,
      });
      const dialog = this.dialogEl();
      if (dialog) {
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', this.heading.id);
        dialog.setAttribute('aria-label', this.heading.textContent || eventMessage('companionLabel', this.locale));
        dialog.classList.add('event-companion', 'event-companion--modal');
        dialog.addEventListener('click', this.onModalBackdrop);
        // Companion owns dismiss; suppress JinModal chrome close.
        const chromeClose = dialog.querySelector<HTMLButtonElement>('.modal-close-btn');
        if (chromeClose) {
          chromeClose.hidden = true;
          chromeClose.disabled = true;
        }
      }
    }
    this.modal.setBody(this.panel);
    this.modal.setFooter(document.createDocumentFragment()); // shell footer lives in panel
    this.workspace.inert = true;
    this.dialogEl()?.setAttribute('aria-modal', 'true');

    if (opts.skipInitialFocus) {
      // Open without letting JinModal steal focus permanently.
      const prior = document.activeElement;
      this.modal.open();
      if (prior instanceof HTMLElement && !this.panel.contains(prior)) {
        prior.focus({ preventScroll: true });
      }
    } else {
      this.modal.open();
    }
  }

  private teardownHost(opts: { preservePanel?: boolean } = {}): void {
    if (!opts.preservePanel) {
      document.removeEventListener('keydown', this.onKeyDown);
    }
    if (this.floating) {
      if (opts.preservePanel && this.panel.parentElement === this.floating) {
        this.panel.remove();
      }
      this.floating.remove();
      this.floating = null;
      window.removeEventListener('resize', this.onViewportChange);
      window.removeEventListener('scroll', this.onViewportChange, true);
      document.removeEventListener('click', this.onOutsideClick, true);
      this.floatingObserver?.disconnect();
      this.floatingObserver = null;
    }
    this.workspace.inert = false;

    if (this.modal) {
      this.dialogEl()?.removeEventListener('click', this.onModalBackdrop);
      if (opts.preservePanel && this.panel.parentElement) {
        this.panel.remove();
      }
      this.modal.close({ restoreFocus: false });
      // Keep modal instance for reuse? destroy to avoid stale handlers
      this.modal.destroy();
      this.modal = null;
    }
    this.hostKind = null;
  }

  private renderBody(): void {
    this.clearDiscardPrompt();
    this.composer = null;
    this.bodySlot.replaceChildren();
    this.footerSlot.querySelector('.event-composer__footer')?.remove();
    this.heading.textContent = eventMessage(
      this.mode === 'create' ? 'newEvent' : this.mode === 'edit' ? 'editEvent' : 'eventHeading',
      this.locale,
    );
    this.dialogEl()?.setAttribute('aria-labelledby', this.heading.id);
    this.dialogEl()?.setAttribute('aria-label', this.heading.textContent);

    if (this.mode === 'preview' && this.detail) {
      const preview = renderEventPreview(
        this.detail,
        {
          onEdit: () => {
            if (!this.detail) return;
            const next = draftFromEvent(this.detail.event, this.detail.edit_token);
            this.openEdit(next, this.detail, {
              recurrenceScopes: this.detail.capabilities.recurrence_scopes,
              recurrencePatternSupported: this.detail.capabilities.recurrence_pattern_supported === true,
              temporalDisabledReason: this.temporalDisabledReason,
            });
          },
          onOpenFullDetails: (eventId) => {
            this.onOpenFullDetails?.(eventId);
          },
        },
        {
          locale: this.locale,
          operationState: this.operationState,
          statusMessage: this.statusOverride,
          temporalDisabledReason: this.temporalDisabledReason,
        },
      );
      // If editable and Join was primary, still expose Edit as secondary when can_edit
      if (
        this.detail.capabilities.can_edit
        && !preview.querySelector('.event-preview__edit')
      ) {
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'btn-secondary tap-target event-preview__edit';
        edit.textContent = eventMessage('edit', this.locale);
        edit.dataset.companionFocus = 'preview-edit';
        edit.addEventListener('click', () => {
          if (!this.detail) return;
          const next = draftFromEvent(this.detail.event, this.detail.edit_token);
          this.openEdit(next, this.detail, {
            recurrenceScopes: this.detail.capabilities.recurrence_scopes,
            recurrencePatternSupported: this.detail.capabilities.recurrence_pattern_supported === true,
            temporalDisabledReason: this.temporalDisabledReason,
          });
        });
        preview.querySelector('.event-preview__actions')?.appendChild(edit)
          ?? preview.insertBefore(edit, preview.querySelector('.event-preview__open-full'));
      }
      this.bodySlot.appendChild(preview);
      preview.querySelector<HTMLElement>('[data-companion-focus="preview-title"]')?.setAttribute('tabindex', '-1');
    } else if ((this.mode === 'create' || this.mode === 'edit') && this.draft) {
      const dest =
        (this.mode === 'edit' && this.detail
          ? (() => {
              const membership = calendarMembershipIdentity(
                this.detail.event,
                eventMessage('jinCalendarName', this.locale),
              );
              return {
                name: membership.label,
                alias: membership.accountAlias ?? undefined,
                color: membership.color,
                accountId: this.detail.event.sync_context?.account_id,
                calendarId: this.detail.event.sync_context?.calendar_id,
                allowedConferenceSolutionTypes: this.detail.event.sync_context?.allowed_conference_solution_types,
              };
            })()
          : this.destination);
      const scopes =
        this.recurrenceScopes.length > 0
          ? this.recurrenceScopes
          : (this.detail?.capabilities.recurrence_scopes ?? []);
      this.composer = renderEventComposer({
        draft: this.draft,
        destination: dest,
        destinations: this.mode === 'create' ? this.destinations : [],
        onDestinationChange: (destination) => {
          this.destination = destination;
          this.onDestinationChange?.(destination);
        },
        conferenceData: this.detail?.event.conference_data,
        existingMeetingHref: this.detail?.event.hangout_link,
        conferenceCapabilities: this.detail?.capabilities.collaboration ?? undefined,
        recurrenceScopes: scopes,
        recurrencePatternSupported: this.recurrencePatternSupported,
        changeSummary: this.changeSummary,
        operationState: this.operationState,
        locale: this.locale,
        onCancel: () => {
          void this.requestDismiss();
        },
        onSave: () => {
          void this.handleSave();
        },
        onDraftChange: () => {
          if (this.operationState !== 'persisting') {
            const next = reduceOperationState(this.operationState, { type: 'edit' });
            if (next.ok) this.operationState = next.state;
          }
        },
      });
      this.bodySlot.appendChild(this.composer.root);
      this.footerSlot.insertBefore(this.composer.footer, this.statusRegion);
    }

    this.applyPersistingChrome();
    this.positionFloating();
    this.announce(this.statusOverride ?? operationStatusCopy(this.operationState, this.detail, this.locale));
    if (this.mode === 'create' || this.mode === 'edit') {
      this.restoreFocusId('composer-title');
    } else {
      this.restoreFocusId('preview-title');
    }
  }

  private async handleSave(): Promise<void> {
    if (!this.draft || !this.onSave) return;
    if (this.operationState === 'persisting') return;
    const validating = reduceOperationState(this.operationState, { type: 'validate' });
    if (!validating.ok) return;
    this.operationState = validating.state;
    const passed = reduceOperationState(this.operationState, { type: 'validation_passed' });
    this.operationState = passed.state;
    this.applyPersistingChrome();
    this.announce(eventMessage('saving', this.locale));
    this.composer?.refresh();

    try {
      const result = await this.onSave(this.draft);
      if (result.outcome === 'local') {
        this.operationState = reduceOperationState(this.operationState, { type: 'persist_confirmed' }).state;
      } else if (result.outcome === 'sync_pending') {
        this.operationState = reduceOperationState(this.operationState, { type: 'persist_queued' }).state;
      } else {
        this.operationState = reduceOperationState(
          reduceOperationState(this.operationState, { type: 'persist_queued' }).state,
          { type: 'sync_confirmed' },
        ).state;
      }
      this.statusOverride = outcomeStatus(result.outcome, result.detail, this.locale);
      this.detail = result.detail;
      this.draft = null;
      if (result.closeAfterSave) {
        this.close(true);
        return;
      }
      // Successful save returns the same host to updated Preview.
      this.mode = 'preview';
      this.renderBody();
    } catch (error) {
      this.operationState = reduceOperationState(this.operationState, { type: 'persist_failed' }).state;
      const known = [
        'chooseExactDestination', 'destinationNoLongerWritable', 'destinationNoMeet',
        'googleDestinationRequired', 'tooManyGuests',
      ] as const;
      const message = error instanceof Error && known.some(key => error.message === eventMessage(key, this.locale))
        ? error.message
        : eventMessage('failedSaveEvent', this.locale);
      this.announce(message);
      if (error instanceof Error && (
        error.message === eventMessage('destinationNoLongerWritable', this.locale)
        || error.message === eventMessage('destinationNoMeet', this.locale)
      )) this.composer?.requireDestinationChoice();
      this.applyPersistingChrome();
      this.composer?.refresh();
    }
  }

  private applyPersistingChrome(): void {
    const persisting = this.operationState === 'persisting';
    this.closeBtn.disabled = persisting;
    const cancel = this.panel.querySelector<HTMLButtonElement>('.event-composer__cancel');
    if (cancel) cancel.disabled = persisting;
  }

  private announce(message: string | null): void {
    this.statusRegion.textContent = message ?? '';
  }

  private async requestDismiss(): Promise<void> {
    if (this.operationState === 'persisting') {
      this.announce(eventMessage('saving', this.locale));
      return;
    }
    if (this.isDraftDirty()) {
      const discard = await this.promptDiscard();
      if (!discard) return;
    }
    this.close(true);
  }

  private isDraftDirty(): boolean {
    if (this.mode === 'preview') return false;
    if (!this.draft) return false;
    return this.initialDirty
      || (this.initialDraft !== null && JSON.stringify(this.draft) !== this.initialDraft)
      || (this.mode === 'create'
        && `${this.destination?.accountId ?? ''}:${this.destination?.calendarId ?? ''}` !== this.initialDestination);
  }

  private promptDiscard(): Promise<boolean> {
    if (this.discardResolver) {
      return new Promise((resolve) => {
        // Already showing — wait for that decision
        const prev = this.discardResolver!;
        this.discardResolver = (keep) => {
          prev(keep);
          resolve(keep);
        };
      });
    }
    return new Promise((resolve) => {
      this.discardResolver = resolve;
      this.discardRegion.classList.remove('hidden');
      this.discardRegion.replaceChildren();

      const prompt = document.createElement('p');
      prompt.textContent = eventMessage('discardPrompt', this.locale);
      this.discardRegion.appendChild(prompt);

      const keep = document.createElement('button');
      keep.type = 'button';
      keep.className = 'btn-secondary tap-target';
      keep.textContent = eventMessage('keepEditing', this.locale);
      keep.addEventListener('click', () => {
        this.clearDiscardPrompt();
        resolve(false);
      });

      const discard = document.createElement('button');
      discard.type = 'button';
      discard.className = 'btn-danger tap-target';
      discard.textContent = eventMessage('discardChanges', this.locale);
      discard.addEventListener('click', () => {
        this.clearDiscardPrompt();
        resolve(true);
      });

      this.discardRegion.appendChild(keep);
      this.discardRegion.appendChild(discard);
      keep.focus({ preventScroll: true });
    });
  }

  private clearDiscardPrompt(): void {
    this.discardRegion.classList.add('hidden');
    this.discardRegion.replaceChildren();
    this.discardResolver = null;
  }

  private handleNavigation(_intent: NavigationIntent): boolean | Promise<boolean> {
    if (!this.open) return true;
    if (this.operationState === 'persisting') {
      this.announce(eventMessage('saving', this.locale));
      return false;
    }
    if (this.isDraftDirty()) {
      return this.promptDiscard().then((discard) => {
        if (discard) {
          this.close(true);
          return true;
        }
        return false;
      });
    }
    // Clean companion — allow navigation (and close)
    this.close(true);
    return true;
  }

  private captureFocusId(): string | null {
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.panel.contains(active)) {
      return active.dataset.companionFocus ?? null;
    }
    return null;
  }

  private restoreFocusId(id: string | null): void {
    if (!id) return;
    const el = this.panel.querySelector<HTMLElement>(`[data-companion-focus="${id}"]`);
    el?.focus({ preventScroll: true });
  }
}
