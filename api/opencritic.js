export default async function handler(req, res) {
  const { name } = req.query;
  if (!name) return res.status(400).json({});
  try {
    const searchRes = await fetch(
      `https://api.opencritic.com/api/game/search?criteria=${encodeURIComponent(name)}`,
      { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } }
    );
    if (!searchRes.ok) return res.status(searchRes.status).json({});
    const results = await searchRes.json();
    if (!Array.isArray(results) || !results.length) return res.status(200).json({});

    // Match exact name first, fall back to first result
    const query = name.toLowerCase();
    const match = results.find(r => r.name?.toLowerCase() === query) || results[0];

    // Search results include topCriticScore and percentRecommended — no second call needed
    const score = match.topCriticScore != null ? Math.round(match.topCriticScore) : -1;
    const tier = match.tier || null;
    const percentRecommended = match.percentRecommended != null ? Math.round(match.percentRecommended) : null;
    const numReviews = match.numReviews || 0;

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");
    return res.status(200).json({ score, tier, numReviews, percentRecommended });
  } catch {
    return res.status(500).json({});
  }
}
