// The video-message money rules, run against an in-memory database and a pretend Google Play.
// node --test tests/test_video_rules.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { buyer, studio, run, PRODUCT, DEADLINE_DAYS } from '../supabase/functions/_shared/core.js';

const DAY = 86400000;
function world() {
  const rows = new Map(), purchases = new Map(), files = new Set(), log = [];
  let clock = new Date('2026-11-18T10:00:00Z');
  const deps = {
    now: () => new Date(clock),
    hash: async t => createHash('sha256').update(t).digest('hex'),
    db: {
      async insert(r) { const row = { id: randomUUID(), created_at: clock.toISOString(), consumed: false, ...r }; rows.set(row.id, row); return { ...row }; },
      async get(id) { const r = rows.get(id); return r ? { ...r } : null; },
      async byToken(t) { const r = [...rows.values()].find(x => x.purchase_token === t); return r ? { ...r } : null; },
      async listByDevice(h) { return [...rows.values()].filter(r => r.device_hash === h).map(r => ({ ...r })); },
      async listByStatus(s) { return [...rows.values()].filter(r => r.status === s).map(r => ({ ...r })); },
      async update(id, patch, only) { const r = rows.get(id); if (!r || (only && r.status !== only)) return null; Object.assign(r, patch); return { ...r }; },
      async remove(id) { rows.delete(id); },
      async countDrafts(h) { return [...rows.values()].filter(r => r.device_hash === h && r.status === 'draft').length; },
      async pruneDrafts(before) { for (const [id, r] of rows) if (r.status === 'draft' && r.created_at < before) rows.delete(id); }
    },
    play: {
      down: false, consumeDown: false, refundDown: false,
      async getPurchase(product, token) { if (this.down) throw new Error('down'); assert.equal(product, PRODUCT); const p = purchases.get(token); if (!p) throw new Error('404'); return p; },
      async consume(_p, token) { if (this.consumeDown) throw new Error('down'); log.push(['consume', token]); },
      async refund(orderId) { if (this.refundDown) throw new Error('down'); log.push(['refund', orderId]); }
    },
    storage: {
      async signedUrl(path, s) { return `https://files.test/${path}?for=${s}`; },
      async signedUpload(path) { return { uploadUrl: `https://files.test/up/${path}` }; },
      async remove(path) { files.delete(path); log.push(['removeFile', path]); },
      async exists(path) { return files.has(path); }
    }
  };
  const pay = (id, state = 0) => { const token = 'tok_' + randomUUID() + randomUUID(); purchases.set(token, { purchaseState: state, orderId: 'GPA.' + token.slice(4, 12), obfuscatedExternalAccountId: id }); return token; };
  return { deps, rows, purchases, files, log, pay, tick: ms => { clock = new Date(+clock + ms); } };
}
const KEY = 'a'.repeat(40), OTHER = 'b'.repeat(40);
const form = { key: KEY, forName: 'Sam', fromName: 'Jo', occasion: 'Birthday', brief: 'She turns 30 and loves the ghost episodes.' };
const code = async p => { try { await p; return 'ok'; } catch (e) { return e.code; } };
async function paidRequest(w, f = form) {
  const { id } = await buyer.draft(f, w.deps);
  const token = w.pay(id);
  const { request } = await buyer.confirm({ key: f.key, purchaseToken: token }, w.deps);
  return { id, token, request };
}

test('a request is written down first, then paid, then consumed so another can be bought', async () => {
  const w = world();
  const { id } = await buyer.draft(form, w.deps);
  assert.deepEqual((await buyer.list({ key: KEY }, w.deps)).requests, [], 'unpaid drafts are not shown');
  const token = w.pay(id);
  const { request } = await buyer.confirm({ key: KEY, purchaseToken: token }, w.deps);
  assert.equal(request.status, 'paid');
  assert.equal(new Date(request.dueAt) - new Date(request.paidAt), DEADLINE_DAYS * DAY);
  assert.deepEqual(w.log, [['consume', token]]);
  assert.equal(w.rows.get(id).consumed, true);
});

