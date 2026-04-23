// api/sitemap.js — XML sitemap including all job pages for Google indexing

const JOB_SLUGS = [
  'senior-research-analyst-difc',
  'investment-research-analyst-dubai',
  'investment-research-analyst-riyadh',
  'gcc-investment-intelligence-associate',
  'due-diligence-analyst-dubai',
  'due-diligence-analyst-riyadh',
  'private-credit-analyst',
  'real-estate-intelligence-analyst',
  'healthcare-consumer-intelligence-analyst',
  'technology-venture-intelligence-analyst',
  'client-development-associate',
  'senior-client-director'
];

const STATIC_PAGES = [
  { loc: 'https://gulfcapitalintelligence.com/', priority: '1.0', changefreq: 'weekly' },
  { loc: 'https://gulfcapitalintelligence.com/careers', priority: '0.9', changefreq: 'weekly' },
  { loc: 'https://gulfcapitalintelligence.com/news', priority: '0.7', changefreq: 'daily' },
  { loc: 'https://gulfcapitalintelligence.com/app', priority: '0.8', changefreq: 'monthly' },
  { loc: 'https://gulfcapitalintelligence.com/vision2030', priority: '0.9', changefreq: 'weekly' },
];

module.exports = async function handler(req, res) {
  const today = new Date().toISOString().split('T')[0];

  const jobUrls = JOB_SLUGS.map(slug => `
  <url>
    <loc>https://gulfcapitalintelligence.com/careers/${slug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`).join('');

  const staticUrls = STATIC_PAGES.map(p => `
  <url>
    <loc>${p.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
        http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
${staticUrls}
${jobUrls}
</urlset>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
  return res.status(200).send(xml);
}
