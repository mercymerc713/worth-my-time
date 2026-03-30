export default async function handler(req, res) {
  const { name } = req.query;
  if (!name) return res.status(400).json({});

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const searchRes = await fetch(
      `https://api.opencritic.com/api/game/search?criteria=${encodeURIComponent(name)}`,
      { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }, signal: controller.signal }
    );
    if (!searchRes.ok) { clearTimeout(timeout); return res.status(200).json({}); }
    const results = await searchRes.json();
    if (!Array.isArray(results) || !results.length) { clearTimeout(timeout); return res.status(200).json({}); }

    const query = name.toLowerCase();
    const match = results.find(r => r.name?.toLowerCase() === query) || results[0];

    const gameRes = await fetch(
      `https://api.opencritic.com/api/game/${match.id}`,
      { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }, signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!gameRes.ok) return res.status(200).json({});
    const g = await gameRes.json();

    const score = g.topCriticScore != null && g.topCriticScore >= 0 ? Math.round(g.topCriticScore) : -1;
    if (score < 0) return res.status(200).json({});

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");
    return res.status(200).json({
      score,
      tier: g.tier || null,
      numReviews: g.numReviews || 0,
      percentRecommended: g.percentRecommended != null ? Math.round(g.percentRecommended) : null,
    });
  } catch {
    clearTimeout(timeout);
    return res.status(200).json({});
  }
}
