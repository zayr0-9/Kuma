import { mkdir, mkdtemp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parentsResolveInsideRoot,
  resolveDestinationPath,
} from '../src/main/storage/pathSafety.ts';

const BACKSLASH = String.fromCharCode(92);

describe('resolveDestinationPath', () => {
  it('resolves a plain path under the root (posix)', () => {
    const result = resolveDestinationPath('/dest', 'Camera/IMG_0001.jpg', 'linux');
    expect(result).toEqual({
      ok: true,
      absolutePath: ['', 'dest', 'Camera', 'IMG_0001.jpg'].join(sep),
    });
  });

  it('rejects wire-rule violations (traversal, absolute, NUL)', () => {
    for (const bad of ['../escape.jpg', '/abs.jpg', 'a/../b.jpg', 'a//b.jpg', '']) {
      const result = resolveDestinationPath('/dest', bad, 'linux');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('invalid_wire_path');
    }
  });

  it('rejects control characters on every platform', () => {
    const controlChar = String.fromCharCode(7);
    const result = resolveDestinationPath('/dest', 'a' + controlChar + 'b.jpg', 'linux');
    expect(result).toEqual({
      ok: false,
      error: { kind: 'invalid_platform_name', segment: 'a' + controlChar + 'b.jpg' },
    });
  });

  describe('win32 rules', () => {
    const cases: { path: string; kind: string }[] = [
      { path: 'CON/file.txt', kind: 'reserved_name' },
      { path: 'photos/com3.txt', kind: 'reserved_name' },
      { path: 'report./x.txt', kind: 'invalid_platform_name' },
      { path: 'name /x.txt', kind: 'invalid_platform_name' },
      { path: 'a:b.txt', kind: 'invalid_platform_name' },
      { path: 'foo<bar.txt', kind: 'invalid_platform_name' },
      { path: `a${BACKSLASH}b.txt`, kind: 'invalid_platform_name' },
    ];

    for (const { path, kind } of cases) {
      it(`rejects ${JSON.stringify(path)} as ${kind}`, () => {
        const result = resolveDestinationPath('/dest', path, 'win32');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.kind).toBe(kind);
      });
    }

    it('does not treat reserved-name lookalikes as reserved', () => {
      expect(resolveDestinationPath('/dest', 'console/file.txt', 'win32').ok).toBe(true);
      expect(resolveDestinationPath('/dest', 'com0.txt', 'win32').ok).toBe(true);
    });

    it('rejects paths beyond MAX_PATH', () => {
      const long = 'a'.repeat(300) + '.jpg';
      const result = resolveDestinationPath('/dest', long, 'win32');
      expect(result).toEqual({ ok: false, error: { kind: 'path_too_long' } });
    });
  });

  it('allows windows-invalid names on posix platforms', () => {
    expect(resolveDestinationPath('/dest', 'CON/file.txt', 'darwin').ok).toBe(true);
    expect(resolveDestinationPath('/dest', 'a:b.txt', 'linux').ok).toBe(true);
  });
});

describe('parentsResolveInsideRoot', () => {
  it('accepts existing directories inside the root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fsync-root-'));
    await mkdir(join(root, 'sub'));
    await expect(parentsResolveInsideRoot(root, join(root, 'sub', 'file.jpg'))).resolves.toBe(true);
  });

  it('accepts not-yet-created ancestors (falls back to the root itself)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fsync-root-'));
    await expect(parentsResolveInsideRoot(root, join(root, 'a', 'b', 'c.jpg'))).resolves.toBe(true);
  });

  it('rejects a symlinked ancestor escaping the root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fsync-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'fsync-outside-'));
    await symlink(outside, join(root, 'link'), 'dir');
    await expect(parentsResolveInsideRoot(root, join(root, 'link', 'file.jpg'))).resolves.toBe(
      false,
    );
  });
});
