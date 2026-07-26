// Expo's Babel preset. babel-preset-expo (SDK 57) auto-configures the
// react-native-worklets plugin required by react-native-reanimated v4 when it is installed,
// so the gallery's pan/zoom worklets are transformed. Explicit config so the toolchain never
// falls back to a default that omits it.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
