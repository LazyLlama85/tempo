// Tempo — Metro config (first one this project has needed).
//
// Only exists for one reason: lottie-react-native's web fallback pulls in
// @lottiefiles/dotlottie-react, which loads a WASM player
// (@lottiefiles/dotlottie-web's dotlottie-player.wasm) — Metro's default
// resolver doesn't treat `.wasm` as a bundleable asset, so resolving it 404s
// even though the file is really there. This only matters for local `expo
// start` web preview; Tempo ships iOS/Android only, where Metro resolves
// LottieView's native (non-`.web.js`) entry point and never touches any of
// this.
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
config.resolver.assetExts.push('wasm')

module.exports = config
