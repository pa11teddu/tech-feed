# Tech Feed: Build Plan (v2, reviewed)

A personal, single-user, Instagram-style tech news feed. AI writes the posts and I read them on my iPhone as an installed PWA.

> **For the coding agent:** Read this whole file. Build **only the phase you are asked to build**. Meet every acceptance criterion for that phase. Then stop and report what you verified and what I must set up by hand. Do not start the next phase.

---

## 0. Decisions (locked)

| Topic | Decision |
|---|---|
| Users | One (me). No signup flow. |
| Auth | Supabase Auth **email OTP code** (6 digits), entered inside the PWA. No magic links: on iOS a link opens in Safari, and the installed PWA does not share its cookies. Signups disabled; only `OWNER_EMAIL` can log in. |
| Device | iPhone Safari, installed to Home Screen. Design for 390px, safe-area insets, thumb reach, dark mode. |
| LLM provider | **GitHub Models** (free, rate-limited) by default. **Anthropic** can be swapped in with `LLM_PROVIDER=anthropic`. Both sit behind `lib/llm.ts`. |
| Embeddings | **GitHub Models** `openai/text-embedding-3-small` with `dimensions=1024`. Voyage `voyage-3.5` (1024-d) can be swapped in with `EMBEDDING_PROVIDER`. Column is `vector(1024)`, and every provider must output exactly 1024 dimensions. |
| Schedule | Twice a day: **6:00 AM and 6:00 PM America/Los_Angeles** (DST-safe gate, §7.9). |
| Hosting / DB / Jobs | Vercel Hobby, Supabase free, GitHub Actions (private repo). All $0. |
| Repo | Private GitHub repo `pa11teddu/tech-feed`, local clone at `~/tech-feed`. |
| Language | TypeScript everywhere, `strict: true`, no `any`. Node 22 LTS, npm. |
| Diagrams | **SVG only** (no Mermaid runtime), sanitized server-side. Phase 2. |
| Copyright | Original summaries only. No quote over 15 words. Link to sources. The only borrowed media is the source's `og:image` as a thumbnail. |
| Secrets | Env vars only. Never commit keys. `.env.example` documents every variable. |

## 1. Goal

A feed of AI-written tech posts, one card per story, with a sticky stream bar: **All, AI/ML, Data Engineering, Outages, Networking/Infra, Algorithms/CS, Quantum, Dev Tools**. Each card has an image, stream chip, headline, TL;DR, expandable deep dive, source links, and like / save / not interested. A scheduled job generates posts twice a day.

## 2. Stack and pre-approved dependencies

Only these dependencies are approved. Ask before adding anything else.

| Purpose | Packages |
|---|---|
| Web | `next` (App Router), `react`, `react-dom`, `tailwindcss`, `typescript`, `eslint` (from create-next-app) |
| Supabase | `@supabase/supabase-js`, `@supabase/ssr` |
| LLM | `@anthropic-ai/sdk` (Anthropic path only). GitHub Models is called with plain `fetch` (OpenAI-compatible REST), so it needs no SDK. |
| Pipeline | `rss-parser`, `@mozilla/readability`, `jsdom`, `robots-parser`, `p-limit`, `zod`, `tsx` |
| Rendering | `react-markdown`, `remark-gfm`, `rehype-sanitize` |
| Tests | `vitest` |
| Phase 2 | `isomorphic-dompurify` (SVG sanitizing) |
| Phase 4 | `web-push` |

No `next-pwa` (write the service worker by hand). No `next/image` for remote images: it would burn Vercel's free image-optimization quota, so use `<img loading="lazy" referrerPolicy="no-referrer">`.

## 3. Repo layout

```
tech-feed/
  docs/PLAN.md  docs/SETUP.md          # SETUP = step-by-step account/secret setup for me
  .env.example  README.md
  supabase/migrations/0001_init.sql
  src/
    middleware.ts                      # Supabase session refresh + auth gate
    app/
      layout.tsx  page.tsx             # feed
      login/page.tsx                   # email → 6-digit code
      saved/page.tsx                   # Phase 2
      post/[id]/page.tsx
      api/feed/route.ts
      api/interact/route.ts            # Phase 2
    components/  StreamBar, PostCard, DeepDive, ActionBar, PullToRefresh, Skeleton
    lib/
      env.ts       # zod-validated env, fails fast with a clear message
      db.ts        # server/browser/service-role Supabase clients
      llm.ts       # provider interface: complete({system,user,schema}) → typed JSON + usage
      llm/github-models.ts  llm/anthropic.ts
      embed.ts     # provider interface → number[1024]
      pricing.ts   # $/MTok per model (Anthropic) for cost estimates
      prompts.ts  schema.ts  streams.ts  rank.ts
  pipeline/
    run.ts       # orchestrator, CLI flags: --dry-run, --limit N, --step <name>, --force
    ingest.ts  dedupe.ts  classify.ts  select.ts  generate.ts  image.ts  retention.ts
    fetcher.ts   # timeouts, UA, robots.txt, per-host rate limit, URL cache
    sources.seed.ts  seed.ts
    fixtures/    # canned feeds/articles/LLM outputs for tests
  tests/
  .github/workflows/pipeline.yml  .github/workflows/ci.yml
  public/manifest.webmanifest  public/sw.js  public/icons/ (192, 512, apple-touch-icon 180)
```

