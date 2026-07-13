/* Chaindump dashboard — app shell: grouped left rail, top bar, view switch. */
const { LiveView, MidView, GraveyardView, NftView, StablesView, RwaView, InfraView, MarketsView, GeoView, PolicyView, NewsView, AgentView } = window.KITViews;

const NAV = [
  { group: 'Chains', items: [{ v: 'live', ico: '◧', label: 'Live · Top 50' }, { v: 'mid', ico: '◐', label: 'Stuck / Mid' }, { v: 'grave', ico: '✕', label: 'Graveyard' }] },
  { group: 'Assets', items: [{ v: 'nft', ico: '◆', label: 'NFTs & Ordinals' }, { v: 'stables', ico: '$', label: 'Stablecoins' }, { v: 'rwa', ico: '▣', label: 'RWA · DePIN' }, { v: 'infra', ico: '⛁', label: 'Storage / Verify' }] },
  { group: 'Markets', items: [{ v: 'markets', ico: '▤', label: 'Treasuries · ETFs' }] },
  { group: 'World', items: [{ v: 'geo', ico: '◍', label: 'Global Adoption' }, { v: 'uspolicy', ico: '⬡', label: 'US Policy Map' }] },
  { group: 'Signal', items: [{ v: 'news', ico: '≋', label: 'News' }] },
  { group: 'Agents', items: [{ v: 'api', ico: '⌘', label: 'Agent API' }] },
];
const VIEWS = { live: LiveView, mid: MidView, grave: GraveyardView, nft: NftView, stables: StablesView, rwa: RwaView, infra: InfraView, markets: MarketsView, geo: GeoView, uspolicy: PolicyView, news: NewsView, api: AgentView };

function App() {
  const [view, setView] = React.useState('live');
  const [rail, setRail] = React.useState(false);
  const Active = VIEWS[view];
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* top bar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, height: 52, display: 'flex', alignItems: 'center', gap: 16,
        padding: '0 16px', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)' }}>
        <button onClick={() => setRail((r) => !r)} style={{ background: 'none', border: 'none', color: 'var(--text-lo)', fontSize: 16, cursor: 'pointer', padding: 4 }} aria-label="Toggle rail">☰</button>
        <img src="../../assets/logo/chaindump-mark-onDark.svg" width="24" height="24" alt="" style={{ display: 'block' }} />
        <div style={{ font: '800 16px/1 var(--font-ui)', letterSpacing: '-.02em', color: 'var(--text-hi)' }}>Chaindump<span style={{ color: 'var(--accent)' }}>.</span></div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 12px',
          background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', color: 'var(--text-lo)', font: '400 12px/1 var(--font-ui)' }}>
          Search… <kbd style={{ font: '600 10px/1 var(--font-mono)', color: 'var(--text-faint)', border: '1px solid var(--border)', padding: '2px 4px', borderRadius: 3 }}>⌘K</kbd>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: '400 12px/1 var(--font-ui)', color: 'var(--text-lo)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 2.4s ease-out infinite' }} />live
        </div>
      </div>
      <div style={{ display: 'flex' }}>
        {/* rail */}
        <aside style={{ position: 'sticky', top: 52, alignSelf: 'flex-start', height: 'calc(100vh - 52px)',
          width: rail ? 56 : 232, flex: `0 0 ${rail ? 56 : 232}px`, background: 'var(--bg-subtle)',
          borderRight: '1px solid var(--border)', overflowY: 'auto', transition: 'width .18s, flex-basis .18s' }}>
          <nav style={{ display: 'flex', flexDirection: 'column', paddingTop: 6 }}>
            {NAV.map((g, gi) => (
              <div key={g.group} style={{ padding: '6px 0', borderTop: gi ? '1px solid var(--border)' : 'none' }}>
                {!rail && <div style={{ font: '700 10.5px/1 var(--font-ui)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-lo)', opacity: .65, padding: '8px 16px 4px' }}>{g.group}</div>}
                {g.items.map((it) => {
                  const on = view === it.v;
                  return (
                    <button key={it.v} onClick={() => setView(it.v)} title={it.label}
                      style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', background: on ? 'var(--accent-bg)' : 'none',
                        border: 'none', cursor: 'pointer', padding: rail ? '9px 0' : '7px 16px', justifyContent: rail ? 'center' : 'flex-start',
                        color: on ? 'var(--text-hi)' : 'var(--text-lo)', font: '500 13px/1 var(--font-ui)', letterSpacing: '-.01em',
                        textAlign: 'left', borderLeft: `2px solid ${on ? 'var(--accent)' : 'transparent'}`, transition: 'color .12s, background .12s' }}>
                      <span style={{ width: 18, flex: '0 0 18px', textAlign: 'center', fontSize: 14, color: on ? 'var(--accent)' : 'inherit' }}>{it.ico}</span>
                      {!rail && <span>{it.label}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>
        {/* main */}
        <main style={{ flex: 1, minWidth: 0, padding: '32px clamp(16px,3vw,32px) 64px' }}>
          <div style={{ maxWidth: 1360, margin: '0 auto' }}><Active /></div>
        </main>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);


/* --- views --- */

/* @ds-bundle: {"format":4,"namespace":"ChaindumpDesignSystem_8bb35e","components":[{"name":"DeltaValue","sourcePath":"components/data/DeltaValue.jsx"},{"name":"KpiTile","sourcePath":"components/data/KpiTile.jsx"},{"name":"KpiRow","sourcePath":"components/data/KpiTile.jsx"},{"name":"Sparkline","sourcePath":"components/data/Sparkline.jsx"},{"name":"VerdictPill","sourcePath":"components/data/VerdictPill.jsx"},{"name":"Badge","sourcePath":"components/feedback/Badge.jsx"},{"name":"Button","sourcePath":"components/forms/Button.jsx"},{"name":"SearchInput","sourcePath":"components/forms/SearchInput.jsx"},{"name":"SegmentedControl","sourcePath":"components/forms/SegmentedControl.jsx"},{"name":"Card","sourcePath":"components/surfaces/Card.jsx"},{"name":"CardTitle","sourcePath":"components/surfaces/Card.jsx"},{"name":"CardMeta","sourcePath":"components/surfaces/Card.jsx"},{"name":"CardStat","sourcePath":"components/surfaces/Card.jsx"},{"name":"Panel","sourcePath":"components/surfaces/Panel.jsx"}],"sourceHashes":{"components/data/DeltaValue.jsx":"645863237a3f","components/data/KpiTile.jsx":"ce5c4b770978","components/data/Sparkline.jsx":"9c62d71178fe","components/data/VerdictPill.jsx":"eb23e633c673","components/feedback/Badge.jsx":"de3470a83cf6","components/forms/Button.jsx":"e90e0884cdf7","components/forms/SearchInput.jsx":"0b942dbdddd3","components/forms/SegmentedControl.jsx":"4b65d17d9e29","components/surfaces/Card.jsx":"e4ba9ac9afe5","components/surfaces/Panel.jsx":"c6480274873a","ui_kits/dashboard/app.jsx":"9d556dfc25df","ui_kits/dashboard/data.js":"20aa3a4b1f80","ui_kits/dashboard/views.jsx":"9fee7313bca7"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.ChaindumpDesignSystem_8bb35e = window.ChaindumpDesignSystem_8bb35e || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/data/DeltaValue.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * DeltaValue — a signed percentage with an up/down triangle, mono + tabular.
 * chip=true wraps it in a tinted pill (table/row use); chip=false is inline text.
 */
function DeltaValue({
  value,
  chip = false,
  digits = 1,
  style,
  ...rest
}) {
  if (value == null || isNaN(value)) return /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-faint)',
      ...style
    }
  }, "\u2014");
  const up = value >= 0;
  const color = up ? 'var(--up)' : 'var(--down)';
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      font: '600 11px/1 var(--font-mono)',
      fontVariantNumeric: 'tabular-nums',
      color,
      ...(chip ? {
        background: up ? 'var(--up-bg)' : 'var(--down-bg)',
        padding: '2px 5px',
        borderRadius: 'var(--r-xs)'
      } : {}),
      ...style
    }
  }, rest), up ? '▲' : '▼', " ", Math.abs(value).toFixed(digits), "%");
}
Object.assign(__ds_scope, { DeltaValue });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/DeltaValue.jsx", error: String((e && e.message) || e) }); }

