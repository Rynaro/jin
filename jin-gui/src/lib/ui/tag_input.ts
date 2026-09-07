/** Compact chip-based tag input used by creation surfaces. */
export class TagInput {
  private readonly source: HTMLInputElement;
  private readonly root: HTMLDivElement;
  private readonly chips: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly originalType: string;
  private tags: string[] = [];

  constructor(source: HTMLInputElement) {
    this.source = source;
    this.originalType = source.type;
    this.root = document.createElement('div');
    this.root.className = 'jin-tag-input';
    this.chips = document.createElement('div');
    this.chips.className = 'jin-tag-input__chips';
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'jin-tag-input__field';
    this.input.placeholder = source.placeholder || 'Add tag';
    this.input.setAttribute('aria-label', source.getAttribute('aria-label') || 'Add tag');
    source.before(this.root);
    this.root.append(this.chips, this.input, source);
    source.type = 'hidden';
    this.setTags(source.value.split(','));
    this.input.addEventListener('keydown', this.onKeydown);
    this.input.addEventListener('blur', this.onBlur);
  }

  private normalize(value: string): string {
    return value.trim().replace(/^#+/, '').trim().toLocaleLowerCase();
  }

  private commitDraft(): void {
    const candidates = this.input.value.split(',').map(value => this.normalize(value)).filter(Boolean);
    for (const candidate of candidates) if (!this.tags.includes(candidate)) this.tags.push(candidate);
    this.input.value = '';
    this.render();
  }

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.commitDraft();
    } else if (event.key === 'Backspace' && !this.input.value && this.tags.length) {
      this.tags.pop();
      this.render();
    }
  };

  private readonly onBlur = (): void => this.commitDraft();

  private render(): void {
    this.chips.replaceChildren(...this.tags.map(tag => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'jin-tag-input__chip';
      chip.setAttribute('aria-label', `Remove ${tag} tag`);
      chip.textContent = `#${tag} ×`;
      chip.addEventListener('click', () => {
        this.tags = this.tags.filter(value => value !== tag);
        this.render();
        this.input.focus();
      });
      return chip;
    }));
    this.source.value = this.tags.join(',');
    this.source.dispatchEvent(new Event('change', { bubbles: true }));
  }

  getTags(): string[] {
    this.commitDraft();
    return [...this.tags];
  }

  setTags(values: string[]): void {
    this.tags = [];
    for (const value of values) {
      const normalized = this.normalize(value);
      if (normalized && !this.tags.includes(normalized)) this.tags.push(normalized);
    }
    this.render();
  }

  focus(): void { this.input.focus(); }

  destroy(): void {
    this.input.removeEventListener('keydown', this.onKeydown);
    this.input.removeEventListener('blur', this.onBlur);
    this.root.before(this.source);
    this.root.remove();
    this.source.type = this.originalType;
  }
}
