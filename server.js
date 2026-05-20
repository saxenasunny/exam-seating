/**
 * Exam Seating Plan Management Platform
 * Backend: Node.js + Express + sql.js (SQLite)
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const { getDb, run, all, get, lastId, saveToDisk } = require('./database/db');
const { parseExcelFile } = require('./parseExcel');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'examseating_jwt_secret_change_in_production';

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── File Upload Config ────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ts = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${ts}_${safeName}`);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) cb(null, true);
    else cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
  },
  limits: { fileSize: 20 * 1024 * 1024 } // 20 MB
});

// ─── Auth Middleware ───────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'Authorization header missing' });
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── STUDENT API ──────────────────────────────────────────────────────────────

/**
 * GET /api/search?enrollment=XXX&date=YYYY-MM-DD
 * Public: No auth required
 * Returns seating info for a given enrollment number
 */
app.get('/api/search', (req, res) => {
  const { enrollment, date } = req.query;
  if (!enrollment || !enrollment.trim()) {
    return res.status(400).json({ error: 'Enrollment number is required' });
  }

  const enroll = enrollment.trim().toUpperCase();

  // Determine which date to search
  let searchDate;
  if (date && date.trim()) {
    // User provided a date — use it
    searchDate = date.trim();
  } else {
    // Use today's date in IST (India)
    const now = new Date();
    const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    searchDate = ist.toISOString().split('T')[0];
  }

  // Find active upload(s) for that date
  const uploads = all(
    `SELECT * FROM seating_uploads WHERE exam_date = ? AND active = 1 ORDER BY uploaded_at DESC`,
    [searchDate]
  );

  if (uploads.length === 0) {
    const msg = get(`SELECT value FROM system_settings WHERE key = 'not_found_message'`);
    return res.json({
      found: false,
      searchDate,
      message: msg ? msg.value : 'No active seating plan found for this date.'
    });
  }

  // Search across all active uploads for that date
  const uploadIds = uploads.map(u => u.id);
  const placeholders = uploadIds.map(() => '?').join(',');

  // Try exact match first, then case-insensitive
  let record = get(
    `SELECT r.*, u.exam_date, u.session FROM seating_records r
     JOIN seating_uploads u ON r.upload_id = u.id
     WHERE r.enrollment = ? AND r.upload_id IN (${placeholders})
     LIMIT 1`,
    [enroll, ...uploadIds]
  );

  if (!record) {
    // Try case-insensitive
    record = get(
      `SELECT r.*, u.exam_date, u.session FROM seating_records r
       JOIN seating_uploads u ON r.upload_id = u.id
       WHERE UPPER(r.enrollment) = ? AND r.upload_id IN (${placeholders})
       LIMIT 1`,
      [enroll, ...uploadIds]
    );
  }

  if (!record) {
    const msg = get(`SELECT value FROM system_settings WHERE key = 'not_found_message'`);
    return res.json({
      found: false,
      searchDate,
      enrollment: enroll,
      message: msg ? msg.value : 'Enrollment number not found in the seating plan.'
    });
  }

  return res.json({
    found: true,
    enrollment: record.enrollment,
    room_number: record.room_number,
    row_number: record.row_number,
    seat_number: record.seat_number,
    exam_date: record.exam_date,
    session: record.session,
    searchDate
  });
});

/**
 * GET /api/settings/public
 * Returns public settings (title, institution name, contact)
 */
app.get('/api/settings/public', (req, res) => {
  const rows = all(`SELECT key, value FROM system_settings WHERE key IN ('portal_title','institution_name','contact_info','not_found_message')`);
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  res.json(settings);
});

// ─── ADMIN AUTH ───────────────────────────────────────────────────────────────

/**
 * POST /api/admin/login
 */
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const admin = get(`SELECT * FROM admins WHERE username = ?`, [username.trim()]);
  if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = bcrypt.compareSync(password, admin.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, username: admin.username });
});

// ─── ADMIN ROUTES (all require auth) ─────────────────────────────────────────

/**
 * POST /api/admin/upload
 * Upload and parse an Excel seating plan
 */
