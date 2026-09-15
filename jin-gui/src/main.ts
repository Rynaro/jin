/// <reference types="vite/client" />
/**
 * GUI-S1 entry point.
 *
 * Boot order:
 *   1. Inter font weights (OFL — cross-platform Linux fallback for SF Pro)
 *   2. Design-system CSS (tokens → typography → spacing → materials → a11y → motion → layout)
 *   3. Stimulus Application
 *   4. Register all controllers (app, error, appearance)
 *   5. Initialize Lucide icons (replaces data-lucide="name" with SVGs)
 *
 * The AppearanceController loads persisted prefs and applies root data-attributes
 * on connect, before the first paint, minimising FOUC.
 */

// ── Fonts (must load before CSS so @font-face is registered) ─────────────────
// @fontsource/inter: SIL Open Font License 1.1 — free to bundle and redistribute.
// On macOS, -apple-system in the CSS font stack resolves to the real SF Pro
// from the OS, so Inter is only actually rendered on Linux (WebKitGTK).
// Weight 400 = Regular (Body/Titles), Weight 600 = SemiBold (Headline).
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';

// ── Design system CSS ─────────────────────────────────────────────────────────
// main.css is a thin wrapper around index.css which imports the full token system.
import './styles/main.css';

// ── Stimulus ──────────────────────────────────────────────────────────────────
import { Application } from '@hotwired/stimulus';
import AppController from './controllers/app_controller';
import ErrorController from './controllers/error_controller';
import AppearanceController from './controllers/appearance_controller';
import TodayController from './controllers/today_controller';
import RouterController from './controllers/router_controller';
import NotesController from './controllers/notes_controller';
import TasksController from './controllers/tasks_controller';
import EventsController from './controllers/events_controller';
import CalendarViewController from './controllers/calendar_view_controller';
import CaptureController from './controllers/capture_controller';
import ActionsController from './controllers/actions_controller';
import SettingsController from './controllers/settings_controller';
import SidebarController from './controllers/sidebar_controller';
import ListsController from './controllers/lists_controller';
import CalendarController from './controllers/calendar_controller';
import TemporalEditorController from './controllers/temporal_editor_controller';
import NotificationsController from './controllers/notifications_controller';
import FirstRunController from './controllers/first_run_controller';
import { getLaunchState } from './invoke';
import { applyLaunchMode } from './lib/launch_bootstrap';

const stimulusApp = Application.start();

stimulusApp.register('app', AppController);
stimulusApp.register('error', ErrorController);
stimulusApp.register('appearance', AppearanceController);

function startReadyApp(): void {
  document.querySelector<HTMLElement>('.jin-shell')?.removeAttribute('hidden');
  document.querySelector<HTMLElement>('[data-first-run-root]')?.setAttribute('hidden', '');
  document.querySelector<HTMLElement>('.skip-to-content')?.removeAttribute('hidden');
  stimulusApp.register('app', AppController);
  stimulusApp.register('error', ErrorController);
  stimulusApp.register('today', TodayController);
  stimulusApp.register('router', RouterController);
  stimulusApp.register('notes', NotesController);
  stimulusApp.register('tasks', TasksController);
  stimulusApp.register('events', EventsController);
  stimulusApp.register('calendar-view', CalendarViewController);
  stimulusApp.register('capture', CaptureController);
  stimulusApp.register('actions', ActionsController);
  stimulusApp.register('settings', SettingsController);
  stimulusApp.register('sidebar', SidebarController);
  stimulusApp.register('lists', ListsController);
  stimulusApp.register('calendar', CalendarController);
  stimulusApp.register('temporal-editor', TemporalEditorController);
  stimulusApp.register('notifications', NotificationsController);
  initIcons();
}

async function boot(): Promise<void> {
  let launch = null;
  try {
    launch = await getLaunchState();
  } catch {
    // Register setup for the same inline recovery UI if the bridge is not yet
    // available. It reports the retryable error instead of starting product UI.
  }
  applyLaunchMode(launch, { startReady: startReadyApp, startSetup });
}

function startSetup(): void {
  document.querySelector<HTMLElement>('[data-first-run-root]')?.removeAttribute('hidden');
  stimulusApp.register('first-run', FirstRunController);
}

void boot();

// ── Lucide icons ──────────────────────────────────────────────────────────────
// Replace <i data-lucide="name"> elements with actual SVGs after DOM is ready.
import { initIcons } from './lib/icons';

// ── Dev debugging ─────────────────────────────────────────────────────────────
if (import.meta.env.DEV) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__jin_stimulus__ = stimulusApp;
}
