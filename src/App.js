import { useState, useEffect, useCallback, useRef } from "react";


// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const RAWG_KEY = "4d7a97bce7df4cfc94e9981345756746";
const RAWG_BASE = "https://api.rawg.io/api";
const TRIAL_DAYS = 7;
const PRICE = "$7.99";
const STRIPE_PK = "pk_live_51TFTAJ2K899ZvFgqThSdv7JhhI7f8wT4yazZQ13CPdGseAdBUH0jOWST04GCx4PJkJxO9GgwxOpiZLkc0ZedWlpU00PrTvKTMc";
const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/8x24gsg9K0bT63XcrU9Zm00";

// ─── EMAIL CONFIG (via Vercel serverless function) ───────────────────────
async function sendVerificationEmail(toEmail, toName, code) {
  try {
    const res = await fetch("/api/send-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to_email: toEmail, to_name: toName, code }),
    });
    return res.ok;
  } catch { return false; }
}

// ─── SUPABASE CONFIG ──────────────────────────────────────────────────────
const SUPABASE_URL = "https://bibpoybwclvifqmouxsf.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpYnBveWJ3Y2x2aWZxbW91eHNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MDYwMjgsImV4cCI6MjA5MDE4MjAyOH0.R9FBlAT6FXTMshVaFjOCPtMarVeGael5zkFKtNf5ao8";
const SUPABASE_REST = `${SUPABASE_URL}/rest/v1`;

const sbHeaders = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "Prefer": "return=representation",
};

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_REST}${path}`, {
    ...options,
    headers: { ...sbHeaders, ...(options.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// STEAM DECK / PROTON DB LAYER
// ProtonDB API: https://www.protondb.com/api/v1/reports/summaries/{appId}.json
// Steam Deck compatibility pulled from Steam API by app name matching
// Since both require a Steam App ID which RAWG provides, we use that directly
// ─────────────────────────────────────────────────────────────────────────────





// Cache for deck/proton data








// ─────────────────────────────────────────────────────────────────────────────
// STORAGE HELPERS (persistent across sessions)
// ─────────────────────────────────────────────────────────────────────────────
// ─── LOCAL STORAGE (for session only) ────────────────────────────────────
const store = {
  async get(key) {
    try { const val = localStorage.getItem(key); return val ? JSON.parse(val) : null; } catch { return null; }
  },
  async set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  },
  async del(key) {
    try { localStorage.removeItem(key); } catch {}
  },
};

// ─── SUPABASE ACCOUNT FUNCTIONS ───────────────────────────────────────────
async function sbGetAccount(email) {
  try {
    const data = await sbFetch(`/accounts?email=eq.${encodeURIComponent(email.toLowerCase().trim())}&limit=1`);
    return data?.[0] || null;
  } catch { return null; }
}

async function sbCreateAccount(email, name, passwordHash) {
  try {
    const now = Date.now();
    const trialEnds = now + TRIAL_DAYS * 24 * 60 * 60 * 1000;
    const data = await sbFetch("/accounts", {
      method: "POST",
      body: JSON.stringify({
        email: email.toLowerCase().trim(),
        name: name.trim(),
        password_hash: passwordHash,
        trial_start_at: now,
        trial_ends_at: trialEnds,
        is_paid: false,
      }),
    });
    return data?.[0] || null;
  } catch(e) { console.error("sbCreateAccount error:", e); return null; }
}

async function sbUpdateAccount(email, updates) {
  try {
    await sbFetch(`/accounts?email=eq.${encodeURIComponent(email.toLowerCase().trim())}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
    return true;
  } catch { return false; }
}

