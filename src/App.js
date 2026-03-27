import { useState, useEffect, useCallback, useRef } from "react";

const RAWG_KEY = "4d7a97bce7df4cfc94e9981345756746";
const RAWG_BASE = "https://api.rawg.io/api";

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

// ── Genre → RAWG slug map ──────────────────────────────────────────────────
const GENRE_MAP = {
  "Action":      "action",
  "Adventure":   "adventure",
  "RPG":         "role-playing-games-rpg",
  "Shooter":     "shooter",
  "Strategy":    "strategy",
  "Puzzle":      "puzzle",
  "Platformer":  "platformer",
  "Sports":      "sports",
  "Racing":      "racing",
  "Indie":       "indie",
  "Simulation":  "simulation",
  "Fighting":    "fighting",
  "Arcade":      "arcade",
  "Family":      "family",
};

// ── Difficulty inferred from genres ───────────────────────────────────────
function inferDifficulty(genres = []) {
  const names = genres.map(g => g.name);
  const hard = ["Shooter", "Fighting", "Strategy", "Platformer"];
  const easy = ["Puzzle", "Simulation", "Card", "Sports", "Family"];
  if (hard.some(g => names.includes(g))) return "Challenging";
  if (easy.some(g => names.includes(g))) return "Relaxed";
  return "Medium";
}

// ── Multiplayer tag check ──────────────────────────────────────────────────
function getMultiplayerType(game) {
  const tags = (game.tags || []).map(t => t.slug);
  if (tags.includes("co-op") || tags.includes("local-co-op") || tags.includes("online-co-op")) return "co-op";
  if (tags.includes("multiplayer") || tags.includes("online-multiplayer")) return "multiplayer";
  if (tags.includes("singleplayer")) return "singleplayer";
  return "unknown";
}

// ── Price tier inferred from release year + rating ────────────────────────
function getPriceTier(game) {
  const year = parseInt((game.released || "2000").split("-")[0]);
  const rating = game.rating || 3;
  if (year < 2015 || rating < 2.5) return "free-budget"; // likely cheap/free
  if (year >= 2022 && rating > 3.5) return "full-price";  // likely $60+
  return "mid";
}

function computeScores(game) {
  const rating = game.rating || 3;
  const ratingCount = game.ratings_count || 0;
  const metacritic = game.metacritic || 0;
  const genres = (game.genres || []).map(g => g.name);
  const primaryGenre = genres[0] || "default";
  const hltb = HLTB_GENRE_TIMES[primaryGenre] || HLTB_GENRE_TIMES["default"];

  const shortFriendly = ["Puzzle", "Arcade", "Card", "Fighting", "Racing", "Sports"];
  const longForm = ["RPG", "Strategy", "Simulation"];
  let timeScore = 70;
  if (shortFriendly.some(g => genres.includes(g))) timeScore = Math.min(99, timeScore + 22);
  if (longForm.some(g => genres.includes(g))) timeScore = Math.max(30, timeScore - 25);
  if (genres.includes("Indie")) timeScore = Math.min(99, timeScore + 8);
  timeScore = Math.round(timeScore + (Math.random() * 6 - 3));

  const deepAdventure = ["RPG", "Adventure", "Action"];
  let advScore = 55;
  if (deepAdventure.some(g => genres.includes(g))) advScore += 30;
  if (genres.includes("Indie")) advScore += 10;
  if (metacritic > 80) advScore += 10;
  advScore = Math.min(99, Math.round(advScore + (Math.random() * 8 - 4)));

  let worthScore = Math.round((rating / 5) * 60 + 30);
  if (metacritic > 85) worthScore = Math.min(99, worthScore + 10);
  if (ratingCount > 1000) worthScore = Math.min(99, worthScore + 5);
  worthScore = Math.round(worthScore + (Math.random() * 6 - 3));

  const difficulty = inferDifficulty(game.genres);
  const esrb = game.esrb_rating?.name || "Not Rated";
  return { timeScore, advScore, worthScore, difficulty, hltb, esrb };
}

function getSessionCategory(genres = []) {
  const names = genres.map(g => g.name);
  if (["Puzzle","Arcade","Card","Fighting","Racing","Sports"].some(g => names.includes(g))) return "short";
  if (["RPG","Strategy","Simulation"].some(g => names.includes(g))) return "long";
  return "medium";
}

