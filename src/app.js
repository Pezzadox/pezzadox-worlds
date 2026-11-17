// Pezzadox Worlds: the app shell. Content comes live from pezzadox.com, with a built-in
// snapshot (data/episodes.json) so the app is useful offline and on first launch.
import { Capacitor } from '@capacitor/core';
import { InAppBrowser, DefaultWebViewOptions } from '@capacitor/inappbrowser';
import { LocalNotifications } from '@capacitor/local-notifications';
import { BackgroundRunner } from '@capacitor/background-runner';
import { Share } from '@capacitor/share';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { SplashScreen } from '@capacitor/splash-screen';

const SITE = 'https://www.pezzadox.com';
const RUNNER = 'com.pezzadox.worlds.episodes';
const native = Capacitor.isNativePlatform();
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- storage ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('pw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pw.' + k, JSON.stringify(v)); } catch {} }
};

// ---------- content ----------
const SHOWS = [
  { em: '🎙️', name: 'The Pezzadox Show', blurb: 'The flagship sit-down podcast', url: SITE + '/shows.html' },
  { em: '👻', name: 'Parag-Gators', blurb: 'Paranormal investigations', url: SITE + '/shows.html' },
  { em: '💘', name: '1 vs 15 Speed Dating', blurb: 'One single, fifteen dates', url: SITE + '/shows.html' }
];
const GAMES = [
  { em: '🚀', name: 'Boglin Skies', blurb: 'Jetpack through the TV towers.', url: '/games.html', g: 'linear-gradient(160deg,#1b5c8a,#07060F)' },
  { em: '🎯', name: 'Big Target Man', blurb: 'Aim and time your power shots.', url: '/games.html', g: 'linear-gradient(160deg,#8a1b4f,#07060F)' },
  { em: '🧟', name: 'Dimension Z', blurb: 'Top-down zombie arena.', url: '/games.html', g: 'linear-gradient(160deg,#2f6b1b,#07060F)' },
  { em: '🟦', name: 'Pezza Dash', blurb: 'Four levels of portals.', url: '/games.html', g: 'linear-gradient(160deg,#3a2a9a,#07060F)' },
  { em: '⚡', name: 'Weird Science Lab', blurb: 'Build, zap, get a Match Report.', url: '/games.html', g: 'linear-gradient(160deg,#6b1b8a,#07060F)' },
  { em: '👑', name: 'King of Ink', blurb: "Feed the tattooed king. Dodge the bombs.", url: '/games/king-of-ink.html', g: 'linear-gradient(160deg,#8a5a1b,#07060F)' },
  { em: '🦖', name: 'Dino Dash', blurb: "John Ledward's endless runner.", url: '/games/dino-dash.html', g: 'linear-gradient(160deg,#1b8a6b,#07060F)' },
  { em: '📻', name: 'Save the Podcast', blurb: 'Pick a hero. Escape the studio.', url: '/games/save-the-podcast.html', g: 'linear-gradient(160deg,#8a1b1b,#07060F)' }
];
const TOPICS = ['All', 'Sport', 'Mind', 'Comedy & Entertainment', 'Faith & Paranormal', 'Business & Politics', 'Roundups'];

let episodes = store.get('episodes', null);
let seen = new Set(store.get('seen', []));
let topic = 'All', query = '';

function duration(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(iso || '');
  if (!m) return '';
  const h = +(m[1] || 0), mins = +(m[2] || 0);
  return h ? `${h}h ${mins}m` : `${mins}m`;
}
const clip = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n).replace(/\s\S*$/, '') + '…' : t; };
const clock = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const epLabel = e => (e.show === 'Parag-Gators' ? 'PG ' : 'EP ') + e.ep;
const isNew = e => !seen.has(e.slug);

async function loadSnapshot() {
  if (episodes && episodes.length) return;
  const r = await fetch('data/episodes.json');
  const data = await r.json();
  episodes = data.episodes;
  store.set('shorts', data.shorts || []);
  seen = new Set(episodes.map(e => e.slug));   // everything shipped with the app counts as seen
  store.set('episodes', episodes); store.set('seen', [...seen]);
}

