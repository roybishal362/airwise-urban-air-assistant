import { Router, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Assistant } from '../services/assistant/assistantService.js';
import type { BriefService } from '../services/briefService.js';
import { approximatePlace } from './approxLocation.js';
import { briefRequestSchema, chatRequestSchema, placesQuerySchema } from './schemas.js';

export interface ApiDependencies {
  briefService: BriefService;
  assistant: Assistant;
  rateLimitPerMinute: number;
  chatRateLimitPerMinute: number;
}

const limiter = (limit: number) =>
  rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a minute.' },
    },
  });

/**
 * Household profiles contain health data, so they travel only in POST bodies
 * (never URLs, which end up in logs and browser history) and responses are
 * marked `no-store`.
 */
export function createApiRouter(deps: ApiDependencies): Router {
  const router = Router();
  router.use(limiter(deps.rateLimitPerMinute));

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', assistant: deps.assistant.mode });
  });

  // Fallback for "Use my location" when the device cannot locate itself.
  router.get('/locate', (req, res) => {
    const place = approximatePlace(req.headers);
    res.set('Cache-Control', 'private, no-store');
    if (!place) {
      res.status(404).json({
        error: {
          code: 'LOCATION_UNAVAILABLE',
          message: 'Your approximate area is not available. Search for your city instead.',
        },
      });
      return;
    }
    res.json({ place });
  });

  router.get('/places', async (req: Request, res) => {
    const { q } = placesQuerySchema.parse(req.query);
    const places = await deps.briefService.searchPlaces(q);
    res.set('Cache-Control', 'public, max-age=3600').json({ places });
  });

  router.post('/brief', async (req, res) => {
    const body = briefRequestSchema.parse(req.body);
    const brief = await deps.briefService.getBrief(body);
    res.set('Cache-Control', 'no-store').json({ brief });
  });

  // GenAI calls cost money: a tighter, separate budget per client.
  router.post('/chat', limiter(deps.chatRateLimitPerMinute), async (req, res) => {
    const body = chatRequestSchema.parse(req.body);
    const brief = await deps.briefService.getBrief(body);
    const answer = await deps.assistant.reply({
      message: body.message,
      history: body.history,
      brief,
      household: body.household,
    });
    res.set('Cache-Control', 'no-store').json(answer);
  });

  return router;
}
