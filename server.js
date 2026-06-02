const express        = require('express');
const speakeasy      = require('speakeasy');
const session        = require('express-session');
const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { google }     = require('googleapis');
const crypto         = require('crypto');
const path           = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── CONFIG (from .env via --env-file flag) ───────────────
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SPREADSHEET_ID       = process.env.SPREADSHEET_ID;
const ADMIN_PASSWORD       = process.env.ADMIN_PASSWORD;
const TOTP_SECRET          = process.env.TOTP_SECRET;
const USE_PASSWORD_FALLBACK = process.env.USE_PASSWORD_FALLBACK === 'true';
const BASE_URL             = process.env.BASE_URL;
const SESSION_SECRET       = process.env.SESSION_SECRET;
const CREDENTIALS_FILE     = process.env.GOOGLE_CREDENTIALS_FILE || 'credentials.json';
const TOKEN_VALIDITY_MS    = 60 * 1000; // 60 seconds

// ─── SLOTS — Label shown to admin → sheet tab name ───────
const SLOTS = [
  { label: '09/03 — Morning',   sheet: '09/03 morning'   },
  { label: '09/03 — Afternoon', sheet: '09/03 afternoon' },
  { label: '10/03 — Morning',   sheet: '10/03 morning'   },
  { label: '10/03 — Afternoon', sheet: '10/03 afternoon' },
  { label: '11/03 — Morning',   sheet: '11/03 morning'   },
  { label: '11/03 — Afternoon', sheet: '11/03 afternoon' },
  { label: '12/03 — Morning',   sheet: '12/03 morning'   },
  { label: '12/03 — Afternoon', sheet: '12/03 afternoon' },
  { label: '13/03 — Morning',   sheet: '13/03 morning'   },
  { label: '13/03 — Afternoon', sheet: '13/03 afternoon' },
];
// ──────────────────────────────────────────────────────────

// ─── IN-MEMORY STATE ──────────────────────────────────────
let currentToken  = null;
let previousToken = null; // kept for grace period after rotation
let activeSlot    = null;
const GRACE_PERIOD_MS = 30 * 1000; // 30s grace after token rotates

function generateToken() {
  if (!activeSlot) return null;
  previousToken = currentToken; // save old token for grace period
  currentToken  = {
    token:     crypto.randomBytes(16).toString('hex'),
    createdAt: Date.now(),
    usedBy:    new Set(),
    sheet:     activeSlot.sheet,
    label:     activeSlot.label,
  };
  console.log(`🔄 New QR token for: ${activeSlot.label}`);
  return currentToken;
}

function isTokenValid(token) {
  // Check current token
  if (currentToken && currentToken.token === token) {
    if (Date.now() - currentToken.createdAt <= TOKEN_VALIDITY_MS) return true;
  }
  // Check previous token within grace period
  if (previousToken && previousToken.token === token) {
    const age = Date.now() - previousToken.createdAt;
    if (age <= TOKEN_VALIDITY_MS + GRACE_PERIOD_MS) return true;
  }
  return false;
}

// Get whichever token object matches (current or previous)
function getTokenData(token) {
  if (currentToken  && currentToken.token  === token) return currentToken;
  if (previousToken && previousToken.token === token) return previousToken;
  return null;
}

// Auto-refresh token every 60s (only if a slot is active)
setInterval(() => { if (activeSlot) generateToken(); }, TOKEN_VALIDITY_MS);

// ─── SESSION & PASSPORT ───────────────────────────────────
app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
  clientID:          GOOGLE_CLIENT_ID,
  clientSecret:      GOOGLE_CLIENT_SECRET,
  callbackURL:       `${BASE_URL}/auth/google/callback`,
  passReqToCallback: true,
}, (req, accessToken, refreshToken, profile, done) => {
  const user = {
    email:        profile.emails[0].value,
    name:         profile.displayName,
    pendingToken: req.session.pendingToken || null,
  };
  return done(null, user);
}));

passport.serializeUser((user, done)   => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ─── MIDDLEWARE ───────────────────────────────────────────
function requireLogin(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/');
}

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ─── AUTH ROUTES ──────────────────────────────────────────
app.get('/attend', (req, res) => {
  const { token } = req.query;
  if (!token || !isTokenValid(token)) {
    return res.sendFile(path.join(__dirname, 'public', 'expired.html'));
  }
  req.session.pendingToken = token;
  res.redirect('/auth/google');
});

app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => res.redirect('/attendance')
);

