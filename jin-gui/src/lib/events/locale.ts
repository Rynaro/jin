export type EventLocaleKey = 'en' | 'pt-BR';
export type EventLocalePreference = 'system' | EventLocaleKey;

const STORAGE_KEY = 'jin:event-locale';

const catalogs = {
  en: {
    back: 'Back', calendar: 'Calendar', edit: 'Edit', delete: 'Delete', remove: 'Remove',
    save: 'Save', saving: 'Saving…', cancel: 'Cancel', sourceJin: 'Source: Jin', sourceGoogle: 'Source: Google',
    timeBlock: 'Time block', allDay: 'All day', recurring: 'Recurring', location: 'Location',
    originTask: 'Originating task', prepNotes: 'Prep notes', related: 'Related', open: 'Open',
    findPrep: 'Find prep note', findRelated: 'Find related note', more: 'More',
    privateTitle: 'Private to Jin',
    privateCopy: 'Attached notes and links stay in Jin. They aren’t shared with Google or event guests.',
    attachedOnly: 'Attached in Jin only.',
    readCancelled: 'This event is cancelled and can only be viewed.',
    readRecurring: 'Recurring events are view-only in this milestone.',
    readExternal: 'Google events are view-only in Jin.',
    removeTitle: 'Remove this Time block?',
    removeBody: 'The task will not be completed or deleted.',
    returnFlexible: 'Return task to flexible agenda',
    removalBlocked: 'Removal is blocked until the conflicting calendar change is resolved.',
    removalConflict: 'This event changed. Review the refreshed details and try again.',
    loading: 'Loading event…', notFound: 'Event not found.',
    events: 'Events', event: 'event', noEvents: 'No events scheduled', view: 'View', addEvent: 'Add Event',
    newEvent: 'New Event', editEvent: 'Edit Event', create: 'Create', update: 'Update',
    createEvent: 'Create event', close: 'Close', title: 'Title', date: 'Date',
    when: 'When', dateTime: 'Date and time', use: 'Use', clear: 'Clear', useDates: 'Use dates',
    relativePlaceholder: 'Tomorrow at 2pm', relativeHint: 'Type a date naturally, or choose dates below.',
    chooseDate: 'Choose a date', previousMonth: 'Previous month', nextMonth: 'Next month',
    previousYear: 'Previous year', nextYear: 'Next year', chooseAtLeastOneDay: 'Choose at least one day.',
    naturalEmpty: 'Try “tomorrow at 2pm” or “2026-08-28 09:30”.',
    naturalUnsupported: 'Use today, tomorrow, a weekday, “in N days”, or YYYY-MM-DD.',
    naturalInvalidDate: 'That calendar date does not exist.',
    naturalInvalidTime: 'Use a time like 9, 9:30, 9am, noon, or midnight.',
    naturalDayBounds: 'Use 1–365 days.', naturalWeekBounds: 'Use 1–52 weeks.',
    naturalInvalidToday: 'Today could not be determined.', invalidTime: 'Use a time like 9, 930, or 9:30.',
    startTime: 'Start time', endTime: 'End time', description: 'Description',
    eventTitle: 'Event title', eventDescription: 'Event description', endAfterStart: 'End must be after start',
    titleDateRequired: 'Title and date are required', failedLoadCalendar: 'Failed to load calendar',
    eventSaved: 'Event saved.', eventChanged: 'This event changed',
    eventChangedCopy: 'Review the latest event before saving again.', changedFields: 'Changed fields',
    useLatest: 'Use latest', reviewDraft: 'Review my draft',
    editValidation: 'Add a title and valid date and time before saving.',
    editBlocked: 'Saving is blocked until the conflicting calendar change is repaired.',
    editRetry: 'Your draft is safe. Review it and try Save again.',
    failedLoadEvent: 'Failed to load the complete event', failedSaveEvent: 'Failed to save event',
    failedLoadEvents: 'Failed to load events', failedDeleteEvent: 'Failed to delete event',
    failedRemoveEvent: 'Failed to remove event', failedAttachNote: 'Failed to attach note',
    failedAddRelated: 'Failed to add related note', unexpectedError: 'An unexpected error occurred. Please try again.',
    failedPromoteTask: 'Failed to promote task',
    previous: 'Previous', next: 'Next', today: 'Today', goToday: 'Go to today',
    month: 'Month', week: 'Week', day: 'Day', deleteConfirm: 'Delete this event?',
    dayTimeline: 'Day timeline', weekTimeline: 'Week timeline', allDayLane: 'All-day events',
    earlyNight: 'Early nighttime, midnight to 6 AM', lateNight: 'Late nighttime, 10 PM to midnight',
    show: 'Show', hide: 'Hide', currentTime: 'current time', noNightEvents: 'no events',
    continuedFromBefore: 'Continued from before', continuesAfter: 'Continues after', tasks: 'Tasks',
    promoteEvent: 'Promote to event', promoteEventTitle: 'Promote this task to a calendar event',
    readOnlyEvent: 'This event is read-only because it is external or recurring.',
    noteTitle: 'Note title', relatedTitle: 'Related note title', attachNote: 'Attach note',
    addRelated: 'Add related note', searchByTitle: 'Search by title', noTitleMatch: 'Choose a note from the title suggestions.',
    localeSystem: 'System Default', localeEnglish: 'English', localePortuguese: 'Português (Brasil)',
    localeLabel: 'Calendar and event language', flexible: 'Flexible',
    recurrenceScope: 'Apply changes to', thisOccurrence: 'This occurrence', entireSeries: 'Entire series',
    deleteEntireSeries: 'Delete the entire series',
    organizer: 'Organizer', attendees: 'Attendees', attendeeListLimited: 'Google returned a limited attendee list.', conferencing: 'Conferencing', reminders: 'Reminders',
    you: 'You', guest: 'Guest', optional: 'Optional', joinMeeting: 'Join meeting', conferenceId: 'Conference ID',
    conferenceEntryPoint: 'Dial-in details', conferenceCredentials: 'credentials', conferencePin: 'PIN', conferenceAccessCode: 'Access code', conferenceMeetingCode: 'Meeting code', conferencePasscode: 'Passcode', conferencePassword: 'Password',
    calendarDefault: 'Calendar default', noReminders: 'No reminders', beforeEvent: 'before', atEventTime: 'At event time',
    responseAccepted: 'Accepted', responseTentative: 'Tentative', responseDeclined: 'Declined', responseNeedsAction: 'Awaiting response',
    reminderPopup: 'Popup', reminderEmail: 'Email', minute: 'minute', minutes: 'minutes',
  },
  'pt-BR': {
    back: 'Voltar', calendar: 'Calendário', edit: 'Editar', delete: 'Excluir', remove: 'Remover',
    save: 'Salvar', saving: 'Salvando…', cancel: 'Cancelar', sourceJin: 'Source: Jin', sourceGoogle: 'Source: Google',
    timeBlock: 'Time block', allDay: 'Dia inteiro', recurring: 'Recorrente', location: 'Local',
    originTask: 'Tarefa de origem', prepNotes: 'Notas de preparo', related: 'Relacionados', open: 'Abrir',
    findPrep: 'Buscar nota de preparo', findRelated: 'Buscar nota relacionada', more: 'Mais',
    privateTitle: 'Privado no Jin',
    privateCopy: 'Notas e links anexados permanecem no Jin. Eles não são compartilhados com o Google nem com convidados do evento.',
    attachedOnly: 'Anexado somente no Jin.',
    readCancelled: 'Este evento foi cancelado e está disponível apenas para visualização.',
    readRecurring: 'Eventos recorrentes estão disponíveis apenas para visualização neste marco.',
    readExternal: 'Eventos do Google estão disponíveis apenas para visualização no Jin.',
    removeTitle: 'Remover este Time block?',
    removeBody: 'A tarefa não será concluída nem excluída.',
    returnFlexible: 'Retornar tarefa à agenda flexível',
    removalBlocked: 'A remoção está bloqueada até que a alteração conflitante seja resolvida.',
    removalConflict: 'Este evento mudou. Revise os detalhes atualizados e tente novamente.',
    loading: 'Carregando evento…', notFound: 'Evento não encontrado.',
    events: 'Eventos', event: 'evento', noEvents: 'Nenhum evento agendado', view: 'Ver', addEvent: 'Adicionar evento',
    newEvent: 'Novo evento', editEvent: 'Editar evento', create: 'Criar', update: 'Atualizar',
    createEvent: 'Criar evento', close: 'Fechar', title: 'Título', date: 'Data',
    when: 'Quando', dateTime: 'Data e hora', use: 'Usar', clear: 'Limpar', useDates: 'Usar datas',
    relativePlaceholder: 'Amanhã às 14h', relativeHint: 'Digite uma data naturalmente ou escolha as datas abaixo.',
    chooseDate: 'Escolha uma data', previousMonth: 'Mês anterior', nextMonth: 'Próximo mês',
    previousYear: 'Ano anterior', nextYear: 'Próximo ano', chooseAtLeastOneDay: 'Escolha pelo menos um dia.',
    naturalEmpty: 'Tente “amanhã às 14h” ou “2026-08-28 09:30”.',
    naturalUnsupported: 'Use hoje, amanhã, um dia da semana, “em N dias” ou YYYY-MM-DD.',
    naturalInvalidDate: 'Essa data não existe no calendário.',
    naturalInvalidTime: 'Use um horário como 9, 9:30, 9h, meio-dia ou meia-noite.',
    naturalDayBounds: 'Use de 1 a 365 dias.', naturalWeekBounds: 'Use de 1 a 52 semanas.',
    naturalInvalidToday: 'Não foi possível determinar a data de hoje.', invalidTime: 'Use um horário como 9, 930 ou 9:30.',
    startTime: 'Hora de início', endTime: 'Hora de término', description: 'Descrição',
    eventTitle: 'Título do evento', eventDescription: 'Descrição do evento', endAfterStart: 'O término deve ser posterior ao início',
    titleDateRequired: 'Título e data são obrigatórios', failedLoadCalendar: 'Não foi possível carregar o calendário',
    eventSaved: 'Evento salvo.', eventChanged: 'Este evento mudou',
    eventChangedCopy: 'Revise o evento mais recente antes de salvar novamente.', changedFields: 'Campos alterados',
    useLatest: 'Usar versão mais recente', reviewDraft: 'Revisar meu rascunho',
    editValidation: 'Adicione um título e uma data e horário válidos antes de salvar.',
    editBlocked: 'O salvamento está bloqueado até que a alteração conflitante seja reparada.',
    editRetry: 'Seu rascunho está seguro. Revise-o e tente Salvar novamente.',
    failedLoadEvent: 'Não foi possível carregar o evento completo', failedSaveEvent: 'Não foi possível salvar o evento',
    failedLoadEvents: 'Não foi possível carregar os eventos', failedDeleteEvent: 'Não foi possível excluir o evento',
    failedRemoveEvent: 'Não foi possível remover o evento', failedAttachNote: 'Não foi possível anexar a nota',
    failedAddRelated: 'Não foi possível adicionar a nota relacionada', unexpectedError: 'Ocorreu um erro inesperado. Tente novamente.',
    failedPromoteTask: 'Não foi possível promover a tarefa',
    previous: 'Anterior', next: 'Próximo', today: 'Hoje', goToday: 'Ir para hoje',
    month: 'Mês', week: 'Semana', day: 'Dia', deleteConfirm: 'Excluir este evento?',
    dayTimeline: 'Linha do tempo do dia', weekTimeline: 'Linha do tempo da semana', allDayLane: 'Eventos de dia inteiro',
    earlyNight: 'Madrugada, da meia-noite às 6h', lateNight: 'Noite, das 22h à meia-noite',
    show: 'Mostrar', hide: 'Ocultar', currentTime: 'hora atual', noNightEvents: 'nenhum evento',
    continuedFromBefore: 'Continua de antes', continuesAfter: 'Continua depois', tasks: 'Tarefas',
    promoteEvent: 'Promover para evento', promoteEventTitle: 'Promover esta tarefa para um evento do calendário',
    readOnlyEvent: 'Este evento é somente leitura porque é externo ou recorrente.',
    noteTitle: 'Título da nota', relatedTitle: 'Título da nota relacionada', attachNote: 'Anexar nota',
    addRelated: 'Adicionar nota relacionada', searchByTitle: 'Buscar por título', noTitleMatch: 'Escolha uma nota nas sugestões de títulos.',
    localeSystem: 'Padrão do sistema', localeEnglish: 'English', localePortuguese: 'Português (Brasil)',
    localeLabel: 'Idioma do Calendário e dos eventos', flexible: 'Flexível',
    recurrenceScope: 'Aplicar alterações a', thisOccurrence: 'Esta ocorrência', entireSeries: 'Série inteira',
    deleteEntireSeries: 'Excluir a série inteira',
    organizer: 'Organizador', attendees: 'Participantes', attendeeListLimited: 'O Google retornou uma lista limitada de participantes.', conferencing: 'Videoconferência', reminders: 'Lembretes',
    you: 'Você', guest: 'Participante', optional: 'Opcional', joinMeeting: 'Entrar na reunião', conferenceId: 'ID da conferência',
    conferenceEntryPoint: 'Dados de acesso', conferenceCredentials: 'credenciais', conferencePin: 'PIN', conferenceAccessCode: 'Código de acesso', conferenceMeetingCode: 'Código da reunião', conferencePasscode: 'Senha numérica', conferencePassword: 'Senha',
    calendarDefault: 'Padrão do calendário', noReminders: 'Sem lembretes', beforeEvent: 'antes', atEventTime: 'No horário do evento',
    responseAccepted: 'Confirmado', responseTentative: 'Talvez', responseDeclined: 'Recusado', responseNeedsAction: 'Aguardando resposta',
    reminderPopup: 'Notificação', reminderEmail: 'E-mail', minute: 'minuto', minutes: 'minutos',
  },
} as const;

