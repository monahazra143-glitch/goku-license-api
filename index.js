// GOKU license server (Vercel + Supabase).  URL:  /api?op=activate | check | admin
const SB = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY;
const ADMIN = process.env.ADMIN_PASSWORD;
const DAY = 86400000;

async function db(path, opt = {}) {
  const r = await fetch(SB + "/rest/v1/" + path, {
    ...opt,
    headers: { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json", ...(opt.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error("db " + r.status + " " + t);
  try { return JSON.parse(t); } catch { return null; }
}

// kitni rows (PostgREST ke Content-Range se, 1000 ki limit nahi lagti)
async function count(filter) {
  const r = await fetch(SB + "/rest/v1/licenses?select=key&limit=1" + filter, {
    headers: { apikey: SK, Authorization: "Bearer " + SK, Prefer: "count=exact" },
  });
  if (!r.ok) throw new Error("count " + r.status);
  return parseInt((r.headers.get("content-range") || "").split("/")[1], 10) || 0;
}

function norm(raw) {
  let n = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (n.startsWith("GOKU")) n = n.slice(4);
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/.test(n)) return null;
  return "GOKU-" + n.slice(0, 4) + "-" + n.slice(4, 8) + "-" + n.slice(8);
}

async function verify(b, bind) {
  const key = norm(b.key), dev = String(b.device || "");
  if (!key || dev.length < 16) return { ok: false, code: "bad", msg: "Invalid key" };
  const enc = encodeURIComponent(key);
  const q = "licenses?key=eq." + enc + "&select=*";
  let L = (await db(q))[0];
  if (!L) return { ok: false, code: "nokey", msg: "This license key is not valid" };
  if (L.status !== "active") return { ok: false, code: "blocked", msg: "This license has been blocked", reason: L.block_reason || "" };   // reason = Access blocked screen par dikhega
  const now = Date.now();
  if (!L.device_id) {
    if (!bind) return { ok: false, code: "unbound", msg: "License not activated" };
    const exp = L.expires_at || (L.days > 0 ? new Date(now + L.days * DAY).toISOString() : null);
    const upd = await db("licenses?key=eq." + enc + "&device_id=is.null&status=eq.active", {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ device_id: dev, activated_at: L.activated_at || new Date(now).toISOString(), expires_at: exp }),
    });
    L = (upd && upd[0]) || (await db(q))[0];
  }
  if (!L || L.device_id !== dev) return { ok: false, code: "device", msg: "This key is already used on another phone" };
  const expMs = L.expires_at ? Date.parse(L.expires_at) : 0;
  if (L.days > 0 && expMs <= now) return { ok: false, code: "expired", msg: "This license has expired" };
  return { ok: true, days: L.days, exp: expMs, now };
}

async function admin(b) {
  const a = b.action, key = b.key ? norm(b.key) : null;
  const enc = key ? encodeURIComponent(key) : "";
  if (a === "stats") {
    const [total, used, blocked, ultra, ultraUsed] = await Promise.all([
      count(""), count("&device_id=not.is.null"), count("&status=neq.active"),
      count("&type=like.Ultra*"), count("&type=like.Ultra*&device_id=not.is.null"),
    ]);
    return { ok: true, total, used, unused: total - used, blocked, ultra, ultraUsed };
  }
  if (a === "search") {
    const s = String(b.q || "").trim().replace(/[^A-Za-z0-9 \-_.@]/g, "");
    const f = String(b.filter || "");
    let p = "licenses?select=key,type,days,status,device_id,activated_at,expires_at,note,block_reason&limit=50";
    if (s) p += "&or=(key.ilike.*" + s + "*,device_id.ilike.*" + s + "*,note.ilike.*" + s + "*)";
    else if (f === "blocked") p += "&status=neq.active&order=activated_at.desc.nullslast";
    else if (f === "ultra") p += "&type=like.Ultra*&order=serial.asc";
    else if (f === "unused") p += "&device_id=is.null&order=serial.asc";
    else p += "&activated_at=not.is.null&order=activated_at.desc";
    return { ok: true, rows: await db(p) };
  }
  if (!key) return { ok: false, msg: "bad key" };
  const patch = async (o) => ({ ok: true, rows: await db("licenses?key=eq." + enc, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(o) }) });
  if (a === "block") return patch({ status: "blocked", block_reason: String(b.reason || "").trim().slice(0, 100) || null });
  if (a === "unblock") return patch({ status: "active", block_reason: null });
  if (a === "reset") return patch({ device_id: null });
  if (a === "note") return patch({ note: String(b.note || "").slice(0, 200) });
  return { ok: false, msg: "unknown action" };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, msg: "POST only" });
  try {
    const op = req.query.op, b = req.body || {};
    if (op === "activate") return res.json(await verify(b, true));
    if (op === "check") return res.json(await verify(b, false));
    if (op === "admin") {
      if (!ADMIN || req.headers["x-admin-password"] !== ADMIN) return res.status(401).json({ ok: false, msg: "wrong password" });
      return res.json(await admin(b));
    }
    return res.status(404).json({ ok: false });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, code: "server", msg: "Server error, try again" });
  }
};
