const express        = require('express');
const session        = require('express-session');
const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const path           = require('path');
const fs             = require('fs');

const config                  = require('./config');
const { initializeSpreadsheet } = require('./services/masterSheet');
const authRouter              = require('./routes/auth');
const adminRouter             = require('./routes/admin');
const attendanceRouter        = require('./routes/attendance');

const oauthJson  = JSON.parse(fs.readFileSync(path.join(__dirname, config.oauthFile), 'utf8'));
const oauthEntry = oauthJson.web || oauthJson.installed;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ secret: config.sessionSecret, resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
  clientID:          oauthEntry.client_id,
  clientSecret:      oauthEntry.client_secret,
  callbackURL:       `${config.baseUrl}/auth/google/callback`,
  passReqToCallback: true,
}, (req, accessToken, refreshToken, profile, done) => {
  return done(null, {
    email:        profile.emails[0].value,
    name:         profile.displayName,
    pendingToken: req.session.pendingToken || null,
  });
}));

passport.serializeUser((user, done)   => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

app.use(authRouter);
app.use(adminRouter);
app.use(attendanceRouter);

app.get('/',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(config.port, () => {
  console.log(`🚀 Server running at http://localhost:${config.port}`);
  initializeSpreadsheet().catch(err =>
    console.error('❌ Spreadsheet init failed:', err.message)
  );
});
