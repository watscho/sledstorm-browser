// The one place where the existing network modules enter the server. They
// stay untyped JavaScript under research/network; these signatures describe
// the options their factories accept today.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { WebSocketServer } from 'ws';
import { launchDedicatedRuntime as dedicatedRuntime } from '../../research/network/dedicated-runtime.mjs';
import { emulatorAssetPaths as assetPaths } from '../../research/network/emulator-assets.mjs';
import { createPublicGateway as publicGateway } from '../../research/network/public-server.mjs';
import { createRetroArchRelay as retroArchRelay } from '../../research/network/retroarch-relay.mjs';
import { invitationUrl as webInvitationUrl } from '../../web/invitation.js';
import { identityKey as saveIdentityKey } from '../../web/save-file.js';
import { invitationVersion as webInvitationVersion, roomIdentity as identityOfRoom } from '../../web/room-identity.js';

export interface GatewayOptions {
  port: number;
  /** Loopback port of the runtime HTTP server that owns the game origin. */
  upstream: number;
  relay?: number;
  netplay?: number | null;
  accessToken?: string | null;
  discMode?: 'local' | 'shared';
  assetPaths?: Set<string>;
  maxPayload?: number;
  mirrorPort?: number;
  getMirrorOrigin?: () => string | undefined;
}

export type Gateway = Server & { mirrorServer?: Server };

export interface DedicatedSetup {
  room: string;
  workerKey: string;
  progress: string;
  camera: boolean;
  nativeCamera: boolean;
  snapshot?: string;
}

export interface NetplayRelayOptions {
  port?: number;
  /** Page origins allowed to connect. Defaults to the game origin on port 8000. */
  origins?: string[];
  startDedicated?: (setup: DedicatedSetup, signal: AbortSignal) => Promise<{ exited: Promise<void> }>;
  /** The relay belongs to a server that opens its one room itself: no player can start or stop an emulator. */
  ownsRooms?: boolean;
  /** How long a new emulator may take to listen. */
  startupMs?: number;
  /**
   * How long a server's room that stands empty keeps the controllers of players who left a race, and how
   * long a room that loaded a save waits for the player of that load.
   */
  reservedMs?: number;
  /** How long a save that a player loads into a server's room may take to arrive. */
  transferMs?: number;
}

/** A room as the server asks for it: its name, the token of its invitation, and what its players must share. */
export interface RoomSpec {
  room: string;
  token: string;
  identity: string;
  progress: 'all' | 'original';
  camera: boolean;
  nativeCamera?: boolean;
  /**
   * The identity key of the saves that fit the room's game, 1 to 256 characters. With it, the only
   * player of the room may load a save into it; without it the room loads none.
   */
  saves?: string;
  /** Hears when a save starts to load into the room, and when that load is over, whichever way it went. */
  onRestoring?: (active: boolean) => void;
}

export interface RoomStatus {
  listening: boolean;
  players: number;
  seats: { slot: number; status: string }[];
  racing: boolean;
  expiresAt: number | null;
  /** A save is loading: from the moment a good one has arrived until its player is back, or is given up. */
  restoring: boolean;
}

export type NetplayRelay = WebSocketServer & {
  stopDedicated(): void;
  /** Opens a dedicated room without a player. Throws when the room cannot even be asked for. */
  createRoom(spec: RoomSpec): { ready: Promise<void>; ended: Promise<string>; stop(reason: string): void; status(): RoomStatus | null };
  roomStatus(room: string): RoomStatus | null;
  /** Lets go of the name of a room that gets no further session. */
  releaseRoom(room: string): void;
};

export interface RuntimeOptions {
  /** The game page the worker opens. */
  url?: string;
  /** Browser switches added to the runtime's own. */
  args?: string[];
  /** Where the temporary profile is made. */
  profileRoot?: string;
  /** How long a browser may take to end before it is killed. */
  graceMs?: number;
  /** Environment variables added to the inherited ones. */
  env?: Record<string, string>;
}

/** Starts one browser as a room's emulator. `exited` resolves once it is gone and its profile removed. */
export const launchDedicatedRuntime = dedicatedRuntime as unknown as
  (browser: string, setup: DedicatedSetup, signal: AbortSignal, options?: RuntimeOptions) => Promise<{ exited: Promise<void> }>;

export const createPublicGateway = publicGateway as unknown as (options: GatewayOptions) => Gateway;
export const createRetroArchRelay = retroArchRelay as unknown as (options?: NetplayRelayOptions) => NetplayRelay;

/** The public paths of the web client and of the emulator files named in the lock. */
export const emulatorAssetPaths = assetPaths as unknown as
  (lock: { files: Record<string, string> }, discMode: 'local' | 'shared') => Set<string>;

export const listeningPort = (server: { address(): AddressInfo | string | null }): number =>
  (server.address() as AddressInfo).port;

/** What a room's players agree on before the game starts. */
export interface RoomOptions {
  progress: 'all' | 'original';
  camera: boolean;
  nativeCamera?: boolean;
}

export interface RoomIdentityInput {
  disc: string;
  core: string;
  adapter: string;
  native: Record<string, string>;
  /** `HLE` for the built-in BIOS, else the SHA-256 of the BIOS file. */
  bios: string;
  options: RoomOptions;
}

/** The identity of a room, by the module that the players' pages use too. Other fields of the input do not count. */
export const roomIdentity = identityOfRoom as unknown as (input: RoomIdentityInput) => Promise<string>;

/**
 * The key that a player's save library keeps the saves of one game under. `bios` is `hle` for the
 * built-in BIOS, else the SHA-256 of the BIOS file. Throws when a part is not what a library would hold.
 */
export const identityKey = saveIdentityKey as unknown as
  (identity: { disc: string; core: string; adapter: string; bios: string }) => string;

/** The version that an invitation to a Netplay room carries. */
export const invitationVersion = webInvitationVersion as unknown as number;

/** The link to a room, in the form that the players' pages read. `publicOrigin` replaces the origin of `href`. */
export const invitationUrl = webInvitationUrl as unknown as
  (href: string, accessPath: string, room: { v: number; room: string; token: string }, options: RoomOptions, publicOrigin?: string) => string;
