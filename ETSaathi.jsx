import { useState, useRef, useEffect, useCallback, createContext, useContext, useMemo } from "react";

const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const ApiKeyContext = createContext({ apiKey: "", setApiKey: () => { } });
const useApiKey = () => useContext(ApiKeyContext);

// ── FINANCE ENGINE ──────────────────────────────────────────────────
const FE = {
  sipCorpus(sip, years, cagr = 12, stepUp = 10) {
    let corpus = 0, totalInvested = 0, monthly = sip;
    for (let y = 0; y < years; y++) {
      for (let m = 0; m < 12; m++) {
        corpus = (corpus + monthly) * (1 + cagr / 100 / 12);
        totalInvested += monthly;
      }
      monthly *= 1 + stepUp / 100;
    }
    return { corpus: Math.round(corpus), totalInvested: Math.round(totalInvested), gains: Math.round(corpus - totalInvested) };
  },
  fireCorpus(monthlyExpenses, yearsToRetirement, inflationRate = 6) {
    const futureExpenses = monthlyExpenses * Math.pow(1 + inflationRate / 100, yearsToRetirement);
    return Math.round((futureExpenses * 12) / 0.04);
  },
  requiredSIP(targetCorpus, years, cagr = 12) {
    const r = cagr / 100 / 12, n = years * 12;
    return Math.round(targetCorpus / ((Math.pow(1 + r, n) - 1) / r * (1 + r)));
  },
  taxOld(income) {
    let tax = 0;
    const slabs = [[250000, 0], [500000, 0.05], [1000000, 0.2], [Infinity, 0.3]];
    let prev = 0;
    for (const [limit, rate] of slabs) {
      if (income <= prev) break;
      tax += Math.min(income - prev, limit - prev) * rate;
      prev = limit;
    }
    return Math.round(tax * 1.04);
  },
  taxNew(income) {
    const taxable = Math.max(0, income - 75000);
    let tax = 0;
    const slabs = [[300000, 0], [700000, 0.05], [1000000, 0.1], [1200000, 0.15], [1500000, 0.2], [Infinity, 0.3]];
    let prev = 0;
    for (const [limit, rate] of slabs) {
      if (taxable <= prev) break;
      tax += Math.min(taxable - prev, limit - prev) * rate;
      prev = limit;
    }
    return Math.round(tax * 1.04);
  },
  healthScore(data) {
    const scores = {
      emergency: Math.min(100, (data.emergencyFund / (data.monthlyExpenses * 6)) * 100),
      insurance: Math.min(100, (data.insuranceCover / (data.annualIncome * 10)) * 100),
      debt: Math.max(0, 100 - (data.emiAmount / data.monthlyIncome) * 333),
      savings: Math.min(100, (data.monthlySavings / data.monthlyIncome) * 500),
      tax: Math.min(100, (data.taxSavings / 150000) * 100),
      invest: data.hasSIP ? 80 : 20,
    };
    const weights = { emergency: 0.2, insurance: 0.2, debt: 0.2, savings: 0.2, tax: 0.1, invest: 0.1 };
    const total = Object.keys(scores).reduce((s, k) => s + scores[k] * weights[k], 0);
    return { total: Math.round(total), breakdown: scores };
  },
  monteCarlo(sip, years, runs = 500) {
    const results = [];
    for (let r = 0; r < runs; r++) {
      let corpus = 0;
      for (let m = 0; m < years * 12; m++) {
        const monthlyReturn = (Math.random() * 0.32 - 0.06) / 12;
        corpus = (corpus + sip) * (1 + monthlyReturn);
      }
      results.push(Math.max(0, corpus));
    }
    results.sort((a, b) => a - b);
    return {
      p10: Math.round(results[Math.floor(runs * 0.1)]),
      median: Math.round(results[Math.floor(runs * 0.5)]),
      p90: Math.round(results[Math.floor(runs * 0.9)]),
      successRate: Math.round((results.filter(v => v > sip * years * 12).length / runs) * 100),
    };
  },
  // MPT-based risk allocation
  riskAllocation(riskScore) {
    if (riskScore >= 80) return { equity: 85, debt: 10, gold: 5, label: "Aggressive" };
    if (riskScore >= 60) return { equity: 70, debt: 20, gold: 10, label: "Moderate-High" };
    if (riskScore >= 40) return { equity: 55, debt: 35, gold: 10, label: "Moderate" };
    if (riskScore >= 20) return { equity: 35, debt: 50, gold: 15, label: "Conservative" };
    return { equity: 20, debt: 65, gold: 15, label: "Very Conservative" };
  },
  // Tax loss harvesting
  taxLossHarvest(holdings) {
    const losses = holdings.filter(h => h.gain < 0);
    const gains = holdings.filter(h => h.gain > 0);
    const totalLoss = losses.reduce((s, h) => s + Math.abs(h.gain), 0);
    const taxSaved = Math.min(totalLoss, gains.reduce((s, h) => s + h.gain, 0)) * 0.1;
    return { totalLoss, taxSaved: Math.round(taxSaved), candidates: losses };
  },
};

const fmt = {
  cr: v => v >= 10000000 ? `₹${(v / 10000000).toFixed(2)}Cr` : v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : `₹${v.toLocaleString("en-IN")}`,
  num: v => `₹${Math.round(v).toLocaleString("en-IN")}`,
  pct: v => `${Math.round(v)}%`,
};

// ── DESIGN TOKENS (CLEO-INSPIRED) ──────────────────────────────────
const T = {
  bg: "#09090E",
  bgCard: "#0F0F17",
  bgCard2: "#14141E",
  bgCard3: "#1A1A28",
  border: "#1F1F30",
  borderLight: "#2A2A40",
  accent: "#6366F1",
  accentHover: "#818CF8",
  accentGlow: "rgba(99,102,241,0.15)",
  emerald: "#10B981",
  emeraldGlow: "rgba(16,185,129,0.12)",
  amber: "#F59E0B",
  amberGlow: "rgba(245,158,11,0.12)",
  rose: "#F43F5E",
  roseGlow: "rgba(244,63,94,0.12)",
  sky: "#0EA5E9",
  skyGlow: "rgba(14,165,233,0.12)",
  violet: "#8B5CF6",
  text: "#FAFAFA",
  textSub: "#A0A0C0",
  textMuted: "#505070",
  gradient: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 50%, #A78BFA 100%)",
};