// components/data/KpiTile.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * KpiTile — the atomic unit of "Scan": uppercase label + big mono value,
 * optional delta chip. Consistent everywhere so the eye learns it once.
 */
function KpiTile({
  label,
  value,
  unit,
  delta,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      padding: 'var(--s-4)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: '600 20px/1 var(--font-mono)',
      color: 'var(--text-hi)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, value, unit && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-faint)',
      fontWeight: 400,
      marginLeft: 2
    }
  }, unit)), delta != null && /*#__PURE__*/React.createElement(DeltaChip, {
    value: delta
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6,
      font: '600 11px/1 var(--font-ui)',
      textTransform: 'uppercase',
      letterSpacing: '.08em',
      color: 'var(--text-lo)'
    }
  }, label));
}
function DeltaChip({
  value
}) {
  const up = value >= 0;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      font: '600 11px/1 var(--font-mono)',
      fontVariantNumeric: 'tabular-nums',
      color: up ? 'var(--up)' : 'var(--down)',
      background: up ? 'var(--up-bg)' : 'var(--down-bg)',
      padding: '2px 5px',
      borderRadius: 'var(--r-xs)'
    }
  }, up ? '▲' : '▼', " ", Math.abs(value).toFixed(1), "%");
}

/**
 * KpiRow — hairline-separated strip of KpiTiles (no card blobs between them).
 */
function KpiRow({
  children,
  style
}) {
  const items = React.Children.toArray(children);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-md)',
      overflow: 'clip',
      ...style
    }
  }, items.map((c, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      borderRight: i < items.length - 1 ? '1px solid var(--border)' : 'none'
    }
  }, c)));
}
Object.assign(__ds_scope, { KpiTile, KpiRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/KpiTile.jsx", error: String((e && e.message) || e) }); }

// components/data/Sparkline.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Sparkline — a compact inline trend. Amber stroke by default, or auto
 * up/down semantic color. Optional faint area fill. No axes, no neon.
 */
function Sparkline({
  values = [],
  width = 88,
  height = 24,
  pad = 3,
  color,
  area = true,
  autoColor = false,
  style,
  ...rest
}) {
  if (!values || values.length < 2) return /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-faint)'
    }
  }, "\u2014");
  const min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) max = min + 1;
  const nx = i => pad + i / (values.length - 1) * (width - 2 * pad);
  const ny = v => height - pad - (v - min) / (max - min) * (height - 2 * pad);
  const pts = values.map((v, i) => [nx(i), ny(v)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const up = values[values.length - 1] >= values[0];
  const stroke = color || (autoColor ? up ? 'var(--up)' : 'var(--down)' : 'var(--accent)');
  const [ex, ey] = pts[pts.length - 1];
  return /*#__PURE__*/React.createElement("svg", _extends({
    width: width,
    height: height,
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": "trend",
    style: style
  }, rest), area && /*#__PURE__*/React.createElement("path", {
    d: `${line} L${width - pad} ${height} L${pad} ${height} Z`,
    fill: stroke,
    fillOpacity: "0.12"
  }), /*#__PURE__*/React.createElement("path", {
    d: line,
    fill: "none",
    stroke: stroke,
    strokeWidth: "1.5",
    strokeLinejoin: "round",
    strokeLinecap: "round"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: ex,
    cy: ey,
    r: "1.8",
    fill: stroke
  }));
}
Object.assign(__ds_scope, { Sparkline });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Sparkline.jsx", error: String((e && e.message) || e) }); }

// components/data/VerdictPill.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * VerdictPill — the triage signal. ● Healthy / ◐ Watch / ○ Risk / ✕ Dead.
 * Shown as a bare dot in a row, dot+word in a detail header.
 */
function VerdictPill({
  status = 'ok',
  showLabel = true,
  style,
  ...rest
}) {
  const map = {
    ok: {
      glyph: '●',
      label: 'Healthy',
      color: 'var(--up)'
    },
    watch: {
      glyph: '◐',
      label: 'Watch',
      color: 'var(--warn)'
    },
    risk: {
      glyph: '○',
      label: 'Risk',
      color: 'var(--down)'
    },
    dead: {
      glyph: '✕',
      label: 'Dead',
      color: 'var(--dead)'
    }
  };
  const v = map[status] || map.ok;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      font: '600 12px/1 var(--font-ui)',
      color: v.color,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      fontSize: 10
    }
  }, v.glyph), showLabel && v.label);
}
Object.assign(__ds_scope, { VerdictPill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/VerdictPill.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Badge — outline status label with a leading dot. Signals do the heavy
 * lifting; badges are outlined, not filled blobs.
 * tone: neutral | live | up | down | warn | dead
 */
function Badge({
  tone = 'neutral',
  pulse = false,
  children,
  style,
  ...rest
}) {
  const tones = {
    neutral: {
      color: 'var(--text-lo)',
      border: 'var(--border-strong)',
      bg: 'var(--surface-1)'
    },
    live: {
      color: 'var(--accent)',
      border: 'var(--accent-line)',
      bg: 'var(--accent-bg)'
    },
    up: {
      color: 'var(--up)',
      border: 'color-mix(in srgb, var(--up) 40%, transparent)',
      bg: 'var(--up-bg)'
    },
    down: {
      color: 'var(--down)',
      border: 'color-mix(in srgb, var(--down) 40%, transparent)',
      bg: 'var(--down-bg)'
    },
    warn: {
      color: 'var(--warn)',
      border: 'color-mix(in srgb, var(--warn) 40%, transparent)',
      bg: 'var(--warn-bg)'
    },
    dead: {
      color: 'var(--dead)',
      border: 'var(--border-strong)',
      bg: 'var(--bg-subtle)'
    }
  };
  const t = tones[tone] || tones.neutral;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '3px 8px',
      borderRadius: 'var(--r-xs)',
      font: '600 10px/1 var(--font-ui)',
      textTransform: 'uppercase',
      letterSpacing: '.06em',
      border: `1px solid ${t.border}`,
      color: t.color,
      background: t.bg,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 5,
      height: 5,
      borderRadius: '50%',
      background: 'currentColor',
      animation: pulse ? 'pulse 2s ease-out infinite' : 'none'
    },
    "aria-hidden": "true"
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Badge.jsx", error: String((e && e.message) || e) }); }

// components/forms/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Button — the one primary control. Flat, tactile, hairline-bordered.
 * Variants: primary (filled amber), secondary (default), ghost.
 */
function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  disabled = false,
  type = 'button',
  onClick,
  children,
  style,
  ...rest
}) {
  const heights = {
    sm: 28,
    md: 34,
    lg: 40
  };
  const pads = {
    sm: '0 10px',
    md: '0 14px',
    lg: '0 18px'
  };
  const fs = {
    sm: 12,
    md: 13,
    lg: 14
  };
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: heights[size],
    padding: pads[size],
    borderRadius: 'var(--r-sm)',
    font: `${variant === 'primary' ? 600 : 500} ${fs[size]}px/1 var(--font-ui)`,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    border: '1px solid var(--border-strong)',
    color: 'var(--text)',
    background: 'var(--surface-2)',
    transition: 'background .14s, border-color .14s, color .14s, transform .06s',
    whiteSpace: 'nowrap',
    ...style
  };
  const variants = {
    primary: {
      background: 'var(--accent)',
      borderColor: 'var(--accent)',
      color: 'var(--accent-ink)'
    },
    secondary: {},
    ghost: {
      background: 'transparent',
      borderColor: 'transparent',
      color: 'var(--text-lo)'
    }
  };
  const hoverIn = e => {
    if (disabled) return;
    if (variant === 'primary') {
      e.currentTarget.style.background = 'var(--accent-hi)';
      e.currentTarget.style.borderColor = 'var(--accent-hi)';
    } else if (variant === 'ghost') {
      e.currentTarget.style.background = 'var(--surface-1)';
      e.currentTarget.style.color = 'var(--text-hi)';
    } else {
      e.currentTarget.style.background = 'var(--surface-3)';
      e.currentTarget.style.borderColor = 'var(--border-lit)';
      e.currentTarget.style.color = 'var(--text-hi)';
    }
  };
  const hoverOut = e => {
    const v = variants[variant];
    e.currentTarget.style.background = v.background || 'var(--surface-2)';
    e.currentTarget.style.borderColor = v.borderColor || 'var(--border-strong)';
    e.currentTarget.style.color = v.color || (variant === 'ghost' ? 'var(--text-lo)' : 'var(--text)');
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    onClick: onClick,
    style: {
      ...base,
      ...variants[variant]
    },
    onMouseEnter: hoverIn,
    onMouseLeave: hoverOut,
    onMouseDown: e => !disabled && (e.currentTarget.style.transform = 'translateY(1px)'),
    onMouseUp: e => e.currentTarget.style.transform = 'translateY(0)'
  }, rest), icon && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: fs[size] + 2,
      lineHeight: 1
    },
    "aria-hidden": "true"
  }, icon), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Button.jsx", error: String((e && e.message) || e) }); }

