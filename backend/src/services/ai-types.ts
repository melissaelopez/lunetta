import type { z } from 'zod';
import type { AiProvider, Effort } from '../config.js';

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface ImageInput {
  mimeType: string;
  data: string;
  label?: string;
}

export interface StructuredRequest<S extends z.ZodType> {
  label: string;
  schema: S;
  system: string;
  prompt: string;
  images?: ImageInput[];
  maxTokens?: number;
  effort?: Effort;
  /** Optional per-request provider override (e.g. 'gemini' for AI Insights). */
  providerOverride?: AiProvider;
  /** Optional per-request API key (e.g. from X-Gemini-Api-Key header). Never log, store, or cache. */
  apiKeyOverride?: string;
}