app.post('/api/admin/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const { exam_date, session, active } = req.body;
    if (!exam_date || !session || !req.file) {
      return res.status(400).json({ error: 'exam_date, session, and file are required' });
    }

    const filePath = req.file.path;
    let parsed;
    try {
      parsed = parseExcelFile(filePath);
    } catch (parseErr) {
      fs.unlinkSync(filePath);
      return res.status(422).json({ error: `Failed to parse Excel: ${parseErr.message}` });
    }

    const { records, skippedSheets } = parsed;
    if (records.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(422).json({ error: 'No enrollment records found in the Excel file. Please check the file format.' });
    }

    // Check for duplicate enrollment in same date+session
    const existingUploads = all(
      `SELECT id FROM seating_uploads WHERE exam_date = ? AND session = ? AND active = 1`,
      [exam_date, session]
    );
    if (existingUploads.length > 0) {
      // Warn but allow — admin decision
    }

    // Insert upload record
    run(
      `INSERT INTO seating_uploads (exam_date, session, file_name, total_students, active, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [exam_date, session, req.file.originalname, records.length, active === '1' || active === true ? 1 : 0, req.admin.username]
    );
    const uploadId = lastId();

    // Batch insert records
    const BATCH = 500;
    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      for (const r of batch) {
        run(
          `INSERT INTO seating_records (upload_id, enrollment, room_number, row_number, seat_number, sheet_name)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [uploadId, r.enrollment, r.room_number, r.row_number, r.seat_number, r.sheet_name]
        );
      }
    }

    // Log upload
    run(
      `INSERT INTO upload_logs (upload_id, action, details, performed_by)
       VALUES (?, 'UPLOAD', ?, ?)`,
      [uploadId, `Parsed ${records.length} records from ${req.file.originalname}. Skipped: ${skippedSheets.join(', ')}`, req.admin.username]
    );

    saveToDisk();

    res.json({
      success: true,
      upload_id: uploadId,
      total_records: records.length,
      rooms: [...new Set(records.map(r => r.room_number))].length,
      skipped_sheets: skippedSheets,
      message: `Successfully uploaded ${records.length} seating records across ${[...new Set(records.map(r => r.room_number))].length} rooms.`
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/uploads
 * List all seating uploads
 */
app.get('/api/admin/uploads', authMiddleware, (req, res) => {
  const uploads = all(
    `SELECT u.*, COUNT(r.id) as student_count
     FROM seating_uploads u
     LEFT JOIN seating_records r ON r.upload_id = u.id
     GROUP BY u.id
     ORDER BY u.uploaded_at DESC`
  );
  res.json(uploads);
});

/**
 * PATCH /api/admin/uploads/:id/toggle
 * Activate / deactivate a seating plan
 */
app.patch('/api/admin/uploads/:id/toggle', authMiddleware, (req, res) => {
  const { id } = req.params;
  const upload = get(`SELECT * FROM seating_uploads WHERE id = ?`, [id]);
  if (!upload) return res.status(404).json({ error: 'Upload not found' });

  const newActive = upload.active === 1 ? 0 : 1;
  run(`UPDATE seating_uploads SET active = ? WHERE id = ?`, [newActive, id]);
  run(`INSERT INTO upload_logs (upload_id, action, details, performed_by) VALUES (?, ?, ?, ?)`,
    [id, newActive ? 'ACTIVATE' : 'DEACTIVATE', `Plan ${newActive ? 'activated' : 'deactivated'}`, req.admin.username]);
  saveToDisk();
  res.json({ success: true, active: newActive });
});

/**
 * DELETE /api/admin/uploads/:id
 * Delete a seating plan and all its records
 */
app.delete('/api/admin/uploads/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const upload = get(`SELECT * FROM seating_uploads WHERE id = ?`, [id]);
  if (!upload) return res.status(404).json({ error: 'Upload not found' });

  run(`DELETE FROM seating_records WHERE upload_id = ?`, [id]);
  run(`DELETE FROM seating_uploads WHERE id = ?`, [id]);
  run(`INSERT INTO upload_logs (upload_id, action, details, performed_by) VALUES (?, 'DELETE', ?, ?)`,
    [id, `Deleted plan: ${upload.file_name} (${upload.exam_date} ${upload.session})`, req.admin.username]);
  saveToDisk();
  res.json({ success: true });
});

/**
 * GET /api/admin/search?enrollment=XXX&date=YYYY-MM-DD
 * Admin manual student search (searches ALL plans, not just active)
 */
app.get('/api/admin/search', authMiddleware, (req, res) => {
  const { enrollment, date } = req.query;
  if (!enrollment) return res.status(400).json({ error: 'Enrollment required' });

  const enroll = enrollment.trim().toUpperCase();
  let query = `SELECT r.*, u.exam_date, u.session, u.active, u.file_name
               FROM seating_records r
               JOIN seating_uploads u ON r.upload_id = u.id
               WHERE UPPER(r.enrollment) = ?`;
  const params = [enroll];

  if (date) {
    query += ` AND u.exam_date = ?`;
    params.push(date);
  }
  query += ` ORDER BY u.exam_date DESC LIMIT 50`;

  const results = all(query, params);
  res.json(results);
});

/**
 * GET /api/admin/stats
 * Dashboard statistics
 */
app.get('/api/admin/stats', authMiddleware, (req, res) => {
  const totalUploads = get(`SELECT COUNT(*) as cnt FROM seating_uploads`)?.cnt || 0;
  const activeUploads = get(`SELECT COUNT(*) as cnt FROM seating_uploads WHERE active = 1`)?.cnt || 0;
  const totalStudents = get(`SELECT COUNT(*) as cnt FROM seating_records`)?.cnt || 0;
  const totalRooms = get(`SELECT COUNT(DISTINCT room_number) as cnt FROM seating_records`)?.cnt || 0;

  // Today's active plan in IST
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  const today = ist.toISOString().split('T')[0];
  const todayPlan = get(`SELECT * FROM seating_uploads WHERE exam_date = ? AND active = 1 LIMIT 1`, [today]);

  const recentLogs = all(`SELECT * FROM upload_logs ORDER BY performed_at DESC LIMIT 10`);

  res.json({ totalUploads, activeUploads, totalStudents, totalRooms, todayPlan, recentLogs, today });
});

/**
 * GET /api/admin/settings
 * Get all system settings
 */
app.get('/api/admin/settings', authMiddleware, (req, res) => {
  const rows = all(`SELECT key, value FROM system_settings`);
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  res.json(settings);
});

/**
 * POST /api/admin/settings
 * Update system settings
 */
app.post('/api/admin/settings', authMiddleware, (req, res) => {
  const { key, value } = req.body;
  if (!key || value === undefined) return res.status(400).json({ error: 'key and value required' });
  run(`INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)`, [key, value]);
  saveToDisk();
  res.json({ success: true });
});

/**
 * GET /api/admin/logs
 * Upload activity logs
 */
app.get('/api/admin/logs', authMiddleware, (req, res) => {
  const logs = all(`SELECT l.*, u.exam_date, u.session FROM upload_logs l
                    LEFT JOIN seating_uploads u ON l.upload_id = u.id
                    ORDER BY l.performed_at DESC LIMIT 100`);
  res.json(logs);
});

/**
 * GET /api/admin/rooms?upload_id=X
 * List all rooms for a given upload
 */
app.get('/api/admin/rooms', authMiddleware, (req, res) => {
  const { upload_id } = req.query;
  if (!upload_id) return res.status(400).json({ error: 'upload_id required' });
  const rooms = all(
    `SELECT room_number, COUNT(*) as count FROM seating_records WHERE upload_id = ? GROUP BY room_number ORDER BY room_number`,
    [upload_id]
  );
  res.json(rooms);
});

/**
 * POST /api/admin/change-password
 */
app.post('/api/admin/change-password', authMiddleware, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Both fields required' });
  if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

  const admin = get(`SELECT * FROM admins WHERE id = ?`, [req.admin.id]);
  if (!bcrypt.compareSync(current_password, admin.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const newHash = bcrypt.hashSync(new_password, 10);
  run(`UPDATE admins SET password_hash = ? WHERE id = ?`, [newHash, req.admin.id]);
  saveToDisk();
  res.json({ success: true });
});

// ─── Catch-all: Serve student portal ─────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/admin')) {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────
getDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🎓 Exam Seating Plan Platform running on http://localhost:${PORT}`);
    console.log(`   Student Portal: http://localhost:${PORT}`);
    console.log(`   Admin Panel:    http://localhost:${PORT}/admin\n`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
