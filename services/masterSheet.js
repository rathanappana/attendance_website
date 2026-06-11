const { google } = require('googleapis');
const fs         = require('fs');
const path       = require('path');
const config     = require('../config');
const SLOTS      = require('../slots');

const MASTER_TAB       = 'Master';
const REGISTRATION_TAB = 'Registration';
const ANALYSIS_TAB     = 'Analysis';

// Master column layout (0-based):
// 0:Email | 1:Name | 2:Registered | 3..3+N-1:slots | 3+N:Total
const COL_REGISTERED = 2;
const COL_SLOT_START = 3;

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, '..', config.credentialsFile),
    scopes:  ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

function columnLetter(index) {
  let col = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n   = Math.floor((n - 1) / 26);
  }
  return col;
}

function buildHeader() {
  return ['Email', 'Name', 'Registered', ...SLOTS.map(s => s.label), 'Total'];
}

// altEmail.lower → primaryEmail (original case) — populated by readAttendeesCSV
const emailAliasMap = new Map();

// If email is a known alt, returns the primary email. Otherwise returns email unchanged.
function resolveToCanonical(email) {
  return emailAliasMap.get(email.toLowerCase().trim()) || email;
}

function readAttendeesCSV() {
  const filePath = path.join(__dirname, '..', 'attendees.csv');
  if (!fs.existsSync(filePath)) return null;

  const lines       = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  const header      = lines[0].split(',').map(h => h.trim().toLowerCase());
  const nameIdx     = header.indexOf('name');
  const emailIdx    = header.indexOf('email');
  const altEmailIdx = header.indexOf('alt_email');

  if (nameIdx === -1 || emailIdx === -1) {
    console.warn('⚠️  attendees.csv missing "name" or "email" column');
    return [];
  }

  emailAliasMap.clear();

  return lines.slice(1)
    .map(line => {
      const parts    = line.split(',');
      const email    = parts[emailIdx]?.trim();
      const name     = parts[nameIdx]?.trim();
      const altEmail = altEmailIdx !== -1 ? parts[altEmailIdx]?.trim() : '';
      if (email && altEmail) {
        emailAliasMap.set(altEmail.toLowerCase(), email);
      }
      return { email, name };
    })
    .filter(a => a.email && a.name);
}

