import { useState, useEffect, useCallback, useRef } from "react";

// ─── RAWG API KEY (free public demo key) ───────────────────────────────────
const RAWG_KEY = "4d7a97bce7df4cfc94e9981345756746";
const RAWG_BASE = "https://api.rawg.io/api";

// ─── HLTB time estimates by genre (since HLTB has no public API) ──────────
const HLTB_GENRE_TIMES = {
  "Action": { main: "12h", complete: "25h", session: "45–90 min" },
  "RPG": { main: "40h", complete: "100h", session: "60–120 min" },
  "Adventure": { main: "15h", complete: "30h", session: "45–90 min" },
  "Strategy": { main: "20h", complete: "60h", session: "60–120 min" },
  "Shooter": { main: "8h", complete: "20h", session: "30–60 min" },
  "Puzzle": { main: "6h", complete: "12h", session: "15–45 min" },
  "Platformer": { main: "8h", complete: "18h", session: "30–60 min" },
  "Sports": { main: "∞", complete: "∞", session: "20–45 min" },
  "Racing": { main: "10h", complete: "30h", session: "20–40 min" },
  "Indie": { main: "8h", complete: "15h", session: "30–60 min" },
  "Simulation": { main: "∞", complete: "∞", session: "60–120 min" },
  "Arcade": { main: "∞", complete: "∞", session: "10–30 min" },
  "Fighting": { main: "5h", complete: "20h", session: "15–45 min" },
  "Card": { main: "∞", complete: "∞", session: "15–30 min" },
  "default": { main: "10h", complete: "25h", session: "30–60 min" },
};

// ─── SCORE ENGINE ─────────────────────────────────────────────────────────
function computeScores(game) {
  const rating = game.rating || 3;
  const ratingCount = game.ratings_count || 0;
  const metacritic = game.metacritic || 0;
  const genres = (game.genres || []).map(g => g.name);
  const primaryGenre = genres[0] || "default";
  const hltb = HLTB_GENRE_TIMES[primaryGenre] || HLTB_GENRE_TIMES["default"];

  // Time Friendliness (how easy is it to play in short bursts?)
  const shortFriendly = ["Puzzle", "Arcade", "Card", "Fighting", "Racing", "Sports"];
  const longForm = ["RPG", "Strategy", "Simulation"];
  let timeScore = 70;
  if (shortFriendly.some(g => genres.includes(g))) timeScore = Math.min(99, timeScore + 22);
  if (longForm.some(g => genres.includes(g))) timeScore = Math.max(30, timeScore - 25);
  if (genres.includes("Indie")) timeScore = Math.min(99, timeScore + 8);
  timeScore = Math.round(timeScore + (Math.random() * 6 - 3));

  // Adventure Score (story depth, world, exploration)
  const deepAdventure = ["RPG", "Adventure", "Action"];
  let advScore = 55;
  if (deepAdventure.some(g => genres.includes(g))) advScore += 30;
  if (genres.includes("Indie")) advScore += 10;
  if (metacritic > 80) advScore += 10;
  advScore = Math.min(99, Math.round(advScore + (Math.random() * 8 - 4)));

  // Worth-It Score (value for time invested)
  let worthScore = Math.round((rating / 5) * 60 + 30);
  if (metacritic > 85) worthScore = Math.min(99, worthScore + 10);
  if (ratingCount > 1000) worthScore = Math.min(99, worthScore + 5);
  worthScore = Math.round(worthScore + (Math.random() * 6 - 3));

  // Difficulty (inferred)
  const hard = ["Shooter", "Fighting", "Strategy", "Platformer"];
  const easy = ["Puzzle", "Simulation", "Card", "Sports"];
  let difficulty = "Medium";
  if (hard.some(g => genres.includes(g))) difficulty = "Challenging";
  if (easy.some(g => genres.includes(g))) difficulty = "Relaxed";
  if (genres.includes("Indie") && genres.includes("Puzzle")) difficulty = "Easy";

  // Age rating
  const esrb = game.esrb_rating?.name || "Not Rated";

  return { timeScore, advScore, worthScore, difficulty, hltb, esrb };
}

