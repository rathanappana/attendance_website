function requireLogin(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/');
}

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

module.exports = { requireLogin, requireAdmin };
