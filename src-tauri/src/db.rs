//! Conexión SQLite única para el escritorio. Recibe el MISMO SQL que el núcleo envía al worker WASM;
//! aquí no hay reglas de negocio (ARCHITECTURE.md 7.3). Las funciones libres trabajan sobre `&Connection`
//! para poder probarlas sin Tauri; `DbState` solo guarda la conexión detrás de un `Mutex`.

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, Statement};
use serde::Serialize;
use serde_json::{Map, Number, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Error serializable que llega a JS como `{ message, code }` (code = código extendido de SQLite).
#[derive(Debug, Serialize)]
pub struct DbError {
    pub message: String,
    pub code: Option<i32>,
}

impl DbError {
    pub fn msg(message: impl Into<String>) -> Self {
        DbError { message: message.into(), code: None }
    }
}

impl From<rusqlite::Error> for DbError {
    fn from(err: rusqlite::Error) -> Self {
        let code = match &err {
            rusqlite::Error::SqliteFailure(e, _) => Some(e.extended_code),
            rusqlite::Error::SqlInputError { error, .. } => Some(error.extended_code),
            _ => None,
        };
        // Para los RAISE(ABORT, '<codigo>') de los triggers el mensaje es exactamente el código.
        let message = match &err {
            rusqlite::Error::SqliteFailure(_, Some(m)) => m.clone(),
            rusqlite::Error::SqlInputError { msg, .. } => msg.clone(),
            other => other.to_string(),
        };
        DbError { message, code }
    }
}

impl From<std::io::Error> for DbError {
    fn from(err: std::io::Error) -> Self {
        DbError::msg(err.to_string())
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct DbInfo {
    pub sqlite_version: String,
    pub path: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct RunResult {
    pub changes: usize,
}

pub type JsonRow = Map<String, Value>;

/// Conexión única, abierta de forma perezosa por `db_open`.
#[derive(Default)]
pub struct DbState {
    pub conn: Mutex<Option<Connection>>,
    pub path: Mutex<Option<PathBuf>>,
}

/// Abre (o crea) la base con las pragmas de Cuadra.
pub fn open_connection(path: &Path) -> Result<Connection, DbError> {
    if let Some(dir) = path.parent() {
        if !dir.as_os_str().is_empty() {
            std::fs::create_dir_all(dir)?;
        }
    }
    let conn = Connection::open(path)?;
    configure(&conn)?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_memory() -> Result<Connection, DbError> {
    let conn = Connection::open_in_memory()?;
    configure(&conn)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> Result<(), DbError> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    // journal_mode devuelve una fila; en memoria queda en "memory" y es correcto.
    conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))?;
    conn.busy_timeout(std::time::Duration::from_millis(3000))?;
    Ok(())
}

pub fn info(conn: &Connection, path: &str) -> Result<DbInfo, DbError> {
    let sqlite_version: String = conn.query_row("SELECT sqlite_version()", [], |r| r.get(0))?;
    Ok(DbInfo { sqlite_version, path: path.to_string() })
}

/// Parámetro JSON → valor SQLite. number entero → INTEGER, otro number → REAL, array de bytes → BLOB.
pub fn to_sql_value(v: &Value) -> Result<SqlValue, DbError> {
    Ok(match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else if let Some(f) = n.as_f64() {
                SqlValue::Real(f)
            } else {
                return Err(DbError::msg(format!("número fuera de rango: {n}")));
            }
        }
        Value::String(s) => SqlValue::Text(s.clone()),
        Value::Array(items) => {
            let mut bytes = Vec::with_capacity(items.len());
            for item in items {
                let byte = item
                    .as_u64()
                    .and_then(|n| u8::try_from(n).ok())
                    .ok_or_else(|| DbError::msg("un arreglo de parámetro debe ser una lista de bytes"))?;
                bytes.push(byte);
            }
            SqlValue::Blob(bytes)
        }
        Value::Object(_) => return Err(DbError::msg("parámetro de tipo objeto no soportado")),
    })
}

pub fn from_value_ref(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Value::Array(b.iter().map(|x| Value::Number((*x).into())).collect()),
    }
}

