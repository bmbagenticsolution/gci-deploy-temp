// api/stripe-webhook.js
// GCI Payment Platform - Stripe Webhook Handler (ESM)
//
// Handles:
//   checkout.session.completed    -> activate plan, store in KV, send confirmation email
//   customer.subscription.updated -> sync subscription status in KV
//   customer.subscription.deleted -> mark cancelled in KV, send cancellation email
//   invoice.payment_succeeded     -> reset monthly report count for Tier 2, keep active
//   invoice.payment_failed        -> mark payment_failed in KV, send warning email
//   charge.dispute.created        -> auto-submit legal evidence to Stripe Disputes API
//   charge.dispute.updated        -> log only
//   charge.dispute.closed         -> log only

const { hsUpsertContact, hsLogTimelineNote, hsCreateDealForContact, HS_LIFECYCLE, HS_SOURCE, HS_STAGE } = require('../lib/hubspot.js');
const { fanOutLeadEvent } = require('../lib/notify.js');
const { kvGet, kvSet, kvLpush, kvLrange } = require('../redis-client');

// Disable Vercel's body parser so we can read the raw body for Stripe signature verification
export const config = { api: { bodyParser: false } };

// Plan data helpers
async function getPlanData(email) {
  return await kvGet(`plan:${email}`);
}

async function setPlanData(email, data) {
  const existing = (await getPlanData(email)) || {};
  const merged = { ...existing, ...data, updatedAt: new Date().toISOString() };
  await kvSet(`plan:${email}`, merged);
  return merged;
}

// Report limit helpers
function getInitialReportsRemaining(plan, billing) {
  if (plan === 'conviction-screen') return 1;
  if (plan === 'due-diligence') return 5;
  return null; // null = unlimited
}

function getNextMonthReset() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return next.toISOString();
}

// Ensure user exists in gci:user and users:all list
async function ensureUserRecord(email, plan) {
  const userKey  = `gci:user:${email}`;
  const existing = await kvGet(userKey);

  if (!existing) {
    const newUser = {
      email,
      name: '',
      company: '',
      created: new Date().toISOString(),
      plan,
      planStatus: 'active',
    };
    await kvSet(userKey, newUser);
  } else {
    const updated = typeof existing === 'object' ? existing : {};
    await kvSet(userKey, { ...updated, plan, planStatus: 'active' });
  }

  // Add to users:all list (admin dashboard uses this)
  const allUsersRaw = await kvGet('users:all');
  let allUsers = Array.isArray(allUsersRaw) ? allUsersRaw : [];
  if (!allUsers.includes(email)) {
    allUsers.unshift(email);
    await kvSet('users:all', allUsers);
  }
}

// Email sender via Resend
async function sendEmail({ to, subject, html }) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    console.warn('[webhook] RESEND_API_KEY not set - email not sent to', to);
    return false;
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Gulf Capital Intelligence <difc@gulfcapitalintelligence.com>',
        to: [to],
        subject,
        html,
      }),
    });
    if (!r.ok) {
      const err = await r.text();
      console.error('[webhook] Resend error:', err);
      return false;
    }
    console.log(`[webhook] Email sent to ${to}: ${subject}`);
    return true;
  } catch (e) {
    console.error('[webhook] Email send failed:', e.message);
    return false;
  }
}

// Plan display names
const PLAN_LABELS = {
  'conviction-screen':    'Conviction Screen',
  'due-diligence':        'Due Diligence Access',
  'intelligence-retainer':'Intelligence Retainer',
};

const PLAN_PRICES = {
  'conviction-screen':    '$499 one-time',
  'due-diligence':        '$999/month',
  'intelligence-retainer':'$2,499/month',
};

