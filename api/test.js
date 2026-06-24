export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-fs-domain,x-fs-key");

  if (req.method === "OPTIONS") return res.status(200).end();

  const domain = req.headers["x-fs-domain"];
  const key    = req.headers["x-fs-key"];

  if (!domain || !key) return res.status(400).json({ error: "Missing headers" });

  const auth    = "Basic " + Buffer.from(key + ":X").toString("base64");
  const headers = { "Authorization": auth, "Content-Type": "application/json" };

  const results = {};

  // Test 1: Can we reach Freshservice at all?
  try {
    const r = await fetch(`https://${domain}/api/v2/agents/me`, { headers });
    const d = await r.json();
    results.auth = { status: r.status, name: d.agent?.first_name || d.first_name || "unknown", role: d.agent?.role_ids || d.role_ids };
  } catch(e) { results.auth = { error: e.message }; }

  // Test 2: Assets endpoint - just 1 asset
  try {
    const r = await fetch(`https://${domain}/api/v2/assets?per_page=1&page=1`, { headers });
    const d = await r.json();
    const first = (d.assets||d.config_items||d.items||[])[0] || null;
    results.assets_v2 = {
      status: r.status,
      total: d.total || d.meta?.total_count || "unknown",
      first_asset_keys: first ? Object.keys(first) : [],
      location_fields: first ? {
        location:      first.location,
        location_name: first.location_name,
        location_id:   first.location_id,
        type_fields:   first.type_fields || {},
      } : null,
    };
  } catch(e) { results.assets_v2 = { error: e.message }; }

  // Test 3: Try asset types endpoint
  try {
    const r = await fetch(`https://${domain}/api/v2/asset_types`, { headers });
    const d = await r.json();
    results.asset_types = { status: r.status, types: (d.asset_types||[]).map(t=>t.name) };
  } catch(e) { results.asset_types = { error: e.message }; }

  return res.status(200).json(results);
}
