/**
 * ErrorController — Stimulus controller that renders JinErrorDto messages.
 *
 * Listens for `app:error` events dispatched by AppController (or any other
 * controller) and shows a dismissible error banner.
 */

import { Controller } from '@hotwired/stimulus';
import type { JinErrorDto } from '../types/error';

export default class ErrorController extends Controller {
  static targets = ['container'];

  declare containerTarget: HTMLElement;

  connect(): void {
    // Listen for error events dispatched by sibling controllers.
    this.element.addEventListener('app:error', this.handleError.bind(this));
  }

  disconnect(): void {
    this.element.removeEventListener('app:error', this.handleError.bind(this));
  }

  handleError(event: Event): void {
    const customEvent = event as CustomEvent<JinErrorDto>;
    const err = customEvent.detail;
    if (!err) return;

    this.containerTarget.textContent = '';
    const badge = document.createElement('span');
    badge.className = 'jin-error-code jin-badge';
    badge.textContent = `code ${err.code}`;

    const msg = document.createElement('span');
    msg.className = 'jin-error-message';
    msg.textContent = ` [${err.kind}] ${err.message}`;

    if (err.retriable) {
      const hint = document.createElement('span');
      hint.className = 'jin-error-retriable';
      hint.textContent = ' — will retry';
      this.containerTarget.appendChild(hint);
    }

    this.containerTarget.appendChild(badge);
    this.containerTarget.appendChild(msg);
    this.containerTarget.classList.remove('hidden');
  }

  dismiss(): void {
    this.containerTarget.textContent = '';
    this.containerTarget.classList.add('hidden');
  }
}
