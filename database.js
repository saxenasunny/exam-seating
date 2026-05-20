/**
 * Database initialization and schema setup
 * Uses better-sqlite3 for fast synchronous SQLite access
 */

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'db', 'seating.db');

// Ensure db directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Initialize all tables and default data
 */
function initDatabase() {
  db.exec(`
    -- Admin users table
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Seating plan upload records
    CREATE TABLE IF NOT EXISTS seating_uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_date TEXT NOT NULL,
      session TEXT NOT NULL CHECK(session IN ('Morning', 'Evening')),
      file_name TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      total_students INTEGER DEFAULT 0,
      total_rooms INTEGER DEFAULT 0,
      uploaded_by TEXT,
      uploaded_at TEXT DEFAULT (datetime('now'))
    );

    -- Individual seating records (parsed from Excel)
    CREATE TABLE IF NOT EXISTS seating_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      upload_id INTEGER NOT NULL,
      enrollment TEXT NOT NULL,
      room_number TEXT NOT NULL,
      row_number TEXT,
      seat_number INTEGER,
      sheet_name TEXT,
      FOREIGN KEY (upload_id) REFERENCES seating_uploads(id) ON DELETE CASCADE
    );

    -- System settings (key-value store)
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Upload activity logs
    CREATE TABLE IF NOT EXISTS upload_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      upload_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      performed_by TEXT,
      performed_at TEXT DEFAULT (datetime('now'))
    );

    -- Create indexes for fast student search
    CREATE INDEX IF NOT EXISTS idx_seating_enrollment ON seating_records(enrollment);
    CREATE INDEX IF NOT EXISTS idx_seating_upload_id ON seating_records(upload_id);
    CREATE INDEX IF NOT EXISTS idx_uploads_date ON seating_uploads(exam_date);
    CREATE INDEX IF NOT EXISTS idx_uploads_active ON seating_uploads(active);
  `);

  // Insert default admin if not exists
  const existingAdmin = db.prepare('SELECT id FROM admins WHERE username = ?').get('admin');
  if (!existingAdmin) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run('admin', hash);
    console.log('✅ Default admin created: admin / admin123');
  }

  // Insert default system settings
  const defaultSettings = [
    ['not_found_message', 'Your seating plan is currently unavailable. Please contact the Examination Cell.'],
    ['college_name', 'University Examination Management System'],
    ['exam_title', 'End Term Examinations'],
  ];

  const upsertSetting = db.prepare(`
    INSERT INTO system_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `);

  for (const [key, value] of defaultSettings) {
    upsertSetting.run(key, value);
  }

  console.log('✅ Database initialized successfully');
}

initDatabase();

module.exports = db;
