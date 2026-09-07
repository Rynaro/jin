/**
 * ui/select.ts — JinSelect: framework-free ink-and-seal native <select> wrapper.
 *
 * Implements the §5.2 architecture from the SPECTRA todo-defect-fixes spec.
 * Wraps an existing <select> in a .jin-select shell and adds a CSS-drawn
 * .jin-select__chevron affordance (border-trick chevron — no icon registry
 * surface required; chevron-down is registered but kept for richer contexts).
 *
 * The native <select> is the source of truth throughout:
 *   - Option values are untouched (list filter stays l.id — S6 territory).
 *   - Native change events still fire and bubble, so Stimulus
 *     data-action="change->tasks#applyFilter" wiring is fully preserved.
 *   - Native keyboard navigation and ARIA semantics are preserved (no custom
 *     role="listbox" popup — spec §5.2 rejected alternative R-S1).
 *
 * Per spec §5.2 rejected alternative:
 *   Do NOT build a custom role="listbox" popup — a11y liability with no gain.
 *   This is a cosmetic/affordance fix only.
 *
 * Usage:
 *   const js = JinSelect.enhance(selectEl);   // wrap in place (static factory)
 *   js.getValue();                             // current value
 *   js.setValue('inbox');                      // programmatic set (silent — native semantics)
 *   js.onChange(v => console.log(v));          // subscribe to user-initiated changes
 *
 * Shell structure produced in the DOM:
 *   <div class="jin-select">
 *     <select data-tasks-target="statusFilter" ...>…</select>   ← unchanged
 *     <span class="jin-select__chevron" aria-hidden="true"></span>
 *   </div>
 *
 * No Stimulus import — framework-free class (matches modal.ts house style).
 */

export class JinSelect {
  private static readonly _instances = new WeakMap<HTMLSelectElement, JinSelect>();
  private readonly _select: HTMLSelectElement;
  private readonly _shell: HTMLDivElement;
  private readonly _changeListeners: Array<(value: string) => void> = [];

  /**
   * Wrap the given <select> element in the JinSelect shell.
   *
   * The select is moved inside a new .jin-select <div> (inserted in its original
   * position), and a .jin-select__chevron <span> is appended after it inside the
   * shell. The select's attributes, data-*, and event listeners are untouched.
   */
  constructor(selectEl: HTMLSelectElement) {
    this._select = selectEl;

    // Build the wrapper shell and insert it exactly where the select was.
    this._shell = document.createElement('div');
    this._shell.className = 'jin-select';

    const parent = selectEl.parentNode;
    if (parent) {
      // insertBefore places the shell at the select's current position.
      parent.insertBefore(this._shell, selectEl);
    }
    // Move the select inside the shell (its data-action / data-*-target survive).
    this._shell.appendChild(selectEl);

    // CSS-drawn down-chevron affordance.
    // A <span> with border-right + border-bottom, rotated 45deg, yields a "V"
    // pointing downward. Styled in forms.css — no icon registry required.
    const chevron = document.createElement('span');
    chevron.className = 'jin-select__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    this._shell.appendChild(chevron);

    // Forward the native change event to the optional callback subscribers.
    // We DO NOT stop propagation — the native event still reaches Stimulus
    // (data-action="change->tasks#applyFilter" keeps working as before).
    selectEl.addEventListener('change', () => {
      const v = this._select.value;
      for (const cb of this._changeListeners) {
        cb(v);
      }
    });

    JinSelect._instances.set(selectEl, this);
  }

  // ── Public surface ────────────────────────────────────────────────────────────

  /**
   * Returns the current value of the underlying native <select>.
   * Equivalent to selectEl.value.
   */
  getValue(): string {
    return this._select.value;
  }

  /**
   * Set the value of the underlying native <select> programmatically.
   * Like a direct DOM assignment, this does NOT fire a change event — same
   * semantics as `selectEl.value = v` (programmatic changes are silent).
   */
  setValue(value: string): void {
    this._select.value = value;
  }

  /**
   * Register a callback to be invoked whenever the user changes the select's
   * value (native change event). Multiple listeners are supported.
   *
   * Only user-initiated changes fire this; programmatic setValue() is silent.
   */
  onChange(cb: (value: string) => void): void {
    this._changeListeners.push(cb);
  }

