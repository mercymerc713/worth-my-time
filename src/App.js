import React, { useState, useEffect, useCallback, useRef } from "react";


// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const RAWG_KEY = "4d7a97bce7df4cfc94e9981345756746";
const RAWG_BASE = "https://api.rawg.io/api";
const TRIAL_DAYS = 3;
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

async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

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
          <div key={`${r.userEmail}-${game.id}`} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"10px 12px"}}>
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
    await sbFetch("/profiles?on_conflict=user_email", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(profile),
    });
    return true;
  } catch(e) {
    console.error("upsertProfile error:", e);
    throw e;
  }
}

async function getProfileByTag(gamerTag) {
  try {
    const data = await sbFetch(`/profiles?gamer_tag=eq.${encodeURIComponent(gamerTag)}&limit=1`);
    return data?.[0] || null;
  } catch { return null; }
}

// Backlog helpers — store slim game objects in profiles.backlog JSONB
async function addToBacklog(email, game) {
  const profile = await getProfile(email);
  const current = profile?.backlog || [];
  if (current.some(g => g.id === game.id)) return;
  const updated = [...current, { id: game.id, name: game.name, background_image: game.background_image || null, slug: game.slug || null }];
  await upsertProfile({ user_email: email, backlog: updated });
  return updated;
}

async function removeFromBacklog(email, gameId) {
  const profile = await getProfile(email);
  const updated = (profile?.backlog || []).filter(g => g.id !== gameId);
  await upsertProfile({ user_email: email, backlog: updated });
  return updated;
}

// Showcase helpers — store slim game objects in profiles.showcase_games JSONB
async function saveShowcase(email, games) {
  await upsertProfile({ user_email: email, showcase_games: games });
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

// ─── Friend Requests ─────────────────────────────────────────────────────────
// SQL to run in Supabase:
// create table friend_requests (
//   id uuid default gen_random_uuid() primary key,
//   from_email text not null,
//   to_email text not null,
//   status text default 'pending',
//   created_at timestamp with time zone default now(),
//   unique(from_email, to_email)
// );
// alter table friend_requests enable row level security;
// create policy "Anyone can read friend_requests" on friend_requests for select to anon using (true);
// create policy "Anyone can insert friend_requests" on friend_requests for insert to anon with check (true);
// create policy "Anyone can update friend_requests" on friend_requests for update to anon using (true);
// create policy "Anyone can delete friend_requests" on friend_requests for delete to anon using (true);

async function sendFriendRequest(fromEmail, toEmail) {
  try {
    await sbFetch("/friend_requests", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify({ from_email: fromEmail, to_email: toEmail, status: "pending" }),
    });
    return true;
  } catch { return false; }
}

async function getFriendRequestStatus(fromEmail, toEmail) {
  try {
    const data = await sbFetch(`/friend_requests?or=(and(from_email.eq.${encodeURIComponent(fromEmail)},to_email.eq.${encodeURIComponent(toEmail)}),and(from_email.eq.${encodeURIComponent(toEmail)},to_email.eq.${encodeURIComponent(fromEmail)}))`);
    if (!Array.isArray(data)) return null;
    return data?.[0] || null;
  } catch { return null; }
}

