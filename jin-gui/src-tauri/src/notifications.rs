//! Native notification capability/status and the shared delivery transport.

#[cfg(target_os = "macos")]
use objc2_foundation::{NSObject, NSObjectProtocol};
#[cfg(target_os = "macos")]
use objc2_user_notifications::{
    UNNotification, UNNotificationPresentationOptions, UNNotificationResponse,
    UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NotificationPermission {
    Granted,
    Denied,
    Prompt,
    Restricted,
    NotApplicable,
    Unavailable,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NotificationStatusDto {
    pub platform: String,
    pub permission: NotificationPermission,
    pub reason: String,
    pub can_request: bool,
    pub can_open_settings: bool,
    pub settings_scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TestNotificationResultDto {
    pub submitted: bool,
    pub message: String,
}

pub trait NotificationPlatform {
    fn status(&self) -> Result<NotificationStatusDto, String>;
    fn request_permission(&self) -> Result<NotificationStatusDto, String>;
    fn open_settings(&self) -> Result<(), String>;
}

#[derive(Debug, Default, Clone)]
pub struct NativeNotificationPlatform {
    #[cfg(target_os = "windows")]
    app_id: String,
}

impl NativeNotificationPlatform {
    pub fn new<R: Runtime>(app: &AppHandle<R>) -> Self {
        #[cfg(target_os = "windows")]
        {
            Self {
                // Tauri's configured identifier is also the AppUserModelID
                // written into installed Windows shortcuts/packages.
                app_id: app.config().identifier.clone(),
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = app;
            Self {}
        }
    }
}

impl NotificationPlatform for NativeNotificationPlatform {
    fn status(&self) -> Result<NotificationStatusDto, String> {
        #[cfg(target_os = "windows")]
        return windows_platform_status(&self.app_id);
        #[cfg(not(target_os = "windows"))]
        platform_status()
    }

    fn request_permission(&self) -> Result<NotificationStatusDto, String> {
        #[cfg(target_os = "windows")]
        return windows_platform_status(&self.app_id);
        #[cfg(not(target_os = "windows"))]
        request_platform_permission()
    }

    fn open_settings(&self) -> Result<(), String> {
        open_platform_settings()
    }
}

/// One delivery seam shared by reminders and the Settings test action.
pub trait NotificationTransport: Send + Sync {
    fn submit(&self, title: &str, body: &str) -> Result<(), String>;
}

pub struct NativeNotificationTransport<R: Runtime> {
    #[cfg(target_os = "windows")]
    app_id: String,
    _runtime: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> NativeNotificationTransport<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        #[cfg(target_os = "windows")]
        {
            Self {
                app_id: app.config().identifier.clone(),
                _runtime: std::marker::PhantomData,
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            drop(app);
            Self {
                _runtime: std::marker::PhantomData,
            }
        }
    }
}

impl<R: Runtime> NotificationTransport for NativeNotificationTransport<R> {
    fn submit(&self, title: &str, body: &str) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        let status = windows_platform_status(&self.app_id)?;
        #[cfg(not(target_os = "windows"))]
        let status = NativeNotificationPlatform::default().status()?;
        if matches!(
            status.permission,
            NotificationPermission::Denied
                | NotificationPermission::Prompt
                | NotificationPermission::Restricted
                | NotificationPermission::Unavailable
                | NotificationPermission::Unknown
        ) {
            return Err(format!(
                "notifications are {}",
                permission_name(status.permission)
            ));
        }
        #[cfg(target_os = "macos")]
        {
            submit_macos_notification(title, body)
        }
        #[cfg(target_os = "linux")]
        {
            submit_linux_notification(title, body)
        }
        #[cfg(target_os = "windows")]
        {
            submit_windows_notification(&self.app_id, title, body)
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        {
            let _ = (title, body);
            Err("native notification submission is unavailable on this platform".into())
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "windows", test))]
fn native_submission_result<T, E: std::fmt::Display>(
    result: Result<T, E>,
    service: &str,
) -> Result<(), String> {
    result
        .map(|_| ())
        .map_err(|error| format!("{service} rejected notification submission: {error}"))
}

#[cfg(target_os = "linux")]
fn submit_linux_notification(title: &str, body: &str) -> Result<(), String> {
    // notify-rust's blocking show waits for the org.freedesktop.Notifications
    // Notify method reply. Unlike the Tauri plugin wrapper, it does not spawn
    // and discard the native result.
    native_submission_result(
        notify_rust::Notification::new()
            .appname("Jin")
            .summary(title)
            .body(body)
            .show(),
        "desktop notification service",
    )
}

#[cfg(target_os = "windows")]
fn submit_windows_notification(app_id: &str, title: &str, body: &str) -> Result<(), String> {
    // Toast::show uses CreateToastNotifierWithId(app_id) and propagates the
    // WinRT Show result. The installed Tauri identifier is the effective AUMID.
    native_submission_result(
        tauri_winrt_notification::Toast::new(app_id)
            .title(title)
            .text1(body)
            .show(),
        "Windows toast service",
    )
}

#[cfg(target_os = "macos")]
fn submit_macos_notification(title: &str, body: &str) -> Result<(), String> {
    use block2::RcBlock;
    use objc2_foundation::{NSError, NSString};
    use objc2_user_notifications::{
        UNMutableNotificationContent, UNNotificationRequest, UNNotificationSound,
        UNUserNotificationCenter,
    };
    use std::{
        sync::{atomic::AtomicU64, atomic::Ordering, mpsc},
        time::Duration,
    };

    static REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(title));
    content.setBody(&NSString::from_str(body));
    content.setSound(Some(&UNNotificationSound::defaultSound()));
    let identifier = NSString::from_str(&format!(
        "dev.jin.gui.notification.{}.{}",
        std::process::id(),
        REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let request =
        UNNotificationRequest::requestWithIdentifier_content_trigger(&identifier, &content, None);

    let (sender, receiver) = mpsc::sync_channel(1);
    let completion = RcBlock::new(move |error: *mut NSError| {
        let native_error = unsafe { error.as_ref() }.map(mac_native_error);
        let _ = sender.send(MacDeliveryCompletion::Completed(native_error));
    });
    UNUserNotificationCenter::currentNotificationCenter()
        .addNotificationRequest_withCompletionHandler(&request, Some(&completion));

    let completion = match receiver.recv_timeout(Duration::from_secs(5)) {
        Ok(completion) => completion,
        Err(mpsc::RecvTimeoutError::Timeout) => MacDeliveryCompletion::TimedOut,
        Err(mpsc::RecvTimeoutError::Disconnected) => MacDeliveryCompletion::Disconnected,
    };
    reconcile_mac_delivery_completion(completion)
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, PartialEq, Eq)]
enum MacDeliveryCompletion {
    Completed(Option<MacNativeError>),
    TimedOut,
    Disconnected,
}

#[cfg(target_os = "macos")]
fn reconcile_mac_delivery_completion(completion: MacDeliveryCompletion) -> Result<(), String> {
    match completion {
        MacDeliveryCompletion::Completed(None) => Ok(()),
        MacDeliveryCompletion::Completed(Some(error)) => Err(format!(
            "macOS could not submit the notification: NSError domain={} code={} localizedDescription={}",
            error.domain, error.code, error.localized_description
        )),
        MacDeliveryCompletion::TimedOut => {
            Err("macOS notification submission timed out before completion".into())
        }
        MacDeliveryCompletion::Disconnected => {
            Err("macOS notification submission ended without a completion result".into())
        }
    }
}

#[cfg(target_os = "macos")]
objc2::define_class!(
    // SAFETY: NSObject imposes no extra subclassing invariants, the delegate
    // has no Drop implementation or thread-affine ivars, and its completion
    // handlers are safe to invoke on whichever queue Apple chooses.
    #[unsafe(super(NSObject))]
    #[thread_kind = objc2::AnyThread]
    #[ivars = ()]
    #[name = "JinUserNotificationCenterDelegate"]
    struct JinUserNotificationCenterDelegate;

    // SAFETY: NSObjectProtocol has no additional safety requirements.
    unsafe impl NSObjectProtocol for JinUserNotificationCenterDelegate {}

    // SAFETY: Each selector uses the exact generated protocol signature and
    // invokes Apple's required completion handler exactly once.
    unsafe impl UNUserNotificationCenterDelegate for JinUserNotificationCenterDelegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion_handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            complete_will_present(completion_handler);
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive_response(
            &self,
            _center: &UNUserNotificationCenter,
            _response: &UNNotificationResponse,
            completion_handler: &block2::DynBlock<dyn Fn()>,
        ) {
            complete_notification_response(completion_handler);
        }
    }
);

#[cfg(target_os = "macos")]
fn foreground_presentation_options() -> UNNotificationPresentationOptions {
    use objc2_user_notifications::UNNotificationPresentationOptions as Options;
    Options::Banner | Options::List | Options::Sound
}

#[cfg(target_os = "macos")]
fn complete_will_present(
    completion_handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
) {
    completion_handler.call((foreground_presentation_options(),));
}

#[cfg(target_os = "macos")]
fn complete_notification_response(completion_handler: &block2::DynBlock<dyn Fn()>) {
    completion_handler.call(());
}

#[cfg(target_os = "macos")]
impl JinUserNotificationCenterDelegate {
    fn new() -> objc2::rc::Retained<Self> {
        use objc2::{msg_send, AnyThread};
        let this = Self::alloc().set_ivars(());
        // SAFETY: Invoke NSObject's initializer on a newly allocated instance
        // whose ivars have already been initialized.
        unsafe { msg_send![super(this), init] }
    }
}

#[must_use]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotificationDelegateInstallOutcome {
    Installed,
    AlreadyInstalled,
    PreservedExisting,
    SkippedOffMainThread,
    NotApplicable,
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NotificationDelegateSlotDecision {
    Install,
    ReuseOwned,
    PreserveExisting,
}

#[cfg(target_os = "macos")]
fn notification_delegate_slot_decision(
    owner_initialized: bool,
    center_has_delegate: bool,
) -> NotificationDelegateSlotDecision {
    if owner_initialized {
        NotificationDelegateSlotDecision::ReuseOwned
    } else if center_has_delegate {
        NotificationDelegateSlotDecision::PreserveExisting
    } else {
        NotificationDelegateSlotDecision::Install
    }
}

#[cfg(target_os = "macos")]
static NOTIFICATION_CENTER_DELEGATE: std::sync::OnceLock<
    objc2::rc::Retained<JinUserNotificationCenterDelegate>,
> = std::sync::OnceLock::new();

#[cfg(target_os = "macos")]
static NOTIFICATION_DELEGATE_COLLISION: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Install Jin's foreground notification delegate before Tauri starts.
/// Notification Center's delegate property is weak; the OnceLock is the safe,
/// explicit process-lifetime strong owner.
#[cfg(target_os = "macos")]
pub fn install_notification_center_delegate() -> NotificationDelegateInstallOutcome {
    use objc2::runtime::ProtocolObject;
    use objc2_user_notifications::UNUserNotificationCenter;

    if objc2::MainThreadMarker::new().is_none() {
        return NotificationDelegateInstallOutcome::SkippedOffMainThread;
    }
    let center = UNUserNotificationCenter::currentNotificationCenter();
    match notification_delegate_slot_decision(
        NOTIFICATION_CENTER_DELEGATE.get().is_some(),
        center.delegate().is_some(),
    ) {
        NotificationDelegateSlotDecision::ReuseOwned => {
            return NotificationDelegateInstallOutcome::AlreadyInstalled;
        }
        NotificationDelegateSlotDecision::PreserveExisting => {
            NOTIFICATION_DELEGATE_COLLISION.store(true, std::sync::atomic::Ordering::Release);
            return NotificationDelegateInstallOutcome::PreservedExisting;
        }
        NotificationDelegateSlotDecision::Install => {}
    }

    if NOTIFICATION_CENTER_DELEGATE
        .set(JinUserNotificationCenterDelegate::new())
        .is_err()
    {
        return NotificationDelegateInstallOutcome::AlreadyInstalled;
    }
    let delegate = NOTIFICATION_CENTER_DELEGATE
        .get()
        .expect("notification delegate owner was initialized above");
    center.setDelegate(Some(ProtocolObject::from_ref(&**delegate)));
    NotificationDelegateInstallOutcome::Installed
}

#[cfg(not(target_os = "macos"))]
pub fn install_notification_center_delegate() -> NotificationDelegateInstallOutcome {
    NotificationDelegateInstallOutcome::NotApplicable
}

#[cfg(target_os = "macos")]
fn notification_delegate_collision() -> bool {
    NOTIFICATION_DELEGATE_COLLISION.load(std::sync::atomic::Ordering::Acquire)
}

#[cfg(not(target_os = "macos"))]
fn notification_delegate_collision() -> bool {
    false
}

fn test_notification_submission_message(delegate_collision: bool) -> String {
    if delegate_collision {
        "Test notification submitted to the notification service; banner or delivery is not guaranteed. Jin preserved another notification delegate, so it controls foreground presentation. Check Notification Center, Focus, or Do Not Disturb if no banner appears."
            .into()
    } else {
        "Test notification submitted to the notification service; banner or delivery is not guaranteed. If no banner appears, check Notification Center or Focus or Do Not Disturb."
            .into()
    }
}

pub fn notification_status_fn(
    platform: &dyn NotificationPlatform,
) -> Result<NotificationStatusDto, String> {
    platform.status()
}

pub fn request_notification_permission_fn(
    platform: &dyn NotificationPlatform,
) -> Result<NotificationStatusDto, String> {
    let current = platform.status()?;
    if current.permission != NotificationPermission::Prompt || !current.can_request {
        return Ok(current);
    }
    platform.request_permission()
}

pub fn open_notification_settings_fn(platform: &dyn NotificationPlatform) -> Result<(), String> {
    let status = platform.status()?;
    if !status.can_open_settings {
        return Err(status.reason);
    }
    platform.open_settings()
}

pub fn send_test_notification_fn(
    transport: &dyn NotificationTransport,
) -> Result<TestNotificationResultDto, String> {
    transport.submit("Jin", "Notifications are working.")?;
    Ok(TestNotificationResultDto {
        submitted: true,
        message: test_notification_submission_message(notification_delegate_collision()),
    })
}

#[tauri::command]
pub async fn notification_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<NotificationStatusDto, String> {
    notification_status_fn(&NativeNotificationPlatform::new(&app))
}

#[tauri::command]
pub async fn request_notification_permission<R: Runtime>(
    app: AppHandle<R>,
) -> Result<NotificationStatusDto, String> {
    request_notification_permission_fn(&NativeNotificationPlatform::new(&app))
}

#[tauri::command]
pub async fn open_notification_settings<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    open_notification_settings_fn(&NativeNotificationPlatform::new(&app))
}

#[tauri::command]
pub async fn send_test_notification<R: Runtime>(
    app: AppHandle<R>,
) -> Result<TestNotificationResultDto, String> {
    send_test_notification_fn(&NativeNotificationTransport::new(app))
}

fn permission_name(permission: NotificationPermission) -> &'static str {
    match permission {
        NotificationPermission::Granted => "granted",
        NotificationPermission::Denied => "denied",
        NotificationPermission::Prompt => "waiting for permission",
        NotificationPermission::Restricted => "restricted",
        NotificationPermission::NotApplicable => "managed by the desktop",
        NotificationPermission::Unavailable => "unavailable",
        NotificationPermission::Unknown => "unknown or unsupported",
    }
}

#[cfg(target_os = "macos")]
fn platform_status() -> Result<NotificationStatusDto, String> {
    use block2::RcBlock;
    use objc2_user_notifications::UNUserNotificationCenter;
    use std::{sync::mpsc, time::Duration};

    let (sender, receiver) = mpsc::sync_channel(1);
    let completion = RcBlock::new(
        move |settings: std::ptr::NonNull<objc2_user_notifications::UNNotificationSettings>| {
            let status = unsafe { settings.as_ref() }.authorizationStatus();
            let _ = sender.send(status);
        },
    );
    UNUserNotificationCenter::currentNotificationCenter()
        .getNotificationSettingsWithCompletionHandler(&completion);
    let status = receiver
        .recv_timeout(Duration::from_secs(3))
        .map_err(|_| "macOS did not return notification settings in time".to_string())?;
    Ok(mac_status(status))
}

#[cfg(target_os = "macos")]
fn mac_status(status: objc2_user_notifications::UNAuthorizationStatus) -> NotificationStatusDto {
    use objc2_user_notifications::UNAuthorizationStatus as Status;
    let (permission, reason, can_request) = match status {
        Status::NotDetermined => (
            NotificationPermission::Prompt,
            "macOS has not asked for notification permission yet.",
            true,
        ),
        Status::Denied => (
            NotificationPermission::Denied,
            "Notifications are disabled for Jin in macOS Settings.",
            false,
        ),
        Status::Authorized | Status::Provisional | Status::Ephemeral => (
            NotificationPermission::Granted,
            "macOS allows Jin notifications.",
            false,
        ),
        _ => (
            NotificationPermission::Unknown,
            "macOS returned an unknown notification permission state.",
            false,
        ),
    };
    NotificationStatusDto {
        platform: "macos".into(),
        permission,
        reason: reason.into(),
        can_request,
        can_open_settings: true,
        settings_scope: "notification_center".into(),
    }
}

#[cfg(target_os = "macos")]
fn request_platform_permission() -> Result<NotificationStatusDto, String> {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::NSError;
    use objc2_user_notifications::{UNAuthorizationOptions, UNUserNotificationCenter};
    use std::{sync::mpsc, time::Duration};

    let (sender, receiver) = mpsc::sync_channel(1);
    let completion = RcBlock::new(move |granted: Bool, error: *mut NSError| {
        let native_error = unsafe { error.as_ref() }.map(mac_native_error);
        let _ = sender.send(MacPermissionCallbackOutcome::Completed {
            granted: granted.as_bool(),
            error: native_error,
        });
    });
    UNUserNotificationCenter::currentNotificationCenter()
        .requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
            &completion,
        );
    let outcome = match receiver.recv_timeout(Duration::from_secs(30)) {
        Ok(outcome) => outcome,
        Err(mpsc::RecvTimeoutError::Timeout) => MacPermissionCallbackOutcome::TimedOut,
        Err(mpsc::RecvTimeoutError::Disconnected) => MacPermissionCallbackOutcome::Disconnected,
    };

    // Notification Center's persisted setting is authoritative. In particular,
    // macOS can persist authorization even when its completion handler reports
    // an error, so every callback outcome (including timeout) is reconciled with
    // a fresh settings read before deciding what to return.
    reconcile_mac_permission_request(outcome, platform_status())
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, PartialEq, Eq)]
struct MacNativeError {
    domain: String,
    code: i64,
    localized_description: String,
}

