# Setup guide (Phase 1)

Everything here is free: Supabase free tier, Vercel Hobby, GitHub Actions on a private repo, and your existing GitHub Copilot plan for the LLM. Follow the steps in order. Each step says how to check it worked.

> **Change from PLAN.md §0/§6:** GitHub Models was retired on **2026-07-30** (the API now returns a bare `OK`). The default LLM is therefore the **GitHub Copilot CLI** (`LLM_PROVIDER=copilot`), billed to your Copilot plan. A generic OpenAI-compatible provider (`LLM_PROVIDER=openai`, Gemini free tier by default) and Anthropic (`LLM_PROVIDER=anthropic`) are drop-in alternatives.

## 0. Local prerequisites

```bash
node -v          # v22.x
npm ci
cp .env.example .env.local
copilot --version   # GitHub Copilot CLI; install with: npm install -g @github/copilot
copilot login       # once, if `copilot -p "hi"` asks you to sign in
```

## 1. Supabase project

1. Create a free account at <https://supabase.com> and a **New project** (any region near you; save the database password somewhere safe).
2. **Run the migration:** Dashboard → **SQL Editor** → New query → paste all of `supabase/migrations/0001_init.sql` → **Run**. You should see "Success. No rows returned".
   - Check: **Table Editor** lists `app_owner, sources, stories, raw_items, posts, interactions, pipeline_runs`, each with the RLS badge enabled.
3. **Add yourself as the owner** (SQL Editor):
   ```sql
   insert into app_owner (email) values ('you@example.com');
   ```
   (`npm run seed` also does this from `OWNER_EMAIL`.)
4. **Create your user and disable signups:** Authentication → **Users** → **Add user** → *Create new user* with your email (auto-confirm). Then Authentication → **Sign In / Providers** → turn **off** "Allow new users to sign up". Keep the **Email** provider enabled.
5. **Make the email send a code, not a link:** Authentication → **Emails** → **Templates** → **Magic Link**. Replace the body with:
   ```html
   <h2>Your Tech Feed code</h2>
   <p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
   <p>It expires in a few minutes. If you didn't request it, ignore this email.</p>
   ```
   Save. (The app calls `signInWithOtp` with `shouldCreateUser: false`, then `verifyOtp` with the 6-digit code. It never uses links, because an emailed link would open Safari, which doesn't share cookies with the installed PWA.)
6. **Copy keys:** Project Settings → **API**:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL` **and** `SUPABASE_URL`
   - `anon` / publishable key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` / secret key → `SUPABASE_SERVICE_ROLE_KEY` (**pipeline only, never in Vercel or the browser**)

   Put them in `.env.local`, plus `OWNER_EMAIL=you@example.com`.

## 2. Seed sources and run the pipeline locally

```bash
npm run sources:verify      # fetch + parse every Phase 1 feed and print the table
npm run seed                # verify again, upsert passing sources, set app_owner
npm run pipeline -- --dry-run --limit 15   # optional: prints posts, writes nothing
npm run pipeline            # real run: writes to Supabase
```

- Check: Supabase → Table Editor → `posts` has rows, and `pipeline_runs` has a row with `status = ok`.
- **About the 10-post check:** with `MAX_PER_STREAM_PER_RUN=3` and 3 Phase 1 streams, one run produces at most about 9 posts (more if the classifier routes stories to other streams). For the first fill, either run `MAX_PER_STREAM_PER_RUN=4 npm run pipeline` or run `npm run pipeline -- --force` twice (leftover classified stories are picked up on the second run).
- A re-run within 6 hours of an `ok` run is recorded as `skipped`. Use `--force` to override.
- Cost: about 11 Copilot calls per run (1 or 2 classify batches plus up to 9 posts) × 0.33 premium requests with `claude-haiku-4.5`, so roughly 3.6 per run and about 220 per month at 2 runs/day. That fits Copilot Pro's 300/month. Each run's `pipeline_runs.counts.premium_requests` records actual usage.

## 3. GitHub Actions (scheduled pipeline)

1. **Create a fine-grained PAT for Copilot:** <https://github.com/settings/personal-access-tokens/new>
   - Name `tech-feed-copilot`, expiration of your choice, Repository access: *Public repositories (read-only)* is enough.
   - Permissions → Account permissions → **Copilot Requests: Read & write** (the only permission needed).
   - Copy the token. (This replaces the "models:read PAT" from the original plan, since GitHub Models no longer exists.)
2. Repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `COPILOT_GITHUB_TOKEN` (the PAT from step 1)
3. Optional **Variables** (same page, *Variables* tab): `LLM_PROVIDER`, `MODEL_CLASSIFY`, `MODEL_WRITE`, `MAX_PER_STREAM_PER_RUN`, `MIN_IMPORTANCE`, `MAX_LLM_CALLS_PER_RUN`, `MAX_INPUT_CHARS`, `MAX_RUN_USD`, `LLM_BASE_URL`. Unset means the default from `.env.example`. If you switch providers, add `LLM_API_KEY` or `ANTHROPIC_API_KEY` as secrets.
4. **Test it:** Actions → **pipeline** → *Run workflow* → check **force** → Run. It should go green and add a `pipeline_runs` row.
   - Schedule: cron `0 1,2,13,14 * * *` UTC. The first step lets through only the slots that are 6 AM or 6 PM in America/Los_Angeles, so you get exactly two runs a day year-round, across DST changes.
   - A failed run (or Anthropic overspend) fails the workflow, and GitHub emails you.

## 4. Vercel (hosting)

1. Sign in at <https://vercel.com> with GitHub (Hobby plan) → **Add New… → Project** → import `pa11teddu/tech-feed` (grant access to the private repo). Framework is auto-detected as Next.js.
2. **Environment Variables** (Production + Preview):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `OWNER_EMAIL`
   - Do **not** add `SUPABASE_SERVICE_ROLE_KEY` or any LLM keys. The web app doesn't need them.
3. **Deploy.** Note the URL (e.g. `https://tech-feed-xyz.vercel.app`).
4. Back in Supabase → Authentication → **URL Configuration**: set **Site URL** to your Vercel URL. (Codes don't use redirects, but this keeps the auth settings consistent.)

## 5. iPhone

1. Open the Vercel URL in **Safari** → Share → **Add to Home Screen** → Add.
2. Open **Tech Feed** from the Home Screen. It should launch full-screen with no Safari address bar.
3. Enter your email → **Send code** → enter the 6-digit code from the email. iOS offers the code above the keyboard if Mail is set up.
4. Check: the feed shows the stream bar (All plus streams that have posts), and cards expand with **Read more**. Pull down at the top to refresh. Close and reopen the app, and you should stay signed in.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Signups not allowed for otp" on Send code | Create the user in Authentication → Users first (step 1.4). |
| Email contains a link, not a code | Edit the Magic Link template to use `{{ .Token }}` (step 1.5). |
| Feed is empty after login | Your email isn't in `app_owner` (RLS hides everything), or the pipeline hasn't run. |
| Pipeline: `Missing required environment variables` | Fill `.env.local` locally, or the Actions secrets. |
| Pipeline: `copilot CLI failed` in Actions | Check the `COPILOT_GITHUB_TOKEN` secret and its *Copilot Requests* permission. |
| Run status `partial` | The Copilot quota or `MAX_LLM_CALLS_PER_RUN` was hit. Stories keep their status and continue next run. |