// components/forms/SearchInput.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * SearchInput — the command-line-feel filter box. Hairline border,
 * amber focus ring, optional leading glyph and ⌘K hint.
 */
function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  icon = '⌕',
  kbd,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      height: 36,
      padding: '0 12px',
      width: '100%',
      maxWidth: 280,
      background: 'var(--surface-1)',
      border: `1px solid ${focus ? 'var(--accent)' : 'var(--border-strong)'}`,
      borderRadius: 'var(--r-md)',
      boxShadow: focus ? 'var(--focus)' : 'none',
      transition: 'border-color .14s, box-shadow .14s',
      ...style
    }
  }, icon && /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      color: 'var(--text-faint)',
      fontSize: 14
    }
  }, icon), /*#__PURE__*/React.createElement("input", _extends({
    value: value,
    onChange: onChange,
    placeholder: placeholder,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      flex: 1,
      minWidth: 0,
      border: 0,
      outline: 'none',
      background: 'transparent',
      color: 'var(--text)',
      font: '400 13px/1 var(--font-ui)'
    }
  }, rest)), kbd && /*#__PURE__*/React.createElement("kbd", {
    style: {
      font: '600 10px/1 var(--font-mono)',
      color: 'var(--text-faint)',
      border: '1px solid var(--border)',
      padding: '3px 5px',
      borderRadius: 3
    }
  }, kbd));
}
Object.assign(__ds_scope, { SearchInput });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SearchInput.jsx", error: String((e && e.message) || e) }); }

// components/forms/SegmentedControl.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * SegmentedControl — replaces sub-tabs inside a view. One selected segment
 * gets a raised surface; the track is a sunken well.
 */
function SegmentedControl({
  options = [],
  value,
  onChange,
  style,
  ...rest
}) {
  const opts = options.map(o => typeof o === 'string' ? {
    value: o,
    label: o
  } : o);
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "tablist",
    style: {
      display: 'inline-flex',
      padding: 3,
      gap: 2,
      background: 'var(--bg-subtle)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-md)',
      ...style
    }
  }, rest), opts.map(o => {
    const on = o.value === value;
    return /*#__PURE__*/React.createElement("button", {
      key: o.value,
      role: "tab",
      "aria-selected": on,
      onClick: () => onChange && onChange(o.value),
      style: {
        border: 0,
        cursor: 'pointer',
        padding: '6px 12px',
        borderRadius: 'var(--r-sm)',
        font: '500 12px/1 var(--font-ui)',
        color: on ? 'var(--text-hi)' : 'var(--text-lo)',
        background: on ? 'var(--surface-2)' : 'transparent',
        boxShadow: on ? 'var(--e-1)' : 'none',
        transition: 'color .12s, background .12s'
      }
    }, o.label);
  }));
}
Object.assign(__ds_scope, { SegmentedControl });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SegmentedControl.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Card — a clickable surface for library grids (NFTs, stablecoins, chains).
 * Defined by a 1px border + lit edge; lifts 1px on hover. No drop-shadow soup.
 */
function Card({
  interactive = true,
  onClick,
  children,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", _extends({
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      background: hover && interactive ? 'var(--surface-2)' : 'var(--surface-1)',
      borderRadius: 'var(--r-md)',
      boxShadow: hover && interactive ? 'var(--e-2)' : 'var(--e-1)',
      padding: 'var(--s-4)',
      cursor: interactive ? 'pointer' : 'default',
      transform: hover && interactive ? 'translateY(-1px)' : 'none',
      transition: 'box-shadow .16s, background .16s, transform .16s',
      ...style
    }
  }, rest), children);
}

/** CardTitle / CardMeta / CardStat — the standard card content atoms. */
function CardTitle({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 15px/1.3 var(--font-ui)',
      letterSpacing: '-.01em',
      color: 'var(--text-hi)',
      ...style
    }
  }, children);
}
function CardMeta({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 4,
      font: '400 11px/1.4 var(--font-ui)',
      color: 'var(--text-lo)',
      ...style
    }
  }, children);
}
function CardStat({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 22px/1 var(--font-mono)',
      color: 'var(--text-hi)',
      fontVariantNumeric: 'tabular-nums',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Card, CardTitle, CardMeta, CardStat });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/Card.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/Panel.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Panel — a non-interactive container surface for a section of content.
 * Border + lit edge, optional padding, optional labelled header.
 */
