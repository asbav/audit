const HARDWARE_TYPE_ID = 27002724114;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-fs-domain,x-fs-key,x-fs-action");
  if (req.method === "OPTIONS") return res.status(200).end();

  const domain = req.headers["x-fs-domain"];
  const key    = req.headers["x-fs-key"];
  const action = req.headers["x-fs-action"] || "passthrough";
  const path   = req.query.path || "";

  if (!domain || !key) return res.status(400).json({ error: "Missing headers" });

  const auth    = "Basic " + Buffer.from(key + ":X").toString("base64");
  const headers = { "Authorization": auth, "Content-Type": "application/json" };

  // ── FETCH ALL HARDWARE ASSETS + LOCATIONS in parallel ──
  if (action === "fetch-all-assets") {
    try {
      // Step 1: get all locations (paginated, build id→name map)
      const locationMap = {};
      let locPage = 1;
      while (true) {
        const r = await fetch(`https://${domain}/api/v2/locations?per_page=100&page=${locPage}`, { headers });
        if (!r.ok) break;
        const d = await r.json();
        const locs = d.locations || [];
        locs.forEach(l => { locationMap[l.id] = l.name; });
        if (locs.length < 100) break;
        locPage++;
      }

      // Step 2: fetch page 1 of hardware assets to get total
      const firstUrl = `https://${domain}/api/v2/assets?asset_type_id=${HARDWARE_TYPE_ID}&per_page=100&page=1`;
      const firstRes = await fetch(firstUrl, { headers });
      if (!firstRes.ok) {
        const txt = await firstRes.text();
        return res.status(firstRes.status).json({ error: "Freshservice error " + firstRes.status, detail: txt.slice(0, 400) });
      }
      const firstData = await firstRes.json();
      const firstPage = firstData.assets || [];
      const total     = firstData.total || firstData.meta?.total_count || null;

      // Work out pages needed
      const perPage    = 100;
      let totalPages   = total ? Math.ceil(total / perPage) : (firstPage.length < perPage ? 1 : 30);
      totalPages       = Math.min(totalPages, 30); // 3000 asset cap

      // Step 3: fetch remaining pages in parallel batches of 5
      let allAssets = [...firstPage];
      const remaining = [];
      for (let p = 2; p <= totalPages; p++) remaining.push(p);

      for (let i = 0; i < remaining.length; i += 5) {
        const batch = remaining.slice(i, i + 5);
        const results = await Promise.all(batch.map(async page => {
          const r = await fetch(
            `https://${domain}/api/v2/assets?asset_type_id=${HARDWARE_TYPE_ID}&per_page=${perPage}&page=${page}`,
            { headers }
          );
          if (!r.ok) return [];
          const d = await r.json();
          return d.assets || [];
        }));
        results.forEach(pageAssets => { allAssets = allAssets.concat(pageAssets); });
        if (results.some(r => r.length < perPage)) break;
      }

      // Step 4: resolve location_id → name on each asset
      const resolved = allAssets.map(a => ({
        id:           a.id,
        name:         a.name || a.display_name || a.asset_tag || "Asset " + a.id,
        asset_tag:    a.asset_tag,
        location_id:  a.location_id,
        location_name: a.location_id ? (locationMap[a.location_id] || "Location #" + a.location_id) : "No location set",
      }));

      return res.status(200).json({
        assets:         resolved,
        total:          resolved.length,
        locations_loaded: Object.keys(locationMap).length,
      });

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PASSTHROUGH for PUT (asset update) and POST (ticket create) ──
  try {
    const url      = `https://${domain}${path}`;
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