app.get('/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

// ─── ADMIN ROUTES ─────────────────────────────────────────
// Tell frontend which login mode is active
app.get('/admin/login-mode', (req, res) => {
  res.json({ passwordMode: USE_PASSWORD_FALLBACK });
});

app.post('/admin/login', (req, res) => {
  const { password } = req.body;

  // ── EMERGENCY PASSWORD MODE (USE_PASSWORD_FALLBACK = true)
  if (USE_PASSWORD_FALLBACK) {
    if (password === ADMIN_PASSWORD) {
      req.session.isAdmin = true;
      return res.json({ success: true, method: 'password' });
    }
    return res.status(401).json({ error: 'Wrong password' });
  }

  // ── NORMAL MODE: TOTP only
  if (password && /^\d{6}$/.test(password)) {
    const valid = speakeasy.totp.verify({
      secret:   TOTP_SECRET,
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

app.get('/admin/logout', (req, res) => {
  req.session.isAdmin = false;
  activeSlot   = null;
  currentToken = null;
  res.redirect('/');
});

// Return all slots to admin UI
app.get('/admin/slots', requireAdmin, (req, res) => {
  res.json({ slots: SLOTS, activeSlot });
});

// Admin picks a slot → generate first token
app.post('/admin/slot', requireAdmin, (req, res) => {
  const { sheet } = req.body;
  const slot = SLOTS.find(s => s.sheet === sheet);
  if (!slot) return res.status(400).json({ error: 'Invalid slot' });
  activeSlot = slot;
  generateToken();
  console.log(`✅ Active slot: ${slot.label}`);
  res.json({ success: true, slot });
});

// Return current token + time remaining for QR display
app.get('/admin/token', requireAdmin, (req, res) => {
  if (!activeSlot)   return res.status(400).json({ error: 'no_slot' });
  if (!currentToken) generateToken();
  const elapsed   = Date.now() - currentToken.createdAt;
  const remaining = Math.max(0, Math.ceil((TOKEN_VALIDITY_MS - elapsed) / 1000));
  const qrUrl     = `${BASE_URL}/attend?token=${currentToken.token}`;
  res.json({ token: currentToken.token, remaining, qrUrl, slot: activeSlot });
});

// ─── PAGES ────────────────────────────────────────────────
app.get('/',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/attendance', requireLogin, (req, res) => {
  const token = req.user.pendingToken;
  if (!token || !isTokenValid(token)) {
    return res.sendFile(path.join(__dirname, 'public', 'expired.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'attendance.html'));
});

app.get('/me', requireLogin, (req, res) => {
  const token     = req.user.pendingToken;
  const tokenData = getTokenData(token);
  res.json({
    email: req.user.email,
    name:  req.user.name,
    slot:  tokenData ? tokenData.label : null,
  });
});

// ─── SUBMIT ATTENDANCE ────────────────────────────────────
app.post('/submit', requireLogin, async (req, res) => {
  const email = req.user.email;
  const name  = req.body.name?.trim() || req.user.name;
  const token = req.user.pendingToken;

  if (!name) return res.status(400).json({ error: 'Name is required.' });

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

  const sheetName = tokenData.sheet; // ✅ from token — not user input

  try {
    const alreadyMarked = await checkDuplicate(email, sheetName);
    if (alreadyMarked) {
      return res.status(409).json({ error: 'Attendance already marked for this slot!' });
    }
    await ensureSheetExists(sheetName);
    await appendToSheet(sheetName, email, name);
    tokenData.usedBy.add(email);
    console.log(`✅ [${sheetName}] ${email} (${name})`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Sheets Error:', err.message);
    res.status(500).json({ error: 'Failed to write to Google Sheet.' });
  }
});

// ─── SHEETS HELPERS ───────────────────────────────────────
async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, CREDENTIALS_FILE),
    scopes:  ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

// Auto-create sheet tab + headers if it doesn't exist
async function ensureSheetExists(sheetName) {
  const sheets      = await getSheetsClient();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists      = spreadsheet.data.sheets.some(s => s.properties.title === sheetName);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [['Timestamp', 'Email', 'Name']] },
    });
    console.log(`📄 Created new sheet: ${sheetName}`);
  }
}

async function checkDuplicate(email, sheetName) {
  const sheets = await getSheetsClient();
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range:         `${sheetName}!A:B`,
    });
    const rows = result.data.values || [];
    return rows.some(row => (row[1] || '') === email);
  } catch { return false; }
}

async function appendToSheet(sheetName, email, name) {
  const sheets    = await getSheetsClient();
  const timestamp = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range:         `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[timestamp, email, name]] },
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));