function accountToUser(account) {
  return {
    name: account.name,
    email: account.email,
    joinedAt: new Date(account.created_at).getTime(),
    trialStartAt: account.trial_start_at,
    trialEndsAt: account.trial_ends_at,
    isPaid: account.is_paid,
    paidAt: account.paid_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNT HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function createUser(name, email) {
  const now = Date.now();
  return {
    name,
    email,
    joinedAt: now,
    trialStartAt: now,
    trialEndsAt: now + TRIAL_DAYS * 24 * 60 * 60 * 1000,
    isPaid: false,
    paidAt: null,
  };
}

function getAccountStatus(user) {
  if (!user) return "guest";
  if (user.isPaid) return "paid";
  if (Date.now() < user.trialEndsAt) return "trial";
  return "expired";
}

function getTrialDaysLeft(user) {
  if (!user) return 0;
  const ms = user.trialEndsAt - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function hasFullAccess(user) {
  const s = getAccountStatus(user);
  return s === "paid" || s === "trial";
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMUNITY REVIEWS
// ─────────────────────────────────────────────────────────────────────────────
// Load all reviews for a game from Supabase
async function loadReviews(gameId) {
  try {
    const data = await sbFetch(
      `/reviews?game_id=eq.${gameId}&order=created_at.desc&limit=50`
    );
    // Normalize field names to match our UI
    return (data || []).map(r => ({
      userEmail:  r.user_email,
      userName:   r.user_name,
      rating:     r.rating,
      text:       r.review_text,
      timeSpent:  r.time_spent,
      date:       new Date(r.created_at).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" }),
    }));
  } catch (e) {
    console.error("loadReviews error:", e);
    return [];
  }
}

// Save or update a review in Supabase
async function saveReview(gameId, gameName, review) {
  try {
    // Upsert — insert or update if same game_id + user_email
    await sbFetch("/reviews", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        game_id:     String(gameId),
        game_name:   gameName,
        user_email:  review.userEmail,
        user_name:   review.userName,
        rating:      review.rating,
        review_text: review.text,
        time_spent:  review.timeSpent,
      }),
    });
    return await loadReviews(gameId);
  } catch (e) {
    console.error("saveReview error:", e);
    return await loadReviews(gameId);
  }
}

function StarPicker({ value, onChange, readonly=false }) {
  const [hov, setHov] = useState(0);
  return (
    <div style={{display:"flex",gap:2}}>
      {[1,2,3,4,5].map(s=>(
        <span key={s}
          onClick={()=>!readonly&&onChange&&onChange(s)}
          onMouseEnter={()=>!readonly&&setHov(s)}
          onMouseLeave={()=>!readonly&&setHov(0)}
          style={{fontSize:readonly?14:18,cursor:readonly?"default":"pointer",
            color:s<=(hov||value)?"#fbbf24":"rgba(255,255,255,0.15)",
            transition:"color .15s"}}>★</span>
      ))}
    </div>
  );
}

function CommunityReviews({ game, currentUser }) {
  const [reviews, setReviews] = useState([]);
  const [myRating, setMyRating] = useState(0);
  const [myReview, setMyReview] = useState("");
  const [myTime, setMyTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [postAnon, setPostAnon] = useState(false);

  useEffect(() => {
    loadReviews(game.id).then(r => {
      setReviews(r);
      if (currentUser) {
        const mine = r.find(rv => rv.userEmail === currentUser.email);
        if (mine) { setMyRating(mine.rating); setMyReview(mine.text); setMyTime(mine.timeSpent||""); }
      }
    });
  }, [game.id]);

  const handleSubmit = async () => {
    if (!currentUser) return;
    if (!myRating) return;
    setSubmitting(true);
    const review = {
      userEmail: currentUser.email,
      userName: postAnon ? "Anonymous" : currentUser.name,
      rating: myRating,
      text: myReview.trim(),
      timeSpent: myTime,
      date: new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),
    };
    const updated = await saveReview(game.id, game.name, review);
    setReviews(updated);
    setSubmitting(false);
    setSubmitted(true);
    setShowForm(false);
    setTimeout(()=>setSubmitted(false), 3000);
  };

  const avgRating = reviews.length ? (reviews.reduce((s,r)=>s+r.rating,0)/reviews.length).toFixed(1) : null;

  return (
    <div style={{marginTop:16}}>
      <div style={{fontSize:9,color:"rgba(255,255,255,0.28)",fontFamily:"'Space Mono',monospace",letterSpacing:1.5,marginBottom:10}}>
        💬 COMMUNITY REVIEWS {reviews.length>0&&`(${reviews.length})`}
      </div>

      {/* Avg rating summary */}
      {avgRating && (
        <div style={{display:"flex",alignItems:"center",gap:12,background:"rgba(255,255,255,0.04)",borderRadius:10,padding:"10px 14px",marginBottom:12}}>
          <div style={{fontSize:28,fontWeight:900,color:"#fbbf24",fontFamily:"'Space Mono',monospace"}}>{avgRating}</div>
          <div>
            <StarPicker value={Math.round(avgRating)} readonly/>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:"'Space Mono',monospace",marginTop:2}}>{reviews.length} player review{reviews.length!==1?"s":""}</div>
          </div>
        </div>
      )}

      {/* Write review button */}
      {currentUser && !showForm && (
        <button onClick={()=>setShowForm(true)}
          style={{width:"100%",background:"rgba(167,139,250,0.1)",border:"1px solid rgba(167,139,250,0.3)",
            borderRadius:10,padding:"9px",color:"#a78bfa",fontSize:11,cursor:"pointer",
            fontFamily:"'Space Mono',monospace",marginBottom:12,transition:"all .2s"}}
          onMouseEnter={e=>e.currentTarget.style.background="rgba(167,139,250,0.2)"}
          onMouseLeave={e=>e.currentTarget.style.background="rgba(167,139,250,0.1)"}>
          ✍️ {reviews.find(r=>r.userEmail===currentUser.email) ? "Edit My Review" : "Write a Review"}
        </button>
      )}

      {/* Review form */}
      {currentUser && showForm && (
        <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:14,marginBottom:14}}>
          <div style={{fontSize:11,color:"white",fontFamily:"'Space Mono',monospace",fontWeight:700,marginBottom:10}}>Your Review</div>
          <div style={{marginBottom:10}}>
            <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",fontFamily:"'Space Mono',monospace",marginBottom:6}}>YOUR RATING</div>
            <StarPicker value={myRating} onChange={setMyRating}/>
          </div>
          <div style={{marginBottom:10}}>
            <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",fontFamily:"'Space Mono',monospace",marginBottom:6}}>HOW LONG DID YOU PLAY?</div>
            <input placeholder="e.g. 12 hours, weekends only, still playing..." value={myTime}
              onChange={e=>setMyTime(e.target.value)}
              style={{width:"100%",background:"rgba(0,0,0,0.4)",border:"1px solid rgba(255,255,255,0.1)",
                borderRadius:8,padding:"8px 10px",color:"white",fontSize:11,
                fontFamily:"'Space Mono',monospace",boxSizing:"border-box"}}/>
          </div>
          {/* Anonymous toggle */}
          <div onClick={()=>setPostAnon(!postAnon)}
            style={{display:"flex",alignItems:"center",gap:10,background:postAnon?"rgba(167,139,250,0.12)":"rgba(255,255,255,0.03)",
              border:`1px solid ${postAnon?"rgba(167,139,250,0.4)":"rgba(255,255,255,0.08)"}`,
              borderRadius:10,padding:"10px 12px",cursor:"pointer",marginBottom:12,transition:"all .2s"}}>
            <div style={{width:18,height:18,borderRadius:"50%",border:`2px solid ${postAnon?"#a78bfa":"rgba(255,255,255,0.2)"}`,
              background:postAnon?"#a78bfa":"transparent",display:"flex",alignItems:"center",
              justifyContent:"center",fontSize:10,color:"white",flexShrink:0,transition:"all .2s"}}>
              {postAnon?"✓":""}
            </div>
            <div>
              <div style={{fontSize:11,color:"white",fontFamily:"'Space Mono',monospace",fontWeight:700}}>Post anonymously</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",fontFamily:"'Space Mono',monospace"}}>Your name won't be shown — review posts as "Anonymous"</div>
            </div>
          </div>

          <div style={{marginBottom:12}}>
            <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",fontFamily:"'Space Mono',monospace",marginBottom:6}}>YOUR THOUGHTS</div>
            <textarea placeholder="Was it worth your time? Would you recommend it to a busy person?" value={myReview}
              onChange={e=>setMyReview(e.target.value)}
              style={{width:"100%",background:"rgba(0,0,0,0.4)",border:"1px solid rgba(255,255,255,0.1)",
                borderRadius:8,padding:"8px 10px",color:"white",fontSize:11,resize:"vertical",
                minHeight:70,fontFamily:"'Space Mono',monospace",boxSizing:"border-box"}}/>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={handleSubmit} disabled={!myRating||submitting}
              style={{flex:1,background:myRating?"#a78bfa":"rgba(255,255,255,0.1)",border:"none",
                borderRadius:9,padding:"9px",color:"white",fontSize:11,fontWeight:700,
                cursor:myRating?"pointer":"not-allowed",fontFamily:"'Space Mono',monospace"}}>
              {submitting?"Saving...":submitted?"✓ Saved!":"Submit Review"}
            </button>
            <button onClick={()=>setShowForm(false)}
              style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",
                borderRadius:9,padding:"9px 14px",color:"rgba(255,255,255,0.4)",fontSize:11,
                cursor:"pointer",fontFamily:"'Space Mono',monospace"}}>Cancel</button>
          </div>
        </div>
      )}

      {/* Reviews list */}
      {reviews.length === 0 && (
        <div style={{textAlign:"center",padding:"16px 0",color:"rgba(255,255,255,0.25)",fontSize:11,fontFamily:"'Space Mono',monospace"}}>
          No reviews yet. Be the first to share your experience!
        </div>
      )}
      <div style={{display:"flex",flexDirection:"column",gap:10,maxHeight:280,overflowY:"auto"}}>
        {reviews.map((r,i)=>(
          <div key={i} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"10px 12px"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:26,height:26,borderRadius:"50%",
                  background:r.userName==="Anonymous"?"rgba(255,255,255,0.15)":`hsl(${r.userName?.charCodeAt(0)*7%360},60%,45%)`,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:r.userName==="Anonymous"?14:11,fontWeight:700,color:"white",
                  fontFamily:"'Space Mono',monospace",flexShrink:0}}>
                  {r.userName==="Anonymous" ? "👤" : r.userName?.[0]?.toUpperCase()||"?"}
                </div>
                <div>
                  <div style={{fontSize:11,color:"white",fontWeight:700,fontFamily:"'Space Mono',monospace"}}>{r.userName}</div>
                  <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",fontFamily:"'Space Mono',monospace"}}>{r.date}</div>
                </div>
              </div>
              <StarPicker value={r.rating} readonly/>
            </div>
            {r.timeSpent && <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",fontFamily:"'Space Mono',monospace",marginBottom:4}}>⏱ {r.timeSpent}</div>}
            {r.text && <div style={{fontSize:11,color:"rgba(255,255,255,0.7)",fontFamily:"'Space Mono',monospace",lineHeight:1.6}}>{r.text}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMUNITY PROFILES — Supabase helpers
// Run this SQL in Supabase to set up profile tables:
/*
create table profiles (
  id uuid default gen_random_uuid() primary key,
  user_email text unique not null,
  gamer_tag text unique,
  bio text,
  avatar_color text default '#a78bfa',
  avatar_emoji text default '🎮',
  favorite_games jsonb default '[]',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
create table follows (
  id uuid default gen_random_uuid() primary key,
  follower_email text not null,
  following_email text not null,
  created_at timestamp with time zone default now(),
  unique(follower_email, following_email)
);
alter table profiles enable row level security;
alter table follows enable row level security;
create policy "Anyone can read profiles" on profiles for select to anon using (true);
create policy "Anyone can insert profiles" on profiles for insert to anon with check (true);
create policy "Anyone can update profiles" on profiles for update to anon using (true);
create policy "Anyone can read follows" on follows for select to anon using (true);
create policy "Anyone can insert follows" on follows for insert to anon with check (true);
create policy "Anyone can delete follows" on follows for delete to anon using (true);
*/
// ─────────────────────────────────────────────────────────────────────────────

async function getProfile(email) {
  try {
    const data = await sbFetch(`/profiles?user_email=eq.${encodeURIComponent(email)}&limit=1`);
    return data?.[0] || null;
  } catch { return null; }
}

async function upsertProfile(profile) {
  try {
    await sbFetch("/profiles", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(profile),
    });
    return true;
  } catch { return false; }
}

async function getProfileByTag(gamerTag) {
  try {
    const data = await sbFetch(`/profiles?gamer_tag=eq.${encodeURIComponent(gamerTag)}&limit=1`);
    return data?.[0] || null;
  } catch { return null; }
}

async function getUserReviews(email) {
  try {
    const data = await sbFetch(`/reviews?user_email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=20`);
    return data || [];
  } catch { return []; }
}

async function getFollowers(email) {
  try {
    const data = await sbFetch(`/follows?following_email=eq.${encodeURIComponent(email)}`);
    return data || [];
  } catch { return []; }
}

async function getFollowing(email) {
  try {
    const data = await sbFetch(`/follows?follower_email=eq.${encodeURIComponent(email)}`);
    return data || [];
  } catch { return []; }
}

async function followUser(followerEmail, followingEmail) {
  try {
    await sbFetch("/follows", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify({ follower_email: followerEmail, following_email: followingEmail }),
    });
    return true;
  } catch { return false; }
}

async function unfollowUser(followerEmail, followingEmail) {
  try {
    await sbFetch(`/follows?follower_email=eq.${encodeURIComponent(followerEmail)}&following_email=eq.${encodeURIComponent(followingEmail)}`, {
      method: "DELETE",
    });
    return true;
  } catch { return false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// GAME DATA HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const HLTB = {
  "Action":     { main:"12h", complete:"25h", session:"45–90 min" },
  "RPG":        { main:"40h", complete:"100h", session:"60–120 min" },
  "Adventure":  { main:"15h", complete:"30h", session:"45–90 min" },
  "Strategy":   { main:"20h", complete:"60h", session:"60–120 min" },
  "Shooter":    { main:"8h",  complete:"20h", session:"30–60 min" },
  "Puzzle":     { main:"6h",  complete:"12h", session:"15–45 min" },
  "Platformer": { main:"8h",  complete:"18h", session:"30–60 min" },
  "Sports":     { main:"∞",   complete:"∞",   session:"20–45 min" },
  "Racing":     { main:"10h", complete:"30h", session:"20–40 min" },
  "Indie":      { main:"8h",  complete:"15h", session:"30–60 min" },
  "Simulation": { main:"∞",   complete:"∞",   session:"60–120 min" },
  "Arcade":     { main:"∞",   complete:"∞",   session:"10–30 min" },
  "Fighting":   { main:"5h",  complete:"20h", session:"15–45 min" },
  "default":    { main:"10h", complete:"25h", session:"30–60 min" },
};

const GENRE_MAP = {
  "Action":"action","Adventure":"adventure","RPG":"role-playing-games-rpg",
  "Shooter":"shooter","Strategy":"strategy","Puzzle":"puzzle","Platformer":"platformer",
  "Sports":"sports","Racing":"racing","Indie":"indie","Simulation":"simulation",
  "Fighting":"fighting","Arcade":"arcade","Family":"family",
};

const ACCENT = {
  "RPG":"#c084fc","Action":"#f87171","Adventure":"#34d399","Shooter":"#fb923c",
  "Strategy":"#60a5fa","Puzzle":"#fbbf24","Platformer":"#4ade80","Indie":"#a78bfa",
  "Sports":"#38bdf8","Racing":"#f97316","Simulation":"#86efac","Fighting":"#ef4444",
  "Arcade":"#facc15","default":"#94a3b8",
};

function accentOf(genres=[]) { return ACCENT[genres[0]?.name] || ACCENT.default; }
function hltbOf(genres=[])   { return HLTB[genres[0]?.name]   || HLTB.default; }

function difficultyOf(genres=[]) {
  const n = genres.map(g=>g.name);
  if (["Shooter","Fighting","Strategy","Platformer"].some(x=>n.includes(x))) return "Challenging";
  if (["Puzzle","Simulation","Sports","Family"].some(x=>n.includes(x)))      return "Relaxed";
  return "Medium";
}

function sessionCatOf(genres=[]) {
  const n = genres.map(g=>g.name);
  if (["Puzzle","Arcade","Card","Fighting","Racing","Sports"].some(x=>n.includes(x))) return "short";
  if (["RPG","Strategy","Simulation"].some(x=>n.includes(x))) return "long";
  return "medium";
}

function computeScores(game) {
  try {
  const rating = game.rating||3, mc = game.metacritic||0, rc = game.ratings_count||0;
  const genres = (game.genres||[]).filter(Boolean);
  const names  = genres.map(g=>g.name||"");
  const hltb   = hltbOf(genres);
  const shortF = ["Puzzle","Arcade","Card","Fighting","Racing","Sports"];
  const longF  = ["RPG","Strategy","Simulation"];
  let t=70;
  if (shortF.some(g=>names.includes(g))) t=Math.min(99,t+22);
  if (longF.some(g=>names.includes(g)))  t=Math.max(30,t-25);
  if (names.includes("Indie")) t=Math.min(99,t+8);
  t=Math.round(t+(Math.random()*6-3));
  let a=55;
  if (["RPG","Adventure","Action"].some(g=>names.includes(g))) a+=30;
  if (names.includes("Indie")) a+=10;
  if (mc>80) a+=10;
  a=Math.min(99,Math.round(a+(Math.random()*8-4)));
  let w=Math.round((rating/5)*60+30);
  if (mc>85) w=Math.min(99,w+10);
  if (rc>1000) w=Math.min(99,w+5);
  w=Math.round(w+(Math.random()*6-3));
  return { t, a, w, hltb, difficulty:difficultyOf(genres), esrb:game.esrb_rating?.name||"Not Rated" };
  } catch { return { t:70, a:70, w:70, hltb:HLTB.default, difficulty:"Medium", esrb:"Not Rated" }; }
}

function storesOf(game) {
  const n = encodeURIComponent(game.name || "");
  const platforms = (game.platforms || []).map(p => p.platform?.slug || p.platform?.name?.toLowerCase() || "");
  const stores = (game.stores || []).map(s => s.store?.slug || "");

  const isPC        = platforms.some(p => ["pc","windows","linux","macos","mac"].includes(p));
  const isPS        = platforms.some(p => ["playstation4","playstation5","playstation3","ps4","ps5","ps3","playstation"].some(x => p.includes(x)));
  const isXbox      = platforms.some(p => ["xbox","xbox-one","xbox360","xbox-series-x"].some(x => p.includes(x)));
  const isNintendo  = platforms.some(p => ["nintendo","switch","wii","nintendo-switch"].some(x => p.includes(x)));
  const isMobile    = platforms.some(p => ["ios","android","mobile"].some(x => p.includes(x)));
  const hasSteam    = stores.includes("steam") || isPC;
  const hasEpic     = stores.includes("epic-games") || isPC;
  const hasGOG      = stores.includes("gog") || isPC;
  const hasPS       = stores.includes("playstation-store") || isPS;
  const hasXbox     = stores.includes("xbox360") || stores.includes("xbox-store") || stores.includes("microsoft-store") || isXbox;
  const hasNintendo = stores.includes("nintendo") || isNintendo;
  const hasMobile   = stores.includes("google-play") || stores.includes("apple-itunes") || isMobile;

  const result = [];
  if (hasSteam)    result.push({ name:"Steam",          url:`https://store.steampowered.com/search/?term=${n}`,                 icon:"🖥",  color:"#1b2838" });
  if (hasEpic)     result.push({ name:"Epic Games",     url:`https://store.epicgames.com/en-US/browse?q=${n}`,                  icon:"⚡",  color:"#2a2a2a" });
  if (hasGOG)      result.push({ name:"GOG",            url:`https://www.gog.com/games?search=${n}`,                            icon:"🌍",  color:"#7b2fbe" });
  if (hasPS)       result.push({ name:"PlayStation",    url:`https://store.playstation.com/en-us/search/${n}`,                  icon:"🎮",  color:"#003087" });
  if (hasXbox)     result.push({ name:"Xbox",           url:`https://www.xbox.com/en-US/Search/Results?q=${n}`,                 icon:"🟢",  color:"#107c10" });
  if (hasNintendo) result.push({ name:"Nintendo",       url:`https://www.nintendo.com/search/#q=${n}&p=1&cat=gme&sort=df`,      icon:"🔴",  color:"#e4000f" });
  if (hasMobile)   result.push({ name:"Mobile",         url:`https://play.google.com/store/search?q=${n}&c=apps`,               icon:"📱",  color:"#01875f" });

  // Fallback — if we can't detect, show all stores
  if (result.length === 0) {
    return [
      { name:"Steam",       url:`https://store.steampowered.com/search/?term=${n}`, icon:"🖥",  color:"#1b2838" },
      { name:"Epic Games",  url:`https://store.epicgames.com/en-US/browse?q=${n}`,  icon:"⚡",  color:"#2a2a2a" },
      { name:"PlayStation", url:`https://store.playstation.com/en-us/search/${n}`,  icon:"🎮",  color:"#003087" },
      { name:"Xbox",        url:`https://www.xbox.com/en-US/Search/Results?q=${n}`, icon:"🟢",  color:"#107c10" },
    ];
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// SMALL UI ATOMS
// ─────────────────────────────────────────────────────────────────────────────
const SCORE_TIPS = {
  "Time": [
    { range: [0, 39],  color: "#f87171", msg: "⛔ Demands long sessions — not great for busy people. Plan for 2+ hours minimum." },
    { range: [40, 59], color: "#fb923c", msg: "⚠️ Best played in longer sittings. Hard to feel progress in under an hour." },
    { range: [60, 74], color: "#fbbf24", msg: "🕐 Playable in 45–90 min sessions. Good if you have a regular hour free." },
    { range: [75, 89], color: "#4ade80", msg: "✅ Great for short sessions. You can pick it up, play 30–45 min, and feel satisfied." },
    { range: [90, 99], color: "#34d399", msg: "🏆 Perfect for busy people. Jump in for 15–30 min anytime and always make progress." },
  ],
  "Adventure": [
    { range: [0, 39],  color: "#f87171", msg: "⛔ Very little story or exploration. Mostly repetitive gameplay with no real world to discover." },
    { range: [40, 59], color: "#fb923c", msg: "⚠️ Some depth but fairly surface level. Fine for quick fun, not for story lovers." },
    { range: [60, 74], color: "#fbbf24", msg: "🕐 Decent story and world. You'll get some adventure but it won't blow your mind." },
    { range: [75, 89], color: "#4ade80", msg: "✅ Rich story and real exploration. You'll care about the world and want to see what's next." },
    { range: [90, 99], color: "#34d399", msg: "🏆 Deep, immersive adventure. Compelling story, worlds worth exploring, and lots to discover." },
  ],
  "Worth It": [
    { range: [0, 39],  color: "#f87171", msg: "⛔ Not worth your time. Poor ratings, weak gameplay, or too short for the price." },
    { range: [40, 59], color: "#fb923c", msg: "⚠️ Mixed bag. Has fans but also real problems. Read reviews before committing." },
    { range: [60, 74], color: "#fbbf24", msg: "🕐 Decent value. Enjoyable but not exceptional. Good if it's on sale." },
    { range: [75, 89], color: "#4ade80", msg: "✅ Solid buy. Consistently well-rated by players who felt their time was well spent." },
    { range: [90, 99], color: "#34d399", msg: "🏆 A must-play. Players overwhelmingly say this game was worth every minute they invested." },
  ],
  "Time Friendly": [
    { range: [0, 39],  color: "#f87171", msg: "⛔ Demands long sessions — not great for busy people. Plan for 2+ hours minimum." },
    { range: [40, 59], color: "#fb923c", msg: "⚠️ Best played in longer sittings. Hard to feel progress in under an hour." },
    { range: [60, 74], color: "#fbbf24", msg: "🕐 Playable in 45–90 min sessions. Good if you have a regular hour free." },
    { range: [75, 89], color: "#4ade80", msg: "✅ Great for short sessions. You can pick it up, play 30–45 min, and feel satisfied." },
    { range: [90, 99], color: "#34d399", msg: "🏆 Perfect for busy people. Jump in for 15–30 min anytime and always make progress." },
  ],
};

function getScoreTip(label, value) {
  const tips = SCORE_TIPS[label];
  if (!tips) return null;
  return tips.find(t => value >= t.range[0] && value <= t.range[1]) || tips[tips.length - 1];
}

function ScoreRing({ value, color, label, size=64, darkMode=true }) {
  const [showTip, setShowTip] = useState(false);
  const r=size*.38, c=2*Math.PI*r, off=c-(Math.min(value,99)/100)*c, cx=size/2, cy=size/2;
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,cursor:"help",position:"relative"}}
      onMouseEnter={()=>setShowTip(true)} onMouseLeave={()=>setShowTip(false)}>
      {showTip && SCORE_TIPS[label] && (() => {
        const tip = getScoreTip(label, value);
        return tip ? (
          <div style={{position:"absolute",bottom:"calc(100% + 8px)",left:"50%",transform:"translateX(-50%)",
            background:"#0d0d18",border:`1px solid ${tip.color}50`,borderRadius:10,
            padding:"10px 14px",zIndex:999,boxShadow:`0 8px 30px rgba(0,0,0,0.7)`,
            width:220,pointerEvents:"none"}}>
            {/* Score display */}
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <div style={{fontSize:22,fontWeight:900,color:tip.color,fontFamily:"'Space Mono',monospace"}}>{value}</div>
              <div style={{flex:1}}>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",fontFamily:"'Space Mono',monospace",letterSpacing:1}}>{label.toUpperCase()}</div>
                {/* Score bar */}
                <div style={{height:4,background:"rgba(255,255,255,0.08)",borderRadius:2,marginTop:3}}>
                  <div style={{height:"100%",width:`${value}%`,background:tip.color,borderRadius:2,transition:"width .3s"}}/>
                </div>
              </div>
            </div>
            {/* Message */}
            <div style={{fontSize:11,color:"rgba(255,255,255,0.8)",fontFamily:"'Space Mono',monospace",lineHeight:1.6}}>
              {tip.msg}
            </div>
            {/* Triangle pointer */}
            <div style={{position:"absolute",top:"100%",left:"50%",transform:"translateX(-50%)",
              width:0,height:0,borderLeft:"6px solid transparent",
              borderRight:"6px solid transparent",borderTop:`6px solid ${tip.color}50`}}/>
          </div>
        ) : null;
      })()}
      <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={darkMode?"rgba(255,255,255,0.07)":"rgba(0,0,0,0.08)"} strokeWidth={5}/>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={5}
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          style={{transition:"stroke-dashoffset .9s cubic-bezier(.4,0,.2,1)"}}/>
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill={darkMode?"white":"#0f0f1a"}
          fontSize={size*.2} fontWeight="700"
          style={{transform:`rotate(90deg)`,transformOrigin:`${cx}px ${cy}px`,fontFamily:"'Space Mono',monospace"}}>
          {value}
        </text>
      </svg>
      <span style={{fontSize:9,color:darkMode?"rgba(255,255,255,0.35)":"rgba(0,0,0,0.45)",letterSpacing:1.2,textTransform:"uppercase",fontFamily:"'Space Mono',monospace"}}>{label} ⓘ</span>
    </div>
  );
}

function Chip({ label, color="#94a3b8" }) {
  return <span style={{background:color+"20",border:`1px solid ${color}40`,borderRadius:20,padding:"2px 8px",fontSize:9,color,fontFamily:"'Space Mono',monospace"}}>{label}</span>;
}



function Input({ placeholder, value, onChange, type="text", onKeyDown, style:s={} }) {
  return (
    <input type={type} placeholder={placeholder} value={value} onChange={onChange} onKeyDown={onKeyDown}
      style={{background:"rgba(0,0,0,0.45)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:11,
        padding:"12px 16px",color:"white",fontSize:13,fontFamily:"'Space Mono',monospace",width:"100%",boxSizing:"border-box",...s}}/>
  );
}

function Btn({ children, onClick, variant="primary", style:s={}, disabled=false }) {
  const base = {border:"none",borderRadius:11,padding:"13px 20px",fontWeight:700,fontSize:13,
    cursor:disabled?"not-allowed":"pointer",fontFamily:"'Space Mono',monospace",transition:"opacity .2s",...s};
  const variants = {
    primary: {background:"white",color:"#07070f"},
    purple:  {background:"linear-gradient(135deg,#a78bfa,#7c3aed)",color:"white"},
    ghost:   {background:"rgba(255,255,255,0.06)",color:"rgba(255,255,255,0.6)",border:"1px solid rgba(255,255,255,0.1)"},
    danger:  {background:"rgba(239,68,68,0.15)",color:"#f87171",border:"1px solid rgba(239,68,68,0.3)"},
    gold:    {background:"linear-gradient(135deg,#f59e0b,#d97706)",color:"#07070f"},
  };
  return <button onClick={disabled?undefined:onClick} style={{...base,...variants[variant],...s}} onMouseEnter={e=>!disabled&&(e.currentTarget.style.opacity=".85")} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>{children}</button>;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS BAR  (shows trial countdown or paid badge)
// ─────────────────────────────────────────────────────────────────────────────
function StatusBar({ user, onUpgrade, onLogout }) {
  const status = getAccountStatus(user);
  const daysLeft = getTrialDaysLeft(user);

  const barColor = status==="paid" ? "#4ade80" : status==="trial" ? (daysLeft<=2?"#f97316":"#fbbf24") : "#f87171";
  const barBg    = barColor+"18";

  return (
    <div style={{background:barBg,borderBottom:`1px solid ${barColor}30`,padding:"8px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:8,height:8,borderRadius:"50%",background:barColor,flexShrink:0}}/>
        {status==="paid" && <span style={{fontSize:11,color:barColor,fontFamily:"'Space Mono',monospace",fontWeight:700}}>✓ Full Access — Lifetime</span>}
        {status==="trial" && <span style={{fontSize:11,color:barColor,fontFamily:"'Space Mono',monospace"}}>Free Trial — <strong>{daysLeft} day{daysLeft!==1?"s":""} left</strong></span>}
        {status==="expired" && <span style={{fontSize:11,color:barColor,fontFamily:"'Space Mono',monospace",fontWeight:700}}>⚠ Trial Expired — Upgrade to continue</span>}
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        {status!=="paid" && <Btn onClick={onUpgrade} variant="gold" style={{padding:"5px 14px",fontSize:11,borderRadius:8}}>Unlock Full Access — {PRICE}</Btn>}
        <span style={{fontSize:11,color:"rgba(255,255,255,0.4)",fontFamily:"'Space Mono',monospace"}}>Hi, {user.name}</span>
        <Btn onClick={onLogout} variant="ghost" style={{padding:"4px 10px",fontSize:10,borderRadius:7}}>Sign out</Btn>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYWALL MODAL
// ─────────────────────────────────────────────────────────────────────────────
function PaywallModal({ user, onClose, onSuccess }) {
  const [step, setStep] = useState("offer"); // offer | payment | success
  const [card, setCard] = useState({ number:"", expiry:"", cvc:"", name:"" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const status = getAccountStatus(user);

  const fmtCard = v => v.replace(/\D/g,"").replace(/(\d{4})/g,"$1 ").trim().slice(0,19);
  const fmtExp  = v => v.replace(/\D/g,"").replace(/(\d{2})(\d)/,"$1/$2").slice(0,5);

  const handlePay = async () => {
    if (!card.number || !card.expiry || !card.cvc || !card.name) { setErr("Please fill in all fields."); return; }
    setErr(""); setLoading(true);
    try {
      if (!window.Stripe) { throw new Error("Stripe.js not loaded yet. Please refresh and try again."); }
      const stripe = window.Stripe(STRIPE_PK);
      const { paymentMethod, error } = await stripe.createPaymentMethod({
        type: "card",
        card: { number: card.number.replace(/\s/g,""), exp_month: parseInt(card.expiry.split("/")[0]), exp_year: parseInt("20"+card.expiry.split("/")[1]), cvc: card.cvc },
        billing_details: { name: card.name },
      });
      if (error) { setErr(error.message); setLoading(false); return; }
      // Payment method created successfully — in production send paymentMethod.id to your backend to confirm charge
      setLoading(false);
      setStep("success");
      onSuccess();
    } catch(e) {
      setErr(e.message || "Payment failed. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.9)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(14px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0d0d18",border:"1px solid rgba(255,215,0,0.3)",borderRadius:24,width:"100%",maxWidth:440,boxShadow:"0 0 80px rgba(245,158,11,0.2)",overflow:"hidden"}}>

        {/* Gold top bar */}
        <div style={{height:4,background:"linear-gradient(90deg,#f59e0b,#d97706)"}}/>

        <div style={{padding:28}}>
          {step==="offer" && <>
            <div style={{textAlign:"center",marginBottom:24}}>
              <div style={{fontSize:36,marginBottom:8}}>🏆</div>
              <h2 style={{margin:"0 0 6px",fontSize:22,fontFamily:"'Bitter',serif",color:"white"}}>Unlock Full Access</h2>
              <p style={{margin:0,fontSize:13,color:"rgba(255,255,255,0.45)",fontFamily:"'Space Mono',monospace"}}>One-time payment. No subscriptions. Ever.</p>
            </div>

            {status==="expired" && (
              <div style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:12,padding:12,marginBottom:18,fontSize:12,color:"#fca5a5",fontFamily:"'Space Mono',monospace",textAlign:"center"}}>
                Your 7-day trial has ended.
              </div>
            )}

            {/* Feature list */}
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:24}}>
              {[
                ["🎮","500,000+ games","Full database, always updated"],
                ["⚙","All filters unlocked","Genre, difficulty, price, multiplayer & more"],
                ["🔍","Unlimited searches","No daily limits, ever"],
                ["📚","Personal library","Save, track & review your games"],
                ["🏅","Steam Deck badges","Coming in Phase 3"],
              ].map(([icon,title,desc])=>(
                <div key={title} style={{display:"flex",alignItems:"center",gap:12,background:"rgba(255,255,255,0.03)",borderRadius:12,padding:"10px 14px"}}>
                  <span style={{fontSize:20,flexShrink:0}}>{icon}</span>
                  <div>
                    <div style={{fontSize:13,color:"white",fontWeight:700,fontFamily:"'Space Mono',monospace"}}>{title}</div>
                    <div style={{fontSize:11,color:"rgba(255,255,255,0.35)",fontFamily:"'Space Mono',monospace"}}>{desc}</div>
                  </div>
                  <span style={{marginLeft:"auto",color:"#4ade80",fontSize:14}}>✓</span>
                </div>
              ))}
            </div>

            <Btn onClick={()=>setStep("payment")} variant="gold" style={{width:"100%",fontSize:15,padding:"14px",borderRadius:13}}>
              Continue — {PRICE} one-time →
            </Btn>
            <div style={{textAlign:"center",marginTop:10,fontSize:10,color:"rgba(255,255,255,0.25)",fontFamily:"'Space Mono',monospace"}}>
              Secured by Stripe · No recurring charges
            </div>
          </>}

          {step==="payment" && <>
            <div style={{textAlign:"center",padding:"8px 0 20px"}}>
              <div style={{fontSize:40,marginBottom:10}}>🔒</div>
              <h2 style={{margin:"0 0 8px",fontSize:20,fontFamily:"'Bitter',serif",color:"white"}}>Secure Checkout</h2>
              <p style={{margin:"0 0 20px",fontSize:12,color:"rgba(255,255,255,0.4)",fontFamily:"'Space Mono',monospace",lineHeight:1.7}}>
                You'll be taken to Stripe's secure checkout page to complete your {PRICE} one-time payment.
              </p>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:22,textAlign:"left"}}>
                {[
                  ["🔒","Bank-level encryption","Your card details never touch our servers"],
                  ["⚡","Instant access","Unlocked immediately after payment"],
                  ["♾","Lifetime access","One payment, yours forever — no renewals"],
                ].map(([icon,title,desc])=>(
                  <div key={title} style={{display:"flex",alignItems:"center",gap:12,background:"rgba(255,255,255,0.03)",borderRadius:11,padding:"10px 13px"}}>
                    <span style={{fontSize:18}}>{icon}</span>
                    <div>
                      <div style={{fontSize:12,color:"white",fontWeight:700,fontFamily:"'Space Mono',monospace"}}>{title}</div>
                      <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:"'Space Mono',monospace"}}>{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <Btn onClick={()=>window.open(STRIPE_PAYMENT_LINK,"_blank")} variant="gold" style={{width:"100%",fontSize:15,padding:"14px",borderRadius:13}}>
                Pay {PRICE} Securely on Stripe →
              </Btn>
              <div style={{marginTop:10,fontSize:10,color:"rgba(255,255,255,0.25)",fontFamily:"'Space Mono',monospace"}}>
                Powered by Stripe · No account required
              </div>
              <button onClick={()=>setStep("offer")} style={{marginTop:14,background:"none",border:"none",color:"rgba(255,255,255,0.3)",fontSize:11,cursor:"pointer",fontFamily:"'Space Mono',monospace"}}>← Go back</button>
            </div>
          </>}

          {step==="success" && (
            <div style={{textAlign:"center",padding:"16px 0"}}>
              <div style={{fontSize:52,marginBottom:12}}>🎉</div>
              <h2 style={{margin:"0 0 8px",fontSize:22,fontFamily:"'Bitter',serif",color:"white"}}>You're in!</h2>
              <p style={{fontSize:13,color:"rgba(255,255,255,0.5)",fontFamily:"'Space Mono',monospace",marginBottom:24}}>Full access unlocked. Welcome to Worth My Time.</p>
              <Btn onClick={onClose} variant="gold" style={{padding:"12px 32px",fontSize:13}}>Start Exploring →</Btn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function AuthScreen({ onLogin }) {
  const [mode, setMode] = useState("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass]   = useState("");
  const [err, setErr]     = useState("");
  const [success, setSuccess] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [enteredCode, setEnteredCode] = useState("");
  const [newPass, setNewPass] = useState("");
  const [resetStep, setResetStep] = useState(1); // 1=enter email, 2=enter code, 3=new password
  const [verifyStep, setVerifyStep] = useState(1); // 1=fill form, 2=verify email code
  const [verifyCode, setVerifyCode] = useState("");
  const [enteredVerifyCode, setEnteredVerifyCode] = useState("");
  const [pendingUser, setPendingUser] = useState(null);

  const validateEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());

  const handleForgotPassword = async () => {
    setErr(""); setSuccess("");
    if (!email) { setErr("Please enter your email address."); return; }
    if (!validateEmail(email)) { setErr("Please enter a valid email address."); return; }
    const emailKey = email.toLowerCase().trim();
    const account = await sbGetAccount(emailKey);
    if (!account) { setErr("No account found with this email."); return; }
    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    // Store code with 15min expiry
    await store.set(`wmt_reset_${emailKey}`, { code, expiresAt: Date.now() + 15 * 60 * 1000 });
    // Send real email via EmailJS
    const sent = await sendVerificationEmail(email, account.name, code);
    if (sent) {
      setSuccess(`Reset code sent to ${email} — check your inbox and spam folder.`);
    } else {
      setSuccess(`Couldn't send email. Your code is: ${code}`);
    }
    setResetStep(2);
  };

  const handleVerifyCode = async () => {
    setErr(""); setSuccess("");
    if (!enteredCode) { setErr("Please enter the reset code."); return; }
    const emailKey = email.toLowerCase().trim();
    const stored = await store.get(`wmt_reset_${emailKey}`);
    if (!stored) { setErr("Reset code expired. Please request a new one."); return; }
    if (Date.now() > stored.expiresAt) { setErr("Reset code has expired. Please request a new one."); await store.del(`wmt_reset_${emailKey}`); return; }
    if (enteredCode.trim() !== stored.code) { setErr("Incorrect code. Please try again."); return; }
    setSuccess("Code verified! Please enter your new password.");
    setResetStep(3);
  };

  const handleResetPassword = async () => {
    setErr(""); setSuccess("");
    if (!newPass || newPass.length < 8) { setErr("Password must be at least 8 characters."); return; }
    const emailKey = email.toLowerCase().trim();
    // Update password in Supabase
    const ok = await sbUpdateAccount(emailKey, { password_hash: btoa(newPass) });
    if (!ok) { setErr("Failed to reset password. Please try again."); return; }
    await store.del(`wmt_reset_${emailKey}`);
    setSuccess("Password reset successfully! You can now sign in.");
    setMode("login");
    setResetStep(1);
    setEnteredCode("");
    setNewPass("");
  };
  const validatePassword = (p) => p.length >= 8;

  const submit = async () => {
    setErr("");
    if (!email) { setErr("Email address is required."); return; }
    if (!validateEmail(email)) { setErr("Please enter a valid email address."); return; }

    if (mode === "signup") {
      // Step 1 — validate and send verification code
      if (verifyStep === 1) {
        if (!name.trim()) { setErr("Your name is required."); return; }
        if (!validatePassword(pass)) { setErr("Password must be at least 8 characters."); return; }
        const emailKey = email.toLowerCase().trim();

        // Check if account already exists in Supabase
        const existing = await sbGetAccount(emailKey);
        if (existing) { setErr("An account with this email already exists. Please sign in."); return; }

        // Generate and store verification code locally (temp)
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        await store.set(`wmt_verify_${emailKey}`, { code, expiresAt: Date.now() + 15 * 60 * 1000 });
        setPendingUser({ name: name.trim(), emailKey, passwordHash: btoa(pass) });

        // Send verification email
        const sent = await sendVerificationEmail(emailKey, name.trim(), code);
        setSuccess(sent
          ? `Verification code sent to ${emailKey} — check your inbox and spam folder.`
          : `Couldn't send email. Your code is: ${code}`);
        setVerifyStep(2);
        return;
      }

      // Step 2 — verify code and create account in Supabase
      if (verifyStep === 2) {
        const emailKey = email.toLowerCase().trim();
        const stored = await store.get(`wmt_verify_${emailKey}`);
        if (!stored) { setErr("Verification code expired. Please start over."); setVerifyStep(1); return; }
        if (Date.now() > stored.expiresAt) { setErr("Code expired. Please start over."); await store.del(`wmt_verify_${emailKey}`); setVerifyStep(1); return; }
        if (enteredVerifyCode.trim() !== stored.code) { setErr("Incorrect code. Please try again."); return; }
        if (!pendingUser) { setErr("Session expired. Please start over."); setVerifyStep(1); return; }

        // Create account in Supabase
        const account = await sbCreateAccount(emailKey, pendingUser.name, pendingUser.passwordHash);
        if (!account) { setErr("Failed to create account. Please try again."); return; }

        await store.del(`wmt_verify_${emailKey}`);
        setVerifyStep(1); setEnteredVerifyCode(""); setPendingUser(null); setSuccess("");

        const user = accountToUser(account);
        await store.set("wmt_user", user); // cache session locally
        onLogin(user);
        return;
      }

    } else {
      // Sign in — look up account in Supabase
      if (!pass) { setErr("Password is required."); return; }
      const emailKey = email.toLowerCase().trim();

      const account = await sbGetAccount(emailKey);
      if (!account) { setErr("No account found with this email. Please create an account."); return; }
      if (btoa(pass) !== account.password_hash) { setErr("Incorrect password. Please try again."); return; }

      const user = accountToUser(account);
      await store.set("wmt_user", user); // cache session locally
      onLogin(user);
    }
  };

  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:20,background:"#07070f",backgroundImage:"radial-gradient(ellipse at 30% 20%, #1a0535 0%, transparent 55%), radial-gradient(ellipse at 70% 80%, #051528 0%, transparent 55%)"}}>
      <div style={{width:"100%",maxWidth:400}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <h1 style={{margin:"0 0 6px",fontSize:34,fontFamily:"'Bitter',serif",fontWeight:900,color:"white",letterSpacing:-1}}>Worth My Time?</h1>
          <p style={{color:"rgba(255,255,255,0.35)",fontSize:12,fontFamily:"'Space Mono',monospace",margin:0}}>Game intelligence for busy people</p>
        </div>

        {/* Trial offer banner */}
        <div style={{background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.3)",borderRadius:14,padding:"12px 16px",marginBottom:20,textAlign:"center"}}>
          <div style={{fontSize:13,color:"#a78bfa",fontFamily:"'Space Mono',monospace",fontWeight:700,marginBottom:3}}>🎮 Start your 7-day free trial</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",fontFamily:"'Space Mono',monospace"}}>Full access free for 7 days · Then just {PRICE} one-time</div>
        </div>

        <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:20,padding:26}}>

          {mode !== "forgot" && (
            <div style={{display:"flex",background:"rgba(0,0,0,0.4)",borderRadius:11,padding:3,marginBottom:22,gap:3}}>
              {["signup","login"].map(m=>(
                <button key={m} onClick={()=>{setMode(m);setErr("");setSuccess("");setResetStep(1);setVerifyStep(1);setEnteredVerifyCode("");}}
                  style={{flex:1,background:mode===m?"white":"transparent",color:mode===m?"#07070f":"rgba(255,255,255,0.4)",border:"none",borderRadius:9,padding:"9px",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Space Mono',monospace",transition:"all .2s"}}>
                  {m==="signup"?"Create Account":"Sign In"}
                </button>
              ))}
            </div>
          )}

          {/* SIGN UP / SIGN IN */}
          {mode !== "forgot" && (
            <>
              {/* Signup step 1 — fill form */}
              {mode === "signup" && verifyStep === 1 && (
                <>
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>
                    <Input placeholder="Your name" value={name} onChange={e=>setName(e.target.value)}/>
                    <Input placeholder="Email address" value={email} onChange={e=>setEmail(e.target.value)}/>
                    <Input placeholder="Password (min 8 characters)" type="password" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()}/>
                  </div>
                  {err && <div style={{color:"#f87171",fontSize:11,fontFamily:"'Space Mono',monospace",marginTop:8}}>⚠ {err}</div>}
                  <Btn onClick={submit} variant="purple" style={{width:"100%",marginTop:16}}>Send Verification Code →</Btn>
                  <div style={{marginTop:12,fontSize:10,color:"rgba(255,255,255,0.25)",fontFamily:"'Space Mono',monospace",textAlign:"center",lineHeight:1.6}}>
                    We'll verify your email before creating your account<br/>
                    7 days free · No credit card required · {PRICE} one-time after trial
                  </div>
                </>
              )}

              {/* Signup step 2 — verify email */}
              {mode === "signup" && verifyStep === 2 && (
                <>
                  <div style={{textAlign:"center",marginBottom:16}}>
                    <div style={{fontSize:28,marginBottom:6}}>📧</div>
                    <div style={{fontSize:13,color:"white",fontFamily:"'Space Mono',monospace",fontWeight:700,marginBottom:4}}>Check your email</div>
                    <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",fontFamily:"'Space Mono',monospace",lineHeight:1.6}}>
                      We sent a 6-digit code to<br/>
                      <span style={{color:"#a78bfa"}}>{email}</span>
                    </div>
                  </div>
                  {success && <div style={{color:"#4ade80",fontSize:11,fontFamily:"'Space Mono',monospace",marginBottom:12,textAlign:"center",background:"rgba(74,222,128,0.08)",borderRadius:8,padding:"8px 12px"}}>✓ {success}</div>}
                  <Input placeholder="Enter 6-digit code" value={enteredVerifyCode}
                    onChange={e=>setEnteredVerifyCode(e.target.value.replace(/\D/g,"").slice(0,6))}
                    onKeyDown={e=>e.key==="Enter"&&submit()}/>
                  {err && <div style={{color:"#f87171",fontSize:11,fontFamily:"'Space Mono',monospace",marginTop:8}}>⚠ {err}</div>}
                  <Btn onClick={submit} variant="purple" style={{width:"100%",marginTop:14}}>Verify & Create Account →</Btn>
                  <button onClick={()=>{setVerifyStep(1);setErr("");setSuccess("");setEnteredVerifyCode("");}}
                    style={{display:"block",margin:"10px auto 0",background:"none",border:"none",color:"rgba(255,255,255,0.3)",fontSize:11,cursor:"pointer",fontFamily:"'Space Mono',monospace"}}>
                    ← Use a different email
                  </button>
                </>
              )}

              {/* Sign in form */}
              {mode === "login" && (
                <>
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>
                    <Input placeholder="Email address" value={email} onChange={e=>setEmail(e.target.value)}/>
                    <Input placeholder="Password" type="password" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()}/>
                  </div>
                  {err && <div style={{color:"#f87171",fontSize:11,fontFamily:"'Space Mono',monospace",marginTop:8}}>⚠ {err}</div>}
                  {success && <div style={{color:"#4ade80",fontSize:11,fontFamily:"'Space Mono',monospace",marginTop:8}}>✓ {success}</div>}
                  <Btn onClick={submit} variant="purple" style={{width:"100%",marginTop:16}}>Sign In →</Btn>
                  <button onClick={()=>{setMode("forgot");setErr("");setSuccess("");setResetStep(1);}}
                    style={{display:"block",margin:"12px auto 0",background:"none",border:"none",color:"rgba(255,255,255,0.35)",fontSize:11,cursor:"pointer",fontFamily:"'Space Mono',monospace",textDecoration:"underline"}}>
                    Forgot your password?
                  </button>
                </>
              )}
            </>
          )}

          {/* FORGOT PASSWORD FLOW */}
          {mode === "forgot" && (
            <div>
              <div style={{textAlign:"center",marginBottom:20}}>
                <div style={{fontSize:28,marginBottom:8}}>🔑</div>
                <h3 style={{margin:"0 0 4px",color:"white",fontFamily:"'Bitter',serif",fontSize:18}}>Reset Password</h3>
                <p style={{margin:0,fontSize:11,color:"rgba(255,255,255,0.35)",fontFamily:"'Space Mono',monospace"}}>
                  {resetStep===1 && "Enter your email to receive a reset code"}
                  {resetStep===2 && "Enter the 6-digit code sent to your email"}
                  {resetStep===3 && "Enter your new password"}
                </p>
              </div>

              {/* Step indicator */}
              <div style={{display:"flex",gap:6,marginBottom:20}}>
                {[1,2,3].map(s=>(
                  <div key={s} style={{flex:1,height:3,borderRadius:3,background:resetStep>=s?"#a78bfa":"rgba(255,255,255,0.1)",transition:"background .3s"}}/>
                ))}
              </div>

              {resetStep===1 && (
                <>
                  <Input placeholder="Your email address" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleForgotPassword()}/>
                  {err && <div style={{color:"#f87171",fontSize:11,fontFamily:"'Space Mono',monospace",marginTop:8}}>⚠ {err}</div>}
                  {success && <div style={{color:"#4ade80",fontSize:11,fontFamily:"'Space Mono',monospace",marginTop:8}}>✓ {success}</div>}
                  <Btn onClick={handleForgotPassword} variant="purple" style={{width:"100%",marginTop:14}}>Send Reset Code →</Btn>
                </>
              )}

              {resetStep===2 && (
                <>
                  {success && <div style={{color:"#4ade80",fontSize:11,fontFamily:"'Space Mono',monospace",marginBottom:12}}>✓ {success}</div>}
                  <Input placeholder="Enter 6-digit code" value={enteredCode} onChange={e=>setEnteredCode(e.target.value.replace(/\D/g,"").slice(0,6))} onKeyDown={e=>e.key==="Enter"&&handleVerifyCode()}/>
                  {err && <div style={{color:"#f87171",fontSize:11,fontFamily:"'Space Mono',monospace",marginTop:8}}>⚠ {err}</div>}
                  <Btn onClick={handleVerifyCode} variant="purple" style={{width:"100%",marginTop:14}}>Verify Code →</Btn>
                  <button onClick={()=>{setResetStep(1);setErr("");setSuccess("");}} style={{display:"block",margin:"10px auto 0",background:"none",border:"none",color:"rgba(255,255,255,0.35)",fontSize:11,cursor:"pointer",fontFamily:"'Space Mono',monospace"}}>← Resend code</button>
                </>
              )}

              {resetStep===3 && (
                <>
                  {success && <div style={{color:"#4ade80",fontSize:11,fontFamily:"'Space Mono',monospace",marginBottom:12}}>✓ {success}</div>}
                  <Input placeholder="New password (min 8 characters)" type="password" value={newPass} onChange={e=>setNewPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleResetPassword()}/>
                  {err && <div style={{color:"#f87171",fontSize:11,fontFamily:"'Space Mono',monospace",marginTop:8}}>⚠ {err}</div>}
                  <Btn onClick={handleResetPassword} variant="purple" style={{width:"100%",marginTop:14}}>Reset Password →</Btn>
                </>
              )}

              <button onClick={()=>{setMode("login");setErr("");setSuccess("");setResetStep(1);}}
                style={{display:"block",margin:"14px auto 0",background:"none",border:"none",color:"rgba(255,255,255,0.3)",fontSize:11,cursor:"pointer",fontFamily:"'Space Mono',monospace"}}>
                ← Back to Sign In
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GAME CARD
// ─────────────────────────────────────────────────────────────────────────────
function GameCard({ game, onClick, locked, darkMode=true }) {
  const [hov, setHov] = useState(false);
  if (!game) return null;
  let scores, color, cat, catLbl;
  try {
    scores = computeScores(game);
    color  = accentOf(game.genres);
    cat    = sessionCatOf(game.genres);
    catLbl = {short:"⚡ Quick",medium:"🕐 Mid",long:"🏔 Long"}[cat] || "🎮 Game";
  } catch {
    scores = { t:70, a:70, w:70, hltb:{ session:"30–60 min", main:"10h", complete:"25h" }, difficulty:"Medium", esrb:"Not Rated" };
    color  = "#a78bfa";
    catLbl = "🎮 Game";
  }



  if (!game || !game.id) return null;

  return (
    <div onClick={()=>onClick(game)} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{borderRadius:18,overflow:"hidden",cursor:"pointer",position:"relative",
        border:`1px solid ${hov?color+"70":"rgba(255,255,255,0.07)"}`,
        transform:hov?"translateY(-4px) scale(1.01)":"translateY(0) scale(1)",
        transition:"all .28s cubic-bezier(.4,0,.2,1)",
        boxShadow:hov?`0 20px 60px ${color}30`:"0 2px 12px rgba(0,0,0,0.4)",
        background:darkMode?"#0d0d18":"#ffffff",
        filter:locked?"blur(2px) brightness(0.5)":"none",
        boxShadow:hov?`0 20px 60px ${color}30`:darkMode?"0 2px 12px rgba(0,0,0,0.4)":"0 2px 12px rgba(0,0,0,0.1)"}}>
      <div style={{position:"relative",height:125,overflow:"hidden",background:"#1a1a2e"}}>
        {game.background_image
          ? <img src={game.background_image} alt={game.name} style={{width:"100%",height:"100%",objectFit:"cover",opacity:.8,transition:"transform .4s",transform:hov?"scale(1.05)":"scale(1)"}}/>
          : <div style={{width:"100%",height:"100%",background:`linear-gradient(135deg,${color}30,#0d0d18)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:34}}>🎮</div>}
        <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,#0d0d18 0%,transparent 60%)"}}/>
        <div style={{position:"absolute",top:8,left:8,background:"rgba(0,0,0,0.75)",backdropFilter:"blur(8px)",borderRadius:20,padding:"2px 8px",fontSize:9,color,fontFamily:"'Space Mono',monospace",border:`1px solid ${color}40`}}>{catLbl}</div>
        {game.metacritic && <div style={{position:"absolute",top:8,right:8,background:game.metacritic>74?"#16a34a":game.metacritic>59?"#ca8a04":"#dc2626",borderRadius:7,padding:"2px 7px",fontSize:10,color:"white",fontWeight:700,fontFamily:"'Space Mono',monospace"}}>MC {game.metacritic}</div>}
      </div>
      <div style={{padding:"11px 13px 13px"}}>
        <h3 style={{margin:"0 0 3px",fontSize:14,fontFamily:"'Bitter',serif",fontWeight:700,color:darkMode?"white":"#0f0f1a",lineHeight:1.2,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{game.name}</h3>
        <div style={{fontSize:10,color:darkMode?"rgba(255,255,255,0.3)":"rgba(0,0,0,0.45)",fontFamily:"'Space Mono',monospace",marginBottom:7}}>
          {(game.genres||[]).slice(0,2).map(g=>g.name).join(" · ")}
        </div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:8}}>
          <Chip label={scores.difficulty} color={scores.difficulty==="Relaxed"?"#4ade80":scores.difficulty==="Challenging"?"#f87171":"#fbbf24"}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-around",margin:"8px 0",padding:"8px 0",borderTop:`1px solid ${darkMode?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.06)"}`,borderBottom:`1px solid ${darkMode?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.06)"}`}}>
          <ScoreRing value={scores.t} label="Time"      color={color} darkMode={darkMode}/>
          <ScoreRing value={scores.a} label="Adventure" color={color} darkMode={darkMode}/>
          <ScoreRing value={scores.w} label="Worth It"  color={color} darkMode={darkMode}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"rgba(255,255,255,0.3)",fontFamily:"'Space Mono',monospace"}}>
          <span>⏱ {scores.hltb.session}</span>
          <span>📖 {scores.hltb.main}</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// IMAGE UPLOAD — Supabase Storage
// ─────────────────────────────────────────────────────────────────────────────
async function uploadImage(file, bucket, path) {
  try {
    // Basic content moderation — block obvious bad filenames and check type
    const allowed = ["image/jpeg","image/jpg","image/png","image/gif","image/webp"];
    if (!allowed.includes(file.type)) throw new Error("Only images allowed (jpg, png, gif, webp)");
    if (file.size > 5 * 1024 * 1024) throw new Error("Image must be under 5MB");

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "x-upsert": "true",
      },
      body: formData,
    });
    if (!res.ok) throw new Error("Upload failed");
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
  } catch(e) {
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ACHIEVEMENTS SYSTEM
// ─────────────────────────────────────────────────────────────────────────────
const ACHIEVEMENTS = [
  { id:"first_review",   icon:"✍️",  label:"First Review",     desc:"Wrote your first game review",        color:"#fbbf24" },
  { id:"review_5",       icon:"📝",  label:"Critic",           desc:"Wrote 5 game reviews",                color:"#60a5fa" },
  { id:"review_10",      icon:"🎯",  label:"Expert Critic",    desc:"Wrote 10 game reviews",               color:"#a78bfa" },
  { id:"review_25",      icon:"🏆",  label:"Master Critic",    desc:"Wrote 25 game reviews",               color:"#f97316" },
  { id:"first_follow",   icon:"👥",  label:"Social Gamer",     desc:"Followed another player",             color:"#34d399" },
  { id:"follower_10",    icon:"🌟",  label:"Rising Star",      desc:"Got 10 followers",                    color:"#fbbf24" },
  { id:"showcase",       icon:"📌",  label:"Curator",          desc:"Added games to your showcase",        color:"#e879f9" },
  { id:"backlog",        icon:"📚",  label:"Collector",        desc:"Added 5 games to your backlog",       color:"#38bdf8" },
  { id:"early_adopter",  icon:"🚀",  label:"Early Adopter",    desc:"Joined Worth My Time in early access",color:"#f87171" },
];

function computeAchievements(profile, reviews, followers) {
  const earned = ["early_adopter"]; // everyone gets this
  if (reviews.length >= 1)  earned.push("first_review");
  if (reviews.length >= 5)  earned.push("review_5");
  if (reviews.length >= 10) earned.push("review_10");
  if (reviews.length >= 25) earned.push("review_25");
  if (followers.length >= 10) earned.push("follower_10");
  if ((profile?.showcase_games||[]).length > 0) earned.push("showcase");
  if ((profile?.backlog||[]).length >= 5) earned.push("backlog");
  return ACHIEVEMENTS.map(a => ({ ...a, earned: earned.includes(a.id) }));
}

// ─── Edit Profile Modal ───────────────────────────────────────────────────
const AVATAR_EMOJIS = ["🎮","👾","🕹️","⚔️","🏆","🎯","🔥","💎","🌟","🦁","🐉","🤖","👑","🎭","🚀","⚡"];
const AVATAR_COLORS = ["#a78bfa","#f87171","#34d399","#60a5fa","#fbbf24","#f97316","#e879f9","#38bdf8"];

function EditProfileModal({ user, onClose, onSave }) {
  const [gamerTag, setGamerTag] = useState("");
  const [bio, setBio] = useState("");
  const [status, setStatus] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState("🎮");
  const [avatarColor, setAvatarColor] = useState("#a78bfa");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("identity"); // identity | appearance | status

  useEffect(() => {
    getProfile(user.email).then(p => {
      if (p) {
        setGamerTag(p.gamer_tag || "");
        setBio(p.bio || "");
        setStatus(p.status || "");
        setAvatarEmoji(p.avatar_emoji || "🎮");
        setAvatarColor(p.avatar_color || "#a78bfa");
        setAvatarUrl(p.avatar_url || "");
        setBannerUrl(p.banner_url || "");
      }
    });
  }, [user.email]);

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploadingAvatar(true); setErr("");
    try {
      const path = `${user.email.replace(/[@.]/g,"_")}/avatar_${Date.now()}`;
      const url = await uploadImage(file, "avatars", path);
      setAvatarUrl(url);
    } catch(ex) { setErr(ex.message); }
    setUploadingAvatar(false);
  };

  const handleBannerUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploadingBanner(true); setErr("");
    try {
      const path = `${user.email.replace(/[@.]/g,"_")}/banner_${Date.now()}`;
      const url = await uploadImage(file, "avatars", path);
      setBannerUrl(url);
    } catch(ex) { setErr(ex.message); }
    setUploadingBanner(false);
  };

  const handleSave = async () => {
    setErr("");
    if (gamerTag && !/^[a-zA-Z0-9_]{3,20}$/.test(gamerTag)) { setErr("Gamer tag: 3-20 chars, letters/numbers/underscores only."); return; }
    setSaving(true);
    if (gamerTag) {
      const existing = await getProfileByTag(gamerTag);
      if (existing && existing.user_email !== user.email) { setErr("That gamer tag is taken."); setSaving(false); return; }
    }
    const profile = { user_email: user.email, gamer_tag: gamerTag||null, bio: bio||null, status: status||null, avatar_emoji: avatarEmoji, avatar_color: avatarColor, avatar_url: avatarUrl||null, banner_url: bannerUrl||null };
    await upsertProfile(profile);
    onSave(profile);
    setSaving(false);
    onClose();
  };

  const inputStyle = {width:"100%",background:"rgba(0,0,0,0.4)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"11px 14px",color:"white",fontSize:12,fontFamily:"'Space Mono',monospace",boxSizing:"border-box"};
  const labelStyle = {fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:"'Space Mono',monospace",letterSpacing:1,marginBottom:6,display:"block"};

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(16px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0d0d18",border:"1px solid rgba(167,139,250,0.3)",borderRadius:24,width:"100%",maxWidth:500,maxHeight:"92vh",overflowY:"auto",boxShadow:"0 0 80px rgba(167,139,250,0.2)"}}>

        {/* Banner preview */}
        <div style={{height:120,borderRadius:"24px 24px 0 0",overflow:"hidden",position:"relative",background:bannerUrl?"transparent":`linear-gradient(135deg,${avatarColor}60,#0d0d18)`,cursor:"pointer"}}
          onClick={()=>document.getElementById("banner-upload").click()}>
          {bannerUrl && <img src={bannerUrl} alt="banner" style={{width:"100%",height:"100%",objectFit:"cover"}}/>}
          <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.3)",display:"flex",alignItems:"center",justifyContent:"center",opacity:0,transition:"opacity .2s"}}
            onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=0}>
            <span style={{color:"white",fontSize:12,fontFamily:"'Space Mono',monospace",fontWeight:700}}>
              {uploadingBanner ? "Uploading..." : "📷 Change Banner"}
            </span>
          </div>
          <input id="banner-upload" type="file" accept="image/*" onChange={handleBannerUpload} style={{display:"none"}}/>
        </div>

        <div style={{padding:"0 24px 24px",marginTop:-28}}>
          {/* Avatar */}
          <div style={{position:"relative",display:"inline-block",marginBottom:16}}>
            <div style={{width:72,height:72,borderRadius:"50%",border:"4px solid #0d0d18",overflow:"hidden",background:avatarColor,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,cursor:"pointer",boxShadow:`0 0 24px ${avatarColor}60`}}
              onClick={()=>document.getElementById("avatar-upload").click()}>
              {avatarUrl ? <img src={avatarUrl} alt="avatar" style={{width:"100%",height:"100%",objectFit:"cover"}}/> : avatarEmoji}
            </div>
            <div style={{position:"absolute",bottom:0,right:0,width:22,height:22,background:avatarColor,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,cursor:"pointer",border:"2px solid #0d0d18"}}
              onClick={()=>document.getElementById("avatar-upload").click()}>📷</div>
            <input id="avatar-upload" type="file" accept="image/*" onChange={handleAvatarUpload} style={{display:"none"}}/>
            {uploadingAvatar && <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.7)",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"white",fontFamily:"'Space Mono',monospace"}}>...</div>}
          </div>

          <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",fontFamily:"'Space Mono',monospace",marginBottom:6}}>
            Images must follow community guidelines — no explicit or offensive content.
          </div>

          {/* Tabs */}
          <div style={{display:"flex",background:"rgba(0,0,0,0.4)",borderRadius:10,padding:3,marginBottom:20,gap:3}}>
            {[["identity","👤 Identity"],["appearance","🎨 Look"],["status","🎮 Status"]].map(([id,lbl])=>(
              <button key={id} onClick={()=>setTab(id)}
                style={{flex:1,background:tab===id?"rgba(167,139,250,0.2)":"transparent",color:tab===id?"#a78bfa":"rgba(255,255,255,0.4)",border:`1px solid ${tab===id?"rgba(167,139,250,0.4)":"transparent"}`,borderRadius:8,padding:"8px 4px",cursor:"pointer",fontSize:10,fontFamily:"'Space Mono',monospace",fontWeight:tab===id?700:400}}>
                {lbl}
              </button>
            ))}
          </div>

          {/* Identity tab */}
          {tab==="identity" && (
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div><label style={labelStyle}>GAMER TAG</label>
                <input placeholder="e.g. ProGamer_99 (3-20 chars)" value={gamerTag} onChange={e=>setGamerTag(e.target.value)} style={inputStyle}/>
              </div>
              <div><label style={labelStyle}>BIO</label>
                <textarea placeholder="Tell the community about yourself and how you game..." value={bio} onChange={e=>setBio(e.target.value)}
                  style={{...inputStyle,resize:"vertical",minHeight:90}}/>
              </div>
            </div>
          )}

          {/* Appearance tab */}
          {tab==="appearance" && (
            <div>
              <label style={labelStyle}>AVATAR EMOJI (if no photo uploaded)</label>
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:16}}>
                {AVATAR_EMOJIS.map(e=>(
                  <button key={e} onClick={()=>setAvatarEmoji(e)}
                    style={{width:38,height:38,borderRadius:8,border:`2px solid ${avatarEmoji===e?"white":"transparent"}`,background:"rgba(255,255,255,0.06)",cursor:"pointer",fontSize:20,transition:"border .2s"}}>
                    {e}
                  </button>
                ))}
              </div>
              <label style={labelStyle}>PROFILE COLOR</label>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                {AVATAR_COLORS.map(c=>(
                  <button key={c} onClick={()=>setAvatarColor(c)}
                    style={{width:32,height:32,borderRadius:"50%",background:c,border:`4px solid ${avatarColor===c?"white":"transparent"}`,cursor:"pointer",transition:"border .2s"}}/>
                ))}
              </div>
            </div>
          )}

          {/* Status tab */}
          {tab==="status" && (
            <div>
              <label style={labelStyle}>WHAT ARE YOU PLAYING RIGHT NOW?</label>
              <input placeholder="e.g. Currently grinding Elden Ring DLC..." value={status} onChange={e=>setStatus(e.target.value)} style={inputStyle}/>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.25)",fontFamily:"'Space Mono',monospace",marginTop:8}}>This shows on your public profile so others know what you're into.</div>
            </div>
          )}

          {err && <div style={{color:"#f87171",fontSize:11,fontFamily:"'Space Mono',monospace",marginTop:10}}>⚠ {err}</div>}

          <div style={{display:"flex",gap:8,marginTop:20}}>
            <button onClick={handleSave} disabled={saving}
              style={{flex:1,background:"linear-gradient(135deg,#a78bfa,#7c3aed)",border:"none",borderRadius:11,padding:"13px",color:"white",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"'Space Mono',monospace",opacity:saving?0.7:1}}>
              {saving?"Saving...":"Save Profile →"}
            </button>
            <button onClick={onClose}
              style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:11,padding:"13px 16px",color:"rgba(255,255,255,0.5)",fontSize:12,cursor:"pointer",fontFamily:"'Space Mono',monospace"}}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function UserProfilePage({ profileEmail, currentUser, onClose, onEditProfile }) {
  const [profile, setProfile] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [followers, setFollowers] = useState([]);
  const [following, setFollowing] = useState([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("activity");
  const isOwnProfile = currentUser?.email === profileEmail;

  useEffect(() => {
    Promise.all([getProfile(profileEmail), getUserReviews(profileEmail), getFollowers(profileEmail), getFollowing(profileEmail)])
      .then(([p, r, flrs, flwg]) => {
        setProfile(p); setReviews(r); setFollowers(flrs); setFollowing(flwg);
        setIsFollowing(flrs.some(f => f.follower_email === currentUser?.email));
        setLoading(false);
      });
  }, [profileEmail]);

  const handleFollow = async () => {
    if (!currentUser) return;
    if (isFollowing) {
      await unfollowUser(currentUser.email, profileEmail);
      setFollowers(f => f.filter(x => x.follower_email !== currentUser.email));
      setIsFollowing(false);
    } else {
      await followUser(currentUser.email, profileEmail);
      setFollowers(f => [...f, { follower_email: currentUser.email }]);
      setIsFollowing(true);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}?profile=${profile?.gamer_tag || profileEmail}`);
  };

  const displayName = profile?.gamer_tag || profileEmail.split("@")[0];
  const avatarColor = profile?.avatar_color || "#a78bfa";
  const achievements = computeAchievements(profile, reviews, followers);
  const showcase = profile?.showcase_games || [];
  const backlog = profile?.backlog || [];

  if (loading) return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:250,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(16px)"}}>
      <div style={{color:"white",fontFamily:"'Space Mono',monospace",fontSize:12}}>Loading profile...</div>
    </div>
  );

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:250,display:"flex",alignItems:"stretch",backdropFilter:"blur(16px)",overflowY:"auto"}}>
      <div style={{width:"100%",maxWidth:760,margin:"0 auto",background:"#0d0d18",minHeight:"100vh",position:"relative"}}>

        {/* BANNER */}
        <div style={{height:200,overflow:"hidden",position:"relative",background:profile?.banner_url?"transparent":`linear-gradient(135deg,${avatarColor}50,#0d0d18)`}}>
          {profile?.banner_url && <img src={profile.banner_url} alt="banner" style={{width:"100%",height:"100%",objectFit:"cover"}}/>}
          <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,#0d0d18,transparent 60%)"}}/>
          <button onClick={onClose} style={{position:"absolute",top:16,right:16,background:"rgba(0,0,0,0.6)",border:"1px solid rgba(255,255,255,0.2)",color:"white",borderRadius:10,padding:"8px 14px",cursor:"pointer",fontSize:12,fontFamily:"'Space Mono',monospace",fontWeight:700}}>✕ Close</button>
        </div>

        <div style={{padding:"0 24px 40px",marginTop:-56}}>

          {/* AVATAR + NAME ROW */}
          <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:12}}>
            <div style={{display:"flex",alignItems:"flex-end",gap:16}}>
              {/* Avatar */}
              <div style={{width:88,height:88,borderRadius:"50%",border:"4px solid #0d0d18",overflow:"hidden",background:avatarColor,display:"flex",alignItems:"center",justifyContent:"center",fontSize:36,flexShrink:0,boxShadow:`0 0 30px ${avatarColor}60`}}>
                {profile?.avatar_url
                  ? <img src={profile.avatar_url} alt="avatar" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                  : (profile?.avatar_emoji || "🎮")}
              </div>
              <div style={{paddingBottom:4}}>
                <h1 style={{margin:"0 0 2px",fontSize:26,fontFamily:"'Bitter',serif",color:"white",fontWeight:900}}>{displayName}</h1>
                {profile?.gamer_tag && <div style={{fontSize:12,color:"rgba(255,255,255,0.4)",fontFamily:"'Space Mono',monospace"}}>@{profile.gamer_tag}</div>}
                {profile?.status && (
                  <div style={{fontSize:11,color:avatarColor,fontFamily:"'Space Mono',monospace",marginTop:4,display:"flex",alignItems:"center",gap:6}}>
                    <span style={{width:7,height:7,borderRadius:"50%",background:"#4ade80",display:"inline-block"}}/>
                    {profile.status}
                  </div>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div style={{display:"flex",gap:8,paddingBottom:4}}>
              {isOwnProfile ? (
                <button onClick={onEditProfile}
                  style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:10,padding:"9px 16px",color:"white",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Space Mono',monospace"}}>
                  ✏️ Edit Profile
                </button>
              ) : (
                <button onClick={handleFollow}
                  style={{background:isFollowing?"rgba(255,255,255,0.08)":"linear-gradient(135deg,#a78bfa,#7c3aed)",border:isFollowing?"1px solid rgba(255,255,255,0.15)":"none",borderRadius:10,padding:"9px 16px",color:"white",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Space Mono',monospace"}}>
                  {isFollowing?"✓ Following":"+ Follow"}
                </button>
              )}
              <button onClick={copyLink}
                style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"9px 12px",color:"rgba(255,255,255,0.6)",fontSize:11,cursor:"pointer",fontFamily:"'Space Mono',monospace"}}>
                🔗 Share
              </button>
            </div>
          </div>

          {/* Bio */}
          {profile?.bio && <p style={{fontSize:13,color:"rgba(255,255,255,0.6)",fontFamily:"'Space Mono',monospace",lineHeight:1.8,margin:"0 0 20px",maxWidth:560}}>{profile.bio}</p>}

          {/* STATS ROW */}
          <div style={{display:"flex",gap:20,marginBottom:24,flexWrap:"wrap"}}>
            {[["💬",reviews.length,"Reviews"],["👥",followers.length,"Followers"],["➕",following.length,"Following"]].map(([icon,val,lbl])=>(
              <div key={lbl} style={{textAlign:"center"}}>
                <div style={{fontSize:20,fontWeight:800,color:avatarColor,fontFamily:"'Space Mono',monospace"}}>{val}</div>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:"'Space Mono',monospace"}}>{icon} {lbl}</div>
              </div>
            ))}
          </div>

          {/* ACHIEVEMENTS */}
          <div style={{marginBottom:24}}>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",fontFamily:"'Space Mono',monospace",letterSpacing:1.5,marginBottom:10}}>🏆 ACHIEVEMENTS</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {achievements.map(a=>(
                <div key={a.id} title={a.desc}
                  style={{display:"flex",alignItems:"center",gap:6,background:a.earned?`${a.color}18`:"rgba(255,255,255,0.03)",border:`1px solid ${a.earned?a.color+"40":"rgba(255,255,255,0.06)"}`,borderRadius:20,padding:"5px 10px",opacity:a.earned?1:0.4,transition:"all .2s"}}>
                  <span style={{fontSize:14}}>{a.icon}</span>
                  <span style={{fontSize:10,color:a.earned?a.color:"rgba(255,255,255,0.3)",fontFamily:"'Space Mono',monospace",fontWeight:a.earned?700:400}}>{a.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* TABS */}
          <div style={{display:"flex",gap:4,marginBottom:20,borderBottom:"1px solid rgba(255,255,255,0.08)",paddingBottom:0}}>
            {[["activity","📋 Activity"],["showcase","📌 Showcase"],["backlog","📚 Backlog"]].map(([id,lbl])=>(
              <button key={id} onClick={()=>setActiveTab(id)}
                style={{background:"transparent",border:"none",borderBottom:`2px solid ${activeTab===id?avatarColor:"transparent"}`,color:activeTab===id?avatarColor:"rgba(255,255,255,0.4)",padding:"10px 16px",cursor:"pointer",fontSize:11,fontFamily:"'Space Mono',monospace",fontWeight:activeTab===id?700:400,marginBottom:-1,transition:"all .2s"}}>
                {lbl}
              </button>
            ))}
          </div>

          {/* ACTIVITY TAB */}
          {activeTab==="activity" && (
            reviews.length===0 ? (
              <div style={{textAlign:"center",padding:"30px 0",color:"rgba(255,255,255,0.25)",fontSize:11,fontFamily:"'Space Mono',monospace"}}>No reviews yet</div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {reviews.map((r,i)=>(
                  <div key={i} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:"14px 16px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                      <div style={{fontSize:14,color:"white",fontWeight:700,fontFamily:"'Bitter',serif"}}>{r.game_name}</div>
                      <div style={{display:"flex",gap:1}}>{[1,2,3,4,5].map(s=><span key={s} style={{fontSize:13,color:s<=r.rating?"#fbbf24":"rgba(255,255,255,0.15)"}}>★</span>)}</div>
                    </div>
                    {r.time_spent && <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",fontFamily:"'Space Mono',monospace",marginBottom:4}}>⏱ {r.time_spent}</div>}
                    {r.review_text && <div style={{fontSize:12,color:"rgba(255,255,255,0.65)",fontFamily:"'Space Mono',monospace",lineHeight:1.6}}>{r.review_text}</div>}
                    <div style={{fontSize:9,color:"rgba(255,255,255,0.2)",fontFamily:"'Space Mono',monospace",marginTop:6}}>{new Date(r.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* SHOWCASE TAB */}
          {activeTab==="showcase" && (
            <div>
              {showcase.length===0 ? (
                <div style={{textAlign:"center",padding:"30px 0",color:"rgba(255,255,255,0.25)",fontSize:11,fontFamily:"'Space Mono',monospace"}}>
                  {isOwnProfile ? "No games showcased yet. Edit your profile to pin your favorites." : "No games showcased yet."}
                </div>
              ) : (
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12}}>
                  {showcase.map((g,i)=>(
                    <div key={i} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:"12px",textAlign:"center"}}>
                      <div style={{fontSize:13,color:"white",fontWeight:700,fontFamily:"'Bitter',serif"}}>{g.name}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* BACKLOG TAB */}
          {activeTab==="backlog" && (
            <div>
              {backlog.length===0 ? (
                <div style={{textAlign:"center",padding:"30px 0",color:"rgba(255,255,255,0.25)",fontSize:11,fontFamily:"'Space Mono',monospace"}}>
                  {isOwnProfile ? "Your backlog is empty. Add games you want to play!" : "No backlog games yet."}
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {backlog.map((g,i)=>(
                    <div key={i} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:"12px 16px",display:"flex",alignItems:"center",gap:10}}>
                      <span style={{fontSize:16}}>📚</span>
                      <div style={{fontSize:13,color:"white",fontFamily:"'Bitter',serif",fontWeight:700}}>{g.name}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GameModal({ game, onClose, currentUser }) {
  if (!game) return null;
  let scores, color, stores;
  try {
    scores = computeScores(game);
    color  = accentOf(game.genres);
    stores = storesOf(game);
  } catch(e) {
    scores = { t:70, a:70, w:70, hltb:{ session:"30–60 min", main:"10h", complete:"25h" }, difficulty:"Medium", esrb:"Not Rated" };
    color  = "#a78bfa";
    stores = [];
  }
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(12px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0d0d18",border:`1px solid ${color}50`,borderRadius:24,width:"100%",maxWidth:500,maxHeight:"90vh",overflowY:"auto",boxShadow:`0 0 100px ${color}25`,position:"relative"}}>
        {game.background_image && (
          <div style={{height:180,overflow:"hidden",borderRadius:"24px 24px 0 0",position:"relative"}}>
            <img src={game.background_image} alt={game.name} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
            <div style={{position:"absolute",inset:0,background:`linear-gradient(to top,#0d0d18,transparent 50%)`}}/>
          </div>
        )}
        <div style={{padding:20}}>
          <button onClick={onClose} style={{position:"absolute",top:14,right:14,background:"rgba(0,0,0,0.6)",border:"1px solid rgba(255,255,255,0.15)",color:"white",borderRadius:10,width:32,height:32,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
          <div style={{fontSize:9,color,fontFamily:"'Space Mono',monospace",letterSpacing:1.5,marginBottom:4}}>{(game.genres||[]).map(g=>g.name).join(" · ")}</div>
          <h2 style={{margin:"0 0 10px",fontSize:22,fontFamily:"'Bitter',serif",color:"white",lineHeight:1.2}}>{game.name}</h2>
          <div style={{display:"flex",justifyContent:"space-around",marginBottom:18,padding:12,background:"rgba(255,255,255,0.03)",borderRadius:14,border:"1px solid rgba(255,255,255,0.06)"}}>
            <ScoreRing value={scores.t} label="Time Friendly" color={color} size={68}/>
            <ScoreRing value={scores.a} label="Adventure"     color={color} size={68}/>
            <ScoreRing value={scores.w} label="Worth It"      color={color} size={68}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
            {[["⏱ Session",scores.hltb.session],["📖 Story",scores.hltb.main],["🏆 100%",scores.hltb.complete],["🎯 Difficulty",scores.difficulty],["⭐ Rating",game.rating?`${game.rating.toFixed(1)}/5`:"Unrated"],["📊 Metacritic",game.metacritic||"No score"],["🔞 Age Rating", scores.esrb==="Not Rated"?"Unrated":scores.esrb==="Everyone"?"E — Everyone":scores.esrb==="Everyone 10+"?"E10+ — Everyone 10+":scores.esrb==="Teen"?"T — Teen (13+)":scores.esrb==="Mature"?"M — Mature (17+)":scores.esrb==="Adults Only"?"AO — Adults Only (18+)":scores.esrb==="Rating Pending"?"Rating Pending":scores.esrb],["📅 Released",game.released?new Date(game.released).toLocaleDateString("en-US",{year:"numeric",month:"short"}):"Unknown"]].map(([k,v])=>(
              <div key={k} style={{background:"rgba(255,255,255,0.04)",borderRadius:10,padding:"9px 12px"}}>
                <div style={{fontSize:9,color:"rgba(255,255,255,0.28)",fontFamily:"'Space Mono',monospace",marginBottom:3}}>{k}</div>
                <div style={{fontSize:12,color:"white",fontWeight:700,fontFamily:"'Space Mono',monospace"}}>{v}</div>
              </div>
            ))}
          </div>
          {(game.platforms||[]).length>0 && (
            <div style={{marginBottom:14}}>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.28)",fontFamily:"'Space Mono',monospace",letterSpacing:1.5,marginBottom:7}}>AVAILABLE ON</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {(game.platforms||[]).map(p=><Chip key={p.platform.id} label={p.platform.name} color={color}/>)}
              </div>
            </div>
          )}
          <CommunityReviews game={game} currentUser={currentUser}/>

          <div>
            <div style={{fontSize:9,color:"rgba(255,255,255,0.28)",fontFamily:"'Space Mono',monospace",letterSpacing:1.5,marginBottom:7}}>
              BUY / FIND THIS GAME
              <span style={{color:"rgba(255,255,255,0.2)",marginLeft:6}}>— only showing stores for detected platforms</span>
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {stores.map(s=>(
                <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer"
                  style={{background:s.color+"22",border:`1px solid ${s.color}60`,borderRadius:10,
                    padding:"9px 13px",textAlign:"center",color:"white",textDecoration:"none",
                    fontSize:11,fontFamily:"'Space Mono',monospace",flex:"1 0 auto",
                    transition:"all .2s",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}
                  onMouseEnter={e=>{e.currentTarget.style.background=s.color+"44";e.currentTarget.style.transform="translateY(-1px)";}}
                  onMouseLeave={e=>{e.currentTarget.style.background=s.color+"22";e.currentTarget.style.transform="translateY(0)";}}>
                  <span style={{fontSize:14}}>{s.icon}</span>
                  <span>{s.name}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCKED OVERLAY (shown when trial expired and user tries to filter)
// ─────────────────────────────────────────────────────────────────────────────
function LockedOverlay({ onUpgrade }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:150,display:"flex",alignItems:"center",justifyContent:"center",padding:20,backdropFilter:"blur(10px)"}}>
      <div style={{textAlign:"center",maxWidth:340}}>
        <div style={{fontSize:48,marginBottom:12}}>🔒</div>
        <h2 style={{color:"white",fontFamily:"'Bitter',serif",margin:"0 0 8px"}}>Trial Ended</h2>
        <p style={{color:"rgba(255,255,255,0.45)",fontFamily:"'Space Mono',monospace",fontSize:12,lineHeight:1.7,marginBottom:24}}>
          Your 7-day free trial has ended. Unlock full access for a one-time payment of {PRICE} — no subscriptions, ever.
        </p>
        <Btn onClick={onUpgrade} variant="gold" style={{padding:"14px 32px",fontSize:14}}>Unlock Full Access — {PRICE}</Btn>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_FILTERS = {time:"all",genre:"all",platform:"all",difficulty:"all",multiplayer:"all",price:"all"};
const PLATFORM_MAP = {all:"",pc:"4",playstation:"187",xbox:"186",nintendo:"7",mobile:"21,3"};
const SORT_MAP     = {newest:"-released",rating:"-rating",metacritic:"-metacritic",popular:"-added"};

export default function App() {
  const [user, setUser]       = useState(null);
  const [appReady, setAppReady] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [games, setGames]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [search, setSearch]   = useState("");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sortBy, setSortBy]   = useState("newest");
  const [selected, setSelected] = useState(null);
  const [page, setPage]       = useState(1);
  const [total, setTotal]     = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [minutes, setMinutes] = useState("");
  const [showPaywall, setShowPaywall] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [viewProfile, setViewProfile] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const debRef = useRef(null);

  // Load user from storage — refresh from Supabase to get latest trial/paid status
  useEffect(() => {
    store.get("wmt_user").then(async cached => {
      if (cached) {
        // Refresh from Supabase to get latest paid status and trial info
        const fresh = await sbGetAccount(cached.email);
        const user = fresh ? accountToUser(fresh) : cached;
        await store.set("wmt_user", user);
        setUser(user);
        getProfile(user.email).then(p => setUserProfile(p));
      }
      setAppReady(true);
    });
  }, []);

  const status = getAccountStatus(user);
  const access = hasFullAccess(user);

  const handleLogin = async (u) => { await store.set("wmt_user", u); setUser(u); };
  const handleLogout = async () => { await store.del("wmt_user"); setUser(null); setGames([]); setHasLoaded(false); };
  const handlePaid = async () => {
    const updated = { ...user, isPaid:true, paidAt:Date.now() };
    // Update in Supabase
    await sbUpdateAccount(user.email, { is_paid: true, paid_at: Date.now() });
    // Update local session cache
    await store.set("wmt_user", updated);
    setUser(updated);
    setShowPaywall(false);
  };

  const fetchGames = useCallback(async (q, f, sort, pg) => {
    setLoading(true); setError("");
    try {
      const todayDate = new Date().toISOString().split("T")[0];

      // ── SEARCH MODE: pure title search, no filters ──────────────────────
      if (q && q.trim().length > 0) {
        const p = new URLSearchParams({
          key: RAWG_KEY,
          page_size: 40,
          page: 1,
          search: q.trim(),
          search_precise: "true",
        });
        if (f.platform !== "all" && PLATFORM_MAP[f.platform]) {
          p.set("platforms", PLATFORM_MAP[f.platform]);
        }
        const res = await fetch(`${RAWG_BASE}/games?${p}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        let results = (data.results || []).filter(g =>
          g.background_image
        );
        // Score and sort by relevance
        const ql = q.trim().toLowerCase();
        results = results.sort((a, b) => {
          const scoreMatch = (name) => {
            const n = (name||"").toLowerCase();
            if (n === ql) return 100;
            if (n.startsWith(ql)) return 80;
            if (n.includes(` ${ql}`)) return 60;
            if (n.includes(ql)) return 40;
            return (b.ratings_count||0) - (a.ratings_count||0);
          };
          return scoreMatch(b.name) - scoreMatch(a.name);
        });
        setGames(results);
        setTotal(data.count || 0);
        setHasLoaded(true);
        setLoading(false);
        return;
      }

      // ── BROWSE MODE: apply all filters ──────────────────────────────────
      const p = new URLSearchParams({
        key: RAWG_KEY,
        page_size: 20,
        page: pg,
        ordering: SORT_MAP[sort] || "-released",
        dates: `2000-01-01,${todayDate}`,
        exclude_additions: "true",
      });
      if (f.platform !== "all" && PLATFORM_MAP[f.platform]) p.set("platforms", PLATFORM_MAP[f.platform]);
      const gs = [];
      if (f.time === "short") gs.push("puzzle,arcade,card-games,fighting,racing,sports");
      if (f.time === "long")  gs.push("role-playing-games-rpg,strategy,simulation");
      if (f.genre !== "all" && GENRE_MAP[f.genre]) gs.push(GENRE_MAP[f.genre]);
      if (gs.length) p.set("genres", gs.join(","));
      if (f.multiplayer === "singleplayer") p.set("tags", "singleplayer");
      if (f.multiplayer === "multiplayer")  p.set("tags", "multiplayer");
      if (f.multiplayer === "co-op")        p.set("tags", "co-op");
      const res = await fetch(`${RAWG_BASE}/games?${p}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      let results = data.results||[];
      const today = new Date().toISOString().split("T")[0];

      // Filter out unreleased games and games with no cover image
      results = results.filter(g => {
        if (!g.released || g.released > today) return false;
        if (!g.background_image) return false;
        return true;
      });

      // Always sort by newest first, then put exact search matches on top
      results = [...results].sort((a, b) => {
        const da = new Date(a.released || "2000-01-01");
        const db = new Date(b.released || "2000-01-01");
        return db - da;
      });

      if (q) {
        const ql = q.toLowerCase().trim();
        const scoreMatch = (name) => {
          const n = name.toLowerCase();
          if (n === ql) return 100;                          // exact match
          if (n.startsWith(ql)) return 80;                  // starts with
          if (n.includes(` ${ql}`)) return 60;              // word boundary
          if (n.includes(ql)) return 40;                    // contains
          return 0;
        };
        results = [...results].sort((a, b) => {
          const as = scoreMatch(a.name || "");
          const bs = scoreMatch(b.name || "");
          if (as !== bs) return bs - as;                    // higher score first
          // Tiebreak by ratings count — more popular games first
          return (b.ratings_count || 0) - (a.ratings_count || 0);
        });
      }
      if (f.difficulty!=="all") results=results.filter(g=>{ const d=difficultyOf(g.genres||[]); return f.difficulty==="easy"?d==="Relaxed":f.difficulty==="hard"?d==="Challenging":d==="Medium"; });
      setGames(results); setTotal(data.count||0); setHasLoaded(true);
    } catch { setError("Couldn't reach the game database. Check your RAWG API key."); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user || !access) return;
    if (!hasLoaded && !search && search !== "") return;
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => {
      setPage(1);
      fetchGames(search, filters, sortBy, 1);
    }, search ? 400 : 100); // faster reload when clearing search
  }, [search, filters, sortBy, user]);

  useEffect(() => { if (hasLoaded && user && access) fetchGames(search,filters,sortBy,page); }, [page]);

  const handleTimeSearch = () => {
    const m = parseInt(minutes); if (!m) return;

    // Each time window maps to DISTINCT genres so results never overlap
    let timeGenres = "";
    let ordering = "-released";

    if (m <= 15) {
      // Under 15 min — pure arcade, instant-play games
      timeGenres = "arcade,card-games";
      ordering = "-rating";
    } else if (m <= 30) {
      // 15–30 min — puzzle and quick sports
      timeGenres = "puzzle,sports,racing";
      ordering = "-rating";
    } else if (m <= 45) {
      // 30–45 min — fighting and platformers
      timeGenres = "fighting,platformer";
      ordering = "-released";
    } else if (m <= 60) {
      // 45–60 min — indie games designed for short sessions
      timeGenres = "indie,shooter";
      ordering = "-released";
    } else if (m <= 90) {
      // 60–90 min — action games with good pacing
      timeGenres = "action,adventure";
      ordering = "-released";
    } else if (m <= 120) {
      // 90–120 min — deeper action and adventure
      timeGenres = "action-adventure,massively-multiplayer";
      ordering = "-metacritic";
    } else {
      // 2+ hours — RPGs, strategy, simulation
      timeGenres = "role-playing-games-rpg,strategy,simulation";
      ordering = "-metacritic";
    }

    setSearch("");
    setPage(1);
    setFilters(DEFAULT_FILTERS);
    fetchGamesWithTime(timeGenres, ordering);
  };

  // Clear time search — go fully back to landing screen
  const handleClearTimeSearch = () => {
    setMinutes("");
    setSearch("");
    setPage(1);
    setGames([]);
    setTotal(0);
    setHasLoaded(false);
    setFilters(DEFAULT_FILTERS);
    setError("");
  };

  const fetchGamesWithTime = useCallback(async (timeGenres, ordering="-released") => {
    setLoading(true); setError("");
    try {
      const todayDate = new Date().toISOString().split("T")[0];
      const params = new URLSearchParams({
        key: RAWG_KEY,
        page_size: 40,
        page: 1,
        ordering,
        genres: timeGenres,
        dates: `2000-01-01,${todayDate}`,
        exclude_additions: "true",
      });
      const res = await fetch(`${RAWG_BASE}/games?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      let results = (data.results || []).filter(g =>
        g.background_image && g.released && g.released <= todayDate
      );
      results = results.sort((a, b) =>
        new Date(b.released||"2000-01-01") - new Date(a.released||"2000-01-01")
      );
      setGames(results);
      setTotal(data.count || 0);
      setHasLoaded(true);
    } catch { setError("Couldn't reach the game database. Check your RAWG API key."); }
    setLoading(false);
  }, []);

  if (!appReady) return <div style={{minHeight:"100vh",background:"#07070f",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{color:"rgba(255,255,255,0.3)",fontFamily:"'Space Mono',monospace",fontSize:12}}>Loading...</div></div>;
  if (!user) return <><link href="https://fonts.googleapis.com/css2?family=Bitter:wght@700;900&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet"/><style>{`*{box-sizing:border-box}body{margin:0}input{color-scheme:dark}input::placeholder{color:rgba(255,255,255,0.22)}input:focus{outline:none;border-color:rgba(167,139,250,0.4)!important}`}</style><AuthScreen onLogin={handleLogin}/></>;

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Bitter:wght@700;900&family=Space+Mono:wght@400;700&family=Lora:ital@1&display=swap" rel="stylesheet"/>
      <style>{`*{box-sizing:border-box}body{margin:0}::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:#0d0d18}::-webkit-scrollbar-thumb{background:#2a2a3e;border-radius:3px}input::placeholder{color:rgba(255,255,255,0.25)}input:focus{outline:none;border-color:rgba(255,255,255,0.25)!important}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}.card-anim{animation:fadeIn .4s ease forwards;opacity:0}`}</style>

      <div style={{minHeight:"100vh",background:darkMode?"#080810":"#f4f4f8",backgroundImage:darkMode?"radial-gradient(ellipse at 15% 15%,#1a0a2e 0%,transparent 45%),radial-gradient(ellipse at 85% 85%,#0a1628 0%,transparent 45%)":"radial-gradient(ellipse at 15% 15%,#e0d7ff 0%,transparent 45%),radial-gradient(ellipse at 85% 85%,#d7e8ff 0%,transparent 45%)",transition:"background .3s,color .3s"}}>

        {/* Status Bar */}
        <StatusBar user={user} onUpgrade={()=>setShowPaywall(true)} onLogout={handleLogout}/>
        {/* Profile button in nav */}
        {user && (
          <button onClick={()=>setShowEditProfile(true)}
            style={{position:"fixed",bottom:72,right:20,zIndex:100,
              width:44,height:44,borderRadius:"50%",
              background:userProfile?.avatar_color||"#a78bfa",
              border:"none",cursor:"pointer",fontSize:20,
              display:"flex",alignItems:"center",justifyContent:"center",
              boxShadow:`0 4px 20px ${userProfile?.avatar_color||"#a78bfa"}60`}}>
            {userProfile?.avatar_emoji||"🎮"}
          </button>
        )}
        {/* View my profile button */}
        {user && (
          <button onClick={()=>setViewProfile(user.email)} title="View My Profile"
            style={{position:"fixed",bottom:124,right:20,zIndex:100,
              background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",
              borderRadius:"50%",width:44,height:44,cursor:"pointer",fontSize:16,
              display:"flex",alignItems:"center",justifyContent:"center",
              color:"rgba(255,255,255,0.7)"}}>
            👤
          </button>
        )}
        {/* Theme toggle */}
        <div style={{position:"fixed",bottom:20,right:20,zIndex:100}}>
          <button onClick={()=>setDarkMode(!darkMode)} title={darkMode?"Switch to Light Mode":"Switch to Dark Mode"}
            style={{background:darkMode?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.1)",
              border:`1px solid ${darkMode?"rgba(255,255,255,0.2)":"rgba(0,0,0,0.15)"}`,
              borderRadius:"50%",width:44,height:44,cursor:"pointer",
              fontSize:20,display:"flex",alignItems:"center",justifyContent:"center",
              boxShadow:"0 4px 20px rgba(0,0,0,0.3)",transition:"all .2s"}}>
            {darkMode ? "☀️" : "🌙"}
          </button>
        </div>

        {/* Header */}
        <div style={{textAlign:"center",padding:"32px 20px 20px"}}>
          <h1 style={{margin:"0 0 6px",fontSize:"clamp(30px,6vw,54px)",fontFamily:"'Bitter',serif",fontWeight:900,color:darkMode?"white":"#0f0f1a",lineHeight:1.05,letterSpacing:-1}}>Worth My Time?</h1>
          <p style={{color:darkMode?"rgba(255,255,255,0.38)":"rgba(0,0,0,0.5)",fontSize:13,margin:"0 auto",maxWidth:340,lineHeight:1.7,fontFamily:"'Lora',serif",fontStyle:"italic"}}>
            Real game intelligence for busy people.
          </p>
        </div>

        {/* Quick Finder */}
        <div style={{maxWidth:540,margin:"0 auto 16px",padding:"0 16px"}}>
          <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:14,padding:14}}>
            <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",fontFamily:"'Space Mono',monospace",letterSpacing:2,marginBottom:8}}>⚡ I HAVE THIS MANY MINUTES</div>
            <div style={{display:"flex",gap:8}}>
              <Input placeholder="e.g. 45" type="number" value={minutes}
                onChange={e=>{ const v=e.target.value; setMinutes(v); if(!v) handleClearTimeSearch(); }}
                onKeyDown={e=>e.key==="Enter"&&handleTimeSearch()}
                style={{padding:"10px 12px",fontSize:12,background:darkMode?"rgba(0,0,0,0.5)":"rgba(0,0,0,0.05)",color:darkMode?"white":"#0f0f1a",border:`1px solid ${darkMode?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.15)"}`}}/>
              <Btn onClick={handleTimeSearch} variant="primary" style={{whiteSpace:"nowrap",padding:"10px 16px",fontSize:11,borderRadius:9}}>Find →</Btn>
              {minutes && (
                <button onClick={handleClearTimeSearch}
                  style={{background:"rgba(239,68,68,0.15)",border:"1px solid rgba(239,68,68,0.4)",borderRadius:9,padding:"10px 13px",color:"#f87171",fontSize:11,cursor:"pointer",fontFamily:"'Space Mono',monospace",whiteSpace:"nowrap",fontWeight:700}}>
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Search */}
        <div style={{maxWidth:540,margin:"0 auto 14px",padding:"0 16px"}}>
          <Input placeholder="Search 500,000+ games..." value={search}
            onChange={e=>setSearch(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter"){ clearTimeout(debRef.current); setPage(1); fetchGames(e.target.value,filters,sortBy,1); }}}
            style={{padding:"12px 16px",fontSize:12,background:darkMode?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.05)",color:darkMode?"white":"#0f0f1a",border:`1px solid ${darkMode?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.15)"}`}}/>
        </div>

        {/* Filter Toggle */}
        {access && (
          <div style={{maxWidth:900,margin:"0 auto 14px",padding:"0 16px"}}>
            <button onClick={()=>setShowFilters(!showFilters)} style={{background:darkMode?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.05)",border:`1px solid ${darkMode?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.15)"}`,borderRadius:11,padding:"9px 16px",color:darkMode?"rgba(255,255,255,0.6)":"rgba(0,0,0,0.65)",cursor:"pointer",fontSize:11,fontFamily:"'Space Mono',monospace",display:"flex",alignItems:"center",gap:8}}>
              ⚙ Filters {showFilters?"▲":"▼"}
            </button>
            {showFilters && (
              <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:13,padding:16,marginTop:8,display:"flex",flexDirection:"column",gap:12}}>
                {[
                  ["⏱ SESSION",  [["all","All"],["short","⚡ Quick"],["medium","🕐 Mid"],["long","🏔 Long"]], "time", "white"],
                  ["🎮 GENRE",   [["all","All"],...Object.keys(GENRE_MAP).map(g=>[g,g])], "genre", "#60a5fa"],
                  ["🖥 PLATFORM",[["all","All"],["pc","PC"],["playstation","PS"],["xbox","Xbox"],["nintendo","Nintendo"],["mobile","Mobile"]], "platform", "#a78bfa"],
                  ["🎯 DIFFICULTY",[["all","All"],["easy","Relaxed"],["medium","Medium"],["hard","Challenging"]], "difficulty", "#fbbf24"],
                  ["👥 PLAY STYLE",[["all","All"],["singleplayer","Solo"],["multiplayer","Multi"],["co-op","Co-op"]], "multiplayer", "#34d399"],
                ].map(([label, opts, key, color])=>(
                  <div key={key}>
                    <div style={{fontSize:9,color:darkMode?"rgba(255,255,255,0.3)":"rgba(0,0,0,0.45)",fontFamily:"'Space Mono',monospace",letterSpacing:1.5,marginBottom:6}}>{label}</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {opts.map(([v,l])=>{
                        const active=filters[key]===v;
                        return <button key={v} onClick={()=>setFilters(f=>({...f,[key]:v}))} style={{background:active?(color==="white"?"white":color+"25"):darkMode?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.06)",color:active?(color==="white"?"#080810":color):darkMode?"rgba(255,255,255,0.45)":"rgba(0,0,0,0.6)",border:`1px solid ${active?(color==="white"?"white":color+"70"):darkMode?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.15)"}`,borderRadius:100,padding:"5px 12px",cursor:"pointer",fontSize:10,fontFamily:"'Space Mono',monospace",transition:"all .2s",fontWeight:active?700:400}}>{l}</button>;
                      })}
                    </div>
                  </div>
                ))}
                <button onClick={()=>{setFilters(DEFAULT_FILTERS);setPage(1);}} style={{alignSelf:"flex-start",background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:9,padding:"6px 13px",color:darkMode?"#f87171":"#dc2626",fontSize:10,cursor:"pointer",fontFamily:"'Space Mono',monospace"}}>✕ Clear filters</button>
              </div>
            )}
          </div>
        )}

        {/* Locked filter teaser for expired */}
        {!access && status==="expired" && (
          <div style={{maxWidth:900,margin:"0 auto 14px",padding:"0 16px"}}>
            <div onClick={()=>setShowPaywall(true)} style={{background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.25)",borderRadius:13,padding:"12px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontSize:18}}>🔒</span>
              <div style={{flex:1}}>
                <div style={{fontSize:12,color:"#f59e0b",fontFamily:"'Space Mono',monospace",fontWeight:700}}>Filters locked — Unlock for {PRICE}</div>
                <div style={{fontSize:10,color:darkMode?"rgba(255,255,255,0.35)":"rgba(0,0,0,0.5)",fontFamily:"'Space Mono',monospace"}}>Genre, difficulty, multiplayer, price filters + unlimited searches</div>
              </div>
              <span style={{fontSize:11,color:"#f59e0b",fontFamily:"'Space Mono',monospace",whiteSpace:"nowrap"}}>Unlock →</span>
            </div>
          </div>
        )}

        {/* Sort & count */}
        {hasLoaded && (
          <div style={{maxWidth:900,margin:"0 auto 12px",padding:"0 16px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
            <div style={{fontSize:10,color:darkMode?"rgba(255,255,255,0.3)":"rgba(0,0,0,0.45)",fontFamily:"'Space Mono',monospace"}}>{total.toLocaleString()} games</div>
            <div style={{display:"flex",gap:5}}>
              {[["newest","🆕 Newest"],["rating","⭐ Top Rated"],["metacritic","📊 Metacritic"],["popular","🔥 Popular"]].map(([v,l])=>(
                <button key={v} onClick={()=>{setSortBy(v);setPage(1);}}
                  style={{
                    background: sortBy===v ? "rgba(167,139,250,0.2)" : darkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.07)",
                    color: sortBy===v ? "#a78bfa" : darkMode ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.65)",
                    border: `1px solid ${sortBy===v ? "#a78bfa60" : darkMode ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.2)"}`,
                    borderRadius:7, padding:"5px 10px", cursor:"pointer",
                    fontSize:10, fontFamily:"'Space Mono',monospace",
                    fontWeight: sortBy===v ? 700 : 400,
                    transition:"all .2s"
                  }}>{l}</button>
              ))}
            </div>
          </div>
        )}

        {/* Content */}
        <div style={{maxWidth:900,margin:"0 auto",padding:"0 16px"}}>
          {!hasLoaded && !loading && (
            <div style={{textAlign:"center",padding:"48px 20px"}}>
              <div style={{fontSize:42,marginBottom:12}}>🎮</div>
              <h2 style={{color:darkMode?"white":"#0f0f1a",fontFamily:"'Bitter',serif",margin:"0 0 8px"}}>500,000+ Games Ready</h2>
              <p style={{color:darkMode?"rgba(255,255,255,0.4)":"rgba(0,0,0,0.5)",fontFamily:"'Space Mono',monospace",fontSize:11,marginBottom:22}}>Search or browse the full database</p>
              <Btn onClick={()=>fetchGames("",filters,"rating",1)} variant="primary" style={{padding:"12px 26px",fontSize:12}}>Browse Top Rated →</Btn>
            </div>
          )}

          {loading && (
            <div style={{textAlign:"center",padding:"48px 20px"}}>
              <div style={{display:"inline-flex",gap:6}}>
                {[0,1,2].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:"#a78bfa",animation:"pulse 1.2s ease infinite",animationDelay:`${i*.2}s`}}/>)}
              </div>
              <div style={{color:darkMode?"rgba(255,255,255,0.3)":"rgba(0,0,0,0.45)",fontFamily:"'Space Mono',monospace",fontSize:11,marginTop:10}}>Searching the database...</div>
            </div>
          )}

          {error && <div style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:12,padding:16,marginBottom:16,color:"#fca5a5",fontFamily:"'Space Mono',monospace",fontSize:11,lineHeight:1.7}}>⚠️ {error}</div>}

          {!loading && games.length>0 && (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:13,marginBottom:26}}>
              {games.map((g,i)=>(
                <div key={g.id} className="card-anim" style={{animationDelay:`${i*.04}s`}}>
                  <GameCard game={g} onClick={setSelected} locked={false} darkMode={darkMode}/>
                </div>
              ))}
            </div>
          )}

          {!loading && hasLoaded && games.length===0 && !error && (
            <div style={{textAlign:"center",padding:36,color:darkMode?"rgba(255,255,255,0.3)":"rgba(0,0,0,0.45)",fontFamily:"'Space Mono',monospace",fontSize:11}}>No games found. Try adjusting your filters.</div>
          )}

          {hasLoaded && !loading && total>20 && (
            <div style={{display:"flex",justifyContent:"center",gap:10,alignItems:"center",paddingBottom:36}}>
              <Btn onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1} variant="ghost" style={{padding:"7px 13px",fontSize:11,borderRadius:8,opacity:page===1?.3:1}}>← Prev</Btn>
              <span style={{color:darkMode?"rgba(255,255,255,0.3)":"rgba(0,0,0,0.5)",fontSize:11,fontFamily:"'Space Mono',monospace"}}>Page {page} of {Math.min(Math.ceil(total/20),500)}</span>
              <Btn onClick={()=>setPage(p=>p+1)} variant="ghost" style={{padding:"7px 13px",fontSize:11,borderRadius:8}}>Next →</Btn>
            </div>
          )}
        </div>

        <div style={{textAlign:"center",paddingBottom:26,color:darkMode?"rgba(255,255,255,0.12)":"rgba(0,0,0,0.25)",fontSize:9,letterSpacing:2,fontFamily:"'Space Mono',monospace"}}>
          WORTH MY TIME · RAWG.IO · HLTB · YOUR SCORES
        </div>
      </div>

      {/* Modals */}
      {status==="expired" && !showPaywall && games.length===0 && hasLoaded && <LockedOverlay onUpgrade={()=>setShowPaywall(true)}/>}
      {showPaywall && <PaywallModal user={user} onClose={()=>setShowPaywall(false)} onSuccess={handlePaid}/>}
      <GameModal game={selected} onClose={()=>setSelected(null)} currentUser={user}/>
      {showEditProfile && user && <EditProfileModal user={user} onClose={()=>setShowEditProfile(false)} onSave={p=>setUserProfile(p)}/>}
      {viewProfile && user && <UserProfilePage profileEmail={viewProfile} currentUser={user} onClose={()=>setViewProfile(null)} onEditProfile={()=>{setViewProfile(null);setShowEditProfile(true);}}/>}
    </>
  );
}
