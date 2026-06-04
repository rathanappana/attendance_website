# Attendance System

QR-based attendance with Google OAuth login and Google Sheets backend.
Admin generates QR → student scans → Google login → attendance written to sheet.

---

## File Structure

```
attendance_website/
├── server.js               # app entry — express setup, passport, listen
├── config.js               # loads all secrets from .env
├── settings.js             # behavior toggles (token timing, auth mode, geo-fencing)
├── slots.js                # attendance slot definitions — edit for each event
├── setup.js                # one-time TOTP secret generator
├── attendees.csv           # participant list (never commit — personal data)
├── attendees.example.csv   # template for attendees.csv
├── package.json
├── .env                    # secrets (never commit)
├── .env.example            # template — commit this
├── credentials.json        # Google service account key (never commit)
├── routes/
│   ├── auth.js             # Google OAuth + /attend + /logout
│   ├── admin.js            # admin login/logout/slots/token/registration routes
│   └── attendance.js       # /attendance page, /me, /submit
├── middleware/
│   └── auth.js             # requireLogin, requireAdmin
├── services/
│   ├── token.js            # QR token state — generate, validate, rotate
│   ├── sheets.js           # Google Sheets slot-tab helpers
│   ├── masterSheet.js      # Master/Registration/Analysis tab management
│   └── geofence.js         # haversine distance + venue proximity check
└── public/
    ├── index.html          # admin UI (login + slot picker + QR + registration)
    ├── attendance.html     # student attendance form
    ├── expired.html        # shown when QR token expired
    └── footer.js           # shared footer component
```

---

## Google Sheet Structure

Server auto-creates all tabs on first startup. Point `SPREADSHEET_ID` at a blank sheet.

| Tab | Columns | Purpose |
|-----|---------|---------|
| `Master` | Email \| Name \| Registered \| [slot labels…] \| Total | Pivot — one row per student, ✓ per slot attended |
| `Registration` | Timestamp \| Email \| Name | Audit log — one row per registration event |
| `09/03 morning` (etc.) | Timestamp \| Email \| Name | Raw slot attendance — source of truth |
| `Analysis` | Formulas only | Overview stats + slot aggregate + day-wise counts |

**Analysis tab updates live** — it's pure COUNTIF formulas referencing Master, no server writes.

---

## Prerequisites

- Node.js v20.6+ (uses built-in `--env-file` flag, no dotenv needed)
- `node_modules/` present (or restore: `npm install`)
- `.env` configured (copy from `.env.example`)
- `credentials.json` — Google service account JSON key file (Sheets API)
- `o_auth_credentials.json` — Google OAuth 2.0 client JSON (downloaded from Cloud Console)
- A blank Google Sheet — server creates all tabs on startup

---

## Setup

### 1. Configure secrets
```bash
cp .env.example .env
# edit .env — set SPREADSHEET_ID, BASE_URL, SESSION_SECRET, ADMIN_PASSWORD
```

Place credential files in project root (never commit these):
- `credentials.json` — service account key from Google Cloud Console → IAM → Service Accounts
- `o_auth_credentials.json` — OAuth 2.0 client JSON from Google Cloud Console → APIs & Services → Credentials

### 2. Prepare attendees list
```bash
cp attendees.example.csv attendees.csv
# edit attendees.csv:
# name,email
# Alice Sharma,alice@iith.ac.in
```

> **Important:** Email in CSV must match the student's actual Google account email.
> This is the key used for all attendance tracking. Wrong email = Master row never gets ✓.

### 3. Configure slots

Edit `slots.js` — one entry per session:
```js
{ label: '09/03 — Morning', sheet: '09/03 morning' },
```
`label` → shown in admin UI and Master column header. `sheet` → Sheets tab name (auto-created).

### 4. Configure behavior (optional)

Edit `settings.js` — safe to commit, no secrets here:
```js
tokenValidityMs:     60 * 1000,   // QR code lifespan
tokenGracePeriodMs:  30 * 1000,   // grace window after token rotates
usePasswordFallback: true,         // true = password login, false = TOTP
geofencingEnabled:   false,        // enable to enforce physical location
```

