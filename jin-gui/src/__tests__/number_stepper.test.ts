// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createCompactNumberStepper } from '../lib/ui/number_stepper';

describe('createCompactNumberStepper', () => {
  it('changes its native number input within bounds and emits input/change events', () => {
    const stepper = createCompactNumberStepper({
      value: 2, min: 1, max: 3, inputLabel: 'Interval', decrementLabel: 'Decrease interval', incrementLabel: 'Increase interval',
    });
    const input = vi.fn(); const change = vi.fn();
    stepper.input.addEventListener('input', input); stepper.input.addEventListener('change', change);
    stepper.incrementButton.click();
    expect(stepper.input.type).toBe('number');
    expect(stepper.input.value).toBe('3');
    expect(input).toHaveBeenCalledTimes(1); expect(change).toHaveBeenCalledTimes(1);
    stepper.incrementButton.click();
    expect(stepper.input.value).toBe('3');
    stepper.decrementButton.click(); stepper.decrementButton.click(); stepper.decrementButton.click();
    expect(stepper.input.value).toBe('1');
    expect(stepper.decrementButton.getAttribute('aria-label')).toBe('Decrease interval');
  });

  it('retains native typed values and disables input and both buttons together', () => {
    const stepper = createCompactNumberStepper({
      value: 1, min: 1, inputLabel: 'Count', decrementLabel: 'Decrease count', incrementLabel: 'Increase count',
    });
    stepper.input.value = '7';
    stepper.input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(stepper.input.value).toBe('7');
    stepper.setDisabled(true);
    expect(stepper.input.disabled).toBe(true);
    expect(stepper.decrementButton.disabled).toBe(true);
    expect(stepper.incrementButton.disabled).toBe(true);
    expect(stepper.element.getAttribute('aria-disabled')).toBe('true');
  });
});