function csvField(value) {
  const v = (value || '').trim();
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

// Appends a new student to attendees.csv. Throws if email/alt_email already used.
function addAttendeeToCSV(name, email, altEmail) {
  name     = (name     || '').trim();
  email    = (email    || '').trim();
  altEmail = (altEmail || '').trim();
  if (!name || !email) throw new Error('Name and email are required');

  const filePath  = path.join(__dirname, '..', 'attendees.csv');
  const existing  = readAttendeesCSV() || [];
  const emailLow  = email.toLowerCase();
  const altLow    = altEmail.toLowerCase();

  for (const a of existing) {
    if (a.email.toLowerCase() === emailLow || (altLow && a.email.toLowerCase() === altLow)) {
      throw new Error(`"${email}" is already in attendees.csv`);
    }
  }
  if (emailAliasMap.has(emailLow) || (altLow && emailAliasMap.has(altLow))) {
    throw new Error(`"${email}" is already in attendees.csv (as an alt email)`);
  }

  // Place values by header column name — don't assume a fixed column order.
  const header  = fs.readFileSync(filePath, 'utf8').split('\n')[0].split(',').map(h => h.trim().toLowerCase());
  const nameIdx = header.indexOf('name');
  const emailIdx = header.indexOf('email');
  const altIdx  = header.indexOf('alt_email');

  const row = new Array(header.length).fill('');
  row[nameIdx]  = csvField(name);
  row[emailIdx] = csvField(email);
  if (altIdx !== -1) row[altIdx] = csvField(altEmail);

  fs.appendFileSync(filePath, `\n${row.join(',')}`);
  console.log(`📝 Added to attendees.csv: ${name} <${email}>`);
}

// Rebuilds Master completely from:
//   CSV (attendee list) + slot tabs (audit) + Registration tab (audit)
// Called every startup — idempotent, heals any prior inconsistency.
async function rebuildMaster(sheets) {
  // ── 1. CSV attendees (ordered, primary source for names) ─
  const csvAttendees = readAttendeesCSV() || [];
  if (csvAttendees.length === 0 && !fs.existsSync(path.join(__dirname, '..', 'attendees.csv'))) {
    console.warn('⚠️  attendees.csv not found — Master rebuilt from audit tabs only');
  }

  // email.lower → { email, name }  (preserves CSV ordering)
  const attendeeMap = new Map();
  for (const a of csvAttendees) {
    attendeeMap.set(a.email.toLowerCase().trim(), { email: a.email.trim(), name: a.name.trim() });
  }

  // ── 2. Read slot tabs (audit) → slot attendance per email ─
  // email.lower → Set of slot labels attended
  const slotAttendance = new Map();

  for (const slot of SLOTS) {
    try {
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: config.spreadsheetId,
        range:         `${slot.sheet}!B:C`,  // Email(B), Name(C)
      });
      const rows = (result.data.values || []).slice(1);
      for (const row of rows) {
        const raw   = (row[0] || '').trim();
        if (!raw) continue;
        const email = resolveToCanonical(raw).toLowerCase();  // alt → primary

        if (!slotAttendance.has(email)) slotAttendance.set(email, new Set());
        slotAttendance.get(email).add(slot.label);
      }
    } catch (e) {
      // Slot tab doesn't exist yet — skip silently
    }
  }

  // ── 3. Read Registration tab (audit) → registered emails ─
  const registeredEmails = new Set();
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range:         `${REGISTRATION_TAB}!B:B`,  // Email column
    });
    const rows = (result.data.values || []).slice(1);
    for (const row of rows) {
      const email = (row[0] || '').toLowerCase().trim();
      if (email) registeredEmails.add(email);
    }
  } catch (e) { /* Registration tab not yet created */ }

  // ── 4. Build fresh data rows ──────────────────────────────
  const dataRows = [];
  for (const [emailLower, person] of attendeeMap) {
    const registered = registeredEmails.has(emailLower) ? '✓' : '';
    const slotCols   = SLOTS.map(s =>
      (slotAttendance.get(emailLower) || new Set()).has(s.label) ? '✓' : ''
    );
    dataRows.push([person.email, person.name, registered, ...slotCols, '']);
  }

  // ── 5. Clear Master data rows and rewrite ─────────────────
  await sheets.spreadsheets.values.clear({
    spreadsheetId: config.spreadsheetId,
    range:         `${MASTER_TAB}!A2:ZZ`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId:    config.spreadsheetId,
    range:            `${MASTER_TAB}!A1`,
    valueInputOption: 'USER_ENTERED',
    resource:         { values: [buildHeader()] },
  });

  if (dataRows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId:    config.spreadsheetId,
      range:            `${MASTER_TAB}!A1`,
      valueInputOption: 'USER_ENTERED',
      resource:         { values: dataRows },
    });

    // Write Total formulas (dataRows[i] → spreadsheet row 2+i)
    const firstSlotCol = columnLetter(COL_SLOT_START);
    const lastSlotCol  = columnLetter(COL_SLOT_START + SLOTS.length - 1);
    const totalCol     = columnLetter(COL_SLOT_START + SLOTS.length);
    const totalFormulas = dataRows.map((_, i) => {
      const row = 2 + i;
      return [`=COUNTIF(${firstSlotCol}${row}:${lastSlotCol}${row},"✓")`];
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId:    config.spreadsheetId,
      range:            `${MASTER_TAB}!${totalCol}2`,
      valueInputOption: 'USER_ENTERED',
      resource:         { values: totalFormulas },
    });
  }

  console.log(`📋 Master rebuilt: ${dataRows.length} rows from CSV`);
}

