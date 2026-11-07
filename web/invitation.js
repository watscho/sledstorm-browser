export function parseInvitation(hash) {
  if (!hash) return null;
  try {
    const value = JSON.parse(atob(hash.slice(1)));
    if (![6, 7].includes(value.v) || !/^[a-f0-9]{24}$/.test(value.room) || !/^[a-f0-9]{64}$/.test(value.token)
      || !['all', 'original'].includes(value.progress) || typeof value.camera !== 'boolean'
      || (value.nativeCamera !== undefined && (value.v !== 7 || value.nativeCamera !== true || !value.camera))
      || value.recovery !== undefined) throw new Error();
    return value;
  } catch { throw new Error('Invalid or outdated invitation. Ask the host for a new complete link.'); }
}

export function invitationUrl(href, accessPath, room, options, publicOrigin) {
  const url = new URL(href);
  if (publicOrigin) {
    const published = new URL(publicOrigin);
    if (published.protocol !== 'https:' || published.origin !== publicOrigin) throw new Error('Invalid public invitation origin');
    url.protocol = published.protocol; url.hostname = published.hostname; url.port = published.port;
  }
  url.pathname = accessPath;
  url.search = '';
  url.hash = btoa(JSON.stringify({ v: room.v === 7 ? 7 : 6, room: room.room, token: room.token, ...options }));
  return url.href;
}

export function onlineInvitationUrl(href, accessPath, room, options, publicOrigin) {
  const current = new URL(href);
  if (!publicOrigin && current.protocol !== 'https:') {
    throw new Error('Cloudflare Tunnel is not active. Start the online launcher with python3 tools/play-online.py.');
  }
  const url = invitationUrl(href, accessPath || '/', room, options, publicOrigin);
  if (['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
    throw new Error('An online invitation needs a public HTTPS address.');
  }
  return url;
}
