const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { z } = require('zod');
const ProkeralaClient = require('../services/prokeralaClient');
const { geocodePlace } = require('../services/geocodeService');

const router = express.Router();

const schema = z.object({ place: z.string().min(1) });

/** GET-style POST /api/panchang — today's tithi, nakshatra, auspicious windows for a location */
router.post('/', asyncHandler(async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'place is required' });

  try {
    const { latitude, longitude } = await geocodePlace(parsed.data.place);
    const panchang = await ProkeralaClient.getPanchang({
      isoDatetime: new Date().toISOString(),
      latitude,
      longitude,
    });
    res.json({ panchang });
  } catch (err) {
    console.error('panchang failed:', err.response?.data || err.message);
    res.status(502).json({ error: 'Could not fetch today\'s panchang.' });
  }
}));

module.exports = router;
