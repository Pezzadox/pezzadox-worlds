// Video messages: ask Kyle for a personal video, pay through Google Play, watch it here.
// Only present in a build that was given the backend address, and only on Android for now.
import { Capacitor } from '@capacitor/core';
import { NativePurchases, PURCHASE_TYPE } from '@capgo/native-purchases';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Share } from '@capacitor/share';

/* global __PW_VIDEO__ */
const CFG = typeof __PW_VIDEO__ === 'object' && __PW_VIDEO__ ? __PW_VIDEO__ : {};
export const PRODUCT = 'video_message';
const OCCASIONS = ['Birthday', 'Congratulations', 'Good luck', 'Thank you', 'Get well soon', 'Just because'];
const DEADLINE_DAYS = 14;

// The test harness can stand in for the phone's billing and say which platform this is.
const seam = () => (typeof window !== 'undefined' && window.__pwVideoTest) || null;
const billing = () => seam()?.billing || NativePurchases;
const platform = () => seam()?.platform || Capacitor.getPlatform();
export const videoEnabled = () => !!(CFG.url && CFG.anon) && platform() === 'android';

let ui;                       // { $, esc, toast, tap, store, render, closeSheet, syncRunner }
let requests = null, price = null, busy = false, draft = {}, problem = '';
export function initVideo(ctx) { ui = ctx; }

function key() {
  let k = ui.store.get('vkey', null);
  if (!k) { k = crypto.randomUUID() + crypto.randomUUID(); ui.store.set('vkey', k); }
  return k;
}
export const videoApiInfo = () => videoEnabled() ? { url: CFG.url + '/functions/v1/video-request', anon: CFG.anon, key: ui.store.get('vkey', null), waiting: (requests || ui.store.get('vreq', [])).filter(r => r.status === 'paid').map(r => r.id) } : null;

async function api(action, body = {}) {
  const r = await fetch(CFG.url + '/functions/v1/video-request', {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: CFG.anon, authorization: 'Bearer ' + CFG.anon },
    body: JSON.stringify({ action, key: key(), ...body })
  });
  const j = await r.json().catch(() => ({}));
  if (r.status !== 200) { const e = new Error(j.message || 'Something went wrong. Please try again.'); e.code = j.error || 'server'; throw e; }
  return j;
}

function keep(list) { requests = list; ui.store.set('vreq', list); ui.syncRunner?.(); }
async function load() {
  try { keep((await api('list')).requests); } catch { if (!requests) requests = ui.store.get('vreq', []); }
}

// A payment that went through but never reached the server (app closed, no signal) is sent again.
export async function recoverPurchases() {
  if (!videoEnabled()) return;
  try {
    const { purchases } = await billing().getPurchases({ productType: PURCHASE_TYPE.INAPP });
    for (const p of purchases || []) {
      if (p.productIdentifier !== PRODUCT || !p.purchaseToken || p.purchaseState !== '1') continue;
      try { await api('confirm', { purchaseToken: p.purchaseToken, id: ui.store.get('vpending', null) }); ui.store.set('vpending', null); } catch {}
    }
  } catch {}
  await load();
  if ((requests || []).some(r => r.status === 'ready' && !ui.store.get('vseen', []).includes(r.id))) ui.render();
}

const when = iso => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
const unseen = r => r.status === 'ready' && !ui.store.get('vseen', []).includes(r.id);

// ---------- what shows on the Home and More tabs ----------
export function videoCard() {
  if (!videoEnabled()) return '';
  const ready = (requests || ui.store.get('vreq', [])).filter(unseen).length;
  return `
    <h2>A video from Kyle</h2>
    <div class="card"><b>${ready ? 'Your video is ready 🎬' : 'Get a personal video message'}</b>
      <p>${ready ? 'Kyle has recorded it. Tap to watch.' : 'A birthday, a pep talk, a thank you. Kyle records it just for them.'}</p>
      <button class="btn pink" data-video="open">${ready ? 'Watch it' : 'Ask Kyle'}</button></div>`;
}
export function videoRow(linkRow) {
  if (!videoEnabled()) return '';
  const n = (requests || ui.store.get('vreq', [])).length;
  return linkRow('🎬', 'Video messages', n ? `${n} request${n > 1 ? 's' : ''}` : 'A personal video from Kyle', 'data-video="open"');
}