// Reads one episode page: the JSON-LD block carries the title, video, length and topic.
function parseEpisode(slug, html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let ld = {};
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try { const j = JSON.parse(s.textContent); if (j['@type'] === 'VideoObject') { ld = j; break; } } catch {}
  }
  const og = doc.querySelector('meta[property="og:title"]')?.content || '';
  const num = +((/EP\s?(\d+)/i.exec(og) || [])[1] || 0);
  const yt = ((/v=([A-Za-z0-9_-]+)/.exec(ld.contentUrl || '') || [])[1]) || null;
  const thumbs = [].concat(ld.thumbnailUrl || []);
  const shorts = [...doc.querySelectorAll('.shorts a[href*="/shorts/"]')].map(a => [(/shorts\/([A-Za-z0-9_-]+)/.exec(a.href) || [])[1], a.querySelector('img')?.alt || a.textContent.trim()]).filter(x => x[0]);
  const lines = [...doc.querySelectorAll('p[data-t]')];
  const n = Math.min(6, lines.length);
  const moments = [...Array(n)].map((_, k) => lines[Math.floor((k + 0.5) * lines.length / n)]).map(p => [+p.dataset.t, clip(p.textContent, 110)]);
  return {
    shorts, moments,
    slug, ep: num, show: slug.startsWith('parag-gators') ? 'Parag-Gators' : 'The Pezzadox Show',
    genre: ld.genre || '', yt, dur: ld.duration || '',
    title: ld.name || og.replace(/\s*\|\s*The Pezzadox Show.*$/, '') || slug,
    desc: ld.description || doc.querySelector('meta[name="description"]')?.content || '',
    thumb: thumbs.find(t => t.includes('pezzadox.com')) || thumbs[0] || (yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : '')
  };
}

let refreshing = null;
async function refresh(manual) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const txt = await (await fetch(SITE + '/pezzadox-sitemap.txt', { cache: 'no-store' })).text();
      const slugs = [...txt.matchAll(/\/episodes\/([a-z0-9-]+)\.html/g)].map(m => m[1]);
      if (!slugs.length) throw new Error('no episodes in sitemap');
      const known = new Map(episodes.map(e => [e.slug, e]));
      const fresh = [];
      for (const slug of slugs) {
        if (known.has(slug)) { fresh.push(known.get(slug)); continue; }
        try { fresh.push(parseEpisode(slug, await (await fetch(`${SITE}/episodes/${slug}.html`)).text())); } catch {}
      }
      const added = fresh.filter(e => !known.has(e.slug));
      episodes = fresh; store.set('episodes', episodes); store.set('checked', Date.now());
      syncRunner();
      render();
      if (manual) toast(added.length ? `${added.length} new episode${added.length > 1 ? 's' : ''}` : 'You’re up to date');
    } catch (e) {
      if (manual) toast('Couldn’t reach pezzadox.com');
    } finally { refreshing = null; }
  })();
  return refreshing;
}

// Fills in a description the snapshot doesn't carry, the first time an episode is opened.
async function ensureDesc(e) {
  if (e.desc && e.more) return e;
  try {
    const full = parseEpisode(e.slug, await (await fetch(`${SITE}/episodes/${e.slug}.html`)).text());
    Object.assign(e, { desc: full.desc, genre: e.genre || full.genre, moments: full.moments, shorts: full.shorts.length ? full.shorts : (e.shorts || []), more: true });
    store.set('episodes', episodes);
  } catch {}
  return e;
}