// Email templates
function confirmationEmail(email, plan, billing) {
  const label = PLAN_LABELS[plan] || plan;
  const price = billing === 'annual'
    ? (plan === 'due-diligence' ? '$9,990/year' : '$24,990/year')
    : (PLAN_PRICES[plan] || '');
  const reportsInfo = plan === 'conviction-screen'
    ? '1 conviction report included in your one-time purchase.'
    : plan === 'due-diligence'
    ? 'Up to 5 conviction reports per month, resets on your billing date.'
    : 'Unlimited conviction reports, 3 team seats included.';
  const accessUrl = (process.env.APP_URL || 'https://gulfcapitalintelligence.com') + '/app';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:40px 16px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:600px">
      <!-- Header -->
      <tr><td style="background:#0B1D35;padding:32px 40px;text-align:center">
        <div style="font-family:Georgia,serif;font-size:22px;color:#C8A84B;letter-spacing:0.05em;font-weight:400">GULF CAPITAL INTELLIGENCE</div>
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:10px;color:rgba(200,168,75,0.6);letter-spacing:0.15em;text-transform:uppercase;margin-top:6px">DIFC, Dubai</div>
      </td></tr>
      <!-- Body -->
      <tr><td style="padding:40px 40px 32px">
        <div style="font-size:24px;font-weight:600;color:#0B1D35;margin-bottom:8px">Your subscription is active.</div>
        <div style="font-size:15px;color:#5a6a7e;margin-bottom:32px;line-height:1.6">Thank you. Your GCI access is confirmed and ready to use.</div>
        <!-- Plan box -->
        <div style="background:#f8f9fb;border:1px solid #e2e6ed;border-radius:10px;padding:24px;margin-bottom:28px">
          <div style="font-size:11px;color:#8a9bb0;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:6px">Active Plan</div>
          <div style="font-size:20px;font-weight:700;color:#0B1D35;margin-bottom:4px">${label}</div>
          <div style="font-size:14px;color:#C8A84B;font-weight:600;margin-bottom:12px">${price}</div>
          <div style="font-size:13px;color:#5a6a7e;line-height:1.7">${reportsInfo}</div>
        </div>
        <!-- CTA -->
        <div style="text-align:center;margin-bottom:32px">
          <a href="${accessUrl}" style="display:inline-block;background:#0B1D35;color:#ffffff;font-size:14px;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;letter-spacing:0.02em">Access Your Dashboard</a>
        </div>
        <div style="font-size:13px;color:#8a9bb0;line-height:1.8">
          <strong style="color:#5a6a7e">Getting started:</strong><br>
          Log in to your account at <a href="${accessUrl}" style="color:#0B1D35">${accessUrl}</a><br>
          Enter your investment parameters and generate your first conviction report.<br>
          All reports are saved in your account history.
        </div>
      </td></tr>
      <!-- Footer -->
      <tr><td style="background:#f8f9fb;border-top:1px solid #e2e6ed;padding:20px 40px;text-align:center">
        <div style="font-size:11px;color:#a0aab8;line-height:1.8">
          Gulf Capital Intelligence &bull; DIFC, Dubai, UAE<br>
          Queries: <a href="mailto:difc@gulfcapitalintelligence.com" style="color:#0B1D35">difc@gulfcapitalintelligence.com</a>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function cancellationEmail(email, plan) {
  const label = PLAN_LABELS[plan] || plan;
  const accessUrl = (process.env.APP_URL || 'https://gulfcapitalintelligence.com') + '/app';
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:40px 16px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;max-width:600px">
      <tr><td style="background:#0B1D35;padding:28px 40px;text-align:center">
        <div style="font-family:Georgia,serif;font-size:20px;color:#C8A84B">GULF CAPITAL INTELLIGENCE</div>
      </td></tr>
      <tr><td style="padding:40px">
        <div style="font-size:22px;font-weight:600;color:#0B1D35;margin-bottom:12px">Subscription cancelled.</div>
        <div style="font-size:14px;color:#5a6a7e;line-height:1.7;margin-bottom:24px">
          Your <strong>${label}</strong> subscription has been cancelled. You will retain access until the end of your current billing period, after which your account will revert to read-only mode.
        </div>
        <div style="font-size:13px;color:#5a6a7e;line-height:1.8;margin-bottom:24px">
          Your saved reports remain accessible in your account history. To reactivate your subscription at any time, log in and choose a plan.
        </div>
        <div style="text-align:center;margin-bottom:24px">
          <a href="${accessUrl}" style="display:inline-block;background:#0B1D35;color:#fff;font-size:13px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none">View Account</a>
        </div>
        <div style="font-size:12px;color:#a0aab8">Questions: <a href="mailto:difc@gulfcapitalintelligence.com" style="color:#0B1D35">difc@gulfcapitalintelligence.com</a></div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function paymentFailedEmail(email, plan) {
  const label = PLAN_LABELS[plan] || plan;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:40px 16px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;max-width:600px">
      <tr><td style="background:#0B1D35;padding:28px 40px;text-align:center">
        <div style="font-family:Georgia,serif;font-size:20px;color:#C8A84B">GULF CAPITAL INTELLIGENCE</div>
      </td></tr>
      <tr><td style="padding:40px">
        <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px 20px;margin-bottom:24px">
          <div style="font-size:14px;font-weight:600;color:#856404">Action required: payment failed</div>
        </div>
        <div style="font-size:15px;font-weight:600;color:#0B1D35;margin-bottom:12px">We were unable to process your payment.</div>
        <div style="font-size:14px;color:#5a6a7e;line-height:1.7;margin-bottom:24px">
          Your <strong>${label}</strong> subscription payment has failed. Stripe will automatically retry within the next few days. To avoid any interruption to your access, please update your payment method.
        </div>
        <div style="font-size:13px;color:#5a6a7e;line-height:1.8;margin-bottom:24px">
          Common reasons: expired card, insufficient funds, or a bank security block on international transactions. Updating your card in Stripe takes under 2 minutes.
        </div>
        <div style="font-size:12px;color:#a0aab8">Questions: <a href="mailto:difc@gulfcapitalintelligence.com" style="color:#0B1D35">difc@gulfcapitalintelligence.com</a></div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// Auto-dispute handler: gathers evidence and submits to Stripe
async function handleDispute(stripe, dispute) {
  const { id: disputeId, charge: chargeId, amount, currency, reason } = dispute;
  const created = new Date(dispute.created * 1000).toISOString();
  console.log(`[webhook] DISPUTE ${disputeId} charge=${chargeId} reason=${reason} amount=${amount} ${currency}`);

  let charge = {}, customer = {}, subscription = null, invoiceData = null;

  try { charge = await stripe.charges.retrieve(chargeId); } catch (e) { console.error('charge retrieve:', e.message); }
  if (charge.customer) {
    try { customer = await stripe.customers.retrieve(charge.customer); } catch (e) { console.error('customer retrieve:', e.message); }
  }

  const custEmail = customer.email || charge.receipt_email || charge.billing_details?.email || '';
  if (custEmail) {
    const planData = await getPlanData(custEmail);
    if (planData?.subscriptionId) {
      try { subscription = await stripe.subscriptions.retrieve(planData.subscriptionId); } catch (e) { console.error('sub retrieve:', e.message); }
    }
  }
  if (charge.invoice) {
    try { invoiceData = await stripe.invoices.retrieve(charge.invoice); } catch (e) { console.error('invoice retrieve:', e.message); }
  }

  const fmtDate = ts => ts ? new Date(ts * 1000).toISOString().split('T')[0] : 'N/A';
  const custName = customer.name || charge.billing_details?.name || 'N/A';
  const custIp   = charge.metadata?.customer_ip || 'Recorded in platform logs';
  const serviceDate = fmtDate(charge.created);

  const evidenceText = [
    'GULF CAPITAL INTELLIGENCE: CHARGEBACK DISPUTE EVIDENCE',
    '======================================================',
    '',
    'COMPANY: Boost My Business AI Innovation Limited',
    'PLATFORM: gulfcapitalintelligence.com',
    'JURISDICTION: DIFC, Dubai, UAE  |  CR No: 1082109',
    '',
    'DISPUTE DETAILS:',
    `Dispute ID: ${disputeId}`,
    `Charge ID: ${chargeId}`,
    `Amount: ${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`,
    `Dispute Reason: ${reason}`,
    `Dispute Created: ${created}`,
    `Customer: ${custName} (${custEmail})`,
    '',
    'SERVICE DESCRIPTION:',
    'Gulf Capital Intelligence provides AI-powered investment conviction reports.',
    'Reports are digital products generated instantly upon customer request.',
    'Each report is unique, generated in real-time based on customer parameters.',
    'The service is consumed immediately upon delivery within the platform.',
    '',
    'DELIVERY CONFIRMATION:',
    `Service Date: ${serviceDate}`,
    `Subscription ID: ${subscription ? subscription.id : 'N/A'}`,
    `Subscription Status at Charge: ${subscription ? subscription.status : 'active'}`,
    `Customer Account Created: ${fmtDate(customer.created)}`,
    `Customer IP at Signup: ${custIp}`,
    `Invoice ID: ${invoiceData ? invoiceData.id : 'N/A'}`,
    '',
    'The customer created an account, selected a subscription plan,',
    'and completed payment through Stripe secure checkout.',
    'Platform access was granted immediately upon payment confirmation.',
    '',
    'REFUND POLICY (PUBLISHED BEFORE PURCHASE):',
    'All sales are final. No refunds, returns, or credits once a subscription',
    'is activated or a report is generated. This policy is clearly displayed:',
    '  1. On the signup form (links to Terms and Refund Policy)',
    '  2. On the Stripe checkout page',
    '  3. Published at: gulfcapitalintelligence.com/refund-policy',
    '  4. In Terms of Use Section 6: gulfcapitalintelligence.com/terms',
    '',
    'LEGAL BASIS:',
    'UAE Federal Law No. 15 of 2020 (Consumer Protection)',
    'UAE Electronic Transactions Law (Federal Law No. 46 of 2021)',
    'EU Consumer Rights Directive 2011/83/EU, Article 16(m) digital content exception',
    'UK Consumer Contracts Regulations 2013',
    '',
    'The customer explicitly agreed to the no-refund policy before completing',
    'their purchase. The digital service was delivered and consumed immediately.',
    'This transaction is not eligible for a refund under published policies.',
  ].join('\n');

  try {
    await stripe.disputes.update(disputeId, {
      evidence: {
        product_description: 'AI-powered investment conviction report for GCC markets. Digital product generated instantly and delivered within the Gulf Capital Intelligence platform.',
        customer_name: custName,
        customer_email_address: custEmail,
        customer_purchase_ip: custIp,
        service_date: serviceDate,
        refund_policy: 'All sales are final. No refunds once a subscription is activated or report is generated. Published at gulfcapitalintelligence.com/refund-policy and gulfcapitalintelligence.com/terms (Section 6).',
        refund_policy_disclosure: 'Refund policy is displayed as a clickable link on the signup form, referenced in Terms of Use Section 6, and published on a dedicated refund policy page. Customer must accept before account creation and Stripe checkout.',
        refund_refusal_explanation: 'Customer purchased a digital service delivered and consumed immediately. Published no-refund policy, agreed to before purchase, clearly states all sales are final for instantly-delivered digital products.',
        cancellation_policy: 'Subscriptions may be cancelled anytime to prevent future charges, but no refunds are issued for the current billing period or previously delivered services.',
        cancellation_policy_disclosure: 'Cancellation policy is included in the Refund and Cancellation Policy page, linked from signup form and Terms of Use.',
        access_activity_log: 'Customer created account, activated subscription, and had platform access for report generation. Account creation and subscription activation timestamps recorded.',
        uncategorized_text: evidenceText,
      },
      submit: true,
    });
    console.log(`[webhook] Dispute evidence submitted for ${disputeId}`);
  } catch (e) {
    console.error('[webhook] Failed to submit dispute evidence:', e.message);
  }

  await kvSet(`dispute:${disputeId}`, {
    disputeId, chargeId, amount, currency, reason,
    customerEmail: custEmail, customerName: custName,
    created, evidenceSubmitted: true, submittedAt: new Date().toISOString(),
  });
}

// Read raw body for Stripe signature verification
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    const timer = setTimeout(() => reject(new Error('Body read timeout')), 30000);
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 2 * 1024 * 1024) { clearTimeout(timer); reject(new Error('Request body too large')); }
    });
    req.on('end', () => { clearTimeout(timer); resolve(data); });
    req.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, stripe-signature');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let stripe;
  try {
    const { default: Stripe } = await import('stripe');
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  } catch (e) {
    console.error('[webhook] Failed to init Stripe:', e.message);
    return res.status(500).json({ error: 'Stripe init failed' });
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header' });

  let event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('[webhook] Signature verification failed:', e.message);
    return res.status(400).json({ error: 'Webhook signature verification failed: ' + e.message });
  }

  console.log(`[webhook] Event: ${event.type} id=${event.id}`);

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        const email   = (session.customer_email || session.metadata?.email || '').toLowerCase().trim();
        const plan    = session.metadata?.plan;
        const billing = session.metadata?.billing || 'monthly';

        if (!email || !plan) {
          console.warn('[webhook] checkout.session.completed missing email or plan', session.id);
          break;
        }

        const reportsRemaining = plan === 'conviction-screen' ? 1
                               : plan === 'due-diligence'     ? 5
                               : null; // unlimited

        await setPlanData(email, {
          plan,
          status: 'active',
          billing,
          stripeCustomerId:  session.customer || null,
          subscriptionId:    session.subscription || null,
          reportsRemaining,
          reportsUsedTotal:  0,
          reportsUsedMonth:  0,
          monthReset:        plan === 'due-diligence' ? getNextMonthReset() : null,
          seats:             session.metadata?.seats || '1',
          activatedAt:       new Date().toISOString(),
        });

        await ensureUserRecord(email, plan);

        // Log payment event
        await kvLpush('events:payment', {
          email, plan, billing,
          amount: session.amount_total || 0,
          currency: session.currency || 'usd',
          sessionId: session.id,
          timestamp: new Date().toISOString(),
          type: 'checkout.session.completed',
        });

        // Send confirmation email
        await sendEmail({
          to: email,
          subject: `Your GCI ${PLAN_LABELS[plan] || plan} is now active`,
          html: confirmationEmail(email, plan, billing),
        });

        console.log(`[webhook] Plan activated: ${email} -> ${plan} (${billing})`);

        // Best-effort HubSpot lifecycle flip to customer
        hsUpsertContact({
          email,
          source: HS_SOURCE.STRIPE,
          lifecycleStage: HS_LIFECYCLE.CUSTOMER,
          extra: {
            gci_plan: PLAN_LABELS[plan] || plan,
            gci_source: HS_SOURCE.STRIPE
          }
        }).then(() => hsLogTimelineNote({
          email,
          body: `Stripe checkout completed: ${PLAN_LABELS[plan] || plan} (${billing}). Amount: ${(session.amount_total||0)/100} ${(session.currency||'usd').toUpperCase()}. Session: ${session.id}`
        })).catch(() => {});

        // Auto-create a Won deal in HubSpot for the new paying customer
        hsCreateDealForContact({
          email,
          dealname: `${PLAN_LABELS[plan] || plan} - ${email}`,
          stage: HS_STAGE.WON,
          amount: ((session.amount_total || 0) / 100).toFixed(2),
          closeDate: new Date().toISOString().slice(0, 10),
          extra: {
            description: `Stripe checkout. Plan ${PLAN_LABELS[plan] || plan} (${billing}). Session ${session.id}`
          }
        }).catch(() => {});

        fanOutLeadEvent({
          kind: 'New Paying Customer',
          email,
          summary: `${PLAN_LABELS[plan] || plan} subscription started for ${email}.`,
          fields: [
            { label: 'Plan',    value: PLAN_LABELS[plan] || plan },
            { label: 'Billing', value: billing },
            { label: 'Amount',  value: '$' + ((session.amount_total || 0) / 100).toFixed(2) },
            { label: 'Session', value: session.id }
          ]
        });
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const email = (sub.metadata?.email || '').toLowerCase().trim();
        const plan  = sub.metadata?.plan;

        if (!email) { console.warn('[webhook] subscription.updated missing email'); break; }

        const status = sub.status === 'active' ? 'active' : sub.status;
        const existing = (await getPlanData(email)) || {};

        await setPlanData(email, {
          ...existing,
          plan:             plan || existing.plan,
          status,
          stripeCustomerId: sub.customer || existing.stripeCustomerId,
          subscriptionId:   sub.id,
        });

        console.log(`[webhook] Subscription updated: ${email} status=${status}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub   = event.data.object;
        const email = (sub.metadata?.email || '').toLowerCase().trim();

        if (!email) { console.warn('[webhook] subscription.deleted missing email'); break; }

        const existing = (await getPlanData(email)) || {};
        const plan = existing.plan || sub.metadata?.plan;

        await setPlanData(email, {
          ...existing,
          status:         'cancelled',
          subscriptionId: sub.id,
          cancelledAt:    new Date().toISOString(),
        });

        // Update user record
        const userKey = `gci:user:${email}`;
        const user = await kvGet(userKey);
        if (user && typeof user === 'object') {
          await kvSet(userKey, { ...user, planStatus: 'cancelled' });
        }

        await sendEmail({
          to: email,
          subject: 'Your GCI subscription has been cancelled',
          html: cancellationEmail(email, plan),
        });

        console.log(`[webhook] Subscription cancelled: ${email}`);

        // Best-effort HubSpot status update
        hsUpsertContact({
          email,
          source: HS_SOURCE.STRIPE,
          extra: {
            gci_plan: (PLAN_LABELS[plan] || plan || '') + ' (cancelled)'
          }
        }).then(() => hsLogTimelineNote({
          email,
          body: `Subscription cancelled: ${PLAN_LABELS[plan] || plan || 'unknown'}. Will retain access until end of billing period.`
        })).catch(() => {});
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const email   = (invoice.customer_email || '').toLowerCase().trim();

        if (!email) break;

        const existing = (await getPlanData(email)) || {};
        const plan = existing.plan;

        // Reset monthly report count for Tier 2
        const updates = {
          ...existing,
          status:          'active',
          stripeCustomerId: invoice.customer || existing.stripeCustomerId,
          lastPaymentAt:   new Date(invoice.created * 1000).toISOString(),
        };

        if (plan === 'due-diligence') {
          updates.reportsRemaining = 5;
          updates.reportsUsedMonth = 0;
          updates.monthReset       = getNextMonthReset();
        }

        await setPlanData(email, updates);

        await kvLpush('events:payment', {
          email, plan,
          amount:    invoice.amount_paid || 0,
          currency:  invoice.currency || 'usd',
          invoiceId: invoice.id,
          timestamp: new Date().toISOString(),
          type: 'invoice.payment_succeeded',
        });

        console.log(`[webhook] Payment succeeded: ${email}${plan === 'due-diligence' ? ' (reports reset to 5)' : ''}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const email   = (invoice.customer_email || '').toLowerCase().trim();

        if (!email) break;

        const existing = (await getPlanData(email)) || {};
        const plan = existing.plan;

        await setPlanData(email, {
          ...existing,
          status:               'payment_failed',
          lastFailedPaymentAt:  new Date(invoice.created * 1000).toISOString(),
        });

        await sendEmail({
          to: email,
          subject: 'GCI: Action required - payment failed',
          html: paymentFailedEmail(email, plan),
        });

        console.log(`[webhook] Payment failed: ${email}`);
        break;
      }

      case 'charge.dispute.created': {
        await handleDispute(stripe, event.data.object);
        break;
      }

      case 'charge.dispute.updated': {
        console.log(`[webhook] Dispute updated: ${event.data.object.id} status=${event.data.object.status}`);
        break;
      }

      case 'charge.dispute.closed': {
        console.log(`[webhook] Dispute closed: ${event.data.object.id} status=${event.data.object.status}`);
        break;
      }

      default:
        console.log(`[webhook] Unhandled event: ${event.type}`);
    }

    return res.status(200).json({ received: true, eventType: event.type });
  } catch (e) {
    console.error('[webhook] Processing error:', e.message, e.stack);
    return res.status(500).json({ error: 'Webhook processing failed: ' + e.message });
  }
}
