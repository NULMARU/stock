import { useState } from "react";
import { Link, useNavigate } from "react-router";
export default function FinancialEntry() {
  const navigate = useNavigate();
  const [ticker, setTicker] = useState(""),
    [market, setMarket] = useState("US");
  const [watch] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem("financialWatchlist") ?? "[]");
      return Array.isArray(v)
        ? v.filter((x) => typeof x === "string").slice(0, 50)
        : [];
    } catch {
      return [];
    }
  });
  return (
    <section className="mx-auto max-w-6xl px-4 pt-5 sm:px-6">
      <div className="rounded-xl border bg-muted/30 p-4">
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <h2 className="font-semibold">관심 기업의 재무제표</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              12가지 질문으로 공시 읽기 · 실데이터 연결 준비 중
            </p>
          </div>
          <Link className="text-sm underline" to="/lab">
            AI 인프라 시뮬레이션 ↗
          </Link>
        </div>
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (ticker.trim())
              navigate(
                `/stock/${encodeURIComponent(ticker.trim().toUpperCase())}/financials?market=${market}`,
              );
          }}
        >
          <select
            aria-label="재무 조회 시장"
            className="rounded border bg-background p-2"
            value={market}
            onChange={(e) => setMarket(e.target.value)}
          >
            <option value="US">미국</option>
            <option value="KR">한국</option>
            <option value="CN">중국·홍콩</option>
          </select>
          <input
            aria-label="재무 조회 종목 코드"
            className="min-w-0 flex-1 rounded border bg-background p-2"
            placeholder="NVDA 또는 005930.KS"
            value={ticker}
            maxLength={20}
            required
            onChange={(e) => setTicker(e.target.value)}
          />
          <button className="rounded border px-4 py-2">재무 보기</button>
        </form>
        {watch.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {watch.map((key) => {
              const [m, ...t] = key.split(":");
              return (
                <Link
                  className="rounded border bg-background px-3 py-1 text-sm"
                  key={key}
                  to={`/stock/${encodeURIComponent(t.join(":"))}/financials?market=${m}`}
                >
                  ★ {t.join(":")}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
