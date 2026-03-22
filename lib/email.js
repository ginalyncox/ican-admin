/**
 * Email sending via Brevo (formerly Sendinblue)
 * Free tier: 300 emails/day
 * 
 * Set BREVO_API_KEY environment variable to enable.
 */

const BREVO_API_KEY = process.env.BREVO_API_KEY;

/**
 * Generate branded HTML email template
 */
function buildEmailHTML(subject, bodyText, options = {}) {
  const preheader = options.preheader || '';
  const unsubscribeUrl = options.unsubscribeUrl || 'https://iowacannabisaction.org';
  
  // Convert plain text body to HTML paragraphs
  const bodyHTML = bodyText
    .split('\n\n')
    .map(p => p.trim())
    .filter(p => p)
    .map(p => `<p style="margin: 0 0 16px; line-height: 1.7;">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body { margin: 0; padding: 0; background-color: #F5F3ED; font-family: 'Work Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .container { max-width: 600px; margin: 0 auto; }
</style>
</head>
<body style="margin: 0; padding: 0; background-color: #F5F3ED;">
${preheader ? `<div style="display: none; font-size: 1px; color: #F5F3ED; line-height: 1px; max-height: 0; max-width: 0; opacity: 0; overflow: hidden;">${preheader}</div>` : ''}

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #F5F3ED;">
<tr><td style="padding: 24px 16px;">

  <!-- Main Card -->
  <table role="presentation" class="container" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(30,36,24,0.08);">

    <!-- Header -->
    <tr>
      <td style="background-color: #2D6A3F; padding: 28px 32px; text-align: center;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td style="text-align: center;">
              <!-- Leaf icon -->
              <div style="display: inline-block; width: 36px; height: 36px; margin-bottom: 8px;">
                <img src="https://iowacannabisaction.org/favicon-32.png" alt="" width="32" height="32" style="display: block; margin: 0 auto;">
              </div>
              <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: #ffffff; letter-spacing: 0.02em;">Iowa Cannabis Action Network</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Body -->
    <tr>
      <td style="padding: 32px 32px 24px; font-size: 15px; color: #1E2418; line-height: 1.7;">
        <h1 style="font-family: Georgia, 'Times New Roman', serif; font-size: 22px; font-weight: 700; color: #2D6A3F; margin: 0 0 20px; line-height: 1.3;">${subject}</h1>
        ${bodyHTML}
      </td>
    </tr>

    <!-- CTA -->
    <tr>
      <td style="padding: 0 32px 32px; text-align: center;">
        <a href="https://iowacannabisaction.org/get-involved.html" style="display: inline-block; padding: 12px 28px; background-color: #2D6A3F; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">Get Involved</a>
      </td>
    </tr>

    <!-- Divider -->
    <tr>
      <td style="padding: 0 32px;">
        <hr style="border: none; border-top: 1px solid #D6D0C0; margin: 0;">
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="padding: 24px 32px; text-align: center; font-size: 12px; color: #8A9478; line-height: 1.6;">
        <p style="margin: 0 0 8px;">Iowa Cannabis Action Network, Inc.</p>
        <p style="margin: 0 0 8px;">
          <a href="https://iowacannabisaction.org" style="color: #2D6A3F; text-decoration: none;">Website</a> &middot;
          <a href="https://facebook.com/61584583045381" style="color: #2D6A3F; text-decoration: none;">Facebook</a> &middot;
          <a href="mailto:hello@iowacannabisaction.org" style="color: #2D6A3F; text-decoration: none;">Contact</a>
        </p>
        <p style="margin: 0; font-size: 11px; color: #B0ADA5;">
          You received this because you subscribed to ICAN updates.<br>
          ICAN is a 501(c)(4) social welfare organization. EIN: 41-2746368
        </p>
      </td>
    </tr>

  </table>

</td></tr>
</table>
</body>
</html>`;
}

/**
 * Send email via Brevo API
 * @param {Object} options - { to: [{email, name}], subject, htmlContent, textContent }
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendEmail({ to, subject, htmlContent, textContent }) {
  if (!BREVO_API_KEY) {
    console.log('Brevo not configured — email not sent');
    return { success: false, error: 'BREVO_API_KEY not set' };
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'Iowa Cannabis Action Network', email: 'hello@iowacannabisaction.org' },
        to,
        subject,
        htmlContent,
        textContent: textContent || subject,
      }),
    });

    const data = await response.json();
    if (response.ok) {
      return { success: true, messageId: data.messageId };
    } else {
      console.error('Brevo error:', data);
      return { success: false, error: data.message || 'Send failed' };
    }
  } catch (err) {
    console.error('Email send error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Send newsletter to all active subscribers
 */
async function sendNewsletter(db, subject, body, sentBy) {
  const subscribers = db.prepare("SELECT email, name FROM subscribers WHERE status = 'active'").all();
  if (subscribers.length === 0) {
    return { success: false, sent: 0, error: 'No active subscribers' };
  }

  const htmlContent = buildEmailHTML(subject, body);
  
  let sent = 0;
  let errors = [];

  // Brevo allows up to 50 recipients per API call
  // Send in batches
  const batchSize = 50;
  for (let i = 0; i < subscribers.length; i += batchSize) {
    const batch = subscribers.slice(i, i + batchSize);
    const to = batch.map(s => ({ email: s.email, name: s.name || undefined }));
    
    const result = await sendEmail({
      to,
      subject,
      htmlContent,
      textContent: body,
    });

    if (result.success) {
      sent += batch.length;
    } else {
      errors.push(result.error);
    }
  }

  // Log the send
  db.prepare('INSERT INTO newsletter_sends (subject, body, recipient_count, sent_by) VALUES (?, ?, ?, ?)')
    .run(subject, body, sent, sentBy);

  // Also create member_messages entry
  try {
    db.prepare("INSERT INTO member_messages (subject, body, message_type, sent_by) VALUES (?, ?, 'newsletter', ?)")
      .run(subject, body, sentBy);
  } catch (e) { /* ignore */ }

  return { success: sent > 0, sent, total: subscribers.length, errors };
}

module.exports = { sendEmail, sendNewsletter, buildEmailHTML };
