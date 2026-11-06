export function parseInvitation(hash) {
  if (!hash) return null;
  try {
    const value = JSON.parse(atob(hash.slice(1)));
    if (value.v !== 6 || !/^[a-f0-9]{24}$/.test(value.room) || !/^[a-f0-9]{64}$/.test(value.token)
      || !['all', 'original'].includes(value.progress) || typeof value.camera !== 'boolean') throw new Error();
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
  url.hash = btoa(JSON.stringify({ v: 6, room: room.room, token: room.token, ...options }));
  return url.href;
}
