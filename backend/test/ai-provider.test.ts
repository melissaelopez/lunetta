import test from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAIFetchError, type GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { hasProviderApiKey, resolveAiSettings } from '../src/config.js';
import { generateClaudeStructured } from '../src/services/claude.js';
import { generateOpenAIStructured } from '../src/services/openai-adapter.js';
import { generateGeminiChat, generateGeminiStructured, resolveGeminiChatModel, sanitizeGeminiError, zodToGeminiSchema } from '../src/services/gemini-adapter.js';
import { buildPrompt } from '../src/services/ai-insights.js';
import { aiApiErrorResponse } from '../src/services/ai-api-error.js';
import { handleRouteError } from '../src/middleware/errorHandler.js';

const ResultSchema = z.object({ result: z.string() });
const jpegData = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]).toString('base64');
const pngData = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]).toString('base64');
const request = {
  label: 'test',
  schema: ResultSchema,
  system: 'Return the result.',
  prompt: 'Say hello.',
};

function openAIResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'response_test',
    object: 'response',
    created_at: 1,
    model: 'gpt-6-luna',
    status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"result":"hello"}', annotations: [], logprobs: [], parsed: { result: 'hello' } }], id: 'message_test', status: 'completed' }],
    output_parsed: { result: 'hello' },
    output_text: '{"result":"hello"}',
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 1 } },
    incomplete_details: null,
    error: null,
    ...overrides,
  };
}

function mockOpenAI(response: unknown, onParse: (body: any) => void = () => {}): OpenAI {
  return {
    responses: {
      parse: async (body: any) => {
        onParse(body);
        return response;
      },
    },
  } as unknown as OpenAI;
}

test('provider defaults preserve Claude and choose Luna for OpenAI', () => {
  assert.deepEqual(resolveAiSettings(), { provider: 'anthropic', model: 'claude-opus-5', effort: 'medium' });
  assert.deepEqual(resolveAiSettings('openai'), { provider: 'openai', model: 'gpt-6-luna', effort: 'medium' });
  assert.deepEqual(resolveAiSettings('openai', 'gpt-6-sol', 'high'), { provider: 'openai', model: 'gpt-6-sol', effort: 'high' });
  assert.deepEqual(resolveAiSettings('openai', 'gpt-6-luna', 'none'), { provider: 'openai', model: 'gpt-6-luna', effort: 'none' });
  assert.throws(() => resolveAiSettings('openai', 'claude-sonnet-5'), /Claude model/);
  assert.throws(() => resolveAiSettings('anthropic', 'gpt-6-sol'), /OpenAI model/);
});

test('provider key availability uses only the selected provider key', () => {
  assert.equal(hasProviderApiKey('anthropic', { anthropic: 'ant-key' }), true);
  assert.equal(hasProviderApiKey('anthropic', { openai: 'oa-key' }), false);
  assert.equal(hasProviderApiKey('openai', { openai: 'oa-key' }), true);
  assert.equal(hasProviderApiKey('openai', { anthropic: 'ant-key' }), false);
});

test('OpenAI adapter sends text-only structured output with storage disabled', async () => {
  let body: any;
  const result = await generateOpenAIStructured(request, mockOpenAI(openAIResponse(), value => { body = value; }));
  assert.deepEqual(result, { result: 'hello' });
  assert.equal(body.store, false);
  assert.equal(body.input[0].role, 'system');
  assert.equal(body.input[1].content[0].text, request.prompt);
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.max_output_tokens, 25_000);
});

test('OpenAI adapter preserves image labels and image order in multimodal input', async () => {
  let body: any;
  await generateOpenAIStructured({
    ...request,
    images: [
      { mimeType: 'application/octet-stream', data: jpegData, label: 'Frame 1' },
      { mimeType: 'image/jpeg', data: pngData, label: 'Frame 2' },
    ],
  }, mockOpenAI(openAIResponse(), value => { body = value; }));
  const content = body.input[1].content;
  assert.deepEqual(content.map((item: any) => item.type), ['input_text', 'input_image', 'input_text', 'input_image', 'input_text']);
  assert.equal(content[0].text, 'Frame 1');
  assert.equal(content[1].image_url, `data:image/jpeg;base64,${jpegData}`);
  assert.equal(content[2].text, 'Frame 2');
  assert.equal(content[3].image_url, `data:image/png;base64,${pngData}`);
  assert.equal(content[4].text, request.prompt);
});

test('OpenAI adapter rejects unsupported image bytes before sending a request', async () => {
  let sent = false;
  await assert.rejects(
    generateOpenAIStructured({ ...request, images: [{ mimeType: 'image/jpeg', data: 'bm90IGFuIGltYWdl' }] }, mockOpenAI(openAIResponse(), () => { sent = true; })),
    /Unsupported image format/,
  );
  assert.equal(sent, false);
});

