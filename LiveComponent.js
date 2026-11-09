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
          video: { facingMode: { ideal: next }, width: { ideal: 720 }, height: { ideal: 1280 } },
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
    const close = el('button', 'live-host-panel-close', 'Close Panel');
    close.onclick = () => { panel.remove(); s._hostPanel = null; };
    panel.append(heading, controls, close);
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

  async function render() {
    const s = liveSession;
    if (!s) return;
    const room = liveScreen('');
    room.classList.add('live-room-screen', 'live-room');
    s._room = room;

    const stage = el('div', 'live-video-wrap live-stage');
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = !!s.host;
    video.srcObject = s.host ? s.stream : (s.remote || null);
    stage.append(video);
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
    const rank = el('span', 'live-demo-rank', 'RANK — · Daily Popularity Hall');
    const goal = el('span', 'live-demo-goal', '🏆 Goal not set');
    second.append(rank, goal);

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

    const sound = el('button', 'live-demo-sound', '🔊');
    sound.setAttribute('aria-label', 'Toggle sound');
    sound.onclick = () => { video.muted = !video.muted; sound.textContent = video.muted ? '🔇' : '🔊'; };
    if (!s.host) identity.append(sound);

    room.append(stage, heartLayer, top, second, giftBanner, comments, bottom);
    liveOpenSheet(room);
    video.play().catch(() => {});

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
        if (x.kind === 'comment' && x.body === '__bouncy_live_like__') return;
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

  window.BouncyLiveComponent = {
    render,
    onGift: async (s, giftRow) => {
      if (liveSession !== s || s.closing) return;
      await renderGiftAnimation(s, giftRow);
      await refreshGifters(s);
      const wallet = await sb.rpc('bouncy_get_coin_wallet');
      if (!wallet.error) {
        s.coinWallet = wallet.data;
        if (s.host) {
          const label = s._room?.querySelector('.live-demo-profile-coins');
          if (label) label.textContent = '💎 ' + Number(wallet.data?.earned_coins || 0).toLocaleString();
        }
      }
    }
  };
})();