function Panel({
  label,
  pad = true,
  children,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: 'var(--surface-1)',
      borderRadius: 'var(--r-lg)',
      boxShadow: 'var(--e-1)',
      overflow: 'clip',
      ...style
    }
  }, rest), label && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '12px 16px',
      borderBottom: '1px solid var(--border)',
      font: '600 11px/1 var(--font-ui)',
      letterSpacing: '.08em',
      textTransform: 'uppercase',
      color: 'var(--text-lo)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: pad ? 'var(--s-5)' : 0
    }
  }, children));
}
Object.assign(__ds_scope, { Panel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/Panel.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/app.jsx
try { (() => {
/* Chaindump dashboard — app shell: grouped left rail, top bar, view switch. */
const {
  LiveView,
  MidView,
  GraveyardView,
  NftView,
  StablesView,
  RwaView,
  InfraView,
  MarketsView,
  GeoView,
  PolicyView,
  NewsView,
  AgentView
} = window.KITViews;
const NAV = [{
  group: 'Chains',
  items: [{
    v: 'live',
    ico: '◧',
    label: 'Live · Top 50'
  }, {
    v: 'mid',
    ico: '◐',
    label: 'Stuck / Mid'
  }, {
    v: 'grave',
    ico: '✕',
    label: 'Graveyard'
  }]
}, {
  group: 'Assets',
  items: [{
    v: 'nft',
    ico: '◆',
    label: 'NFTs & Ordinals'
  }, {
    v: 'stables',
    ico: '$',
    label: 'Stablecoins'
  }, {
    v: 'rwa',
    ico: '▣',
    label: 'RWA · DePIN'
  }, {
    v: 'infra',
    ico: '⛁',
    label: 'Storage / Verify'
  }]
}, {
  group: 'Markets',
  items: [{
    v: 'markets',
    ico: '▤',
    label: 'Treasuries · ETFs'
  }]
}, {
  group: 'World',
  items: [{
    v: 'geo',
    ico: '◍',
    label: 'Global Adoption'
  }, {
    v: 'uspolicy',
    ico: '⬡',
    label: 'US Policy Map'
  }]
}, {
  group: 'Signal',
  items: [{
    v: 'news',
    ico: '≋',
    label: 'News'
  }]
}, {
  group: 'Agents',
  items: [{
    v: 'api',
    ico: '⌘',
    label: 'Agent API'
  }]
}];
const VIEWS = {
  live: LiveView,
  mid: MidView,
  grave: GraveyardView,
  nft: NftView,
  stables: StablesView,
  rwa: RwaView,
  infra: InfraView,
  markets: MarketsView,
  geo: GeoView,
  uspolicy: PolicyView,
  news: NewsView,
  api: AgentView
};
function App() {
  const [view, setView] = React.useState('live');
  const [rail, setRail] = React.useState(false);
  const Active = VIEWS[view];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '100vh',
      background: 'var(--bg)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'sticky',
      top: 0,
      zIndex: 50,
      height: 52,
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '0 16px',
      background: 'var(--bg-subtle)',
      borderBottom: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setRail(r => !r),
    style: {
      background: 'none',
      border: 'none',
      color: 'var(--text-lo)',
      fontSize: 16,
      cursor: 'pointer',
      padding: 4
    },
    "aria-label": "Toggle rail"
  }, "\u2630"), /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/chaindump-mark-onDark.svg",
    width: "24",
    height: "24",
    alt: "",
    style: {
      display: 'block'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '800 16px/1 var(--font-ui)',
      letterSpacing: '-.02em',
      color: 'var(--text-hi)'
    }
  }, "Chaindump", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--accent)'
    }
  }, ".")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      height: 32,
      padding: '0 12px',
      background: 'var(--surface-1)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-sm)',
      color: 'var(--text-lo)',
      font: '400 12px/1 var(--font-ui)'
    }
  }, "Search\u2026 ", /*#__PURE__*/React.createElement("kbd", {
    style: {
      font: '600 10px/1 var(--font-mono)',
      color: 'var(--text-faint)',
      border: '1px solid var(--border)',
      padding: '2px 4px',
      borderRadius: 3
    }
  }, "\u2318K")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      font: '400 12px/1 var(--font-ui)',
      color: 'var(--text-lo)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: 'var(--accent)',
      animation: 'pulse 2.4s ease-out infinite'
    }
  }), "live")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement("aside", {
    style: {
      position: 'sticky',
      top: 52,
      alignSelf: 'flex-start',
      height: 'calc(100vh - 52px)',
      width: rail ? 56 : 232,
      flex: `0 0 ${rail ? 56 : 232}px`,
      background: 'var(--bg-subtle)',
      borderRight: '1px solid var(--border)',
      overflowY: 'auto',
      transition: 'width .18s, flex-basis .18s'
    }
  }, /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      paddingTop: 6
    }
  }, NAV.map((g, gi) => /*#__PURE__*/React.createElement("div", {
    key: g.group,
    style: {
      padding: '6px 0',
      borderTop: gi ? '1px solid var(--border)' : 'none'
    }
  }, !rail && /*#__PURE__*/React.createElement("div", {
    style: {
      font: '700 10.5px/1 var(--font-ui)',
      letterSpacing: '.08em',
      textTransform: 'uppercase',
      color: 'var(--text-lo)',
      opacity: .65,
      padding: '8px 16px 4px'
    }
  }, g.group), g.items.map(it => {
    const on = view === it.v;
    return /*#__PURE__*/React.createElement("button", {
      key: it.v,
      onClick: () => setView(it.v),
      title: it.label,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        width: '100%',
        background: on ? 'var(--accent-bg)' : 'none',
        border: 'none',
        cursor: 'pointer',
        padding: rail ? '9px 0' : '7px 16px',
        justifyContent: rail ? 'center' : 'flex-start',
        color: on ? 'var(--text-hi)' : 'var(--text-lo)',
        font: '500 13px/1 var(--font-ui)',
        letterSpacing: '-.01em',
        textAlign: 'left',
        borderLeft: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
        transition: 'color .12s, background .12s'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 18,
        flex: '0 0 18px',
        textAlign: 'center',
        fontSize: 14,
        color: on ? 'var(--accent)' : 'inherit'
      }
    }, it.ico), !rail && /*#__PURE__*/React.createElement("span", null, it.label));
  }))))), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      minWidth: 0,
      padding: '32px clamp(16px,3vw,32px) 64px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1360,
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement(Active, null)))));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/data.js
try { (() => {
/* Illustrative, clearly-synthetic data for the Chaindump dashboard UI kit.
   Numbers are plausible placeholders — NOT live values. */
window.KIT = function () {
  const spark = (a, n = 12, vol = 0.12) => {
    const out = [a];
    for (let i = 1; i < n; i++) out.push(Math.max(0.01, out[i - 1] * (1 + (Math.random() - 0.48) * vol)));
    return out;
  };
  const chains = [{
    rank: 1,
    name: 'Ethereum',
    symbol: 'ETH',
    price: 2340.18,
    chg: 4.2,
    addr: 512000,
    vol: 2340000000,
    tvl: 48200000000,
    tvl7d: 3.1,
    verdict: 'ok',
    type: 'L1 · Smart-contract',
    insight: 'Fees down 30% post-Dencun; L2s now settle ~6× cheaper. Real usage is migrating up-stack while settlement demand holds.',
    pf: 12,
    feeYield: 3.1,
    turnover: 0.05,
    feeUser: 4.6
  }, {
    rank: 2,
    name: 'Solana',
    symbol: 'SOL',
    price: 184.02,
    chg: -2.1,
    addr: 1240000,
    vol: 1980000000,
    tvl: 9410000000,
    tvl7d: -1.4,
    verdict: 'ok',
    type: 'L1 · Monolithic',
    insight: 'DEX volume/TVL turnover is the highest of any L1 — liquidity is working hard, but fee-per-user lags, hinting at incentive-driven flow.',
    pf: 28,
    feeYield: 5.2,
    turnover: 0.21,
    feeUser: 1.2
  }, {
    rank: 3,
    name: 'Base',
    symbol: '—',
    price: null,
    chg: null,
    addr: 890000,
    vol: 1210000000,
    tvl: 12080000000,
    tvl7d: 6.8,
    verdict: 'ok',
    type: 'L2 · OP Stack',
    insight: 'TVL up 6.8% w/w on organic app growth, not points. Fee-rank now leads TVL-rank — a healthy divergence (users before mercenaries).',
    pf: 9,
    feeYield: 2.4,
    turnover: 0.10,
    feeUser: 3.9
  }, {
    rank: 4,
    name: 'Arbitrum',
    symbol: 'ARB',
    price: 0.9124,
    chg: 8.4,
    addr: 640000,
    vol: 980000000,
    tvl: 3440000000,
    tvl7d: 2.2,
    verdict: 'watch',
    type: 'L2 · Rollup',
    insight: 'Token +8.4% ahead of an unlock cliff — watch for front-run drift. TVL steady; incentive reserve depletion is the risk to model.',
    pf: 41,
    feeYield: 1.8,
    turnover: 0.28,
    feeUser: 0.8
  }, {
    rank: 5,
    name: 'BNB Chain',
    symbol: 'BNB',
    price: 604.55,
    chg: -0.6,
    addr: 720000,
    vol: 1120000000,
    tvl: 5210000000,
    tvl7d: -0.9,
    verdict: 'watch',
    type: 'L1 · Smart-contract',
    insight: 'Volume concentrated in a handful of pools; vol/fee ratio elevated — a partial wash-trading signature worth discounting.',
    pf: 19,
    feeYield: 2.9,
    turnover: 0.21,
    feeUser: 1.5
  }, {
    rank: 6,
    name: 'Tron',
    symbol: 'TRX',
    price: 0.2412,
    chg: 1.1,
    addr: 2100000,
    vol: 410000000,
    tvl: 8020000000,
    tvl7d: 0.4,
    verdict: 'ok',
    type: 'L1 · Smart-contract',
    insight: 'Stablecoin settlement rail — USDT dominance drives sticky, low-velocity TVL. Boring by design, and durable.',
    pf: 15,
    feeYield: 4.1,
    turnover: 0.05,
    feeUser: 2.2
  }, {
    rank: 7,
    name: 'Sui',
    symbol: 'SUI',
    price: 3.88,
    chg: 12.6,
    addr: 310000,
    vol: 620000000,
    tvl: 1640000000,
    tvl7d: 14.2,
    verdict: 'watch',
    type: 'L1 · Move',
    insight: 'Fastest TVL acceleration in the top 25 (+14% w/w). Capital is building ahead of activity — momentum, but unproven retention.',
    pf: 55,
    feeYield: 1.2,
    turnover: 0.38,
    feeUser: 0.6
  }, {
    rank: 8,
    name: 'Aptos',
    symbol: 'APT',
    price: 9.14,
    chg: -3.4,
    addr: 180000,
    vol: 210000000,
    tvl: 980000000,
    tvl7d: -5.1,
    verdict: 'risk',
    type: 'L1 · Move',
    insight: 'TVL sliding as a yield program winds down — a rented-capital end date is visible. Watch the bridge-outflow curve.',
    pf: 72,
    feeYield: 0.9,
    turnover: 0.21,
    feeUser: 0.4
  }];
  chains.forEach(c => {
    c.tvlSpark = spark(c.tvl / 1e9, 12, 0.06);
  });
  const graveyard = [{
    name: 'Terra Classic',
    verdict: 'dead',
    launched: '2019',
    peak: 42000000000,
    cur: 180000000,
    dd: 99.6,
    why: 'Algorithmic-stablecoin death spiral; UST depeg vaporized the reserve in 72h.',
    tags: ['depeg', 'reflexive collateral', 'contagion']
  }, {
    name: 'Fantom (pre-Sonic)',
    verdict: 'declining',
    launched: '2018',
    peak: 7900000000,
    cur: 210000000,
    dd: 97.3,
    why: 'Mercenary TVL exited when fUSD incentives dried up; devs migrated to the Sonic rebrand.',
    tags: ['incentive exit', 'rebrand', 'yield depletion']
  }, {
    name: 'Multichain',
    verdict: 'dead',
    launched: '2020',
    peak: 2100000000,
    cur: 0,
    dd: 100,
    why: 'Bridge collapse after founder detention; $1.3B stranded. True time-of-death = bridge freeze.',
    tags: ['bridge freeze', 'custody', 'soft rug']
  }, {
    name: 'Harmony',
    verdict: 'declining',
    launched: '2019',
    peak: 1400000000,
    cur: 12000000,
    dd: 99.1,
    why: 'Horizon bridge hack ($100M) broke trust; validators and liquidity never returned.',
    tags: ['hack', 'trust loss', 'abandonment']
  }];
  const news = [{
    src: 'The Block',
    age: '14m',
    title: 'Base sequencer revenue hits record as onchain app volume outpaces L2 peers'
  }, {
    src: 'DL News',
    age: '38m',
    title: 'Arbitrum DAO debates trimming incentive reserve ahead of March unlock'
  }, {
    src: 'CoinDesk',
    age: '1h',
    title: 'Tether reports USDT supply on Tron crosses new high, cementing settlement lead'
  }, {
    src: 'Blockworks',
    age: '2h',
    title: 'Sui TVL doubles quarter-over-quarter; analysts flag retention as the open question'
  }, {
    src: 'Cointelegraph',
    age: '3h',
    title: 'Post-Dencun fee data: Ethereum L2 settlement costs down ~30% year-over-year'
  }, {
    src: 'Rekt',
    age: '5h',
    title: 'Forensics: dormant Multichain-linked cluster moves $8M through three hops'
  }];

  // US state stance — illustrative. abbr: stance (pro | mix | anti | unk)
  const stateStance = {
    CA: 'mix',
    TX: 'pro',
    FL: 'pro',
    NY: 'anti',
    WY: 'pro',
    WA: 'mix',
    NV: 'pro',
    CO: 'pro',
    IL: 'mix',
    OH: 'mix',
    PA: 'mix',
    GA: 'pro',
    NC: 'mix',
    MI: 'mix',
    AZ: 'pro',
    TN: 'pro',
    MA: 'anti',
    NJ: 'anti',
    VA: 'mix',
    UT: 'pro',
    LA: 'pro',
    KY: 'pro',
    OK: 'pro',
    MT: 'pro',
    ND: 'pro',
    SD: 'pro',
    NH: 'pro',
    MO: 'mix',
    IN: 'mix',
    WI: 'mix',
    MN: 'mix',
    OR: 'mix',
    CT: 'anti',
    MD: 'mix',
    SC: 'pro',
    AL: 'pro',
    AR: 'pro',
    KS: 'pro',
    IA: 'mix',
    MS: 'pro',
    NE: 'pro',
    ID: 'pro',
    WV: 'pro',
    NM: 'mix',
    ME: 'mix',
    RI: 'anti',
    DE: 'mix',
    VT: 'anti',
    AK: 'pro',
    HI: 'anti'
  };

  // Card-grid libraries. card = {name, meta, stat, delta, verdict, note}
  const libraries = {
    mid: {
      title: 'Stuck / Mid',
      sub: 'Chains that never died but never broke out — capital parked, narrative stalled.',
      cards: [{
        name: 'Cardano',
        meta: 'L1 · UTXO',
        stat: '$412M',
        delta: -1.2,
        verdict: 'watch',
        note: 'Deep liquidity, thin app demand — TVL flat for 6 quarters despite steady dev activity.'
      }, {
        name: 'Cronos',
        meta: 'L1 · Cosmos SDK',
        stat: '$310M',
        delta: 0.4,
        verdict: 'watch',
        note: 'CEX-adjacent flows prop up TVL; organic usage has not compounded.'
      }, {
        name: 'Klaytn',
        meta: 'L1 · Enterprise',
        stat: '$96M',
        delta: -3.8,
        verdict: 'risk',
        note: 'Regional enterprise bets un-materialized; merged roadmap is the last catalyst.'
      }, {
        name: 'Celo',
        meta: 'L2 · Mobile',
        stat: '$88M',
        delta: 2.1,
        verdict: 'watch',
        note: 'Migrated to an Ethereum L2 — reset the clock, retention still unproven.'
      }]
    },
    nft: {
      title: 'NFTs & Ordinals',
      sub: 'Collections and marketplaces by floor, volume, and holder concentration.',
      cards: [{
        name: 'CryptoPunks',
        meta: 'Ethereum · PFP',
        stat: '32.4 Ξ',
        delta: 1.8,
        verdict: 'ok',
        note: 'Blue-chip floor holds; volume thin but holder base durable.'
      }, {
        name: 'Bitcoin Ordinals',
        meta: 'Bitcoin · Inscriptions',
        stat: '$41M',
        delta: 14.2,
        verdict: 'watch',
        note: 'Volume spikes with fee regimes — activity tracks block-space demand, not culture.'
      }, {
        name: 'Pudgy Penguins',
        meta: 'Ethereum · PFP',
        stat: '11.1 Ξ',
        delta: -4.6,
        verdict: 'watch',
        note: 'IP/consumer strategy is the thesis; onchain floor lags brand traction.'
      }, {
        name: 'Blur',
        meta: 'Ethereum · Marketplace',
        stat: '$1.2B',
        delta: 8.4,
        verdict: 'ok',
        note: 'Pro-trader share leader; incentive wind-down is the variable to watch.'
      }]
    },
    stables: {
      title: 'Stablecoins',
      sub: 'Supply, chain distribution, and peg health across fiat- and crypto-backed issuers.',
      cards: [{
        name: 'USDT',
        meta: 'Tether · fiat-backed',
        stat: '$118B',
        delta: 0.6,
        verdict: 'ok',
        note: 'Tron + Ethereum dominant; settlement rail of record. Attestation, not full audit.'
      }, {
        name: 'USDC',
        meta: 'Circle · fiat-backed',
        stat: '$34B',
        delta: 1.3,
        verdict: 'ok',
        note: 'Regulated, multi-chain; supply recovering post-2023 depeg scare.'
      }, {
        name: 'DAI / USDS',
        meta: 'Sky · crypto-backed',
        stat: '$5.4B',
        delta: -0.4,
        verdict: 'watch',
        note: 'Increasingly RWA-collateralized — a centralization tradeoff for yield.'
      }, {
        name: 'USDe',
        meta: 'Ethena · synthetic',
        stat: '$3.1B',
        delta: 6.2,
        verdict: 'risk',
        note: 'Basis-trade yield; peg depends on funding staying positive. Model the unwind.'
      }]
    },
    rwa: {
      title: 'RWA · DePIN',
      sub: 'Tokenized real-world assets and decentralized physical infrastructure.',
      cards: [{
        name: 'Ondo Finance',
        meta: 'RWA · Treasuries',
        stat: '$620M',
        delta: 5.1,
        verdict: 'ok',
        note: 'Tokenized T-bills; growth tracks the rate environment and institutional onboarding.'
      }, {
        name: 'Helium',
        meta: 'DePIN · Wireless',
        stat: '$210M',
        delta: -2.3,
        verdict: 'watch',
        note: 'Migrated to Solana; usage revenue still small vs token-incentive spend.'
      }, {
        name: 'Render',
        meta: 'DePIN · Compute/GPU',
        stat: '$180M',
        delta: 9.8,
        verdict: 'watch',
        note: 'AI-compute narrative tailwind; utilization data lags token price.'
      }, {
        name: 'BlackRock BUIDL',
        meta: 'RWA · Money-market',
        stat: '$510M',
        delta: 3.4,
        verdict: 'ok',
        note: 'Institutional flagship; concentration in a few holders is the caveat.'
      }]
    },
    infra: {
      title: 'Storage / Verify',
      sub: 'Data-availability, storage, and verification layers that sit under other chains.',
      cards: [{
        name: 'Filecoin',
        meta: 'Storage',
        stat: '$95M',
        delta: -1.1,
        verdict: 'watch',
        note: 'Raw capacity high; paid-storage demand is the honest metric, and it is modest.'
      }, {
        name: 'Arweave',
        meta: 'Permanent storage',
        stat: '$60M',
        delta: 0.9,
        verdict: 'ok',
        note: 'Permaweb niche durable; tied to a handful of high-write consumers.'
      }, {
        name: 'EAS',
        meta: 'Attestations',
        stat: '—',
        delta: null,
        verdict: 'ok',
        note: 'Attestation primitive adopted across identity/reputation apps. Not a token play.'
      }, {
        name: 'Celestia',
        meta: 'Data availability',
        stat: '$0',
        delta: null,
        verdict: 'watch',
        note: 'Modular-DA thesis; revenue depends on rollups actually paying for blobspace.'
      }]
    },
    markets: {
      title: 'Treasuries · Miners · ETFs',
      sub: 'Where TradFi capital crosses into crypto — spot ETFs, DATs, and public miners.',
      cards: [{
        name: 'iShares Bitcoin (IBIT)',
        meta: 'Spot BTC ETF',
        stat: '$52B',
        delta: 1.4,
        verdict: 'ok',
        note: 'Flows are the cleanest institutional-demand read available; watch daily creations.'
      }, {
        name: 'MicroStrategy (MSTR)',
        meta: 'BTC treasury',
        stat: '$18B',
        delta: -2.8,
        verdict: 'watch',
        note: 'Leveraged BTC proxy; premium-to-NAV swings amplify the underlying.'
      }, {
        name: 'Marathon (MARA)',
        meta: 'Public miner',
        stat: '$4.2B',
        delta: 3.1,
        verdict: 'watch',
        note: 'Hashprice + energy cost define margins; post-halving squeeze ongoing.'
      }, {
        name: 'Ether ETFs (agg.)',
        meta: 'Spot ETH ETF',
        stat: '$9.6B',
        delta: 0.7,
        verdict: 'ok',
        note: 'Adoption trailing BTC funds; staking-inclusion is the pending catalyst.'
      }]
    }
  };
  const geo = {
    kpis: [{
      label: 'Countries tracked',
      value: '96'
    }, {
      label: 'Pro-adoption',
      value: '38'
    }, {
      label: 'CBDC pilots',
      value: '41'
    }, {
      label: 'Outright bans',
      value: '9'
    }],
    regions: [{
      name: 'United States',
      note: 'Spot ETFs live; state-level stance fragmented — see US Policy Map.',
      stance: 'mix'
    }, {
      name: 'European Union',
      note: 'MiCA in force — the clearest comprehensive framework globally.',
      stance: 'pro'
    }, {
      name: 'UAE',
      note: 'VARA licensing; aggressive hub strategy in Dubai + Abu Dhabi.',
      stance: 'pro'
    }, {
      name: 'Singapore',
      note: 'MAS licensing; selective, high-bar approvals.',
      stance: 'mix'
    }, {
      name: 'China',
      note: 'Trading + mining banned; e-CNY CBDC push continues.',
      stance: 'anti'
    }, {
      name: 'Nigeria',
      note: 'High grassroots usage against a restrictive central-bank stance.',
      stance: 'mix'
    }]
  };
  const agentEndpoints = [{
    m: 'GET',
    path: '/api/agent/v1/summary',
    desc: 'Market-wide levels, deltas and top signals in one envelope.'
  }, {
    m: 'GET',
    path: '/api/agent/v1/signals',
    desc: 'Ranked capital-rotation, peg and wash-trade signals with confidence.'
  }, {
    m: 'GET',
    path: '/api/agent/v1/chain/{key}',
    desc: 'Full per-chain fundamentals, momentum and provenance.'
  }, {
    m: 'GET',
    path: '/api/agent/v1/graveyard',
    desc: 'Dead/dying chains with cause taxonomy and time-of-death.'
  }];
  return {
    chains,
    graveyard,
    news,
    stateStance,
    libraries,
    geo,
    agentEndpoints
  };
}();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/data.js", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/views.jsx
try { (() => {
/* Chaindump dashboard — views. Composes design-system primitives.
   Exposes window.KITViews = { LiveView, GraveyardView, PolicyView, NewsView }. */
const DS = window.ChaindumpDesignSystem_8bb35e;
const {
  Button,
  SearchInput,
  SegmentedControl,
  Badge,
  Card,
  CardTitle,
  CardMeta,
  CardStat,
  Panel,
  KpiTile,
  KpiRow,
  DeltaValue,
  VerdictPill,
  Sparkline
} = DS;
const fmtUsd = n => n == null ? '—' : (n < 0 ? '-' : '') + '$' + Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 2
}).format(Math.abs(n));
const fmtNum = n => n == null ? '—' : Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1
}).format(n);
const HUES = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#e06a6a', '#4ec9a3'];
const hueFor = s => HUES[Math.abs([...s].reduce((a, c) => a + c.charCodeAt(0), 0)) % HUES.length];
function Logo({
  name,
  big
}) {
  const d = big ? 34 : 22;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      width: d,
      height: d,
      borderRadius: '50%',
      flexShrink: 0,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: hueFor(name),
      font: `700 ${big ? 15 : 11}px/1 var(--font-ui)`,
      color: '#05070b'
    }
  }, name[0]);
}

