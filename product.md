# Unified Workspace Landscape: Notes + Tasks + Calendar — Technical Dossier

**Scope:** Competitive analysis for software that addresses the integration pain between personal notes, task management, and calendar events in a single data model. Focus: feature depth, architecture, privacy posture, and niche fit. Audience: technical evaluator selecting or tracking tools in this market segment.

***

## Executive Summary

The dominant failure mode in personal productivity tooling is the same across all market segments: notes, tasks, and calendar live in three separate data silos that communicate poorly or not at all. Tools in this space generally fall into one of three architectural families:

1. **Note-first tools** that bolt on tasks (and sometimes fake-calendar views from date-tagged entries) — Logseq, Capacities, AFFiNE, Joplin, Obsidian.
2. **Task-first tools** that add notes/docs and optionally expose CalDAV — Vikunja, Huly.
3. **Calendar-first tools** that add lightweight tasks and minimal notes — Routine, NotePlan.
4. **Encrypted-hub tools** that co-locate all three in one product — Octofold, Planito.

None of the current tools fully own all three primitives at equal depth — which is simultaneously the market gap and the reason fragmentation persists.

***

## Market Segmentation

| Segment | Primary Users | Key Trade-off |
|---------|-------------|--------------|
| PKM / Knowledge Workers | Researchers, developers, writers | Depth of notes vs. action capture |
| Developer / Team Tooling | Engineering teams, project managers | Github/Jira integration vs. personal calendar |
| Privacy / Self-Hosted | Sysadmins, compliance-sensitive users | Control vs. polish and mobile |
| Calendar-centric Daily Planning | Executives, freelancers | Schedule as backbone vs. rich notes |
| Encrypted Cloud | Professionals with data residency concerns | Encryption assurances vs. self-host |

***

## Open-Source / Self-Hostable Tools

### 1. Vikunja

**Niche:** Self-hosted, API-first task management with native CalDAV — the only open-source tool in this roundup where CalDAV is a built-in, first-class protocol, not a plugin or external bridge.

**Repository & License:** AGPLv3 on GitHub; Go backend + Vue.js frontend.[1]

#### Architecture
- Go API backend with GORM abstraction layer; supports SQLite (default), PostgreSQL, and MySQL.[1]
- Background worker handles scheduled reminders and recurring task generation.[1]
- CalDAV server embedded in the API, exposed under the `/dav` subspace.[2]
- Authentication supports local accounts, OpenID Connect, and LDAP.[1]
- Single Docker image bundles API + frontend; configurable via `config.yml` or environment variables.[1]

#### Feature Matrix

**Task management**
- Tasks with due dates, priorities, labels, assignees, and subtasks.[3]
- Repeating/recurring tasks with flexible schedules (daily, weekly, monthly, custom).[3]
- Subtask relationships; blocking/blocked-by relations across different projects.[3]
- Saved filters, unlimited labels, unlimited projects on self-hosted (no artificial paywalls).[4]
- Quick Add Magic: natural language task entry with inline date, label, and assignee parsing.[3]
- File attachments on tasks.[3]

**Views**
- List, Kanban, Gantt Chart, Table — all four switchable per project.[1][3]
- Gantt is uniquely useful for deadline planning; Kanban for sprint-style workflows.[4]

**Calendar / CalDAV**
- Built-in CalDAV server supporting VTODO; exposed at `/projects/<ID>/`.[2]
- Supported properties: UID, SUMMARY, DESCRIPTION, PRIORITY, CATEGORIES, COMPLETED, DUE, DURATION, DTSTAMP, DTSTART, VALARM, RRULE (server-to-client only).[2]
- Sync tested with Thunderbird, Apple Reminders, and DAVx5 on Android.[5]
- As of v2.3.0, tags and sync token added to CalDAV collections.[6]
- **Critical limitation:** CalDAV integration is labeled "early alpha" with documented bugs and client compatibility issues. It syncs VTODO (tasks), not VEVENT (calendar events) — Vikunja is a task manager that exposes itself to calendar clients, not a calendar in the classical sense.[2]

**Notes**
- Vikunja has **no native notes module**. Notes do not exist as a first-class object. Comments can be attached to tasks, but there is no dedicated note or document layer.

**Collaboration**
- Project sharing with per-user or per-team permission levels.[3]
- Share links with read/write rights for external collaborators.[3]
- Webhooks and REST API for automation.[1]

**Import/Migration**
- Import from Todoist, Trello, Microsoft To-Do.[1]

#### Privacy & Data Model
Vikunja is the cleanest open-source option for data residency: AGPLv3 means full code transparency, self-host means zero external dependency for core functionality, and the EU Cloud option (personal at 4€/month, organization at 5€/user/month) is hosted in the EU. Self-hosted is free forever with no feature caps.[7]

#### Competitive Position
Vikunja is strictly a **task manager** that happens to support CalDAV. It competes with Todoist directly on self-hosting and CalDAV, where Todoist has neither. It does not solve the notes/calendar/tasks triangle — it solves the tasks/CalDAV half. For engineers running their own infrastructure who need to bridge tasks into an existing CalDAV-capable calendar, Vikunja is the most credible open-source option. The gap is that notes are entirely absent.[4]

**Pricing:** Self-hosted: free forever. Cloud Personal: 4€/month (40€/year). Cloud Organization: 5€/user/month. Pro (admin panel, audit logs, time tracking): separate pricing from Family to Enterprise.[7]

***

### 2. Logseq

