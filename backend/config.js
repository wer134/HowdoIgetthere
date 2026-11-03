import path from 'node:path';

const integer = (env, key, fallback, max = Number.MAX_SAFE_INTEGER) => {
  const value = Number(env[key] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new Error(`Invalid ${key}`);
  return value;
};
export function accountConfig(env = process.env) {
  const origin = env.ACCOUNT_ORIGIN || '';
  if (origin) {
    const url = new URL(origin);
    if (url.origin !== origin || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('ACCOUNT_ORIGIN must be an HTTPS origin (HTTP loopback allowed)');
  }
  const secret = env.ACCOUNT_SECRET || '';
  const configured = Boolean(origin && env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && secret);
  if (secret && Buffer.byteLength(secret) < 32) throw new Error('ACCOUNT_SECRET requires at least 32 bytes');
  const service = kind => ({
    dailyCalls: integer(env, `${kind}_DAILY_CALL_LIMIT`, 0), monthlyCalls: integer(env, `${kind}_MONTHLY_CALL_LIMIT`, 0),
    dailyCost: integer(env, `${kind}_DAILY_BUDGET_MICROUSD`, 0), monthlyCost: integer(env, `${kind}_MONTHLY_BUDGET_MICROUSD`, 0),
    cost: integer(env, `${kind}_MAX_COST_MICROUSD`, 0),
  });
  return {
    available: configured, origin, secret, secure: origin.startsWith('https:'),
    clientId: env.GOOGLE_OAUTH_CLIENT_ID || '', clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    dbPath: path.resolve(env.ACCOUNT_DB_PATH || 'data/accounts.sqlite'),
    trustedProxies: (env.TRUSTED_PROXY_ADDRESSES || '').split(',').map(s => s.trim()).filter(Boolean),
    maxAccounts: integer(env, 'ACCOUNT_MAX_USERS', 10000), maxTotalBytes: integer(env, 'ACCOUNT_MAX_TOTAL_BYTES', 1073741824),
    maxSuggestions: integer(env, 'ACCOUNT_MAX_SUGGESTIONS', 100000), maxTravels: 20, maxUserBytes: 20 * 1024 * 1024, maxTravelBytes: 2 * 1024 * 1024,
    sms: service('SMS'), ai: service('AI'), countries: (env.SMS_ALLOWED_COUNTRIES || 'KR').split(',').map(s => s.trim()),
    twilioAccount: env.TWILIO_ACCOUNT_SID || '', twilioToken: env.TWILIO_AUTH_TOKEN || '', twilioService: env.TWILIO_VERIFY_SERVICE_SID || '',
    freeAI: env.FREE_AI_ENABLED === 'true', aiKey: env.SERVICE_GEMINI_API_KEY || '', aiModel: env.SERVICE_GEMINI_MODEL || 'gemini-2.5-flash',
    aiInputChars: integer(env, 'AI_MAX_INPUT_CHARS', 12000, 30000), aiOutputTokens: integer(env, 'AI_MAX_OUTPUT_TOKENS', 2048, 8192),
  };
}
