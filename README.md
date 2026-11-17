# tech-feed

A personal, Instagram-style tech news feed. An AI pipeline writes original posts from RSS sources twice a day (6 AM and 6 PM Pacific), and I read them on my iPhone as an installed PWA. Single user, $0 infrastructure.

- **Plan:** [docs/PLAN.md](docs/PLAN.md) (source of truth)
- **Setup (accounts, secrets, deploy):** [docs/SETUP.md](docs/SETUP.md)
- **Status:** Phase 1 (AI/ML, Data Engineering, Outages)

## Stack

Next.js 16 (App Router) + Tailwind 4 · Supabase (Postgres + pgvector, email-OTP auth, RLS) · GitHub Actions (scheduled pipeline) · Vercel Hobby. The LLM sits behind `src/lib/llm.ts`:

| `LLM_PROVIDER` | How | Notes |
|---|---|---|
| `copilot` (default) | GitHub Copilot CLI, `copilot -p` with all tools disabled | Uses your Copilot plan (about 0.33 premium requests per call with `claude-haiku-4.5`) |
| `openai` | Any OpenAI-compatible endpoint via `fetch` | Gemini free tier by default. Replaces GitHub Models, retired 2026-07-30 |
| `anthropic` | `@anthropic-ai/sdk` | Paid. `MAX_RUN_USD` cap is enforced before each call |

## Commands

```bash
npm run dev            # web app on http://localhost:3000 (MOCK_DATA=1 for fixture posts, no auth)
npm run lint           # eslint
npm run typecheck      # tsc --noEmit (strict, no any)
npm test               # vitest: schemas, links, URLs, score, DST gate, LLM retry, fixture pipeline
npm run build          # production build

npm run sources:verify # fetch + parse every Phase 1 source, print a verification table
npm run seed           # upsert verified sources + OWNER_EMAIL into Supabase
npm run pipeline       # full run: ingest → dedupe → classify → select → generate → retention
npm run pipeline -- --dry-run --limit 15   # live RSS + LLM, prints posts, no DB
npm run pipeline -- --step classify        # one step only
npm run pipeline -- --force                # ignore the "ok run in the last 6h" skip
npm run icons          # regenerate PWA icons (no dependencies)
npm run screenshots    # 390×844 light/dark screenshots of the mock UI (needs Chrome + a running dev server)
```

## Layout

```
src/proxy.ts                 Supabase session refresh + auth gate (Next 16's rename of middleware.ts)
src/app/                     feed (/), /login (email → 6-digit code), /post/[id], /api/feed, /auth/signout
src/components/              StreamBar, PostCard, DeepDive, PullToRefresh, Skeleton, Feed, ...
src/lib/                     env (zod), db, llm (+ llm/copilot, llm/openai-compat, llm/anthropic), embed,
                             schema, prompts, links, rank, streams, url, pricing, feed-data
pipeline/                    run.ts (CLI) → pipeline.ts → ingest/dedupe/classify/select/generate/image/retention
                             fetcher.ts (10s timeout, UA, robots.txt, 2/host + 6 global, URL cache)
                             store-supabase.ts / store-memory.ts, sources.seed.ts, seed.ts, schedule-gate.ts
pipeline/fixtures/           canned feeds, pages, mock HTTP and mock LLM for tests
supabase/migrations/         0001_init.sql: full schema, indexes, RLS, feed() ranking function
.github/workflows/           pipeline.yml (6 AM/6 PM Pacific, DST-safe), ci.yml
public/                      manifest.webmanifest, sw.js (never caches /api or auth), icons
```

## Guardrails

- Every post needs at least one link, and every link must be one of the story's input URLs (enforced in `src/lib/links.ts` and tested).
- Posts are original summaries: no quote over 15 words (checked by the zod schema), sources are always linked, and the only borrowed media is `og:image`.
- Markdown is rendered through `rehype-sanitize`, and no unsanitized HTML is ever injected.
- The fetcher respects robots.txt, never reads paywalled or login pages (401/402/403 or paywall markers fall back to the RSS summary), and rate-limits per host.
- `MAX_LLM_CALLS_PER_RUN` hard-caps calls. 429s honor `retry-after` with backoff (max 3 retries). An exhausted quota ends the run as `partial`, and stories are kept for the next run.

## Dev-time tooling

UI design used the MIT-licensed [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) skill (`npx ui-ux-pro-max-cli init --ai copilot`), installed under `.github/prompts/`. It is a dev-time prompt and data pack only, not a runtime dependency.