/// Enlaza posicionales (array) o con nombre (objeto, con o sin prefijo `:`/`@`/`$`).
fn bind(stmt: &mut Statement<'_>, params: &Value) -> Result<(), DbError> {
    match params {
        Value::Null => Ok(()),
        Value::Array(items) => {
            for (i, item) in items.iter().enumerate() {
                stmt.raw_bind_parameter(i + 1, to_sql_value(item)?)?;
            }
            Ok(())
        }
        Value::Object(map) => {
            for (name, item) in map {
                let bare = name.trim_start_matches([':', '@', '$']);
                let index = [":", "@", "$"]
                    .iter()
                    .find_map(|prefix| {
                        stmt.parameter_index(&format!("{prefix}{bare}")).ok().flatten()
                    })
                    .ok_or_else(|| DbError::msg(format!("parámetro con nombre desconocido: {name}")))?;
                stmt.raw_bind_parameter(index, to_sql_value(item)?)?;
            }
            Ok(())
        }
        _ => Err(DbError::msg("los parámetros deben ser un arreglo o un objeto")),
    }
}

pub fn all(conn: &Connection, sql: &str, params: &Value) -> Result<Vec<JsonRow>, DbError> {
    let mut stmt = conn.prepare(sql)?;
    bind(&mut stmt, params)?;
    let names: Vec<String> = stmt.column_names().into_iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.raw_query();
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut map = JsonRow::new();
        for (i, name) in names.iter().enumerate() {
            map.insert(name.clone(), from_value_ref(row.get_ref(i)?));
        }
        out.push(map);
    }
    Ok(out)
}

pub fn run(conn: &Connection, sql: &str, params: &Value) -> Result<RunResult, DbError> {
    let mut stmt = conn.prepare(sql)?;
    bind(&mut stmt, params)?;
    let changes = stmt.raw_execute()?;
    Ok(RunResult { changes })
}

/// Atómico: un SAVEPOINT envuelve todas las filas (como `runMany` de los otros adaptadores).
pub fn run_many(conn: &Connection, sql: &str, rows: &[Value]) -> Result<RunResult, DbError> {
    conn.execute_batch("SAVEPOINT cuadra_run_many")?;
    let result = (|| -> Result<usize, DbError> {
        let mut stmt = conn.prepare(sql)?;
        let mut changes = 0;
        for params in rows {
            bind(&mut stmt, params)?;
            changes += stmt.raw_execute()?;
        }
        Ok(changes)
    })();
    match result {
        Ok(changes) => {
            conn.execute_batch("RELEASE cuadra_run_many")?;
            Ok(RunResult { changes })
        }
        Err(err) => {
            let _ = conn.execute_batch("ROLLBACK TO cuadra_run_many; RELEASE cuadra_run_many");
            Err(err)
        }
    }
}

/// Varias sentencias sin parámetros (migraciones, BEGIN IMMEDIATE, COMMIT, ROLLBACK).
pub fn exec(conn: &Connection, sql: &str) -> Result<(), DbError> {
    conn.execute_batch(sql)?;
    Ok(())
}

/// Archivo SQLite completo: VACUUM INTO a un temporal y lectura.
pub fn export(conn: &Connection, tmp_dir: &Path) -> Result<Vec<u8>, DbError> {
    std::fs::create_dir_all(tmp_dir)?;
    let target = tmp_dir.join(format!("cuadra-export-{}.sqlite3", std::process::id()));
    let _ = std::fs::remove_file(&target);
    let literal = target.to_string_lossy().replace('\'', "''");
    let result = conn
        .execute_batch(&format!("VACUUM INTO '{literal}'"))
        .map_err(DbError::from)
        .and_then(|()| std::fs::read(&target).map_err(DbError::from));
    let _ = std::fs::remove_file(&target);
    result
}

