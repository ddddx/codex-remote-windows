# Mobile Android Release CI

GitHub Actions workflow: `.github/workflows/mobile-android-release.yml`.

The workflow builds signed Android APKs without committing signing credentials.
It publishes a GitHub Release on every push to `main`. It also supports pushed
tags matching `mobile-v*` and manual `workflow_dispatch` runs.

Push builds create a unique release tag such as
`mobile-build-v1.0.11-123-abcdef123456`. The release notes include the commits
from that push plus generated GitHub release notes.

## Required GitHub Environment Secrets

Create an environment named `mobile-release`, then add these environment
secrets:

- `ANDROID_RELEASE_KEYSTORE_BASE64`
- `ANDROID_RELEASE_KEYSTORE_PASSWORD`
- `ANDROID_RELEASE_KEY_ALIAS`
- `ANDROID_RELEASE_KEY_PASSWORD`

To create the keystore base64 value on Windows PowerShell:

```powershell
[Convert]::ToBase64String(
  [IO.File]::ReadAllBytes("C:\path\to\release-signing.jks")
) | Set-Clipboard
```

Paste the clipboard value into `ANDROID_RELEASE_KEYSTORE_BASE64`.

Use the values from the local signing info file for the other three secrets.

Do not commit the `.jks`, `key.properties`, or the signing info text file. The
root `.gitignore` and `apps/mobile/android/.gitignore` both ignore these files.

## Publish

Every push to `main` builds and publishes signed APKs automatically.

For a named release tag, update `apps/mobile/pubspec.yaml` first, then push:

```powershell
git tag mobile-v1.0.11
git push origin mobile-v1.0.11
```

The release will contain:

- universal APK
- `arm64-v8a` APK
- `armeabi-v7a` APK
- `x86_64` APK
