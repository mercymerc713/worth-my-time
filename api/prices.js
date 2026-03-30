const ITAD_KEY = process.env.ITAD_KEY;

export default async function handler(req, res) {
  if (!ITAD_KEY) return res.status(200).json({ deals: [] });
  const { name } = req.query;
  if (!name) return res.status(400).json({ deals: [] });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    // Step 1: lookup game ID
    const lookupRes = await fetch(
      `https://api.isthereanydeal.com/games/lookup/v1?key=${ITAD_KEY}&title=${encodeURIComponent(name)}`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: controller.signal }
    );
    if (!lookupRes.ok) { clearTimeout(timeout); return res.status(200).json({ deals: [] }); }
    const lookupData = await lookupRes.json();
    const gameId = lookupData?.game?.id;
    if (!gameId) { clearTimeout(timeout); return res.status(200).json({ deals: [] }); }

    // Step 2: get prices
    const pricesRes = await fetch(
      `https://api.isthereanydeal.com/games/prices/v3?key=${ITAD_KEY}&country=US`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
        body: JSON.stringify([gameId]),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);
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
        const pa = a.price === "Free" ? 0 : parseFloat(a.price.replace("$", "")) || 999;
        const pb = b.price === "Free" ? 0 : parseFloat(b.price.replace("$", "")) || 999;
        return pa - pb;
      });

    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate");
    return res.status(200).json({ deals: formatted });
  } catch {
    clearTimeout(timeout);
    return res.status(200).json({ deals: [] });
  }
}