async function acceptFriendRequest(fromEmail, toEmail) {
  try {
    await sbFetch(`/friend_requests?from_email=eq.${encodeURIComponent(fromEmail)}&to_email=eq.${encodeURIComponent(toEmail)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "accepted" }),
    });
    // Create mutual follows
    await Promise.all([
      followUser(fromEmail, toEmail),
      followUser(toEmail, fromEmail),
    ]);
    return true;
  } catch { return false; }
}

async function removeFriend(emailA, emailB) {
  try {
    await sbFetch(`/friend_requests?or=(and(from_email.eq.${encodeURIComponent(emailA)},to_email.eq.${encodeURIComponent(emailB)}),and(from_email.eq.${encodeURIComponent(emailB)},to_email.eq.${encodeURIComponent(emailA)}))`, {
      method: "DELETE",
    });
    await Promise.all([
      unfollowUser(emailA, emailB),
      unfollowUser(emailB, emailA),
    ]);
    return true;
  } catch { return false; }
}

async function getPendingFriendRequests(email) {
  try {
    const data = await sbFetch(`/friend_requests?to_email=eq.${encodeURIComponent(email)}&status=eq.pending`);
    return data || [];
  } catch { return []; }
}

// ─── Messaging ───────────────────────────────────────────────────────────────
// SQL to run in Supabase:
// create table messages (
//   id uuid default gen_random_uuid() primary key,
//   from_email text not null,
//   to_email text not null,
//   content text not null,
//   read boolean default false,
//   created_at timestamp with time zone default now()
// );
// alter table messages enable row level security;
// create policy "Anyone can read messages" on messages for select to anon using (true);
// create policy "Anyone can insert messages" on messages for insert to anon with check (true);
// create policy "Anyone can update messages" on messages for update to anon using (true);

async function sendMessage(fromEmail, toEmail, content) {
  try {
    await sbFetch("/messages", {
      method: "POST",
      body: JSON.stringify({ from_email: fromEmail, to_email: toEmail, content: content.trim() }),
    });
    return true;
  } catch { return false; }
}

async function getConversation(emailA, emailB) {
  try {
    const data = await sbFetch(`/messages?or=(and(from_email.eq.${encodeURIComponent(emailA)},to_email.eq.${encodeURIComponent(emailB)}),and(from_email.eq.${encodeURIComponent(emailB)},to_email.eq.${encodeURIComponent(emailA)}))&order=created_at.asc&limit=100`);
    return data || [];
  } catch { return []; }
}

async function getInbox(email) {
  try {
    const data = await sbFetch(`/messages?or=(from_email.eq.${encodeURIComponent(email)},to_email.eq.${encodeURIComponent(email)})&order=created_at.desc&limit=200`);
    if (!Array.isArray(data) || !data?.length) return [];
    // Group into conversations, keep latest message per thread
    const threads = {};
    for (const m of data) {
      const other = m.from_email === email ? m.to_email : m.from_email;
      if (!threads[other]) threads[other] = m;
    }
    return Object.values(threads);
  } catch { return []; }
}

async function markMessagesRead(fromEmail, toEmail) {
  try {
    await sbFetch(`/messages?from_email=eq.${encodeURIComponent(fromEmail)}&to_email=eq.${encodeURIComponent(toEmail)}&read=eq.false`, {
      method: "PATCH",
      body: JSON.stringify({ read: true }),
    });
  } catch { /* non-critical */ }
}

async function getUnreadCount(email) {
  try {
    const data = await sbFetch(`/messages?to_email=eq.${encodeURIComponent(email)}&read=eq.false`);
    return data?.length || 0;
  } catch { return 0; }
}

// ─────────────────────────────────────────────────────────────────────────────
// LIKES & COMMENTS HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function reviewId(r) { return `${r.user_email}_${r.game_id}`; }

async function toggleLike(userEmail, rid, isLiked) {
  try {
    if (isLiked) {
      await sbFetch(`/review_likes?user_email=eq.${encodeURIComponent(userEmail)}&review_id=eq.${encodeURIComponent(rid)}`, { method: "DELETE" });
    } else {
      await sbFetch("/review_likes", { method: "POST", headers: { "Content-Type": "application/json", "Prefer": "resolution=ignore-duplicates" }, body: JSON.stringify({ user_email: userEmail, review_id: rid }) });
    }
    return true;
  } catch { return false; }
}

async function batchLikes(reviewIds) {
  try {
    const data = await sbFetch(`/review_likes?review_id=in.(${reviewIds.map(encodeURIComponent).join(",")})&select=review_id`);
    const counts = {};
    for (const r of (data || [])) counts[r.review_id] = (counts[r.review_id] || 0) + 1;
    return counts;
  } catch { return {}; }
}

async function getUserLikeSet(userEmail) {
  try {
    const data = await sbFetch(`/review_likes?user_email=eq.${encodeURIComponent(userEmail)}&select=review_id`);
    return new Set((data || []).map(r => r.review_id));
  } catch { return new Set(); }
}

async function getComments(rid) {
  try {
    const data = await sbFetch(`/review_comments?review_id=eq.${encodeURIComponent(rid)}&order=created_at.asc&limit=50`);
    return data || [];
  } catch { return []; }
}

async function postComment(rid, userEmail, userName, content) {
  try {
    await sbFetch("/review_comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ review_id: rid, user_email: userEmail, user_name: userName, content }) });
    return true;
  } catch { return false; }
}

async function batchCommentCounts(reviewIds) {
  try {
    const data = await sbFetch(`/review_comments?review_id=in.(${reviewIds.map(encodeURIComponent).join(",")})&select=review_id`);
    const counts = {};
    for (const r of (data || [])) counts[r.review_id] = (counts[r.review_id] || 0) + 1;
    return counts;
  } catch { return {}; }
}

async function getTrendingGames() {
  try {
    const data = await sbFetch(`/reviews?order=created_at.desc&limit=300&select=game_id,game_name`);
    const counts = {};
    for (const r of (data || [])) {
      if (!counts[r.game_id]) counts[r.game_id] = { name: r.game_name, id: r.game_id, count: 0 };
      counts[r.game_id].count++;
    }
    return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 8);
  } catch { return []; }
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
  // Deterministic noise seeded from game.id so scores are stable across renders
  const _id = typeof game.id === "number" ? game.id : 0;
  const n1 = ((_id * 7919) % 7) - 3;
  const n2 = ((_id * 6271) % 9) - 4;
  const n3 = ((_id * 5381) % 7) - 3;
  t=Math.round(t+n1);
  let a=55;
  if (["RPG","Adventure","Action"].some(g=>names.includes(g))) a+=30;
  if (names.includes("Indie")) a+=10;
  if (mc>80) a+=10;
  a=Math.min(99,Math.round(a+n2));
  let w=Math.round((rating/5)*60+30);
  if (mc>85) w=Math.min(99,w+10);
  if (rc>1000) w=Math.min(99,w+5);
  w=Math.round(w+n3);
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
  if (hasPS) {
    result.push({ name:"PS Store",       url:`https://store.playstation.com/en-us/search/${n}`,          icon:"🎮",  color:"#003087" });
    result.push({ name:"PSNProfiles",    url:`https://psnprofiles.com/search/games?q=${n}`,               icon:"🏆",  color:"#003087" });
  }
  if (hasXbox)     result.push({ name:"Xbox",           url:`https://www.xbox.com/en-US/Search/Results?q=${n}`,                 icon:"🟢",  color:"#107c10" });
  if (hasNintendo) result.push({ name:"Nintendo",       url:`https://www.nintendo.com/search/#q=${n}&p=1&cat=gme&sort=df`,      icon:"🔴",  color:"#e4000f" });
  if (hasMobile)   result.push({ name:"Mobile",         url:`https://play.google.com/store/search?q=${n}&c=apps`,               icon:"📱",  color:"#01875f" });

  // Fallback — if we can't detect, show all stores
  if (result.length === 0) {
    return [
      { name:"Steam",       url:`https://store.steampowered.com/search/?term=${n}`, icon:"🖥",  color:"#1b2838" },
      { name:"Epic Games",  url:`https://store.epicgames.com/en-US/browse?q=${n}`,  icon:"⚡",  color:"#2a2a2a" },
      { name:"PS Store",    url:`https://store.playstation.com/en-us/search/${n}`,  icon:"🎮",  color:"#003087" },
      { name:"PSNProfiles", url:`https://psnprofiles.com/search/games?q=${n}`,      icon:"🏆",  color:"#003087" },
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
      <span style={{fontSize:9,color:darkMode?"rgba(255,255,255,0.35)":"#333333",letterSpacing:1.2,textTransform:"uppercase",fontFamily:"'Space Mono',monospace"}}>{label} ⓘ</span>
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
    cursor:disabled?"not-allowed":"pointer",fontFamily:"'Space Mono',monospace",
    transition:"opacity .2s, box-shadow .2s, transform .15s",...s};
  const variants = {
    primary: {background:"white",color:"#07070f",boxShadow:"0 0 18px rgba(255,255,255,0.18)"},
    purple:  {background:"linear-gradient(135deg,#a78bfa,#7c3aed)",color:"white",boxShadow:"0 4px 24px rgba(139,92,246,0.45)"},
    ghost:   {background:"rgba(255,255,255,0.06)",color:"rgba(255,255,255,0.6)",border:"1px solid rgba(255,255,255,0.1)"},
    danger:  {background:"rgba(239,68,68,0.15)",color:"#f87171",border:"1px solid rgba(239,68,68,0.3)"},
    gold:    {background:"linear-gradient(135deg,#f59e0b,#d97706)",color:"#07070f",boxShadow:"0 4px 20px rgba(245,158,11,0.4)"},
  };
  return <button onClick={disabled?undefined:onClick}
    style={{...base,...variants[variant],...s}}
    onMouseEnter={e=>{ if(!disabled){ e.currentTarget.style.opacity=".88"; e.currentTarget.style.transform="translateY(-1px)"; }}}
    onMouseLeave={e=>{ e.currentTarget.style.opacity="1"; e.currentTarget.style.transform="translateY(0)"; }}>
    {children}
  </button>;
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
// PARENTAL CONTROLS PIN MODAL
// ─────────────────────────────────────────────────────────────────────────────
const PARENT_PIN_KEY = "wmt_parent_pin"; // stores hashed PIN in localStorage

async function hashPin(pin) {
  const data = new TextEncoder().encode(pin + "wmt-salt-2026");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function ParentalPinModal({ mode, onSuccess, onCancel, darkMode=true }) {
  // mode: "set" (first time) | "verify" (unlock/lock)
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100); }, []);

  const handleDigit = (d) => {
    if (mode === "set") {
      if (pin.length < 4) { setPin(p => p + d); setErr(""); }
    } else {
      if (pin.length < 4) { setPin(p => p + d); setErr(""); }
    }
  };

  const handleConfirmDigit = (d) => {
    if (confirm.length < 4) setConfirm(c => c + d);
  };

  const handleBack = () => {
    if (mode === "set" && pin.length === 4 && confirm.length > 0) setConfirm(c => c.slice(0, -1));
    else setPin(p => p.slice(0, -1));
  };

  const handleSubmit = async () => {
    setLoading(true); setErr("");
    if (mode === "set") {
      if (pin.length < 4) { setErr("Enter a 4-digit PIN."); setLoading(false); return; }
      if (pin !== confirm) { setErr("PINs don't match. Try again."); setConfirm(""); setLoading(false); return; }
      const hashed = await hashPin(pin);
      localStorage.setItem(PARENT_PIN_KEY, hashed);
      onSuccess();
    } else {
      const stored = localStorage.getItem(PARENT_PIN_KEY);
      const hashed = await hashPin(pin);
      if (hashed === stored) { onSuccess(); }
      else { setErr("Wrong PIN. Try again."); setPin(""); }
    }
    setLoading(false);
  };

  useEffect(() => {
    if (mode === "set" && pin.length === 4 && confirm.length === 4) handleSubmit();
    if (mode === "verify" && pin.length === 4) handleSubmit();
  }, [pin, confirm]);

  const dots = (val) => [0,1,2,3].map(i => (
    <div key={i} style={{width:14,height:14,borderRadius:"50%",background:i<val.length?"#a78bfa":"rgba(255,255,255,0.15)",transition:"background .15s"}}/>
  ));

  const isConfirmStep = mode === "set" && pin.length === 4;

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(16px)"}}>
      <div style={{background:darkMode?"#0d0d18":"#fff",border:`1px solid rgba(167,139,250,0.3)`,borderRadius:24,width:"100%",maxWidth:320,padding:28,textAlign:"center",boxShadow:"0 0 60px rgba(167,139,250,0.15)"}}>
        <div style={{fontSize:36,marginBottom:12}}>🔒</div>
        <h2 style={{margin:"0 0 6px",fontSize:18,fontFamily:"'Bitter',serif",color:darkMode?"white":"#0f0f1a",fontWeight:700}}>
          {mode === "set" ? "Set Parental PIN" : "Parental Controls"}
        </h2>
        <p style={{fontSize:11,color:darkMode?"rgba(255,255,255,0.4)":"rgba(0,0,0,0.5)",fontFamily:"'Space Mono',monospace",margin:"0 0 20px",lineHeight:1.6}}>
          {mode === "set"
            ? isConfirmStep ? "Confirm your PIN" : "Choose a 4-digit PIN"
            : "Enter your parental PIN"}
        </p>

        {/* PIN dots */}
        <div style={{display:"flex",gap:12,justifyContent:"center",marginBottom:20}}>
          {dots(isConfirmStep ? confirm : pin)}
        </div>

        {/* Number pad */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
          {[1,2,3,4,5,6,7,8,9].map(d => (
            <button key={d} onClick={()=>isConfirmStep?handleConfirmDigit(String(d)):handleDigit(String(d))}
              style={{padding:"14px 0",borderRadius:12,border:`1px solid ${darkMode?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.1)"}`,
                background:darkMode?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.04)",
                color:darkMode?"white":"#0f0f1a",fontSize:18,fontWeight:700,cursor:"pointer",
                fontFamily:"'Space Mono',monospace",transition:"background .1s"}}
              onMouseDown={e=>e.currentTarget.style.background="rgba(167,139,250,0.2)"}
              onMouseUp={e=>e.currentTarget.style.background=darkMode?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.04)"}>
              {d}
            </button>
          ))}
          <div/>
          <button onClick={()=>isConfirmStep?handleConfirmDigit("0"):handleDigit("0")}
            style={{padding:"14px 0",borderRadius:12,border:`1px solid ${darkMode?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.1)"}`,
              background:darkMode?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.04)",
              color:darkMode?"white":"#0f0f1a",fontSize:18,fontWeight:700,cursor:"pointer",
              fontFamily:"'Space Mono',monospace"}}
            onMouseDown={e=>e.currentTarget.style.background="rgba(167,139,250,0.2)"}
            onMouseUp={e=>e.currentTarget.style.background=darkMode?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.04)"}>
            0
          </button>
          <button onClick={handleBack}
            style={{padding:"14px 0",borderRadius:12,border:"none",background:"transparent",
              color:darkMode?"rgba(255,255,255,0.5)":"rgba(0,0,0,0.4)",fontSize:18,cursor:"pointer"}}>
            ⌫
          </button>
        </div>

        {err && <div style={{fontSize:11,color:"#f87171",fontFamily:"'Space Mono',monospace",marginBottom:10}}>{err}</div>}
        {loading && <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",fontFamily:"'Space Mono',monospace",marginBottom:10}}>Checking...</div>}

        <button onClick={onCancel}
          style={{background:"none",border:"none",color:darkMode?"rgba(255,255,255,0.3)":"rgba(0,0,0,0.35)",
            fontSize:11,cursor:"pointer",fontFamily:"'Space Mono',monospace",padding:"8px 0"}}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AGE GATE MODAL
// ─────────────────────────────────────────────────────────────────────────────
function AgeGateModal({ onConfirm, onDeny, darkMode=true }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(16px)"}}>
      <div style={{background:darkMode?"#0d0d18":"#fff",border:`1px solid ${darkMode?"rgba(255,100,50,0.4)":"rgba(200,80,30,0.3)"}`,borderRadius:24,width:"100%",maxWidth:380,padding:32,textAlign:"center",boxShadow:"0 0 80px rgba(249,115,22,0.2)"}}>
        <div style={{fontSize:48,marginBottom:16}}>🔞</div>
        <h2 style={{margin:"0 0 10px",fontSize:22,fontFamily:"'Bitter',serif",color:darkMode?"white":"#0f0f1a",fontWeight:700}}>Age Verification</h2>
        <p style={{fontSize:12,color:darkMode?"rgba(255,255,255,0.5)":"rgba(0,0,0,0.5)",fontFamily:"'Space Mono',monospace",lineHeight:1.7,margin:"0 0 28px"}}>
          This will show games rated Mature (17+) and Adults Only.<br/>You must be 18 or older to continue.
        </p>
        <button onClick={onConfirm}
          style={{width:"100%",padding:"13px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#f97316,#ef4444)",color:"white",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"'Space Mono',monospace",marginBottom:10,letterSpacing:"0.3px"}}>
          Yes, I am 18 or older
        </button>
        <button onClick={onDeny}
          style={{width:"100%",padding:"11px",borderRadius:12,border:`1px solid ${darkMode?"rgba(255,255,255,0.12)":"rgba(0,0,0,0.12)"}`,background:"transparent",color:darkMode?"rgba(255,255,255,0.4)":"rgba(0,0,0,0.4)",fontWeight:400,fontSize:12,cursor:"pointer",fontFamily:"'Space Mono',monospace"}}>
          No, take me back
        </button>
        <p style={{fontSize:9,color:darkMode?"rgba(255,255,255,0.2)":"rgba(0,0,0,0.25)",fontFamily:"'Space Mono',monospace",marginTop:16,lineHeight:1.5}}>
          Your choice is saved locally on this device.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYWALL MODAL
// ─────────────────────────────────────────────────────────────────────────────
function PaywallModal({ user, onClose, onSuccess }) {
  const [step, setStep] = useState("offer"); // offer | payment | success
  const [stripeOpened, setStripeOpened] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyErr, setVerifyErr] = useState("");
  const [err, setErr] = useState("");
  const status = getAccountStatus(user);

  const verifyPayment = async () => {
    setVerifying(true); setVerifyErr("");
    try {
      // First check Supabase (fast, covers webhook-marked accounts)
      const account = await sbGetAccount(user.email);
      if (account?.is_paid) {
        await onSuccess();
        setStep("success");
        setVerifying(false);
        return;
      }
      // Fallback: ask our server to verify directly with Stripe
      const res = await fetch("/api/verify-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email }),
      });
      const data = await res.json();
      if (data?.paid) {
        // Server confirmed payment and updated Supabase — reload account
        const updated = await sbGetAccount(user.email);
        if (updated?.is_paid) {
          await onSuccess();
          setStep("success");
        } else {
          setVerifyErr("Payment confirmed but account update failed. Please contact support.");
        }
      } else {
        setVerifyErr("Payment not confirmed yet. If you just paid, please wait a moment and try again.");
      }
    } catch {
      setVerifyErr("Could not reach payment server. Check your connection and try again.");
    }
    setVerifying(false);
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
                Your 3-day trial has ended.
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
              <Btn onClick={()=>{ const link = user?.email ? `${STRIPE_PAYMENT_LINK}?prefilled_email=${encodeURIComponent(user.email)}` : STRIPE_PAYMENT_LINK; window.open(link,"_blank"); setStripeOpened(true); }} variant="gold" style={{width:"100%",fontSize:15,padding:"14px",borderRadius:13}}>
                Pay {PRICE} Securely on Stripe →
              </Btn>
              {stripeOpened && (
                <div style={{marginTop:14}}>
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",fontFamily:"'Space Mono',monospace",textAlign:"center",marginBottom:10,lineHeight:1.6}}>
                    Once you've completed checkout on Stripe, click below to activate your account.
                  </div>
                  <Btn onClick={verifyPayment} disabled={verifying} variant="purple" style={{width:"100%",fontSize:13,padding:"12px",borderRadius:13,opacity:verifying?0.7:1}}>
                    {verifying ? "Verifying..." : "I've Completed Payment — Activate Access →"}
                  </Btn>
                  {verifyErr && <div style={{marginTop:8,fontSize:11,color:"#fca5a5",fontFamily:"'Space Mono',monospace",textAlign:"center"}}>{verifyErr}</div>}
                </div>
              )}
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
  const [showcaseGames, setShowcaseGames] = useState([]);

  useEffect(() => {
    const randomPage = Math.floor(Math.random() * 15) + 1;
    const todayDate = new Date().toISOString().split("T")[0];
    fetch(`${RAWG_BASE}/games?key=${RAWG_KEY}&page_size=20&page=${randomPage}&ordering=-rating&metacritic=75,100&dates=2010-01-01,${todayDate}&exclude_additions=true`)
      .then(r => r.json())
      .then(d => setShowcaseGames((d.results||[]).filter(g=>g.background_image).slice(0,14)))
      .catch(()=>{});
  }, []);
  const [submitting, setSubmitting] = useState(false);

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
      setErr("Failed to send reset email. Please check your email address and try again.");
      return;
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
    const ok = await sbUpdateAccount(emailKey, { password_hash: await hashPassword(newPass) });
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
    if (submitting) return;
    setSubmitting(true);
    try {
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
        setPendingUser({ name: name.trim(), emailKey, passwordHash: await hashPassword(pass) });

        // Send verification email
        const sent = await sendVerificationEmail(emailKey, name.trim(), code);
        if (!sent) {
          setErr("Failed to send verification email. Please check your email address and try again.");
          setVerifyStep(1);
          return;
        }
        setSuccess(`Verification code sent to ${emailKey} — check your inbox and spam folder.`);
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
      const hash = await hashPassword(pass);
      if (hash !== account.password_hash) {
        // Migrate legacy btoa-encoded passwords to SHA-256 on successful login
        if (btoa(pass) === account.password_hash) {
          await sbUpdateAccount(emailKey, { password_hash: hash });
        } else {
          setErr("Incorrect password. Please try again."); return;
        }
      }

      const user = accountToUser(account);
      await store.set("wmt_user", user); // cache session locally
      onLogin(user);
    }
    } finally { setSubmitting(false); }
  };

  return (
    <div style={{minHeight:"100vh",background:"#05050e",backgroundImage:"radial-gradient(ellipse at 25% 15%, #200a42 0%, transparent 50%), radial-gradient(ellipse at 75% 85%, #051a35 0%, transparent 50%), radial-gradient(ellipse at 50% 50%, #0d0820 0%, transparent 70%)"}}>

      {/* ── HERO SECTION ── */}
      <div style={{textAlign:"center",padding:"52px 20px 40px",maxWidth:700,margin:"0 auto"}}>
        <div style={{display:"inline-block",background:"linear-gradient(135deg,rgba(167,139,250,0.2),rgba(124,58,237,0.15))",border:"1px solid rgba(167,139,250,0.4)",borderRadius:20,padding:"5px 16px",fontSize:10,color:"#c4b5fd",fontFamily:"'Space Mono',monospace",fontWeight:700,letterSpacing:1.5,marginBottom:18,boxShadow:"0 0 20px rgba(167,139,250,0.15)"}}>
          🚀 NOW IN EARLY ACCESS
        </div>
        <h1 style={{margin:"0 0 14px",fontSize:"clamp(36px,7vw,64px)",fontFamily:"'Bitter',serif",fontWeight:900,color:"white",letterSpacing:-2,lineHeight:1.05,textShadow:"0 0 60px rgba(167,139,250,0.5), 0 0 120px rgba(124,58,237,0.25)"}}>
          Worth My Time?
        </h1>
        <p style={{color:"rgba(255,255,255,0.5)",fontSize:"clamp(13px,2vw,16px)",fontFamily:"'Lora',serif",fontStyle:"italic",margin:"0 auto 32px",maxWidth:480,lineHeight:1.7}}>
          Game intelligence for busy people. Discover games that fit your schedule — not the other way around.
        </p>

        {/* 3 value props */}
        <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap",marginBottom:40}}>
          {[
            ["⏱","Session-Friendly Scores","Know before you play if a game fits 30 mins or needs 3 hours"],
            ["🎮","500,000+ Games","The full database, scored and filtered for time-pressed players"],
            ["💰","One-Time Payment",`No subscriptions — pay ${PRICE} once, keep access forever`],
          ].map(([icon,title,desc])=>(
            <div key={title} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:16,padding:"16px 18px",maxWidth:200,textAlign:"left",flex:"1 0 160px",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",boxShadow:"inset 0 1px 0 rgba(255,255,255,0.07)"}}>
              <div style={{fontSize:22,marginBottom:8}}>{icon}</div>
              <div style={{fontSize:12,color:"white",fontWeight:700,fontFamily:"'Space Mono',monospace",marginBottom:4,lineHeight:1.3}}>{title}</div>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:"'Space Mono',monospace",lineHeight:1.6}}>{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── GAME SHOWCASE STRIP ── */}
      {showcaseGames.length > 0 && (
        <div style={{overflow:"hidden",marginBottom:36,maskImage:"linear-gradient(to right,transparent,black 8%,black 92%,transparent)",WebkitMaskImage:"linear-gradient(to right,transparent,black 8%,black 92%,transparent)"}}>
          <div style={{display:"flex",gap:10,padding:"4px 40px",overflowX:"auto",scrollbarWidth:"none"}}
            ref={el=>{ if(el){ el.style.cssText+="scrollbar-width:none;-ms-overflow-style:none;"; } }}>
            {showcaseGames.map(g=>(
              <div key={g.id} style={{flexShrink:0,width:130,height:78,borderRadius:10,overflow:"hidden",border:"1px solid rgba(255,255,255,0.07)",position:"relative"}}>
                <img src={g.background_image} alt={g.name} loading="lazy" decoding="async" style={{width:"100%",height:"100%",objectFit:"cover",opacity:0.7}}/>
                <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(0,0,0,0.7),transparent 50%)"}}/>
                <div style={{position:"absolute",bottom:5,left:7,right:7,fontSize:8,color:"rgba(255,255,255,0.75)",fontFamily:"'Space Mono',monospace",lineHeight:1.2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{g.name}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── AUTH FORM ── */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"0 20px 60px"}}>
      <div style={{width:"100%",maxWidth:400}}>
        {/* Trial offer banner */}
        <div style={{background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.3)",borderRadius:14,padding:"12px 16px",marginBottom:20,textAlign:"center"}}>
          <div style={{fontSize:13,color:"#a78bfa",fontFamily:"'Space Mono',monospace",fontWeight:700,marginBottom:3}}>🎮 Start your 3-day free trial</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",fontFamily:"'Space Mono',monospace"}}>Full access free for 3 days · Then just {PRICE} one-time</div>
        </div>

        <div style={{background:"rgba(255,255,255,0.045)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:20,padding:26,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",boxShadow:"inset 0 1px 0 rgba(255,255,255,0.1), 0 20px 60px rgba(0,0,0,0.5)"}}>

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
                  <Btn onClick={submit} disabled={submitting} variant="purple" style={{width:"100%",marginTop:16,opacity:submitting?0.7:1}}>{submitting?"Sending...":"Send Verification Code →"}</Btn>
                  <div style={{marginTop:12,fontSize:10,color:"rgba(255,255,255,0.25)",fontFamily:"'Space Mono',monospace",textAlign:"center",lineHeight:1.6}}>
                    We'll verify your email before creating your account<br/>
                    3 days free · No credit card required · {PRICE} one-time after trial
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
                  <Btn onClick={submit} disabled={submitting} variant="purple" style={{width:"100%",marginTop:14,opacity:submitting?0.7:1}}>{submitting?"Creating account...":"Verify & Create Account →"}</Btn>
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
                  <Btn onClick={submit} disabled={submitting} variant="purple" style={{width:"100%",marginTop:16,opacity:submitting?0.7:1}}>{submitting?"Signing in...":"Sign In →"}</Btn>
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
      </div>{/* end auth form wrapper */}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RECOMMENDATIONS SECTION
// ─────────────────────────────────────────────────────────────────────────────
function RecommendationsSection({ user, onGameClick, darkMode }) {
  const [recs, setRecs] = useState([]);
  const [basedOn, setBasedOn] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const reviews = await getUserReviews(user.email);
        const topRated = reviews.filter(r => r.rating >= 4).slice(0, 3);
        if (!topRated.length) { setReady(true); return; }
        setBasedOn(topRated.map(r => r.game_name));
        const reviewedIds = new Set(reviews.map(r => String(r.game_id)));
        const results = await Promise.all(
          topRated.map(r =>
            fetch(`${RAWG_BASE}/games/${r.game_id}/suggested?key=${RAWG_KEY}&page_size=6`)
              .then(res => res.json()).then(d => d.results || []).catch(() => [])
          )
        );
        const seen = new Set();
        const filtered = results.flat().filter(g => {
          if (!g.background_image || reviewedIds.has(String(g.id)) || seen.has(g.id)) return false;
          seen.add(g.id); return true;
        });
        setRecs(filtered.slice(0, 12));
      } catch {}
      setReady(true);
    })();
  }, [user.email]);

  if (!ready || recs.length === 0) return null;

  return (
    <div style={{marginBottom:32}}>
      <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:12,flexWrap:"wrap"}}>
        <div style={{fontSize:9,color:darkMode?"rgba(255,255,255,0.35)":"#333",fontFamily:"'Space Mono',monospace",letterSpacing:2,fontWeight:800}}>✨ RECOMMENDED FOR YOU</div>
        <div style={{fontSize:9,color:darkMode?"rgba(255,255,255,0.2)":"#888",fontFamily:"'Space Mono',monospace"}}>based on {basedOn.slice(0,2).join(", ")}</div>
      </div>
      <div style={{display:"flex",gap:10,overflowX:"auto",paddingBottom:8,scrollbarWidth:"thin",scrollbarColor:"#2a2a3e transparent"}}>
        {recs.map(game => {
          const scores = computeScores(game);
          const color = accentOf(game.genres);
          return (
            <div key={game.id} onClick={()=>onGameClick(game)}
              style={{flexShrink:0,width:148,cursor:"pointer",borderRadius:14,overflow:"hidden",
                background:darkMode?"#0d0d18":"#fff",
                border:`1px solid ${darkMode?"rgba(255,255,255,0.07)":"rgba(0,0,0,0.08)"}`,
                transition:"transform .2s,box-shadow .2s"}}
              onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow=`0 12px 30px ${color}35`;}}
              onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="none";}}>
              <div style={{height:88,overflow:"hidden",position:"relative",background:"#1a1a2e"}}>
                <img src={game.background_image} alt={game.name} loading="lazy" decoding="async" style={{width:"100%",height:"100%",objectFit:"cover",opacity:.85}}/>
                {game.metacritic && <div style={{position:"absolute",top:5,right:5,background:game.metacritic>74?"#16a34a":game.metacritic>59?"#ca8a04":"#dc2626",borderRadius:5,padding:"1px 5px",fontSize:9,color:"white",fontWeight:700,fontFamily:"'Space Mono',monospace"}}>MC {game.metacritic}</div>}
              </div>
              <div style={{padding:"8px 10px"}}>
                <div style={{fontSize:11,fontWeight:700,color:darkMode?"white":"#0f0f1a",fontFamily:"'Bitter',serif",lineHeight:1.2,marginBottom:6,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden",minHeight:26}}>{game.name}</div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:9,fontFamily:"'Space Mono',monospace"}}>
                  <span style={{color,fontWeight:700}}>T:{scores.t}</span>
                  <span style={{color,fontWeight:700}}>A:{scores.a}</span>
                  <span style={{color,fontWeight:700}}>W:{scores.w}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TRENDING SECTION
// ─────────────────────────────────────────────────────────────────────────────
function TrendingSection({ onGameClick, darkMode }) {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("top");

  useEffect(() => {
    setLoading(true);
    const today = new Date().toISOString().split("T")[0];
    let url;
    if (category === "top") {
      url = `${RAWG_BASE}/games?key=${RAWG_KEY}&page_size=15&ordering=-rating&metacritic=80,100&dates=2015-01-01,${today}&exclude_additions=true`;
    } else if (category === "new") {
      const threeMonthsAgo = new Date(Date.now() - 90*24*60*60*1000).toISOString().split("T")[0];
      url = `${RAWG_BASE}/games?key=${RAWG_KEY}&page_size=15&ordering=-released&dates=${threeMonthsAgo},${today}&exclude_additions=true`;
    } else {
      url = `${RAWG_BASE}/games?key=${RAWG_KEY}&page_size=15&ordering=-rating&genres=puzzle,arcade,indie&dates=2015-01-01,${today}&exclude_additions=true`;
    }
    fetch(url)
      .then(r => r.json())
      .then(data => {
        setGames((data.results||[]).filter(g=>g.background_image).slice(0,12));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [category]);

  return (
    <div style={{marginBottom:32}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:9,color:darkMode?"rgba(255,255,255,0.35)":"#333",fontFamily:"'Space Mono',monospace",letterSpacing:2,fontWeight:800}}>
          🔥 FEATURED GAMES
        </div>
        <div style={{display:"flex",gap:5}}>
          {[["top","⭐ Top Rated"],["new","🆕 Just Released"],["short","⚡ Quick Play"]].map(([v,l])=>(
            <button key={v} onClick={()=>setCategory(v)}
              style={{background:category===v?"rgba(167,139,250,0.2)":darkMode?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.06)",
                color:category===v?"#a78bfa":darkMode?"rgba(255,255,255,0.45)":"rgba(0,0,0,0.5)",
                border:`1px solid ${category===v?"rgba(167,139,250,0.4)":darkMode?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.12)"}`,
                borderRadius:20,padding:"4px 10px",cursor:"pointer",fontSize:9,
                fontFamily:"'Space Mono',monospace",fontWeight:category===v?700:400,transition:"all .2s"}}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{display:"flex",gap:6,alignItems:"center",padding:"24px 0"}}>
          {[0,1,2].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:"#a78bfa",animation:"pulse 1.2s ease infinite",animationDelay:`${i*.2}s`}}/>)}
        </div>
      ) : (
        <div style={{display:"flex",gap:10,overflowX:"auto",paddingBottom:8,scrollbarWidth:"thin",scrollbarColor:"#2a2a3e transparent"}}>
          {games.map(game => {
            const scores = computeScores(game);
            const color = accentOf(game.genres);
            return (
              <div key={game.id} onClick={()=>onGameClick(game)}
                style={{flexShrink:0,width:148,cursor:"pointer",borderRadius:14,overflow:"hidden",
                  background:darkMode?"#0d0d18":"#fff",
                  border:`1px solid ${darkMode?"rgba(255,255,255,0.07)":"rgba(0,0,0,0.08)"}`,
                  transition:"transform .2s,box-shadow .2s"}}
                onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow=`0 12px 30px ${color}35`;}}
                onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="none";}}>
                <div style={{height:88,overflow:"hidden",position:"relative",background:"#1a1a2e"}}>
                  {game.background_image
                    ? <img src={game.background_image} alt={game.name} loading="lazy" decoding="async" style={{width:"100%",height:"100%",objectFit:"cover",opacity:.85}}/>
                    : <div style={{width:"100%",height:"100%",background:`linear-gradient(135deg,${color}30,#0d0d18)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>🎮</div>}
                  <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,#0d0d18,transparent 60%)"}}/>
                  {game.metacritic && <div style={{position:"absolute",top:5,right:5,background:game.metacritic>74?"#16a34a":game.metacritic>59?"#ca8a04":"#dc2626",borderRadius:5,padding:"1px 5px",fontSize:9,color:"white",fontWeight:700,fontFamily:"'Space Mono',monospace"}}>MC {game.metacritic}</div>}
                </div>
                <div style={{padding:"8px 10px"}}>
                  <div style={{fontSize:11,fontWeight:700,color:darkMode?"white":"#0f0f1a",fontFamily:"'Bitter',serif",lineHeight:1.2,marginBottom:6,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden",minHeight:26}}>{game.name}</div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:9,fontFamily:"'Space Mono',monospace"}}>
                    <span style={{color:color,fontWeight:700}}>T:{scores.t}</span>
                    <span style={{color:color,fontWeight:700}}>A:{scores.a}</span>
                    <span style={{color:color,fontWeight:700}}>W:{scores.w}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVACY POLICY MODAL
// ─────────────────────────────────────────────────────────────────────────────
function PrivacyModal({ onClose }) {
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(12px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0d0d18",border:"1px solid rgba(255,255,255,0.1)",borderRadius:24,width:"100%",maxWidth:520,maxHeight:"85vh",overflowY:"auto",padding:28,position:"relative"}}>
        <button onClick={onClose} style={{position:"absolute",top:14,right:14,background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",color:"white",borderRadius:10,width:32,height:32,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        <div style={{fontSize:9,color:"#a78bfa",fontFamily:"'Space Mono',monospace",letterSpacing:2,marginBottom:6}}>LEGAL</div>
        <h2 style={{margin:"0 0 18px",fontSize:20,fontFamily:"'Bitter',serif",color:"white"}}>Privacy Policy</h2>
        <div style={{fontSize:12,color:"rgba(255,255,255,0.6)",fontFamily:"'Space Mono',monospace",lineHeight:1.85,display:"flex",flexDirection:"column",gap:16}}>
          <p style={{margin:0}}><span style={{color:"white",fontWeight:700}}>Last updated: {new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})}</span></p>
          {[
            ["What we collect", "When you create an account we store your email address, display name, and a hashed (encrypted) version of your password. We also store game reviews and ratings you submit, and the list of players you follow."],
            ["How we use it", "Your data is used solely to operate Worth My Time — to authenticate you, save your reviews, and power the community feed. We do not sell your data, share it with advertisers, or use it for any purpose outside the app."],
            ["Payments", "Payments are processed by Stripe. We never see or store your card details. Stripe's privacy policy applies to payment data: stripe.com/privacy."],
            ["Email", "We send a one-time verification code when you sign up or reset your password. We do not send marketing emails without your consent."],
            ["Data storage", "Your data is stored in Supabase (PostgreSQL), hosted in the United States. By using this service you consent to your data being stored there."],
            ["Cookies & tracking", "We do not use tracking cookies or third-party analytics. The only storage used is your browser's localStorage to keep you logged in."],
            ["Data deletion", "To delete your account and all associated data, email us at support@worthmytime.info. We will process your request within 30 days."],
            ["Contact", "Questions about this policy? Email support@worthmytime.info."],
          ].map(([title, body]) => (
            <div key={title}>
              <div style={{color:"#a78bfa",marginBottom:4,fontSize:11,letterSpacing:0.5}}>{title}</div>
              <p style={{margin:0}}>{body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TERMS OF SERVICE MODAL
// ─────────────────────────────────────────────────────────────────────────────
function TermsModal({ onClose }) {
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(12px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0d0d18",border:"1px solid rgba(255,255,255,0.1)",borderRadius:24,width:"100%",maxWidth:520,maxHeight:"85vh",overflowY:"auto",padding:28,position:"relative"}}>
        <button onClick={onClose} style={{position:"absolute",top:14,right:14,background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",color:"white",borderRadius:10,width:32,height:32,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        <div style={{fontSize:9,color:"#a78bfa",fontFamily:"'Space Mono',monospace",letterSpacing:2,marginBottom:6}}>LEGAL</div>
        <h2 style={{margin:"0 0 18px",fontSize:20,fontFamily:"'Bitter',serif",color:"white"}}>Terms of Service</h2>
        <div style={{fontSize:12,color:"rgba(255,255,255,0.6)",fontFamily:"'Space Mono',monospace",lineHeight:1.85,display:"flex",flexDirection:"column",gap:16}}>
          <p style={{margin:0}}><span style={{color:"white",fontWeight:700}}>Last updated: {new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})}</span></p>
          {[
            ["Acceptance", "By creating an account or using Worth My Time you agree to these terms. If you do not agree, do not use the service."],
            ["The service", "Worth My Time provides game discovery tools, scoring, and community features. Game data is sourced from RAWG.io and HowLongToBeat. Scores are algorithmically generated estimates — not guarantees."],
            ["Your account", "You are responsible for keeping your login credentials secure. You must be 13 years or older to use this service. One account per person."],
            ["Payments & access", `A one-time payment of ${PRICE} grants lifetime access to all features. A ${TRIAL_DAYS}-day free trial is available with no payment required. All sales are final — we do not offer refunds except where required by law.`],
            ["User content", "Reviews and ratings you post are your own. By submitting content you grant Worth My Time a license to display it within the app. Do not post content that is illegal, hateful, or harassing."],
            ["Prohibited use", "You may not attempt to scrape, reverse-engineer, or abuse the service. Automated access without permission is prohibited."],
            ["Disclaimers", "The service is provided as-is. We make no warranty that it will be uninterrupted or error-free. Game scores and time estimates are approximations only."],
            ["Changes", "We may update these terms at any time. Continued use of the service after changes constitutes acceptance."],
            ["Contact", "Questions? Email support@worthmytime.info."],
          ].map(([title, body]) => (
            <div key={title}>
              <div style={{color:"#a78bfa",marginBottom:4,fontSize:11,letterSpacing:0.5}}>{title}</div>
              <p style={{margin:0}}>{body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FAQ MODAL
// ─────────────────────────────────────────────────────────────────────────────
function FAQModal({ onClose, darkMode=true }) {
  const [open, setOpen] = useState(null);
  const bg = darkMode ? "#0d0d18" : "#ffffff";
  const border = darkMode ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.12)";
  const text = darkMode ? "white" : "#0f0f1a";
  const muted = darkMode ? "rgba(255,255,255,0.4)" : "#555";

  const faqs = [
    ["What are the Time, Adventure, and Worth It scores?",
     "Time (T) measures how session-friendly a game is — 90+ means great 15–30 min sessions, below 50 means you need 2+ hours to feel progress. Adventure (A) rates story depth and world richness. Worth It (W) combines player ratings, Metacritic scores, and review sentiment to tell you if the game deserves your limited hours."],
    ["How is the free trial different from full access?",
     `Your 3-day free trial gives you complete access to everything — all 500,000+ games, filters, reviews, and profiles. After 3 days you'll need the one-time ${PRICE} payment to continue. No subscriptions, ever.`],
    [`Is the ${PRICE} really a one-time payment?`,
     "Yes. Pay once, keep access forever. We will never charge you again and there are no hidden fees or tiers."],
    ["Where does the game data come from?",
     "Game data is sourced from RAWG, one of the largest game databases with 500,000+ titles. Playtime estimates are based on HowLongToBeat averages by genre. Scores are calculated from genre, ratings, and Metacritic data."],
    ["Can I trust the scores?",
     "Scores are algorithmic estimates — they're a quick starting point for busy people, not a replacement for reading reviews. Always check the community reviews on each game for real player opinions."],
    ["How do community reviews work?",
     "Any logged-in user can leave a star rating, time spent, and a written review on any game. Reviews can be posted anonymously. The average rating is shown on each game's detail page."],
    ["I paid but my account isn't unlocked. What do I do?",
     "After paying on Stripe, click 'I've Completed Payment — Activate Access' in the checkout modal. This checks your payment and unlocks your account instantly. If it still doesn't work, sign out and back in — your paid status will load on next login."],
  ];

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(14px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:bg,border:`1px solid ${border}`,borderRadius:24,width:"100%",maxWidth:560,maxHeight:"88vh",overflowY:"auto",boxShadow:"0 0 80px rgba(0,0,0,0.6)"}}>
        <div style={{padding:"28px 28px 0"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
            <h2 style={{margin:0,fontSize:22,fontFamily:"'Bitter',serif",color:text,fontWeight:900}}>FAQ & About</h2>
            <button onClick={onClose} style={{background:"none",border:"none",color:muted,fontSize:20,cursor:"pointer",padding:"4px 8px"}}>✕</button>
          </div>
          <p style={{margin:"0 0 22px",fontSize:12,color:muted,fontFamily:"'Space Mono',monospace",lineHeight:1.8}}>
            Worth My Time? is a game discovery tool built for people with limited gaming time. We score every game on three dimensions that matter when you're busy.
          </p>

          {/* Score explainer */}
          <div style={{background:darkMode?"rgba(255,255,255,0.03)":"rgba(0,0,0,0.04)",border:`1px solid ${border}`,borderRadius:14,padding:16,marginBottom:22}}>
            <div style={{fontSize:9,color:muted,fontFamily:"'Space Mono',monospace",letterSpacing:1.5,marginBottom:12,fontWeight:700}}>HOW SCORES WORK (0–99)</div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {[
                ["T","Time","#4ade80","Session-friendliness. 90+ = play 15–30 min and feel satisfied. Below 50 = needs long sittings."],
                ["A","Adventure","#60a5fa","Story depth and world richness. High = compelling narrative. Low = story-light or repetitive."],
                ["W","Worth It","#fbbf24","Overall value. Combines player ratings, Metacritic, and popularity. High = overwhelmingly recommended."],
              ].map(([abbr,name,color,desc])=>(
                <div key={abbr} style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                  <div style={{width:32,height:32,borderRadius:8,background:color+"20",border:`1px solid ${color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:900,color,fontFamily:"'Space Mono',monospace",flexShrink:0}}>{abbr}</div>
                  <div>
                    <div style={{fontSize:12,fontWeight:700,color:text,fontFamily:"'Space Mono',monospace",marginBottom:2}}>{name}</div>
                    <div style={{fontSize:11,color:muted,fontFamily:"'Space Mono',monospace",lineHeight:1.6}}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* FAQ accordions */}
        <div style={{padding:"0 28px 28px",display:"flex",flexDirection:"column",gap:6}}>
          <div style={{fontSize:9,color:muted,fontFamily:"'Space Mono',monospace",letterSpacing:1.5,marginBottom:4,fontWeight:700}}>FREQUENTLY ASKED QUESTIONS</div>
          {faqs.map(([q,a],i)=>(
            <div key={i} style={{border:`1px solid ${border}`,borderRadius:12,overflow:"hidden"}}>
              <button onClick={()=>setOpen(open===i?null:i)}
                style={{width:"100%",background:open===i?darkMode?"rgba(167,139,250,0.08)":"rgba(167,139,250,0.06)":"transparent",border:"none",padding:"12px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,textAlign:"left"}}>
                <span style={{fontSize:12,color:text,fontFamily:"'Space Mono',monospace",fontWeight:open===i?700:400,lineHeight:1.5}}>{q}</span>
                <span style={{color:"#a78bfa",fontSize:16,flexShrink:0,transition:"transform .2s",display:"inline-block",transform:open===i?"rotate(45deg)":"rotate(0deg)"}}>+</span>
              </button>
              {open===i && (
                <div style={{padding:"0 16px 14px",borderTop:`1px solid ${border}`}}>
                  <div style={{paddingTop:10,fontSize:12,color:muted,fontFamily:"'Space Mono',monospace",lineHeight:1.8}}>{a}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GAME CARD
// ─────────────────────────────────────────────────────────────────────────────
function GameCard({ game, onClick, locked, darkMode=true, currentUser=null, inBacklog=false, onToggleBacklog=null }) {
  const [hov, setHov] = useState(false);
  const [backlogBusy, setBacklogBusy] = useState(false);
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

  const worthColor = scores.w >= 75 ? "#4ade80" : scores.w >= 50 ? color : "#f87171";

  return (
    <div onClick={()=>onClick(game)} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{borderRadius:18,overflow:"hidden",cursor:"pointer",position:"relative",
        border:`1px solid ${hov?color+"70":darkMode?"rgba(255,255,255,0.07)":"rgba(0,0,0,0.09)"}`,
        transform:hov?"translateY(-4px) scale(1.01)":"translateY(0) scale(1)",
        transition:"all .28s cubic-bezier(.4,0,.2,1)",
        background:darkMode?"#0d0d18":"#ffffff",
        filter:locked?"blur(2px) brightness(0.5)":"none",
        boxShadow:hov?`0 20px 60px ${color}30`:darkMode?"0 2px 12px rgba(0,0,0,0.4)":"0 2px 12px rgba(0,0,0,0.1)"}}>
      {/* Worth It accent bar */}
      <div style={{height:3,background:`linear-gradient(90deg,${worthColor},${worthColor}55)`,opacity:hov?1:0.7,transition:"opacity .28s"}}/>
      <div style={{position:"relative",height:122,overflow:"hidden",background:"#1a1a2e"}}>
        {game.background_image
          ? <img src={game.background_image} alt={game.name} loading="lazy" decoding="async" style={{width:"100%",height:"100%",objectFit:"cover",opacity:.8,transition:"transform .4s",transform:hov?"scale(1.05)":"scale(1)"}}/>
          : <div style={{width:"100%",height:"100%",background:`linear-gradient(135deg,${color}30,#0d0d18)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:34}}>🎮</div>}
        <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,#0d0d18 0%,transparent 60%)"}}/>
        <div style={{position:"absolute",top:8,left:8,background:"rgba(0,0,0,0.75)",backdropFilter:"blur(8px)",borderRadius:20,padding:"2px 8px",fontSize:9,color,fontFamily:"'Space Mono',monospace",border:`1px solid ${color}40`}}>{catLbl}</div>
        {game.metacritic && <div style={{position:"absolute",top:8,right:8,background:game.metacritic>74?"#16a34a":game.metacritic>59?"#ca8a04":"#dc2626",borderRadius:7,padding:"2px 7px",fontSize:10,color:"white",fontWeight:700,fontFamily:"'Space Mono',monospace"}}>MC {game.metacritic}</div>}
      </div>
      <div style={{padding:"11px 13px 13px"}}>
        <h3 style={{margin:"0 0 3px",fontSize:14,fontFamily:"'Bitter',serif",fontWeight:700,color:darkMode?"white":"#0f0f1a",lineHeight:1.2,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{game.name}</h3>
        <div style={{fontSize:10,color:darkMode?"rgba(255,255,255,0.3)":"#444444",fontFamily:"'Space Mono',monospace",marginBottom:7}}>
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
        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:darkMode?"rgba(255,255,255,0.3)":"rgba(0,0,0,0.4)",fontFamily:"'Space Mono',monospace"}}>
          <span>⏱ {scores.hltb.session}</span>
          <span>📖 {scores.hltb.main}</span>
        </div>
        {currentUser && onToggleBacklog && (
          <button
            onClick={async e => {
              e.stopPropagation();
              if (backlogBusy) return;
              setBacklogBusy(true);
              await onToggleBacklog(game);
              setBacklogBusy(false);
            }}
            style={{marginTop:9,width:"100%",padding:"6px 0",borderRadius:8,border:`1px solid ${inBacklog?"rgba(56,189,248,0.4)":darkMode?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.12)"}`,background:inBacklog?"rgba(56,189,248,0.1)":"transparent",color:inBacklog?"#38bdf8":darkMode?"rgba(255,255,255,0.4)":"rgba(0,0,0,0.45)",fontSize:10,fontFamily:"'Space Mono',monospace",cursor:"pointer",transition:"all .2s",fontWeight:inBacklog?700:400}}>
            {backlogBusy ? "..." : inBacklog ? "✓ In Backlog" : "📚 + Backlog"}
          </button>
        )}
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

function computeAchievements(profile, reviews, followers, following=[]) {
  const earned = ["early_adopter"]; // everyone gets this
  if (reviews.length >= 1)  earned.push("first_review");
  if (reviews.length >= 5)  earned.push("review_5");
  if (reviews.length >= 10) earned.push("review_10");
  if (reviews.length >= 25) earned.push("review_25");
  if (following.length >= 1)  earned.push("first_follow");
  if (followers.length >= 10) earned.push("follower_10");
  if ((profile?.showcase_games||[]).length > 0) earned.push("showcase");
  if ((profile?.backlog||[]).length >= 5) earned.push("backlog");
  return ACHIEVEMENTS.map(a => ({ ...a, earned: earned.includes(a.id) }));
}

// ─── Edit Profile Modal ───────────────────────────────────────────────────
const AVATAR_EMOJIS = ["🎮","👾","🕹️","⚔️","🏆","🎯","🔥","💎","🌟","🦁","🐉","🤖","👑","🎭","🚀","⚡"];
const AVATAR_COLORS = ["#a78bfa","#f87171","#34d399","#60a5fa","#fbbf24","#f97316","#e879f9","#38bdf8"];

// ─────────────────────────────────────────────────────────────────────────────
// KIDS MODE SETTINGS (rendered inside EditProfileModal Controls tab)
// ─────────────────────────────────────────────────────────────────────────────
const KIDS_MODE_KEY = "wmt_kids_mode";

function KidsModeSettings() {
  const [kidsMode, setKidsMode] = useState(() => localStorage.getItem(KIDS_MODE_KEY) === "1");
  const [showPin, setShowPin] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // "enable"|"disable"

  const toggle = () => {
    setPendingAction(kidsMode ? "disable" : "enable");
    setShowPin(true);
  };

  return (
    <div>
      <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",fontFamily:"'Space Mono',monospace",letterSpacing:2,fontWeight:800,marginBottom:14}}>PARENTAL CONTROLS</div>

      {/* Kids Mode toggle row */}
      <div style={{background:"rgba(255,255,255,0.04)",border:`1px solid ${kidsMode?"rgba(167,139,250,0.4)":"rgba(255,255,255,0.08)"}`,borderRadius:14,padding:16,cursor:"pointer",transition:"all .2s"}} onClick={toggle}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:13,color:"white",fontWeight:700,fontFamily:"'Space Mono',monospace",marginBottom:4}}>
              {kidsMode ? "🧒 Kids Mode ON" : "🔒 Kids Mode OFF"}
            </div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",fontFamily:"'Space Mono',monospace",lineHeight:1.6}}>
              {kidsMode
                ? "Account locked to Everyone-rated games only. PIN required to disable."
                : "Enable to restrict this account to kid-friendly games only."}
            </div>
          </div>
          <div style={{width:42,height:24,borderRadius:12,background:kidsMode?"#a78bfa":"rgba(255,255,255,0.1)",position:"relative",transition:"background .2s",flexShrink:0,marginLeft:12}}>
            <div style={{position:"absolute",top:3,left:kidsMode?21:3,width:18,height:18,borderRadius:"50%",background:"white",transition:"left .2s",boxShadow:"0 1px 4px rgba(0,0,0,0.4)"}}/>
          </div>
        </div>
      </div>

      {kidsMode && (
        <div style={{marginTop:12,background:"rgba(167,139,250,0.08)",border:"1px solid rgba(167,139,250,0.2)",borderRadius:12,padding:12}}>
          <div style={{fontSize:10,color:"rgba(167,139,250,0.9)",fontFamily:"'Space Mono',monospace",lineHeight:1.7}}>
            ✓ All browsing restricted to ESRB Everyone / Everyone 10+<br/>
            ✓ Adult content toggle hidden<br/>
            ✓ Strict filtering on every search and page<br/>
            ✓ PIN required to disable
          </div>
        </div>
      )}

      <div style={{fontSize:9,color:"rgba(255,255,255,0.2)",fontFamily:"'Space Mono',monospace",marginTop:12,lineHeight:1.6}}>
        The PIN is stored on this device only. If you forget it, clear your browser data to reset.
      </div>

      {showPin && <ParentalPinModal darkMode={true}
        mode={localStorage.getItem(PARENT_PIN_KEY) ? "verify" : "set"}
        onCancel={()=>{ setShowPin(false); setPendingAction(null); }}
        onSuccess={()=>{
          if (pendingAction === "enable") {
            localStorage.setItem(KIDS_MODE_KEY, "1");
            setKidsMode(true);
            window.dispatchEvent(new Event("wmt_kids_mode_change"));
          } else {
            localStorage.removeItem(KIDS_MODE_KEY);
            setKidsMode(false);
            window.dispatchEvent(new Event("wmt_kids_mode_change"));
          }
          setShowPin(false); setPendingAction(null);
        }}/>}
    </div>
  );
}

function EditProfileModal({ user, onClose, onSave }) {
  const [gamerTag, setGamerTag] = useState("");
  const [bio, setBio] = useState("");
  const [status, setStatus] = useState("");
  const [psnId, setPsnId] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState("🎮");
  const [avatarColor, setAvatarColor] = useState("#a78bfa");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("identity"); // identity | appearance | status | showcase | controls
  const [showcaseGames, setShowcaseGames] = useState([]);
  const [showcaseQuery, setShowcaseQuery] = useState("");
  const [showcaseResults, setShowcaseResults] = useState([]);
  const [searchingShowcase, setSearchingShowcase] = useState(false);
  const [savingShowcase, setSavingShowcase] = useState(false);

  useEffect(() => {
    getProfile(user.email).then(p => {
      if (p) {
        setGamerTag(p.gamer_tag || "");
        setBio(p.bio || "");
        setStatus(p.status || "");
        setPsnId(p.psn_id || "");
        setAvatarEmoji(p.avatar_emoji || "🎮");
        setAvatarColor(p.avatar_color || "#a78bfa");
        setAvatarUrl(p.avatar_url || "");
        setBannerUrl(p.banner_url || "");
        setShowcaseGames(p.showcase_games || []);
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
    try {
      if (gamerTag) {
        const existing = await getProfileByTag(gamerTag);
        if (existing && existing.user_email !== user.email) { setErr("That gamer tag is taken."); setSaving(false); return; }
      }
      const profile = { user_email: user.email, gamer_tag: gamerTag||null, bio: bio||null, status: status||null, psn_id: psnId||null, avatar_emoji: avatarEmoji, avatar_color: avatarColor, avatar_url: avatarUrl||null, banner_url: bannerUrl||null };
      await upsertProfile(profile);
      onSave(profile);
      onClose();
    } catch(e) {
      const msg = e?.message || "";
      // Show the real Supabase error to help diagnose
      setErr(msg ? `Save failed: ${msg.slice(0,120)}` : "Failed to save profile. Please try again.");
    }
    setSaving(false);
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
          <div style={{display:"flex",background:"rgba(0,0,0,0.4)",borderRadius:10,padding:3,marginBottom:20,gap:3,flexWrap:"wrap"}}>
            {[["identity","👤"],["appearance","🎨"],["status","🎮"],["showcase","📌"],["controls","🔒"]].map(([id,lbl])=>(
              <button key={id} onClick={()=>setTab(id)}
                style={{flex:1,background:tab===id?"rgba(167,139,250,0.2)":"transparent",color:tab===id?"#a78bfa":"rgba(255,255,255,0.4)",border:`1px solid ${tab===id?"rgba(167,139,250,0.4)":"transparent"}`,borderRadius:8,padding:"8px 4px",cursor:"pointer",fontSize:11,fontFamily:"'Space Mono',monospace",fontWeight:tab===id?700:400,minWidth:0}}>
                {lbl} <span style={{fontSize:8,display:"block",letterSpacing:0.5}}>{id.toUpperCase()}</span>
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
              <div>
                <label style={labelStyle}>PSN ID (optional)</label>
                <div style={{position:"relative"}}>
                  <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:14}}>🎮</span>
                  <input placeholder="e.g. YourPSN_ID" value={psnId} onChange={e=>setPsnId(e.target.value.replace(/\s/g,""))} style={{...inputStyle,paddingLeft:34}}/>
                </div>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.2)",fontFamily:"'Space Mono',monospace",marginTop:5}}>Your PSN username — shows a link to your PSNProfiles page on your profile.</div>
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

          {/* Showcase tab */}
          {tab==="showcase" && (
            <div>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",fontFamily:"'Space Mono',monospace",letterSpacing:1,marginBottom:12}}>PIN YOUR FAVORITES (up to 6) — shown publicly on your profile</div>
              {/* Current showcase */}
              {showcaseGames.length > 0 && (
                <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14}}>
                  {showcaseGames.map((g,i) => (
                    <div key={g.id} style={{display:"flex",alignItems:"center",gap:10,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"8px 12px"}}>
                      {g.background_image && <img src={g.background_image} alt="" style={{width:36,height:28,objectFit:"cover",borderRadius:5,flexShrink:0}}/>}
                      <div style={{flex:1,fontSize:12,color:"white",fontFamily:"'Bitter',serif",fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.name}</div>
                      <button onClick={()=>setShowcaseGames(arr=>arr.filter((_,j)=>j!==i))}
                        style={{background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.2)",borderRadius:6,padding:"3px 8px",color:"#f87171",fontSize:10,cursor:"pointer",fontFamily:"'Space Mono',monospace",flexShrink:0}}>
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {showcaseGames.length < 6 && (
                <>
                  <div style={{position:"relative",marginBottom:10}}>
                    <input
                      placeholder="Search for a game to pin..."
                      value={showcaseQuery}
                      onChange={async e => {
                        const q = e.target.value;
                        setShowcaseQuery(q);
                        if (!q.trim() || q.trim().length < 2) { setShowcaseResults([]); return; }
                        setSearchingShowcase(true);
                        try {
                          const res = await fetch(`${RAWG_BASE}/games?key=${RAWG_KEY}&search=${encodeURIComponent(q)}&page_size=6&ordering=-rating`);
                          const data = await res.json();
                          setShowcaseResults((data.results||[]).filter(g=>g.background_image).slice(0,6));
                        } catch { setShowcaseResults([]); }
                        setSearchingShowcase(false);
                      }}
                      style={{width:"100%",background:"rgba(0,0,0,0.4)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"10px 14px",color:"white",fontSize:12,fontFamily:"'Space Mono',monospace",boxSizing:"border-box"}}
                    />
                    {searchingShowcase && <div style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:10,color:"rgba(255,255,255,0.3)",fontFamily:"'Space Mono',monospace"}}>...</div>}
                  </div>
                  {showcaseResults.length > 0 && (
                    <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:10}}>
                      {showcaseResults.map(g => {
                        const already = showcaseGames.some(x=>x.id===g.id);
                        return (
                          <div key={g.id} style={{display:"flex",alignItems:"center",gap:10,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:9,padding:"7px 10px",cursor:already?"default":"pointer",opacity:already?0.5:1}}
                            onClick={()=>{
                              if (already || showcaseGames.length>=6) return;
                              setShowcaseGames(arr=>[...arr, { id:g.id, name:g.name, background_image:g.background_image, slug:g.slug||null }]);
                              setShowcaseQuery(""); setShowcaseResults([]);
                            }}>
                            <img src={g.background_image} alt="" style={{width:40,height:30,objectFit:"cover",borderRadius:5,flexShrink:0}}/>
                            <div style={{flex:1,fontSize:12,color:"white",fontFamily:"'Bitter',serif",fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.name}</div>
                            <span style={{fontSize:10,color:already?"#4ade80":"rgba(255,255,255,0.3)",fontFamily:"'Space Mono',monospace",flexShrink:0}}>{already?"✓ Added":"+ Add"}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
              <button
                onClick={async () => {
                  setSavingShowcase(true);
                  try { await saveShowcase(user.email, showcaseGames); onSave({ showcase_games: showcaseGames }); } catch(e) { setErr("Failed to save showcase."); }
                  setSavingShowcase(false);
                }}
                disabled={savingShowcase}
                style={{width:"100%",background:"linear-gradient(135deg,#e879f9,#a78bfa)",border:"none",borderRadius:11,padding:"12px",color:"white",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"'Space Mono',monospace",marginTop:4,opacity:savingShowcase?0.7:1}}>
                {savingShowcase ? "Saving..." : "💾 Save Showcase →"}
              </button>
            </div>
          )}

          {tab==="controls" && (
            <KidsModeSettings/>
          )}

          {tab !== "controls" && tab !== "showcase" && err && <div style={{color:"#f87171",fontSize:11,fontFamily:"'Space Mono',monospace",marginTop:10}}>⚠ {err}</div>}

          <div style={{display:"flex",gap:8,marginTop:20}}>
            {tab !== "controls" && tab !== "showcase" && <button onClick={handleSave} disabled={saving}
              style={{flex:1,background:"linear-gradient(135deg,#a78bfa,#7c3aed)",border:"none",borderRadius:11,padding:"13px",color:"white",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"'Space Mono',monospace",opacity:saving?0.7:1}}>
              {saving?"Saving...":"Save Profile →"}
            </button>}
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

function UserProfilePage({ profileEmail, currentUser, onClose, onEditProfile, onOpenMessages }) {
  const [profile, setProfile] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [followers, setFollowers] = useState([]);
  const [following, setFollowing] = useState([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("activity");
  const [copied, setCopied] = useState(false);
  const [friendRequest, setFriendRequest] = useState(null); // null | {status, from_email, to_email}
  const [friendBusy, setFriendBusy] = useState(false);
  const isOwnProfile = currentUser?.email === profileEmail;

  useEffect(() => {
    Promise.all([
      getProfile(profileEmail),
      getUserReviews(profileEmail),
      getFollowers(profileEmail),
      getFollowing(profileEmail),
      currentUser && !isOwnProfile ? getFriendRequestStatus(currentUser.email, profileEmail).catch(() => null) : Promise.resolve(null),
    ]).then(([p, r, flrs, flwg, fr]) => {
      setProfile(p); setReviews(r); setFollowers(flrs); setFollowing(flwg);
      setIsFollowing(flrs.some(f => f.follower_email === currentUser?.email));
      setFriendRequest(fr);
      setLoading(false);
    }).catch(() => setLoading(false));
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
    const url = `${window.location.origin}?profile=${profile?.gamer_tag || profileEmail}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } else {
      // Fallback for browsers without clipboard API
      const el = document.createElement("textarea");
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const displayName = profile?.gamer_tag || profileEmail.split("@")[0];
  const avatarColor = profile?.avatar_color || "#a78bfa";
  const achievements = computeAchievements(profile, reviews, followers, following);
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

        {/* BANNER — decorative only, no content overlaps it */}
        <div style={{height:130,overflow:"hidden",position:"relative",background:`linear-gradient(135deg,${avatarColor}25,#0d0d18 75%)`}}>
          {profile?.banner_url && (
            <img src={profile.banner_url} alt="banner" loading="lazy"
              style={{width:"100%",height:"100%",objectFit:"cover",opacity:0.35}}/>
          )}
          <div style={{position:"absolute",inset:0,background:"linear-gradient(to bottom, transparent 30%, #0d0d18 100%)"}}/>
          <button onClick={onClose}
            style={{position:"absolute",top:12,right:12,background:"rgba(0,0,0,0.6)",border:"1px solid rgba(255,255,255,0.15)",color:"white",borderRadius:9,padding:"6px 13px",cursor:"pointer",fontSize:11,fontFamily:"'Space Mono',monospace",fontWeight:700}}>
            ✕ Close
          </button>
        </div>

        <div style={{padding:"16px 20px 48px"}}>

          {/* AVATAR ROW */}
          <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:14}}>
            <div style={{width:72,height:72,borderRadius:"50%",border:`3px solid #0d0d18`,boxShadow:`0 0 0 2px ${avatarColor}50, 0 4px 20px ${avatarColor}40`,overflow:"hidden",background:avatarColor,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,flexShrink:0}}>
              {profile?.avatar_url
                ? <img src={profile.avatar_url} alt="avatar" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                : (profile?.avatar_emoji || "🎮")}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <h1 style={{margin:"0 0 2px",fontSize:22,fontFamily:"'Bitter',serif",color:"white",fontWeight:900,lineHeight:1.2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{displayName}</h1>
              {profile?.gamer_tag && <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:"'Space Mono',monospace"}}>@{profile.gamer_tag}</div>}
              {profile?.status && (
                <div style={{fontSize:10,color:avatarColor,fontFamily:"'Space Mono',monospace",marginTop:3,display:"flex",alignItems:"center",gap:4}}>
                  <span style={{width:6,height:6,borderRadius:"50%",background:"#4ade80",flexShrink:0,display:"inline-block"}}/>
                  {profile.status}
                </div>
              )}
            </div>
          </div>

          {/* Action buttons on their own row — always visible, never clipped */}
          <div style={{display:"flex",gap:8,marginBottom:18,flexWrap:"wrap"}}>
            {isOwnProfile ? (
              <button onClick={onEditProfile}
                style={{background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.3)",borderRadius:10,padding:"8px 16px",color:"#a78bfa",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Space Mono',monospace"}}>
                ✏️ Edit Profile
              </button>
            ) : (
              <>
                <button onClick={handleFollow}
                  style={{background:isFollowing?"rgba(255,255,255,0.07)":"linear-gradient(135deg,#a78bfa,#7c3aed)",border:isFollowing?"1px solid rgba(255,255,255,0.12)":"none",borderRadius:10,padding:"8px 16px",color:"white",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Space Mono',monospace",boxShadow:isFollowing?"none":"0 2px 12px rgba(139,92,246,0.35)"}}>
                  {isFollowing?"✓ Following":"+ Follow"}
                </button>
                <button
                  disabled={friendBusy}
                  onClick={async () => {
                    if (!currentUser || friendBusy) return;
                    setFriendBusy(true);
                    if (friendRequest?.status === "accepted") {
                      await removeFriend(currentUser.email, profileEmail);
                      setFriendRequest(null);
                    } else if (friendRequest?.status === "pending" && friendRequest.to_email === currentUser.email) {
                      await acceptFriendRequest(friendRequest.from_email, currentUser.email);
                      setFriendRequest(r => ({ ...r, status: "accepted" }));
                    } else if (!friendRequest) {
                      await sendFriendRequest(currentUser.email, profileEmail);
                      setFriendRequest({ from_email: currentUser.email, to_email: profileEmail, status: "pending" });
                    }
                    setFriendBusy(false);
                  }}
                  style={{
                    background: friendRequest?.status==="accepted" ? "rgba(74,222,128,0.1)" : friendRequest?.status==="pending" && friendRequest.to_email===currentUser?.email ? "rgba(251,191,36,0.12)" : friendRequest?.status==="pending" ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.06)",
                    border: `1px solid ${friendRequest?.status==="accepted"?"rgba(74,222,128,0.35)":friendRequest?.status==="pending"&&friendRequest.to_email===currentUser?.email?"rgba(251,191,36,0.4)":"rgba(255,255,255,0.12)"}`,
                    borderRadius:10,padding:"8px 14px",
                    color: friendRequest?.status==="accepted"?"#4ade80":friendRequest?.status==="pending"&&friendRequest.to_email===currentUser?.email?"#fbbf24":"rgba(255,255,255,0.6)",
                    fontSize:11,fontWeight:700,cursor:friendBusy?"not-allowed":"pointer",fontFamily:"'Space Mono',monospace",transition:"all .2s"
                  }}>
                  {friendBusy ? "..." : friendRequest?.status==="accepted" ? "✓ Friends" : friendRequest?.status==="pending" && friendRequest.to_email===currentUser?.email ? "✅ Accept Friend Request" : friendRequest?.status==="pending" ? "⏳ Request Sent" : "👥 Add Friend"}
                </button>
                <button onClick={()=>onOpenMessages&&onOpenMessages(profileEmail)}
                  style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"8px 14px",color:"rgba(255,255,255,0.6)",fontSize:11,cursor:"pointer",fontFamily:"'Space Mono',monospace",transition:"all .2s"}}
                  onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(167,139,250,0.3)"}
                  onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(255,255,255,0.1)"}>
                  💬 Message
                </button>
              </>
            )}
            <button onClick={copyLink}
              style={{background:copied?"rgba(74,222,128,0.12)":"rgba(255,255,255,0.05)",border:`1px solid ${copied?"rgba(74,222,128,0.4)":"rgba(255,255,255,0.1)"}`,borderRadius:10,padding:"8px 14px",color:copied?"#4ade80":"rgba(255,255,255,0.5)",fontSize:11,cursor:"pointer",fontFamily:"'Space Mono',monospace",transition:"all .2s"}}>
              {copied ? "✓ Copied!" : "🔗 Share"}
            </button>
          </div>

          {/* Bio */}
          {profile?.bio && <p style={{fontSize:12,color:"rgba(255,255,255,0.5)",fontFamily:"'Space Mono',monospace",lineHeight:1.8,margin:"0 0 10px",maxWidth:520}}>{profile.bio}</p>}
          {profile?.psn_id && (
            <a href={`https://psnprofiles.com/${encodeURIComponent(profile.psn_id)}`} target="_blank" rel="noopener noreferrer"
              style={{display:"inline-flex",alignItems:"center",gap:6,background:"rgba(0,48,135,0.2)",border:"1px solid rgba(0,112,209,0.3)",borderRadius:20,padding:"5px 12px",fontSize:10,color:"#60a5fa",fontFamily:"'Space Mono',monospace",textDecoration:"none",marginBottom:16,transition:"all .2s"}}
              onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(0,112,209,0.6)"}
              onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(0,112,209,0.3)"}>
              🎮 PSN: {profile.psn_id} <span style={{opacity:0.5}}>→ PSNProfiles</span>
            </a>
          )}

          {/* STATS ROW */}
          <div style={{display:"flex",gap:0,marginBottom:22,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,overflow:"hidden"}}>
            {[["💬",reviews.length,"Reviews"],["👥",followers.length,"Followers"],["➕",following.length,"Following"]].map(([icon,val,lbl],i,arr)=>(
              <div key={lbl} style={{flex:1,textAlign:"center",padding:"14px 8px",borderRight:i<arr.length-1?"1px solid rgba(255,255,255,0.07)":"none"}}>
                <div style={{fontSize:22,fontWeight:900,color:avatarColor,fontFamily:"'Space Mono',monospace",lineHeight:1}}>{val}</div>
                <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",fontFamily:"'Space Mono',monospace",marginTop:4,letterSpacing:0.5}}>{icon} {lbl}</div>
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
          <div style={{display:"flex",gap:0,marginBottom:20,borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
            {[["activity","📋 Activity"],["showcase","📌 Showcase"],["backlog","📚 Backlog"]].map(([id,lbl])=>(
              <button key={id} onClick={()=>setActiveTab(id)}
                style={{background:"transparent",border:"none",borderBottom:`2px solid ${activeTab===id?avatarColor:"transparent"}`,color:activeTab===id?avatarColor:"rgba(255,255,255,0.35)",padding:"10px 18px",cursor:"pointer",fontSize:11,fontFamily:"'Space Mono',monospace",fontWeight:activeTab===id?700:400,marginBottom:-1,transition:"all .2s"}}>
                {lbl}
              </button>
            ))}
          </div>

          {/* ACTIVITY TAB */}
          {activeTab==="activity" && (
            reviews.length===0 ? (
              <div style={{textAlign:"center",padding:"40px 0",color:"rgba(255,255,255,0.2)",fontSize:11,fontFamily:"'Space Mono',monospace"}}>
                <div style={{fontSize:28,marginBottom:10}}>🎮</div>No reviews yet
              </div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {reviews.map((r,i)=>(
                  <div key={`${r.user_email}-${r.game_id || i}`}
                    style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:"14px 16px",transition:"border .2s"}}
                    onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(167,139,250,0.2)"}
                    onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(255,255,255,0.07)"}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8,gap:12}}>
                      <div style={{fontSize:14,color:"white",fontWeight:700,fontFamily:"'Bitter',serif",lineHeight:1.2}}>{r.game_name}</div>
                      <div style={{display:"flex",gap:1,flexShrink:0}}>{[1,2,3,4,5].map(s=><span key={s} style={{fontSize:12,color:s<=r.rating?"#fbbf24":"rgba(255,255,255,0.12)"}}>★</span>)}</div>
                    </div>
                    {r.time_spent && <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:"'Space Mono',monospace",marginBottom:6,display:"flex",alignItems:"center",gap:4}}><span>⏱</span>{r.time_spent}</div>}
                    {r.review_text && <div style={{fontSize:12,color:"rgba(255,255,255,0.6)",fontFamily:"'Space Mono',monospace",lineHeight:1.7}}>{r.review_text}</div>}
                    <div style={{fontSize:9,color:"rgba(255,255,255,0.18)",fontFamily:"'Space Mono',monospace",marginTop:8}}>{new Date(r.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
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
                  <div style={{fontSize:28,marginBottom:10}}>📌</div>
                  {isOwnProfile ? "No games showcased yet. Edit your profile → Showcase to pin your favorites." : "No games showcased yet."}
                </div>
              ) : (
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:10}}>
                  {showcase.map((g,i)=>(
                    <div key={i} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,overflow:"hidden",transition:"border .2s"}}
                      onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(232,121,249,0.3)"}
                      onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(255,255,255,0.08)"}>
                      {g.background_image
                        ? <img src={g.background_image} alt={g.name} style={{width:"100%",height:90,objectFit:"cover",display:"block"}}/>
                        : <div style={{width:"100%",height:90,background:"rgba(232,121,249,0.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>🎮</div>}
                      <div style={{padding:"8px 10px"}}>
                        <div style={{fontSize:11,color:"white",fontWeight:700,fontFamily:"'Bitter',serif",lineHeight:1.2,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{g.name}</div>
                      </div>
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
                  <div style={{fontSize:28,marginBottom:10}}>📚</div>
                  {isOwnProfile ? "Your backlog is empty. Browse games and hit '+ Backlog' to save them here!" : "No backlog games yet."}
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:7}}>
                  {backlog.map((g,i)=>(
                    <div key={g.id||i} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,display:"flex",alignItems:"center",gap:10,overflow:"hidden",transition:"border .2s"}}
                      onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(56,189,248,0.2)"}
                      onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(255,255,255,0.07)"}>
                      {g.background_image
                        ? <img src={g.background_image} alt={g.name} style={{width:56,height:44,objectFit:"cover",flexShrink:0}}/>
                        : <div style={{width:56,height:44,background:"rgba(56,189,248,0.1)",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🎮</div>}
                      <div style={{flex:1,fontSize:13,color:"white",fontFamily:"'Bitter',serif",fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",paddingRight:4}}>{g.name}</div>
                      {isOwnProfile && (
                        <button
                          onClick={async () => {
                            const updated = await removeFromBacklog(profileEmail, g.id);
                            setProfile(p => ({ ...p, backlog: updated }));
                          }}
                          style={{background:"transparent",border:"none",color:"rgba(255,255,255,0.2)",fontSize:14,cursor:"pointer",padding:"0 12px",flexShrink:0,lineHeight:"44px"}}
                          title="Remove from backlog">✕</button>
                      )}
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

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGES MODAL
// ─────────────────────────────────────────────────────────────────────────────
function MessagesModal({ currentUser, initialRecipient=null, onClose }) {
  const [inbox, setInbox] = useState([]);
  const [activeThread, setActiveThread] = useState(null); // email string
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadProfiles, setThreadProfiles] = useState({});
  const bottomRef = React.useRef(null);

  useEffect(() => {
    getInbox(currentUser.email).then(threads => {
      setInbox(threads);
      setLoadingInbox(false);
      // Load profiles for all thread participants
      const emails = [...new Set(threads.map(m => m.from_email === currentUser.email ? m.to_email : m.from_email))];
      Promise.all(emails.map(e => getProfile(e))).then(profiles => {
        const map = {};
        emails.forEach((e, i) => { if (profiles[i]) map[e] = profiles[i]; });
        setThreadProfiles(map);
      });
    });
    if (initialRecipient) openThread(initialRecipient);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const openThread = async (email) => {
    setActiveThread(email);
    setLoadingThread(true);
    const [msgs, profile] = await Promise.all([
      getConversation(currentUser.email, email),
      getProfile(email),
    ]);
    setMessages(msgs);
    if (profile) setThreadProfiles(p => ({ ...p, [email]: profile }));
    setLoadingThread(false);
    markMessagesRead(email, currentUser.email);
  };

  const handleSend = async () => {
    if (!draft.trim() || !activeThread || sending) return;
    setSending(true);
    const ok = await sendMessage(currentUser.email, activeThread, draft.trim());
    if (ok) {
      setMessages(m => [...m, { from_email: currentUser.email, to_email: activeThread, content: draft.trim(), created_at: new Date().toISOString() }]);
      setDraft("");
    }
    setSending(false);
  };

  const getDisplayName = (email) => {
    const p = threadProfiles[email];
    return p?.gamer_tag || email.split("@")[0];
  };

  const getAvatar = (email) => {
    const p = threadProfiles[email];
    if (p?.avatar_url) return <img src={p.avatar_url} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>;
    return p?.avatar_emoji || "🎮";
  };

  const getAvatarColor = (email) => threadProfiles[email]?.avatar_color || "#a78bfa";

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(16px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0d0d18",border:"1px solid rgba(167,139,250,0.25)",borderRadius:24,width:"100%",maxWidth:680,height:"85vh",display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 0 80px rgba(167,139,250,0.15)"}}>

        {/* Header */}
        <div style={{padding:"16px 20px",borderBottom:"1px solid rgba(255,255,255,0.07)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {activeThread && (
              <button onClick={()=>{ setActiveThread(null); setMessages([]); }} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"5px 10px",color:"rgba(255,255,255,0.5)",fontSize:11,cursor:"pointer",fontFamily:"'Space Mono',monospace"}}>← Back</button>
            )}
            <h3 style={{margin:0,fontSize:15,fontFamily:"'Bitter',serif",color:"white",fontWeight:700}}>
              {activeThread ? `💬 ${getDisplayName(activeThread)}` : "💬 Messages"}
            </h3>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"5px 12px",color:"rgba(255,255,255,0.5)",fontSize:11,cursor:"pointer",fontFamily:"'Space Mono',monospace"}}>✕ Close</button>
        </div>

        {/* Body */}
        <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
          {!activeThread ? (
            // Inbox
            <div style={{flex:1,overflowY:"auto",padding:12}}>
              {loadingInbox ? (
                <div style={{textAlign:"center",padding:40,color:"rgba(255,255,255,0.3)",fontSize:11,fontFamily:"'Space Mono',monospace"}}>Loading...</div>
              ) : inbox.length === 0 ? (
                <div style={{textAlign:"center",padding:40}}>
                  <div style={{fontSize:32,marginBottom:12}}>💬</div>
                  <div style={{color:"rgba(255,255,255,0.3)",fontSize:11,fontFamily:"'Space Mono',monospace",lineHeight:1.8}}>No messages yet.<br/>Visit a player's profile and hit "Message" to start a conversation.</div>
                </div>
              ) : (
                inbox.map((m, i) => {
                  const other = m.from_email === currentUser.email ? m.to_email : m.from_email;
                  const unread = !m.read && m.to_email === currentUser.email;
                  const ac = getAvatarColor(other);
                  return (
                    <div key={i} onClick={()=>openThread(other)}
                      style={{display:"flex",alignItems:"center",gap:12,padding:"12px",borderRadius:14,cursor:"pointer",background:unread?"rgba(167,139,250,0.06)":"transparent",border:`1px solid ${unread?"rgba(167,139,250,0.2)":"rgba(255,255,255,0.05)"}`,marginBottom:6,transition:"all .2s"}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"}
                      onMouseLeave={e=>e.currentTarget.style.background=unread?"rgba(167,139,250,0.06)":"transparent"}>
                      <div style={{width:40,height:40,borderRadius:"50%",background:ac,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0,overflow:"hidden"}}>{getAvatar(other)}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,color:"white",fontWeight:700,fontFamily:"'Space Mono',monospace",marginBottom:2}}>{getDisplayName(other)}</div>
                        <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",fontFamily:"'Space Mono',monospace",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{m.content}</div>
                      </div>
                      {unread && <div style={{width:8,height:8,borderRadius:"50%",background:"#a78bfa",flexShrink:0}}/>}
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            // Conversation
            <>
              <div style={{flex:1,overflowY:"auto",padding:"12px 16px",display:"flex",flexDirection:"column",gap:8}}>
                {loadingThread ? (
                  <div style={{textAlign:"center",padding:40,color:"rgba(255,255,255,0.3)",fontSize:11,fontFamily:"'Space Mono',monospace"}}>Loading...</div>
                ) : messages.length === 0 ? (
                  <div style={{textAlign:"center",padding:40,color:"rgba(255,255,255,0.3)",fontSize:11,fontFamily:"'Space Mono',monospace"}}>No messages yet. Say hello!</div>
                ) : (
                  messages.map((m, i) => {
                    const isMe = m.from_email === currentUser.email;
                    return (
                      <div key={i} style={{display:"flex",justifyContent:isMe?"flex-end":"flex-start"}}>
                        <div style={{maxWidth:"72%",background:isMe?"linear-gradient(135deg,#a78bfa,#7c3aed)":"rgba(255,255,255,0.07)",borderRadius:isMe?"18px 18px 4px 18px":"18px 18px 18px 4px",padding:"10px 14px",boxShadow:isMe?"0 2px 12px rgba(139,92,246,0.3)":"none"}}>
                          <div style={{fontSize:13,color:"white",fontFamily:"'Space Mono',monospace",lineHeight:1.6,wordBreak:"break-word"}}>{m.content}</div>
                          <div style={{fontSize:9,color:isMe?"rgba(255,255,255,0.5)":"rgba(255,255,255,0.3)",fontFamily:"'Space Mono',monospace",marginTop:4,textAlign:isMe?"right":"left"}}>
                            {new Date(m.created_at).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef}/>
              </div>
              {/* Input */}
              <div style={{padding:"12px 16px",borderTop:"1px solid rgba(255,255,255,0.07)",display:"flex",gap:10,flexShrink:0}}>
                <input
                  value={draft}
                  onChange={e=>setDraft(e.target.value)}
                  onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); handleSend(); }}}
                  placeholder="Write a message..."
                  style={{flex:1,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"10px 14px",color:"white",fontSize:12,fontFamily:"'Space Mono',monospace"}}
                />
                <button onClick={handleSend} disabled={!draft.trim()||sending}
                  style={{background:"linear-gradient(135deg,#a78bfa,#7c3aed)",border:"none",borderRadius:12,padding:"10px 16px",color:"white",fontWeight:700,fontSize:12,cursor:draft.trim()&&!sending?"pointer":"not-allowed",fontFamily:"'Space Mono',monospace",opacity:draft.trim()&&!sending?1:0.5,boxShadow:"0 2px 12px rgba(139,92,246,0.3)"}}>
                  {sending?"...":"Send"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const DECK_BADGE = {
  platinum: { label:"Platinum", color:"#e2e8f0", bg:"rgba(226,232,240,0.15)", icon:"🏅" },
  gold:     { label:"Gold",     color:"#fbbf24", bg:"rgba(251,191,36,0.15)",  icon:"🥇" },
  silver:   { label:"Silver",   color:"#94a3b8", bg:"rgba(148,163,184,0.15)", icon:"🥈" },
  bronze:   { label:"Bronze",   color:"#cd7f32", bg:"rgba(205,127,50,0.15)",  icon:"🥉" },
  borked:   { label:"Borked",   color:"#f87171", bg:"rgba(248,113,113,0.15)", icon:"💀" },
  native:   { label:"Native",   color:"#4ade80", bg:"rgba(74,222,128,0.15)",  icon:"🎮" },
  pending:  { label:"Pending",  color:"#94a3b8", bg:"rgba(148,163,184,0.1)",  icon:"⏳" },
};

const OC_TIER_COLOR = { Mighty:"#4ade80", Strong:"#86efac", Fair:"#fbbf24", Weak:"#f87171" };

function GameModal({ game, onClose, currentUser, darkMode=true }) {
  const [deckBadge, setDeckBadge] = useState(null);
  const [steamPrice, setSteamPrice] = useState(null);
  const [ocData, setOcData] = useState(null);
  const [storeDeals, setStoreDeals] = useState([]);

  useEffect(() => {
    if (!game) return;
    setDeckBadge(null); setSteamPrice(null); setOcData(null); setStoreDeals([]);

    // OpenCritic + ITAD prices — fetch by name for any game
    fetch(`/api/opencritic?name=${encodeURIComponent(game.name)}`)
      .then(r => r.json())
      .then(d => { if (d?.score != null && d.score > 0) setOcData(d); })
      .catch(() => {});

    fetch(`/api/prices?name=${encodeURIComponent(game.name)}`)
      .then(r => r.json())
      .then(d => { if (d?.deals?.length) setStoreDeals(d.deals); })
      .catch(() => {});

    // Steam + ProtonDB — only for PC/Steam games
    const isSteam = (game.platforms||[]).some(p => p.platform?.slug === "pc" || p.platform?.name?.toLowerCase().includes("pc"));
    const hasStore = (game.stores||[]).some(s => s.store?.slug === "steam");
    if (!isSteam && !hasStore) return;

    fetch(`${RAWG_BASE}/games/${game.id}/stores?key=${RAWG_KEY}`)
      .then(r => r.json())
      .then(async data => {
        const steamUrl = (data.results||[]).find(s => s.url?.includes("steampowered.com"))?.url;
        if (!steamUrl) return;
        const match = steamUrl.match(/\/app\/(\d+)/);
        if (!match) return;
        const appId = match[1];
        const [proton, steam] = await Promise.allSettled([
          fetch(`/api/protondb?appId=${appId}`).then(r => r.json()),
          fetch(`/api/steam?appId=${appId}`).then(r => r.json()),
        ]);
        if (proton.status === "fulfilled" && proton.value?.tier) setDeckBadge(proton.value.tier.toLowerCase());
        if (steam.status === "fulfilled" && steam.value) setSteamPrice(steam.value);
      })
      .catch(() => {});
  }, [game?.id]);

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
  const badge = deckBadge ? DECK_BADGE[deckBadge] : null;
  const mbg = darkMode ? "#0d0d18" : "#ffffff";
  const mtext = darkMode ? "white" : "#0f0f1a";
  const msubtle = darkMode ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.45)";
  const mcard = darkMode ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)";
  const mborder = darkMode ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)";
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(12px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:mbg,border:`1px solid ${color}50`,borderRadius:24,width:"100%",maxWidth:500,maxHeight:"90vh",overflowY:"auto",boxShadow:`0 0 100px ${color}25`,position:"relative"}}>
        {game.background_image && (
          <div style={{height:180,overflow:"hidden",borderRadius:"24px 24px 0 0",position:"relative"}}>
            <img src={game.background_image} alt={game.name} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
            <div style={{position:"absolute",inset:0,background:`linear-gradient(to top,${mbg},transparent 50%)`}}/>
          </div>
        )}
        <div style={{padding:20}}>
          <button onClick={onClose} style={{position:"absolute",top:14,right:14,background:"rgba(0,0,0,0.5)",border:"1px solid rgba(255,255,255,0.15)",color:"white",borderRadius:10,width:32,height:32,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
          <div style={{fontSize:9,color,fontFamily:"'Space Mono',monospace",letterSpacing:1.5,marginBottom:4}}>{(game.genres||[]).map(g=>g.name).join(" · ")}</div>
          <h2 style={{margin:"0 0 10px",fontSize:22,fontFamily:"'Bitter',serif",color:mtext,lineHeight:1.2}}>{game.name}</h2>
          <div style={{display:"flex",justifyContent:"space-around",marginBottom:18,padding:12,background:mcard,borderRadius:14,border:`1px solid ${mborder}`}}>
            <ScoreRing value={scores.t} label="Time"      color={color} size={68} darkMode={darkMode}/>
            <ScoreRing value={scores.a} label="Adventure" color={color} size={68} darkMode={darkMode}/>
            <ScoreRing value={scores.w} label="Worth It"  color={color} size={68} darkMode={darkMode}/>
          </div>
          {/* Steam Deck Badge */}
          {badge && (
            <div style={{display:"flex",alignItems:"center",gap:10,background:badge.bg,border:`1px solid ${badge.color}40`,borderRadius:12,padding:"10px 14px",marginBottom:10}}>
              <span style={{fontSize:20}}>{badge.icon}</span>
              <div>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",fontFamily:"'Space Mono',monospace",letterSpacing:1}}>STEAM DECK</div>
                <div style={{fontSize:13,fontWeight:700,color:badge.color,fontFamily:"'Space Mono',monospace"}}>{badge.label}</div>
              </div>
              <div style={{marginLeft:"auto",fontSize:9,color:"rgba(255,255,255,0.25)",fontFamily:"'Space Mono',monospace",textAlign:"right"}}>via ProtonDB</div>
            </div>
          )}

          {/* OpenCritic Badge */}
          {ocData && ocData.score >= 0 && (
            <div style={{display:"flex",alignItems:"center",gap:10,background:"rgba(74,222,128,0.06)",border:`1px solid ${OC_TIER_COLOR[ocData.tier]||"#4ade80"}30`,borderRadius:12,padding:"10px 14px",marginBottom:10}}>
              <span style={{fontSize:20}}>🎯</span>
              <div>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",fontFamily:"'Space Mono',monospace",letterSpacing:1}}>OPENCRITIC</div>
                <div style={{fontSize:13,fontWeight:700,color:OC_TIER_COLOR[ocData.tier]||"#4ade80",fontFamily:"'Space Mono',monospace"}}>
                  {ocData.score} {ocData.tier ? `· ${ocData.tier}` : ""}
                  {ocData.percentRecommended != null ? <span style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontWeight:400}}> · {ocData.percentRecommended}% recommended</span> : null}
                </div>
              </div>
              <div style={{marginLeft:"auto",fontSize:9,color:"rgba(255,255,255,0.25)",fontFamily:"'Space Mono',monospace",textAlign:"right"}}>via OpenCritic</div>
            </div>
          )}

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
            {[["⏱ Session",scores.hltb.session],["📖 Story",scores.hltb.main],["🏆 100%",scores.hltb.complete],["🎯 Difficulty",scores.difficulty],["⭐ Rating",game.rating?`${game.rating.toFixed(1)}/5`:"Unrated"],["📊 Metacritic",game.metacritic||"No score"],["🔞 Age Rating", scores.esrb==="Not Rated"?"Unrated":scores.esrb==="Everyone"?"E — Everyone":scores.esrb==="Everyone 10+"?"E10+ — Everyone 10+":scores.esrb==="Teen"?"T — Teen (13+)":scores.esrb==="Mature"?"M — Mature (17+)":scores.esrb==="Adults Only"?"AO — Adults Only (18+)":scores.esrb==="Rating Pending"?"Rating Pending":scores.esrb],["📅 Released",game.released?new Date(game.released).toLocaleDateString("en-US",{year:"numeric",month:"short"}):"Unknown"],
            ].map(([k,v])=>(
              <div key={k} style={{background:mcard,borderRadius:10,padding:"9px 12px"}}>
                <div style={{fontSize:9,color:msubtle,fontFamily:"'Space Mono',monospace",marginBottom:3}}>{k}</div>
                <div style={{fontSize:12,color:mtext,fontWeight:700,fontFamily:"'Space Mono',monospace"}}>{v}</div>
              </div>
            ))}
          </div>
          {/* Store Prices */}
          {storeDeals.length > 0 && (
            <div style={{marginBottom:14}}>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.28)",fontFamily:"'Space Mono',monospace",letterSpacing:1.5,marginBottom:8}}>💰 PRICES</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {storeDeals.slice(0,6).map((d,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"rgba(255,255,255,0.04)",borderRadius:10,padding:"8px 12px"}}>
                    <div style={{fontSize:11,color:"rgba(255,255,255,0.7)",fontFamily:"'Space Mono',monospace"}}>{d.store}</div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      {d.cut > 0 && <span style={{fontSize:9,background:"rgba(74,222,128,0.15)",color:"#4ade80",borderRadius:6,padding:"2px 6px",fontFamily:"'Space Mono',monospace",fontWeight:700}}>-{d.cut}%</span>}
                      <span style={{fontSize:12,fontWeight:700,color:"white",fontFamily:"'Space Mono',monospace"}}>{d.price}</span>
                      {d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" style={{fontSize:9,color:"rgba(255,255,255,0.3)",fontFamily:"'Space Mono',monospace",textDecoration:"none"}} onMouseEnter={e=>e.currentTarget.style.color="#a78bfa"} onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,0.3)"}>→ Buy</a>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Steam price fallback when ITAD not configured */}
          {storeDeals.length === 0 && steamPrice && (
            <div style={{marginBottom:14,background:"rgba(255,255,255,0.04)",borderRadius:10,padding:"9px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.28)",fontFamily:"'Space Mono',monospace",letterSpacing:1.5}}>💰 STEAM PRICE</div>
              <div style={{fontSize:12,fontWeight:700,color:"white",fontFamily:"'Space Mono',monospace"}}>
                {steamPrice.is_free ? "Free to Play" : steamPrice.discount > 0 ? `${steamPrice.price} (${steamPrice.discount}% off)` : steamPrice.price || "N/A"}
              </div>
            </div>
          )}

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
          Your 3-day free trial has ended. Unlock full access for a one-time payment of {PRICE} — no subscriptions, ever.
        </p>
        <Btn onClick={onUpgrade} variant="gold" style={{padding:"14px 32px",fontSize:14}}>Unlock Full Access — {PRICE}</Btn>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMUNITY FEED
// ─────────────────────────────────────────────────────────────────────────────
function ReviewCard({ r, user, darkMode, onViewProfile, likeCounts, userLikeSet, commentCounts, onToggleLike, onOpenComments }) {
  const rid = reviewId(r);
  const liked = userLikeSet.has(rid);
  const likes = likeCounts[rid] || 0;
  const comments = commentCounts[rid] || 0;
  const isAnon = r.user_name === "Anonymous";
  const avatarBg = isAnon ? "rgba(255,255,255,0.15)" : `hsl(${(r.user_name?.charCodeAt(0)||0)*7%360},60%,40%)`;
  const accentColors = ["#a78bfa","#ec4899","#38bdf8","#4ade80","#f59e0b","#f87171","#818cf8"];
  const accent = accentColors[(r.game_id||0) % accentColors.length];
  const bg = darkMode ? "#0d0d18" : "#fff";
  const border = darkMode ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
  const text = darkMode ? "white" : "#0f0f1a";
  const muted = darkMode ? "rgba(255,255,255,0.35)" : "#666";
  return (
    <div style={{background:bg,border:`1px solid ${border}`,borderRadius:16,overflow:"hidden"}}>
      <div style={{height:3,background:`linear-gradient(90deg,${accent},${accent}55)`}}/>
      <div style={{padding:16}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
          <div onClick={()=>!isAnon&&onViewProfile(r.user_email)}
            style={{cursor:isAnon?"default":"pointer",width:38,height:38,borderRadius:"50%",background:avatarBg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:isAnon?16:14,fontWeight:700,color:"white",flexShrink:0,border:`2px solid ${accent}40`}}>
            {isAnon?"👤":r.user_name?.[0]?.toUpperCase()||"?"}
          </div>
          <div style={{flex:1}}>
            <div onClick={()=>!isAnon&&onViewProfile(r.user_email)} style={{cursor:isAnon?"default":"pointer",fontSize:13,fontWeight:700,color:text,fontFamily:"'Space Mono',monospace"}}>{r.user_name}</div>
            <div style={{fontSize:9,color:muted,fontFamily:"'Space Mono',monospace"}}>{new Date(r.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
          </div>
          <div style={{display:"flex",gap:1}}>{[1,2,3,4,5].map(s=><span key={s} style={{fontSize:13,color:s<=r.rating?"#fbbf24":darkMode?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.12)"}}>★</span>)}</div>
        </div>
        <div style={{background:darkMode?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.04)",borderRadius:10,padding:"10px 13px",marginBottom:r.review_text?10:0,borderLeft:`3px solid ${accent}`}}>
          <div style={{fontSize:14,fontWeight:700,color:text,fontFamily:"'Bitter',serif"}}>{r.game_name}</div>
          {r.time_spent && <div style={{fontSize:10,color:muted,fontFamily:"'Space Mono',monospace",marginTop:3}}>⏱ {r.time_spent}</div>}
        </div>
        {r.review_text && <div style={{fontSize:12,color:darkMode?"rgba(255,255,255,0.65)":"#444",fontFamily:"'Space Mono',monospace",lineHeight:1.7,marginBottom:12}}>{r.review_text}</div>}
        <div style={{display:"flex",gap:12,alignItems:"center",paddingTop:10,borderTop:`1px solid ${border}`}}>
          <button onClick={()=>onToggleLike(rid,liked)}
            style={{display:"flex",alignItems:"center",gap:5,background:"none",border:"none",cursor:"pointer",padding:"4px 10px",borderRadius:20,
              background:liked?`${accent}18`:"transparent",
              color:liked?accent:muted,fontSize:12,fontFamily:"'Space Mono',monospace",transition:"all .15s"}}>
            <span style={{fontSize:15}}>{liked?"❤️":"🤍"}</span>
            <span style={{fontWeight:liked?700:400}}>{likes > 0 ? likes : ""}</span>
          </button>
          <button onClick={()=>onOpenComments(rid,r)}
            style={{display:"flex",alignItems:"center",gap:5,background:"none",border:"none",cursor:"pointer",padding:"4px 10px",borderRadius:20,color:muted,fontSize:12,fontFamily:"'Space Mono',monospace",transition:"all .15s"}}>
            <span style={{fontSize:14}}>💬</span>
            <span>{comments > 0 ? comments : "Comment"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function CommentsPanel({ rid, review, user, darkMode, onClose, onViewProfile }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [posting, setPosting] = useState(false);
  const bg = darkMode ? "#0d0d18" : "#fff";
  const border = darkMode ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
  const text = darkMode ? "white" : "#0f0f1a";
  const muted = darkMode ? "rgba(255,255,255,0.35)" : "#666";
  const bottomRef = useRef(null);
  useEffect(() => { getComments(rid).then(d => { setComments(d); setLoading(false); }); }, [rid]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [comments]);
  const submit = async () => {
    if (!input.trim() || posting) return;
    setPosting(true);
    const name = user.gamerTag || user.email?.split("@")[0] || "Player";
    await postComment(rid, user.email, name, input.trim());
    setComments(c => [...c, { user_email: user.email, user_name: name, content: input.trim(), created_at: new Date().toISOString() }]);
    setInput("");
    setPosting(false);
  };
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:400,display:"flex",alignItems:"flex-end",justifyContent:"center",padding:"0",backdropFilter:"blur(8px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:darkMode?"#0d0d18":"#f8f8fc",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:600,maxHeight:"70vh",display:"flex",flexDirection:"column",border:`1px solid ${border}`}}>
        <div style={{padding:"14px 18px",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:text,fontFamily:"'Bitter',serif"}}>{review.game_name}</div>
            <div style={{fontSize:10,color:muted,fontFamily:"'Space Mono',monospace"}}>by {review.user_name}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:muted,fontSize:20,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"14px 18px",display:"flex",flexDirection:"column",gap:10}}>
          {loading && <div style={{color:muted,fontFamily:"'Space Mono',monospace",fontSize:11,textAlign:"center",padding:20}}>Loading comments...</div>}
          {!loading && comments.length===0 && <div style={{color:muted,fontFamily:"'Space Mono',monospace",fontSize:11,textAlign:"center",padding:24}}>No comments yet — be the first!</div>}
          {comments.map((c,i) => {
            const avatarBg = `hsl(${(c.user_name?.charCodeAt(0)||0)*7%360},60%,40%)`;
            return (
              <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                <div onClick={()=>onViewProfile(c.user_email)} style={{cursor:"pointer",width:30,height:30,borderRadius:"50%",background:avatarBg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"white",flexShrink:0}}>
                  {c.user_name?.[0]?.toUpperCase()||"?"}
                </div>
                <div style={{flex:1,background:darkMode?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.04)",borderRadius:10,padding:"8px 12px"}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#a78bfa",fontFamily:"'Space Mono',monospace",marginBottom:3}}>{c.user_name}</div>
                  <div style={{fontSize:12,color:darkMode?"rgba(255,255,255,0.75)":"#333",fontFamily:"'Space Mono',monospace",lineHeight:1.6}}>{c.content}</div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef}/>
        </div>
        <div style={{padding:"12px 18px",borderTop:`1px solid ${border}`,display:"flex",gap:8,flexShrink:0}}>
          <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()}
            placeholder="Write a comment..."
            style={{flex:1,background:darkMode?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.05)",border:`1px solid ${border}`,borderRadius:10,padding:"9px 13px",color:text,fontSize:12,fontFamily:"'Space Mono',monospace"}}/>
          <button onClick={submit} disabled={!input.trim()||posting}
            style={{background:"linear-gradient(135deg,#a78bfa,#7c3aed)",border:"none",borderRadius:10,padding:"9px 16px",color:"white",fontWeight:700,fontSize:12,cursor:"pointer",opacity:!input.trim()||posting?0.5:1,fontFamily:"'Space Mono',monospace"}}>
            {posting?"...":"Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CommunityFeed({ user, darkMode, onViewProfile }) {
  const [feedReviews, setFeedReviews] = useState([]);
  const [allReviews, setAllReviews] = useState([]);
  const [suggested, setSuggested] = useState([]);
  const [trending, setTrending] = useState([]);
  const [followingEmails, setFollowingEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [followingInProgress, setFollowingInProgress] = useState({});
  const [subTab, setSubTab] = useState("everyone"); // feed | everyone | discover
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [likeCounts, setLikeCounts] = useState({});
  const [userLikeSet, setUserLikeSet] = useState(new Set());
  const [commentCounts, setCommentCounts] = useState({});
  const [openComments, setOpenComments] = useState(null); // {rid, review}

  const bg     = darkMode ? "#0d0d18" : "#fff";
  const border = darkMode ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
  const text   = darkMode ? "white" : "#0f0f1a";
  const muted  = darkMode ? "rgba(255,255,255,0.35)" : "#666";

  const loadSocialData = async (reviews) => {
    if (!reviews.length) return;
    const ids = reviews.map(reviewId);
    const [lc, ul, cc] = await Promise.all([
      batchLikes(ids),
      getUserLikeSet(user.email),
      batchCommentCounts(ids),
    ]);
    setLikeCounts(lc);
    setUserLikeSet(ul);
    setCommentCounts(cc);
  };

  const loadFeed = async () => {
    setLoading(true);
    const [followingData, allRevs, trendingData] = await Promise.all([
      getFollowing(user.email).catch(() => []),
      sbFetch(`/reviews?order=created_at.desc&limit=60`).catch(() => []),
      getTrendingGames(),
    ]);
    const emails = followingData.map(f => f.following_email);
    setFollowingEmails(emails);
    setAllReviews(allRevs || []);
    setTrending(trendingData);

    if (emails.length > 0) {
      try {
        const fr = await sbFetch(`/reviews?user_email=in.(${emails.map(encodeURIComponent).join(",")})&order=created_at.desc&limit=40`);
        setFeedReviews(fr || []);
        await loadSocialData([...(fr||[]), ...(allRevs||[])]);
      } catch { setFeedReviews([]); }
    } else {
      await loadSocialData(allRevs || []);
    }

    // Build suggested players from recent reviewers
    const seen = new Set([user.email, ...emails]);
    const people = [];
    for (const r of (allRevs || [])) {
      if (!seen.has(r.user_email) && r.user_name !== "Anonymous") {
        seen.add(r.user_email);
        people.push({ email: r.user_email, name: r.user_name, gameName: r.game_name });
      }
      if (people.length >= 8) break;
    }
    setSuggested(people);
    setLoading(false);
  };

  useEffect(() => { loadFeed(); }, [user.email]);

  const handleToggleLike = async (rid, isLiked) => {
    // Optimistic update
    setUserLikeSet(prev => { const s = new Set(prev); isLiked ? s.delete(rid) : s.add(rid); return s; });
    setLikeCounts(prev => ({ ...prev, [rid]: Math.max(0, (prev[rid]||0) + (isLiked?-1:1)) }));
    await toggleLike(user.email, rid, isLiked);
  };

  const searchPlayers = async (q) => {
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    try {
      // Search by gamer_tag first, then fall back to name match in reviews
      const [byTag, byReview] = await Promise.all([
        sbFetch(`/profiles?gamer_tag=ilike.*${encodeURIComponent(q.trim())}*&limit=10`).catch(()=>[]),
        sbFetch(`/reviews?user_name=ilike.*${encodeURIComponent(q.trim())}*&limit=20`).catch(()=>[]),
      ]);
      const seen = new Set([user.email]);
      const results = [];
      for (const p of (byTag||[])) {
        if (!seen.has(p.user_email)) { seen.add(p.user_email); results.push({ email: p.user_email, name: p.gamer_tag || p.user_email?.split("@")[0], gamertag: p.gamer_tag }); }
      }
      for (const r of (byReview||[])) {
        if (!seen.has(r.user_email) && r.user_name !== "Anonymous") { seen.add(r.user_email); results.push({ email: r.user_email, name: r.user_name, gameName: r.game_name }); }
      }
      setSearchResults(results.slice(0, 10));
    } catch { setSearchResults([]); }
    setSearching(false);
  };

  const handleFollow = async (email) => {
    setFollowingInProgress(p => ({...p, [email]: true}));
    await followUser(user.email, email);
    setFollowingEmails(e => [...e, email]);
    setSuggested(s => s.filter(x => x.email !== email));
    setFollowingInProgress(p => ({...p, [email]: false}));
    loadFeed();
  };

  const playerCard = (p) => (
    <div key={p.email} style={{display:"flex",alignItems:"center",gap:12,background:bg,border:`1px solid ${border}`,borderRadius:12,padding:"12px 14px"}}>
      <div onClick={()=>onViewProfile(p.email)} style={{cursor:"pointer",width:42,height:42,borderRadius:"50%",background:`hsl(${(p.name?.charCodeAt(0)||0)*7%360},60%,40%)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:700,color:"white",flexShrink:0}}>
        {p.name?.[0]?.toUpperCase()||"?"}
      </div>
      <div style={{flex:1}} onClick={()=>onViewProfile(p.email)}>
        <div style={{fontSize:13,fontWeight:700,color:text,fontFamily:"'Space Mono',monospace",cursor:"pointer"}}>{p.name}</div>
        {p.gamertag && <div style={{fontSize:9,color:"#a78bfa",fontFamily:"'Space Mono',monospace"}}>@{p.gamertag}</div>}
        {p.gameName && <div style={{fontSize:9,color:muted,fontFamily:"'Space Mono',monospace"}}>🎮 {p.gameName}</div>}
      </div>
      {followingEmails.includes(p.email)
        ? <span style={{fontSize:10,color:"#4ade80",fontFamily:"'Space Mono',monospace",fontWeight:700}}>✓ Following</span>
        : <button onClick={()=>handleFollow(p.email)} disabled={!!followingInProgress[p.email]}
            style={{background:"linear-gradient(135deg,#a78bfa,#7c3aed)",border:"none",borderRadius:8,padding:"7px 14px",color:"white",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"'Space Mono',monospace",opacity:followingInProgress[p.email]?0.7:1}}>
            {followingInProgress[p.email]?"...":"+ Follow"}
          </button>
      }
    </div>
  );

  const reviewCards = (reviews) => (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {reviews.filter(r=>r.user_name!=="Anonymous").map((r,i)=>(
        <ReviewCard key={`${r.user_email}-${r.game_id}-${i}`} r={r} user={user} darkMode={darkMode}
          onViewProfile={onViewProfile} likeCounts={likeCounts} userLikeSet={userLikeSet}
          commentCounts={commentCounts} onToggleLike={handleToggleLike}
          onOpenComments={(rid,rev)=>setOpenComments({rid,review:rev})}/>
      ))}
    </div>
  );

  if (loading) return (
    <div style={{maxWidth:640,margin:"0 auto",padding:"0 16px 40px"}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr",gap:12}}>
        {[...Array(4)].map((_,i)=>(
          <div key={i} style={{borderRadius:16,overflow:"hidden",background:bg,border:`1px solid ${border}`}}>
            <div className="skeleton" style={{height:3}}/><div style={{padding:16,display:"flex",flexDirection:"column",gap:10}}>
            <div style={{display:"flex",gap:10,alignItems:"center"}}><div className="skeleton" style={{width:38,height:38,borderRadius:"50%"}}/><div style={{flex:1,display:"flex",flexDirection:"column",gap:6}}><div className="skeleton" style={{height:12,width:"40%",borderRadius:6}}/><div className="skeleton" style={{height:9,width:"25%",borderRadius:6}}/></div></div>
            <div className="skeleton" style={{height:56,borderRadius:10}}/><div className="skeleton" style={{height:10,borderRadius:6,width:"70%"}}/>
          </div></div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{maxWidth:640,margin:"0 auto",padding:"0 16px 40px"}}>
      {openComments && <CommentsPanel rid={openComments.rid} review={openComments.review} user={user} darkMode={darkMode} onViewProfile={onViewProfile} onClose={()=>setOpenComments(null)}/>}

      {/* Sub-tab bar */}
      <div style={{display:"flex",background:darkMode?"rgba(0,0,0,0.35)":"rgba(0,0,0,0.05)",borderRadius:11,padding:3,gap:3,marginBottom:20}}>
        {[["everyone","🌍 Everyone"],["feed","📋 My Feed"],["discover","🔍 Discover"]].map(([v,l])=>(
          <button key={v} onClick={()=>setSubTab(v)}
            style={{flex:1,background:subTab===v?darkMode?"rgba(167,139,250,0.2)":"white":"transparent",
              color:subTab===v?"#a78bfa":darkMode?"rgba(255,255,255,0.4)":"rgba(0,0,0,0.45)",
              border:`1px solid ${subTab===v?"rgba(167,139,250,0.4)":"transparent"}`,
              borderRadius:8,padding:"8px",cursor:"pointer",fontSize:11,fontWeight:subTab===v?700:400,
              fontFamily:"'Space Mono',monospace",transition:"all .2s"}}>
            {l}
          </button>
        ))}
      </div>

      {/* ── EVERYONE TAB ── */}
      {subTab === "everyone" && (
        <div>
          <div style={{fontSize:9,color:muted,fontFamily:"'Space Mono',monospace",letterSpacing:2,fontWeight:800,marginBottom:12}}>🌍 LATEST FROM THE COMMUNITY</div>
          {allReviews.length === 0
            ? <div style={{textAlign:"center",padding:"40px 20px",background:bg,border:`1px solid ${border}`,borderRadius:16}}>
                <div style={{fontSize:36,marginBottom:10}}>🎮</div>
                <div style={{fontSize:14,fontWeight:700,color:text,fontFamily:"'Bitter',serif",marginBottom:8}}>No reviews yet</div>
                <div style={{fontSize:11,color:muted,fontFamily:"'Space Mono',monospace",lineHeight:1.7}}>Be the first to review a game!</div>
              </div>
            : reviewCards(allReviews)
          }
        </div>
      )}

      {/* ── MY FEED TAB ── */}
      {subTab === "feed" && (
        <div>
          <div style={{fontSize:9,color:muted,fontFamily:"'Space Mono',monospace",letterSpacing:2,fontWeight:800,marginBottom:12}}>
            📋 FROM PEOPLE YOU FOLLOW {feedReviews.length>0&&`· ${feedReviews.length} reviews`}
          </div>
          {followingEmails.length === 0
            ? <div style={{textAlign:"center",padding:"40px 20px",background:bg,border:`1px solid ${border}`,borderRadius:16}}>
                <div style={{fontSize:36,marginBottom:10}}>👥</div>
                <div style={{fontSize:14,fontWeight:700,color:text,fontFamily:"'Bitter',serif",marginBottom:8}}>Your feed is empty</div>
                <div style={{fontSize:11,color:muted,fontFamily:"'Space Mono',monospace",lineHeight:1.7}}>Follow players in the <strong style={{color:"#a78bfa"}}>Everyone</strong> or <strong style={{color:"#a78bfa"}}>Discover</strong> tabs to fill your feed.</div>
              </div>
            : feedReviews.length === 0
              ? <div style={{textAlign:"center",padding:"40px 20px",background:bg,border:`1px solid ${border}`,borderRadius:16}}>
                  <div style={{fontSize:36,marginBottom:10}}>🎮</div>
                  <div style={{fontSize:14,fontWeight:700,color:text,fontFamily:"'Bitter',serif",marginBottom:8}}>No reviews yet</div>
                  <div style={{fontSize:11,color:muted,fontFamily:"'Space Mono',monospace",lineHeight:1.7}}>The people you follow haven't posted reviews yet.</div>
                </div>
              : reviewCards(feedReviews)
          }
        </div>
      )}

      {/* ── DISCOVER TAB ── */}
      {subTab === "discover" && (
        <div style={{display:"flex",flexDirection:"column",gap:24}}>

          {/* Search */}
          <div>
            <input placeholder="Search by name or gamer tag..."
              value={searchQuery}
              onChange={e=>{ setSearchQuery(e.target.value); searchPlayers(e.target.value); }}
              style={{width:"100%",background:darkMode?"rgba(0,0,0,0.45)":"rgba(0,0,0,0.05)",border:`1px solid ${border}`,borderRadius:11,padding:"12px 16px",color:text,fontSize:12,fontFamily:"'Space Mono',monospace",boxSizing:"border-box"}}/>
            {searchQuery.trim().length > 0 && (
              <div style={{marginTop:12}}>
                {searching && <div style={{color:muted,fontFamily:"'Space Mono',monospace",fontSize:11}}>Searching...</div>}
                {!searching && searchResults.length === 0 && <div style={{color:muted,fontFamily:"'Space Mono',monospace",fontSize:11}}>No players found for "{searchQuery}"</div>}
                <div style={{display:"flex",flexDirection:"column",gap:8}}>{searchResults.map(playerCard)}</div>
              </div>
            )}
          </div>

          {/* Trending games */}
          {trending.length > 0 && !searchQuery && (
            <div>
              <div style={{fontSize:9,color:muted,fontFamily:"'Space Mono',monospace",letterSpacing:2,fontWeight:800,marginBottom:12}}>🔥 TRENDING THIS WEEK</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {trending.map((g,i)=>(
                  <div key={g.id} style={{background:bg,border:`1px solid ${border}`,borderRadius:10,padding:"8px 12px",display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:11,fontWeight:700,color:"#a78bfa",fontFamily:"'Space Mono',monospace"}}>#{i+1}</span>
                    <div>
                      <div style={{fontSize:11,fontWeight:700,color:text,fontFamily:"'Bitter',serif"}}>{g.name}</div>
                      <div style={{fontSize:9,color:muted,fontFamily:"'Space Mono',monospace"}}>{g.count} review{g.count!==1?"s":""}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Suggested players */}
          {!searchQuery && (
            <div>
              <div style={{fontSize:9,color:muted,fontFamily:"'Space Mono',monospace",letterSpacing:2,fontWeight:800,marginBottom:12}}>👥 SUGGESTED PLAYERS</div>
              {suggested.length === 0
                ? <div style={{textAlign:"center",padding:"32px 20px",background:bg,border:`1px solid ${border}`,borderRadius:16}}>
                    <div style={{fontSize:11,color:muted,fontFamily:"'Space Mono',monospace"}}>No suggestions yet — check back as more people join!</div>
                  </div>
                : <div style={{display:"flex",flexDirection:"column",gap:8}}>{suggested.map(playerCard)}</div>
              }
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_FILTERS = {time:"all",genre:"all",platform:"all",difficulty:"all",multiplayer:"all",price:"all",year:"all",minScore:"any"};
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
  const [showMessages, setShowMessages] = useState(false);
  const [messagesRecipient, setMessagesRecipient] = useState(null);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [showFAQ, setShowFAQ] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [activeView, setActiveView] = useState("discover"); // discover | community
  const [ageVerified, setAgeVerified] = useState(() => localStorage.getItem("wmt_age_verified") === "1");
  const [showAgeGate, setShowAgeGate] = useState(false);
  const [activeParentFilter, setActiveParentFilter] = useState(null);
  const [parentalModeActive, setParentalModeActive] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pendingPinAction, setPendingPinAction] = useState(null);
  const [kidsMode, setKidsMode] = useState(() => localStorage.getItem(KIDS_MODE_KEY) === "1");
  const parentPinSet = () => !!localStorage.getItem(PARENT_PIN_KEY);
  const ageVerifiedRef = useRef(ageVerified);
  const kidsModeRef = useRef(kidsMode);
  useEffect(() => { ageVerifiedRef.current = ageVerified; }, [ageVerified]);
  useEffect(() => { kidsModeRef.current = kidsMode; }, [kidsMode]);
  // Listen for kids mode changes from the settings component
  useEffect(() => {
    const handler = () => {
      const on = localStorage.getItem(KIDS_MODE_KEY) === "1";
      setKidsMode(on);
      kidsModeRef.current = on;
      setActiveParentFilter(null);
      setParentalModeActive(false);
      if (on) {
        setTimeout(() => handleParentSearch("kids", 1), 50);
      } else {
        setTimeout(() => fetchGames(search, filters, sortBy, 1), 50);
      }
    };
    window.addEventListener("wmt_kids_mode_change", handler);
    return () => window.removeEventListener("wmt_kids_mode_change", handler);
  }, []);
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
        getUnreadCount(user.email).then(n => setUnreadMessages(n));
      }
      setAppReady(true);
    });
  }, []);

  const status = getAccountStatus(user);
  const access = hasFullAccess(user);

  const handleLogin = async (u) => { await store.set("wmt_user", u); setUser(u); };
  const handleLogout = async () => { await store.del("wmt_user"); setUser(null); setGames([]); setHasLoaded(false); };
  const handlePaid = async () => {
    // Re-fetch from Supabase to get the authoritative paid status set by the webhook
    const fresh = await sbGetAccount(user.email);
    const updated = fresh ? accountToUser(fresh) : { ...user, isPaid:true, paidAt:Date.now() };
    await store.set("wmt_user", updated);
    setUser(updated);
    // Modal stays open so the success step can be shown; it closes via onClose
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
      const YEAR_RANGES = { "2020s":"2020-01-01,"+todayDate, "2010s":"2010-01-01,2019-12-31", "2000s":"2000-01-01,2009-12-31", "classic":"1980-01-01,1999-12-31" };
      const dateRange = YEAR_RANGES[f.year] || `2000-01-01,${todayDate}`;
      const p = new URLSearchParams({
        key: RAWG_KEY,
        page_size: 40,
        page: pg,
        ordering: SORT_MAP[sort] || "-released",
        dates: dateRange,
        exclude_additions: "true",
      });
      if (f.minScore !== "any") p.set("metacritic", `${f.minScore},100`);
      if (f.platform !== "all" && PLATFORM_MAP[f.platform]) p.set("platforms", PLATFORM_MAP[f.platform]);
      // Kids Mode locks to Everyone/Everyone 10+ only; otherwise exclude Adults Only unless age verified
      if (kidsModeRef.current) p.set("esrb_ratings", "1,2");
      else if (!ageVerifiedRef.current) p.set("esrb_ratings", "1,2,3,4");
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
      // In Kids Mode: also enforce ESRB 1-2 client-side (API filter alone is unreliable)
      results = results.filter(g => {
        if (!g.released || g.released > today) return false;
        if (!g.background_image) return false;
        if (kidsModeRef.current) {
          const esrbId = g.esrb_rating?.id;
          if (!esrbId || esrbId > 2) return false;
        }
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

  // Lock body scroll when any modal is open
  useEffect(() => {
    const anyModal = viewProfile || showEditProfile || showFAQ || showPrivacy || showTerms || showAgeGate || showPinModal;
    document.body.style.overflow = anyModal ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [viewProfile, showEditProfile, showFAQ, showPrivacy, showTerms, showAgeGate, showPinModal]);

  // Auto-load a random page of top-rated games on first login
  useEffect(() => {
    if (!user || !access) return;
    if (kidsModeRef.current) {
      // Kids Mode: use tag-based search — RAWG's esrb_ratings filter is unreliable
      handleParentSearch("kids", 1);
    } else {
      const randomPage = Math.floor(Math.random() * 20) + 1;
      fetchGames("", filters, "rating", randomPage);
    }
  }, [user?.email, access]);

  useEffect(() => {
    if (!user || !access || !hasLoaded) return;
    setActiveParentFilter(null); setParentalModeActive(false); // leaving to regular search exits parental mode
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => {
      setPage(1);
      fetchGames(search, filters, sortBy, 1);
    }, search ? 400 : 100);
  }, [search, filters, sortBy]);

  useEffect(() => {
    if (!hasLoaded || !user || !access) return;
    if (activeParentFilter) handleParentSearch(activeParentFilter, page);
    else fetchGames(search, filters, sortBy, page);
  }, [page]);

  const handleTimeSearch = (overrideMinutes) => {
    const m = parseInt(overrideMinutes ?? minutes); if (!m) return;
    setActiveParentFilter(null);
    setMinutes(String(m));

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

  const handleParentSearch = useCallback(async (type, pg=1) => {
    setLoading(true); setError("");
    if (pg === 1) { setSearch(""); setPage(1); setFilters(DEFAULT_FILTERS); setMinutes(""); setActiveParentFilter(type); }
    const todayDate = new Date().toISOString().split("T")[0];
    // esrb: 1=Everyone, 2=Everyone 10+ only — strictly excludes Teen(3), Mature(4), Adults Only(5)
    const SAFE_ESRB = "1,2";
    const configs = {
      kids:       { tags:"family-friendly,for-kids,cute,cartoon",          esrb:SAFE_ESRB, ordering:"-rating" },
      adhd:       { tags:"relaxing,casual,wholesome,colorful,family-friendly", esrb:SAFE_ESRB, ordering:"-rating" },
      autism:     { tags:"relaxing,wholesome,colorful,no-jump-scares,family-friendly", esrb:SAFE_ESRB, ordering:"-rating" },
      familycoop: { tags:"local-co-op,family-friendly,co-op,cartoon",      esrb:SAFE_ESRB, ordering:"-rating" },
    };
    const cfg = configs[type]; if (!cfg) return;
    try {
      const params = new URLSearchParams({ key:RAWG_KEY, page_size:40, page:pg, ordering:cfg.ordering, tags:cfg.tags, esrb_ratings:cfg.esrb, dates:`2000-01-01,${todayDate}`, exclude_additions:"true" });
      const res = await fetch(`${RAWG_BASE}/games?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      // Extra client-side safety: filter out adult/mature content by genre AND title keywords
      const BLOCKED_GENRES = ["adult","eroge","hentai","pinup","nude"];
      const BLOCKED_TITLE_WORDS = [
        "hentai","eroge","nude","naked","nsfw","xxx","porn","sex","lewd","ecchi",
        "18+","adult","fetish","strip","lingerie","bikini","topless","uncensored",
        "stuck in","milf","busty","boobs","booty","ass ","sexy girl","hot girl",
        "washing machine","step","onlyfans",
      ];
      const results = (data.results||[]).filter(g => {
        if (!g.background_image) return false;
        // Strictly require E(1) or E10+(2) — reject unrated, Teen, Mature, Adults Only
        const esrbId = g.esrb_rating?.id;
        if (!esrbId || esrbId > 2) return false;
        const genres = (g.genres||[]).map(g=>g.slug);
        if (genres.some(s => BLOCKED_GENRES.includes(s))) return false;
        const title = (g.name||"").toLowerCase();
        if (BLOCKED_TITLE_WORDS.some(w => title.includes(w))) return false;
        return true;
      });
      setGames(results); setTotal(data.count||0); setHasLoaded(true);
    } catch { setError("Couldn't load results. Try again."); }
    setLoading(false);
  }, []);

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

  const handleSurpriseMe = async () => {
    setActiveParentFilter(null);
    setLoading(true); setError(""); setHasLoaded(true);
    try {
      const randomPage = Math.floor(Math.random() * 50) + 1;
      const todayDate = new Date().toISOString().split("T")[0];
      const p = new URLSearchParams({ key:RAWG_KEY, page_size:40, page:randomPage, ordering:"-rating", dates:`2010-01-01,${todayDate}`, metacritic:"70,100", exclude_additions:"true" });
      if (kidsModeRef.current) p.set("esrb_ratings", "1,2");
      const res = await fetch(`${RAWG_BASE}/games?${p}`);
      const data = await res.json();
      let results = (data.results||[]).filter(g=>g.background_image);
      if (kidsModeRef.current) {
        results = results.filter(g => { const id = g.esrb_rating?.id; return id === 1 || id === 2; });
      }
      if (results.length > 0) setSelected(results[Math.floor(Math.random()*results.length)]);
      setGames(results);
    } catch { setError("Couldn't load a surprise. Try again!"); }
    setLoading(false);
  };

  if (!appReady) return <div style={{minHeight:"100vh",background:"#07070f",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{color:"rgba(255,255,255,0.3)",fontFamily:"'Space Mono',monospace",fontSize:12}}>Loading...</div></div>;
  if (!user) return <><style>{`*{box-sizing:border-box}body{margin:0}input{color-scheme:dark}input::placeholder{color:rgba(255,255,255,0.22)}input:focus{outline:none;border-color:rgba(167,139,250,0.6)!important;box-shadow:0 0 0 3px rgba(167,139,250,0.12)!important}::selection{background:rgba(167,139,250,0.35);color:white}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#07070f}::-webkit-scrollbar-thumb{background:rgba(167,139,250,0.35);border-radius:4px}`}</style><AuthScreen onLogin={handleLogin}/></>;


  return (
    <>
      <style>{`*{box-sizing:border-box}body{margin:0}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#0d0d18}::-webkit-scrollbar-thumb{background:rgba(167,139,250,0.35);border-radius:4px}::-webkit-scrollbar-thumb:hover{background:rgba(167,139,250,0.6)}::selection{background:rgba(167,139,250,0.35);color:white}input::placeholder{color:rgba(255,255,255,0.25)}input:focus{outline:none;border-color:rgba(167,139,250,0.6)!important;box-shadow:0 0 0 3px rgba(167,139,250,0.12)!important}textarea:focus{outline:none;border-color:rgba(167,139,250,0.6)!important;box-shadow:0 0 0 3px rgba(167,139,250,0.12)!important}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}@keyframes fadeIn{from{opacity:0;transform:translateY(12px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}.card-anim{animation:fadeIn .38s cubic-bezier(.22,1,.36,1) forwards;opacity:0}@keyframes shimmer{0%{background-position:-600px 0}100%{background-position:600px 0}}.skeleton{background:linear-gradient(90deg,rgba(255,255,255,0.04) 25%,rgba(255,255,255,0.09) 50%,rgba(255,255,255,0.04) 75%);background-size:600px 100%;animation:shimmer 1.6s infinite linear}`}</style>

      <div style={{minHeight:"100vh",background:darkMode?"#111118":"#f4f4f8",backgroundImage:darkMode?"radial-gradient(ellipse at 15% 15%,#1e0d35 0%,transparent 45%),radial-gradient(ellipse at 85% 85%,#0c1a30 0%,transparent 45%)":"radial-gradient(ellipse at 15% 15%,#e0d7ff 0%,transparent 45%),radial-gradient(ellipse at 85% 85%,#d7e8ff 0%,transparent 45%)",transition:"background .3s,color .3s"}}>

        {/* Status Bar */}
        <StatusBar user={user} onUpgrade={()=>setShowPaywall(true)} onLogout={handleLogout}/>
        {/* Header */}
        <div style={{textAlign:"center",padding:"32px 20px 16px"}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:6,background:darkMode?"rgba(167,139,250,0.1)":"rgba(124,58,237,0.08)",border:`1px solid ${darkMode?"rgba(167,139,250,0.25)":"rgba(124,58,237,0.2)"}`,borderRadius:20,padding:"4px 14px",marginBottom:12}}>
            <span style={{fontSize:11}}>✨</span>
            <span style={{fontSize:10,fontFamily:"'Space Mono',monospace",color:darkMode?"#c4b5fd":"#7c3aed",fontWeight:700,letterSpacing:0.5}}>500,000+ games scored</span>
          </div>
          <h1 style={{margin:"0 0 8px",fontSize:"clamp(30px,6vw,54px)",fontFamily:"'Bitter',serif",fontWeight:900,lineHeight:1.05,letterSpacing:-1,background:"linear-gradient(135deg,#a78bfa 0%,#ec4899 60%,#f59e0b 100%)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}}>Worth My Time?</h1>
          <p style={{color:darkMode?"rgba(255,255,255,0.38)":"#555555",fontSize:13,margin:"0 auto 16px",maxWidth:340,lineHeight:1.7,fontFamily:"'Lora',serif",fontStyle:"italic"}}>
            Real game intelligence for busy people.
          </p>
          {/* User controls row */}
          {user && (
            <div style={{display:"flex",justifyContent:"center",gap:8,flexWrap:"wrap"}}>
              {kidsMode && (
                <div style={{background:"rgba(167,139,250,0.15)",border:"1px solid rgba(167,139,250,0.4)",borderRadius:20,padding:"5px 14px",color:"#a78bfa",fontSize:10,fontFamily:"'Space Mono',monospace",fontWeight:700,display:"flex",alignItems:"center",gap:5}}>
                  🧒 Kids Mode
                </div>
              )}
              {[
                ["👤", "My Profile", ()=>setViewProfile(user.email)],
                [darkMode?"☀️":"🌙", darkMode?"Light Mode":"Dark Mode", ()=>setDarkMode(!darkMode)],
              ].map(([icon, label, fn])=>(
                <button key={label} onClick={fn}
                  style={{background:darkMode?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.06)",
                    border:`1px solid ${darkMode?"rgba(255,255,255,0.12)":"rgba(0,0,0,0.12)"}`,
                    borderRadius:20,padding:"5px 14px",color:darkMode?"rgba(255,255,255,0.55)":"rgba(0,0,0,0.55)",
                    fontSize:10,cursor:"pointer",fontFamily:"'Space Mono',monospace",
                    display:"flex",alignItems:"center",gap:5,transition:"all .2s"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(167,139,250,0.5)";e.currentTarget.style.color="#a78bfa";}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=darkMode?"rgba(255,255,255,0.12)":"rgba(0,0,0,0.12)";e.currentTarget.style.color=darkMode?"rgba(255,255,255,0.55)":"rgba(0,0,0,0.55)";}}>
                  <span>{icon}</span>{label}
                </button>
              ))}
              <button onClick={()=>{ setMessagesRecipient(null); setShowMessages(true); setUnreadMessages(0); }}
                style={{background:darkMode?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.06)",
                  border:`1px solid ${unreadMessages>0?"rgba(167,139,250,0.5)":darkMode?"rgba(255,255,255,0.12)":"rgba(0,0,0,0.12)"}`,
                  borderRadius:20,padding:"5px 14px",color:unreadMessages>0?"#a78bfa":darkMode?"rgba(255,255,255,0.55)":"rgba(0,0,0,0.55)",
                  fontSize:10,cursor:"pointer",fontFamily:"'Space Mono',monospace",
                  display:"flex",alignItems:"center",gap:5,transition:"all .2s",position:"relative"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(167,139,250,0.5)";e.currentTarget.style.color="#a78bfa";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=unreadMessages>0?"rgba(167,139,250,0.5)":darkMode?"rgba(255,255,255,0.12)":"rgba(0,0,0,0.12)";e.currentTarget.style.color=unreadMessages>0?"#a78bfa":darkMode?"rgba(255,255,255,0.55)":"rgba(0,0,0,0.55)";}}>
                <span>💬</span>Messages{unreadMessages>0&&<span style={{background:"#a78bfa",color:"white",borderRadius:"50%",width:16,height:16,fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{unreadMessages}</span>}
              </button>
            </div>
          )}
        </div>

        {/* View Tab Bar */}
        <div style={{maxWidth:540,margin:"0 auto 20px",padding:"0 16px"}}>
          <div style={{display:"flex",background:darkMode?"rgba(0,0,0,0.4)":"rgba(0,0,0,0.06)",borderRadius:12,padding:3,gap:3}}>
            {[["discover","🎮 Discover"],["community","👥 Community"]].map(([v,l])=>(
              <button key={v} onClick={()=>setActiveView(v)}
                style={{flex:1,background:activeView===v?darkMode?"rgba(167,139,250,0.2)":"white":"transparent",
                  color:activeView===v?"#a78bfa":darkMode?"rgba(255,255,255,0.4)":"rgba(0,0,0,0.45)",
                  border:`1px solid ${activeView===v?"rgba(167,139,250,0.4)":"transparent"}`,
                  borderRadius:9,padding:"9px",cursor:"pointer",fontSize:12,fontWeight:activeView===v?700:400,
                  fontFamily:"'Space Mono',monospace",transition:"all .2s"}}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* Community Feed View */}
        {activeView === "community" && (
          <CommunityFeed user={user} darkMode={darkMode} onViewProfile={setViewProfile}/>
        )}

        {/* Quick Finder */}
        {activeView === "discover" && <><div style={{maxWidth:540,margin:"0 auto 16px",padding:"0 16px",display:"flex",flexDirection:"column",gap:10}}>

          {/* Time Finder */}
          <div style={{background:darkMode?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.05)",border:`1px solid ${darkMode?"rgba(255,255,255,0.09)":"rgba(0,0,0,0.15)"}`,borderRadius:14,padding:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{fontSize:9,color:darkMode?"rgba(255,255,255,0.35)":"#111",fontFamily:"'Space Mono',monospace",letterSpacing:2,fontWeight:800}}>⚡ I HAVE THIS LONG</div>
              {minutes && <button onClick={handleClearTimeSearch} style={{background:"none",border:"none",color:"rgba(248,113,113,0.7)",fontSize:9,cursor:"pointer",fontFamily:"'Space Mono',monospace"}}>✕ Clear</button>}
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {[["15 min",15],["30 min",30],["45 min",45],["1 hr",60],["1.5 hr",90],["2 hr",120],["3+ hr",180]].map(([label,val])=>(
                <button key={val} onClick={()=>handleTimeSearch(val)}
                  style={{background:minutes===String(val)?"rgba(167,139,250,0.25)":darkMode?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.06)",
                    border:`1px solid ${minutes===String(val)?"rgba(167,139,250,0.6)":darkMode?"rgba(255,255,255,0.12)":"rgba(0,0,0,0.12)"}`,
                    borderRadius:20,padding:"6px 14px",color:minutes===String(val)?"#a78bfa":darkMode?"rgba(255,255,255,0.6)":"rgba(0,0,0,0.6)",
                    fontSize:10,cursor:"pointer",fontFamily:"'Space Mono',monospace",fontWeight:minutes===String(val)?700:400,transition:"all .15s"}}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 18+ Toggle — hidden when Kids Mode is on */}
          {!kidsMode && (
            <>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:darkMode?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.05)",border:`1px solid ${ageVerified?"rgba(249,115,22,0.4)":darkMode?"rgba(255,255,255,0.09)":"rgba(0,0,0,0.15)"}`,borderRadius:14,padding:"10px 14px",cursor:"pointer",transition:"all .2s"}}
              onClick={()=>{ if(ageVerified){ localStorage.removeItem("wmt_age_verified"); setAgeVerified(false); setTimeout(()=>fetchGames(search,filters,sortBy,1),50); } else { setShowAgeGate(true); } }}>
              <div>
                <div style={{fontSize:9,color:ageVerified?"#f97316":darkMode?"rgba(255,255,255,0.35)":"#111",fontFamily:"'Space Mono',monospace",letterSpacing:2,fontWeight:800}}>🔞 MATURE CONTENT</div>
                <div style={{fontSize:9,color:darkMode?"rgba(255,255,255,0.3)":"rgba(0,0,0,0.4)",fontFamily:"'Space Mono',monospace",marginTop:3}}>{ageVerified ? "Showing Mature & Adults Only games" : "18+ content hidden — tap to enable"}</div>
              </div>
              <div style={{width:36,height:20,borderRadius:10,background:ageVerified?"#f97316":"rgba(255,255,255,0.1)",position:"relative",transition:"background .2s",flexShrink:0}}>
                <div style={{position:"absolute",top:2,left:ageVerified?18:2,width:16,height:16,borderRadius:"50%",background:"white",transition:"left .2s",boxShadow:"0 1px 4px rgba(0,0,0,0.4)"}}/>
              </div>
            </div>
            {/* For Parents hint */}
            <div onClick={()=>setShowEditProfile(true)} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 4px",cursor:"pointer",opacity:0.6}} title="Set up Kids Mode">
              <span style={{fontSize:11}}>👨‍👩‍👧</span>
              <span style={{fontSize:9,color:darkMode?"rgba(255,255,255,0.45)":"rgba(0,0,0,0.45)",fontFamily:"'Space Mono',monospace",lineHeight:1.5}}>
                <span style={{textDecoration:"underline"}}>Set up Kids Mode</span> — Profile → 🔒 Controls
              </span>
            </div>
            </>
          )}

          {/* Kids Mode active — show sub-filters + banner */}
          {kidsMode && (
            <div style={{background:"rgba(167,139,250,0.08)",border:"1px solid rgba(167,139,250,0.3)",borderRadius:14,padding:14}}>
              <div style={{fontSize:9,color:"#a78bfa",fontFamily:"'Space Mono',monospace",letterSpacing:2,fontWeight:800,marginBottom:10}}>🧒 KIDS MODE ACTIVE</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {[
                  ["🧒 Kid Friendly","kids","Games rated Everyone — safe for all ages"],
                  ["🧩 ADHD Friendly","adhd","Short, engaging sessions — easy to pick up and put down"],
                  ["🌈 Autism Safe","autism","Calm, predictable — no jump scares or sensory overload"],
                  ["🎮 Family Co-op","familycoop","Play together on the same couch"],
                ].map(([label,type,tip])=>{
                  const isActive = activeParentFilter === type;
                  return (
                    <button key={type} title={tip}
                      onClick={()=>{
                        if (isActive) { setActiveParentFilter(null); setPage(1); fetchGames(search,filters,sortBy,1); }
                        else { handleParentSearch(type); }
                      }}
                      style={{background:isActive?"rgba(167,139,250,0.25)":"rgba(167,139,250,0.06)",
                        border:`1px solid ${isActive?"rgba(167,139,250,0.7)":"rgba(167,139,250,0.2)"}`,
                        borderRadius:20,padding:"6px 14px",color:isActive?"#a78bfa":"rgba(167,139,250,0.7)",
                        fontSize:10,cursor:"pointer",fontFamily:"'Space Mono',monospace",fontWeight:isActive?700:400,transition:"all .15s"}}>
                      {isActive ? `✓ ${label}` : label}
                    </button>
                  );
                })}
              </div>
              <div style={{fontSize:9,color:"rgba(167,139,250,0.5)",fontFamily:"'Space Mono',monospace",marginTop:10}}>
                All browsing is restricted to Everyone-rated games. Manage in Profile → Controls.
              </div>
            </div>
          )}

        </div>

        {/* Search */}
        <div style={{maxWidth:540,margin:"0 auto 14px",padding:"0 16px"}}>
          <Input placeholder="Search 500,000+ games..." value={search}
            onChange={e=>setSearch(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter"){ clearTimeout(debRef.current); setPage(1); fetchGames(e.target.value,filters,sortBy,1); }}}
            style={{padding:"12px 16px",fontSize:12,background:darkMode?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.05)",color:darkMode?"white":"#0f0f1a",border:`1px solid ${darkMode?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.15)"}`}}/>
          <button onClick={handleSurpriseMe} style={{marginTop:10,width:"100%",padding:"11px 0",borderRadius:10,border:"none",background:"linear-gradient(135deg,#f97316,#ec4899)",color:"white",fontWeight:700,fontSize:13,cursor:"pointer",letterSpacing:"0.5px",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
            🎲 Surprise Me
          </button>
        </div>

        {/* Filter Toggle — hidden in Kids Mode */}
        {access && !kidsMode && (
          <div style={{maxWidth:1400,margin:"0 auto 14px",padding:"0 16px"}}>
            <button onClick={()=>setShowFilters(!showFilters)} style={{background:darkMode?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.07)",border:`1px solid ${darkMode?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.2)"}`,borderRadius:11,padding:"9px 16px",color:darkMode?"rgba(255,255,255,0.6)":"#111111",cursor:"pointer",fontSize:11,fontFamily:"'Space Mono',monospace",display:"flex",alignItems:"center",gap:8}}>
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
                  ["📅 ERA",[["all","All Time"],["2020s","2020s"],["2010s","2010s"],["2000s","2000s"],["classic","Classic"]], "year", "#f97316"],
                  ["📊 MIN SCORE",[["any","Any"],["60","Good 60+"],["75","Great 75+"],["85","Outstanding 85+"]], "minScore", "#4ade80"],
                ].map(([label, opts, key, color])=>(
                  <div key={key}>
                    <div style={{fontSize:9,color:darkMode?"rgba(255,255,255,0.3)":"#111111",fontFamily:"'Space Mono',monospace",letterSpacing:1.5,marginBottom:6,fontWeight:700}}>{label}</div>
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
          <div style={{maxWidth:1400,margin:"0 auto 14px",padding:"0 16px"}}>
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
          <div style={{maxWidth:1400,margin:"0 auto 12px",padding:"0 16px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
            <div style={{fontSize:10,color:darkMode?"rgba(255,255,255,0.3)":"#222222",fontFamily:"'Space Mono',monospace",fontWeight:700}}>{total.toLocaleString()} games</div>
            {!kidsMode && (
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
            )}
          </div>
        )}

        {/* Content */}
        <div style={{maxWidth:1400,margin:"0 auto",padding:"0 16px"}}>
          {!hasLoaded && !loading && (
            <div>
              <RecommendationsSection user={user} onGameClick={setSelected} darkMode={darkMode}/>
              <TrendingSection onGameClick={setSelected} darkMode={darkMode}/>
              <div style={{textAlign:"center",padding:"8px 20px 32px"}}>
                <p style={{color:darkMode?"rgba(255,255,255,0.35)":"rgba(0,0,0,0.45)",fontFamily:"'Space Mono',monospace",fontSize:11,marginBottom:16}}>Or browse the full database of 500,000+ games</p>
                <Btn onClick={()=>fetchGames("",filters,"rating",1)} variant="primary" style={{padding:"12px 26px",fontSize:12}}>Browse Top Rated →</Btn>
              </div>
            </div>
          )}

          {loading && (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:13,marginBottom:26}}>
              {[...Array(12)].map((_,i)=>(
                <div key={i} style={{borderRadius:18,overflow:"hidden",background:darkMode?"#0d0d18":"#ffffff",border:`1px solid ${darkMode?"rgba(255,255,255,0.07)":"rgba(0,0,0,0.08)"}`}}>
                  <div className="skeleton" style={{height:3}}/>
                  <div className="skeleton" style={{height:122}}/>
                  <div style={{padding:"11px 13px 13px",display:"flex",flexDirection:"column",gap:8}}>
                    <div className="skeleton" style={{height:14,borderRadius:6,width:"85%"}}/>
                    <div className="skeleton" style={{height:10,borderRadius:6,width:"55%"}}/>
                    <div style={{display:"flex",justifyContent:"space-around",padding:"8px 0"}}>
                      {[0,1,2].map(j=><div key={j} className="skeleton" style={{width:48,height:48,borderRadius:"50%"}}/>)}
                    </div>
                    <div className="skeleton" style={{height:28,borderRadius:8}}/>
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <div style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:12,padding:16,marginBottom:16,color:"#fca5a5",fontFamily:"'Space Mono',monospace",fontSize:11,lineHeight:1.7}}>⚠️ {error}</div>}

          {!loading && games.length>0 && (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:13,marginBottom:26}}>
              {games.map((g,i)=>(
                <div key={g.id} className="card-anim" style={{animationDelay:`${i*.04}s`}}>
                  <GameCard game={g} onClick={setSelected} locked={false} darkMode={darkMode}
                    currentUser={user}
                    inBacklog={(userProfile?.backlog||[]).some(b=>b.id===g.id)}
                    onToggleBacklog={async (game) => {
                      const inBl = (userProfile?.backlog||[]).some(b=>b.id===game.id);
                      const updated = inBl
                        ? await removeFromBacklog(user.email, game.id)
                        : await addToBacklog(user.email, game);
                      setUserProfile(p => ({ ...p, backlog: updated }));
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          {!loading && hasLoaded && games.length===0 && !error && (
            <div style={{textAlign:"center",padding:"48px 24px"}}>
              <div style={{fontSize:40,marginBottom:14}}>🕹️</div>
              <div style={{color:darkMode?"rgba(255,255,255,0.7)":"#222",fontFamily:"'Bitter',serif",fontSize:16,fontWeight:700,marginBottom:8}}>No games found</div>
              <div style={{color:darkMode?"rgba(255,255,255,0.35)":"rgba(0,0,0,0.45)",fontFamily:"'Space Mono',monospace",fontSize:11,lineHeight:1.8,maxWidth:260,margin:"0 auto"}}>Try a different search, adjust your filters, or hit <strong style={{color:"#a78bfa"}}>Surprise Me</strong> to discover something great.</div>
            </div>
          )}

          {hasLoaded && !loading && total>40 && (
            <div style={{display:"flex",justifyContent:"center",gap:6,alignItems:"center",paddingBottom:36,flexWrap:"wrap"}}>
              <Btn onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1} variant="ghost" style={{padding:"7px 14px",fontSize:11,borderRadius:10,opacity:page===1?.3:1}}>← Prev</Btn>
              {(() => {
                const totalPages = Math.min(Math.ceil(total/40), 500);
                const pages = [];
                const addPage = (p) => pages.push(
                  <button key={p} onClick={()=>setPage(p)}
                    style={{width:32,height:32,borderRadius:8,border:`1px solid ${p===page?"rgba(167,139,250,0.6)":darkMode?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.15)"}`,
                      background:p===page?"rgba(167,139,250,0.18)":"transparent",
                      color:p===page?"#a78bfa":darkMode?"rgba(255,255,255,0.45)":"rgba(0,0,0,0.5)",
                      fontSize:11,fontFamily:"'Space Mono',monospace",fontWeight:p===page?700:400,cursor:"pointer",transition:"all .15s"}}>
                    {p}
                  </button>
                );
                if (totalPages <= 7) {
                  for (let p=1; p<=totalPages; p++) addPage(p);
                } else {
                  addPage(1);
                  if (page > 3) pages.push(<span key="e1" style={{color:"rgba(255,255,255,0.2)",fontSize:11,padding:"0 2px"}}>…</span>);
                  for (let p=Math.max(2,page-1); p<=Math.min(totalPages-1,page+1); p++) addPage(p);
                  if (page < totalPages-2) pages.push(<span key="e2" style={{color:"rgba(255,255,255,0.2)",fontSize:11,padding:"0 2px"}}>…</span>);
                  addPage(totalPages);
                }
                return pages;
              })()}
              <Btn onClick={()=>setPage(p=>Math.min(p+1,Math.min(Math.ceil(total/40),500)))} disabled={page>=Math.min(Math.ceil(total/40),500)} variant="ghost" style={{padding:"7px 14px",fontSize:11,borderRadius:10,opacity:page>=Math.min(Math.ceil(total/40),500)?.3:1}}>Next →</Btn>
            </div>
          )}
        </div></>}

        {activeView === "discover" && <div style={{textAlign:"center",paddingBottom:26,display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
          <button onClick={()=>setShowFAQ(true)}
            style={{background:"none",border:"1px solid rgba(255,255,255,0.1)",borderRadius:20,padding:"6px 16px",color:darkMode?"rgba(255,255,255,0.3)":"rgba(0,0,0,0.35)",fontSize:10,cursor:"pointer",fontFamily:"'Space Mono',monospace",transition:"all .2s"}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(167,139,250,0.4)";e.currentTarget.style.color="#a78bfa";}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(255,255,255,0.1)";e.currentTarget.style.color=darkMode?"rgba(255,255,255,0.3)":"rgba(0,0,0,0.35)";}}>
            ❓ FAQ & About
          </button>
          <div style={{display:"flex",gap:14,alignItems:"center"}}>
            {[["Privacy Policy",()=>setShowPrivacy(true)],["Terms of Service",()=>setShowTerms(true)]].map(([label,fn])=>(
              <button key={label} onClick={fn} style={{background:"none",border:"none",color:darkMode?"rgba(255,255,255,0.2)":"rgba(0,0,0,0.3)",fontSize:9,cursor:"pointer",fontFamily:"'Space Mono',monospace",padding:0,transition:"color .2s",letterSpacing:0.5}}
                onMouseEnter={e=>e.currentTarget.style.color="#a78bfa"}
                onMouseLeave={e=>e.currentTarget.style.color=darkMode?"rgba(255,255,255,0.2)":"rgba(0,0,0,0.3)"}>
                {label}
              </button>
            ))}
          </div>
          <div style={{color:darkMode?"rgba(255,255,255,0.12)":"rgba(0,0,0,0.25)",fontSize:9,letterSpacing:2,fontFamily:"'Space Mono',monospace"}}>
            WORTH MY TIME · RAWG.IO · HLTB · YOUR SCORES
          </div>
        </div>}
      </div>

      {/* Modals */}
      {status==="expired" && !showPaywall && <LockedOverlay onUpgrade={()=>setShowPaywall(true)}/>}
      {showPaywall && <PaywallModal user={user} onClose={()=>setShowPaywall(false)} onSuccess={handlePaid}/>}
      <GameModal game={selected} onClose={()=>setSelected(null)} currentUser={user} darkMode={darkMode}/>
      {showEditProfile && user && <EditProfileModal user={user} onClose={()=>setShowEditProfile(false)} onSave={p=>setUserProfile(p)}/>}
      {viewProfile && user && <UserProfilePage profileEmail={viewProfile} currentUser={user} onClose={()=>setViewProfile(null)} onEditProfile={()=>{setViewProfile(null);setShowEditProfile(true);}} onOpenMessages={(email)=>{ setViewProfile(null); setMessagesRecipient(email); setShowMessages(true); }}/>}
      {showMessages && user && <MessagesModal currentUser={user} initialRecipient={messagesRecipient} onClose={()=>{ setShowMessages(false); setMessagesRecipient(null); }}/>}
      {showFAQ && <FAQModal onClose={()=>setShowFAQ(false)} darkMode={darkMode}/>}
      {showPrivacy && <PrivacyModal onClose={()=>setShowPrivacy(false)}/>}
      {showTerms && <TermsModal onClose={()=>setShowTerms(false)}/>}
      {showPinModal && <ParentalPinModal darkMode={darkMode}
        mode={parentPinSet() ? "verify" : "set"}
        onCancel={()=>{ setShowPinModal(false); setPendingPinAction(null); }}
        onSuccess={()=>{
          setShowPinModal(false);
          if (pendingPinAction === "enter_mode") {
            setParentalModeActive(true);
          } else if (pendingPinAction === "exit_mode") {
            setParentalModeActive(false);
            setActiveParentFilter(null);
            setPage(1);
            fetchGames(search, filters, sortBy, 1);
          }
          setPendingPinAction(null);
        }}/>}
      {showAgeGate && <AgeGateModal darkMode={darkMode}
        onConfirm={()=>{ localStorage.setItem("wmt_age_verified","1"); setAgeVerified(true); setShowAgeGate(false); setTimeout(()=>fetchGames(search,filters,sortBy,1),50); }}
        onDeny={()=>setShowAgeGate(false)}/>}
    </>
  );
}