**Niche:** Open-source, local-first, privacy-first outliner-based knowledge graph that is transitioning into a unified DB format combining markdown graphs and database graphs in a single app as of May 2025.

**Repository & License:** AGPL-3.0; Clojure/ClojureScript frontend, local storage by default.[8]

#### Architecture
- Originally file-based (markdown), every bullet point is a linkable, queryable block.[8]
- As of May 26, 2025 ("Major Milestone"), 7,322 commits merged unifying two years of DB development — both database graphs and markdown graphs now supported in a single binary.[9]
- ClojureScript Plugin SDK released October 2025 for native plugin development.[9]
- MCP Server added September 2025: allows AI assistants (e.g. Claude) to query your Logseq graph directly.[9]
- Mobile apps (iOS and Android) launched July 2025 using Capacitor framework.[9]

#### Feature Matrix

**Notes / Knowledge Graph**
- Outliner editor: every block is a node in a bidirectional knowledge graph.[8]
- Bi-directional linking, block references, page embeds.[8]
- Journal (date-based daily notes) as the primary entry point.
- Property system on DB graphs; templates, bulk editing.[9]
- AI-powered local semantic search using embedding models — offline, runs on device — shipped August 2025.[9]
- Audio recording with waveform display and automatic offline speech-to-text transcription (September 2025).[9]
- PDF annotation, whiteboard (early access).[9]

**Task Management**
- Task states (TODO, DOING, DONE, CANCELLED, WAITING) on any block.[10]
- SCHEDULED and DEADLINE properties with date picker.[10]
- Recurring tasks: daily, weekly, monthly (added December 2024).[9]
- Time tracking: task-level timers with automatic duration calculation.[9]
- `/todo`, `/doing`, `/done` slash commands for status updates.[10]
- Bulk task management: convert parent + nested nodes into tasks simultaneously.[10]
- Scheduled View, Group By, Sort By for task aggregation.[10]

**Calendar**
- No native calendar view in core Logseq.
- **Agenda plugin** (community): provides calendar view, Gantt view, timeline view, subscription calendar (basic events), and Pomodoro timer.[11]
- Subscription calendar in the Agenda plugin only supports basic events — no write-back to external CalDAV/Google Calendar.[11]
- The DB format (since May 2025) has a native date picker for journals, but this is date-based navigation, not a true calendar with event creation.[12]

**Sync**
- Logseq Sync is the official paid sync backend; not open-source and not self-hostable by design.[13]
- Self-hosting sync requires third-party tooling: SyncThing, Nextcloud, iCloud — each with edge cases on Android.[8]
- Logseq CLI (`npm install -g @logseq/cli`) released August 2025 for offline search and graph export.[9]

#### Privacy & Data Model
Default storage is local markdown files — maximum transparency and portability. The sync backend is opaque and hosted. For a fully self-sovereign setup, Logseq + SyncThing or Nextcloud is the standard stack, at the cost of reliability on mobile. AGPL-3.0 license ensures code auditability.[8]

#### Competitive Position
Logseq's value proposition is the **richest open-source knowledge graph + task system** currently available. The DB migration milestone in May 2025 represents a step-change in capability: repeated tasks, time tracking, bulk editing, and real-time collaboration become viable. The Achilles' heel remains calendar: there is no native calendar, and the Agenda plugin is a read-only overlay with no event write-back. For engineers who are note-heavy and want deep task query power over a local graph, Logseq is unmatched in the open-source space.

**Pricing:** Desktop app is free, no usage limits. Sync service is paid (pricing not publicly listed in current sources). Plugin ecosystem is free and community-maintained.[14]

***

### 3. AppFlowy

**Niche:** Open-source, Notion-like workspace with a strong self-hosting story, AGPL-licensed, Flutter-based cross-platform UI, and a 2025 roadmap that adds real-time collaboration and AI that runs entirely on-device.

**Repository & License:** AGPL-3.0; Rust backend, Flutter frontend; 67.4k GitHub stars.[15]

#### Architecture
- Rust sync engine (rewritten in 2025 for real-time multi-user collaboration across all platforms).[16]
- Flutter-based clients (Linux, macOS, Windows, iOS, Android, Web) ensure native performance and cross-platform consistency.[17]
- Self-hosting via Docker; official Helm chart published in 2025.[16]
- AppFlowy Web launched 2025: full Grid, Kanban, and Calendar view management from the browser.[18]
- Local AI / Vault Workspace: full AI that runs entirely on-device using local RAG search — "not a single byte will leave your vault."[16]
- AI integrations: GPT-4, Claude 3 Sonnet, Gemini 2.5 Pro/Flash — configurable per deployment.[19][17]
- SAML 2.0, Azure OpenAI support, on-premise LLMs, and whitelabeling on enterprise/self-hosted editions.[16]

#### Feature Matrix

**Documents / Notes**
- Block-based editor: text, headings, lists, to-dos, images, files, code blocks, math equations, toggles, callouts, table of contents.[16]
- Video, audio, and file embeds (added 2025).[16]
- Two-way relations and rollups in databases.[16]
- Backlinks, tags, and suggested connections planned for H1 2026.[16]
- AI Meeting Notes: real-time transcription on macOS/Windows, AI converts to clean share-ready summary.[16]
- AI Search: natural language queries across all workspace documents.[16]
- Page version history planned for H1 2026.[16]

