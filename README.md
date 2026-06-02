# Attendance System

QR-based attendance with Google OAuth login and Google Sheets backend.
Admin generates QR → student scans → Google login → attendance written to sheet.

---

## File Structure

```
attendance_website/
├── server.js               # main app — routes, auth, sheets logic
├── setup.js                # one-time TOTP secret generator
├── package.json
├── .env                    # secrets (never commit)
├── .env.example            # template — commit this
├── credentials.json        # Google service account key (never commit)
├── o_auth_credentials.json # OAuth client credentials (never commit)
└── public/
    ├── index.html          # landing / admin login page
    ├── admin.html          # admin panel (QR display + slot picker)
    ├── attendance.html     # student attendance form
    ├── expired.html        # shown when QR token expired
    └── footer.js           # shared footer component
```

---

## Prerequisites

- Node.js v20.6+ (uses built-in `--env-file` flag)
- `node_modules/` already present (or restore: `npm install`)
- `.env` file configured (copy from `.env.example`)
- `credentials.json` — Google service account key file
- `o_auth_credentials.json` — Google OAuth client credentials

---

## Setup

### 1. Configure environment
```bash
cp .env.example .env
# edit .env with your values
```

### 2. (First time) Generate TOTP secret
```bash
node setup.js
# saves secret, prints QR — scan with Google Authenticator
# copy TOTP_SECRET output into .env
```

---

## Start Server

```bash
node --env-file=.env server.js
# or via npm:
npm start
```

Server runs at `http://localhost:3000`

---

## Access the Website

### Production
Visit: `https://isea.rathanappana.com`

### Local / SSH Testing — Port Forwarding

Run this on your **local machine** (not on the server):
```bash
ssh -L 3000:localhost:3000 user@your-server-ip
```
Then open `http://localhost:3000` in your local browser.
The tunnel forwards local port 3000 → server port 3000 over SSH.

### Quick API check (from SSH session)
```bash
curl http://localhost:3000/admin/login-mode
```

---

## Admin Login

1. Go to `http://localhost:3000` → click Admin
2. **Password mode** (`USE_PASSWORD_FALLBACK=true`): enter `ADMIN_PASSWORD` from `.env`
3. **TOTP mode** (`USE_PASSWORD_FALLBACK=false`): enter 6-digit code from Authenticator app
4. Pick slot → QR appears → students scan

---

## Deployment

### 1. Copy files to server
```bash
rsync -av --exclude='node_modules' --exclude='.env' \
  . user@server:/path/to/attendance_website/
```

### 2. On server — install dependencies
```bash
cd /path/to/attendance_website
npm install
```

### 3. Copy secrets (do NOT git commit these)
```bash
scp .env credentials.json o_auth_credentials.json user@server:/path/to/attendance_website/
```

### 4. Run with process manager (keep alive after SSH logout)
```bash
# using pm2
npm install -g pm2
pm2 start "node --env-file=.env server.js" --name attendance
pm2 save
pm2 startup   # auto-start on reboot
```

### 5. Nginx reverse proxy (serve on port 80/443)
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

---

## .gitignore (add before first commit)

```
node_modules/
.env
credentials.json
o_auth_credentials.json
totp-setup-qr.png
```
