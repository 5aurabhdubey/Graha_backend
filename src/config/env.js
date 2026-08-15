const { z } = require('zod');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8080),

  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),

  PROKERALA_CLIENT_ID: z.string().min(1, 'PROKERALA_CLIENT_ID is required'),
  PROKERALA_CLIENT_SECRET: z.string().min(1, 'PROKERALA_CLIENT_SECRET is required'),
  PROKERALA_BASE_URL: z.string().url().default('https://api.prokerala.com'),

  ALLOWED_ORIGIN: z.string().default('*'),
  CHAT_RATE_LIMIT_PER_15MIN: z.coerce.number().default(20),

  // Optional — if unset, cache falls back to in-memory (fine for a single
  // instance, but breaks cache-sharing once you run more than one replica
  // behind the load balancer; see README).
  REDIS_URL: z.string().optional(),

  // Caps how many simultaneous OpenAI calls this instance makes at once —
  // protects against rate-limit errors when many users chat at the same time.
  MAX_CONCURRENT_AI_CALLS: z.coerce.number().default(10),
  MAX_CONCURRENT_PROKERALA_CALLS: z.coerce.number().default(15),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment configuration:');
    for (const issue of result.error.issues) {
      console.error(`   ${issue.path.join('.')}: ${issue.message}`);
    }
    console.error('\nCheck your .env against .env.example, then restart.');
    process.exit(1); // fail fast at boot, not on the first real request
  }

  return result.data;
}

module.exports = { loadEnv };
