import { describe, expect, it } from 'vitest';
import {
  destinationsOverlap,
  findDestinationOverlap,
} from '../src/main/storage/destinationOverlap.ts';

// Unit tests for spec-12.5 destination overlap. Uses posix absolute paths and an
// explicit platform argument so behaviour is deterministic regardless of the host.

describe('destinationsOverlap', () => {
  it('treats identical paths as overlapping', () => {
    expect(destinationsOverlap('/backups/a', '/backups/a', 'linux')).toBe(true);
  });

  it('detects an ancestor destination', () => {
    expect(destinationsOverlap('/backups', '/backups/camera', 'linux')).toBe(true);
  });

  it('detects a descendant destination', () => {
    expect(destinationsOverlap('/backups/camera', '/backups', 'linux')).toBe(true);
  });

  it('allows unrelated siblings', () => {
    expect(destinationsOverlap('/backups/a', '/backups/b', 'linux')).toBe(false);
  });

  it('is not fooled by a shared path prefix that is not a directory boundary', () => {
    // /backups/camera vs /backups/camera-roll are siblings, not nested.
    expect(destinationsOverlap('/backups/camera', '/backups/camera-roll', 'linux')).toBe(false);
  });

  it('normalises . and .. segments before comparing', () => {
    expect(destinationsOverlap('/backups/a', '/backups/b/../a', 'linux')).toBe(true);
  });

  it('is case-sensitive on linux but case-insensitive on darwin/win32', () => {
    expect(destinationsOverlap('/Backups', '/backups', 'linux')).toBe(false);
    expect(destinationsOverlap('/Backups', '/backups', 'darwin')).toBe(true);
    expect(destinationsOverlap('/Backups', '/backups', 'win32')).toBe(true);
  });
});

describe('findDestinationOverlap', () => {
  const existing = [
    { mappingId: 'm1', destinationRoot: '/backups/a' },
    { mappingId: 'm2', destinationRoot: '/backups/b' },
  ];

  it('returns the overlapping mapping id', () => {
    expect(findDestinationOverlap('/backups/a/nested', existing, undefined, 'linux')).toBe('m1');
  });

  it('returns null when nothing overlaps', () => {
    expect(findDestinationOverlap('/backups/c', existing, undefined, 'linux')).toBeNull();
  });

  it('excludes the candidate own mapping id', () => {
    // m1 would overlap itself, but it is excluded — no other overlap remains.
    expect(findDestinationOverlap('/backups/a', existing, 'm1', 'linux')).toBeNull();
  });
});
