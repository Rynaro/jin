mod exit_code;
mod output;

use std::path::PathBuf;
use std::process;

use anyhow::Context;
use clap::{Parser, Subcommand};
use jin_core::dto::Envelope;
use jin_core::ops::api;
use jin_core::{Config, JinError};

use exit_code::ExitCode;

// ──────────────────────────────────────────────────────────────
// CLI grammar (S3)
// ──────────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(name = "jin", about = "Sovereign notes + tasks + calendar", version)]
struct Cli {
    /// Emit machine-readable JSON (versioned DTO envelope).
    #[arg(long, global = true)]
    json: bool,

    /// Override the jin root directory (default: current directory).
    #[arg(long, global = true)]
    root: Option<PathBuf>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize a new jin root.
    Init {
        /// Target directory (defaults to current dir).
        #[arg(long)]
        root: Option<PathBuf>,
    },

    /// Manage notes.
    Note {
        #[command(subcommand)]
        action: NoteAction,
    },

    /// Manage tasks.
    Task {
        #[command(subcommand)]
        action: TaskAction,
    },

    /// Manage events.
    Event {
        #[command(subcommand)]
        action: EventAction,
    },

    /// Create a typed edge between two objects.
    Link {
        source: String,
        target: String,
        #[arg(long = "type")]
        edge_type: String,
    },

    /// Attach a note to a target (sugar for link with default edge type).
    Attach {
        note: String,
        target: String,
        #[arg(long)]
        kind: Option<String>,
    },

    /// Promote a task to an event.
    Promote {
        task: String,
        /// When to schedule the event: ISO 8601 datetime, e.g. 2026-07-01T14:00:00
        #[arg(long)]
        when: String,
        /// IANA timezone, e.g. America/New_York. Omit for floating (wall-time only).
        #[arg(long)]
        tz: Option<String>,
        /// Immutable Google account id for an explicit publication route.
        #[arg(long, requires = "calendar_id")]
        account_id: Option<String>,
        /// Immutable Google calendar id for an explicit publication route.
        #[arg(long, requires = "account_id")]
        calendar_id: Option<String>,
        /// Keep the promoted event only in Jin even when Google routes exist.
        #[arg(long, conflicts_with_all = ["account_id", "calendar_id"])]
        jin_only: bool,
    },

    /// Show today's agenda (or a specific date with --date).
    Today {
        /// Show the agenda for this date (YYYY-MM-DD).
        /// Defaults to today in the display_tz configured in .jin/config.toml.
        #[arg(long)]
        date: Option<String>,
    },

    /// Sync with Google Calendar (stub — M2).
    Sync,

    /// Export canonical files to a destination directory.
    Export {
        dest: PathBuf,
        /// Overwrite an existing non-empty destination.
        /// By default, jin refuses to export into a non-empty directory.
        #[arg(long)]
        force: bool,
    },

    /// Verify and import a portable Jin export, then rebuild its derived index.
    Import {
        source: PathBuf,
        dest: PathBuf,
        /// Replace only existing Jin-owned canonical paths in destination.
        #[arg(long)]
        force: bool,
    },

    /// Manage vault-managed content-addressed attachment assets.
    Asset {
        #[command(subcommand)]
        action: AssetAction,
    },

    /// Manage portable declarative Notes Collections.
    Collection {
        #[command(subcommand)]
        action: CollectionAction,
    },

    /// Quick-add a note or task.
    Capture {
        text: String,
        #[arg(long)]
        task: bool,
        #[arg(long)]
        list: Option<String>,
    },

    /// Diagnostic: list dangling edges and index health.
    Doctor,

    /// Manage Google Calendar authentication.
    Auth {
        #[command(subcommand)]
        action: AuthAction,
    },

    /// Manage the multi-account Google Calendar registry.
    Google {
        #[command(subcommand)]
        action: GoogleAction,
    },
}

#[derive(Subcommand)]
enum NoteAction {
    Add {
        /// Title as positional shorthand: jin note add "My Note"
        #[arg(value_name = "TITLE", conflicts_with = "title")]
        title_pos: Option<String>,
        /// Title as named flag: --title "My Note"
        #[arg(long, conflicts_with = "title_pos")]
        title: Option<String>,
        #[arg(long, default_value = "")]
        body: String,
    },
    Edit {
        id: String,
        /// New title.
        #[arg(long)]
        title: Option<String>,
        /// Replace the note body.
        #[arg(long)]
        body: Option<String>,
        /// Add a tag (repeatable: --add-tag foo --add-tag bar).
        #[arg(long = "add-tag")]
        add_tag: Vec<String>,
        /// Remove a tag (repeatable).
        #[arg(long = "rm-tag")]
        rm_tag: Vec<String>,
        /// Full replacement strict property map as JSON (no executable syntax).
        #[arg(long)]
        properties_json: Option<String>,
        /// Refuse the edit if the Note revision has advanced.
        #[arg(long)]
        expected_revision: Option<u64>,
    },
    List {
        /// Filter by tag.
        #[arg(long)]
        tag: Option<String>,
    },
    Show {
        id: String,
    },
    Rm {
        id: String,
    },
    /// Search derived note body/property/link-label text as a literal phrase.
    Search {
        query: String,
    },
    /// Restore an immutable note snapshot as a new revision.
    Restore {
        id: String,
        revision: u64,
        #[arg(long)]
        expected_revision: Option<u64>,
    },
    /// List immutable recovery snapshots available for a Note.
    Revisions {
        id: String,
    },
}

#[derive(Subcommand)]
enum AssetAction {
    /// Copy a regular local file into the vault's content-addressed store.
    Add {
        source: PathBuf,
    },
    List,
    /// Repair missing manifest entries without deleting suspicious files.
    Repair,
}

#[derive(Subcommand)]
enum CollectionAction {
    List,
    /// Create from a versioned declarative query JSON document.
    Add {
        name: String,
        #[arg(
            long,
            default_value = "{\"version\":1,\"filter\":{\"op\":\"all\",\"clauses\":[]},\"sort\":[{\"field\":\"updated\",\"direction\":\"desc\"}]}"
        )]
        query_json: String,
    },
    /// Evaluate a portable collection against canonical notes.
    Run {
        id: String,
    },
}

#[derive(Subcommand)]
enum TaskAction {
    Add {
        /// Title as positional shorthand: jin task add "My Task"
        #[arg(value_name = "TITLE", conflicts_with = "title")]
        title_pos: Option<String>,
        /// Title as named flag: --title "My Task"
        #[arg(long, conflicts_with = "title_pos")]
        title: Option<String>,
        #[arg(long)]
        list: Option<String>,
        /// Priority: none | low | medium | high.
        #[arg(long)]
        priority: Option<String>,
        /// Due date: YYYY-MM-DD or RFC 3339 datetime with offset.
        #[arg(long)]
        due: Option<String>,
        /// S6: id of the parent task, if this is a subtask.
        #[arg(long)]
        parent: Option<String>,
    },
    Edit {
        id: String,
        /// New title.
        #[arg(long)]
        title: Option<String>,
        /// Priority: none | low | medium | high.
        #[arg(long)]
        priority: Option<String>,
        /// Due date: YYYY-MM-DD or RFC 3339 datetime with offset.
        #[arg(long)]
        due: Option<String>,
        /// Clear the due date.
        #[arg(long)]
        clear_due: bool,
        /// Move to a different list.
        #[arg(long)]
        list: Option<String>,
        /// S6: reassign the parent (id of the new parent task).
        #[arg(long, conflicts_with = "clear_parent")]
        parent: Option<String>,
        /// S6: detach from the parent (set parent = None).
        #[arg(long)]
        clear_parent: bool,
    },
    List {
        /// Filter by list name.
        #[arg(long)]
        list: Option<String>,
        /// Filter by status: todo | doing | done | cancelled.
        #[arg(long)]
        status: Option<String>,
        /// Filter by priority: none | low | medium | high.
        #[arg(long)]
        priority: Option<String>,
    },
    Show {
        id: String,
    },
    Rm {
        id: String,
    },
    /// Mark a task as done (todo|doing → done).
    Done {
        id: String,
    },
    /// Start a task (todo → doing).
    Start {
        id: String,
    },
    /// Cancel a task (todo|doing → cancelled).
    Cancel {
        id: String,
    },
    /// Reopen a task (done|cancelled → todo, clears completed_at).
    Reopen {
        id: String,
    },
}

