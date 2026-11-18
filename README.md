# Pezzadox Worlds

The Pezzadox app for iPhone and Android: the three shows, every episode, the eight
Pezzadox Dimension Hop games, and new episode alerts. Developer: Pezzadox.

App id on both stores: `com.pezzadox.worlds`. Home-screen name: Pezzadox.

## How it works

The app is a small shell (`www/index.html`, `src/app.js`) around www.pezzadox.com:

- **Episodes** come from the site's `pezzadox-sitemap.txt` and each episode page's JSON-LD
  (title, YouTube video, length, topic, thumbnail). `www/data/episodes.json` is a built-in
  snapshot so the app works on first launch and offline. New episodes on the site appear
  in the app by themselves, marked New. Nothing to update here when an episode goes up.
- **Games, shows, shorts, guests, news, shop, booking** open the site's own pages in an
  in-app browser.
- **New episode alerts** (`www/runners/episodes.js`) run as a background task every few
  hours, compare the sitemap with the episodes already seen, and post a local notification.
  No server and no push service account needed.

- **Video messages** (Android): people pay through Google Play for a personal video from
  Kyle and watch it in the app. The app side is `src/video.js`; the rules for payments and
  refunds are `supabase/functions/_shared/core.js`; Kyle's queue is `site/video-studio.html`.
  Off until the backend is set up: see `docs/video-messages.md`.

## Develop

```bash
npm install
npm test          # builds www/app.js, then the phone-size tests and the video-message payment rules
npm run sync      # build and copy into the iOS and Android projects
```

## Release

See `docs/release-runbook.md`. In short: `git tag v1.0.0 && git push origin v1.0.0`.
