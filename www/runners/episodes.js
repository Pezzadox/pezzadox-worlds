// Pezzadox Worlds background check. The OS runs 'checkEpisodes' every few hours; it reads
// pezzadox.com's sitemap and sends one notification per episode it hasn't seen before.
// 'syncKnown' comes from the app so episodes already shown there never trigger an alert.
const SITE = 'https://www.pezzadox.com';

function readList(key) {
  try { return JSON.parse((CapacitorKV.get(key) || {}).value || '[]'); } catch (e) { return []; }
}

addEventListener('syncKnown', (resolve, reject, args) => {
  try {
    const mine = readList('known');
    const merged = Array.from(new Set(mine.concat((args && args.slugs) || [])));
    CapacitorKV.set('known', JSON.stringify(merged));
    CapacitorKV.set('enabled', args && args.enabled ? 'yes' : 'no');
    CapacitorKV.set('video', JSON.stringify((args && args.video) || null));
    resolve();
  } catch (e) { reject(e); }
});

// Video messages: if this phone is waiting for a video from Kyle, see whether it is ready.
async function checkVideos() {
  let v = null;
  try { v = JSON.parse((CapacitorKV.get('video') || {}).value || 'null'); } catch (e) {}
  if (!v || !v.url || !v.key || !v.waiting || !v.waiting.length) return;
  const r = await fetch(v.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: v.anon, authorization: 'Bearer ' + v.anon },
    body: JSON.stringify({ action: 'list', key: v.key })
  });
  const list = ((await r.json()) || {}).requests || [];
  const done = list.filter(x => v.waiting.indexOf(x.id) !== -1 && x.status !== 'paid');
  if (!done.length) return;
  const notes = done.map(x => x.status === 'ready'
    ? { id: 500000 + Math.floor(Math.random() * 100000), title: 'Your video from Kyle is ready', body: 'For ' + x.forName + '. Open Pezzadox to watch it.' }
    : { id: 500000 + Math.floor(Math.random() * 100000), title: 'Your video request was refunded', body: x.reason || 'Open Pezzadox for details.' });
  CapacitorNotifications.schedule(notes);
  v.waiting = v.waiting.filter(id => !done.some(x => x.id === id));
  CapacitorKV.set('video', JSON.stringify(v));
}

addEventListener('checkEpisodes', async (resolve, reject) => {
  try { await checkVideos(); } catch (e) {}
  try {
    if ((CapacitorKV.get('enabled') || {}).value !== 'yes') return resolve();
    const txt = await (await fetch(SITE + '/pezzadox-sitemap.txt')).text();
    const slugs = [];
    const re = /\/episodes\/([a-z0-9-]+)\.html/g;
    let m;
    while ((m = re.exec(txt))) slugs.push(m[1]);
    if (!slugs.length) return resolve();
    const known = readList('known');
    if (!known.length) { CapacitorKV.set('known', JSON.stringify(slugs)); return resolve(); }
    const fresh = slugs.filter(s => known.indexOf(s) === -1).slice(0, 3);
    const notes = [];
    for (let i = 0; i < fresh.length; i++) {
      let title = fresh[i].replace(/-/g, ' ');
      try {
        const html = await (await fetch(SITE + '/episodes/' + fresh[i] + '.html')).text();
        const t = /<meta property="og:title" content="([^"]+)"/.exec(html);
        if (t) title = t[1].replace(/&amp;/g, '&').replace(/\s*\|\s*The Pezzadox Show.*$/, '');
      } catch (e) {}
      notes.push({ id: 1000 + Math.floor(Math.random() * 100000), title: 'New episode out now', body: title });
    }
    if (notes.length) CapacitorNotifications.schedule(notes);
    CapacitorKV.set('known', JSON.stringify(known.concat(fresh)));
    resolve();
  } catch (e) { reject(e); }
});