// ── GLOBAL CSS ──────────────────────────────────────────────────────
const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300;12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&family=JetBrains+Mono:wght@400;500;600&display=swap');
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #09090E; margin: 0; min-width: 100vw; min-height: 100vh; overflow-x: hidden; }
:root {
  --accent: #6366F1;
  --emerald: #10B981;
  --amber: #F59E0B;
  --rose: #F43F5E;
  --sky: #0EA5E9;
}
::-webkit-scrollbar { width: 3px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #222238; border-radius: 99px; }
input[type=range] { appearance: none; height: 3px; background: #1F1F30; border-radius: 99px; outline: none; cursor: pointer; }
input[type=range]::-webkit-slider-thumb { appearance: none; width: 18px; height: 18px; border-radius: 50%; background: var(--accent); cursor: pointer; box-shadow: 0 0 10px rgba(99,102,241,0.5); transition: transform 0.15s; }
input[type=range]::-webkit-slider-thumb:hover { transform: scale(1.15); }
input[type=number] { -moz-appearance: textfield; }
input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
@keyframes fadeSlideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
@keyframes bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
@keyframes shimmer { 0% { background-position: -200px 0; } 100% { background-position: 200px 0; } }
@keyframes glow { 0%, 100% { box-shadow: 0 0 20px rgba(99,102,241,0.2); } 50% { box-shadow: 0 0 40px rgba(99,102,241,0.5); } }
@keyframes slideRight { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes countUp { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
@keyframes nudgeBounce { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
@keyframes ringFill { from { stroke-dashoffset: 999; } to { stroke-dashoffset: 0; } }
@keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-6px); } }
.fade-slide-up { animation: fadeSlideUp 0.4s ease both; }
.pulse-dot { animation: pulse 2s infinite; }
.float { animation: float 3s ease-in-out infinite; }
`;

// ── SHARED STYLES ──────────────────────────────────────────────────
const S = {
  app: { background: T.bg, minHeight: "100vh", minWidth: "100%", fontFamily: "'Bricolage Grotesque', sans-serif", color: T.text, display: "flex" },
  sidebar: { width: 240, background: T.bgCard, borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", padding: "0", position: "fixed", top: 0, left: 0, height: "100vh", zIndex: 100 },
  main: { marginLeft: 240, flex: 1, display: "flex", flexDirection: "column", minHeight: "100vh" },
  header: { padding: "14px 24px", borderBottom: `1px solid ${T.border}`, background: "rgba(9,9,14,0.92)", backdropFilter: "blur(20px)", position: "sticky", top: 0, zIndex: 50, display: "flex", alignItems: "center", gap: 12 },
  card: { background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 16, padding: 20 },
  cardSm: { background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 },
  input: { width: "100%", background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 14px", color: T.text, fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "inherit", transition: "border-color 0.2s" },
  label: { fontSize: 11, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6, display: "block", fontWeight: 600 },
  btn: (v, color) => ({
    padding: "10px 18px", borderRadius: 10, border: `1px solid ${v ? (color || T.accent) : T.border}`,
    background: v ? (color || T.accent) : "transparent", color: v ? "#fff" : T.textSub,
    cursor: "pointer", fontSize: 14, fontWeight: 600, transition: "all 0.2s", fontFamily: "inherit",
    display: "inline-flex", alignItems: "center", gap: 6,
  }),
  pill: (color) => ({ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 99, fontSize: 11, fontWeight: 700, background: color + "22", color, letterSpacing: 0.3 }),
  navItem: (active) => ({
    display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", margin: "1px 8px", borderRadius: 10,
    cursor: "pointer", background: active ? T.accentGlow : "transparent", color: active ? T.accentHover : T.textSub,
    fontWeight: active ? 700 : 400, fontSize: 13.5, transition: "all 0.15s",
    border: `1px solid ${active ? T.accent + "44" : "transparent"}`,
  }),
};

// ── ANIMATED NUMBER ─────────────────────────────────────────────────
function AnimNum({ value, format = fmt.cr, duration = 600 }) {
  const [display, setDisplay] = useState(0);
  const startRef = useRef(0);
  const startTimeRef = useRef(null);
  useEffect(() => {
    startRef.current = display;
    startTimeRef.current = null;
    const animate = (ts) => {
      if (!startTimeRef.current) startTimeRef.current = ts;
      const prog = Math.min((ts - startTimeRef.current) / duration, 1);
      const eased = 1 - Math.pow(1 - prog, 3);
      setDisplay(Math.round(startRef.current + (value - startRef.current) * eased));
      if (prog < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [value]);
  return <span style={{ animation: "countUp 0.3s ease both" }}>{format(display)}</span>;
}

// ── SPARK LINE ──────────────────────────────────────────────────────
function SparkLine({ data, color, height = 60, filled = true, multiLine }) {
  if (!data?.length && !multiLine?.length) return null;
  const lines = multiLine || [{ data, color }];
  const allVals = lines.flatMap(l => l.data);
  const max = Math.max(...allVals);
  const min = Math.min(...allVals);
  const W = 300, H = height;
  const toX = (i, len) => (i / (len - 1)) * W;
  const toY = (v) => H - ((v - min) / (max - min || 1)) * (H - 8) - 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height }} preserveAspectRatio="none">
      <defs>
        {lines.map((l, li) => (
          <linearGradient key={li} id={`sg${li}${l.color?.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={l.color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={l.color} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      {lines.map((l, li) => {
        const pts = l.data.map((v, i) => `${toX(i, l.data.length)},${toY(v)}`);
        return (
          <g key={li}>
            {filled && <polygon points={`0,${H} ${pts.join(" ")} ${W},${H}`} fill={`url(#sg${li}${l.color?.replace("#", "")})`} />}
            <polyline points={pts.join(" ")} fill="none" stroke={l.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        );
      })}
    </svg>
  );
}

// ── RING ───────────────────────────────────────────────────────────
function Ring({ value, size = 80, color = T.accent, label, sub }) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.bgCard3} strokeWidth={9} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={9}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.34,1.56,0.64,1)" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: size > 90 ? 20 : 13, fontWeight: 800, color, lineHeight: 1 }}>{value}</span>
        {label && <span style={{ fontSize: 9, color: T.textMuted, fontWeight: 600, letterSpacing: 0.5, marginTop: 2 }}>{label}</span>}
      </div>
    </div>
  );
}

