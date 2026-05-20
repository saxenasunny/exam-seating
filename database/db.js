/**
 * Database module using sql.js (pure JS SQLite - no native bindings required)
 * Persists to a .sqlite file on disk via fs operations
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'seating.sqlite');

let db = null;
let isDirty = false;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  setupSchema();
  seedAdmin();
  setInterval(() => { if (isDirty) { saveToDisk(); isDirty = false; } }, 3000);
  return db;
}

function saveToDisk() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function markDirty() { isDirty = true; }

function setupSchema() {
  db.run(`CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS seating_uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_date TEXT NOT NULL,
    session TEXT NOT NULL,
    file_name TEXT NOT NULL,
    total_students INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    uploaded_at TEXT DEFAULT (datetime('now')),
    uploaded_by TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS seating_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    upload_id INTEGER NOT NULL,
    enrollment TEXT NOT NULL,
    room_number TEXT NOT NULL,
    row_number TEXT,
    seat_number INTEGER,
    sheet_name TEXT,
    FOREIGN KEY(upload_id) REFERENCES seating_uploads(id) ON DELETE CASCADE
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_enrollment ON seating_records(enrollment, upload_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_upload_date ON seating_uploads(exam_date, active)`);
  db.run(`CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS upload_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    upload_id INTEGER,
    action TEXT NOT NULL,
    details TEXT,
    performed_by TEXT,
    performed_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES
    ('not_found_message','Your seating plan is currently unavailable. Please contact the Examination Cell.'),
    ('portal_title','Exam Seating Plan Portal'),
    ('institution_name','University Examination Cell'),
    ('contact_info','examination@university.edu | +91-XXXXXXXXXX')`);
  saveToDisk();
}

function seedAdmin() {
  const bcrypt = require('bcryptjs');
  const res = db.exec("SELECT COUNT(*) FROM admins");
  const count = res[0]?.values[0][0] || 0;
  if (count === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.run("INSERT INTO admins (username, password_hash) VALUES (?, ?)", ['admin', hash]);
    saveToDisk();
    console.log('\u2705 Default admin: username=admin  password=admin123');
  }
}

function run(sql, params = []) { db.run(sql, params); markDirty(); }

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) { return all(sql, params)[0] || null; }

function lastId() {
  const r = db.exec("SELECT last_insert_rowid()");
  return r[0]?.values[0][0];
}

module.exports = { getDb, run, all, get, lastId, saveToDisk, markDirty };
