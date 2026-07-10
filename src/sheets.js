const { google } = require('googleapis');

function loadCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }
  if (process.env.GOOGLE_SERVICE_ACCOUNT_FILE) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(process.env.GOOGLE_SERVICE_ACCOUNT_FILE);
  }
  throw new Error('No Google service account credentials configured (see .env.example).');
}

let sheetsClient = null;
function getSheets() {
  if (sheetsClient) return sheetsClient;
  const creds = loadCredentials();
  const auth = new google.auth.JWT(
    creds.client_email,
    null,
    creds.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

const SHEET_ID = () => process.env.GOOGLE_SHEET_ID;

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function ensureTab(title, headerRow) {
  const sheets = getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID() });
  const exists = meta.data.sheets.some(s => s.properties.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID(),
      requestBody: { requests: [{ addSheet: { properties: { title } } }] }
    });
  }
  // Always re-sync the header row (row 1) to whatever's currently expected —
  // not just at creation. This is what makes headers self-heal after a
  // column gets added/renamed in code, instead of needing a manual fix in
  // the Sheet every time the schema changes.
  if (headerRow) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID(),
      range: `${title}!A1:${colLetter(headerRow.length)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headerRow] }
    });
  }
}

async function appendRow(tabName, row) {
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID(),
    range: `${tabName}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });
}

// Overwrite (or create) a single "today" row identified by matching the date in column A.
// Used for the running daily mention-count tally so re-runs update instead of duplicating.
async function upsertRowByFirstColumn(tabName, keyValue, row) {
  const sheets = getSheets();
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID(),
    range: `${tabName}!A:A`
  });
  const values = existing.data.values || [];
  const rowIndex = values.findIndex(r => r[0] === keyValue);
  if (rowIndex === -1) {
    await appendRow(tabName, row);
    return;
  }
  const sheetRowNumber = rowIndex + 1; // 1-indexed
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID(),
    range: `${tabName}!A${sheetRowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [row] }
  });
}

// Creates a new, uniquely-named tab for a thread and writes the raw
// transcript into it (no AI summarization — just the messages, tagged by speaker).
async function createThreadTranscriptTab(baseName, contentRows) {
  const sheets = getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID() });
  const existingTitles = new Set(meta.data.sheets.map(s => s.properties.title));
  let title = baseName.slice(0, 95);
  let suffix = 2;
  while (existingTitles.has(title)) {
    title = `${baseName.slice(0, 90)}_${suffix}`;
    suffix += 1;
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID(),
    requestBody: { requests: [{ addSheet: { properties: { title } } }] }
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID(),
    range: `${title}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: contentRows }
  });
  return title;
}

module.exports = { ensureTab, appendRow, upsertRowByFirstColumn, createThreadTranscriptTab };