function getAccentColor(genres = []) {
  const g = genres[0]?.name || "";
  const map = {
    "RPG":"#c084fc","Action":"#f87171","Adventure":"#34d399","Shooter":"#fb923c",
    "Strategy":"#60a5fa","Puzzle":"#fbbf24","Platformer":"#4ade80","Indie":"#a78bfa",
    "Sports":"#38bdf8","Racing":"#f97316","Simulation":"#86efac","Fighting":"#ef4444",
    "Arcade":"#facc15","Card":"#e879f9","Family":"#f9a8d4",
  };
  return map[g] || "#94a3b8";
}

function getStoreLinks(game) {
  const name = encodeURIComponent(game.name || "");
  return [
    { name: "Steam",       url: `https://store.steampowered.com/search/?term=${name}`,                    icon: "🖥" },
    { name: "Epic",        url: `https://store.epicgames.com/en-US/browse?q=${name}`,                     icon: "⚡" },
    { name: "GOG",         url: `https://www.gog.com/games?search=${name}`,                               icon: "🌍" },
    { name: "PSN",         url: `https://store.playstation.com/en-us/search/${name}`,                     icon: "🎮" },
    { name: "Xbox",        url: `https://www.xbox.com/en-US/Search/Results?q=${name}`,                    icon: "⬜" },
  ];
}

// ── Filter pill component ──────────────────────────────────────────────────
function Pill({ label, active, color = "white", onClick }) {
  return (
    <button onClick={onClick} style={{
      background: active ? (color === "white" ? "white" : color + "25") : "rgba(255,255,255,0.05)",
      color: active ? (color === "white" ? "#080810" : color) : "rgba(255,255,255,0.45)",
      border: `1px solid ${active ? (color === "white" ? "white" : color + "70") : "rgba(255,255,255,0.1)"}`,
      borderRadius: 100, padding: "6px 13px", cursor: "pointer", fontSize: 11,
      fontFamily: "'Space Mono', monospace", transition: "all 0.2s",
      fontWeight: active ? 700 : 400, whiteSpace: "nowrap",
    }}>{label}</button>
  );
}

// ── Filter section label ───────────────────────────────────────────────────
function FilterLabel({ children }) {
  return <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: "'Space Mono', monospace", letterSpacing: 1.5, marginBottom: 6, marginTop: 4 }}>{children}</div>;
}

// ── Score Ring ─────────────────────────────────────────────────────────────
function ScoreRing({ value, label, color, size = 64 }) {
  const r = size * 0.38, circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(value, 99) / 100) * circ;
  const cx = size / 2, cy = size / 2;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={5} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={5}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(.4,0,.2,1)" }} />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill="white"
          fontSize={size * 0.2} fontWeight="700"
          style={{ transform: `rotate(90deg)`, transformOrigin: `${cx}px ${cy}px`, fontFamily: "'Space Mono', monospace" }}>
          {value}
        </text>
      </svg>
      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", letterSpacing: 1.2, textTransform: "uppercase", fontFamily: "'Space Mono', monospace" }}>{label}</span>
    </div>
  );
}

// ── Multiplayer badge ──────────────────────────────────────────────────────
function MultiplayerBadge({ type }) {
  const map = {
    "co-op":        { label: "Co-op",       color: "#34d399" },
    "multiplayer":  { label: "Multiplayer", color: "#38bdf8" },
    "singleplayer": { label: "Solo",        color: "#a78bfa" },
  };
  const cfg = map[type];
  if (!cfg) return null;
  return (
    <span style={{ background: cfg.color + "20", border: `1px solid ${cfg.color}40`, borderRadius: 20, padding: "2px 8px", fontSize: 9, color: cfg.color, fontFamily: "'Space Mono', monospace" }}>
      {cfg.label}
    </span>
  );
}

// ── Difficulty badge ───────────────────────────────────────────────────────
function DiffBadge({ level }) {
  const map = { Relaxed: "#4ade80", Medium: "#fbbf24", Challenging: "#f87171" };
  const color = map[level] || "#94a3b8";
  return (
    <span style={{ background: color + "20", border: `1px solid ${color}40`, borderRadius: 20, padding: "2px 8px", fontSize: 9, color, fontFamily: "'Space Mono', monospace" }}>
      {level}
    </span>
  );
}

