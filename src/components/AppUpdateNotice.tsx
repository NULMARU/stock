import { useEffect, useRef, useState } from "react";
import { prepareAppUpdate, updateURL } from "@/lib/appUpdates";
const CURRENT = import.meta.env.VITE_APP_BUILD_ID ?? "development";
export default function AppUpdateNotice() {
  const [available, setAvailable] = useState(false),
    [message, setMessage] = useState(""),
    [applying, setApplying] = useState(false);
  const registration = useRef<ServiceWorkerRegistration | null>(null),
    latest = useRef(CURRENT),
    requested = useRef(false);
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let alive = true,
      checking = false;
    const cleanups: (() => void)[] = [];
    const show = () => {
      if (alive) setAvailable(true);
    };
    const controllerChanged = () => {
      if (requested.current)
        location.replace(updateURL(location.href, latest.current));
    };
    navigator.serviceWorker?.addEventListener(
      "controllerchange",
      controllerChanged,
    );
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker
        .register("./sw.js", { scope: "./", updateViaCache: "none" })
        .then((reg) => {
          if (!alive) return;
          registration.current = reg;
          if (reg.waiting) show();
          const found = () => {
            const worker = reg.installing;
            if (!worker) return;
            const changed = () => {
              if (
                worker.state === "installed" &&
                navigator.serviceWorker.controller
              )
                show();
            };
            worker.addEventListener("statechange", changed);
            cleanups.push(() =>
              worker.removeEventListener("statechange", changed),
            );
          };
          reg.addEventListener("updatefound", found);
          cleanups.push(() => reg.removeEventListener("updatefound", found));
          found();
        })
        .catch(() => {
          /* Version endpoint still provides a manual update path. */
        });
    async function check() {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const versionURL = new URL("./version.json", location.href);
        versionURL.searchParams.set("check", String(Date.now()));
        const response = await fetch(versionURL, {
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        if (response.ok) {
          const data = await response.json();
          if (
            alive &&
            typeof data.version === "string" &&
            data.version !== CURRENT
          ) {
            latest.current = data.version;
            show();
          }
        }
        await registration.current?.update();
      } catch {
        /* Offline: preserve the current app and saved data. */
      } finally {
        checking = false;
      }
    }
    const visible = () => void check();
    void check();
    const timer = setInterval(visible, 60000);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", visible);
    return () => {
      alive = false;
      clearInterval(timer);
      cleanups.forEach((fn) => fn());
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", visible);
      navigator.serviceWorker?.removeEventListener(
        "controllerchange",
        controllerChanged,
      );
    };
  }, []);
  async function apply() {
    if (!navigator.onLine) {
      setMessage("인터넷 연결 후 새 버전을 적용해 주세요.");
      return;
    }
    setApplying(true);
    setMessage("저장 상태를 확인하고 있습니다.");
    try {
      if (!(await prepareAppUpdate())) {
        setMessage(
          "계산이 끝나거나 취소된 뒤 다시 눌러 주세요. 저장 오류가 있으면 먼저 해결하거나 JSON으로 보관하세요.",
        );
        setApplying(false);
        return;
      }
      requested.current = true;
      const waiting = registration.current?.waiting;
      if (waiting) {
        waiting.postMessage({ type: "ACTIVATE_UPDATE" });
        setTimeout(() => {
          if (requested.current)
            location.replace(updateURL(location.href, latest.current));
        }, 5000);
      } else location.replace(updateURL(location.href, latest.current));
    } catch {
      setMessage(
        "저장을 확인하지 못했습니다. 입력을 보관한 뒤 다시 시도하세요.",
      );
      setApplying(false);
    }
  }
  if (!available) return null;
  return (
    <aside
      aria-label="앱 업데이트"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 border-b border-teal-700 bg-teal-950 px-4 py-3 text-sm text-white"
    >
      <div>
        <strong>새 버전이 준비됐습니다.</strong>
        <p className="mt-1 text-xs text-teal-100">
          입력한 내용을 저장한 뒤 갱신하세요. 관심 종목과 저장된 실험은
          유지됩니다.
        </p>
        {message && (
          <p role="status" className="mt-1 text-xs">
            {message}
          </p>
        )}
      </div>
      <button
        className="shrink-0 rounded border border-teal-200 px-3 py-2 font-semibold disabled:opacity-50"
        disabled={applying}
        onClick={() => void apply()}
      >
        {applying ? "갱신 준비 중…" : "새 버전 적용"}
      </button>
    </aside>
  );
}
