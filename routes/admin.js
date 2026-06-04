const express   = require('express');
const speakeasy = require('speakeasy');
const config    = require('../config');
const settings  = require('../settings');
const SLOTS     = require('../slots');
const { requireAdmin } = require('../middleware/auth');
const {
  generateToken, setActiveSlot, getActiveSlot, getCurrentToken, clearSession,
  TOKEN_VALIDITY_MS,
} = require('../services/token');
const {
  getAttendeesForAdmin, markRegistrationInMaster,
} = require('../services/masterSheet');

const router = express.Router();

router.get('/admin/login-mode', (req, res) => {
  res.json({ passwordMode: settings.usePasswordFallback });
});

router.post('/admin/login', (req, res) => {
  const { password } = req.body;

  if (settings.usePasswordFallback) {
    if (password === config.adminPassword) {
      req.session.isAdmin = true;
      return res.json({ success: true, method: 'password' });
    }
    return res.status(401).json({ error: 'Wrong password' });
  }

  if (password && /^\d{6}$/.test(password)) {
    const valid = speakeasy.totp.verify({
      secret:   config.totpSecret,
      encoding: 'base32',
      token:    password,
      window:   1,
    });
    if (valid) {
      req.session.isAdmin = true;
      return res.json({ success: true, method: 'otp' });
    }
  }

  res.status(401).json({ error: 'Invalid OTP' });
});

router.get('/admin/logout', (req, res) => {
  req.session.isAdmin = false;
  clearSession();
  res.redirect('/');
});

router.get('/admin/slots', requireAdmin, (req, res) => {
  res.json({ slots: SLOTS, activeSlot: getActiveSlot() });
});

router.post('/admin/slot', requireAdmin, (req, res) => {
  const { sheet } = req.body;
  const slot = SLOTS.find(s => s.sheet === sheet);
  if (!slot) return res.status(400).json({ error: 'Invalid slot' });
  setActiveSlot(slot);
  generateToken();
  console.log(`✅ Active slot: ${slot.label}`);
  res.json({ success: true, slot });
});

router.get('/admin/token', requireAdmin, (req, res) => {
  const activeSlot = getActiveSlot();
  if (!activeSlot) return res.status(400).json({ error: 'no_slot' });
  let token = getCurrentToken();
  if (!token) token = generateToken();
  const elapsed   = Date.now() - token.createdAt;
  const remaining = Math.max(0, Math.ceil((TOKEN_VALIDITY_MS - elapsed) / 1000));
  const qrUrl     = `${config.baseUrl}/attend?token=${token.token}`;
  res.json({ token: token.token, remaining, qrUrl, slot: activeSlot });
});

// ── REGISTRATION ──────────────────────────────────────────
router.get('/admin/attendees', requireAdmin, async (req, res) => {
  try {
    const attendees = await getAttendeesForAdmin();
    res.json({ attendees });
  } catch (err) {
    console.error('❌ Attendees fetch failed:', err.message);
    res.status(500).json({ error: 'Failed to load attendees.' });
  }
});

router.post('/admin/register', requireAdmin, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });
  try {
    await markRegistrationInMaster(email);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Registration failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