  // ── Static factory ────────────────────────────────────────────────────────────

  /**
   * Wrap an existing <select> element in place with the JinSelect ink-and-seal
   * shell. The element's DOM position is preserved (the .jin-select shell takes
   * its place; the select is moved inside it).
   *
   * Convenience alias for `new JinSelect(selectEl)`.
   *
   * @param selectEl  The native <select> to enhance.
   * @returns The JinSelect instance (for chaining getValue/setValue/onChange).
   */
  static enhance(selectEl: HTMLSelectElement): JinSelect {
    const existing = JinSelect._instances.get(selectEl);
    if (existing) return existing;
    return new JinSelect(selectEl);
  }

  /**
   * Enhance every native select beneath `root`, including `root` itself when
   * it is a select. Repeated calls are safe: each select receives one shell,
   * one chevron, and one native change bridge for its whole DOM lifetime.
   */
  static enhanceAll(root: ParentNode = document): JinSelect[] {
    const selects: HTMLSelectElement[] = [];
    if (root instanceof HTMLSelectElement) selects.push(root);
    selects.push(...Array.from(root.querySelectorAll<HTMLSelectElement>('select')));
    return selects.map((select) => JinSelect.enhance(select));
  }
}

/**
 * A fully rendered Jin combobox for compact creation surfaces.
 *
 * The supplied select remains a hidden form/value bridge, while all pointer
 * and keyboard interaction happens in Jin-owned DOM. This is intentionally a
 * separate component from JinSelect: existing screens keep their native,
 * progressively styled control and can migrate deliberately.
 */