// Writes/rewrites Analysis tab with formulas. Stateless — safe to call every startup.
async function writeAnalysisTab(sheets) {
  const regCol = columnLetter(COL_REGISTERED);

  const overview = [
    ['OVERVIEW', ''],
    ['Total Registered',     `=COUNTIF(Master!${regCol}:${regCol},"✓")`],
    ['Total in System',      `=COUNTA(Master!A2:A10000)`],
    ['Overall Attendance %', `=IF(B3=0,"N/A",TEXT(B2/B3,"0.0%"))`],
    [''],
  ];

  const SLOT_DATA_ROW_START = 7;
  const slotHeaders = ['Slot', 'Attended', 'Registered', 'Attendance %'];
  const slotRows    = SLOTS.map((slot, i) => {
    const slotCol = columnLetter(COL_SLOT_START + i);
    const row     = SLOT_DATA_ROW_START + i;
    return [
      slot.label,
      `=COUNTIF(Master!${slotCol}:${slotCol},"✓")`,
      `=COUNTIF(Master!${regCol}:${regCol},"✓")`,
      `=IF(C${row}=0,"N/A",TEXT(B${row}/C${row},"0.0%"))`,
    ];
  });

  const DAY_DATA_START = SLOT_DATA_ROW_START + SLOTS.length + 3;
  const days = [...new Set(SLOTS.map(s => s.label.split('—')[0].trim()))];
  const dayHeaders = ['Day', 'Morning Attended', 'Afternoon Attended', 'Total Day'];
  const dayRows = days.map((day, idx) => {
    const mSlots = SLOTS.filter(s => s.label.startsWith(day) && s.label.toLowerCase().includes('morning'));
    const aSlots = SLOTS.filter(s => s.label.startsWith(day) && s.label.toLowerCase().includes('afternoon'));
    const mFmt   = mSlots.length ? '=' + mSlots.map(s => { const c = columnLetter(COL_SLOT_START + SLOTS.indexOf(s)); return `COUNTIF(Master!${c}:${c},"✓")`; }).join('+') : '=0';
    const aFmt   = aSlots.length ? '=' + aSlots.map(s => { const c = columnLetter(COL_SLOT_START + SLOTS.indexOf(s)); return `COUNTIF(Master!${c}:${c},"✓")`; }).join('+') : '=0';
    const row    = DAY_DATA_START + idx;
    return [day, mFmt, aFmt, `=B${row}+C${row}`];
  });

  const allValues = [
    ...overview,
    slotHeaders, ...slotRows,
    [''], [''],
    dayHeaders,  ...dayRows,
    [''],
    ['PER-STUDENT BREAKDOWN'],
    ['→ See "Master" tab — one row per student, ✓ per slot attended'],
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId:    config.spreadsheetId,
    range:            `${ANALYSIS_TAB}!A1`,
    valueInputOption: 'USER_ENTERED',
    resource:         { values: allValues },
  });
  console.log('📊 Analysis tab updated');
}

// Idempotent entry point — called every server startup.
async function initializeSpreadsheet() {
  const sheets      = await getSheetsClient();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: config.spreadsheetId });
  const sheetMeta   = spreadsheet.data.sheets;
  const existingTabs = new Set(sheetMeta.map(s => s.properties.title));

  // ── Ensure all required tabs exist ───────────────────────
  const tabsToCreate = [
    { title: MASTER_TAB,       index: 0 },
    { title: REGISTRATION_TAB, index: null },
    { title: ANALYSIS_TAB,     index: null },
    ...SLOTS.map(s => ({ title: s.sheet, index: null })),
  ].filter(t => !existingTabs.has(t.title));

  for (const tab of tabsToCreate) {
    const props = { title: tab.title };
    if (tab.index !== null) props.index = tab.index;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.spreadsheetId,
      resource: { requests: [{ addSheet: { properties: props } }] },
    });
    existingTabs.add(tab.title);

    // Write headers for new tabs
    const headers = {
      [MASTER_TAB]:       [buildHeader()],
      [REGISTRATION_TAB]: [['Timestamp', 'Email', 'Name']],
      [ANALYSIS_TAB]:     null, // written by writeAnalysisTab
    };
    const tabHeader = headers[tab.title] ?? [['Timestamp', 'Email', 'Name']]; // slot tabs
    if (tabHeader) {
      await sheets.spreadsheets.values.update({
        spreadsheetId:    config.spreadsheetId,
        range:            `${tab.title}!A1`,
        valueInputOption: 'USER_ENTERED',
        resource:         { values: tabHeader },
      });
    }
    console.log(`📄 Created tab: ${tab.title}`);
  }

  // ── Rebuild Master from CSV + audit tabs ─────────────────
  await rebuildMaster(sheets);

  // ── Write Analysis formulas ───────────────────────────────
  await writeAnalysisTab(sheets);

  console.log('✅ Spreadsheet ready');
}