#[derive(Subcommand)]
enum EventAction {
    Add {
        /// Title as positional shorthand: jin event add "My Event"
        #[arg(value_name = "TITLE", conflicts_with = "title")]
        title_pos: Option<String>,
        /// Title as named flag: --title "My Event"
        #[arg(long, conflicts_with = "title_pos")]
        title: Option<String>,
        /// Start: ISO 8601 datetime (2026-07-01T14:00:00) or date for --all-day (2026-07-01)
        #[arg(long)]
        start: String,
        /// End: ISO 8601 datetime or date for --all-day
        #[arg(long)]
        end: String,
        /// IANA timezone, e.g. America/New_York. Omit for floating (wall-time only).
        #[arg(long)]
        tz: Option<String>,
        /// All-day event: --start and --end expect YYYY-MM-DD dates.
        #[arg(long)]
        all_day: bool,
        /// Immutable Google account id for an explicit publication route.
        #[arg(long, requires = "calendar_id")]
        account_id: Option<String>,
        /// Immutable Google calendar id for an explicit publication route.
        #[arg(long, requires = "account_id")]
        calendar_id: Option<String>,
    },
    List,
    Show {
        id: String,
    },
    Rm {
        id: String,
    },
}

/// S6.1 auth sub-commands.
#[derive(Subcommand)]
enum AuthAction {
    /// Run the OAuth onboarding wizard and store tokens.
    Login,
    /// Show authentication status, token validity, and storage backend.
    Status,
    /// Delete stored tokens (does not revoke the token at Google).
    Logout,
}

#[derive(Subcommand)]
enum GoogleAction {
    /// List account aliases and discovered calendars.
    List,
    /// Add a pending account identity with a renameable alias.
    Add { alias: String },
    /// Authenticate or reauthenticate one immutable account id.
    Login { account_id: String },
    /// Rename an account alias without changing provider identity.
    Rename { account_id: String, alias: String },
    /// Disconnect one account and quarantine only its pending writes.
    Disconnect { account_id: String },
    /// Discover or update calendars visible to one connected account.
    Refresh { account_id: String },
    /// Enable or disable one exact calendar route.
    Calendar {
        account_id: String,
        calendar_id: String,
        #[arg(long, conflicts_with = "disable")]
        enable: bool,
        #[arg(long, conflicts_with = "enable")]
        disable: bool,
    },
}

// ──────────────────────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────────────────────

fn main() {
    let cli = Cli::parse();
    let code = run(cli);
    process::exit(code);
}

fn run(cli: Cli) -> i32 {
    let json = cli.json;
    match dispatch(cli) {
        Ok(()) => ExitCode::Ok as i32,
        Err(err) => {
            // M2: emit versioned error envelope in --json mode; eprintln in human mode.
            let code = if let Some(jin_err) = err.downcast_ref::<JinError>() {
                ExitCode::from_jin_error(jin_err)
            } else {
                ExitCode::Other
            };
            if json {
                let env = Envelope::error(&format!("{}", code as i32), &err.to_string());
                output::print_json(&env);
            } else {
                eprintln!("error: {:#}", err);
            }
            code as i32
        }
    }
}

fn dispatch(cli: Cli) -> anyhow::Result<()> {
    let json = cli.json;
    let root_override = cli.root.clone();

    match cli.command {
        Commands::Init { root } => {
            let root = root
                .or(root_override)
                .unwrap_or_else(|| std::env::current_dir().expect("cwd"));
            cmd_init(&root, json)?;
        }

        Commands::Note { action } => {
            let root = resolve_root(root_override)?;
            match action {
                NoteAction::Add {
                    title_pos,
                    title,
                    body,
                } => {
                    let title = resolve_title(title, title_pos)?;
                    cmd_note_add(&root, title, body, json)?;
                }
                NoteAction::Edit {
                    id,
                    title,
                    body,
                    add_tag,
                    rm_tag,
                    properties_json,
                    expected_revision,
                } => {
                    cmd_note_edit(
                        &root,
                        NoteEditArgs {
                            id,
                            title,
                            body,
                            add_tags: add_tag,
                            rm_tags: rm_tag,
                            properties_json,
                            expected_revision,
                        },
                        json,
                    )?;
                }
                NoteAction::List { tag } => {
                    cmd_note_list(&root, tag.as_deref(), json)?;
                }
                NoteAction::Show { id } => {
                    cmd_note_show(&root, &id, json)?;
                }
                NoteAction::Rm { id } => {
                    cmd_note_rm(&root, &id, json)?;
                }
                NoteAction::Search { query } => {
                    cmd_note_search(&root, &query, json)?;
                }
                NoteAction::Restore {
                    id,
                    revision,
                    expected_revision,
                } => {
                    cmd_note_restore(&root, &id, revision, expected_revision, json)?;
                }
                NoteAction::Revisions { id } => {
                    cmd_note_revisions(&root, &id, json)?;
                }
            }
        }

        Commands::Task { action } => {
            let root = resolve_root(root_override)?;
            match action {
                TaskAction::Add {
                    title_pos,
                    title,
                    list,
                    priority,
                    due,
                    parent,
                } => {
                    let title = resolve_title(title, title_pos)?;
                    cmd_task_add(&root, title, list, priority, due, parent, json)?;
                }
                TaskAction::Edit {
                    id,
                    title,
                    priority,
                    due,
                    clear_due,
                    list,
                    parent,
                    clear_parent,
                } => {
                    cmd_task_edit(
                        &root,
                        &id,
                        title,
                        priority,
                        due,
                        clear_due,
                        list,
                        parent,
                        clear_parent,
                        json,
                    )?;
                }
                TaskAction::List {
                    list,
                    status,
                    priority,
                } => {
                    cmd_task_list(
                        &root,
                        list.as_deref(),
                        status.as_deref(),
                        priority.as_deref(),
                        json,
                    )?;
                }
                TaskAction::Show { id } => {
                    cmd_task_show(&root, &id, json)?;
                }
                TaskAction::Rm { id } => {
                    cmd_task_rm(&root, &id, json)?;
                }
                TaskAction::Done { id } => {
                    cmd_task_done(&root, &id, json)?;
                }
                TaskAction::Start { id } => {
                    cmd_task_transition(&root, &id, jin_core::model::TaskStatus::Doing, json)?;
                }
                TaskAction::Cancel { id } => {
                    cmd_task_transition(&root, &id, jin_core::model::TaskStatus::Cancelled, json)?;
                }
                TaskAction::Reopen { id } => {
                    cmd_task_transition(&root, &id, jin_core::model::TaskStatus::Todo, json)?;
                }
            }
        }

        Commands::Event { action } => {
            let root = resolve_root(root_override)?;
            match action {
                EventAction::Add {
                    title_pos,
                    title,
                    start,
                    end,
                    tz,
                    all_day,
                    account_id,
                    calendar_id,
                } => {
                    let title = resolve_title(title, title_pos)?;
                    cmd_event_add(
                        &root,
                        title,
                        start,
                        end,
                        tz,
                        all_day,
                        account_id,
                        calendar_id,
                        json,
                    )?;
                }
                EventAction::List => {
                    cmd_event_list(&root, json)?;
                }
                EventAction::Show { id } => {
                    cmd_event_show(&root, &id, json)?;
                }
                EventAction::Rm { id } => {
                    cmd_event_rm(&root, &id, json)?;
                }
            }
        }

        Commands::Link {
            source,
            target,
            edge_type,
        } => {
            let root = resolve_root(root_override)?;
            cmd_link(&root, &source, &target, &edge_type, json)?;
        }

        Commands::Attach { note, target, kind } => {
            let root = resolve_root(root_override)?;
            cmd_attach(&root, &note, &target, kind.as_deref(), json)?;
        }

        Commands::Promote {
            task,
            when,
            tz,
            account_id,
            calendar_id,
            jin_only,
        } => {
            let root = resolve_root(root_override)?;
            cmd_promote(
                &root,
                &task,
                &when,
                tz,
                account_id,
                calendar_id,
                jin_only,
                json,
            )?;
        }

        Commands::Today { date } => {
            let root = resolve_root(root_override)?;
            cmd_today(&root, date, json)?;
        }

        Commands::Sync => {
            let root = resolve_root(root_override)?;
            cmd_sync(&root, json)?;
        }

        Commands::Export { dest, force } => {
            let root = resolve_root(root_override)?;
            cmd_export(&root, &dest, force, json)?;
        }

        Commands::Import {
            source,
            dest,
            force,
        } => {
            cmd_import(&source, &dest, force, json)?;
        }

        Commands::Asset { action } => {
            let root = resolve_root(root_override)?;
            match action {
                AssetAction::Add { source } => cmd_asset_add(&root, &source, json)?,
                AssetAction::List => cmd_asset_list(&root, json)?,
                AssetAction::Repair => cmd_asset_repair(&root, json)?,
            }
        }

        Commands::Collection { action } => {
            let root = resolve_root(root_override)?;
            match action {
                CollectionAction::List => cmd_collection_list(&root, json)?,
                CollectionAction::Add { name, query_json } => {
                    cmd_collection_add(&root, name, &query_json, json)?
                }
                CollectionAction::Run { id } => cmd_collection_run(&root, &id, json)?,
            }
        }

        Commands::Capture { text, task, list } => {
            let root = resolve_root(root_override)?;
            cmd_capture(&root, text, task, list, json)?;
        }

        Commands::Doctor => {
            let root = resolve_root(root_override)?;
            cmd_doctor(&root, json)?;
        }

        Commands::Auth { action } => match action {
            AuthAction::Login => {
                let root = resolve_root(root_override)?;
                cmd_auth_login(&root, json)?;
            }
            AuthAction::Status => {
                let root = resolve_root(root_override)?;
                cmd_auth_status(&root, json)?;
            }
            AuthAction::Logout => {
                let root = resolve_root(root_override)?;
                cmd_auth_logout(&root, json)?;
            }
        },
        Commands::Google { action } => {
            let root = resolve_root(root_override)?;
            cmd_google(&root, action, json)?;
        }
    }

    Ok(())
}

