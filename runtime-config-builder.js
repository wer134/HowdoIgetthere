// Only the loopback development server reads environment values. Never bake them into config.js.
export function buildRuntimeConfig(env) {
  const config = {};
  const googleKey = env.googleAPI || env.googlemap;
  if (googleKey) config.googleMapsApiKey = googleKey;
  if (env.geminiapi) config.geminiApiKey = env.geminiapi;
  return Object.entries(config).map(([key,value]) => `window.APP_CONFIG[${JSON.stringify(key)}] = ${JSON.stringify(value)};`).join('\n');
}
