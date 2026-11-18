// Video messages: the rules, with no knowledge of Supabase or Google in them.
// Everything that touches the outside world comes in through `deps`, so the money logic
// (who has paid, who gets refunded, who may watch what) can be tested on its own.
//
// deps = {
//   db:      { insert, get, byToken, listByDevice, listByStatus, update, remove, countDrafts, pruneDrafts },
//   play:    { getPurchase(productId, token), consume(productId, token), refund(orderId) },
//   storage: { signedUrl(path, seconds), signedUpload(path), remove(path), exists(path) },
//   hash:    async text => hex,   now: () => Date
// }

export const PRODUCT = 'video_message';
export const DEADLINE_DAYS = 14;
export const OCCASIONS = ['Birthday', 'Congratulations', 'Good luck', 'Thank you', 'Get well soon', 'Just because'];
const DAY = 86400000;

export class Problem extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new Problem(status, code, message); };

const text = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);

export function clean(input) {
  const forName = text(input?.forName, 40), fromName = text(input?.fromName, 40), brief = text(input?.brief, 300);
  const occasion = OCCASIONS.includes(input?.occasion) ? input.occasion : 'Just because';
  if (!forName) fail(400, 'for_name', 'Say who the video is for.');
  if (!fromName) fail(400, 'from_name', 'Say who it is from.');
  if (brief.length < 10) fail(400, 'brief', 'Tell Kyle a little more about what to say.');
  return { for_name: forName, from_name: fromName, occasion, brief };
}

async function device(body, deps) {
  const key = String(body?.key ?? '');
  if (key.length < 32 || key.length > 128) fail(400, 'key', 'This phone could not be recognised. Update the app and try again.');
  return deps.hash(key);
}

// What a buyer is allowed to see about their own request.
export const forBuyer = r => ({
  id: r.id, status: r.status, forName: r.for_name, fromName: r.from_name, occasion: r.occasion, brief: r.brief,
  paidAt: r.paid_at, dueAt: r.due_at, readyAt: r.ready_at, reason: r.reason || null
});

async function mine(body, deps) {
  const hash = await device(body, deps);
  const row = await deps.db.get(String(body?.id ?? ''));
  if (!row || row.device_hash !== hash) fail(404, 'not_found', 'That request could not be found.');
  return row;
}

async function tryConsume(row, deps) {
  if (row.consumed) return row;
  try {
    await deps.play.consume(PRODUCT, row.purchase_token);
    return (await deps.db.update(row.id, { consumed: true })) || row;
  } catch { return row; }   // paid either way; the next call tries again
}

async function refundAs(row, status, reason, deps) {
  // Claim the row first so two refunds can never race, then pay the money back.
  const claimed = await deps.db.update(row.id, { status: 'refunding' }, 'paid');
  if (!claimed) fail(409, 'changed', 'That request has already changed.');
  try { await deps.play.refund(row.order_id); }
  catch (e) { await deps.db.update(row.id, { status: 'paid' }, 'refunding'); fail(502, 'refund_failed', 'Google Play could not refund this just now. Try again shortly.'); }
  return deps.db.update(row.id, { status, reason, closed_at: deps.now().toISOString() }, 'refunding');
}

