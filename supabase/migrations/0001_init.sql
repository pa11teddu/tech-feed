-- Tech Feed: full schema (PLAN §4). Later phases need no rework.
create extension if not exists vector;

create table app_owner (email text primary key);   -- seeded with OWNER_EMAIL

create table sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null unique,
  stream text not null,
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
  url text not null unique,
  title text not null,
  summary text,
  published_at timestamptz,
  content text,
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
  links jsonb not null,
  image_url text,
  diagram_svg text,
  importance int not null,
  boost float not null default 0,
  embedding vector(1024),
  published_at timestamptz not null default now()
);

create table interactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  kind text not null check (kind in ('like','save','dismiss')),
  created_at timestamptz not null default now(),
  unique (post_id, kind)
);

create table pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','ok','partial','failed','skipped')),
  provider text,
  counts jsonb not null default '{}',
  llm_calls int not null default 0,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  est_cost_usd numeric(10,4) not null default 0,
  error text
);

-- Indexes
create index posts_stream_published_idx on posts (stream, published_at desc);
create index posts_published_idx on posts (published_at desc);
create index stories_status_idx on stories (status);
create index raw_items_story_idx on raw_items (story_id);
create index raw_items_embedding_idx on raw_items using hnsw (embedding vector_cosine_ops);
create index stories_centroid_idx on stories using hnsw (centroid vector_cosine_ops);
create index posts_embedding_idx on posts using hnsw (embedding vector_cosine_ops);
create index pipeline_runs_finished_idx on pipeline_runs (status, finished_at desc);

-- Owner check used by every RLS policy.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from app_owner where lower(email) = lower(auth.jwt()->>'email'));
$$;

-- RLS: enabled on every table. The pipeline's service-role key bypasses RLS.
alter table app_owner enable row level security;
alter table sources enable row level security;
alter table stories enable row level security;
alter table raw_items enable row level security;
alter table posts enable row level security;
alter table interactions enable row level security;
alter table pipeline_runs enable row level security;

create policy owner_read_posts on posts
  for select to authenticated using (public.is_owner());

create policy owner_read_interactions on interactions
  for select to authenticated using (public.is_owner());
create policy owner_insert_interactions on interactions
  for insert to authenticated with check (public.is_owner());
create policy owner_update_interactions on interactions
  for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy owner_delete_interactions on interactions
  for delete to authenticated using (public.is_owner());

-- Read-only visibility for the future /health page (Phase 3).
create policy owner_read_sources on sources
  for select to authenticated using (public.is_owner());
create policy owner_read_runs on pipeline_runs
  for select to authenticated using (public.is_owner());

-- Feed ranking, computed at query time so it never goes stale:
--   score = importance * exp(-age_hours / p_decay_hours) + boost
-- p_decay_hours has no default: the app passes FEED_DECAY_HOURS from src/lib/rank.ts,
-- the single place the constant lives. Runs as the caller, so RLS applies.
-- Explicit columns: never ship embedding vectors to the browser.
create or replace function public.feed(p_stream text, p_limit int, p_offset int, p_decay_hours float)
returns table (
  id uuid, story_id uuid, stream text, headline text, tldr text, body_md text,
  takeaways text[], links jsonb, image_url text, diagram_svg text,
  importance int, boost float, published_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select p.id, p.story_id, p.stream, p.headline, p.tldr, p.body_md,
         p.takeaways, p.links, p.image_url, p.diagram_svg,
         p.importance, p.boost, p.published_at
  from posts p
  where (p_stream is null or p.stream = p_stream)
    and not exists (
      select 1 from interactions i where i.post_id = p.id and i.kind = 'dismiss'
    )
  order by
    p.importance * exp(-(extract(epoch from (now() - p.published_at)) / 3600.0) / p_decay_hours) + p.boost desc,
    p.published_at desc
  limit least(greatest(p_limit, 1), 50)
  offset greatest(p_offset, 0);
$$;

-- Streams that currently have posts (Phase 1 shows only these in the stream bar).
create or replace function public.post_streams()
returns setof text
language sql
stable
security invoker
set search_path = public
as $$
  select distinct stream from posts order by stream;
$$;

revoke all on function public.feed(text, int, int, float) from public, anon;
revoke all on function public.post_streams() from public, anon;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.feed(text, int, int, float) to authenticated;
grant execute on function public.post_streams() to authenticated;