// ---------- video ----------
// Videos play inside the app. YouTube's player needs a proper web address around it, which
// the app's own pages don't have on iPhone, so it is hosted by a tiny page on pezzadox.com.
const playerUrl = (id, t = 0, short = false) => `${SITE}/app-player.html?v=${encodeURIComponent(id)}${t ? '&t=' + t : ''}${short ? '&s=1' : ''}`;
const frame = (id, t, short) => `<iframe src="${esc(playerUrl(id, t, short))}" title="Video player" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
function playInSheet(id, t = 0) {
  const p = $('#sheetPanel .player');
  if (!p) return;
  tap();
  p.classList.add('playing');
  p.innerHTML = frame(id, t);
  p.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function playShort(id, title) {
  tap();
  $('#vid').innerHTML = `<div class="vbox short">${frame(id, 0, true)}</div><p>${esc(title || '')}</p><button class="btn ghost" data-vclose>Close</button>`;
  $('#vid').classList.add('on');
}
function closeVid() { $('#vid').classList.remove('on'); $('#vid').innerHTML = ''; }
const shortCard = ([id, title]) => `<button class="short" data-short="${esc(id)}" data-title="${esc(title)}"><img src="https://i.ytimg.com/vi/${esc(id)}/hqdefault.jpg" alt="" loading="lazy" onerror="this.remove()"><span class="pb sm"></span><b>${esc(title)}</b></button>`;

// ---------- native bridges (with web fallbacks for the browser preview) ----------
async function openPage(path) {
  const url = path.startsWith('http') ? path : SITE + path;
  tap();
  if (!native) { window.open(url, '_blank', 'noopener'); return; }
  await InAppBrowser.openInWebView({ url, options: { ...DefaultWebViewOptions, showURL: false, closeButtonText: 'Done', showNavigationButtons: true } });
}
async function openOut(url) {
  tap();
  if (!native) { window.open(url, '_blank', 'noopener'); return; }
  await InAppBrowser.openInExternalBrowser({ url });
}
function tap() { if (native) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}); }
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2200); }

// New-episode alerts: the background runner checks the sitemap every few hours and
// notifies about slugs it hasn't seen. The app keeps the runner's list in step.
const alerts = { get on() { return store.get('alerts', false); } };
async function syncRunner() {
  if (!native) return;
  try { await BackgroundRunner.dispatchEvent({ label: RUNNER, event: 'syncKnown', details: { slugs: episodes.map(e => e.slug), enabled: alerts.on } }); } catch {}
}
async function setAlerts(want) {
  if (want && native) {
    let p = await LocalNotifications.checkPermissions();
    if (p.display !== 'granted') p = await LocalNotifications.requestPermissions();
    if (p.display !== 'granted') { toast('Notifications are off in Settings'); want = false; }
  }
  store.set('alerts', want);
  await syncRunner();
  render();
  if (want) toast('We’ll tell you when a new episode drops');
}

// ---------- rendering ----------
const img = (src, alt = '') => src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" onerror="this.remove()">` : '';
const thumb = e => `<div class="thumb">${img(e.thumb)}<span class="pb sm"></span><span class="ep">${epLabel(e)}</span>${e.dur ? `<span class="dur">${duration(e.dur)}</span>` : ''}</div>`;

function homeView() {
  const [latest, ...rest] = episodes;
  const fresh = episodes.filter(isNew);
  return `
    <h1>Welcome to the worlds.</h1>
    <p class="lead">Three shows, every episode and eight arcade games from Kyle Perry’s studio.</p>
    ${latest ? `
    <h2>${fresh.length ? 'New episode' : 'Latest episode'}</h2>
    <button class="hero" data-ep="${esc(latest.slug)}" style="display:block;width:calc(100% - 40px);text-align:left">
      ${img(latest.thumb, latest.title)}<div class="shade"></div><span class="pb" data-play-ep="${esc(latest.slug)}" role="button" aria-label="Play"></span>
      <div class="meta"><span class="tag ${isNew(latest) ? 'new' : ''}">${isNew(latest) ? 'New · ' : ''}${epLabel(latest)}</span>
      <h3>${esc(latest.title)}</h3><div class="sub">${esc(latest.genre)}${latest.dur ? ' · ' + duration(latest.dur) : ''}</div></div>
    </button>` : ''}
    <h2>The shows</h2>
    <div class="shows">${SHOWS.map((s, i) => `<button class="show" data-open="${esc(s.url)}"><i>${s.em}</i><b>${esc(s.name)}</b></button>`).join('')}</div>
    <h2>More episodes <button data-tab-go="episodes">See all</button></h2>
    <div class="row">${rest.slice(0, 8).map(e => `<button class="mini" data-ep="${esc(e.slug)}">${thumb(e)}<b>${esc(e.title)}</b></button>`).join('')}</div>
    ${store.get('shorts', []).length ? `<h2>Shorts <button data-tab-go="watch">See all</button></h2>
    <div class="row">${store.get('shorts', []).slice(0, 6).map(shortCard).join('')}</div>` : ''}
    <h2>Pezzadox Dimension Hop <button data-tab-go="games">All games</button></h2>
    <div class="row">${GAMES.slice(0, 5).map(g => `<button class="game" style="--g:${g.g};flex:0 0 150px" data-open="${esc(g.url)}"><span class="em">${g.em}</span><b>${esc(g.name)}</b></button>`).join('')}</div>
    ${alerts.on ? '' : `
    <h2>Never miss an episode</h2>
    <div class="card"><b>New episode alerts</b><p>Get a notification when a new episode of The Pezzadox Show or Parag-Gators drops.</p>
      <button class="btn pink" data-alerts="on">Turn on alerts</button></div>`}
    <div class="foot">Pezzadox Worlds · pezzadox.com</div>`;
}

