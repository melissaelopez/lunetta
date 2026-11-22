import { config, hasProviderApiKey, type AiProvider } from '../config.js';
import type { z } from 'zod';
import { generateClaudeStructured, isClaudeConfigured } from './claude.js';
import { generateOpenAIStructured, isOpenAIConfigured } from './openai-adapter.js';
import { generateGeminiStructured, isGeminiConfigured } from './gemini-adapter.js';
import type { StructuredRequest } from './ai-types.js';

export type { ImageInput } from './ai-types.js';

export function isAiConfigured(opts?: { provider?: AiProvider; geminiApiKey?: string }): boolean {
  const provider = opts?.provider ?? config.ai.provider;
  return hasProviderApiKey(provider, {
    anthropic: isClaudeConfigured() ? config.anthropic.apiKey : '',
    openai: isOpenAIConfigured() ? config.openai.apiKey : '',
    gemini: isGeminiConfigured(opts?.geminiApiKey) ? (opts?.geminiApiKey?.trim() || config.gemini.apiKey) : '',
  });
}

export function missingAiApiKey(provider: AiProvider = config.ai.provider): string {
  if (provider === 'openai') return 'OPENAI_API_KEY';
  if (provider === 'gemini') return 'GEMINI_API_KEY';
  return 'ANTHROPIC_API_KEY';
}

export function generateStructured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
  const provider = req.providerOverride ?? config.ai.provider;
  if (provider === 'gemini') return generateGeminiStructured(req);
  if (provider === 'openai') return generateOpenAIStructured(req);
  return generateClaudeStructured(req);
}
