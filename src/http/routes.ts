import { Router, type RequestHandler } from 'express';
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

/** Per-IP rate limiter allowing `limit` requests a minute. */
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

/** City-level fallback for "Use my location" when the device cannot locate itself. */
const locate: RequestHandler = (req, res) => {
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
};

/** City search; results are public and cached for an hour. */
const places =
  (deps: ApiDependencies): RequestHandler =>
  async (req, res) => {
    const { q } = placesQuerySchema.parse(req.query);
    const found = await deps.briefService.searchPlaces(q);
    res.set('Cache-Control', 'public, max-age=3600').json({ places: found });
  };

/** The family's air brief; it is computed from health data, so it is never cached. */
const brief =
  (deps: ApiDependencies): RequestHandler =>
  async (req, res) => {
    const request = briefRequestSchema.parse(req.body);
    const result = await deps.briefService.getBrief(request);
    res.set('Cache-Control', 'no-store').json({ brief: result });
  };

/** A question to the assistant, answered from the household's brief. */
const chat =
  (deps: ApiDependencies): RequestHandler =>
  async (req, res) => {
    const request = chatRequestSchema.parse(req.body);
    const result = await deps.briefService.getBrief(request);
    const answer = await deps.assistant.reply({
      message: request.message,
      history: request.history,
      brief: result,
      household: request.household,
    });
    res.set('Cache-Control', 'no-store').json(answer);
  };

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
  router.get('/locate', locate);
  router.get('/places', places(deps));
  router.post('/brief', brief(deps));
  // GenAI calls cost money: a tighter, separate budget per client.
  router.post('/chat', limiter(deps.chatRateLimitPerMinute), chat(deps));
  return router;
}