/// Pasa el WAL al archivo principal (al cerrar).
pub fn checkpoint(conn: &Connection) -> Result<(), DbError> {
    conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const INIT_SQL: &str = include_str!("../../src/data/migrations/001_init.sql");

    fn migrated() -> Connection {
        let conn = open_memory().expect("open");
        exec(&conn, INIT_SQL).expect("001_init.sql");
        conn
    }

    #[test]
    fn migration_creates_schema_and_sqlite_is_recent() {
        let conn = migrated();
        let i = info(&conn, ":memory:").unwrap();
        assert!(i.sqlite_version.starts_with("3."), "{}", i.sqlite_version);
        let rows = all(&conn, "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'", &Value::Null).unwrap();
        assert!(rows[0]["n"].as_i64().unwrap() > 5);
        let fk = all(&conn, "PRAGMA foreign_keys", &Value::Null).unwrap();
        assert_eq!(fk[0]["foreign_keys"], json!(1));
    }

    #[test]
    fn insert_and_read_back() {
        let conn = migrated();
        let tables = all(&conn, "SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces'", &Value::Null).unwrap();
        assert_eq!(tables.len(), 1, "se espera la tabla workspaces");
        let cols = all(&conn, "SELECT name, \"notnull\" AS nn, dflt_value FROM pragma_table_info('workspaces')", &Value::Null).unwrap();
        // Rellena solo las columnas NOT NULL sin valor por defecto, con texto, para no depender del esquema exacto.
        let required: Vec<&str> = cols
            .iter()
            .filter(|c| c["nn"] == json!(1) && c["dflt_value"].is_null())
            .map(|c| c["name"].as_str().unwrap())
            .collect();
        let sql = format!(
            "INSERT INTO workspaces ({}) VALUES ({})",
            required.join(", "),
            required.iter().map(|_| "?").collect::<Vec<_>>().join(", ")
        );
        let params = Value::Array(required.iter().map(|n| fill(&conn, n)).collect());
        let res = run(&conn, &sql, &params);
        let res = res.unwrap_or_else(|e| panic!("insert falló: {} ({:?}) sql={sql}", e.message, e.code));
        assert_eq!(res, RunResult { changes: 1 });
        let back = all(&conn, "SELECT count(*) AS n FROM workspaces", &Value::Null).unwrap();
        assert_eq!(back[0]["n"], json!(1));
    }

    /// Valor de prueba según el nombre de la columna (el esquema puede cambiar sin romper la prueba).
    fn fill(_conn: &Connection, name: &str) -> Value {
        match name {
            n if n.ends_with("_at") => json!("2026-01-01T00:00:00.000Z"),
            n if n.contains("version") || n.ends_with("_minor") || n == "decimals" => json!(1),
            "currency" => json!("DOP"),
            _ => json!(format!("valor-{name}")),
        }
    }

    #[test]
    fn typed_values_round_trip() {
        let conn = open_memory().unwrap();
        exec(&conn, "CREATE TABLE t (i INTEGER, r REAL, s TEXT, b BLOB, n)").unwrap();
        let big: i64 = 9_007_199_254_740_991;
        run(&conn, "INSERT INTO t VALUES (?, ?, ?, ?, ?)", &json!([big, 1.5, "ñandú", [0, 1, 255], null])).unwrap();
        let rows = all(&conn, "SELECT * FROM t", &Value::Null).unwrap();
        assert_eq!(rows[0]["i"], json!(big));
        assert_eq!(rows[0]["r"], json!(1.5));
        assert_eq!(rows[0]["s"], json!("ñandú"));
        assert_eq!(rows[0]["b"], json!([0, 1, 255]));
        assert_eq!(rows[0]["n"], Value::Null);
    }

    #[test]
    fn named_params_work_with_and_without_prefix() {
        let conn = open_memory().unwrap();
        exec(&conn, "CREATE TABLE t (a, b)").unwrap();
        run(&conn, "INSERT INTO t VALUES (:a, @b)", &json!({"a": 1, ":b": 2})).unwrap();
        let rows = all(&conn, "SELECT a, b FROM t WHERE a = $x", &json!({"x": 1})).unwrap();
        assert_eq!(rows[0]["b"], json!(2));
    }

    #[test]
    fn run_many_is_atomic() {
        let conn = open_memory().unwrap();
        exec(&conn, "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)").unwrap();
        let ok = run_many(&conn, "INSERT INTO t VALUES (?, ?)", &[json!([1, "a"]), json!([2, "b"])]).unwrap();
        assert_eq!(ok.changes, 2);
        let err = run_many(&conn, "INSERT INTO t VALUES (?, ?)", &[json!([3, "c"]), json!([3, "dup"])]).unwrap_err();
        assert!(err.code.is_some());
        let n = all(&conn, "SELECT count(*) AS n FROM t", &Value::Null).unwrap();
        assert_eq!(n[0]["n"], json!(2), "la fila 3 debe haberse deshecho");
    }

    #[test]
    fn explicit_transaction_rolls_back() {
        let conn = open_memory().unwrap();
        exec(&conn, "CREATE TABLE t (v)").unwrap();
        exec(&conn, "BEGIN IMMEDIATE").unwrap();
        run(&conn, "INSERT INTO t VALUES (1)", &Value::Null).unwrap();
        exec(&conn, "ROLLBACK").unwrap();
        assert_eq!(all(&conn, "SELECT count(*) AS n FROM t", &Value::Null).unwrap()[0]["n"], json!(0));
    }

    #[test]
    fn errors_carry_message_and_code() {
        let conn = open_memory().unwrap();
        exec(&conn, "CREATE TABLE t (id INTEGER PRIMARY KEY)").unwrap();
        run(&conn, "INSERT INTO t VALUES (1)", &Value::Null).unwrap();
        let err = run(&conn, "INSERT INTO t VALUES (1)", &Value::Null).unwrap_err();
        assert_eq!(err.code, Some(1555)); // SQLITE_CONSTRAINT_PRIMARYKEY
        let syntax = all(&conn, "SELEC 1", &Value::Null).unwrap_err();
        assert!(syntax.code.is_some());
    }

    #[test]
    fn trigger_raise_message_is_the_bare_code() {
        let conn = open_memory().unwrap();
        exec(
            &conn,
            "CREATE TABLE t (id); CREATE TRIGGER no_del BEFORE DELETE ON t BEGIN SELECT RAISE(ABORT, 'delete_forbidden'); END; INSERT INTO t VALUES (1);",
        )
        .unwrap();
        let err = run(&conn, "DELETE FROM t", &Value::Null).unwrap_err();
        assert_eq!(err.message, "delete_forbidden");
    }

    #[test]
    fn export_returns_a_sqlite_file_that_reopens() {
        let dir = std::env::temp_dir().join("cuadra-rs-test");
        let path = dir.join(format!("src-{}.sqlite3", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let conn = open_connection(&path).unwrap();
        exec(&conn, INIT_SQL).unwrap();
        run(&conn, "CREATE TABLE extra (v)", &Value::Null).unwrap();
        let bytes = export(&conn, &dir).unwrap();
        assert!(bytes.starts_with(b"SQLite format 3\0"));
        let copy = dir.join(format!("copy-{}.sqlite3", std::process::id()));
        std::fs::write(&copy, &bytes).unwrap();
        let reopened = open_connection(&copy).unwrap();
        let n = all(&reopened, "SELECT count(*) AS n FROM sqlite_master WHERE name = 'extra'", &Value::Null).unwrap();
        assert_eq!(n[0]["n"], json!(1));
        checkpoint(&conn).unwrap();
        drop((conn, reopened));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn wal_is_enabled_on_files() {
        let dir = std::env::temp_dir().join("cuadra-rs-wal");
        let path = dir.join(format!("w-{}.sqlite3", std::process::id()));
        let conn = open_connection(&path).unwrap();
        let mode = all(&conn, "PRAGMA journal_mode", &Value::Null).unwrap();
        assert_eq!(mode[0]["journal_mode"], json!("wal"));
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
