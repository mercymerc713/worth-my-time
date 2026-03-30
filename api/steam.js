export default async function handler(req, res) {
  const { appId } = req.query;
  if (!appId || !/^\d+$/.test(appId)) return res.status(400).json({});
  try {
    const upstream = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=en`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!upstream.ok) return res.status(upstream.status).json({});
    const json = await upstream.json();
    const data = json?.[appId]?.data || {};
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    return res.status(200).json({
      is_free: data.is_free || false,
      price: data.price_overview?.final_formatted || null,
      discount: data.price_overview?.discount_percent || 0,
      initial_price: data.price_overview?.initial_formatted || null,
    });
  } catch {
    return res.status(500).json({});
  }
}
