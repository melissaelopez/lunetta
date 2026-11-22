import { GoogleGenerativeAI, SchemaType, type Part, type ResponseSchema } from '@google/generative-ai';
import { z } from 'zod';
import { config } from '../config.js';
import type { StructuredRequest } from './ai-types.js';

type SupportedImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

function imageMimeType(base64: string): SupportedImageMimeType {
  const bytes = Buffer.from(base64.slice(0, 32), 'base64');
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && (bytes.toString('ascii', 0, 6) === 'GIF87a' || bytes.toString('ascii', 0, 6) === 'GIF89a')) return 'image/gif';
  throw new Error('Unsupported image format for Gemini analysis; expected JPEG, PNG, WebP, or GIF');
}

function convertJsonSchemaNode(node: Record<string, any>): ResponseSchema {
  // Handle z.nullable() in JSON Schema 2020-12: type: ['string', 'null']
  if (Array.isArray(node.type)) {
    const nonNull = node.type.filter((t: unknown) => t !== 'null');
    const isNullable = nonNull.length < node.type.length;
    if (nonNull.length === 1) {
      const converted = convertJsonSchemaNode({ ...node, type: nonNull[0] });
      if (isNullable) (converted as any).nullable = true;
      return converted;
    }
  }

  // Handle z.nullable() emitted as anyOf: [<schema>, { type: 'null' }]
  if (Array.isArray(node.anyOf)) {
    const nonNull = node.anyOf.filter((branch: any) => branch && branch.type !== 'null');
    const isNullable = nonNull.length < node.anyOf.length;
    if (nonNull.length === 1) {
      const converted = convertJsonSchemaNode(nonNull[0]);
      if (isNullable) (converted as any).nullable = true;
      if (node.description && !converted.description) converted.description = node.description;
      return converted;
    }
  }

  const description = typeof node.description === 'string' ? node.description : undefined;
  const base = description ? { description } : {};

  switch (node.type) {
    case 'object': {
      const properties: Record<string, ResponseSchema> = {};
      for (const [k, v] of Object.entries(node.properties ?? {})) {
        properties[k] = convertJsonSchemaNode(v as Record<string, any>);
      }
      const required = Array.isArray(node.required) ? node.required : undefined;
      return {
        type: SchemaType.OBJECT,
        ...base,
        properties,
        ...(required && required.length > 0 ? { required } : {}),
      };
    }
    case 'array': {
      return {
        type: SchemaType.ARRAY,
        ...base,
        items: convertJsonSchemaNode((node.items ?? { type: 'string' }) as Record<string, any>),
        ...(typeof node.minItems === 'number' ? { minItems: node.minItems } : {}),
        ...(typeof node.maxItems === 'number' ? { maxItems: node.maxItems } : {}),
      };
    }
    case 'integer':
      return { type: SchemaType.INTEGER, ...base };
    case 'number':
      return { type: SchemaType.NUMBER, ...base };
    case 'boolean':
      return { type: SchemaType.BOOLEAN, ...base };
    case 'string':
    default: {
      if (Array.isArray(node.enum)) {
        return {
          type: SchemaType.STRING,
          format: 'enum',
          enum: node.enum.map(String),
          ...base,
        };
      }
      return { type: SchemaType.STRING, ...base };
    }
  }
}

/** Converts a Zod schema into Gemini's OpenAPI-subset ResponseSchema. */
export function zodToGeminiSchema(schema: z.ZodType): ResponseSchema {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, any>;
  return convertJsonSchemaNode(jsonSchema);
}

/** Strips any API key strings from error text before logging or returning to clients. */
export function sanitizeGeminiError(message: string): string {
  return message
    .replace(/([?&]key=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/AIza[0-9A-Za-z\-_]{10,}/g, '[REDACTED]');
}

export function isGeminiConfigured(apiKeyOverride?: string): boolean {
  return !!(apiKeyOverride?.trim() || config.gemini.apiKey);
}

export async function generateGeminiStructured<S extends z.ZodType>(
  req: StructuredRequest<S>,
  injectedClient?: GoogleGenerativeAI,
): Promise<z.infer<S>> {
  const userKey = req.apiKeyOverride?.trim();
  const apiKey = userKey || config.gemini.apiKey;
  if (!apiKey && !injectedClient) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const parts: Part[] = [];
  for (const img of req.images ?? []) {
    if (img.label) parts.push({ text: img.label });
    parts.push({
      inlineData: {
        mimeType: imageMimeType(img.data),
        data: img.data,
      },
    });
  }
  parts.push({ text: req.prompt });

  const modelName = config.ai.provider === 'gemini' ? config.ai.model : config.gemini.model;
  const started = Date.now();
  console.log(
    `[ai:gemini:${req.label}] ${modelName} images=${req.images?.length ?? 0} keySource=${userKey ? 'user' : 'server'}`,
  );

  // Per-request client ensures user-supplied keys live only in local stack scope and are never cached.
  const client = injectedClient ?? new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({
    model: modelName,
    systemInstruction: req.system,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: zodToGeminiSchema(req.schema),
      maxOutputTokens: req.maxTokens ?? 8192,
    },
  });

  const result = await model.generateContent(parts);
  const response = result.response;
  const usage = response.usageMetadata;
  console.log(
    `[ai:gemini:${req.label}] done in ${Date.now() - started}ms — in=${usage?.promptTokenCount ?? 0} out=${usage?.candidatesTokenCount ?? 0}`,
  );

  const candidate = response.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
    throw new Error(`Gemini did not complete the request (${candidate.finishReason})`);
  }

  let text = response.text().trim();
  if (!text) {
    throw new Error('Gemini returned no parseable structured output');
  }
  text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Gemini returned invalid JSON for structured output');
  }
  return req.schema.parse(parsed);
}