test('the form is checked and tidied', async () => {
  const w = world();
  assert.equal(await code(buyer.draft({ ...form, forName: '  ' }, w.deps)), 'for_name');
  assert.equal(await code(buyer.draft({ ...form, brief: 'hi' }, w.deps)), 'brief');
  assert.equal(await code(buyer.draft({ ...form, key: 'short' }, w.deps)), 'key');
  const { id } = await buyer.draft({ ...form, occasion: 'Hacking', brief: 'x'.repeat(900), forName: 'Sam\u0000\u0007 Smith' }, w.deps);
  const r = w.rows.get(id);
  assert.equal(r.occasion, 'Just because'); assert.equal(r.brief.length, 300); assert.equal(r.for_name, 'Sam Smith');
});

test('a purchase token only ever pays for one request, and only its own', async () => {
  const w = world();
  const a = await paidRequest(w);
  // sending it again is harmless and does not create or change anything
  const again = await buyer.confirm({ key: KEY, purchaseToken: a.token }, w.deps);
  assert.equal(again.request.id, a.id);
  assert.equal(w.log.filter(l => l[0] === 'consume').length, 1);
  // another phone cannot claim it
  assert.equal(await code(buyer.confirm({ key: OTHER, purchaseToken: a.token }, w.deps)), 'token_used');
  // a real purchase made for request A cannot be pointed at draft B
  const b = await buyer.draft(form, w.deps);
  const tokenForA2 = w.pay(a.id);
  assert.equal(await code(buyer.confirm({ key: KEY, id: b.id, purchaseToken: tokenForA2 }, w.deps)), 'no_request');
  assert.equal(w.rows.get(b.id).status, 'draft');
  // and another phone's purchase cannot pay for this phone's draft
  const theirs = w.pay(b.id);
  assert.equal(await code(buyer.confirm({ key: OTHER, purchaseToken: theirs }, w.deps)), 'no_request');
});

test('made-up, cancelled and pending purchases pay for nothing', async () => {
  const w = world();
  const { id } = await buyer.draft(form, w.deps);
  assert.equal(await code(buyer.confirm({ key: KEY, purchaseToken: 'x'.repeat(60) }, w.deps)), 'play_unreachable');
  assert.equal(await code(buyer.confirm({ key: KEY, purchaseToken: w.pay(id, 1) }, w.deps)), 'not_paid');
  assert.equal(await code(buyer.confirm({ key: KEY, purchaseToken: w.pay(id, 2) }, w.deps)), 'pending');
  assert.equal(w.rows.get(id).status, 'draft');
  assert.deepEqual(w.log, []);
});

test('if Google cannot be reached to consume, the request is still paid and consuming is retried', async () => {
  const w = world();
  w.deps.play.consumeDown = true;
  const a = await paidRequest(w);
  assert.equal(a.request.status, 'paid'); assert.equal(w.rows.get(a.id).consumed, false);
  w.deps.play.consumeDown = false;
  await buyer.confirm({ key: KEY, purchaseToken: a.token }, w.deps);
  assert.equal(w.rows.get(a.id).consumed, true);
});

test('the studio queue, upload and delivery; only the buyer can watch', async () => {
  const w = world();
  const a = await paidRequest(w); w.tick(1000);
  const b = await paidRequest(w, { ...form, key: OTHER, forName: 'Lee' });
  const q = await studio.queue({}, w.deps);
  assert.deepEqual(q.waiting.map(r => r.id), [a.id, b.id], 'oldest first');
  assert.equal(await code(buyer.watch({ key: KEY, id: a.id }, w.deps)), 'not_ready');
  const up = await studio.uploadUrl({ id: a.id, ext: 'mov' }, w.deps);
  assert.match(up.path, new RegExp(`^${a.id}/\\d+\\.mov$`));
  assert.equal(await code(studio.ready({ id: a.id, path: up.path }, w.deps)), 'no_video', 'nothing uploaded yet');
  w.files.add(up.path);
  assert.equal(await code(studio.ready({ id: a.id, path: `${b.id}/1.mp4` }, w.deps)), 'no_video', "another request's file");
  assert.equal((await studio.ready({ id: a.id, path: up.path }, w.deps)).request.status, 'ready');
  assert.match((await buyer.watch({ key: KEY, id: a.id }, w.deps)).url, /for=3600$/);
  assert.match((await buyer.watch({ key: KEY, id: a.id, share: true }, w.deps)).url, /for=604800$/);
  assert.equal(await code(buyer.watch({ key: OTHER, id: a.id }, w.deps)), 'not_found');
  assert.equal(await code(studio.ready({ id: a.id, path: up.path }, w.deps)), 'not_waiting', 'cannot deliver twice');
  assert.equal(await code(buyer.cancel({ key: KEY, id: a.id }, w.deps)), 'too_late', 'no refund once delivered');
});

