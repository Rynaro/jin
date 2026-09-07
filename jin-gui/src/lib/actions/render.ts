/**
 * actions/render.ts — DOM rendering helpers for promote / attach / link dialogs.
 *
 * Re-exports the shared form-error utilities from capture/render.ts.
 * ActionsController uses these directly.
 *
 * Tested by: src/__tests__/actions_controller.test.ts
 */

export {
  renderFormError,
  clearFormError,
  renderFormSuccess,
  setFormBusy,
  clearAllFormErrors,
} from '../capture/render';
