// settings.js — behavior toggles and tunable parameters
// Safe to commit. Edit this file to configure your deployment.
// Secrets (API keys, passwords) belong in .env, not here.

module.exports = {

  // ─── QR TOKEN ─────────────────────────────────────────────────────────────
  // How long each QR code stays valid before rotating
  tokenValidityMs: 60 * 1000,      // 60 seconds

  // After a token rotates, the old one is still accepted for this window.
  // Covers students who scanned just before rotation.
  tokenGracePeriodMs: 30 * 1000,   // 30 seconds


  // ─── STUDENT ATTENDANCE VIEW ──────────────────────────────────────────────
  // When enabled, logged-in students can view their own per-slot attendance
  // (✓/✗ + total) on the attendance page. Only works for students present
  // in attendees.csv (Master sheet) — unregistered scanners can still mark
  // attendance, they just won't see a record.
  attendanceViewEnabled: true,


  // ─── ADMIN LOGIN MODE ─────────────────────────────────────────────────────
  // true  → admin logs in with plain password  (ADMIN_PASSWORD in .env)
  // false → admin logs in with 6-digit TOTP    (run setup.js first)
  usePasswordFallback: true,


  // ─── GEO-FENCING ──────────────────────────────────────────────────────────
  // When enabled, the /attend endpoint checks that the student's device
  // is within `radiusMeters` of the venue before accepting the scan.
  // Requires the frontend to send { lat, lng } with the request.
  geofencingEnabled: false,
  geofencing: {
    latitude:     17.4458,   // venue latitude  (decimal degrees)
    longitude:    78.3523,   // venue longitude (decimal degrees)
    radiusMeters: 200,       // allowed radius from venue center
  },

};
