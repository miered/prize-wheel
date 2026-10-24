# Setup: hosting and Twitch

The app is plain HTML, CSS and JavaScript. You can open `index.html` directly to use the
wheel and Plinko offline. **Connecting Twitch needs the app hosted at a real web address**,
because Twitch only sends you back after sign-in to an address you've registered with it.

It takes about 15 minutes and costs nothing.

---

## Part 1: Put the app on GitHub Pages (free)

1. Sign in at <https://github.com>, or create a free account.
2. Click **+ → New repository**.
   - Name it something like `prize-wheel`.
   - Set it to **Public**. GitHub Pages is free for public repos.
   - Click **Create repository**.
3. On the new repo page, click **uploading an existing file**.
4. Drag these into the upload area from your `WheelSpinner` folder, keeping the folders:
   - `index.html`
   - the `css` folder
   - the `js` folder

   You don't need `.claude`, `RESEARCH.md` or `SETUP.md`, but they don't hurt.
5. Click **Commit changes**.
6. Go to **Settings → Pages**.
   - Under **Build and deployment**, set **Source** to **Deploy from a branch**.
   - Set **Branch** to **main** and **/(root)**, then click **Save**.
7. Wait a minute and refresh. GitHub shows your address, for example:

   ```
   https://YOUR-USERNAME.github.io/prize-wheel/
   ```

   Open it. The app should load.

**Updating later:** upload the changed files to the same repo the same way. Pages
republishes automatically within a minute or two.

---

## For streamers using the hosted app

Click **Connect Twitch** in the header, then **Authorize** on Twitch. That's all: the app's
built-in Twitch app is used, and your sign-in stays in your own browser.

Parts 2 and 3 below are only for whoever hosts their **own copy** of the app.

---

## Part 2: Register a Twitch app (gives you a Client ID)

Twitch requires **two-factor authentication** on your account before you can register apps.
Turn it on first at <https://www.twitch.tv/settings/security>.

1. Go to <https://dev.twitch.tv/console/apps> and sign in with your streaming account.
2. Click **Register Your Application** and fill in:
   - **Name:** anything unique, e.g. `YourName Prize Wheel`.
   - **OAuth Redirect URLs:** your GitHub Pages address **exactly**, including the
     trailing `/`, e.g. `https://YOUR-USERNAME.github.io/prize-wheel/`.
     - The app shows the exact address under **Settings → Twitch → OAuth Redirect URL**,
       with a **Copy** button.
     - Optional: also add `http://localhost:5500/` if you run the app locally.
   - **Category:** pick the closest fit, e.g. **Broadcaster Suite**.
   - **Client Type:** **Public**.
3. Click **Create**, then **Manage** next to the new app.
4. Copy the **Client ID**. You don't need the Client Secret; never paste it anywhere.

---

## Part 3: Connect the app

1. Put the Client ID in `js/app.js` as `TWITCH_CLIENT_ID` so every visitor can use it. Or,
   for just yourself, paste it under **Settings → Twitch → Advanced: use your own Twitch app**.
2. Open your GitHub Pages address.
3. Click **Connect Twitch** (top right), sign in, and approve. The app only asks to **send chat
   messages as you** (`user:write:chat`).
4. Back in the app you'll see **Connected as YourName**:
   - Your Twitch profile picture appears in the wheel center, on the Plinko chip and in the
     Plinko header. Change or turn off each spot under **Settings → Logos**.
   - Click **Send test message** to check chat announcements.
   - Edit the **Wheel message** and **Plinko message** templates if you like. The placeholders are:
     - `{prize}`: what was won
     - `{viewer}`: the "Called by" name in Plinko
     - `{slot}`: the Plinko slot number
     - `{channel}`: your channel name

**Privacy:** the sign-in token is saved only in that browser on that computer. Nothing goes
to any server except Twitch itself. **Disconnect** in Settings revokes it.

**If sign-in stops working:** Twitch tokens expire after a while. The app tells you, and
you click **Connect Twitch** again.

---

## Using it in OBS

- Turn on **Settings → Look → Green-screen background**.
- Add the page as a **Browser Source**, or capture the browser window.
- Apply a **Chroma Key** filter (green).
- **Present** mode (or press **F**) hides the side panel so only the game shows.

## Keyboard shortcuts

| Key | Wheel | Plinko |
|---|---|---|
| Space | Spin | Drop from the selected slot |
| 0–9 | none | Type a slot number; it drops automatically |
| Enter | Spin, when the wheel is focused | Drop |
| F | Present mode | Present mode |
| Esc | Close pop-up / exit present mode | same |

## Running locally (optional)

If you have Python installed, run this in the `WheelSpinner` folder:

```
py -m http.server 5500
```

Then open <http://localhost:5500/>.
