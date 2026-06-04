const config = {
  oauthFile:       process.env.GOOGLE_OAUTH_FILE || 'o_auth_credentials.json',
  spreadsheetId:   process.env.SPREADSHEET_ID,
  adminPassword:       process.env.ADMIN_PASSWORD,
  totpSecret:          process.env.TOTP_SECRET,
  baseUrl:             process.env.BASE_URL,
  sessionSecret:       process.env.SESSION_SECRET,
  credentialsFile:     process.env.GOOGLE_CREDENTIALS_FILE || 'credentials.json',
  port:                parseInt(process.env.PORT, 10) || 3000,
};

module.exports = config;
