const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { z } = require('zod');
const ProkeralaClient = require('../services/prokeralaClient');
const { geocodePlace } = require('../services/geocodeService');

const router = express.Router();

const personSchema = z.object({ date: z.string(), time: z.string(), place: z.string() });
const schema = z.object({ person1: personSchema, person2: personSchema });

async function resolve(person) {
  const { latitude, longitude } = await geocodePlace(person.place);
  return { isoDatetime: `${person.date}T${person.time}:00`, latitude, longitude };
}

/** POST /api/match — Vedic compatibility (guna milan) between two birth profiles */
router.post('/', asyncHandler(async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }

  try {
    const [profileA, profileB] = await Promise.all([
      resolve(parsed.data.person1),
      resolve(parsed.data.person2),
    ]);
    const result = await ProkeralaClient.getMatching(profileA, profileB);
    res.json({ result });
  } catch (err) {
    console.error('matching failed:', err.response?.data || err.message);
    res.status(502).json({ error: 'Could not calculate compatibility right now.' });
  }
}));

module.exports = router;
