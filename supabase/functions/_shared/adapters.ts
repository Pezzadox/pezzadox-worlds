// The real-world side of the video-message rules: Supabase for rows and files,
// Google Play's Developer API for checking, consuming and refunding purchases.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const BUCKET = 'video-messages';
export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-sweep-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

export const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = ''; for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// Signs in to Google as the Play service account (the same JSON the release pipeline uses).
let cached: { token: string; until: number } | null = null;
async function googleToken(): Promise<string> {
  if (cached && cached.until > Date.now() + 60000) return cached.token;
  const sa = JSON.parse(Deno.env.get('PLAY_SERVICE_ACCOUNT_JSON')!);
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const der = Uint8Array.from(atob(String(sa.private_key).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`)));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` })
  });
  if (!r.ok) throw new Error('google sign-in ' + r.status);
  const j = await r.json();
  cached = { token: j.access_token, until: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}
async function playApi(path: string, method = 'GET') {
  const pkg = Deno.env.get('PLAY_PACKAGE_NAME') || 'com.pezzadox.worlds';
  const r = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}/${path}`, {
    method, headers: { authorization: 'Bearer ' + await googleToken() }
  });
  if (!r.ok) throw new Error(`play ${method} ${path.split('/')[0]} ${r.status}`);
  return r.status === 204 ? {} : await r.json().catch(() => ({}));
}

export function deps() {
  const sb = admin(), t = () => sb.from('video_requests');
  const one = async (q: any) => { const { data, error } = await q; if (error) throw error; return data ?? null; };
  return {
    now: () => new Date(),
    hash: async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join(''),
    db: {
      insert: (row: any) => one(t().insert(row).select().single()),
      get: (id: string) => /^[0-9a-f-]{36}$/i.test(id) ? one(t().select().eq('id', id).maybeSingle()) : Promise.resolve(null),
      byToken: (token: string) => one(t().select().eq('purchase_token', token).maybeSingle()),
      listByDevice: async (h: string) => (await one(t().select().eq('device_hash', h).order('created_at', { ascending: false }).limit(50))) ?? [],
      listByStatus: async (s: string) => (await one(t().select().eq('status', s).limit(500))) ?? [],
      update: (id: string, patch: any, only?: string) => { let q = t().update(patch).eq('id', id); if (only) q = q.eq('status', only); return one(q.select().maybeSingle()); },
      remove: async (id: string) => { await one(t().delete().eq('id', id)); },
      countDrafts: async (h: string) => { const { count, error } = await t().select('id', { count: 'exact', head: true }).eq('device_hash', h).eq('status', 'draft'); if (error) throw error; return count ?? 0; },
      pruneDrafts: async (before: string) => { await one(t().delete().eq('status', 'draft').lt('created_at', before)); }
    },
    play: {
      getPurchase: (product: string, token: string) => playApi(`purchases/products/${encodeURIComponent(product)}/tokens/${encodeURIComponent(token)}`),
      consume: (product: string, token: string) => playApi(`purchases/products/${encodeURIComponent(product)}/tokens/${encodeURIComponent(token)}:consume`, 'POST'),
      refund: (orderId: string) => playApi(`orders/${encodeURIComponent(orderId)}:refund?revoke=true`, 'POST')
    },
    storage: {
      signedUrl: async (path: string, seconds: number) => { const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, seconds); if (error) throw error; return data.signedUrl; },
      signedUpload: async (path: string) => { const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path); if (error) throw error; return { uploadUrl: data.signedUrl, token: data.token }; },
      remove: async (path: string) => { await sb.storage.from(BUCKET).remove([path]); },
      exists: async (path: string) => { const i = path.lastIndexOf('/'); const { data } = await sb.storage.from(BUCKET).list(path.slice(0, i), { search: path.slice(i + 1) }); return !!data?.some(f => f.name === path.slice(i + 1)); }
    }
  };
}

export async function answer(work: () => Promise<unknown>) {
  try { return json(200, await work()); }
  catch (e: any) {
    if (e && typeof e.status === 'number' && e.code) return json(e.status, { error: e.code, message: e.message });
    console.error(e);
    return json(500, { error: 'server', message: 'Something went wrong. Please try again.' });
  }
}
