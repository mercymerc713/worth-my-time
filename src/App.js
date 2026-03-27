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
const store = {
  async get(key) {
    try {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : null;
    } catch { return null; }
  },
  async set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  },
  async del(key) {
    try { localStorage.removeItem(key); } catch {}
  },
};

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
  const n = encodeURIComponent(game.name||"");
  return [
    { name:"Steam",     url:`https://store.steampowered.com/search/?term=${n}`,      icon:"🖥" },
    { name:"Epic",      url:`https://store.epicgames.com/en-US/browse?q=${n}`,       icon:"⚡" },
    { name:"GOG",       url:`https://www.gog.com/games?search=${n}`,                 icon:"🌍" },
    { name:"PSN",       url:`https://store.playstation.com/en-us/search/${n}`,       icon:"🎮" },
    { name:"Xbox",      url:`https://www.xbox.com/en-US/Search/Results?q=${n}`,      icon:"⬜" },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// SMALL UI ATOMS
// ─────────────────────────────────────────────────────────────────────────────
const SCORE_TIPS = {
  "Time":           "How easy is this game to play in short sessions? Higher = more busy-people friendly.",
  "Adventure":      "Story depth, world exploration and overall experience. Higher = richer adventure.",
  "Worth It":       "Is this game worth your limited free time? Based on ratings and player reviews.",
  "Time Friendly":  "How easy is this game to play in short sessions? Higher = more busy-people friendly.",
};

function ScoreRing({ value, color, label, size=64 }) {
  const [showTip, setShowTip] = useState(false);
  const r=size*.38, c=2*Math.PI*r, off=c-(Math.min(value,99)/100)*c, cx=size/2, cy=size/2;
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,cursor:"help",position:"relative"}}
      onMouseEnter={()=>setShowTip(true)} onMouseLeave={()=>setShowTip(false)}>
      {showTip && SCORE_TIPS[label] && (
        <div style={{position:"absolute",bottom:"calc(100% + 6px)",left:"50%",transform:"translateX(-50%)",
          background:"#1a1a2e",border:"1px solid rgba(255,255,255,0.15)",borderRadius:8,
          padding:"6px 10px",fontSize:10,color:"rgba(255,255,255,0.85)",fontFamily:"'Space Mono',monospace",
          whiteSpace:"nowrap",zIndex:999,boxShadow:"0 4px 20px rgba(0,0,0,0.5)",
          maxWidth:180,whiteSpace:"normal",textAlign:"center",lineHeight:1.5}}>
          {SCORE_TIPS[label]}
        </div>
      )}
      <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={5}/>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={5}
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          style={{transition:"stroke-dashoffset .9s cubic-bezier(.4,0,.2,1)"}}/>
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill="white"
          fontSize={size*.2} fontWeight="700"
          style={{transform:`rotate(90deg)`,transformOrigin:`${cx}px ${cy}px`,fontFamily:"'Space Mono',monospace"}}>
          {value}
        </text>
      </svg>
      <span style={{fontSize:9,color:"rgba(255,255,255,0.35)",letterSpacing:1.2,textTransform:"uppercase",fontFamily:"'Space Mono',monospace"}}>{label} ⓘ</span>
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
    const account = await store.get(`wmt_account_${emailKey}`);
    if (!account) { setErr("No account found with this email."); return; }
    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    // Store code with 15min expiry
    await store.set(`wmt_reset_${emailKey}`, { code, expiresAt: Date.now() + 15 * 60 * 1000 });
    // Send email via EmailJS
    try {
      await fetch("https://api.emailjs.com/api/v1.0/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id: "YOUR_EMAILJS_SERVICE_ID",
          template_id: "YOUR_EMAILJS_TEMPLATE_ID",
          user_id: "YOUR_EMAILJS_PUBLIC_KEY",
          template_params: {
            to_email: email,
            to_name: account.name,
            reset_code: code,
            app_name: "Worth My Time",
          }
        })
      });
      setSuccess(`A reset code has been sent to ${email}. Check your inbox.`);
      setResetStep(2);
    } catch {
      // If EmailJS not configured, show code directly for testing
      setSuccess(`Your reset code is: ${code} (valid for 15 minutes)`);
      setResetStep(2);
    }
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
    const account = await store.get(`wmt_account_${emailKey}`);
    if (!account) { setErr("Account not found."); return; }
    // Update password
    await store.set(`wmt_account_${emailKey}`, { ...account, passwordHash: btoa(newPass) });
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

    // Email validation
    if (!email) { setErr("Email address is required."); return; }
    if (!validateEmail(email)) { setErr("Please enter a valid email address."); return; }

    if (mode === "signup") {
      // Step 1 — validate form and send verification code
      if (verifyStep === 1) {
        if (!name.trim()) { setErr("Your name is required."); return; }
        if (!validatePassword(pass)) { setErr("Password must be at least 8 characters."); return; }

        // Check if account already exists
        const emailKey = email.toLowerCase().trim();
        const existing = await store.get(`wmt_account_${emailKey}`);
        if (existing) { setErr("An account with this email already exists. Please sign in."); return; }

        // Generate 6-digit verification code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        await store.set(`wmt_verify_${emailKey}`, { code, expiresAt: Date.now() + 15 * 60 * 1000 });

        // Save pending user data
        const user = createUser(name.trim(), emailKey);
        setPendingUser({ user, emailKey, passwordHash: btoa(pass) });
        setVerifyCode(code); // show on screen since EmailJS not configured yet
        setSuccess(`Verification code sent! Your code is: ${code}`);
        setVerifyStep(2);
        return;
      }

      // Step 2 — verify the code and create account
      if (verifyStep === 2) {
        const emailKey = email.toLowerCase().trim();
        const stored = await store.get(`wmt_verify_${emailKey}`);
        if (!stored) { setErr("Verification code expired. Please start over."); setVerifyStep(1); return; }
        if (Date.now() > stored.expiresAt) { setErr("Code expired. Please start over."); await store.del(`wmt_verify_${emailKey}`); setVerifyStep(1); return; }
        if (enteredVerifyCode.trim() !== stored.code) { setErr("Incorrect code. Please try again."); return; }

        // Code verified — create account
        if (!pendingUser) { setErr("Session expired. Please start over."); setVerifyStep(1); return; }
        await store.set(`wmt_account_${emailKey}`, { name: pendingUser.user.name, email: emailKey, passwordHash: pendingUser.passwordHash });
        await store.set(`wmt_profile_${emailKey}`, pendingUser.user);
        await store.del(`wmt_verify_${emailKey}`);
        setVerifyStep(1);
        setEnteredVerifyCode("");
        setPendingUser(null);
        setSuccess("");
        onLogin(pendingUser.user);
        return;
      }

    } else {
      // Sign in validation
      if (!pass) { setErr("Password is required."); return; }

      // Check account exists
      const emailKey = email.toLowerCase().trim();
      const account = await store.get(`wmt_account_${emailKey}`);
      if (!account) { setErr("No account found with this email. Please create an account."); return; }

      // Check password
      if (btoa(pass) !== account.passwordHash) { setErr("Incorrect password. Please try again."); return; }

      // Always load the saved user profile so trial dates and paid status are preserved
      const savedUser = await store.get(`wmt_profile_${emailKey}`);
      if (savedUser) {
        onLogin(savedUser);
      } else {
        // Fallback — create fresh session (first time signing in after account creation)
        const user = createUser(account.name, account.email);
        await store.set(`wmt_profile_${emailKey}`, user);
        onLogin(user);
      }
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
function GameCard({ game, onClick, locked }) {
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
        background:"#0d0d18",filter:locked?"blur(2px) brightness(0.5)":"none"}}>
      <div style={{position:"relative",height:125,overflow:"hidden",background:"#1a1a2e"}}>
        {game.background_image
          ? <img src={game.background_image} alt={game.name} style={{width:"100%",height:"100%",objectFit:"cover",opacity:.8,transition:"transform .4s",transform:hov?"scale(1.05)":"scale(1)"}}/>
          : <div style={{width:"100%",height:"100%",background:`linear-gradient(135deg,${color}30,#0d0d18)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:34}}>🎮</div>}
        <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,#0d0d18 0%,transparent 60%)"}}/>
        <div style={{position:"absolute",top:8,left:8,background:"rgba(0,0,0,0.75)",backdropFilter:"blur(8px)",borderRadius:20,padding:"2px 8px",fontSize:9,color,fontFamily:"'Space Mono',monospace",border:`1px solid ${color}40`}}>{catLbl}</div>
        {game.metacritic && <div style={{position:"absolute",top:8,right:8,background:game.metacritic>74?"#16a34a":game.metacritic>59?"#ca8a04":"#dc2626",borderRadius:7,padding:"2px 7px",fontSize:10,color:"white",fontWeight:700,fontFamily:"'Space Mono',monospace"}}>MC {game.metacritic}</div>}
      </div>
      <div style={{padding:"11px 13px 13px"}}>
        <h3 style={{margin:"0 0 3px",fontSize:14,fontFamily:"'Bitter',serif",fontWeight:700,color:"white",lineHeight:1.2,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{game.name}</h3>
        <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",fontFamily:"'Space Mono',monospace",marginBottom:7}}>
          {(game.genres||[]).slice(0,2).map(g=>g.name).join(" · ")}
        </div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:8}}>
          <Chip label={scores.difficulty} color={scores.difficulty==="Relaxed"?"#4ade80":scores.difficulty==="Challenging"?"#f87171":"#fbbf24"}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-around",margin:"8px 0",padding:"8px 0",borderTop:"1px solid rgba(255,255,255,0.05)",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
          <ScoreRing value={scores.t} label="Time"      color={color}/>
          <ScoreRing value={scores.a} label="Adventure" color={color}/>
          <ScoreRing value={scores.w} label="Worth It"  color={color}/>
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
function GameModal({ game, onClose }) {
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
            {[["⏱ Session",scores.hltb.session],["📖 Story",scores.hltb.main],["🏆 100%",scores.hltb.complete],["🎯 Difficulty",scores.difficulty],["⭐ Rating",game.rating?`${game.rating}/5`:"N/A"],["📊 Metacritic",game.metacritic||"N/A"],["🔞 Age",scores.esrb],["📅 Released",game.released||"N/A"]].map(([k,v])=>(
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
          <div>
            <div style={{fontSize:9,color:"rgba(255,255,255,0.28)",fontFamily:"'Space Mono',monospace",letterSpacing:1.5,marginBottom:7}}>BUY / FIND THIS GAME</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {stores.map(s=>(
                <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer"
                  style={{background:`${color}12`,border:`1px solid ${color}35`,borderRadius:10,padding:"8px 12px",textAlign:"center",color:"white",textDecoration:"none",fontSize:11,fontFamily:"'Space Mono',monospace",flex:"1 0 auto",transition:"background .2s"}}
                  onMouseEnter={e=>e.currentTarget.style.background=`${color}28`}
                  onMouseLeave={e=>e.currentTarget.style.background=`${color}12`}>
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
const SORT_MAP     = {rating:"-rating",metacritic:"-metacritic",newest:"-released",popular:"-added"};

export default function App() {
  const [user, setUser]       = useState(null);
  const [appReady, setAppReady] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [games, setGames]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [search, setSearch]   = useState("");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sortBy, setSortBy]   = useState("rating");
  const [selected, setSelected] = useState(null);
  const [page, setPage]       = useState(1);
  const [total, setTotal]     = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [minutes, setMinutes] = useState("");
  const [showPaywall, setShowPaywall] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const debRef = useRef(null);

  // Load user from storage
  useEffect(() => {
    store.get("wmt_user").then(u => { if (u) setUser(u); setAppReady(true); });
  }, []);

  const status = getAccountStatus(user);
  const access = hasFullAccess(user);

  const handleLogin = async (u) => { await store.set("wmt_user", u); setUser(u); };
  const handleLogout = async () => { await store.del("wmt_user"); setUser(null); setGames([]); setHasLoaded(false); };
  const handlePaid = async () => {
    const updated = { ...user, isPaid:true, paidAt:Date.now() };
    await store.set("wmt_user", updated);
    // Also update persistent profile so paid status survives logout/login
    await store.set(`wmt_profile_${user.email}`, updated);
    setUser(updated);
    setShowPaywall(false);
  };

  const fetchGames = useCallback(async (q, f, sort, pg) => {
    setLoading(true); setError("");
    try {
      const p = new URLSearchParams({ key:RAWG_KEY, page_size:20, page:pg, ordering:SORT_MAP[sort]||"-rating" });
      if (q) {
        p.set("search", q);
        p.set("search_exact", "false");
        p.set("search_precise", "true");
      }
      if (f.platform!=="all" && PLATFORM_MAP[f.platform]) p.set("platforms", PLATFORM_MAP[f.platform]);
      const gs=[];
      if (f.time==="short") gs.push("puzzle,arcade,card-games,fighting,racing,sports");
      if (f.time==="long")  gs.push("role-playing-games-rpg,strategy,simulation");
      if (f.genre!=="all" && GENRE_MAP[f.genre]) gs.push(GENRE_MAP[f.genre]);
      if (gs.length) p.set("genres", gs.join(","));
      if (f.multiplayer==="singleplayer") p.set("tags","singleplayer");
      if (f.multiplayer==="multiplayer")  p.set("tags","multiplayer");
      if (f.multiplayer==="co-op")        p.set("tags","co-op");
      const res = await fetch(`${RAWG_BASE}/games?${p}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      let results = data.results||[];
      // Put exact/closest title matches first when searching
      if (q) {
        const ql = q.toLowerCase().trim();
        results = [...results].sort((a, b) => {
          const an = (a.name||"").toLowerCase();
          const bn = (b.name||"").toLowerCase();
          const aExact = an === ql;
          const bExact = bn === ql;
          const aStarts = an.startsWith(ql);
          const bStarts = bn.startsWith(ql);
          if (aExact && !bExact) return -1;
          if (!aExact && bExact) return 1;
          if (aStarts && !bStarts) return -1;
          if (!aStarts && bStarts) return 1;
          return 0;
        });
      }
      if (f.difficulty!=="all") results=results.filter(g=>{ const d=difficultyOf(g.genres||[]); return f.difficulty==="easy"?d==="Relaxed":f.difficulty==="hard"?d==="Challenging":d==="Medium"; });
      setGames(results); setTotal(data.count||0); setHasLoaded(true);
    } catch { setError("Couldn't reach the game database. Check your RAWG API key."); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user || !access) return;
    if (!hasLoaded && !search) return;
    clearTimeout(debRef.current);
    debRef.current = setTimeout(()=>{ setPage(1); fetchGames(search,filters,sortBy,1); }, 400);
  }, [search, filters, sortBy, user]);

  useEffect(() => { if (hasLoaded && user && access) fetchGames(search,filters,sortBy,page); }, [page]);

  const handleTimeSearch = () => {
    const m = parseInt(minutes); if (!m) return;
    // Map minutes to specific genre slugs that match real session times
    let timeGenres = "";
    let timeLabel = "";
    if (m <= 20) {
      timeGenres = "arcade,card-games,puzzle";
      timeLabel = "Under 20 min";
    } else if (m <= 40) {
      timeGenres = "puzzle,arcade,fighting,racing,sports,card-games";
      timeLabel = "20–40 min";
    } else if (m <= 60) {
      timeGenres = "platformer,indie,fighting,puzzle,shooter,sports,racing";
      timeLabel = "40–60 min";
    } else if (m <= 90) {
      timeGenres = "action,indie,platformer,shooter,adventure";
      timeLabel = "60–90 min";
    } else if (m <= 120) {
      timeGenres = "action,adventure,shooter,indie";
      timeLabel = "1–2 hours";
    } else {
      timeGenres = "role-playing-games-rpg,strategy,simulation,adventure";
      timeLabel = "2+ hours";
    }
    const cat = m <= 40 ? "short" : m <= 100 ? "medium" : "long";
    const nf = { ...filters, time: cat };
    setFilters(nf);
    setPage(1);
    // Fetch with exact genres + newest first (2026 down)
    fetchGamesWithTime(timeGenres, nf, m);
  };

  const fetchGamesWithTime = useCallback(async (timeGenres, f, minutes) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({
        key: RAWG_KEY,
        page_size: 20,
        page: 1,
        ordering: "-released", // newest first — 2026 going down
        genres: timeGenres,
      });
      if (f.platform !== "all" && PLATFORM_MAP[f.platform]) params.set("platforms", PLATFORM_MAP[f.platform]);
      const res = await fetch(`${RAWG_BASE}/games?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      let results = data.results || [];
      // Sort by release date descending (2026 first)
      results = results.sort((a, b) => {
        const da = new Date(a.released || "2000-01-01");
        const db = new Date(b.released || "2000-01-01");
        return db - da;
      });
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
              <Input placeholder="e.g. 45" type="number" value={minutes} onChange={e=>setMinutes(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleTimeSearch()} style={{padding:"10px 12px",fontSize:12}}/>
              <Btn onClick={handleTimeSearch} variant="primary" style={{whiteSpace:"nowrap",padding:"10px 16px",fontSize:11,borderRadius:9}}>Find Games →</Btn>
            </div>
          </div>
        </div>

        {/* Search */}
        <div style={{maxWidth:540,margin:"0 auto 14px",padding:"0 16px"}}>
          <Input placeholder="Search 500,000+ games..." value={search} onChange={e=>setSearch(e.target.value)} style={{padding:"12px 16px",fontSize:12,background:darkMode?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.05)",color:darkMode?"white":"#0f0f1a",border:`1px solid ${darkMode?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.15)"}`}}/>
        </div>

        {/* Filter Toggle */}
        {access && (
          <div style={{maxWidth:900,margin:"0 auto 14px",padding:"0 16px"}}>
            <button onClick={()=>setShowFilters(!showFilters)} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:11,padding:"9px 16px",color:"rgba(255,255,255,0.6)",cursor:"pointer",fontSize:11,fontFamily:"'Space Mono',monospace",display:"flex",alignItems:"center",gap:8}}>
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
                    <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",fontFamily:"'Space Mono',monospace",letterSpacing:1.5,marginBottom:6}}>{label}</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {opts.map(([v,l])=>{
                        const active=filters[key]===v;
                        return <button key={v} onClick={()=>setFilters(f=>({...f,[key]:v}))} style={{background:active?(color==="white"?"white":color+"25"):"rgba(255,255,255,0.05)",color:active?(color==="white"?"#080810":color):"rgba(255,255,255,0.45)",border:`1px solid ${active?(color==="white"?"white":color+"70"):"rgba(255,255,255,0.1)"}`,borderRadius:100,padding:"5px 12px",cursor:"pointer",fontSize:10,fontFamily:"'Space Mono',monospace",transition:"all .2s",fontWeight:active?700:400}}>{l}</button>;
                      })}
                    </div>
                  </div>
                ))}
                <button onClick={()=>{setFilters(DEFAULT_FILTERS);setPage(1);}} style={{alignSelf:"flex-start",background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:9,padding:"6px 13px",color:"#f87171",fontSize:10,cursor:"pointer",fontFamily:"'Space Mono',monospace"}}>✕ Clear filters</button>
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
                <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:"'Space Mono',monospace"}}>Genre, difficulty, multiplayer, price filters + unlimited searches</div>
              </div>
              <span style={{fontSize:11,color:"#f59e0b",fontFamily:"'Space Mono',monospace",whiteSpace:"nowrap"}}>Unlock →</span>
            </div>
          </div>
        )}

        {/* Sort & count */}
        {hasLoaded && (
          <div style={{maxWidth:900,margin:"0 auto 12px",padding:"0 16px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",fontFamily:"'Space Mono',monospace"}}>{total.toLocaleString()} games</div>
            <div style={{display:"flex",gap:5}}>
              {[["rating","Top Rated"],["metacritic","Metacritic"],["newest","Newest"],["popular","Popular"]].map(([v,l])=>(
                <button key={v} onClick={()=>{setSortBy(v);setPage(1);}} style={{background:sortBy===v?"rgba(167,139,250,0.2)":"transparent",color:sortBy===v?"#a78bfa":"rgba(255,255,255,0.3)",border:`1px solid ${sortBy===v?"#a78bfa50":"rgba(255,255,255,0.07)"}`,borderRadius:7,padding:"4px 9px",cursor:"pointer",fontSize:10,fontFamily:"'Space Mono',monospace",transition:"all .2s"}}>{l}</button>
              ))}
            </div>
          </div>
        )}

        {/* Content */}
        <div style={{maxWidth:900,margin:"0 auto",padding:"0 16px"}}>
          {!hasLoaded && !loading && (
            <div style={{textAlign:"center",padding:"48px 20px"}}>
              <div style={{fontSize:42,marginBottom:12}}>🎮</div>
              <h2 style={{color:"white",fontFamily:"'Bitter',serif",margin:"0 0 8px"}}>500,000+ Games Ready</h2>
              <p style={{color:"rgba(255,255,255,0.4)",fontFamily:"'Space Mono',monospace",fontSize:11,marginBottom:22}}>Search or browse the full database</p>
              <Btn onClick={()=>fetchGames("",filters,"rating",1)} variant="primary" style={{padding:"12px 26px",fontSize:12}}>Browse Top Rated →</Btn>
            </div>
          )}

          {loading && (
            <div style={{textAlign:"center",padding:"48px 20px"}}>
              <div style={{display:"inline-flex",gap:6}}>
                {[0,1,2].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:"#a78bfa",animation:"pulse 1.2s ease infinite",animationDelay:`${i*.2}s`}}/>)}
              </div>
              <div style={{color:"rgba(255,255,255,0.3)",fontFamily:"'Space Mono',monospace",fontSize:11,marginTop:10}}>Searching the database...</div>
            </div>
          )}

          {error && <div style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:12,padding:16,marginBottom:16,color:"#fca5a5",fontFamily:"'Space Mono',monospace",fontSize:11,lineHeight:1.7}}>⚠️ {error}</div>}

          {!loading && games.length>0 && (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:13,marginBottom:26}}>
              {games.map((g,i)=>(
                <div key={g.id} className="card-anim" style={{animationDelay:`${i*.04}s`}}>
                  <GameCard game={g} onClick={setSelected} locked={false}/>
                </div>
              ))}
            </div>
          )}

          {!loading && hasLoaded && games.length===0 && !error && (
            <div style={{textAlign:"center",padding:36,color:"rgba(255,255,255,0.3)",fontFamily:"'Space Mono',monospace",fontSize:11}}>No games found. Try adjusting your filters.</div>
          )}

          {hasLoaded && !loading && total>20 && (
            <div style={{display:"flex",justifyContent:"center",gap:10,alignItems:"center",paddingBottom:36}}>
              <Btn onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1} variant="ghost" style={{padding:"7px 13px",fontSize:11,borderRadius:8,opacity:page===1?.3:1}}>← Prev</Btn>
              <span style={{color:"rgba(255,255,255,0.3)",fontSize:11,fontFamily:"'Space Mono',monospace"}}>Page {page} of {Math.min(Math.ceil(total/20),500)}</span>
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
      <GameModal game={selected} onClose={()=>setSelected(null)}/>
    </>
  );
}
