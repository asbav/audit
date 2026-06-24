export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,x-fs-domain,x-fs-key");

  if (req.method === "OPTIONS") return res.status(200).end();

  const domain = req.headers["x-fs-domain"];
  const key    = req.headers["x-fs-key"];
  const path   = req.query.path || "/api/v2/assets";

  if (!domain || !key) return res.status(400).json({ error: "Missing x-fs-domain or x-fs-key header" });

  const auth = "Basic " + Buffer.from(key + ":X").toString("base64");

  // For asset listing requests, paginate through ALL pages automatically
  if (req.method === "GET" && path.includes("/api/v2/assets")) {
    try {
      let allAssets = [];
      let page = 1;
      const perPage = 100;

      while (true) {
        const url = `https://${domain}/api/v2/assets?per_page=${perPage}&page=${page}`;
        const response = await fetch(url, {
          headers: { "Authorization": auth, "Content-Type": "application/json" },
        });

        if (!response.ok) {
          const text = await response.text();
          return res.status(response.status).json({ error: "Freshservice error", status: response.status, detail: text.slice(0, 500) });
        }

        const data = await response.json();

        // Freshservice can return assets under different keys
        const pageAssets =
          data.assets ||
          data.config_items ||
          data.items ||
          (Array.isArray(data) ? data : null) ||
          [];

        allAssets = allAssets.concat(pageAssets);

        // Stop if we got fewer than a full page (last page)
        if (pageAssets.length < perPage) break;

        // Safety cap — 5000 assets max (50 pages)
        if (page >= 50) break;

        page++;
      }

      return res.status(200).json({ assets: allAssets, total: allAssets.length });

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // All other requests (PUT asset, POST ticket, etc.) — pass through directly
  try {
    const url = `https://${domain}${path}`;
    const response = await fetch(url, {
      method: req.method,
      headers: { "Authorization": auth, "Content-Type": "application/json" },
      body: ["POST", "PUT"].includes(req.method) ? JSON.stringify(req.body) : undefined,
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