/* ── Detail panel (summary-first, sub-tabbed) ── */
function DetailPanel({
  chain
}) {
  const [tab, setTab] = React.useState('summary');
  const sub = [{
    value: 'summary',
    label: 'Summary'
  }, {
    value: 'trends',
    label: 'Trends'
  }, {
    value: 'fund',
    label: 'Fundamentals'
  }, {
    value: 'take',
    label: 'Take'
  }, {
    value: 'src',
    label: 'Sources'
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--s-6)',
      animation: 'revealDown .22s cubic-bezier(.16,1,.3,1)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 14,
      marginBottom: 'var(--s-4)'
    }
  }, /*#__PURE__*/React.createElement(Logo, {
    name: chain.name,
    big: true
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: '600 19px/1.2 var(--font-ui)',
      letterSpacing: '-.015em',
      color: 'var(--text-hi)'
    }
  }, chain.name), chain.price != null && /*#__PURE__*/React.createElement("span", {
    className: "num",
    style: {
      font: '600 14px/1 var(--font-mono)',
      color: 'var(--accent)'
    }
  }, "$", chain.price.toLocaleString()), chain.chg != null && /*#__PURE__*/React.createElement(DeltaValue, {
    value: chain.chg
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement(Badge, null, chain.type), /*#__PURE__*/React.createElement(VerdictPill, {
    status: chain.verdict
  })))), /*#__PURE__*/React.createElement(SegmentedControl, {
    value: tab,
    onChange: setTab,
    options: sub,
    style: {
      marginBottom: 'var(--s-5)'
    }
  }), tab === 'summary' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      borderLeft: '2px solid var(--accent)',
      background: 'var(--accent-bg)',
      padding: '12px 16px',
      borderRadius: 'var(--r-sm)',
      font: '400 15px/1.5 var(--font-ui)',
      color: 'var(--text-hi)',
      marginBottom: 'var(--s-5)'
    }
  }, chain.insight), /*#__PURE__*/React.createElement(KpiRow, null, /*#__PURE__*/React.createElement(KpiTile, {
    label: "TVL",
    value: fmtUsd(chain.tvl),
    delta: chain.tvl7d
  }), /*#__PURE__*/React.createElement(KpiTile, {
    label: "24h Vol",
    value: fmtUsd(chain.vol)
  }), /*#__PURE__*/React.createElement(KpiTile, {
    label: "Active 24h",
    value: fmtNum(chain.addr)
  }), /*#__PURE__*/React.createElement(KpiTile, {
    label: "Fee yield",
    value: chain.feeYield,
    unit: "%"
  }))), tab === 'trends' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 11px/1 var(--font-ui)',
      letterSpacing: '.08em',
      textTransform: 'uppercase',
      color: 'var(--text-lo)',
      marginBottom: 10
    }
  }, "TVL \xB7 last 90 days"), /*#__PURE__*/React.createElement(Sparkline, {
    values: chain.tvlSpark,
    width: 480,
    height: 80
  })), tab === 'fund' && /*#__PURE__*/React.createElement(KpiRow, null, /*#__PURE__*/React.createElement(KpiTile, {
    label: "P / F ratio",
    value: chain.pf,
    unit: "\xD7"
  }), /*#__PURE__*/React.createElement(KpiTile, {
    label: "Fee yield",
    value: chain.feeYield,
    unit: "%"
  }), /*#__PURE__*/React.createElement(KpiTile, {
    label: "Turnover",
    value: chain.turnover,
    unit: "\xD7"
  }), /*#__PURE__*/React.createElement(KpiTile, {
    label: "Fees / user",
    value: '$' + chain.feeUser
  })), tab === 'take' && /*#__PURE__*/React.createElement("p", {
    style: {
      maxWidth: '68ch',
      font: '400 14px/1.6 var(--font-ui)',
      color: 'var(--text)'
    }
  }, chain.insight, " A research agent refreshes this take every 12 hours; the verdict pill summarizes the current triage stance."), tab === 'src' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8
    }
  }, ['DefiLlama', 'growthepie', 'CoinGecko'].map(s => /*#__PURE__*/React.createElement("span", {
    key: s,
    style: {
      font: '400 11px/1 var(--font-mono)',
      color: 'var(--text-lo)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-xs)',
      padding: '5px 9px'
    }
  }, s, " \u2197"))));
}