export class JinSelectField {
  private static readonly instances = new WeakMap<HTMLSelectElement, JinSelectField>();
  private readonly select: HTMLSelectElement;
  private readonly root: HTMLDivElement;
  private readonly trigger: HTMLButtonElement;
  private readonly value: HTMLSpanElement;
  private readonly listbox: HTMLDivElement;
  private readonly observer: MutationObserver;
  private readonly portalHost: HTMLElement;
  private readonly originalTabIndex: number;
  private readonly originallyHidden: boolean;
  private readonly originalAriaHidden: string | null;
  private readonly describedBy: string[];
  private options: HTMLButtonElement[] = [];
  private activeIndex = -1;
  private typeahead = '';
  private typeaheadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(select: HTMLSelectElement) {
    this.select = select;
    this.originalTabIndex = select.tabIndex;
    this.originallyHidden = select.hidden;
    this.originalAriaHidden = select.getAttribute('aria-hidden');
    this.describedBy = (select.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    this.root = document.createElement('div');
    this.root.className = 'jin-select-field';

    this.trigger = document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'jin-select-field__trigger';
    this.trigger.setAttribute('role', 'combobox');
    this.trigger.setAttribute('aria-haspopup', 'listbox');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.setAttribute('aria-label', select.getAttribute('aria-label') || this.labelText() || 'Choose an option');
    this.syncSemantics();

    this.value = document.createElement('span');
    this.value.className = 'jin-select-field__value';
    const chevron = document.createElement('span');
    chevron.className = 'jin-select-field__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    this.trigger.append(this.value, chevron);

    this.listbox = document.createElement('div');
    this.listbox.className = 'jin-select-field__listbox hidden';
    this.listbox.id = `${select.id || `jin-select-${Math.random().toString(36).slice(2)}`}-listbox`;
    this.listbox.setAttribute('role', 'listbox');
    this.listbox.setAttribute('aria-label', this.trigger.getAttribute('aria-label') || 'Options');
    this.trigger.setAttribute('aria-controls', this.listbox.id);

    select.before(this.root);
    this.root.append(select, this.trigger);
    // A select can live inside a scrolling form. Keep the popup in the same
    // top-layer dialog, but outside every scroll/overflow container, so its
    // options cannot be painted underneath or clipped by adjacent fields.
    this.portalHost = select.closest('dialog') ?? document.body;
    this.portalHost.appendChild(this.listbox);
    select.classList.add('jin-select-field__native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    select.hidden = true;

    this.trigger.addEventListener('click', this.onTriggerClick);
    this.trigger.addEventListener('keydown', this.onTriggerKeydown);
    this.root.addEventListener('focusout', this.onFocusOut);
    this.select.addEventListener('change', this.onSelectChange);
    document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
    window.addEventListener('resize', this.onViewportChanged);
    window.addEventListener('scroll', this.onViewportChanged, true);

    this.observer = new MutationObserver(() => this.refresh());
    this.observer.observe(select, { childList: true, subtree: true, attributes: true });
    this.refresh();
    JinSelectField.instances.set(select, this);
  }

  private labelText(): string {
    if (!this.select.id) return '';
    return Array.from(document.querySelectorAll<HTMLLabelElement>('label[for]'))
      .find(label => label.htmlFor === this.select.id)?.textContent?.trim() || '';
  }

  refresh(): void {
    this.listbox.replaceChildren();
    this.options = Array.from(this.select.options).map((option, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'jin-select-field__option';
      item.id = `${this.listbox.id}-option-${index}`;
      item.setAttribute('role', 'option');
      item.tabIndex = -1;
      item.dataset.value = option.value;
      item.disabled = option.disabled;
      item.textContent = option.textContent;
      item.addEventListener('click', () => this.choose(index));
      this.listbox.appendChild(item);
      return item;
    });
    this.syncSelection();
    this.syncSemantics();
  }

  /** Set both the hidden value source and the rendered trigger immediately. */
  setValue(value: string): void {
    this.select.value = value;
    this.syncSelection();
    this.setInvalid(false);
  }

  /** Focus the rendered control; the hidden native bridge never receives focus. */
  focus(): void {
    this.trigger.focus();
  }

  /** Reflect field validation on the rendered combobox and associate its error. */
  setInvalid(invalid: boolean, errorId?: string): void {
    if (invalid) this.trigger.setAttribute('aria-invalid', 'true');
    else this.trigger.removeAttribute('aria-invalid');
    const describedBy = [...this.describedBy];
    if (invalid && errorId && !describedBy.includes(errorId)) describedBy.push(errorId);
    if (describedBy.length) this.trigger.setAttribute('aria-describedby', describedBy.join(' '));
    else this.trigger.removeAttribute('aria-describedby');
  }

  private syncSemantics(): void {
    const required = this.select.required || this.select.getAttribute('aria-required') === 'true';
    if (required) this.trigger.setAttribute('aria-required', 'true');
    else this.trigger.removeAttribute('aria-required');
    this.setInvalid(this.trigger.getAttribute('aria-invalid') === 'true');
  }

  private syncSelection(): void {
    const selectedIndex = Math.max(0, this.select.selectedIndex);
    this.activeIndex = selectedIndex;
    this.value.textContent = this.select.options[selectedIndex]?.textContent || 'Choose';
    this.options.forEach((option, index) => option.setAttribute('aria-selected', String(index === selectedIndex)));
    this.trigger.setAttribute('aria-activedescendant', this.options[selectedIndex]?.id || '');
  }

  private toggle(): void {
    this.isOpen() ? this.close() : this.open();
  }

  private readonly onTriggerClick = (): void => this.toggle();
  private readonly onTriggerKeydown = (event: KeyboardEvent): void => this.onKeydown(event);
  private readonly onSelectChange = (): void => {
    this.syncSelection();
    if (this.select.value) this.setInvalid(false);
  };

  private open(): void {
    this.root.dataset.open = 'true';
    this.listbox.classList.remove('hidden');
    this.trigger.setAttribute('aria-expanded', 'true');
    this.activeIndex = Math.max(0, this.select.selectedIndex);
    this.positionPopup();
    this.updateActive();
  }

  private close(): void {
    delete this.root.dataset.open;
    this.listbox.classList.add('hidden');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.typeahead = '';
  }

  private choose(index: number): void {
    const option = this.select.options[index];
    if (!option || option.disabled) return;
    const changed = this.select.value !== option.value;
    this.select.value = option.value;
    this.syncSelection();
    this.close();
    this.trigger.focus();
    if (changed) this.select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  private move(delta: number): void {
    if (!this.options.length) return;
    let next = this.activeIndex;
    do next = (next + delta + this.options.length) % this.options.length;
    while (this.options[next]?.disabled && next !== this.activeIndex);
    this.activeIndex = next;
    this.updateActive();
  }

  private updateActive(): void {
    this.options.forEach((option, index) => option.classList.toggle('is-active', index === this.activeIndex));
    const active = this.options[this.activeIndex];
    if (active) {
      this.trigger.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView?.({ block: 'nearest' });
    }
  }

  private onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.isOpen()) this.open();
      else this.move(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && this.isOpen()) {
      event.preventDefault();
      this.choose(this.activeIndex);
      return;
    }
    if (event.key === 'Escape' && this.isOpen()) {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key === 'Tab' && this.isOpen()) {
      // Never trap focus: close synchronously and let the browser perform its
      // normal forward/backward Tab move.
      this.close();
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (!this.isOpen()) this.open();
      this.activeIndex = event.key === 'Home' ? 0 : this.options.length - 1;
      this.updateActive();
      return;
    }
    if (event.key.length === 1 && /\S/.test(event.key)) {
      this.typeahead += event.key.toLocaleLowerCase();
      if (this.typeaheadTimer) clearTimeout(this.typeaheadTimer);
      this.typeaheadTimer = setTimeout(() => { this.typeahead = ''; }, 500);
      const match = this.options.findIndex(option => !option.disabled && (option.textContent || '').toLocaleLowerCase().startsWith(this.typeahead));
      if (match >= 0) {
        if (!this.isOpen()) this.open();
        this.activeIndex = match;
        this.updateActive();
      }
    }
  }

  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    const target = event.target as Node;
    if (!this.root.contains(target) && !this.listbox.contains(target)) this.close();
  };

