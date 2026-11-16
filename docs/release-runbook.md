# Release runbook: Pezzadox Worlds

## Release

    git tag v1.0.0 && git push origin v1.0.0

That builds the Android bundle and the iOS build and uploads them to Play internal
testing and TestFlight. Both arrive as drafts; nothing reaches anyone until it is
promoted in the console. The workflow can also be started by hand from the Actions tab
(Release → Run workflow).

App id on both stores: `com.pezzadox.worlds`

## Secrets (GitHub → Settings → Secrets and variables → Actions)

Android:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the upload keystore, base64 |
| `ANDROID_KEYSTORE_PASSWORD` | its password |
| `ANDROID_KEY_ALIAS` | `pezzadoxworlds` |
| `ANDROID_KEY_PASSWORD` | the key password |
| `PLAY_SERVICE_ACCOUNT_JSON` | the Play service-account JSON, whole (the same one as World Mapper works) |

Apple (all the same values as World Mapper, apart from nothing):

| Secret | Value |
| --- | --- |
| `APP_STORE_CONNECT_API_KEY` | the .p8 key, base64 |
| `APP_STORE_CONNECT_KEY_ID` | key id |
| `APP_STORE_CONNECT_ISSUER_ID` | issuer id |
| `IOS_TEAM_ID` | team id |
| `MATCH_GIT_URL` | the certificates repo; `world-mapper-certs` can hold this app's profile too |
| `MATCH_GIT_TOKEN` | a fine-grained PAT for that repo |
| `MATCH_PASSWORD` | the passphrase encrypting the stored certificate |

Either half is skipped, with a warning, when its secrets are absent.

## First Android release only

Google refuses API uploads until one build has gone in through the console. Download
the `.aab` from the workflow run's artifacts and upload it by hand once, under
Testing → Internal testing.

## Store pages

Listings, screenshots and the privacy policy are in `store/`. The privacy policy needs a
public web address for both stores: GitHub Pages or the website both work.

Store questionnaires, for reference: no data collected, no ads, no tracking, no account,
suitable for everyone (Apple 4+, Google content rating "Everyone"). Category: Entertainment.
