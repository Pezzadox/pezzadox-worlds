# Video messages

People ask Kyle for a personal video, pay through Google Play, and watch it in the app.
Android only for now. The feature is **off** until the steps below are done: without the
two `PW_SUPABASE_…` secrets the app is built with no trace of it.

## How it works

1. The buyer fills in the form. The request is saved as a draft **before** any money moves.
2. Google Play takes the payment. The purchase is tied to that draft.
3. The app sends the purchase token to the backend, which asks Google directly whether it
   is real, paid and for that draft. Only then is the request marked paid and the purchase
   consumed (so the same person can buy another).
4. Kyle opens the studio page, reads the request, uploads the video. The buyer's app shows
   it as ready and, if they allowed notifications, tells them.
5. Refunds go back through Google Play automatically when Kyle declines, when the buyer
   cancels before it is recorded, or when 14 days pass without a video.

If the app closes between paying and confirming, it sends the purchase again next time it
opens. If a payment can never be matched to a request, it is never acknowledged, and Google
refunds it by itself after three days.

There are no accounts. Each phone keeps a random code; the backend stores only its hash and
uses it to show a phone its own requests.

## One-time setup

### 1. Supabase (the backend)

1. Create a project at supabase.com (EU or UK region). Note the **Project URL** and the
   **anon public** key (Settings → API).
2. Install the Supabase CLI, then from this repo:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push                                   # creates the table and the private video bucket
   supabase functions deploy video-request --no-verify-jwt
   supabase functions deploy video-studio --no-verify-jwt
   ```
3. Set the functions' secrets:
   ```bash
   supabase secrets set PLAY_PACKAGE_NAME=com.pezzadox.worlds
   supabase secrets set STUDIO_EMAILS=<the email you will sign in to the studio with>
   supabase secrets set SWEEP_SECRET=<a long random string, 24+ characters>
   supabase secrets set PLAY_SERVICE_ACCOUNT_JSON="$(cat play-service-account.json)"
   ```
   The service-account file is the same one the release pipeline uses. Do not commit it.
4. Authentication → Users → **Add user**: your studio email and a strong password, with
   "Auto confirm user" ticked. Then Authentication → Sign in / Providers → turn **off**
   "Allow new users to sign up".
5. The 14-day refund sweep. Database → Extensions → enable `pg_cron` and `pg_net`, then in
   the SQL editor (once), with your project URL and the sweep secret filled in:
   ```sql
   select cron.schedule('video-sweep', '15 3 * * *', $$
     select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/video-studio',
       headers := '{"content-type":"application/json","x-sweep-secret":"<SWEEP_SECRET>"}'::jsonb,
       body := '{"action":"sweep"}'::jsonb);
   $$);
   ```

### 2. Google Play

1. Play Console → the app → Monetise → Products → **In-app products** → create a product
   with ID exactly `video_message`, a name, a description and the price. Activate it.
   (A build containing the billing library must be uploaded once before this page unlocks.)
2. Users and permissions → the service account → give it **View financial data** and
   **Manage orders and subscriptions** for this app. Without the second one refunds fail.
3. App content: answer the questionnaires as below.

### 3. GitHub secrets (Settings → Secrets and variables → Actions)

| Secret | Value |
| --- | --- |
| `PW_SUPABASE_URL` | the Project URL, e.g. `https://abcd1234.supabase.co` |
| `PW_SUPABASE_ANON_KEY` | the **anon public** key. Never the service-role key: the build refuses it |

The next release build then includes video messages, and the next push to `main` publishes
the studio page.

### 4. The privacy policy

Replace the public policy page with the new `store/privacy-policy.md`.

## The studio (Kyle's queue)

`https://pezzadox.github.io/pezzadox-worlds/studio/` once the secrets are set. Sign in with
the studio email and password. Each waiting request shows who it is for, what to say and
when it is due. Choose the video file (MP4, MOV or WebM, up to 250 MB) and tap **Upload and
send**, or **Decline and refund**. The page can be added to your phone's home screen.

## Play Console answers once this is live

- **In-app purchases:** yes.
- **Data safety, collected (not shared), required for app functionality:**
  Personal info → Name (first names typed into a request); Messages → Other in-app messages
  (what Kyle is asked to say); Financial info → Purchase history; Photos and videos → Videos
  (the finished video, which is Kyle's recording, stored for the buyer).
  Encrypted in transit: yes. Users can request deletion: yes (in the app, and by email).
- **Target audience:** 18 and over is the simplest fit for a paid personal-message service.
- **Refund policy** in the listing: ready within 14 days or refunded in full; cancel any
  time before it is recorded.

Check these against the Play Console wording at the time; Google changes the forms.

## Testing before going live

Add your own Google account under Play Console → Settings → **Licence testing**. Purchases
by licence testers are free and go through the whole flow, including refunds.

## What has and has not been tested

Tested automatically (`npm test`): every payment and refund rule against a pretend Google
Play and database (`tests/test_video_rules.mjs`), and the app screens against a pretend
phone and backend (`tests/test_video.py`).

Not yet run for real: the edge functions against a live Supabase project, the calls to
Google Play's API, the studio upload, and the purchase screen on a phone. Run one
licence-tester purchase end to end, including a decline, before switching it on for everyone.
