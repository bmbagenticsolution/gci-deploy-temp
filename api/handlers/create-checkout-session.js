// api/create-checkout-session.js
// GCI Payment Platform - Stripe Checkout Session Creator
//
// Tier 1 (conviction-screen):     $499 one-time,  1 report total
// Tier 2 (due-diligence):         $999/month,     5 reports/month, auto-debit, cancel anytime
// Tier 3 (intelligence-retainer): $2,499/month,   unlimited reports, 3 seats, cancel anytime
// Tier 4 (enterprise):            from $5,000/month - handled offline, no Stripe checkout here
//
// Annual billing for Tier 2 and 3 (2 months free):
//   Tier 2 annual: $9,990/year   -> env: STRIPE_PRICE_DUE_DILIGENCE_ANNUAL
//   Tier 3 annual: $24,990/year  -> env: STRIPE_PRICE_RETAINER_ANNUAL

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { default: Stripe } = await import('stripe');
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const stripe = new Stripe(stripeKey);
    const isTestMode = stripeKey && stripeKey.startsWith('sk_test_');

    const { plan, email, billing = 'monthly' } = req.body || {};
    const baseUrl = process.env.APP_URL || 'https://gulfcapitalintelligence.com';

    if (!plan) return res.status(400).json({ error: 'Plan is required' });
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email address is required' });

    const cleanEmail = email.toLowerCase().trim();

    // Test-mode price IDs (used when STRIPE_SECRET_KEY is sk_test_*)
    const TEST_PRICES = {
      dd_monthly: 'price_1TDC1H42YO00FnEZvdtnOZq9',
      dd_annual: 'price_1TQxs242YO00FnEZDtqTDw5a',
      retainer_monthly: 'price_1TDC1N42YO00FnEZ3ZSxsfiN',
      retainer_annual: 'price_1TQxs442YO00FnEZGntK7Qxb',
      enterprise: 'price_1TQxsU42YO00FnEZiCF1YMev',
      si_single: 'price_1TQxsW42YO00FnEZ35MStzil',
      si_multi: 'price_1TQxsX42YO00FnEZOEusKKiX',
      si_quarterly: 'price_1TQxsa42YO00FnEZxAPs7iH7',
      si_annual: 'price_1TQxsc42YO00FnEZDSqEtIjX',
    };

    function p(envKey, testKey) {
      if (isTestMode) return TEST_PRICES[testKey];
      return process.env[envKey] || TEST_PRICES[testKey];
    }

    const PLANS = {
      'conviction-screen': {
        mode: 'payment',
        name: 'GCI Conviction Screen',
        description: 'One AI-powered conviction report for a specific GCC investment opportunity',
        amount: 49900,
        reportsAllowed: '1',
        seats: '1',
      },
      'due-diligence': {
        mode: 'subscription',
        monthlyPriceId: p('STRIPE_PRICE_DUE_DILIGENCE', 'dd_monthly'),
        annualPriceId:  p('STRIPE_PRICE_DUE_DILIGENCE_ANNUAL', 'dd_annual'),
        reportsPerMonth: '5',
        seats: '1',
      },
      'intelligence-retainer': {
        mode: 'subscription',
        monthlyPriceId: p('STRIPE_PRICE_RETAINER', 'retainer_monthly'),
        annualPriceId:  p('STRIPE_PRICE_RETAINER_ANNUAL', 'retainer_annual'),
        reportsPerMonth: 'unlimited',
        seats: '3',
      },
      'enterprise': {
        mode: 'subscription',
        monthlyPriceId: p('STRIPE_PRICE_ENTERPRISE', 'enterprise'),
        annualPriceId:  p('STRIPE_PRICE_ENTERPRISE', 'enterprise'),
        reportsPerMonth: 'unlimited',
        seats: 'unlimited',
      },
      'si-single': {
        mode: 'payment',
        priceId: p('STRIPE_PRICE_SI_SINGLE', 'si_single'),
        reportsAllowed: '1',
        seats: '1',
      },
      'si-multi': {
        mode: 'payment',
        priceId: p('STRIPE_PRICE_SI_MULTI', 'si_multi'),
        reportsAllowed: '1',
        seats: '1',
      },
      'si-quarterly': {
        mode: 'subscription',
        monthlyPriceId: p('STRIPE_PRICE_SI_QUARTERLY', 'si_quarterly'),
        annualPriceId:  p('STRIPE_PRICE_SI_QUARTERLY', 'si_quarterly'),
        reportsPerMonth: '4-per-quarter',
        seats: '2',
      },
      'si-annual': {
        mode: 'subscription',
        monthlyPriceId: p('STRIPE_PRICE_SI_ANNUAL', 'si_annual'),
        annualPriceId:  p('STRIPE_PRICE_SI_ANNUAL', 'si_annual'),
        reportsPerMonth: 'unlimited',
        seats: '3',
      },
    };

    const cfg = PLANS[plan];
    if (!cfg) return res.status(400).json({ error: 'Invalid plan. Valid values: conviction-screen, due-diligence, intelligence-retainer' });

    const billingCycle = cfg.mode === 'payment' ? 'one-time' : billing;

    const metadata = {
      plan,
      email: cleanEmail,
      billing: billingCycle,
      seats: cfg.seats,
    };
    if (cfg.reportsPerMonth) metadata.reportsPerMonth = cfg.reportsPerMonth;
    if (cfg.reportsAllowed)  metadata.reportsAllowed  = cfg.reportsAllowed;

    const params = {
      payment_method_types: ['card'],
      mode: cfg.mode,
      customer_email: cleanEmail,
      metadata,
      success_url: `${baseUrl}/app?payment=success&plan=${encodeURIComponent(plan)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${baseUrl}/app?payment=cancelled`,
      allow_promotion_codes: true,
    };

    if (cfg.mode === 'payment') {
      if (cfg.priceId) {
        params.line_items = [{ price: cfg.priceId, quantity: 1 }];
      } else {
        params.line_items = [{
          price_data: {
            currency: 'usd',
            product_data: { name: cfg.name, description: cfg.description },
            unit_amount: cfg.amount,
          },
          quantity: 1,
        }];
      }
    } else {
      const priceId = billingCycle === 'annual' ? cfg.annualPriceId : cfg.monthlyPriceId;
      if (!priceId) {
        return res.status(500).json({
          error: `Stripe price ID not configured. Set STRIPE_PRICE_${plan.toUpperCase().replace(/-/g, '_')}${billingCycle === 'annual' ? '_ANNUAL' : ''} in Vercel environment variables.`
        });
      }
      params.line_items = [{ price: priceId, quantity: 1 }];
      params.subscription_data = { metadata };
    }

    const session = await stripe.checkout.sessions.create(params);
    console.log(`[checkout] Created session for ${cleanEmail}, plan=${plan}, billing=${billingCycle}`);

    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (e) {
    console.error('[create-checkout-session]', e.message);
    return res.status(500).json({ error: 'Failed to create checkout session: ' + e.message });
  }
}
