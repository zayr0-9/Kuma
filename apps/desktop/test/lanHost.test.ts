import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { resolveLanHost } from '../src/main/net/lanHost.ts';

// The pairing QR's host hint (spec 24.3): the first non-internal IPv4, loopback
// otherwise. Fed a fixed interface map so it is deterministic off any real machine.

function ipv4(address: string, internal: boolean): NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${address}/24`,
  };
}

function ipv6(address: string, internal: boolean): NetworkInterfaceInfo {
  return {
    address,
    netmask: 'ffff:ffff:ffff:ffff::',
    family: 'IPv6',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${address}/64`,
    scopeid: 0,
  };
}

describe('resolveLanHost', () => {
  it('returns the first non-internal IPv4 address, skipping loopback and IPv6', () => {
    const host = resolveLanHost({
      lo0: [ipv4('127.0.0.1', true), ipv6('::1', true)],
      en0: [ipv6('fe80::1', false), ipv4('192.168.1.42', false)],
    });
    expect(host).toBe('192.168.1.42');
  });

  it('falls back to loopback when there is no external IPv4', () => {
    expect(resolveLanHost({ lo0: [ipv4('127.0.0.1', true)] })).toBe('127.0.0.1');
    expect(resolveLanHost({})).toBe('127.0.0.1');
  });
});
