//! Cáscara de escritorio de Cuadra. Solo expone SQL sobre una conexión única y un diálogo de guardado;
//! la lógica de negocio vive en TypeScript (ADR-1).

mod db;

use db::{DbError, DbInfo, DbState, JsonRow, RunResult};
use serde_json::Value;
use std::path::PathBuf;
use tauri::{ipc::Response, Manager, State};
use tauri_plugin_dialog::DialogExt;

fn no_connection() -> DbError {
    DbError::msg("la base no está abierta (falta db_open)")
}

fn lock_error() -> DbError {
    DbError::msg("la conexión SQLite quedó inutilizable")
}

fn with_conn<T>(state: &State<'_, DbState>, f: impl FnOnce(&rusqlite::Connection) -> Result<T, DbError>) -> Result<T, DbError> {
    let guard = state.conn.lock().map_err(|_| lock_error())?;
    let conn = guard.as_ref().ok_or_else(no_connection)?;
    f(conn)
}

#[tauri::command]
async fn db_open(app: tauri::AppHandle, state: State<'_, DbState>) -> Result<DbInfo, DbError> {
    let mut guard = state.conn.lock().map_err(|_| lock_error())?;
    let mut path_guard = state.path.lock().map_err(|_| lock_error())?;
    if guard.is_none() {
        let dir = app.path().app_data_dir().map_err(|e| DbError::msg(e.to_string()))?;
        let path = dir.join("cuadra.sqlite3");
        *guard = Some(db::open_connection(&path)?);
        *path_guard = Some(path);
    }
    let path = path_guard.as_ref().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    db::info(guard.as_ref().ok_or_else(no_connection)?, &path)
}

#[tauri::command]
async fn db_all(state: State<'_, DbState>, sql: String, params: Option<Value>) -> Result<Vec<JsonRow>, DbError> {
    with_conn(&state, |c| db::all(c, &sql, &params.unwrap_or(Value::Null)))
}

#[tauri::command]
async fn db_run(state: State<'_, DbState>, sql: String, params: Option<Value>) -> Result<RunResult, DbError> {
    with_conn(&state, |c| db::run(c, &sql, &params.unwrap_or(Value::Null)))
}

#[tauri::command]
async fn db_run_many(state: State<'_, DbState>, sql: String, rows: Vec<Value>) -> Result<RunResult, DbError> {
    with_conn(&state, |c| db::run_many(c, &sql, &rows))
}

#[tauri::command]
async fn db_exec(state: State<'_, DbState>, sql: String) -> Result<(), DbError> {
    with_conn(&state, |c| db::exec(c, &sql))
}

/// Devuelve los bytes crudos (llegan a JS como ArrayBuffer, sin pasar por JSON).
#[tauri::command]
async fn db_export(app: tauri::AppHandle, state: State<'_, DbState>) -> Result<Response, DbError> {
    let tmp: PathBuf = app
        .path()
        .app_cache_dir()
        .map_err(|e| DbError::msg(e.to_string()))?
        .join("tmp");
    with_conn(&state, |c| db::export(c, &tmp)).map(Response::new)
}

/// Cierra la conexión (checkpoint del WAL). Una nueva llamada a db_open la reabre.
#[tauri::command]
async fn db_close(state: State<'_, DbState>) -> Result<(), DbError> {
    let mut guard = state.conn.lock().map_err(|_| lock_error())?;
    if let Some(conn) = guard.take() {
        db::checkpoint(&conn)?;
    }
    Ok(())
}

/// Diálogo nativo «Guardar como» y escritura del archivo. Devuelve la ruta elegida o `None` si se cancela.
#[tauri::command]
async fn save_file(app: tauri::AppHandle, suggested_name: String, data: Vec<u8>) -> Result<Option<String>, DbError> {
    let picked = app.dialog().file().set_file_name(&suggested_name).blocking_save_file();
    let Some(file) = picked else { return Ok(None) };
    let path = file.into_path().map_err(|e| DbError::msg(e.to_string()))?;
    std::fs::write(&path, data)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(DbState::default())
        .invoke_handler(tauri::generate_handler![
            db_open,
            db_all,
            db_run,
            db_run_many,
            db_exec,
            db_export,
            db_close,
            save_file
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar Cuadra");
}