#[cfg(target_os = "macos")]
fn mac_native_error(error: &objc2_foundation::NSError) -> MacNativeError {
    MacNativeError {
        domain: error.domain().to_string(),
        code: error.code() as i64,
        localized_description: error.localizedDescription().to_string(),
    }
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, PartialEq, Eq)]
enum MacPermissionCallbackOutcome {
    Completed {
        granted: bool,
        error: Option<MacNativeError>,
    },
    TimedOut,
    Disconnected,
}

#[cfg(target_os = "macos")]
fn reconcile_mac_permission_request(
    outcome: MacPermissionCallbackOutcome,
    reread: Result<NotificationStatusDto, String>,
) -> Result<NotificationStatusDto, String> {
    if let Ok(status) = &reread {
        if status.permission == NotificationPermission::Granted {
            return Ok(status.clone());
        }
        if matches!(
            outcome,
            MacPermissionCallbackOutcome::Completed {
                granted: false,
                error: None
            }
        ) && status.permission == NotificationPermission::Denied
        {
            return Ok(status.clone());
        }
    }

    let callback_context = match outcome {
        MacPermissionCallbackOutcome::Completed {
            granted,
            error: Some(error),
        } => format!(
            "callback granted={granted}; NSError domain={} code={} localizedDescription={}",
            error.domain, error.code, error.localized_description
        ),
        MacPermissionCallbackOutcome::Completed {
            granted,
            error: None,
        } => format!("callback granted={granted} with no NSError"),
        MacPermissionCallbackOutcome::TimedOut => "callback timed out".into(),
        MacPermissionCallbackOutcome::Disconnected => {
            "callback channel disconnected before returning a result".into()
        }
    };

    match reread {
        Ok(status) => Err(format!(
            "macOS notification permission request was inconclusive ({callback_context}); re-read status={} ({})",
            permission_name(status.permission), status.reason
        )),
        Err(status_error) => Err(format!(
            "macOS notification permission request was inconclusive ({callback_context}); re-reading notification settings failed: {status_error}"
        )),
    }
}

