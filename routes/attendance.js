const express = require('express');
const path    = require('path');
const settings = require('../settings');
const { requireLogin } = require('../middleware/auth');
const { isTokenValid, getTokenData } = require('../services/token');
const { checkDuplicate, ensureSheetExists, appendToSheet } = require('../services/sheets');
const { isWithinVenue }         = require('../services/geofence');
const { markAttendanceInMaster } = require('../services/masterSheet');

const router = express.Router();

router.get('/attendance', requireLogin, (req, res) => {
  const token = req.user.pendingToken;
  if (!token || !isTokenValid(token)) {
    return res.sendFile(path.join(__dirname, '..', 'public', 'expired.html'));
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'attendance.html'));
});

router.get('/me', requireLogin, (req, res) => {
  const tokenData = getTokenData(req.user.pendingToken);
  res.json({
    email:            req.user.email,
    name:             req.user.name,
    slot:             tokenData ? tokenData.label : null,
    geofencingEnabled: settings.geofencingEnabled,
  });
});

router.post('/submit', requireLogin, async (req, res) => {
  const email = req.user.email;
  const name  = req.body.name?.trim() || req.user.name;
  const token = req.user.pendingToken;

  if (!name) return res.status(400).json({ error: 'Name is required.' });

  // ─── GEO-FENCING ────────────────────────────────────────
  if (settings.geofencingEnabled) {
    const lat = parseFloat(req.body.lat);
    const lng = parseFloat(req.body.lng);
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'Location required. Enable location access and try again.' });
    }
    if (!isWithinVenue(lat, lng)) {
      return res.status(403).json({ error: 'You must be physically present at the venue to mark attendance.' });
    }
  }

  if (!token || !isTokenValid(token)) {
    return res.status(410).json({ error: 'QR code expired. Please scan the new code.' });
  }

  const tokenData = getTokenData(token);
  if (!tokenData) {
    return res.status(410).json({ error: 'QR code expired. Please scan the new code.' });
  }

  if (tokenData.usedBy.has(email)) {
    return res.status(409).json({ error: 'You already marked attendance for this slot!' });
  }

  const sheetName = tokenData.sheet;

  try {
    const alreadyMarked = await checkDuplicate(email, sheetName);
    if (alreadyMarked) {
      return res.status(409).json({ error: 'Attendance already marked for this slot!' });
    }
    await ensureSheetExists(sheetName);
    await appendToSheet(sheetName, email, name);
    tokenData.usedBy.add(email);
    console.log(`✅ [${sheetName}] ${email} (${name})`);

    // Update Master pivot — non-blocking so slot tab write is already safe
    markAttendanceInMaster(email, tokenData.label).catch(err =>
      console.error('❌ Master update failed:', err.message)
    );

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Sheets Error:', err.message);
    res.status(500).json({ error: 'Failed to write to Google Sheet.' });
  }
});

module.exports = router;
