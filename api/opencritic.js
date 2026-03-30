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

    // Match the closest name to avoid wrong results
    const query = name.toLowerCase();
    const match = results.find(r => r.name?.toLowerCase() === query) || results[0];

    const gameRes = await fetch(
      `https://api.opencritic.com/api/game/${match.id}`,
      { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } }
    );
    if (!gameRes.ok) return res.status(gameRes.status).json({});
    const g = await gameRes.json();

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");
    return res.status(200).json({
      score: Math.round(g.topCriticScore ?? -1),
      tier: g.tier || null,
      numReviews: g.numReviews || 0,
      percentRecommended: g.percentRecommended != null ? Math.round(g.percentRecommended) : null,
    });
  } catch {
    return res.status(500).json({});
  }
}
