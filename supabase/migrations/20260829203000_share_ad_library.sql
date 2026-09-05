-- Share the advertising/B-roll library across authenticated accounts while
-- reserving asset deletion for the two library administrators.

begin;

create or replace function public.can_delete_ad_library_assets()
returns boolean
language sql
stable
set search_path = ''
as $$
  select lower(coalesce((select auth.jwt()) ->> 'email', '')) = any (
    array['quentin@sokai.club', 'axel@sokai.club']::text[]
  );
$$;

revoke all on function public.can_delete_ad_library_assets() from public;
grant execute on function public.can_delete_ad_library_assets() to authenticated, service_role;

-- Shared folders ------------------------------------------------------------

drop policy if exists "users manage own ad library folders" on public.ad_library_folders;
drop policy if exists "authenticated users read shared ad library folders" on public.ad_library_folders;
drop policy if exists "authenticated users create shared ad library folders" on public.ad_library_folders;
drop policy if exists "authenticated users update shared ad library folders" on public.ad_library_folders;
drop policy if exists "authenticated users delete shared ad library folders" on public.ad_library_folders;

create policy "authenticated users read shared ad library folders"
  on public.ad_library_folders for select
  to authenticated
  using (true);

create policy "authenticated users create shared ad library folders"
  on public.ad_library_folders for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "authenticated users update shared ad library folders"
  on public.ad_library_folders for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated users delete shared ad library folders"
  on public.ad_library_folders for delete
  to authenticated
  using (true);

-- Shared assets -------------------------------------------------------------

drop policy if exists "users manage own ad library assets" on public.ad_library_assets;
drop policy if exists "authenticated users read shared ad library assets" on public.ad_library_assets;
drop policy if exists "authenticated users create shared ad library assets" on public.ad_library_assets;
drop policy if exists "authenticated users update shared ad library assets" on public.ad_library_assets;
drop policy if exists "library admins delete shared ad library assets" on public.ad_library_assets;

create policy "authenticated users read shared ad library assets"
  on public.ad_library_assets for select
  to authenticated
  using (true);

create policy "authenticated users create shared ad library assets"
  on public.ad_library_assets for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "authenticated users update shared ad library assets"
  on public.ad_library_assets for update
  to authenticated
  using (true)
  with check (true);

create policy "library admins delete shared ad library assets"
  on public.ad_library_assets for delete
  to authenticated
  using ((select public.can_delete_ad_library_assets()));

-- Shared tags ---------------------------------------------------------------

drop policy if exists "users manage own ad library tags" on public.ad_library_tags;
drop policy if exists "authenticated users read shared ad library tags" on public.ad_library_tags;
drop policy if exists "authenticated users create shared ad library tags" on public.ad_library_tags;
drop policy if exists "authenticated users update shared ad library tags" on public.ad_library_tags;
drop policy if exists "authenticated users delete shared ad library tags" on public.ad_library_tags;

create policy "authenticated users read shared ad library tags"
  on public.ad_library_tags for select
  to authenticated
  using (true);

create policy "authenticated users create shared ad library tags"
  on public.ad_library_tags for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "authenticated users update shared ad library tags"
  on public.ad_library_tags for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated users delete shared ad library tags"
  on public.ad_library_tags for delete
  to authenticated
  using (true);

-- Shared asset/tag links ----------------------------------------------------

drop policy if exists "users manage own ad library asset tags" on public.ad_library_asset_tags;
drop policy if exists "authenticated users read shared ad library asset tags" on public.ad_library_asset_tags;
drop policy if exists "authenticated users create shared ad library asset tags" on public.ad_library_asset_tags;
drop policy if exists "authenticated users update shared ad library asset tags" on public.ad_library_asset_tags;
drop policy if exists "authenticated users delete shared ad library asset tags" on public.ad_library_asset_tags;

create policy "authenticated users read shared ad library asset tags"
  on public.ad_library_asset_tags for select
  to authenticated
  using (true);

create policy "authenticated users create shared ad library asset tags"
  on public.ad_library_asset_tags for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "authenticated users update shared ad library asset tags"
  on public.ad_library_asset_tags for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated users delete shared ad library asset tags"
  on public.ad_library_asset_tags for delete
  to authenticated
  using (true);

notify pgrst, 'reload schema';

commit;
