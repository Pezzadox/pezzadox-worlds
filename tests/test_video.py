"""Video messages in the app, end to end in a browser: the form, the Google Play payment
(a stand-in for the phone's billing), a pretend backend, and recovery when the confirmation
is lost. The backend's own rules are tested separately in test_video_rules.mjs."""
import json, threading, http.server, functools, os, subprocess, sys, uuid
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', 'www')
API = 'https://video.test/functions/v1/video-request'
results = []
def check(name, cond): results.append(('PASS' if cond else 'FAIL') + ' ' + name)

def build(on):
    env = {k: v for k, v in os.environ.items() if not k.startswith('PW_')}
    if on: env.update(PW_TEST='1', PW_SUPABASE_URL='https://video.test', PW_SUPABASE_ANON_KEY='public-anon-key')
    subprocess.run(['node', 'tools/build.js'], cwd=os.path.join(HERE, '..'), env=env, check=True, stdout=subprocess.DEVNULL)

def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
    s = http.server.ThreadingHTTPServer(('127.0.0.1', 0), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s

# The phone's billing, faked: it records what the app asked for and hands back a purchase.
BILLING = """
window.__bill = { calls: [], mode: 'ok', owned: [] };
window.__pwVideoTest = { platform: '%s', billing: {
  getProduct: async o => { __bill.calls.push(['getProduct', o]); return { product: { identifier: 'video_message', priceString: '£4.99' } }; },
  purchaseProduct: async o => {
    __bill.calls.push(['purchaseProduct', o]);
    if (__bill.mode === 'cancel') throw Object.assign(new Error('User cancelled the purchase'), { code: 'USER_CANCELLED' });
    const t = { productIdentifier: o.productIdentifier, purchaseToken: 'tok-' + o.appAccountToken + '-' + 'x'.repeat(30), purchaseState: '1', isAcknowledged: false };
    __bill.owned.push(t); localStorage.setItem('test.owned', JSON.stringify(__bill.owned)); return t;
  },
  getPurchases: async () => ({ purchases: JSON.parse(localStorage.getItem('test.owned') || '[]') })
} };
"""

class Backend:
    """Just enough of the server to drive the screens."""
    def __init__(self): self.rows = {}; self.calls = []; self.fail_confirm = False
    def handle(self, r):
        cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'content-type': 'application/json'}
        if r.request.method == 'OPTIONS': return r.fulfill(status=200, headers=cors, body='ok')
        b = json.loads(r.request.post_data or '{}'); a = b.get('action'); self.calls.append((a, b, dict(r.request.headers)))
        out = lambda s, d: r.fulfill(status=s, headers=cors, body=json.dumps(d))
        pub = lambda x: {k: x.get(k) for k in ('id', 'status', 'forName', 'fromName', 'occasion', 'brief', 'paidAt', 'dueAt', 'readyAt', 'reason')}
        if a == 'draft':
            if not (b.get('forName') or '').strip(): return out(400, {'error': 'for_name', 'message': 'Say who the video is for.'})
            i = str(uuid.uuid4()); self.rows[i] = {'id': i, 'status': 'draft', 'key': b['key'], **{k: b.get(k) for k in ('forName', 'fromName', 'occasion', 'brief')}}
            return out(200, {'id': i})
        if a == 'confirm':
            if self.fail_confirm: return out(502, {'error': 'play_unreachable', 'message': 'Google Play could not confirm the payment just now.'})
            i = b['purchaseToken'].split('-', 1)[1].rsplit('-', 1)[0]; x = self.rows.get(i)
            if not x: return out(409, {'error': 'no_request', 'message': 'not found'})
            if x['status'] == 'draft': x.update(status='paid', paidAt='2026-11-18T10:00:00Z', dueAt='2026-12-02T10:00:00Z')
            return out(200, {'request': pub(x)})
        if a == 'list': return out(200, {'requests': [pub(x) for x in self.rows.values() if x['key'] == b['key'] and x['status'] != 'draft']})
        x = self.rows.get(b.get('id'))
        if a == 'watch': return out(200, {'url': 'https://files.test/' + x['id'] + '.mp4?share=' + str(bool(b.get('share')))})
        if a == 'cancel': x.update(status='refunded', reason='Cancelled by you'); return out(200, {'request': pub(x)})
        if a == 'remove': del self.rows[x['id']]; return out(200, {'removed': True})
        return out(400, {'error': 'action'})