// Appends any CSV rows not already in Master. Never touches existing rows —
// safe to run while server is live and students are actively marking attendance.
async function addNewAttendeesFromCSV() {
  const sheets = await getSheetsClient();
  const csvAttendees = readAttendeesCSV() || [];

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range:         `${MASTER_TAB}!A:A`,
  });
  const existingRows   = result.data.values || [];
  const existingEmails = new Set(
    existingRows.slice(1).map(r => (r[0] || '').toLowerCase().trim()).filter(Boolean)
  );
  const startRow = existingRows.length + 1;

  const newAttendees = csvAttendees.filter(a => !existingEmails.has(a.email.toLowerCase().trim()));
  if (newAttendees.length === 0) return { added: 0, names: [] };

  const newRows = newAttendees.map(a => [a.email.trim(), a.name.trim(), '', ...SLOTS.map(() => ''), '']);
  await sheets.spreadsheets.values.append({
    spreadsheetId:    config.spreadsheetId,
    range:            `${MASTER_TAB}!A1`,
    valueInputOption: 'USER_ENTERED',
    resource:         { values: newRows },
  });

  const firstSlotCol = columnLetter(COL_SLOT_START);
  const lastSlotCol  = columnLetter(COL_SLOT_START + SLOTS.length - 1);
  const totalCol     = columnLetter(COL_SLOT_START + SLOTS.length);
  const totalFormulas = newAttendees.map((_, i) => {
    const row = startRow + i;
    return [`=COUNTIF(${firstSlotCol}${row}:${lastSlotCol}${row},"✓")`];
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId:    config.spreadsheetId,
    range:            `${MASTER_TAB}!${totalCol}${startRow}`,
    valueInputOption: 'USER_ENTERED',
    resource:         { values: totalFormulas },
  });

  console.log(`➕ Added ${newAttendees.length} new attendee(s) from CSV`);
  return { added: newAttendees.length, names: newAttendees.map(a => a.name) };
}