### 5. (TOTP mode only) Generate TOTP secret
```bash
node setup.js
# prints QR — scan with Google Authenticator
# copy TOTP_SECRET value into .env
```

---

## Start Server

```bash
node --env-file=.env server.js
# or:
npm start
```

Server runs at `http://localhost:3000`

**On every startup the server:**
1. Creates any missing tabs (Master, Registration, slot tabs, Analysis)
2. Rebuilds Master fully from `attendees.csv` + slot audit tabs + Registration audit tab
3. Rewrites Analysis tab formulas

Fully idempotent — safe to restart any number of times.

---

## Access the Website

### Production
Tunnel localhost:3000 to your domain: `https://production.domain`

### Local / SSH Testing — Port Forwarding

Run on your **local machine**:
```bash
ssh -L 3000:localhost:3000 user@your-server-ip
```
Then open `http://localhost:3000` in local browser.

### Quick API check (from SSH session)
```bash
curl http://localhost:3000/admin/login-mode
```

---

## Admin Panel

Login → two modes available from the Slot screen:

### QR Attendance Mode
1. Pick session slot → click **Generate QR**
2. QR displayed full-screen — rotates every 60s automatically
3. Students scan → Google login → submit name → attendance recorded

### Registration Mode
1. Click **Registration →** from Slot screen
2. List of all attendees from Master with search + filter (All / Unregistered / Registered)
3. Click **Register** next to a student → marks ✓ in Master `Registered` column + logs to `Registration` tab

**Admin login:**
- **Password mode** (`usePasswordFallback: true` in `settings.js`): enter `ADMIN_PASSWORD` from `.env`
- **TOTP mode** (`usePasswordFallback: false`): enter 6-digit code from Authenticator app

---

## Changing a Student's Email Mid-Event

CSV changes do **not** retroactively fix existing sheet data. Email is the primary key.

If a student attended some slots under a wrong email:

1. Open the Google Sheet → Master tab
2. Find the old email row — manually edit the email cell to the correct one
3. Find any slot tabs where they appear — manually fix the email there too
4. Update `attendees.csv` with the correct email
5. Restart server — new email now matches, future attendance marks correctly

---

## Geo-Fencing (optional)

Set in `settings.js`:
```js
geofencingEnabled: true,
geofencing: {
  latitude:     17.4458,
  longitude:    78.3523,
  radiusMeters: 200,
},
```
When enabled, `/submit` rejects attendance from outside the radius.
Frontend (`attendance.html`) must send `lat` + `lng` via `navigator.geolocation` in the POST body.

---

## Deployment

Server runs locally on port 3000. Cloudflare Tunnel exposes it to the internet — no open ports, no nginx needed.

### 1. Start the Node server
```bash
node --env-file=.env server.js
# or via pm2 (survives SSH logout):
npm install -g pm2
pm2 start "node --env-file=.env server.js" --name attendance
pm2 save
pm2 startup
```

### 2. Start Cloudflare Tunnel

**One-time setup (first deploy only):**
```bash
# Install cloudflared (Arch/Debian/etc — adjust for your OS)
# https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

cloudflared tunnel login          # opens browser, authorizes your Cloudflare account
cloudflared tunnel create attendance   # creates tunnel, saves credentials JSON
cloudflared tunnel route dns attendance your-domain.com   # points domain to tunnel
```

**Every deploy — run tunnel:**
```bash
cloudflared tunnel run --url http://localhost:3000 attendance
```

**Or with a config file** (`~/.cloudflared/config.yml`):
```yaml
tunnel: <tunnel-id>
credentials-file: /home/<user>/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: your-domain.com
    service: http://localhost:3000
  - service: http_status:404
```
```bash
cloudflared tunnel run attendance
```

**Quick temporary tunnel** (testing only — random URL each time):
```bash
cloudflared tunnel --url http://localhost:3000
```

### 3. Install dependencies
```bash
cd /path/to/attendance_website
npm install
```

### 4. Copy secrets + data to server (never commit these)
```bash
scp .env credentials.json o_auth_credentials.json attendees.csv user@server:/path/to/attendance_website/
```
