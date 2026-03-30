export default async function handler(req, res) {
  const { appId } = req.query;
  if (!appId || !/^\d+$/.test(appId)) {
    return res.status(400).json({ error: "Invalid appId" });
  }
  try {
    const upstream = await fetch(
      `https://www.protondb.com/api/v1/reports/summaries/${appId}.json`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!upstream.ok) return res.status(upstream.status).json({});
    const data = await upstream.json();
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    return res.status(200).json(data);
  } catch {
    return res.status(500).json({});
  }
}
