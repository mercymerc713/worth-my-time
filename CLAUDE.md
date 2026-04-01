# Worth My Time? — Project Memory

## Project Overview
**Worth My Time?** is a game discovery platform for busy people. It scores 500,000+ games using Time, Adventure, and Worth It metrics powered by the RAWG API. Built as a React 18 SPA deployed on Vercel, with Supabase backend and Stripe payments.

- **Live URL:** https://worthmytime.info
- **Repo:** mercymerc713/worth-my-time
- **Branch:** `claude/review-website-l5rSR` (feature branch, merges into `main`)
- **Deploy:** Vercel auto-deploys from `main` branch
- **Price:** $7.99 one-time (3-day free trial first)

---

## Architecture

### Stack
- **Frontend:** React 18 SPA — single file `src/App.js` (~3650 lines)
- **Backend:** Vercel serverless functions in `/api/`
- **Database:** Supabase (PostgreSQL + REST API)
- **Payments:** Stripe Checkout (live mode)
- **Game Data:** RAWG API (500k+ games)
- **Hosting:** Vercel (auto-deploy from `main`)

### Key Files
| File | Purpose |
|---|---|
| `src/App.js` | Entire frontend — all components, state, API calls |
| `public/index.html` | PWA meta tags, service worker registration, OG tags |
| `public/manifest.json` | PWA manifest for installable app / Play Store TWA |
| `public/sw.js` | Service worker — shell caching, offline fallback |
| `public/icon-192.png` | 192px PWA icon |
| `public/icon-512.png` | 512px PWA icon (also used as og:image) |
| `public/apple-touch-icon.png` | 180px Apple touch icon |
| `public/favicon-32.png` | 32px favicon |
| `public/robots.txt` | SEO crawler config |
| `public/sitemap.xml` | Sitemap for Google |
| `public/.well-known/assetlinks.json` | Play Store TWA placeholder (needs real SHA-256) |
| `api/verify-payment.js` | POST endpoint — checks Stripe for payment by email, updates Supabase |
| `api/stripe-webhook.js` | Stripe webhook handler — marks users paid on `checkout.session.completed` |
| `api/send-code.js` | Email verification code sender |
| `api/opencritic.js` | OpenCritic score proxy |
| `api/prices.js` | Game price aggregator proxy |
| `api/protondb.js` | ProtonDB (Steam Deck) compatibility proxy |
| `api/steam.js` | Steam data proxy |
| `vercel.json` | SPA rewrites — all non-API routes → index.html |

### Environment Variables (Vercel) — ALL CONFIGURED ✅
- `STRIPE_SECRET_KEY` — Stripe secret key for verify-payment
- `STRIPE_WEBHOOK_SECRET` — `whsec_Uw7DZxyNFhxnP3C6FQNa5qhU...` (set Mar 28)
- `SUPABASE_URL` — `https://bibpoybwclvifqmouxsf.supabase.co`
- `SUPABASE_SERVICE_KEY` — Supabase service role key
- `ITAD_KEY` — IsThereAnyDeal API key
- `APP_ORIGIN` — App origin for CORS

### Constants in App.js
- `RAWG_KEY` — line 7
- `RAWG_BASE` — line 8: `https://api.rawg.io/api`
- `PRICE` — "$7.99" (line 10)
- `STRIPE_PK` — Stripe publishable key (line 11)
- `STRIPE_PAYMENT_LINK` — Stripe hosted checkout link (line 12)
- `SUPABASE_URL` / `SUPABASE_KEY` — anon key (lines 27-28)
- `PARENT_PIN_KEY` — "wmt_parent_pin" — localStorage key for hashed parental PIN
- `KIDS_MODE_KEY` — "wmt_kids_mode" — localStorage key for kids mode toggle

---

## Supabase Database Schema

### `accounts` table
- `email` (text, unique) — user email
- `is_paid` (boolean) — payment status
- `paid_at` (bigint) — payment timestamp
- `trial_start` (bigint) — trial start timestamp
- Standard created_at/updated_at

