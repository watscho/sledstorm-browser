// The one place where the existing network modules enter the server. They
// stay untyped JavaScript under research/network; these signatures describe
// the options their factories accept today.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { WebSocketServer } from 'ws';
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
  startDedicated?: (setup: DedicatedSetup, signal: AbortSignal) => Promise<{ exited: Promise<void> }>;
}

export type NetplayRelay = WebSocketServer & { stopDedicated(): void };

export const createPublicGateway = publicGateway as unknown as (options: GatewayOptions) => Gateway;
export const createRetroArchRelay = retroArchRelay as unknown as (options?: NetplayRelayOptions) => NetplayRelay;

export const listeningPort = (server: { address(): AddressInfo | string | null }): number =>
  (server.address() as AddressInfo).port;