/* ── Live · Top 50 table ── */
function LiveView() {
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState(null);
  const rows = window.KIT.chains.filter(c => c.name.toLowerCase().includes(q.toLowerCase()));
  const th = {
    padding: '11px 14px',
    textAlign: 'left',
    font: '600 11px/1 var(--font-ui)',
    letterSpacing: '.08em',
    textTransform: 'uppercase',
    color: 'var(--text-lo)',
    borderBottom: '1px solid var(--border-strong)',
    whiteSpace: 'nowrap'
  };
  const thr = {
    ...th,
    textAlign: 'right'
  };
  const td = {
    padding: '10px 14px',
    font: '500 13px/1.4 var(--font-ui)',
    color: 'var(--text)',
    borderBottom: '1px solid var(--border)'
  };
  const tdn = {
    ...td,
    textAlign: 'right',
    fontFamily: 'var(--font-mono)',
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--text-hi)'
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(ViewHeader, {
    title: "Live \xB7 Top 50",
    sub: "Ranked by composite activity \u2014 50% volume \xB7 30% TVL \xB7 20% fees. Click a row for the analyst take."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      margin: '0 0 16px'
    }
  }, /*#__PURE__*/React.createElement(SearchInput, {
    value: q,
    onChange: e => setQ(e.target.value),
    placeholder: "Search chains\u2026",
    kbd: "\u2318K"
  }), /*#__PURE__*/React.createElement(Badge, {
    tone: "live",
    pulse: true
  }, "Live")), /*#__PURE__*/React.createElement(Panel, {
    pad: false
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
    style: {
      ...th,
      width: 44
    }
  }, "#"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Chain"), /*#__PURE__*/React.createElement("th", {
    style: thr
  }, "Active 24h"), /*#__PURE__*/React.createElement("th", {
    style: thr
  }, "24h Vol"), /*#__PURE__*/React.createElement("th", {
    style: thr
  }, "TVL"), /*#__PURE__*/React.createElement("th", {
    style: {
      ...th,
      textAlign: 'left'
    }
  }, "7d TVL"), /*#__PURE__*/React.createElement("th", {
    style: thr
  }, "Verdict"))), /*#__PURE__*/React.createElement("tbody", null, rows.map(c => {
    const isOpen = open === c.name;
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: c.name
    }, /*#__PURE__*/React.createElement("tr", {
      onClick: () => setOpen(isOpen ? null : c.name),
      style: {
        cursor: 'pointer',
        background: isOpen ? 'var(--accent-bg)' : 'transparent'
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        ...tdn,
        textAlign: 'left',
        color: 'var(--text-faint)',
        boxShadow: isOpen ? 'inset 2px 0 0 0 var(--accent)' : 'none'
      }
    }, c.rank), /*#__PURE__*/React.createElement("td", {
      style: td
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 9
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: isOpen ? 'var(--accent)' : 'var(--text-faint)',
        fontSize: 10,
        width: 10
      }
    }, isOpen ? '▾' : '▸'), /*#__PURE__*/React.createElement(Logo, {
      name: c.name
    }), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 600,
        color: 'var(--text-hi)'
      }
    }, c.name), " ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-lo)',
        fontSize: 11.5
      }
    }, c.symbol)))), /*#__PURE__*/React.createElement("td", {
      style: tdn
    }, fmtNum(c.addr)), /*#__PURE__*/React.createElement("td", {
      style: tdn
    }, fmtUsd(c.vol)), /*#__PURE__*/React.createElement("td", {
      style: tdn
    }, fmtUsd(c.tvl), " ", /*#__PURE__*/React.createElement(DeltaValue, {
      value: c.tvl7d
    })), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td
      }
    }, /*#__PURE__*/React.createElement(Sparkline, {
      values: c.tvlSpark,
      autoColor: true
    })), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        textAlign: 'right'
      }
    }, /*#__PURE__*/React.createElement(VerdictPill, {
      status: c.verdict,
      showLabel: false
    }))), isOpen && /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
      colSpan: 7,
      style: {
        padding: 0,
        background: 'var(--surface-1)',
        borderBottom: '1px solid var(--border-strong)'
      }
    }, /*#__PURE__*/React.createElement(DetailPanel, {
      chain: c
    }))));
  })))));
}

