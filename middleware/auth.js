/**
 * Authentication middleware for admin-protected routes
 */

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  res.status(401).json({ success: false, message: 'Unauthorized. Please login.' });
}

module.exports = { requireAdmin };