**Task / Database System**
- Databases with multiple views: Grid (table), Kanban, Calendar, Gallery (2026 roadmap).[20][16]
- Custom priority labels, status tags, due dates, assignees per row.[17]
- Subtasks via checklist blocks or database relations.[17]
- Reminders and custom alerts.[17]

**Calendar**
- Calendar view is a **database view**, not a standalone calendar application.[21]
- Events are database rows that must have at least one date field; rows without a date value are excluded from the calendar display but listed separately.[21]
- Calendar layout settings: day/week/month layout, weekend visibility, week numbers, first day of week, which date field to use for event arrangement.[21]
- Monthly and weekly calendar views added to AppFlowy Web in September 2025.[20][19]
- Drag-and-drop to adjust event date/time; quick menu to edit properties; open event page to add rich content notes.[20]
- **No CalDAV integration. No Google/Outlook calendar sync.** The calendar is purely an internal view of database data.

**Self-Hosting Specifics**
- Super admin panel, SAML 2.0, Helm chart, security audits on self-hosted editions.[16]
- Federated synchronization between different AppFlowy instances: open feature request, not yet implemented.[22]
- Android app widgets (open feature request, 2025).[22]

#### Privacy & Data Model
AppFlowy is the most enterprise-capable open-source workspace in this comparison. The local-first design, AGPL license, and local AI RAG mean you can run it completely air-gapped. The lack of CalDAV or external calendar sync is a deliberate design choice: the calendar view is internal to AppFlowy's database, not a bridge to external systems.

#### Competitive Position
AppFlowy sits in the same niche as Notion but open-source and self-hostable. It excels at documentation, wikis, and project management. For the specific notes+tasks+calendar triangle, it solves notes+tasks very well but leaves calendar fragmented: you get an internal calendar view for database dates, but your Google/iCloud/CalDAV events do not flow in. For teams where all work lives inside AppFlowy, this is acceptable. For individuals who need to integrate existing external calendars, it is a gap.

**Pricing:** Free tier (cloud): 2-member workspace. Pro: paid plan with unlimited storage. Self-hosted: free, all features unlocked.[23]

***

### 4. AFFiNE

**Niche:** Open-source, local-first "KnowledgeOS" that merges docs, infinite whiteboards, databases, and AI in one hyper-fused platform. The only tool in this list where documents and visual/spatial thinking (whiteboard/canvas) are equally first-class.

**Repository & License:** MIT (frontend) / AGPLv3 (backend services); TypeScript/Rust; 61.6k GitHub stars.[24]

#### Architecture
- CRDT-based local-first sync: conflict-free real-time collaboration without a central server as source of truth.[25]
- AFFiNE self-host: Docker + PostgreSQL + Redis stack; configurable via environment variables.[26]
- Supports OIDC, Google OAuth, GitHub OAuth for authentication on self-hosted instances.[26]
- "Edgeless mode" (whiteboard) and "Page mode" (document) are unified: you can embed a whiteboard inside a document and vice versa.
- AI Copilot: writing assistant and AI image generation in documents and on the whiteboard canvas.

#### Feature Matrix

**Documents / Notes**
- Block-based rich editor with all standard types plus embeds (databases, whiteboards, code, math).
- Synced Blocks: create a reusable content block in one document and reference it in others; updates propagate automatically.[27]
- Split View: multiple documents side-by-side via drag-and-drop.[27]
- Database properties can be added to document page info (deadlines, task status visible in document header).[27]
- Templates: Digital Planner, Cornell Notes, Knowledge Base, and more.[24]

**Tasks**
- Tasks live inside documents as check-items or inside database blocks.
- Database blocks can be configured as a Kanban or table view for task tracking.
- No dedicated, app-level task layer separate from documents.

**Calendar**
- Calendar integration shipped in version 0.22 (June 2025): subscribe to your email calendar via URL (iCal / WebCal standard).[28]
- Events appear in the AFFiNE Journal sidebar for the relevant date.[29]
- From an event in the sidebar, you can create a linked document (note) directly tied to the event day in the Journal.[29]
- Sync is read-only pull (URL subscription); **you cannot create or modify events inside AFFiNE** — it explicitly redirects event creation to your calendar app.[29]
- Does not support uploading `.ics` files from local disk; requires a public URL subscription link.[29]
- Does not support CalDAV; calendar data arrives as a one-way iCal feed.[29]

**Whiteboard / Edgeless**
- Infinite canvas with shapes, connectors, frames, embedded documents, and sticky notes.
- Miro-like spatial planning inside the same data model as text documents.

**Self-Hosting**
- Full Docker-compose setup with PostgreSQL and Redis.[26]
- User management: import users, reset passwords, delete/ban users from admin UI.[26]
- S3-compatible storage and Cloudflare R2 support for blobs.[26]
- SMTP email notifications configuration.[26]
- Team license required for commercial team use; free for individuals.[24]

#### Privacy & Data Model
Local-first CRDT means your data is yours by default. Self-host removes cloud dependency entirely. The iCal calendar integration is read-only and fetches from a public URL — meaning your calendar data is not stored in AFFiNE's server, it is fetched on demand from your calendar provider.

#### Competitive Position
AFFiNE fills a unique niche: the only open-source tool that merges documents + whiteboard + databases. For knowledge workers who think spatially — mind maps, mood boards, architecture diagrams alongside notes — it is the only open-source option. Calendar integration (v0.22, June 2025) is shallow: read-only iCal subscription with note attachment capability. This is a "see your day's meetings while taking notes" feature, not a full calendar. Tasks are document-embedded, not app-level. AFFiNE is best positioned for teams that value the visual/spatial dimension and need a Notion+Miro replacement under one self-hosted deployment.