## 4. Data model (`0001_init.sql`)

```sql
create extension if not exists vector;

create table app_owner (email text primary key);   -- seeded with OWNER_EMAIL

create table sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null unique,                 -- RSS/Atom URL
  stream text not null,                     -- default stream hint
  fetch_mode text not null default 'page' check (fetch_mode in ('page','feed_only')),
  max_items_per_run int not null default 15,
  active boolean not null default true,
  last_success_at timestamptz,
  last_error text,
  consecutive_failures int not null default 0
);

create table stories (
  id uuid primary key default gen_random_uuid(),
  stream text,
  importance int check (importance between 1 and 10),
  status text not null default 'new'
    check (status in ('new','classified','rejected','selected','generated','failed')),
  attempts int not null default 0,
  centroid vector(1024),
  created_at timestamptz not null default now()
);

create table raw_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references sources(id) on delete set null,
  url text not null unique,                 -- canonicalized (no utm_*, no fragment)
  title text not null,
  summary text,                             -- RSS description, fallback when page fetch fails
  published_at timestamptz,
  content text,                             -- readable text, ≤ 12k chars; nulled after 14 days
  og_image text,
  embedding vector(1024),
  story_id uuid references stories(id) on delete set null,
  fetched_at timestamptz not null default now()
);

create table posts (
  id uuid primary key default gen_random_uuid(),
  story_id uuid unique references stories(id) on delete cascade,
  stream text not null,
  headline text not null,
  tldr text not null,
  body_md text not null,
  takeaways text[] not null default '{}',
  links jsonb not null,                     -- [{title,url}], each url ∈ story's raw_items.url
  image_url text,
  diagram_svg text,                         -- sanitized SVG (Phase 2)
  importance int not null,
  boost float not null default 0,           -- personalization term (Phase 3)
  embedding vector(1024),                   -- Phase 2+
  published_at timestamptz not null default now()
);

create table interactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  kind text not null check (kind in ('like','save','dismiss')),
  created_at timestamptz not null default now(),
  unique (post_id, kind)                    -- unlike/unsave = delete row
);

create table pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','ok','partial','failed','skipped')),
  provider text,
  counts jsonb not null default '{}',       -- per-step counts
  llm_calls int not null default 0,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  est_cost_usd numeric(10,4) not null default 0,
  error text
);
```

Indexes: `posts(stream, published_at desc)`, `posts(published_at desc)`, `stories(status)`, `raw_items(story_id)`, HNSW on `raw_items.embedding`, `stories.centroid`, `posts.embedding` (`vector_cosine_ops`).

**RLS:** enable on every table. Policy for the `authenticated` role: `exists (select 1 from app_owner where email = auth.jwt()->>'email')`. The web app gets read access to `posts` and read/write access to `interactions`. The pipeline uses the service-role key, which bypasses RLS. Also turn signups off in the Supabase dashboard.

**Feed scoring (computed at query time, so it never goes stale):** SQL function `feed(p_stream text, p_limit int, p_offset int)` returns posts not dismissed, ordered by
`score = importance * exp(-age_hours / 36) + boost` (desc), tie-broken by `published_at desc`. The half-life constant lives in one place.

## 5. Streams and starter sources

Seed from `sources.seed.ts`. **Before seeding, the agent must fetch and parse every URL and drop or replace any that fail.** Print a verification table.

