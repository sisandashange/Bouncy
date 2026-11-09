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

alter table public.live_battle_participants add column if not exists boost_until timestamptz;
alter table public.live_battle_participants add column if not exists boost_uses integer not null default 0;
alter table public.live_battle_participants drop constraint if exists live_battle_participants_team_check;
alter table public.live_battle_participants add constraint live_battle_participants_team_check check(team between 1 and 4);

create or replace function public.bouncy_create_live_battle(p_live_id uuid,p_format text,p_duration_minutes integer)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_battle uuid; v_host uuid;
begin
 if v_uid is null then raise exception 'Sign in first'; end if;
 select host_id into v_host from public.live_streams where id=p_live_id and status='live' and last_heartbeat_at>now()-interval '60 seconds';
 if v_host is null or v_host<>v_uid then raise exception 'Only the active live host can create a battle'; end if;
 if p_format not in ('1v1','1v1v1','1v1v1v1','1v2','1v3','1v4','2v2') then raise exception 'Invalid battle format'; end if;
 if p_duration_minutes not in (5,10,15) then raise exception 'Battle duration must be 5, 10 or 15 minutes'; end if;
 insert into public.live_battles(live_id,created_by,format,duration_minutes) values(p_live_id,v_uid,p_format,p_duration_minutes) returning id into v_battle;
 insert into public.live_battle_participants(battle_id,user_id,team,seat,role,status,joined_at) values(v_battle,v_uid,1,1,'host','accepted',now());
 return v_battle;
end $$;

