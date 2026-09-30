import { ArrowRight, ArrowUpRight, Check, Compass, Download, HelpCircle, Link2, ListChecks, Loader2, MapPin, Navigation } from "lucide-react";
import chongqing from "../assets/chongqing.jpg";
import chengdu from "../assets/chengdu.jpg";
import beijing from "../assets/beijing.jpg";
import type { InputMode } from "../lib/types";
import InputModes from "./InputModes";

interface Props {
  demoMode?: boolean;
  link: string;
  mode: InputMode;
  onModeChange: (mode: InputMode) => void;
  busy: boolean;
  error: string;
  onLinkChange: (value: string) => void;
  onGenerate: () => void;
  onDemo: () => void;
}

const destinations = [
  { city: "重庆", title: "在山城，走进人间烟火", subtitle: "穿过老街，在两江相遇", tag: "城市漫游", image: chongqing, color: "blue" },
  { city: "成都", title: "把日子，过成慢悠悠", subtitle: "一杯盖碗茶，一场不赶路的旅行", tag: "松弛感旅行", image: chengdu, color: "green" },
  { city: "北京", title: "去北京，读一座城的故事", subtitle: "从红墙金瓦，到胡同深处", tag: "人文与历史", image: beijing, color: "peach" },
];

export default function TravelHome(p: Props) {
  const idea = p.mode === "idea";
  const focusInput = () => {
    document.getElementById("source-link")?.focus();
    document.getElementById("start-journey")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return <div className="site-shell">
    <header className="site-header">
      <a className="brand" href="/" aria-label="途书旅记 TUSHU 首页"><span className="brand-icon"><Compass size={26} /></span><strong>途书旅记<span>TUSHU</span></strong></a>
      <nav className="main-nav" aria-label="首页导航"><a className="active" href="#start-journey" aria-current="page">首页<span /></a><a href="#inspiration">发现灵感</a><a href="#how-it-works">如何出发</a></nav>
      <div className="header-right"><a className="help-button" href="#how-it-works"><HelpCircle size={17} /><span>使用指南</span></a><span className="header-divider" /><button className="profile-button" aria-label="开始规划旅行" onClick={focusInput}><Compass size={18} /></button></div>
    </header>
    <main className="home">
      <section className="hero" id="start-journey">
        <div className="hero-stamp">Trip Flow</div>
        <h1>灵感出发，<span className="underlined">自在抵达<svg viewBox="0 0 210 14" aria-hidden="true"><path d="M3 10Q100 -2 207 8" /></svg></span>。</h1>
        <p>把收藏的攻略，变成下一段旅程</p>
        <div className="composer-wrap">
          <form className="composer" onSubmit={event => { event.preventDefault(); p.onGenerate(); }}>
            <div className="composer-tabs">{p.demoMode ? <span className="preset-label"><Compass size={15} />预设演示</span> : <InputModes mode={p.mode} onChange={p.onModeChange} disabled={p.busy} />}<span className="mini-tag">{p.demoMode ? "固定攻略 · 暂不可更换" : "你的旅行灵感入口"}</span></div>
            <div className="composer-input"><label className="sr-only" htmlFor="source-link">{idea ? "旅行想法" : "攻略链接或正文"}</label><textarea id="source-link" value={p.link} readOnly={p.demoMode} disabled={p.busy} maxLength={12000} onChange={event => { if (!p.demoMode) p.onLinkChange(event.target.value); }} placeholder={idea ? "想去哪里，玩几天？例如：重庆玩 2 天，想吃美食、看夜景，节奏轻松一点…" : "粘贴小红书链接、分享文案或攻略正文，下一站交给途书…"} rows={p.demoMode ? 3 : 2} /><button className="composer-send" disabled={p.busy || !p.link.trim()} aria-label={p.demoMode ? "生成演示行程" : idea ? "生成旅行方案" : "解析攻略"}>{p.busy ? <Loader2 className="animate-spin" size={23} /> : <ArrowUpRight size={25} />}</button></div>
            <div className="composer-foot"><span><MapPin size={15} />{p.demoMode ? "重庆 · 2 天 · 16 站" : idea ? "告诉途书城市、天数和偏好" : "从攻略中识别目的地"}</span><span><Check size={14} />{p.demoMode ? "固定演示行程" : idea ? "单城 1–7 天 · 未填天数按 2 天" : "保留原始旅行顺序"}</span></div>
          </form>
          <div className="try-demo"><span>{p.demoMode ? "已为你备好重庆两日游" : "还没想好？"}</span><button disabled={p.busy} onClick={p.demoMode ? p.onGenerate : p.onDemo}>{p.demoMode ? "开始演示" : idea ? "试试「重庆 2 天，吃美食、看夜景」" : "试试这篇「重庆不绕路 2 日游」"}<ArrowRight size={13} /></button></div>
        </div>
        {p.error && <div className="home-error" role="alert">{p.error}</div>}
      </section>
      <div className="value-strip"><span><Check size={14} />核对每一站，再出发</span><span><MapPin size={14} />百度地图路线导航</span><span><Download size={14} />一份可以带走的行程长图</span></div>
      <section className="collection-section" id="inspiration">
        <div className="section-heading"><div><div className="eyebrow">A LITTLE INSPIRATION</div><h2>下一站，你想去哪里？<span>好行程，从一点灵感开始</span></h2></div><button className="text-button" onClick={focusInput}>开始我的行程<ArrowUpRight size={17} /></button></div>
        <div className="destination-grid">{destinations.map((destination, i) => <article className={`destination-card ${destination.color}`} key={destination.city}>
          <div className="destination-image"><img src={destination.image} alt={`${destination.city}旅行风景`} width={600} height={360} /><span className="destination-chip"><MapPin size={12} />{destination.city}</span><span className="destination-number">0{i + 1}</span></div>
          <div className="destination-body"><span className="card-tag">{destination.tag}</span><h3 className="card-title">{destination.title}</h3><p>{destination.subtitle}</p><footer>{i === 0 ? <button disabled={p.busy} onClick={() => { p.onDemo(); focusInput(); }}><span>{p.demoMode ? "查看固定重庆攻略" : "填入重庆示例攻略"}</span><span className="card-arrow"><ArrowUpRight size={19} /></span></button> : <button onClick={focusInput}><span>{p.demoMode ? "当前演示为重庆两日游" : "带上你的攻略，一起出发"}</span><span className="card-arrow"><ArrowUpRight size={19} /></span></button>}</footer></div>
        </article>)}</div>
      </section>
      <section className="travel-guide" id="how-it-works" aria-labelledby="guide-title">
        <div className="section-heading"><div><div className="eyebrow">FROM AN IDEA TO A JOURNEY</div><h2 id="guide-title">三步，离远方更近一点</h2></div></div>
        <div className="guide-grid">{[{ icon: Link2, title: "留住灵感", text: p.demoMode ? "已预填重庆两日游攻略，点击箭头开始演示。" : "粘贴一篇攻略，或用一句话说说想去的地方。" }, { icon: ListChecks, title: "安排刚刚好", text: p.demoMode ? "查看预设的两天行程，按天浏览每一站。" : "核对地点，按天调整，留出自己的旅行节奏。" }, { icon: Navigation, title: "带着地图出发", text: "生成动线、查看住宿，分享或保存行程长图。" }].map((step, i) => <div className="guide-step" key={step.title}><span className="step-icon"><step.icon size={21} /></span><div><small>0{i + 1}</small><h3>{step.title}</h3><p>{step.text}</p></div></div>)}</div>
      </section>
      <footer className="site-footer"><span>途书 TUSHU <i />让每一次出发，都有迹可循。</span><span>MADE FOR THE WANDERER IN YOU <Compass size={13} /></span></footer>
    </main>
  </div>;
}
