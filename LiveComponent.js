/* BOUNCY LIVE: Supabase streams, WebRTC, chat, wallet and gifts */
(()=>{'use strict';
const giftsMap={rose:['🌹','Rose'],finger_heart:['🫰','Finger Heart'],perfume:['🧴','Perfume'],sports_car:['🏎️','Sports Car'],yacht:['🛥️','Super Yacht'],private_jet:['✈️','Private Jet'],castle:['🏰','Royal Castle'],universe:['🌌','The Universe'],bouncy_galaxy:['🚀','Bouncy Galaxy']};
const rtc={iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]};
const db=()=>typeof sb!=='undefined'?sb:null, user=()=>typeof me!=='undefined'?me:null;
const say=t=>typeof toast==='function'?toast(t):console.log(t);
const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!=null)n.textContent=txt;return n};
let ui=null,live=null,signalCh=null,viewerCh=null,commentCh=null,giftCh=null,walletCh=null,streamCh=null,heartbeat=null;
let peers=new Map(),candidateQueue=new Map(),giftList=[],coinBalance=0,diamonds=0,camFacing='user';
const username=u=>u?.display||u?.username||u?.user_metadata?.username||'BOUNCY user';
async function profile(id){const r=await db().from('profiles').select('username,display_name').eq('id',id).maybeSingle();return r.data?.display_name||r.data?.username||'BOUNCY user'}
function build(){
 if(ui?.isConnected)return ui;
 ui=el('section','b-live-root');ui.id='bouncy-live';
 ui.innerHTML='<div class="b-live-stage"><video class="b-live-video" autoplay playsinline></video><div class="b-live-gradient"></div></div><div class="b-live-head"><div class="b-live-host"><span class="b-live-avatar">B</span><span><b class="b-live-name">BOUNCY LIVE</b><small class="b-live-sub">Discover live creators</small></span></div><div class="b-live-head-right"><span class="b-live-count">● 0</span><button class="b-live-x">×</button></div></div><div class="b-live-effects"></div><div class="b-live-chat"></div><div class="b-live-controls"><input class="b-live-message" maxlength="300" placeholder="Say something…"><button class="b-live-send">Send</button><button class="b-live-gift">🎁</button><button class="b-live-heart">♥</button></div><div class="b-live-host-tools"><button data-do="mute">Mute</button><button data-do="flip">Flip</button><button data-do="end">End LIVE</button></div><div class="b-live-gifts" hidden><header><b>Send a gift</b><button data-do="giftclose">×</button></header><p>Coins: <b class="b-live-coins">0</b></p><div class="b-live-gift-list"></div></div><div class="b-live-toast"></div>';
 document.body.append(ui);
 ui.querySelector('.b-live-x').onclick=()=>live?.role==='host'?end():close();
 ui.querySelector('.b-live-send').onclick=sendComment;
 ui.querySelector('.b-live-message').onkeydown=e=>{if(e.key==='Enter')sendComment()};
 ui.querySelector('.b-live-gift').onclick=()=>{if(!user()){say('Log in to send gifts');return}ui.querySelector('.b-live-gifts').hidden=false;loadWallet();loadGifts()};
 ui.querySelector('.b-live-heart').onclick=()=>{const h=el('span','b-live-heart-float','♥');ui.querySelector('.b-live-effects').append(h);setTimeout(()=>h.remove(),1000)};
 ui.querySelector('[data-do="mute"]').onclick=toggleMute;
 ui.querySelector('[data-do="flip"]').onclick=flip;
 ui.querySelector('[data-do="end"]').onclick=end;
 ui.querySelector('[data-do="giftclose"]').onclick=()=>ui.querySelector('.b-live-gifts').hidden=true;
 return ui;
}
function status(t){if(!ui)return;const n=ui.querySelector('.b-live-toast');n.textContent=t;n.classList.add('show');setTimeout(()=>n.classList.remove('show'),2500)}
function header(name,title){ui.querySelector('.b-live-name').textContent='@'+name;ui.querySelector('.b-live-avatar').textContent=name.slice(0,1).toUpperCase();ui.querySelector('.b-live-sub').textContent=title||'LIVE'}
function video(stream,muted=true){const v=ui.querySelector('.b-live-video');v.srcObject=stream;v.muted=muted;v.play().catch(()=>{})}
async function loadWallet(){
 if(!user()||!db())return;const r=await db().rpc('bouncy_get_coin_wallet');
 if(r.error){status('Wallet unavailable');return}
 coinBalance=Number(r.data.balance||0);diamonds=Number(r.data.earned_coins||0);walletUI();
 if(walletCh)db().removeChannel(walletCh);
 walletCh=db().channel('bouncy-live-wallet-'+user().id).on('postgres_changes',{event:'UPDATE',schema:'public',table:'coin_wallets',filter:'user_id=eq.'+user().id},e=>{coinBalance=Number(e.new.balance||0);diamonds=Number(e.new.earned_coins||0);walletUI()}).subscribe();
}
function walletUI(){if(ui){ui.querySelector('.b-live-coins').textContent=coinBalance.toLocaleString('en-ZA');ui.querySelector('.b-live-sub').textContent=live?.role==='host'?'◆ '+diamonds.toLocaleString('en-ZA')+' diamonds':ui.querySelector('.b-live-sub').textContent}}
async function loadGifts(){
 const r=await db().from('gifts').select('id,name,emoji,coin_cost').order('coin_cost');if(r.error){status('Gift catalogue unavailable');return}
 giftList=r.data||[];const box=ui.querySelector('.b-live-gift-list');box.replaceChildren();
 giftList.forEach(g=>{const b=el('button','b-live-gift-item');b.append(el('span','',g.emoji),el('b','',g.name),el('small','',g.coin_cost.toLocaleString()+' coins'));b.onclick=()=>sendGift(g);box.append(b)});
}
function giftFX(id,sender,name,emoji){
 if(!ui?.isConnected)return false;const g=giftsMap[id]||[emoji||'🎁',name||'Gift'];
 const banner=el('div','b-live-gift-banner');banner.append(el('span','b-live-gift-icon',g[0]),el('b','', '@'+sender+' sent '+g[1]));
 ui.querySelector('.b-live-effects').append(banner);const p=el('span','b-live-gift-particle',g[0]);ui.querySelector('.b-live-effects').append(p);
 setTimeout(()=>banner.remove(),3800);setTimeout(()=>p.remove(),2500);return true;
}
window.triggerGiftAnimation=giftFX;
async function sendGift(g){
 const b=ui.querySelector('.b-live-gift-item');if(b)b.disabled=true;
 const r=await db().rpc('bouncy_send_live_gift',{p_live_id:live.stream.id,p_gift_id:g.id,p_quantity:1,p_recipient_id:live.stream.host_id});
 if(r.error){status(r.error.message==='Not enough coins'?'Not enough coins in your wallet':r.error.message);if(b)b.disabled=false;return}
 coinBalance=Number(r.data.balance);walletUI();ui.querySelector('.b-live-gifts').hidden=true;status(g.name+' sent!');if(b)b.disabled=false;
}
async function signal(to,type,payload){
 const r=await db().from('live_signals').insert({stream_id:live.stream.id,sender_id:user().id,recipient_id:to,signal_type:type,payload});
 if(r.error)console.warn('LIVE signal error',r.error.message);
}
function subscribeSignals(){
 if(signalCh)db().removeChannel(signalCh);
 signalCh=db().channel('bouncy-live-signals-'+live.stream.id+'-'+user().id)
 .on('postgres_changes',{event:'INSERT',schema:'public',table:'live_signals',filter:'recipient_id=eq.'+user().id},async e=>{
  const x=e.new;if(!live||x.stream_id!==live.stream.id)return;
  try{
   if(live.role==='host'){
    const pc=peers.get(x.sender_id);if(!pc)return;
    if(x.signal_type==='answer'&&pc.signalingState==='have-local-offer'){await pc.setRemoteDescription(x.payload);for(const c of candidateQueue.get(x.sender_id)||[])await pc.addIceCandidate(c);candidateQueue.delete(x.sender_id)}
    if(x.signal_type==='candidate'){if(pc.remoteDescription)await pc.addIceCandidate(x.payload);else candidateQueue.set(x.sender_id,[...(candidateQueue.get(x.sender_id)||[]),x.payload])}
   }else{
    const pc=live.pc;if(!pc)return;
    if(x.signal_type==='offer'&&pc.signalingState==='stable'){await pc.setRemoteDescription(x.payload);const a=await pc.createAnswer();await pc.setLocalDescription(a);await signal(live.stream.host_id,'answer',pc.localDescription.toJSON());for(const c of live.candidates.splice(0))await pc.addIceCandidate(c)}
    if(x.signal_type==='candidate'){if(pc.remoteDescription)await pc.addIceCandidate(x.payload);else live.candidates.push(x.payload)}
   }
  }catch(err){console.error(err);status('Could not connect video')}
 }).subscribe();
}
async function makePeer(id){
 if(!live||live.role!=='host'||peers.has(id)||!live.media)return;
 const pc=new RTCPeerConnection(rtc);peers.set(id,pc);live.media.getTracks().forEach(t=>pc.addTrack(t,live.media));
 pc.onicecandidate=e=>{if(e.candidate)signal(id,'candidate',e.candidate.toJSON())};
 pc.onconnectionstatechange=()=>{if(['closed','failed'].includes(pc.connectionState)){peers.delete(id);pc.close()}};
 const offer=await pc.createOffer();await pc.setLocalDescription(offer);await signal(id,'offer',pc.localDescription.toJSON());
}
async function count(){
 if(!live)return;const r=await db().from('live_viewers').select('id',{count:'exact',head:true}).eq('stream_id',live.stream.id);
 if(ui)ui.querySelector('.b-live-count').textContent='● '+(r.count||0);
}
async function chatSetup(){
 const id=live.stream.id;await loadGifts();
 const old=await db().from('live_comments').select('id,user_id,message').eq('live_id',id).order('created_at',{ascending:false}).limit(20);
 (old.data||[]).reverse().forEach(x=>showComment(x));
 if(commentCh)db().removeChannel(commentCh);
 commentCh=db().channel('b-live-chat-'+id).on('postgres_changes',{event:'INSERT',schema:'public',table:'live_comments',filter:'live_id=eq.'+id},e=>showComment(e.new)).subscribe();
 if(giftCh)db().removeChannel(giftCh);
 giftCh=db().channel('b-live-gift-feed-'+id).on('postgres_changes',{event:'INSERT',schema:'public',table:'live_gifts',filter:'live_id=eq.'+id},async e=>{
  const g=giftList.find(x=>x.id===e.new.gift_id)||{name:e.new.gift_id,emoji:'🎁'};
  giftFX(e.new.gift_id,await profile(e.new.sender_id),g.name,g.emoji);
 }).subscribe();
 if(streamCh)db().removeChannel(streamCh);
 streamCh=db().channel('b-live-stream-status-'+id).on('postgres_changes',{event:'UPDATE',schema:'public',table:'live_streams',filter:'id=eq.'+id},e=>{if(live?.role==='viewer'&&e.new.status==='ended'){status('LIVE ended');setTimeout(close,1000)}}).subscribe();
 await count();
}
async function showComment(x){
 const who=await profile(x.user_id);if(!ui?.isConnected)return;
 const row=el('div','b-live-comment');row.append(el('b','', '@'+who),document.createTextNode(' '+x.message));
 const box=ui.querySelector('.b-live-chat');box.append(row);while(box.children.length>25)box.firstChild.remove();box.scrollTop=box.scrollHeight;
}
async function sendComment(){
 if(!live||!user())return;const input=ui.querySelector('.b-live-message'),message=input.value.trim();if(!message)return;input.value='';
 const r=await db().from('live_comments').insert({live_id:live.stream.id,user_id:user().id,message});
 if(r.error){input.value=message;status('Comment could not send')}
}
async function startHost(title){
 const u=user();if(!u){say('Log in first');return}
 const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'user'}},audio:{echoCancellation:true,noiseSuppression:true}});
 const room='bouncy-'+(crypto.randomUUID?.()||Date.now()+'-'+Math.random().toString(16).slice(2));
 const r=await db().from('live_streams').insert({host_id:u.id,title:title||'Live Stream',room_name:room}).select().single();
 if(r.error){media.getTracks().forEach(t=>t.stop());status(r.error.message);return}
 live={role:'host',stream:r.data,media};window.liveSession=live;live._room=ui;ui.classList.add('b-live-host-mode');
 video(media,true);header(username(u),r.data.title);ui.querySelector('.b-live-host-tools').hidden=false;ui.querySelector('.b-live-gift').hidden=true;
 subscribeSignals();
 viewerCh=db().channel('b-live-viewers-'+r.data.id)
 .on('postgres_changes',{event:'INSERT',schema:'public',table:'live_viewers',filter:'stream_id=eq.'+r.data.id},e=>makePeer(e.new.user_id))
 .on('postgres_changes',{event:'DELETE',schema:'public',table:'live_viewers',filter:'stream_id=eq.'+r.data.id},e=>{peers.get(e.old.user_id)?.close();peers.delete(e.old.user_id);count()})
 .subscribe(async s=>{if(s==='SUBSCRIBED'){const q=await db().from('live_viewers').select('user_id').eq('stream_id',r.data.id);(q.data||[]).forEach(v=>makePeer(v.user_id))}});
 heartbeat=setInterval(()=>db().from('live_streams').update({last_heartbeat_at:new Date().toISOString()}).eq('id',r.data.id),25000);
 await chatSetup();await loadWallet();status('You are LIVE');
}
async function join(stream){
 live={role:'viewer',stream,pc:new RTCPeerConnection(rtc),candidates:[]};window.liveSession=live;live._room=ui;
 ui.querySelector('.b-live-host-tools').hidden=true;ui.querySelector('.b-live-gift').hidden=false;ui.classList.remove('b-live-host-mode');
 header(await profile(stream.host_id),stream.title);subscribeSignals();
 const pc=live.pc;pc.ontrack=e=>video(e.streams[0],true);pc.onicecandidate=e=>{if(e.candidate)signal(stream.host_id,'candidate',e.candidate.toJSON())};
 pc.onconnectionstatechange=()=>{if(pc.connectionState==='connected')status('Connected');if(pc.connectionState==='failed')status('Connection failed — network relay may be needed')};
 const r=await db().from('live_viewers').upsert({stream_id:stream.id,user_id:user().id},{onConflict:'stream_id,user_id'});
 if(r.error){status(r.error.message);await close();return}
 await chatSetup();await loadWallet();status('Joining LIVE…');
}
async function browse(){
 const u=user();if(!u){if(typeof authSheet==='function')authSheet('watch LIVE streams');return}
 build();ui.classList.add('b-live-browse-mode');ui.querySelector('.b-live-host-tools').hidden=true;ui.querySelector('.b-live-gift').hidden=true;
 const list=el('div','b-live-browse-list'),top=el('div','b-live-browse-title');top.append(el('b','', 'LIVE on BOUNCY'));
 const start=el('button','b-live-start','＋ Go LIVE');start.onclick=()=>startForm();top.append(start);list.append(top);
 const r=await db().from('live_streams').select('id,host_id,title,room_name,started_at') .eq('status','live').gt('last_heartbeat_at',new Date(Date.now()-90000).toISOString()).order('started_at',{ascending:false}).limit(30);
 if(r.error)list.append(el('p','',r.error.message));
 else if(!r.data?.length)list.append(el('p','b-live-empty','No one is LIVE right now. Start the first stream.'));
 else{
  const ids=[...new Set(r.data.map(x=>x.host_id))],p=await db().from('profiles').select('id,username,display_name').in('id',ids),map={};(p.data||[]).forEach(x=>map[x.id]=x);
  r.data.forEach(s=>{const pr=map[s.host_id]||{},b=el('button','b-live-stream-card');b.append(el('small','b-live-badge','● LIVE'),el('b','',pr.display_name||pr.username||'Creator'),el('span','',s.title||'Live Stream'));b.onclick=()=>{list.remove();ui.classList.remove('b-live-browse-mode');ui.querySelector('.b-live-controls').hidden=false;join(s)};list.append(b)});
 }
 ui.append(list);ui.querySelector('.b-live-controls').hidden=true;ui.querySelector('.b-live-gifts').hidden=true;loadWallet();
}
function startForm(){
 const f=el('div','b-live-form'),i=el('input','');i.placeholder='LIVE title (optional)';i.maxLength=80;
 const go=el('button','b-live-start','Start LIVE'),cancel=el('button','b-live-cancel','Cancel');
 go.onclick=async()=>{go.disabled=true;try{await startHost(i.value.trim());f.remove();ui.querySelector('.b-live-controls').hidden=false;ui.classList.remove('b-live-browse-mode');ui.querySelector('.b-live-browse-list')?.remove()}catch(e){status('Allow camera and microphone access');go.disabled=false}};
 cancel.onclick=()=>f.remove();f.append(el('h3','','Start your LIVE'),i,go,cancel);ui.append(f);
}
async function toggleMute(){const t=live?.media?.getAudioTracks()[0];if(!t)return;t.enabled=!t.enabled;ui.querySelector('[data-do="mute"]').textContent=t.enabled?'Mute':'Unmute'}
async function flip(){
 if(!live?.media)return;try{camFacing=camFacing==='user'?'environment':'user';const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:camFacing}},audio:false}),t=s.getVideoTracks()[0];
 live.media.getVideoTracks().forEach(x=>{live.media.removeTrack(x);x.stop()});live.media.addTrack(t);
 for(const pc of peers.values()){const sender=pc.getSenders().find(x=>x.track?.kind==='video');if(sender)await sender.replaceTrack(t)}
 video(live.media,true)}catch(e){status('Camera switch failed')}
}
async function end(){
 if(live?.role!=='host'||!confirm('End your LIVE?'))return;
 await db().from('live_streams').update({status:'ended',ended_at:new Date().toISOString()}).eq('id',live.stream.id);await close();say('LIVE ended');
}
async function close(){
 const old=live;if(heartbeat)clearInterval(heartbeat);heartbeat=null;
 if(old?.role==='viewer'&&user())await db().from('live_viewers').delete().eq('stream_id',old.stream.id).eq('user_id',user().id);
 old?.media?.getTracks().forEach(t=>t.stop());old?.pc?.close();for(const p of peers.values())p.close();peers.clear();candidateQueue.clear();
 [signalCh,viewerCh,commentCh,giftCh,walletCh,streamCh].filter(Boolean).forEach(c=>db()?.removeChannel(c));
 signalCh=viewerCh=commentCh=giftCh=walletCh=streamCh=null;live=null;window.liveSession=null;
 ui?.remove();ui=null;
}
function launcher(){
 let b=document.getElementById('liveOpen')||document.getElementById('b-live-launch');
 if(!b){b=el('button','feed-live-btn','LIVE');b.id='liveOpen';const target=document.querySelector('#app .feed-head-actions')||document.querySelector('#app header')||document.querySelector('header')||document.body;target.prepend(b)}
 b.classList.add('b-live-launch');b.type='button';b.onclick=e=>{e.preventDefault();browse()};
}
function init(){launcher();if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',launcher,{once:true});window.addEventListener('pagehide',()=>{if(live?.role==='viewer'&&user())db()?.from('live_viewers').delete().eq('stream_id',live.stream.id).eq('user_id',user().id)})}
init();
})();