test('OpenAI adapter rejects refusals, incomplete responses, and absent parsed output', async () => {
  await assert.rejects(
    generateOpenAIStructured(request, mockOpenAI(openAIResponse({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'declined' }] }] }))),
    /declined this request/,
  );
  await assert.rejects(
    generateOpenAIStructured(request, mockOpenAI(openAIResponse({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }))),
    /incomplete \(max_output_tokens\)/,
  );
  await assert.rejects(generateOpenAIStructured(request, mockOpenAI(openAIResponse({ output_parsed: null }))), /no parseable structured output/);
});

test('Claude adapter retains the current structured request behavior', async () => {
  let body: any;
  const client = {
    beta: {
      messages: {
        parse: async (value: any) => {
          body = value;
          return {
            model: 'claude-opus-5',
            stop_reason: 'end_turn',
            parsed_output: { result: 'hello' },
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        },
      },
    },
  } as unknown as Anthropic;
  const result = await generateClaudeStructured({ ...request, images: [{ mimeType: 'image/jpeg', data: 'aGVsbG8=', label: 'Camera frame' }] }, client);
  assert.deepEqual(result, { result: 'hello' });
  assert.equal(body.messages[0].content[0].text, 'Camera frame');
  assert.equal(body.messages[0].content[1].type, 'image');
  assert.equal(body.fallbacks, 'default');
  assert.deepEqual(body.betas, ['server-side-fallback-2026-07-01']);
});

test('OpenAI authentication and rate limit errors map to AI responses', () => {
  const unauthorized = aiApiErrorResponse(401, 'Unauthorized', 'OPENAI_API_KEY');
  assert.equal(unauthorized.status, 502);
  assert.equal(unauthorized.body.error, 'ai_error');
  assert.match(unauthorized.body.message, /Check OPENAI_API_KEY/);

  const rateLimited = aiApiErrorResponse(429, 'Rate limited', 'OPENAI_API_KEY');
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.body.error, 'ai_error');
  assert.match(rateLimited.body.message, /rate-limited/);
});

test('provider API errors do not look like expired Nanit sessions', () => {
  const captureResponse = () => {
    let status = 0;
    let body: unknown;
    const res = {
      status(code: number) { status = code; return this; },
      json(value: unknown) { body = value; return this; },
    } as any;
    return { res, get status() { return status; }, get body() { return body; } };
  };

  const auth = captureResponse();
  handleRouteError(auth.res, new OpenAI.APIError(401, { message: 'Unauthorized' }, 'Unauthorized', new Headers()));
  assert.equal(auth.status, 502);
  assert.equal((auth.body as any).error, 'ai_error');
  assert.match((auth.body as any).message, /OPENAI_API_KEY/);

  const rateLimit = captureResponse();
  handleRouteError(rateLimit.res, new OpenAI.APIError(429, { message: 'Rate limited' }, 'Rate limited', new Headers()));
  assert.equal(rateLimit.status, 429);
  assert.equal((rateLimit.body as any).error, 'ai_error');
});

test('Gemini provider settings and key availability work alongside Claude and OpenAI', () => {
  assert.equal(resolveAiSettings('gemini').provider, 'gemini');
  assert.equal(resolveAiSettings('gemini', 'gemini-2.5-flash', 'low').model, 'gemini-2.5-flash');
  assert.throws(() => resolveAiSettings('gemini', 'claude-opus-5'), /Claude model/);
  assert.throws(() => resolveAiSettings('gemini', 'gpt-6-luna'), /OpenAI model/);
  assert.throws(() => resolveAiSettings('anthropic', 'gemini-2.5-flash'), /Gemini model/);

  assert.equal(hasProviderApiKey('gemini', { gemini: 'gem-key' }), true);
  assert.equal(hasProviderApiKey('gemini', { anthropic: 'ant-key', openai: 'oa-key' }), false);
});

test('zodToGeminiSchema strips unsupported JSON Schema keywords and preserves structure', () => {
  const ComplexSchema = z.object({
    summary: z.string().describe('Short summary'),
    score: z.number().int().min(1).max(5),
    mood: z.enum(['calm', 'fussy']),
    notes: z.array(z.string()),
    optionalDetail: z.string().nullable(),
  });
  const schema = zodToGeminiSchema(ComplexSchema) as any;
  assert.equal(schema.type, 'object');
  assert.equal(schema.$schema, undefined);
  assert.equal(schema.additionalProperties, undefined);
  assert.equal(schema.properties.score.type, 'integer');
  assert.equal(schema.properties.score.minimum, undefined);
  assert.equal(schema.properties.score.maximum, undefined);
  assert.equal(schema.properties.mood.format, 'enum');
  assert.deepEqual(schema.properties.mood.enum, ['calm', 'fussy']);
  assert.equal(schema.properties.notes.type, 'array');
  assert.equal(schema.properties.optionalDetail.nullable, true);
});