create or replace function public.bouncy_invite_live_battle_player(p_battle_id uuid,p_invitee_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_battle public.live_battles%rowtype; v_id uuid; v_max integer; v_count integer; v_seat integer; v_team integer;
begin
 if v_uid is null then raise exception 'Sign in first'; end if;
 select * into v_battle from public.live_battles where id=p_battle_id for update;
 if not found or v_battle.created_by<>v_uid or v_battle.status<>'forming' then raise exception 'Only the host can invite players before the battle starts'; end if;
 if p_invitee_id is null or p_invitee_id=v_uid then raise exception 'Choose another user'; end if;
 v_max:=case v_battle.format when '1v1' then 2 when '1v1v1' then 3 when '1v1v1v1' then 4 when '1v2' then 3 when '1v3' then 4 when '1v4' then 5 when '2v2' then 4 end;
 select count(*) into v_count from public.live_battle_participants where battle_id=p_battle_id and status in ('accepted','invited');
 if v_count>=v_max then raise exception 'All player slots are full'; end if;
 if not exists(select 1 from public.profiles where id=p_invitee_id) then raise exception 'User not found'; end if;
 select gs into v_seat from generate_series(2,v_max) gs where not exists(select 1 from public.live_battle_participants p where p.battle_id=p_battle_id and p.seat=gs) order by gs limit 1;
 if v_seat is null then raise exception 'No player slots available'; end if;
 v_team:=case when v_battle.format in ('1v1v1','1v1v1v1') then v_seat when v_battle.format in ('1v2','1v3','1v4') then 2 when v_battle.format='2v2' then case when v_seat<=2 then 1 else 2 end else 2 end;
 insert into public.live_battle_participants(battle_id,user_id,team,seat,role,status) values(p_battle_id,p_invitee_id,v_team,v_seat,'cohost','invited') on conflict(battle_id,user_id) do nothing;
 insert into public.live_battle_invites(battle_id,inviter_id,invitee_id) values(p_battle_id,v_uid,p_invitee_id) returning id into v_id;
 return v_id;
end $$;

create or replace function public.bouncy_respond_live_battle_invite(p_invite_id uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_inv public.live_battle_invites%rowtype; v_b public.live_battles%rowtype;
begin
 if v_uid is null then raise exception 'Sign in first'; end if;
 select * into v_inv from public.live_battle_invites where id=p_invite_id for update;
 if not found or v_inv.invitee_id<>v_uid or v_inv.status<>'pending' then raise exception 'Invitation is unavailable'; end if;
 select * into v_b from public.live_battles where id=v_inv.battle_id for update;
 if v_b.status<>'forming' then raise exception 'Battle is no longer accepting players'; end if;
 update public.live_battle_invites set status=case when p_accept then 'accepted' else 'declined' end,responded_at=now() where id=p_invite_id;
 update public.live_battle_participants set status=case when p_accept then 'accepted' else 'declined' end,joined_at=case when p_accept then now() else null end where battle_id=v_inv.battle_id and user_id=v_uid and status='invited';
 return jsonb_build_object('accepted',p_accept,'battle_id',v_inv.battle_id);
end $$;

create or replace function public.bouncy_start_live_battle(p_battle_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_b public.live_battles%rowtype; v_required integer; v_count integer; v_end timestamptz;
begin
 if v_uid is null then raise exception 'Sign in first'; end if;
 select * into v_b from public.live_battles where id=p_battle_id for update;
 if not found or v_b.created_by<>v_uid or v_b.status<>'forming' then raise exception 'Battle cannot be started'; end if;
 v_required:=case v_b.format when '1v1' then 2 when '1v1v1' then 3 when '1v1v1v1' then 4 when '1v2' then 3 when '1v3' then 4 when '1v4' then 5 when '2v2' then 4 end;
 select count(*) into v_count from public.live_battle_participants where battle_id=p_battle_id and status='accepted';
 if v_count<>v_required then raise exception 'Invite and confirm all % players first',v_required; end if;
 v_end:=now()+make_interval(mins=>v_b.duration_minutes);
 update public.live_battles set status='active',starts_at=now(),ends_at=v_end where id=p_battle_id;
 return jsonb_build_object('battle_id',p_battle_id,'starts_at',now(),'ends_at',v_end);
end $$;

create or replace function public.bouncy_record_live_battle_taps(p_battle_id uuid,p_taps integer)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_p public.live_battle_participants%rowtype; v_b public.live_battles%rowtype; v_points bigint;
begin
 if v_uid is null then raise exception 'Sign in first'; end if;
 if p_taps is null or p_taps<1 or p_taps>100 then raise exception 'Tap batch must be between 1 and 100'; end if;
 select * into v_b from public.live_battles where id=p_battle_id;
 if not found or v_b.status<>'active' or now()>v_b.ends_at then raise exception 'Battle is not active'; end if;
 select * into v_p from public.live_battle_participants where battle_id=p_battle_id and user_id=v_uid and status='accepted' for update;
 if not found then raise exception 'Only battle players can score taps'; end if;
 v_points:=p_taps*case when v_p.boost_until>now() then 2 else 1 end;
 update public.live_battle_participants set taps=taps+p_taps,boost_points=boost_points+greatest(v_points-p_taps,0) where battle_id=p_battle_id and user_id=v_uid;
 insert into public.live_battle_score_events(battle_id,user_id,event_type,points) values(p_battle_id,v_uid,'tap_batch',v_points);
 return jsonb_build_object('added_points',v_points,'boost_active',v_p.boost_until>now());
end $$;

create or replace function public.bouncy_boost_live_battle(p_battle_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_p public.live_battle_participants%rowtype; v_b public.live_battles%rowtype; v_balance integer;
begin
 if v_uid is null then raise exception 'Sign in first'; end if;
 select * into v_b from public.live_battles where id=p_battle_id and status='active' and now()<=ends_at;
 if not found then raise exception 'Battle is not active'; end if;
 select * into v_p from public.live_battle_participants where battle_id=p_battle_id and user_id=v_uid and status='accepted' for update;
 if not found then raise exception 'Only battle players can boost'; end if;
 if v_p.boost_until>now() then raise exception 'Your 2x boost is already active'; end if;
 insert into public.user_coins(user_id) values(v_uid) on conflict(user_id) do nothing;
 update public.user_coins set balance=balance-100,updated_at=now() where user_id=v_uid and balance>=100 returning balance into v_balance;
 if not found then raise exception 'You need 100 coins to boost'; end if;
 update public.live_battle_participants set boost_until=now()+interval '30 seconds',boost_uses=boost_uses+1 where battle_id=p_battle_id and user_id=v_uid;
 insert into public.live_battle_score_events(battle_id,user_id,event_type,points) values(p_battle_id,v_uid,'boost',1);
 return jsonb_build_object('balance',v_balance,'boost_until',now()+interval '30 seconds','multiplier',2);
end $$;

revoke all on function public.bouncy_create_live_battle(uuid,text,integer) from public,anon;
revoke all on function public.bouncy_invite_live_battle_player(uuid,uuid) from public,anon;
revoke all on function public.bouncy_respond_live_battle_invite(uuid,boolean) from public,anon;
revoke all on function public.bouncy_start_live_battle(uuid) from public,anon;
revoke all on function public.bouncy_record_live_battle_taps(uuid,integer) from public,anon;
revoke all on function public.bouncy_boost_live_battle(uuid) from public,anon;
grant execute on function public.bouncy_create_live_battle(uuid,text,integer) to authenticated;
grant execute on function public.bouncy_invite_live_battle_player(uuid,uuid) to authenticated;
grant execute on function public.bouncy_respond_live_battle_invite(uuid,boolean) to authenticated;
grant execute on function public.bouncy_start_live_battle(uuid) to authenticated;
grant execute on function public.bouncy_record_live_battle_taps(uuid,integer) to authenticated;
grant execute on function public.bouncy_boost_live_battle(uuid) to authenticated;
