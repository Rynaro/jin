/*
 * Deterministic Tauri bridge fixture for Playwright MCP.
 *
 * This is a classic browser init script: it has no imports/exports and runs
 * before the application bundle. It installs only for Jin's local Vite
 * origin, never replaces a native Tauri bridge, and upgrades an older
 * deterministic bridge injected by an existing browser context.
 */
;(function installJinTauriFixture() {
  'use strict';

  if (window.location.origin !== 'http://127.0.0.1:1420') return;
  if (window.__TAURI_INTERNALS__) {
    var existingInvoke = window.__TAURI_INTERNALS__.invoke;
    var isOlderDeterministicFixture = typeof existingInvoke === 'function'
      && String(existingInvoke).includes('Unsupported Jin fixture command');
    if (!isOlderDeterministicFixture) return;
  }

  var NOW = '2026-07-01T10:00:00Z';
  var lists = [
    { id: 'inbox', name: 'Inbox', color: 'accent', icon: 'inbox', position: 'V', parent_id: null, view: 'list', sort_mode: 'manual', is_default: true, task_count: 4, sections: [] },
    { id: 'work', name: 'Work', color: 'blue', icon: 'briefcase', position: 'W', parent_id: null, view: 'list', sort_mode: 'manual', is_default: false, task_count: 3, sections: [
      { id: 's1', list_id: 'work', name: 'Todo', position: 'V', task_count: 2 },
      { id: 's2', list_id: 'work', name: 'In Progress', position: 'W', task_count: 1 }
    ] },
    { id: 'home', name: 'Home', color: 'green', icon: 'house', position: 'X', parent_id: null, view: 'list', sort_mode: 'manual', is_default: false, task_count: 2, sections: [] }
  ];
  var tags = [
    { slug: 'email', name: 'email', color: 'blue', task_count: 2 },
    { slug: 'urgent', name: 'urgent', color: 'red', task_count: 1 }
  ];
  var taskBase = { status: 'todo', priority: 'none', due: null, list: 'inbox', completed_at: null, deleted_at: null, created: NOW, updated: NOW, backlinks: [], body: '', section_id: null, parent: null, tags: [], position: 'V', reminders: [], agenda_bucket: null };
  function task(fields) { return Object.assign({}, taskBase, fields); }
  var tasks = [
    task({ id: 't1', title: 'Reply to the design review email with the complete workspace rationale', body: 'Document the continuous workspace rationale and verify the interaction details.', list: 'work', section_id: 's1', priority: 'high', due: '2026-06-28', tags: ['email', 'urgent'], position: 'V' }),
    task({ id: 't2', title: 'Draft Q3 planning doc', list: 'work', section_id: 's1', priority: 'medium', due: '2026-07-05T14:00:00Z', tags: ['email'], position: 'W', agenda_bucket: 'flexible' }),
    task({ id: 't3', title: 'Prepare stakeholder notes', list: 'work', section_id: 's2', status: 'doing', priority: 'low', position: 'X' }),
    task({ id: 't4', title: 'Water the plants', list: 'home', priority: 'low', position: 'Y' }),
    task({ id: 't5', title: 'Renew library books', list: 'home', status: 'done', completed_at: NOW, position: 'Z' }),
    task({ id: 't6', title: 'Book dentist appointment', list: 'inbox', position: 'a0' })
  ];
  var folders = [
    { path: 'Field Notes', name: 'Field Notes', note_count: 2 },
    { path: 'Field Notes/Water', name: 'Water', note_count: 0 },
    { path: 'Studio', name: 'Studio', note_count: 2 },
    { path: 'Empty', name: 'Empty', note_count: 0 }
  ];
  var noteBase = { status: 'active', created: NOW, updated: NOW, deleted_at: null, links: [], backlinks: [], revision: 1 };
  var notes = [
    Object.assign({}, noteBase, { id: 'n1', title: 'A current moving through glass', tags: ['jin', 'visual'], excerpt: 'Liquid depth, brush restraint, and a bright flash of betta red.', folder_path: 'Field Notes' }),
    Object.assign({}, noteBase, { id: 'n2', title: 'Margins with their own tide', tags: ['layout'], excerpt: 'The page breathes differently when every edge refuses symmetry.', folder_path: 'Field Notes' }),
    Object.assign({}, noteBase, { id: 'n3', title: 'Nanquim studies', tags: ['ink'], excerpt: 'Dry brush, pooled pigment, rice paper, one decisive seal.', folder_path: 'Studio' }),
    Object.assign({}, noteBase, { id: 'n4', title: 'Small rituals', tags: [], excerpt: 'A quiet list of details worth returning to.', folder_path: 'Studio' })
  ];
  var collections = [];
  var eventBase = { description: null, location: null, is_all_day: false, start_tzid: null, end_tzid: null, floating: false, status: 'confirmed', source: 'jin', authority: 'jin', ical_uid: null, derived_from: null, recurrence: [], recurring_event_id: null, original_start: null, master_id: null, recurrence_unexpanded: false, sequence: 0, organizer: null, attendees: null, attendees_omitted: null, conference_data: null, hangout_link: null, reminders: null, created: NOW, updated: NOW, backlinks: [], sync_context: null };
  function event(fields) {
    var item = Object.assign({}, eventBase, fields);
    item.recurrence = (item.recurrence || []).slice();
    item.backlinks = (item.backlinks || []).map(function cloneBacklink(link) { return Object.assign({}, link); });
    return item;
  }
  function eventIsMutable(item) {
    return item.status !== 'cancelled' && item.source === 'jin' && item.authority === 'jin' &&
      item.recurrence.length === 0 && item.recurring_event_id === null &&
      item.original_start === null && item.master_id === null && !item.recurrence_unexpanded;
  }
  function routedEventIsMutable(item) {
    return item.status !== 'cancelled' && Boolean(item.sync_context && item.sync_context.writable);
  }
  function requireValidEventInput(input) {
    if (!String(input.title || '').trim()) throw new Error('event title is required');
    if (!input.start || !input.end || String(input.end) <= String(input.start)) {
      throw new Error('event end must be after start');
    }
  }
  var googleAccounts = [
    {
      id: 'acct-personal', alias: 'Personal', principal: 'personal@example.com', state: 'connected', auth_generation: 2,
      calendars: [
        { account_id: 'acct-personal', calendar_id: 'personal-primary', name: 'Personal', primary: true, access_role: 'owner', writable: true, enabled: true, available: true, route_generation: 3 },
        { account_id: 'acct-personal', calendar_id: 'family-shared', name: 'Family', primary: false, access_role: 'reader', writable: false, enabled: true, available: true, route_generation: 1 }
      ]
    },
    {
      id: 'acct-work', alias: 'Work', principal: 'work@example.com', state: 'connected', auth_generation: 4,
      calendars: [
        { account_id: 'acct-work', calendar_id: 'work-primary', name: 'Team Calendar', primary: true, access_role: 'writer', writable: true, enabled: true, available: true, route_generation: 5 },
        { account_id: 'acct-work', calendar_id: 'focus-room', name: 'Focus Room', primary: false, access_role: 'owner', writable: true, enabled: false, available: true, route_generation: 2 }
      ]
    }
  ];
  function syncContext(accountId, calendarId, state) {
    var account = googleAccounts.find(function findAccount(item) { return item.id === accountId; });
    var calendar = account && account.calendars.find(function findCalendar(item) { return item.calendar_id === calendarId; });
    if (!account || !calendar) return null;
    return {
      provider: 'google', account_id: account.id, account_alias: account.alias,
      calendar_id: calendar.calendar_id, calendar_name: calendar.name,
      access_role: calendar.access_role,
      writable: account.state === 'connected' && calendar.writable && calendar.enabled && calendar.available,
      state: state || 'synced'
    };
  }
  function refreshSyncContexts() {
    events.forEach(function refreshEventContext(item) {
      if (!item.sync_context) return;
      item.sync_context = syncContext(item.sync_context.account_id, item.sync_context.calendar_id, item.sync_context.state);
    });
  }
  var events = [
    event({ id: 'e1', title: 'Sprint Planning', start: '2026-08-20T09:00:00', end: '2026-08-20T10:30:00', location: 'Conference Room A', description: 'Review sprint goals and assign tasks for the upcoming sprint' }),
    event({ id: 'e2', title: 'Team Standup', start: '2026-08-20T10:00:00', end: '2026-08-20T10:15:00' }),
    event({ id: 'e3', title: 'Q3 Review', start: '2026-08-20', end: '2026-08-21', is_all_day: true }),
    event({ id: 'e4', title: 'Design Critique', start: '2026-08-21T14:00:00', end: '2026-08-21T15:00:00', description: 'Review the new component library with the design team' }),
    event({ id: 'e5', title: 'Retrospective', start: '2026-08-22T15:00:00', end: '2026-08-22T16:00:00' }),
    event({ id: 'e6', title: 'Company All-Hands', start: '2026-08-25', end: '2026-08-27', is_all_day: true }),
    event({ id: 'e7', title: 'Imported recurring instance', start: '2026-09-10T09:00:00', end: '2026-09-10T10:00:00', source: 'google', authority: 'google', recurring_event_id: 'google-master-1', original_start: '2026-09-10T09:00:00', reminders: { useDefault: true }, sync_context: syncContext('acct-personal', 'personal-primary') }),
    event({
      id: 'e8', title: 'Partner review', start: '2026-08-20T11:00:00', end: '2026-08-20T12:00:00',
      source: 'google', authority: 'google', sync_context: syncContext('acct-work', 'work-primary'),
      organizer: { email: 'host@partner.example', displayName: 'Morgan Chen', self: false, providerOnly: '<img src=x onerror=alert(1)>' },
      attendees: [
        { email: 'alex@example.com', displayName: 'Alex Rivera', responseStatus: 'accepted' },
        { email: 'sam@example.com', displayName: 'Sam Oliveira', responseStatus: 'tentative', optional: true },
        { email: 'lee@example.com', displayName: 'Lee Taylor', responseStatus: 'declined' }
      ],
      attendees_omitted: true,
      hangout_link: 'https://meet.google.com/abc-defg-hij',
      conference_data: {
        conferenceSolution: { key: { type: 'hangoutsMeet', providerOnly: 'hidden' }, name: 'Google Meet', providerOnly: 'hidden' },
        conferenceId: 'abc-defg-hij',
        entryPoints: [
          { entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij', label: 'meet.google.com/abc-defg-hij', providerOnly: 'hidden' },
          { entryPointType: 'phone', uri: 'tel:+15550199', label: '+1 555 0199', pin: '246810' },
          { entryPointType: 'video', uri: 'javascript:alert(1)', label: 'Unsafe provider URL' }
        ],
        notes: 'Use the lobby and wait for the host to admit you.',
        providerOnly: '<script>alert(1)</script>'
      },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }, { method: 'email', minutes: 60 }] }
    }),
    event({ id: 'e9', title: 'Prepare stakeholder notes', start: '2026-08-20T12:15:00', end: '2026-08-20T13:00:00', derived_from: 't3' }),
    event({ id: 'e10', title: 'Airport pickup', start: '2026-08-20T02:00:00', end: '2026-08-20T03:00:00' }),
    event({ id: 'e11', title: 'Call São Paulo', start: '2026-08-20T22:45:00', end: '2026-08-20T23:15:00' }),
    event({ id: 'e12', title: 'Google focus interview', start: '2026-08-20T16:00:00', end: '2026-08-20T16:45:00', source: 'google', authority: 'google', reminders: { useDefault: false }, sync_context: syncContext('acct-personal', 'family-shared') })
  ];
  var nextEventSequence = 12;
  var eventEditOperations = {};
  var quarantinedOperations = [
    { operation_id: 'fixture-paused-001', provider: 'google', operation: 'patch', jin_id: 'e8', recurrence_key: 'master', account_id: 'acct-work', account_alias: 'Work', calendar_id: 'work-primary', calendar_name: 'Team Calendar', pause_reason: 'provider_permission_changed' }
  ];

  function eventEditToken(item) {
    return 'fixture-event:' + item.id + ':' + item.sequence;
  }

  function attachNoteBacklink(noteId, eventId, edgeType) {
    var sourceNote = notes.find(function findSourceNote(item) { return item.id === noteId; });
    if (!sourceNote) throw new Error('Note not found: ' + noteId);
    var targetEvent = events.find(function findTargetEvent(item) { return item.id === eventId; });
    if (!targetEvent) throw new Error('Event not found: ' + eventId);
    var existing = targetEvent.backlinks.find(function findBacklink(link) {
      return link.source_id === noteId && link.edge_type === edgeType;
    });
    if (!existing) {
      targetEvent.backlinks.push({
        source_id: noteId,
        source_kind: 'note',
        edge_type: edgeType,
        label: sourceNote.title,
      });
    }
    return { edge_type: edgeType, source_id: noteId, target_id: eventId };
  }
  var fixtures = {
    list_lists: lists,
    list_tags: tags,
    list_tasks: tasks,
    list_folders: folders,
    list_notes: notes,
    today_agenda: { date: '2026-08-20', display_tz: 'UTC', all_day_events: [
      { id: 'e3', title: 'Q3 Review', start: '2026-08-20', end: '2026-08-21', is_all_day: true, start_tzid: null, floating: false, status: 'confirmed', source: 'jin', authority: 'jin', ical_uid: null, derived_from: null, recurrence_unexpanded: false, created: NOW, updated: NOW, display_start: 'all-day', originating_task: null, prep_notes: [] }
    ], timed_events: [
      { id: 'e1', title: 'Sprint Planning', start: '2026-08-20T09:00:00', end: '2026-08-20T10:30:00', is_all_day: false, start_tzid: null, floating: false, status: 'confirmed', source: 'jin', authority: 'jin', ical_uid: null, derived_from: null, recurrence_unexpanded: false, created: NOW, updated: NOW, display_start: '09:00', originating_task: null, prep_notes: [] },
      { id: 'e2', title: 'Team Standup', start: '2026-08-20T10:00:00', end: '2026-08-20T10:15:00', is_all_day: false, start_tzid: null, floating: false, status: 'confirmed', source: 'jin', authority: 'jin', ical_uid: null, derived_from: null, recurrence_unexpanded: false, created: NOW, updated: NOW, display_start: '10:00', originating_task: null, prep_notes: [] },
      { id: 'e8', title: 'Partner review', start: '2026-08-20T11:00:00', end: '2026-08-20T12:00:00', is_all_day: false, start_tzid: null, floating: false, status: 'confirmed', source: 'google', authority: 'google', ical_uid: 'fixture-work-e8@google', derived_from: null, recurrence_unexpanded: false, created: NOW, updated: NOW, display_start: '11:00', originating_task: null, prep_notes: [], sync_context: syncContext('acct-work', 'work-primary') }
    ] },
    auth_status: { state: 'disconnected', account: null, expires_at: null, backend: 'none' },
    app_config: { root_path: '/tmp', display_tz: 'UTC', calendar_id: null, schema_version: 3 },
    get_config: { root_path: '/tmp', display_tz: 'UTC', calendar_id: null, schema_version: 3 }
  };
  var notificationState = {
    platform: 'macos', permission: 'prompt',
    reason: 'macOS has not asked for notification permission yet.',
    can_request: true, can_open_settings: true, settings_scope: 'notification_center'
  };
  var notificationCapabilities = {
    can_mark_read: true, can_defer: true, can_dismiss: true,
    can_respond: false, can_complete_task: false, can_open_source: true,
    recurrence_scopes: [], disabled_reason: null
  };
  function notificationCommon(fields) {
    return Object.assign({
      source_revision: 'fixture-revision-1', status: 'active', version: 1,
      read_at: null, visible_after: null, created_at: NOW, updated_at: NOW,
      requested_action: null, action_state: null, action_error: null,
      native_state: 'not_requested', resolution_origin: null, source_reason: null,
      schema_version: 1
    }, fields);
  }
  var notificationItems = [
    notificationCommon({
      id: 'notification-invite-recurring',
      source_key: 'google/acct-work/work-primary/google-recurring-1/2026-08-20T11:00:00Z',
      kind: 'calendar_invitation', account_id: 'acct-work', account_alias: 'Work',
      calendar_id: 'work-primary', calendar_name: 'Team Calendar', canonical_event_id: 'e8',
      google_event_id: 'google-recurring-instance-1',
      recurrence: {
        type: 'instance', instance_google_event_id: 'google-recurring-instance-1',
        recurring_event_id: 'google-recurring-1', original_start: '2026-08-20T11:00:00Z',
        original_start_tzid: 'America/Sao_Paulo'
      },
      title: 'Partner roadmap review', organizer_name: 'Morgan Chen',
      organizer_email: 'host@partner.example', start: '2026-08-20T11:00:00Z',
      end: '2026-08-20T12:00:00Z', all_day: false, timezone: 'America/Sao_Paulo',
      location: 'Google Meet', self_email: 'work@example.com',
      provider_response_status: 'needsAction', etag: 'fixture-etag-1',
      provider_subject: 'work@example.com', auth_generation: 4, route_generation: 5,
      capabilities: Object.assign({}, notificationCapabilities, {
        can_respond: true, recurrence_scopes: ['this_occurrence', 'entire_series']
      })
    }),
    notificationCommon({
      id: 'notification-task-reminder',
      source_key: 'task/t1/2026-07-01T10:00:00Z', kind: 'task_reminder',
      occurrence_key: '2026-07-01T10:00:00Z', task_id: 't1',
      title: 'Reply to the design review email', scheduled_at: NOW,
      list_name: 'Work', project_name: 'Launch', task_edit_token: 'fixture-task-t1',
      native_state: 'submitted',
      capabilities: Object.assign({}, notificationCapabilities, { can_complete_task: true })
    }),
    notificationCommon({
      id: 'notification-invite-pending',
      source_key: 'google/acct-personal/personal-primary/google-pending-1/master',
      kind: 'calendar_invitation', account_id: 'acct-personal', account_alias: 'Personal',
      calendar_id: 'personal-primary', calendar_name: 'Personal', canonical_event_id: 'e7',
      google_event_id: 'google-pending-1', recurrence: { type: 'single' },
      title: 'Dinner planning', organizer_name: 'Avery Silva',
      organizer_email: 'avery@example.test', start: '2026-08-21T19:00:00Z',
      end: '2026-08-21T20:00:00Z', all_day: false, timezone: 'UTC', location: null,
      self_email: 'personal@example.com', provider_response_status: 'needsAction',
      etag: 'fixture-etag-2', provider_subject: 'personal@example.com',
      auth_generation: 2, route_generation: 3, status: 'action_pending',
      requested_action: 'maybe', action_state: 'queued', native_state: 'pending',
      capabilities: Object.assign({}, notificationCapabilities, { can_respond: true })
    }),
    notificationCommon({
      id: 'notification-invite-retryable',
      source_key: 'google/acct-work/work-primary/google-retryable-1/master',
      kind: 'calendar_invitation', account_id: 'acct-work', account_alias: 'Work',
      calendar_id: 'work-primary', calendar_name: 'Team Calendar', canonical_event_id: 'e9',
      google_event_id: 'google-retryable-1', recurrence: { type: 'single' },
      title: 'Vendor contract review', organizer_name: 'Sam Rivera',
      organizer_email: 'sam@vendor.example', start: '2026-08-22T15:00:00Z',
      end: '2026-08-22T15:30:00Z', all_day: false, timezone: 'UTC', location: 'Meet',
      self_email: 'work@example.com', provider_response_status: 'needsAction',
      etag: 'fixture-etag-3', provider_subject: 'work@example.com',
      auth_generation: 4, route_generation: 5, requested_action: 'refuse',
      action_state: 'failed_retryable',
      action_error: { code: 'provider_failed', message: 'Google is temporarily unavailable.', retryable: true },
      capabilities: Object.assign({}, notificationCapabilities, { can_respond: true })
    }),
    notificationCommon({
      id: 'notification-deferred-reminder', source_key: 'task/t2/deferred',
      kind: 'task_reminder', occurrence_key: 'deferred', task_id: 't2',
      title: 'Draft Q3 planning doc', scheduled_at: NOW, list_name: 'Work',
      project_name: null, task_edit_token: 'fixture-task-t2',
      visible_after: '2026-07-02T09:00:00Z',
      capabilities: Object.assign({}, notificationCapabilities, { can_complete_task: true })
    }),
    notificationCommon({
      id: 'notification-history-dismissed', source_key: 'task/t4/history',
      kind: 'task_reminder', occurrence_key: 'history', task_id: 't4',
      title: 'Water the plants', scheduled_at: NOW, list_name: 'Home',
      project_name: null, task_edit_token: 'fixture-task-t4', status: 'dismissed',
      source_reason: 'dismissed_by_user', capabilities: notificationCapabilities
    })
  ];
  var notificationPartialErrors = [{
    source_kind: 'calendar_invitation', source_key: 'google/acct-work/work-primary/broken-event',
    code: 'canonical_event_invalid', message: 'One calendar event could not be refreshed.',
    updated_at: NOW
  }];

  function notificationById(id) {
    return notificationItems.find(function findNotification(item) { return item.id === id; });
  }

  function requireNotificationInput(options) {
    var input = options.input || {};
    var item = notificationById(input.item_id);
    if (!item) throw new Error('Notification not found: ' + input.item_id);
    var expected = input.expected_version;
    if (expected === undefined) expected = input.expected_item_version;
    if (expected !== item.version) {
      throw { code: 'stale_item', message: 'This notification changed; review the latest state.', retryable: true, item: clone(item) };
    }
    return { input: input, item: item };
  }

  function notificationSummary() {
    var visible = notificationItems.filter(function visibleNotification(item) {
      return (item.status === 'active' || item.status === 'action_pending')
        && (item.visible_after === null || item.visible_after <= NOW);
    });
    return {
      visible_unread: visible.filter(function unreadNotification(item) { return item.read_at === null; }).length,
      visible_total: visible.length,
      pending: visible.filter(function pendingNotification(item) { return item.status === 'action_pending'; }).length,
      errors: visible.filter(function failedNotification(item) { return item.action_error !== null; }).length,
      partial_error_count: notificationPartialErrors.length
    };
  }

  function clone(value) {
    if (value === undefined) return value;
    if (typeof window.structuredClone === 'function') return window.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  window.__TAURI_INTERNALS__ = {
    invoke: function invoke(cmd, args) {
      var options = args || {};
      if (cmd === 'list_tasks') {
        var matchingTasks = tasks.filter(function matchesTask(item) {
          if (!options.include_deleted && item.deleted_at !== null) return false;
          if (options.list !== undefined && item.list !== options.list) return false;
          if (options.status !== undefined && item.status !== options.status) return false;
          if (options.priority !== undefined && item.priority !== options.priority) return false;
          if (options.tag !== undefined && item.tags.indexOf(options.tag) === -1) return false;
          return true;
        });
        return Promise.resolve(clone(matchingTasks.map(function listProjection(item) {
          return Object.assign({}, item, { body: '' });
        })));
      }
      if (cmd === 'get_task') {
        var taskDetail = tasks.find(function findTask(item) { return item.id === options.id; });
        if (!taskDetail) return Promise.reject(new Error('Task not found: ' + options.id));
        return Promise.resolve(clone(taskDetail));
      }
      if (cmd === 'edit_task') {
        var taskIndex = tasks.findIndex(function findTaskIndex(item) { return item.id === options.id; });
        if (taskIndex === -1) return Promise.reject(new Error('Task not found: ' + options.id));
        var input = options.input || {};
        var editableKeys = ['title', 'body', 'priority', 'due', 'list', 'tags', 'section_id', 'reminders', 'parent'];
        editableKeys.forEach(function applyEdit(key) {
          if (Object.prototype.hasOwnProperty.call(input, key)) tasks[taskIndex][key] = clone(input[key]);
        });
        if (input.clear_due) tasks[taskIndex].due = null;
        if (input.clear_section) tasks[taskIndex].section_id = null;
        if (input.clear_parent) tasks[taskIndex].parent = null;
        tasks[taskIndex].updated = NOW;
        return Promise.resolve(clone(tasks[taskIndex]));
      }
      if (cmd === 'list_notes') {
        var matchingNotes = notes.filter(function matchesNote(item) {
          if (!options.include_deleted && item.deleted_at !== null) return false;
          if (options.folder !== undefined && item.folder_path !== options.folder) return false;
          if (options.tag !== undefined && item.tags.indexOf(options.tag) === -1) return false;
          return true;
        });
        return Promise.resolve(clone(matchingNotes));
      }
      if (cmd === 'get_note') {
        var note = notes.find(function findNote(item) { return item.id === options.id; });
        if (!note) return Promise.reject(new Error('Note not found: ' + options.id));
        return Promise.resolve(clone(Object.assign({}, note, {
          body_markdown: '# ' + note.title + '\n\nA deterministic note body for visual QA.\n\n> Ink is reserved for meaning, not atmosphere.',
          folder_path: null
        })));
      }
      if (cmd === 'search_notes') {
        var needle = String(options.text || '').toLowerCase();
        return Promise.resolve(clone(notes.filter(function matchesLiteralNote(item) {
          return item.title.toLowerCase().indexOf(needle) !== -1 ||
            item.excerpt.toLowerCase().indexOf(needle) !== -1;
        })));
      }
      if (cmd === 'list_collections') {
        return Promise.resolve(clone(collections));
      }
      if (cmd === 'create_collection') {
        var inputCollection = options.input || {};
        var createdCollection = {
          schema_version: 1,
          id: 'collection-' + String(collections.length + 1),
          name: String(inputCollection.name || 'Untitled collection'),
          query: clone(inputCollection.query || { version: 1, filter: { op: 'all', clauses: [] }, sort: [], limit: null }),
          view: {}
        };
        collections.push(createdCollection);
        return Promise.resolve(clone(createdCollection));
      }
      if (cmd === 'rename_collection') {
        var renameCollection = collections.find(function findCollection(item) { return item.id === options.id; });
        if (!renameCollection) return Promise.reject(new Error('Collection not found: ' + options.id));
        renameCollection.name = String(options.name || '');
        return Promise.resolve(clone(renameCollection));
      }
      if (cmd === 'update_collection_query') {
        var updateCollection = collections.find(function findCollection(item) { return item.id === options.id; });
        if (!updateCollection) return Promise.reject(new Error('Collection not found: ' + options.id));
        updateCollection.query = clone((options.input || {}).query);
        return Promise.resolve(clone(updateCollection));
      }
      if (cmd === 'delete_collection') {
        collections = collections.filter(function keepCollection(item) { return item.id !== options.id; });
        return Promise.resolve();
      }
      if (cmd === 'evaluate_collection') {
        var evaluatedCollection = collections.find(function findCollection(item) { return item.id === options.id; });
        if (!evaluatedCollection) return Promise.reject(new Error('Collection not found: ' + options.id));
        var filter = evaluatedCollection.query && evaluatedCollection.query.filter;
        var evaluatedNotes = notes.filter(function matchesCollection(item) {
          if (!filter || filter.op === 'all') return true;
          if (filter.op === 'tag') return item.tags.indexOf(filter.value) !== -1;
          if (filter.op === 'status') return item.status === filter.value;
          if (filter.op === 'body_contains') return item.excerpt.toLowerCase().indexOf(String(filter.value || '').toLowerCase()) !== -1;
          return true;
        });
        return Promise.resolve(clone(evaluatedNotes));
      }
      if (cmd === 'list_note_revisions') {
        return Promise.resolve([1]);
      }
      if (cmd === 'preview_note_revision') {
        var previewNote = notes.find(function findNote(item) { return item.id === options.id; });
        if (!previewNote) return Promise.reject(new Error('Note not found: ' + options.id));
        return Promise.resolve({
          revision: Number(options.revision),
          title: previewNote.title,
          body_markdown: '# ' + previewNote.title + '\n\nA deterministic revision preview.',
          updated: previewNote.updated
        });
      }
      if (cmd === 'restore_note_revision') {
        var restoredNote = notes.find(function findNote(item) { return item.id === options.id; });
        if (!restoredNote) return Promise.reject(new Error('Note not found: ' + options.id));
        restoredNote.revision += 1;
        restoredNote.updated = NOW;
        return Promise.resolve(clone(restoredNote));
      }
      if (cmd === 'import_attachment') {
        var source = String(options.source || '');
        var filename = source.split('/').pop() || 'attachment';
        return Promise.resolve({
          sha256: 'fixture-asset-' + filename.replace(/[^a-z0-9]/gi, '').toLowerCase(),
          mime: 'application/octet-stream',
          size: 1,
          original_names: [filename]
        });
      }
      if (cmd === 'list_events') {
        var matchingEvents = events.filter(function matchesEvent(item) {
          if (!options.include_deleted && item.status === 'cancelled') return false;
          return true;
        });
        return Promise.resolve(clone(matchingEvents));
      }
      if (cmd === 'list_google_accounts') return Promise.resolve(clone(googleAccounts));
      if (cmd === 'add_google_account') {
        var alias = String(options.alias || '').trim();
        if (!alias) return Promise.reject(new Error('account alias is required'));
        var addedAccount = { id: 'acct-' + String(googleAccounts.length + 1).padStart(3, '0'), alias: alias, principal: null, state: 'pending', auth_generation: 0, calendars: [] };
        googleAccounts.push(addedAccount);
        return Promise.resolve(clone(addedAccount));
      }
      if (cmd === 'rename_google_account') {
        var renameAccount = googleAccounts.find(function findAccount(item) { return item.id === options.account_id; });
        if (!renameAccount) return Promise.reject(new Error('Google account not found'));
        var renamedAlias = String(options.alias || '').trim();
        if (!renamedAlias) return Promise.reject(new Error('account alias is required'));
        renameAccount.alias = renamedAlias;
        refreshSyncContexts();
        quarantinedOperations.forEach(function refreshQuarantineAlias(item) {
          if (item.account_id === renameAccount.id) item.account_alias = renamedAlias;
        });
        return Promise.resolve(clone(googleAccounts));
      }
      if (cmd === 'connect_google_account') {
        var connectAccount = googleAccounts.find(function findAccount(item) { return item.id === options.account_id; });
        if (!connectAccount) return Promise.reject(new Error('Google account not found'));
        connectAccount.state = 'connected';
        connectAccount.principal = connectAccount.principal || connectAccount.alias.toLowerCase().replace(/[^a-z0-9]+/g, '.') + '@example.com';
        connectAccount.auth_generation += 1;
        if (connectAccount.calendars.length === 0) connectAccount.calendars.push({
          account_id: connectAccount.id, calendar_id: connectAccount.id + '-primary', name: connectAccount.alias,
          primary: true, access_role: 'owner', writable: true, enabled: true, available: true, route_generation: 1
        });
        refreshSyncContexts();
        return Promise.resolve(clone(googleAccounts));
      }
      if (cmd === 'disconnect_google_account') {
        var disconnectAccount = googleAccounts.find(function findAccount(item) { return item.id === options.account_id; });
        if (!disconnectAccount) return Promise.reject(new Error('Google account not found'));
        disconnectAccount.state = 'disconnected';
        disconnectAccount.auth_generation += 1;
        refreshSyncContexts();
        return Promise.resolve(clone(googleAccounts));
      }
      if (cmd === 'refresh_google_calendars') {
        var refreshAccount = googleAccounts.find(function findAccount(item) { return item.id === options.account_id; });
        if (!refreshAccount || refreshAccount.state !== 'connected') return Promise.reject(new Error('Connect this account before refreshing calendars'));
        refreshAccount.calendars.forEach(function refreshCalendar(item) { item.available = true; item.route_generation += 1; });
        refreshSyncContexts();
        return Promise.resolve(clone(googleAccounts));
      }
      if (cmd === 'set_google_calendar_enabled') {
        var toggleAccount = googleAccounts.find(function findAccount(item) { return item.id === options.account_id; });
        var toggleCalendar = toggleAccount && toggleAccount.calendars.find(function findCalendar(item) { return item.calendar_id === options.calendar_id; });
        if (!toggleCalendar) return Promise.reject(new Error('Google calendar not found'));
        toggleCalendar.enabled = options.enabled === true;
        toggleCalendar.route_generation += 1;
        refreshSyncContexts();
        return Promise.resolve(clone(googleAccounts));
      }
      if (cmd === 'list_quarantined_sync_operations') return Promise.resolve(clone(quarantinedOperations));
      if (cmd === 'review_quarantined_sync_operation') {
        var reviewIndex = quarantinedOperations.findIndex(function findOperation(item) {
          return item.provider === options.provider && item.account_id === options.account_id &&
            item.calendar_id === options.calendar_id && item.operation_id === options.operation_id;
        });
        if (reviewIndex === -1) return Promise.reject(new Error('Quarantined operation not found'));
        quarantinedOperations.splice(reviewIndex, 1);
        return Promise.resolve();
      }
      if (cmd === 'get_event') {
        var requestedEvent = events.find(function findEvent(item) { return item.id === options.id; });
        if (!requestedEvent) return Promise.reject(new Error('Event not found: ' + options.id));
        return Promise.resolve(clone(requestedEvent));
      }
      if (cmd === 'get_event_detail') {
        var detailEvent = events.find(function findEvent(item) { return item.id === options.id; });
        if (!detailEvent) return Promise.reject(new Error('Event not found: ' + options.id));
        var origin = detailEvent.derived_from
          ? tasks.find(function findOrigin(item) { return item.id === detailEvent.derived_from; })
          : null;
        var readOnlyReason = detailEvent.status === 'cancelled' ? 'cancelled'
          : (detailEvent.source !== 'jin' || detailEvent.authority !== 'jin') && !(detailEvent.sync_context && detailEvent.sync_context.writable) ? 'external_authority_or_source'
          : null;
        var canReturn = Boolean(origin && (origin.status === 'todo' || origin.status === 'doing') && !readOnlyReason &&
          !events.some(function otherBlock(item) { return item.id !== detailEvent.id && item.derived_from === origin.id && item.status !== 'cancelled'; }));
        return Promise.resolve(clone({
          event: detailEvent,
          edit_token: eventEditToken(detailEvent),
          capabilities: {
            display_kind: detailEvent.derived_from ? 'time-block' : 'event',
            can_edit: !readOnlyReason,
            can_delete: !readOnlyReason,
            read_only_reason: readOnlyReason,
            can_return_task_to_flexible: canReturn,
            originating_task: origin ? { id: origin.id, title: origin.title, status: origin.status } : null
          }
        }));
      }
      if (cmd === 'preview_recurrence') {
        var previewInput = options.input || {};
        var draft = previewInput.recurrence || {};
        var interval = Math.max(1, Number(draft.interval) || 1);
        var cursor = new Date(String(previewInput.start || NOW) + (previewInput.is_all_day ? 'T12:00:00' : ''));
        var occurrences = [];
        for (var recurrenceIndex = 0; recurrenceIndex < 3; recurrenceIndex += 1) {
          if (draft.frequency === 'monthly' && draft.monthly && draft.monthly.kind === 'nth_weekday') {
            var monthCursor = new Date(cursor);
            monthCursor.setDate(1);
            monthCursor.setMonth(monthCursor.getMonth() + (recurrenceIndex * interval));
            var weekdayIndex = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'].indexOf(draft.monthly.weekday);
            if (Number(draft.monthly.ordinal) === -1) {
              monthCursor.setMonth(monthCursor.getMonth() + 1);
              monthCursor.setDate(0);
              monthCursor.setDate(monthCursor.getDate() - ((monthCursor.getDay() - weekdayIndex + 7) % 7));
            } else {
              monthCursor.setDate(1 + ((weekdayIndex - monthCursor.getDay() + 7) % 7) + ((Number(draft.monthly.ordinal) - 1) * 7));
            }
            occurrences.push(previewInput.is_all_day
              ? monthCursor.getFullYear() + '-' + String(monthCursor.getMonth() + 1).padStart(2, '0') + '-' + String(monthCursor.getDate()).padStart(2, '0')
              : monthCursor.toISOString());
            continue;
          }
          occurrences.push(previewInput.is_all_day
            ? cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0') + '-' + String(cursor.getDate()).padStart(2, '0')
            : cursor.toISOString());
          if (draft.frequency === 'daily') cursor.setDate(cursor.getDate() + interval);
          else if (draft.frequency === 'monthly') cursor.setMonth(cursor.getMonth() + interval);
          else if (draft.frequency === 'yearly') cursor.setFullYear(cursor.getFullYear() + interval);
          else cursor.setDate(cursor.getDate() + (7 * interval));
        }
        return Promise.resolve({ recurrence: [], occurrences: occurrences });
      }
      if (cmd === 'create_event') {
        var input = options.input || {};
        try { requireValidEventInput(input); } catch (validationError) { return Promise.reject(validationError); }
        var newEvent = event({
          id: 'fixture-event-' + String(nextEventSequence++).padStart(3, '0'),
          title: String(input.title || 'Untitled'),
          start: String(input.start || NOW),
          end: String(input.end || input.start || NOW),
          is_all_day: input.is_all_day === true,
          location: input.location || null,
          description: input.description || null,
          start_tzid: input.is_all_day === true ? null : (input.tzid || null),
          end_tzid: input.is_all_day === true ? null : (input.tzid || null),
          floating: input.is_all_day !== true && !input.tzid,
        });
        events.push(newEvent);
        fixtures.list_events = events;
        return Promise.resolve(clone(newEvent));
      }
      if (cmd === 'create_routed_event') {
        var routedInput = options.input || {};
        try { requireValidEventInput(routedInput); } catch (routedValidationError) { return Promise.reject(routedValidationError); }
        if (!routedInput.operation_id) return Promise.reject(new Error('operation_id is required'));
        var routedContext = syncContext(routedInput.account_id, routedInput.calendar_id, 'pending');
        if (!routedContext || !routedContext.writable) return Promise.reject(new Error('selected calendar is not writable'));
        var routedEvent = event({
          id: 'fixture-event-' + String(nextEventSequence++).padStart(3, '0'), title: String(routedInput.title || 'Untitled'),
          start: String(routedInput.start || NOW), end: String(routedInput.end || routedInput.start || NOW),
          is_all_day: routedInput.is_all_day === true, location: routedInput.location || null,
          description: routedInput.description || null, start_tzid: routedInput.is_all_day === true ? null : (routedInput.tzid || null),
          end_tzid: routedInput.is_all_day === true ? null : (routedInput.tzid || null),
          floating: routedInput.is_all_day !== true && !routedInput.tzid, sync_context: routedContext
        });
        events.push(routedEvent);
        fixtures.list_events = events;
        return Promise.resolve(clone(routedEvent));
      }
      if (cmd === 'attach_note') {
        var attachKind = options.kind || 'prep-for';
        try {
          return Promise.resolve(clone(attachNoteBacklink(options.note_id, options.target_id, attachKind)));
        } catch (attachError) {
          return Promise.reject(attachError);
        }
      }
      if (cmd === 'link') {
        if (options.edge_type !== 'references') {
          return Promise.reject(new Error('fixture event context only supports references'));
        }
        try {
          return Promise.resolve(clone(attachNoteBacklink(options.source_id, options.target_id, options.edge_type)));
        } catch (linkError) {
          return Promise.reject(linkError);
        }
      }
      if (cmd === 'delete_event') {
        var idx = events.findIndex(function findEvent(item) { return item.id === options.id; });
        if (idx === -1) return Promise.reject(new Error('Event not found: ' + options.id));
        if (!eventIsMutable(events[idx])) return Promise.reject(new Error('event is read-only'));
        events[idx].status = 'cancelled';
        events[idx].sequence += 1;
        events[idx].updated = NOW;
        fixtures.list_events = events;
        return Promise.resolve(clone(events[idx]));
      }
      if (cmd === 'delete_routed_event') {
        var deleteInput = options.input || {};
        var routedDeleteIndex = events.findIndex(function findEvent(item) { return item.id === deleteInput.event_id; });
        if (routedDeleteIndex === -1) return Promise.reject(new Error('Event not found: ' + deleteInput.event_id));
        var routedDeleteEvent = events[routedDeleteIndex];
        if (!routedEventIsMutable(routedDeleteEvent) || !routedDeleteEvent.sync_context) return Promise.reject(new Error('event is read-only'));
        if (routedDeleteEvent.sync_context.account_id !== deleteInput.account_id || routedDeleteEvent.sync_context.calendar_id !== deleteInput.calendar_id) {
          return Promise.reject(new Error('event destination does not match'));
        }
        if (!deleteInput.operation_id) return Promise.reject(new Error('operation_id is required'));
        routedDeleteEvent.status = 'cancelled'; routedDeleteEvent.sequence += 1; routedDeleteEvent.updated = NOW;
        routedDeleteEvent.sync_context.state = 'pending'; fixtures.list_events = events;
        return Promise.resolve(clone(routedDeleteEvent));
      }
      if (cmd === 'edit_event') {
        var editInput = options.input || {};
        var editIndex = events.findIndex(function findEvent(item) { return item.id === editInput.event_id; });
        if (editIndex === -1) return Promise.reject(new Error('Event not found: ' + editInput.event_id));
        if (!eventIsMutable(events[editIndex])) return Promise.reject(new Error('event is read-only'));
        if (!editInput.operation_id) return Promise.reject(new Error('operation_id is required'));
        try { requireValidEventInput(editInput); } catch (validationError) { return Promise.reject(validationError); }
        var editRequest = JSON.stringify(editInput);
        var completedEdit = eventEditOperations[editInput.operation_id];
        if (completedEdit) {
          if (completedEdit.request !== editRequest) return Promise.reject(new Error('operation conflict'));
          return Promise.resolve(clone(completedEdit.result));
        }
        var original = events[editIndex];
        if (editInput.edit_token !== eventEditToken(original)) {
          return Promise.reject({
            code: 4,
            kind: 'sync_conflict',
            message: 'Event changed since it was opened',
            retriable: false,
            details: { type: 'stale_event', event_id: original.id }
          });
        }
        var changed = original.title !== String(editInput.title).trim() || original.start !== String(editInput.start) ||
          original.end !== String(editInput.end) || original.is_all_day !== (editInput.is_all_day === true) ||
          original.start_tzid !== (editInput.is_all_day === true ? null : (editInput.tzid || null)) ||
          original.description !== (editInput.description === undefined ? null : editInput.description) ||
          original.location !== (editInput.location === undefined ? null : editInput.location);
        if (!changed) return Promise.resolve(clone({ event: original, no_op: true }));
        events[editIndex] = Object.assign({}, original, {
          title: String(editInput.title).trim(), start: String(editInput.start), end: String(editInput.end),
          is_all_day: editInput.is_all_day === true,
          start_tzid: editInput.is_all_day === true ? null : (editInput.tzid || null),
          end_tzid: editInput.is_all_day === true ? null : (editInput.tzid || null),
          floating: editInput.is_all_day !== true && !editInput.tzid,
          description: editInput.description === undefined ? null : editInput.description,
          location: editInput.location === undefined ? null : editInput.location,
          sequence: original.sequence + 1, updated: NOW
        });
        fixtures.list_events = events;
        var editResult = { event: events[editIndex], no_op: false };
        eventEditOperations[editInput.operation_id] = { request: editRequest, result: clone(editResult) };
        return Promise.resolve(clone(editResult));
      }
      if (cmd === 'edit_routed_event') {
        var routedEditInput = options.input || {};
        var routedEditIndex = events.findIndex(function findEvent(item) { return item.id === routedEditInput.event_id; });
        if (routedEditIndex === -1) return Promise.reject(new Error('Event not found: ' + routedEditInput.event_id));
        var routedOriginal = events[routedEditIndex];
        if (!routedEventIsMutable(routedOriginal) || !routedOriginal.sync_context) return Promise.reject(new Error('event is read-only'));
        if (routedOriginal.sync_context.account_id !== routedEditInput.account_id || routedOriginal.sync_context.calendar_id !== routedEditInput.calendar_id) {
          return Promise.reject(new Error('event destination does not match'));
        }
        if (!routedEditInput.operation_id) return Promise.reject(new Error('operation_id is required'));
        try { requireValidEventInput(routedEditInput); } catch (routedEditValidationError) { return Promise.reject(routedEditValidationError); }
        if (routedEditInput.edit_token !== eventEditToken(routedOriginal)) return Promise.reject({
          code: 4, kind: 'sync_conflict', message: 'Event changed since it was opened', retriable: false,
          details: { type: 'stale_event', event_id: routedOriginal.id }
        });
        events[routedEditIndex] = Object.assign({}, routedOriginal, {
          title: String(routedEditInput.title).trim(), start: String(routedEditInput.start), end: String(routedEditInput.end),
          is_all_day: routedEditInput.is_all_day === true,
          start_tzid: routedEditInput.is_all_day === true ? null : (routedEditInput.tzid || null),
          end_tzid: routedEditInput.is_all_day === true ? null : (routedEditInput.tzid || null),
          floating: routedEditInput.is_all_day !== true && !routedEditInput.tzid,
          description: routedEditInput.description === undefined ? null : routedEditInput.description,
          location: routedEditInput.location === undefined ? null : routedEditInput.location,
          sequence: routedOriginal.sequence + 1, updated: NOW,
          sync_context: Object.assign({}, routedOriginal.sync_context, { state: 'pending' })
        });
        fixtures.list_events = events;
        return Promise.resolve(clone(events[routedEditIndex]));
      }
      if (cmd === 'remove_time_block') {
        var removeInput = options.input || {};
        if (!removeInput.operation_id) return Promise.reject(new Error('operation_id is required'));
        var removeIndex = events.findIndex(function findEvent(item) { return item.id === removeInput.event_id; });
        if (removeIndex === -1) return Promise.reject(new Error('Event not found: ' + removeInput.event_id));
        var removeEvent = events[removeIndex];
        if (!removeEvent.derived_from || !eventIsMutable(removeEvent)) return Promise.reject(new Error('event is read-only'));
        var removeTask = tasks.find(function findTask(item) { return item.id === removeEvent.derived_from; }) || null;
        removeEvent.status = 'cancelled';
        removeEvent.sequence += 1;
        removeEvent.updated = NOW;
        if (removeInput.return_to_flexible && removeTask) removeTask.agenda_bucket = 'flexible';
        fixtures.list_events = events;
        return Promise.resolve(clone({ event: removeEvent, originating_task: removeTask }));
      }
      if (cmd === 'promote_task') {
        if (!options.operation_id) return Promise.reject(new Error('operation_id is required'));
        var promotionRoute = null;
        if (options.account_id || options.calendar_id) {
          promotionRoute = syncContext(options.account_id, options.calendar_id, 'pending');
          if (!promotionRoute || !promotionRoute.writable) return Promise.reject(new Error('selected promotion destination is not writable'));
        } else if (options.local_only !== true) {
          var promotionDestinations = googleAccounts.flatMap(function writablePromotionAccounts(account) {
            return account.calendars.filter(function writablePromotionCalendar(calendar) {
              return account.state === 'connected' && calendar.enabled && calendar.available && calendar.writable;
            });
          });
          // The deterministic bridge keeps the historical direct-invoke fixture
          // local when no destination is supplied. Production core/Tauri/CLI
          // reject this ambiguity; browser tests choose an explicit route.
          if (promotionDestinations.length > 1) promotionDestinations = [];
          if (promotionDestinations.length === 1) {
            var promotionAccount = googleAccounts.find(function promotionOwner(account) {
              return account.calendars.some(function sameCalendar(calendar) { return calendar === promotionDestinations[0]; });
            });
            promotionRoute = promotionAccount && syncContext(promotionAccount.id, promotionDestinations[0].calendar_id, 'pending');
          }
        }
        var promotedTask = tasks.find(function findTask(item) { return item.id === options.task_id; });
        if (!promotedTask) return Promise.reject(new Error('Task not found: ' + options.task_id));
        var existingPromotion = events.find(function findPromotion(item) {
          return item.derived_from === options.task_id && item.status !== 'cancelled';
        });
        if (existingPromotion) return Promise.resolve(clone(existingPromotion));
        var slot = options.slot || {};
        var promotedStart = String(slot.when || NOW).slice(0, 19);
        var promotedEndDate = new Date(promotedStart);
        promotedEndDate.setHours(promotedEndDate.getHours() + 1);
        var promotedEnd = promotedEndDate.getFullYear() + '-' + String(promotedEndDate.getMonth() + 1).padStart(2, '0') + '-' + String(promotedEndDate.getDate()).padStart(2, '0') + 'T' + String(promotedEndDate.getHours()).padStart(2, '0') + ':' + String(promotedEndDate.getMinutes()).padStart(2, '0') + ':00';
        var promotedEvent = event({
          id: 'promoted-' + options.task_id + '-' + String(options.operation_id).replace(/[^a-z0-9-]/gi, '').toLowerCase(),
          title: promotedTask.title,
          start: promotedStart,
          end: promotedEnd,
          is_all_day: false,
          start_tzid: slot.tzid || null,
          end_tzid: slot.tzid || null,
          floating: !slot.tzid,
          derived_from: options.task_id,
          sync_context: promotionRoute,
        });
        events.push(promotedEvent);
        promotedTask.agenda_bucket = null;
        fixtures.list_events = events;
        return Promise.resolve(clone(promotedEvent));
      }
      if (cmd === 'notification_center_summary') {
        return Promise.resolve(clone(notificationSummary()));
      }
      if (cmd === 'list_notification_items') {
        var listInput = options.input || {};
        var notificationFilter = listInput.filter || 'all';
        var visibleNotifications = notificationItems.filter(function filterNotification(item) {
          var terminal = ['acted', 'superseded', 'dismissed', 'obsolete'].indexOf(item.status) !== -1;
          var deferred = item.visible_after !== null && item.visible_after > NOW;
          if (notificationFilter === 'history') return terminal;
          if (notificationFilter === 'deferred') return deferred && !terminal;
          if (terminal || deferred) return false;
          if (notificationFilter === 'unread') return item.read_at === null;
          if (notificationFilter === 'invitations') return item.kind === 'calendar_invitation';
          if (notificationFilter === 'reminders') return item.kind === 'task_reminder';
          return true;
        });
        return Promise.resolve(clone({
          items: visibleNotifications,
          next_cursor: null,
          snapshot_watermark: NOW,
          partial_errors: notificationPartialErrors
        }));
      }
      if (cmd === 'get_notification_item') {
        var notificationItem = notificationById(options.item_id);
        if (!notificationItem) return Promise.reject(new Error('Notification not found: ' + options.item_id));
        return Promise.resolve(clone(notificationItem));
      }
      if (cmd === 'set_notification_read') {
        try {
          var readMutation = requireNotificationInput(options);
          if (!readMutation.item.capabilities.can_mark_read) throw new Error('Notification read state cannot be changed');
          readMutation.item.read_at = readMutation.input.read ? NOW : null;
          readMutation.item.version += 1;
          readMutation.item.updated_at = NOW;
          return Promise.resolve(clone(readMutation.item));
        } catch (readError) { return Promise.reject(readError); }
      }
      if (cmd === 'defer_notification_item') {
        try {
          var deferMutation = requireNotificationInput(options);
          if (deferMutation.item.status !== 'active' || !deferMutation.item.capabilities.can_defer) throw new Error('Notification cannot be deferred');
          deferMutation.item.visible_after = deferMutation.input.visible_after;
          deferMutation.item.version += 1;
          deferMutation.item.updated_at = NOW;
          return Promise.resolve(clone(deferMutation.item));
        } catch (deferError) { return Promise.reject(deferError); }
      }
      if (cmd === 'dismiss_notification_item') {
        try {
          var dismissMutation = requireNotificationInput(options);
          if (dismissMutation.item.status !== 'active' || !dismissMutation.item.capabilities.can_dismiss) throw new Error('Notification cannot be dismissed');
          dismissMutation.item.status = 'dismissed';
          dismissMutation.item.version += 1;
          dismissMutation.item.updated_at = NOW;
          return Promise.resolve(clone(dismissMutation.item));
        } catch (dismissError) { return Promise.reject(dismissError); }
      }
      if (cmd === 'respond_calendar_invitation') {
        try {
          var responseMutation = requireNotificationInput(options);
          if (responseMutation.item.kind !== 'calendar_invitation' || responseMutation.item.status !== 'active' || !responseMutation.item.capabilities.can_respond) throw new Error('Notification cannot be answered');
          responseMutation.item.status = 'action_pending';
          responseMutation.item.requested_action = responseMutation.input.response;
          responseMutation.item.action_state = 'queued';
          responseMutation.item.version += 1;
          responseMutation.item.updated_at = NOW;
          return Promise.resolve(clone(responseMutation.item));
        } catch (responseError) { return Promise.reject(responseError); }
      }
      if (cmd === 'retry_calendar_invitation') {
        try {
          var retryMutation = requireNotificationInput(options);
          if (retryMutation.item.kind !== 'calendar_invitation' || retryMutation.item.status !== 'active' || !retryMutation.item.capabilities.can_respond || !retryMutation.item.action_error || retryMutation.item.action_error.retryable !== true || ['allow', 'maybe', 'refuse'].indexOf(retryMutation.item.requested_action) === -1) throw new Error('Notification cannot be retried');
          retryMutation.item.status = 'action_pending';
          retryMutation.item.action_state = 'queued';
          retryMutation.item.action_error = null;
          retryMutation.item.version += 1;
          retryMutation.item.updated_at = NOW;
          return Promise.resolve(clone(retryMutation.item));
        } catch (retryError) { return Promise.reject(retryError); }
      }
      if (cmd === 'complete_notification_task') {
        try {
          var completeMutation = requireNotificationInput(options);
          if (completeMutation.item.kind !== 'task_reminder' || completeMutation.item.status !== 'active' || !completeMutation.item.capabilities.can_complete_task) throw new Error('Notification cannot be completed');
          var notificationTask = tasks.find(function findNotificationTask(item) { return item.id === completeMutation.item.task_id; });
          if (!notificationTask) throw new Error('Task not found: ' + completeMutation.item.task_id);
          notificationTask.status = 'done';
          notificationTask.completed_at = NOW;
          completeMutation.item.status = 'acted';
          completeMutation.item.requested_action = 'complete_task';
          completeMutation.item.action_state = 'succeeded';
          completeMutation.item.resolution_origin = 'jin';
          completeMutation.item.version += 1;
          completeMutation.item.updated_at = NOW;
          return Promise.resolve(clone(completeMutation.item));
        } catch (completeError) { return Promise.reject(completeError); }
      }
      if (cmd === 'notification_status') return Promise.resolve(clone(notificationState));
      if (cmd === 'request_notification_permission') {
        notificationState = Object.assign({}, notificationState, {
          permission: 'granted', reason: 'macOS allows Jin notifications.', can_request: false
        });
        return Promise.resolve(clone(notificationState));
      }
      if (cmd === 'open_notification_settings') return Promise.resolve();
      if (cmd === 'send_test_notification') return Promise.resolve({
        submitted: true,
        message: 'Test notification submitted to the notification service; banner or delivery is not guaranteed. If no banner appears, check Notification Center or Focus or Do Not Disturb.'
      });
      if (!Object.prototype.hasOwnProperty.call(fixtures, cmd)) {
        return Promise.reject(new Error('Unsupported Jin fixture command: ' + cmd));
      }
      return Promise.resolve(clone(fixtures[cmd]));
    },
    transformCallback: function transformCallback(callback) { return callback; },
    convertFileSrc: function convertFileSrc(source) { return source; }
  };
})();