function episodesView() {
  const q = query.trim().toLowerCase();
  const list = episodes.filter(e => (topic === 'All' || e.genre === topic) && (!q || (e.title + ' ' + e.genre + ' ' + e.slug.replace(/-/g, ' ')).toLowerCase().includes(q)));
  return `
    <h1>Episodes</h1>
    <p class="lead">${episodes.length} full-length conversations.</p>
    <label class="search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8E89A4" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <span class="sr">Search episodes</span><input id="q" type="search" placeholder="Search guests and topics" value="${esc(query)}" autocomplete="off"></label>
    <div class="chips">${TOPICS.map(t => `<button class="chip ${t === topic ? 'on' : ''}" data-topic="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <div class="list">${list.length ? list.map(e => `
      <button class="item" data-ep="${esc(e.slug)}">${thumb(e)}
        <div><b>${esc(e.title)}</b><div class="sub">${isNew(e) ? '<span class="tag new" style="margin-right:6px">New</span>' : ''}${esc(e.show === 'Parag-Gators' ? 'Parag-Gators' : e.genre)}</div></div>
      </button>`).join('') : '<div class="empty">No episodes match that.</div>'}</div>`;
}

function gamesView() {
  return `
    <h1>Pezzadox Dimension Hop</h1>
    <p class="lead">Eight free 16-bit arcade games. High scores stay on your phone.</p>
    <div class="games">${GAMES.map(g => `<button class="game" style="--g:${g.g}" data-open="${esc(g.url)}"><span class="em">${g.em}</span><div><b>${esc(g.name)}</b><br><span>${esc(g.blurb)}</span></div></button>`).join('')}</div>
    <div class="note">📱 Turn your phone sideways for the best view. The games load from pezzadox.com, so you need a connection the first time.</div>`;
}

const linkRow = (ic, title, small, attr) => `<button ${attr}><span class="ic">${ic}</span><span class="tx"><b>${esc(title)}</b>${small ? `<small>${esc(small)}</small>` : ''}</span><span class="chev">›</span></button>`;

function watchView() {
  return `
    <h1>Watch</h1>
    <p class="lead">Full episodes, shorts and clips.</p>
    <h2>Shorts</h2>
    <div class="shortgrid">${store.get('shorts', []).map(shortCard).join('')}</div>
    <h2>Latest episodes</h2>
    <div class="row">${episodes.slice(0, 8).map(e => `<button class="mini" data-play-ep="${esc(e.slug)}">${thumb(e)}<b>${esc(e.title)}</b></button>`).join('')}</div>
    <h2>More to watch</h2>
    <div class="links">
      ${linkRow('⚡', 'Shorts and clips', 'The best moments, all in one place', 'data-open="/shorts.html"')}
      ${linkRow('📜', 'Transcripts', 'Read any episode', 'data-open="/transcripts.html"')}
    </div>
    <h2>Follow</h2>
    <div class="links">
      ${linkRow('▶️', 'YouTube', '@Pezzadox · subscribe for every episode', 'data-out="https://www.youtube.com/@Pezzadox?sub_confirmation=1"')}
      ${linkRow('🎵', 'TikTok', '@pezzadox', 'data-out="https://www.tiktok.com/@pezzadox"')}
      ${linkRow('📸', 'Instagram', '@thepezzadox', 'data-out="https://www.instagram.com/thepezzadox/"')}
      ${linkRow('✖️', 'X', '@pezzadox1', 'data-out="https://x.com/pezzadox1"')}
      ${linkRow('👻', 'Snapchat', '@pezzadox', 'data-out="https://www.snapchat.com/@pezzadox"')}
      ${linkRow('📘', 'Facebook', 'The Pezzadox Show', 'data-out="https://www.facebook.com/profile.php?id=61553312957145"')}
      ${linkRow('💼', 'LinkedIn', 'Pezzadox', 'data-out="https://www.linkedin.com/company/pezzadox"')}
    </div>`;
}

