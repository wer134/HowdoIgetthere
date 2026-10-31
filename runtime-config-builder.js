// Explicit loopback-only development opt-in. Production never exposes private environment keys.
export function buildRuntimeConfig(env, { localKeys = false } = {}) {
  const config = {};
  if (env.PUBLIC_GOOGLE_MAPS_KEY) config.googleMapsApiKey = env.PUBLIC_GOOGLE_MAPS_KEY;
  if (localKeys && env.NODE_ENV !== 'production') {
    const googleKey = env.googleAPI || env.googlemap;
    if (googleKey) config.googleMapsApiKey = googleKey;
    if (env.geminiapi) config.geminiApiKey = env.geminiapi;
  }
  return 'window.APP_CONFIG = window.APP_CONFIG || {};\n' + Object.entries(config).map(([key,value]) => `window.APP_CONFIG[${JSON.stringify(key)}] = ${JSON.stringify(value)};`).join('\n');
}