// ── DECISION CARD ──────────────────────────────────────────────────
function DecisionCard({ decision, onApply, onSimulate }) {
  const [applied, setApplied] = useState(false);
  const handleApply = () => { setApplied(true); onApply?.(decision); };
  return (
    <div style={{
      background: `linear-gradient(135deg, ${T.bgCard2} 0%, ${T.bgCard3} 100%)`,
      border: `1px solid ${T.accent}55`, borderRadius: 16, padding: 20,
      animation: "fadeSlideUp 0.4s ease both",
      boxShadow: `0 8px 32px ${T.accentGlow}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: T.rose, animation: "pulse 2s infinite" }} />
        <span style={{ fontSize: 11, color: T.rose, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Decision Alert</span>
      </div>
      <div style={{ fontSize: 17, fontWeight: 800, color: T.text, marginBottom: 4 }}>{decision.title}</div>
      <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
        <div>
          <div style={S.label}>Current</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.textSub }}>{decision.current}</div>
        </div>
        <div style={{ color: T.textMuted, alignSelf: "center", fontSize: 18 }}>→</div>
        <div>
          <div style={S.label}>Recommended</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.accent }}>{decision.recommended}</div>
        </div>
      </div>
      <div style={{ background: T.accentGlow, border: `1px solid ${T.accent}22`, borderRadius: 10, padding: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: T.textSub, fontWeight: 600, marginBottom: 8 }}>📈 Impact</div>
        {decision.impacts.map((imp, i) => (
          <div key={i} style={{ fontSize: 13, color: T.text, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: T.emerald }}>✓</span> {imp}
          </div>
        ))}
      </div>
      {decision.explanation && (
        <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 14, lineHeight: 1.6, padding: "8px 12px", background: T.bgCard, borderRadius: 8, borderLeft: `3px solid ${T.accent}` }}>
          💡 <strong style={{ color: T.textSub }}>Why?</strong> {decision.explanation}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={handleApply} style={{ ...S.btn(true), flex: 1, padding: "11px 0", justifyContent: "center", background: applied ? T.emerald : T.accent, border: "none", fontSize: 13 }}>
          {applied ? "✓ Applied!" : "Apply Decision"}
        </button>
        <button onClick={() => onSimulate?.(decision)} style={{ ...S.btn(false), padding: "11px 16px", fontSize: 13 }}>
          Simulate More
        </button>
      </div>
    </div>
  );
}

// ── BEHAVIORAL ALERT ───────────────────────────────────────────────
function BehavioralAlert({ alerts }) {
  const [dismissed, setDismissed] = useState([]);
  const visible = alerts.filter((_, i) => !dismissed.includes(i));
  if (!visible.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {visible.map((alert, i) => (
        <div key={i} style={{
          background: T.bgCard2, border: `1px solid ${alert.color}44`,
          borderRadius: 12, padding: "12px 16px",
          display: "flex", alignItems: "flex-start", gap: 12,
          animation: "fadeSlideUp 0.3s ease both",
          animationDelay: `${i * 0.1}s`,
        }}>
          <span style={{ fontSize: 20, flexShrink: 0 }}>{alert.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: alert.color, marginBottom: 3 }}>{alert.title}</div>
            <div style={{ fontSize: 12, color: T.textSub, lineHeight: 1.5 }}>{alert.message}</div>
            {alert.action && (
              <div style={{ marginTop: 6, fontSize: 12, color: T.emerald, fontWeight: 600 }}>
                👉 {alert.action}
              </div>
            )}
          </div>
          <button onClick={() => setDismissed(d => [...d, i])} style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, fontSize: 16, lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>
      ))}
    </div>
  );
}

// ── SCENARIO TABLE ─────────────────────────────────────────────────
function ScenarioTable({ scenarios }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Scenario", "Monthly SIP", "Corpus (20Y)", "Risk", "Retire Age"].map(h => (
              <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, color: T.textMuted, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderBottom: `1px solid ${T.border}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {scenarios.map((s, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${T.border}88`, background: s.highlight ? T.accentGlow : "transparent", transition: "background 0.2s" }}>
              <td style={{ padding: "12px 14px", fontSize: 13, fontWeight: 600, color: s.highlight ? T.accentHover : T.text }}>
                {s.highlight && <span style={{ marginRight: 6 }}>⭐</span>}{s.label}
              </td>
              <td style={{ padding: "12px 14px", fontSize: 13, color: T.textSub, fontFamily: "'JetBrains Mono', monospace" }}>{fmt.num(s.sip)}</td>
              <td style={{ padding: "12px 14px", fontSize: 14, fontWeight: 700, color: T.emerald, fontFamily: "'JetBrains Mono', monospace" }}>{fmt.cr(s.corpus)}</td>
              <td style={{ padding: "12px 14px" }}><span style={S.pill(s.riskColor)}>{s.risk}</span></td>
              <td style={{ padding: "12px 14px", fontSize: 13, color: T.textSub }}>{s.retireAge}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── SMART NUDGE ────────────────────────────────────────────────────
function SmartNudge({ nudges }) {
  const [idx, setIdx] = useState(0);
  const nudge = nudges[idx % nudges.length];
  return (
    <div style={{
      background: `linear-gradient(135deg, ${T.bgCard2}, ${T.bgCard3})`,
      border: `1px solid ${T.emerald}44`,
      borderRadius: 12, padding: "12px 16px",
      display: "flex", alignItems: "center", gap: 12,
      cursor: "pointer", transition: "all 0.2s",
    }} onClick={() => setIdx(i => i + 1)}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: T.emeraldGlow, border: `1px solid ${T.emerald}33`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
        {nudge.icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: T.emerald, fontWeight: 700, marginBottom: 2 }}>💡 Smart Nudge</div>
        <div style={{ fontSize: 13, color: T.textSub }}>{nudge.message}</div>
      </div>
      <span style={{ color: T.textMuted, fontSize: 12 }}>{idx + 1}/{nudges.length}</span>
    </div>
  );
}

// ── TIMELINE PAGE ──────────────────────────────────────────────────
function TimelinePage() {
  const [age, setAge] = useState(28);
  const milestones = useMemo(() => [
    { year: 1, label: "Emergency Fund", desc: "Build 6 months expenses buffer", goal: `₹${Math.round(50000 * 6 / 100000).toFixed(1)}L`, icon: "🛡️", color: T.sky },
    { year: 2, label: "Max Insurance Cover", desc: "Term life + health insurance", goal: "₹1Cr + ₹10L", icon: "❤️", color: T.rose },
    { year: 3, label: "Step-up SIP", desc: "Increase SIP by 20%", goal: fmt.num(10000 * 1.2) + "/mo", icon: "📈", color: T.emerald },
    { year: 5, label: "First Goal (Car/Home Down Payment)", desc: "Dedicated goal fund", goal: "₹10-25L", icon: "🏠", color: T.amber },
    { year: 7, label: "Equity Portfolio", desc: "Direct stocks + MF diversification", goal: "₹25L+", icon: "📊", color: T.violet },
    { year: 10, label: "Financial Independence", desc: "Passive income covers 50% expenses", goal: fmt.cr(FE.fireCorpus(50000, 10) / 2), icon: "🔥", color: T.accent },
    { year: 15, label: "FIRE Ready", desc: "Option to retire early", goal: fmt.cr(FE.fireCorpus(50000, 15)), icon: "🏆", color: T.emerald },
  ], [age]);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>📅 Life Financial Timeline</h2>
        <p style={{ color: T.textSub, fontSize: 14 }}>Your personalized roadmap to financial independence</p>
      </div>
      <div style={{ display: "flex", gap: 20, marginBottom: 24, alignItems: "center" }}>
        <div style={{ ...S.cardSm, display: "flex", alignItems: "center", gap: 12 }}>
          <label style={{ ...S.label, margin: 0 }}>Your Age</label>
          <input type="number" value={age} onChange={e => setAge(+e.target.value)} style={{ ...S.input, width: 80 }} />
        </div>
      </div>
      <div style={{ position: "relative", paddingLeft: 32 }}>
        <div style={{ position: "absolute", left: 12, top: 0, bottom: 0, width: 2, background: `linear-gradient(to bottom, ${T.accent}, ${T.emerald})`, borderRadius: 2 }} />
        {milestones.map((m, i) => (
          <div key={i} style={{ position: "relative", marginBottom: 24, animation: `fadeSlideUp 0.4s ease ${i * 0.07}s both` }}>
            <div style={{ position: "absolute", left: -26, top: 16, width: 16, height: 16, borderRadius: "50%", background: m.color, border: `3px solid ${T.bg}`, boxShadow: `0 0 12px ${m.color}66` }} />
            <div style={{ ...S.card, borderColor: m.color + "33", marginLeft: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 20 }}>{m.icon}</span>
                    <div>
                      <div style={{ fontSize: 11, color: m.color, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Year {m.year} · Age {age + m.year}</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>{m.label}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: T.textSub, lineHeight: 1.6 }}>{m.desc}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 16 }}>
                  <div style={S.label}>Target</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: m.color, fontFamily: "'JetBrains Mono', monospace" }}>{m.goal}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── COUPLE MODE ────────────────────────────────────────────────────
function CouplePage() {
  const [mode, setMode] = useState("single");
  const [a, setA] = useState({ income: 100000, expenses: 55000, sip: 10000, goal: "invest" });
  const [b, setB] = useState({ income: 80000, expenses: 45000, sip: 8000, goal: "spend" });

  const combined = {
    income: a.income + b.income,
    expenses: a.expenses + b.expenses,
    sip: a.sip + b.sip,
    savings: (a.income + b.income) - (a.expenses + b.expenses),
  };
  const conflict = a.goal !== b.goal;
  const fireYears = 20;
  const targetCorpus = FE.fireCorpus(combined.expenses, fireYears);
  const projCorpus = FE.sipCorpus(combined.sip, fireYears).corpus;
  const InpRow = (label, valA, onA, valB, onB) => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12, alignItems: "center" }}>
      <div style={{ fontSize: 13, color: T.textSub, fontWeight: 500 }}>{label}</div>
      <input type="number" value={valA} onChange={e => onA(+e.target.value)} style={S.input} />
      {mode === "couple" && <input type="number" value={valB} onChange={e => onB(+e.target.value)} style={S.input} />}
    </div>
  );

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>💑 Couple Mode</h2>
        <p style={{ color: T.textSub, fontSize: 14 }}>Plan finances together — detect conflicts, combine goals</p>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {[{ id: "single", label: "👤 Single" }, { id: "couple", label: "👥 Couple" }].map(m => (
          <button key={m.id} onClick={() => setMode(m.id)} style={{ ...S.btn(mode === m.id), padding: "8px 20px" }}>{m.label}</button>
        ))}
      </div>
      {mode === "couple" && conflict && (
        <div style={{ background: T.roseGlow, border: `1px solid ${T.rose}44`, borderRadius: 12, padding: 16, marginBottom: 20, animation: "nudgeBounce 0.5s ease" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.rose, marginBottom: 6 }}>⚠️ Goal Conflict Detected!</div>
          <div style={{ fontSize: 13, color: T.textSub, marginBottom: 10 }}>
            Partner A wants to <strong style={{ color: T.accentHover }}>invest</strong> · Partner B wants to <strong style={{ color: T.amber }}>spend more</strong>
          </div>
          <div style={{ background: T.emeraldGlow, border: `1px solid ${T.emerald}33`, borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 12, color: T.emerald, fontWeight: 700 }}>💡 Suggested Split</div>
            <div style={{ fontSize: 13, color: T.textSub, marginTop: 4 }}>
              70% invest ({fmt.num(Math.round(combined.savings * 0.7))}/mo) · 30% lifestyle ({fmt.num(Math.round(combined.savings * 0.3))}/mo)
            </div>
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={S.card}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div style={{ ...S.label, margin: 0 }}>Parameter</div>
            <div style={{ ...S.label, margin: 0 }}>Partner A</div>
            {mode === "couple" && <div style={{ ...S.label, margin: 0 }}>Partner B</div>}
          </div>
          {InpRow("Monthly Income", a.income, v => setA(p => ({ ...p, income: v })), b.income, v => setB(p => ({ ...p, income: v })))}
          {InpRow("Monthly Expenses", a.expenses, v => setA(p => ({ ...p, expenses: v })), b.expenses, v => setB(p => ({ ...p, expenses: v })))}
          {InpRow("Monthly SIP (₹)", a.sip, v => setA(p => ({ ...p, sip: v })), b.sip, v => setB(p => ({ ...p, sip: v })))}
          {mode === "couple" && (
            <div>
              <div style={{ ...S.label, marginTop: 8 }}>Financial Goal Priority</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[{ id: "invest", label: "💰 Invest" }, { id: "spend", label: "🛍️ Spend" }, { id: "save", label: "🏦 Save" }, { id: "enjoy", label: "✈️ Enjoy" }].map(g => (
                  <button key={g.id} onClick={() => setB(p => ({ ...p, goal: g.id }))} style={{ ...S.btn(b.goal === g.id), padding: "7px 0", justifyContent: "center", fontSize: 12 }}>{g.label}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {mode === "couple" && (
            <div style={{ ...S.card, borderColor: T.accent + "44" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.textSub, marginBottom: 12 }}>Combined Picture</div>
              {[
                { l: "Total Income", v: fmt.num(combined.income), c: T.emerald },
                { l: "Total Expenses", v: fmt.num(combined.expenses), c: T.rose },
                { l: "Combined SIP", v: fmt.num(combined.sip), c: T.accent },
                { l: "Monthly Surplus", v: fmt.num(combined.savings), c: T.amber },
              ].map(row => (
                <div key={row.l} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${T.border}` }}>
                  <span style={{ fontSize: 13, color: T.textSub }}>{row.l}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: row.c, fontFamily: "'JetBrains Mono', monospace" }}>{row.v}</span>
                </div>
              ))}
            </div>
          )}
          <div style={S.card}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>20-Year FIRE Projection</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={S.cardSm}>
                <div style={S.label}>FIRE Target</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: T.amber, fontFamily: "'JetBrains Mono', monospace" }}>{fmt.cr(targetCorpus)}</div>
              </div>
              <div style={S.cardSm}>
                <div style={S.label}>Projected</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: projCorpus >= targetCorpus ? T.emerald : T.rose, fontFamily: "'JetBrains Mono', monospace" }}>{fmt.cr(projCorpus)}</div>
              </div>
            </div>
            <div style={{ marginTop: 12, height: 6, background: T.bgCard3, borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(100, (projCorpus / targetCorpus) * 100)}%`, background: T.gradient, borderRadius: 3, transition: "width 0.8s ease" }} />
            </div>
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>{Math.round((projCorpus / targetCorpus) * 100)}% towards FIRE goal</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── PORTFOLIO PAGE (MPT) ───────────────────────────────────────────
function PortfolioPage() {
  const [riskScore, setRiskScore] = useState(65);
  const [invested, setInvested] = useState(500000);
  const alloc = FE.riskAllocation(riskScore);
  const holdings = [
    { name: "Nifty 50 Index Fund", value: invested * 0.35, buy: invested * 0.3, gain: invested * 0.05, type: "equity" },
    { name: "Mid Cap Momentum", value: invested * 0.25, buy: invested * 0.28, gain: -invested * 0.03, type: "equity" },
    { name: "Govt Bond Fund", value: invested * 0.2, buy: invested * 0.19, gain: invested * 0.01, type: "debt" },
    { name: "Gold ETF", value: invested * 0.1, buy: invested * 0.09, gain: invested * 0.01, type: "gold" },
    { name: "US Tech Fund", value: invested * 0.1, buy: invested * 0.14, gain: -invested * 0.04, type: "equity" },
  ];
  const harvest = FE.taxLossHarvest(holdings);
  const totalValue = holdings.reduce((s, h) => s + h.value, 0);
  const totalBuy = holdings.reduce((s, h) => s + h.buy, 0);
  const totalGain = totalValue - totalBuy;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>📊 Portfolio Intelligence</h2>
        <p style={{ color: T.textSub, fontSize: 14 }}>MPT-optimized allocation · Tax-loss harvesting · Auto-rebalancing</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
        <div style={S.card}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Risk Profile</div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={S.label}>Risk Tolerance</span>
            <span style={{ ...S.pill(riskScore >= 60 ? T.rose : riskScore >= 40 ? T.amber : T.emerald) }}>{alloc.label}</span>
          </div>
          <input type="range" min={0} max={100} value={riskScore} onChange={e => setRiskScore(+e.target.value)} style={{ width: "100%", marginBottom: 20 }} />
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { l: "Equity", v: alloc.equity, c: T.emerald },
              { l: "Debt", v: alloc.debt, c: T.sky },
              { l: "Gold", v: alloc.gold, c: T.amber },
            ].map(a => (
              <div key={a.l} style={{ flex: 1, textAlign: "center" }}>
                <div style={{ height: 60, display: "flex", alignItems: "flex-end", justifyContent: "center", marginBottom: 6 }}>
                  <div style={{ width: 32, background: a.c, borderRadius: "4px 4px 0 0", height: `${a.v * 0.6}%`, transition: "height 0.5s cubic-bezier(0.34,1.56,0.64,1)", minHeight: 4 }} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: a.c }}>{a.v}%</div>
                <div style={{ fontSize: 11, color: T.textMuted }}>{a.l}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={S.card}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Portfolio Summary</div>
          {[
            { l: "Current Value", v: fmt.cr(totalValue), c: T.text },
            { l: "Total Invested", v: fmt.cr(totalBuy), c: T.textSub },
            { l: "Total P&L", v: fmt.cr(Math.abs(totalGain)), c: totalGain >= 0 ? T.emerald : T.rose, prefix: totalGain >= 0 ? "▲ " : "▼ " },
            { l: "XIRR (est.)", v: "11.8%", c: T.accent },
          ].map(r => (
            <div key={r.l} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 13, color: T.textSub }}>{r.l}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: r.c, fontFamily: "'JetBrains Mono', monospace" }}>{r.prefix || ""}{r.v}</span>
            </div>
          ))}
        </div>
      </div>
      {harvest.taxSaved > 0 && (
        <div style={{ background: T.amberGlow, border: `1px solid ${T.amber}44`, borderRadius: 12, padding: 16, marginBottom: 20, animation: "fadeSlideUp 0.4s ease both" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.amber, marginBottom: 6 }}>🔄 Tax-Loss Harvesting Opportunity</div>
          <div style={{ fontSize: 13, color: T.textSub }}>
            Book ₹{Math.round(harvest.totalLoss / 1000).toFixed(0)}K losses from <strong style={{ color: T.text }}>{harvest.candidates.length} fund(s)</strong> → Save <strong style={{ color: T.emerald }}>{fmt.num(harvest.taxSaved)}</strong> in LTCG tax this year
          </div>
        </div>
      )}
      <div style={S.card}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Holdings</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>{["Fund", "Current Value", "Invested", "P&L", "Action"].map(h => (
              <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: T.textMuted, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderBottom: `1px solid ${T.border}` }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {holdings.map((h, i) => (
              <tr key={i}>
                <td style={{ padding: "12px", fontSize: 13, fontWeight: 600 }}>{h.name}</td>
                <td style={{ padding: "12px", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: T.textSub }}>{fmt.cr(h.value)}</td>
                <td style={{ padding: "12px", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: T.textMuted }}>{fmt.cr(h.buy)}</td>
                <td style={{ padding: "12px", fontSize: 13, fontWeight: 700, color: h.gain >= 0 ? T.emerald : T.rose, fontFamily: "'JetBrains Mono', monospace" }}>
                  {h.gain >= 0 ? "+" : ""}{fmt.cr(h.gain)}
                </td>
                <td style={{ padding: "12px" }}>
                  {h.gain < 0 ? <span style={S.pill(T.amber)}>Harvest Loss</span> : <span style={S.pill(T.emerald)}>Hold</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── SIP PAGE (WITH WHAT-IF SLIDER) ─────────────────────────────────
function SIPPage() {
  const [form, setForm] = useState({ sip: 10000, years: 20, cagr: 12, stepUp: 10 });
  const [whatIf, setWhatIf] = useState(10000);
  const result = FE.sipCorpus(form.sip, form.years, form.cagr, form.stepUp);
  const whatIfResult = FE.sipCorpus(whatIf, form.years, form.cagr, form.stepUp);
  const mc = FE.monteCarlo(form.sip, form.years);
  const chartData = Array.from({ length: form.years }, (_, i) => FE.sipCorpus(form.sip, i + 1, form.cagr, form.stepUp).corpus);
  const whatIfChart = Array.from({ length: form.years }, (_, i) => FE.sipCorpus(whatIf, i + 1, form.cagr, form.stepUp).corpus);
  const diff = whatIfResult.corpus - result.corpus;

  const scenarios = [
    { label: "Current", sip: form.sip, corpus: result.corpus, risk: "Medium", riskColor: T.amber, retireAge: 52 },
    { label: `+₹${(whatIf - form.sip).toLocaleString("en-IN")} SIP`, sip: whatIf, corpus: whatIfResult.corpus, risk: "Medium", riskColor: T.amber, retireAge: whatIf > form.sip ? 50 : 54, highlight: whatIf > form.sip },
    { label: "Aggressive (15%)", sip: form.sip, corpus: FE.sipCorpus(form.sip, form.years, 15).corpus, risk: "High", riskColor: T.rose, retireAge: 49 },
  ];

  const Slider = (k, label, min, max, step = 1000) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={S.label}>{label}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: T.accentHover, fontFamily: "'JetBrains Mono', monospace" }}>
          {k === "cagr" || k === "stepUp" ? `${form[k]}%` : fmt.num(form[k])}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={form[k]}
        onChange={e => setForm(p => ({ ...p, [k]: +e.target.value }))} style={{ width: "100%" }} />
    </div>
  );

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>📈 SIP Wealth Engine</h2>
        <p style={{ color: T.textSub, fontSize: 14 }}>Monte Carlo simulations + live what-if scenarios</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 20 }}>
        <div>
          <div style={S.card}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Parameters</div>
            {Slider("sip", "Monthly SIP", 500, 100000)}
            {Slider("years", "Investment Period", 1, 40, 1)}
            {Slider("cagr", "Expected CAGR", 6, 20, 1)}
            {Slider("stepUp", "Annual Step-up", 0, 25, 1)}
          </div>
          {/* WHAT-IF SLIDER */}
          <div style={{ ...S.card, marginTop: 16, borderColor: T.accent + "44" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.accentHover, marginBottom: 4 }}>🎯 What-If Simulator</div>
            <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 12 }}>What if I increase my SIP?</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={S.label}>Simulated SIP</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: T.accent, fontFamily: "'JetBrains Mono', monospace" }}>{fmt.num(whatIf)}</span>
            </div>
            <input type="range" min={form.sip} max={form.sip * 4} step={500} value={whatIf}
              onChange={e => setWhatIf(+e.target.value)} style={{ width: "100%", marginBottom: 12 }} />
            {whatIf !== form.sip && (
              <div style={{ background: diff > 0 ? T.emeraldGlow : T.roseGlow, border: `1px solid ${diff > 0 ? T.emerald : T.rose}33`, borderRadius: 8, padding: 10, animation: "fadeSlideUp 0.3s ease" }}>
                <div style={{ fontSize: 11, color: diff > 0 ? T.emerald : T.rose, fontWeight: 700, marginBottom: 4 }}>
                  {diff > 0 ? "+" : ""}{fmt.cr(diff)} extra corpus
                </div>
                <div style={{ fontSize: 12, color: T.textSub }}>
                  Success rate: {FE.monteCarlo(whatIf, form.years, 200).successRate}% · Retire {Math.round(Math.abs(diff) / (50000 * 12))} years {diff > 0 ? "earlier" : "later"}
                </div>
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {[
              { label: "Projected Corpus", value: result.corpus, color: T.emerald },
              { label: "Total Invested", value: result.totalInvested, color: T.sky },
              { label: "Total Gains", value: result.gains, color: T.amber },
              { label: "Return Multiple", value: null, color: T.accentHover, display: `${(result.corpus / result.totalInvested).toFixed(1)}x` },
            ].map(m => (
              <div key={m.label} style={S.cardSm}>
                <div style={S.label}>{m.label}</div>
                <div style={{ fontSize: 19, fontWeight: 800, color: m.color, fontFamily: "'JetBrains Mono', monospace" }}>
                  {m.display || <AnimNum value={m.value} />}
                </div>
              </div>
            ))}
          </div>
          <div style={S.card}>
            <div style={{ fontSize: 13, color: T.textSub, marginBottom: 8, fontWeight: 600 }}>Growth Projection</div>
            <SparkLine multiLine={[
              { data: chartData, color: T.accent },
              ...(whatIf !== form.sip ? [{ data: whatIfChart, color: T.emerald }] : []),
            ]} height={80} />
            <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 10, height: 2, background: T.accent, borderRadius: 1 }} /><span style={{ fontSize: 11, color: T.textMuted }}>Current SIP</span></div>
              {whatIf !== form.sip && <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 10, height: 2, background: T.emerald, borderRadius: 1 }} /><span style={{ fontSize: 11, color: T.textMuted }}>What-if SIP</span></div>}
            </div>
          </div>
          <div style={S.card}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>📊 Scenario Comparison</div>
            <ScenarioTable scenarios={scenarios} />
          </div>
          <div style={{ ...S.card, borderColor: T.accent + "44" }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Monte Carlo (500 runs)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              {[
                { l: "Pessimistic (P10)", v: mc.p10, c: T.rose },
                { l: "Median (P50)", v: mc.median, c: T.amber },
                { l: "Optimistic (P90)", v: mc.p90, c: T.emerald },
              ].map(m => (
                <div key={m.l} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6 }}>{m.l}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: m.c, fontFamily: "'JetBrains Mono', monospace" }}>{fmt.cr(m.v)}</div>
                </div>
              ))}
            </div>
            <div style={{ textAlign: "center" }}><span style={S.pill(T.emerald)}>✓ {mc.successRate}% Success Rate</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── FIRE PAGE ──────────────────────────────────────────────────────
function FIREPage() {
  const [form, setForm] = useState({ age: 30, retireAge: 50, income: 100000, expenses: 55000, savings: 200000, sip: 10000 });
  const [whatIfSIP, setWhatIfSIP] = useState(10000);
  const years = form.retireAge - form.age;
  const target = FE.fireCorpus(form.expenses, years);
  const projected = FE.sipCorpus(form.sip, years).corpus + form.savings * Math.pow(1.1, years);
  const whatIfProjected = FE.sipCorpus(whatIfSIP, years).corpus + form.savings * Math.pow(1.1, years);
  const reqSIP = FE.requiredSIP(target - form.savings * Math.pow(1.1, years), years);
  const gap = projected - target;
  const gapColor = gap >= 0 ? T.emerald : T.rose;
  const chartData = Array.from({ length: years }, (_, i) => FE.sipCorpus(form.sip, i + 1).corpus);
  const whatIfChart = Array.from({ length: years }, (_, i) => FE.sipCorpus(whatIfSIP, i + 1).corpus);
  const Inp = (k, label) => (
    <div style={{ marginBottom: 14 }}>
      <label style={S.label}>{label}</label>
      <input type="number" value={form[k]} onChange={e => setForm(p => ({ ...p, [k]: +e.target.value }))} style={S.input} />
    </div>
  );
  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>🔥 FIRE Path Planner</h2>
        <p style={{ color: T.textSub, fontSize: 14 }}>Financial Independence, Retire Early — with live simulation</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20 }}>
        <div>
          <div style={S.card}>
            {Inp("age", "Current Age")}
            {Inp("retireAge", "Target Retire Age")}
            {Inp("income", "Monthly Income (₹)")}
            {Inp("expenses", "Monthly Expenses (₹)")}
            {Inp("savings", "Current Savings (₹)")}
            {Inp("sip", "Current Monthly SIP (₹)")}
          </div>
          {/* What-If Slider */}
          <div style={{ ...S.card, marginTop: 16, borderColor: T.accent + "44" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.accentHover, marginBottom: 12 }}>🎯 What-If: SIP Increase</div>
            <input type="range" min={form.sip} max={form.sip * 3} step={500} value={whatIfSIP}
              onChange={e => setWhatIfSIP(+e.target.value)} style={{ width: "100%" }} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              <span style={{ fontSize: 12, color: T.textMuted }}>New SIP:</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.accent, fontFamily: "'JetBrains Mono', monospace" }}>{fmt.num(whatIfSIP)}</span>
            </div>
            {whatIfSIP > form.sip && (
              <div style={{ marginTop: 10, fontSize: 13, color: T.emerald, animation: "fadeSlideUp 0.3s ease" }}>
                🎉 Retire {Math.round(Math.abs(whatIfProjected - projected) / (form.expenses * 12))} years earlier with {fmt.cr(whatIfProjected - projected)} more corpus
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { l: "FIRE Target", v: fmt.cr(target), c: T.amber },
              { l: "Projected Corpus", v: fmt.cr(Math.max(0, projected)), c: T.sky },
              { l: gap >= 0 ? "Surplus" : "Shortfall", v: fmt.cr(Math.abs(gap)), c: gapColor },
              { l: "Required SIP", v: fmt.num(reqSIP), c: T.accentHover },
            ].map(m => (
              <div key={m.l} style={{ ...S.cardSm, borderColor: m.c + "33" }}>
                <div style={S.label}>{m.l}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: m.c, fontFamily: "'JetBrains Mono', monospace" }}>{m.v}</div>
              </div>
            ))}
          </div>
          <div style={S.card}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Corpus Growth to Retirement</div>
            <SparkLine multiLine={[
              { data: chartData, color: T.accent },
              ...(whatIfSIP > form.sip ? [{ data: whatIfChart, color: T.emerald }] : []),
            ]} height={90} />
          </div>
          <div style={{ ...S.card, background: gap >= 0 ? T.emeraldGlow : T.roseGlow, borderColor: gapColor + "33" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: gapColor, marginBottom: 6 }}>
              {gap >= 0 ? "✅ You're on the FIRE path!" : "⚠️ Action Required"}
            </div>
            <div style={{ fontSize: 13, color: T.textSub, lineHeight: 1.7 }}>
              {gap >= 0
                ? `You'll reach ${fmt.cr(target)} by age ${form.retireAge}. With what-if SIP, you could retire ${Math.floor(Math.abs(gap) / (form.expenses * 12))} years earlier!`
                : `Increase SIP by ${fmt.num(reqSIP - form.sip)}/month to bridge the ${fmt.cr(Math.abs(gap))} gap and retire at ${form.retireAge}.`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── TAX PAGE ───────────────────────────────────────────────────────
function TaxPage() {
  const [form, setForm] = useState({ income: 1200000, ded80c: 150000, ded80d: 25000, hra: 120000, nps: 50000 });
  const oldDeductions = form.ded80c + form.ded80d + form.hra + form.nps + 50000;
  const oldTaxable = Math.max(0, form.income - oldDeductions);
  const oldTax = FE.taxOld(oldTaxable);
  const newTax = FE.taxNew(form.income);
  const saving = newTax - oldTax;
  const better = saving > 0 ? "OLD" : "NEW";
  const Inp = (k, label) => (
    <div style={{ marginBottom: 14 }}>
      <label style={S.label}>{label}</label>
      <input type="number" value={form[k]} onChange={e => setForm(p => ({ ...p, [k]: +e.target.value }))} style={S.input} />
    </div>
  );
  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>🧾 Tax Wizard</h2>
        <p style={{ color: T.textSub, fontSize: 14 }}>Old vs New regime — AI-powered tax optimization</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 20 }}>
        <div style={S.card}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Your Details</div>
          {Inp("income", "Annual Income (₹)")}
          {Inp("ded80c", "80C Investments (₹)")}
          {Inp("ded80d", "80D Health Insurance (₹)")}
          {Inp("hra", "HRA Exemption (₹)")}
          {Inp("nps", "NPS 80CCD(1B) (₹)")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ ...S.card, borderColor: T.amber + "44", background: T.amberGlow }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: T.amber, marginBottom: 4 }}>
              🏆 {better} Regime saves you {fmt.num(Math.abs(saving))} / year
            </div>
            <div style={{ fontSize: 13, color: T.textSub }}>That's {fmt.num(Math.round(Math.abs(saving) / 12))}/month extra — invest it!</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {[
              { name: "Old Regime", tax: oldTax, taxable: oldTaxable, deductions: oldDeductions, color: T.sky, active: better === "OLD" },
              { name: "New Regime", tax: newTax, taxable: Math.max(0, form.income - 75000), deductions: 75000, color: T.accentHover, active: better === "NEW" },
            ].map(r => (
              <div key={r.name} style={{ ...S.card, borderColor: r.active ? r.color + "88" : T.border, borderWidth: r.active ? 2 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{r.name}</span>
                  {r.active && <span style={S.pill(r.color)}>BETTER</span>}
                </div>
                {[
                  { l: "Deductions", v: fmt.num(r.deductions) },
                  { l: "Taxable Income", v: fmt.num(r.taxable) },
                  { l: "Tax + Cess", v: fmt.num(r.tax), bold: true, color: r.color },
                  { l: "Monthly Take-home", v: fmt.num(Math.round((form.income - r.tax) / 12)) },
                ].map(row => (
                  <div key={row.l} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${T.border}` }}>
                    <span style={{ fontSize: 13, color: T.textSub }}>{row.l}</span>
                    <span style={{ fontSize: 13, fontWeight: row.bold ? 800 : 500, color: row.color || T.text, fontFamily: row.bold ? "'JetBrains Mono', monospace" : "inherit" }}>{row.v}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div style={S.card}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Why this decision?</div>
            <div style={{ fontSize: 13, color: T.textSub, lineHeight: 1.8, padding: "10px 14px", background: T.bgCard, borderRadius: 8, borderLeft: `3px solid ${T.accent}` }}>
              {better === "OLD"
                ? `Your deductions total ${fmt.num(oldDeductions)} which lowers taxable income significantly. The old regime benefits people with high 80C/HRA/NPS investments. At ₹${(form.income / 100000).toFixed(1)}L income, maxing 80C saves ₹${fmt.num(Math.round(Math.abs(saving) / 3))}/year more.`
                : `Your deductions (${fmt.num(oldDeductions)}) are insufficient to offset the new regime's lower slab rates. Switch to new regime and invest the ₹${fmt.num(Math.abs(saving))} saved into ELSS for better long-term returns.`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── HEALTH PAGE ────────────────────────────────────────────────────
function HealthPage() {
  const [form, setForm] = useState({
    monthlyIncome: 80000, monthlyExpenses: 50000, monthlySavings: 15000,
    emergencyFund: 200000, annualIncome: 960000, insuranceCover: 5000000,
    emiAmount: 15000, taxSavings: 100000, hasSIP: true,
  });
  const result = FE.healthScore(form);
  const dims = [
    { key: "emergency", label: "Emergency Fund", target: "6 months expenses", color: T.sky },
    { key: "insurance", label: "Life Insurance", target: "10x annual income", color: T.emerald },
    { key: "debt", label: "Debt Health", target: "EMI < 30% income", color: T.amber },
    { key: "savings", label: "Savings Rate", target: "> 20% income", color: T.accentHover },
    { key: "tax", label: "Tax Efficiency", target: "Max 80C/80D", color: T.rose },
    { key: "invest", label: "Investment Activity", target: "Active SIP", color: T.violet },
  ];
  const grade = result.total >= 80 ? "A+" : result.total >= 65 ? "A" : result.total >= 50 ? "B" : result.total >= 35 ? "C" : "D";
  const gradeColor = result.total >= 80 ? T.emerald : result.total >= 65 ? T.amber : result.total >= 50 ? T.sky : result.total >= 35 ? "#F97316" : T.rose;
  const Inp = (k, label, type = "number") => (
    <div style={{ marginBottom: 12 }}>
      <label style={S.label}>{label}</label>
      {type === "bool"
        ? <div style={{ display: "flex", gap: 8 }}>
          {[true, false].map(v => (
            <button key={String(v)} onClick={() => setForm(p => ({ ...p, [k]: v }))}
              style={{ ...S.btn(form[k] === v), flex: 1, padding: "8px 0", justifyContent: "center" }}>
              {v ? "Yes" : "No"}
            </button>
          ))}
        </div>
        : <input type="number" value={form[k]} onChange={e => setForm(p => ({ ...p, [k]: +e.target.value }))} style={S.input} />}
    </div>
  );
  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>❤️ Financial Health Score</h2>
        <p style={{ color: T.textSub, fontSize: 14 }}>6-dimension SEBI-aligned assessment</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 20 }}>
        <div style={S.card}>{["monthlyIncome", "monthlyExpenses", "monthlySavings", "emergencyFund", "annualIncome", "insuranceCover", "emiAmount", "taxSavings"].map(k => Inp(k, k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()) + (["monthlyIncome", "monthlyExpenses", "monthlySavings", "annualIncome"].includes(k) ? " (₹)" : " (₹)")))}{Inp("hasSIP", "Active SIP?", "bool")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ ...S.card, display: "flex", alignItems: "center", gap: 24 }}>
            <Ring value={result.total} size={120} color={gradeColor} label="Score" />
            <div>
              <div style={{ fontSize: 52, fontWeight: 800, color: gradeColor, lineHeight: 1, fontFamily: "'Bricolage Grotesque', sans-serif" }}>{grade}</div>
              <div style={{ fontSize: 13, color: T.textSub, marginTop: 6 }}>
                {result.total >= 80 ? "Excellent! You're financially fit." : result.total >= 65 ? "Good. A few gaps to fill." : result.total >= 50 ? "Average. Action needed." : "Urgent fixes required."}
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {dims.map(d => {
              const v = Math.round(result.breakdown[d.key]);
              return (
                <div key={d.key} style={S.cardSm}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{d.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: v >= 70 ? T.emerald : v >= 40 ? T.amber : T.rose, fontFamily: "'JetBrains Mono', monospace" }}>{v}/100</span>
                  </div>
                  <div style={{ height: 5, background: T.bgCard3, borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${v}%`, background: v >= 70 ? T.emerald : v >= 40 ? T.amber : T.rose, borderRadius: 3, transition: "width 0.6s ease", transformOrigin: "left" }} />
                  </div>
                  <div style={{ fontSize: 11, color: T.textMuted, marginTop: 5 }}>Target: {d.target}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── DASHBOARD ──────────────────────────────────────────────────────
function Dashboard({ onNav }) {
  const sipData = Array.from({ length: 10 }, (_, i) => FE.sipCorpus(10000, i + 1).corpus);
  const decisions = [
    {
      title: "Increase Monthly SIP",
      current: "₹10,000/mo",
      recommended: "₹12,500/mo",
      impacts: ["₹32L more corpus in 20 years", "Retire 2 years earlier at age 48", "FIRE success rate: 72% → 89%"],
      explanation: "Your savings rate is 18.7% — below the 25% benchmark. A ₹2,500 SIP increase leverages compounding to generate outsized returns over 20 years."
    }
  ];
  const alerts = [
    { icon: "⚠️", title: "Spending Alert", message: "You spent 40% more on food this week — that's ₹3,200 extra vs your monthly average.", action: "Redirect ₹2,000 to SIP this month", color: T.amber },
    { icon: "📉", title: "Market Dip Detected", message: "Nifty is down 3.2% this week — historically, SIP during dips generates 15-20% better returns.", action: "Consider lump-sum of ₹5,000 in index fund", color: T.sky },
    { icon: "🔔", title: "Tax Deadline", message: "Only 47 days left for 80C investments. You have ₹50,000 gap to fill.", action: "Invest in ELSS before March 31st", color: T.rose },
  ];
  const nudges = [
    { icon: "📈", message: "Market dip detected — invest ₹3,000 now for 18% better entry point" },
    { icon: "💡", message: "Salary credited! Ideal time to step-up SIP by ₹500" },
    { icon: "🔄", message: "Portfolio rebalancing due — equity allocation is 78% (target: 70%)" },
    { icon: "🏦", message: "Emergency fund at 3.2 months. Top up ₹15,000 to reach 6-month safety net" },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Your Financial Command Center</h2>
        <p style={{ color: T.textSub, fontSize: 14 }}>AI-driven decisions · Behavioral alerts · Live portfolio intelligence</p>
      </div>
      {/* Top metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
        {[
          { label: "Net Worth", value: "₹12.4L", change: "+8.2%", color: T.emerald, sparkData: [8, 9, 10, 10.5, 11, 11.8, 12.4].map(v => v * 100000) },
          { label: "Monthly SIP", value: "₹10,000", change: "Active", color: T.sky, sparkData: [8, 8.5, 9, 9, 10, 10, 10].map(v => v * 1000) },
          { label: "Tax Saved", value: "₹45,000", change: "This FY", color: T.amber, sparkData: [10, 15, 20, 28, 35, 40, 45].map(v => v * 1000) },
          { label: "Health Score", value: "72/100", change: "Grade A", color: T.accentHover, sparkData: [55, 58, 62, 65, 67, 70, 72] },
        ].map(m => (
          <div key={m.label} style={S.cardSm}>
            <div style={S.label}>{m.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: m.color, marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>{m.value}</div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 8 }}>{m.change}</div>
            <SparkLine data={m.sparkData} color={m.color} height={30} />
          </div>
        ))}
      </div>
      {/* Smart Nudge */}
      <div style={{ marginBottom: 16 }}>
        <SmartNudge nudges={nudges} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Decision Engine */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.textSub, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1, fontSize: 11 }}>🧠 Decision Engine</div>
          {decisions.map((d, i) => <DecisionCard key={i} decision={d} onApply={() => { }} onSimulate={() => onNav("sip")} />)}
        </div>
        {/* Behavioral Alerts */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textSub, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>⚠️ Behavioral Alerts</div>
          <BehavioralAlert alerts={alerts} />
        </div>
      </div>
      {/* SIP chart + Quick nav */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={S.card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>SIP → Wealth Growth (10Y)</div>
          <SparkLine data={sipData} color={T.accent} height={80} />
          <div style={{ fontSize: 12, color: T.textSub, marginTop: 8 }}>₹10K/month → {fmt.cr(sipData[9])} in 10 years @ 12% CAGR</div>
        </div>
        <div style={S.card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Quick Actions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { icon: "🔥", label: "Plan FIRE path", id: "fire" },
              { icon: "📊", label: "Portfolio intelligence", id: "portfolio" },
              { icon: "📅", label: "Life timeline", id: "timeline" },
              { icon: "💑", label: "Couple mode", id: "couple" },
            ].map(a => (
              <button key={a.id} onClick={() => onNav(a.id)}
                style={{ ...S.btn(false), display: "flex", alignItems: "center", gap: 10, textAlign: "left", padding: "10px 14px", width: "100%" }}>
                <span style={{ fontSize: 15 }}>{a.icon}</span><span>{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── CHAT PAGE ──────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are ET Saathi, an elite AI Financial Decision Engine for Indian investors. Sharp, witty, occasionally roast-y, but deeply knowledgeable.

You have: FIRE planning, SIP simulations, Tax regime comparison, Money Health Score, Behavioral finance, Scenario simulation, MPT portfolio optimization, Tax-loss harvesting, Goal-based investing.

When users share data: 1) Calculate specific ₹ numbers 2) Compare scenarios 3) Show 5/10/20Y impact 4) Give ONE clear action

Indian context: ₹, 80C/80D, NPS, ELSS, SIP, CAGR, XIRR
Tone: Confident, witty, direct. Always end with a specific ₹ recommendation.
Keep responses concise but data-rich.`;

const QUICK_ACTIONS = [
  { icon: "🔥", label: "FIRE Number", prompt: "Help me calculate my FIRE number for early retirement." },
  { icon: "💰", label: "SIP Optimize", prompt: "Simulate my SIP growth and optimize my wealth strategy." },
  { icon: "🧾", label: "Tax Wizard", prompt: "Compare old vs new tax regime and find maximum savings." },
  { icon: "📊", label: "Portfolio Review", prompt: "Review my portfolio and suggest MPT-based optimization." },
  { icon: "😂", label: "Roast Budget", prompt: "Roast my spending habits and tell me exactly where I'm wasting money!" },
  { icon: "🎯", label: "Goal Planner", prompt: "I have a financial goal. Calculate the SIP needed to reach it." },
];

function ChatPage({ onOpenSettings }) {
  const { apiKey } = useApiKey();
  const [messages, setMessages] = useState([{
    role: "assistant",
    content: "Namaste! 🙏 I'm ET Saathi — your AI Financial Decision Engine.\n\nI calculate, simulate, and optimize your money with real ₹ numbers. Not vague advice — actual decisions.\n\n• FIRE number calculation\n• Tax regime comparison\n• Portfolio optimization (MPT)\n• Roast your spending 😄\n• What-if simulations\n\nWhat financial decision can I help you make today?"
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = useCallback(async (text) => {
    const userMsg = text || input.trim();
    if (!userMsg || loading) return;
    if (!apiKey) { onOpenSettings?.(); return; }
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);
    try {
      const history = messages.slice(-12).map(m => ({ role: m.role, content: m.content }));

      let reply = "";
      if (apiKey.startsWith("AIza")) { // Google Gemini
        const geminiHistory = history.map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }]
        }));
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: { text: SYSTEM_PROMPT } },
            contents: [...geminiHistory, { role: "user", parts: [{ text: userMsg }] }]
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
      } else if (apiKey.startsWith("sk-proj-") || (apiKey.startsWith("sk-") && !apiKey.startsWith("sk-ant-"))) { // OpenAI
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
          body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history, { role: "user", content: userMsg }] }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        reply = data.choices?.[0]?.message?.content;
      } else { // Anthropic / Default
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
          body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1000, system: SYSTEM_PROMPT, messages: [...history, { role: "user", content: userMsg }] }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        reply = data.content?.map(b => b.text || "").join("");
      }

      setMessages(prev => [...prev, { role: "assistant", content: reply || "Something went wrong." }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `❌ Error: ${err.message}` }]);
    } finally { setLoading(false); }
  }, [input, loading, messages, apiKey, onOpenSettings]);

  const formatMsg = (text) => text.split("\n").map((line, i) => {
    if (!line) return <br key={i} />;
    const html = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>');
    return <div key={i} style={{ marginBottom: 3, lineHeight: 1.65 }} dangerouslySetInnerHTML={{ __html: html }} />;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 56px)" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "24px", display: "flex", flexDirection: "column", gap: 14 }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === "user" ? "flex-end" : "flex-start",
            background: m.role === "user" ? T.accent : T.bgCard2,
            border: m.role === "user" ? "none" : `1px solid ${T.border}`,
            borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "4px 18px 18px 18px",
            padding: "12px 16px", maxWidth: "80%", fontSize: 14, lineHeight: 1.6,
            animation: "fadeSlideUp 0.3s ease both",
          }}>
            {m.role === "assistant" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: T.gradient, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800 }}>ET</div>
                <span style={{ fontSize: 11, fontWeight: 700, color: T.accentHover, letterSpacing: 0.3 }}>ET Saathi</span>
              </div>
            )}
            {formatMsg(m.content)}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: "flex-start", background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: "4px 18px 18px 18px", padding: "14px 16px" }}>
            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
              {[0, 1, 2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: T.accent, animation: `bounce 1.2s ${i * 0.2}s infinite` }} />)}
              <span style={{ fontSize: 12, color: T.textMuted, marginLeft: 6 }}>Computing your numbers...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {!apiKey && (
        <div style={{ margin: "0 24px 8px", background: T.amberGlow, border: `1px solid ${T.amber}33`, borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.amber, marginBottom: 2 }}>🔑 API Key Required for AI Chat</div>
            <div style={{ fontSize: 12, color: T.textMuted }}>All calculators work without a key.</div>
          </div>
          <button onClick={() => onOpenSettings?.()} style={{ ...S.btn(true), padding: "8px 16px", fontSize: 13 }}>Add Key →</button>
        </div>
      )}
      <div style={{ padding: "6px 24px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        {QUICK_ACTIONS.map(a => (
          <button key={a.label} onClick={() => send(a.prompt)} style={{ ...S.btn(false), padding: "5px 12px", fontSize: 12, gap: 5 }}>
            <span>{a.icon}</span>{a.label}
          </button>
        ))}
      </div>
      <div style={{ padding: "12px 24px", borderTop: `1px solid ${T.border}`, background: T.bgCard }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", background: T.bgCard2, border: `1px solid ${T.border}`, borderRadius: 14, padding: "10px 14px" }}>
          <textarea value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={apiKey ? "Ask anything... 'What if I invest ₹5K more?' or 'Roast my budget'" : "Add Anthropic API key to enable AI chat →"}
            rows={1} style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: T.text, fontSize: 14, resize: "none", fontFamily: "inherit", minHeight: 24, maxHeight: 120 }} />
          <button onClick={() => send()} disabled={!input.trim() || loading}
            style={{ width: 36, height: 36, borderRadius: 9, border: "none", background: T.accent, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: !input.trim() || loading ? 0.4 : 1, transition: "all 0.2s" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
          </button>
        </div>
        <div style={{ fontSize: 11, color: T.textMuted, textAlign: "center", marginTop: 8 }}>ET Saathi · Powered by Claude AI · For educational purposes only</div>
      </div>
    </div>
  );
}