// ── Game Card ──────────────────────────────────────────────────────────────
function GameCard({ game, onClick }) {
  const [hov, setHov] = useState(false);
  const scores = computeScores(game);
  const color = getAccentColor(game.genres);
  const bg = game.background_image;
  const sessionCat = getSessionCategory(game.genres);
  const sessionLabel = { short: "⚡ Quick", medium: "🕐 Mid", long: "🏔 Long" }[sessionCat];
  const mpType = getMultiplayerType(game);

  return (
    <div onClick={() => onClick(game)} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        borderRadius: 18, overflow: "hidden", cursor: "pointer", position: "relative",
        border: `1px solid ${hov ? color + "70" : "rgba(255,255,255,0.07)"}`,
        transform: hov ? "translateY(-4px) scale(1.01)" : "translateY(0) scale(1)",
        transition: "all 0.28s cubic-bezier(.4,0,.2,1)",
        boxShadow: hov ? `0 20px 60px ${color}30` : "0 2px 12px rgba(0,0,0,0.4)",
        background: "#0d0d18",
      }}>
      <div style={{ position: "relative", height: 130, overflow: "hidden", background: "#1a1a2e" }}>
        {bg
          ? <img src={bg} alt={game.name} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.8, transition: "transform 0.4s", transform: hov ? "scale(1.05)" : "scale(1)" }} />
          : <div style={{ width: "100%", height: "100%", background: `linear-gradient(135deg, ${color}30, #0d0d18)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36 }}>🎮</div>}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, #0d0d18 0%, transparent 60%)" }} />
        <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)", borderRadius: 20, padding: "2px 8px", fontSize: 9, color, fontFamily: "'Space Mono', monospace", border: `1px solid ${color}40` }}>{sessionLabel}</div>
        {game.metacritic && <div style={{ position: "absolute", top: 8, right: 8, background: game.metacritic > 74 ? "#16a34a" : game.metacritic > 59 ? "#ca8a04" : "#dc2626", borderRadius: 7, padding: "2px 7px", fontSize: 10, color: "white", fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>MC {game.metacritic}</div>}
      </div>

      <div style={{ padding: "12px 14px 14px" }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 14, fontFamily: "'Bitter', serif", fontWeight: 700, color: "white", lineHeight: 1.2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{game.name}</h3>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "'Space Mono', monospace", marginBottom: 6 }}>
          {(game.genres || []).slice(0, 2).map(g => g.name).join(" · ")}
        </div>

        {/* Badges row */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
          <DiffBadge level={scores.difficulty} />
          <MultiplayerBadge type={mpType} />
        </div>

        <div style={{ display: "flex", justifyContent: "space-around", margin: "10px 0", padding: "8px 0", borderTop: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <ScoreRing value={scores.timeScore} label="Time" color={color} />
          <ScoreRing value={scores.advScore} label="Adventure" color={color} />
          <ScoreRing value={scores.worthScore} label="Worth It" color={color} />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "'Space Mono', monospace" }}>
          <span>⏱ {scores.hltb.session}</span>
          <span>📖 {scores.hltb.main}</span>
        </div>
      </div>
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────
function Modal({ game, onClose }) {
  if (!game) return null;
  const scores = computeScores(game);
  const color = getAccentColor(game.genres);
  const stores = getStoreLinks(game);
  const mpType = getMultiplayerType(game);
  const priceTier = getPriceTier(game);
  const priceTierLabel = { "free-budget": "Free / Budget", "mid": "~$20–$40", "full-price": "$50–$70" }[priceTier];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(12px)" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#0d0d18", border: `1px solid ${color}50`, borderRadius: 24, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: `0 0 100px ${color}25`, position: "relative" }}>
        {game.background_image && (
          <div style={{ height: 190, overflow: "hidden", borderRadius: "24px 24px 0 0", position: "relative" }}>
            <img src={game.background_image} alt={game.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <div style={{ position: "absolute", inset: 0, background: `linear-gradient(to top, #0d0d18, transparent 50%)` }} />
          </div>
        )}
        <div style={{ padding: 22 }}>
          <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.15)", color: "white", borderRadius: 10, width: 32, height: 32, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>

          <div style={{ fontSize: 10, color, fontFamily: "'Space Mono', monospace", letterSpacing: 1.5, marginBottom: 4 }}>{(game.genres || []).map(g => g.name).join(" · ")}</div>
          <h2 style={{ margin: "0 0 4px", fontSize: 24, fontFamily: "'Bitter', serif", color: "white", lineHeight: 1.2 }}>{game.name}</h2>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
            <DiffBadge level={scores.difficulty} />
            <MultiplayerBadge type={mpType} />
            <span style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: "2px 8px", fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "'Space Mono', monospace" }}>💰 {priceTierLabel}</span>
            <span style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: "2px 8px", fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "'Space Mono', monospace" }}>🔞 {scores.esrb}</span>
          </div>

          <div style={{ display: "flex", justifyContent: "space-around", marginBottom: 20, padding: 14, background: "rgba(255,255,255,0.03)", borderRadius: 14, border: "1px solid rgba(255,255,255,0.06)" }}>
            <ScoreRing value={scores.timeScore} label="Time Friendly" color={color} size={70} />
            <ScoreRing value={scores.advScore} label="Adventure" color={color} size={70} />
            <ScoreRing value={scores.worthScore} label="Worth It" color={color} size={70} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 18 }}>
            {[
              ["⏱ Session", scores.hltb.session],
              ["📖 Main Story", scores.hltb.main],
              ["🏆 100%", scores.hltb.complete],
              ["🎯 Difficulty", scores.difficulty],
              ["👥 Players", mpType === "unknown" ? "N/A" : mpType],
              ["💰 Est. Price", priceTierLabel],
              ["⭐ Rating", game.rating ? `${game.rating}/5` : "N/A"],
              ["📊 Metacritic", game.metacritic || "N/A"],
            ].map(([k, v]) => (
              <div key={k} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.28)", fontFamily: "'Space Mono', monospace", marginBottom: 3 }}>{k}</div>
                <div style={{ fontSize: 12, color: "white", fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Platforms */}
          {(game.platforms || []).length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.28)", fontFamily: "'Space Mono', monospace", letterSpacing: 1.5, marginBottom: 8 }}>AVAILABLE ON</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {(game.platforms || []).map(p => (
                  <span key={p.platform.id} style={{ background: `${color}15`, border: `1px solid ${color}30`, borderRadius: 20, padding: "3px 9px", fontSize: 9, color, fontFamily: "'Space Mono', monospace" }}>{p.platform.name}</span>
                ))}
              </div>
            </div>
          )}

          {/* Store links */}
          <div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.28)", fontFamily: "'Space Mono', monospace", letterSpacing: 1.5, marginBottom: 8 }}>BUY / FIND THIS GAME</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {stores.map(s => (
                <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer"
                  style={{ background: `${color}12`, border: `1px solid ${color}35`, borderRadius: 10, padding: "8px 12px", textAlign: "center", color: "white", textDecoration: "none", fontSize: 11, fontFamily: "'Space Mono', monospace", transition: "background 0.2s", flex: "1 0 auto" }}
                  onMouseEnter={e => e.currentTarget.style.background = `${color}28`}
                  onMouseLeave={e => e.currentTarget.style.background = `${color}12`}>
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

