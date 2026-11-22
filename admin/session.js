// The panel's access to the server. The application opens this page with a
// one-time token in the fragment of its address. The page trades the token
// for a session, keeps the session for this tab and sends it with every
// request. No cookie is used: a cookie for 127.0.0.1 goes to every port of
// that address, the game page's among them.

const KEY = 'sled-panel-session';
const TOKEN = /^[a-f0-9]{64}$/;

/**
 * The one-time token of the address this page was opened with, or null. The
 * fragment leaves the address at once, whatever it held, so that a token is
 * not left in sight, in a bookmark or in a copy of the address.
 */
export function takeBootstrap(location, history) {
  if (!location.hash) return null;
  const token = /^#bootstrap=([a-f0-9]{64})$/.exec(location.hash)?.[1] ?? null;
  history.replaceState(null, '', location.pathname + location.search);
  return token;
}

/** What the tab kept, when it has the form of a session. A browser may give the page no storage at all. */
function kept(storage) {
  try {
    const value = storage?.getItem(KEY);
    return typeof value === 'string' && TOKEN.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** Lets go of a session that the server no longer knows. */
export function forgetSession(storage) {
  try { storage?.removeItem(KEY); } catch { /* Nothing was kept. */ }
}

/**
 * The session of this tab, or null when the page is not connected. With a
 * token, the token is traded; without one, as after a reload, the session is
 * the one that the tab kept.
 */
export async function openSession({ fetch, storage, bootstrap }) {
  if (!bootstrap) return kept(storage);
  // A new link is a new start: what the tab held before does not outlive a link that is refused.
  forgetSession(storage);
  let session;
  try {
    const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bootstrap }) });
    if (response.status !== 201) return null;
    session = (await response.json())?.session;
  } catch {
    return null;
  }
  if (typeof session !== 'string' || !TOKEN.test(session)) return null;
  // Without storage the session lasts until the page is reloaded.
  try { storage?.setItem(KEY, session); } catch { /* As above. */ }
  return session;
}

/** A request to the server as this tab's session. */
export function api(session, path, init = {}) {
  return fetch(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${session}` } });
}