  private readonly onFocusOut = (): void => {
    queueMicrotask(() => {
      if (!this.root.contains(document.activeElement) && !this.listbox.contains(document.activeElement)) this.close();
    });
  };

  private readonly onViewportChanged = (): void => {
    if (this.isOpen()) this.positionPopup();
  };

  private positionPopup(): void {
    const rect = this.trigger.getBoundingClientRect();
    const hostRect = this.portalHost === document.body
      ? { left: -window.scrollX, top: -window.scrollY }
      : this.portalHost.getBoundingClientRect();
    const gap = 6;
    const edge = 8;
    const desiredHeight = Math.min(220, this.options.length * 38 + 8);
    const below = window.innerHeight - rect.bottom - edge - gap;
    const above = rect.top - edge - gap;
    const opensUp = below < desiredHeight && above > below;
    const available = Math.max(72, opensUp ? above : below);
    const height = Math.min(desiredHeight, available);

    this.listbox.dataset.placement = opensUp ? 'top' : 'bottom';
    const viewportLeft = Math.max(edge, Math.min(rect.left, window.innerWidth - rect.width - edge));
    const viewportTop = opensUp
      ? Math.max(edge, rect.top - height - gap)
      : Math.min(window.innerHeight - edge - height, rect.bottom + gap);
    this.listbox.style.left = `${viewportLeft - hostRect.left}px`;
    this.listbox.style.width = `${rect.width}px`;
    this.listbox.style.maxHeight = `${height}px`;
    this.listbox.style.top = `${viewportTop - hostRect.top}px`;
  }

  private isOpen(): boolean { return this.trigger.getAttribute('aria-expanded') === 'true'; }

  destroy(): void {
    this.observer.disconnect();
    document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
    window.removeEventListener('resize', this.onViewportChanged);
    window.removeEventListener('scroll', this.onViewportChanged, true);
    this.root.removeEventListener('focusout', this.onFocusOut);
    this.trigger.removeEventListener('click', this.onTriggerClick);
    this.trigger.removeEventListener('keydown', this.onTriggerKeydown);
    this.select.removeEventListener('change', this.onSelectChange);
    if (this.typeaheadTimer) clearTimeout(this.typeaheadTimer);
    this.listbox.remove();
    this.root.before(this.select);
    this.root.remove();
    this.select.classList.remove('jin-select-field__native');
    this.select.hidden = this.originallyHidden;
    this.select.tabIndex = this.originalTabIndex;
    if (this.originalAriaHidden === null) this.select.removeAttribute('aria-hidden');
    else this.select.setAttribute('aria-hidden', this.originalAriaHidden);
    JinSelectField.instances.delete(this.select);
  }

  static enhance(select: HTMLSelectElement): JinSelectField {
    return this.instances.get(select) ?? new JinSelectField(select);
  }
}