#[cfg(target_os = "macos")]
const MACOS_NOTIFICATION_SETTINGS_TARGET: &str =
    "x-apple.systempreferences:com.apple.Notifications-Settings.extension";

#[cfg(target_os = "macos")]
fn open_platform_settings() -> Result<(), String> {
    let status = std::process::Command::new("open")
        .arg(MACOS_NOTIFICATION_SETTINGS_TARGET)
        .status()
        .map_err(|error| format!("Could not open macOS Notification Settings: {error}. Open System Settings > Notifications > Jin manually."))?;
    if status.success() {
        Ok(())
    } else {
        Err("Could not open macOS Notification Settings. Open System Settings > Notifications > Jin manually.".into())
    }
}

#[cfg(target_os = "windows")]
fn windows_platform_status(app_id: &str) -> Result<NotificationStatusDto, String> {
    use windows::core::HSTRING;
    use windows::UI::Notifications::{NotificationSetting, ToastNotificationManager};
    let setting = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))
        .and_then(|notifier| notifier.Setting())
        .map_err(|error| error.to_string())?;
    let (permission, reason) = match setting {
        NotificationSetting::Enabled => (
            NotificationPermission::Granted,
            "Windows allows Jin notifications.",
        ),
        NotificationSetting::DisabledForApplication => (
            NotificationPermission::Denied,
            "Notifications are disabled for Jin in Windows Settings.",
        ),
        NotificationSetting::DisabledForUser => (
            NotificationPermission::Restricted,
            "Notifications are disabled for this Windows user.",
        ),
        NotificationSetting::DisabledByGroupPolicy => (
            NotificationPermission::Restricted,
            "Notifications are disabled by Windows group policy.",
        ),
        NotificationSetting::DisabledByManifest => (
            NotificationPermission::Unavailable,
            "This Jin package cannot send Windows notifications.",
        ),
        _ => (
            NotificationPermission::Unknown,
            "Windows returned an unknown notification setting.",
        ),
    };
    Ok(NotificationStatusDto {
        platform: "windows".into(),
        permission,
        reason: reason.into(),
        can_request: false,
        can_open_settings: true,
        settings_scope: "notifications".into(),
    })
}

