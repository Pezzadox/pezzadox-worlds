-- Video messages: one row per request. Nobody reads or writes this table directly:
-- the app and the studio page go through the edge functions, which use the service role.
create extension if not exists pgcrypto;

create table if not exists public.video_requests (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  device_hash    text not null,                 -- SHA-256 of a random key kept on the buyer's phone
  for_name       text not null,
  from_name      text not null,
  occasion       text not null,
  brief          text not null,
  status         text not null default 'draft'
                 check (status in ('draft','paid','refunding','ready','declined','refunded')),
  purchase_token text unique,                   -- Google Play purchase token; one request per purchase
  order_id       text,
  consumed       boolean not null default false,
  paid_at        timestamptz,
  due_at         timestamptz,
  ready_at       timestamptz,
  closed_at      timestamptz,
  video_path     text,
  reason         text
);
create index if not exists video_requests_device on public.video_requests (device_hash);
create index if not exists video_requests_status on public.video_requests (status, paid_at);

alter table public.video_requests enable row level security;
revoke all on public.video_requests from anon, authenticated;
-- No policies on purpose: with row level security on and no policy, only the service role gets in.

-- The finished videos. Private: buyers get a short-lived signed link from the edge function.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('video-messages', 'video-messages', false, 262144000, array['video/mp4','video/quicktime','video/webm'])
on conflict (id) do nothing;
