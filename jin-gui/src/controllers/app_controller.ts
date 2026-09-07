/**
 * AppController — Stimulus controller for the minimal GUI-S0 shell.
 *
 * Calls today_agenda on connect and renders the raw DTO JSON.
 * This is proof-of-wiring only — the real Today view is GUI-S3.
 */

import { Controller } from '@hotwired/stimulus';
import { todayAgenda } from '../invoke';
import { isJinErrorDto } from '../types/error';

export default class AppController extends Controller {
  static targets = ['output'];
  static values = { root: String };

  declare outputTarget: HTMLPreElement;
  declare rootValue: string;

  connect(): void {
    void this.loadAgenda();
  }

  async loadAgenda(): Promise<void> {
    try {
      const agenda = await todayAgenda();
      this.outputTarget.textContent = JSON.stringify(agenda, null, 2);
    } catch (err: unknown) {
      if (isJinErrorDto(err)) {
        // Dispatch to the error controller.
        this.dispatch('error', { detail: err, prefix: '' });
        this.outputTarget.textContent = `Error [${err.kind}] code=${err.code}: ${err.message}`;
      } else {
        this.outputTarget.textContent = `Unexpected error: ${String(err)}`;
      }
    }
  }

  // Manual refresh action (e.g. a reload button in future views).
  refresh(): void {
    void this.loadAgenda();
  }
}
