-- Publicité / B-roll library --------------------------------------------------

begin;

create table if not exists public.ad_library_folders (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  name        text        not null check (char_length(name) between 1 and 80),
  parent_id   uuid        references public.ad_library_folders(id) on delete set null,
  order_index integer     not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists ad_library_folders_user_order_idx
  on public.ad_library_folders (user_id, order_index);

drop trigger if exists ad_library_folders_updated_at on public.ad_library_folders;
create trigger ad_library_folders_updated_at
  before update on public.ad_library_folders
  for each row execute function public.touch_updated_at();

alter table public.ad_library_folders enable row level security;

drop policy if exists "users manage own ad library folders" on public.ad_library_folders;
create policy "users manage own ad library folders"
  on public.ad_library_folders for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.ad_library_assets (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  folder_id      uuid        references public.ad_library_folders(id) on delete set null,
  source_item_id text,
  source_type    text        not null check (source_type in ('generation', 'upload', 'trimmed', 'library_upload')),
  media_type     text        not null check (media_type in ('image', 'video')),
  url            text        not null,
  title          text,
  duration       double precision,
  trim_start     double precision,
  trim_end       double precision,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (trim_start is null or trim_start >= 0),
  check (trim_end is null or trim_start is null or trim_end > trim_start)
);

create index if not exists ad_library_assets_user_created_idx
  on public.ad_library_assets (user_id, created_at desc);
create index if not exists ad_library_assets_folder_idx
  on public.ad_library_assets (folder_id);

drop trigger if exists ad_library_assets_updated_at on public.ad_library_assets;
create trigger ad_library_assets_updated_at
  before update on public.ad_library_assets
  for each row execute function public.touch_updated_at();

alter table public.ad_library_assets enable row level security;

drop policy if exists "users manage own ad library assets" on public.ad_library_assets;
create policy "users manage own ad library assets"
  on public.ad_library_assets for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.ad_library_tags (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  name       text        not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now()
);

create unique index if not exists ad_library_tags_user_name_idx
  on public.ad_library_tags (user_id, lower(name));

alter table public.ad_library_tags enable row level security;

drop policy if exists "users manage own ad library tags" on public.ad_library_tags;
create policy "users manage own ad library tags"
  on public.ad_library_tags for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.ad_library_asset_tags (
  asset_id  uuid        not null references public.ad_library_assets(id) on delete cascade,
  tag_id    uuid        not null references public.ad_library_tags(id) on delete cascade,
  user_id   uuid        not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (asset_id, tag_id)
);

create index if not exists ad_library_asset_tags_user_idx
  on public.ad_library_asset_tags (user_id);
create index if not exists ad_library_asset_tags_tag_idx
  on public.ad_library_asset_tags (tag_id);

alter table public.ad_library_asset_tags enable row level security;

drop policy if exists "users manage own ad library asset tags" on public.ad_library_asset_tags;
create policy "users manage own ad library asset tags"
  on public.ad_library_asset_tags for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.ad_library_folders to authenticated;
grant select, insert, update, delete on public.ad_library_assets to authenticated;
grant select, insert, update, delete on public.ad_library_tags to authenticated;
grant select, insert, update, delete on public.ad_library_asset_tags to authenticated;

grant all privileges on public.ad_library_folders to service_role;
grant all privileges on public.ad_library_assets to service_role;
grant all privileges on public.ad_library_tags to service_role;
grant all privileges on public.ad_library_asset_tags to service_role;

notify pgrst, 'reload schema';

commit;
