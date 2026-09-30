import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowUpRight, CalendarDays, Check, ChevronRight, Compass, Link2, ListChecks, Loader2, Map, MapPin, PanelLeftClose, PanelLeftOpen, Share2, Sparkles } from "lucide-react";
import type { InputMode, Place, PlacePhoto } from "../lib/types";
import PlaceCard from "./PlaceCard";
import MapView from "./MapView";
import TravelHome from "./TravelHome";
import InputModes from "./InputModes";

interface Props {
  demoMode?: boolean; presetTrip?: boolean;
  phase: string; link: string; onLinkChange: (value: string) => void;
  mode: InputMode; onModeChange: (mode: InputMode) => void; summary: string;
  tripId: string; title: string; city: string; places: Place[]; photos: Record<string, PlacePhoto>;
  progress: string; error: string; onGenerate: () => void; onDemo: () => void;
  onUpdate: (id: number, body: Record<string, unknown>) => void;
  onConfirm: () => void; onShare: () => void; children: ReactNode;
}

export default function JourneyWorkspace(p: Props) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<number | null>(null);
  const [sidebar, setSidebar] = useState(true);
  const [mobileTab, setMobileTab] = useState("list");
  const busy = p.phase === "loading" || p.phase === "routing";
  const hasTrip = !!p.tripId;
  const days = [...new Set(p.places.map(place => place.day))].sort((a, b) => a - b);
  const day = selectedDay !== null && days.includes(selectedDay) ? selectedDay : days[0];
  const active = p.places.filter(place => place.day === day).sort((a, b) => a.seq - b.seq);
  const mapped = active.filter(place => !place.skipped && place.lat != null && place.lng != null);
  const focused = mapped.find(place => place.id === selectedPlace);

  if (!hasTrip) return <TravelHome demoMode={p.demoMode} link={p.link} mode={p.mode} onModeChange={p.onModeChange} busy={busy} error={p.error} onLinkChange={p.onLinkChange} onGenerate={p.onGenerate} onDemo={p.onDemo} />;

  return <div className="trip-app has-trip visual-workspace">
    <header className="app-header">
      <div className="work-heading"><a className="round-back" href="/" aria-label="返回首页，新建行程"><ArrowLeft size={18} /></a><div><strong>{p.title || "正在整理你的旅行灵感"}</strong><span><MapPin size={11} />{p.city || "识别目的地中"}<i /><CalendarDays size={11} />{days.length || "—"} 天<i />{p.places.length} 个地点</span></div></div>
      <div className="header-actions"><span className="work-state"><span className="live-dot" />{busy ? "正在整理中" : p.phase === "route" ? "路线已准备好" : "核对地点后出发"}</span><a href="/" className="quiet-button"><Compass size={15} /><span>新建行程</span></a><button className="black-button small" onClick={p.onShare}><Share2 size={15} />分享行程</button></div>
    </header>
    <div className={`workspace ${sidebar ? "" : "sidebar-collapsed"}`}>
      <aside className={`assistant-panel ${!sidebar ? "desktop-hidden" : ""} ${mobileTab === "assistant" ? "mobile-assistant-open" : ""}`}>
        <div className="panel-top"><span className="assistant-title"><span className="assistant-mark"><Sparkles size={16} /></span>途书旅行助手<small>{p.presetTrip ? "DEMO" : "AI"}</small></span><button className="icon-button" onClick={() => setSidebar(false)} aria-label="收起攻略侧栏"><PanelLeftClose size={17} /></button></div>
        <div className="assistant-content">
          <div className="assistant-intro"><span className="soft-icon"><Compass size={29} /></span><h2>嗨，旅行家。<br />下一站，一起出发。</h2><p>从收藏夹里的一点心动，<br />到眼前清清楚楚的旅行路线。</p></div>
          <div className="source-card"><span><Link2 size={12} />这一次的旅行灵感</span><strong>{p.title || "正在读取攻略…"}</strong><p>{p.city || "目的地识别中"} · {days.length || "—"} 天 · {p.places.length} 个地点</p><div><Check size={12} />{p.presetTrip ? "预设演示 · 固定两日行程" : "核对每一站，按你的节奏调整。"}</div></div>
          <div className="journey-progress">
            <div className="progress-step complete"><span><Check size={12} /></span><div>{p.presetTrip ? "打开固定攻略" : "收下旅行灵感"}<small>{p.presetTrip ? "重庆特种兵两日游" : "攻略和想法，都能成为出发点"}</small></div></div>
            <div className={`progress-step ${p.phase === "loading" ? "current" : "complete"}`}><span>{p.phase === "loading" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}</span><div>{p.presetTrip ? "载入预设地点" : "识别旅行地点"}<small>{p.phase === "loading" ? p.progress || "正在解析…" : `已整理 ${p.places.length} 个地点`}</small></div></div>
            <div className={`progress-step ${p.phase === "confirm" || p.phase === "routing" ? "current" : p.phase === "route" ? "complete" : ""}`}><span>{p.phase === "route" ? <Check size={12} /> : "3"}</span><div>确认并出发<small>{p.phase === "route" ? "路线已就绪，带着地图出发" : "核对地点，再生成动线"}</small></div></div>
          </div>
        </div>
        <div className="sidebar-bottom">{p.demoMode ? <span className="preset-label">预设演示 · 攻略已锁定</span> : <InputModes mode={p.mode} onChange={p.onModeChange} disabled={busy} />}<form className="link-composer" onSubmit={event => { event.preventDefault(); p.onGenerate(); }}><label className="sr-only" htmlFor="source-link">{p.mode === "idea" ? "旅行想法" : "攻略链接或正文"}</label><textarea id="source-link" value={p.link} readOnly={p.demoMode} disabled={busy} maxLength={12000} onChange={event => { if (!p.demoMode) p.onLinkChange(event.target.value); }} placeholder={p.mode === "idea" ? "告诉途书想去的城市、天数和偏好…" : "粘贴攻略链接或正文，开启下一段旅程…"} rows={3} /><div className="composer-bottom"><span><Link2 size={11} />{p.demoMode ? "固定重庆两日游" : "开启一段新的旅程"}</span><button className="send-button" disabled={busy || !p.link.trim()} aria-label={p.demoMode ? "再次查看演示行程" : p.mode === "idea" ? "生成旅行方案" : "解析攻略"}>{busy ? <Loader2 className="animate-spin" size={17} /> : <ArrowUpRight size={18} />}</button></div></form><button className="demo-link" disabled={busy} onClick={p.onDemo}>{p.demoMode ? "查看固定攻略" : "填入重庆示例"} <ArrowUpRight size={13} /></button><div className="sidebar-footer"><span>途书 TUSHU</span><Compass size={12} /></div></div>
      </aside>
      <main className={`planning-panel ${mobileTab !== "list" ? "mobile-hidden" : ""}`}>
        <div className="planning-toolbar"><div className="toolbar-title">{!sidebar && <button className="icon-button" onClick={() => setSidebar(true)} aria-label="展开攻略侧栏"><PanelLeftOpen size={18} /></button>}<ListChecks size={16} /><span>行程画布</span></div><span className={`status-pill ${p.phase === "route" ? "ready" : ""}`}>{busy ? "整理中" : p.phase === "route" ? "路线已生成" : "待确认地点"}</span></div>
        <div className="planning-scroll">
          <div className="trip-heading"><span className="eyebrow">YOUR NEXT JOURNEY</span><h1>{p.title || "正在整理你的旅行灵感"}</h1><p><MapPin size={13} /> {p.city || "目的地识别中"}<span>·</span>{days.length} 天<span>·</span>{p.places.length} 个地点</p></div>
          {p.summary && <p className="trip-summary">{p.summary}</p>}
          <div className="day-tabs" role="tablist" aria-label="行程天数">{days.map(d => <button key={d} role="tab" aria-selected={day === d} onClick={() => { setSelectedDay(d); setSelectedPlace(null); }} className={day === d ? "active" : ""}>Day {d}<small>{p.places.filter(place => place.day === d).length} 站</small></button>)}</div>
          {p.error && <div className="error-message" role="alert">{p.error}</div>}
          {busy && <div className="working-message" role="status"><Loader2 size={17} className="animate-spin" />{p.progress || "正在整理行程…"}</div>}
          {p.phase !== "route" && (active.length > 0 ? <div className="day-column"><div className="day-heading"><CalendarDays size={15} /><strong>第 {day} 天</strong><span>{active.filter(place => !place.skipped).length} 站，串起今天的风景</span></div><div className="place-timeline">{active.map((place, i) => <div key={place.id} className="timeline-item"><span className="timeline-rail"><span>{i + 1}</span></span><PlaceCard place={place} photo={p.photos[String(place.id)]} onUpdate={p.onUpdate} selected={selectedPlace === place.id} onSelect={() => setSelectedPlace(place.id)} />{i < active.length - 1 && <div className="timeline-connector"><ArrowDown size={11} /><span>下一站</span></div>}</div>)}</div><div className="day-ending"><span /><Compass size={14} /> 把时间留给沿途的惊喜</div></div> : !busy && <div className="empty-planning"><MapPin size={30} /><h2>还没有可展示的地点</h2><p>可以在旅行助手中提交一篇攻略开始。</p></div>)}
          {p.children}
        </div>
        {p.phase === "confirm" && <div className="confirm-bar"><div><strong>确认好每一站了吗？</strong><span>生成前，你可以继续调整地点。</span></div><button className="black-button" onClick={p.onConfirm} disabled={busy || !mapped.length}>确认并生成动线 <ArrowUpRight size={16} /></button></div>}
      </main>
      <aside className={`map-panel ${mobileTab !== "map" ? "mobile-hidden" : ""}`}>
        <div className="map-top"><span><Map size={16} /> 地图预览</span><span className="map-day">Day {day || "—"}</span></div>
        {mapped.length ? <MapView key={`${p.tripId}-${day}-${mobileTab}`} points={mapped.map(place => ({ name: place.name, lat: place.lat ?? null, lng: place.lng ?? null }))} mapUrl={`/api/v1/trips/${p.tripId}/map?day=${day}`} focusPoint={focused && { name: focused.name, lat: focused.lat ?? null, lng: focused.lng ?? null }} /> : <div className="map-empty"><Map size={35} /><strong>下一站，即将出现</strong><span>地点定位完成后，在这里查看地图</span></div>}
        <p className="map-disclaimer">连线为地点顺序示意，实际道路请以导航为准。</p>
        <div className="map-summary"><span className="eyebrow">DAY {day || "—"} · EXPLORE</span><h2>{focused?.name || `${p.city || "这座城市"}，慢慢走`}</h2><p>{focused?.poi_address || `已定位 ${mapped.length} 个地点，点选行程卡片查看位置。`}</p><div className="map-place-chips">{mapped.map((place, i) => <button onClick={() => setSelectedPlace(place.id)} key={place.id} className={focused?.id === place.id ? "active" : ""}><span>{i + 1}</span><div>{place.name}<small>{place.type}</small></div><ChevronRight size={13} /></button>)}</div></div>
        <div className="map-bottom"><Compass size={13} />沿着心动的方向，慢慢探索。</div>
      </aside>
    </div>
    <nav className="mobile-view-tabs" aria-label="切换行程视图"><button className={mobileTab === "assistant" ? "active" : ""} onClick={() => setMobileTab("assistant")}><Sparkles size={16} /> 旅行助手</button><button className={mobileTab === "list" ? "active" : ""} onClick={() => setMobileTab("list")}><ListChecks size={16} /> 行程清单</button><button className={mobileTab === "map" ? "active" : ""} onClick={() => setMobileTab("map")}><Map size={16} /> 地图预览</button></nav>
  </div>;
}