// Real-time: mark ✓ in Master immediately after student submits.
// If this fails, next startup's rebuildMaster will catch it from slot tab audit.
async function markAttendanceInMaster(email, slotLabel) {
  const sheets = await getSheetsClient();

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range:         `${MASTER_TAB}!A:ZZ`,
  });
  const rows = result.data.values || [];
  if (rows.length < 2) return;

  const header   = rows[0];
  const colIndex = header.indexOf(slotLabel);
  if (colIndex === -1) { console.warn(`⚠️  Slot column "${slotLabel}" not in Master header`); return; }

  const rowIndex = rows.findIndex(
    (r, i) => i > 0 && (r[0] || '').toLowerCase().trim() === email.toLowerCase().trim()
  );
  if (rowIndex === -1) { console.warn(`⚠️  "${email}" not in Master — not in attendees.csv`); return; }

  const sheetRow  = rowIndex + 1;
  const attendCol = columnLetter(colIndex);

  await sheets.spreadsheets.values.update({
    spreadsheetId:    config.spreadsheetId,
    range:            `${MASTER_TAB}!${attendCol}${sheetRow}`,
    valueInputOption: 'USER_ENTERED',
    resource:         { values: [['✓']] },
  });

  const totalIndex = header.indexOf('Total');
  if (totalIndex !== -1) {
    const firstSlotCol = columnLetter(COL_SLOT_START);
    const lastSlotCol  = columnLetter(totalIndex - 1);
    const totalCol     = columnLetter(totalIndex);
    await sheets.spreadsheets.values.update({
      spreadsheetId:    config.spreadsheetId,
      range:            `${MASTER_TAB}!${totalCol}${sheetRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[`=COUNTIF(${firstSlotCol}${sheetRow}:${lastSlotCol}${sheetRow},"✓")`]] },
    });
  }
  console.log(`📊 Master: ${email} → ${slotLabel} ✓`);
}

// Returns attendee list with registration status for admin UI.
async function getAttendeesForAdmin() {
  const sheets = await getSheetsClient();
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range:         `${MASTER_TAB}!A:C`,
  });
  const rows = result.data.values || [];
  return rows.slice(1)
    .map(row => ({
      email:      (row[0] || '').trim(),
      name:       (row[1] || '').trim(),
      registered: (row[2] || '').trim() === '✓',
    }))
    .filter(a => a.email);
}

// Marks ✓ in Master Registered column + appends to Registration tab.
async function markRegistrationInMaster(email) {
  const sheets = await getSheetsClient();

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range:         `${MASTER_TAB}!A:C`,
  });
  const rows     = result.data.values || [];
  const rowIndex = rows.findIndex(
    (r, i) => i > 0 && (r[0] || '').toLowerCase().trim() === email.toLowerCase().trim()
  );
  if (rowIndex === -1) throw new Error(`"${email}" not found in Master`);

  const sheetRow = rowIndex + 1;
  const regCol   = columnLetter(COL_REGISTERED);

  await sheets.spreadsheets.values.update({
    spreadsheetId:    config.spreadsheetId,
    range:            `${MASTER_TAB}!${regCol}${sheetRow}`,
    valueInputOption: 'USER_ENTERED',
    resource:         { values: [['✓']] },
  });

  const name      = (rows[rowIndex][1] || '').trim();
  const timestamp = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId:    config.spreadsheetId,
    range:            `${REGISTRATION_TAB}!A1`,
    valueInputOption: 'USER_ENTERED',
    resource:         { values: [[timestamp, email, name]] },
  });

  console.log(`✅ Registered: ${name} (${email})`);
}

// Returns all students + attended status for a given slot.
// Student list from Master (= CSV). Attended status from slot tab directly (source of truth).
async function getSlotAttendanceForAdmin(slotLabel, sheetName) {
  const sheets = await getSheetsClient();

  // 1. Student list from Master
  const masterResult = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range:         `${MASTER_TAB}!A:B`,
  });
  const masterRows = (masterResult.data.values || []).slice(1).filter(r => r[0]);

  // 2. Who actually attended — read slot tab B column (email)
  const attendedEmails = new Set();
  try {
    const slotResult = await sheets.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range:         `${sheetName}!B:B`,
    });
    (slotResult.data.values || []).slice(1).forEach(r => {
      if (r[0]) attendedEmails.add(resolveToCanonical(r[0]).toLowerCase().trim());
    });
  } catch (e) { /* slot tab not created yet — no one attended */ }

  return masterRows.map(row => ({
    email:    (row[0] || '').trim(),
    name:     (row[1] || '').trim(),
    attended: attendedEmails.has(resolveToCanonical(row[0] || '').toLowerCase().trim()),
  }));
}

// Returns one student's per-slot attendance + total. null if email not in Master.
async function getStudentAttendance(email) {
  const sheets = await getSheetsClient();
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range:         `${MASTER_TAB}!A:ZZ`,
  });
  const rows = result.data.values || [];
  if (rows.length < 2) return null;

  const header    = rows[0];
  const canonical = resolveToCanonical(email).toLowerCase().trim();
  const row = rows.find((r, i) => i > 0 && (r[0] || '').toLowerCase().trim() === canonical);
  if (!row) return null;

  const slots = SLOTS.map((s, i) => ({
    label:    s.label,
    attended: (row[COL_SLOT_START + i] || '').trim() === '✓',
  }));

  const totalIndex = header.indexOf('Total');
  const total = totalIndex !== -1
    ? Number(row[totalIndex]) || 0
    : slots.filter(s => s.attended).length;

  return {
    name:       (row[1] || '').trim(),
    email:      (row[0] || '').trim(),
    slots,
    total,
    totalSlots: SLOTS.length,
  };
}

module.exports = {
  initializeSpreadsheet,
  getAttendeesForAdmin,
  getSlotAttendanceForAdmin,
  markRegistrationInMaster,
  markAttendanceInMaster,
  resolveToCanonical,
  addNewAttendeesFromCSV,
  addAttendeeToCSV,
  getStudentAttendance,
};
