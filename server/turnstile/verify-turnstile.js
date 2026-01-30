const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function verifyTurnstile(token, ip = null) {
  if (!token) {
    return { success: false, error: 'Missing token.' };
  }
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return { success: false, error: 'Missing TURNSTILE_SECRET_KEY.' };
  }

  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (ip) body.set('remoteip', ip);

  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    body,
  });
  const data = await response.json();
  if (!data.success) {
    return { success: false, error: data['error-codes'] || 'Verification failed.' };
  }
  return { success: true };
}

module.exports = { verifyTurnstile };
