const { verifyTurnstile } = require('./verify-turnstile');

// Example express-style handler for server-side Turnstile verification.
// Wire this into your backend router at POST /api/turnstile/verify (or similar).
async function turnstileVerifyHandler(req, res) {
  try {
    const token = req.body?.token || '';
    const ip = req.body?.ip || null;
    const result = await verifyTurnstile(token, ip);
    if (!result.success) {
      return res.status(403).json({ success: false, error: result.error });
    }
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Verification failed.' });
  }
}

module.exports = { turnstileVerifyHandler };