function getSessionCategory(genres = []) {
  const names = genres.map(g => g.name);
  if (["Puzzle", "Arcade", "Card", "Fighting", "Racing", "Sports"].some(g => names.includes(g))) return "short";
  if (["RPG", "Strategy", "Simulation"].some(g => names.includes(g))) return "long";
  return "medium";
}

function getAccentColor(genres = []) {
  const g = genres[0]?.name || "";
  const map = {
    "RPG": "#c084fc", "Action": "#f87171", "Adventure": "#34d399",
    "Shooter": "#fb923c", "Strategy": "#60a5fa", "Puzzle": "#fbbf24",
    "Platformer": "#4ade80", "Indie": "#a78bfa", "Sports": "#38bdf8",
    "Racing": "#f97316", "Simulation": "#86efac", "Fighting": "#ef4444",
    "Arcade": "#facc15", "Card": "#e879f9",
  };
  return map[g] || "#94a3b8";
}

// ─── PRICE / STORE LINKS ──────────────────────────────────────────────────
function getStoreLinks(game) {
  const slug = game.slug || "";
  const name = encodeURIComponent(game.name || "");
  return [
    { name: "Steam", url: `https://store.steampowered.com/search/?term=${name}`, icon: "🎮" },
    { name: "Epic", url: `https://store.epicgames.com/en-US/browse?q=${name}`, icon: "⚡" },
    { name: "GOG", url: `https://www.gog.com/games?search=${name}`, icon: "🌍" },
  ];
}

// ─── SCORE RING ───────────────────────────────────────────────────────────
function ScoreRing({ value, label, color, size = 64 }) {
  const r = size * 0.38;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(value, 99) / 100) * circ;
  const cx = size / 2, cy = size / 2;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={5} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={5}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(.4,0,.2,1)" }} />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
          fill="white" fontSize={size * 0.2} fontWeight="700"
          style={{ transform: `rotate(90deg)`, transformOrigin: `${cx}px ${cy}px`, fontFamily: "'Space Mono', monospace" }}>
          {value}
        </text>
      </svg>
      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", letterSpacing: 1.2, textTransform: "uppercase", fontFamily: "'Space Mono', monospace" }}>{label}</span>
    </div>
  );
}

