/* ============================================================
   BOUNCY High-Roller Gift Screen Animation Trigger
   Presentation only: wallet/diamond balances must be updated
   by the trusted gift transaction, not by this animation.
   ============================================================ */

(() => {
  'use strict';

  const giftMap = {
    rose: { emoji: '🌹', name: 'Rose' },
    finger_heart: { emoji: '🫰', name: 'Finger Heart' },
    perfume: { emoji: '🧴', name: 'Perfume' },
    sports_car: { emoji: '🏎️', name: 'Sports Car' },
    yacht: { emoji: '🛥️', name: 'Super Yacht' },
    private_jet: { emoji: '✈️', name: 'Private Jet' },
    universe: { emoji: '🌌', name: 'The Universe' },
    bouncy_galaxy: { emoji: '🚀', name: 'Bouncy Galaxy' }
  };

  window.triggerGiftAnimation = function (
    giftId,
    senderName = 'You',
    giftName = 'Gift',
    emoji = '🎁'
  ) {
    // The app's future LIVE controller must expose its current session here.
    const session = (typeof liveSession !== 'undefined')
      ? liveSession
      : window.liveSession;

    const room = session && session._room;
    if (!room || !room.isConnected) return false;

    const item = giftMap[giftId] || {
      emoji: String(emoji || '🎁'),
      name: String(giftName || 'Gift')
    };

    let container = room.querySelector('.live-gift-banner-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'live-gift-banner-container';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-atomic', 'false');
      room.appendChild(container);
    }

    const banner = document.createElement('div');
    banner.className = 'live-gift-banner';

    const icon = document.createElement('div');
    icon.className = 'live-gift-banner-icon';
    icon.textContent = item.emoji;

    const textWrap = document.createElement('div');
    textWrap.className = 'live-gift-banner-text';

    const title = document.createElement('span');
    title.className = 'live-gift-banner-title';
    title.textContent = '@' + String(senderName || 'Someone') + ' sent ' + item.name;

    const sub = document.createElement('span');
    sub.className = 'live-gift-banner-sub';
    sub.textContent = 'BOUNCY LIVE gift';

    textWrap.append(title, sub);
    banner.append(icon, textWrap);
    container.appendChild(banner);

    const particle = document.createElement('div');
    particle.className = 'floating-gift-particle';
    particle.setAttribute('aria-hidden', 'true');
    particle.textContent = item.emoji;
    room.appendChild(particle);

    window.setTimeout(() => {
      banner.style.transition = 'opacity .4s ease, transform .4s ease';
      banner.style.opacity = '0';
      window.setTimeout(() => banner.remove(), 450);
    }, 3500);

    window.setTimeout(() => particle.remove(), 2600);
    return true;
  };
})();

/* update probe */