// ── SETTINGS MODAL ─────────────────────────────────────────────────
function SettingsModal({ onClose }) {
  const { apiKey, setApiKey } = useApiKey();
  const [draft, setDraft] = useState(apiKey);
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = () => {
    const t = draft.trim(); setApiKey(t);
    try { localStorage.setItem("et_saathi_api_key", t); } catch { }
    setSaved(true); setTimeout(() => { setSaved(false); onClose(); }, 800);
  };
  const isValid = draft.trim().length > 0;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 20, padding: 28, width: "100%", maxWidth: 460, boxShadow: "0 24px 80px rgba(0,0,0,0.7)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>API Settings</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, fontSize: 22 }}>×</button>
        </div>
        <div style={{ background: T.skyGlow, border: `1px solid ${T.sky}33`, borderRadius: 10, padding: 12, marginBottom: 20, fontSize: 13, color: T.textSub, lineHeight: 1.6 }}>
          Key stored only in <strong style={{ color: T.text }}>your browser</strong>. Never sent to any server other than Anthropic.
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={S.label}>API Key</label>
          <div style={{ position: "relative" }}>
            <input type={show ? "text" : "password"} value={draft} onChange={e => setDraft(e.target.value)} placeholder="API Key..." style={{ ...S.input, paddingRight: 50, fontFamily: show ? "'JetBrains Mono', monospace" : "inherit", fontSize: 13 }} />
            <button onClick={() => setShow(s => !s)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: T.textMuted, fontSize: 12 }}>{show ? "Hide" : "Show"}</button>
          </div>
          {isValid && <div style={{ fontSize: 12, color: T.emerald, marginTop: 6 }}>✓ Key provided</div>}
        </div>
        {apiKey && <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, padding: "8px 12px", background: T.emeraldGlow, border: `1px solid ${T.emerald}33`, borderRadius: 8 }}><div style={{ width: 7, height: 7, borderRadius: "50%", background: T.emerald }} /><span style={{ fontSize: 12, color: T.emerald }}>AI chat enabled</span></div>}
        <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 20 }}>Don't have a key? <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" style={{ color: T.accentHover, textDecoration: "none" }}>Get one at console.anthropic.com →</a></div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={save} disabled={!draft.trim()} style={{ ...S.btn(true), flex: 1, padding: "12px 0", justifyContent: "center", opacity: !draft.trim() ? 0.5 : 1 }}>{saved ? "✓ Saved!" : "Save Key"}</button>
          <button onClick={onClose} style={{ ...S.btn(false), padding: "12px 16px" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── NAV ────────────────────────────────────────────────────────────
const NAV = [
  { id: "chat", icon: "💬", label: "AI Mentor" },
  { id: "dashboard", icon: "⚡", label: "Dashboard" },
  { id: "portfolio", icon: "📊", label: "Portfolio" },
  { id: "sip", icon: "📈", label: "SIP Engine" },
  { id: "fire", icon: "🔥", label: "FIRE Planner" },
  { id: "tax", icon: "🧾", label: "Tax Wizard" },
  { id: "health", icon: "❤️", label: "Health Score" },
  { id: "timeline", icon: "📅", label: "Life Timeline" },
  { id: "couple", icon: "💑", label: "Couple Mode" },
];

// ── MAIN APP ───────────────────────────────────────────────────────
export default function App() {
  const [nav, setNav] = useState("dashboard");
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState(() => { try { return localStorage.getItem("et_saathi_api_key") || ""; } catch { return ""; } });

  const pages = { chat: ChatPage, dashboard: Dashboard, sip: SIPPage, fire: FIREPage, tax: TaxPage, health: HealthPage, timeline: TimelinePage, couple: CouplePage, portfolio: PortfolioPage };
  const Page = pages[nav] || Dashboard;
  const navItem = NAV.find(n => n.id === nav);

  return (
    <ApiKeyContext.Provider value={{ apiKey, setApiKey }}>
      <style>{GLOBAL_CSS}</style>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      <div style={S.app}>
        {/* Sidebar */}
        <div style={S.sidebar}>
          {/* Logo */}
          <div style={{ padding: "20px 16px 16px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: T.gradient, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, boxShadow: `0 4px 16px ${T.accentGlow}`, animation: "float 3s ease-in-out infinite" }}>💰</div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: -0.5 }}>ET Saathi</div>
                <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 600, letterSpacing: 0.8 }}>AI MONEY MENTOR</div>
              </div>
            </div>
          </div>
          {/* Nav */}
          <div style={{ flex: 1, padding: "10px 0", overflowY: "auto" }}>
            {NAV.map(item => (
              <div key={item.id} style={S.navItem(nav === item.id)} onClick={() => setNav(item.id)}>
                <span style={{ fontSize: 15 }}>{item.icon}</span>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          {/* Bottom */}
          <div style={{ padding: "12px 8px", borderTop: `1px solid ${T.border}` }}>
            <button onClick={() => setShowSettings(true)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10,
              background: apiKey ? T.emeraldGlow : T.amberGlow,
              border: `1px solid ${apiKey ? T.emerald + "33" : T.amber + "33"}`,
              cursor: "pointer", width: "100%",
            }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: apiKey ? T.emerald : T.amber, flexShrink: 0, animation: apiKey ? "pulse 2s infinite" : "none" }} />
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: apiKey ? T.emerald : T.amber }}>{apiKey ? "AI Connected" : "Add API Key"}</div>
                <div style={{ fontSize: 10, color: T.textMuted }}>{apiKey ? "Claude active" : "For AI chat"}</div>
              </div>
            </button>
            <div style={{ background: T.accentGlow, border: `1px solid ${T.accent}22`, borderRadius: 8, padding: "8px 10px", marginTop: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.accentHover }}>ET Hackathon 2026</div>
              <div style={{ fontSize: 10, color: T.textMuted }}>Problem 9 · AI Money Mentor</div>
            </div>
          </div>
        </div>
        {/* Main */}
        <div style={S.main}>
          <div style={S.header}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              {navItem?.icon} {navItem?.label}
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              <span style={S.pill(apiKey ? T.emerald : T.amber)}>{apiKey ? "● AI Active" : "○ No Key"}</span>
              <button onClick={() => setShowSettings(true)} style={{ ...S.btn(false), padding: "5px 12px", fontSize: 12, gap: 5 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                Settings
              </button>
            </div>
          </div>
          {nav === "chat" ? <ChatPage onOpenSettings={() => setShowSettings(true)} />
            : nav === "dashboard" ? <Dashboard onNav={setNav} />
              : <Page />}
        </div>
      </div>
    </ApiKeyContext.Provider>
  );
}
