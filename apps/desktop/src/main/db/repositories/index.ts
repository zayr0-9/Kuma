import type { Database } from '../database.ts';
import { createDevicesRepository, type DevicesRepository } from './devices.ts';
import { createIdentityRepository, type IdentityRepository } from './identity.ts';
import { createRootsRepository, type RootsRepository } from './roots.ts';

// One bundle of repositories bound to a single connection. Statements are prepared
// once at construction. Later slices (files/prepare, versions, deletions, events)
// add their repositories here as they are exercised end to end.
export interface Repositories {
  identity: IdentityRepository;
  devices: DevicesRepository;
  roots: RootsRepository;
}

export function createRepositories(db: Database): Repositories {
  return {
    identity: createIdentityRepository(db),
    devices: createDevicesRepository(db),
    roots: createRootsRepository(db),
  };
}

export type { IdentityRepository } from './identity.ts';
export type { DevicesRepository } from './devices.ts';
export type { RootsRepository } from './roots.ts';
