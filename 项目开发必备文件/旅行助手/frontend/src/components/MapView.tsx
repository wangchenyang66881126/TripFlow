import { useEffect, useRef, useState } from "react";
import { loadBaiduMap, type BaiduMap, type MapApi } from "../lib/baidu-map";

interface Pt { name: string; lat: number | null; lng: number | null }
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

// 静态地图兜底：用 Web 墨卡托把经纬度投影到 640x400 像素坐标，
// 与后端静态图（center=质心、zoom=13、尺寸 640x400）保持一致，画出编号点与连线。
const STATIC_W = 640;
const STATIC_H = 400;
const STATIC_ZOOM = 13;

function projectStatic(points: Pt[]) {
  const valid = points.filter((p): p is Pt & { lat: number; lng: number } => p.lat != null && p.lng != null);
  if (!valid.length) return { pts: [] as { x: number; y: number }[], polyline: "" };
  const worldSize = 256 * Math.pow(2, STATIC_ZOOM);
  const toWorld = (lng: number, lat: number) => {
    const x = ((lng + 180) / 360) * worldSize;
    const sinLat = Math.sin((lat * Math.PI) / 180);
    const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize;
    return { x, y };
  };
  const center = toWorld(
    valid.reduce((s, p) => s + p.lng, 0) / valid.length,
    valid.reduce((s, p) => s + p.lat, 0) / valid.length,
  );
  const pts = valid.map((p) => {
    const w = toWorld(p.lng, p.lat);
    return { x: STATIC_W / 2 + (w.x - center.x), y: STATIC_H / 2 + (w.y - center.y) };
  });
  return { pts, polyline: pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") };
}

interface Props { points: Pt[]; mapUrl: string; focusPoint?: Pt; }
export default function MapView({ points, mapUrl, focusPoint }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [connection, setConnection] = useState<{ api: MapApi; map: BaiduMap } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const pointKey = JSON.stringify(points.filter(p => p.lat != null && p.lng != null));

  useEffect(() => {
    let cancelled = false;
    let instance: BaiduMap | undefined;
    setConnection(null);
    setError("");
    loadBaiduMap().then(api => {
      if (cancelled || !containerRef.current) return;
      instance = new api.Map(containerRef.current);
      instance.enableScrollWheelZoom(true);
      setConnection({ api, map: instance });
    }).catch(() => {
      if (!cancelled) setError("百度交互地图暂时未连接");
    });
    return () => {
      cancelled = true;
      instance?.clearOverlays();
      instance?.destroy?.();
    };
  }, [attempt]);

  useEffect(() => {
    if (!connection || !containerRef.current) return;
    const { api, map } = connection;
    const pts = JSON.parse(pointKey) as (Pt & { lat: number; lng: number })[];
    const path = pts.map(p => new api.Point(p.lng, p.lat));
    const fit = () => {
      if (path.length) map.setViewport(path, { margins: [36, 36, 36, 36], enableAnimation: false });
    };
    try {
      map.clearOverlays();
      if (!path.length) return;
      map.centerAndZoom(path[0], 14);
      if (path.length > 1) map.addOverlay(new api.Polyline(path, { strokeColor: "#28BDF0", strokeWeight: 4, strokeOpacity: 0.85 }));
      pts.forEach((p, i) => {
        const safeName = escapeHtml(p.name);
        const label = new api.Label(`<button type="button" data-trip-map-stop="${i + 1}" aria-label="${i + 1}. ${safeName}" title="${i + 1}. ${safeName}" style="display:grid;place-items:center;width:28px;height:28px;padding:0;border:3px solid white;border-radius:50%;background:#24b7e5;color:white;font:600 12px/1 system-ui;box-shadow:0 2px 8px #23475b35;box-sizing:border-box;cursor:pointer">${i + 1}</button>`, { position: path[i], offset: new api.Size(-14, -14) });
        label.setStyle({ border: "none", backgroundColor: "transparent", padding: "0" });
        label.addEventListener("click", () => {
          map.openInfoWindow(new api.InfoWindow(`<strong>${i + 1}. ${safeName}</strong>`, { width: 200, enableMessage: false }), path[i]);
        });
        map.addOverlay(label);
      });
      fit();
    } catch {
      setError("百度交互地图暂时无法显示");
    }
    const resize = new ResizeObserver(entries => {
      if (entries.some(entry => entry.contentRect.width > 0 && entry.contentRect.height > 0)) {
        map.checkResize?.();
        fit();
      }
    });
    resize.observe(containerRef.current);
    return () => resize.disconnect();
  }, [connection, pointKey]);

  useEffect(() => {
    if (connection && focusPoint?.lat != null && focusPoint.lng != null) {
      connection.map.centerAndZoom(new connection.api.Point(focusPoint.lng, focusPoint.lat), 16);
    }
  }, [connection, focusPoint?.lat, focusPoint?.lng]);

  const fitAll = () => {
    if (!connection) return;
    const pts = JSON.parse(pointKey) as (Pt & { lat: number; lng: number })[];
    connection.map.setViewport(pts.map(p => new connection.api.Point(p.lng, p.lat)), { margins: [36, 36, 36, 36], enableAnimation: false });
  };
  const { pts, polyline } = error ? projectStatic(points) : { pts: [], polyline: "" };
  return <div className="map-canvas interactive-map" data-map-state={error ? "error" : connection ? "ready" : "loading"}>
    <div className="baidu-map-surface" ref={containerRef} aria-label="百度交互地图" />
    {!connection && !error && <div className="map-loading" role="status">正在连接百度地图…</div>}
    {connection && !error && <div className="map-interactive-controls" aria-label="地图控制">
      <button type="button" onClick={fitAll} aria-label="查看全部地点">全览</button>
      <button type="button" onClick={() => connection.map.zoomIn()} aria-label="放大地图">+</button>
      <button type="button" onClick={() => connection.map.zoomOut()} aria-label="缩小地图">−</button>
    </div>}
    {error && <div className="map-offline-preview">
      {!imageFailed && <div className="static-map-wrap">
        <img src={mapUrl} alt="暂存的地点顺序示意图" onError={() => setImageFailed(true)} />
        {!!pts.length && <svg className="static-map-overlay" viewBox={`0 0 ${STATIC_W} ${STATIC_H}`} preserveAspectRatio="none" aria-hidden="true">
          {pts.length > 1 && <polyline points={polyline} fill="none" stroke="#1f8ce0" strokeWidth="3" />}
          {pts.map((p, i) => <g key={i}><circle cx={p.x} cy={p.y} r="13" fill="#1f8ce0" stroke="white" strokeWidth="2.5" /><text x={p.x} y={p.y} dy="4.5" textAnchor="middle" fontSize="13" fontWeight="700" fill="white">{i + 1}</text></g>)}
        </svg>}
      </div>}
      <div className="map-connection-message" role="status"><span>{error}，{imageFailed ? "请重试连接" : "当前显示暂存预览"}。</span><button type="button" onClick={() => { setImageFailed(false); setAttempt(value => value + 1); }}>重新连接</button></div>
    </div>}
  </div>;
}
