// api/job.js — Server-rendered individual job pages for Google indexing
// URL: /careers/[slug] e.g. /careers/senior-research-analyst-difc

const JOBS = {
  'senior-research-analyst-difc': {
    title: 'Senior Research Analyst',
    location: 'Dubai DIFC',
    salary: 'AED 280,000 – 360,000 total package',
    type: 'Full-time',
    track: 'Research and Intelligence',
    employmentType: 'FULL_TIME',
    description: `Gulf Capital Intelligence is hiring a Senior Research Analyst based at our DIFC headquarters. This is a principal-level research role within our GCC conviction engine, responsible for producing institutional-grade investment analysis on private deals across real estate, private credit, healthcare, and technology sectors.

You will lead coverage of complex mandates, synthesise multi-source intelligence, and contribute to the AI agent framework that powers our conviction reports. This is not a traditional equity research role. GCI operates at the intersection of alternative investment analysis and AI-native research infrastructure.

Responsibilities include owning the research layer for active mandates, building data pipelines for sector intelligence, calibrating our six specialist AI agents against market data, and leading client briefing preparation for family office and sovereign fund clients.

Required: 8+ years of investment research, private markets analysis, or GCC deal advisory experience. Demonstrated track record covering UAE, Saudi Arabia, or broader GCC markets. Strong financial modelling, regulatory awareness, and structured writing skills. DIFC or ADGM familiarity preferred.`,
    requirements: [
      '8+ years investment research or GCC deal advisory experience',
      'Coverage of UAE, Saudi Arabia, or broader GCC private markets',
      'Strong financial modelling and structured analysis skills',
      'Experience with private equity, real estate, or private credit mandates',
      'Excellent written English for institutional client deliverables',
      'DIFC or ADGM regulatory familiarity preferred'
    ],
    applyUrl: 'https://gulfcapitalintelligence.com/careers'
  },
  'investment-research-analyst-dubai': {
    title: 'Investment Research Analyst',
    location: 'Dubai',
    salary: 'AED 180,000 – 240,000 total package',
    type: 'Full-time',
    track: 'Research and Intelligence',
    employmentType: 'FULL_TIME',
    description: `Gulf Capital Intelligence is seeking an Investment Research Analyst to join our Dubai-based research team. This role focuses on building and maintaining the structured intelligence inputs that feed our six-agent AI conviction system.

You will be responsible for data gathering, financial analysis, regulatory research, and structured documentation across active GCC investment mandates. Working alongside senior analysts and AI systems, you will contribute to conviction reports used by family offices, sovereign wealth funds, and private banks operating across the GCC.

This is an early-career role for a high-potential analyst who wants to work at the frontier of private markets intelligence and applied AI research infrastructure.`,
    requirements: [
      '2-5 years financial services, investment banking, or research experience',
      'Exposure to GCC markets through work, education, or coverage',
      'Strong Excel, financial modelling, and quantitative analysis skills',
      'Attention to detail and structured written communication',
      'Interest in AI-augmented research workflows',
      'CFA progress or CAIA qualification is a plus'
    ],
    applyUrl: 'https://gulfcapitalintelligence.com/careers'
  },
  'investment-research-analyst-riyadh': {
    title: 'Investment Research Analyst',
    location: 'Riyadh, Saudi Arabia',
    salary: 'SAR 220,000 – 300,000 total package',
    type: 'Full-time',
    track: 'Research and Intelligence',
    employmentType: 'FULL_TIME',
    description: `Gulf Capital Intelligence is opening a Riyadh-based research position to support our expanding Saudi Arabia mandate coverage. The role focuses on Vision 2030 aligned investment analysis, PIF ecosystem coverage, and structured intelligence on private transactions across Saudi healthcare, technology, and infrastructure sectors.

As Investment Research Analyst in Riyadh, you will produce structured deal intelligence, regulatory assessments, and sector briefings that feed directly into our conviction engine. The role requires strong Arabic and English capability, deep familiarity with the Saudi regulatory environment, and an analytical mindset suited to private markets intelligence.`,
    requirements: [
      '2-5 years experience in Saudi financial services, investment, or advisory',
      'Fluent Arabic and English (written and spoken)',
      'Familiarity with Vision 2030, PIF investment mandate, and Saudi regulatory environment',
      'Strong analytical and structured writing skills',
      'Knowledge of SAMA, CMA, or Ministry of Investment frameworks',
      'Based in or willing to relocate to Riyadh'
    ],
    applyUrl: 'https://gulfcapitalintelligence.com/careers'
  },
  'gcc-investment-intelligence-associate': {
    title: 'GCC Investment Intelligence Associate',
    location: 'Dubai or Remote GCC',
    salary: 'AED 120,000 – 160,000 total package',
    type: 'Full-time',
    track: 'Research and Intelligence',
    employmentType: 'FULL_TIME',
    description: `An entry-level research position at Gulf Capital Intelligence designed for sharp, motivated analysts who want to build a career in GCC private markets intelligence. This Associate role supports our senior research team with market data collection, structured analysis, regulatory monitoring, and AI agent calibration.

You will work with our proprietary conviction engine from day one, learning how institutional-grade private investment analysis is structured, synthesised, and delivered. This role is designed to develop into a full Research Analyst position within 18-24 months.`,
    requirements: [
      '0-2 years experience in financial analysis, research, or related field',
      'Degree in Finance, Economics, Business, or quantitative discipline',
      'Exceptional analytical thinking and attention to detail',
      'Strong Excel and structured writing skills',
      'Genuine interest in GCC markets and private investment',
      'Arabic language skills are an advantage'
    ],
    applyUrl: 'https://gulfcapitalintelligence.com/careers'
  },
  'due-diligence-analyst-dubai': {
    title: 'Due Diligence Analyst',
    location: 'Dubai DIFC',
    salary: 'AED 200,000 – 280,000 total package',
    type: 'Full-time',
    track: 'Due Diligence and Private Markets',
    employmentType: 'FULL_TIME',
    description: `Gulf Capital Intelligence is hiring a Due Diligence Analyst to lead the structured verification layer of our conviction reports. This role sits at the core of our analytical process, responsible for stress-testing deal narratives, verifying financial representations, and assessing legal, regulatory, and counterparty risk across active GCC private market mandates.

You will work with our legal AI agent, compliance data layer, and internal research team to produce the diligence section of every major conviction report. Clients include family offices, sovereign vehicles, and private banking institutions operating across the UAE, Saudi Arabia, and the broader GCC.`,
    requirements: [
      '4-8 years due diligence, transaction advisory, or private markets experience',
      'Background in Big 4 advisory, private equity DD, or investment banking',
      'Familiarity with GCC corporate law, DIFC or ADGM structures, or Saudi regulatory frameworks',
      'Strong analytical writing and structured report production skills',
      'Ability to identify principal misalignment and structuring risk in deal documentation',
      'ACA, CFA, or ACCA qualification preferred'
    ],
    applyUrl: 'https://gulfcapitalintelligence.com/careers'
  },
  'due-diligence-analyst-riyadh': {
    title: 'Due Diligence Analyst',
    location: 'Riyadh, Saudi Arabia',
    salary: 'SAR 280,000 – 380,000 total package',
    type: 'Full-time',
    track: 'Due Diligence and Private Markets',
    employmentType: 'FULL_TIME',
    description: `A senior DD analyst role based in Riyadh, covering Saudi private market transactions with a focus on compliance, regulatory risk, and counterparty verification. This position leads the diligence layer for all Saudi mandates processed through our conviction engine, working closely with Riyadh-based family offices, private equity sponsors, and Vision 2030 related transactions.`,
    requirements: [
      '5-10 years due diligence or transaction advisory experience in Saudi Arabia',
      'Deep knowledge of Saudi corporate law, SAMA/CMA regulatory framework, and foreign investment rules',
      'Fluent Arabic and English',
      'Big 4, investment bank, or PE fund background preferred',
      'Experience with Saudi M&A, private credit, or real estate transactions',
      'Based in Riyadh or willing to relocate'
    ],
    applyUrl: 'https://gulfcapitalintelligence.com/careers'
  },
  'private-credit-analyst': {
    title: 'Private Credit Analyst',
    location: 'Dubai DIFC',
    salary: 'AED 220,000 – 300,000 total package',
    type: 'Full-time',
    track: 'Due Diligence and Private Markets',
    employmentType: 'FULL_TIME',
    description: `Gulf Capital Intelligence is building dedicated private credit coverage capability. This analyst role specialises in covenant analysis, credit structuring assessment, cash flow modelling, and lender-side due diligence for direct lending, mezzanine, and distressed debt transactions across the GCC.

You will produce the credit intelligence layer for mandates where our clients are deploying capital into private lending structures. This includes EBITDA coverage analysis, security assessment, intercreditor analysis, and regulatory compliance review under DFSA and Saudi SAMA frameworks.`,
    requirements: [
      '4-7 years private credit, leveraged finance, or structured finance experience',
      'Track record analysing loan documentation, covenant packages, and credit structures',
      'Strong financial modelling for cash flow and credit analysis',
      'Familiarity with GCC private credit markets and direct lending infrastructure',
      'Experience with DFSA or SAMA regulated lending environments preferred',
      'CFA or equivalent qualification preferred'
    ],
    applyUrl: 'https://gulfcapitalintelligence.com/careers'
  },
  'real-estate-intelligence-analyst': {
    title: 'Real Estate Intelligence Analyst',
    location: 'Dubai',
    salary: 'AED 180,000 – 250,000 total package',
    type: 'Full-time',
    track: 'Sector Intelligence',
    employmentType: 'FULL_TIME',
    description: `A sector specialist role covering UAE and GCC real estate investment. This analyst builds and maintains the real estate intelligence layer within our conviction engine, covering off-plan market dynamics, developer risk, absorption data, RERA regulatory compliance, and secondary market liquidity across Dubai, Abu Dhabi, and Riyadh.

Clients deploying into GCC real estate rely on GCI to provide conviction analysis that goes beyond developer marketing materials. This role is responsible for ensuring our real estate agent produces accurate, defensible, and contextually calibrated output.`,
    requirements: [
      '3-6 years UAE or GCC real estate investment, research, or advisory experience',
      'Familiarity with RERA, Dubai Land Department data, and Strata regulations',
      'Quantitative skills for absorption analysis and comparable transaction benchmarking',
      'Understanding of off-plan developer risk, title transfer timelines, and escrow structures',
      'Strong structured writing for institutional clients',
      'RICS, CFA, or real estate finance qualification preferred'
    ],
    applyUrl: 'https://gulfcapitalintelligence.com/careers'
  },
  'healthcare-consumer-intelligence-analyst': {
    title: 'Healthcare and Consumer Intelligence Analyst',
    location: 'Dubai',
    salary: 'AED 180,000 – 250,000 total package',
    type: 'Full-time',
    track: 'Sector Intelligence',
    employmentType: 'FULL_TIME',
    description: `Gulf Capital Intelligence is hiring a sector intelligence analyst with deep coverage of GCC healthcare and consumer sectors. This role focuses on private healthcare operators, diagnostics groups, pharmaceutical distribution, medical technology, and consumer retail investment opportunities across the UAE and Saudi Arabia.

You will produce the sector intelligence layer for healthcare and consumer mandates, covering market sizing, regulatory licensing, operator benchmarking, and competitive dynamics for GCI's institutional client base.`,
    requirements: [
      '3-6 years healthcare investment research, private equity sector coverage, or advisory experience',
      'Coverage of GCC healthcare systems, DHA/HAAD/MOH regulatory frameworks',
      'Understanding of Saudi healthcare Vision 2030 privatisation mandates',
      'Quantitative analysis and comparable company benchmarking skills',
      'Background in consumer or retail sector analysis is a strong advantage',
      'CFA or healthcare finance qualification preferred'
    ],
    applyUrl: 'https://gulfcapitalintelligence.com/careers'
  },
  'technology-venture-intelligence-analyst': {
    title: 'Technology and Venture Intelligence Analyst',
    location: 'Dubai',
    salary: 'AED 180,000 – 250,000 total package',
    type: 'Full-time',
    track: 'Sector Intelligence',
    employmentType: 'FULL_TIME',
    description: `A technology and venture sector intelligence role covering GCC-based and GCC-expanding technology companies, venture-backed businesses, and early-stage investment mandates. This analyst covers fintech, SaaS, logistics technology, and AI-native businesses being evaluated by family offices and sovereign vehicles in the UAE and Saudi Arabia.

You will produce the technology intelligence layer for GCI's conviction engine, including founder background verification, product-market fit assessment, competitive landscape mapping, and growth metric analysis calibrated against comparable emerging market technology businesses.`,
    requirements: [
      '3-6 years venture capital, technology investment, or startup advisory experience',
      'Coverage of MENA or GCC technology ecosystem (Magnitt, Wamda, WAM data familiarity a plus)',
      'Ability to evaluate early-stage companies using qualitative and quantitative frameworks',
      'Understanding of fintech regulatory environments (DIFC, ADGM, SAMA)',
      'Strong network in GCC technology and venture ecosystem is a significant advantage',
      'MBA, CFA, or technology-adjacent qualification preferred'
    ],
    applyUrl: 'https://gulfcapitalintelligence.com/careers'
  },
  'client-development-associate': {
    title: 'Client Development Associate',
    location: 'Dubai DIFC',
    salary: 'AED 160,000 – 220,000 base + performance incentive',
    type: 'Full-time',
    track: 'Client Coverage',
    employmentType: 'FULL_TIME',
    description: `Gulf Capital Intelligence is hiring a Client Development Associate to support our senior client coverage team in growing relationships with family offices, private banks, and sovereign wealth vehicles across the GCC.

This role is responsible for identifying and qualifying prospective institutional clients, supporting senior directors in client presentations and proposal development, and managing the early stages of the client onboarding process. This is a business development role within a highly specialised intelligence firm, not a traditional sales position.`,
    requirements: [
      '2-5 years experience in institutional sales, relationship management, or investment product coverage',
      'Existing relationships or access within GCC family office, private banking, or wealth management network',
      'Strong communication and presentation skills in English (Arabic a significant advantage)',
      'Understanding of GCC investment culture and relationship-driven business development',
      'Ability to represent GCI at the analytical level during client conversations',
      'CFA progress or CAIA qualification preferred'
    ],
    applyUrl: 'https://gulfcapitalintelligence.com/careers'
  },
  'senior-client-director': {
    title: 'Senior Client Director',
    location: 'Dubai DIFC',
    salary: 'AED 350,000 – 500,000 base + significant performance incentive',
    type: 'Full-time',
    track: 'Client Coverage',
    employmentType: 'FULL_TIME',
    description: `A senior revenue-generating role at Gulf Capital Intelligence. The Senior Client Director owns relationships with our largest and most strategically important institutional clients, including sovereign wealth vehicles, tier-one family offices, and private banking platforms across the UAE and Saudi Arabia.

This is a principal-level client-facing position that requires the ability to engage at C-suite and investment committee level, position GCI's analytical capabilities against complex mandates, and drive subscription and retainer revenue from institutional investors who rely on our conviction engine.`,
    requirements: [
      '10+ years senior relationship management in private banking, family office coverage, or institutional investment',
      'Proven track record of managing and growing institutional client relationships in the GCC',
      'Existing senior-level network within UAE or Saudi family office and sovereign wealth community',
      'Ability to engage credibly on investment analysis, private deal structures, and conviction frameworks',
      'Exceptional communication, negotiation, and executive presence',
      'Arabic language skills are highly advantageous'
    ],
    applyUrl: 'https://gulfcapitalintelligence.com/careers'
  }
};

