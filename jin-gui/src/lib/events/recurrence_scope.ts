/**
 * Shared recurrence-scope choice primitive.
 *
 * Only scopes the caller supplies are rendered. `this_and_following` is never
 * offered — the supported type is only this_occurrence | entire_series.
 */

import type { RecurrenceMutationScope } from '../../invoke';
import { eventMessage, resolveEventLocale, type EventLocaleKey } from './locale';

export type SupportedRecurrenceScope = Extract<
  RecurrenceMutationScope,
  'this_occurrence' | 'entire_series'
>;

export interface RecurrenceScopeRenderOptions {
  scopes: readonly SupportedRecurrenceScope[];
  value?: SupportedRecurrenceScope | null;
  name: string;
  legend?: string;
  className?: string;
  onChange?: (scope: SupportedRecurrenceScope) => void;
  inputAttributes?: (
    scope: SupportedRecurrenceScope,
  ) => Record<string, string> | undefined;
  locale?: EventLocaleKey;
}

const SCOPE_MESSAGE: Record<SupportedRecurrenceScope, 'thisOccurrence' | 'entireSeries'> = {
  this_occurrence: 'thisOccurrence',
  entire_series: 'entireSeries',
};

/** Build a fieldset of real radio inputs for the supplied scopes only. */
export function renderRecurrenceScope(
  options: RecurrenceScopeRenderOptions,
): HTMLFieldSetElement {
  const locale = options.locale ?? resolveEventLocale();
  const fieldset = document.createElement('fieldset');
  if (options.className) fieldset.className = options.className;

  const legend = document.createElement('legend');
  legend.textContent = options.legend ?? eventMessage('applyTo', locale);
  fieldset.appendChild(legend);

  for (const scope of options.scopes) {
    if (scope !== 'this_occurrence' && scope !== 'entire_series') continue;

    const label = document.createElement('label');
    label.className = 'recurrence-scope__choice';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = options.name;
    input.value = scope;
    if (options.value === scope) input.checked = true;

    const attrs = options.inputAttributes?.(scope);
    if (attrs) {
      for (const [key, attrValue] of Object.entries(attrs)) {
        input.setAttribute(key, attrValue);
      }
    }

    input.addEventListener('change', () => {
      if (input.checked) options.onChange?.(scope);
    });

    const text = document.createElement('span');
    text.textContent = eventMessage(SCOPE_MESSAGE[scope], locale);

    label.appendChild(input);
    label.appendChild(text);
    fieldset.appendChild(label);
  }

  return fieldset;
}
