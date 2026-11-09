-- BOUNCY Gifts Phase 1: free test coins only. No payment processing.
create table if not exists public.user_coins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 1000 check (balance >= 0),
  earned_coins integer not null default 0 check (earned_coins >= 0),
  free_coins_claimed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.gifts (
  id text primary key,
  name text not null,
  emoji text not null,
  coin_cost integer not null check (coin_cost > 0),
  animation_type text not null default 'pop'
);

insert into public.gifts (id,name,emoji,coin_cost,animation_type) values
 ('rose','Rose','🌹',1,'pop'),
 ('heart','Heart','❤️',5,'float'),
 ('fire','Fire','🔥',10,'flame'),
 ('crown','Crown','👑',50,'shine'),
 ('lion','Lion','🦁',100,'roar'),
 ('diamond','Diamond','💎',500,'sparkle')
on conflict (id) do update set name=excluded.name,emoji=excluded.emoji,coin_cost=excluded.coin_cost,animation_type=excluded.animation_type;

create table if not exists public.live_gifts (
  id uuid primary key default gen_random_uuid(),
  live_id uuid not null references public.live_streams(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  host_id uuid not null references auth.users(id) on delete cascade,
  gift_id text not null references public.gifts(id),
  quantity integer not null check (quantity between 1 and 20),
  total_coins integer not null check (total_coins > 0),
  created_at timestamptz not null default now()
);
create index if not exists live_gifts_live_created_idx on public.live_gifts(live_id,created_at desc);
create index if not exists live_gifts_host_created_idx on public.live_gifts(host_id,created_at desc);

alter table public.user_coins enable row level security;
alter table public.gifts enable row level security;
alter table public.live_gifts enable row level security;

drop policy if exists "Users can read their own coin wallet" on public.user_coins;
create policy "Users can read their own coin wallet" on public.user_coins for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "Authenticated users can read gift catalogue" on public.gifts;
create policy "Authenticated users can read gift catalogue" on public.gifts for select to authenticated using (true);
drop policy if exists "Live participants can read gifts in active streams" on public.live_gifts;
create policy "Live participants can read gifts in active streams" on public.live_gifts for select to authenticated using (
 exists(select 1 from public.live_streams s where s.id=live_gifts.live_id and s.status='live')
);

grant select on public.user_coins,public.gifts,public.live_gifts to authenticated;
revoke insert,update,delete on public.user_coins,public.gifts,public.live_gifts from anon,authenticated;

create or replace function public.bouncy_get_coin_wallet()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_wallet public.user_coins%rowtype;
begin
 if v_uid is null then raise exception 'Sign in to use gifts'; end if;
 insert into public.user_coins(user_id) values(v_uid) on conflict(user_id) do nothing;
 select * into v_wallet from public.user_coins where user_id=v_uid;
 return jsonb_build_object('balance',v_wallet.balance,'earned_coins',v_wallet.earned_coins,'free_coins_claimed_at',v_wallet.free_coins_claimed_at);
end;
$$;

create or replace function public.bouncy_claim_free_coins()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_wallet public.user_coins%rowtype;
begin
 if v_uid is null then raise exception 'Sign in to claim free coins'; end if;
 insert into public.user_coins(user_id) values(v_uid) on conflict(user_id) do nothing;
 update public.user_coins set balance=balance+1000,free_coins_claimed_at=now(),updated_at=now()
 where user_id=v_uid and (free_coins_claimed_at is null or free_coins_claimed_at<=now()-interval '24 hours')
 returning * into v_wallet;
 if not found then raise exception 'Free coins are available once every 24 hours'; end if;
 return jsonb_build_object('balance',v_wallet.balance,'earned_coins',v_wallet.earned_coins,'free_coins_claimed_at',v_wallet.free_coins_claimed_at);
end;
$$;

create or replace function public.bouncy_send_live_gift(p_live_id uuid,p_gift_id text,p_quantity integer default 1)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_host uuid; v_cost integer; v_emoji text; v_name text; v_total integer; v_balance integer; v_earned integer;
begin
 if v_uid is null then raise exception 'Sign in to send gifts'; end if;
 if p_quantity is null or p_quantity<1 or p_quantity>20 then raise exception 'Gift quantity must be between 1 and 20'; end if;
 select s.host_id into v_host from public.live_streams s where s.id=p_live_id and s.status='live' and s.last_heartbeat_at>now()-interval '60 seconds';
 if v_host is null then raise exception 'This live stream is no longer active'; end if;
 if v_host=v_uid then raise exception 'You cannot send gifts to yourself'; end if;
 select g.coin_cost,g.emoji,g.name into v_cost,v_emoji,v_name from public.gifts g where g.id=p_gift_id;
 if v_cost is null then raise exception 'Gift not found'; end if;
 v_total:=v_cost*p_quantity;
 insert into public.user_coins(user_id) values(v_uid),(v_host) on conflict(user_id) do nothing;
 update public.user_coins set balance=balance-v_total,updated_at=now() where user_id=v_uid and balance>=v_total returning balance into v_balance;
 if not found then raise exception 'Not enough coins'; end if;
 update public.user_coins set earned_coins=earned_coins+v_total,updated_at=now() where user_id=v_host returning earned_coins into v_earned;
 insert into public.live_gifts(live_id,sender_id,host_id,gift_id,quantity,total_coins) values(p_live_id,v_uid,v_host,p_gift_id,p_quantity,v_total);
 return jsonb_build_object('gift_id',p_gift_id,'gift_name',v_name,'emoji',v_emoji,'quantity',p_quantity,'total_coins',v_total,'balance',v_balance,'host_earned_coins',v_earned);
end;
$$;

revoke all on function public.bouncy_get_coin_wallet() from public,anon;
revoke all on function public.bouncy_claim_free_coins() from public,anon;
revoke all on function public.bouncy_send_live_gift(uuid,text,integer) from public,anon;
grant execute on function public.bouncy_get_coin_wallet() to authenticated;
grant execute on function public.bouncy_claim_free_coins() to authenticated;
grant execute on function public.bouncy_send_live_gift(uuid,text,integer) to authenticated;

do $$
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime')
 and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='live_gifts') then
  alter publication supabase_realtime add table public.live_gifts;
 end if;
end;
$$;