// ── Filter Drawer (mobile-friendly collapsible) ────────────────────────────
function FilterDrawer({ filters, setFilters, onReset }) {
  const [open, setOpen] = useState(false);
  const activeCount = Object.values(filters).filter(v => v !== "all" && v !== false).length;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto 16px", padding: "0 16px" }}>
      <button onClick={() => setOpen(!open)} style={{
        background: activeCount > 0 ? "rgba(167,139,250,0.15)" : "rgba(255,255,255,0.05)",
        border: `1px solid ${activeCount > 0 ? "#a78bfa60" : "rgba(255,255,255,0.1)"}`,
        borderRadius: 12, padding: "10px 16px", color: "white", cursor: "pointer",
        fontSize: 12, fontFamily: "'Space Mono', monospace", display: "flex", alignItems: "center", gap: 8,
      }}>
        <span>⚙ Filters</span>
        {activeCount > 0 && <span style={{ background: "#a78bfa", color: "#080810", borderRadius: 20, padding: "1px 7px", fontSize: 10, fontWeight: 700 }}>{activeCount}</span>}
        <span style={{ marginLeft: "auto", opacity: 0.5 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 16, marginTop: 8, display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Session length */}
          <div>
            <FilterLabel>⏱ SESSION LENGTH</FilterLabel>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[["all","All"],["short","⚡ Quick <1hr"],["medium","🕐 1–2 hrs"],["long","🏔 2+ hrs"]].map(([v,l]) => (
                <Pill key={v} label={l} active={filters.time === v} onClick={() => setFilters(f => ({ ...f, time: v }))} />
              ))}
            </div>
          </div>

          {/* Genre */}
          <div>
            <FilterLabel>🎮 GENRE</FilterLabel>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["all","Action","Adventure","RPG","Shooter","Strategy","Puzzle","Platformer","Sports","Racing","Indie","Simulation","Fighting","Arcade","Family"].map(v => (
                <Pill key={v} label={v === "all" ? "All Genres" : v} active={filters.genre === v} color="#60a5fa" onClick={() => setFilters(f => ({ ...f, genre: v }))} />
              ))}
            </div>
          </div>

          {/* Platform */}
          <div>
            <FilterLabel>🖥 PLATFORM</FilterLabel>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[["all","All"],["pc","PC"],["playstation","PlayStation"],["xbox","Xbox"],["nintendo","Nintendo"],["mobile","Mobile"]].map(([v,l]) => (
                <Pill key={v} label={l} active={filters.platform === v} color="#a78bfa" onClick={() => setFilters(f => ({ ...f, platform: v }))} />
              ))}
            </div>
          </div>

          {/* Difficulty */}
          <div>
            <FilterLabel>🎯 DIFFICULTY</FilterLabel>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[["all","All"],["easy","Relaxed"],["medium","Medium"],["hard","Challenging"]].map(([v,l]) => (
                <Pill key={v} label={l} active={filters.difficulty === v} color="#fbbf24" onClick={() => setFilters(f => ({ ...f, difficulty: v }))} />
              ))}
            </div>
          </div>

          {/* Multiplayer */}
          <div>
            <FilterLabel>👥 PLAY STYLE</FilterLabel>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[["all","All"],["singleplayer","Solo Only"],["multiplayer","Multiplayer"],["co-op","Co-op"]].map(([v,l]) => (
                <Pill key={v} label={l} active={filters.multiplayer === v} color="#34d399" onClick={() => setFilters(f => ({ ...f, multiplayer: v }))} />
              ))}
            </div>
          </div>

          {/* Price */}
          <div>
            <FilterLabel>💰 PRICE RANGE</FilterLabel>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[["all","All Prices"],["free-budget","Free / Budget"],["mid","~$20–$40"],["full-price","$50–$70"]].map(([v,l]) => (
                <Pill key={v} label={l} active={filters.price === v} color="#fb923c" onClick={() => setFilters(f => ({ ...f, price: v }))} />
              ))}
            </div>
          </div>

          {/* Reset */}
          {activeCount > 0 && (
            <button onClick={onReset} style={{ alignSelf: "flex-start", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "7px 14px", color: "#f87171", fontSize: 11, cursor: "pointer", fontFamily: "'Space Mono', monospace" }}>
              ✕ Clear all filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
const DEFAULT_FILTERS = { time: "all", genre: "all", platform: "all", difficulty: "all", multiplayer: "all", price: "all" };
const platformMap = { all: "", pc: "4", playstation: "187", xbox: "186", nintendo: "7", mobile: "21,3" };
const sortMap = { rating: "-rating", metacritic: "-metacritic", newest: "-released", popular: "-added" };

export default function App() {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sortBy, setSortBy] = useState("rating");
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [minutes, setMinutes] = useState("");
  const debounceRef = useRef(null);

  const fetchGames = useCallback(async (q, f, sort, pg) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ key: RAWG_KEY, page_size: 20, page: pg, ordering: sortMap[sort] || "-rating" });
      if (q) params.set("search", q);
      if (f.platform !== "all" && platformMap[f.platform]) params.set("platforms", platformMap[f.platform]);

      // Genre filter
      const genreFilters = [];
      if (f.time === "short") genreFilters.push("puzzle,arcade,card-games,fighting,racing,sports");
      if (f.time === "long")  genreFilters.push("role-playing-games-rpg,strategy,simulation");
      if (f.genre !== "all" && GENRE_MAP[f.genre]) genreFilters.push(GENRE_MAP[f.genre]);
      if (genreFilters.length) params.set("genres", genreFilters.join(","));

      // Tags for multiplayer
      if (f.multiplayer === "singleplayer") params.set("tags", "singleplayer");
      if (f.multiplayer === "multiplayer")  params.set("tags", "multiplayer");
      if (f.multiplayer === "co-op")        params.set("tags", "co-op");

      const res = await fetch(`${RAWG_BASE}/games?${params}`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();

      // Client-side difficulty + price filter
      let results = data.results || [];
      if (f.difficulty !== "all") {
        results = results.filter(g => {
          const d = inferDifficulty(g.genres || []);
          if (f.difficulty === "easy") return d === "Relaxed";
          if (f.difficulty === "medium") return d === "Medium";
          if (f.difficulty === "hard") return d === "Challenging";
          return true;
        });
      }
      if (f.price !== "all") {
        results = results.filter(g => getPriceTier(g) === f.price);
      }

      setGames(results);
      setTotalCount(data.count || 0);
      setHasLoaded(true);
    } catch (e) {
      setError("Couldn't reach the game database. Check your RAWG API key at rawg.io/apidocs");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!hasLoaded && !search) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setPage(1); fetchGames(search, filters, sortBy, 1); }, 400);
  }, [search, filters, sortBy]);

  useEffect(() => { if (hasLoaded) fetchGames(search, filters, sortBy, page); }, [page]);

  const handleTimeSearch = () => {
    const m = parseInt(minutes);
    if (!m) return;
    const cat = m <= 40 ? "short" : m <= 100 ? "medium" : "long";
    setFilters(f => ({ ...f, time: cat }));
    setPage(1);
    fetchGames(search, { ...filters, time: cat }, sortBy, 1);
  };

  const resetFilters = () => { setFilters(DEFAULT_FILTERS); setPage(1); fetchGames(search, DEFAULT_FILTERS, sortBy, 1); };
  const handleInitialLoad = () => fetchGames("", DEFAULT_FILTERS, "rating", 1);
  const activeFilterCount = Object.values(filters).filter(v => v !== "all").length;

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
        .card-anim { animation: fadeIn 0.4s ease forwards; opacity: 0; }
        a { color: inherit; }
      `}</style>

      <div style={{ minHeight: "100vh", background: "#080810", backgroundImage: "radial-gradient(ellipse at 15% 15%, #1a0a2e 0%, transparent 45%), radial-gradient(ellipse at 85% 85%, #0a1628 0%, transparent 45%)" }}>

        {/* Header */}
        <div style={{ textAlign: "center", padding: "40px 20px 24px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 100, padding: "4px 12px", fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: 2, marginBottom: 16, fontFamily: "'Space Mono', monospace" }}>
            ◈ POWERED BY RAWG · 500,000+ GAMES
          </div>
          <h1 style={{ margin: "0 0 6px", fontSize: "clamp(32px, 6vw, 58px)", fontFamily: "'Bitter', serif", fontWeight: 900, color: "white", lineHeight: 1.05, letterSpacing: -1 }}>Worth My Time?</h1>
          <p style={{ color: "rgba(255,255,255,0.38)", fontSize: 13, margin: "0 auto", maxWidth: 360, lineHeight: 1.7, fontFamily: "'Lora', serif", fontStyle: "italic" }}>
            Real game intelligence for busy people. Filter by time, genre, difficulty, price & more.
          </p>
        </div>

        {/* Quick Finder */}
        <div style={{ maxWidth: 560, margin: "0 auto 20px", padding: "0 16px" }}>
          <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 14, padding: 14 }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: "'Space Mono', monospace", letterSpacing: 2, marginBottom: 8 }}>⚡ I HAVE THIS MANY MINUTES</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="number" placeholder="e.g. 45" value={minutes} onChange={e => setMinutes(e.target.value)} onKeyDown={e => e.key === "Enter" && handleTimeSearch()}
                style={{ flex: 1, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 9, padding: "10px 12px", color: "white", fontSize: 12, fontFamily: "'Space Mono', monospace" }} />
              <button onClick={handleTimeSearch} style={{ background: "white", color: "#080810", border: "none", borderRadius: 9, padding: "10px 18px", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "'Space Mono', monospace", whiteSpace: "nowrap" }}>Find Games →</button>
            </div>
          </div>
        </div>

        {/* Search */}
        <div style={{ maxWidth: 560, margin: "0 auto 16px", padding: "0 16px" }}>
          <input placeholder="Search 500,000+ games — Elden Ring, Minecraft, Celeste..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "12px 16px", color: "white", fontSize: 12, fontFamily: "'Space Mono', monospace" }} />
        </div>

        {/* Filter Drawer */}
        <FilterDrawer filters={filters} setFilters={setFilters} onReset={resetFilters} />

        {/* Sort & Count */}
        {hasLoaded && (
          <div style={{ maxWidth: 900, margin: "0 auto 14px", padding: "0 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "'Space Mono', monospace" }}>
              {totalCount.toLocaleString()} games
              {activeFilterCount > 0 && <span style={{ color: "#a78bfa", marginLeft: 6 }}>· {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""} active</span>}
            </div>
            <div style={{ display: "flex", gap: 5 }}>
              {[["rating","Top Rated"],["metacritic","Metacritic"],["newest","Newest"],["popular","Popular"]].map(([v,l]) => (
                <button key={v} onClick={() => { setSortBy(v); setPage(1); }}
                  style={{ background: sortBy === v ? "rgba(167,139,250,0.2)" : "transparent", color: sortBy === v ? "#a78bfa" : "rgba(255,255,255,0.3)", border: `1px solid ${sortBy === v ? "#a78bfa50" : "rgba(255,255,255,0.07)"}`, borderRadius: 7, padding: "4px 9px", cursor: "pointer", fontSize: 10, fontFamily: "'Space Mono', monospace", transition: "all 0.2s" }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Content */}
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 16px" }}>
          {!hasLoaded && !loading && (
            <div style={{ textAlign: "center", padding: "50px 20px" }}>
              <div style={{ fontSize: 44, marginBottom: 14 }}>🎮</div>
              <h2 style={{ color: "white", fontFamily: "'Bitter', serif", margin: "0 0 8px" }}>500,000+ Games Ready</h2>
              <p style={{ color: "rgba(255,255,255,0.4)", fontFamily: "'Space Mono', monospace", fontSize: 11, marginBottom: 24 }}>Use the filters above or browse everything</p>
              <button onClick={handleInitialLoad} style={{ background: "white", color: "#080810", border: "none", borderRadius: 12, padding: "13px 28px", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "'Space Mono', monospace" }}>Browse Top Rated →</button>
            </div>
          )}

          {loading && (
            <div style={{ textAlign: "center", padding: "50px 20px" }}>
              <div style={{ display: "inline-flex", gap: 6 }}>
                {[0,1,2].map(i => <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: "#a78bfa", animation: "pulse 1.2s ease infinite", animationDelay: `${i * 0.2}s` }} />)}
              </div>
              <div style={{ color: "rgba(255,255,255,0.3)", fontFamily: "'Space Mono', monospace", fontSize: 11, marginTop: 10 }}>Searching the database...</div>
            </div>
          )}

          {error && (
            <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, padding: 18, marginBottom: 18, color: "#fca5a5", fontFamily: "'Space Mono', monospace", fontSize: 11, lineHeight: 1.7 }}>⚠️ {error}</div>
          )}

          {!loading && games.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 14, marginBottom: 28 }}>
              {games.map((g, i) => (
                <div key={g.id} className="card-anim" style={{ animationDelay: `${i * 0.04}s` }}>
                  <GameCard game={g} onClick={setSelected} />
                </div>
              ))}
            </div>
          )}

          {!loading && hasLoaded && games.length === 0 && !error && (
            <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.3)", fontFamily: "'Space Mono', monospace", fontSize: 11 }}>
              No games found. Try adjusting your filters.
            </div>
          )}

          {hasLoaded && !loading && totalCount > 20 && (
            <div style={{ display: "flex", justifyContent: "center", gap: 10, alignItems: "center", paddingBottom: 40 }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: page === 1 ? "rgba(255,255,255,0.2)" : "white", borderRadius: 9, padding: "8px 14px", cursor: page === 1 ? "default" : "pointer", fontSize: 11, fontFamily: "'Space Mono', monospace" }}>← Prev</button>
              <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, fontFamily: "'Space Mono', monospace" }}>Page {page} of {Math.min(Math.ceil(totalCount / 20), 500)}</span>
              <button onClick={() => setPage(p => p + 1)}
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white", borderRadius: 9, padding: "8px 14px", cursor: "pointer", fontSize: 11, fontFamily: "'Space Mono', monospace" }}>Next →</button>
            </div>
          )}
        </div>

        <div style={{ textAlign: "center", paddingBottom: 28, color: "rgba(255,255,255,0.12)", fontSize: 9, letterSpacing: 2, fontFamily: "'Space Mono', monospace" }}>
          WORTH MY TIME · RAWG.IO · HLTB · YOUR SCORES
        </div>
      </div>

      <Modal game={selected} onClose={() => setSelected(null)} />
    </>
  );
}
