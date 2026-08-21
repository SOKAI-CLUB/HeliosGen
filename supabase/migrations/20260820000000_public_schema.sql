-- HeliosGen cloud tables for a dedicated Supabase project.
-- Run with Supabase migrations or paste this entire file into the SQL Editor.

begin;

-- `public` is exposed by the Supabase Data API by default.
grant usage on schema public to anon, authenticated, service_role;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_updated_at() from public;
grant execute on function public.touch_updated_at() to authenticated, service_role;

-- User uploads ---------------------------------------------------------------

create table if not exists public.user_uploads (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        references auth.users(id) on delete set null,
  r2_url     text        not null,
  mime_type  text,
  source     text        not null default 'user_upload',
  created_at timestamptz not null default now()
);

create index if not exists user_uploads_user_created_idx
  on public.user_uploads (user_id, created_at desc);

alter table public.user_uploads enable row level security;

drop policy if exists "users read own uploads" on public.user_uploads;
create policy "users read own uploads"
  on public.user_uploads for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "users insert own uploads" on public.user_uploads;
create policy "users insert own uploads"
  on public.user_uploads for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- Workflow spaces ------------------------------------------------------------

create table if not exists public.spaces (
  id         text        primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  name       text        not null,
  data       jsonb       not null default '{}'::jsonb,
  is_public  boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists spaces_user_updated_idx
  on public.spaces (user_id, updated_at desc);

drop trigger if exists spaces_updated_at on public.spaces;
create trigger spaces_updated_at
  before update on public.spaces
  for each row execute function public.touch_updated_at();

alter table public.spaces enable row level security;

drop policy if exists "users manage own spaces" on public.spaces;
create policy "users manage own spaces"
  on public.spaces for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "anyone reads public spaces" on public.spaces;
create policy "anyone reads public spaces"
  on public.spaces for select
  to anon, authenticated
  using (is_public = true);

-- Generations ----------------------------------------------------------------

create table if not exists public.generations (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  user_id              uuid references auth.users(id) on delete set null,
  task_id              text not null unique,
  generation_type      text not null check (generation_type in ('image', 'video')),
  status               text not null default 'pending',
  prompt               text,
  model                text,
  aspect_ratio         text,
  quality              text,
  azure_resolution     text,
  duration             integer,
  kling_mode           text,
  sound                boolean,
  reference_image_urls text[] default '{}',
  image_url            text,
  image_urls           jsonb,
  video_url            text,
  error_msg            text
);

create index if not exists generations_user_created_idx
  on public.generations (user_id, created_at desc);
create index if not exists generations_status_idx
  on public.generations (status);

drop trigger if exists generations_updated_at on public.generations;
create trigger generations_updated_at
  before update on public.generations
  for each row execute function public.touch_updated_at();

alter table public.generations enable row level security;

drop policy if exists "users read own generations" on public.generations;
create policy "users read own generations"
  on public.generations for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Per-user provider credentials. Only service-role API routes can access it. --

create table if not exists public.user_settings (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  kie_api_token text,
  azure_api_key text,
  updated_at    timestamptz not null default now()
);

drop trigger if exists user_settings_updated_at on public.user_settings;
create trigger user_settings_updated_at
  before update on public.user_settings
  for each row execute function public.touch_updated_at();

alter table public.user_settings enable row level security;

-- Asset cache. Only service-role API routes can access it. -------------------

create table if not exists public.asset_cache (
  hash       text primary key,
  cdn_url    text not null,
  mime_type  text,
  byte_size  bigint,
  created_at timestamptz not null default now()
);

alter table public.asset_cache enable row level security;

-- Gallery folders ------------------------------------------------------------

create table if not exists public.folders (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  name        text        not null,
  parent_id   uuid        references public.folders(id) on delete cascade,
  order_index integer     not null default 0,
  color       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Safe when upgrading from the older two-file SQL setup.
alter table public.folders add column if not exists color text;

create index if not exists folders_user_order_idx
  on public.folders (user_id, order_index);

drop trigger if exists folders_updated_at on public.folders;
create trigger folders_updated_at
  before update on public.folders
  for each row execute function public.touch_updated_at();

alter table public.folders enable row level security;

drop policy if exists "users manage own folders" on public.folders;
create policy "users manage own folders"
  on public.folders for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.folder_items (
  folder_id  uuid        not null references public.folders(id) on delete cascade,
  item_id    text        not null,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (folder_id, item_id)
);

create index if not exists folder_items_user_idx
  on public.folder_items (user_id);

alter table public.folder_items enable row level security;

drop policy if exists "users manage own folder items" on public.folder_items;
create policy "users manage own folder items"
  on public.folder_items for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Chat sessions --------------------------------------------------------------

create table if not exists public.chat_sessions (
  id         uuid        primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  title      text        not null default 'Chat',
  messages   jsonb       not null default '[]'::jsonb,
  model      text        not null default 'claude-sonnet-4-6',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_sessions_user_updated_idx
  on public.chat_sessions (user_id, updated_at desc);

drop trigger if exists chat_sessions_updated_at on public.chat_sessions;
create trigger chat_sessions_updated_at
  before update on public.chat_sessions
  for each row execute function public.touch_updated_at();

alter table public.chat_sessions enable row level security;

drop policy if exists "users manage own chat sessions" on public.chat_sessions;
create policy "users manage own chat sessions"
  on public.chat_sessions for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Data API privileges. RLS remains the row-level enforcement layer. ----------

grant select on public.spaces to anon;

grant select, insert on public.user_uploads to authenticated;
grant select, insert, update, delete on public.spaces to authenticated;
grant select on public.generations to authenticated;
grant select, insert, update, delete on public.folders to authenticated;
grant select, insert, update, delete on public.folder_items to authenticated;
grant select, insert, update, delete on public.chat_sessions to authenticated;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all routines in schema public to service_role;

alter default privileges for role postgres in schema public
  grant all privileges on tables to service_role;
alter default privileges for role postgres in schema public
  grant all privileges on sequences to service_role;
alter default privileges for role postgres in schema public
  grant all privileges on routines to service_role;

notify pgrst, 'reload schema';

commit;
