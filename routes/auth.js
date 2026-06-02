const express  = require('express');
const passport = require('passport');
const path     = require('path');
const { isTokenValid } = require('../services/token');

const router = express.Router();

router.get('/attend', (req, res) => {
  const { token } = req.query;
  if (!token || !isTokenValid(token)) {
    return res.sendFile(path.join(__dirname, '..', 'public', 'expired.html'));
  }
  req.session.pendingToken = token;
  res.redirect('/auth/google');
});

router.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => res.redirect('/attendance')
);

router.get('/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

module.exports = router;
