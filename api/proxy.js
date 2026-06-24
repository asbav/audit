export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,x-fs-domain,x-fs-key,x-fs-action");

  if (req.method === "OPTIONS") return res.status(200).end();

  const domain = req.headers["x-fs-domain"];
  const key    = req.headers["x-fs-key"];
  const action = req.headers["x-fs-action"] || "passthrough";
  const path   = req.query.path || "/api/v2/assets";

  if (!domain || !key) return res.status(400).json({ error: "Missing headers" });

  const auth    = "Basic " + Buffer.from(key + ":X").toString("base64");
  const headers = { "Authorization": auth, "Content-Type": "application/json" };

  // ── FETCH ALL ASSETS (parallel batching to beat Vercel 10s timeout) ──
  if (action === "fetch-all-assets") {
    try {
      const perPage = 100;

      // Step 1: fetch page 1 to get total count
      const firstRes  = await fetch(`https://${domain}/api/v2/assets?per_page=${perPage}&page=1`, { headers });
      if (!firstRes.ok) {
        const txt = await firstRes.text();
        return res.status(firstRes.status).json({ error: "Freshservice error " + firstRes.status, detail: txt.slice(0, 400) });
      }
      const firstData = await firstRes.json();
      const firstPage = firstData.assets || firstData.config_items || firstData.items || [];
      const total     = firstData.total || firstData.meta?.total_count || null;

      // Work out how many pages we need
      let totalPages;
      if (total) {
        totalPages = Math.ceil(total / perPage);
      } else {
        // No total count — estimate from first page
        totalPages = firstPage.length < perPage ? 1 : 50;
      }
      totalPages = Math.min(totalPages, 50); // hard cap 5000 assets

      // Step 2: fetch remaining pages in parallel (batches of 5 to avoid rate limits)
      let allAssets = [...firstPage];
      const remainingPages = [];
      for (let p = 2; p <= totalPages; p++) remainingPages.push(p);

      const BATCH = 5;
      for (let i = 0; i < remainingPages.length; i += BATCH) {
        const batch = remainingPages.slice(i, i + BATCH);
        const results = await Promise.all(batch.map(async (page) => {
          const r = await fetch(`https://${domain}/api/v2/assets?per_page=${perPage}&page=${page}`, { headers });
          if (!r.ok) return [];
          const d = await r.json();
          return d.assets || d.config_items || d.items || [];
        }));
        results.forEach(pageAssets => {
          allAssets = allAssets.concat(pageAssets);
        });
        // Stop if any batch returned empty (we've hit the end)
        if (results.some(r => r.length < perPage)) break;
      }

      // Debug: sample the location fields from first asset so frontend can map correctly
      const sample = allAssets[0] || {};
      const locationDebug = {
        location:        sample.location,
        location_id:     sample.location_id,
        location_name:   sample.location_name,
        type_fields:     sample.type_fields ? Object.keys(sample.type_fields) : [],
        top_level_keys:  Object.keys(sample).filter(k => k.toLowerCase().includes("loc")),
      };

      return res.status(200).json({ assets: allAssets, total: allAssets.length, locationDebug });

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PASSTHROUGH for PUT/POST (asset update, ticket create) ──
  try {
    const url = `https://${domain}${path}`;
    const response = await fetch(url, {
      method: req.method,
      headers,
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