**Pricing:** Free for individuals. Commercial/team usage requires a paid plan (pricing on affine.pro). Self-hosted: free for personal use.[24]

***

### 5. Huly

**Niche:** Open-source all-in-one platform targeting teams; replaces Linear + Jira + Slack + Notion + Motion with bidirectional GitHub sync, virtual office (audio/video), and a Google Calendar two-way integration.

**Repository & License:** EPL-2.0 on GitHub (hcengineering/huly-selfhost); self-hostable via Docker.[30][31]

#### Architecture
- TypeScript monorepo; real-time collaboration via its own CRDT-like sync layer.
- Bidirectional GitHub Issues and GitHub Projects synchronization — changes in GitHub reflect in Huly and vice versa.[32]
- Two-way Google Calendar synchronization: events from Google Calendar appear in Huly Planner; events created/edited in Huly (with a calendar set) sync back to Google Calendar.[33]
- Virtual Office: customizable audio/video meeting rooms built in (no Zoom/Meet required).[32]
- MetaBrain: upcoming AI knowledge layer that connects tasks, documents, and people into a living knowledge base.[32]

#### Feature Matrix

**Documents / Notes**
- Rich document editor: bold/italic/code/images/attachments/code blocks.[32]
- Action items directly assignable from within document text (tag colleagues, create tasks from notes).[34]
- Link documents to issue tickets.[34]
- Version history on documents.[32]
- Knowledge base / wiki mode.[35]

**Task / Project Management**
- Issues with customizable workflows, labels, assignees, priorities, milestones, and sprints.[30]
- Kanban boards: Scrum or custom Kanban layout configurable per team.[30]
- Sprint planning: create sprints from GitHub issues, assign tasks, set goals.[30]
- Metrics and reporting: velocity, burn-down, without leaving Huly.[30]
- Personal tasks: schedule personal events and todos separate from team projects.[32]
- Time-blocking: drag tasks onto the Planner calendar to block time.[32]
- Recurring tasks with configurable schedules.[36]

**Calendar / Planner**
- Team Planner: centralized calendar view of all individual tasks and events across the team.[30][32]
- Personal Planner: individual calendar view with task scheduling and time-blocking.[36]
- **Two-way Google Calendar sync** as of current release: Google Calendar events appear automatically in Huly Planner; Huly events sync back to Google Calendar when a calendar is selected.[33]
- Privacy settings synchronized: Public / FreeBusy / Only visible to you.[33]
- Shared calendars and team availability tracking.[30]
- No CalDAV support documented.

**Communication**
- Direct messaging and group channels (Slack-style).[30]
- Two-way Slack integration for message sync.[30]
- Inbox: centralized notifications and task updates.[30]
- Audio/video conferencing built-in (no external dependency).[32]

**Self-Hosting**
- Docker Compose deployment via huly-selfhost repository on GitHub.[31]
- Free to self-host with all features; cloud plans charged based on storage, network, and compute usage.[36]
- Unlimited users on the free cloud tier (10GB storage, 10GB video/audio traffic).[36]

#### Privacy & Data Model
Self-hosting provides full data control. The Google Calendar integration requires granting Huly OAuth access to your Google account — this is a data residency concern for privacy-maximal users. If self-hosted, Google sync still routes through Huly's integration infrastructure rather than purely through your own server. No zero-knowledge encryption claims.

#### Competitive Position
Huly is the most feature-complete open-source tool in this roundup for **teams**. The combination of bidirectional GitHub sync, two-way Google Calendar, Slack integration, virtual office, and rich document editing in one self-hostable platform is unmatched in the open-source segment. For individuals, it is arguably over-engineered: the UX is aimed at developer/product teams. The notes-as-documents model is solid, but there is no personal knowledge graph or daily journal model — notes are attached to projects and issues, not to a personal flow.

**Pricing:** Cloud: Free (10GB storage). Paid cloud: usage-based. Self-hosted: free.[36]

***

### 6. Logseq + Org-mode (Emacs) — Infrastructure Tier

These are not applications in the modern sense but rather **data model platforms** that deserve mention in a competitive landscape report.

**Org-mode** is a plain-text format and Emacs subsystem that unifies notes, tasks, scheduled items, deadlines, and agenda views in one file format. Tasks are Org headings with TODO keywords; scheduling adds SCHEDULED/DEADLINE timestamps. The weekly/daily agenda compiles all items across configured Org files into a single agenda view — equivalent to a personal calendar derived from your note data. CalDAV import/export is possible via `org-icalendar` and similar packages. The data model is fully owned (plain text files), scriptable in Emacs Lisp, and integrable with any toolchain. The tradeoff is entirely the user-experience investment: Emacs proficiency is required, and the mobile story (Orgzly on Android, BeOrg on iOS) is functional but not polished.[37][38]

For a senior engineer comfortable in terminal environments, org-mode solves the triangle most elegantly at the data layer — it just requires accepting that the UI is the editor.

***

## Private / SaaS Tools

### 7. NotePlan 3

**Niche:** Apple-ecosystem, markdown-native daily planner that fuses a bullet-journal/calendar interface with tasks and notes in plain `.md` files stored in iCloud or local disk. The only commercial tool in this list with explicit offline-first, file-transparent storage.

**Platform:** macOS, iOS, iPad, Web (no Linux, no Android).[39]