// ---------- the sheet ----------
const STATUS = {
  paid: r => ['Waiting for Kyle', `Paid ${when(r.paidAt)}. Ready by ${when(r.dueAt)} or you get your money back.`],
  ready: r => ['Ready to watch', `Recorded ${when(r.readyAt)}.`],
  declined: r => ['Declined and refunded', r.reason || 'Kyle could not make this one.'],
  refunded: r => ['Refunded', r.reason || 'Your money has been returned.']
};
function requestCard(r) {
  const { esc } = ui, [head, small] = (STATUS[r.status] || STATUS.paid)(r);
  return `<div class="vreq ${esc(r.status)}">
    <div class="vhead"><span class="tag ${r.status === 'ready' ? 'new' : r.status === 'paid' ? '' : 'pink'}">${esc(head)}</span><b>For ${esc(r.forName)}</b></div>
    <div class="sub">${esc(r.occasion)} · from ${esc(r.fromName)}</div>
    <p>${esc(small)}</p>
    <div class="two">
      ${r.status === 'ready' ? `<button class="btn pink" data-video="watch" data-id="${esc(r.id)}">▶ Watch</button><button class="btn ghost" data-video="share" data-id="${esc(r.id)}">Send to ${esc(r.forName)}</button>` : ''}
      ${r.status === 'paid' ? `<button class="btn ghost" data-video="cancel" data-id="${esc(r.id)}">Cancel and refund</button>` : ''}
      ${r.status !== 'paid' ? `<button class="btn ghost" data-video="remove" data-id="${esc(r.id)}">Delete</button>` : ''}
    </div></div>`;
}

