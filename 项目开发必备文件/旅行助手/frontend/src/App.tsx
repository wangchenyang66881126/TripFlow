import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Navigation, Share2, Sparkles } from "lucide-react";
import { api } from "./lib/api";
import type { Place, RouteResponse } from "./lib/types";
import PlaceCard from "./components/PlaceCard";
import RouteView from "./components/RouteView";

const DEMO_LINK = "https://xhslink.cn/o/10vTPLjLXy7";
const BRAND = "#4FA83C";

type Phase = "idle" | "loading" | "confirm" | "routing" | "route";

export default function App() {
  const [link, setLink] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [tripId, setTripId] = useState("");
  const [city, setCity] = useState("");
  const [title, setTitle] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [navUri, setNavUri] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const timerRef = useRef<number | null>(null);
  const exportTimerRef = useRef<number | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopExportTimer = useCallback(() => {
    if (exportTimerRef.current !== null) {
      window.clearInterval(exportTimerRef.current);
      exportTimerRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      stopTimer();
      stopExportTimer();
    },
    [stopTimer, stopExportTimer],
  );

  // 恢复入口：?trip=xxx 或 /share/xxx
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let trip = params.get("trip");
    if (!trip) {
      const m = window.location.pathname.match(/^\/share\/([A-Za-z0-9]+)/);
      if (m) trip = m[1];
    }
    if (!trip) return;
    (async () => {
      try {
        const data = await api.getPlaces(trip);
        setTripId(trip);
        setCity(data.city ?? "");
        setTitle(data.title ?? "");
        setPlaces(data.places);
        setPhase("confirm");
        try {
          const r = await api.getRoute(trip);
          setRoute(r);
          setPhase("route");
          try {
            const nav = await api.getAppNav(trip);
            if (nav.uris.length) setNavUri(nav.uris[0]);
          } catch {
            /* ignore */
          }
        } catch {
          /* 尚未生成动线 */
        }
      } catch {
        setError("行程不存在或已失效");
        setPhase("idle");
      }
    })();
  }, []);

  const pollTask = useCallback(
    (taskId: string, onDone: () => void, failPhase: Phase) => {
      stopTimer();
      timerRef.current = window.setInterval(async () => {
        try {
          const t = await api.getTask(taskId);
          setProgress(t.progress ?? "");
          if (t.status === "done") {
            stopTimer();
            onDone();
          } else if (t.status === "failed") {
            stopTimer();
            setError(t.error ?? "生成失败");
            setPhase(failPhase);
          }
        } catch (e) {
          stopTimer();
          setError(e instanceof Error ? e.message : "请求失败");
          setPhase(failPhase);
        }
      }, 1200);
    },
    [stopTimer],
  );

  const handleGenerate = async (src?: string) => {
    const value = (src ?? link).trim();
    if (!value) return;
    setError("");
    setProgress("提交中…");
    setPhase("loading");
    setPlaces([]);
    setRoute(null);
    try {
      const { trip_id, task_id } = await api.createTrip(value);
      setTripId(trip_id);
      window.history.replaceState(null, "", `?trip=${trip_id}`);
      pollTask(
        task_id,
        async () => {
          const data = await api.getPlaces(trip_id);
          setCity(data.city ?? "");
          setTitle(data.title ?? "");
          setPlaces(data.places);
          setPhase("confirm");
        },
        "idle",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败");
      setPhase("idle");
    }
  };

  const handleGenerateRoute = async () => {
    if (!tripId) return;
    setError("");
    setProgress("路线编排中…");
    setPhase("routing");
    try {
      const { task_id } = await api.createRoute(tripId);
      pollTask(
        task_id,
        async () => {
          const r = await api.getRoute(tripId);
          setRoute(r);
          setPhase("route");
          setNavUri("");
          api
            .getAppNav(tripId)
            .then((nav) => {
              if (nav.uris.length) setNavUri(nav.uris[0]);
            })
            .catch(() => {});
        },
        "confirm",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败");
      setPhase("confirm");
    }
  };

  const handleAppNav = async () => {
    if (!tripId) return;
    try {
      const { uris } = await api.getAppNav(tripId);
      if (!uris.length) {
        setError("无可用导航");
        return;
      }
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isMobile) {
        window.location.href = uris[0];
      } else {
        await handleShare();
        window.alert(
          "电脑上没有百度地图 App，跳转需在手机进行。\n分享链接已复制，请用手机浏览器打开即可跳转。",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败");
    }
  };

  const handleShare = async () => {
    if (!tripId) return;
    const url = `${window.location.origin}/share/${tripId}`;
    try {
      await navigator.clipboard.writeText(url);
      window.alert(`分享链接已复制：${url}`);
    } catch {
      window.prompt("复制分享链接：", url);
    }
  };

  const handleExport = async () => {
    if (!tripId) return;
    setExporting(true);
    setExportProgress("");
    try {
      const { task_id } = await api.createExport(tripId);
      stopExportTimer();
      exportTimerRef.current = window.setInterval(async () => {
        try {
          const t = await api.getTask(task_id);
          setExportProgress(t.progress ?? "");
          if (t.status === "done") {
            stopExportTimer();
            setExporting(false);
            window.open(`/api/v1/trips/${tripId}/export.png`);
          } else if (t.status === "failed") {
            stopExportTimer();
            setExporting(false);
            setExportProgress(`导出失败：${t.error ?? ""}`);
          }
        } catch (e) {
          stopExportTimer();
          setExporting(false);
          setExportProgress(e instanceof Error ? e.message : "导出失败");
        }
      }, 1500);
    } catch (e) {
      setExporting(false);
      setExportProgress(e instanceof Error ? e.message : "导出失败");
    }
  };

  const updatePlace = async (id: number, body: Record<string, unknown>) => {
    if (!tripId) return;
    try {
      await api.updatePlace(tripId, id, body);
      const data = await api.getPlaces(tripId);
      setPlaces(data.places);
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新失败");
    }
  };

  const days = new Map<number, Place[]>();
  for (const p of places) {
    const arr = days.get(p.day) ?? [];
    arr.push(p);
    days.set(p.day, arr);
  }
  for (const arr of days.values()) arr.sort((a, b) => a.seq - b.seq);
  const dayKeys = [...days.keys()].sort((a, b) => a - b);

  return (
    <div className="min-h-screen bg-[#F7F7F7]">
      <header className="sticky top-0 z-10 border-b border-[#EBEBEB] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full font-bold text-white"
              style={{ background: BRAND }}
            >
              T
            </span>
            <span className="text-lg font-bold tracking-tight">TripFlow</span>
          </div>
          <div className="text-sm text-[#717171]">旅行全流程助手</div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
        <section className="py-8 sm:py-12">
          <h1 className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
            把攻略变成
            <span style={{ color: BRAND }}> 一张可走的动线</span>
          </h1>
          <p className="mt-2 text-sm text-[#717171] sm:text-base">
            粘贴小红书攻略链接，自动识别景点、连成百度地图多途径点动线。
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <div className="flex flex-1 items-center rounded-2xl border border-[#DDDDDD] bg-white px-4 shadow-sm focus-within:border-[#4FA83C] focus-within:ring-2 focus-within:ring-[#4FA83C]/20">
              <MapPin size={18} className="shrink-0 text-[#717171]" />
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                placeholder="粘贴小红书攻略链接…"
                className="w-full bg-transparent px-3 py-3.5 text-[15px] outline-none placeholder:text-[#B0B0B0]"
              />
            </div>
            <button
              onClick={() => handleGenerate()}
              disabled={phase === "loading" || phase === "routing"}
              className="inline-flex items-center justify-center gap-2 rounded-2xl px-7 py-3.5 text-[15px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              style={{ background: BRAND }}
            >
              {phase === "loading" ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Sparkles size={18} />
              )}
              生成动线
            </button>
          </div>
          <button
            onClick={() => {
              setLink(DEMO_LINK);
              handleGenerate(DEMO_LINK);
            }}
            className="mt-3 text-sm font-medium underline-offset-4 hover:underline"
            style={{ color: BRAND }}
          >
            试试这篇重庆攻略 →
          </button>

          {phase === "loading" && (
            <div className="mt-6 flex items-center gap-2 text-sm text-[#717171]">
              <Loader2 size={16} className="animate-spin" style={{ color: BRAND }} />
              {progress || "处理中…"}
            </div>
          )}
          {phase === "routing" && (
            <div className="mt-6 flex items-center gap-2 text-sm text-[#717171]">
              <Loader2 size={16} className="animate-spin" style={{ color: BRAND }} />
              {progress || "路线编排中…"}
            </div>
          )}
          {error && (
            <div className="mt-6 rounded-xl bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]">
              {error}
            </div>
          )}
        </section>

        {/* 地点确认 */}
        {(phase === "confirm" || phase === "route") && places.length > 0 && (
          <section>
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl font-bold">{title || "行程地点"}</h2>
              <span className="text-sm text-[#717171]">
                {city && `${city} · `}
                共 {places.length} 个地点
              </span>
            </div>

            {dayKeys.map((day) => (
              <div key={day} className="mb-6">
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className="rounded-lg px-2.5 py-1 text-xs font-bold text-white"
                    style={{ background: BRAND }}
                  >
                    Day {day}
                  </span>
                  <span className="text-sm text-[#717171]">
                    {days.get(day)!.length} 个地点
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {days.get(day)!.map((p) => (
                    <PlaceCard key={p.id} place={p} onUpdate={updatePlace} />
                  ))}
                </div>
              </div>
            ))}

            {phase === "confirm" && (
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  onClick={handleGenerateRoute}
                  className="inline-flex items-center gap-2 rounded-2xl px-6 py-3 text-[15px] font-semibold text-white transition hover:opacity-90"
                  style={{ background: BRAND }}
                >
                  <Navigation size={18} />
                  确认并生成动线
                </button>
                <button
                  onClick={handleShare}
                  className="inline-flex items-center gap-2 rounded-2xl border border-[#DDDDDD] bg-white px-6 py-3 text-[15px] font-medium text-[#222] transition hover:border-[#B0B0B0]"
                >
                  <Share2 size={18} />
                  分享
                </button>
              </div>
            )}
          </section>
        )}

        {/* 动线结果 */}
        {phase === "route" && route && (
          <section className="mt-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold">动线结果</h2>
              <button
                onClick={() => setPhase("confirm")}
                className="text-sm font-medium underline-offset-4 hover:underline"
                style={{ color: BRAND }}
              >
                调整地点
              </button>
            </div>
            <RouteView
              route={route}
              navUri={navUri}
              onAppNav={handleAppNav}
              onShare={handleShare}
              onExport={handleExport}
              exporting={exporting}
              exportProgress={exportProgress}
            />
          </section>
        )}
      </main>
    </div>
  );
}
