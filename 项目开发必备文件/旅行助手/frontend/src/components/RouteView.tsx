import { Clock, Download, ExternalLink, Loader2, Navigation, Share2 } from "lucide-react";
import type { RouteResponse } from "../lib/types";
import MapView from "./MapView";

interface Props {
  route: RouteResponse;
  navUri: string;
  onAppNav: () => void;
  onShare: () => void;
  onExport: () => void;
  exporting: boolean;
  exportProgress: string;
}

function toMercator(lng: number, lat: number): [number, number] {
  const x = (lng * 20037508.34) / 180;
  const y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  const yM = (y * 20037508.34) / 180;
  return [x, yM];
}

function webMapUrl(points: { lat: number | null | undefined; lng: number | null | undefined }[]): string {
  const pts = points.filter((p) => p.lat != null && p.lng != null) as {
    lat: number;
    lng: number;
  }[];
  if (!pts.length) return "https://map.baidu.com/";
  const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const [mx, my] = toMercator(lng, lat);
  return `https://map.baidu.com/@${mx.toFixed(2)},${my.toFixed(2)},13z`;
}

export default function RouteView({
  route,
  navUri,
  onAppNav,
  onShare,
  onExport,
  exporting,
  exportProgress,
}: Props) {
  return (
    <div>
      {route.days.map((d) => (
        <div key={d.day} className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <span
              className="rounded-lg px-2.5 py-1 text-xs font-bold text-white"
              style={{ background: "#4FA83C" }}
            >
              Day {d.day}
            </span>
            <span className="text-sm text-[#717171]">
              {d.places.length} 个地点 · {d.segments.length} 段
            </span>
            <a
              href={webMapUrl(d.places.map((p) => ({ lat: p.lat ?? null, lng: p.lng ?? null })))}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
              style={{ color: "#4FA83C" }}
            >
              <ExternalLink size={14} />
              网页版打开
            </a>
          </div>

          <MapView
            points={d.places.map((p) => ({
              name: p.name,
              lat: p.lat ?? null,
              lng: p.lng ?? null,
            }))}
            mapUrl={d.map_url}
          />

          <div className="mt-3 rounded-2xl border border-[#EBEBEB] bg-white px-4 py-2">
            {d.segments.map((s, i) => (
              <div
                key={i}
                className="flex items-center justify-between border-b border-dashed border-[#EBEBEB] py-2.5 text-sm last:border-b-0"
              >
                <span className="min-w-0 truncate pr-3">
                  {s.from_place} → {s.to_place}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-[#717171]">
                  <Clock size={13} />
                  {s.mode} · {s.duration_text}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <a
          href={navUri || "#"}
          onClick={(e) => {
            const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
            if (!isMobile) {
              e.preventDefault();
              onAppNav();
            }
          }}
          className="inline-flex items-center gap-2 rounded-2xl px-6 py-3 text-[15px] font-semibold text-white transition hover:opacity-90"
          style={{ background: "#4FA83C" }}
        >
          <Navigation size={18} />
          跳转百度地图 App
        </a>
        <button
          onClick={onShare}
          className="inline-flex items-center gap-2 rounded-2xl border border-[#DDDDDD] bg-white px-6 py-3 text-[15px] font-medium text-[#222] transition hover:border-[#B0B0B0]"
        >
          <Share2 size={18} />
          分享
        </button>
        <button
          onClick={onExport}
          disabled={exporting}
          className="inline-flex items-center gap-2 rounded-2xl border border-[#DDDDDD] bg-white px-6 py-3 text-[15px] font-medium text-[#222] transition hover:border-[#B0B0B0] disabled:opacity-60"
        >
          {exporting ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Download size={18} />
          )}
          导出长图
        </button>
      </div>
      {exportProgress && (
        <p className="mt-3 text-sm text-[#717171]">{exportProgress}</p>
      )}
    </div>
  );
}
