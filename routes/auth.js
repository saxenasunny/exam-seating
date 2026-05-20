/**
 * Authentication routes for Admin Panel
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username.trim());

  if (!admin) {
    return res.status(401).json({ success: false, message: 'Invalid credentials.' });
  }

  const valid = bcrypt.compareSync(password, admin.password_hash);
  if (!valid) {
    return res.status(401).json({ success: false, message: 'Invalid credentials.' });
  }

  req.session.adminId = admin.id;
  req.session.adminUsername = admin.username;

  res.json({ success: true, message: 'Login successful.', username: admin.username });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ success: false, message: 'Logout failed.' });
    res.clearCookie('connect.sid');
    res.json({ success: true, message: 'Logged out successfully.' });
  });
});

// GET /api/auth/me - Check current session
router.get('/me', (req, res) => {
  if (req.session && req.session.adminId) {
    return res.json({ success: true, loggedIn: true, username: req.session.adminUsername });
  }
  res.json({ success: true, loggedIn: false });
});

// POST /api/auth/change-password
router.post('/change-password', (req, res) => {
  if (!req.session || !req.session.adminId) {
    return res.status(401).json({ success: false, message: 'Unauthorized.' });
  }

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.session.adminId);
  if (!bcrypt.compareSync(currentPassword, admin.password_hash)) {
    return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(newHash, req.session.adminId);

  res.json({ success: true, message: 'Password changed successfully.' });
});

module.exports = router;
