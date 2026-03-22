/**
 * Google OAuth 2.0 Configuration
 * 
 * To enable Google Sign-In:
 * 1. Go to https://console.cloud.google.com/
 * 2. Create a project (or select existing)
 * 3. Go to APIs & Services → Credentials
 * 4. Create OAuth 2.0 Client ID (Web application)
 * 5. Add authorized redirect URIs:
 *    - http://localhost:4000/auth/google/callback (development)
 *    - https://ican-admin.onrender.com/auth/google/callback (production)
 * 6. Set environment variables:
 *    - GOOGLE_CLIENT_ID=your-client-id
 *    - GOOGLE_CLIENT_SECRET=your-client-secret
 */

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

function setupGoogleAuth(app, db) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    console.log('Google OAuth not configured (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)');
    return false;
  }

  const isProd = process.env.NODE_ENV === 'production';
  const baseUrl = isProd ? 'https://ican-admin.onrender.com' : 'http://localhost:4000';

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
    done(null, account);
  });

  passport.use(new GoogleStrategy({
    clientID: clientId,
    clientSecret: clientSecret,
    callbackURL: baseUrl + '/auth/google/callback'
  }, (accessToken, refreshToken, profile, done) => {
    const email = (profile.emails && profile.emails[0] && profile.emails[0].value || '').toLowerCase();
    if (!email) {
      return done(null, false, { message: 'No email found in Google profile.' });
    }

    // Look up the account
    let account = db.prepare('SELECT * FROM accounts WHERE email = ?').get(email);
    
    if (!account) {
      // No account with this Google email — deny
      return done(null, false, { message: 'No ICAN account found for ' + email + '. Contact your administrator.' });
    }

    // Update last login
    db.prepare("UPDATE accounts SET last_login = datetime('now') WHERE id = ?").run(account.id);
    
    done(null, account);
  }));

  app.use(passport.initialize());
  // Note: we don't use passport.session() — we manage sessions ourselves

  // Google OAuth routes
  app.get('/auth/google', passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account'
  }));

  app.get('/auth/google/callback', 
    passport.authenticate('google', { session: false, failureRedirect: '/login?error=google_denied' }),
    (req, res) => {
      const account = req.user;
      if (!account) {
        return res.redirect('/login?error=no_account');
      }

      const roles = JSON.parse(account.roles || '[]');
      
      // Set the unified session
      req.session.accountId = account.id;
      req.session.accountEmail = account.email;
      req.session.accountName = account.name;
      req.session.accountRoles = roles;

      // Auto-activate all portal sessions
      if (roles.includes('admin') && account.admin_user_id) {
        const adminUser = db.prepare('SELECT * FROM users WHERE id = ?').get(account.admin_user_id);
        if (adminUser) {
          req.session.userId = adminUser.id;
          req.session.userName = adminUser.name;
          req.session.userEmail = adminUser.email;
          req.session.userRole = adminUser.role;
        }
      }

      if (roles.includes('volunteer') && account.gardener_id) {
        const cred = db.prepare('SELECT * FROM member_credentials WHERE gardener_id = ?').get(account.gardener_id);
        const gardener = db.prepare('SELECT * FROM gardeners WHERE id = ?').get(account.gardener_id);
        if (cred && gardener) {
          req.session.memberId = cred.id;
          req.session.memberGardenerId = gardener.id;
          req.session.memberName = gardener.first_name + ' ' + gardener.last_name;
          req.session.memberEmail = cred.email;
          req.session.memberMustChangePassword = 0;
          req.session.memberOnboardingCompleted = cred.onboarding_completed;
        }
      }

      if (roles.includes('director') && account.board_member_id) {
        const member = db.prepare('SELECT * FROM board_members WHERE id = ?').get(account.board_member_id);
        if (member) {
          req.session.directorId = member.id;
          req.session.directorBoardMemberId = member.id;
          req.session.directorName = member.first_name + ' ' + member.last_name;
          req.session.directorEmail = member.email;
          req.session.directorTitle = member.title;
          req.session.directorIsOfficer = member.is_officer;
          req.session.directorOfficerTitle = member.officer_title;
          req.session.directorMustChangePassword = 0;
          req.session.directorOnboardingCompleted = member.onboarding_completed;
        }
      }

      // Route to appropriate portal
      if (roles.length === 1) {
        if (roles[0] === 'admin') return res.redirect('/admin');
        if (roles[0] === 'volunteer') return res.redirect('/member');
        if (roles[0] === 'director') return res.redirect('/director');
      }
      res.redirect('/portal-select');
    }
  );

  console.log('Google OAuth enabled');
  return true;
}

module.exports = { setupGoogleAuth };