#[cfg(target_os = "windows")]
const WINDOWS_NOTIFICATION_SETTINGS_TARGET: &str = "ms-settings:notifications";

#[cfg(target_os = "windows")]
fn open_platform_settings() -> Result<(), String> {
    let status = std::process::Command::new("explorer.exe")
        .arg(WINDOWS_NOTIFICATION_SETTINGS_TARGET)
        .status()
        .map_err(|error| format!("Could not open Windows Notification Settings: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Could not open Windows Notification Settings. Open Settings > System > Notifications manually.".into())
    }
}

#[cfg(target_os = "linux")]
fn platform_status() -> Result<NotificationStatusDto, String> {
    Ok(NotificationStatusDto {
        platform: "linux".into(),
        permission: NotificationPermission::NotApplicable,
        reason: "Notification permission is managed by your desktop environment.".into(),
        can_request: false,
        can_open_settings: false,
        settings_scope: "desktop_environment".into(),
    })
}

#[cfg(target_os = "linux")]
fn request_platform_permission() -> Result<NotificationStatusDto, String> {
    platform_status()
}

#[cfg(target_os = "linux")]
fn open_platform_settings() -> Result<(), String> {
    Err("Open your desktop environment's notification settings manually.".into())
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn platform_status() -> Result<NotificationStatusDto, String> {
    Ok(NotificationStatusDto {
        platform: std::env::consts::OS.into(),
        permission: NotificationPermission::Unknown,
        reason: "Notification permission status is not available on this platform.".into(),
        can_request: false,
        can_open_settings: false,
        settings_scope: "unavailable".into(),
    })
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn request_platform_permission() -> Result<NotificationStatusDto, String> {
    platform_status()
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn open_platform_settings() -> Result<(), String> {
    Err("Notification settings are unavailable on this platform.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct FakePlatform(NotificationStatusDto);
    impl NotificationPlatform for FakePlatform {
        fn status(&self) -> Result<NotificationStatusDto, String> {
            Ok(self.0.clone())
        }
        fn request_permission(&self) -> Result<NotificationStatusDto, String> {
            Ok(NotificationStatusDto {
                permission: NotificationPermission::Granted,
                can_request: false,
                reason: "allowed".into(),
                ..self.0.clone()
            })
        }
        fn open_settings(&self) -> Result<(), String> {
            Ok(())
        }
    }

    fn status(permission: NotificationPermission) -> NotificationStatusDto {
        NotificationStatusDto {
            platform: "test".into(),
            permission,
            reason: "reason".into(),
            can_request: permission == NotificationPermission::Prompt,
            can_open_settings: true,
            settings_scope: "notifications".into(),
        }
    }

    #[test]
    fn only_prompt_state_requests_permission() {
        assert_eq!(
            request_notification_permission_fn(&FakePlatform(status(
                NotificationPermission::Prompt
            )))
            .unwrap()
            .permission,
            NotificationPermission::Granted
        );
        assert_eq!(
            request_notification_permission_fn(&FakePlatform(status(
                NotificationPermission::Denied
            )))
            .unwrap()
            .permission,
            NotificationPermission::Denied
        );
    }

    #[derive(Default)]
    struct FakeTransport(Mutex<Vec<(String, String)>>);
    impl NotificationTransport for FakeTransport {
        fn submit(&self, title: &str, body: &str) -> Result<(), String> {
            self.0.lock().unwrap().push((title.into(), body.into()));
            Ok(())
        }
    }

    #[test]
    fn test_submission_uses_shared_transport_and_truthful_copy() {
        let transport = FakeTransport::default();
        let result = send_test_notification_fn(&transport).unwrap();
        assert!(result.submitted);
        assert!(result
            .message
            .contains("submitted to the notification service"));
        assert!(result.message.contains("delivery is not guaranteed"));
        assert!(result.message.contains("Focus or Do Not Disturb"));
        assert_eq!(
            transport.0.lock().unwrap().as_slice(),
            &[("Jin".into(), "Notifications are working.".into())]
        );
    }

    #[test]
    fn native_submission_result_only_succeeds_when_service_accepts_request() {
        assert_eq!(
            native_submission_result::<u32, &str>(Ok(42), "native service"),
            Ok(())
        );
        assert_eq!(
            native_submission_result::<(), _>(Err("connection refused"), "native service")
                .unwrap_err(),
            "native service rejected notification submission: connection refused"
        );
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_delivery_only_accepts_nil_error_completion() {
        assert_eq!(
            reconcile_mac_delivery_completion(MacDeliveryCompletion::Completed(None)),
            Ok(())
        );
        assert!(
            reconcile_mac_delivery_completion(MacDeliveryCompletion::TimedOut)
                .unwrap_err()
                .contains("timed out")
        );
        assert!(
            reconcile_mac_delivery_completion(MacDeliveryCompletion::Disconnected)
                .unwrap_err()
                .contains("without a completion result")
        );
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_delivery_error_preserves_nserror_context() {
        let result = reconcile_mac_delivery_completion(MacDeliveryCompletion::Completed(Some(
            MacNativeError {
                domain: "UNErrorDomain".into(),
                code: 17,
                localized_description: "request rejected".into(),
            },
        )))
        .unwrap_err();
        assert!(result.contains("NSError domain=UNErrorDomain code=17"));
        assert!(result.contains("localizedDescription=request rejected"));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_delegate_completes_foreground_and_response_handlers_exactly_once() {
        use block2::RcBlock;
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Mutex,
        };

        let foreground_calls = Arc::new(AtomicUsize::new(0));
        let observed_options = Arc::new(Mutex::new(None));
        let calls = Arc::clone(&foreground_calls);
        let observed = Arc::clone(&observed_options);
        let foreground = RcBlock::new(move |options: UNNotificationPresentationOptions| {
            calls.fetch_add(1, Ordering::SeqCst);
            *observed.lock().unwrap() = Some(options);
        });
        complete_will_present(&foreground);
        assert_eq!(foreground_calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            *observed_options.lock().unwrap(),
            Some(
                UNNotificationPresentationOptions::Banner
                    | UNNotificationPresentationOptions::List
                    | UNNotificationPresentationOptions::Sound
            )
        );

        let response_calls = Arc::new(AtomicUsize::new(0));
        let calls = Arc::clone(&response_calls);
        let response = RcBlock::new(move || {
            calls.fetch_add(1, Ordering::SeqCst);
        });
        complete_notification_response(&response);
        assert_eq!(response_calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_delegate_lifecycle_installs_once_and_preserves_foreign_owner() {
        assert_eq!(
            notification_delegate_slot_decision(false, false),
            NotificationDelegateSlotDecision::Install
        );
        assert_eq!(
            notification_delegate_slot_decision(true, true),
            NotificationDelegateSlotDecision::ReuseOwned
        );
        assert_eq!(
            notification_delegate_slot_decision(false, true),
            NotificationDelegateSlotDecision::PreserveExisting
        );
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_delegate_installation_rejects_off_main_thread_without_mutation() {
        let outcome = std::thread::spawn(install_notification_center_delegate)
            .join()
            .unwrap();
        assert_eq!(
            outcome,
            NotificationDelegateInstallOutcome::SkippedOffMainThread
        );
    }

    #[test]
    fn delegate_collision_keeps_submission_truthful_and_explains_foreground_behavior() {
        let ordinary = test_notification_submission_message(false);
        assert!(ordinary.contains("submitted to the notification service"));
        assert!(ordinary.contains("delivery is not guaranteed"));
        assert!(!ordinary.contains("another notification delegate"));

        let collision = test_notification_submission_message(true);
        assert!(collision.contains("submitted to the notification service"));
        assert!(collision.contains("preserved another notification delegate"));
        assert!(collision.contains("controls foreground presentation"));
        assert!(collision.contains("Notification Center"));
        assert!(!collision.contains("delivered"));
    }

    #[test]
    fn compiled_settings_targets_are_exact() {
        #[cfg(target_os = "macos")]
        assert_eq!(
            MACOS_NOTIFICATION_SETTINGS_TARGET,
            "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
        );
        #[cfg(target_os = "windows")]
        assert_eq!(
            WINDOWS_NOTIFICATION_SETTINGS_TARGET,
            "ms-settings:notifications"
        );
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_native_status_mapping_is_truthful() {
        use objc2_user_notifications::UNAuthorizationStatus as Status;
        let prompt = mac_status(Status::NotDetermined);
        assert_eq!(prompt.permission, NotificationPermission::Prompt);
        assert!(prompt.can_request);
        let denied = mac_status(Status::Denied);
        assert_eq!(denied.permission, NotificationPermission::Denied);
        assert!(!denied.can_request);
        for native in [Status::Authorized, Status::Provisional, Status::Ephemeral] {
            assert_eq!(
                mac_status(native).permission,
                NotificationPermission::Granted
            );
        }
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_permission_reread_granted_wins_over_callback_error_or_timeout() {
        let error = MacNativeError {
            domain: "UNErrorDomain".into(),
            code: 1,
            localized_description: "native failure".into(),
        };
        for outcome in [
            MacPermissionCallbackOutcome::Completed {
                granted: false,
                error: Some(error),
            },
            MacPermissionCallbackOutcome::TimedOut,
        ] {
            let reconciled = reconcile_mac_permission_request(
                outcome,
                Ok(status(NotificationPermission::Granted)),
            )
            .unwrap();
            assert_eq!(reconciled.permission, NotificationPermission::Granted);
        }
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_permission_false_without_error_and_denied_is_normal() {
        let reconciled = reconcile_mac_permission_request(
            MacPermissionCallbackOutcome::Completed {
                granted: false,
                error: None,
            },
            Ok(status(NotificationPermission::Denied)),
        )
        .unwrap();
        assert_eq!(reconciled.permission, NotificationPermission::Denied);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_permission_inconclusive_error_preserves_native_and_status_context() {
        let result = reconcile_mac_permission_request(
            MacPermissionCallbackOutcome::Completed {
                granted: false,
                error: Some(MacNativeError {
                    domain: "UNErrorDomain".into(),
                    code: 7,
                    localized_description: "request rejected".into(),
                }),
            },
            Ok(status(NotificationPermission::Denied)),
        )
        .unwrap_err();
        assert!(result.contains("NSError domain=UNErrorDomain code=7"));
        assert!(result.contains("localizedDescription=request rejected"));
        assert!(result.contains("re-read status=denied (reason)"));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_permission_timeout_preserves_reread_failure() {
        let result = reconcile_mac_permission_request(
            MacPermissionCallbackOutcome::TimedOut,
            Err("settings callback also timed out".into()),
        )
        .unwrap_err();
        assert!(result.contains("callback timed out"));
        assert!(result.contains("settings callback also timed out"));
    }
}
