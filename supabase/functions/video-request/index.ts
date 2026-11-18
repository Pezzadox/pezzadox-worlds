// The app's side of video messages: write the request down, confirm the Google Play
// payment, list my requests, watch, cancel, delete. Called with the project's public key.
import { buyer, run } from '../_shared/core.js';
import { answer, cors, deps, json } from '../_shared/adapters.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const body = await req.json().catch(() => ({}));
  return answer(() => run(buyer, String(body.action || ''), body, deps()));
});
