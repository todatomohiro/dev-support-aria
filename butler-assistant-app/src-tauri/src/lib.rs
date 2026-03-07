use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

/// フロントエンドに送信する PTY 出力イベント
#[derive(Clone, Serialize)]
struct PtyOutputEvent {
    session_id: String,
    data: Vec<u8>,
}

/// PTY セッションの書き込み側を保持
struct PtySession {
    writer: Box<dyn Write + Send>,
}

/// アプリ全体で PTY セッションを管理
struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

/// PTY セッションを作成してシェルを起動する
#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    manager: State<PtyManager>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<String, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("PTY open failed: {e}"))?;

    let mut cmd = CommandBuilder::new_default_prog();
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Spawn failed: {e}"))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Clone reader failed: {e}"))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Take writer failed: {e}"))?;

    let session = PtySession { writer };

    manager
        .sessions
        .lock()
        .map_err(|e| format!("Lock failed: {e}"))?
        .insert(session_id.clone(), session);

    // 別スレッドで PTY 出力を読み取り、Tauri イベントとして送信
    let sid = session_id.clone();
    std::thread::spawn(move || {
        let _child = child; // child の所有権をスレッドに移動（drop でプロセス終了を検知）
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let _ = app.emit(
                        "pty-output",
                        PtyOutputEvent {
                            session_id: sid.clone(),
                            data: buf[..n].to_vec(),
                        },
                    );
                }
                Err(_) => break,
            }
        }
        // セッション終了を通知
        let _ = app.emit(
            "pty-exit",
            PtyOutputEvent {
                session_id: sid,
                data: vec![],
            },
        );
    });

    Ok(session_id)
}

/// PTY にデータを書き込む（ユーザー入力）
#[tauri::command]
fn pty_write(manager: State<PtyManager>, session_id: String, data: String) -> Result<(), String> {
    let mut sessions = manager
        .sessions
        .lock()
        .map_err(|e| format!("Lock failed: {e}"))?;

    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("Session not found: {session_id}"))?;

    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write error: {e}"))?;

    session
        .writer
        .flush()
        .map_err(|e| format!("Flush error: {e}"))?;

    Ok(())
}

/// PTY セッションを終了する
#[tauri::command]
fn pty_kill(manager: State<PtyManager>, session_id: String) -> Result<(), String> {
    let mut sessions = manager
        .sessions
        .lock()
        .map_err(|e| format!("Lock failed: {e}"))?;

    sessions.remove(&session_id);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .manage(PtyManager {
            sessions: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![pty_spawn, pty_write, pty_kill])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
