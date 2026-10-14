# Install Fridge Chef on iPhone

## Steps (Safari)

1. Open the app URL in **Safari** (not Chrome — iOS “Add to Home Screen” works best from Safari).
2. Tap **Share** (the square with an arrow).
3. Tap **Add to Home Screen**.
4. Tap **Add**. The Fridge Chef icon appears on your home screen.
5. Open it from the home screen. After the first visit, the service worker caches the app shell so it opens offline.

## If the app looks blank offline

- Open it once while online so the service worker can cache all files.
- Then try Airplane Mode → open from the home screen again. Saved plans, pantry and recipes should still load.

## Moving saved data from Safari → home-screen app

iOS treats Safari and the home-screen app as separate storage. Plans saved in Safari do **not** automatically carry over.

To move them:
1. In Safari, go to **Saved → Download backup (JSON)** (or **Save offline file**).
2. In the home-screen app, go to **Saved → Restore from backup** and pick that JSON file.
3. Or keep the exported offline HTML file in the Files app as a read-only snapshot.

## Offline file

**Saved → Save offline file** downloads `fridge-chef-offline.html` — a single file with your pantry, shopping, saved items, monthly menu and my-days plan plus the raw JSON. Keep it in Files. It opens without any account.

## Untested

Real-iPhone install, true offline loading, and on-phone visuals are **untested** — see TESTING.md. Please verify on your device.