### `profiles` table
```sql
create table profiles (
  id uuid default gen_random_uuid() primary key,
  user_email text unique not null,
  gamer_tag text unique,
  bio text,
  status text,
  avatar_color text default '#a78bfa',
  avatar_emoji text default '🎮',
  avatar_url text,
  banner_url text,
  showcase_games jsonb default '[]',
  backlog jsonb default '[]',
  favorite_games jsonb default '[]',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
```
- RLS: open read/insert/update for anon
- Upsert uses `?on_conflict=user_email` with `Prefer: resolution=merge-duplicates`

### `reviews` table
- `user_email`, `game_id`, `game_name`, `rating` (1-5), `review_text`, `time_spent`, `created_at`

### `follows` table
- `follower_email`, `following_email` (unique pair)

### Storage
- `avatars` bucket — user-uploaded avatar and banner images

---

## Feature Map

### Core Features (✅ Complete & Live)
- **Game Search & Discovery** — search 500k+ games, filter by genre/platform/era/difficulty/time/score
- **Time/Adventure/Worth It Scores** — computed from RAWG data + HLTB estimates
- **Game Modal** — detailed view with Metacritic, OpenCritic, Steam Deck, price comparison
- **Surprise Me** — random high-rated game discovery (E/E10+ only in Kids Mode)
- **Reviews** — star ratings + text reviews, stored in Supabase
- **User Profiles** — gamer tag, bio, status, custom avatar/banner, achievements
- **Showcase** — pin up to 6 favorite games (Edit Profile → 📌 Showcase tab), displays with art grid on profile
- **Backlog** — "📚 + Backlog" button on every game card, toggles on/off, saved to Supabase, visible in Backlog tab with art thumbnails + remove button
- **Social** — follow/unfollow users, follower counts, community feed
- **Share Profile** — copy profile link, shows "✓ Copied!" for 2s, clipboard fallback
- **Achievements** — auto-earned badges (First Review, Critic, Curator, Collector, etc.)
- **Dark/Light Mode** — toggle in UI
- **Age Gate** — 18+ confirmation modal before showing adult content

### Parental Controls (✅ Complete & Live)
- **Kids Mode** — toggle in Edit Profile → 🔒 Controls tab
- **PIN Protected** — 4-digit PIN (SHA-256 hashed with salt `wmt-salt-2026`, stored in localStorage)
- **ESRB Filtering** — Kids Mode restricts ALL browsing to E (Everyone) and E10+ only
  - API param: `esrb_ratings=1,2`
  - Client-side double-check: `g.esrb_rating?.id > 2` blocked
  - Blocked genres: adult, eroge, hentai, pinup, nude
  - Blocked title words list for extra safety
- **Parent Filter Buttons** — quick-access kid-friendly category buttons
- **Surprise Me** — restricted to E/E10+ when Kids Mode is on (API + client-side)
- **Pagination** — ESRB enforcement preserved on page 2+ via `activeParentFilter` state

### Payments (✅ Complete & Live)
- **3-day free trial** — auto-starts on signup
- **One-time $7.99** — Stripe Checkout (hosted link)
- **Payment Verification** — `/api/verify-payment` checks Stripe API directly as fallback
- **Stripe Webhook** — `captivating-splendor` endpoint active at `https://worthmytime.info/api/stripe-webhook`, listens for `checkout.session.completed`, `STRIPE_WEBHOOK_SECRET` set in Vercel ✅

### PWA (✅ Complete & Live)
- `manifest.json` — name, icons, display:standalone, categories
- `sw.js` — service worker with shell caching, network-first for API calls
- Icons — 32px favicon, 180px apple-touch, 192px, 512px PNGs
- `index.html` — manifest link, apple-mobile tags, SW registration, og:image/twitter:image
- `robots.txt` + `sitemap.xml` — SEO
- `.well-known/assetlinks.json` — placeholder for Play Store TWA (needs real SHA-256)
- App is now **installable** on Android/iOS from browser

---

## Technical Patterns

