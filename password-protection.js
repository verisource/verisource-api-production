/**
 * Simple password protection for beta site
 */

const BETA_PASSWORD = process.env.BETA_PASSWORD || 'verisource2024';

function requirePassword(req, res, next) {
  // Check if user has valid session
  if (req.session && req.session.authenticated) {
    return next();
  }
  
  // Check for password in query param or POST body
  const providedPassword = req.query.password || req.body.password;
  
  if (providedPassword === BETA_PASSWORD) {
    req.session.authenticated = true;
    return next();
  }
  
  // Redirect to login page
  res.redirect('/login');
}

module.exports = { requirePassword, BETA_PASSWORD };