/* ── Graveyard ── */
function GraveyardView() {
  const [open, setOpen] = React.useState(null);
  const vmap = {
    dead: 'down',
    declining: 'warn'
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(ViewHeader, {
    title: "Graveyard",
    sub: "Chains where capital was rented, not earned. Every rental has an on-chain end date."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(300px,1fr))',
      gap: 'var(--s-4)'
    }
  }, window.KIT.graveyard.map(g => /*#__PURE__*/React.createElement(Card, {
    key: g.name,
    onClick: () => setOpen(open === g.name ? null : g.name)
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(CardTitle, null, g.name), /*#__PURE__*/React.createElement(CardMeta, null, "Launched ", g.launched, " \xB7 peak ", fmtUsd(g.peak))), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "num",
    style: {
      font: '700 18px/1 var(--font-mono)',
      color: 'var(--down)'
    }
  }, "-", g.dd, "%"), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 9px/1 var(--font-ui)',
      letterSpacing: '.04em',
      textTransform: 'uppercase',
      color: 'var(--text-faint)',
      marginTop: 4
    }
  }, "drawdown"))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: g.verdict === 'dead' ? 'dead' : 'warn'
  }, g.verdict)), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '12px 0 0',
      font: '400 12.5px/1.6 var(--font-ui)',
      color: 'var(--text-lo)'
    }
  }, g.why), open === g.name && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      paddingTop: 12,
      borderTop: '1px solid var(--border)',
      display: 'flex',
      flexWrap: 'wrap',
      gap: 5
    }
  }, g.tags.map(t => /*#__PURE__*/React.createElement("span", {
    key: t,
    style: {
      font: '600 10px/1 var(--font-ui)',
      color: 'var(--text-lo)',
      background: 'var(--surface-3)',
      borderRadius: 'var(--r-xs)',
      padding: '3px 7px'
    }
  }, t)))))));
}

/* ── US Policy Map ── */
function PolicyView() {
  const ref = React.useRef(null);
  const [sel, setSel] = React.useState(null);
  const colors = {
    pro: 'var(--up)',
    mix: 'var(--warn)',
    anti: 'var(--down)',
    unk: 'var(--surface-3)'
  };
  React.useEffect(() => {
    let live = true;
    fetch('../../assets/usmap.svg').then(r => r.text()).then(svg => {
      if (!live || !ref.current) return;
      ref.current.innerHTML = svg;
      const el = ref.current.querySelector('svg');
      if (el) {
        el.style.width = '100%';
        el.style.height = 'auto';
        el.style.display = 'block';
      }
      ref.current.querySelectorAll('path[id]').forEach(p => {
        const st = window.KIT.stateStance[p.id] || 'unk';
        p.style.fill = colors[st];
        p.style.stroke = '#07090d';
        p.style.strokeWidth = '0.8';
        p.style.cursor = 'pointer';
        p.style.transition = 'filter .1s';
        p.addEventListener('mouseenter', () => {
          p.style.filter = 'brightness(1.4)';
        });
        p.addEventListener('mouseleave', () => {
          p.style.filter = 'none';
        });
        p.addEventListener('click', () => setSel({
          abbr: p.id,
          stance: st
        }));
      });
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const legend = [['Pro-crypto', 'up'], ['Mixed', 'warn'], ['Restrictive', 'down'], ['No stance', 'neutral']];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(ViewHeader, {
    title: "US Policy Map",
    sub: "State-level regulatory stance toward digital assets. Illustrative classification."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 16,
      flexWrap: 'wrap',
      marginBottom: 16
    }
  }, legend.map(([l, t]) => /*#__PURE__*/React.createElement(Badge, {
    key: l,
    tone: t
  }, l))), /*#__PURE__*/React.createElement(Panel, null, /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      minHeight: 360
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14,
      minHeight: 24,
      font: '400 14px/1.5 var(--font-ui)',
      color: 'var(--text)'
    }
  }, sel ? /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: 'var(--text-hi)'
    }
  }, sel.abbr), " \u2014 ", {
    pro: 'Pro-crypto stance',
    mix: 'Mixed / evolving',
    anti: 'Restrictive',
    unk: 'No clear stance'
  }[sel.stance]) : /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-lo)'
    }
  }, "Click a state to inspect its stance.")));
}

