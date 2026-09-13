import { lazy, Suspense, useEffect } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router";
import FinancialEntry from "@/components/FinancialEntry";
import HomePage from "@/pages/HomePage";
import StockDetailPage from "@/pages/StockDetailPage";
import GlossaryPage from "@/pages/GlossaryPage";
import NewsPage from "@/pages/NewsPage";
import { Toaster } from "@/components/ui/sonner";
import TickerBar from "@/components/TickerBar";
import { cn } from "@/lib/utils";
import { trackLaunch, trackTabView } from "@/lib/analytics";

const Lab = lazy(() => import("@/apps/simulation-lab/Lab"));
const Financials = lazy(() => import("@/pages/FinancialsPage"));

const NAV_ITEMS = [
  { to: "/", label: "종목", end: true },
  { to: "/news", label: "뉴스", end: false },
  { to: "/glossary", label: "용어", end: false },
  { to: "/lab", label: "실험실", end: false },
] as const;

export default function App() {
  const location = useLocation();

  // 사용 패턴 수집: 앱 실행 1회 + 탭 이동마다 기록 (로컬 전용)
  useEffect(() => {
    trackLaunch();
  }, []);
  useEffect(() => {
    const path = location.pathname;
    const tab = path === "/" ? "home" : path.split("/")[1] || "home";
    trackTabView(tab);
  }, [location.pathname]);

  if (location.pathname.startsWith("/lab"))
    return (
      <Suspense fallback={<p className="p-8">실험실을 여는 중…</p>}>
        <Lab />
      </Suspense>
    );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
          {/* 앱 로고/이름 — 홈으로 이동 */}
          <Link to="/" className="flex items-center gap-2 focus:outline-none">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-sm text-primary-foreground">
              🚀
            </span>
            <span className="hidden text-base font-bold tracking-tight text-foreground sm:inline">
              Dsup 주식
            </span>
          </Link>

          {/* 네비게이션 */}
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-medium sm:px-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <TickerBar />

      <main>
        {location.pathname === "/" && <FinancialEntry />}
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route
            path="/stock/:ticker/financials"
            element={
              <Suspense fallback={<p className="p-8">재무정보를 여는 중…</p>}>
                <Financials />
              </Suspense>
            }
          />
          <Route path="/stock/:ticker" element={<StockDetailPage />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/glossary" element={<GlossaryPage />} />
        </Routes>
      </main>

      <Toaster />
    </div>
  );
}
