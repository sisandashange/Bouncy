-- BOUNCY Live Battles foundation and secure RPCs
-- Applied to Supabase project lakupnehsetdazezlsrs.
-- Supports 5/10/15 minute battles and formats:
-- 1v1, 1v1v1, 1v1v1v1, 1v2, 1v3, 1v4, 2v2.
-- 100 coins buys a 30-second 2x points boost.

create table if not exists public.live_battles (
  id uuid primary key default gen_random_uuid(),
  live_id uuid not null references public.live_streams(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  format text not null check (format in ('1v1','1v1v1','1v1v1v1','1v2','1v3','1v4','2v2')),
  duration_minutes integer not null check (duration_minutes in (5,10,15)),
  status text not null default 'forming' check (status in ('forming','ready','active','completed','cancelled')),
  starts_at timestamptz, ends_at timestamptz, winner_team smallint,
  created_at timestamptz not null default now(), completed_at timestamptz,
  constraint live_battles_time_check check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create unique index if not exists live_battles_one_open_per_live on public.live_battles(live_id) where status in ('forming','ready','active');

create table if not exists public.live_battle_participants (
  battle_id uuid not null references public.live_battles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  team smallint not null check (team between 1 and 4), seat smallint not null check (seat between 1 and 5),
  role text not null default 'player' check (role in ('host','cohost','player')),
  status text not null default 'invited' check (status in ('invited','accepted','declined','left','removed')),
  joined_at timestamptz, taps bigint not null default 0 check (taps>=0),
  gift_coins bigint not null default 0 check (gift_coins>=0), boost_points bigint not null default 0 check (boost_points>=0),
  boost_until timestamptz, boost_uses integer not null default 0,
  created_at timestamptz not null default now(),
  primary key(battle_id,user_id), unique(battle_id,seat)
);
create table if not exists public.live_battle_invites (
  id uuid primary key default gen_random_uuid(), battle_id uuid not null references public.live_battles(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete cascade, invitee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled','expired')),
  created_at timestamptz not null default now(), responded_at timestamptz,
  unique(battle_id,invitee_id), check(inviter_id<>invitee_id)
);
create table if not exists public.live_battle_score_events (
  id uuid primary key default gen_random_uuid(), battle_id uuid not null references public.live_battles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check(event_type in ('tap_batch','gift','boost')),
  points bigint not null check(points>0), source_gift_id uuid references public.live_gifts(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists live_battle_participants_user_idx on public.live_battle_participants(user_id);
create index if not exists live_battle_invites_invitee_idx on public.live_battle_invites(invitee_id,status);
create index if not exists live_battle_score_events_battle_idx on public.live_battle_score_events(battle_id,created_at);

alter table public.live_battles enable row level security;
alter table public.live_battle_participants enable row level security;
alter table public.live_battle_invites enable row level security;
alter table public.live_battle_score_events enable row level security;
drop policy if exists "Authenticated users can view live battles" on public.live_battles;
create policy "Authenticated users can view live battles" on public.live_battles for select to authenticated using(true);
drop policy if exists "Authenticated users can view battle participants" on public.live_battle_participants;
create policy "Authenticated users can view battle participants" on public.live_battle_participants for select to authenticated using(true);
drop policy if exists "Invite participants can view battle invitations" on public.live_battle_invites;
create policy "Invite participants can view battle invitations" on public.live_battle_invites for select to authenticated using(auth.uid()=inviter_id or auth.uid()=invitee_id);
drop policy if exists "Authenticated users can view battle scores" on public.live_battle_score_events;
create policy "Authenticated users can view battle scores" on public.live_battle_score_events for select to authenticated using(true);
revoke insert,update,delete on public.live_battles,public.live_battle_participants,public.live_battle_invites,public.live_battle_score_events from anon,authenticated;

do $$
begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='live_battles') then alter publication supabase_realtime add table public.live_battles; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='live_battle_participants') then alter publication supabase_realtime add table public.live_battle_participants; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='live_battle_invites') then alter publication supabase_realtime add table public.live_battle_invites; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='live_battle_score_events') then alter publication supabase_realtime add table public.live_battle_score_events; end if;
end $$;

-- RPCs below are SECURITY DEFINER and validate auth.uid() on every call.
-- The host creates a battle and invites co-hosts; invitees explicitly accept.
-- Team rules: 1vN = host solo vs invited players; 2v2 = seats 1-2 vs 3-4;
-- 1v1v1 and 1v1v1v1 = each seat is its own team.
