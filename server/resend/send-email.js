const RESEND_API_URL = 'https://api.resend.com/emails';

async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey) {
    throw new Error('Missing RESEND_API_KEY.');
  }
  if (!from) {
    throw new Error('Missing RESEND_FROM.');
  }
  if (!to || !subject) {
    throw new Error('Missing required fields.');
  }

  const payload = {
    from,
    to,
    subject,
    html,
    text,
  };

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Resend error: ${errorText}`);
  }

  return response.json();
}

module.exports = { sendEmail };