function moreView() {
  return `
    <h1>More</h1>
    <h2>The show</h2>
    <div class="links">
      ${linkRow('🧑‍🤝‍🧑', 'Guests', 'Everyone who has sat in the chair', 'data-open="/guests.html"')}
      ${linkRow('📰', 'News', 'What’s happening at Pezzadox', 'data-open="/news.html"')}
      ${linkRow('🛍️', 'Shop', 'Merch', 'data-open="/shop.html"')}
      ${linkRow('☕', 'Buy me a coffee', 'Support the show', 'data-out="https://buymeacoffee.com/kyle1g"')}
    </div>
    <h2>Work with Kyle</h2>
    <div class="links">
      ${linkRow('📅', 'Book Kyle', 'Appearances and hosting', 'data-open="/book-me.html"')}
      ${linkRow('🤝', 'Partnerships', 'Sponsorship packages', 'data-open="/partnerships.html"')}
      ${linkRow('🎬', 'Collaborate', 'Be a guest or work together', 'data-open="/collaborate.html"')}
    </div>
    <h2>Settings</h2>
    <div class="links">
      <button data-alerts="${alerts.on ? 'off' : 'on'}"><span class="ic">🔔</span><span class="tx"><b>New episode alerts</b><small>${alerts.on ? 'On' : 'Off'}</small></span><span class="switch ${alerts.on ? 'on' : ''}" role="switch" aria-checked="${alerts.on}"></span></button>
      ${linkRow('🔒', 'Privacy policy', 'Pezzadox Worlds collects nothing about you', 'data-open="/pezzadox-worlds-privacy.html"')}
    </div>
    <h2>More from Pezzadox</h2>
    <div class="links">
      ${linkRow('🌍', 'World Mapper', 'Flat Earth vs the Globe: measure it yourself', 'data-toast="World Mapper is coming soon to the stores"')}
      ${linkRow('🧮', 'The Complicator', 'Maths made harder, so easier', 'data-toast="The Complicator is coming soon to the stores"')}
    </div>
    <div class="foot">Pezzadox Worlds 1.0 · © 2026 Pezzadox</div>`;
}

function openEpisode(slug, autoplay = false) {
  const e = episodes.find(x => x.slug === slug);
  if (!e) return;
  tap();
  if (isNew(e)) { seen.add(e.slug); store.set('seen', [...seen]); }
  $('#sheetPanel').dataset.slug = e.slug;
  const draw = () => {
    $('#sheetPanel').innerHTML = `
      <div class="grab"></div>
      <button class="iconbtn close" data-close aria-label="Close">✕</button>
      <div class="player thumb">${e.yt ? `<img src="https://i.ytimg.com/vi/${esc(e.yt)}/maxresdefault.jpg" alt="" onerror="this.onerror=null;this.src='${esc(e.thumb)}'">` : img(e.thumb)}
        ${e.yt ? `<button class="pb big" data-play="${esc(e.yt)}" aria-label="Play episode"></button>` : ''}${e.dur ? `<span class="dur">${duration(e.dur)}</span>` : ''}</div>
      <div style="padding:14px 20px 0;display:flex;gap:6px;flex-wrap:wrap"><span class="tag">${esc(e.show)}</span>${e.genre ? `<span class="tag pink">${esc(e.genre)}</span>` : ''}</div>
      <h3>${esc(e.title)}</h3>
      <div class="desc">${e.desc ? esc(e.desc) : '<span class="sub">Loading the story…</span>'}</div>
      <div class="acts">
        ${e.yt ? `<button class="btn pink wide" data-play="${esc(e.yt)}">▶ Play episode</button>` : ''}
        <div class="two">
          ${e.yt ? `<button class="btn ghost" data-out="https://www.youtube.com/watch?v=${esc(e.yt)}">Open in YouTube</button>` : `<button class="btn ghost" data-open="/episodes/${esc(e.slug)}.html">Episode page</button>`}
          <button class="btn ghost" data-share="${esc(e.slug)}">Share</button>
        </div>
      </div>
      ${e.moments?.length && e.yt ? `<h4>Jump to a moment</h4><div class="moments">${e.moments.map(([t, txt]) => `<button data-play="${esc(e.yt)}" data-t="${t}"><span class="ts">${clock(t)}</span>${esc(txt)}</button>`).join('')}</div>` : ''}
      ${e.yt ? `<h4>From the episode</h4><div class="stills">${[1, 2, 3].map(n => `<button data-play="${esc(e.yt)}" aria-label="Play"><img src="https://i.ytimg.com/vi/${esc(e.yt)}/hq${n}.jpg" alt="" loading="lazy" onerror="this.parentNode.remove()"></button>`).join('')}</div>` : ''}
      ${e.shorts?.length ? `<h4>Shorts from this episode</h4><div class="row">${e.shorts.map(shortCard).join('')}</div>` : ''}
      <div class="acts"><button class="btn ghost" data-open="/episodes/${esc(e.slug)}.html">Full episode page and transcript</button></div>`;
  };
  draw();
  $('#sheet').classList.add('on');
  $('#sheetPanel').scrollTop = 0;
  if (autoplay && e.yt) playInSheet(e.yt);
  if (!e.desc || !e.more) ensureDesc(e).then(() => {
    if (!$('#sheet').classList.contains('on') || $('#sheetPanel').dataset.slug !== e.slug) return;
    const playing = $('#sheetPanel .player.playing');
    if (playing) { const keep = playing.outerHTML; draw(); $('#sheetPanel .player').outerHTML = keep; } else draw();
  });
}
function closeSheet() { $('#sheet').classList.remove('on'); $('#sheetPanel').innerHTML = ''; render(); }