test('declining, cancelling and running late each refund exactly once', async () => {
  const w = world();
  const a = await paidRequest(w), b = await paidRequest(w), c = await paidRequest(w);
  const order = id => w.rows.get(id).order_id;
  const d = await studio.decline({ id: a.id, reason: 'Not one I can do' }, w.deps);
  assert.equal(d.request.status, 'declined'); assert.equal(d.request.reason, 'Not one I can do');
  assert.equal(await code(studio.decline({ id: a.id }, w.deps)), 'not_waiting');
  assert.equal((await buyer.cancel({ key: KEY, id: b.id }, w.deps)).request.status, 'refunded');
  assert.equal(await code(buyer.cancel({ key: KEY, id: b.id }, w.deps)), 'too_late');
  w.tick((DEADLINE_DAYS - 1) * DAY);
  assert.deepEqual((await studio.sweep({}, w.deps)).refunded, [], 'not late yet');
  w.tick(2 * DAY);
  assert.equal((await studio.queue({}, w.deps)).waiting[0].overdue, true);
  assert.deepEqual((await studio.sweep({}, w.deps)).refunded, [c.id]);
  assert.deepEqual((await studio.sweep({}, w.deps)).refunded, []);
  assert.deepEqual(w.log.filter(l => l[0] === 'refund').map(l => l[1]), [order(a.id), order(b.id), order(c.id)]);
});

test('a refund that Google rejects leaves the request waiting, not lost', async () => {
  const w = world();
  const a = await paidRequest(w);
  w.deps.play.refundDown = true;
  assert.equal(await code(buyer.cancel({ key: KEY, id: a.id }, w.deps)), 'refund_failed');
  assert.equal(w.rows.get(a.id).status, 'paid');
  w.deps.play.refundDown = false;
  assert.equal((await buyer.cancel({ key: KEY, id: a.id }, w.deps)).request.status, 'refunded');
});

test('deleting removes the request and its video, but not one still in the queue', async () => {
  const w = world();
  const a = await paidRequest(w);
  assert.equal(await code(buyer.remove({ key: KEY, id: a.id }, w.deps)), 'in_queue');
  const up = await studio.uploadUrl({ id: a.id }, w.deps); w.files.add(up.path);
  await studio.ready({ id: a.id, path: up.path }, w.deps);
  assert.equal(await code(buyer.remove({ key: OTHER, id: a.id }, w.deps)), 'not_found');
  await buyer.remove({ key: KEY, id: a.id }, w.deps);
  assert.equal(w.rows.has(a.id), false); assert.equal(w.files.has(up.path), false);
});

test('unfinished drafts are capped and cleared after a day', async () => {
  const w = world();
  for (let i = 0; i < 5; i++) await buyer.draft(form, w.deps);
  assert.equal(await code(buyer.draft(form, w.deps)), 'too_many');
  w.tick(DAY + 1000);
  await buyer.draft(form, w.deps);
  assert.equal(w.rows.size, 1);
});

test('unknown actions are refused, including inherited names', async () => {
  const w = world();
  assert.equal(await code(run(buyer, 'constructor', {}, w.deps)), 'action');
  assert.equal(await code(run(buyer, 'sweep', {}, w.deps)), 'action', 'studio actions are not reachable from the buyer side');
});
