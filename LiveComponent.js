/* BOUNCY Live component — uses the existing WebRTC + Supabase session. */
(function () {
  const $ = (root, selector) => root.querySelector(selector);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const icon = (name) => {
    const paths = {
      sliders: '<path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3"/><path d="M2 14h4m4-6h4m4 8h4"/>',
      share: '<path d="M12 16V3m0 0L7 8m5-5 5 5"/><path d="M5 13v8h14v-8"/>',
      gift: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M2 8h20V5H2z"/><path d="M12 5H8.5a2.5 2.5 0 1 1 2.5-2.5V5zm0 0h3.5A2.5 2.5 0 1 0 13 2.5V5z"/>',
      eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>',
      x: '<path d="m6 6 12 12M18 6 6 18"/>',
      mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/>',
      flip: '<path d="M20 7h-5l2-2m-2 2 2 2M4 17h5l-2 2m2-2-2-2"/><path d="M5 7a8 8 0 0 1 13-2M19 17a8 8 0 0 1-13 2"/>',
      sparkle: '<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3z"/><path d="m19 14 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z"/>',
      pause: '<path d="M8 5v14M16 5v14"/>',
      play: '<path d="m8 5 11 7-11 7z"/>'
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || '') + '</svg>';
  };

  async function refreshViewerCount(s) {
    if (!s || liveSession !== s || s.closing) return;
    const cutoff = new Date(Date.now() - 45000).toISOString();
    if (s.host) {
      await sb.from('live_viewers').delete().eq('stream_id', s.id).lt('last_seen_at', cutoff);
    }
    const q = await sb.from('live_viewers').select('user_id', { count: 'exact', head: true })
      .eq('stream_id', s.id).gte('last_seen_at', cutoff);
    if (!q.error && s._viewerCount) s._viewerCount.textContent = '👁 ' + Number(q.count || 0).toLocaleString();
  }

  async function refreshGifters(s) {
    if (!s || liveSession !== s || s.closing || !s._gifters) return;
    const q = await sb.from('live_gifts').select('sender_id,total_coins').eq('live_id', s.id);
    if (q.error) return;
    const totals = new Map();
    (q.data || []).forEach(row => totals.set(row.sender_id, (totals.get(row.sender_id) || 0) + Number(row.total_coins || 0)));
    const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    s._gifters.replaceChildren();
    if (!top.length) {
      s._gifters.append(el('span', 'live-gifter-empty', 'Top gifters'));
      return;
    }
    const ids = top.map(x => x[0]);
    const p = await sb.from('profiles').select('id,username,avatar_url').in('id', ids);
    const profiles = Object.fromEntries((p.data || []).map(x => [x.id, x]));
    top.forEach(([id, coins], i) => {
      const profile = profiles[id] || {};
      const avatar = el('img', 'live-gifter-avatar');
      avatar.src = profile.avatar_url || '';
      avatar.alt = '@' + (profile.username || 'user') + ' · ' + coins + ' coins';
      avatar.title = avatar.alt;
      avatar.loading = 'lazy';
      avatar.style.setProperty('--gifter-order', String(i));
      s._gifters.append(avatar);
    });
  }

  function spawnHeart(s, x, y, big) {
    if (!s?._heartLayer) return;
    const heart = el('span', big ? 'live-heart-float live-heart-big' : 'live-heart-float', '♥');
    heart.style.left = x + 'px';
    heart.style.top = y + 'px';
    s._heartLayer.append(heart);
    setTimeout(() => heart.remove(), big ? 950 : 1900);
  }


  async function refreshCohostPanel(s) {
    if (!s?._cohostPanel || liveSession !== s || s.closing) return;
    const list = s._cohostPanel.querySelector('.bouncy-cohost-list');
    if (!list) return;
    list.replaceChildren(el('p', '', 'Loading co-hosts…'));
    const q = await sb.from('live_cohosts').select('id,user_id,username,avatar_url,seat_number,status,is_muted_by_host,created_at').eq('live_id', s.id).order('created_at', { ascending: true });
    if (q.error) { list.replaceChildren(el('p', '', q.error.message || 'Could not load co-host requests')); return; }
    list.replaceChildren();
    const rows = q.data || [];
    if (!rows.length) list.append(el('p', '', 'No co-host requests yet.'));
    rows.forEach(row => {
      const item = el('div', 'bouncy-cohost-row');
      const info = el('div', 'bouncy-cohost-info');
      info.append(el('strong', '', '@' + (row.username || 'user')));
      info.append(el('small', '', row.status === 'accepted' ? 'Seat ' + row.seat_number + (row.is_muted_by_host ? ' · Host muted' : '') : row.status));
      item.append(info);
      const actions = el('div', 'bouncy-cohost-actions');
      const act = (label, action) => {
        const b = el('button', '', label);
        b.onclick = async () => {
          b.disabled = true;
          const r = await sb.rpc('bouncy_host_manage_live_cohost', { p_live_id: s.id, p_cohost_id: row.id, p_action: action });
          if (r.error) toast(r.error.message || 'Co-host action failed');
          else await refreshCohostPanel(s);
          b.disabled = false;
        };
        actions.append(b);
      };
      if (row.status === 'requested' || row.status === 'invited') {
        act('Accept', 'accept'); act('Decline', 'decline');
      } else if (row.status === 'accepted') {
        act(row.is_muted_by_host ? 'Unmute' : 'Mute', 'mute');
        act('Remove', 'kick');
      }
      if (actions.childNodes.length) item.append(actions);
      list.append(item);
    });
  }

  async function openCohostPanel(s) {
    if (!s?.host || !me?.id) return toast('Only the live host can manage co-hosts');
    if (s._cohostPanel) { s._cohostPanel.remove(); s._cohostPanel = null; return; }
    const panel = el('section', 'live-demo-host-panel live-cohost-panel');
    panel.append(el('strong', '', 'BOUNCY CO-HOSTS · MAX 4 PEOPLE'));
    panel.append(el('p', 'bouncy-cohost-note', 'Up to four people can share this live. Guests need camera and microphone permission to join.'));
    const settings = el('div', 'bouncy-cohost-settings');
    const allow = el('button', '', s.cohostAllowRequests === false ? 'Turn requests on' : 'Turn requests off');
    allow.onclick = async () => {
      allow.disabled = true;
      const action = s.cohostAllowRequests === false ? 'requests_on' : 'requests_off';
      const r = await sb.rpc('bouncy_host_manage_live_cohost', { p_live_id: s.id, p_cohost_id: null, p_action: action });
      if (r.error) toast(r.error.message || 'Could not update requests');
      else { s.cohostAllowRequests = action === 'requests_on'; allow.textContent = s.cohostAllowRequests ? 'Turn requests off' : 'Turn requests on'; }
      allow.disabled = false;
    };
    settings.append(allow);
    [2,3,4].forEach(n => {
      const b = el('button', '', n + ' seats');
      b.classList.toggle('active', Number(s.cohostLayout || 4) === n);
      b.onclick = async () => {
        const r = await sb.rpc('bouncy_host_manage_live_cohost', { p_live_id: s.id, p_cohost_id: null, p_action: 'layout_' + n });
        if (r.error) toast(r.error.message || 'Could not change layout');
        else { s.cohostLayout = n; const count=s._cohostGrid?.querySelectorAll('.bouncy-live-guest-tile').length||1; if(s._cohostGrid)s._cohostGrid.dataset.layout=String(Math.min(n,count)); [...settings.querySelectorAll('button')].slice(1).forEach(x => x.classList.toggle('active', x === b)); }
      };
      settings.append(b);
    });
    const inviteWrap = el('div', 'bouncy-cohost-invite');
    const search = el('input', '');
    search.placeholder = 'Invite by username'; search.autocomplete = 'off'; search.maxLength = 30;
    const invite = el('button', '', 'Invite viewer');
    const inviteStatus = el('small', '', 'Invite someone who is currently watching this live.');
    invite.onclick = async () => {
      const username = search.value.trim().replace(/^@/, '');
      if (!username) return toast('Enter a username');
      invite.disabled = true;
      const p = await sb.from('profiles').select('id,username').ilike('username', username).limit(2);
      if (p.error || !p.data?.length) inviteStatus.textContent = 'Username not found.';
      else if (p.data.length !== 1) inviteStatus.textContent = 'More than one match. Enter the exact username.';
      else {
        const r = await sb.rpc('bouncy_invite_live_cohost', { p_live_id: s.id, p_invitee_id: p.data[0].id });
        inviteStatus.textContent = r.error ? (r.error.message || 'Invite failed') : 'Invitation sent to @' + p.data[0].username + '.';
        if (!r.error) search.value = '';
      }
      invite.disabled = false;
    };
    inviteWrap.append(search, invite, inviteStatus);
    const list = el('div', 'bouncy-cohost-list');
    const close = el('button', 'live-host-panel-close', 'Close');
    close.onclick = () => { panel.remove(); s._cohostPanel = null; };
    panel.append(settings, inviteWrap, el('strong', '', 'Requests and guests'), list, close);
    s._room.append(panel); s._cohostPanel = panel;
    await refreshCohostPanel(s);
  }


  async function leaveCohost(s, button) {
    if (!button || button.disabled) return;
    button.disabled = true;
    const r = await sb.rpc('bouncy_leave_live_cohost', { p_live_id: s.id });
    if (r.error) {
      toast(r.error.message || 'Could not leave co-host seat');
      button.disabled = false;
      return;
    }
    button.textContent = '＋'; button.title = 'Request to Co-Host';
    button.classList.remove('requested');
    button.onclick = () => requestCohost(s, button);
    button.disabled = false;
    toast('You left the co-host seat');
  }

  async function requestCohost(s, button) {
    if (!me?.id) return toast('Sign in to request a co-host seat');
    if (!s || s.host || button.disabled) return;
    button.disabled = true;
    const r = await sb.rpc('bouncy_request_live_cohost', { p_live_id: s.id });
    if (r.error) { toast(r.error.message || 'Could not request a co-host seat'); button.textContent = 'Request to Co-Host'; button.disabled = false; return; }
    button.textContent = 'Co-Host request sent'; button.classList.add('requested');
    toast('Request sent to the live host');
  }


  function showCohostInvite(s, row) {
    if (!row?.id || s._cohostInvitePanel || !s._room) return;
    const panel = el('section', 'live-demo-host-panel bouncy-cohost-invite-panel');
    panel.append(el('strong', '', 'CO-HOST INVITATION'));
    panel.append(el('p', '', 'The host invited you to join this live as a co-host.'));
    const accept = el('button', 'live-host-panel-close', 'Accept invitation');
    const decline = el('button', 'live-host-panel-close', 'Decline');
    const respond = async value => {
      accept.disabled = true; decline.disabled = true;
      const r = await sb.rpc('bouncy_respond_live_cohost_invite', { p_live_id: s.id, p_accept: value });
      if (r.error) {
        toast(r.error.message || 'Could not respond to invitation');
        accept.disabled = false; decline.disabled = false; return;
      }
      panel.remove(); s._cohostInvitePanel = null;
      if (s._cohostButton) {
        s._cohostButton.textContent = value ? '×' : '＋';
        s._cohostButton.disabled = false;
        s._cohostButton.title = value ? 'Leave Co-Host' : 'Request to Co-Host';
        s._cohostButton.onclick = value ? () => leaveCohost(s, s._cohostButton) : () => requestCohost(s, s._cohostButton);
      }
      if (value) { toast('Co-host invitation accepted. Connecting camera and microphone…'); window.bouncyStartCohost?.(s); }
      else toast('Invitation declined');
    };
    accept.onclick = () => respond(true);
    decline.onclick = () => respond(false);
    panel.append(accept, decline);
    s._room.append(panel); s._cohostInvitePanel = panel;
  }

  function watchCohostChanges(s) {
    if (!s || !me?.id || s.cohostChannel) return;
    s.cohostChannel = sb.channel('bouncy-cohosts-' + s.id + '-' + me.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_cohosts', filter: 'live_id=eq.' + s.id }, async ev => {
        if (liveSession !== s || s.closing) return;
        if (s._cohostPanel) await refreshCohostPanel(s);
        if (s.host && ev.new?.user_id && ['kicked','left','declined'].includes(ev.new.status)) {
          window.bouncyRemoveCohost?.(s, ev.new.user_id);
        }
        if (!s.host && ev.new?.user_id === me.id) {
          if (s.isCohost && ev.new.status === 'accepted' && ev.old?.is_muted_by_host !== ev.new.is_muted_by_host) {
            s.cohostHostMuted = !!ev.new.is_muted_by_host;
            s.cohostStream?.getAudioTracks().forEach(t => t.enabled = !s.cohostHostMuted && !s.cohostSelfMuted);
            const mic=s._room?.querySelector('.bouncy-cohost-mic-toggle'); if(mic){mic.disabled=s.cohostHostMuted;mic.textContent=s.cohostHostMuted?'Muted by host':(s.cohostSelfMuted?'Mic off':'Mic on')}
            toast(ev.new.is_muted_by_host ? 'The host muted your microphone' : 'The host unmuted your microphone');
          }
          if (ev.new.status === 'kicked' || ev.new.status === 'left' || ev.new.status === 'declined') {
            if (s.isCohost) window.bouncyStopCohost?.(s, ev.new.status === 'kicked' ? 'The host removed you from co-host' : 'Your co-host seat ended');
          }
          if (ev.new.status === 'invited') showCohostInvite(s, ev.new);
          const button = s._cohostButton;
          if (button) {
            if (ev.new.status === 'accepted') { button.textContent = '×'; button.title = 'Leave Co-Host'; button.disabled = false; button.onclick = () => leaveCohost(s, button); }
            else if (ev.new.status === 'declined' || ev.new.status === 'kicked' || ev.new.status === 'left') { button.textContent = '＋'; button.title = 'Request to Co-Host'; button.disabled = false; button.classList.remove('requested'); button.onclick = () => requestCohost(s, button); }
            else if (ev.new.status === 'requested' || ev.new.status === 'invited') { button.textContent = '…'; button.title = 'Waiting for host'; button.disabled = true; }
          }
          if (ev.new.status === 'accepted') { toast('Co-host accepted. Connecting camera and microphone…'); window.bouncyStartCohost?.(s); }
          if (ev.new.status === 'declined') toast('The host declined your co-host request');
        }
      }).subscribe();
  }

  function openHostPanel(s) {
    if (s._hostPanel) { s._hostPanel.remove(); s._hostPanel = null; return; }
    const panel = el('section', 'live-demo-host-panel');
    const heading = el('strong', '', 'Host controls');
    const controls = el('div', 'live-host-control-grid');
    const makeControl = (symbol, label, callback) => {
      const b = el('button', 'live-host-control');
      b.innerHTML = icon(symbol) + '<span>' + label + '</span>';
      b.addEventListener('click', callback);
      controls.append(b);
      return b;
    };
    const audioTrack = () => s.stream?.getAudioTracks()[0];
    const videoTrack = () => s.stream?.getVideoTracks()[0];
    const mute = makeControl('mic', 'Mute', () => {
      const track = audioTrack();
      if (!track) return toast('Microphone is unavailable');
      track.enabled = !track.enabled;
      mute.querySelector('span').textContent = track.enabled ? 'Mute' : 'Unmute';
      mute.querySelector('svg').innerHTML = track.enabled
        ? '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/>'
        : '<path d="m3 3 18 18"/><path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 9V5a3 3 0 0 0-5.8-1M5 10a7 7 0 0 0 12 5M19 10a7 7 0 0 1-.4 2.3M12 17v5m-4 0h8"/>';
    });
    const flip = makeControl('flip', 'Flip', async () => {
      try {
        const next = s.facing === 'environment' ? 'user' : 'environment';
        const fresh = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: next }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
        const nextTrack = fresh.getVideoTracks()[0];
        const oldTrack = videoTrack();
        for (const pc of (s.pcs?.values?.() || [])) {
          const sender = pc.getSenders().find(x => x.track?.kind === 'video');
          if (sender) await sender.replaceTrack(nextTrack);
        }
        if (oldTrack) s.stream.removeTrack(oldTrack);
        s.stream.addTrack(nextTrack);
        oldTrack?.stop();
        s.facing = next;
        if (s._video) { s._video.srcObject = s.stream; s._video.play().catch(() => {}); }
      } catch (e) { toast('Could not switch camera. Check camera permission.'); }
    });
    const beauty = makeControl('sparkle', 'Enhance', () => {
      s._beautyOn = !s._beautyOn;
      if (s._video) s._video.style.filter = s._beautyOn ? 'brightness(1.08) saturate(1.14) contrast(1.04)' : '';
      beauty.classList.toggle('active', s._beautyOn);
      toast(s._beautyOn ? 'Enhance preview on' : 'Enhance preview off');
    });
    const pause = makeControl('pause', 'Pause', () => {
      const track = videoTrack();
      if (!track) return toast('Camera is unavailable');
      track.enabled = !track.enabled;
      pause.querySelector('span').textContent = track.enabled ? 'Pause' : 'Resume';
      pause.querySelector('svg').innerHTML = track.enabled ? '<path d="M8 5v14M16 5v14"/>' : '<path d="m8 5 11 7-11 7z"/>';
    });
    const battle = makeControl('gift', 'Battle', () => openBattlePanel(s));
    makeControl('eye', 'Co-Host', () => openCohostPanel(s));
    const zoomWrap = el('label', 'live-host-zoom');
    const zoomTitle = el('span', '', 'Camera zoom');
    const zoomValue = el('strong', '', '1.0×');
    const zoom = document.createElement('input');
    const zoomTrack = videoTrack();
    let zoomCaps = null;
    try { zoomCaps = zoomTrack?.getCapabilities?.()?.zoom || null; } catch (e) {}
    if (!zoomCaps || typeof zoomCaps.min !== 'number' || typeof zoomCaps.max !== 'number' || zoomCaps.max <= zoomCaps.min) zoomWrap.hidden = true;
    else {
      zoom.type = 'range';
      zoom.min = String(Math.max(0.5, zoomCaps.min));
      zoom.max = String(Math.min(2, zoomCaps.max));
      zoom.step = String(zoomCaps.step > 0 ? zoomCaps.step : 0.05);
      if (Number(zoom.max) <= Number(zoom.min)) zoomWrap.hidden = true;
      const currentZoom = Number(zoomTrack.getSettings?.().zoom || 1);
      zoom.value = String(Math.min(Number(zoom.max), Math.max(Number(zoom.min), currentZoom)));
      zoomValue.textContent = Number(zoom.value).toFixed(2).replace(/0$/, '') + '×';
      zoom.setAttribute('aria-label', 'Camera zoom');
      zoom.oninput = async () => {
        const value = Number(zoom.value);
        try {
          await zoomTrack.applyConstraints({ advanced: [{ zoom: value }] });
          s._cameraZoom = value;
          zoomValue.textContent = value.toFixed(2).replace(/0$/, '') + '×';
        } catch (e) { toast('This camera cannot apply that zoom level'); }
      };
      zoomWrap.append(zoomTitle, zoom, zoomValue);
    }
    const close = el('button', 'live-host-panel-close', 'Close Panel');
    close.onclick = () => { panel.remove(); s._hostPanel = null; };
    panel.append(heading, controls, zoomWrap, close);
    s._room.append(panel);
    s._hostPanel = panel;
  }

  function openViewerOptions(s) {
    if (s._viewerPanel) { s._viewerPanel.remove(); s._viewerPanel = null; return; }
    const panel = el('section', 'live-demo-host-panel');
    panel.append(el('strong', '', 'Live options'));
    const sound = el('button', 'live-host-panel-close', s._video?.muted ? 'Turn sound on' : 'Mute sound');
    sound.onclick = () => {
      if (!s._video) return;
      s._video.muted = !s._video.muted;
      sound.textContent = s._video.muted ? 'Turn sound on' : 'Mute sound';
    };
    const close = el('button', 'live-host-panel-close', 'Close Panel');
    close.onclick = () => { panel.remove(); s._viewerPanel = null; };
    panel.append(sound, close);
    s._room.append(panel);
    s._viewerPanel = panel;
  }


  async function openBattlePanel(s) {
    if (!s?.host || !me?.id) return toast('Only the live host can manage battles');
    if (s._battlePanel) { s._battlePanel.remove(); s._battlePanel = null; return; }
    const panel = el('section', 'live-demo-host-panel');
    panel.append(el('strong', '', 'BOUNCY LIVE BATTLE'));
    const formatLabel = el('label', '', 'Battle format');
    const format = el('select', '');
    [['1v1','1 vs 1'],['1v1v1','3 individual players'],['1v1v1v1','4 individual players'],['1v2','1 vs 2'],['1v3','1 vs 3'],['1v4','1 vs 4'],['2v2','2 vs 2']].forEach(([v,l]) => { const o=el('option','',l);o.value=v;format.append(o); });
    const durationLabel = el('label', '', 'Duration');
    const duration = el('select', '');
    [5,10,15].forEach(v=>{const o=el('option','',v+' minutes');o.value=String(v);duration.append(o);});
    const create = el('button','live-host-panel-close','Create battle');
    const status = el('p','','Choose a format and duration, then create the battle.');
    status.style.cssText='font-size:11px;line-height:1.4;margin:0;text-align:center';
    const inviteWrap = el('div','');
    inviteWrap.style.cssText='display:none;gap:7px;flex-direction:column';
    const username = el('input','');
    username.placeholder='Enter player username';
    username.autocomplete='off';
    username.maxLength=30;
    username.style.cssText='width:100%;height:40px;padding:0 12px;border-radius:12px;border:1px solid #ffffff44;background:#222;color:#fff';
    const invite = el('button','live-host-panel-close','Invite player');
    const start = el('button','live-host-panel-close','Start battle');
    start.style.display='none';
    const close = el('button','live-host-panel-close','Close');
    let battleId=null;
    create.onclick=async()=>{
      create.disabled=true;
      const r=await sb.rpc('bouncy_create_live_battle',{p_live_id:s.id,p_format:format.value,p_duration_minutes:Number(duration.value)});
      create.disabled=false;
      if(r.error){status.textContent=r.error.message||'Could not create battle';return}
      battleId=r.data;
      format.disabled=true;duration.disabled=true;create.style.display='none';inviteWrap.style.display='flex';start.style.display='';
      status.textContent='Battle created. Invite the required players. They must accept before it can start.';
      s._battleId=battleId;
    };
    invite.onclick=async()=>{
      const handle=username.value.trim().replace(/^@/,'');
      if(!handle)return toast('Enter a username');
      invite.disabled=true;
      const p=await sb.from('profiles').select('id,username').ilike('username',handle).limit(2);
      if(p.error||!p.data?.length){status.textContent='That username was not found.';invite.disabled=false;return}
      if(p.data.length!==1){status.textContent='Username lookup was not unique. Check the exact username.';invite.disabled=false;return}
      const r=await sb.rpc('bouncy_invite_live_battle_player',{p_battle_id:battleId,p_invitee_id:p.data[0].id});
      invite.disabled=false;
      if(r.error){status.textContent=r.error.message||'Could not invite player';return}
      status.textContent='Invitation sent to @'+p.data[0].username+'. Invite the next player if needed.';
      username.value='';
    };
    start.onclick=async()=>{
      start.disabled=true;
      const r=await sb.rpc('bouncy_start_live_battle',{p_battle_id:battleId});
      start.disabled=false;
      if(r.error){status.textContent=r.error.message||'Battle cannot start yet';return}
      status.textContent='Battle started. Duration: '+duration.value+' minutes.';
      start.style.display='none';
      format.disabled=true;duration.disabled=true;invite.disabled=true;
    };
    close.onclick=()=>{panel.remove();s._battlePanel=null};
    panel.append(formatLabel,format,durationLabel,duration,create,inviteWrap,status);
    inviteWrap.append(username,invite);
    panel.append(start,close);
    s._room.append(panel);
    s._battlePanel=panel;
  }


  function watchBattleInvites(s) {
    if (!s || s.host || !me?.id) return;
    const channel=sb.channel('bouncy-battle-invites-'+s.id+'-'+me.id)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'live_battle_invites',filter:'invitee_id=eq.'+me.id},payload=>{
        const invite=payload.new;
        if(!invite?.id || s._battleInvitePanel) return;
        const panel=el('section','live-demo-host-panel');
        panel.append(el('strong','','CO-HOST / BATTLE INVITATION'));
        panel.append(el('p','','The live host invited you to join a BOUNCY battle. Accepting confirms your player place; multi-person video is still being connected.'));
        const accept=el('button','live-host-panel-close','Accept invitation');
        const decline=el('button','live-host-panel-close','Decline');
        const respond=async value=>{
          accept.disabled=true;decline.disabled=true;
          const r=await sb.rpc('bouncy_respond_live_battle_invite',{p_invite_id:invite.id,p_accept:value});
          if(r.error){accept.disabled=false;decline.disabled=false;toast(r.error.message||'Could not respond to invitation');return}
          panel.remove();s._battleInvitePanel=null;
          toast(value?'Battle invitation accepted':'Invitation declined');
        };
        accept.onclick=()=>respond(true);decline.onclick=()=>respond(false);
        panel.append(accept,decline);s._room.append(panel);s._battleInvitePanel=panel;
      }).subscribe();
    s.battleInviteChannel=channel;
  }

  async function render() {
    const s = liveSession;
    if (!s) return;
    if (s.id) {
      const owner = await sb.from('live_streams').select('host_id,cohost_layout,cohost_allow_requests,cohost_enabled').eq('id', s.id).maybeSingle();
      if (!owner.error && owner.data) {
        s.hostId = owner.data.host_id;
        s.host = !!me?.id && owner.data.host_id === me.id;
        s.cohostLayout = Number(owner.data.cohost_layout || 4);
        s.cohostAllowRequests = owner.data.cohost_allow_requests !== false;
      }
    }
    const room = liveScreen('');
    room.classList.add('live-room-screen', 'live-room');
    s._room = room;

    const stage = el('div', 'live-video-wrap live-stage');
    const bgVideo = document.createElement('video');
    bgVideo.autoplay = true; bgVideo.playsInline = true; bgVideo.muted = true;
    bgVideo.className = 'live-video-blur-layer';
    bgVideo.srcObject = s.host ? s.stream : (s.remote || null);
    const video = document.createElement('video');
    video.autoplay = true; video.playsInline = true; video.muted = !!s.host;
    video.className = 'live-video-main-layer';
    video.srcObject = s.host ? s.stream : (s.remote || null);
    stage.append(bgVideo, video);
    const guestGrid = el('div', 'bouncy-live-guest-grid');
    stage.append(guestGrid);
    s._cohostGrid = guestGrid;
    s._backgroundVideo = bgVideo;
    s._video = video;

    const heartLayer = el('div', 'live-heart-layer');
    s._heartLayer = heartLayer;

    const top = el('div', 'live-demo-top');
    const identity = el('div', 'live-demo-profile');
    const avatar = el('img', 'live-demo-avatar');
    avatar.alt = 'Host avatar';
    avatar.src = s.host ? (me.avatar || me.avatar_url || '') : (s.hostAvatar || '');
    const profileText = el('div', 'live-demo-profile-text');
    const nameLine = el('div', 'live-demo-name-line');
    nameLine.append(el('strong', '', '@' + (s.host ? (me.username || 'user') : (s.hostName || 'user'))));
    if (s.hostVerified || (s.host && me.verified)) nameLine.append(el('span', 'live-demo-verified', '✓'));
    profileText.append(nameLine, el('span', 'live-demo-live', 'LIVE'));
    identity.append(avatar, profileText);

    const wallet = await sb.rpc('bouncy_get_coin_wallet');
    if (!wallet.error) s.coinWallet = wallet.data || { balance: 0, earned_coins: 0 };
    const coinValue = Number(s.host ? s.coinWallet?.earned_coins : s.coinWallet?.balance) || 0;
    const coins = el('span', 'live-demo-profile-coins', '💎 ' + coinValue.toLocaleString());
    identity.append(coins);

    const follow = el('button', 'live-demo-follow', '+ Follow');
    if (s.host) follow.hidden = true;
    else {
      const hostId = s.hostId || s.host_id;
      const check = async () => {
        const q = await sb.from('follows').select('followed_id').eq('follower_id', me.id).eq('followed_id', hostId).maybeSingle();
        if (!q.error && q.data) { follow.textContent = 'Following'; follow.classList.add('following'); }
      };
      if (hostId && me?.id) check();
      follow.onclick = async () => {
        if (!me?.id || !hostId) return toast('Sign in to follow this host');
        follow.disabled = true;
        const q = await sb.from('follows').select('followed_id').eq('follower_id', me.id).eq('followed_id', hostId).maybeSingle();
        let result;
        if (q.error) { toast('Could not check follow status'); follow.disabled = false; return; }
        if (q.data) result = await sb.from('follows').delete().eq('follower_id', me.id).eq('followed_id', hostId);
        else result = await sb.from('follows').insert({ follower_id: me.id, followed_id: hostId });
        if (result.error) toast(result.error.message || 'Could not update follow');
        else { follow.textContent = q.data ? '+ Follow' : 'Following'; follow.classList.toggle('following', !q.data); }
        follow.disabled = false;
      };
    }
    identity.append(follow);

    const right = el('div', 'live-demo-top-right');
    const gifters = el('div', 'live-demo-gifters');
    s._gifters = gifters;
    const viewerCount = el('span', 'live-demo-view-count', '👁 —');
    s._viewerCount = viewerCount;
    const close = el('button', 'live-demo-close', '×');
    close.setAttribute('aria-label', s.host ? 'End live stream' : 'Leave live stream');
    close.onclick = () => s.host ? endLiveStream(false) : leaveLiveStream(false);
    right.append(gifters, viewerCount, close);
    top.append(identity, right);

    const second = el('div', 'live-demo-sub');
    const rankGroup = el('div', 'live-demo-rank-group');
    const brand = el('span', 'live-demo-brand', 'BOUNCY');
    const rank = el('span', 'live-demo-rank', 'RANK — · Daily Popularity Hall');
    const goal = el('span', 'live-demo-goal', '🏆 Goal not set');
    rankGroup.append(brand, rank);
    second.append(rankGroup, goal);

    const giftBanner = el('div', 'live-gift-banner-stack');
    const comments = el('div', 'live-comments live-floating-comments');
    const bottom = el('div', 'live-bottom-tiktok live-bottom live-demo-bottom');
    const compose = el('div', 'live-compose live-compose-tiktok');
    const input = el('input', '');
    input.placeholder = 'Add comment...';
    input.maxLength = 500;
    const send = el('button', 'live-send-comment', 'Send');
    send.hidden = true;
    compose.append(input, send);
    bottom.append(compose);

    const options = el('button', 'live-demo-dock-button live-demo-options', '');
    options.innerHTML = icon('sliders');
    options.setAttribute('aria-label', s.host ? 'Host controls' : 'Live options');
    options.onclick = () => s.host ? openHostPanel(s) : openViewerOptions(s);
    if (!s.host) {
      const cohostRequest = el('button', 'live-demo-dock-button live-demo-cohost-request', '＋');
      cohostRequest.setAttribute('aria-label', 'Request to Co-Host');
      cohostRequest.title = 'Request to Co-Host';
      cohostRequest.onclick = () => requestCohost(s, cohostRequest);
      s._cohostButton = cohostRequest;
      const existing = await sb.from('live_cohosts').select('id,status').eq('live_id', s.id).eq('user_id', me.id).maybeSingle();
      if (!existing.error && existing.data) {
        if (existing.data.status === 'accepted') { cohostRequest.textContent = '×'; cohostRequest.disabled = false; cohostRequest.title = 'Leave Co-Host'; cohostRequest.onclick = () => leaveCohost(s, cohostRequest); }
        else if (existing.data.status === 'requested') { cohostRequest.textContent = '…'; cohostRequest.disabled = true; cohostRequest.title = 'Waiting for host'; }
        else if (existing.data.status === 'invited') { cohostRequest.textContent = '✉'; cohostRequest.title = 'Co-host invitation'; showCohostInvite(s, existing.data); }
      }
      bottom.append(cohostRequest);
    }
    const share = el('button', 'live-demo-dock-button live-demo-share', '');
    share.innerHTML = icon('share');
    share.setAttribute('aria-label', 'Share live');
    share.onclick = async () => {
      try {
        if (navigator.share) await navigator.share({ title: 'BOUNCY Live', url: location.href });
        else { await navigator.clipboard.writeText(location.href); toast('Live link copied'); }
      } catch (e) {}
    };
    const gift = el('button', 'live-demo-dock-button live-demo-gift', '');
    gift.innerHTML = icon('gift');
    gift.setAttribute('aria-label', 'Send gift');
    gift.onclick = () => openLiveGiftPanel(s, comments, stage);
    bottom.append(options, share, gift);

    room.append(stage, heartLayer, top, second, giftBanner, comments, bottom);
    liveOpenSheet(room);
    watchCohostChanges(s);
    if (!s.host) watchBattleInvites(s);
    video.play().catch(() => {});
    if (!s.host) {
      const accepted = await sb.from('live_cohosts').select('status').eq('live_id', s.id).eq('user_id', me.id).maybeSingle();
      if (!accepted.error && accepted.data?.status === 'accepted') window.bouncyStartCohost?.(s);
    }
    if (s.host) addCohostTile(s, 'host', s.stream, 'Host', true);

    let lastTap = 0;
    let singleTapTimer = null;
    stage.addEventListener('pointerup', event => {
      const rect = stage.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const now = Date.now();
      if (now - lastTap < 300) {
        clearTimeout(singleTapTimer);
        lastTap = 0;
        spawnHeart(s, x, y, true);
        sendLiveLike(s);
      } else {
        lastTap = now;
        singleTapTimer = setTimeout(() => {
          spawnHeart(s, x, y, false);
          sendLiveLike(s);
        }, 290);
      }
    });

    const renderComments = async () => {
      if (liveSession !== s || s.closing) return;
      const [q, g] = await Promise.all([
        sb.from('live_comments').select('id,user_id,body,created_at').eq('stream_id', s.id).order('created_at', { ascending: true }).limit(100),
        sb.from('live_gifts').select('id,sender_id,gift_id,quantity,created_at,gifts(name,emoji)').eq('live_id', s.id).order('created_at', { ascending: true }).limit(100)
      ]);
      if (q.error && g.error) return;
      comments.replaceChildren();
      const rows = [
        ...(q.data || []).map(x => ({ ...x, kind: 'comment' })),
        ...(g.data || []).map(x => ({ ...x, kind: 'gift' }))
      ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const ids = [...new Set(rows.map(x => x.user_id || x.sender_id).filter(Boolean))];
      const names = {};
      if (ids.length) {
        const p = await sb.from('profiles').select('id,username').in('id', ids);
        (p.data || []).forEach(x => names[x.id] = x.username);
      }
      rows.forEach(x => {
        if (x.kind === 'comment' && x.body === '__bouncy_live_like__') {
          if (!s._seenLikeIds) s._seenLikeIds = new Set();
          if (!s._seenLikeIds.has(x.id)) {
            s._seenLikeIds.add(x.id);
            if (s._seenLikeIds.size > 250) s._seenLikeIds.delete(s._seenLikeIds.values().next().value);
            if (x.user_id !== me.id) spawnHeart(s, stage.clientWidth * 0.72, stage.clientHeight * 0.72, false);
          }
          return;
        }
        const line = el('div', 'live-comment' + (x.kind === 'gift' ? ' live-gift-comment' : ''));
        line.textContent = x.kind === 'gift'
          ? '@' + (names[x.sender_id] || 'user') + ' sent ' + (x.gifts?.name || 'Gift') + ' ' + (x.gifts?.emoji || '🎁')
          : '@' + (names[x.user_id] || 'user') + ': ' + x.body;
        comments.append(line);
      });
      comments.scrollTop = comments.scrollHeight;
    };
    await renderComments();
    s.commentChannel = sb.channel('live-comments-' + s.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_comments', filter: 'stream_id=eq.' + s.id }, renderComments)
      .subscribe();

    send.onclick = async () => {
      const body = input.value.trim();
      if (!body || send.disabled) return;
      send.disabled = true;
      const r = await sb.from('live_comments').insert({ stream_id: s.id, user_id: me.id, body });
      if (r.error) toast('Comment could not be sent: ' + r.error.message);
      else input.value = '';
      send.disabled = false;
    };
    input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); send.click(); } };

    await setupLiveGifts(s, comments, stage);
    await refreshViewerCount(s);
    await refreshGifters(s);
    s.viewerCountTimer = setInterval(() => refreshViewerCount(s), 5000);
    s.giftersTimer = setInterval(() => refreshGifters(s), 15000);
    if (s.host) {
      if (!s.channel) await subscribeLiveSignals(s);
      s.heartbeat = setInterval(() => sb.from('live_streams').update({ last_heartbeat_at: new Date().toISOString() }).eq('id', s.id).eq('host_id', me.id), 20000);
    } else {
      s.heartbeat = setInterval(() => sb.from('live_viewers').update({ last_seen_at: new Date().toISOString() }).eq('stream_id', s.id).eq('user_id', me.id), 20000);
    }
  }


  function addCohostTile(s, key, stream, label, isHost=false) {
    if (!s?._cohostGrid || !stream) return;
    let tile = s._cohostGrid.querySelector('[data-cohost-key="' + CSS.escape(String(key)) + '"]');
    if (!tile) {
      tile = el('div', 'bouncy-live-guest-tile');
      tile.dataset.cohostKey = String(key);
      const v = document.createElement('video');
      v.autoplay = true; v.playsInline = true; v.muted = !!isHost;
      const tag = el('span', 'bouncy-live-guest-label', label);
      tile.append(v, tag); s._cohostGrid.append(tile);
    }
    const v = tile.querySelector('video');
    if (v.srcObject !== stream) v.srcObject = stream;
    v.muted = !!isHost; v.play().catch(() => {});
    tile.querySelector('.bouncy-live-guest-label').textContent = label;
    const count = s._cohostGrid.querySelectorAll('.bouncy-live-guest-tile').length;
    s._cohostGrid.classList.toggle('visible', count > 1);
    s._room?.classList.toggle('bouncy-live-has-cohosts', count > 1);
    if (count > 1 && s._video) s._video.muted = true;
    s._cohostGrid.dataset.layout = String(Math.min(Number(s.cohostLayout || 4), count));
  }

  function removeCohostTile(s, userId) {
    const tile = s?._cohostGrid?.querySelector('[data-cohost-key="' + CSS.escape(String(userId)) + '"]');
    tile?.remove();
    const count = s?._cohostGrid?.querySelectorAll('.bouncy-live-guest-tile').length || 0;
    s?._cohostGrid?.classList.toggle('visible', count > 1);
    s?._room?.classList.toggle('bouncy-live-has-cohosts', count > 1);
    if (count <= 1 && s?._video && !s.host) s._video.muted = false;
  }

  window.BouncyLiveComponent = {
    render,
    onCohostTrack: (s,userId,stream,username) => addCohostTile(s,userId,stream,'@' + (username || s.cohostNames?.[userId] || 'Co-host')),
    onLocalCohostStream: (s,stream) => addCohostTile(s,'self',stream,'You',true),
    onParticipantTrack: (s,streamId,stream) => {
      const entries = [...(s.participantStreams || new Map()).entries()];
      entries.forEach(([id,media],index) => addCohostTile(s,id,media,index===0?'Host':'Co-host ' + index,index===0 && s.host));
    },
    removeCohostTile,
    onGift: async (s, giftRow) => {
      if (liveSession !== s || s.closing) return;
      await renderGiftAnimation(s, giftRow);
      await refreshGifters(s);
      const wallet = await sb.rpc('bouncy_get_coin_wallet');
      if (!wallet.error) {
        s.coinWallet = wallet.data;
        const label = s._room?.querySelector('.live-demo-profile-coins');
        if (label) label.textContent = '💎 ' + Number((s.host || s.isCohost) ? (wallet.data?.earned_coins || 0) : (wallet.data?.balance || 0)).toLocaleString();
      }
    }
  };
})();