function draw() {
  const { $, esc } = ui, list = requests || [];
  $('#sheetPanel').dataset.slug = '';
  $('#sheetPanel').innerHTML = `
    <div class="grab"></div>
    <button class="iconbtn close" data-close aria-label="Close">✕</button>
    <h3 style="padding-top:26px">A video from Kyle</h3>
    <div class="desc">Tell Kyle who it’s for and what to say. He records a personal video and it appears here, usually within a few days.</div>
    ${list.length ? `<h4>Your requests</h4><div class="vlist">${list.map(requestCard).join('')}</div><h4>Ask for another</h4>` : ''}
    <form class="vform" id="vform" novalidate>
      <label for="vFor">Who is it for?</label><input id="vFor" name="forName" maxlength="40" autocomplete="off" placeholder="Their first name" value="${esc(draft.forName || '')}">
      <label for="vFrom">Who is it from?</label><input id="vFrom" name="fromName" maxlength="40" autocomplete="given-name" placeholder="Your name" value="${esc(draft.fromName || '')}">
      <label for="vOcc">What’s the occasion?</label><select id="vOcc" name="occasion">${OCCASIONS.map(o => `<option${o === (draft.occasion || 'Birthday') ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>
      <label for="vBrief">What should Kyle say?</label><textarea id="vBrief" name="brief" maxlength="300" rows="4" placeholder="A few details: what they love, an in-joke, what the day is.">${esc(draft.brief || '')}</textarea>
      <div class="sub" id="vCount">${(draft.brief || '').length}/300</div>
      ${problem ? `<div class="verr" role="alert">${esc(problem)}</div>` : ''}
      <button class="btn pink wide" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'One moment…' : price ? `Pay ${esc(price)} and send to Kyle` : 'Continue to payment'}</button>
      <div class="sub vterms">Payment is taken by Google Play. Ready within ${DEADLINE_DAYS} days or refunded in full. You can cancel for a full refund any time before Kyle records it. Kyle may decline a request, and if he does you are refunded. What you write here is sent to Kyle to make your video.</div>
    </form>`;
}

export async function openVideo() {
  if (!videoEnabled()) return;
  ui.tap(); problem = '';
  if (!requests) requests = ui.store.get('vreq', []);
  draw();
  ui.$('#sheet').classList.add('on'); ui.$('#sheetPanel').scrollTop = 0;
  const seenNow = (requests || []).filter(r => r.status === 'ready').map(r => r.id);
  load().then(() => { ui.store.set('vseen', [...new Set([...ui.store.get('vseen', []), ...seenNow])]); if (open()) redraw(); });
  if (!price) billing().getProduct({ productIdentifier: PRODUCT, productType: PURCHASE_TYPE.INAPP })
    .then(({ product }) => { price = product?.priceString || null; if (open() && price) redraw(); }).catch(() => {});
}
const open = () => ui.$('#sheet').classList.contains('on') && !!ui.$('#vform');
function readForm() { const f = ui.$('#vform'); if (f) draft = Object.fromEntries(new FormData(f)); }
function redraw() { readForm(); const y = ui.$('#sheetPanel').scrollTop; draw(); ui.$('#sheetPanel').scrollTop = y; }

async function pay() {
  if (busy) return;
  readForm(); problem = ''; busy = true; draw();
  let id = null;
  try {
    ({ id } = await api('draft', draft));
    ui.store.set('vpending', id);
    const t = await billing().purchaseProduct({
      productIdentifier: PRODUCT, productType: PURCHASE_TYPE.INAPP, quantity: 1,
      appAccountToken: id, isConsumable: false, autoAcknowledgePurchases: false
    });
    if (!t?.purchaseToken) throw Object.assign(new Error('The payment did not complete.'), { code: 'no_token' });
    try {
      await api('confirm', { purchaseToken: t.purchaseToken, id });
      ui.store.set('vpending', null);
      draft = {}; ui.toast('Sent to Kyle');
      askToNotify();
    } catch (e) {
      // Paid, but not yet confirmed: it is retried when the app next opens.
      problem = e.code === 'pending' ? e.message : 'Your payment went through but we could not confirm it yet. It will be checked again automatically, and nothing is lost.';
    }
    await load();
  } catch (e) {
    const cancelled = /cancel/i.test(e?.message || '') || e?.code === 'USER_CANCELLED' || e?.code === '1';
    problem = cancelled ? '' : (e?.message || 'The payment did not complete. You have not been charged.');
  } finally { busy = false; if (open()) draw(); ui.render(); }
}

async function askToNotify() {
  try {
    let p = await LocalNotifications.checkPermissions();
    if (p.display !== 'granted') p = await LocalNotifications.requestPermissions();
  } catch {}
}

async function watch(id) {
  ui.tap();
  try {
    const { url } = await api('watch', { id });
    const v = ui.$('#vid');
    v.innerHTML = `<div class="vbox short"><video src="${ui.esc(url)}" controls autoplay playsinline></video></div><button class="btn ghost" data-vclose>Close</button>`;
    v.classList.add('on');
  } catch (e) { ui.toast(e.message); }
}
async function share(id) {
  try {
    const r = (requests || []).find(x => x.id === id);
    const { url } = await api('watch', { id, share: true });
    await Share.share({ title: 'A video from Kyle', text: `${r?.forName || 'Hi'}, Kyle from Pezzadox recorded this for you. The link works for 7 days.`, url });
  } catch (e) { if (e?.code) ui.toast(e.message); }
}
let confirmFor = null;
async function act(action, id, ask, done) {
  // First tap asks, second tap does it: no pop-up dialogs.
  if (confirmFor !== action + id) { confirmFor = action + id; ui.toast(ask); setTimeout(() => { if (confirmFor === action + id) confirmFor = null; }, 4000); return; }
  confirmFor = null;
  try { await api(action, { id }); ui.toast(done); } catch (e) { ui.toast(e.message); }
  await load(); if (open()) redraw(); ui.render();
}

export function videoClick(d) {
  if (d.video === 'open') return openVideo();
  if (d.video === 'watch') return watch(d.id);
  if (d.video === 'share') return share(d.id);
  if (d.video === 'cancel') return act('cancel', d.id, 'Tap again to cancel and get your money back', 'Cancelled. Your refund is on its way.');
  if (d.video === 'remove') return act('remove', d.id, 'Tap again to delete this for good', 'Deleted');
}
export function videoSubmit(ev) { if (ev.target.id !== 'vform') return false; ev.preventDefault(); pay(); return true; }
export function videoInput(ev) { if (ev.target.id === 'vBrief') { const c = ui.$('#vCount'); if (c) c.textContent = ev.target.value.length + '/300'; return true; } return false; }
