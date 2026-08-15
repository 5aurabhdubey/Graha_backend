const OpenAI = require('openai');
const CircuitBreaker = require('opossum');
const { buildSystemPrompt } = require('../prompts/systemPrompt');
const { aiQueue } = require('../queue/apiQueues');
const logger = require('../utils/logger');

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 3, // the OpenAI SDK has its own built-in retry/backoff for transient errors
  timeout: 20000,
});
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// Circuit breaker on top of the SDK's own retries — protects against a
// sustained OpenAI outage/degradation, same reasoning as resilientClient.js.
const breaker = new CircuitBreaker(
  async (messages) => {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.8,
      max_tokens: 400,
    });
    return completion.choices[0].message.content;
  },
  {
    timeout: 25000,
    errorThresholdPercentage: 50,
    resetTimeout: 20000,
    name: 'openai-chat',
  }
);

breaker.on('open', () => logger.error('OpenAI circuit OPEN — using fallback replies until it recovers'));
breaker.on('close', () => logger.info('OpenAI circuit closed — back to normal'));

/** A calm, honest fallback if OpenAI is genuinely unreachable — never a raw error dumped on the user. */
function fallbackReply(name) {
  return `I'm having trouble reaching the stars right now, ${name} — give me a moment and try asking again shortly. In the meantime, your chart hasn't changed, so nothing about your reading is affected by this.`;
}

async function askGraha({ name, chart, dashaPeriods, transits, doshas, question, conversationHistory = [] }) {
  const systemPrompt = buildSystemPrompt({ name, chart, dashaPeriods, transits, doshas });
  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: question },
  ];

  try {
    // Queued so a burst of users doesn't fire more concurrent OpenAI calls
    // than MAX_CONCURRENT_AI_CALLS allows, then routed through the breaker.
    return await aiQueue.add(() => breaker.fire(messages));
  } catch (err) {
    logger.error({ err: err.message, name }, 'OpenAI call failed after retries/circuit check — returning fallback');
    return fallbackReply(name);
  }
}

module.exports = { askGraha };
