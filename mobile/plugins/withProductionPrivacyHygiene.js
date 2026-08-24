// Arclo — strip development-only privacy declarations from production builds.
//
// WHY (2026-08-24). App Review has now rejected this app once for declaring a
// framework it didn't visibly use (HealthKit, 2.5.1). Inspecting the *shipped
// IPA* for build 31 — not app.json, not `expo config` — found three more
// declarations that never appear anywhere in this repo:
//
//   NSCameraUsageDescription        ← expo-image-picker's autolinked defaults
//   NSMicrophoneUsageDescription    ← expo-image-picker's autolinked defaults
//   NSLocalNetworkUsageDescription  ← expo-dev-launcher
//   NSBonjourServices: _expo._tcp   ← expo-dev-launcher
//
// The first two are handled declaratively in app.json (`cameraPermission: false`,
// `microphonePermission: false`) — the app only ever calls
// `launchImageLibraryAsync`, never the camera.
//
// The local-network pair is what this plugin exists for. expo-dev-launcher adds
// its own Xcode build phase ("Strip Local Network Keys for Release") that is
// supposed to remove them from non-Debug builds — and it did not: build 31 is a
// Release build and shipped both keys anyway. Rather than debug Expo's build
// phase from a machine with no Xcode, this removes them at config time, where
// the result is verifiable.
//
// Deliberately scoped to production so local development still works: a dev
// client genuinely needs local networking to find a Metro server, and silently
// breaking `expo run:ios` to satisfy a reviewer would be a bad trade. EAS sets
// EAS_BUILD_PROFILE on every cloud build; anything else (a local dev build, a
// preview profile) is left untouched.

const { withInfoPlist } = require('expo/config-plugins')

const DEV_LAUNCHER_SERVICE = '_expo._tcp'

module.exports = function withProductionPrivacyHygiene(config) {
  return withInfoPlist(config, (cfg) => {
    if (process.env.EAS_BUILD_PROFILE !== 'production') return cfg

    const plist = cfg.modResults

    // Drop the dev-launcher's Bonjour service; keep any other service someone
    // legitimately added later, and only remove the usage description once no
    // services remain to justify it.
    if (Array.isArray(plist.NSBonjourServices)) {
      plist.NSBonjourServices = plist.NSBonjourServices.filter(
        (s) => String(s).toLowerCase().replace(/\.$/, '') !== DEV_LAUNCHER_SERVICE,
      )
      if (plist.NSBonjourServices.length === 0) delete plist.NSBonjourServices
    }
    if (!plist.NSBonjourServices) delete plist.NSLocalNetworkUsageDescription

    return cfg
  })
}
