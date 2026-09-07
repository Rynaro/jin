//! Root-aware event mutation service with recoverable outbox intent.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

use crate::google::account::{EventSyncTarget, GoogleAccountState};
use crate::model::event::{EventSource, EventStatus};
use crate::model::Event;
use crate::notification_center::InvitationResponse;
use crate::ops::events::{CreateEventParams, EditEventPatch};
use crate::store::fs;
use crate::sync::state::{
    self, OutboxOperation, OutboxOperationKind, SyncDestination, MASTER_RECURRENCE_KEY,
};
use crate::{Config, JinError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecurrenceMutationScope {
    ThisOccurrence,
    EntireSeries,
    ThisAndFollowing,
}

#[derive(Debug, Clone)]
pub struct InvitationResponseMutationRequest {
    pub event_id: String,
    pub target: EventSyncTarget,
    pub operation_id: String,
    pub response: InvitationResponse,
    pub recurrence_scope: Option<RecurrenceMutationScope>,
    pub expected_google_event_id: String,
    pub expected_recurrence_key: String,
    pub expected_self_email: String,
    pub expected_etag: String,
    pub expected_provider_subject: String,
    pub expected_auth_generation: u64,
    pub expected_route_generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedInvitationResponse {
    pub operation_id: String,
    pub event_id: String,
    pub google_event_id: String,
    pub recurrence_key: String,
    pub response_status: String,
    pub canonical_revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MutationJournal {
    operation_id: String,
    event_id: String,
    target: EventSyncTarget,
    operation: OutboxOperationKind,
    recurrence_key: String,
    google_event_id: Option<String>,
    base_etag: Option<String>,
    canonical_revision: String,
    auth_generation: u64,
    route_generation: u64,
    payload: Option<serde_json::Value>,
    finalized: bool,
}

pub struct EventMutationService<'a> {
    root: &'a Path,
    config: Config,
}

impl<'a> EventMutationService<'a> {
    pub fn new(root: &'a Path) -> crate::Result<Self> {
        Ok(Self {
            root,
            config: Config::load(root)?,
        })
    }

    pub fn create(
        &self,
        params: CreateEventParams,
        target: Option<EventSyncTarget>,
        operation_id: &str,
    ) -> crate::Result<Event> {
        self.create_with_recurrence(params, Vec::new(), target, operation_id)
    }

    pub fn create_with_recurrence(
        &self,
        params: CreateEventParams,
        recurrence: Vec<String>,
        target: Option<EventSyncTarget>,
        operation_id: &str,
    ) -> crate::Result<Event> {
        validate_operation_id(operation_id)?;
        if target.is_none() && !recurrence.is_empty() {
            return Err(JinError::InvalidInput(
                "Recurring events currently require a writable Google Calendar destination"
                    .to_string(),
            ));
        }
        let mut event = crate::ops::events::build_event(params, None)?;
        event.frontmatter.recurrence = recurrence;
        event.frontmatter.recurrence_unexpanded = !event.frontmatter.recurrence.is_empty();
        if let Some(target) = target {
            let (auth_generation, route_generation) = self.validate_target(&target, true)?;
            event.frontmatter.calendar_id = target.calendar_id.clone();
            let bytes = fs::render_event_bytes(&event)?;
            let revision = revision(&bytes);
            let payload = crate::google::mapping::jin_to_google(&event.frontmatter);
            let journal = MutationJournal {
                operation_id: operation_id.to_string(),
                event_id: event.id().to_string(),
                target,
                operation: OutboxOperationKind::Insert,
                recurrence_key: MASTER_RECURRENCE_KEY.to_string(),
                google_event_id: None,
                base_etag: None,
                canonical_revision: revision,
                auth_generation,
                route_generation,
                payload: Some(payload),
                finalized: false,
            };
            self.write_journal(&journal)?;
            fs::write_event(&self.config.events_dir(), &event)?;
            crate::google::route_ownership::write(
                &self.config.events_dir(),
                event.id(),
                &journal.target,
            )?;
            self.finalize(journal)?;
        } else {
            fs::write_event(&self.config.events_dir(), &event)?;
        }
        self.refresh_index()?;
        Ok(event)
    }

    /// Route a Jin-local edit through the same root-aware mutation boundary as
    /// provider-backed edits. The underlying recoverable operation remains the
    /// canonical implementation for local-only events.
    pub fn edit_local(
        &self,
        event_id: &str,
        edit_token: &str,
        patch: EditEventPatch,
        operation_id: &str,
    ) -> crate::Result<crate::ops::events::EditEventOutcome> {
        self.edit_local_scoped(event_id, edit_token, patch, None, operation_id)
    }

    pub fn edit_local_scoped(
        &self,
        event_id: &str,
        edit_token: &str,
        patch: EditEventPatch,
        scope: Option<RecurrenceMutationScope>,
        operation_id: &str,
    ) -> crate::Result<crate::ops::events::EditEventOutcome> {
        validate_operation_id(operation_id)?;
        if let Some(ownership) =
            crate::google::route_ownership::read(&self.config.events_dir(), event_id)?
        {
            let target = EventSyncTarget::new(ownership.account_id, ownership.calendar_id)?;
            let event = self.edit(event_id, edit_token, patch, target, scope, operation_id)?;
            return Ok(crate::ops::events::EditEventOutcome {
                event,
                no_op: false,
            });
        }
        if scope.is_some() {
            return self.edit_unrouted_recurrence(event_id, edit_token, patch, scope, operation_id);
        }
        crate::ops::events::edit_event_with_operation_id(
            self.root,
            event_id,
            edit_token,
            operation_id,
            patch,
        )
    }

    /// Route a Jin-local delete through the root-aware mutation boundary.
    pub fn delete_local(&self, event_id: &str) -> crate::Result<Event> {
        self.delete_local_scoped(event_id, None)
    }

    pub fn delete_local_scoped(
        &self,
        event_id: &str,
        scope: Option<RecurrenceMutationScope>,
    ) -> crate::Result<Event> {
        if let Some(ownership) =
            crate::google::route_ownership::read(&self.config.events_dir(), event_id)?
        {
            let target = EventSyncTarget::new(ownership.account_id, ownership.calendar_id)?;
            return self.delete(
                event_id,
                target,
                scope,
                &format!("legacy-delete-{}", crate::id::new_ulid()),
            );
        }
        let path = fs::find_event_path(&self.config.events_dir(), event_id)?;
        let event = fs::read_event(&path)?;
        if !event.frontmatter.recurrence.is_empty() {
            return Err(JinError::InvalidInput(
                "Local recurring series are read-only until local occurrence projection is available"
                    .to_string(),
            ));
        }
        validate_supported_recurrence_mutation(&event, scope)?;
        let event = crate::ops::events::delete_event(&self.config.events_dir(), event_id)?;
        self.refresh_index()?;
        Ok(event)
    }

    /// Publish an existing Jin-owned event to one exact destination. This is
    /// used by task promotion after its recoverable task/event transaction has
    /// converged; retries are idempotent through the scoped outbox key.
    pub fn publish_existing(
        &self,
        event_id: &str,
        target: EventSyncTarget,
        operation_id: &str,
    ) -> crate::Result<Event> {
        validate_operation_id(operation_id)?;
        self.recover()?;
        let (auth_generation, route_generation) = self.validate_target(&target, true)?;
        let path = fs::find_event_path(&self.config.events_dir(), event_id)?;
        let mut event = fs::read_event(&path)?;
        if let Some(existing) =
            crate::google::route_ownership::read(&self.config.events_dir(), event_id)?
        {
            let existing_target = EventSyncTarget::new(existing.account_id, existing.calendar_id)?;
            crate::google::route_ownership::validate(&self.config.events_dir(), event_id, &target)?;
            if existing_target == target {
                return Ok(event);
            }
        }
        if event.frontmatter.source != EventSource::Jin {
            return Err(JinError::InvalidInput(
                "only Jin-origin events can be newly published".to_string(),
            ));
        }
        event.frontmatter.calendar_id = target.calendar_id.clone();
        event.frontmatter.updated = Utc::now().fixed_offset();
        event.frontmatter.sequence = event.frontmatter.sequence.saturating_add(1);
        let bytes = fs::render_event_bytes(&event)?;
        let journal = MutationJournal {
            operation_id: operation_id.to_string(),
            event_id: event_id.to_string(),
            target,
            operation: OutboxOperationKind::Insert,
            recurrence_key: MASTER_RECURRENCE_KEY.to_string(),
            google_event_id: None,
            base_etag: None,
            canonical_revision: revision(&bytes),
            auth_generation,
            route_generation,
            payload: Some(crate::google::mapping::jin_to_google(&event.frontmatter)),
            finalized: false,
        };
        self.write_journal(&journal)?;
        fs::write_event(&self.config.events_dir(), &event)?;
        crate::google::route_ownership::write(
            &self.config.events_dir(),
            event_id,
            &journal.target,
        )?;
        self.finalize(journal)?;
        self.refresh_index()?;
        Ok(event)
    }

    pub fn edit(
        &self,
        event_id: &str,
        edit_token: &str,
        patch: EditEventPatch,
        target: EventSyncTarget,
        scope: Option<RecurrenceMutationScope>,
        operation_id: &str,
    ) -> crate::Result<Event> {
        validate_operation_id(operation_id)?;
        if scope == Some(RecurrenceMutationScope::ThisAndFollowing) {
            return Err(JinError::InvalidInput(
                "This and following recurrence edits are not supported".to_string(),
            ));
        }
        let (auth_generation, route_generation) = self.validate_target(&target, true)?;
        let requested_path = fs::find_event_path(&self.config.events_dir(), event_id)?;
        let requested_bytes = std::fs::read(&requested_path)?;
        let requested = fs::parse_event_bytes(&requested_bytes)?;
        let effective_id = series_event_id(&requested, event_id, scope)?;
        let path = fs::find_event_path(&self.config.events_dir(), &effective_id)?;
        let before = std::fs::read(&path)?;
        // The editor token belongs to the occurrence the user opened. For an
        // entire-series mutation that token guards the occurrence while the
        // canonical master is resolved and mutated in this same operation.
        let guarded_bytes = if effective_id == event_id {
            &before
        } else {
            &requested_bytes
        };
        if format!("sha256:{:x}", Sha256::digest(guarded_bytes)) != edit_token {
            return Err(JinError::StaleEvent {
                event_id: effective_id.clone(),
            });
        }
        let mut event = fs::read_event(&path)?;
        let before_event = event.clone();
        self.validate_event_target(&event, &target)?;
        let recurrence_key = recurrence_key(&event, scope)?;
        if event.frontmatter.status == EventStatus::Cancelled {
            return Err(JinError::InvalidStateTransition {
                from: "cancelled".to_string(),
                to: "changed".to_string(),
            });
        }
        if event.frontmatter.source == EventSource::Jin {
            validate_supported_recurrence_mutation(&event, scope)?;
        }
        crate::ops::events::validate_meeting_patch(&patch)?;
        validate_attendee_patch(&event, &patch)?;
        if effective_id != event_id && scope == Some(RecurrenceMutationScope::EntireSeries) {
            apply_series_patch(&mut event, &requested, patch)?;
        } else {
            apply_patch(&mut event, patch);
        }
        event.frontmatter.updated = Utc::now().fixed_offset();
        event.frontmatter.sequence += 1;
        let bytes = fs::render_event_bytes(&event)?;
        let destination = SyncDestination::google(
            target.account_id.as_str().to_string(),
            target.calendar_id.clone(),
        );
        let conn = state::open_sync_db(&self.config.sync_dir())?;
        let mapping =
            state::get_scoped_entry_by_jin_id(&conn, &destination, &effective_id, &recurrence_key)?;
        if event.frontmatter.source == EventSource::Google && mapping.is_none() {
            return Err(JinError::Integrity(
                "Google event has no mapping for its persisted destination".to_string(),
            ));
        }
        let payload = sparse_patch(&before_event, &event);
        let journal = MutationJournal {
            operation_id: operation_id.to_string(),
            event_id: effective_id,
            target,
            operation: OutboxOperationKind::Patch,
            recurrence_key,
            google_event_id: mapping
                .as_ref()
                .and_then(|entry| entry.google_event_id.clone()),
            base_etag: mapping.as_ref().and_then(|entry| entry.etag.clone()),
            canonical_revision: revision(&bytes),
            auth_generation,
            route_generation,
            payload: Some(payload),
            finalized: false,
        };
        self.write_journal(&journal)?;
        fs::write_event(&self.config.events_dir(), &event)?;
        self.finalize(journal)?;
        self.refresh_index()?;
        Ok(event)
    }

    pub fn delete(
        &self,
        event_id: &str,
        target: EventSyncTarget,
        scope: Option<RecurrenceMutationScope>,
        operation_id: &str,
    ) -> crate::Result<Event> {
        validate_operation_id(operation_id)?;
        if scope == Some(RecurrenceMutationScope::ThisAndFollowing) {
            return Err(JinError::InvalidInput(
                "This and following recurrence edits are not supported".to_string(),
            ));
        }
        let (auth_generation, route_generation) = self.validate_target(&target, true)?;
        let requested = fs::read_event(&fs::find_event_path(&self.config.events_dir(), event_id)?)?;
        let effective_id = series_event_id(&requested, event_id, scope)?;
        let path = fs::find_event_path(&self.config.events_dir(), &effective_id)?;
        let mut event = fs::read_event(&path)?;
        self.validate_event_target(&event, &target)?;
        let recurrence_key = recurrence_key(&event, scope)?;
        if event.frontmatter.source == EventSource::Jin {
            validate_supported_recurrence_mutation(&event, scope)?;
        }
        let destination = SyncDestination::google(
            target.account_id.as_str().to_string(),
            target.calendar_id.clone(),
        );
        let conn = state::open_sync_db(&self.config.sync_dir())?;
        let mapping =
            state::get_scoped_entry_by_jin_id(&conn, &destination, &effective_id, &recurrence_key)?;
        if mapping.is_none() {
            return Err(JinError::Integrity(
                "synchronized delete has no mapping for its persisted destination".to_string(),
            ));
        }
        event.frontmatter.status = EventStatus::Cancelled;
        event.frontmatter.updated = Utc::now().fixed_offset();
        event.frontmatter.sequence += 1;
        let bytes = fs::render_event_bytes(&event)?;
        let journal = MutationJournal {
            operation_id: operation_id.to_string(),
            event_id: effective_id,
            target,
            operation: OutboxOperationKind::Delete,
            recurrence_key,
            google_event_id: mapping
                .as_ref()
                .and_then(|entry| entry.google_event_id.clone()),
            base_etag: mapping.as_ref().and_then(|entry| entry.etag.clone()),
            canonical_revision: revision(&bytes),
            auth_generation,
            route_generation,
            payload: None,
            finalized: false,
        };
        self.write_journal(&journal)?;
        fs::write_event(&self.config.events_dir(), &event)?;
        self.finalize(journal)?;
        self.refresh_index()?;
        Ok(event)
    }

    /// Queue a self-attendee RSVP without changing canonical attendee state.
    /// Provider-confirmed state is imported later by the sync worker.
    pub fn respond_to_invitation(
        &self,
        request: InvitationResponseMutationRequest,
    ) -> crate::Result<QueuedInvitationResponse> {
        self.respond_to_invitation_inner(request, true)
    }

    pub fn validate_invitation_response(
        &self,
        request: &InvitationResponseMutationRequest,
    ) -> crate::Result<QueuedInvitationResponse> {
        self.respond_to_invitation_inner(request.clone(), false)
    }

    fn respond_to_invitation_inner(
        &self,
        request: InvitationResponseMutationRequest,
        enqueue: bool,
    ) -> crate::Result<QueuedInvitationResponse> {
        validate_operation_id(&request.operation_id)?;
        if request.recurrence_scope == Some(RecurrenceMutationScope::ThisAndFollowing) {
            return Err(JinError::InvalidInput(
                "This and following invitation responses are not supported".to_string(),
            ));
        }
        let (auth_generation, route_generation) = self.validate_target(&request.target, true)?;
        if auth_generation != request.expected_auth_generation {
            return Err(JinError::OperationConflict {
                operation_id: request.operation_id,
                reason: "credential_generation_changed".to_string(),
            });
        }
        if route_generation != request.expected_route_generation {
            return Err(JinError::OperationConflict {
                operation_id: request.operation_id,
                reason: "route_generation_changed".to_string(),
            });
        }
        let account = self
            .config
            .google_registry
            .account(&request.target.account_id)?;
        if account.provider_subject.as_deref() != Some(&request.expected_provider_subject) {
            return Err(JinError::OperationConflict {
                operation_id: request.operation_id,
                reason: "credential_generation_changed".to_string(),
            });
        }

        let requested = fs::read_event(&fs::find_event_path(
            &self.config.events_dir(),
            &request.event_id,
        )?)?;
        let effective_id =
            invitation_response_event_id(&requested, &request.event_id, request.recurrence_scope)?;
        let event_path = fs::find_event_path(&self.config.events_dir(), &effective_id)?;
        let canonical_bytes = std::fs::read(&event_path)?;
        let event = fs::parse_event_bytes(&canonical_bytes)?;
        if event.frontmatter.source != EventSource::Google
            || event.frontmatter.authority != EventSource::Google
        {
            return Err(JinError::InvalidInput(
                "unsupported_source: invitation responses require a Google event".to_string(),
            ));
        }
        self.validate_event_target(&event, &request.target)?;
        if event.frontmatter.status == EventStatus::Cancelled {
            return Err(JinError::InvalidStateTransition {
                from: "cancelled".to_string(),
                to: "responded".to_string(),
            });
        }
        if event_has_ended(&event, Utc::now()) {
            return Err(JinError::InvalidInput("invitation_ended".to_string()));
        }
        let organizer_owned = event
            .frontmatter
            .organizer
            .as_ref()
            .and_then(|organizer| organizer.is_self)
            == Some(true);
        if organizer_owned {
            return Err(JinError::InvalidInput("organizer_owned".to_string()));
        }
        let self_attendees = event
            .frontmatter
            .attendees
            .as_deref()
            .unwrap_or_default()
            .iter()
            .filter(|attendee| attendee.is_self == Some(true))
            .collect::<Vec<_>>();
        let self_attendee = match self_attendees.as_slice() {
            [] => return Err(JinError::InvalidInput("self_attendee_missing".to_string())),
            [attendee] => *attendee,
            _ => {
                return Err(JinError::InvalidInput(
                    "self_attendee_ambiguous".to_string(),
                ))
            }
        };
        if self_attendee.organizer == Some(true) {
            return Err(JinError::InvalidInput("organizer_owned".to_string()));
        }
        let self_email = self_attendee
            .email
            .as_deref()
            .filter(|email| !email.trim().is_empty())
            .ok_or_else(|| JinError::InvalidInput("self_attendee_missing".to_string()))?;
        if self_email != request.expected_self_email {
            return Err(JinError::OperationConflict {
                operation_id: request.operation_id,
                reason: "self_attendee_changed".to_string(),
            });
        }
        if self_attendee.response_status.as_deref() != Some("needsAction") {
            return Err(JinError::InvalidInput("already_answered".to_string()));
        }

        let recurrence_key = invitation_response_recurrence_key(&event, request.recurrence_scope)?;
        if recurrence_key != request.expected_recurrence_key {
            return Err(JinError::OperationConflict {
                operation_id: request.operation_id,
                reason: "recurrence_identity_changed".to_string(),
            });
        }
        let destination = SyncDestination::google(
            request.target.account_id.as_str().to_string(),
            request.target.calendar_id.clone(),
        );
        let conn = state::open_sync_db(&self.config.sync_dir())?;
        let mapping =
            state::get_scoped_entry_by_jin_id(&conn, &destination, &effective_id, &recurrence_key)?
                .ok_or_else(|| {
                    JinError::Integrity(
                        "Google invitation has no mapping for its exact provider route".to_string(),
                    )
                })?;
        if mapping.google_event_id.as_deref() != Some(&request.expected_google_event_id) {
            return Err(JinError::OperationConflict {
                operation_id: request.operation_id,
                reason: "route_generation_changed".to_string(),
            });
        }
        if mapping.etag.as_deref() != Some(&request.expected_etag) {
            return Err(JinError::OperationConflict {
                operation_id: request.operation_id,
                reason: "stale_item".to_string(),
            });
        }
        let response_status = request.response.provider_status().to_string();
        let payload = serde_json::json!({
            "schemaVersion": 1,
            "selfEmail": self_email,
            "responseStatus": response_status,
            "providerSubject": request.expected_provider_subject,
        });
        let canonical_revision = revision(&canonical_bytes);
        let journal = MutationJournal {
            operation_id: request.operation_id.clone(),
            event_id: effective_id.clone(),
            target: request.target,
            operation: OutboxOperationKind::RespondInvitation,
            recurrence_key: recurrence_key.clone(),
            google_event_id: Some(request.expected_google_event_id.clone()),
            base_etag: Some(request.expected_etag),
            canonical_revision: canonical_revision.clone(),
            auth_generation,
            route_generation,
            payload: Some(payload.clone()),
            finalized: false,
        };
        if enqueue {
            if let Some(existing) = state::get_outbox_operation(&conn, &request.operation_id)? {
                if existing.destination
                    != SyncDestination::google(
                        journal.target.account_id.as_str().to_string(),
                        journal.target.calendar_id.clone(),
                    )
                    || existing.jin_id != journal.event_id
                    || existing.recurrence_key != journal.recurrence_key
                    || existing.google_event_id != journal.google_event_id
                    || existing.operation != OutboxOperationKind::RespondInvitation
                    || existing.payload.as_ref() != Some(&payload)
                {
                    return Err(JinError::OperationConflict {
                        operation_id: request.operation_id,
                        reason: "idempotency_conflict".to_string(),
                    });
                }
            } else {
                self.write_journal(&journal)?;
                self.finalize(journal)?;
            }
        }
        Ok(QueuedInvitationResponse {
            operation_id: request.operation_id,
            event_id: effective_id,
            google_event_id: request.expected_google_event_id,
            recurrence_key,
            response_status,
            canonical_revision,
        })
    }

    fn edit_unrouted_recurrence(
        &self,
        event_id: &str,
        edit_token: &str,
        patch: EditEventPatch,
        scope: Option<RecurrenceMutationScope>,
        _operation_id: &str,
    ) -> crate::Result<crate::ops::events::EditEventOutcome> {
        if scope == Some(RecurrenceMutationScope::ThisAndFollowing) {
            return Err(JinError::InvalidInput(
                "This and following recurrence edits are not supported".to_string(),
            ));
        }
        let requested_path = fs::find_event_path(&self.config.events_dir(), event_id)?;
        let requested_bytes = std::fs::read(&requested_path)?;
        if revision(&requested_bytes) != edit_token {
            return Err(JinError::StaleEvent {
                event_id: event_id.to_string(),
            });
        }
        let requested = fs::parse_event_bytes(&requested_bytes)?;
        if requested.frontmatter.source == EventSource::Jin {
            return Err(JinError::InvalidInput(
                "Local recurring series are read-only until local occurrence projection is available"
                    .to_string(),
            ));
        }
        validate_supported_recurrence_mutation(&requested, scope)?;
        let effective_id = series_event_id(&requested, event_id, scope)?;
        let path = fs::find_event_path(&self.config.events_dir(), &effective_id)?;
        let mut event = fs::read_event(&path)?;
        if effective_id != event_id && scope == Some(RecurrenceMutationScope::EntireSeries) {
            apply_series_patch(&mut event, &requested, patch)?;
        } else {
            apply_patch(&mut event, patch);
        }
        event.frontmatter.updated = Utc::now().fixed_offset();
        event.frontmatter.sequence += 1;
        fs::write_event(&self.config.events_dir(), &event)?;
        self.refresh_index()?;
        Ok(crate::ops::events::EditEventOutcome {
            event,
            no_op: false,
        })
    }

    pub fn recover(&self) -> crate::Result<usize> {
        let dir = self.journal_dir();
        if !dir.exists() {
            return Ok(0);
        }
        let mut recovered = 0;
        for entry in std::fs::read_dir(dir)? {
            let path = entry?.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let mut journal: MutationJournal = serde_json::from_slice(&std::fs::read(&path)?)
                .map_err(|e| JinError::Integrity(format!("parse event mutation journal: {e}")))?;
            if journal.finalized {
                continue;
            }
            let event_path = self
                .config
                .events_dir()
                .join(fs::event_filename(&journal.event_id));
            if !event_path.exists()
                || revision(&std::fs::read(event_path)?) != journal.canonical_revision
            {
                return Err(JinError::OperationBlocked {
                    operation_id: journal.operation_id,
                    reason: "canonical event diverged from unfinished outbox journal".to_string(),
                });
            }
            match crate::google::route_ownership::read(
                &self.config.events_dir(),
                &journal.event_id,
            )? {
                Some(_) => crate::google::route_ownership::validate(
                    &self.config.events_dir(),
                    &journal.event_id,
                    &journal.target,
                )?,
                None => crate::google::route_ownership::write(
                    &self.config.events_dir(),
                    &journal.event_id,
                    &journal.target,
                )?,
            }
            self.finalize(journal.clone())?;
            journal.finalized = true;
            recovered += 1;
        }
        Ok(recovered)
    }

    fn validate_target(
        &self,
        target: &EventSyncTarget,
        require_write: bool,
    ) -> crate::Result<(u64, u64)> {
        let account = self.config.google_registry.account(&target.account_id)?;
        if account.state != GoogleAccountState::Connected {
            return Err(JinError::Auth(
                "Google account is not connected".to_string(),
            ));
        }
        let calendar = self
            .config
            .google_registry
            .calendars
            .iter()
            .find(|calendar| {
                calendar.account_id == target.account_id
                    && calendar.calendar_id == target.calendar_id
            })
            .ok_or_else(|| {
                JinError::Integrity("unknown Google calendar destination".to_string())
            })?;
        if !calendar.enabled || !calendar.available {
            return Err(JinError::InvalidInput(
                "Google calendar destination is disabled or unavailable".to_string(),
            ));
        }
        if require_write && !calendar.access_role.can_write() {
            return Err(JinError::InvalidInput(
                "Google calendar destination is read-only".to_string(),
            ));
        }
        Ok((account.auth_generation, calendar.route_generation))
    }

    fn validate_event_target(&self, event: &Event, target: &EventSyncTarget) -> crate::Result<()> {
        if event.frontmatter.calendar_id != target.calendar_id {
            return Err(JinError::InvalidInput(
                "moving an already-published event between calendars is not supported".to_string(),
            ));
        }
        crate::google::route_ownership::validate(&self.config.events_dir(), event.id(), target)
    }

    fn journal_dir(&self) -> PathBuf {
        self.config.sync_dir().join("mutation-journal")
    }

    fn write_journal(&self, journal: &MutationJournal) -> crate::Result<()> {
        std::fs::create_dir_all(self.journal_dir())?;
        let path = self
            .journal_dir()
            .join(format!("{}.json", journal.operation_id));
        let tmp = path.with_extension("json.tmp");
        std::fs::write(
            &tmp,
            serde_json::to_vec_pretty(journal).map_err(|e| {
                JinError::Integrity(format!("serialize event mutation journal: {e}"))
            })?,
        )?;
        std::fs::rename(tmp, path)?;
        Ok(())
    }

    fn finalize(&self, mut journal: MutationJournal) -> crate::Result<()> {
        let conn = state::open_sync_db(&self.config.sync_dir())?;
        state::enqueue_outbox(
            &conn,
            &OutboxOperation {
                operation_id: journal.operation_id.clone(),
                destination: SyncDestination::google(
                    journal.target.account_id.as_str().to_string(),
                    journal.target.calendar_id.clone(),
                ),
                jin_id: journal.event_id.clone(),
                recurrence_key: journal.recurrence_key.clone(),
                google_event_id: journal.google_event_id.clone(),
                operation: journal.operation.clone(),
                base_etag: journal.base_etag.clone(),
                canonical_revision: journal.canonical_revision.clone(),
                auth_generation: journal.auth_generation,
                route_generation: journal.route_generation,
                payload: journal.payload.clone(),
                state: "pending".to_string(),
                pause_reason: None,
                reviewed: false,
            },
        )?;
        journal.finalized = true;
        self.write_journal(&journal)
    }

    fn refresh_index(&self) -> crate::Result<()> {
        let mut index = crate::index::open(&self.config.index_path())?;
        crate::index::rebuild::rebuild(&mut index, self.root)?;
        Ok(())
    }
}

fn validate_operation_id(operation_id: &str) -> crate::Result<()> {
    if operation_id.is_empty()
        || operation_id.contains('/')
        || operation_id.contains('\\')
        || operation_id == "."
        || operation_id == ".."
    {
        return Err(JinError::InvalidInput("invalid operation id".to_string()));
    }
    Ok(())
}

fn revision(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn recurrence_key(event: &Event, scope: Option<RecurrenceMutationScope>) -> crate::Result<String> {
    let recurring = !event.frontmatter.recurrence.is_empty()
        || event.frontmatter.recurring_event_id.is_some()
        || event.frontmatter.original_start.is_some();
    if !recurring {
        return Ok(MASTER_RECURRENCE_KEY.to_string());
    }
    match scope {
        Some(RecurrenceMutationScope::ThisOccurrence) => event
            .frontmatter
            .original_start
            .as_ref()
            .map(crate::model::event::render_temporal)
            .ok_or_else(|| {
                JinError::InvalidInput(
                    "occurrence edit requires original-start identity".to_string(),
                )
            }),
        Some(RecurrenceMutationScope::EntireSeries) => Ok(MASTER_RECURRENCE_KEY.to_string()),
        Some(RecurrenceMutationScope::ThisAndFollowing) => unreachable!(),
        None => Err(JinError::InvalidInput(
            "recurring event mutation requires an explicit scope".to_string(),
        )),
    }
}

fn series_event_id(
    event: &Event,
    requested_id: &str,
    scope: Option<RecurrenceMutationScope>,
) -> crate::Result<String> {
    if scope != Some(RecurrenceMutationScope::EntireSeries) {
        return Ok(requested_id.to_string());
    }
    if event.frontmatter.recurrence.is_empty()
        && event.frontmatter.recurring_event_id.is_none()
        && event.frontmatter.original_start.is_none()
    {
        return Ok(requested_id.to_string());
    }
    event
        .frontmatter
        .master_id
        .clone()
        .or_else(|| {
            if !event.frontmatter.recurrence.is_empty() {
                Some(requested_id.to_string())
            } else {
                None
            }
        })
        .ok_or_else(|| {
            JinError::Integrity(
                "recurrence occurrence is missing its canonical master identity".to_string(),
            )
        })
}

fn invitation_response_event_id(
    event: &Event,
    requested_id: &str,
    scope: Option<RecurrenceMutationScope>,
) -> crate::Result<String> {
    let is_master = !event.frontmatter.recurrence.is_empty()
        && event.frontmatter.recurring_event_id.is_none()
        && event.frontmatter.original_start.is_none();
    let is_instance = event.frontmatter.recurring_event_id.is_some()
        || event.frontmatter.original_start.is_some();
    match (is_master, is_instance, scope) {
        (false, false, None) => Ok(requested_id.to_string()),
        (false, false, Some(_)) => Err(JinError::InvalidInput(
            "unsupported_recurrence_scope".to_string(),
        )),
        (true, false, Some(RecurrenceMutationScope::EntireSeries)) => Ok(requested_id.to_string()),
        (true, false, _) => Err(JinError::InvalidInput(
            "unsupported_recurrence_scope".to_string(),
        )),
        (false, true, Some(RecurrenceMutationScope::ThisOccurrence)) => {
            Ok(requested_id.to_string())
        }
        (false, true, Some(RecurrenceMutationScope::EntireSeries)) => event
            .frontmatter
            .master_id
            .clone()
            .ok_or_else(|| JinError::InvalidInput("unsupported_recurrence_scope".to_string())),
        _ => Err(JinError::InvalidInput(
            "unsupported_recurrence_scope".to_string(),
        )),
    }
}

fn invitation_response_recurrence_key(
    event: &Event,
    scope: Option<RecurrenceMutationScope>,
) -> crate::Result<String> {
    if scope == Some(RecurrenceMutationScope::ThisOccurrence) {
        let original_start =
            event.frontmatter.original_start.as_ref().ok_or_else(|| {
                JinError::InvalidInput("unsupported_recurrence_scope".to_string())
            })?;
        return Ok(match (&event.frontmatter.start_tzid, original_start) {
            (Some(tzid), crate::model::event::TemporalValue::DateTime(_)) => format!(
                "{}@{}",
                crate::model::event::render_temporal(original_start),
                tzid
            ),
            _ => crate::model::event::render_temporal(original_start),
        });
    }
    Ok(MASTER_RECURRENCE_KEY.to_string())
}

fn event_has_ended(event: &Event, now: chrono::DateTime<Utc>) -> bool {
    match &event.frontmatter.end {
        crate::model::event::TemporalValue::Date(date) => *date <= now.date_naive(),
        crate::model::event::TemporalValue::DateTime(value) => {
            let tzid = event
                .frontmatter
                .end_tzid
                .as_deref()
                .or(event.frontmatter.start_tzid.as_deref())
                .unwrap_or("UTC");
            crate::time::resolve_to_utc(*value, tzid)
                .map(|resolved| resolved.utc() <= now)
                .unwrap_or(true)
        }
    }
}

fn apply_patch(event: &mut Event, patch: EditEventPatch) {
    event.frontmatter.title = patch.title;
    event.frontmatter.start = patch.start;
    event.frontmatter.end = patch.end;
    event.frontmatter.start_value_type = patch.start_value_type;
    event.frontmatter.end_value_type = patch.end_value_type;
    event.frontmatter.is_all_day = patch.is_all_day;
    event.frontmatter.start_tzid = patch.start_tzid;
    event.frontmatter.end_tzid = patch.end_tzid;
    event.frontmatter.floating = patch.floating;
    event.frontmatter.description = patch.description;
    event.frontmatter.location = patch.location;
    apply_meeting_patch(
        event,
        patch.attendees,
        patch.attendees_omitted,
        patch.conference_data,
        patch.clear_conference_data,
        patch.reminders,
    );
}

fn apply_meeting_patch(
    event: &mut Event,
    attendees: Option<Vec<crate::model::event::EventAttendee>>,
    attendees_omitted: Option<bool>,
    conference_data: Option<crate::model::event::EventConferenceData>,
    clear_conference_data: bool,
    reminders: Option<crate::model::event::EventReminderSettings>,
) {
    if let Some(attendees) = attendees {
        event.frontmatter.attendees = Some(attendees);
    }
    if let Some(attendees_omitted) = attendees_omitted {
        event.frontmatter.attendees_omitted = Some(attendees_omitted);
    }
    if clear_conference_data {
        event.frontmatter.conference_data = None;
    } else if let Some(conference_data) = conference_data {
        event.frontmatter.conference_data = Some(conference_data);
    }
    if let Some(reminders) = reminders {
        event.frontmatter.reminders = Some(reminders);
    }
}

fn apply_series_patch(
    master: &mut Event,
    occurrence: &Event,
    patch: EditEventPatch,
) -> crate::Result<()> {
    if patch.title != occurrence.frontmatter.title {
        master.frontmatter.title = patch.title;
    }
    if patch.description != occurrence.frontmatter.description {
        master.frontmatter.description = patch.description;
    }
    if patch.location != occurrence.frontmatter.location {
        master.frontmatter.location = patch.location;
    }
    if crate::model::event::render_temporal(&patch.start)
        != crate::model::event::render_temporal(&occurrence.frontmatter.start)
    {
        master.frontmatter.start = shift_temporal(
            &master.frontmatter.start,
            &occurrence.frontmatter.start,
            &patch.start,
        )?;
    }
    if crate::model::event::render_temporal(&patch.end)
        != crate::model::event::render_temporal(&occurrence.frontmatter.end)
    {
        master.frontmatter.end = shift_temporal(
            &master.frontmatter.end,
            &occurrence.frontmatter.end,
            &patch.end,
        )?;
    }
    if patch.is_all_day != occurrence.frontmatter.is_all_day {
        master.frontmatter.is_all_day = patch.is_all_day;
        master.frontmatter.start_value_type = patch.start_value_type;
        master.frontmatter.end_value_type = patch.end_value_type;
    }
    if patch.start_tzid != occurrence.frontmatter.start_tzid {
        master.frontmatter.start_tzid = patch.start_tzid;
    }
    if patch.end_tzid != occurrence.frontmatter.end_tzid {
        master.frontmatter.end_tzid = patch.end_tzid;
    }
    if patch.floating != occurrence.frontmatter.floating {
        master.frontmatter.floating = patch.floating;
    }
    apply_meeting_patch(
        master,
        patch.attendees,
        patch.attendees_omitted,
        patch.conference_data,
        patch.clear_conference_data,
        patch.reminders,
    );
    Ok(())
}

fn validate_attendee_patch(event: &Event, patch: &EditEventPatch) -> crate::Result<()> {
    let Some(attendees) = patch.attendees.as_ref() else {
        return Ok(());
    };
    if patch.attendees_omitted == Some(true) && event.frontmatter.attendees_omitted != Some(true) {
        return Err(JinError::Validation {
            field: "attendees_omitted".to_string(),
            reason: "limited attendee mode requires a provider-truncated canonical attendee list"
                .to_string(),
        });
    }
    let limited = event.frontmatter.attendees_omitted == Some(true);
    if !limited {
        return Ok(());
    }
    let Some(canonical_attendees) = event.frontmatter.attendees.as_ref() else {
        return Err(JinError::Validation {
            field: "attendees".to_string(),
            reason: "limited attendee mode requires one canonical self attendee".to_string(),
        });
    };
    if canonical_attendees.len() != 1
        || canonical_attendees[0].is_self != Some(true)
        || attendees.len() != 1
        || attendees[0].is_self != Some(true)
    {
        return Err(JinError::Validation {
            field: "attendees".to_string(),
            reason: "limited attendee mode requires the canonical and patched lists to contain exactly one self attendee"
                .to_string(),
        });
    }
    if !same_attendee_identity_and_non_response_fields(&canonical_attendees[0], &attendees[0]) {
        return Err(JinError::Validation {
            field: "attendees".to_string(),
            reason: "limited attendee mode may change only response_status and comment".to_string(),
        });
    }
    Ok(())
}

fn same_attendee_identity_and_non_response_fields(
    canonical: &crate::model::event::EventAttendee,
    patched: &crate::model::event::EventAttendee,
) -> bool {
    canonical.id == patched.id
        && canonical.email == patched.email
        && canonical.display_name == patched.display_name
        && canonical.organizer == patched.organizer
        && canonical.is_self == patched.is_self
        && canonical.resource == patched.resource
        && canonical.optional == patched.optional
        && canonical.additional_guests == patched.additional_guests
        && canonical.extra == patched.extra
}

fn shift_temporal(
    master: &crate::model::event::TemporalValue,
    occurrence: &crate::model::event::TemporalValue,
    edited: &crate::model::event::TemporalValue,
) -> crate::Result<crate::model::event::TemporalValue> {
    use crate::model::event::TemporalValue;
    match (master, occurrence, edited) {
        (TemporalValue::Date(master), TemporalValue::Date(before), TemporalValue::Date(after)) => {
            Ok(TemporalValue::Date(*master + (*after - *before)))
        }
        (
            TemporalValue::DateTime(master),
            TemporalValue::DateTime(before),
            TemporalValue::DateTime(after),
        ) => Ok(TemporalValue::DateTime(*master + (*after - *before))),
        _ => Err(JinError::InvalidInput(
            "series time edit must preserve date value type".to_string(),
        )),
    }
}

fn validate_supported_recurrence_mutation(
    event: &Event,
    scope: Option<RecurrenceMutationScope>,
) -> crate::Result<()> {
    if event.frontmatter.recurrence.is_empty()
        && event.frontmatter.recurring_event_id.is_none()
        && event.frontmatter.original_start.is_none()
    {
        return crate::ops::events::ensure_mutable(event);
    }
    if !crate::recurrence::is_supported(&event.frontmatter.recurrence)
        && event.frontmatter.master_id.is_none()
    {
        return Err(JinError::InvalidInput(
            "this imported recurrence pattern is preserved but cannot be edited".to_string(),
        ));
    }
    if scope.is_none() {
        return Err(JinError::InvalidInput(
            "recurring event mutation requires an explicit scope".to_string(),
        ));
    }
    Ok(())
}

fn sparse_patch(before: &Event, event: &Event) -> serde_json::Value {
    let old = crate::google::mapping::jin_to_google(&before.frontmatter);
    let full = crate::google::mapping::jin_to_google(&event.frontmatter);
    let mut patch = serde_json::Map::new();
    for key in [
        "summary",
        "description",
        "location",
        "start",
        "end",
        "recurrence",
        "attendees",
        "conferenceData",
        "reminders",
    ] {
        if full.get(key) != old.get(key) {
            patch.insert(
                key.to_string(),
                full.get(key).cloned().unwrap_or(serde_json::Value::Null),
            );
        }
    }
    if patch.contains_key("attendees") && event.frontmatter.attendees_omitted == Some(true) {
        patch.insert(
            "attendeesOmitted".to_string(),
            serde_json::Value::Bool(true),
        );
    }
    serde_json::Value::Object(patch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::event::{
        EventAttendee, EventConferenceData, EventFrontmatter, EventReminderSettings, TemporalValue,
        ValueType,
    };
    use chrono::NaiveDate;

    fn event(id: &str, title: &str, start: &str, end: &str) -> Event {
        let created = chrono::DateTime::parse_from_rfc3339("2026-01-01T09:00:00-03:00").unwrap();
        Event {
            frontmatter: EventFrontmatter {
                id: id.to_string(),
                kind: "event".to_string(),
                title: title.to_string(),
                description: None,
                location: None,
                start: TemporalValue::Date(NaiveDate::parse_from_str(start, "%Y-%m-%d").unwrap()),
                end: TemporalValue::Date(NaiveDate::parse_from_str(end, "%Y-%m-%d").unwrap()),
                start_value_type: ValueType::Date,
                end_value_type: ValueType::Date,
                is_all_day: true,
                start_tzid: None,
                end_tzid: None,
                floating: false,
                recurrence: vec!["RRULE:FREQ=WEEKLY".to_string()],
                recurring_event_id: None,
                original_start: None,
                master_id: None,
                recurrence_unexpanded: true,
                ical_uid: Some(format!("{id}@jin")),
                sequence: 0,
                status: EventStatus::Confirmed,
                created,
                updated: created,
                transparency: None,
                visibility: None,
                organizer: None,
                attendees: None,
                attendees_omitted: None,
                conference_data: None,
                hangout_link: None,
                reminders: None,
                source: EventSource::Google,
                authority: EventSource::Google,
                calendar_id: "primary".to_string(),
                derived_from: None,
            },
            body: String::new(),
        }
    }

    fn patch_for(event: &Event) -> EditEventPatch {
        EditEventPatch {
            title: event.frontmatter.title.clone(),
            start: event.frontmatter.start.clone(),
            end: event.frontmatter.end.clone(),
            start_value_type: event.frontmatter.start_value_type.clone(),
            end_value_type: event.frontmatter.end_value_type.clone(),
            is_all_day: event.frontmatter.is_all_day,
            start_tzid: event.frontmatter.start_tzid.clone(),
            end_tzid: event.frontmatter.end_tzid.clone(),
            floating: event.frontmatter.floating,
            description: event.frontmatter.description.clone(),
            location: event.frontmatter.location.clone(),
            attendees: None,
            attendees_omitted: None,
            conference_data: None,
            clear_conference_data: false,
            reminders: None,
        }
    }

    #[test]
    fn entire_series_patch_uses_master_baseline_instead_of_occurrence_date() {
        let mut master = event("master", "Standup", "2026-08-03", "2026-08-04");
        let occurrence = event("instance", "Standup", "2026-08-31", "2026-09-01");
        let mut edited = occurrence.clone();
        edited.frontmatter.title = "Team standup".to_string();

        apply_series_patch(
            &mut master,
            &occurrence,
            EditEventPatch {
                title: edited.frontmatter.title,
                start: edited.frontmatter.start,
                end: edited.frontmatter.end,
                start_value_type: ValueType::Date,
                end_value_type: ValueType::Date,
                is_all_day: true,
                start_tzid: None,
                end_tzid: None,
                floating: false,
                description: None,
                location: None,
                attendees: None,
                attendees_omitted: None,
                conference_data: None,
                clear_conference_data: false,
                reminders: None,
            },
        )
        .unwrap();

        assert_eq!(
            crate::model::event::render_temporal(&master.frontmatter.start),
            "2026-08-03"
        );
        assert_eq!(master.frontmatter.title, "Team standup");
    }

    #[test]
    fn sparse_google_patch_only_contains_changed_fields() {
        let before = event("master", "Standup", "2026-08-03", "2026-08-04");
        let mut after = before.clone();
        after.frontmatter.title = "Team standup".to_string();
        let patch = sparse_patch(&before, &after);
        assert_eq!(patch, serde_json::json!({ "summary": "Team standup" }));
    }

    #[test]
    fn sparse_google_patch_clears_removed_optional_fields() {
        let mut before = event("master", "Standup", "2026-08-03", "2026-08-04");
        before.frontmatter.description = Some("Old description".to_string());
        before.frontmatter.location = Some("Old room".to_string());
        let mut after = before.clone();
        after.frontmatter.description = None;
        after.frontmatter.location = None;
        let patch = sparse_patch(&before, &after);
        assert_eq!(
            patch,
            serde_json::json!({ "description": null, "location": null })
        );
    }

    #[test]
    fn sparse_google_patch_projects_meeting_fields_into_the_outbox_shape() {
        let before = event("master", "Standup", "2026-08-03", "2026-08-04");
        let mut after = before.clone();
        after.frontmatter.attendees = Some(vec![serde_json::from_value::<EventAttendee>(
            serde_json::json!({
                "email": "guest@example.com",
                "responseStatus": "needsAction"
            }),
        )
        .unwrap()]);
        after.frontmatter.conference_data = Some(
            serde_json::from_value::<EventConferenceData>(serde_json::json!({
                "pendingCreateRequest": {
                    "requestId": "jin-fresh-request-02",
                    "conferenceSolutionKey": { "type": "hangoutsMeet" }
                }
            }))
            .unwrap(),
        );
        after.frontmatter.reminders = Some(
            serde_json::from_value::<EventReminderSettings>(serde_json::json!({
                "useDefault": false,
                "overrides": [{ "method": "popup", "minutes": 15 }]
            }))
            .unwrap(),
        );

        let patch = sparse_patch(&before, &after);
        assert_eq!(patch["attendees"][0]["email"], "guest@example.com");
        assert_eq!(
            patch["conferenceData"]["createRequest"]["requestId"],
            "jin-fresh-request-02"
        );
        assert!(patch["conferenceData"]["createRequest"]
            .get("status")
            .is_none());
        assert_eq!(patch["reminders"]["overrides"][0]["minutes"], 15);
    }

    #[test]
    fn truncated_attendee_rsvp_patch_retains_attendees_omitted() {
        let mut before = event("master", "Standup", "2026-08-03", "2026-08-04");
        let mut self_attendee = serde_json::from_value::<EventAttendee>(serde_json::json!({
            "email": "me@example.com",
            "self": true,
            "responseStatus": "needsAction"
        }))
        .unwrap();
        before.frontmatter.attendees = Some(vec![self_attendee.clone()]);
        before.frontmatter.attendees_omitted = Some(true);
        self_attendee.response_status = Some("accepted".to_string());

        let mut edit = patch_for(&before);
        edit.attendees = Some(vec![self_attendee]);
        crate::ops::events::validate_meeting_patch(&edit).unwrap();
        validate_attendee_patch(&before, &edit).unwrap();

        let mut after = before.clone();
        apply_patch(&mut after, edit);
        let patch = sparse_patch(&before, &after);
        assert_eq!(patch["attendeesOmitted"], true);
        assert_eq!(patch["attendees"][0]["responseStatus"], "accepted");
    }

    #[test]
    fn limited_attendee_mode_rejects_unsafe_shapes() {
        let mut before = event("master", "Standup", "2026-08-03", "2026-08-04");
        let self_attendee = serde_json::from_value::<EventAttendee>(serde_json::json!({
            "id": "self-profile",
            "email": "me@example.com",
            "displayName": "Me",
            "self": true,
            "resource": false,
            "optional": false,
            "additionalGuests": 0,
            "responseStatus": "needsAction",
            "comment": "old comment",
            "futureAttendeeField": "canonical-only"
        }))
        .unwrap();
        let mut unsupported_limited = patch_for(&before);
        unsupported_limited.attendees = Some(vec![self_attendee.clone()]);
        unsupported_limited.attendees_omitted = Some(true);
        assert!(validate_attendee_patch(&before, &unsupported_limited).is_err());

        before.frontmatter.attendees_omitted = Some(true);
        before.frontmatter.attendees = Some(vec![self_attendee.clone()]);
        let mut edit = patch_for(&before);
        let mut allowed = self_attendee.clone();
        allowed.response_status = Some("accepted".to_string());
        allowed.comment = Some("new comment".to_string());
        edit.attendees = Some(vec![allowed]);
        validate_attendee_patch(&before, &edit).unwrap();

        let mut forbidden_variants = Vec::new();
        let mut changed = self_attendee.clone();
        changed.email = Some("other@example.com".to_string());
        forbidden_variants.push(changed);
        let mut changed = self_attendee.clone();
        changed.display_name = Some("Someone else".to_string());
        forbidden_variants.push(changed);
        let mut changed = self_attendee.clone();
        changed.resource = Some(true);
        forbidden_variants.push(changed);
        let mut changed = self_attendee.clone();
        changed.optional = Some(true);
        forbidden_variants.push(changed);
        let mut changed = self_attendee.clone();
        changed.additional_guests = Some(1);
        forbidden_variants.push(changed);
        let mut changed = self_attendee.clone();
        changed.extra.insert(
            "futureAttendeeField".to_string(),
            serde_json::json!("changed"),
        );
        forbidden_variants.push(changed);
        for changed in forbidden_variants {
            let mut unsafe_edit = patch_for(&before);
            unsafe_edit.attendees = Some(vec![changed]);
            assert!(validate_attendee_patch(&before, &unsafe_edit).is_err());
        }

        let mut missing_canonical_self = before.clone();
        missing_canonical_self.frontmatter.attendees = None;
        assert!(validate_attendee_patch(&missing_canonical_self, &edit).is_err());

        edit.attendees_omitted = Some(false);
        assert!(crate::ops::events::validate_meeting_patch(&edit).is_err());
    }
}
