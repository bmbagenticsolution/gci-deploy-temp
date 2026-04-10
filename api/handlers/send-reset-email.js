// api/send-reset-email.js
// Sends a real password reset email via Resend
// Uses HMAC-signed tokens — no extra dependencies needed

const crypto = require('crypto');

function generateToken(email) {
  const secret = process.env.ADMIN_SECRET || 'gci-reset-secret';
  const exp = Date.now() + 3600000; // 1 hour from now
  const payload = Buffer.from(JSON.stringify({ email, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const token = generateToken(email);
  const baseUrl = 'https://gulfcapitalintelligence.com';
  const resetLink = `${baseUrl}/app.html?reset_token=${encodeURIComponent(token)}&reset_email=${encodeURIComponent(email)}`;

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Gulf Capital Intelligence <noreply@gulfcapitalintelligence.com>',
        to: [email],
        subject: 'Reset your GCI password',
        html: `
          <!DOCTYPE html>
          <html>
          <head><meta charset="utf-8"></head>
          <body style="margin:0;padding:0;background:#f5f3ee;font-family:Arial,sans-serif">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ee;padding:40px 0">
              <tr><td align="center">
                <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
                  <tr>
                    <td style="background:#0b1d35;padding:28px 32px">
                      <table cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="background:#c8a84b;border-radius:5px;width:36px;height:36px;text-align:center;vertical-align:middle">
                            <span style="color:#0b1d35;font-weight:700;font-size:13px;line-height:36px">GCI</span>
                          </td>
                          <td style="padding-left:10px;color:#ffffff;font-size:13px;font-weight:600;vertical-align:middle">Gulf Capital Intelligence</td>
                        </tr>
                      </table>
                      <div style="color:#ffffff;font-size:20px;margin-top:14px;font-weight:400">Reset Your Password</div>
                      <div style="color:rgba(255,255,255,0.5);font-size:12px;margin-top:4px">Your request has been verified</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:32px">
                      <p style="color:#142840;font-size:15px;margin:0 0 16px">Hi there,</p>
                      <p style="color:#4a5568;font-size:14px;line-height:1.6;margin:0 0 24px">
                        We received a request to reset the password for <strong>${email}</strong>.
                        Click the button below to sign back in.
                      </p>
                      <table cellpadding="0" cellspacing="0" style="margin:0 0 24px">
                        <tr>
                          <td style="background:#0b1d35;border-radius:8px">
                            <a href="${resetLink}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">
                              Reset My Password
                            </a>
                          </td>
                        </tr>
                      </table>
                      <p style="color:#8a9bb0;font-size:12px;margin:0 0 24px">
                        This link expires in <strong>1 hour</strong>. If you did not request a reset, ignore this email.
                      </p>
                      <hr style="border:none;border-top:1px solid #e8e4dc;margin:0 0 20px">
                      <p style="color:#8a9bb0;font-size:11px;margin:0">
                        If the button does not work, copy this URL:<br>
                        <a href="${resetLink}" style="color:#c8a84b;word-break:break-all">${resetLink}</a>
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="background:#f7f5f0;padding:16px 32px;text-align:center">
                      <p style="color:#8a9bb0;font-size:11px;margin:0">Gulf Capital Intelligence &bull; DIFC, Dubai &bull; AI screening intelligence, not regulated investment advice.</p>
                    </td>
                  </tr>
                </table>
              </td></tr>
            </table>
          </body>
          </html>
        `,
      }),
    });

    if (!resendRes.ok) {
      const err = await resendRes.text();
      console.error('Resend error:', err);
    }
  } catch (err) {
    console.error('Send reset email error:', err);
  }

  // Always 200 to prevent email enumeration
  return res.status(200).json({ ok: true });
}