#### Architecture
- All data stored as plain `.md` files inside iCloud Drive (transparent, accessible via Finder).[40]
- Calendar events pulled in real-time from macOS/iOS `EventKit` (Apple's calendar database) — not stored in NotePlan itself.[40]
- Sync via Apple CloudKit (native, seamless between Apple devices).[39]
- Plugin system with JavaScript API for workflow automation and custom templates.[39]

#### Feature Matrix

**Notes**
- Daily, weekly, monthly, yearly notes automatically generated.[39]
- Bi-directional linking between notes.[39]
- Custom folder organization + nested folders.[39]
- Templates with JavaScript scripting for dynamic content (API calls, date logic).[39]
- Themes: custom fonts, colors, Markdown styles.[39]
- AI tools: summarize, rewrite content; Memo AI (voice to structured notes, announced in current version).[39]
- Sketch and handwrite on iPhone/iPad; AI converts handwriting to text.[39]

**Task Management**
- Tasks created via Markdown checkboxes (`* [ ] task`).[39]
- Due dates with quick keyboard commands (e.g. `>2026-07-01`).[39]
- Time blocks: allocate specific time slots to tasks with duration and notifications.[39]
- Recurring tasks with configurable schedules.[39]
- Upcoming Tasks Filter: dynamic list of future tasks with drag-and-drop rescheduling.[39]
- Customizable saved task filters by date, tags, projects, or note path.[39]
- Tasks automatically appear in the daily note for their scheduled date.[39]

**Calendar Integration**
- Reads from all calendars added to macOS/iOS Internet Accounts: Google Calendar, Microsoft Exchange (Outlook), Yahoo, iCloud, AOL.[41]
- CalDAV support: any CalDAV provider can be added via macOS "Add Other Account..." → CalDAV.[41]
- Calendar events appear inline within the daily note — events and tasks share the same daily view.[39]
- Google Calendar sync: view and create Google Calendar events directly within NotePlan's interface alongside daily notes.[39]
- Events are read from the Apple Calendar database in real-time; not stored by NotePlan.[40]
- iOS Shortcuts and Siri voice command integration for capture.[39]

**Extensions / Plugins**
- Plugin library with JavaScript API.[39]
- Community plugins available via NotePlan's plugin browser.

#### Privacy & Data Model
Storage in iCloud Drive means data lives on Apple's servers (US primarily); iCloud Drive can be disabled for fully local storage (loses cross-device sync). NotePlan itself does not transmit notes externally — only Apple's iCloud sync stack is involved. For maximum privacy, run NotePlan fully offline with local storage only.[40]

#### Critical Limitations
- **Apple ecosystem only.** No Linux client, no Android client. Web app exists but is secondary.[39]
- CalDAV works via macOS Internet Accounts, not a direct protocol implementation — you're depending on Apple's abstraction layer.
- No self-hosting path.

#### Competitive Position
NotePlan is the closest commercial tool to solving the notes+tasks+calendar triangle for Apple users. Its calendar model (events and tasks in the same daily note, reading from system calendar) is architecturally the most seamless of any tool evaluated. The limitation is the Apple moat: no Linux, no Android, no self-host. For users already locked into the Apple ecosystem who want markdown transparency without cloud vendor lock-in at the data layer, NotePlan is the best current option.

**Pricing:** $8.33/month billed annually ($99.99/year); $12/month month-to-month. Single subscription covers all Apple platforms.[39]

***

### 8. Capacities

**Niche:** Object-based PKM for knowledge workers — German-built (Freiburg), no VC funding, focused on "studio for your mind" with a deliberate design philosophy that prioritizes thinking and note-taking over project management.

**Platform:** macOS, Windows, iOS, Android, Web. No Linux native app; Web is accessible on Linux.[42]

#### Architecture
- Cloud-hosted with offline mode (full offline note creation/editing).[43]
- Data is European (company based in Freiburg, Germany — EU data residency).[42]
- No self-hosting option.
- Mobile app designed as companion to desktop, not standalone.

#### Feature Matrix

**Notes / Object System**
- Object-based model: every note is a typed object (person, book, meeting, project, tag, etc.).[44]
- Custom object types with user-defined properties (including date/time for calendar integration).[45]
- Contextual backlinks, block linking, two-way linking (added 2025).[46]
- Daily Notes as primary time anchor for all objects.[43]
- Kanban view and group-by across object collections (added 2025).[46]
- Readwise integration: highlights sync as objects.[46]
- Automated exports (human- and machine-readable) for backup.[46]

**Task Management**
- Task management added December 2025 (Capacities Pro and Believer tiers).[47]
- Tasks appear in context, Kanban boards, Calendar, and a Today view.[48]
- Priorities and statuses configurable.[47]
- Scheduling: tasks scheduled to a date appear in the Capacities Calendar for that date.[49]
- **Limitations (as of launch):** No recurring tasks, no reminders, no subtasks as explicit objects (checkboxes work as workaround), cannot add custom properties to the Task object type.[50]

**Calendar**
- Built-in calendar with day/3-day/week/month views.[45]
- Daily Note anchored to each calendar day; any integration input lands in the daily note.[45]
- Google Calendar integration (Capacities Pro): events appear in the Journal sidebar and day view.[51]
- Outlook Calendar integration (Capacities Pro): equivalent to Google Calendar integration.[45]
- From a calendar event, create a linked object (e.g., meeting notes) with the event date pre-filled.[51]
- Event sync is automatic and bidirectional in metadata (Capacities creates and updates linked objects), but Capacities **does not write events back** to Google/Outlook.[51]
- No CalDAV support.

#### Privacy & Data Model
EU-based company, data encrypted in transit, no VC funding (self-funded). "Your data is yours" stance, but no zero-knowledge or self-host option — you're trusting Capacities Labs GmbH. Automated exports provide a safety net for data portability.[52]

#### Competitive Position
Capacities competes directly with Notion and Obsidian as a more opinionated PKM. The object model is genuinely differentiated — thinking in objects rather than pages or bullets. The addition of task management (December 2025) and calendar integrations (March 2025) makes it more complete, but both features are newer and carry limitations (no recurring tasks, no CalDAV, calendar is read-only-pull from Google/Outlook). For researchers, writers, and professionals who are knowledge-heavy and want elegant object relationships with a clean calendar sidebar, Capacities is compelling. For engineers who need deep task power or privacy guarantees, it falls short.

**Pricing:** Free (basic features). Pro: $10/month (annual) or $12/month. Believer: same price + early access. Calendar integration is Pro-only.[53]

***

### 9. Routine

**Niche:** Calendar-first daily planner with tasks, lightweight notes, and contact management; targets executives, freelancers, and knowledge workers who want a Google Calendar replacement rather than a note-taking platform.

**Platform:** macOS, Windows, iOS, Android, Web, Linux (desktop client available).[54]

#### Architecture
- SaaS with offline mode and cross-platform sync.[54]
- Google Calendar, Microsoft Outlook, and iCloud Calendar two-way integration.[55]
- Calendar is the backbone: everything is organized around the timeline.
- Console: a global quick-capture bar (keyboard shortcut, anywhere on the system) with natural language processing.[56]
- MCP (Model Context Protocol) integration: AI assistants like ChatGPT/Claude can query and operate Routine.[54]
- Zapier integration: 5000+ tools connectable via automation.[57]

#### Feature Matrix

**Calendar**
- Syncs Google Calendar, Outlook, and iCloud bidirectionally.[55]
- Multiple layouts: 3-day, 5-day, weekly, monthly.[54]
- Time blocking: drag tasks directly onto calendar slots to block time.[56]
- AI voice commands: "create a meeting with X next Tuesday at 2pm" processed by NLP.[54]
- Meeting scheduling with automatic Google Meet link generation and participant emailing.[56]
- Time tracking: task-specific timers automatically record time blocks in the calendar.[54]

**Task Management**
- Universal inbox: all tasks, meetings, integrations (Gmail, Slack, Notion, WhatsApp) in one view.[57]
- Quick capture via Console with natural language (e.g., "Buy groceries tomorrow at 5pm" auto-schedules).[55]
- Recurring tasks with frequency, start, and end date configuration.[56]
- Custom databases (up to 3 on Free, 10 on Pro, unlimited on Business).[54]
- Views: group, filter, sort with custom logic.[54]
- AI agents: delegate tasks to specialized AI agents (Business tier).[54]
- AI automations: research, structure data, operate integrated services (Business tier).[54]

**Notes**
- Notes module: title + rich text with `/` slash commands for formatting (headings, bullets, embeds).[56]
- Notes tie back to calendar and tasks (meeting minutes, brainstorming attached to events).[58]
- Transclusion (embed objects/blocks from another source) — listed as "coming soon" on current pricing page.[54]
- Notes are functional but explicitly lighter than Notion — Routine does not aim to be a PKM.[56]

**Integrations**
- Backlinks: visualize which items reference an object.[54]
- References: create links and backlinks between objects and notes.[54]
- Contextual capture: captures context of tasks/notes and enables navigation back to source (Pro).[54]
- MCP plugin: AI assistants can operate Routine.[54]

#### Privacy & Data Model
Standard SaaS encryption (AES-256 / TLS); not zero-knowledge. Company based in France (EU). No self-hosting. SSO available; 2FA listed as "coming soon." For GDPR compliance, Routine operates under EU law.[57][54]

#### Competitive Position
Routine is the most polished calendar-first tool evaluated. It solves the "calendar as backbone" model better than any competitor: two-way sync with Google/Outlook, true time-blocking by dragging tasks into calendar slots, natural language capture. Notes exist but are lightweight — Routine is not trying to replace a PKM. The MCP integration and AI agents differentiate it for power users who want AI-orchestrated task routing. Limitations: no CalDAV, no self-host, notes are not a knowledge graph, collaboration is basic on lower tiers.

**Pricing:** Free (core features, 100 AI credits). Professional: $10/month (5,000 AI credits, AI meeting notes, time tracking, 30-day history). Business: $15/seat/month (workspaces, access control, AI agents, 90-day history). Enterprise: custom.[54]

***

### 10. Octofold

**Niche:** Zero-knowledge encrypted all-in-one workspace for professionals: email, calendar, notes, documents, kanban tasks, voice notes, and a built-in AI assistant in a single E2E-encrypted hub.

**Platform:** Web and installed apps; multi-device sync. No self-hosting option.

#### Architecture
- Zero-knowledge encryption: data is encrypted client-side before transmission; the provider cryptographically cannot read user content.[59]
- IMAP/SMTP integration: connects external email inboxes (any provider) to manage email alongside tasks and calendar.[59]
- "Octopus" AI: context-aware AI that operates within the encrypted workspace — can draft replies from notes, schedule calendar events from chat messages, summarize threads.[59]
- No CalDAV noted; calendar is Octofold's own internal system.

#### Feature Matrix

**Email**
- Connect any IMAP/SMTP inbox; AI Smart Reply for drafting professional responses.[59]
- Real-time sync across devices with E2E privacy.[59]

**Calendar**
- Integrated calendar with one-time and recurring event scheduling.[59]
- Events connect directly to projects and reminders.[59]
- Timeline view side-by-side with notes for schedule alignment.[59]

**Smart Reminders**
- Time-based or recurring alerts with custom icons/colors.[59]
- Reminders can be linked to any note or project.[59]

**Notes / Documents**
- Encrypted notes with unlimited count across all plans.[59]
- Office Documents, Spreadsheets, and Slides (integrated office suite).[59]
- Drawpad/sketching (Pro+).[59]
- PDF viewing and annotation.[59]
- Voice notes with speech-to-text transcription (Lite+).[59]
- AI chat in notes (Pro+); AI token quota varies by plan.[59]

**Task Management**
- Quick todos (Free+); full task management with projects and Kanban (Pro+).[59]
- Projects: tasks, progress tracking, project timelines integrated with calendar.[59]

**Business Features (unique to Octofold)**
- Business directory listing with verified badge.[59]
- Custom landing page builder with custom domain support.[59]
- Customer messaging inbox, appointment bookings, product catalog.[59]
- These features are primarily relevant for solo professionals or small businesses with a public-facing presence.

**AI Capabilities**
- Octopus AI: context-aware workspace intelligence.[59]
- Can create calendar events from chat messages, draft emails from notes.[59]
- AI tokens: 30,000 (Lite) → 250,000 (Pro) → 1,000,000 (Ultra).[59]
- AI image generation: 50 (Lite) → 500 (Pro) → Unlimited (Ultra).[59]

#### Privacy Architecture
Octofold's primary differentiator is zero-knowledge encryption — unlike Notion, Google Workspace, or even Routine, the server cannot decrypt user content. This is the strongest privacy guarantee among the commercial tools evaluated. The tradeoff: no self-hosting, no code auditability (closed source), and you depend on Octofold's implementation of the encryption being correct.[59]

#### Critical Limitations
- No CalDAV; no external calendar integration documented — calendar appears to be Octofold-native only.
- Closed source: the zero-knowledge claim cannot be independently audited.
- Relatively young product with a Turkish UI trace in pricing (suggesting origin market) — limited third-party reviews.
- Business-directory features are noise for personal/technical use cases.

#### Competitive Position
Octofold occupies a unique niche: **encrypted workspace that co-locates email + calendar + notes + tasks under one zero-knowledge hub**. There is no open-source equivalent at this level of integration. The closest analogy is Proton's ecosystem (ProtonMail + ProtonCalendar + ProtonDrive), but Proton does not integrate tasks and notes into a unified workspace. For professionals with strong data-residency requirements who cannot self-host and want one hub, Octofold is the most complete privacy-focused commercial option.

**Pricing:** Free (limited). Lite: $8.99/month (billed annually, $107.93/year). Pro: $29.40/month ($352.80/year). Ultra: $77.40/month ($928.80/year). Team: 5-100 seats from ~$104.97/month (5 seats).[59]

***

### 11. Planito

**Niche:** Calm, unified workspace for individuals and teams that combines rich notes, tasks, calendar, AI intelligence, and knowledge base in a single tab. Positioned as a direct replacement for "Notion + Trello + Google Calendar."[60]

**Platform:** Web-based SaaS; 18+ countries, 24,000+ workflows automated.[60]

#### Feature Matrix

**Notes**
- Rich notes editor with markdown, callouts, tables, code blocks, image embeds, slash commands.[60]
- Distraction-free writing environment.[60]

**Tasks**
- Personal and team task management: priorities, deadlines, assignees, progress tracking, comments, real-time collaborative editing.[60]
- Smart workflow automation: recurring schedules and triggers for hands-off project running.[60]
- Auto Workflows: create recurring rules once and let Planito execute them.[60]

**Calendar**
- Weekly Calendar view: visual week view connecting events, tasks, and focus blocks.[60]
- Drag events across the grid; multiple categories with color-coded time blocks.[60]
- Smart Workflow Automation includes recurring event scheduling.[60]
- Meeting Summaries: automatic outcome capture and follow-up after meetings.[60]
- No explicit mention of Google/Outlook/CalDAV integration in public documentation — calendar appears to be internal.

**Structure View**
- Interactive node-graph for visualizing academic, business, or life systems.[60]
- Zoom, pan, click-to-edit nodes; drag to rearrange.[60]

**Smart Sheets**
- Spreadsheet capability with 20+ templates, AI insights, custom columns, real-time filtering.[60]

**Knowledge Base / Web Clipper**
- Save links from anywhere; AI summarizes instantly, extracts key insights.[60]
- Convert articles into notes or tasks; track reading progress.[60]

**Intelligence Layer**
- AI knows the entire workspace: summarizes saved links, extracts insights, generates tasks, detects patterns.[60]
- AI accuracy claim: 98% task accuracy via AI (marketing metric, not independently verified).[60]

**Privacy**
- Data encrypted in transit; not sold; not used to train AI models.[60]
- No zero-knowledge claims; hosted SaaS.

#### Competitive Position
Planito is a strong all-in-one candidate for individuals/teams willing to move everything into one hosted workspace. The Knowledge Base + AI summary combo is the most useful differentiator for link-heavy researchers. The calendar is internal (no CalDAV/Google sync confirmed), which may limit adoption for users with existing calendar infrastructure. At the lower price point (free plan with paid tiers), it competes on breadth rather than depth.

**Pricing:** Free plan available (always free, no credit card). Paid tiers not publicly detailed in researched sources.[60]

***

## Comparative Feature Matrix

| Tool | License | Self-Host | Notes Depth | Task Depth | Calendar Model | CalDAV | Ext. Cal Sync | Linux Native |
|------|---------|-----------|-------------|------------|----------------|--------|---------------|--------------|
| **Vikunja** | AGPLv3 | ✅ Full | ❌ None | ✅✅✅ | Task-as-CalDAV | ✅ (alpha) | ❌ | ✅ (Web) |
| **Logseq** | AGPLv3 | Partial* | ✅✅✅ | ✅✅ | Plugin (Agenda) | ❌ | ❌ | ✅ |
| **AppFlowy** | AGPLv3 | ✅ Full | ✅✅ | ✅✅ | DB view only | ❌ | ❌ | ✅ |
| **AFFiNE** | MIT/AGPL | ✅ Full | ✅✅✅ | ✅ (doc-embed) | iCal read-only | ❌ | iCal URL | ✅ (Web) |
| **Huly** | EPL-2.0 | ✅ Full | ✅✅ | ✅✅✅ | Team Planner + Google | ❌ | Google 2-way | ✅ |
| **Org-mode** | GPL | ✅ (local) | ✅✅✅ | ✅✅✅ | Native agenda | ✅ (via pkg) | iCal export | ✅ |
| **NotePlan** | Proprietary | ❌ | ✅✅ | ✅✅ | System calendar (EventKit) | ✅ (via macOS) | All (via macOS) | ❌ |
| **Capacities** | Proprietary | ❌ | ✅✅✅ | ✅ (new, limited) | Built-in + Google/Outlook | ❌ | Google/Outlook (read) | Web only |
| **Routine** | Proprietary | ❌ | ✅ | ✅✅ | Calendar-first backbone | ❌ | Google/Outlook/iCloud 2-way | ✅ |
| **Octofold** | Proprietary | ❌ | ✅✅ | ✅ | Internal + E2E encrypted | ❌ | IMAP only | Web |
| **Planito** | Proprietary | ❌ | ✅✅ | ✅✅ | Internal weekly view | ❌ | Not confirmed | Web |

*Logseq sync backend not self-hostable; file sync via third-party tools (SyncThing, Nextcloud).

***

## Gap Analysis: The Unsolved Triangle

The core market gap — native, bidirectional, first-class integration of **personal notes** + **task management** + **calendar events** in one data model with **self-host support** — remains unsolved in 2026.

The closest approximations:

- **Best notes + calendar integration, self-hosted:** AFFiNE (read-only iCal) or Huly (Google 2-way). Neither has deep notes+tasks+calendar parity.
- **Best notes + tasks, self-hosted:** Logseq (knowledge graph depth) or AppFlowy (workspace depth). Calendar is absent or shallow.
- **Best calendar + tasks integration, any platform:** Routine (two-way Google/Outlook) or NotePlan (system EventKit). Notes are lightweight.
- **Best all-three, privacy-first commercial:** Octofold (E2EE, but closed and no CalDAV).
- **Best all-three, self-hosted, technically:** Org-mode + Emacs (maximum integration depth, steep adoption cost).
- **Best all-three, tasks with CalDAV bridge, self-hosted:** Vikunja + external calendar + notes in a separate tool (still three tools, but two managed by you).

The architectural reason for this gap: notes need a rich content model (blocks, links, hierarchies); tasks need a structured workflow model (statuses, priorities, recurring rules, assignees); calendar needs temporal precision (VEVENT, VTODO, VFREEBUSY, recurrence rules, timezone handling). Merging all three without one domain dominating and degrading the others requires purpose-built data modeling that no current tool has fully executed.

***

## Strategic Observations

1. **CalDAV is the lingua franca nobody implements well for personal use.** CalDAV (RFC 4791) and CalDAV+CardDAV are the only open protocols for calendar/contact sync. Of the tools evaluated, only Vikunja (tasks-as-VTODO) and NotePlan (via macOS Internet Accounts) expose CalDAV. This is a clear market gap for a self-hosted personal workspace.

2. **AI as a substitute for integration.** Routine's AI voice commands, Octofold's Octopus, and Capacities' Intelligence Layer all attempt to paper over integration gaps by using AI to shuttle data between features. This is a UX band-aid, not a data-model fix. MCP (Model Context Protocol) — supported by Routine and Logseq (MCP Server) — is the emerging protocol for AI-to-app integration and may matter more in 2026-2027.

3. **The note-as-event pattern.** NotePlan and AFFiNE both implement "create a note from a calendar event" as the bridge between calendar and notes. This is directionally correct — an event without context (notes, tasks) is half the picture — but neither supports writing events back.

4. **Open-source momentum is accelerating.** Logseq's DB unification (May 2025), AppFlowy's local AI RAG (2025), AFFiNE's calendar integration (v0.22, June 2025), and Huly's two-way Google Calendar sync represent more calendar-facing open-source progress in 2025 than in the previous three years combined. The gap is closing.

5. **Self-host + CalDAV + notes remains the white space.** A tool that self-hosts, implements CalDAV natively for bidirectional event sync (not just VTODO), and has a rich notes model would occupy a niche currently served only by complex stacks (Nextcloud Calendar + Joplin + Vikunja, etc.). No single tool occupies this space in mid-2026.
