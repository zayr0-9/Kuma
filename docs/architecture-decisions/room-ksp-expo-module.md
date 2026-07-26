# Room + KSP in the Expo local module

**Date:** 2026-07-26
**Status:** Adopted (compile-verified on EAS build `2091ec4b`)
**Spec reference:** section 16 (mobile database), 11.5 (Room as source of truth)

## Decision

Persist the phone's sync state with **Room 2.7.1**, whose annotation processor runs under
**KSP 2.1.20-2.0.1** (KSP2). The KSP Gradle plugin is applied inside the local module's own
`android/build.gradle` via a nested `buildscript` classpath; Room DAOs are **blocking** (no
coroutines/Flow).

## Why this was a risk worth isolating

The spec mandates Room. Room needs a compile-time annotation processor, and in a **managed
Expo workflow there is no committed `android/` project** to edit — the module's own
`build.gradle` is the only place the app owns. Getting an annotation processor onto that
build, with versions matched to the toolchain Expo pins, is the kind of thing that fails only
at cloud-build time (no Android toolchain locally, spec 32.1). So it landed on its own branch
and was compile-checked on EAS **before** any engine code was layered on top.

## What actually works

- **Expo resolves the KSP _version_ but does not apply the plugin.**
  `expo-modules-autolinking` sets `rootProject.ext.kspVersion` from its `KSPLookup` table
  (Kotlin `2.1.20` → `2.1.20-2.0.1`), and `ExpoModulesCorePlugin.gradle` exposes
  `applyKspJvmToolchain()`. But nothing applies `com.google.devtools.ksp`. The module must.
- **Apply it with a nested buildscript classpath**, not the `plugins {}` DSL (which fights the
  root project's plugin management) and not a hardcoded version:

  ```gradle
  buildscript {
    repositories { google(); mavenCentral() }
    dependencies {
      def kspVer = rootProject.ext.has('kspVersion') ? rootProject.ext.kspVersion : '2.1.20-2.0.1'
      classpath "com.google.devtools.ksp:symbol-processing-gradle-plugin:${kspVer}"
    }
  }
  // …after apply plugin: 'kotlin-android' and applyKotlinExpoModulesCorePlugin():
  apply plugin: 'com.google.devtools.ksp'
  applyKspJvmToolchain()
  ```

  Using `rootProject.ext.kspVersion` means the version tracks whatever Kotlin Expo pins; the
  literal is only the known-good fallback for the current pin.

- **Room must be 2.7+.** The `-2.0.x` KSP suffix is **KSP2**. Room 2.6.x is KSP1-only and fails
  under a KSP2 plugin; Room 2.7.0 is the first line with native KSP2 support. Hence 2.7.1.
- **Blocking DAOs.** Every DB caller is already on a worker thread (the service loop, the upload
  worker, or an Expo `AsyncFunction`'s background dispatcher), so a suspend/Flow surface would
  add a dependency for nothing. Room's own main-thread ban is the guard that keeps it true — so
  the notification builder (which also runs on the main thread) reads the in-memory transfer
  snapshot, never Room.

## Consequences / deferred

- `exportSchema = false` with destructive fallback: every table is a cache of scannable or
  desktop-durable state, so an early schema bump can drop-and-rebuild rather than carry a
  migration. Migrations + schema tests arrive when the tables stabilise (spec 16 lists migration
  testing as a native-scope concern).
- `deletion_event` and `paired_device` from spec 16.1 are not yet Room entities — deletion
  propagation is spec 19 (deferred), and pairing already persists durably via `TokenVault` +
  `PairingManager`, so duplicating it into Room now would churn proven code.
- If Expo bumps Kotlin, re-check the KSP fallback literal and the Room line against the new
  `KSPLookup` entry.
