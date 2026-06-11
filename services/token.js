const crypto   = require('crypto');
const settings = require('../settings');

const TOKEN_VALIDITY_MS = settings.tokenValidityMs;
const GRACE_PERIOD_MS   = settings.tokenGracePeriodMs;

let currentToken  = null;
let previousToken = null;
let activeSlot    = null;

function generateToken() {
  if (!activeSlot) return null;
  previousToken = currentToken;
  currentToken  = {
    token:     crypto.randomBytes(8).toString('hex'),
    createdAt: Date.now(),
    usedBy:    new Set(),
    sheet:     activeSlot.sheet,
    label:     activeSlot.label,
  };
  console.log(`🔄 New QR token for: ${activeSlot.label}`);
  return currentToken;
}

function isTokenValid(token) {
  if (currentToken && currentToken.token === token) {
    if (Date.now() - currentToken.createdAt <= TOKEN_VALIDITY_MS) return true;
  }
  if (previousToken && previousToken.token === token) {
    const age = Date.now() - previousToken.createdAt;
    if (age <= TOKEN_VALIDITY_MS + GRACE_PERIOD_MS) return true;
  }
  return false;
}

function getTokenData(token) {
  if (currentToken  && currentToken.token  === token) return currentToken;
  if (previousToken && previousToken.token === token) return previousToken;
  return null;
}

function setActiveSlot(slot) { activeSlot = slot; }
function getActiveSlot()     { return activeSlot; }
function getCurrentToken()   { return currentToken; }

function clearSession() {
  activeSlot   = null;
  currentToken = null;
}

// Auto-refresh when slot is active
setInterval(() => { if (activeSlot) generateToken(); }, TOKEN_VALIDITY_MS);

module.exports = {
  generateToken,
  isTokenValid,
  getTokenData,
  setActiveSlot,
  getActiveSlot,
  getCurrentToken,
  clearSession,
  TOKEN_VALIDITY_MS,
};