const views = { home: homeView, episodes: episodesView, games: gamesView, watch: watchView, more: moreView };
let tab = 'home';
function render() {
  const el = $('#v-' + tab);
  const focusQ = document.activeElement?.id === 'q';
  el.innerHTML = views[tab]();
  if (focusQ) { const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}
function go(t) {
  if (t === tab) { $('#main').scrollTo({ top: 0, behavior: 'smooth' }); return; }
  tap();
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + t));
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  tab = t; render(); $('#main').scrollTop = 0;
}

document.addEventListener('click', ev => {
  const b = ev.target.closest('button, [data-close], [data-play-ep]');
  if (ev.target === $('#sheet')) return closeSheet();
  if (ev.target === $('#vid')) return closeVid();
  if (!b) return;
  const d = b.dataset;
  if (d.tab) return go(d.tab);
  if (d.tabGo) return go(d.tabGo);
  if (d.playEp) return openEpisode(d.playEp, true);
  if (d.ep) return openEpisode(d.ep);
  if (d.play) return playInSheet(d.play, +(d.t || 0));
  if (d.short) return playShort(d.short, d.title);
  if ('vclose' in d) return closeVid();
  if (d.open) return openPage(d.open);
  if (d.out) return openOut(d.out);
  if (d.topic) { topic = d.topic; tap(); return render(); }
  if (d.alerts) return setAlerts(d.alerts === 'on');
  if (d.toast) return toast(d.toast);
  if ('close' in d) return closeSheet();
  if (d.share) {
    const e = episodes.find(x => x.slug === d.share);
    const url = `${SITE}/episodes/${e.slug}.html`;
    if (native) return Share.share({ title: e.title, text: `${e.title} — The Pezzadox Show`, url }).catch(() => {});
    if (navigator.share) return navigator.share({ title: e.title, url }).catch(() => {});
    navigator.clipboard?.writeText(url).then(() => toast('Link copied'), () => {});
  }
});
document.addEventListener('input', ev => { if (ev.target.id === 'q') { query = ev.target.value; render(); } });
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  if ($('#vid').classList.contains('on')) return closeVid();
  if ($('#sheet').classList.contains('on')) closeSheet();
});
$('#refreshBtn').addEventListener('click', () => { tap(); toast('Checking for new episodes…'); refresh(true); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - store.get('checked', 0) > 30 * 60e3) refresh(false); });

(async function start() {
  await loadSnapshot();
  render();
  if (native) SplashScreen.hide().catch(() => {});
  refresh(false);
})();

window.__pw = { refresh, get episodes() { return episodes; }, parseEpisode };
