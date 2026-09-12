-- Shared review threads. Mutations go through the authenticated server API,
-- which derives authorship from the session and checks ownership on deletion.
begin;

create table public.ad_library_comments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.ad_library_assets(id) on delete cascade,
  parent_id uuid,
  user_id uuid references auth.users(id) on delete set null,
  author_name text not null check (char_length(author_name) between 1 and 80),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  timecode double precision check (timecode >= 0 and timecode <= 604800),
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, asset_id),
  foreign key (parent_id, asset_id) references public.ad_library_comments(id, asset_id) on delete cascade,
  check (parent_id is null or (timecode is null and not resolved)),
  check (parent_id is null or parent_id <> id)
);

create index ad_library_comments_asset_created_idx on public.ad_library_comments(asset_id, created_at);
create index ad_library_comments_parent_idx on public.ad_library_comments(parent_id);
create trigger ad_library_comments_updated_at before update on public.ad_library_comments
  for each row execute function public.touch_updated_at();

alter table public.ad_library_comments enable row level security;
revoke all on public.ad_library_comments from anon, authenticated;
grant select on public.ad_library_comments to authenticated;
grant all on public.ad_library_comments to service_role;
create policy "authenticated users read shared review comments"
  on public.ad_library_comments for select to authenticated using (true);

commit;