export type EventMessageKey = keyof typeof catalogs.en;

export function isEventLocaleKey(value: unknown): value is EventLocaleKey {
  return value === 'en' || value === 'pt-BR';
}

export function normalizeEventLocalePreference(value: unknown): EventLocalePreference {
  return value === 'system' || isEventLocaleKey(value) ? value : 'system';
}

export function loadEventLocalePreference(): EventLocalePreference {
  return normalizeEventLocalePreference(localStorage.getItem(STORAGE_KEY));
}

export function saveEventLocalePreference(value: unknown): EventLocalePreference {
  const preference = normalizeEventLocalePreference(value);
  localStorage.setItem(STORAGE_KEY, preference);
  window.dispatchEvent(new CustomEvent('jin:event-locale-changed', { detail: { preference } }));
  return preference;
}

export function resolveEventLocale(
  preference: EventLocalePreference = loadEventLocalePreference(),
  systemLocale: string = navigator.language,
): EventLocaleKey {
  if (preference !== 'system') return preference;
  return systemLocale.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}

export function eventMessage(key: EventMessageKey, locale = resolveEventLocale()): string {
  return catalogs[locale][key];
}

export function eventLocaleOptions(locale = resolveEventLocale()): Array<{ value: EventLocalePreference; label: string }> {
  return [
    { value: 'system', label: eventMessage('localeSystem', locale) },
    { value: 'en', label: eventMessage('localeEnglish', locale) },
    { value: 'pt-BR', label: eventMessage('localePortuguese', locale) },
  ];
}