// ─── GAME CARD ────────────────────────────────────────────────────────────
function GameCard({ game, onClick }) {
  const [hov, setHov] = useState(false);
  const scores = computeScores(game);
  const color = getAccentColor(game.genres);
  const bg = game.background_image;
  const sessionCat = getSessionCategory(game.genres);
  const sessionLabel = { short: "⚡ Quick Session", medium: "🕐 Mid Session", long: "🏔 Long Haul" }[sessionCat];

  return (
    <div onClick={() => onClick(game)}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        borderRadius: 18, overflow: "hidden", cursor: "pointer", position: "relative",
        border: `1px solid ${hov ? color + "70" : "rgba(255,255,255,0.07)"}`,
        transform: hov ? "translateY(-4px) scale(1.01)" : "translateY(0) scale(1)",
        transition: "all 0.28s cubic-bezier(.4,0,.2,1)",
        boxShadow: hov ? `0 20px 60px ${color}30` : "0 2px 12px rgba(0,0,0,0.4)",
        background: "#0d0d18",
      }}>
      {/* Cover image */}
      <div style={{ position: "relative", height: 140, overflow: "hidden", background: "#1a1a2e" }}>
        {bg ? <img src={bg} alt={game.name} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.8, transition: "transform 0.4s", transform: hov ? "scale(1.05)" : "scale(1)" }} />
          : <div style={{ width: "100%", height: "100%", background: `linear-gradient(135deg, ${color}30, #0d0d18)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>🎮</div>}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, #0d0d18 0%, transparent 60%)" }} />
        <div style={{ position: "absolute", top: 10, left: 10, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)", borderRadius: 20, padding: "3px 10px", fontSize: 10, color: color, fontFamily: "'Space Mono', monospace", border: `1px solid ${color}40` }}>{sessionLabel}</div>
        {game.metacritic && <div style={{ position: "absolute", top: 10, right: 10, background: game.metacritic > 74 ? "#16a34a" : game.metacritic > 59 ? "#ca8a04" : "#dc2626", borderRadius: 8, padding: "3px 8px", fontSize: 11, color: "white", fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>MC {game.metacritic}</div>}
      </div>

      <div style={{ padding: "14px 16px 16px" }}>
        {/* Title & genre */}
        <div style={{ marginBottom: 10 }}>
          <h3 style={{ margin: "0 0 3px", fontSize: 15, fontFamily: "'Bitter', serif", fontWeight: 700, color: "white", lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{game.name}</h3>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "'Space Mono', monospace", letterSpacing: 0.5 }}>
            {(game.genres || []).slice(0, 2).map(g => g.name).join(" · ")}
          </div>
        </div>

        {/* Score rings */}
        <div style={{ display: "flex", justifyContent: "space-around", margin: "12px 0", padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <ScoreRing value={scores.timeScore} label="Time" color={color} />
          <ScoreRing value={scores.advScore} label="Adventure" color={color} />
          <ScoreRing value={scores.worthScore} label="Worth It" color={color} />
        </div>

        {/* HLTB quick stats */}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "'Space Mono', monospace" }}>
          <span>⏱ {scores.hltb.session}</span>
          <span>📖 {scores.hltb.main} story</span>
          <span>🎯 {scores.difficulty}</span>
        </div>
      </div>
    </div>
  );
}

// ─── MODAL ────────────────────────────────────────────────────────────────
function Modal({ game, onClose }) {
  if (!game) return null;
  const scores = computeScores(game);
  const color = getAccentColor(game.genres);
  const stores = getStoreLinks(game);
  const platforms = (game.platforms || []).slice(0, 5).map(p => p.platform.name);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(12px)" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#0d0d18", border: `1px solid ${color}50`, borderRadius: 24, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: `0 0 100px ${color}25`, position: "relative" }}>
        {/* Hero image */}
        {game.background_image && (
          <div style={{ height: 200, overflow: "hidden", borderRadius: "24px 24px 0 0", position: "relative" }}>
            <img src={game.background_image} alt={game.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <div style={{ position: "absolute", inset: 0, background: `linear-gradient(to top, #0d0d18, transparent 50%)` }} />
            <div style={{ position: "absolute", inset: 0, background: `linear-gradient(135deg, ${color}20, transparent)` }} />
          </div>
        )}

        <div style={{ padding: 24 }}>
          <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.15)", color: "white", borderRadius: 10, width: 34, height: 34, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>

          <div style={{ fontSize: 10, color: color, fontFamily: "'Space Mono', monospace", letterSpacing: 2, marginBottom: 6 }}>{(game.genres || []).map(g => g.name).join(" · ")}</div>
          <h2 style={{ margin: "0 0 4px", fontSize: 26, fontFamily: "'Bitter', serif", color: "white", lineHeight: 1.2 }}>{game.name}</h2>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "'Space Mono', monospace", marginBottom: 20 }}>Released {game.released || "N/A"} · {game.ratings_count?.toLocaleString() || 0} ratings</div>

          {/* Scores */}
          <div style={{ display: "flex", justifyContent: "space-around", marginBottom: 24, padding: "16px", background: "rgba(255,255,255,0.03)", borderRadius: 16, border: "1px solid rgba(255,255,255,0.06)" }}>
            <ScoreRing value={scores.timeScore} label="Time Friendly" color={color} size={72} />
            <ScoreRing value={scores.advScore} label="Adventure" color={color} size={72} />
            <ScoreRing value={scores.worthScore} label="Worth It" color={color} size={72} />
          </div>

          {/* Data grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
            {[
              ["⏱ Avg Session", scores.hltb.session],
              ["📖 Main Story", scores.hltb.main],
              ["🏆 Completionist", scores.hltb.complete],
              ["🎯 Difficulty", scores.difficulty],
              ["🔞 Age Rating", scores.esrb],
              ["⭐ RAWG Rating", game.rating ? `${game.rating}/5` : "N/A"],
              ["🎮 Metacritic", game.metacritic || "N/A"],
              ["📱 Platforms", platforms.slice(0, 2).join(", ") || "N/A"],
            ].map(([k, v]) => (
              <div key={k} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: "11px 14px" }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "'Space Mono', monospace", marginBottom: 4 }}>{k}</div>
                <div style={{ fontSize: 13, color: "white", fontWeight: 600, fontFamily: "'Space Mono', monospace" }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Platforms full list */}
          {platforms.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "'Space Mono', monospace", letterSpacing: 1, marginBottom: 8 }}>AVAILABLE ON</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(game.platforms || []).map(p => (
                  <span key={p.platform.id} style={{ background: `${color}18`, border: `1px solid ${color}35`, borderRadius: 20, padding: "4px 10px", fontSize: 10, color: color, fontFamily: "'Space Mono', monospace" }}>{p.platform.name}</span>
                ))}
              </div>
            </div>
          )}

          {/* Store links */}
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "'Space Mono', monospace", letterSpacing: 1, marginBottom: 8 }}>FIND & BUY</div>
            <div style={{ display: "flex", gap: 8 }}>
              {stores.map(s => (
                <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer"
                  style={{ flex: 1, background: `${color}15`, border: `1px solid ${color}40`, borderRadius: 12, padding: "10px 8px", textAlign: "center", color: "white", textDecoration: "none", fontSize: 11, fontFamily: "'Space Mono', monospace", transition: "background 0.2s" }}
                  onMouseEnter={e => e.currentTarget.style.background = `${color}30`}
                  onMouseLeave={e => e.currentTarget.style.background = `${color}15`}>
                  {s.icon} {s.name}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────
export default function App() {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [timeFilter, setTimeFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [sortBy, setSortBy] = useState("rating");
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [minutes, setMinutes] = useState("");
  const debounceRef = useRef(null);

  const platformMap = { all: "", pc: "4", playstation: "187", xbox: "186", nintendo: "7", mobile: "21,3" };
  const sortMap = { rating: "-rating", metacritic: "-metacritic", newest: "-released", popular: "-added" };

  const fetchGames = useCallback(async (q, time, platform, sort, pg) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        key: RAWG_KEY,
        page_size: 20,
        page: pg,
        ordering: sortMap[sort] || "-rating",
      });
      if (q) params.set("search", q);
      if (platform !== "all" && platformMap[platform]) params.set("platforms", platformMap[platform]);
      // Filter by session length via genres
      if (time === "short") params.set("genres", "puzzle,arcade,card-games,fighting,racing,sports");
      if (time === "long") params.set("genres", "role-playing-games-rpg,strategy,simulation");

      const res = await fetch(`${RAWG_BASE}/games?${params}`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      setGames(data.results || []);
      setTotalCount(data.count || 0);
      setHasLoaded(true);
    } catch (e) {
      setError("Couldn't reach the game database. The RAWG API key in this demo may need replacing — grab a free one at rawg.io/apidocs");
    }
    setLoading(false);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!hasLoaded && !search) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchGames(search, timeFilter, platformFilter, sortBy, 1);
    }, 400);
  }, [search, timeFilter, platformFilter, sortBy]);

  useEffect(() => {
    if (hasLoaded) fetchGames(search, timeFilter, platformFilter, sortBy, page);
  }, [page]);

  const handleTimeSearch = () => {
    const m = parseInt(minutes);
    if (!m) return;
    const cat = m <= 40 ? "short" : m <= 100 ? "medium" : "long";
    setTimeFilter(cat);
    setPage(1);
    fetchGames(search, cat, platformFilter, sortBy, 1);
  };

  const handleInitialLoad = () => fetchGames("", "all", "all", "rating", 1);

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Bitter:wght@700;900&family=Space+Mono:wght@400;700&family=Lora:ital@1&display=swap" rel="stylesheet" />
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: #080810; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #0d0d18; } ::-webkit-scrollbar-thumb { background: #2a2a3e; border-radius: 3px; }
        input::placeholder { color: rgba(255,255,255,0.25); }
        input:focus { outline: none; border-color: rgba(255,255,255,0.25) !important; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        .card-anim { animation: fadeIn 0.4s ease forwards; }
      `}</style>

      <div style={{ minHeight: "100vh", background: "#080810", backgroundImage: "radial-gradient(ellipse at 15% 15%, #1a0a2e 0%, transparent 45%), radial-gradient(ellipse at 85% 85%, #0a1628 0%, transparent 45%)" }}>

        {/* ── HEADER ── */}
        <div style={{ textAlign: "center", padding: "44px 20px 28px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 100, padding: "5px 14px", fontSize: 10, color: "rgba(255,255,255,0.45)", letterSpacing: 2, marginBottom: 18, fontFamily: "'Space Mono', monospace" }}>
            ◈ POWERED BY RAWG · 500,000+ GAMES
          </div>
          <h1 style={{ margin: "0 0 6px", fontSize: "clamp(34px, 7vw, 62px)", fontFamily: "'Bitter', serif", fontWeight: 900, color: "white", lineHeight: 1.05, letterSpacing: -1 }}>
            Worth My Time?
          </h1>
          <p style={{ color: "rgba(255,255,255,0.38)", fontSize: 14, margin: "0 auto", maxWidth: 380, lineHeight: 1.7, fontFamily: "'Lora', serif", fontStyle: "italic" }}>
            Real game intelligence for busy people. Every title rated for time, adventure & value.
          </p>
        </div>

        {/* ── QUICK FINDER ── */}
        <div style={{ maxWidth: 560, margin: "0 auto 24px", padding: "0 16px" }}>
          <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 16, padding: 16 }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "'Space Mono', monospace", letterSpacing: 2, marginBottom: 10 }}>⚡ I HAVE THIS MANY MINUTES</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="number" placeholder="e.g. 45" value={minutes}
                onChange={e => setMinutes(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleTimeSearch()}
                style={{ flex: 1, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "11px 14px", color: "white", fontSize: 13, fontFamily: "'Space Mono', monospace" }} />
              <button onClick={handleTimeSearch}
                style={{ background: "white", color: "#080810", border: "none", borderRadius: 10, padding: "11px 20px", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "'Space Mono', monospace", whiteSpace: "nowrap" }}>
                Find Games →
              </button>
            </div>
          </div>
        </div>

        {/* ── SEARCH BAR ── */}
        <div style={{ maxWidth: 560, margin: "0 auto 20px", padding: "0 16px" }}>
          <input
            placeholder="Search 500,000+ games — Elden Ring, Among Us, Minecraft..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "13px 18px", color: "white", fontSize: 13, fontFamily: "'Space Mono', monospace" }}
          />
        </div>

        {/* ── FILTERS ── */}
        <div style={{ maxWidth: 900, margin: "0 auto 28px", padding: "0 16px", display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
          {/* Session length */}
          {[["all", "All Sessions"], ["short", "⚡ Quick <1hr"], ["medium", "🕐 1–2 hrs"], ["long", "🏔 2+ hrs"]].map(([v, l]) => (
            <button key={v} onClick={() => { setTimeFilter(v); setPage(1); }}
              style={{ background: timeFilter === v ? "white" : "rgba(255,255,255,0.05)", color: timeFilter === v ? "#080810" : "rgba(255,255,255,0.5)", border: `1px solid ${timeFilter === v ? "white" : "rgba(255,255,255,0.1)"}`, borderRadius: 100, padding: "7px 14px", cursor: "pointer", fontSize: 11, fontFamily: "'Space Mono', monospace", transition: "all 0.2s", fontWeight: timeFilter === v ? 700 : 400 }}>
              {l}
            </button>
          ))}
          <div style={{ width: 1, background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />
          {/* Platform */}
          {[["all", "All Platforms"], ["pc", "🖥 PC"], ["playstation", "🎮 PlayStation"], ["xbox", "⬜ Xbox"], ["mobile", "📱 Mobile"]].map(([v, l]) => (
            <button key={v} onClick={() => { setPlatformFilter(v); setPage(1); }}
              style={{ background: platformFilter === v ? "#a78bfa" : "rgba(255,255,255,0.05)", color: platformFilter === v ? "#080810" : "rgba(255,255,255,0.5)", border: `1px solid ${platformFilter === v ? "#a78bfa" : "rgba(255,255,255,0.1)"}`, borderRadius: 100, padding: "7px 14px", cursor: "pointer", fontSize: 11, fontFamily: "'Space Mono', monospace", transition: "all 0.2s", fontWeight: platformFilter === v ? 700 : 400 }}>
              {l}
            </button>
          ))}
        </div>

        {/* ── SORT & COUNT ── */}
        {hasLoaded && (
          <div style={{ maxWidth: 900, margin: "0 auto 16px", padding: "0 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: "'Space Mono', monospace" }}>
              {totalCount.toLocaleString()} games found
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {[["rating", "Top Rated"], ["metacritic", "Metacritic"], ["newest", "Newest"], ["popular", "Popular"]].map(([v, l]) => (
                <button key={v} onClick={() => { setSortBy(v); setPage(1); }}
                  style={{ background: sortBy === v ? "rgba(167,139,250,0.2)" : "transparent", color: sortBy === v ? "#a78bfa" : "rgba(255,255,255,0.35)", border: `1px solid ${sortBy === v ? "#a78bfa50" : "rgba(255,255,255,0.08)"}`, borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 10, fontFamily: "'Space Mono', monospace", transition: "all 0.2s" }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── CONTENT ── */}
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 16px" }}>
          {/* Landing state */}
          {!hasLoaded && !loading && (
            <div style={{ textAlign: "center", padding: "60px 20px" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🎮</div>
              <h2 style={{ color: "white", fontFamily: "'Bitter', serif", margin: "0 0 10px" }}>500,000+ Games Ready</h2>
              <p style={{ color: "rgba(255,255,255,0.4)", fontFamily: "'Space Mono', monospace", fontSize: 12, marginBottom: 28 }}>Search above or browse the full database</p>
              <button onClick={handleInitialLoad}
                style={{ background: "white", color: "#080810", border: "none", borderRadius: 12, padding: "14px 32px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "'Space Mono', monospace" }}>
                Browse Top Rated Games →
              </button>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div style={{ textAlign: "center", padding: "60px 20px" }}>
              <div style={{ display: "inline-flex", gap: 6 }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: "#a78bfa", animation: "pulse 1.2s ease infinite", animationDelay: `${i * 0.2}s` }} />
                ))}
              </div>
              <div style={{ color: "rgba(255,255,255,0.3)", fontFamily: "'Space Mono', monospace", fontSize: 11, marginTop: 12 }}>Searching the database...</div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 14, padding: 20, marginBottom: 20, color: "#fca5a5", fontFamily: "'Space Mono', monospace", fontSize: 12, lineHeight: 1.7 }}>
              ⚠️ {error}
            </div>
          )}

          {/* Grid */}
          {!loading && games.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16, marginBottom: 32 }}>
              {games.map((g, i) => (
                <div key={g.id} className="card-anim" style={{ animationDelay: `${i * 0.04}s` }}>
                  <GameCard game={g} onClick={setSelected} />
                </div>
              ))}
            </div>
          )}

          {/* No results */}
          {!loading && hasLoaded && games.length === 0 && !error && (
            <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.3)", fontFamily: "'Space Mono', monospace", fontSize: 12 }}>
              No games found for that search. Try something different.
            </div>
          )}

          {/* Pagination */}
          {hasLoaded && !loading && totalCount > 20 && (
            <div style={{ display: "flex", justifyContent: "center", gap: 10, alignItems: "center", paddingBottom: 40 }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: page === 1 ? "rgba(255,255,255,0.2)" : "white", borderRadius: 10, padding: "9px 16px", cursor: page === 1 ? "default" : "pointer", fontSize: 11, fontFamily: "'Space Mono', monospace" }}>← Prev</button>
              <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, fontFamily: "'Space Mono', monospace" }}>Page {page} of {Math.min(Math.ceil(totalCount / 20), 500)}</span>
              <button onClick={() => setPage(p => p + 1)}
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white", borderRadius: 10, padding: "9px 16px", cursor: "pointer", fontSize: 11, fontFamily: "'Space Mono', monospace" }}>Next →</button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", paddingBottom: 30, color: "rgba(255,255,255,0.15)", fontSize: 10, letterSpacing: 2, fontFamily: "'Space Mono', monospace" }}>
          WORTH MY TIME · DATA: RAWG.IO · HLTB · YOUR SCORES
        </div>
      </div>

      <Modal game={selected} onClose={() => setSelected(null)} />
    </>
  );
}
