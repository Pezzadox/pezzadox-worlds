// Kyle's side of video messages: the queue, uploading a finished video, declining.
// Only people signed in with an email listed in STUDIO_EMAILS get in. The 'sweep' action
// (refund anything overdue) can also be run by a timer that sends SWEEP_SECRET.
import { studio, run } from '../_shared/core.js';
import { admin, answer, cors, deps, json } from '../_shared/adapters.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');

  const secret = Deno.env.get('SWEEP_SECRET') || '';
  const timer = action === 'sweep' && secret.length >= 24 && req.headers.get('x-sweep-secret') === secret;
  if (!timer) {
    const allowed = (Deno.env.get('STUDIO_EMAILS') || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data } = await admin().auth.getUser(jwt);
    const email = (data?.user?.email || '').toLowerCase();
    if (!email || !data?.user?.email_confirmed_at || !allowed.includes(email)) return json(403, { error: 'forbidden', message: 'This account cannot open the studio.' });
  }
  return answer(() => run(studio, action, body, deps()));
});
