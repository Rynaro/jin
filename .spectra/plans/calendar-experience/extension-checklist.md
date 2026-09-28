# Calendar extension checklist

Use this checklist before accepting any Calendar / Event Companion field, action, capability, or state. Full visual-language dossier expansion is Stage S8 — this page is the lightweight gate for AC-CALX-061.

## Required before merge

### Shared section placement
Declare which shared Preview / Composer / Companion section owns the addition (or why a Calendar-only geometry surface is required).

### Summary copy
Provide the one-line summary copy (en + pt-BR key names) shown when a disclosure is collapsed.

### Mode / capability / state matrix
List create vs edit, required capabilities, and durable vs provider states the control must respect.

### Owner
Name the CSS/code owner (`calendar.css` geometry, `events.css` companion content, `lib/events/*` pure helpers, or `CalendarViewController` orchestration). Do not invent a third normal-layout CSS owner.

### Duplicate-removal list
Enumerate obsolete competing selectors/declarations removed (or explicitly kept with reason) so cascade authority stays singular.

### Cross-entry regression coverage
Name the fixture or test that proves Calendar, Preview/Composer, full detail, and any other entry share destination, validation, and serialized meaning through shared adapters.