### State Management
- All state in single `App()` component via `useState`
- `useRef` mirror pattern for `kidsModeRef` and `ageVerifiedRef` to avoid stale closures in `useCallback`
- `window.dispatchEvent(new Event("wmt_kids_mode_change"))` for cross-component sync between `KidsModeSettings` and main App
- `localStorage` for persistent client-side state: age verification, parental PIN, kids mode

### Supabase Helpers (App.js lines ~44-500)
- `sbFetch(path, options)` — wrapper with auth headers
- `sbGetAccount(email)` / `sbCreateAccount(email)` / `sbUpdateAccount(email, updates)`
- `getProfile(email)` / `upsertProfile(profile)` / `getProfileByTag(tag)`
- `addToBacklog(email, game)` / `removeFromBacklog(email, gameId)`
- `saveShowcase(email, games)`
- `getUserReviews(email)` / `getFollowers(email)` / `getFollowing(email)`
- `followUser()` / `unfollowUser()`

### Key Components (all in App.js)
- `AuthScreen` — email + verification code login
- `StatusBar` — top bar with user info, upgrade button
- `PaywallModal` — trial/payment flow with Stripe checkout + verify
- `AgeGateModal` — 18+ age confirmation
- `ParentalPinModal` — 4-digit PIN set/verify with numpad UI
- `KidsModeSettings` — toggle + instructions (rendered in EditProfileModal Controls tab)
- `EditProfileModal` — tabs: Identity, Appearance, Status, Showcase, Controls
- `UserProfilePage` — full profile view with Activity/Showcase/Backlog tabs
- `GameModal` — detailed game view with scores, reviews, prices
- `GameCard` — grid card with scores, HLTB, backlog button (props: `currentUser`, `inBacklog`, `onToggleBacklog`)

### ESRB Rating IDs (RAWG)
- 1 = Everyone
- 2 = Everyone 10+
- 3 = Teen
- 4 = Mature
- 5 = Adults Only

---

## Launch Status

### Web Launch — READY ✅
| Task | Status |
|---|---|
| Core features | ✅ Live |
| Payments (Stripe + webhook) | ✅ Live |
| PWA (manifest, SW, icons) | ✅ Live |
| og:image / social sharing | ✅ Live |
| sitemap.xml + robots.txt | ✅ Live |
| DMARC | ✅ Updated to `p=quarantine` |
| Stripe webhook registered | ✅ Active (`captivating-splendor`) |
| STRIPE_WEBHOOK_SECRET in Vercel | ✅ Set |

### Google Play Store — In Progress 🔧
| Task | Status | Notes |
|---|---|---|
| PWA manifest + SW | ✅ Live | Required for TWA |
| Google Play Developer Account | 🔧 User working on it | $25 one-time, expected tomorrow |
| Bubblewrap CLI to generate APK | ❌ Waiting on dev account | `npx @nicolo-ribaudo/bubblewrap init --manifest=https://worthmytime.info/manifest.json` |
| Update assetlinks.json with real SHA-256 | ❌ After Bubblewrap | Replace placeholder in `public/.well-known/assetlinks.json` |
| Play Store listing | ❌ | Screenshots, description, privacy policy URL |
| Submit for review | ❌ | 3-7 day review for new accounts |

### Nice to Have
| Task | Notes |
|---|---|
| Custom og:image (designed banner) | Currently using icon-512.png as placeholder |
| Email notifications | New follower, review reply |
| PWA update prompt | Notify users when new version available |
| Better app icon (professional design) | Current one is programmatically generated from SVG |

---

## Git Workflow
- **Feature branch:** `claude/review-website-l5rSR`
- **Deploy branch:** `main`
- Push to feature branch → Create PR on GitHub → Merge → Vercel auto-deploys
- GitHub PAT tokens: user generates fresh ones as needed (they expire quickly)
- Remote URL format: `https://x-access-token:<TOKEN>@github.com/mercymerc713/worth-my-time.git`
- There is also a `github-direct` remote that bypasses the proxy for direct pushes

## Domain & Email
- **Domain:** worthmytime.info
- **Support email:** support@worthmytime.info
- **DMARC:** `p=quarantine` ✅ (updated 2026-04-01)
