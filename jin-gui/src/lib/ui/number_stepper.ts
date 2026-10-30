/** A compact bounded native number input with explicit step buttons. */
export interface CompactNumberStepperOptions {
  value: number;
  min: number;
  max?: number;
  step?: number;
  inputLabel: string;
  decrementLabel: string;
  incrementLabel: string;
}

export interface CompactNumberStepper {
  element: HTMLElement;
  input: HTMLInputElement;
  decrementButton: HTMLButtonElement;
  incrementButton: HTMLButtonElement;
  setDisabled: (disabled: boolean) => void;
}

export function createCompactNumberStepper(options: CompactNumberStepperOptions): CompactNumberStepper {
  const element = document.createElement('div');
  element.className = 'form-number-stepper';
  const decrementButton = document.createElement('button');
  decrementButton.type = 'button'; decrementButton.className = 'form-number-stepper__button';
  decrementButton.textContent = '−'; decrementButton.setAttribute('aria-label', options.decrementLabel);
  const input = document.createElement('input');
  input.type = 'number'; input.className = 'form-number-stepper__input'; input.value = String(options.value);
  input.min = String(options.min); input.step = String(options.step ?? 1);
  if (options.max !== undefined) input.max = String(options.max);
  input.setAttribute('aria-label', options.inputLabel);
  const incrementButton = document.createElement('button');
  incrementButton.type = 'button'; incrementButton.className = 'form-number-stepper__button';
  incrementButton.textContent = '+'; incrementButton.setAttribute('aria-label', options.incrementLabel);
  const changeBy = (direction: -1 | 1) => {
    if (input.disabled) return;
    const step = Number(input.step) || 1;
    const min = Number(input.min);
    const max = input.max === '' ? Number.POSITIVE_INFINITY : Number(input.max);
    const current = input.valueAsNumber;
    const base = Number.isFinite(current) ? current : min;
    const next = Math.min(max, Math.max(min, base + direction * step));
    if (next === base) return;
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  decrementButton.addEventListener('click', () => changeBy(-1));
  incrementButton.addEventListener('click', () => changeBy(1));
  element.append(decrementButton, input, incrementButton);
  return { element, input, decrementButton, incrementButton, setDisabled(disabled) {
    input.disabled = disabled; decrementButton.disabled = disabled; incrementButton.disabled = disabled;
    element.setAttribute('aria-disabled', String(disabled));
  } };
}
