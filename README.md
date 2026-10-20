# Native Android Converter

A private browser page for converting an Android ZIP into a signed AAB and a
universal APK, using the same private signing setup as Bubblewrap Builder.

## What to upload

- A ZIP containing **one `.aab`**. The converter removes its previous JAR signing
  metadata, signs the AAB with your key, and creates a universal APK from it.
- Or one native Android Gradle source project, including `gradlew`,
  `gradle/wrapper/gradle-wrapper.jar`, `gradle-wrapper.properties`, settings,
  and the app module. Its release AAB is built before conversion and signing.

Up to 30 MB compressed / 512 MB expanded. Source projects use the `bundleRelease`
task of the selected module (`app` by default). A project ZIP may have one outer
folder. Unneeded `.git`, `.gradle`, IDE and source build directories are ignored.
Only one project/release bundle is supported per request. APK-only and website
ZIPs cannot recreate the original AAB or become a native medication app.

App name, package ID, version, icon, Firebase behavior and local Android reminders
come from the input app, not from this signing converter. AAB features must support
bundletool's universal APK generation. This is not an arbitrary file converter.

## Signing setup — reuse, do not replace

Select your existing **private builder repository**, normally
`Ventsharm/private-android-builder`. Keep its four existing Actions secrets:

- `KEYSTORE_BASE64`
- `KEYSTORE_PASSWORD`
- `KEY_ALIAS`
- `KEY_PASSWORD`

Your fine-grained GitHub token grants access to that repository; it does not store
these secrets itself. The converter cannot read their values through the API.
Enter the token only into the converter page. It needs **Actions, Contents and
Workflows: Read and write** for the selected private build repository. No token,
JKS, alias or password belongs in this source repository, chat or input ZIP.

The page installs `.github/workflows/native-android-convert.yml` in the selected
private builder repository, leaving Bubblewrap's `build-public.yml` unchanged.
An existing unrelated workflow at the same new path is never overwritten.

## Privacy and hosting

This source repository is private. **A private GitHub repository does not by
itself make an ordinary GitHub Pages website private.** The working page is
published with owner-only sign-in protection through Sites. Keep this audience
private when updating it. Do not turn on public GitHub Pages as a substitute.

The frontend contains no analytics or third-party JavaScript. It holds the GitHub
token in this tab only, never in localStorage, sessionStorage, cookies, URLs or
service-worker caches. Requests using the token go directly to GitHub. No signing
secret is sent to the website host. The frontend files and workflow contain only
public code and the names of your repository secrets.

## Build isolation and cleanup

1. Source goes to a temporary **draft release in your selected private repo**.
   It is not committed to repository history.
2. A preparation job verifies the upload belongs to the current random request ID,
   checks ZIP paths, rejects links/secret files/oversized inputs, and builds source
   projects **without the signing secrets**.
3. A separate clean signing job downloads only the prepared AAB. It uses official
   SHA-256-verified bundletool 1.18.3 and the existing repository secrets. Uploaded
   Gradle scripts never run in this signing job. Secrets are provided only to the
   signing step; temporary key/password files are removed on step exit.
4. Both signed outputs are checked against the keystore's public certificate.
   The signed artifact contains only `app-release.apk`, `app-release.aab`, and a
   public certificate fingerprint. GitHub retains it for **one day**.
5. A separate cleanup job removes this request's draft upload and unsigned
   artifact, including after ordinary build/sign failures. Cancelled runs, token
   failures or workflows that never start may leave an upload; the page provides
   its private GitHub link for manual deletion.

APK and AAB use your existing key, not a generated replacement. For an existing
Google Play listing the package/version and accepted upload key must match that
listing. If Google Play App Signing uses a separate app-signing key, a directly
installed APK signed with the upload key cannot update a Play-installed copy
signed with Google's app-signing key.

GitHub Actions time/storage allowances apply. The converter does not enable
billing or buy build minutes. Only upload your own apps or source you trust.

## Updating

Edit `index.html`, `builder.js` or `workflow.yml` here, run checks, then publish the
matching private Site version. The next conversion updates this converter's
workflow in the chosen private build repo. Existing signing secrets are never
changed. Keep the original Bubblewrap Builder separate.

Run `node --test tests/*.test.cjs` and `python3 -m unittest discover -s tests`.
Python ZIP-workflow tests use PyYAML (`python3 -m pip install -r requirements-dev.txt`).
