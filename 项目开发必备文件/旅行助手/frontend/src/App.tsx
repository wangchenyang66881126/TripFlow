import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./lib/api";
import { PRESET_DEMO, PRESET_TEXT } from "./lib/preset";
import { fallbackIfAppStaysClosed, isMobileDevice } from "./lib/navigation";
import type { AppNavResponse, HotelsResponse, InputMode, NavLeg, NavLink, Place, PlacePhoto, RouteResponse } from "./lib/types";
import JourneyWorkspace from "./components/JourneyWorkspace";
import RouteView from "./components/RouteView";
import ScanModal from "./components/ScanModal";

const DEMO_LINK = "https://xhslink.cn/o/10vTPLjLXy7";


type Phase = "idle" | "loading" | "confirm" | "routing" | "route";

export default function App() {
  const [link, setLink] = useState(PRESET_DEMO ? PRESET_TEXT : "");
  const [presetTrip, setPresetTrip] = useState(false);
  const [mode, setMode] = useState<InputMode>("guide");
  const [summary, setSummary] = useState("");
  const submittingRef = useRef(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [tripId, setTripId] = useState("");
  const [city, setCity] = useState("");
  const [title, setTitle] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [nav, setNav] = useState<AppNavResponse | null>(null);
  const [hotels, setHotels] = useState<HotelsResponse | null>(null);
  const [hotelsError, setHotelsError] = useState("");
  const [photos, setPhotos] = useState<Record<string, PlacePhoto>>({});
  const [scanLeg, setScanLeg] = useState<NavLeg | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const timerRef = useRef<number | null>(null);
  const exportTimerRef = useRef<number | null>(null);
  const cancelNavFallback = useRef<(() => void) | null>(null);

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
      cancelNavFallback.current?.();
    },
    [stopTimer, stopExportTimer],
  );

  // 实景图只是锦上添花：失败时不提示，卡片照常显示
  const loadPhotos = useCallback((trip: string) => {
    api
      .getPhotos(trip)
      .then((r) => setPhotos(r.photos))
      .catch(() => {});
  }, []);

  const loadHotels = useCallback((trip: string) => {
    setHotels(null);
    setHotelsError("");
    api
      .getHotels(trip)
      .then(setHotels)
      .catch((e) => setHotelsError(e instanceof Error ? e.message : "推荐住宿加载失败"));
  }, []);

  const pollTask = useCallback(
    (taskId: string, onDone: () => void | Promise<void>, failPhase: Phase) => {
      stopTimer();
      let polling = false;
      timerRef.current = window.setInterval(async () => {
        if (polling) return;
        polling = true;
        try {
          const t = await api.getTask(taskId);
          setProgress(t.progress ?? "");
          if (t.status === "done") {
            stopTimer();
            await onDone();
          } else if (t.status === "failed") {
            stopTimer();
            setError(t.error ?? "生成失败");
            setPhase(failPhase);
          }
        } catch (e) {
          stopTimer();
          setError(e instanceof Error ? e.message : "请求失败");
          setPhase(failPhase);
        } finally {
          polling = false;
        }
      }, 1200);
    },
    [stopTimer],
  );

  // 刷新恢复服务端任务，不重复提交生成请求。
  useEffect(() => {
    const trip = new URLSearchParams(window.location.search).get("trip")
      || window.location.pathname.match(/^\/share\/([A-Za-z0-9]+)/)?.[1];
    if (!trip) return;
    let cancelled = false;
    const restore = async () => {
      const data = await api.getPlaces(trip);
      if (cancelled) return;
      setTripId(trip);
      setCity(data.city ?? "");
      setTitle(data.title ?? "");
      setSummary(data.summary ?? "");
      setPresetTrip(!!data.preset);
      setMode(data.input_mode ?? "guide");
      setLink(PRESET_DEMO ? PRESET_TEXT : (data.input_text ?? ""));
      setPlaces(data.places);
      if (data.task_id && (data.task_status === "pending" || data.task_status === "running")) {
        setPhase(data.status === "routing" ? "routing" : "loading");
        pollTask(data.task_id, restore, "idle");
        return;
      }
      if (data.task_status === "failed" && data.status !== "done") {
        setError(data.task_error || "上次生成未完成，可以修改输入后重新提交。");
        setPhase("idle");
        return;
      }
      setPhase("confirm");
      loadPhotos(trip);
      if (data.status === "done") {
        const result = await api.getRoute(trip);
        if (cancelled) return;
        setRoute(result);
        setPhase("route");
        loadHotels(trip);
        api.getAppNav(trip).then(setNav).catch(() => {});
      }
    };
    restore().catch((e) => {
      if (!cancelled) {
        setError(e instanceof Error ? e.message : "行程读取失败，请刷新重试。");
        setPhase("idle");
      }
    });
    return () => { cancelled = true; stopTimer(); };
  }, [loadHotels, loadPhotos, pollTask, stopTimer]);

  const handleGenerate = async (src?: string) => {
    const value = (src ?? link).trim();
    if (!value || submittingRef.current || phase === "loading" || phase === "routing") return;
    submittingRef.current = true;
    setError("");
    setProgress("提交中…");
    setPhase("loading");
    setPlaces([]);
    setTitle("");
    setCity("");
    setSummary("");
    setHotels(null);
    setPhotos({});
    setRoute(null);
    setNav(null);
    try {
      if (PRESET_DEMO) {
        setProgress("正在打开预设行程…");
        const { trip_id } = await api.openPreset();
        const [data, result] = await Promise.all([api.getPlaces(trip_id), api.getRoute(trip_id)]);
        setTripId(trip_id);
        setPresetTrip(true);
        setCity(data.city ?? "");
        setTitle(data.title ?? "");
        setSummary(data.summary ?? "");
        setPlaces(data.places);
        setRoute(result);
        setPhase("route");
        window.history.replaceState(null, "", `?trip=${trip_id}`);
        loadHotels(trip_id);
        loadPhotos(trip_id);
        api.getAppNav(trip_id).then(setNav).catch(() => {});
        return;
      }
      setPresetTrip(false);
      const { trip_id, task_id } = await api.createTrip(value, mode);
      setTripId(trip_id);
      window.history.replaceState(null, "", `?trip=${trip_id}`);
      pollTask(
        task_id,
        async () => {
          const data = await api.getPlaces(trip_id);
          setCity(data.city ?? "");
          setTitle(data.title ?? "");
          setSummary(data.summary ?? "");
          setPlaces(data.places);
          setPhase("confirm");
          loadPhotos(trip_id);
        },
        "idle",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败");
      setPhase("idle");
    } finally {
      submittingRef.current = false;
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
          setNav(null);
          loadHotels(tripId);
          api
            .getAppNav(tripId)
            .then(setNav)
            .catch(() => {});
        },
        "confirm",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败");
      setPhase("confirm");
    }
  };

  const openInApp = (uri: string, webUri: string) => {
    cancelNavFallback.current?.();
    cancelNavFallback.current = fallbackIfAppStaysClosed(() => {
      window.location.assign(webUri);
    });
    window.location.href = uri;
  };

  // 驾车（含途经点）：电脑上没有 App，弹二维码 + 网页版
  const handleAppNav = (leg: NavLeg) => {
    if (!isMobileDevice()) {
      setScanLeg(leg);
      return;
    }
    openInApp(leg.uri, leg.web_uri);
  };

  // 电脑使用原生 HTTPS 链接；手机尝试 App，未唤起则打开同一段网页路线。
  const handleSegmentNav = (link: NavLink) => {
    openInApp(link.uri, link.web_uri);
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
      loadPhotos(tripId); // 改名 / 换 POI 后重新匹配图片（未变的地点走缓存）
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新失败");
    }
  };

  return (
    <>
      <JourneyWorkspace
        demoMode={PRESET_DEMO} presetTrip={presetTrip}
        phase={phase} link={link} onLinkChange={setLink} tripId={tripId}
        mode={mode} onModeChange={setMode} summary={summary}
        title={title} city={city} places={places} photos={photos} progress={progress} error={error}
        onGenerate={() => handleGenerate()}
        onDemo={() => { setLink(PRESET_DEMO ? PRESET_TEXT : (mode === "idea" ? "重庆玩 2 天，想吃美食、看夜景，节奏轻松一点" : DEMO_LINK)); document.getElementById("source-link")?.focus(); }}
        onUpdate={updatePlace} onConfirm={handleGenerateRoute} onShare={handleShare}
      >
        {phase === "route" && route && (
          <section className="result-section">
            <div className="result-heading"><h2>动线结果</h2>
              {presetTrip ? <span className="preset-label">预设演示 · 固定行程</span> : <button onClick={() => setPhase("confirm")} className="quiet-button">调整地点</button>}
            </div>
            <RouteView preset={presetTrip} route={route} nav={nav} onAppNav={handleAppNav}
              onSegmentNav={handleSegmentNav} hotels={hotels} hotelsError={hotelsError} onShare={handleShare} onExport={handleExport}
              exporting={exporting} exportProgress={exportProgress} />
          </section>
        )}
      </JourneyWorkspace>
      {scanLeg && (
        <ScanModal
          url={`${window.location.origin}/share/${tripId}`}
          leg={scanLeg}
          onClose={() => setScanLeg(null)}
        />
      )}
    </>
  );
}
