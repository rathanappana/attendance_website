// ─────────────────────────────────────────────────────────
// ONE-TIME SETUP SCRIPT — run this ONCE locally
// then copy the secret into server.js and delete this file
//
// Usage:  node setup.js
// ─────────────────────────────────────────────────────────

const speakeasy = require('speakeasy');
const QRCode    = require('qrcode');

const secret = speakeasy.generateSecret({
  name:   'Attendance Admin (IITH)',  // label shown in Authenticator app
  issuer: 'ISEA IITH',
  length: 20,
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅  YOUR TOTP SECRET (copy this into server.js)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`\n   const TOTP_SECRET = '${secret.base32}';\n`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Save QR code as image
QRCode.toFile('totp-setup-qr.png', secret.otpauth_url, { width: 300 }, (err) => {
  if (err) {
    console.error('❌ Could not save QR image:', err.message);
  } else {
    console.log('📱 QR code saved → totp-setup-qr.png');
    console.log('   Open this image and scan with Google Authenticator\n');
  }
});

console.log('⚠️  AFTER SCANNING:');
console.log('   1. Copy the secret above into server.js');
console.log('   2. Delete this setup.js file');
console.log('   3. Delete totp-setup-qr.png\n');