test('Gemini adapter handles text-only and multimodal requests with image labels in order', async () => {
  let capturedModelParams: any;
  let capturedParts: any;
  const mockClient = {
    getGenerativeModel(modelParams: any) {
      capturedModelParams = modelParams;
      return {
        async generateContent(parts: any) {
          capturedParts = parts;
          return {
            response: {
              candidates: [{ finishReason: 'STOP' }],
              usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6 },
              text: () => '{"result":"hello from gemini"}',
            },
          };
        },
      };
    },
  } as unknown as GoogleGenerativeAI;

  const result = await generateGeminiStructured(
    {
      ...request,
      apiKeyOverride: 'AIzaTestFakeUserKey1234567890',
      images: [
        { mimeType: 'application/octet-stream', data: jpegData, label: 'Frame 1' },
        { mimeType: 'image/jpeg', data: pngData, label: 'Frame 2' },
      ],
    },
    mockClient,
  );

  assert.deepEqual(result, { result: 'hello from gemini' });
  assert.equal(capturedModelParams.systemInstruction, request.system);
  assert.equal(capturedModelParams.generationConfig.responseMimeType, 'application/json');
  assert.equal(capturedModelParams.generationConfig.responseSchema.type, 'object');
  assert.equal(capturedParts.length, 5);
  assert.deepEqual(capturedParts[0], { text: 'Frame 1' });
  assert.deepEqual(capturedParts[1], { inlineData: { mimeType: 'image/jpeg', data: jpegData } });
  assert.deepEqual(capturedParts[2], { text: 'Frame 2' });
  assert.deepEqual(capturedParts[3], { inlineData: { mimeType: 'image/png', data: pngData } });
  assert.deepEqual(capturedParts[4], { text: request.prompt });
});

test('Gemini adapter rejects unsupported image bytes before sending a request', async () => {
  let sent = false;
  const mockClient = {
    getGenerativeModel() {
      sent = true;
      return { generateContent: async () => ({}) };
    },
  } as unknown as GoogleGenerativeAI;

  await assert.rejects(
    generateGeminiStructured(
      { ...request, apiKeyOverride: 'AIzaTestFakeUserKey1234567890', images: [{ mimeType: 'image/jpeg', data: 'bm90IGFuIGltYWdl' }] },
      mockClient,
    ),
    /Unsupported image format/,
  );
  assert.equal(sent, false);
});

test('Gemini errors redact API keys and never trigger Nanit 401 logout', () => {
  const secretKey = 'AIzaSyFakeSecretKey9876543210';
  const sanitized = sanitizeGeminiError(`Request to https://example.com?key=${secretKey} failed with ${secretKey}`);
  assert.equal(sanitized.includes(secretKey), false);
  assert.match(sanitized, /\[REDACTED\]/);

  const captureResponse = () => {
    let status = 0;
    let body: unknown;
    const res = {
      status(code: number) { status = code; return this; },
      json(value: unknown) { body = value; return this; },
    } as any;
    return { res, get status() { return status; }, get body() { return body; } };
  };

  const invalidKey400 = captureResponse();
  handleRouteError(
    invalidKey400.res,
    new GoogleGenerativeAIFetchError(`API key not valid: ${secretKey}`, 400, 'Bad Request'),
  );
  assert.equal(invalidKey400.status, 502);
  assert.equal((invalidKey400.body as any).error, 'ai_invalid_key');
  assert.equal(JSON.stringify(invalidKey400.body).includes(secretKey), false);

  const unauthorized401 = captureResponse();
  handleRouteError(
    unauthorized401.res,
    new GoogleGenerativeAIFetchError('Unauthorized', 401, 'Unauthorized'),
  );
  assert.equal(unauthorized401.status, 502);
  assert.equal((unauthorized401.body as any).error, 'ai_invalid_key');

  const rateLimited429 = captureResponse();
  handleRouteError(
    rateLimited429.res,
    new GoogleGenerativeAIFetchError('Quota exceeded', 429, 'Too Many Requests'),
  );
  assert.equal(rateLimited429.status, 429);
  assert.equal((rateLimited429.body as any).error, 'ai_error');
});