| Stream | Starter sources | fetch_mode |
|---|---|---|
| AI/ML | arXiv `rss.arxiv.org/rss/cs.AI`, `/cs.LG` (cap 10 each); `hnrss.org/newest?points=150&q=AI OR LLM`; OpenAI, Google DeepMind, Anthropic, Hugging Face blogs | arXiv: feed_only; blogs: page |
| Data Engineering | Databricks, Snowflake, dbt, Confluent blogs; Apache Spark & Kafka GitHub release atom | page |
| Outages | AWS, Azure, GCP, Cloudflare status feeds; a postmortem collection feed if a valid one exists | feed_only |
| Networking/Infra | Cloudflare blog, Kubernetes blog, APNIC blog | page |
| Algorithms/CS | arXiv cs.DS, cs.CC (cap 10 each), Quanta Magazine | arXiv: feed_only |
| Quantum | arXiv quant-ph (cap 10), IBM Quantum, Google Quantum AI blogs, Quanta | mixed |
| Dev Tools | `github.com/{owner}/{repo}/releases.atom` for repos in `DEVTOOLS_REPOS` env (comma list) | feed_only |

Phase 1 seeds only the AI/ML, Data Engineering, and Outages sources.

## 6. LLM provider details

- **GitHub Models**: `POST https://models.github.ai/inference/chat/completions` with `Authorization: Bearer $GITHUB_MODELS_TOKEN`. Locally, use a fine-grained PAT with `models:read`. In Actions, use `GITHUB_TOKEN` with `permissions: models: read`. Embeddings: `POST https://models.github.ai/inference/embeddings`.
- **Model IDs come from env.** At build time the agent must query `https://models.github.ai/catalog/models`, pick the current best available model for each role, and write it into `.env.example`. Roles: a cheap/fast model for classify and a strong model for write. Never hard-code models in logic.
- **Free-tier limits** (per request ≈ 8K tokens in / 4K out; roughly 10–15 RPM and 50–150 requests/day per model, depending on Copilot plan). The design must fit inside them:
  - **Batch classify:** up to 15 stories per call, using title + 500-char snippet each.
  - **Generate:** one call per post. Input is capped at about 5K tokens total (`MAX_INPUT_CHARS`, default 18000, split across the cluster's items).
  - **Batch embeddings:** up to 50 inputs per call.
  - **429 handling:** honor `retry-after`, use exponential backoff, at most 3 retries. If the daily quota is exhausted, stop the LLM steps gracefully, leave stories in their current status for the next run, and mark the run `partial`, not `failed`.
  - **`MAX_LLM_CALLS_PER_RUN`** (default 40) hard-caps calls.
- **Anthropic** (`LLM_PROVIDER=anthropic`): `MODEL_CLASSIFY=claude-haiku-5-5`, `MODEL_WRITE=claude-sonnet-5-5`. Cost is estimated from `lib/pricing.ts`. Abort generate if the estimated spend would exceed `MAX_RUN_USD` (default 0.50).
- **Structured output:** ask for JSON only and validate with zod. On parse or validation failure, retry once with the validation error appended, then mark the story `failed` (attempts++). After 3 attempts the story is never retried. Invalid output never crashes a run.
- **Prompt-injection guard:** article text goes inside clearly delimited `<source>` blocks. The system prompt says source content is data, not instructions.

## 7. Pipeline (`npm run pipeline`; every step idempotent and safe to re-run)

1. **Ingest:** fetch active sources (per-source try/catch; update `last_success_at`, `last_error`, `consecutive_failures`). Take the newest `max_items_per_run` items and drop anything older than 48h. Canonicalize URLs and skip ones already in `raw_items`. For `page` mode, fetch the page and extract text with Readability (≤ 12k chars) plus `og:image`. Fall back to the RSS summary if the fetch fails or is blocked. Never fetch paywalled or login pages: a 401/403 or paywall marker means use the summary.
2. **Fetcher rules:** 10s timeout, UA `TechFeedBot/1.0 (+repo URL)`, robots.txt respected (cached per host), at most 2 concurrent requests per host and 6 globally, and an in-run URL cache.
3. **Dedupe/cluster** (Phase 2; Phase 1 maps each item to its own story): embed title + first 1k chars. Join the most similar story from the last 3 days if cosine > `CLUSTER_THRESHOLD` (default 0.82), then update the centroid. Otherwise create a new story.
4. **Classify:** stories with status `new`, in batches, return `{id, stream, importance, is_noise}`. Set status `rejected` if `is_noise` or `importance < MIN_IMPORTANCE` (default 5), otherwise `classified`.
5. **Select:** per stream, take the top `MAX_PER_STREAM_PER_RUN` (default 3, so about 6 per stream per day) `classified` stories by importance, then recency. Set status `selected`. Leftovers expire after 3 days.
6. **Generate:** for `selected` stories, produce `{headline ≤ 90 chars, tldr ≤ 2 sentences, body_md 250–600 words, takeaways 2–5, links[]}`.
   - **Link check:** every link URL must be in the story's input URL set. Drop foreign links. If none remain, reject the post.
   - **Rules:** original wording, no quote over 15 words, state uncertainty, no facts beyond the sources.
   - **Templates** (Phase 2): Outages use *What happened / Impact / Timeline / Root cause / Fix / Lessons*. Algorithms/CS and Quantum use *Problem / What's new / Why it matters / Caveats*.
   - On success, set status `generated`.
7. **Image:** use the best `og:image` in the cluster (absolute https URL, skipping known placeholder or logo patterns). In Phase 2, if there is no image and the post is an explainer, ask the write model for a small SVG, sanitize it with DOMPurify (SVG profile, no scripts, foreignObject, or external hrefs, at most 20KB), and store it in `diagram_svg`.
8. **Rank** (Phase 3): set `posts.boost` from `w · cosine(post.embedding, mean(liked embeddings)) − penalty(stream dismiss rate)`. Phase 1 leaves `boost = 0`.
9. **Retention:** null out `raw_items.content` after 14 days and delete `rejected` and `failed` stories after 30 days.
10. **Run log:** write a `pipeline_runs` row with per-step counts, LLM calls, tokens, and estimated cost, and print a summary table. Exit non-zero on a `failed` run or if Anthropic spend exceeds `MAX_RUN_USD`.
11. **Schedule** (`pipeline.yml`): cron `0 1,2,13,14 * * *` (UTC) plus `workflow_dispatch` (with a `force` input). The first step exits early unless the America/Los_Angeles local hour is 6 or 18, or the run is forced. The pipeline also skips (status `skipped`) if an `ok` run finished in the last 6 hours. The result is exactly 6 AM and 6 PM Pacific year-round. Set `permissions: { contents: read, models: read }` and `timeout-minutes: 20`.
12. **CI** (`ci.yml`): on push or PR, run `npm ci`, lint, typecheck, test, and build.

## 8. App behavior

| Screen | Behavior |
|---|---|
| Login | Email field (prefilled hint), "Send code", then a 6-digit code field (`inputmode=numeric`, `autocomplete=one-time-code`) and `verifyOtp`. The session persists via `@supabase/ssr` cookies, and middleware refreshes it. Any route except `/login` redirects there when no session exists. |
| Feed | Sticky, horizontally scrollable stream bar (All + streams that have posts in Phase 1, all 7 later). Selection lives in the URL (`?s=outages`). Infinite scroll, 20 per page via `/api/feed`. Skeleton cards while loading. **Custom pull-to-refresh** (iOS standalone has no native one). Empty and error states. |
| Card | Image at a fixed 16:9 ratio, lazy-loaded, falling back to a stream-colored gradient on error. Then stream chip, headline, TL;DR, and a "Read more" toggle that expands the deep dive inline (sanitized Markdown, takeaways, diagram if present). Source links open in a new tab with `rel="noopener noreferrer"`. Action bar (Phase 2): like, save, not interested. "Not interested" hides the card with an optimistic update and rolls back on error. |
| Saved (Phase 2) | Saved posts, newest first. |
| Post | Permalink `/post/[id]` with the same card fully expanded and a share button (`navigator.share`). |
| PWA | `manifest.webmanifest` (name, short_name, 192/512 icons incl. maskable, `display: standalone`, `start_url: /`, theme/background colors), `apple-touch-icon`, `apple-mobile-web-app-capable`, `viewport-fit=cover`, safe-area padding, dark mode via `prefers-color-scheme`. `sw.js` caches the app shell and static assets only and **never caches `/api/*` or auth routes**. |
| A11y | Tap targets ≥ 44px, WCAG AA contrast in both themes, semantic HTML, visible focus, `aria-pressed` on toggles. |

## 9. Phases and acceptance criteria

### Phase 1: Working vertical slice
**Scope:** AI/ML, Data Engineering, and Outages streams. Ingest, classify, select (with cap), generate (one item = one story), and the feed UI with stream bar and expandable deep dive. Also OTP login, PWA, both workflows, `SETUP.md`, and the migration (full schema, so later phases need no rework).

**Agent-verifiable (must pass before stopping):**
- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` all pass.
- Unit tests cover the zod schemas, link validation, URL canonicalization, the feed score formula, the DST schedule gate, and LLM JSON-retry behavior.
- A fixture test runs the full pipeline with a **mocked LLM and mocked HTTP**, producing at least 10 posts from fixtures. Malformed LLM output and a crashing source don't fail the run.
- `npm run pipeline -- --dry-run --limit 15` runs **live** (real RSS plus GitHub Models using `GITHUB_MODELS_TOKEN`, or `gh auth token` if it has models access) and prints the generated posts without a DB. If no token works, document it and rely on the mocked test.
- Source verification table printed. Every seeded Phase 1 URL parses.
- At 390×844 viewport (browser canvas or Playwright screenshot against mock data), the stream tabs, cards, TL;DR, and expandable deep dive render correctly in light and dark mode.
- `.env.example` documents every variable. `README.md` and `docs/SETUP.md` are complete.

**Needs me (listed in SETUP.md, verified after I finish setup):**
- Create the Supabase project, run the migration, insert my email into `app_owner`, disable signups, and put `{{ .Token }}` in the email OTP template.
- Create the GitHub fine-grained PAT (models:read) for local runs, and add the Actions secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Import the repo into Vercel and set the env vars.
- Confirm on the iPhone: `npm run pipeline` inserts at least 10 posts, OTP login works inside the installed PWA, and the app opens standalone.

### Phase 2: Quality
Embeddings plus clustering, og:image selection plus SVG diagrams, like/save/dismiss persisted, Saved screen, Outage and Research templates, post embeddings.
**Acceptance:** fixture test shows that the same story from 2+ sources yields one post with multiple links. Like/save/dismiss survive a reload. Outage posts contain all six template headings (tested). The SVG sanitizer strips scripts and external refs (tested).

### Phase 3: All streams and personalization
Remaining streams and sources, `DEVTOOLS_REPOS`, ranking `boost` from likes and dismissals, and a `/health` page (per source: last success, consecutive failures, last error; last 10 `pipeline_runs`).
**Acceptance:** all 7 streams populate. A test shows that liking posts in a stream raises comparable posts' scores on the next rank. Sources failing 3+ times in a row are flagged on `/health`.

### Phase 4: Delivery
Web Push digest after each scheduled run (iOS 16.4+, installed PWA only, permission asked from a button tap). Search (Postgres full-text plus vector similarity), "More like this" on posts, and an optional email digest.
**Acceptance:** a push arrives on the iPhone after a run, and search returns relevant posts for 5 sample queries.

## 10. Guardrails

- **Hallucination control:** every post has at least one link, and every link must come from its input items (enforced in code, tested).
- **Sanitization:** Markdown through `rehype-sanitize`, SVG through DOMPurify, no `dangerouslySetInnerHTML` on unsanitized data.
- **Fetching:** no paywalls or logins, robots.txt respected, per-host rate limits, URL cache.
- **Budget:** `MAX_LLM_CALLS_PER_RUN` always applies, and `MAX_RUN_USD` applies when using Anthropic. A breach fails the workflow, which emails me through GitHub's notification.
- **Storage:** retention step keeps Supabase under the free tier (500MB). The twice-daily runs also keep the free project from pausing.
- **Code:** small typed files, no `any`, env validated at startup, no secrets in logs.

## 11. Environment variables

| Var | Used by | Default / note |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web | — |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | pipeline | never exposed to the browser |
| `OWNER_EMAIL` | web hint and seed | — |
| `LLM_PROVIDER` | pipeline | `github` \| `anthropic` (default `github`) |
| `GITHUB_MODELS_TOKEN` | pipeline | PAT locally; `GITHUB_TOKEN` in Actions |
| `ANTHROPIC_API_KEY` | pipeline | only if `LLM_PROVIDER=anthropic` |
| `MODEL_CLASSIFY`, `MODEL_WRITE` | pipeline | chosen from the live catalog at build time |
| `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `VOYAGE_API_KEY` | pipeline (Phase 2) | `github`, `openai/text-embedding-3-small`; Voyage optional |
| `MAX_PER_STREAM_PER_RUN` | pipeline | 3 |
| `MIN_IMPORTANCE` | pipeline | 5 |
| `MAX_LLM_CALLS_PER_RUN` | pipeline | 40 |
| `MAX_RUN_USD` | pipeline | 0.50 (Anthropic only) |
| `MAX_INPUT_CHARS` | pipeline | 18000 |
| `CLUSTER_THRESHOLD` | pipeline (Phase 2) | 0.82 |
| `DEVTOOLS_REPOS` | pipeline (Phase 3) | e.g. `vercel/next.js,microsoft/TypeScript` |
| `APP_TIMEZONE` | pipeline/workflow | `America/Los_Angeles` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Phase 4 | — |

## 12. Rules for the coding agent

- Build only the requested phase. Commit after the phase with a clear message.
- Ask before adding paid services or dependencies not listed in §2.
- Keep files small and typed. No `any`.
- After the phase, run lint, typecheck, tests, and build. Report what changed, what was verified (with evidence), and the exact manual steps left for me.
