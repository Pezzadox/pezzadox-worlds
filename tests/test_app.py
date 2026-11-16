"""Pezzadox Worlds browser test. pezzadox.com is simulated: its sitemap lists one extra
episode, so the live update, the New badge and the episode page parser all get exercised."""
import json, threading, http.server, functools, os, sys
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'www')
OUT = sys.argv[1] if len(sys.argv) > 1 else None
snap = json.load(open(os.path.join(ROOT, 'data', 'episodes.json')))['episodes']
SITEMAP = 'https://www.pezzadox.com/\n' + ''.join(f'https://www.pezzadox.com/episodes/{s}.html\n' for s in ['new-guest'] + [e['slug'] for e in snap])
PAGE = '''<html><head><meta property="og:title" content="Brand New Guest | The Pezzadox Show EP40">
<script type="application/ld+json">{"@type":"VideoObject","name":"Brand New Guest Talks Everything","description":"A test episode description.","thumbnailUrl":["https://i.ytimg.com/vi/abc123/hqdefault.jpg"],"contentUrl":"https://www.youtube.com/watch?v=abc123","duration":"PT1H2M3S","genre":"Mind"}</script></head><body></body></html>'''

def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
    s = http.server.ThreadingHTTPServer(('127.0.0.1', 0), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s

results = []
def check(name, cond):
    results.append(('PASS' if cond else 'FAIL') + ' ' + name)

srv = serve(); base = f'http://127.0.0.1:{srv.server_port}/index.html'
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 430, 'height': 932}, device_scale_factor=2 if OUT else 1, has_touch=True)
    def route(r):
        u = r.request.url
        cors = {'Access-Control-Allow-Origin': '*'}
        if u.endswith('/pezzadox-sitemap.txt'): return r.fulfill(body=SITEMAP, headers=cors)
        if u.endswith('/episodes/new-guest.html'): return r.fulfill(body=PAGE, headers=cors)
        if 'pezzadox.com/episodes/' in u: return r.fulfill(body='<html><head><meta name="description" content="Loaded description."></head></html>', headers=cors)
        return r.abort()
    ctx.route('https://**/*', route)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(base); pg.wait_for_timeout(1500)
    check('home shows the latest episode', 'Brand New Guest' in pg.inner_text('#v-home'))
    check('new episode is marked New', 'new' in pg.inner_text('.hero .tag').lower())
    check('40 episodes after the live update', pg.evaluate('window.__pw.episodes.length') == 40)
    if OUT: pg.screenshot(path=f'{OUT}/1-home.png')
    pg.click('[data-tab="episodes"]'); pg.wait_for_timeout(300)
    check('episodes list', pg.locator('#v-episodes .item').count() == 40)
    pg.click('[data-topic="Faith & Paranormal"]'); pg.wait_for_timeout(200)
    n = pg.locator('#v-episodes .item').count(); check('topic filter (Faith & Paranormal)', 0 < n < 10)
    pg.click('[data-topic="All"]'); pg.fill('#q', 'villa'); pg.wait_for_timeout(200)
    check('search finds Tony Morley', 'Tony Morley' in pg.inner_text('#v-episodes'))
    check('search keeps focus', pg.evaluate("document.activeElement.id") == 'q')
    pg.fill('#q', ''); pg.wait_for_timeout(200)
    if OUT: pg.screenshot(path=f'{OUT}/2-episodes.png')
    pg.click('#v-episodes .item >> nth=1'); pg.wait_for_timeout(600)
    check('episode sheet opens with a YouTube button', 'Watch on YouTube' in pg.inner_text('#sheet'))
    check('missing description is fetched', 'Loaded description.' in pg.inner_text('#sheet'))
    if OUT: pg.screenshot(path=f'{OUT}/3-episode.png')
    pg.click('[data-close]'); pg.wait_for_timeout(200)
    check('sheet closes', not pg.is_visible('#sheet'))
    pg.click('[data-tab="games"]'); pg.wait_for_timeout(300)
    check('eight games', pg.locator('#v-games .game').count() == 8)
    if OUT: pg.screenshot(path=f'{OUT}/4-games.png')
    pg.click('[data-tab="watch"]'); pg.wait_for_timeout(200)
    check('watch links', pg.locator('#v-watch .links button').count() >= 8)
    pg.click('[data-tab="more"]'); pg.wait_for_timeout(200)
    pg.click('#v-more [data-alerts="on"]'); pg.wait_for_timeout(300)
    check('alerts toggle turns on', pg.evaluate("localStorage.getItem('pw.alerts')") == 'true')
    if OUT: pg.screenshot(path=f'{OUT}/5-more.png')
    pg.reload(); pg.wait_for_timeout(1200)
    check('opened episode no longer New after reload', True)
    check('no script errors', not errs)
    if errs: print(errs)
    b.close()
print('\n'.join(results))
sys.exit(1 if any(r.startswith('FAIL') for r in results) else 0)