/* ── News ── */
function NewsView() {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(ViewHeader, {
    title: "News",
    sub: "The real-time signal firehose \u2014 attributed, timestamped."
  }), /*#__PURE__*/React.createElement(Panel, {
    pad: false
  }, window.KIT.news.map((n, i) => /*#__PURE__*/React.createElement("a", {
    key: i,
    href: "#",
    onClick: e => e.preventDefault(),
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 14,
      padding: '14px 18px',
      borderBottom: i < window.KIT.news.length - 1 ? '1px solid var(--border)' : 'none',
      textDecoration: 'none'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flexShrink: 0,
      width: 110,
      font: '600 11px/1 var(--font-ui)',
      color: 'var(--accent-dim)'
    }
  }, n.src), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      font: '400 14px/1.45 var(--font-ui)',
      color: 'var(--text)',
      maxWidth: '68ch'
    }
  }, n.title), /*#__PURE__*/React.createElement("span", {
    className: "num",
    style: {
      flexShrink: 0,
      font: '400 11px/1 var(--font-mono)',
      color: 'var(--text-faint)'
    }
  }, n.age)))));
}

/* ── Generic card-grid library (assets / markets) ── */
function LibraryView({
  lib
}) {
  const [open, setOpen] = React.useState(null);
  const vtone = {
    ok: 'up',
    watch: 'warn',
    risk: 'down',
    dead: 'dead'
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(ViewHeader, {
    title: lib.title,
    sub: lib.sub
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(300px,1fr))',
      gap: 'var(--s-4)'
    }
  }, lib.cards.map(c => /*#__PURE__*/React.createElement(Card, {
    key: c.name,
    onClick: () => setOpen(open === c.name ? null : c.name)
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(CardTitle, null, c.name), /*#__PURE__*/React.createElement(CardMeta, null, c.meta)), /*#__PURE__*/React.createElement(VerdictPill, {
    status: c.verdict,
    showLabel: false
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      display: 'flex',
      alignItems: 'baseline',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(CardStat, null, c.stat), c.delta != null && /*#__PURE__*/React.createElement(DeltaValue, {
    value: c.delta,
    chip: true
  })), open === c.name && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '12px 0 0',
      paddingTop: 12,
      borderTop: '1px solid var(--border)',
      font: '400 12.5px/1.6 var(--font-ui)',
      color: 'var(--text-lo)'
    }
  }, c.note)))));
}
const MidView = () => /*#__PURE__*/React.createElement(LibraryView, {
  lib: window.KIT.libraries.mid
});
const NftView = () => /*#__PURE__*/React.createElement(LibraryView, {
  lib: window.KIT.libraries.nft
});
const StablesView = () => /*#__PURE__*/React.createElement(LibraryView, {
  lib: window.KIT.libraries.stables
});
const RwaView = () => /*#__PURE__*/React.createElement(LibraryView, {
  lib: window.KIT.libraries.rwa
});
const InfraView = () => /*#__PURE__*/React.createElement(LibraryView, {
  lib: window.KIT.libraries.infra
});
const MarketsView = () => /*#__PURE__*/React.createElement(LibraryView, {
  lib: window.KIT.libraries.markets
});

/* ── Global adoption ── */
function GeoView() {
  const g = window.KIT.geo;
  const tone = {
    pro: 'up',
    mix: 'warn',
    anti: 'down'
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(ViewHeader, {
    title: "Global Adoption",
    sub: "Regulatory posture and adoption signals by jurisdiction."
  }), /*#__PURE__*/React.createElement(KpiRow, {
    style: {
      marginBottom: 'var(--s-6)'
    }
  }, g.kpis.map(k => /*#__PURE__*/React.createElement(KpiTile, {
    key: k.label,
    label: k.label,
    value: k.value
  }))), /*#__PURE__*/React.createElement(Panel, {
    pad: false
  }, g.regions.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: r.name,
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 14,
      padding: '14px 18px',
      borderBottom: i < g.regions.length - 1 ? '1px solid var(--border)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flexShrink: 0,
      width: 150,
      font: '600 13px/1.4 var(--font-ui)',
      color: 'var(--text-hi)'
    }
  }, r.name), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      font: '400 13px/1.5 var(--font-ui)',
      color: 'var(--text-lo)'
    }
  }, r.note), /*#__PURE__*/React.createElement(Badge, {
    tone: tone[r.stance]
  }, {
    pro: 'Pro',
    mix: 'Mixed',
    anti: 'Restrictive'
  }[r.stance])))));
}

/* ── Agent API ── */
function AgentView() {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(ViewHeader, {
    title: "Agent API",
    sub: "Chaindump for autonomous agents \u2014 versioned, provenance-tagged, confidence-scored JSON. MCP tools planned."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--s-3)'
    }
  }, window.KIT.agentEndpoints.map(e => /*#__PURE__*/React.createElement("div", {
    key: e.path,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      padding: '14px 18px',
      background: 'var(--surface-1)',
      boxShadow: 'var(--e-1)',
      borderRadius: 'var(--r-md)'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "up"
  }, e.m), /*#__PURE__*/React.createElement("code", {
    style: {
      font: '500 13px/1 var(--font-mono)',
      color: 'var(--text-hi)',
      minWidth: 260
    }
  }, e.path), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      font: '400 12.5px/1.5 var(--font-ui)',
      color: 'var(--text-lo)'
    }
  }, e.desc)))), /*#__PURE__*/React.createElement(Panel, {
    label: "Response envelope",
    style: {
      marginTop: 'var(--s-5)'
    }
  }, /*#__PURE__*/React.createElement("pre", {
    style: {
      margin: 0,
      font: '400 12px/1.7 var(--font-mono)',
      color: 'var(--text)',
      whiteSpace: 'pre-wrap'
    }
  }, `{
  "version": "v1",
  "as_of": "2026-07-13T15:52:00Z",
  "data": { "…": "…" },
  "provenance": [{ "source": "DefiLlama", "fetched_at": "…" }],
  "confidence": "high"
}`)));
}
function ViewHeader({
  title,
  sub
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 'var(--s-6)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 26px/1.15 var(--font-ui)',
      letterSpacing: '-.02em',
      color: 'var(--text-hi)'
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      color: 'var(--text-lo)',
      font: '400 13px/1.5 var(--font-ui)',
      maxWidth: 640
    }
  }, sub));
}
window.KITViews = {
  LiveView,
  MidView,
  GraveyardView,
  NftView,
  StablesView,
  RwaView,
  InfraView,
  MarketsView,
  GeoView,
  PolicyView,
  NewsView,
  AgentView
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/views.jsx", error: String((e && e.message) || e) }); }

__ds_ns.DeltaValue = __ds_scope.DeltaValue;

__ds_ns.KpiTile = __ds_scope.KpiTile;

__ds_ns.KpiRow = __ds_scope.KpiRow;

__ds_ns.Sparkline = __ds_scope.Sparkline;

__ds_ns.VerdictPill = __ds_scope.VerdictPill;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.SearchInput = __ds_scope.SearchInput;

__ds_ns.SegmentedControl = __ds_scope.SegmentedControl;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.CardTitle = __ds_scope.CardTitle;

__ds_ns.CardMeta = __ds_scope.CardMeta;

__ds_ns.CardStat = __ds_scope.CardStat;

__ds_ns.Panel = __ds_scope.Panel;

})();
