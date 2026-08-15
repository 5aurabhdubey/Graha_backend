const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { z } = require('zod');
const ProkeralaClient = require('../services/prokeralaClient');
const { geocodePlace } = require('../services/geocodeService');

const router = express.Router();

const birthProfileSchema = z.object({
  name: z.string().min(1),
  date: z.string(),
  time: z.string(),
  place: z.string().min(1),
});

router.post('/', asyncHandler(async (req, res) => {
  const parsed = birthProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid birth profile', details: parsed.error.flatten() });
  }

  const { name, date, time, place } = parsed.data;

  try {
    const { latitude, longitude, displayName } = await geocodePlace(place);
    const isoDatetime = `${date}T${time}:00+05:30`;

    const profile = { isoDatetime, latitude, longitude };

    const [kundli, dashaPeriods, doshaDetails, transits] = await Promise.all([
      ProkeralaClient.getKundli(profile),
      ProkeralaClient.getDashaPeriods(profile),
      ProkeralaClient.getKundliDetails(profile),
      ProkeralaClient.getCurrentTransits(profile),
    ]);

    // Temporary debug logs
    console.log('=== RAW KUNDLI ===');
    console.log(JSON.stringify(kundli, null, 2));
    console.log('=== RAW DASHA ===');
    console.log(JSON.stringify(dashaPeriods, null, 2));

    res.json({
      name,
      resolvedPlace: displayName,
      chart: kundli,
      dashaPeriods,
      doshas: doshaDetails?.doshas ?? null,
      transits,
    });
  } catch (err) {
    console.error('kundali generation failed:', err.response?.data || err.message);
    res.status(502).json({ error: 'Could not generate kundali right now. Please try again shortly.' });
  }
}));

module.exports = router;