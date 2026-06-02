const { google } = require('googleapis');
const path       = require('path');
const config     = require('../config');

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, '..', config.credentialsFile),
    scopes:  ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

async function ensureSheetExists(sheetName) {
  const sheets      = await getSheetsClient();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: config.spreadsheetId });
  const exists      = spreadsheet.data.sheets.some(s => s.properties.title === sheetName);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.spreadsheetId,
      resource: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.spreadsheetId,
      range:         `${sheetName}!A1`,
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
      spreadsheetId: config.spreadsheetId,
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
    spreadsheetId: config.spreadsheetId,
    range:         `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[timestamp, email, name]] },
  });
}

module.exports = { ensureSheetExists, checkDuplicate, appendToSheet };
