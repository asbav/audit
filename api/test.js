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

  // 1. Find the Hardware asset type ID
  try {
    const r = await fetch(`https://${domain}/api/v2/asset_types?per_page=100`, { headers });
    const d = await r.json();
    const types = d.asset_types || [];
    const hw = types.find(t => t.name.toLowerCase() === "hardware");
    const hwRelated = types.filter(t =>
      t.name.toLowerCase().includes("hardware") ||
      (hw && t.parent_asset_type_id === hw.id)
    );
    results.hardware_type    = hw ? { id: hw.id, name: hw.name } : "NOT FOUND";
    results.hardware_children = hwRelated.map(t => ({ id: t.id, name: t.name, parent: t.parent_asset_type_id }));
  } catch(e) { results.asset_types = { error: e.message }; }

  // 2. Fetch 3 assets filtered to Hardware type
  try {
    const r2 = await fetch(`https://${domain}/api/v2/asset_types?per_page=100`, { headers });
    const d2  = await r2.json();
    const hw  = (d2.asset_types||[]).find(t => t.name.toLowerCase() === "hardware");
    if (hw) {
      const r = await fetch(`https://${domain}/api/v2/assets?asset_type_id=${hw.id}&per_page=3`, { headers });
      const d = await r.json();
      const assets = d.assets || [];
      results.hardware_assets_sample = assets.map(a => ({
        id:            a.id,
        name:          a.name,
        display_name:  a.display_name,
        asset_tag:     a.asset_tag,
        location_id:   a.location_id,
        department_id: a.department_id,
        type_fields:   a.type_fields,
      }));
      results.hardware_total = d.total || "unknown";
    } else {
      results.hardware_assets_sample = "Hardware type not found by name";
    }
  } catch(e) { results.hardware_sample = { error: e.message }; }

  // 3. Fetch locations list
  try {
    const r = await fetch(`https://${domain}/api/v2/locations?per_page=100`, { headers });
    const d = await r.json();
    results.locations = (d.locations||[]).map(l => ({ id: l.id, name: l.name, parent_id: l.parent_location_id }));
    results.locations_total = results.locations.length;
  } catch(e) { results.locations = { error: e.message }; }

  // 4. Try fetching 1 asset that actually HAS a location_id set
  try {
    const r = await fetch(`https://${domain}/api/v2/assets?per_page=100&page=1`, { headers });
    const d = await r.json();
    const withLoc = (d.assets||[]).find(a => a.location_id);
    results.first_asset_with_location = withLoc ? {
      id:          withLoc.id,
      name:        withLoc.name,
      location_id: withLoc.location_id,
      type_fields: withLoc.type_fields,
    } : "none in first 100 assets";
  } catch(e) { results.located_asset = { error: e.message }; }

  return res.status(200).json(results);
}
