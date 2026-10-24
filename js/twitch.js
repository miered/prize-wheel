/* Optional Twitch connection: sign in with the streamer's account (implicit OAuth, no server),
   read their profile picture, and post winner announcements to their chat.
   The access token is stored only in this browser. */
(() => {
  'use strict';
  const PW = window.PW;
  const U = PW.util;
  const SESSION_KEY = 'prizewheel.twitch';
  const STATE_KEY = 'prizewheel.oauthState';
  const SCOPES = 'user:write:chat';

  // opts: { clientId() -> string, changed() }
  PW.createTwitch = (opts) => {
    let session = U.safe(() => JSON.parse(localStorage.getItem(SESSION_KEY)), null); // { token, clientId, id, login, name, image }
    let avatar = null;

    const persist = () => U.safe(() => {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    });

    // The exact address to register as the OAuth Redirect URL at dev.twitch.tv
    const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');
    // Twitch only redirects back to https pages or localhost
    const canConnect = () => location.protocol === 'https:' ||
      (location.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(location.hostname));

    const headers = () => ({ Authorization: `Bearer ${session.token}`, 'Client-Id': session.clientId });

    async function loadAvatar() {
      avatar = null;
      if (!session?.image) return;
      try { avatar = await U.loadImage(session.image); } catch { avatar = null; }
      opts.changed();
    }

    function connect() {
      const clientId = opts.clientId().trim();
      if (!clientId) { U.toast('Paste your Twitch Client ID first (see SETUP.md)'); return; }
      if (!canConnect()) { U.toast('Twitch sign-in only works when the app is hosted online'); return; }
      const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
      U.safe(() => sessionStorage.setItem(STATE_KEY, JSON.stringify({ state, clientId })));
      const q = new URLSearchParams({
        response_type: 'token', client_id: clientId, redirect_uri: redirectUri(),
        scope: SCOPES, state, force_verify: 'true',
      });
      location.assign(`https://id.twitch.tv/oauth2/authorize?${q}`);
    }

    // Handles the redirect back from Twitch (#access_token=… or #error=…). Returns true if it did.
    async function handleRedirect() {
      const hash = location.hash.slice(1);
      if (!/(^|&)(access_token|error)=/.test(hash)) return false;
      const p = new URLSearchParams(hash);
      U.safe(() => history.replaceState(null, '', location.pathname + location.search));
      const pending = U.safe(() => JSON.parse(sessionStorage.getItem(STATE_KEY)), null);
      U.safe(() => sessionStorage.removeItem(STATE_KEY));
      if (p.get('error')) { U.toast(`Twitch sign-in cancelled: ${p.get('error_description') || p.get('error')}`); return true; }
      if (!pending || p.get('state') !== pending.state) { U.toast('Twitch sign-in failed a security check. Please try again.'); return true; }
      try {
        const token = p.get('access_token');
        const r = await fetch('https://api.twitch.tv/helix/users', { headers: { Authorization: `Bearer ${token}`, 'Client-Id': pending.clientId } });
        if (!r.ok) throw new Error(`Twitch returned ${r.status}`);
        const u = (await r.json()).data?.[0];
        if (!u) throw new Error('No user returned');
        session = { token, clientId: pending.clientId, id: u.id, login: u.login, name: u.display_name || u.login, image: u.profile_image_url };
        persist();
        U.toast(`Connected to Twitch as ${session.name}`);
        opts.changed();
        loadAvatar();
      } catch (err) {
        U.toast(`Couldn't finish Twitch sign-in (${err.message})`);
      }
      return true;
    }

    // Twitch asks apps to validate tokens on start-up; an expired one is dropped.
    async function validate() {
      if (!session) return;
      try {
        const r = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${session.token}` } });
        if (r.status === 401) {
          session = null; avatar = null; persist(); opts.changed();
          U.toast('Your Twitch sign-in expired. Reconnect in Settings.');
        }
      } catch { /* offline: keep the session and try again next load */ }
    }

    async function say(message) {
      if (!session) return false;
      try {
        const r = await fetch('https://api.twitch.tv/helix/chat/messages', {
          method: 'POST',
          headers: { ...headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ broadcaster_id: session.id, sender_id: session.id, message: message.slice(0, 500) }),
        });
        if (r.status === 401) { U.toast('Twitch sign-in expired. Reconnect in Settings.'); return false; }
        if (!r.ok) { U.toast(`Twitch chat message failed (${r.status})`); return false; }
        const sent = (await r.json()).data?.[0];
        if (sent && !sent.is_sent) { U.toast(`Twitch didn't post it: ${sent.drop_reason?.message || 'blocked'}`); return false; }
        return true;
      } catch {
        U.toast("Couldn't reach Twitch to post in chat");
        return false;
      }
    }

    async function disconnect() {
      if (session) {
        const body = new URLSearchParams({ client_id: session.clientId, token: session.token });
        fetch('https://id.twitch.tv/oauth2/revoke', { method: 'POST', body }).catch(() => {});
      }
      session = null; avatar = null;
      persist();
      opts.changed();
    }

    loadAvatar();

    return {
      connect, disconnect, handleRedirect, validate, say, redirectUri, canConnect,
      get session() { return session; },
      get avatar() { return avatar; },
    };
  };
})();
