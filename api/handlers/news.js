// api/news.js
// GCI News — stores and retrieves daily intelligence articles from Redis
// GET  /api/news               — paginated article list
// GET  /api/news?slug=xxx      — single article by slug
// POST /api/news               — create new article (requires x-admin-secret header)
// POST /api/news?action=subscribe — add email subscriber

const { kvGet, kvSet } = require('../redis-client');
const ADMIN_SECRET = process.env.ADMIN_SECRET || process.env.ADMIN_API_KEY;
const NEWS_KEY   = 'gci:news:articles';
const SUBS_KEY   = 'gci:news:subscribers';

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return fallback; }
}

function slugify(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function estimateReadTime(body) {
  const words = (body || '').split(/\s+/).length;
  return Math.max(1, Math.round(words / 220)) + ' min read';
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { slug, page = '1', limit = '12', action } = req.query;

  // ── GET: list or single article ──────────────────────────────────────────
  if (req.method === 'GET') {
    const raw = await kvGet(NEWS_KEY);
    const articles = parseJson(raw, []);
    const published = Array.isArray(articles)
      ? articles.filter(a => a.published).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      : [];

    if (slug) {
      const article = published.find(a => a.slug === slug);
      if (!article) return res.status(404).json({ error: 'Article not found' });
      return res.status(200).json({ article });
    }

    const pageNum  = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const start    = (pageNum - 1) * limitNum;
    const paginated = published.slice(start, start + limitNum);
    const total = published.length;

    // Return list with excerpt and no full body (keeps response lean)
    const list = paginated.map(a => ({
      id:          a.id,
      title:       a.title,
      slug:        a.slug,
      excerpt:     a.excerpt || stripHtml(a.body || '').slice(0, 180) + '...',
      category:    a.category,
      publishedAt: a.publishedAt,
      readTime:    a.readTime,
      author:      a.author,
      tags:        a.tags || []
    }));

    return res.status(200).json({
      articles: list,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      limit: limitNum
    });
  }

  // ── POST: create article or subscribe ────────────────────────────────────
  if (req.method === 'POST') {

    // Email subscription
    if (action === 'subscribe') {
      const { email, name } = req.body || {};
      if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
      const raw = await kvGet(SUBS_KEY);
      const subs = parseJson(raw, []);
      const existing = Array.isArray(subs) ? subs : [];
      if (existing.find(s => s.email === email)) {
        return res.status(200).json({ ok: true, message: 'Already subscribed' });
      }
      existing.push({ email, name: name || '', subscribedAt: new Date().toISOString() });
      await kvSet(SUBS_KEY, JSON.stringify(existing));
      return res.status(200).json({ ok: true, message: 'Subscribed successfully' });
    }

    // Create article — requires admin secret
    const secret = req.headers['x-admin-secret'];
    if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorised' });
    }

    const {
      title, body, category, author, tags,
      excerpt, metaTitle, metaDescription
    } = req.body || {};

    if (!title || !body) return res.status(400).json({ error: 'title and body required' });

    const id       = `art_${Date.now()}`;
    const artSlug  = slugify(title);
    const readTime = estimateReadTime(body);
    const plainExcerpt = excerpt || stripHtml(body).slice(0, 200) + '...';
    const now = new Date().toISOString();

    const article = {
      id,
      title,
      slug:            artSlug,
      body,
      excerpt:         plainExcerpt,
      category:        category || 'Market Intelligence',
      author:          author   || 'GCI Intelligence Desk',
      tags:            Array.isArray(tags) ? tags : [],
      readTime,
      metaTitle:       metaTitle       || title,
      metaDescription: metaDescription || plainExcerpt.slice(0, 160),
      publishedAt:     now,
      createdAt:       now,
      published:       true
    };

    const raw2   = await kvGet(NEWS_KEY);
    const existing = parseJson(raw2, []);
    const articles = Array.isArray(existing) ? existing : [];
    articles.unshift(article);

    // Keep max 365 articles
    if (articles.length > 365) articles.splice(365);
    await kvSet(NEWS_KEY, JSON.stringify(articles));

    return res.status(201).json({ ok: true, article });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
