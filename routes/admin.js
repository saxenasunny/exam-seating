/**
 * Admin Panel API Routes
 * All routes require admin authentication via requireAdmin middleware
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const { requireAdmin } = require('../middleware/auth');
const { parseSeatingPlan } = require('../excelParser');

// Configure multer for Excel uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${timestamp}_${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.xlsx', '.xls', '.xlsm'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('Only Excel files (.xlsx, .xls, .xlsm) are allowed.'));
  },
});

// Apply auth middleware to all admin routes
router.use(requireAdmin);

// ─────────────────────────────────────────────
// DASHBOARD STATISTICS
// ─────────────────────────────────────────────

// GET /api/admin/stats
router.get('/stats', (req, res) => {
  const stats = {
    totalUploads: db.prepare('SELECT COUNT(*) as c FROM seating_uploads').get().c,
    activeUploads: db.prepare('SELECT COUNT(*) as c FROM seating_uploads WHERE active = 1').get().c,
    totalStudents: db.prepare('SELECT COUNT(*) as c FROM seating_records').get().c,
    totalRooms: db.prepare('SELECT COUNT(DISTINCT room_number) as c FROM seating_records').get().c,
    recentUploads: db.prepare(`
      SELECT id, exam_date, session, file_name, active, total_students, total_rooms, uploaded_at
      FROM seating_uploads
      ORDER BY uploaded_at DESC
      LIMIT 5
    `).all(),
  };
  res.json({ success: true, stats });
});

// ─────────────────────────────────────────────
// UPLOAD SEATING PLAN
// ─────────────────────────────────────────────

// POST /api/admin/upload/preview  (parse without saving to DB)
router.post('/upload/preview', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });

  try {
    const result = parseSeatingPlan(req.file.path);
    // Delete the temp file after preview
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      preview: {
        totalStudents: result.stats.totalStudents,
        totalRooms: result.stats.totalRooms,
        roomBreakdown: result.stats.roomBreakdown,
        processedSheets: result.stats.processedSheets,
        skippedSheets: result.stats.skippedSheets,
        duplicates: result.stats.duplicates,
        errors: result.errors,
      },
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, message: 'Failed to parse Excel file: ' + err.message });
  }
});

// POST /api/admin/upload  (parse and save to DB)
router.post('/upload', upload.single('file'), (req, res) => {
  const { exam_date, session, active } = req.body;

  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });
  if (!exam_date) return res.status(400).json({ success: false, message: 'Exam date is required.' });
  if (!session) return res.status(400).json({ success: false, message: 'Session is required.' });

  try {
    const result = parseSeatingPlan(req.file.path);

    if (result.records.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'No valid seating records found in the Excel file.' });
    }

    // Save to database in a transaction
    const insertUpload = db.transaction(() => {
      const isActive = active === 'true' || active === '1' || active === true ? 1 : 0;

      const uploadResult = db.prepare(`
        INSERT INTO seating_uploads (exam_date, session, file_name, active, total_students, total_rooms, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        exam_date,
        session,
        req.file.originalname,
        isActive,
        result.stats.totalStudents,
        result.stats.totalRooms,
        req.session.adminUsername,
      );

      const uploadId = uploadResult.lastInsertRowid;

      // Batch insert seating records
      const insertRecord = db.prepare(`
        INSERT INTO seating_records (upload_id, enrollment, room_number, row_number, seat_number, sheet_name)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const rec of result.records) {
        insertRecord.run(uploadId, rec.enrollment, rec.room_number, rec.row_number, rec.seat_number, rec.sheet_name);
      }

      // Log the upload
      db.prepare(`
        INSERT INTO upload_logs (upload_id, action, details, performed_by)
        VALUES (?, 'UPLOAD', ?, ?)
      `).run(uploadId, JSON.stringify({ file: req.file.originalname, students: result.stats.totalStudents }), req.session.adminUsername);

      return uploadId;
    });

    const uploadId = insertUpload();

    res.json({
      success: true,
      message: `Seating plan uploaded successfully! ${result.stats.totalStudents} students in ${result.stats.totalRooms} rooms.`,
      uploadId,
      stats: result.stats,
    });

  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, message: 'Failed to process upload: ' + err.message });
  }
});

// ─────────────────────────────────────────────
// MANAGE SEATING PLANS
// ─────────────────────────────────────────────

// GET /api/admin/uploads
router.get('/uploads', (req, res) => {
  const uploads = db.prepare(`
    SELECT id, exam_date, session, file_name, active, total_students, total_rooms, uploaded_by, uploaded_at
    FROM seating_uploads
    ORDER BY uploaded_at DESC
  `).all();
  res.json({ success: true, uploads });
});

// GET /api/admin/uploads/:id
router.get('/uploads/:id', (req, res) => {
  const upload = db.prepare('SELECT * FROM seating_uploads WHERE id = ?').get(req.params.id);
  if (!upload) return res.status(404).json({ success: false, message: 'Upload not found.' });

  const rooms = db.prepare(`
    SELECT room_number, COUNT(*) as student_count
    FROM seating_records WHERE upload_id = ?
    GROUP BY room_number ORDER BY room_number
  `).all(req.params.id);

  res.json({ success: true, upload, rooms });
});

// PATCH /api/admin/uploads/:id/toggle  — activate/deactivate
router.patch('/uploads/:id/toggle', (req, res) => {
  const upload = db.prepare('SELECT * FROM seating_uploads WHERE id = ?').get(req.params.id);
  if (!upload) return res.status(404).json({ success: false, message: 'Upload not found.' });

  const newStatus = upload.active ? 0 : 1;
  db.prepare('UPDATE seating_uploads SET active = ? WHERE id = ?').run(newStatus, req.params.id);

  db.prepare(`INSERT INTO upload_logs (upload_id, action, details, performed_by) VALUES (?, ?, ?, ?)`)
    .run(req.params.id, newStatus ? 'ACTIVATE' : 'DEACTIVATE', null, req.session.adminUsername);

  res.json({ success: true, message: `Plan ${newStatus ? 'activated' : 'deactivated'} successfully.`, active: newStatus });
});

// DELETE /api/admin/uploads/:id
router.delete('/uploads/:id', (req, res) => {
  const upload = db.prepare('SELECT * FROM seating_uploads WHERE id = ?').get(req.params.id);
  if (!upload) return res.status(404).json({ success: false, message: 'Upload not found.' });

  db.prepare('DELETE FROM seating_uploads WHERE id = ?').run(req.params.id);
  // Cascade deletes seating_records due to foreign key

  db.prepare(`INSERT INTO upload_logs (upload_id, action, details, performed_by) VALUES (?, 'DELETE', ?, ?)`)
    .run(req.params.id, JSON.stringify({ file: upload.file_name }), req.session.adminUsername);

  res.json({ success: true, message: 'Seating plan deleted successfully.' });
});

// ─────────────────────────────────────────────
// MANUAL STUDENT SEARCH (admin)
// ─────────────────────────────────────────────

// GET /api/admin/search?enrollment=xxx&date=xxx
router.get('/search', (req, res) => {
  const { enrollment, date } = req.query;
  if (!enrollment) return res.status(400).json({ success: false, message: 'Enrollment number required.' });

  let query = `
    SELECT sr.enrollment, sr.room_number, sr.row_number, sr.seat_number,
           su.exam_date, su.session, su.active
    FROM seating_records sr
    JOIN seating_uploads su ON sr.upload_id = su.id
    WHERE sr.enrollment = ?
  `;
  const params = [enrollment.trim()];

  if (date) {
    query += ' AND su.exam_date = ?';
    params.push(date);
  }

  query += ' ORDER BY su.exam_date DESC';

  const results = db.prepare(query).all(...params);
  res.json({ success: true, results });
});

// ─────────────────────────────────────────────
// UPLOAD LOGS
// ─────────────────────────────────────────────

// GET /api/admin/logs
router.get('/logs', (req, res) => {
  const logs = db.prepare(`
    SELECT ul.*, su.exam_date, su.session, su.file_name
    FROM upload_logs ul
    LEFT JOIN seating_uploads su ON ul.upload_id = su.id
    ORDER BY ul.performed_at DESC
    LIMIT 100
  `).all();
  res.json({ success: true, logs });
});

// ─────────────────────────────────────────────
// SYSTEM SETTINGS
// ─────────────────────────────────────────────

// GET /api/admin/settings
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM system_settings').all();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json({ success: true, settings });
});

// PUT /api/admin/settings
router.put('/settings', (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ success: false, message: 'Invalid settings data.' });
  }

  const upsert = db.prepare(`
    INSERT INTO system_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const update = db.transaction(() => {
    for (const [key, value] of Object.entries(settings)) {
      upsert.run(key, String(value));
    }
  });

  update();
  res.json({ success: true, message: 'Settings updated successfully.' });
});

module.exports = router;
