/**
 * Student Search API Routes (Public - No Authentication Required)
 */

const express = require('express');
const router = express.Router();
const db = require('../database');

/**
 * GET /api/search
 * Public endpoint for students to search their seating assignment
 *
 * Query params:
 *   enrollment (required) - Student enrollment number
 *   date (optional) - Exam date (YYYY-MM-DD). If not provided, searches today's active plan.
 *
 * Search logic:
 *   - Only returns results from ACTIVE seating plans
 *   - If no date given → searches today's active plan
 *   - If date given → searches that specific date's active plan
 */
router.get('/', (req, res) => {
  const { enrollment, date } = req.query;

  if (!enrollment || enrollment.trim().length < 4) {
    return res.status(400).json({
      success: false,
      message: 'Please enter a valid enrollment number.',
    });
  }

  const enrollmentNum = enrollment.trim();

  // Determine the search date
  let searchDate = date ? date.trim() : null;

  if (!searchDate) {
    // Use today's date in YYYY-MM-DD format
    searchDate = new Date().toISOString().split('T')[0];
  }

  // Search only in ACTIVE plans for the specified date
  const result = db.prepare(`
    SELECT
      sr.enrollment,
      sr.room_number,
      sr.row_number,
      sr.seat_number,
      su.exam_date,
      su.session
    FROM seating_records sr
    JOIN seating_uploads su ON sr.upload_id = su.id
    WHERE sr.enrollment = ?
      AND su.active = 1
      AND su.exam_date = ?
    LIMIT 1
  `).get(enrollmentNum, searchDate);

  if (result) {
    return res.json({ success: true, found: true, data: result });
  }

  // Enrollment not found — return custom message from settings
  const messageSetting = db.prepare(
    "SELECT value FROM system_settings WHERE key = 'not_found_message'"
  ).get();

  const message = messageSetting
    ? messageSetting.value
    : 'Your seating plan is currently unavailable. Please contact the Examination Cell.';

  res.json({ success: true, found: false, message });
});

/**
 * GET /api/search/active-dates
 * Returns list of exam dates that have active seating plans
 * Useful for populating the date picker
 */
router.get('/active-dates', (req, res) => {
  const dates = db.prepare(`
    SELECT DISTINCT exam_date, session
    FROM seating_uploads
    WHERE active = 1
    ORDER BY exam_date DESC
  `).all();
  res.json({ success: true, dates });
});

/**
 * GET /api/search/settings
 * Returns public-facing settings (college name, exam title etc.)
 */
router.get('/settings', (req, res) => {
  const rows = db.prepare(`
    SELECT key, value FROM system_settings
    WHERE key IN ('college_name', 'exam_title', 'not_found_message')
  `).all();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json({ success: true, settings });
});

module.exports = router;