def page(p, base, platform, backend):
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 430, 'height': 932}, has_touch=True)
    def route(r):
        u = r.request.url
        if u.startswith(API): return backend.handle(r)
        return r.abort()
    ctx.route('https://**/*', route)
    ctx.add_init_script(BILLING % platform)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(base); pg.wait_for_timeout(700)
    return b, pg, errs

bill = lambda pg: pg.evaluate('()=>__bill.calls')
text = lambda pg, sel: (pg.text_content(sel) or '').strip()

srv = serve(); base = f'http://127.0.0.1:{srv.server_port}/index.html'
with sync_playwright() as p:
    # Switched off unless the build knows its backend, and on iPhone for now.
    build(False)
    be = Backend(); b, pg, errs = page(p, base, 'android', be)
    check('no backend configured: nothing about video messages anywhere', pg.query_selector('[data-video]') is None and not be.calls and not errs)
    b.close()
    build(True)
    be = Backend(); b, pg, errs = page(p, base, 'ios', be)
    check('iPhone: hidden for now, no billing or backend calls', pg.query_selector('[data-video]') is None and not be.calls and not bill(pg))
    b.close()

    be = Backend(); b, pg, errs = page(p, base, 'android', be)
    check('Android: the card is on Home', 'Get a personal video message' in text(pg, '#v-home'))
    check('the phone key is sent with the public key only', be.calls and be.calls[0][0] == 'list' and len(be.calls[0][1]['key']) >= 64 and be.calls[0][2].get('apikey') == 'public-anon-key')
    pg.click('[data-video="open"]'); pg.wait_for_timeout(300)
    check('price comes from Google Play', 'Pay £4.99 and send to Kyle' in text(pg, '#vform button[type=submit]'))
    check('terms say who takes payment and when you are refunded', all(s in text(pg, '.vterms') for s in ['Google Play', '14 days', 'refunded in full', 'cancel']))

    # An empty form is refused by the server and nothing is charged.
    pg.click('#vform button[type=submit]'); pg.wait_for_timeout(300)
    check('empty form: told what is missing, billing never opened', 'Say who the video is for.' in text(pg, '.verr') and not any(c[0] == 'purchaseProduct' for c in bill(pg)))

    def fill(name='Sam'):
        pg.fill('#vFor', name); pg.fill('#vFrom', 'Jo'); pg.select_option('#vOcc', 'Good luck')
        pg.fill('#vBrief', 'Big interview on Friday. She loves the ghost episodes.')
    fill()
    check('character count follows the typing', text(pg, '#vCount') == '54/300')

    # Backing out of the Google Play screen: no error, no request, form kept.
    pg.evaluate("()=>{__bill.mode='cancel'}")
    pg.click('#vform button[type=submit]'); pg.wait_for_timeout(300)
    check('cancelling at Google Play: no error shown, nothing listed, form kept', pg.query_selector('.verr') is None and pg.query_selector('.vreq') is None and pg.input_value('#vFor') == 'Sam')

    # A normal purchase.
    pg.evaluate("()=>{__bill.mode='ok'}")
    pg.click('#vform button[type=submit]'); pg.wait_for_timeout(500)
    buy = [c for c in bill(pg) if c[0] == 'purchaseProduct'][-1][1]
    drafts = [c for c in be.calls if c[0] == 'draft']
    paid = [x for x in be.rows.values() if x['status'] == 'paid']
    check('request is written down before payment, and the purchase is tied to it', len(paid) == 1 and buy['appAccountToken'] == paid[0]['id'] and buy['productIdentifier'] == 'video_message')
    check('the app does not acknowledge the purchase itself: the server does, after checking', buy.get('autoAcknowledgePurchases') is False and buy.get('isConsumable') is False)
    check('what was typed reaches Kyle unchanged', drafts[-1][1]['forName'] == 'Sam' and drafts[-1][1]['occasion'] == 'Good luck' and 'ghost episodes' in drafts[-1][1]['brief'])
    card = text(pg, '.vreq')
    check('listed as waiting, with the money-back date', 'Waiting for Kyle' in card and 'For Sam' in card and '2 Dec' in card and 'money back' in card)
    check('form is cleared for the next one', pg.input_value('#vFor') == '' and pg.input_value('#vBrief') == '')

    # Payment taken but the confirmation is lost: said plainly, then recovered on next launch.
    be.fail_confirm = True
    fill('Lee'); pg.click('#vform button[type=submit]'); pg.wait_for_timeout(500)
    check('lost confirmation: told the payment went through and will be checked again', 'payment went through' in text(pg, '.verr') and len(pg.query_selector_all('.vreq')) == 1)
    be.fail_confirm = False
    pg.reload(); pg.wait_for_timeout(900)
    check('next launch sends the purchase again and the request appears', sorted(x['forName'] for x in be.rows.values() if x['status'] == 'paid') == ['Lee', 'Sam'])
    pg.click('#tabs [data-tab="more"]'); pg.wait_for_timeout(100)
    check('More tab shows the count', '2 requests' in text(pg, '#v-more'))

    # Kyle delivers one.
    sam = next(x for x in be.rows.values() if x['forName'] == 'Sam' and x['status'] == 'paid'); sam.update(status='ready', readyAt='2026-11-20T09:00:00Z')
    pg.reload(); pg.wait_for_timeout(900)
    check('Home says the video is ready', 'Your video is ready' in text(pg, '#v-home'))
    pg.click('[data-video="open"]'); pg.wait_for_timeout(400)
    pg.click(f'[data-video="watch"][data-id="{sam["id"]}"]'); pg.wait_for_timeout(300)
    src = pg.get_attribute('#vid video', 'src') or ''
    check('Watch plays the signed link in the app', src.endswith(sam['id'] + '.mp4?share=False') and pg.get_attribute('#vid video', 'controls') is not None)
    pg.click('[data-vclose]'); pg.wait_for_timeout(100)
    pg.reload(); pg.wait_for_timeout(900)
    check('once opened, Home stops announcing it', 'Your video is ready' not in text(pg, '#v-home'))

    # Cancel and delete both need a second tap.
    pg.click('[data-video="open"]'); pg.wait_for_timeout(400)
    lee = next(x for x in be.rows.values() if x['forName'] == 'Lee')
    sel = f'[data-video="cancel"][data-id="{lee["id"]}"]'
    pg.click(sel); pg.wait_for_timeout(150)
    check('first tap on Cancel only asks', lee['status'] == 'paid' and 'Tap again' in text(pg, '#toast'))
    pg.click(sel); pg.wait_for_timeout(400)
    check('second tap cancels and shows the refund', lee['status'] == 'refunded' and 'Refunded' in text(pg, '.vlist'))
    sel = f'[data-video="remove"][data-id="{lee["id"]}"]'
    pg.click(sel); pg.wait_for_timeout(150); pg.click(sel); pg.wait_for_timeout(400)
    check('delete removes it for good', lee['id'] not in be.rows and len(pg.query_selector_all('.vreq')) == 1)
    check('no page errors', not errs)
    if errs: print(errs[:3])
    if len(sys.argv) > 1: pg.screenshot(path=sys.argv[1], full_page=False)
    b.close()

build(False)   # leave www/ as a normal build
print('\n'.join(results))
sys.exit(1 if any(r.startswith('FAIL') for r in results) else 0)