module.exports = async function handler(req, res) {
  const { slug } = req.query;
  const job = JOBS[slug];

  if (!job) {
    res.setHeader('Location', '/careers');
    return res.status(302).end();
  }

  const postedDate = '2025-01-15';
  const validThrough = '2026-12-31';
  const baseUrl = 'https://gulfcapitalintelligence.com';
  const canonicalUrl = `${baseUrl}/careers/${slug}`;
  const schemaOrg = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: job.description,
    identifier: { '@type': 'PropertyValue', name: 'Gulf Capital Intelligence', value: slug },
    datePosted: postedDate,
    validThrough: validThrough,
    employmentType: job.employmentType,
    hiringOrganization: {
      '@type': 'Organization',
      name: 'Gulf Capital Intelligence',
      sameAs: baseUrl,
      logo: `${baseUrl}/gci-logo-white.png`
    },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'Gate Village, Building 10',
        addressLocality: job.location.includes('Riyadh') ? 'Riyadh' : 'Dubai',
        addressRegion: job.location.includes('Riyadh') ? 'Riyadh' : 'Dubai',
        addressCountry: job.location.includes('Saudi') || job.location.includes('Riyadh') ? 'SA' : 'AE'
      }
    },
    baseSalary: {
      '@type': 'MonetaryAmount',
      currency: job.salary.startsWith('SAR') ? 'SAR' : 'AED',
      value: { '@type': 'QuantitativeValue', unitText: 'YEAR' }
    },
    occupationalCategory: job.track,
    industry: 'Investment Intelligence / Financial Services',
    directApply: true,
    applicationContact: {
      '@type': 'ContactPoint',
      email: 'difc@gulfcapitalintelligence.com',
      contactType: 'Hiring'
    }
  });

  const requirementsHtml = job.requirements
    .map(r => `<li>${r}</li>`)
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${job.title} | ${job.location} | Gulf Capital Intelligence</title>
<meta name="description" content="${job.title} at Gulf Capital Intelligence, ${job.location}. ${job.salary}. Join the GCC's leading AI-native investment intelligence platform.">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${canonicalUrl}">
<meta property="og:title" content="${job.title} | Gulf Capital Intelligence">
<meta property="og:description" content="${job.description.slice(0, 160)}...">
<meta property="og:url" content="${canonicalUrl}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${job.title} | Gulf Capital Intelligence">
<script type="application/ld+json">${schemaOrg}</script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; background: #f4f5f7; color: #222; line-height: 1.7; }
  a { color: #C8A84B; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .header { background: #0B1D35; padding: 20px 32px; display: flex; align-items: center; justify-content: space-between; }
  .header-brand { color: #C8A84B; font-size: 18px; font-weight: 700; letter-spacing: 0.3px; }
  .header-sub { color: #8a9db5; font-size: 12px; margin-top: 3px; }
  .header-nav a { color: #8a9db5; font-size: 13px; margin-left: 24px; }
  .hero { background: #0B1D35; border-top: 1px solid rgba(200,168,75,0.2); padding: 40px 32px 32px; }
  .hero-inner { max-width: 800px; margin: 0 auto; }
  .hero-track { font-size: 11px; color: #C8A84B; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 10px; }
  .hero-title { font-size: 32px; font-weight: 800; color: #fff; margin-bottom: 12px; line-height: 1.2; }
  .hero-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
  .hero-tag { font-size: 13px; color: #8a9db5; display: flex; align-items: center; gap: 5px; }
  .hero-salary { font-size: 15px; color: #C8A84B; font-weight: 700; }
  .apply-btn { display: inline-block; background: #C8A84B; color: #0B1D35; font-size: 14px; font-weight: 700; padding: 12px 28px; border-radius: 7px; }
  .apply-btn:hover { background: #d4b265; text-decoration: none; }
  .main { max-width: 800px; margin: 40px auto; padding: 0 20px 60px; }
  .card { background: #fff; border-radius: 10px; padding: 32px; margin-bottom: 24px; border: 1px solid #e8e8e8; }
  .card h2 { font-size: 16px; font-weight: 700; color: #0B1D35; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #C8A84B; padding-bottom: 8px; display: inline-block; }
  .card p { font-size: 14px; color: #333; margin-bottom: 12px; }
  .card ul { list-style: none; padding: 0; }
  .card ul li { font-size: 14px; color: #333; padding: 6px 0 6px 20px; position: relative; border-bottom: 1px solid #f5f5f5; }
  .card ul li::before { content: ''; position: absolute; left: 0; top: 14px; width: 8px; height: 2px; background: #C8A84B; }
  .cta-card { background: #0B1D35; border-radius: 10px; padding: 32px; text-align: center; }
  .cta-card h3 { color: #C8A84B; font-size: 18px; margin-bottom: 10px; }
  .cta-card p { color: #8a9db5; font-size: 14px; margin-bottom: 20px; }
  .breadcrumb { font-size: 12px; color: #8a9db5; margin-bottom: 24px; }
  .breadcrumb a { color: #8a9db5; }
  @media(max-width:600px){ .hero-title { font-size: 24px; } .hero { padding: 28px 20px; } .header { padding: 16px 20px; } }
</style>
</head>
<body>
<header class="header">
  <div>
    <div class="header-brand">Gulf Capital Intelligence</div>
    <div class="header-sub">DIFC, Dubai | Riyadh</div>
  </div>
  <nav class="header-nav">
    <a href="/">Platform</a>
    <a href="/careers">All Roles</a>
  </nav>
</header>

<section class="hero">
  <div class="hero-inner">
    <div class="hero-track">${job.track} Track</div>
    <h1 class="hero-title">${job.title}</h1>
    <div class="hero-meta">
      <span class="hero-tag">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8a9db5" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        ${job.location}
      </span>
      <span class="hero-tag">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8a9db5" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
        ${job.type}
      </span>
    </div>
    <div class="hero-salary">${job.salary}</div>
    <div style="margin-top:24px;">
      <a class="apply-btn" href="${job.applyUrl}">Apply for this Role</a>
    </div>
  </div>
</section>

<main class="main">
  <div class="breadcrumb">
    <a href="/">GCI Platform</a> &rsaquo; <a href="/careers">Careers</a> &rsaquo; ${job.title}
  </div>

  <div class="card">
    <h2>About the Role</h2>
    ${job.description.split('\n\n').map(p => `<p>${p.trim()}</p>`).join('\n')}
  </div>

  <div class="card">
    <h2>Requirements</h2>
    <ul>
      ${requirementsHtml}
    </ul>
  </div>

  <div class="card">
    <h2>About Gulf Capital Intelligence</h2>
    <p>Gulf Capital Intelligence operates a multi-agent AI conviction engine designed for the GCC private investment market. Our platform deploys six specialist intelligence agents covering macro and capital flow, sector dynamics, legal and regulatory risk, ESG compliance, financial health, and leadership integrity to produce structured conviction reports for family offices, sovereign wealth funds, and private banking clients.</p>
    <p>We are headquartered at Gate Village, DIFC Dubai with growing coverage of Saudi Arabia and the broader GCC. Our clients are institutional investors who make high-stakes private market allocation decisions and require intelligence infrastructure that goes beyond what traditional research desks can provide.</p>
    <p>All correspondence: <a href="mailto:difc@gulfcapitalintelligence.com">difc@gulfcapitalintelligence.com</a></p>
  </div>

  <div class="cta-card">
    <h3>Ready to Apply?</h3>
    <p>Applications are reviewed personally by senior GCI team members. Qualified candidates receive a sample conviction report via WhatsApp before the first interview call.</p>
    <a class="apply-btn" href="${job.applyUrl}">Submit Your Application</a>
  </div>
</main>

</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  return res.status(200).send(html);
}
