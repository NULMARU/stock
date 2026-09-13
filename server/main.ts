import "dotenv/config";
import { createServer } from "node:http";
import { Store } from "./store";
import { FinancialService } from "./service";
import { resolveSecurity } from "./providers";
const store = new Store();
await store.init();
const service = new FinancialService(store);
const origins = (
  process.env.ALLOWED_ORIGINS ||
  "http://localhost:5173,http://localhost:4173,https://nulmaru.github.io"
).split(",");
const buckets = new Map<string, { count: number; until: number }>();
let ticking = false;
const timer = setInterval(() => {
  if (ticking) return;
  ticking = true;
  service
    .tick()
    .catch((e) =>
      console.error("collector", e instanceof Error ? e.message : "error"),
    )
    .finally(() => {
      ticking = false;
    });
}, 2000);
const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !origins.includes(origin)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const send = (status: number, data: unknown) => {
    res.writeHead(status);
    res.end(JSON.stringify(data));
  };
  if (req.method === "OPTIONS") {
    send(204, null);
    return;
  }
  const now = Date.now();
  for (const [k, b] of buckets) if (b.until < now) buckets.delete(k);
  const ip = req.socket.remoteAddress || "unknown";
  const bucket = buckets.get(ip) ?? { count: 0, until: now + 60000 };
  bucket.count++;
  buckets.set(ip, bucket);
  if (bucket.count > 90 || buckets.size > 4096) {
    res.setHeader("Retry-After", "60");
    send(429, { error: "요청이 많습니다. 잠시 후 다시 시도하세요." });
    return;
  }
  if (!["GET", "POST"].includes(req.method ?? "")) {
    send(405, { error: "Method not allowed" });
    return;
  }
  try {
    const url = new URL(req.url || "/", "http://localhost");
    const parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
    if (url.pathname === "/health") {
      send(200, {
        ok: true,
        dartConfigured: !!process.env.DART_API_KEY,
        quoteConfigured: !!process.env.QUOTE_SERVICE_URL,
        storage: process.env.DATABASE_URL ? "postgres" : "local-file",
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/securities/resolve") {
      send(
        200,
        await service.register(
          await resolveSecurity(
            url.searchParams.get("exchange") || "US",
            url.searchParams.get("ticker") || "",
          ),
        ),
      );
      return;
    }
    if (parts[0] === "v1" && parts[1] === "issuers" && parts[2]) {
      const id = parts[2];
      if (!/^(sec:\d{10}|dart:\d{8})$/.test(id))
        throw new Error("Invalid issuer");
      if (
        (parts[3] === "financials" && req.method === "GET") ||
        (parts[3] === "refresh" && req.method === "POST")
      ) {
        const value = await service.financials(id, parts[3] === "refresh");
        send(value.snapshot ? 200 : 202, value);
        return;
      }
      if (parts[3] === "analysis" && req.method === "GET") {
        const a = await service.analysis(
          id,
          url.searchParams.get("financialVersion") || "",
        );
        send(a ? 200 : 404, a ?? { error: "해당 재무 버전 없음" });
        return;
      }
    }
    if (
      parts[0] === "v1" &&
      parts[1] === "jobs" &&
      parts[2] &&
      req.method === "GET"
    ) {
      const job = await service.job(parts[2]);
      send(job ? 200 : 404, job ?? { error: "Unknown job" });
      return;
    }
    if (
      parts[0] === "v1" &&
      parts[1] === "securities" &&
      parts[3] === "quote" &&
      req.method === "GET"
    ) {
      const security = await store.transaction((s) => s.securities[parts[2]!]);
      if (!security) {
        send(404, { error: "Unknown security" });
        return;
      }
      // Optional privately configured licensed quote gateway. Never claim refresh frequency equals market latency.
      if (!process.env.QUOTE_SERVICE_URL) {
        send(503, {
          status: "not-configured",
          price: null,
          reason: "시세 공급자 미설정",
        });
        return;
      }
      const upstream = new URL(process.env.QUOTE_SERVICE_URL);
      if (upstream.protocol !== "https:")
        throw new Error("Quote service requires HTTPS");
      upstream.searchParams.set("securityId", security.securityId);
      const result = await fetch(upstream, {
        headers: process.env.QUOTE_API_KEY
          ? { Authorization: `Bearer ${process.env.QUOTE_API_KEY}` }
          : {},
        signal: AbortSignal.timeout(10000),
      });
      if (!result.ok) throw new Error("Quote provider unavailable");
      const q = (await result.json()) as Record<string, unknown>;
      if (
        typeof q.price !== "number" ||
        !Number.isFinite(q.price) ||
        q.price < 0 ||
        typeof q.quoteAt !== "string" ||
        !Number.isFinite(Date.parse(q.quoteAt)) ||
        !["realtime", "delayed", "close"].includes(String(q.delayClass)) ||
        typeof q.source !== "string" ||
        typeof q.currency !== "string"
      )
        throw new Error("Invalid quote response");
      send(200, q);
      return;
    }
    send(404, { error: "Not found" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    send(message === "Unknown issuer" ? 404 : 400, { error: message });
  }
});
server.listen(Number(process.env.PORT || 8787), "0.0.0.0", () =>
  console.log("Financial API listening on", process.env.PORT || 8787),
);
async function stop() {
  clearInterval(timer);
  server.close();
  await store.close();
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
