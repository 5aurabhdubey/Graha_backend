const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { z } = require('zod');
const { askGraha } = require('../services/openaiClient');

const router = express.Router();

const chatSchema = z.object({
  question: z.string().min(1).max(500),
  name: z.string().min(1),
  chart: z.any(),
  dashaPeriods: z.any().optional(),
  transits: z.any().optional(),
  doshas: z.any().optional(),
  // Prior turns from this conversation, in {role, content} pairs — lets
  // Graha handle natural follow-ups like the app's chat mockup.
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).optional(),
});

/**
 * POST /api/chat
 * Body: { question, name, chart, dashaPeriods, transits, doshas, history }
 *
 * The client is expected to store the chart bundle returned by /api/kundali
 * (once, at onboarding) and pass the relevant pieces back on each chat call —
 * this keeps the backend stateless and avoids a database for v1.
 */
router.post('/', asyncHandler(async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid chat request', details: parsed.error.flatten() });
  }

  const { question, name, chart, dashaPeriods, transits, doshas, history } = parsed.data;

  try {
    const reply = await askGraha({
      name,
      chart,
      dashaPeriods,
      transits,
      doshas,
      question,
      conversationHistory: history || [],
    });

    res.json({ reply });
  } catch (err) {
    console.error('chat failed:', err.response?.data || err.message);
    res.status(502).json({ error: 'Graha is having trouble responding right now. Please try again.' });
  }
}));

module.exports = router;