fn cmd_google(root: &std::path::Path, action: GoogleAction, json: bool) -> anyhow::Result<()> {
    use jin_core::google::account::GoogleAccountId;
    use jin_core::ops::google_accounts;

    match action {
        GoogleAction::Add { alias } => {
            google_accounts::add_account(root, &alias)?;
        }
        GoogleAction::Login { account_id } => {
            google_accounts::login_account(root, &GoogleAccountId::parse(account_id)?)?;
        }
        GoogleAction::Rename { account_id, alias } => {
            google_accounts::rename_account(root, &GoogleAccountId::parse(account_id)?, &alias)?;
        }
        GoogleAction::Disconnect { account_id } => {
            google_accounts::disconnect_account(root, &GoogleAccountId::parse(account_id)?)?;
        }
        GoogleAction::Refresh { account_id } => {
            let account_id = GoogleAccountId::parse(account_id)?;
            let config = Config::load(root)?;
            let tokens =
                jin_core::google::secrets::load_tokens_for_account(root, &config, &account_id)?;
            google_accounts::refresh_calendars(
                root,
                &account_id,
                &tokens.access_token,
                &jin_core::google::client::ReqwestClient,
            )?;
        }
        GoogleAction::Calendar {
            account_id,
            calendar_id,
            enable,
            disable,
        } => {
            if enable == disable {
                anyhow::bail!("choose exactly one of --enable or --disable");
            }
            google_accounts::set_calendar_enabled(
                root,
                &GoogleAccountId::parse(account_id)?,
                &calendar_id,
                enable,
            )?;
        }
        GoogleAction::List => {}
    }

    let config = Config::load(root)?;
    let accounts = jin_core::dto::GoogleAccountDto::list(&config.google_registry);
    if json {
        output::print_json(&Envelope::ok(
            "google_accounts",
            serde_json::to_value(&accounts)?,
        ));
    } else if accounts.is_empty() {
        println!("No Google accounts configured.");
    } else {
        for account in accounts {
            println!("{}  {}  {}", account.id, account.alias, account.state);
            for calendar in account.calendars {
                println!(
                    "  {}  {}  {}  {}",
                    if calendar.enabled { "on " } else { "off" },
                    calendar.access_role,
                    calendar.calendar_id,
                    calendar.name
                );
            }
        }
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

fn resolve_root(override_root: Option<PathBuf>) -> anyhow::Result<PathBuf> {
    Ok(override_root.unwrap_or_else(|| std::env::current_dir().expect("cwd")))
}

/// Resolve positional and named title flags into a required `String`.
/// clap handles the "both provided" case (conflicts_with). We handle "neither provided".
fn resolve_title(flag: Option<String>, pos: Option<String>) -> anyhow::Result<String> {
    flag.or(pos).ok_or_else(|| {
        anyhow::anyhow!(
            "a title is required: use positional 'jin <cmd> add \"Title\"' or '--title \"Title\"'"
        )
    })
}

// ──────────────────────────────────────────────────────────────
// Command implementations
// ──────────────────────────────────────────────────────────────

fn cmd_init(root: &std::path::Path, json: bool) -> anyhow::Result<()> {
    jin_core::ops::init(root).context("init failed")?;
    if json {
        let env = Envelope::ok(
            "result",
            serde_json::json!({
                "ok": true,
                "message": format!("initialized jin root at {}", root.display()),
                "root": root.display().to_string()
            }),
        );
        output::print_json(&env);
    } else {
        println!("Initialized jin root at {}", root.display());
    }
    Ok(())
}

fn cmd_note_add(
    root: &std::path::Path,
    title: String,
    body: String,
    json: bool,
) -> anyhow::Result<()> {
    let cfg = Config::load(root)?;
    let note = jin_core::ops::notes::create_note(
        &cfg.notes_dir(),
        jin_core::ops::notes::CreateNoteParams {
            title,
            body,
            tags: vec![],
            folder: String::new(),
        },
    )?;
    api::refresh(root)?;
    if json {
        let dto = jin_core::dto::NoteDto::from_model(&note);
        let env = Envelope::ok("note", serde_json::to_value(&dto)?);
        output::print_json(&env);
    } else {
        println!("Created note {} — {}", note.id(), note.title());
    }
    Ok(())
}

fn cmd_note_list(
    root: &std::path::Path,
    tag_filter: Option<&str>,
    json: bool,
) -> anyhow::Result<()> {
    let dtos = api::list_notes(root, false, tag_filter, None)?;
    if json {
        let env = Envelope::ok("list", serde_json::to_value(&dtos)?);
        output::print_json(&env);
    } else {
        if dtos.is_empty() {
            println!("No notes.");
        }
        for d in &dtos {
            let tag_suffix = if d.tags.is_empty() {
                String::new()
            } else {
                format!(" [{}]", d.tags.join(", "))
            };
            println!("{} — {}{}", d.id, d.title, tag_suffix);
        }
    }
    Ok(())
}

struct NoteEditArgs {
    id: String,
    title: Option<String>,
    body: Option<String>,
    add_tags: Vec<String>,
    rm_tags: Vec<String>,
    properties_json: Option<String>,
    expected_revision: Option<u64>,
}

fn cmd_note_edit(root: &std::path::Path, args: NoteEditArgs, json: bool) -> anyhow::Result<()> {
    let properties = args
        .properties_json
        .map(|value| {
            serde_json::from_str(&value).context(
                "--properties-json must be an object containing string, number, bool, date, or string-list values",
            )
        })
        .transpose()?;
    let cfg = Config::load(root)?;
    let note = jin_core::ops::notes::edit_note(
        &cfg.notes_dir(),
        &args.id,
        jin_core::ops::notes::EditNoteParams {
            title: args.title,
            body: args.body,
            add_tags: args.add_tags,
            rm_tags: args.rm_tags,
            properties,
            expected_revision: args.expected_revision,
        },
    )?;
    api::refresh(root)?;
    if json {
        let dto = jin_core::dto::NoteDto::from_model(&note);
        let env = Envelope::ok("note", serde_json::to_value(&dto)?);
        output::print_json(&env);
    } else {
        println!("Updated note {} — {}", note.id(), note.title());
    }
    Ok(())
}

fn cmd_note_search(root: &std::path::Path, query: &str, json: bool) -> anyhow::Result<()> {
    let notes = api::search_notes(root, query)?;
    if json {
        output::print_json(&Envelope::ok("list", serde_json::to_value(notes)?));
    } else {
        for note in notes {
            println!("{} — {}", note.id, note.title);
        }
    }
    Ok(())
}

fn cmd_note_restore(
    root: &std::path::Path,
    id: &str,
    revision: u64,
    expected_revision: Option<u64>,
    json: bool,
) -> anyhow::Result<()> {
    let note =
        jin_core::ops::recovery::restore_note_revision(root, id, revision, expected_revision)?;
    api::refresh(root)?;
    if json {
        output::print_json(&Envelope::ok(
            "note",
            serde_json::to_value(jin_core::dto::NoteDto::from_model(&note))?,
        ));
    } else {
        println!(
            "Restored note {} as revision {}",
            note.id(),
            note.frontmatter.revision
        );
    }
    Ok(())
}

fn cmd_note_revisions(root: &std::path::Path, id: &str, json: bool) -> anyhow::Result<()> {
    let revisions = jin_core::ops::recovery::list_revisions(root, id)?;
    if json {
        output::print_json(&Envelope::ok(
            "note_revisions",
            serde_json::json!(revisions
                .iter()
                .map(|revision| revision.revision)
                .collect::<Vec<_>>()),
        ));
    } else if revisions.is_empty() {
        println!("No recovery snapshots for note {id}.");
    } else {
        for revision in revisions {
            println!("{}", revision.revision);
        }
    }
    Ok(())
}

fn cmd_note_show(root: &std::path::Path, id: &str, json: bool) -> anyhow::Result<()> {
    // Route through api::get_note so index-derived backlinks are attached.
    let dto = api::get_note(root, id)?;
    if json {
        let env = Envelope::ok("note", serde_json::to_value(&dto)?);
        output::print_json(&env);
    } else {
        println!("id:      {}", dto.id);
        println!("title:   {}", dto.title);
        println!("status:  {}", dto.status);
        println!("created: {}", dto.created);
        // NoteDto does not carry the markdown body; read from disk for human display.
        let cfg = Config::load(root)?;
        if let Ok(note) = jin_core::ops::notes::get_note(&cfg.notes_dir(), id) {
            if !note.body.is_empty() {
                println!("\n{}", note.body.trim());
            }
        }
    }
    Ok(())
}

fn cmd_note_rm(root: &std::path::Path, id: &str, json: bool) -> anyhow::Result<()> {
    let note = jin_core::ops::notes::delete_note(&Config::load(root)?.notes_dir(), id)?;
    api::refresh(root)?;
    if json {
        let env = Envelope::ok(
            "result",
            serde_json::json!({
                "ok": true, "id": note.id(), "message": "note soft-deleted"
            }),
        );
        output::print_json(&env);
    } else {
        println!("Deleted note {} — {}", note.id(), note.title());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn cmd_task_add(
    root: &std::path::Path,
    title: String,
    list: Option<String>,
    priority: Option<String>,
    due: Option<String>,
    parent: Option<String>,
    json: bool,
) -> anyhow::Result<()> {
    let priority = priority.as_deref().map(parse_priority).transpose()?;
    let due = due.as_deref().map(parse_due_date).transpose()?;

    let cfg = Config::load(root)?;
    let task = jin_core::ops::tasks::create_task(
        &cfg.tasks_dir(),
        jin_core::ops::tasks::CreateTaskParams {
            title,
            body: String::new(),
            priority,
            due,
            list,
            tags: None,
            reminders: None,
            parent,
        },
    )?;
    api::refresh(root)?;
    if json {
        let dto = jin_core::dto::TaskDto::from_model(&task);
        let env = Envelope::ok("task", serde_json::to_value(&dto)?);
        output::print_json(&env);
    } else {
        println!("Created task {} — {}", task.id(), task.title());
    }
    Ok(())
}

fn cmd_task_list(
    root: &std::path::Path,
    list_filter: Option<&str>,
    status_filter: Option<&str>,
    priority_filter: Option<&str>,
    json: bool,
) -> anyhow::Result<()> {
    let dtos = api::list_tasks(root, list_filter, status_filter, priority_filter, false)?;
    if json {
        let env = Envelope::ok("list", serde_json::to_value(&dtos)?);
        output::print_json(&env);
    } else {
        if dtos.is_empty() {
            println!("No tasks.");
        }
        for d in &dtos {
            let priority_tag = if d.priority != "none" {
                format!(" [{}]", d.priority)
            } else {
                String::new()
            };
            println!("[{}] {} — {}{}", d.status, d.id, d.title, priority_tag);
        }
    }
    Ok(())
}

fn cmd_task_show(root: &std::path::Path, id: &str, json: bool) -> anyhow::Result<()> {
    // Route through api::get_task so index-derived backlinks are attached.
    let dto = api::get_task(root, id)?;
    if json {
        let env = Envelope::ok("task", serde_json::to_value(&dto)?);
        output::print_json(&env);
    } else {
        println!("id:       {}", dto.id);
        println!("title:    {}", dto.title);
        println!("status:   {}", dto.status);
        println!("priority: {}", dto.priority);
        println!("list:     {}", dto.list);
        if let Some(ref parent) = dto.parent {
            println!("parent:   {}", parent);
        }
    }
    Ok(())
}

fn cmd_task_rm(root: &std::path::Path, id: &str, json: bool) -> anyhow::Result<()> {
    let task = jin_core::ops::tasks::delete_task(&Config::load(root)?.tasks_dir(), id)?;
    api::refresh(root)?;
    if json {
        let env = Envelope::ok(
            "result",
            serde_json::json!({
                "ok": true, "id": task.id(), "message": "task soft-deleted"
            }),
        );
        output::print_json(&env);
    } else {
        println!("Deleted task {} — {}", task.id(), task.title());
    }
    Ok(())
}

fn cmd_task_done(root: &std::path::Path, id: &str, json: bool) -> anyhow::Result<()> {
    let task = jin_core::ops::tasks::transition_task(
        &Config::load(root)?.tasks_dir(),
        id,
        jin_core::model::TaskStatus::Done,
    )?;
    api::refresh(root)?;
    if json {
        let dto = jin_core::dto::TaskDto::from_model(&task);
        let env = Envelope::ok("task", serde_json::to_value(&dto)?);
        output::print_json(&env);
    } else {
        println!("Task {} marked done.", task.id());
    }
    Ok(())
}

/// Generic state-machine transition (start / cancel / reopen).
fn cmd_task_transition(
    root: &std::path::Path,
    id: &str,
    next: jin_core::model::TaskStatus,
    json: bool,
) -> anyhow::Result<()> {
    let task = jin_core::ops::tasks::transition_task(&Config::load(root)?.tasks_dir(), id, next)?;
    api::refresh(root)?;
    if json {
        let dto = jin_core::dto::TaskDto::from_model(&task);
        let env = Envelope::ok("task", serde_json::to_value(&dto)?);
        output::print_json(&env);
    } else {
        println!("Task {} → {}", task.id(), task.frontmatter.status);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn cmd_task_edit(
    root: &std::path::Path,
    id: &str,
    title: Option<String>,
    priority: Option<String>,
    due: Option<String>,
    clear_due: bool,
    list: Option<String>,
    parent: Option<String>,
    clear_parent: bool,
    json: bool,
) -> anyhow::Result<()> {
    let priority = priority.as_deref().map(parse_priority).transpose()?;
    let due_param: Option<Option<jin_core::model::DueDate>> = if clear_due {
        Some(None)
    } else if let Some(ref d) = due {
        Some(Some(parse_due_date(d)?))
    } else {
        None
    };
    // S6: `clear_parent` takes priority over `parent` (mirrors clear_due).
    let parent_param: Option<Option<String>> = if clear_parent {
        Some(None)
    } else {
        parent.map(Some)
    };

    let cfg = Config::load(root)?;
    let task = jin_core::ops::tasks::edit_task(
        &cfg.tasks_dir(),
        id,
        jin_core::ops::tasks::EditTaskParams {
            title,
            priority,
            due: due_param,
            list,
            body: None,
            tags: None,
            section_id: None,
            clear_section: false,
            reminders: None,
            parent: parent_param,
        },
    )?;
    api::refresh(root)?;
    if json {
        let dto = jin_core::dto::TaskDto::from_model(&task);
        let env = Envelope::ok("task", serde_json::to_value(&dto)?);
        output::print_json(&env);
    } else {
        println!("Updated task {} — {}", task.id(), task.title());
    }
    Ok(())
}

// ── Parse helpers ──────────────────────────────────────────────────────────

fn parse_priority(s: &str) -> anyhow::Result<jin_core::model::Priority> {
    match s.to_ascii_lowercase().as_str() {
        "none" => Ok(jin_core::model::Priority::None),
        "low" => Ok(jin_core::model::Priority::Low),
        "medium" => Ok(jin_core::model::Priority::Medium),
        "high" => Ok(jin_core::model::Priority::High),
        _ => Err(anyhow::anyhow!(
            "unknown priority '{}'; expected: none, low, medium, high",
            s
        )),
    }
}

fn parse_due_date(s: &str) -> anyhow::Result<jin_core::model::DueDate> {
    use chrono::{DateTime, FixedOffset, NaiveDate};
    // Try bare date first.
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Ok(jin_core::model::DueDate::Date(d));
    }
    // Try RFC 3339 datetime with offset.
    if let Ok(dt) = DateTime::<FixedOffset>::parse_from_rfc3339(s) {
        return Ok(jin_core::model::DueDate::DateTime(dt));
    }
    Err(anyhow::anyhow!(
        "invalid due date '{}'; expected YYYY-MM-DD or RFC 3339 datetime (e.g. 2026-07-01T14:00:00-03:00)",
        s
    ))
}

#[allow(clippy::too_many_arguments)]
fn cmd_event_add(
    root: &std::path::Path,
    title: String,
    start: String,
    end: String,
    tz: Option<String>,
    all_day: bool,
    account_id: Option<String>,
    calendar_id: Option<String>,
    json: bool,
) -> anyhow::Result<()> {
    use chrono::{NaiveDate, NaiveDateTime};
    use jin_core::model::event::{TemporalValue, ValueType};

    // Validate tzid before creating anything on disk.
    if let Some(ref tzid) = tz {
        jin_core::time::validate_tzid(tzid).map_err(|reason| {
            jin_core::JinError::InvalidTimezone {
                tzid: tzid.clone(),
                reason,
            }
        })?;
    }

    let (start_tv, end_tv, start_vt, end_vt) = if all_day {
        // All-day: parse as YYYY-MM-DD dates, no time component.
        let sd = NaiveDate::parse_from_str(&start, "%Y-%m-%d").with_context(|| {
            format!("--all-day expects YYYY-MM-DD dates; got start='{}'", start)
        })?;
        let ed = NaiveDate::parse_from_str(&end, "%Y-%m-%d")
            .with_context(|| format!("--all-day expects YYYY-MM-DD dates; got end='{}'", end))?;
        (
            TemporalValue::Date(sd),
            TemporalValue::Date(ed),
            ValueType::Date,
            ValueType::Date,
        )
    } else {
        // Timed event: parse as ISO 8601 datetime.
        let parse_dt = |s: &str| -> anyhow::Result<TemporalValue> {
            NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S")
                .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M"))
                .map(TemporalValue::DateTime)
                .with_context(|| format!("invalid datetime '{}' (use YYYY-MM-DDTHH:MM:SS)", s))
        };
        (
            parse_dt(&start)?,
            parse_dt(&end)?,
            ValueType::DateTime,
            ValueType::DateTime,
        )
    };

    // Floating = timed without a timezone. All-day events never get a tzid.
    let floating = !all_day && tz.is_none();
    let start_tzid = if all_day { None } else { tz.clone() };
    let end_tzid = if all_day { None } else { tz };

    let target = match (account_id, calendar_id) {
        (Some(account_id), Some(calendar_id)) => {
            Some(jin_core::google::account::EventSyncTarget::new(
                jin_core::google::account::GoogleAccountId::parse(account_id)?,
                calendar_id,
            )?)
        }
        (None, None) => None,
        _ => unreachable!("clap requires both route arguments"),
    };
    let event = jin_core::ops::event_mutation::EventMutationService::new(root)?.create(
        jin_core::ops::events::CreateEventParams {
            title,
            body: String::new(),
            start: start_tv,
            end: end_tv,
            start_value_type: start_vt,
            end_value_type: end_vt,
            is_all_day: all_day,
            start_tzid,
            end_tzid,
            floating,
            ical_uid: None,
            description: None,
            location: None,
            attendees: None,
            conference_data: None,
            reminders: None,
        },
        target,
        &format!("cli-create-{}", jin_core::id::new_ulid()),
    )?;
    if json {
        let dto = jin_core::dto::EventDto::from_model(&event);
        let env = Envelope::ok("event", serde_json::to_value(&dto)?);
        output::print_json(&env);
    } else {
        println!("Created event {} — {}", event.id(), event.title());
    }
    Ok(())
}

fn cmd_event_list(root: &std::path::Path, json: bool) -> anyhow::Result<()> {
    let dtos = api::list_events(root, false)?;
    if json {
        let env = Envelope::ok("list", serde_json::to_value(&dtos)?);
        output::print_json(&env);
    } else {
        if dtos.is_empty() {
            println!("No events.");
        }
        for d in &dtos {
            println!("{} — {} [{}]", d.id, d.title, d.start);
        }
    }
    Ok(())
}

fn cmd_event_show(root: &std::path::Path, id: &str, json: bool) -> anyhow::Result<()> {
    // Route through api::get_event so index-derived backlinks are attached.
    let dto = api::get_event(root, id)?;
    if json {
        let env = Envelope::ok("event", serde_json::to_value(&dto)?);
        output::print_json(&env);
    } else {
        println!("id:       {}", dto.id);
        println!("title:    {}", dto.title);
        println!("status:   {}", dto.status);
        println!("start:    {}", dto.start);
        println!("end:      {}", dto.end);
        if let Some(ref tzid) = dto.start_tzid {
            println!("tzid:     {}", tzid);
        }
    }
    Ok(())
}

fn cmd_event_rm(root: &std::path::Path, id: &str, json: bool) -> anyhow::Result<()> {
    let event = jin_core::ops::event_mutation::EventMutationService::new(root)?.delete_local(id)?;
    if json {
        let env = Envelope::ok(
            "result",
            serde_json::json!({
                "ok": true, "id": event.id(), "message": "event soft-deleted (cancelled)"
            }),
        );
        output::print_json(&env);
    } else {
        println!("Cancelled event {} — {}", event.id(), event.title());
    }
    Ok(())
}

fn cmd_link(
    root: &std::path::Path,
    source: &str,
    target: &str,
    edge_type_str: &str,
    json: bool,
) -> anyhow::Result<()> {
    use jin_core::model::EdgeType;

    let edge_type = EdgeType::parse(edge_type_str).ok_or_else(|| JinError::InvalidEdgeType {
        edge_type: edge_type_str.to_string(),
        reason: format!(
            "'{}' is not in the edge vocabulary. Allowed: derived-from, prep-for, references",
            edge_type_str
        ),
    })?;

    // M5: infer_kind from jin-core returns JinError::NotFound (exit 3) on miss
    let source_kind = api::infer_kind(root, source)?;
    let target_kind = api::infer_kind(root, target)?;

    jin_core::ops::link::create_link(root, source, &source_kind, target, &target_kind, edge_type)?;

    api::refresh(root)?;

    if json {
        let env = Envelope::ok(
            "result",
            serde_json::json!({
                "ok": true,
                "message": format!("created edge {} -[{}]-> {}", source, edge_type_str, target)
            }),
        );
        output::print_json(&env);
    } else {
        println!("Linked {} --[{}]--> {}", source, edge_type_str, target);
    }
    Ok(())
}

fn cmd_attach(
    root: &std::path::Path,
    note_id: &str,
    target_id: &str,
    kind: Option<&str>,
    json: bool,
) -> anyhow::Result<()> {
    use jin_core::model::EdgeType;

    let edge_type = if let Some(k) = kind {
        Some(EdgeType::parse(k).ok_or_else(|| JinError::InvalidEdgeType {
            edge_type: k.to_string(),
            reason: "not in edge vocabulary".to_string(),
        })?)
    } else {
        None
    };

    // M6: attach logic lives in jin-core
    let et = jin_core::ops::attach::attach_note(root, note_id, target_id, edge_type)?;

    api::refresh(root)?;

    if json {
        let env = Envelope::ok(
            "result",
            serde_json::json!({
                "ok": true,
                "message": format!("attached note {} to {} via {}", note_id, target_id, et)
            }),
        );
        output::print_json(&env);
    } else {
        println!("Attached note {} to {} ({})", note_id, target_id, et);
    }
    Ok(())
}

// This CLI boundary intentionally keeps each clap-derived input explicit;
// grouping them solely for lint would obscure the command contract.
#[allow(clippy::too_many_arguments)]
fn cmd_promote(
    root: &std::path::Path,
    task_id: &str,
    when: &str,
    tz: Option<String>,
    account_id: Option<String>,
    calendar_id: Option<String>,
    jin_only: bool,
    json: bool,
) -> anyhow::Result<()> {
    use chrono::NaiveDateTime;

    let start_dt = NaiveDateTime::parse_from_str(when, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(when, "%Y-%m-%dT%H:%M"))
        .with_context(|| format!("invalid --when datetime '{}'", when))?;

    // M6: promote logic lives in jin-core; it validates tzid internally.
    let target = match (account_id, calendar_id) {
        (Some(account_id), Some(calendar_id)) => {
            Some(jin_core::google::account::EventSyncTarget::new(
                jin_core::google::account::GoogleAccountId::parse(account_id)?,
                calendar_id,
            )?)
        }
        (None, None) => None,
        _ => unreachable!("clap requires both route arguments"),
    };
    let event = jin_core::ops::promote::promote_with_destination_and_operation_id(
        root,
        task_id,
        jin_core::ops::promote::PromoteParams { start_dt, tzid: tz },
        target,
        jin_only,
        &format!("promote-{}", jin_core::id::new_ulid()),
    )?;

    api::refresh(root)?;

    if json {
        let dto = jin_core::dto::EventDto::from_model(&event);
        let env = Envelope::ok("event", serde_json::to_value(&dto)?);
        output::print_json(&env);
    } else {
        println!(
            "Promoted task {} to event {} — {}",
            task_id,
            event.id(),
            event.title()
        );
    }
    Ok(())
}

fn cmd_today(root: &std::path::Path, date_str: Option<String>, json: bool) -> anyhow::Result<()> {
    use chrono::NaiveDate;

    let date = date_str
        .map(|s| {
            NaiveDate::parse_from_str(&s, "%Y-%m-%d")
                .with_context(|| format!("invalid --date '{}' (use YYYY-MM-DD)", s))
        })
        .transpose()?;

    let agenda = api::agenda_for_date(root, date)?;

    if json {
        let env = Envelope::ok("agenda", serde_json::to_value(&agenda)?);
        output::print_json(&env);
    } else {
        render_agenda_human(&agenda);
    }
    Ok(())
}

/// Human-readable renderer for the merged day agenda (S7).
fn render_agenda_human(agenda: &jin_core::dto::AgendaDto) {
    println!("Today — {} ({})", agenda.date, agenda.display_tz);

    let total = agenda.all_day_events.len() + agenda.timed_events.len();
    if total == 0 {
        println!("  nothing scheduled");
        return;
    }

    if !agenda.all_day_events.is_empty() {
        println!();
        println!("All-day:");
        for ev in &agenda.all_day_events {
            let src_tag = format!(" [{}]", ev.source);
            let recurr = if ev.recurrence_unexpanded {
                " (recurring)"
            } else {
                ""
            };
            println!("  {}{}{}", ev.title, recurr, src_tag);
            for note in &ev.prep_notes {
                println!("    prep: {} ({})", note.title, note.id);
            }
        }
    }

    if !agenda.timed_events.is_empty() {
        println!();
        println!("Schedule:");
        for ev in &agenda.timed_events {
            let src_tag = format!(" [{}]", ev.source);
            let recurr = if ev.recurrence_unexpanded {
                " (recurring)"
            } else {
                ""
            };
            println!("  {}  {}{}{}", ev.display_start, ev.title, recurr, src_tag);
            if let Some(ref task) = ev.originating_task {
                println!("    task: {} ({})", task.title, task.id);
            }
            for note in &ev.prep_notes {
                println!("    prep: {} ({})", note.title, note.id);
            }
        }
    }
}

fn cmd_export(
    root: &std::path::Path,
    dest: &std::path::Path,
    force: bool,
    json: bool,
) -> anyhow::Result<()> {
    let summary = jin_core::ops::export::export(root, dest, force)?;
    if json {
        let env = Envelope::ok(
            "result",
            serde_json::json!({
                "ok": true,
                "dest": dest.display().to_string(),
                "files_exported": summary.total_files(),
                "notes": summary.notes,
                "tasks": summary.tasks,
                "events": summary.events,
                "attachments": summary.attachments,
                "collections": summary.collections,
                "audit_included": summary.audit_included,
                "files": summary.files,
            }),
        );
        output::print_json(&env);
    } else {
        println!("Exported to {}:", dest.display());
        println!("  {} notes", summary.notes);
        println!("  {} tasks", summary.tasks);
        println!("  {} events", summary.events);
        println!("  {} attachments", summary.attachments);
        println!("  {} collections", summary.collections);
        if summary.audit_included {
            println!("  audit log (.jin/sync/audit.jsonl)");
        }
        println!("  {} file(s) total", summary.total_files());
    }
    Ok(())
}

fn cmd_import(
    source: &std::path::Path,
    dest: &std::path::Path,
    force: bool,
    json: bool,
) -> anyhow::Result<()> {
    let summary = jin_core::ops::export::import(source, dest, force)?;
    if json {
        output::print_json(&Envelope::ok(
            "result",
            serde_json::json!({
                "ok": true,
                "dest": dest.display().to_string(),
                "files_imported": summary.imported_files,
                "notes": summary.notes,
                "attachments": summary.attachments,
                "collections": summary.collections,
            }),
        ));
    } else {
        println!(
            "Imported {} canonical file(s) into {}",
            summary.imported_files,
            dest.display()
        );
    }
    Ok(())
}

fn cmd_asset_add(
    root: &std::path::Path,
    source: &std::path::Path,
    json: bool,
) -> anyhow::Result<()> {
    let asset = jin_core::ops::assets::import_attachment(root, source)?;
    if json {
        output::print_json(&Envelope::ok("attachment", serde_json::to_value(asset)?));
    } else {
        println!("Imported attachment {}", asset.sha256);
    }
    Ok(())
}

fn cmd_asset_list(root: &std::path::Path, json: bool) -> anyhow::Result<()> {
    let manifest = jin_core::ops::assets::load_manifest(root)?;
    let mut assets = Vec::new();
    for hash in manifest.assets.keys() {
        assets.push(jin_core::ops::assets::get_attachment(root, hash)?);
    }
    if json {
        output::print_json(&Envelope::ok("list", serde_json::to_value(assets)?));
    } else {
        for asset in assets {
            println!("{} {} {}", asset.sha256, asset.mime, asset.size);
        }
    }
    Ok(())
}

fn cmd_asset_repair(root: &std::path::Path, json: bool) -> anyhow::Result<()> {
    let report = jin_core::ops::assets::repair_assets(root)?;
    if json {
        output::print_json(&Envelope::ok("result", serde_json::to_value(report)?));
    } else {
        println!(
            "Attachment repair: {} added, {} missing, {} invalid",
            report.added.len(),
            report.missing.len(),
            report.invalid.len()
        );
    }
    Ok(())
}

fn cmd_collection_list(root: &std::path::Path, json: bool) -> anyhow::Result<()> {
    let collections = jin_core::ops::collections::list_collections(root)?;
    if json {
        output::print_json(&Envelope::ok("list", serde_json::to_value(collections)?));
    } else {
        for collection in collections {
            println!("{} — {}", collection.id, collection.name);
        }
    }
    Ok(())
}

fn cmd_collection_add(
    root: &std::path::Path,
    name: String,
    query_json: &str,
    json: bool,
) -> anyhow::Result<()> {
    let query = serde_json::from_str(query_json)
        .context("--query-json must be a versioned declarative Collection query")?;
    let collection = jin_core::ops::collections::create_collection(root, name, query)?;
    if json {
        output::print_json(&Envelope::ok(
            "collection",
            serde_json::to_value(collection)?,
        ));
    } else {
        println!("Created collection {} — {}", collection.id, collection.name);
    }
    Ok(())
}

fn cmd_collection_run(root: &std::path::Path, id: &str, json: bool) -> anyhow::Result<()> {
    let notes = jin_core::ops::collections::evaluate_collection(root, id)?;
    let dtos: Vec<_> = notes
        .iter()
        .map(jin_core::dto::NoteDto::from_model)
        .collect();
    if json {
        output::print_json(&Envelope::ok("list", serde_json::to_value(dtos)?));
    } else {
        for note in notes {
            println!("{} — {}", note.id(), note.title());
        }
    }
    Ok(())
}

fn cmd_capture(
    root: &std::path::Path,
    text: String,
    as_task: bool,
    list: Option<String>,
    json: bool,
) -> anyhow::Result<()> {
    let cfg = Config::load(root)?;
    if as_task {
        let task = jin_core::ops::tasks::create_task(
            &cfg.tasks_dir(),
            jin_core::ops::tasks::CreateTaskParams {
                title: text,
                body: String::new(),
                priority: None,
                due: None,
                list,
                tags: None,
                reminders: None,
                parent: None,
            },
        )?;
        api::refresh(root)?;
        if json {
            let dto = jin_core::dto::TaskDto::from_model(&task);
            let env = Envelope::ok("task", serde_json::to_value(&dto)?);
            output::print_json(&env);
        } else {
            println!("{}", task.id());
        }
    } else {
        let note = jin_core::ops::notes::create_note(
            &cfg.notes_dir(),
            jin_core::ops::notes::CreateNoteParams {
                title: text,
                body: String::new(),
                tags: vec![],
                folder: String::new(),
            },
        )?;
        api::refresh(root)?;
        if json {
            let dto = jin_core::dto::NoteDto::from_model(&note);
            let env = Envelope::ok("note", serde_json::to_value(&dto)?);
            output::print_json(&env);
        } else {
            println!("{}", note.id());
        }
    }
    Ok(())
}

fn cmd_doctor(root: &std::path::Path, json: bool) -> anyhow::Result<()> {
    let dangling = api::list_dangling(root)?;
    if json {
        let env = Envelope::ok(
            "result",
            serde_json::json!({
                "ok": dangling.is_empty(),
                "dangling_edges": dangling,
            }),
        );
        output::print_json(&env);
    } else {
        if dangling.is_empty() {
            println!("Index healthy — no dangling edges.");
        } else {
            println!("Dangling edges ({}):", dangling.len());
            for d in &dangling {
                println!(
                    "  {} ({}) --[{}]--> {} (not found): {}",
                    d.source_id, d.source_kind, d.edge_type, d.target_id, d.reason
                );
            }
        }
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────
// Auth commands (S6.1)
// ──────────────────────────────────────────────────────────────

/// Print the Google OAuth setup wizard guidance.
/// This MUST be called before running the auth flow so the owner understands:
///   1. How to create a GCP project + enable Calendar API
///   2. How to configure the OAuth consent screen
///   3. CRITICAL: publish to "In production" (not "Testing") to avoid 7-day token expiry
///   4. How to create the Desktop OAuth client credentials
fn print_oauth_wizard_guidance() {
    println!();
    println!("Jin — Google Calendar OAuth Setup");
    println!("===================================");
    println!();
    println!("To connect Jin to Google Calendar you need a Google Cloud project and");
    println!("OAuth credentials. This is a one-time setup.");
    println!();
    println!("STEP 1 — Create a Google Cloud project");
    println!("  1. Go to https://console.cloud.google.com/");
    println!("  2. Create a new project (or select an existing one).");
    println!("  3. Enable the Google Calendar API:");
    println!("     https://console.cloud.google.com/apis/library/calendar-json.googleapis.com");
    println!();
    println!("STEP 2 — Configure the OAuth consent screen");
    println!("  1. Go to https://console.cloud.google.com/apis/credentials/consent");
    println!(
        "  2. Choose \"External\" user type (or \"Internal\" if this is a Workspace account)."
    );
    println!("  3. Fill in the App name and your email address.");
    println!();
    println!("  *** IMPORTANT — Publish to \"In production\" ***");
    println!("  Under \"Publishing status\", publish the app to \"In production\"");
    println!("  A personal/few-known-users app may qualify for a verification exception,");
    println!("  but can still show an unverified warning and user cap.");
    println!();
    println!("  If you leave the app in \"Testing\" status, refresh tokens for sensitive");
    println!("  OAuth scopes (including Calendar) expire after ~7 days, forcing you to");
    println!("  re-authenticate every week.");
    println!();
    println!("  A public app requesting sensitive Calendar scopes requires Google");
    println!("  verification. Publishing to production is not the same as verification.");
    println!();
    println!("STEP 3 — Create OAuth credentials");
    println!("  1. Go to https://console.cloud.google.com/apis/credentials");
    println!("  2. Click \"Create Credentials\" → \"OAuth client ID\".");
    println!("  3. Choose \"Desktop app\" as the application type.");
    println!("  4. Note the Client ID and Client Secret.");
    println!();
    println!("STEP 4 — Configure Jin");
    println!("  Add to your .jin/config.toml:");
    println!();
    println!("    [google]");
    println!("    client_id = \"YOUR_CLIENT_ID.apps.googleusercontent.com\"");
    println!("    client_secret = \"YOUR_CLIENT_SECRET\"");
    println!();
    println!("  Or set environment variables:");
    println!("    export JIN_GOOGLE_CLIENT_ID=\"YOUR_CLIENT_ID.apps.googleusercontent.com\"");
    println!("    export JIN_GOOGLE_CLIENT_SECRET=\"YOUR_CLIENT_SECRET\"");
    println!();
}

fn cmd_auth_login(root: &std::path::Path, json: bool) -> anyhow::Result<()> {
    use std::io::BufRead;

    print_oauth_wizard_guidance();

    println!("Press Enter once you have set your credentials, or Ctrl-C to abort.");
    let stdin = std::io::stdin();
    let _ = stdin.lock().lines().next();

    // Load credentials (fails with Auth error / exit 5 if not configured)
    let cfg = Config::load(root)?;
    let creds = jin_core::google::config::GoogleCredentials::load(&cfg)?;

    // Run the PKCE + loopback flow
    let tokens = jin_core::google::auth::run_auth_flow(&creds)?;

    // Persist tokens
    jin_core::google::secrets::save_tokens(root, &cfg, &tokens)?;

    let backend = jin_core::google::secrets::detect_backend(root, &cfg);

    if json {
        let env = Envelope::ok(
            "result",
            serde_json::json!({
                "ok": true,
                "message": "Authentication successful",
                "backend": backend.name(),
            }),
        );
        output::print_json(&env);
    } else {
        println!("Authentication successful!");
        println!("Tokens stored via: {}", backend.name());
        println!("Run 'jin auth status' to verify.");
    }
    Ok(())
}

fn cmd_auth_status(root: &std::path::Path, json: bool) -> anyhow::Result<()> {
    let cfg = Config::load(root)?;
    let backend = jin_core::google::secrets::detect_backend(root, &cfg);

    match jin_core::google::secrets::load_tokens(root, &cfg) {
        Ok(tokens) => {
            let expired = tokens.is_expired();
            if json {
                let env = Envelope::ok(
                    "result",
                    serde_json::json!({
                        "authenticated": true,
                        "expired": expired,
                        "expires_at": tokens.expires_at,
                        "scope": tokens.scope,
                        "client_id": tokens.client_id,
                        "account": tokens.account,
                        "backend": backend.name(),
                    }),
                );
                output::print_json(&env);
            } else {
                println!(
                    "Status:  {}",
                    if expired {
                        "Authenticated (access token expired — will refresh on next sync)"
                    } else {
                        "Authenticated"
                    }
                );
                println!("Backend: {}", backend.name());
                println!("Scope:   {}", tokens.scope);
                if let Some(account) = &tokens.account {
                    println!("Account: {account}");
                }
            }
        }
        Err(_) => {
            // No tokens stored or cannot be loaded — not authenticated.
            if json {
                let env = Envelope::ok(
                    "result",
                    serde_json::json!({
                        "authenticated": false,
                        "backend": backend.name(),
                        "message": "Not authenticated. Run 'jin auth login' to connect to Google Calendar.",
                    }),
                );
                output::print_json(&env);
            } else {
                println!("Not authenticated.");
                println!("Run 'jin auth login' to connect to Google Calendar.");
            }
        }
    }
    Ok(())
}

fn cmd_sync(root: &std::path::Path, json: bool) -> anyhow::Result<()> {
    // Propagate JinError via `?` so `run`'s error handler can map it to the
    // correct exit code (5 for auth, 6 for offline) and print the message.
    let summary = jin_core::ops::sync::sync(root)?;

    if json {
        let env = Envelope::ok("result", serde_json::to_value(&summary)?);
        output::print_json(&env);
    } else {
        println!(
            "Sync complete — pulled: {}, pushed: {}, resolved: {}, conflicts: {}, status: {}",
            summary.pulled, summary.pushed, summary.resolved, summary.conflicts, summary.status
        );
        if summary.resolved > 0 {
            println!(
                "  {} conflict(s) auto-resolved (audit log: {})",
                summary.resolved,
                summary
                    .audit_log_path
                    .as_deref()
                    .unwrap_or(".jin/sync/audit.jsonl")
            );
        }
        for e in &summary.errors {
            eprintln!("  warning: {e}");
        }
        if summary.conflicts > 0 {
            // Genuinely unresolvable — none expected in MVP.
            println!(
                "  {} conflict(s) require manual resolution.",
                summary.conflicts
            );
        }
    }

    // S6.3: auto-resolved conflicts are NOT errors → exit 0.
    // Only genuinely unresolvable conflicts (none in MVP) cause exit 4.
    if summary.conflicts > 0 {
        return Err(JinError::SyncConflict(format!(
            "{} conflict(s) could not be auto-resolved",
            summary.conflicts
        ))
        .into());
    }

    Ok(())
}

fn cmd_auth_logout(root: &std::path::Path, json: bool) -> anyhow::Result<()> {
    let cfg = Config::load(root)?;
    let deleted = jin_core::google::secrets::delete_tokens(root, &cfg)?;

    let message = if deleted {
        "Logged out. Tokens have been deleted."
    } else {
        "Logged out (no stored credentials to remove)."
    };

    if json {
        let env = Envelope::ok(
            "result",
            serde_json::json!({
                "ok": true,
                "deleted": deleted,
                "message": message,
            }),
        );
        output::print_json(&env);
    } else {
        println!("{message}");
        if deleted {
            println!("Note: this does not revoke the token at Google.");
            println!("Run 'jin auth login' to re-authenticate.");
        }
    }
    Ok(())
}
