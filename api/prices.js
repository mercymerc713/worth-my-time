const ITAD_KEY = process.env.ITAD_KEY;

export default async function handler(req, res) {
  if (!ITAD_KEY) return res.status(200).json({ deals: [] });
  const { name } = req.query;
  if (!name) return res.status(400).json({ deals: [] });

  try {
    // Step 1: find game ID by title
    const searchRes = await fetch(
      `https://api.isthereanydeal.com/games/search/v1?key=${ITAD_KEY}&title=${encodeURIComponent(name)}`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!searchRes.ok) return res.status(200).json({ deals: [] });
    const searchData = await searchRes.json();
    if (!searchData?.length) return res.status(200).json({ deals: [] });

    // Match closest title
    const query = name.toLowerCase();
    const match = searchData.find(g => g.title?.toLowerCase() === query) || searchData[0];

    // Step 2: get current prices
    const pricesRes = await fetch(
      `https://api.isthereanydeal.com/games/prices/v3?key=${ITAD_KEY}&country=US`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
        body: JSON.stringify([match.id]),
      }
    );
    if (!pricesRes.ok) return res.status(200).json({ deals: [] });
    const pricesData = await pricesRes.json();
    const deals = pricesData?.[0]?.deals || [];

    const formatted = deals
      .filter(d => d.price?.amount != null)
      .map(d => ({
        store: d.shop?.name || d.shop?.id || "Unknown",
        price: d.price.amount === 0 ? "Free" : `$${d.price.amount.toFixed(2)}`,
        cut: d.cut || 0,
        url: d.url || null,
      }))
      .sort((a, b) => {
        const pa = parseFloat(a.price.replace("$", "")) || 0;
        const pb = parseFloat(b.price.replace("$", "")) || 0;
        return pa - pb;
      });

    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate");
    return res.status(200).json({ deals: formatted });
  } catch {
    return res.status(200).json({ deals: [] });
  }
}
