import { invitationVersion as currentInvitation } from './room-identity.js';

/** The packaged client offers solo play, a room invitation, and its private room worker. */
export function launchMode({ packaged, local, pathname, invitationVersion, worker }) {
  if (!packaged) return 'source';
  if (worker && local) return 'worker';
  if (invitationVersion === currentInvitation && pathname !== '/solo') return 'room';
  if (invitationVersion === undefined && local && (pathname === '/' || pathname === '/solo')) return 'solo';
  return 'invalid';
}

export function roomViewFlags({ camera, nativeCamera }, { mode, raceView, worker = mode === 'worker' }) {
  if (!camera) return 0;
  const shared = 2 | (nativeCamera ? 16 : 0);
  if (worker) return shared;
  if (nativeCamera && mode === 'room' && raceView === 'split') return shared | 64;
  return shared | 1 | (nativeCamera ? 4 : 0);
}
