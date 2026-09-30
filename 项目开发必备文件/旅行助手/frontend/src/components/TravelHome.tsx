import { ArrowRight, ArrowUpRight, Check, Compass, Download, HelpCircle, Link2, ListChecks, Loader2, MapPin, Navigation } from "lucide-react";
import chongqing from "../assets/chongqing.jpg";
import chengdu from "../assets/chengdu.jpg";
import beijing from "../assets/beijing.jpg";

interface Props {
  link: string;
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
            <div className="composer-tabs"><span className="composer-mode"><Link2 size={16} />解析攻略</span><span className="mini-tag">你的旅行灵感入口</span></div>
            <div className="composer-input"><label className="sr-only" htmlFor="source-link">小红书攻略链接</label><textarea id="source-link" value={p.link} onChange={event => p.onLinkChange(event.target.value)} placeholder="粘贴小红书链接或分享文案，下一站交给途书…" rows={2} /><button className="composer-send" disabled={p.busy || !p.link.trim()} aria-label="解析攻略">{p.busy ? <Loader2 className="animate-spin" size={23} /> : <ArrowUpRight size={25} />}</button></div>
            <div className="composer-foot"><span><MapPin size={15} />从攻略中识别目的地</span><span><Check size={14} />保留原始旅行顺序</span></div>
          </form>
          <div className="try-demo"><span>还没想好？</span><button disabled={p.busy} onClick={p.onDemo}>试试这篇「重庆不绕路 2 日游」<ArrowRight size={13} /></button></div>
        </div>
        {p.error && <div className="home-error" role="alert">{p.error}</div>}
      </section>
      <div className="value-strip"><span><Check size={14} />核对每一站，再出发</span><span><MapPin size={14} />百度地图路线导航</span><span><Download size={14} />一份可以带走的行程长图</span></div>
      <section className="collection-section" id="inspiration">
        <div className="section-heading"><div><div className="eyebrow">A LITTLE INSPIRATION</div><h2>下一站，你想去哪里？<span>好行程，从一点灵感开始</span></h2></div><button className="text-button" onClick={focusInput}>开始我的行程<ArrowUpRight size={17} /></button></div>
        <div className="destination-grid">{destinations.map((destination, i) => <article className={`destination-card ${destination.color}`} key={destination.city}>
          <div className="destination-image"><img src={destination.image} alt={`${destination.city}旅行风景`} width={600} height={360} /><span className="destination-chip"><MapPin size={12} />{destination.city}</span><span className="destination-number">0{i + 1}</span></div>
          <div className="destination-body"><span className="card-tag">{destination.tag}</span><h3 className="card-title">{destination.title}</h3><p>{destination.subtitle}</p><footer>{i === 0 ? <button disabled={p.busy} onClick={() => { p.onDemo(); focusInput(); }}><span>填入重庆示例攻略</span><span className="card-arrow"><ArrowUpRight size={19} /></span></button> : <button onClick={focusInput}><span>带上你的攻略，一起出发</span><span className="card-arrow"><ArrowUpRight size={19} /></span></button>}</footer></div>
        </article>)}</div>
      </section>
      <section className="travel-guide" id="how-it-works" aria-labelledby="guide-title">
        <div className="section-heading"><div><div className="eyebrow">FROM AN IDEA TO A JOURNEY</div><h2 id="guide-title">三步，离远方更近一点</h2></div></div>
        <div className="guide-grid">{[{ icon: Link2, title: "留住灵感", text: "粘贴小红书攻略，让喜欢的地方有迹可循。" }, { icon: ListChecks, title: "安排刚刚好", text: "核对地点，按天调整，留出自己的旅行节奏。" }, { icon: Navigation, title: "带着地图出发", text: "生成动线、查看住宿，分享或保存行程长图。" }].map((step, i) => <div className="guide-step" key={step.title}><span className="step-icon"><step.icon size={21} /></span><div><small>0{i + 1}</small><h3>{step.title}</h3><p>{step.text}</p></div></div>)}</div>
      </section>
      <footer className="site-footer"><span>途书 TUSHU <i />让每一次出发，都有迹可循。</span><span>MADE FOR THE WANDERER IN YOU <Compass size={13} /></span></footer>
    </main>
  </div>;
}
