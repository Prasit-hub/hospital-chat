#!/usr/bin/env node
// HIS Gateway จำลอง — ทำตามสัญญา API ในเอกสารออกแบบ ใช้ทดสอบโหมด "เชื่อม HIS Gateway" ก่อนมี Gateway จริง
// และเป็นตัวอย่างให้ฝ่าย IT / ผู้พัฒนา HIS ดูว่า Gateway ต้องตอบอะไร
//
// รัน:   node scripts/mock-his-gateway.mjs            (พอร์ต 4700)
// ตั้งค่าในรวมแชท: ที่อยู่ http://localhost:4700 · OAuth2 · token http://localhost:4700/oauth/token
//                  client id = chat-app · secret = mock-secret   (เปลี่ยนได้ด้วย MOCK_HIS_CLIENT_ID / MOCK_HIS_SECRET)
// ข้อมูลคนไข้สมมติอยู่ที่ src/lib/his/mock-data.json

import http from "node:http";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { appointmentsOf, encountersOf, matchPatients } from "../src/lib/his/mock-engine.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(root, "src/lib/his/mock-data.json"), "utf8"));
const PORT = Number(process.env.PORT || process.env.MOCK_HIS_PORT || 4700);
const CLIENT_ID = process.env.MOCK_HIS_CLIENT_ID || "chat-app";
const SECRET = process.env.MOCK_HIS_SECRET || "mock-secret";

const tokens = new Map(); // token → หมดอายุ
const log = []; // ใครเรียกอะไร (เก็บ 200 รายการล่าสุด) — ดูได้ที่ GET /__log
let fault = null; // จำลองปัญหา: "500" | "timeout" | "garbage" — ตั้งด้วย POST /__fault {"fault": "..."}

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => resolve(s));
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const raw = req.method === "POST" ? await readBody(req) : "";

  // ---- ตัวช่วยทดสอบ (ไม่มีใน Gateway จริง) ----
  if (path === "/__log") return send(res, 200, log);
  if (path === "/__reset") return (log.length = 0), (fault = null), tokens.clear(), send(res, 200, { ok: true });
  if (path === "/__fault") return (fault = JSON.parse(raw || "{}").fault ?? null), send(res, 200, { fault });

  // ---- OAuth2 client credentials ----
  if (path === "/oauth/token" && req.method === "POST") {
    const f = new URLSearchParams(raw);
    if (f.get("grant_type") !== "client_credentials" || f.get("client_id") !== CLIENT_ID || f.get("client_secret") !== SECRET)
      return send(res, 401, { error: "invalid_client" });
    const token = randomBytes(24).toString("hex");
    tokens.set(token, Date.now() + 3600_000);
    return send(res, 200, { access_token: token, token_type: "Bearer", expires_in: 3600 });
  }

  // ---- ทุก API ต้องมี token ----
  const auth = req.headers.authorization ?? "";
  const tok = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!(tokens.get(tok) > Date.now())) return send(res, 401, { error: "unauthorized" });

  log.push({ at: new Date().toISOString(), method: req.method, path, actingUser: req.headers["x-acting-user"] ?? null, purpose: req.headers["x-purpose"] ?? null });
  if (log.length > 200) log.shift();

  if (fault === "timeout") return; // ไม่ตอบเลย
  if (fault === "500") return send(res, 500, { error: "internal" });
  if (fault === "garbage") return send(res, 200, { unexpected: true, diagnosis: "ไม่ควรส่งมา" });

  if (path === "/his/v1/health") return send(res, 200, { status: "ok", source: "mock-his-gateway" });

  if (path === "/his/v1/patients/match" && req.method === "POST") {
    let q;
    try {
      q = JSON.parse(raw || "{}");
    } catch {
      return send(res, 400, { error: "invalid json" });
    }
    const r = matchPatients(data, q);
    return "error" in r ? send(res, 400, { error: r.error }) : send(res, 200, r);
  }

  const m = path.match(/^\/his\/v1\/patients\/([^/]+)\/(appointments|encounters)$/);
  if (m && req.method === "GET") {
    const hn = decodeURIComponent(m[1]);
    if (m[2] === "appointments") {
      const list = appointmentsOf(data, hn, url.searchParams.get("from"), url.searchParams.get("to"));
      return list ? send(res, 200, { appointments: list }) : send(res, 404, { error: "not found" });
    }
    const list = encountersOf(data, hn, Number(url.searchParams.get("limit") || 3));
    return list ? send(res, 200, { encounters: list }) : send(res, 404, { error: "not found" });
  }

  send(res, 404, { error: "not found" });
});

server.listen(PORT, () => console.log(`mock HIS gateway on http://localhost:${PORT} (client_id=${CLIENT_ID})`));
