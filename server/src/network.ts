// The one place where the existing network modules enter the server. They
// stay untyped JavaScript under research/network; these signatures describe
// the options their factories accept today.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { WebSocketServer } from 'ws';
import { emulatorAssetPaths as assetPaths } from '../../research/network/emulator-assets.mjs';
import { createPublicGateway as publicGateway } from '../../research/network/public-server.mjs';
import { createRetroArchRelay as retroArchRelay } from '../../research/network/retroarch-relay.mjs';

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
}

export type NetplayRelay = WebSocketServer & { stopDedicated(): void };

export const createPublicGateway = publicGateway as unknown as (options: GatewayOptions) => Gateway;
export const createRetroArchRelay = retroArchRelay as unknown as (options?: NetplayRelayOptions) => NetplayRelay;

/** The public paths of the web client and of the emulator files named in the lock. */
export const emulatorAssetPaths = assetPaths as unknown as
  (lock: { files: Record<string, string> }, discMode: 'local' | 'shared') => Set<string>;

export const listeningPort = (server: { address(): AddressInfo | string | null }): number =>
  (server.address() as AddressInfo).port;