test('Gemini chat maps user and assistant turns cleanly with system context', async () => {
  let capturedModelParams: any;
  let capturedRequest: any;
  const mockClient = {
    getGenerativeModel(modelParams: any) {
      capturedModelParams = modelParams;
      return {
        async generateContent(req: any) {
          capturedRequest = req;
          return {
            response: {
              candidates: [{ finishReason: 'STOP' }],
              usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 25 },
              text: () => 'Her 5h 30m longest stretch was right after bedtime.',
            },
          };
        },
      };
    },
  } as unknown as GoogleGenerativeAI;

  const reply = await generateGeminiChat(
    {
      label: 'insights-chat',
      system: 'NIGHT CONTEXT WITH CORRECTIONS',
      apiKeyOverride: 'AIzaTestFakeUserKey1234567890',
      messages: [
        { role: 'user', content: 'How did her longest stretch look?' },
        { role: 'assistant', content: 'It was 5h 30m.' },
        { role: 'user', content: 'When did it happen?' },
      ],
    },
    mockClient,
  );

  assert.equal(reply, 'Her 5h 30m longest stretch was right after bedtime.');
  assert.equal(capturedModelParams.systemInstruction, 'NIGHT CONTEXT WITH CORRECTIONS');
  assert.deepEqual(capturedRequest.contents, [
    { role: 'user', parts: [{ text: 'How did her longest stretch look?' }] },
    { role: 'model', parts: [{ text: 'It was 5h 30m.' }] },
    { role: 'user', parts: [{ text: 'When did it happen?' }] },
  ]);
});

test('Gemini chat model selector honors allowlisted Pro/Flash models and ignores unknown models', async () => {
  assert.equal(resolveGeminiChatModel('gemini-pro-latest'), 'gemini-pro-latest');
  assert.equal(resolveGeminiChatModel('gemini-flash-latest'), 'gemini-flash-latest');
  assert.equal(resolveGeminiChatModel('not-a-real-model'), 'gemini-flash-latest');

  let capturedModel = '';
  const mockClient = {
    getGenerativeModel(modelParams: any) {
      capturedModel = modelParams.model;
      return {
        async generateContent() {
          return {
            response: {
              candidates: [{ finishReason: 'STOP' }],
              usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
              text: () => 'Pro reply.',
            },
          };
        },
      };
    },
  } as unknown as GoogleGenerativeAI;

  await generateGeminiChat(
    {
      label: 'insights-chat',
      system: 'Context',
      model: 'gemini-pro-latest',
      apiKeyOverride: 'AIzaTestFakeUserKey1234567890',
      messages: [{ role: 'user', content: 'Analyze patterns.' }],
    },
    mockClient,
  );
  assert.equal(capturedModel, 'gemini-pro-latest');
});

test('AI insights prompt includes current and recent nightly sleep factors across 14-day window', () => {
  const sampleNight = (date: string, sleepFactors?: string[]) => ({
    date,
    sleepFactors,
    night: {
      night_start: 1757979000,
      night_end: 1758017700,
      total_duration_minutes: 540,
      sleep_segments: [{ uid: 's1', baby_uid: 'b1', begin_ts: 1757979000, end_ts: 1758017700, duration: 32400, type: 'auto_sleep', time: 1757979000 }],
      gap_count: 0,
      gaps: [],
      longest_stretch_minutes: 540,
    },
    score: {
      total_score: 90,
      duration_score: 35,
      continuity_score: 35,
      onset_score: 15,
      timing_score: 15,
      details: {
        total_sleep_minutes: 540,
        target_sleep_minutes: 600,
        wake_count: 0,
        longest_stretch_minutes: 540,
        bedtime: new Date(1757979000 * 1000).toISOString(),
        wake_time: new Date(1758017700 * 1000).toISOString(),
        adjusted: false,
        wakes: [],
        check_ins: [],
      },
      expectations: {
        adjusted_age_months: 2,
        ideal_sleep_hours: 10,
        expected_wakes: 3,
        normal_wake_minutes: 45,
        normal_wake_minutes_custom: true,
        expected_stretch_hours: 3,
        ideal_bedtime_range: [19, 22] as [number, number],
        excess_wake_penalty: 0,
        long_wake_penalty: 0,
        self_settled_wakes: 0,
        parent_visit_wakes: 0,
        unknown_wakes: 0,
      },
    },
  });

  const prompt = buildPrompt(
    sampleNight('2025-09-15', ['Arms out — Halo Easy Transition Sleep Sack', 'White noise']),
    [sampleNight('2025-09-14', ['Arms out — Halo Swaddle Sleep Sack'])],
    2,
    0,
    false,
    [],
    false,
    240,
    '',
    '',
  );

  assert.match(prompt, /Sleep factors logged by parent: Arms out — Halo Easy Transition Sleep Sack, White noise/);
  assert.match(prompt, /RECENT NIGHTS \(up to last 14 days/);
  assert.match(prompt, /factors: \[Arms out — Halo Swaddle Sleep Sack\]/);
});
