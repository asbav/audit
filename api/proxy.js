export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,x-fs-domain,x-fs-key");

  if (req.method === "OPTIONS") return res.status(200).end();

  const domain = req.headers["x-fs-domain"];
  const key    = req.headers["x-fs-key"];
  const path   = req.query.path || "/api/v2/assets";

  if (!domain || !key) return res.status(400).json({ error: "Missing x-fs-domain or x-fs-key header" });

  const url = `https://${domain}${path}`;

  try {
    const response = await fetch(url, {
      method: req.method === "OPTIONS" ? "GET" : req.method,
      headers: {
        "Authorization": "Basic " + Buffer.from(key + ":X").toString("base64"),
        "Content-Type":  "application/json",
      },
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
