use clinicians_veil_core::{AppBuildInfo, BuildChannel};
use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};

mod privacy;

const ABOUT_MENU_ID: &str = "about";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildInfoView {
    version: String,
    build_number: String,
    revision: String,
    is_release: bool,
    display_version: String,
}

#[tauri::command]
fn build_info() -> BuildInfoView {
    let is_release = env!("CLINICIANS_VEIL_BUILD_CHANNEL") == "release";
    let info = AppBuildInfo {
        version: env!("CARGO_PKG_VERSION").into(),
        build_number: env!("CLINICIANS_VEIL_BUILD_NUMBER").into(),
        revision: env!("CLINICIANS_VEIL_REVISION").into(),
        channel: if is_release {
            BuildChannel::Release
        } else {
            BuildChannel::Development
        },
    };

    BuildInfoView {
        version: info.version.clone(),
        build_number: info.build_number.clone(),
        revision: info.revision.clone(),
        is_release,
        display_version: info.display_version(),
    }
}

fn application_menu(app: &tauri::App) -> tauri::Result<Menu<tauri::Wry>> {
    let about = MenuItem::with_id(
        app,
        ABOUT_MENU_ID,
        "About Clinician’s Veil",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let hide = PredefinedMenuItem::hide(app, None)?;
    let hide_others = PredefinedMenuItem::hide_others(app, None)?;
    let show_all = PredefinedMenuItem::show_all(app, None)?;
    let quit = PredefinedMenuItem::quit(app, None)?;
    let app_submenu = Submenu::with_items(
        app,
        "Clinician’s Veil",
        true,
        &[
            &about,
            &separator,
            &hide,
            &hide_others,
            &show_all,
            &separator,
            &quit,
        ],
    )?;

    let close = PredefinedMenuItem::close_window(app, None)?;
    let file_submenu = Submenu::with_items(app, "File", true, &[&close])?;
    let edit_submenu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    Menu::with_items(app, &[&app_submenu, &file_submenu, &edit_submenu])
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            build_info,
            privacy::model_status,
            privacy::install_model,
            privacy::cancel_operation,
            privacy::discard_session,
            privacy::detect_text,
            privacy::review_decision,
            privacy::split_detection,
            privacy::add_manual_detection,
            privacy::rescan_text,
            privacy::copy_reviewed_text
        ])
        .setup(|app| {
            app.manage(privacy::PrivacyState::new(
                app.path().app_data_dir()?.join("models"),
            ));
            let menu = application_menu(app)?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let _ = window.state::<privacy::PrivacyState>().discard();
            }
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == ABOUT_MENU_ID {
                let _ = app.emit("show-about", ());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Clinician’s Veil");
}