export const buyer = {
  // Step 1: the request is written down before any money moves.
  async draft(body, deps) {
    const hash = await device(body, deps);
    const fields = clean(body);
    await deps.db.pruneDrafts(new Date(deps.now() - DAY).toISOString());
    if (await deps.db.countDrafts(hash) >= 5) fail(429, 'too_many', 'Too many unfinished requests. Try again tomorrow.');
    const row = await deps.db.insert({ ...fields, device_hash: hash, status: 'draft' });
    return { id: row.id };
  },

  // Step 2: after Google Play takes payment the app sends the purchase token here.
  // Google is asked directly whether it is real, paid, and belongs to this request.
  async confirm(body, deps) {
    const hash = await device(body, deps);
    const token = String(body?.purchaseToken ?? '');
    if (token.length < 20) fail(400, 'token', 'The purchase could not be read.');

    const used = await deps.db.byToken(token);
    if (used) {
      if (used.device_hash !== hash) fail(409, 'token_used', 'That purchase belongs to another request.');
      return { request: forBuyer(await tryConsume(used, deps)) };
    }

    let p;
    try { p = await deps.play.getPurchase(PRODUCT, token); }
    catch { fail(502, 'play_unreachable', 'Google Play could not confirm the payment just now. It will be checked again.'); }
    if (p.purchaseState === 2) fail(202, 'pending', 'The payment is still going through. Your request will appear once it clears.');
    if (p.purchaseState !== 0) fail(402, 'not_paid', 'Google Play says this purchase was not completed.');

    const id = p.obfuscatedExternalAccountId || String(body?.id ?? '');
    const row = id ? await deps.db.get(id) : null;
    if (!row || row.device_hash !== hash || row.status !== 'draft')
      fail(409, 'no_request', 'The request for this payment could not be found, so Google Play will refund it automatically within three days.');

    const now = deps.now();
    const paid = await deps.db.update(row.id, {
      status: 'paid', purchase_token: token, order_id: p.orderId || null,
      paid_at: now.toISOString(), due_at: new Date(+now + DEADLINE_DAYS * DAY).toISOString()
    }, 'draft');
    if (!paid) fail(409, 'changed', 'That request has already changed.');
    return { request: forBuyer(await tryConsume(paid, deps)) };
  },

  async list(body, deps) {
    const hash = await device(body, deps);
    const rows = await deps.db.listByDevice(hash);
    return { requests: rows.filter(r => r.status !== 'draft').map(r => forBuyer(r.status === 'refunding' ? { ...r, status: 'paid' } : r)) };
  },

  async watch(body, deps) {
    const row = await mine(body, deps);
    if (row.status !== 'ready' || !row.video_path) fail(409, 'not_ready', 'This video is not ready yet.');
    return { url: await deps.storage.signedUrl(row.video_path, body?.share ? 7 * 86400 : 3600) };
  },

  // The buyer changes their mind before Kyle has recorded it: full refund.
  async cancel(body, deps) {
    const row = await mine(body, deps);
    if (row.status !== 'paid') fail(409, 'too_late', 'This request can no longer be cancelled.');
    return { request: forBuyer(await refundAs(row, 'refunded', 'Cancelled by you', deps)) };
  },

  // Removes a finished request, and its video, for good.
  async remove(body, deps) {
    const row = await mine(body, deps);
    if (row.status === 'paid' || row.status === 'refunding') fail(409, 'in_queue', 'Cancel the request first, then you can delete it.');
    if (row.video_path) await deps.storage.remove(row.video_path).catch(() => {});
    await deps.db.remove(row.id);
    return { removed: true };
  }
};

// What Kyle sees in the studio.
const forStudio = (r, now) => ({ ...forBuyer(r), overdue: r.status === 'paid' && !!r.due_at && new Date(r.due_at) < now });

export const studio = {
  async queue(_body, deps) {
    const now = deps.now();
    const [paid, ready] = await Promise.all([deps.db.listByStatus('paid'), deps.db.listByStatus('ready')]);
    return {
      waiting: paid.sort((a, b) => String(a.paid_at).localeCompare(String(b.paid_at))).map(r => forStudio(r, now)),
      sent: ready.sort((a, b) => String(b.ready_at).localeCompare(String(a.ready_at))).slice(0, 30).map(r => forStudio(r, now))
    };
  },

  async uploadUrl(body, deps) {
    const row = await deps.db.get(String(body?.id ?? ''));
    if (!row || row.status !== 'paid') fail(409, 'not_waiting', 'That request is not waiting for a video.');
    const ext = ['mp4', 'mov', 'webm'].includes(body?.ext) ? body.ext : 'mp4';
    const path = `${row.id}/${deps.now().getTime()}.${ext}`;
    return { path, ...(await deps.storage.signedUpload(path)) };
  },

  async ready(body, deps) {
    const row = await deps.db.get(String(body?.id ?? ''));
    const path = String(body?.path ?? '');
    if (!row || row.status !== 'paid') fail(409, 'not_waiting', 'That request is not waiting for a video.');
    if (!path.startsWith(row.id + '/') || !(await deps.storage.exists(path))) fail(400, 'no_video', 'Upload the video first.');
    const done = await deps.db.update(row.id, { status: 'ready', video_path: path, ready_at: deps.now().toISOString() }, 'paid');
    if (!done) fail(409, 'changed', 'That request has already changed.');
    return { request: forStudio(done, deps.now()) };
  },

  async decline(body, deps) {
    const row = await deps.db.get(String(body?.id ?? ''));
    if (!row || row.status !== 'paid') fail(409, 'not_waiting', 'That request is not waiting for a video.');
    const reason = text(body?.reason, 200) || 'Kyle could not make this one';
    return { request: forStudio(await refundAs(row, 'declined', reason, deps), deps.now()) };
  },

  // Run on a timer: anything paid for and not made by its due date is refunded.
  async sweep(_body, deps) {
    const now = deps.now();
    const late = (await deps.db.listByStatus('paid')).filter(r => r.due_at && new Date(r.due_at) < now);
    const refunded = [], failed = [];
    for (const r of late) {
      try { await refundAs(r, 'refunded', `Not made within ${DEADLINE_DAYS} days`, deps); refunded.push(r.id); }
      catch { failed.push(r.id); }
    }
    return { refunded, failed };
  }
};

export async function run(table, action, body, deps) {
  const fn = Object.prototype.hasOwnProperty.call(table, action) ? table[action] : null;
  if (!fn) fail(400, 'action', 'Unknown action.');
  return fn(body, deps);
}
