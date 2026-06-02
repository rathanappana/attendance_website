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
├── package.json
├── .env                    # secrets (never commit)
├── .env.example            # template — commit this
├── credentials.json        # Google service account key (never commit)
├── routes/
│   ├── auth.js             # Google OAuth + /attend + /logout
│   ├── admin.js            # admin login/logout/slots/token routes
│   └── attendance.js       # /attendance page, /me, /submit
├── middleware/
│   └── auth.js             # requireLogin, requireAdmin
├── services/
│   ├── token.js            # QR token state — generate, validate, rotate
│   ├── sheets.js           # Google Sheets read/write helpers
│   └── geofence.js         # haversine distance + venue proximity check
└── public/
    ├── index.html          # landing / admin login page
    ├── admin.html          # admin panel (QR display + slot picker)
    ├── attendance.html     # student attendance form
    ├── expired.html        # shown when QR token expired
    └── footer.js           # shared footer component
```

---

## Prerequisites

- Node.js v20.6+ (uses built-in `--env-file` flag, no dotenv needed)
- `node_modules/` present (or restore: `npm install`)
- `.env` configured (copy from `.env.example`)
- `credentials.json` — Google service account JSON key file

---

## Setup

### 1. Configure secrets
```bash
cp .env.example .env
# edit .env with your values
```

### 2. Configure behavior (optional)

Edit `settings.js` — safe to commit, no secrets here:

```js
tokenValidityMs:     60 * 1000,   // QR code lifespan
tokenGracePeriodMs:  30 * 1000,   // overlap window after rotation
usePasswordFallback: true,         // true = password login, false = TOTP
geofencingEnabled:   false,        // enable to restrict by location
```

### 3. Configure slots

Edit `slots.js` — one entry per session:
```js
{ label: '09/03 — Morning', sheet: '09/03 morning' },
```
`label` → shown in admin UI. `sheet` → Google Sheets tab name (auto-created).

### 4. (First time, TOTP mode only) Generate TOTP secret
```bash
node setup.js
# prints QR code — scan with Google Authenticator
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

---

## Access the Website

### Production
Tunnel localhost:3000 to your domain, then visit: `https://isea.rathanappana.com`

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

## Admin Login

1. Go to `http://localhost:3000` → click Admin
2. **Password mode** (`usePasswordFallback: true` in `settings.js`): enter `ADMIN_PASSWORD` from `.env`
3. **TOTP mode** (`usePasswordFallback: false`): enter 6-digit code from Authenticator app
4. Pick a slot → QR appears → students scan

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
When enabled, `/submit` rejects requests from outside the radius.
Frontend (`attendance.html`) must send `lat` + `lng` via `navigator.geolocation` in the POST body.

---

## Deployment

### 1. Copy files to server
```bash
rsync -av --exclude='node_modules' --exclude='.env' --exclude='credentials.json' \
  . user@server:/path/to/attendance_website/
```

### 2. Install dependencies on server
```bash
cd /path/to/attendance_website
npm install
```

### 3. Copy secrets (never commit these)
```bash
scp .env credentials.json user@server:/path/to/attendance_website/
```

### 4. Run with process manager (survives SSH logout + reboots)
```bash
npm install -g pm2
pm2 start "node --env-file=.env server.js" --name attendance
pm2 save
pm2 startup
```

### 5. Nginx reverse proxy
```nginx
server {
    server_name isea.rathanappana.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
