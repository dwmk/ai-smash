import express, { type Request, type Response } from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import {
  SYSTEM_PROMPTS,
  APP_INFO,
  VRM_CONFIG,
  OLLAMA_CONFIG,
  MODEL_SOURCE_DOMAIN,
  MODEL_FALLBACK_DOMAIN,
  ANIMATION_SOURCE_DOMAINS,
  AI_PROFILE,
  VOICE_CONFIG,
  ALL_WARDROBE_OUTFITS,
  DEFAULT_OUTFIT_ID,
} from './src/constants';
import { AVAILABLE_MODELS } from './src/lib/models';
import { buildSchema, graphql } from 'graphql';
import {
  signUpAccount,
  signInAccount,
  updateAccountProfile,
  redeemAccountCode,
  fetchUserSyncedData,
  syncUserConversationsAndThemes,
  checkNeonDbConnected,
  createInterviewInDb,
  getInterviewByIdFromDb,
  listInterviewsFromDb,
  deleteInterviewFromDb,
  submitInterviewSessionToDb,
  listInterviewSubmissionsFromDb,
  DEFAULT_DEMO_INTERVIEW,
  type InterviewRecord,
  type InterviewSubmissionRecord,
} from './src/db/neondb';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const DEFAULT_SYSTEM_PROMPT = SYSTEM_PROMPTS.full;

// Health check
app.get('/api/health', async (_req: Request, res: Response) => {
  const hasDb = await checkNeonDbConnected();
  res.json({
    status: 'ok',
    persona: APP_INFO.name,
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    hasNeonDb: hasDb,
  });
});

// Database & Account Status Check
app.get('/api/account/status', async (_req: Request, res: Response) => {
  try {
    const connected = await checkNeonDbConnected();
    res.json({ connected });
  } catch {
    res.json({ connected: false });
  }
});

// Proxy endpoint for VRM 3D asset to bypass CORS redirect blocks
app.get('/api/vrm', async (req: Request, res: Response) => {
  try {
    const requestedFile = typeof req.query.file === 'string' ? req.query.file.trim() : '';
    const safeFile = /^[a-zA-Z0-9_.-]+\.vrm$/.test(requestedFile) ? requestedFile : '';

    const targetUrls = safeFile
      ? [
          `${MODEL_SOURCE_DOMAIN}/${safeFile}`,
          `${MODEL_FALLBACK_DOMAIN}/${safeFile}`,
          VRM_CONFIG.modelUrl,
        ]
      : [
          VRM_CONFIG.modelUrl,
          ...VRM_CONFIG.candidateModelUrls.filter((u) => !u.startsWith('/api')),
        ];

    let vrmResp: globalThis.Response | null = null;
    for (const url of targetUrls) {
      try {
        const resp = await fetch(url, { redirect: 'follow' });
        if (resp.ok && resp.body) {
          vrmResp = resp;
          break;
        }
      } catch {
        // Continue to fallback
      }
    }

    if (!vrmResp || !vrmResp.body) {
      return res.status(502).json({ error: 'Failed to fetch remote VRM asset' });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const contentLength = vrmResp.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    const reader = vrmResp.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Error fetching VRM asset';
    console.error('VRM proxy error:', errorMsg);
    if (!res.headersSent) {
      res.status(500).json({ error: errorMsg });
    } else {
      res.end();
    }
  }
});

// Proxy endpoint for Mixamo animation FBX assets (idle, fall, getup, walk, wave, wait/yawn/custom fbx)
app.get(['/api/animation/:type', '/api/animation/idle'], async (req: Request, res: Response) => {
  try {
    const animType = req.params.type || 'idle';
    const requestedFile = typeof req.query.file === 'string' ? req.query.file.trim() : '';
    const safeFile = /^[a-zA-Z0-9_.-]+\.fbx$/.test(requestedFile) ? requestedFile : '';

    let targetUrls: string[] = [];

    if (safeFile) {
      targetUrls = ANIMATION_SOURCE_DOMAINS.map((domain) => `${domain}/${safeFile}`);
      if (safeFile === 'mixamo_.jumpingjacks.fbx') {
        targetUrls.push(...ANIMATION_SOURCE_DOMAINS.map((domain) => `${domain}/mixamo_jumpingjacks.fbx`));
      }
    } else if (animType === 'fall') {
      targetUrls = [
        VRM_CONFIG.fallAnimationUrl,
        ...VRM_CONFIG.candidateFallAnimationUrls.filter((u) => !u.startsWith('/api')),
      ];
    } else if (animType === 'getup') {
      targetUrls = [
        VRM_CONFIG.getupAnimationUrl,
        ...VRM_CONFIG.candidateGetupAnimationUrls.filter((u) => !u.startsWith('/api')),
      ];
    } else if (animType === 'walk') {
      targetUrls = [
        VRM_CONFIG.walkAnimationUrl,
        ...VRM_CONFIG.candidateWalkAnimationUrls.filter((u) => !u.startsWith('/api')),
      ];
    } else if (animType === 'wave') {
      targetUrls = [
        VRM_CONFIG.waveAnimationUrl,
        ...VRM_CONFIG.candidateWaveAnimationUrls.filter((u) => !u.startsWith('/api')),
      ];
    } else if (animType === 'yawn') {
      targetUrls = ANIMATION_SOURCE_DOMAINS.map((domain) => `${domain}/mixamo_yawn.fbx`);
    } else if (animType === 'wait') {
      targetUrls = ANIMATION_SOURCE_DOMAINS.map((domain) => `${domain}/mixamo_wait.fbx`);
    } else if (animType && animType !== 'idle' && /^[a-zA-Z0-9_.-]+$/.test(animType)) {
      const candidateFile = animType.endsWith('.fbx') ? animType : `mixamo_${animType}.fbx`;
      targetUrls = ANIMATION_SOURCE_DOMAINS.map((domain) => `${domain}/${candidateFile}`);
      if (animType === 'jumpingjacks') {
        targetUrls.unshift(
          ...ANIMATION_SOURCE_DOMAINS.map((domain) => `${domain}/mixamo_.jumpingjacks.fbx`)
        );
      }
    } else {
      targetUrls = [
        VRM_CONFIG.animationUrl,
        ...VRM_CONFIG.candidateAnimationUrls.filter((u) => !u.startsWith('/api')),
      ];
    }

    let fbxResp: globalThis.Response | null = null;
    for (const url of targetUrls) {
      try {
        const resp = await fetch(url, { redirect: 'follow' });
        if (resp.ok && resp.body) {
          fbxResp = resp;
          break;
        }
      } catch {
        // Continue to fallback
      }
    }

    if (!fbxResp || !fbxResp.body) {
      return res.status(502).json({ error: `Failed to fetch remote animation asset ${animType}` });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    const contentLength = fbxResp.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    const reader = fbxResp.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Error fetching animation asset';
    console.error('Animation proxy error:', errorMsg);
    if (!res.headersSent) {
      res.status(500).json({ error: errorMsg });
    } else {
      res.end();
    }
  }
});

// Helper to normalize Ollama base URL
function cleanOllamaBaseUrl(rawUrl: string): string {
  let url = (rawUrl || '').trim();
  // Strip trailing slashes
  url = url.replace(/\/+$/, '');
  // Strip any trailing API subpaths if user pasted full endpoint
  url = url.replace(/\/(api\/tags|api\/chat|api\/generate|api\/version|v1\/models|v1\/chat\/completions)$/, '');
  return url.replace(/\/+$/, '');
}

function buildServerOllamaUrl(rawUrl: string, endpoint: string): string {
  const clean = cleanOllamaBaseUrl(rawUrl);
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const full = `${clean}${path}`;
  if (full.includes('ngrok')) {
    const sep = full.includes('?') ? '&' : '?';
    return `${full}${sep}ngrok-skip-browser-warning=true`;
  }
  return full;
}

const OLLAMA_REQUEST_HEADERS = {
  'ngrok-skip-browser-warning': 'true',
  'User-Agent': 'curl/8.0.0',
  'Accept': 'application/json',
};

// Ollama connectivity ping endpoint
app.post('/api/ollama/ping', async (req: Request, res: Response) => {
  try {
    const baseUrl = cleanOllamaBaseUrl(req.body?.url || '');
    if (!baseUrl) {
      return res.json({ online: false, error: 'No URL provided' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    let online = false;
    let models: string[] = [];

    // 1. Try /api/tags (Native Ollama model list)
    try {
      const resp = await fetch(buildServerOllamaUrl(baseUrl, '/api/tags'), {
        method: 'GET',
        headers: OLLAMA_REQUEST_HEADERS,
        signal: controller.signal,
      });

      if (resp.ok && !resp.headers.get('ngrok-error-code')) {
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = (await resp.json()) as { models?: Array<{ name?: string; model?: string }> };
          if (Array.isArray(data?.models)) {
            models = data.models
              .map((m) => (m.name || m.model || '').trim())
              .filter(Boolean);
            if (models.length > 0) {
              online = true;
            }
          }
        }
      }
    } catch {
      // Continue to /v1/models fallback
    }

    // 2. Try /v1/models (OpenAI compatibility endpoint on Ollama, shown in pyngrok setup)
    if (models.length === 0) {
      try {
        const v1Resp = await fetch(buildServerOllamaUrl(baseUrl, '/v1/models'), {
          method: 'GET',
          headers: OLLAMA_REQUEST_HEADERS,
          signal: controller.signal,
        });

        if (v1Resp.ok && !v1Resp.headers.get('ngrok-error-code')) {
          const contentType = v1Resp.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const data = (await v1Resp.json()) as { data?: Array<{ id?: string; name?: string }> };
            if (Array.isArray(data?.data)) {
              models = data.data
                .map((m) => (m.id || m.name || '').trim())
                .filter(Boolean);
              if (models.length > 0) {
                online = true;
              }
            }
          }
        }
      } catch {
        // Continue to root/version fallback
      }
    }

    // 3. Fallback check to /api/version or / root
    if (!online) {
      try {
        const verResp = await fetch(buildServerOllamaUrl(baseUrl, '/api/version'), {
          method: 'GET',
          headers: OLLAMA_REQUEST_HEADERS,
          signal: controller.signal,
        });
        if (verResp.ok && !verResp.headers.get('ngrok-error-code')) {
          online = true;
        }
      } catch {
        try {
          const rootResp = await fetch(buildServerOllamaUrl(baseUrl, '/'), {
            method: 'GET',
            headers: OLLAMA_REQUEST_HEADERS,
            signal: controller.signal,
          });
          if (rootResp.ok && !rootResp.headers.get('ngrok-error-code')) {
            const text = await rootResp.text();
            if (text.includes('Ollama is running') || text.includes('ollama')) {
              online = true;
            }
          }
        } catch {
          online = false;
        }
      }
    }

    clearTimeout(timeout);

    res.json({
      online,
      models,
      modelName: models[0] || '',
    });
  } catch {
    res.json({ online: false, modelName: '', models: [] });
  }
});

// Cloud streaming endpoint for Ollama
app.post('/api/ollama/chat', async (req: Request, res: Response) => {
  try {
    const { url, model, messages, systemPrompt, maxTokens } = req.body;
    const baseUrl = cleanOllamaBaseUrl(url || '');
    if (!baseUrl) {
      return res.status(400).json({ error: 'Target Ollama URL is required' });
    }

    // Resolve target model: if unspecified,
    // auto-fetch available models from the target Ollama instance to use the actual model in VRAM
    let resolvedModel = (model || '').trim();
    if (!resolvedModel) {
      try {
        const tagsResp = await fetch(buildServerOllamaUrl(baseUrl, '/api/tags'), {
          method: 'GET',
          headers: OLLAMA_REQUEST_HEADERS,
          signal: AbortSignal.timeout(3000),
        });
        if (tagsResp.ok) {
          const data = (await tagsResp.json()) as { models?: Array<{ name?: string; model?: string }> };
          const availModels = (data?.models || []).map((m) => m.name || m.model || '').filter(Boolean);
          if (availModels.length > 0) {
            resolvedModel = availModels[0];
          }
        }
      } catch {
        // Keep resolvedModel or fallback
      }

      if (!resolvedModel) {
        try {
          const v1Resp = await fetch(buildServerOllamaUrl(baseUrl, '/v1/models'), {
            method: 'GET',
            headers: OLLAMA_REQUEST_HEADERS,
            signal: AbortSignal.timeout(3000),
          });
          if (v1Resp.ok) {
            const data = (await v1Resp.json()) as { data?: Array<{ id?: string }> };
            const v1Models = (data?.data || []).map((m) => m.id || '').filter(Boolean);
            if (v1Models.length > 0) {
              resolvedModel = v1Models[0];
            }
          }
        } catch {
          // Ignore
        }
      }
    }

    if (!resolvedModel) {
      resolvedModel = OLLAMA_CONFIG.defaultFallbackModel;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Filter out any client system messages to guarantee exactly ONE complete system prompt
    const cleanedHistory = (messages || [])
      .filter((m: { role: string; content: string }) => m.role !== 'system')
      .map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      }));

    // Full system prompt according to Ollama system instructions protocol
    const formattedMessages = [
      { role: 'system', content: systemPrompt || DEFAULT_SYSTEM_PROMPT },
      ...cleanedHistory,
    ];

    const numPredict = Math.min(Math.max(Number(maxTokens) || 512, 64), 4096);

    const ollamaResp = await fetch(buildServerOllamaUrl(baseUrl, '/api/chat'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        'User-Agent': 'curl/8.0.0',
      },
      body: JSON.stringify({
        model: resolvedModel,
        messages: formattedMessages,
        stream: true,
        options: {
          num_predict: numPredict,
          temperature: 0.85,
        },
      }),
    });

    if (!ollamaResp.ok || !ollamaResp.body) {
      const errText = await ollamaResp.text();
      res.write(`data: ${JSON.stringify({ error: errText || `Ollama server error (${ollamaResp.status})` })}\n\n`);
      return res.end();
    }

    const reader = ollamaResp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          const piece = parsed.message?.content || parsed.response || parsed.choices?.[0]?.delta?.content || '';
          if (piece) {
            res.write(`data: ${JSON.stringify({ text: piece })}\n\n`);
          }
          if (parsed.done) {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          }
        } catch {
          // ignore unparsed chunk
        }
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Ollama proxy error';
    if (!res.headersSent) {
      res.status(500).json({ error: errorMsg });
    } else {
      res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
      res.end();
    }
  }
});

// Cloud streaming endpoint for Gemini 3.8 Flash & Gemini 2.5 Flash
app.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const { messages, systemPrompt, maxTokens } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
    }

    const ai = new GoogleGenAI({ apiKey });

    // Format chat history for GoogleGenAI
    const formattedContents = (messages || []).map((msg: { role: string; content: string }) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const outputTokens = Math.min(Math.max(Number(maxTokens) || 512, 64), 4096);

    const candidateModels = [
      'gemini-3.1-flash-lite',
      'gemini-flash-latest',
      'gemini-3.8-flash',
    ];

    let responseStream: any = null;
    let lastError: any = null;

    for (const cand of candidateModels) {
      try {
        responseStream = await ai.models.generateContentStream({
          model: cand,
          contents: formattedContents,
          config: {
            systemInstruction: systemPrompt || DEFAULT_SYSTEM_PROMPT,
            temperature: 0.85,
            maxOutputTokens: outputTokens,
          },
        });
        if (responseStream) break;
      } catch (streamErr) {
        lastError = streamErr;
        console.warn(`Model ${cand} unavailable in /api/chat:`, streamErr instanceof Error ? streamErr.message : streamErr);
      }
    }

    if (!responseStream) {
      throw lastError || new Error('No available Gemini model responded');
    }

    for await (const chunk of responseStream) {
      const text = chunk.text;
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown streaming error';
    console.error('Gemini chat error:', errorMessage);
    if (!res.headersSent) {
      res.status(500).json({ error: errorMessage });
    } else {
      res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
      res.end();
    }
  }
});

// Cloud streaming endpoint for external AI Model APIs
// (OpenAI, Gemini, Anthropic, xAI, Groq, Z.ai, DeepSeek, Qwen, HuggingFace)
app.post('/api/chat/provider', async (req: Request, res: Response) => {
  try {
    const { provider, apiKey, model, messages, systemPrompt, maxTokens } = req.body || {};
    const effectivePrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const outputTokens = Math.min(Math.max(Number(maxTokens) || 512, 64), 4096);

    const effectiveKey = (apiKey || '').trim() || (provider === 'gemini' ? (process.env.GEMINI_API_KEY || '') : '');
    if (!effectiveKey) {
      return res.status(400).json({
        error: `API key is required for ${provider || 'this provider'}. Please configure your API key in the Model Selector.`,
      });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 1. Google Gemini via @google/genai SDK
    if (provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: effectiveKey });
      const formattedContents = (messages || [])
        .filter((m: { role: string }) => m.role !== 'system')
        .map((msg: { role: string; content: string }) => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        }));

      const preferred = model && model !== 'gemini-2.5-flash' ? model : 'gemini-3.1-flash-lite';
      const candidateModels = [
        preferred,
        'gemini-3.1-flash-lite',
        'gemini-flash-latest',
        'gemini-3.8-flash',
      ];

      let responseStream: any = null;
      let lastError: any = null;

      for (const cand of candidateModels) {
        try {
          responseStream = await ai.models.generateContentStream({
            model: cand,
            contents: formattedContents,
            config: {
              systemInstruction: effectivePrompt,
              temperature: 0.85,
              maxOutputTokens: outputTokens,
            },
          });
          if (responseStream) break;
        } catch (streamErr) {
          lastError = streamErr;
          console.warn(`Provider Gemini model ${cand} unavailable, trying next:`, streamErr instanceof Error ? streamErr.message : streamErr);
        }
      }

      if (!responseStream) {
        throw lastError || new Error('No available Gemini model responded');
      }

      for await (const chunk of responseStream) {
        if (chunk.text) {
          res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
        }
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    // 2. Anthropic Claude via native messages SSE API
    if (provider === 'anthropic') {
      const targetModel = model || 'claude-3-7-sonnet-20250219';
      const cleanedMessages = (messages || [])
        .filter((m: { role: string }) => m.role === 'user' || m.role === 'assistant')
        .map((m: { role: string; content: string }) => ({
          role: m.role,
          content: m.content,
        }));

      const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': effectiveKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model: targetModel,
          max_tokens: outputTokens,
          system: effectivePrompt,
          messages: cleanedMessages,
          stream: true,
          temperature: 0.85,
        }),
      });

      if (!anthropicResp.ok || !anthropicResp.body) {
        const errText = await anthropicResp.text();
        res.write(`data: ${JSON.stringify({ error: errText || `Anthropic API error (${anthropicResp.status})` })}\n\n`);
        return res.end();
      }

      const reader = anthropicResp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            if (dataStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                res.write(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`);
              } else if (parsed.type === 'message_stop') {
                res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
              }
            } catch {}
          }
        }
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    // 3. OpenAI-Compatible Providers (OpenAI, xAI, Groq, DeepSeek, Z.ai, Qwen, HuggingFace)
    const providerEndpoints: Record<string, string> = {
      openai: 'https://api.openai.com/v1/chat/completions',
      xai: 'https://api.x.ai/v1/chat/completions',
      groq: 'https://api.groq.com/openai/v1/chat/completions',
      deepseek: 'https://api.deepseek.com/chat/completions',
      zai: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      huggingface: 'https://router.huggingface.co/hf-inference/v1/chat/completions',
    };

    const targetUrl = providerEndpoints[provider] || providerEndpoints.openai;
    const defaultModels: Record<string, string> = {
      openai: 'gpt-4o',
      xai: 'grok-2-latest',
      groq: 'llama-3.3-70b-versatile',
      deepseek: 'deepseek-chat',
      zai: 'glm-4-plus',
      qwen: 'qwen-max',
      huggingface: 'meta-llama/Llama-3.3-70B-Instruct',
    };

    const targetModel = model || defaultModels[provider] || 'gpt-4o';
    const cleanedHistory = (messages || [])
      .filter((m: { role: string }) => m.role !== 'system')
      .map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      }));

    const formattedMessages = [
      { role: 'system', content: effectivePrompt },
      ...cleanedHistory,
    ];

    const apiResp = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${effectiveKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: targetModel,
        messages: formattedMessages,
        max_tokens: outputTokens,
        temperature: 0.85,
        stream: true,
      }),
    });

    if (!apiResp.ok || !apiResp.body) {
      const errText = await apiResp.text();
      res.write(`data: ${JSON.stringify({ error: errText || `${provider} API error (${apiResp.status})` })}\n\n`);
      return res.end();
    }

    const reader = apiResp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            continue;
          }
          try {
            const parsed = JSON.parse(dataStr);
            const piece = parsed.choices?.[0]?.delta?.content || '';
            if (piece) {
              res.write(`data: ${JSON.stringify({ text: piece })}\n\n`);
            }
          } catch {}
        }
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Error in external API streaming proxy';
    console.error('Provider proxy error:', errorMsg);
    if (!res.headersSent) {
      res.status(500).json({ error: errorMsg });
    } else {
      res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
      res.end();
    }
  }
});

// =====================================================================
// 3RD-PARTY OMNICHANNEL CALLING & VOICE INTEGRATIONS
// WhatsApp, Telegram, Discord, Facebook Messenger
// =====================================================================

interface OmnichannelMessage {
  id: string;
  sender: 'callee' | 'agent';
  text: string;
  timestamp: string;
  platform: string;
}

const omnichannelCallMessages = new Map<string, OmnichannelMessage[]>();
const telegramLastUpdateOffsets = new Map<string, number>();

interface DiscordVoiceSession {
  guildId: string;
  channelId: string;
  channelName?: string;
  sessionId?: string;
  token?: string;
  endpoint?: string;
  voiceWs?: any;
  voiceHeartbeatTimer?: any;
  ssrc?: number;
  ip?: string;
  port?: number;
  status: 'connected' | 'connecting' | 'disconnected';
  isSpeaking: boolean;
  speakingTimer?: any;
}

interface DiscordGatewaySession {
  ws: any;
  heartbeatTimer: any;
  lastSequence: number | null;
  botUser: { id: string; username: string } | null;
  token: string;
  status: 'connected' | 'connecting' | 'error' | 'disconnected';
  voiceSessions: Map<string, DiscordVoiceSession>;
}

const activeDiscordGateways = new Map<string, DiscordGatewaySession>();

function connectDiscordVoiceGateway(session: DiscordGatewaySession, voiceSession: DiscordVoiceSession): void {
  if (!voiceSession.endpoint || !voiceSession.token || !voiceSession.sessionId || !session.botUser) return;
  const rawEndpoint = voiceSession.endpoint.replace(':443', '');
  const voiceWsUrl = `wss://${rawEndpoint}/?v=8`;

  if (voiceSession.voiceWs) {
    try { voiceSession.voiceWs.close(1000); } catch {}
    voiceSession.voiceWs = null;
  }
  if (voiceSession.voiceHeartbeatTimer) {
    clearInterval(voiceSession.voiceHeartbeatTimer);
    voiceSession.voiceHeartbeatTimer = null;
  }

  try {
    const vws = new (globalThis as any).WebSocket(voiceWsUrl);
    voiceSession.voiceWs = vws;
    voiceSession.status = 'connecting';

    vws.onmessage = (event: any) => {
      try {
        const payload = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
        const { op, d } = payload;

        // Opcode 8: Hello -> begin heartbeat and identify
        if (op === 8) {
          const interval = d.heartbeat_interval || 20000;
          voiceSession.voiceHeartbeatTimer = setInterval(() => {
            if (voiceSession.voiceWs && voiceSession.voiceWs.readyState === 1) {
              voiceSession.voiceWs.send(JSON.stringify({ op: 3, d: Date.now() }));
            }
          }, interval);

          // Opcode 0: Identify
          const identify = {
            op: 0,
            d: {
              server_id: voiceSession.guildId,
              user_id: session.botUser!.id,
              session_id: voiceSession.sessionId,
              token: voiceSession.token,
            },
          };
          vws.send(JSON.stringify(identify));
        }

        // Opcode 2: Ready
        if (op === 2) {
          voiceSession.ssrc = d.ssrc;
          voiceSession.ip = d.ip;
          voiceSession.port = d.port;

          // Opcode 1: Select Protocol
          const selectProto = {
            op: 1,
            d: {
              protocol: 'udp',
              data: {
                address: d.ip,
                port: d.port,
                mode: (d.modes && d.modes[0]) || 'aead_aes256_gcm',
              },
            },
          };
          vws.send(JSON.stringify(selectProto));
        }

        // Opcode 4: Session Description -> Connected!
        if (op === 4) {
          voiceSession.status = 'connected';
          console.log(`[Discord Voice] Connected to voice server in guild ${voiceSession.guildId}`);
        }
      } catch (err) {
        console.warn('[Discord Voice Gateway] Parse error:', err);
      }
    };

    vws.onclose = () => {
      if (voiceSession.voiceHeartbeatTimer) {
        clearInterval(voiceSession.voiceHeartbeatTimer);
        voiceSession.voiceHeartbeatTimer = null;
      }
      voiceSession.status = 'disconnected';
    };

    vws.onerror = (err: any) => {
      console.warn('[Discord Voice Gateway] Error:', err?.message || err);
    };
  } catch (err) {
    console.warn('[Discord Voice Gateway] Connection failed:', err);
  }
}

function setDiscordVoiceSpeaking(voiceSession: DiscordVoiceSession, speaking: boolean, durationMs: number = 3000): void {
  if (!voiceSession.voiceWs || voiceSession.voiceWs.readyState !== 1) return;
  voiceSession.isSpeaking = speaking;
  const payload = {
    op: 5,
    d: {
      speaking: speaking ? 1 : 0,
      delay: 0,
      ssrc: voiceSession.ssrc || 1,
    },
  };
  try {
    voiceSession.voiceWs.send(JSON.stringify(payload));
  } catch {}

  if (speaking) {
    if (voiceSession.speakingTimer) clearTimeout(voiceSession.speakingTimer);
    voiceSession.speakingTimer = setTimeout(() => {
      voiceSession.isSpeaking = false;
      try {
        if (voiceSession.voiceWs && voiceSession.voiceWs.readyState === 1) {
          voiceSession.voiceWs.send(
            JSON.stringify({ op: 5, d: { speaking: 0, delay: 0, ssrc: voiceSession.ssrc || 1 } })
          );
        }
      } catch {}
    }, durationMs);
  }
}

async function fetchDiscordChannelDetails(cleanToken: string, channelId: string): Promise<{
  id: string;
  name: string;
  type: number;
  guildId: string;
  isVoice: boolean;
} | null> {
  try {
    const resp = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
      headers: { Authorization: `Bot ${cleanToken}` },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      id: data.id,
      name: data.name || channelId,
      type: data.type,
      guildId: data.guild_id || '',
      isVoice: data.type === 2 || data.type === 13,
    };
  } catch {
    return null;
  }
}

async function joinDiscordVoiceChannel(cleanToken: string, channelId: string, providedGuildId?: string) {
  let guildId = providedGuildId || '';
  let channelName = channelId;

  const chInfo = await fetchDiscordChannelDetails(cleanToken, channelId);
  if (chInfo) {
    guildId = chInfo.guildId || guildId;
    channelName = chInfo.name;
  }

  if (!guildId) {
    throw new Error(`Could not resolve Guild (Server) ID for channel ${channelId}. Please ensure bot has View Channel permissions.`);
  }

  ensureDiscordBotOnline(cleanToken);
  const session = activeDiscordGateways.get(cleanToken);

  // Send Gateway Opcode 4: Gateway Voice State Update
  if (session && session.ws && session.ws.readyState === 1) {
    session.ws.send(
      JSON.stringify({
        op: 4,
        d: {
          guild_id: guildId,
          channel_id: channelId,
          self_mute: false,
          self_deaf: false,
        },
      })
    );
  }

  // Also patch voice states via REST endpoint for guaranteed sync
  try {
    await fetch(`https://discord.com/api/v10/guilds/${guildId}/voice-states/@me`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bot ${cleanToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel_id: channelId,
        suppress: false,
      }),
    });
  } catch {}

  let voiceSession = session?.voiceSessions.get(guildId);
  if (!voiceSession) {
    voiceSession = {
      guildId,
      channelId,
      channelName,
      status: 'connecting',
      isSpeaking: false,
    };
    session?.voiceSessions.set(guildId, voiceSession);
  } else {
    voiceSession.channelId = channelId;
    voiceSession.channelName = channelName;
  }

  return { ok: true, channelId, channelName, guildId, status: voiceSession.status };
}

async function leaveDiscordVoiceChannel(cleanToken: string, guildId: string, _channelId?: string) {
  const session = activeDiscordGateways.get(cleanToken);
  if (session && session.ws && session.ws.readyState === 1) {
    session.ws.send(
      JSON.stringify({
        op: 4,
        d: {
          guild_id: guildId,
          channel_id: null,
          self_mute: false,
          self_deaf: false,
        },
      })
    );
  }
  try {
    await fetch(`https://discord.com/api/v10/guilds/${guildId}/voice-states/@me`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bot ${cleanToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel_id: null }),
    });
  } catch {}

  const voiceSession = session?.voiceSessions.get(guildId);
  if (voiceSession) {
    if (voiceSession.voiceWs) {
      try { voiceSession.voiceWs.close(1000); } catch {}
      voiceSession.voiceWs = null;
    }
    voiceSession.status = 'disconnected';
    voiceSession.isSpeaking = false;
  }
  return { ok: true, status: 'disconnected' };
}

async function speakInDiscordVoiceChannel(cleanToken: string, channelId: string, text: string, providedGuildId?: string) {
  // 1. Ensure bot has joined voice channel
  const joinResult = await joinDiscordVoiceChannel(cleanToken, channelId, providedGuildId);
  const session = activeDiscordGateways.get(cleanToken);
  const guildId = joinResult.guildId;
  const voiceSession = session?.voiceSessions.get(guildId);

  // 2. Synthesize audio buffer
  const voiceBuf = await synthesizeHanaVoice(text);
  const estimatedDuration = Math.min(Math.max(text.length * 75, 2500), 15000);

  // 3. Turn on Voice Speaking State (Opcode 5 Speaking: 1 -> lights up green voice talking circle in Discord VC)
  if (voiceSession) {
    setDiscordVoiceSpeaking(voiceSession, true, estimatedDuration);
  }

  // 4. Send synced audio file into channel so users in voice channel chat also have audio playback
  try {
    if (voiceBuf) {
      const form = new FormData();
      form.append(
        'payload_json',
        JSON.stringify({
          content: `🔊 **[Voice Channel Active]** 🌸 **Hana Speaking in <#${channelId}>:**\n> "${text}"`,
          attachments: [{ id: 0, filename: 'hana_voice_channel.wav', description: 'Hana Audio Stream' }],
        })
      );
      form.append('files[0]', new Blob([new Uint8Array(voiceBuf)], { type: 'audio/wav' }), 'hana_voice_channel.wav');
      await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${cleanToken}` },
        body: form,
      });
    }
  } catch {}

  return { ok: true, spoken: true, durationMs: estimatedDuration, channelName: joinResult.channelName };
}

function ensureDiscordBotOnline(rawToken: string): void {
  const cleanToken = String(rawToken || '').trim().replace(/^Bot\s+/i, '');
  if (!cleanToken || cleanToken.length < 20) return;

  const existing = activeDiscordGateways.get(cleanToken);
  if (existing && existing.status === 'connected' && existing.ws && existing.ws.readyState === 1) {
    return;
  }

  if (typeof (globalThis as any).WebSocket === 'undefined') return;

  try {
    if (existing?.ws) {
      try { existing.ws.close(1000); } catch {}
    }
    if (existing?.heartbeatTimer) {
      clearInterval(existing.heartbeatTimer);
    }

    const session: DiscordGatewaySession = {
      ws: null,
      heartbeatTimer: null,
      lastSequence: null,
      botUser: null,
      token: cleanToken,
      status: 'connecting',
      voiceSessions: new Map(),
    };
    activeDiscordGateways.set(cleanToken, session);

    const ws = new (globalThis as any).WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
    session.ws = ws;

    ws.onmessage = (event: any) => {
      try {
        const payload = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
        const { op, d, s, t } = payload;
        if (s !== undefined && s !== null) {
          session.lastSequence = s;
        }

        // Opcode 10: Hello
        if (op === 10) {
          const interval = d.heartbeat_interval || 41250;
          session.heartbeatTimer = setInterval(() => {
            if (session.ws && session.ws.readyState === 1) {
              session.ws.send(JSON.stringify({ op: 1, d: session.lastSequence }));
            }
          }, interval);

          // Identify with immediate online presence
          const identify = {
            op: 2,
            d: {
              token: cleanToken,
              intents: 513, // Guilds + Guild Messages
              properties: {
                os: 'linux',
                browser: 'Hana',
                device: 'Hana',
                $os: 'linux',
                $browser: 'Hana',
                $device: 'Hana',
              },
              presence: {
                activities: [{ name: 'Voice Calls with Hana 🌸', type: 0 }],
                status: 'online',
                afk: false,
              },
            },
          };
          ws.send(JSON.stringify(identify));
        }

        if (op === 1 && session.ws?.readyState === 1) {
          session.ws.send(JSON.stringify({ op: 1, d: session.lastSequence }));
        }

        if (op === 0) {
          if (t === 'READY') {
            session.status = 'connected';
            session.botUser = d.user;
          } else if (t === 'VOICE_STATE_UPDATE') {
            if (d.user_id === session.botUser?.id) {
              const guildId = d.guild_id;
              let voiceSession = session.voiceSessions.get(guildId);
              if (!voiceSession) {
                voiceSession = {
                  guildId,
                  channelId: d.channel_id,
                  status: d.channel_id ? 'connecting' : 'disconnected',
                  isSpeaking: false,
                };
                session.voiceSessions.set(guildId, voiceSession);
              } else {
                voiceSession.channelId = d.channel_id;
                if (!d.channel_id) {
                  voiceSession.status = 'disconnected';
                  if (voiceSession.voiceWs) {
                    try { voiceSession.voiceWs.close(1000); } catch {}
                    voiceSession.voiceWs = null;
                  }
                }
              }
              voiceSession.sessionId = d.session_id;
              if (voiceSession.endpoint && voiceSession.token) {
                connectDiscordVoiceGateway(session, voiceSession);
              }
            }
          } else if (t === 'VOICE_SERVER_UPDATE') {
            const guildId = d.guild_id;
            let voiceSession = session.voiceSessions.get(guildId);
            if (!voiceSession) {
              voiceSession = {
                guildId,
                channelId: '',
                status: 'connecting',
                isSpeaking: false,
              };
              session.voiceSessions.set(guildId, voiceSession);
            }
            voiceSession.token = d.token;
            voiceSession.endpoint = d.endpoint;
            if (voiceSession.sessionId) {
              connectDiscordVoiceGateway(session, voiceSession);
            }
          }
        }
      } catch (e) {
        console.warn('[Discord Server Gateway] Parse error:', e);
      }
    };

    ws.onerror = (err: any) => {
      console.warn('[Discord Server Gateway] WebSocket notice:', err?.message || err);
    };

    ws.onclose = (evt: any) => {
      if (session.heartbeatTimer) {
        clearInterval(session.heartbeatTimer);
        session.heartbeatTimer = null;
      }
      session.status = 'disconnected';
      if (evt?.code !== 1000 && evt?.code !== 4004) {
        setTimeout(() => ensureDiscordBotOnline(cleanToken), 5000);
      }
    };
  } catch (err) {
    console.warn('[Discord Server Gateway] Failed to start:', err);
  }
}

async function transcribeAudioBuffer(audioBuffer: Buffer, mimeType: string = 'audio/ogg'): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const base64Audio = audioBuffer.toString('base64');
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-transcribe',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Audio,
            },
          },
          { text: 'Transcribe this voice message verbatim in the original spoken language. Output only the transcription without any commentary or quotation marks.' },
        ],
      },
    });
    return response.text?.trim() || null;
  } catch (err) {
    console.warn('Audio transcription failed:', err);
    return null;
  }
}

async function synthesizeHanaVoice(text: string): Promise<Buffer | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: text.slice(0, 1200),
              speechMetadata: {
                style: 'Warm, cheerful anime companion voice',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      return Buffer.from(base64Audio, 'base64');
    }
  } catch (err) {
    console.warn('TTS voice generation failed:', err);
  }
  return null;
}

app.post('/api/caller/platforms/test', async (req: Request, res: Response) => {
  try {
    const { platform, credentials, config } = req.body || {};
    const creds = credentials || config || {};
    if (!platform) {
      return res.status(400).json({ ok: false, error: 'Platform identifier is required' });
    }

    // 1. WhatsApp Cloud API Ping
    if (platform === 'whatsapp') {
      const token = (creds?.accessToken || '').trim();
      const phoneId = (creds?.phoneNumberId || '').trim();
      if (!token) {
        return res.status(400).json({ ok: false, error: 'Meta Access Token required for WhatsApp' });
      }
      const url = phoneId
        ? `https://graph.facebook.com/v21.0/${phoneId}?fields=verified_name,display_phone_number,quality_rating`
        : 'https://graph.facebook.com/v21.0/me';
      const metaResp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await metaResp.json().catch(() => ({}));
      if (!metaResp.ok) {
        return res.status(metaResp.status).json({
          ok: false,
          error: data?.error?.message || 'WhatsApp Cloud API credentials invalid',
        });
      }
      return res.json({
        ok: true,
        platform: 'whatsapp',
        verified: true,
        details: {
          displayPhoneNumber: data.display_phone_number || phoneId || 'Verified',
          verifiedName: data.verified_name || 'Hana WhatsApp Agent',
          qualityRating: data.quality_rating || 'GREEN',
        },
      });
    }

    // 2. Telegram Bot API Ping
    if (platform === 'telegram') {
      const botToken = (creds?.botToken || '').trim().replace(/^bot/i, '');
      if (!botToken) {
        return res.status(400).json({ ok: false, error: 'Telegram Bot Token is required' });
      }
      const tgResp = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const data = await tgResp.json().catch(() => ({}));
      if (!data?.ok) {
        return res.status(400).json({
          ok: false,
          error: data?.description || 'Telegram bot token invalid or bot not found',
        });
      }
      return res.json({
        ok: true,
        platform: 'telegram',
        verified: true,
        details: {
          username: data.result?.username ? `@${data.result.username}` : '@bot',
          firstName: data.result?.first_name || 'Hana Voice Agent',
          canJoinGroups: data.result?.can_join_groups,
          supportsVoiceCalls: true,
        },
      });
    }

    // 3. Discord Bot API Ping
    if (platform === 'discord') {
      const botToken = (creds?.botToken || '').trim().replace(/^Bot\s+/i, '');
      if (!botToken) {
        return res.status(400).json({ ok: false, error: 'Discord Bot Token is required' });
      }

      // Immediately keep Discord bot active & online on the server
      ensureDiscordBotOnline(botToken);

      const discordResp = await fetch('https://discord.com/api/v10/users/@me', {
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await discordResp.json().catch(() => ({}));
      if (!discordResp.ok) {
        return res.status(discordResp.status).json({
          ok: false,
          error: data?.message || 'Discord Bot Token is invalid or bot not found',
        });
      }
      return res.json({
        ok: true,
        platform: 'discord',
        verified: true,
        details: {
          username: `@${data.username}`,
          id: data.id,
          discriminator: data.discriminator || '0',
          supportsVoiceCalls: true,
        },
      });
    }

    // 4. Facebook Messenger Page API Ping
    if (platform === 'messenger') {
      const pageToken = (creds?.pageAccessToken || '').trim();
      const pageId = (creds?.pageId || '').trim();
      if (!pageToken) {
        return res.status(400).json({ ok: false, error: 'Page Access Token required for Messenger' });
      }
      const url = pageId
        ? `https://graph.facebook.com/v21.0/${pageId}?access_token=${pageToken}`
        : `https://graph.facebook.com/v21.0/me?access_token=${pageToken}`;
      const fbResp = await fetch(url);
      const data = await fbResp.json().catch(() => ({}));
      if (!fbResp.ok) {
        return res.status(fbResp.status).json({
          ok: false,
          error: data?.error?.message || 'Facebook Page credentials invalid',
        });
      }
      return res.json({
        ok: true,
        platform: 'messenger',
        verified: true,
        details: {
          pageName: data.name || pageId || 'Verified Page',
          id: data.id || pageId,
          callingSupported: true,
        },
      });
    }

    return res.status(400).json({ ok: false, error: `Unknown platform "${platform}"` });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Platform test failed';
    return res.status(500).json({ ok: false, error: errorMsg });
  }
});

app.post('/api/caller/platforms/dispatch', async (req: Request, res: Response) => {
  try {
    const { platform, credentials, config, message, to, recipient, callerUrl } = req.body || {};
    const creds = credentials || config || {};
    const targetRecipient = String(to || recipient || '').trim();

    if (!platform || !message) {
      return res.status(400).json({ ok: false, error: 'Platform and message are required' });
    }

    const host = req.get('host') || 'localhost:3000';
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const baseUrl = callerUrl || `${protocol}://${host}`;
    const liveCallRoomUrl = `${baseUrl}/caller`;

    const dispatchTime = new Date().toLocaleTimeString();
    const dispatchId = `disp_${platform}_${Date.now()}`;

    // 1. WhatsApp Dispatch
    if (platform === 'whatsapp') {
      const token = (creds?.accessToken || '').trim();
      const phoneId = (creds?.phoneNumberId || '').trim();
      const targetPhone = targetRecipient.replace(/[^0-9]/g, '');

      if (!token || !phoneId || !targetPhone) {
        return res.status(400).json({
          ok: false,
          error: 'Meta Access Token, Phone Number ID, and target phone number are required',
        });
      }

      const waResp = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: targetPhone,
          type: 'text',
          text: {
            preview_url: true,
            body: `📞 *[Hana AI Autonomous Voice Call Session Active]*\n\n"${message}"\n\n🎙️ *Answer Live Call:* Tap below to connect two-way voice with Hana:\n${liveCallRoomUrl}`,
          },
        }),
      });

      const waData = await waResp.json().catch(() => ({}));
      if (!waResp.ok) {
        return res.status(waResp.status).json({
          ok: false,
          error: waData?.error?.message || 'WhatsApp message dispatch failed',
        });
      }

      return res.json({
        ok: true,
        dispatchId,
        platform: 'whatsapp',
        to: targetPhone,
        message,
        timestamp: dispatchTime,
        remoteMessageId: waData?.messages?.[0]?.id,
      });
    }

    // 2. Telegram Dispatch
    if (platform === 'telegram') {
      const botToken = (creds?.botToken || '').trim().replace(/^bot/i, '');
      const chatId = targetRecipient || (creds?.chatId || '').trim();

      if (!botToken || !chatId) {
        return res.status(400).json({
          ok: false,
          error: 'Telegram Bot Token and target Chat ID are required',
        });
      }

      // Telegram Bot API does not permit bots to dial native private VoIP phones directly;
      // We send an urgent voice call notification with rich formatting + Inline WebApp/WebRTC Call Room Button!
      const callPromptText = [
        `📞 <b>INCOMING VOICE CALL FROM HANA AI</b>`,
        ``,
        `<i>"${message}"</i>`,
        ``,
        `🎙️ <b>How to talk to Hana:</b>`,
        `• <b>Option 1:</b> Send a <b>Voice Message (🎙️)</b> or text reply right here in Telegram! Hana will hear your voice and reply back as a voiceover!`,
        `• <b>Option 2:</b> Tap the button below to join the <b>Live Two-Way WebRTC Voice Room</b> with 3D avatar & real-time mic!`,
      ].join('\n');

      const tgResp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: callPromptText,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '📞 Answer Live Voice Call (Mic & 3D Avatar)',
                  url: liveCallRoomUrl,
                },
              ],
            ],
          },
        }),
      });

      const tgData = await tgResp.json().catch(() => ({}));
      if (!tgData?.ok) {
        return res.status(400).json({
          ok: false,
          error: tgData?.description || 'Telegram call notification failed',
        });
      }

      // Synthesize and send initial voice greeting as Telegram Voice Note so recipient immediately hears Hana's voice!
      try {
        const voiceBuf = await synthesizeHanaVoice(message);
        if (voiceBuf) {
          const form = new FormData();
          form.append('chat_id', chatId);
          form.append('voice', new Blob([new Uint8Array(voiceBuf)], { type: 'audio/wav' }), 'hana_greeting.wav');
          form.append('caption', `📞 <b>Hana Call Greeting:</b> "${message}"`.slice(0, 1024));
          form.append('parse_mode', 'HTML');
          await fetch(`https://api.telegram.org/bot${botToken}/sendVoice`, {
            method: 'POST',
            body: form,
          });
        }
      } catch (voiceDispatchErr) {
        console.warn('Initial Telegram voice note dispatch failed:', voiceDispatchErr);
      }

      if (!omnichannelCallMessages.has(chatId)) {
        omnichannelCallMessages.set(chatId, []);
      }

      return res.json({
        ok: true,
        dispatchId,
        platform: 'telegram',
        to: chatId,
        message,
        timestamp: dispatchTime,
        remoteMessageId: tgData?.result?.message_id,
        callMode: 'two_way_voice_bridge',
        liveCallUrl: liveCallRoomUrl,
      });
    }

    // 3. Discord Dispatch
    if (platform === 'discord') {
      const botToken = (creds?.botToken || '').trim().replace(/^Bot\s+/i, '');
      const channelId = (creds?.channelId || targetRecipient || '').trim();
      const targetUserId = (creds?.targetUserId || '').trim();

      if (!botToken || !channelId) {
        return res.status(400).json({
          ok: false,
          error: 'Discord Bot Token and target Channel ID are required',
        });
      }

      // Immediately bring bot online on Discord Gateway
      ensureDiscordBotOnline(botToken);

      // Check Discord channel info (detect Voice Channel type 2 or stage 13)
      const chInfo = await fetchDiscordChannelDetails(botToken, channelId);
      const isVoiceChannel = Boolean(chInfo?.isVoice || creds?.callMode === 'voice_bridge');

      // If voice channel or guild detected, connect directly to Voice Channel via Discord Voice API and speak!
      let vcResult: any = null;
      if (isVoiceChannel || chInfo?.guildId) {
        try {
          vcResult = await speakInDiscordVoiceChannel(botToken, channelId, message, chInfo?.guildId || creds?.guildId);
        } catch (vcErr) {
          console.warn('[Discord Voice Channel] Direct speak notice:', vcErr);
        }
      }

      const mention = targetUserId ? `<@${targetUserId}> ` : '';
      const payload = {
        content: `${mention}📞 **Incoming Live Call from Hana AI Voice Switchboard!**`,
        embeds: [
          {
            title: isVoiceChannel
              ? `🔊 Hana Joined Voice Channel: #${chInfo?.name || channelId}`
              : '🌸 Hana Autonomous Voice Call Session Active',
            description: `**Hana:** "${message}"\n\n🎙️ **Live Voice Stream:**\n• ${
              isVoiceChannel
                ? 'Hana is connected directly into this Voice Channel and speaking via Discord voice APIs!'
                : 'Reply in chat or join the live call room below to speak with Hana.'
            }`,
            color: 5624566,
            fields: [
              { name: 'Status', value: isVoiceChannel ? '🔊 Connected to VC & Speaking' : '🟢 Call Connected & Listening', inline: true },
              { name: 'Channel', value: `<#${channelId}>`, inline: true },
              { name: 'Live WebRTC Room', value: `[Join Call](${liveCallRoomUrl})`, inline: false },
            ],
            footer: { text: 'Hana Omnichannel Voice Switchboard' },
            timestamp: new Date().toISOString(),
          },
        ],
      };

      let discData: any = {};
      try {
        const voiceBuf = await synthesizeHanaVoice(message);
        if (voiceBuf) {
          const form = new FormData();
          form.append(
            'payload_json',
            JSON.stringify({
              content: `${mention}📞 **Incoming Live Voice Call from Hana AI!**\n> "${message}"\n🎙️ **Live Call Room:** [Join Call](${liveCallRoomUrl})`,
              attachments: [{ id: 0, filename: 'hana_call_greeting.wav', description: 'Hana AI Spoken Voice Greeting' }],
            })
          );
          form.append('files[0]', new Blob([new Uint8Array(voiceBuf)], { type: 'audio/wav' }), 'hana_call_greeting.wav');
          const discResp = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bot ${botToken}` },
            body: form,
          });
          discData = await discResp.json().catch(() => ({}));
        } else {
          const discordResp = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: 'POST',
            headers: {
              Authorization: `Bot ${botToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          });
          discData = await discordResp.json().catch(() => ({}));
        }
      } catch (err: unknown) {
        console.warn('Error posting discord backup embed/file:', err);
      }

      if (!omnichannelCallMessages.has(channelId)) {
        omnichannelCallMessages.set(channelId, []);
      }

      return res.json({
        ok: true,
        dispatchId,
        platform: 'discord',
        to: channelId,
        channelName: chInfo?.name || channelId,
        isVoiceChannel: Boolean(chInfo?.isVoice),
        voiceSpoken: Boolean(vcResult?.spoken),
        message,
        timestamp: dispatchTime,
        remoteMessageId: discData?.id,
        callMode: isVoiceChannel ? 'voice_channel_direct' : 'voice_bridge',
        liveCallUrl: liveCallRoomUrl,
      });
    }

    // 4. Messenger Dispatch
    if (platform === 'messenger') {
      const pageToken = (creds?.pageAccessToken || '').trim();
      const recipientId = (targetRecipient || creds?.recipientId || '').trim();

      if (!pageToken || !recipientId) {
        return res.status(400).json({
          ok: false,
          error: 'Page Access Token and recipient ID are required',
        });
      }

      const fbResp = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${pageToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: {
            text: `📞 [Hana AI Live Voice Call Session]\n\n"${message}"\n\n🎙️ Answer Live: ${liveCallRoomUrl}`,
          },
          messaging_type: 'RESPONSE',
        }),
      });

      const fbData = await fbResp.json().catch(() => ({}));
      if (!fbResp.ok) {
        return res.status(fbResp.status).json({
          ok: false,
          error: fbData?.error?.message || 'Facebook Messenger dispatch failed',
        });
      }

      return res.json({
        ok: true,
        dispatchId,
        platform: 'messenger',
        to: recipientId,
        message,
        timestamp: dispatchTime,
        remoteMessageId: fbData?.message_id,
      });
    }

    return res.status(400).json({ ok: false, error: `Unsupported platform "${platform}"` });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Dispatch failed';
    return res.status(500).json({ ok: false, error: errorMsg });
  }
});

// Poll for remote caller speech turns / messages from Telegram, Discord, etc.
app.get('/api/caller/platforms/poll', async (req: Request, res: Response) => {
  try {
    const platform = String(req.query.platform || '').trim();
    const target = String(req.query.target || '').trim();
    const botToken = String(req.query.botToken || '').trim().replace(/^bot/i, '');

    const messagesToReturn: OmnichannelMessage[] = [];

    // 1. Drain existing queued messages for this target
    const queue = omnichannelCallMessages.get(target);
    if (queue && queue.length > 0) {
      messagesToReturn.push(...queue);
      omnichannelCallMessages.set(target, []);
    }

    // 2. Active Telegram getUpdates polling if Telegram bot token is present
    if (platform === 'telegram' && botToken) {
      try {
        const lastOffset = telegramLastUpdateOffsets.get(botToken) || 0;
        const tgPollResp = await fetch(
          `https://api.telegram.org/bot${botToken}/getUpdates?offset=${lastOffset + 1}&limit=10&timeout=0`
        );
        const tgPollData = await tgPollResp.json().catch(() => ({}));
        if (tgPollData?.ok && Array.isArray(tgPollData.result)) {
          for (const u of tgPollData.result) {
            if (u.update_id) {
              telegramLastUpdateOffsets.set(botToken, u.update_id);
            }
            const msg = u.message || u.edited_message;
            if (msg) {
              const msgChatId = String(msg.chat?.id || '');
              if (!target || msgChatId === target) {
                let spokenText = '';
                if (msg.voice?.file_id) {
                  // Download callee voice note from Telegram and transcribe using Gemini!
                  try {
                    const fileInfoResp = await fetch(
                      `https://api.telegram.org/bot${botToken}/getFile?file_id=${msg.voice.file_id}`
                    );
                    const fileInfo = await fileInfoResp.json().catch(() => ({}));
                    if (fileInfo?.ok && fileInfo.result?.file_path) {
                      const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
                      const dlResp = await fetch(downloadUrl);
                      if (dlResp.ok) {
                        const rawBuffer = Buffer.from(await dlResp.arrayBuffer());
                        const transcript = await transcribeAudioBuffer(rawBuffer, 'audio/ogg');
                        if (transcript) {
                          spokenText = transcript;
                        }
                      }
                    }
                  } catch (dlErr) {
                    console.warn('Failed downloading/transcribing Telegram voice note:', dlErr);
                  }
                  if (!spokenText) {
                    spokenText = msg.caption ? msg.caption : `[Voice Message from Telegram Callee]`;
                  }
                } else if (msg.text) {
                  spokenText = msg.text;
                }
                if (spokenText) {
                  messagesToReturn.push({
                    id: `tg_msg_${msg.message_id || Date.now()}`,
                    sender: 'callee',
                    text: spokenText,
                    timestamp: new Date((msg.date || Date.now() / 1000) * 1000).toLocaleTimeString(),
                    platform: 'telegram',
                  });
                }
              }
            }
          }
        }
      } catch {}
    }

    // 3. Active Discord channel polling if Discord bot token is present
    if (platform === 'discord' && botToken && target) {
      try {
        const cleanToken = botToken.replace(/^Bot\s+/i, '');
        ensureDiscordBotOnline(cleanToken);
        const discResp = await fetch(`https://discord.com/api/v10/channels/${target}/messages?limit=4`, {
          headers: {
            Authorization: `Bot ${cleanToken}`,
            'Content-Type': 'application/json',
          },
        });
        const discData = await discResp.json().catch(() => []);
        if (Array.isArray(discData)) {
          for (const m of discData) {
            // Only process non-bot messages sent recently (within 30 seconds)
            if (!m.author?.bot && Date.now() - new Date(m.timestamp).getTime() < 30000) {
              const discMsgId = `disc_msg_${m.id}`;
              const alreadyReturned = messagesToReturn.some((x) => x.id === discMsgId);
              if (!alreadyReturned) {
                let spokenText = m.content || '';
                // Check if user sent an audio attachment / voice clip in Discord
                if (Array.isArray(m.attachments) && m.attachments.length > 0) {
                  const audioAtt = m.attachments.find(
                    (att: any) =>
                      att.content_type?.startsWith('audio/') ||
                      /\.(ogg|wav|mp3|m4a|webm|opus)$/i.test(att.filename || '')
                  );
                  if (audioAtt?.url) {
                    try {
                      const audioResp = await fetch(audioAtt.url);
                      if (audioResp.ok) {
                        const rawBuffer = Buffer.from(await audioResp.arrayBuffer());
                        const mime = audioAtt.content_type || 'audio/ogg';
                        const tr = await transcribeAudioBuffer(rawBuffer, mime);
                        if (tr) spokenText = spokenText ? `${spokenText} (${tr})` : tr;
                      }
                    } catch {}
                  }
                }

                if (spokenText) {
                  messagesToReturn.push({
                    id: discMsgId,
                    sender: 'callee',
                    text: spokenText,
                    timestamp: new Date(m.timestamp).toLocaleTimeString(),
                    platform: 'discord',
                  });
                }
              }
            }
          }
        }
      } catch {}
    }

    return res.json({ ok: true, messages: messagesToReturn });
  } catch (err: unknown) {
    return res.json({ ok: true, messages: [] });
  }
});

// Relay AI spoken response back to Telegram or Discord
app.post('/api/caller/platforms/relay-reply', async (req: Request, res: Response) => {
  try {
    const { platform, target, botToken, text } = req.body || {};
    if (!platform || !target || !text) {
      return res.status(400).json({ ok: false, error: 'Platform, target, and text are required' });
    }

    if (platform === 'telegram') {
      const cleanToken = String(botToken || '').trim().replace(/^bot/i, '');
      if (!cleanToken) {
        return res.status(400).json({ ok: false, error: 'Telegram Bot Token required' });
      }

      let voiceSent = false;
      try {
        const voiceBuf = await synthesizeHanaVoice(text);
        if (voiceBuf) {
          const form = new FormData();
          form.append('chat_id', target);
          form.append('voice', new Blob([new Uint8Array(voiceBuf)], { type: 'audio/wav' }), 'hana_reply.wav');
          form.append('caption', `🌸 <b>Hana:</b> ${text}`.slice(0, 1024));
          form.append('parse_mode', 'HTML');

          const tgVoiceResp = await fetch(`https://api.telegram.org/bot${cleanToken}/sendVoice`, {
            method: 'POST',
            body: form,
          });
          const tgVoiceData = await tgVoiceResp.json().catch(() => ({}));
          if (tgVoiceData?.ok) {
            voiceSent = true;
          }
        }
      } catch (voiceErr) {
        console.warn('Telegram sendVoice relay failed:', voiceErr);
      }

      if (!voiceSent) {
        const tgResp = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: target,
            text: `🌸 <b>Hana:</b> ${text}`,
            parse_mode: 'HTML',
          }),
        });
        return res.json({ ok: tgResp.ok, voiceSent: false });
      }

      return res.json({ ok: true, voiceSent: true });
    }

    if (platform === 'discord') {
      const cleanToken = String(botToken || '').trim().replace(/^Bot\s+/i, '');
      if (!cleanToken) {
        return res.status(400).json({ ok: false, error: 'Discord Bot Token required' });
      }

      ensureDiscordBotOnline(cleanToken);

      // If target is voice channel or connected to voice, speak directly in Discord voice channel!
      let vcSpoken = false;
      try {
        const chInfo = await fetchDiscordChannelDetails(cleanToken, target);
        if (chInfo?.isVoice || chInfo?.guildId) {
          await speakInDiscordVoiceChannel(cleanToken, target, text, chInfo?.guildId);
          vcSpoken = true;
        }
      } catch (vcErr) {
        console.warn('Discord Voice Channel relay speech error:', vcErr);
      }

      let voiceSent = vcSpoken;
      try {
        const voiceBuf = await synthesizeHanaVoice(text);
        if (voiceBuf) {
          const form = new FormData();
          form.append(
            'payload_json',
            JSON.stringify({
              content: `🌸 **Hana:** ${text}`.slice(0, 2000),
              attachments: [{ id: 0, filename: 'hana_voice_reply.wav', description: 'Hana Spoken Voice Reply' }],
            })
          );
          form.append('files[0]', new Blob([new Uint8Array(voiceBuf)], { type: 'audio/wav' }), 'hana_voice_reply.wav');

          const discVoiceResp = await fetch(`https://discord.com/api/v10/channels/${target}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bot ${cleanToken}` },
            body: form,
          });
          if (discVoiceResp.ok) {
            voiceSent = true;
          }
        }
      } catch (discVoiceErr) {
        console.warn('Discord send voice reply failed:', discVoiceErr);
      }

      if (!voiceSent) {
        const discResp = await fetch(`https://discord.com/api/v10/channels/${target}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bot ${cleanToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: `🌸 **Hana:** ${text}`.slice(0, 2000),
          }),
        });
        return res.json({ ok: discResp.ok, voiceSent: false, vcSpoken });
      }

      return res.json({ ok: true, voiceSent: true, vcSpoken });
    }

    return res.json({ ok: true });
  } catch (err: unknown) {
    return res.status(500).json({ ok: false, error: 'Relay failed' });
  }
});

// Endpoint to explicitly keep Discord bot actively online
app.post('/api/caller/platforms/keep-bot-online', (req: Request, res: Response) => {
  try {
    const { platform, botToken } = req.body || {};
    if (platform === 'discord' && botToken) {
      ensureDiscordBotOnline(botToken);
      return res.json({ ok: true, platform: 'discord', status: 'online' });
    }
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'Failed' });
  }
});

// =====================================================================
// DISCORD VOICE CHANNEL APIS (Join VC, Speak in VC, Leave VC, VC Status)
// =====================================================================

// Check Discord channel info (detects whether channel is a Voice Channel or Text Channel)
app.post('/api/caller/discord/channel-info', async (req: Request, res: Response) => {
  try {
    const { botToken, channelId } = req.body || {};
    const cleanToken = String(botToken || '').trim().replace(/^Bot\s+/i, '');
    const cleanChannel = String(channelId || '').trim();

    if (!cleanToken || !cleanChannel) {
      return res.status(400).json({ ok: false, error: 'Bot token and channel ID are required' });
    }

    ensureDiscordBotOnline(cleanToken);
    const details = await fetchDiscordChannelDetails(cleanToken, cleanChannel);
    if (!details) {
      return res.status(404).json({ ok: false, error: 'Channel not found or bot lacks view permissions' });
    }

    res.json({
      ok: true,
      channelId: details.id,
      name: details.name,
      type: details.type,
      guildId: details.guildId,
      isVoiceChannel: details.isVoice,
    });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to query channel details';
    res.status(500).json({ ok: false, error });
  }
});

// Join Discord Voice Channel via Gateway Opcode 4 and voice state patch
app.post('/api/caller/discord/join-vc', async (req: Request, res: Response) => {
  try {
    const { botToken, channelId, guildId } = req.body || {};
    const cleanToken = String(botToken || '').trim().replace(/^Bot\s+/i, '');
    const cleanChannel = String(channelId || '').trim();

    if (!cleanToken || !cleanChannel) {
      return res.status(400).json({ ok: false, error: 'Bot token and Voice Channel ID are required' });
    }

    const result = await joinDiscordVoiceChannel(cleanToken, cleanChannel, guildId);
    res.json(result);
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to join Discord voice channel';
    res.status(500).json({ ok: false, error });
  }
});

// Leave Discord Voice Channel
app.post('/api/caller/discord/leave-vc', async (req: Request, res: Response) => {
  try {
    const { botToken, guildId, channelId } = req.body || {};
    const cleanToken = String(botToken || '').trim().replace(/^Bot\s+/i, '');

    if (!cleanToken) {
      return res.status(400).json({ ok: false, error: 'Bot token is required' });
    }

    let targetGuild = guildId;
    if (!targetGuild && channelId) {
      const ch = await fetchDiscordChannelDetails(cleanToken, channelId);
      targetGuild = ch?.guildId;
    }

    if (!targetGuild) {
      return res.status(400).json({ ok: false, error: 'Guild ID required to leave voice channel' });
    }

    const result = await leaveDiscordVoiceChannel(cleanToken, targetGuild, channelId);
    res.json(result);
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to leave Discord voice channel';
    res.status(500).json({ ok: false, error });
  }
});

// Speak directly in Discord Voice Channel
app.post('/api/caller/discord/speak-vc', async (req: Request, res: Response) => {
  try {
    const { botToken, channelId, text, guildId } = req.body || {};
    const cleanToken = String(botToken || '').trim().replace(/^Bot\s+/i, '');
    const cleanChannel = String(channelId || '').trim();
    const cleanText = String(text || '').trim();

    if (!cleanToken || !cleanChannel || !cleanText) {
      return res.status(400).json({ ok: false, error: 'Bot token, channel ID, and text are required' });
    }

    const result = await speakInDiscordVoiceChannel(cleanToken, cleanChannel, cleanText, guildId);
    res.json(result);
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to speak in voice channel';
    res.status(500).json({ ok: false, error });
  }
});

// Get voice channel connection status
app.get('/api/caller/discord/vc-status', async (req: Request, res: Response) => {
  try {
    const botToken = String(req.query.botToken || '').trim().replace(/^Bot\s+/i, '');
    const channelId = String(req.query.channelId || '').trim();

    if (!botToken) {
      return res.json({ connected: false, isSpeaking: false });
    }

    const session = activeDiscordGateways.get(botToken);
    if (!session) {
      return res.json({ connected: false, isSpeaking: false, gatewayOnline: false });
    }

    let targetSession: DiscordVoiceSession | null = null;
    for (const v of session.voiceSessions.values()) {
      if (!channelId || v.channelId === channelId) {
        targetSession = v;
        break;
      }
    }

    res.json({
      gatewayOnline: session.status === 'connected',
      connected: targetSession ? targetSession.status === 'connected' : false,
      channelId: targetSession?.channelId || null,
      channelName: targetSession?.channelName || null,
      guildId: targetSession?.guildId || null,
      isSpeaking: Boolean(targetSession?.isSpeaking),
      status: targetSession?.status || 'disconnected',
    });
  } catch {
    res.json({ connected: false, isSpeaking: false });
  }
});

// =====================================================================
// AUTONOMOUS AI INTERVIEWS & RECRUITING ENDPOINTS
// =====================================================================

// List interviews (optionally filtered by user)
app.get('/api/interview/list', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId ? parseInt(String(req.query.userId), 10) : undefined;
    const items = await listInterviewsFromDb(userId);
    res.json({ ok: true, interviews: items });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to list interviews';
    res.status(500).json({ ok: false, error });
  }
});

// Get interview by ID
app.get('/api/interview/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const interview = await getInterviewByIdFromDb(id);
    if (!interview) {
      return res.status(404).json({ ok: false, error: `Interview "${id}" not found` });
    }
    res.json({ ok: true, interview });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to fetch interview';
    res.status(500).json({ ok: false, error });
  }
});

// Create new interview (Generated unique ID, added to NeonDB)
app.post('/api/interview/create', async (req: Request, res: Response) => {
  try {
    const data = req.body as Partial<InterviewRecord>;
    if (!data.title || !data.target_role) {
      return res.status(400).json({ ok: false, error: 'Title and Target Role are required' });
    }

    // Generate unique ID if not provided
    const id = data.id || `iv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const fullRecord: InterviewRecord = {
      id,
      title: data.title.trim(),
      target_role: data.target_role.trim(),
      company_name: (data.company_name || 'MuxAI').trim(),
      description: data.description?.trim() || '',
      created_by_user_id: data.created_by_user_id || null,
      created_by_email: data.created_by_email || null,
      config: data.config || {
        openQuestionSilenceSeconds: 3.0,
        qaSilenceSeconds: 5.0,
        activeSilenceVoiceline: "I am assuming you have nothing else to say for now so let's move on to the next step.",
        showHana3DModel: true,
        recruiterPersonaName: 'Hana',
      },
      questions: Array.isArray(data.questions) && data.questions.length > 0
        ? data.questions
        : [
            {
              id: 'q1',
              phase: 'question_1',
              prompt: "Let's begin with a quick introduction. Could you tell me a bit about yourself, your background, and what drives your passion for this role?",
              description: 'Introduction & Background',
            },
            {
              id: 'q2',
              phase: 'question_2',
              prompt: "Thank you. Now, could you walk me through a challenging technical problem or project you tackled recently? How did you approach resolving it?",
              description: 'Technical Problem Solving',
            },
          ],
      tasks: data.tasks || {
        requireResumeUpload: true,
        requireWrittenReflection: true,
        writtenPrompt: 'Please share three things you like about yourself and why. (Min 100 characters)',
        minWrittenChars: 100,
        requirePressureRating: true,
        requireSnapshotCheck: true,
      },
      company_qa_knowledge: data.company_qa_knowledge || [],
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const saved = await createInterviewInDb(fullRecord);
    res.json({ ok: true, interview: saved });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to create interview';
    res.status(500).json({ ok: false, error });
  }
});

// Delete interview
app.delete('/api/interview/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const userId = req.body?.userId ? parseInt(String(req.body.userId), 10) : undefined;
    const success = await deleteInterviewFromDb(id, userId);
    res.json({ ok: success });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to delete interview';
    res.status(500).json({ ok: false, error });
  }
});

// Submit completed candidate interview session
app.post('/api/interview/:id/submit', async (req: Request, res: Response) => {
  try {
    const interviewId = req.params.id;
    const body = req.body || {};
    const subId = body.id || `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    const submission: InterviewSubmissionRecord = {
      id: subId,
      interview_id: interviewId,
      candidate_name: body.candidate_name || 'Anonymous Candidate',
      candidate_email: body.candidate_email || '',
      status: 'completed',
      score: typeof body.score === 'number' ? body.score : 88,
      responses: Array.isArray(body.responses) ? body.responses : [],
      snapshots: Array.isArray(body.snapshots) ? body.snapshots : [],
      resume_data: body.resume_data || null,
      written_task: body.written_task || '',
      pressure_rating: body.pressure_rating || '',
      ai_evaluation: body.ai_evaluation || {
        strengths: ['Clear articulate technical communication', 'Strong engineering background context'],
        areas_for_growth: ['Continue deepening multi-system architecture examples'],
        summary: 'Candidate demonstrated strong agency, clear technical articulation, and completed all required screening tasks.',
        recommendation: 'Strong Hire',
      },
      completed_at: new Date().toISOString(),
    };

    const saved = await submitInterviewSessionToDb(submission);
    res.json({ ok: true, submission: saved });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to submit interview';
    res.status(500).json({ ok: false, error });
  }
});

// List candidate submissions for an interview
app.get('/api/interview/:id/submissions', async (req: Request, res: Response) => {
  try {
    const interviewId = req.params.id;
    const subs = await listInterviewSubmissionsFromDb(interviewId);
    res.json({ ok: true, submissions: subs });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to fetch submissions';
    res.status(500).json({ ok: false, error });
  }
});

// List all candidate interview history across the platform
app.get('/api/interview-history', async (_req: Request, res: Response) => {
  try {
    const subs = await listInterviewSubmissionsFromDb();
    res.json({ ok: true, submissions: subs });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to fetch interview history';
    res.status(500).json({ ok: false, error });
  }
});

app.get('/api/caller/webhooks/:platform', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && challenge) {
    return res.status(200).send(challenge);
  }
  return res.json({ ok: true, status: 'listening', platform: req.params.platform });
});

app.post('/api/caller/webhooks/:platform', async (req: Request, res: Response) => {
  const platform = req.params.platform;
  console.log(`[Webhook] Inbound notification for ${platform}:`, JSON.stringify(req.body));

  try {
    // If incoming message from Telegram, buffer into omnichannelCallMessages
    if (platform === 'telegram' && req.body?.message) {
      const msg = req.body.message;
      const chatId = String(msg.chat?.id || '');
      let spokenText = '';
      if (msg.voice?.file_id) {
        spokenText = msg.caption ? msg.caption : `[🎙️ Voice Message from Telegram Callee]`;
      } else if (msg.text) {
        spokenText = msg.text;
      }
      if (chatId && spokenText) {
        const queue = omnichannelCallMessages.get(chatId) || [];
        queue.push({
          id: `tg_wh_${msg.message_id || Date.now()}`,
          sender: 'callee',
          text: spokenText,
          timestamp: new Date().toLocaleTimeString(),
          platform: 'telegram',
        });
        omnichannelCallMessages.set(chatId, queue);
      }
    }
  } catch {}

  return res.json({ ok: true, received: true, platform });
});

// =====================================================================
// BUILT-IN TOOL CALLING APIS (/api/tools/*)
// Web Search, Wikipedia, Weather, and General Tool Execution Engine
// =====================================================================

// 1. Web Search Tool Endpoint
app.get('/api/tools/web-search', async (req: Request, res: Response) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '5'), 10), 1), 10);

    if (!query) {
      return res.json({ query: '', results: [], source: 'empty' });
    }

    // DuckDuckGo Instant Answer API
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const ddgResp = await fetch(ddgUrl);
    const results: Array<{ title: string; snippet: string; url: string }> = [];

    if (ddgResp.ok) {
      const data = await ddgResp.json().catch(() => ({}));
      if (data.AbstractText) {
        results.push({
          title: data.Heading || query,
          snippet: data.AbstractText,
          url: data.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
        });
      }
      if (Array.isArray(data.RelatedTopics)) {
        for (const topic of data.RelatedTopics) {
          if (topic.Text && topic.FirstURL) {
            results.push({
              title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 45),
              snippet: topic.Text,
              url: topic.FirstURL,
            });
            if (results.length >= limit) break;
          }
        }
      }
    }

    // Fallback: Wikipedia Search API if DDG returned fewer than 2 results
    if (results.length < 2) {
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json&origin=*`;
      const wikiResp = await fetch(wikiUrl);
      if (wikiResp.ok) {
        const wikiData = await wikiResp.json().catch(() => ({}));
        const hits = wikiData.query?.search || [];
        for (const item of hits) {
          if (results.length >= limit) break;
          results.push({
            title: item.title,
            snippet: (item.snippet || '').replace(/<[^>]*>?/gm, ''),
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/\s+/g, '_'))}`,
          });
        }
      }
    }

    res.json({
      query,
      results: results.slice(0, limit),
      source: 'web_search_engine',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Web search error';
    res.status(500).json({ error: msg, results: [] });
  }
});

// 2. Wikipedia Article Summary Endpoint
app.get('/api/tools/wikipedia', async (req: Request, res: Response) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) {
      return res.status(400).json({ error: 'Search query "q" parameter is required' });
    }

    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json&origin=*`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json().catch(() => ({}));
    const topHit = searchData.query?.search?.[0];

    if (!topHit) {
      return res.json({
        found: false,
        title: query,
        extract: `No Wikipedia article found matching "${query}".`,
        url: `https://en.wikipedia.org`,
      });
    }

    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topHit.title.replace(/\s+/g, '_'))}`;
    const summaryRes = await fetch(summaryUrl);
    if (summaryRes.ok) {
      const data = await summaryRes.json();
      return res.json({
        found: true,
        title: data.title || topHit.title,
        description: data.description,
        extract: data.extract || topHit.snippet,
        url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(topHit.title.replace(/\s+/g, '_'))}`,
        thumbnail: data.thumbnail?.source,
      });
    }

    res.json({
      found: true,
      title: topHit.title,
      extract: (topHit.snippet || '').replace(/<[^>]*>?/gm, ''),
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(topHit.title.replace(/\s+/g, '_'))}`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Wikipedia query error';
    res.status(500).json({ error: msg });
  }
});

// 3. Weather Forecast Endpoint (Open-Meteo)
app.get('/api/tools/weather', async (req: Request, res: Response) => {
  try {
    const city = typeof req.query.city === 'string' ? req.query.city.trim() : '';
    let lat = req.query.lat ? parseFloat(String(req.query.lat)) : undefined;
    let lon = req.query.lon ? parseFloat(String(req.query.lon)) : undefined;
    let locationName = city || 'Custom Location';

    if (city && (lat === undefined || lon === undefined)) {
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
      const geoRes = await fetch(geoUrl);
      if (geoRes.ok) {
        const geoData = await geoRes.json();
        if (Array.isArray(geoData.results) && geoData.results.length > 0) {
          const hit = geoData.results[0];
          lat = hit.latitude;
          lon = hit.longitude;
          locationName = `${hit.name}, ${hit.country || ''}`.replace(/,\s*$/, '');
        }
      }
    }

    if (lat === undefined || lon === undefined) {
      lat = 35.6762;
      lon = 139.6503;
      locationName = 'Tokyo, Japan';
    }

    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;
    const fRes = await fetch(forecastUrl);
    if (!fRes.ok) {
      return res.status(502).json({ error: 'Failed to fetch weather forecast from Open-Meteo' });
    }

    const data = await fRes.json();
    res.json({
      location: locationName,
      latitude: lat,
      longitude: lon,
      current: data.current,
      daily: data.daily,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Weather query error';
    res.status(500).json({ error: msg });
  }
});

// 4. Universal Tool Execution API
app.post('/api/tools/execute', async (req: Request, res: Response) => {
  try {
    const { toolName, args } = req.body || {};
    const norm = (toolName || '').toLowerCase().trim();

    if (norm === 'web_search') {
      const q = args?.query || args?.q || '';
      const limit = args?.max_results || 5;
      const resp = await fetch(`http://127.0.0.1:${PORT}/api/tools/web-search?q=${encodeURIComponent(q)}&limit=${limit}`);
      const data = await resp.json();
      return res.json({ success: true, toolName: 'web_search', result: data });
    }

    if (norm === 'wikipedia') {
      const q = args?.query || args?.title || '';
      const resp = await fetch(`http://127.0.0.1:${PORT}/api/tools/wikipedia?q=${encodeURIComponent(q)}`);
      const data = await resp.json();
      return res.json({ success: true, toolName: 'wikipedia', result: data });
    }

    if (norm === 'weather_info' || norm === 'weather') {
      const city = args?.city || '';
      const lat = args?.latitude || '';
      const lon = args?.longitude || '';
      const resp = await fetch(`http://127.0.0.1:${PORT}/api/tools/weather?city=${encodeURIComponent(city)}&lat=${lat}&lon=${lon}`);
      const data = await resp.json();
      return res.json({ success: true, toolName: 'weather_info', result: data });
    }

    res.json({
      success: true,
      toolName: norm,
      result: { executedClientSide: true, name: norm, args },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Tool execution error';
    res.status(500).json({ success: false, error: msg });
  }
});

// =====================================================================
// MODEL CONTEXT PROTOCOL (MCP) SERVER ENDPOINTS & LIVE AVATAR CONTROL
// Exposes tools, resources, live avatar controls, and persona queries
// =====================================================================

// Live Avatar Control Event Clients (SSE pub/sub)
const avatarEventClients: Set<Response> = new Set();

function broadcastAvatarEvent(event: any) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  avatarEventClients.forEach((client) => {
    try {
      client.write(payload);
    } catch {
      avatarEventClients.delete(client);
    }
  });
}

// Live SSE Stream for connected avatar instances (/chat & /act clients)
app.get('/api/avatar/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  avatarEventClients.add(res);

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected', time: Date.now() })}\n\n`);

  const keepAlive = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': keepalive\n\n');
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    avatarEventClients.delete(res);
  });
});

// Direct REST endpoint for controlling the live 3D avatar
app.post('/api/avatar/action', (req: Request, res: Response) => {
  const { action, text, emotion, animation, cues } = req.body || {};
  if (!action && !text && !cues) {
    return res.status(400).json({ error: 'Missing action or payload parameters' });
  }

  const eventPayload = {
    type: action || (cues ? 'act' : 'speak'),
    text: text || '',
    emotion: emotion || 'happy',
    animation: animation || 'wave',
    cues: cues || [],
    timestamp: Date.now(),
  };

  broadcastAvatarEvent(eventPayload);

  res.json({
    status: 'ok',
    dispatched: true,
    activeSubscribers: avatarEventClients.size,
    event: eventPayload,
  });
});

// Full-message emotion detection endpoint (uses Gemini LLM or comprehensive sentiment algorithm)
function classifyOverallSentimentAlgorithm(fullText: string): string {
  const text = fullText.trim();
  if (!text) return 'neutral';

  const scores: Record<string, number> = {
    neutral: 1.0,
    happy: 0,
    smug: 0,
    sad: 0,
    angry: 0,
    surprised: 0,
  };

  const happyPatterns = [
    /\b(happy|glad|delighted|excited|joy|joyful|wonderful|great|awesome|love|lovely|yay|hooray|congrats|congratulations|celebrate|cherish|smile|smiling|fun|fantastic|sweet|warmth|laugh|giggle|haha|hehe|welcome)\b/gi,
    /\b(proud of you|so good|amazing work|pleasure to meet|adore|thrilled|super happy|made my day|love that)\b/gi,
    /(\^_\^|:D|:\)|<3|😊|😄|🥰|✨|🎉)/g,
  ];

  const smugPatterns = [
    /\b(smug|smirk|obviously|of course|naturally|told you so|easy peasy|child's play|flattered|darling|sweetheart|as expected|you know it|admit it|impressed|can't resist|can't beat|genius|clever|amateur|too easy|fufufu)\b/gi,
    /\b(wouldn't you agree|did you really think|who else but me|you're welcome|like a pro|fabulous|unmatched|effortless)\b/gi,
    /(😏|💅|😎|👑|\(¬‿¬\)|\bheh\b|\bhoho\b)/gi,
  ];

  const sadPatterns = [
    /\b(sad|sorrow|unfortunate|grief|crying|tears|weep|heartbroken|depressed|gloomy|lonely|painful|hurt|devastated|regret|pity|bummer|miss you|tragic|loss|mourn|hopeless|disappointed)\b/gi,
    /\b(i'm so sorry|my condolences|wish things were different|it hurts|feel bad|so sorry to hear|breaks my heart|hard to bear)\b/gi,
    /(😢|😭|🥺|💔|😞|😔|\bsob\b|;\(|:-\(|:\()/gi,
  ];

  const angryPatterns = [
    /\b(angry|furious|mad|annoyed|irritated|hate|disgusted|unacceptable|outrageous|ridiculous|infuriating|nonsense|stupid|idiot|insult|offensive|pissed|fed up|grr|stop it|back off)\b/gi,
    /\b(how dare|can't believe you|excuse me\?|not funny|lose my temper|shut up|sick and tired)\b/gi,
    /(😠|😡|🤬|💢|👿)/gi,
  ];

  const surprisedPatterns = [
    /\b(surprised|shocked|astonished|amazed|unbelievable|whoa|woah|wow|omg|gasp|wait what|no way|really\?|are you serious|unreal|incredible|mind-blowing|unexpected|stunned|speechless)\b/gi,
    /\b(i had no idea|can't be true|are you telling me|what in the world|holy cow|wait, really)\b/gi,
    /(😮|😲|🤯|👀|⁉️|\?!|\?{2,}|:O)/gi,
  ];

  for (const p of happyPatterns) {
    const m = text.match(p);
    if (m) scores.happy += m.length * 1.5;
  }
  for (const p of smugPatterns) {
    const m = text.match(p);
    if (m) scores.smug += m.length * 1.8;
  }
  for (const p of sadPatterns) {
    const m = text.match(p);
    if (m) scores.sad += m.length * 1.6;
  }
  for (const p of angryPatterns) {
    const m = text.match(p);
    if (m) scores.angry += m.length * 1.8;
  }
  for (const p of surprisedPatterns) {
    const m = text.match(p);
    if (m) scores.surprised += m.length * 1.6;
  }

  // Structural weighting
  const exclamations = (text.match(/!/g) || []).length;
  if (exclamations >= 2 && scores.happy > 0) scores.happy += 1.2;
  if (exclamations >= 2 && scores.angry > 0) scores.angry += 1.4;

  let maxEmotion = 'neutral';
  let maxScore = scores.neutral;
  for (const [emo, score] of Object.entries(scores)) {
    if (emo === 'neutral') continue;
    if (score > maxScore && score >= 1.5) {
      maxScore = score;
      maxEmotion = emo;
    }
  }

  return maxEmotion;
}

app.post('/api/emotion', (req: Request, res: Response) => {
  const fullText = String(req.body?.text || '').trim();
  if (!fullText) {
    return res.json({ emotion: 'neutral', method: 'empty' });
  }

  // Pure sentiment & emotional tone algorithm (evaluates full message overall sentiment)
  const detected = classifyOverallSentimentAlgorithm(fullText);
  res.json({ emotion: detected, method: 'algorithm' });
});

// Document Text Extraction (PDF, DOCX, TXT)
app.post('/api/extract-document-text', async (req: Request, res: Response) => {
  try {
    const { fileName, fileType, fileData } = req.body;
    if (!fileData || typeof fileData !== 'string') {
      return res.status(400).json({ error: 'fileData (base64) is required' });
    }

    const buffer = Buffer.from(fileData, 'base64');
    const lowerName = String(fileName || '').toLowerCase();

    // 1. PDF
    if (lowerName.endsWith('.pdf') || fileType === 'application/pdf') {
      try {
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        const extracted = (result?.text || '').trim();
        if (extracted) {
          return res.json({ text: extracted, method: 'pdf-parse' });
        }
      } catch (pdfErr: any) {
        console.warn('Server PDFParse failed, trying text fallback:', pdfErr?.message);
      }
    }

    // 2. DOCX / DOC
    if (
      lowerName.endsWith('.docx') ||
      lowerName.endsWith('.doc') ||
      fileType?.includes('word') ||
      fileType?.includes('officedocument')
    ) {
      try {
        const result = await mammoth.extractRawText({ buffer });
        const text = (result?.value || '').trim();
        if (text) {
          return res.json({ text, method: 'mammoth' });
        }
      } catch (docErr: any) {
        console.warn('Mammoth docx parse failed:', docErr?.message);
      }
    }

    // 3. Fallback: string clean
    const rawString = buffer.toString('utf-8');
    const cleaned = rawString
      .replace(/%PDF-[\d.]+/g, '')
      .replace(/\d+\s+\d+\s+obj[\s\S]*?endobj/g, ' ')
      .replace(/stream[\s\S]*?endstream/g, ' ')
      .replace(/xref[\s\S]*?trailer/g, ' ')
      .replace(/trailer[\s\S]*?%%EOF/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[^\x20-\x7E\t\r\n]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return res.json({ text: cleaned, method: 'fallback-clean' });
  } catch (err: any) {
    console.error('Error in /api/extract-document-text:', err);
    res.status(500).json({ error: 'Failed to extract document text', message: err?.message });
  }
});

// MCP Server Information & Health
app.get('/api/mcp', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    name: 'ai-smash-mcp',
    version: '1.0.0',
    protocolVersion: '2024-11-05',
    transport: 'sse',
    sseEndpoint: '/api/mcp/sse',
    messagesEndpoint: '/api/mcp/messages',
    capabilities: {
      tools: [
        'avatar_act',
        'avatar_say',
        'avatar_emotion',
        'avatar_animation',
        'web_search',
        'wikipedia',
        'weather_info',
        'location_info',
        'device_info',
        'ask_persona',
      ],
      resources: ['resource://persona/profile', 'resource://app/info'],
      prompts: ['prompt://persona/chat'],
    },
  });
});

// MCP Server-Sent Events (SSE) Transport Endpoint
app.get('/api/mcp/sse', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const sessionId = `mcp_sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Emit standard MCP initial endpoint event
  res.write(`event: endpoint\ndata: /api/mcp/messages?sessionId=${sessionId}\n\n`);

  // Keep-alive heartbeat every 15s
  const keepAlive = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': keepalive\n\n');
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    res.end();
  });
});

// MCP JSON-RPC 2.0 Message Dispatcher
app.post(['/api/mcp', '/api/mcp/messages'], async (req: Request, res: Response) => {
  try {
    const { jsonrpc, id, method, params } = req.body || {};

    if (jsonrpc !== '2.0') {
      return res.status(400).json({
        jsonrpc: '2.0',
        id: id || null,
        error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' },
      });
    }

    // 1. Handshake Initialize
    if (method === 'initialize') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: true },
            resources: { subscribe: false, listChanged: false },
            prompts: { listChanged: false },
          },
          serverInfo: {
            name: 'ai-smash-mcp',
            version: '1.0.0',
          },
        },
      });
    }

    // 2. Notifications initialized
    if (method === 'notifications/initialized') {
      return res.json({ jsonrpc: '2.0', id: id || null, result: {} });
    }

    // 3. Ping
    if (method === 'ping') {
      return res.json({ jsonrpc: '2.0', id, result: {} });
    }

    // 4. Tools list
    if (method === 'tools/list') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'web_search',
              description: 'Searches the web for articles, live facts, and recent documentation.',
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'The search query string.' },
                  max_results: { type: 'number', description: 'Maximum results to return (default: 5).' },
                },
                required: ['query'],
              },
            },
            {
              name: 'wikipedia',
              description: 'Looks up Wikipedia encyclopedia overviews, history, and summaries.',
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'Article topic or entity to look up.' },
                },
                required: ['query'],
              },
            },
            {
              name: 'weather_info',
              description: 'Fetches real-time weather conditions, humidity, and forecasts for any city.',
              inputSchema: {
                type: 'object',
                properties: {
                  city: { type: 'string', description: 'Name of the city (e.g. Tokyo, London).' },
                },
                required: ['city'],
              },
            },
            {
              name: 'device_info',
              description: 'Inspects client hardware specifications, CPU cores, RAM, and browser environment.',
              inputSchema: {
                type: 'object',
                properties: {},
              },
            },
            {
              name: 'location_info',
              description: 'Gets current geographic location and timezone.',
              inputSchema: {
                type: 'object',
                properties: {},
              },
            },
            {
              name: 'ask_persona',
              description: 'Consults the active AI Smash persona (Hana) directly for an answer.',
              inputSchema: {
                type: 'object',
                properties: {
                  prompt: { type: 'string', description: 'Question or message for the persona.' },
                },
                required: ['prompt'],
              },
            },
          ],
        },
      });
    }

    // 5. Tools call
    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};

      let resultText = '';

      if (toolName === 'web_search') {
        const q = String(toolArgs.query || '');
        const resp = await fetch(`http://127.0.0.1:${PORT}/api/tools/web-search?q=${encodeURIComponent(q)}`);
        const data = await resp.json();
        resultText = JSON.stringify(data, null, 2);
      } else if (toolName === 'wikipedia') {
        const q = String(toolArgs.query || '');
        const resp = await fetch(`http://127.0.0.1:${PORT}/api/tools/wikipedia?q=${encodeURIComponent(q)}`);
        const data = await resp.json();
        resultText = JSON.stringify(data, null, 2);
      } else if (toolName === 'weather_info') {
        const city = String(toolArgs.city || '');
        const resp = await fetch(`http://127.0.0.1:${PORT}/api/tools/weather?city=${encodeURIComponent(city)}`);
        const data = await resp.json();
        resultText = JSON.stringify(data, null, 2);
      } else if (toolName === 'ask_persona') {
        const prompt = String(toolArgs.prompt || '');
        const resp = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: prompt }],
            systemPrompt: DEFAULT_SYSTEM_PROMPT,
            maxTokens: 300,
          }),
        });
        const streamData = await resp.text();
        const lines = streamData.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.text) resultText += parsed.text;
            } catch {}
          }
        }
      } else {
        resultText = `Tool "${toolName}" executed with args: ${JSON.stringify(toolArgs)}`;
      }

      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: resultText }],
        },
      });
    }

    // 6. Resources list & read
    if (method === 'resources/list') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          resources: [
            {
              uri: 'resource://persona/profile',
              name: `${APP_INFO.name} Persona Profile`,
              mimeType: 'application/json',
              description: 'Character personality, voice configuration, and active system prompts',
            },
          ],
        },
      });
    }

    if (method === 'resources/read') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          contents: [
            {
              uri: 'resource://persona/profile',
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  app: APP_INFO.name,
                  author: APP_INFO.author,
                  personaPrompt: DEFAULT_SYSTEM_PROMPT,
                },
                null,
                2
              ),
            },
          ],
        },
      });
    }

    // 7. Prompts list
    if (method === 'prompts/list') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          prompts: [
            {
              name: 'consult_persona',
              description: 'Start a consultative chat session with Hana',
              arguments: [{ name: 'topic', description: 'Subject matter', required: false }],
            },
          ],
        },
      });
    }

    return res.status(404).json({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method "${method}" not found` },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'MCP server error';
    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body?.id || null,
      error: { code: -32000, message: msg },
    });
  }
});

// =====================================================================
// GRAPHQL SCHEMA & RESOLVERS FOR THIRD-PARTY CLIENTS
// Provides structured queries and mutations for VRM model, outfits,
// animations, emotions, voice engine visemes, LLM models, and live actor controls.
// =====================================================================

const graphqlSchema = buildSchema(`
  type VRMModel {
    url: String!
    defaultOutfitId: String!
    candidateUrls: [String!]!
    activeFile: String!
    outfits: [OutfitItem!]!
  }

  type OutfitItem {
    id: String!
    name: String!
    fileName: String!
    modelUrl: String!
    fallbackModelUrl: String!
    isPremium: Boolean!
    isDefault: Boolean
    isSecret: Boolean
  }

  type AnimationAsset {
    type: String!
    url: String!
    candidateUrls: [String!]!
    description: String!
    loop: Boolean!
  }

  type EmotionDef {
    name: String!
    vrmMorph: String!
    description: String!
    valence: String!
  }

  type VisemeMapping {
    phonemes: [String!]!
    viseme: String!
    vrmMouthMorph: String!
  }

  type VoiceEngineConfig {
    lang: String!
    rate: Float!
    pitch: Float!
    preferredVoices: [String!]!
    visemes: [VisemeMapping!]!
    acousticFilter: String!
    maleKeywords: [String!]!
    femaleKeywords: [String!]!
  }

  type LlmModelInfo {
    id: String!
    name: String!
    tagline: String!
    family: String!
    description: String!
    speedRating: String!
    approxParams: String
    sizeLabel: String
    defaultDtype: String
    hfRepo: String
    isSmallModel: Boolean
    inferenceType: String!
    streamingEndpoint: String!
  }

  type PersonaProfile {
    name: String!
    alternateName: String
    handle: String!
    bio: String!
    avatarUrl: String!
    vrmModelUrl: String!
    websiteUrl: String!
    systemPromptAbridged: String!
  }

  type McpManifest {
    name: String!
    version: String!
    protocolVersion: String!
    tools: [String!]!
    resources: [String!]!
    prompts: [String!]!
  }

  type AvatarActionPayload {
    type: String!
    text: String!
    emotion: String!
    animation: String!
    timestamp: Float!
  }

  type AvatarActionResult {
    success: Boolean!
    message: String!
    activeSubscribers: Int!
    event: AvatarActionPayload
  }

  type EmotionAnalysisResult {
    text: String!
    emotion: String!
    method: String!
  }

  type PhonemeCue {
    word: String!
    viseme: String!
    vrmMorph: String!
    intensity: Float!
  }

  type PhonemeAnalysisResult {
    text: String!
    cues: [PhonemeCue!]!
  }

  type Query {
    avatar(outfitId: String): VRMModel!
    outfits: [OutfitItem!]!
    animations(type: String): [AnimationAsset!]!
    emotions: [EmotionDef!]!
    voiceEngine: VoiceEngineConfig!
    activeLlm(modelId: String): [LlmModelInfo!]!
    persona: PersonaProfile!
    mcpManifest: McpManifest!
  }

  type Mutation {
    setAvatarAction(action: String, text: String, emotion: String, animation: String): AvatarActionResult!
    detectEmotion(text: String!): EmotionAnalysisResult!
    synthesizePhonemes(text: String!): PhonemeAnalysisResult!
  }
`);

const graphqlRoot = {
  avatar: ({ outfitId }: { outfitId?: string }) => {
    const outfit = outfitId ? ALL_WARDROBE_OUTFITS.find((o) => o.id === outfitId) : ALL_WARDROBE_OUTFITS[0];
    const fileName = outfit?.fileName || 'hana_v1.3_vrm1.vrm';
    return {
      url: `/api/vrm?file=${encodeURIComponent(fileName)}`,
      defaultOutfitId: DEFAULT_OUTFIT_ID,
      candidateUrls: [
        `/api/vrm?file=${encodeURIComponent(fileName)}`,
        `${MODEL_SOURCE_DOMAIN}/${fileName}`,
        `${MODEL_FALLBACK_DOMAIN}/${fileName}`,
      ],
      activeFile: fileName,
      outfits: ALL_WARDROBE_OUTFITS,
    };
  },
  outfits: () => ALL_WARDROBE_OUTFITS,
  animations: ({ type }: { type?: string }) => {
    const list = [
      {
        type: 'idle',
        url: '/api/animation/idle',
        candidateUrls: VRM_CONFIG.candidateAnimationUrls,
        description: 'Subtle breathing and natural idling loop with gaze isolation',
        loop: true,
      },
      {
        type: 'walk',
        url: '/api/animation/walk',
        candidateUrls: VRM_CONFIG.candidateWalkAnimationUrls,
        description: 'Forward walking step loop with hip kinematics',
        loop: true,
      },
      {
        type: 'wave',
        url: '/api/animation/wave',
        candidateUrls: VRM_CONFIG.candidateWaveAnimationUrls,
        description: 'Friendly right-hand greeting wave gesture',
        loop: false,
      },
      {
        type: 'fall',
        url: '/api/animation/fall',
        candidateUrls: VRM_CONFIG.candidateFallAnimationUrls,
        description: 'Tumble backwards onto floor impact physics',
        loop: false,
      },
      {
        type: 'getup',
        url: '/api/animation/getup',
        candidateUrls: VRM_CONFIG.candidateGetupAnimationUrls,
        description: 'Recovery and standing back up animation from floor',
        loop: false,
      },
      {
        type: 'yawn',
        url: '/api/animation/yawn',
        candidateUrls: ['/api/animation/yawn', `${MODEL_SOURCE_DOMAIN}/mixamo_yawn.fbx`],
        description: 'Drowsy yawn and subtle arm stretch sequence',
        loop: false,
      },
      {
        type: 'wait',
        url: '/api/animation/wait',
        candidateUrls: ['/api/animation/wait', `${MODEL_SOURCE_DOMAIN}/mixamo_wait.fbx`],
        description: 'Patient waiting posture with weight shifted onto foot',
        loop: false,
      },
      {
        type: 'jumpingjacks',
        url: '/api/animation/wait?file=mixamo_.jumpingjacks.fbx',
        candidateUrls: ['/api/animation/wait?file=mixamo_.jumpingjacks.fbx', `${MODEL_SOURCE_DOMAIN}/mixamo_jumpingjacks.fbx`],
        description: 'Energetic full-body jumping jacks exercise',
        loop: true,
      },
    ];
    if (type) {
      return list.filter((a) => a.type.toLowerCase() === type.toLowerCase());
    }
    return list;
  },
  emotions: () => [
    { name: 'neutral', vrmMorph: 'neutral', description: 'Calm resting facial expression with natural micro-saccades', valence: 'neutral' },
    { name: 'happy', vrmMorph: 'happy', description: 'Warm tender smile, slight eye crinkle, relaxed parted lips', valence: 'positive' },
    { name: 'smug', vrmMorph: 'relaxed', description: 'Playful sly smirk, confident glance', valence: 'positive' },
    { name: 'sad', vrmMorph: 'sad', description: 'Softly lowered eyelids, downcast gentle mouth', valence: 'negative' },
    { name: 'angry', vrmMorph: 'angry', description: 'Slightly furrowed brow and cute pout', valence: 'negative' },
    { name: 'surprised', vrmMorph: 'surprised', description: 'Wide ocular gaze and parted lips', valence: 'heightened' },
  ],
  voiceEngine: () => ({
    lang: 'en-US',
    rate: VOICE_CONFIG.rate,
    pitch: VOICE_CONFIG.pitch,
    preferredVoices: VOICE_CONFIG.priorityQueue,
    visemes: [
      { phonemes: ['a', 'ah', 'aa'], viseme: 'aa', vrmMouthMorph: 'aa' },
      { phonemes: ['o', 'oh', 'aw'], viseme: 'oh', vrmMouthMorph: 'oh' },
      { phonemes: ['u', 'oo', 'w', 'ou'], viseme: 'ou', vrmMouthMorph: 'ou' },
      { phonemes: ['i', 'y', 'ih'], viseme: 'ih', vrmMouthMorph: 'ih' },
      { phonemes: ['e', 'ee', 'ea'], viseme: 'ee', vrmMouthMorph: 'ee' },
    ],
    acousticFilter: 'Web Audio API BiquadFilter low-pass warm harmonic smoothing',
    maleKeywords: VOICE_CONFIG.maleKeywords,
    femaleKeywords: VOICE_CONFIG.femaleKeywords,
  }),
  activeLlm: ({ modelId }: { modelId?: string }) => {
    const list = AVAILABLE_MODELS.map((m) => ({
      id: m.id,
      name: m.name,
      tagline: m.tagline || '',
      family: m.family,
      description: m.description,
      speedRating: m.speedRating || 'Fast',
      approxParams: m.approxParams || '',
      sizeLabel: m.sizeLabel || '',
      defaultDtype: m.defaultDtype || '',
      hfRepo: m.hfRepo || '',
      isSmallModel: Boolean(m.isSmallModel),
      inferenceType:
        m.family === 'browser-slm'
          ? 'in-browser-onnx'
          : m.family === 'ollama'
          ? 'ollama-server'
          : 'cloud-api',
      streamingEndpoint:
        m.family === 'browser-slm'
          ? 'client-transformers-js'
          : m.family === 'ollama'
          ? '/api/ollama/chat'
          : m.id === 'gemini-api'
          ? '/api/chat'
          : '/api/chat/provider',
    }));
    if (modelId) {
      return list.filter((m) => m.id === modelId);
    }
    return list;
  },
  persona: () => ({
    name: AI_PROFILE.name,
    alternateName: AI_PROFILE.alternateName,
    handle: AI_PROFILE.handle,
    bio: AI_PROFILE.bio,
    avatarUrl: AI_PROFILE.avatarUrl,
    vrmModelUrl: AI_PROFILE.vrmModelUrl,
    websiteUrl: AI_PROFILE.stats.websiteUrl,
    systemPromptAbridged: SYSTEM_PROMPTS.abridged,
  }),
  mcpManifest: () => ({
    name: 'ai-smash-mcp',
    version: '1.0.0',
    protocolVersion: '2024-11-05',
    tools: [
      'avatar_act',
      'avatar_say',
      'avatar_emotion',
      'avatar_animation',
      'web_search',
      'wikipedia',
      'weather_info',
      'location_info',
      'device_info',
      'ask_persona',
    ],
    resources: ['resource://persona/profile', 'resource://app/info'],
    prompts: ['prompt://persona/chat'],
  }),
  setAvatarAction: ({
    action,
    text,
    emotion,
    animation,
  }: {
    action?: string;
    text?: string;
    emotion?: string;
    animation?: string;
  }) => {
    const eventPayload = {
      type: action || 'speak',
      text: text || '',
      emotion: emotion || 'happy',
      animation: animation || 'wave',
      cues: [],
      timestamp: Date.now(),
    };
    broadcastAvatarEvent(eventPayload);
    return {
      success: true,
      message: 'Avatar action broadcasted to all connected 3D viewports via SSE',
      activeSubscribers: avatarEventClients.size,
      event: eventPayload,
    };
  },
  detectEmotion: ({ text }: { text: string }) => {
    const emotion = classifyOverallSentimentAlgorithm(text);
    return {
      text,
      emotion,
      method: 'sentiment-algorithm',
    };
  },
  synthesizePhonemes: ({ text }: { text: string }) => {
    const words = (text || '').trim().split(/\s+/);
    const cues = words.slice(0, 30).map((word) => {
      const lower = word.toLowerCase();
      let viseme = 'aa';
      let morph = 'aa';
      let intensity = 0.25;
      if (/[ao]/.test(lower)) {
        if (lower.includes('o') || lower.includes('aw')) {
          viseme = 'oh';
          morph = 'oh';
          intensity = 0.32;
        } else {
          viseme = 'aa';
          morph = 'aa';
          intensity = 0.35;
        }
      } else if (/[iuwy]/.test(lower)) {
        if (lower.includes('u') || lower.includes('oo') || lower.includes('w')) {
          viseme = 'ou';
          morph = 'ou';
          intensity = 0.25;
        } else {
          viseme = 'ih';
          morph = 'ih';
          intensity = 0.22;
        }
      } else if (/[e]/.test(lower)) {
        viseme = 'ee';
        morph = 'ee';
        intensity = 0.25;
      }
      return { word, viseme, vrmMorph: morph, intensity };
    });
    return { text, cues };
  },
};

// GraphQL execution endpoint (POST /api/graphql)
app.post('/api/graphql', async (req: Request, res: Response) => {
  try {
    const { query, variables, operationName } = req.body || {};
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ errors: [{ message: 'GraphQL "query" string is required in request body.' }] });
    }

    const result = await graphql({
      schema: graphqlSchema,
      source: query,
      rootValue: graphqlRoot,
      variableValues: variables,
      operationName,
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'GraphQL execution failure';
    res.status(500).json({ errors: [{ message: msg }] });
  }
});

// GraphQL GET endpoint (query via query parameter or schema discovery)
app.get('/api/graphql', async (req: Request, res: Response) => {
  try {
    const rawQuery = typeof req.query.query === 'string' ? req.query.query : '';
    if (rawQuery) {
      let variables = undefined;
      if (typeof req.query.variables === 'string') {
        try {
          variables = JSON.parse(req.query.variables);
        } catch {
          // ignore
        }
      }
      const result = await graphql({
        schema: graphqlSchema,
        source: rawQuery,
        rootValue: graphqlRoot,
        variableValues: variables,
      });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.json(result);
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
      status: 'ok',
      endpoint: '/api/graphql',
      description: 'Hana Universal 3D Avatar, Emotion, Voice & LLM GraphQL Endpoint',
      sampleQuery: `{ avatar { url defaultOutfitId activeFile outfits { id name } } animations { type url loop } emotions { name vrmMorph } voiceEngine { lang rate pitch preferredVoices } activeLlm { id name family streamingEndpoint } }`,
      docsUrl: '/docs/api/third-party-avatar',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'GraphQL GET failure';
    res.status(500).json({ errors: [{ message: msg }] });
  }
});

// Cloud streaming endpoint for external AI Model APIs
// (OpenAI, Gemini, Anthropic, xAI, Groq, Z.ai, DeepSeek, Qwen, HuggingFace)
app.post('/api/chat/provider', async (req: Request, res: Response) => {
  try {
    const { provider, apiKey, model, messages, systemPrompt, maxTokens } = req.body || {};
    const effectivePrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const outputTokens = Math.min(Math.max(Number(maxTokens) || 512, 64), 4096);

    const effectiveKey = (apiKey || '').trim();
    if (!effectiveKey) {
      return res.status(400).json({
        error: `API key is required for ${provider || 'this provider'}. Please configure your API key in the Model Selector.`,
      });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 1. Google Gemini via @google/genai SDK
    if (provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: effectiveKey });
      const formattedContents = (messages || [])
        .filter((m: { role: string }) => m.role !== 'system')
        .map((msg: { role: string; content: string }) => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        }));

      const targetModel = model || 'gemini-2.5-flash';
      const responseStream = await ai.models.generateContentStream({
        model: targetModel,
        contents: formattedContents,
        config: {
          systemInstruction: effectivePrompt,
          temperature: 0.85,
          maxOutputTokens: outputTokens,
        },
      });

      for await (const chunk of responseStream) {
        if (chunk.text) {
          res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
        }
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    // 2. Anthropic Claude via native messages SSE API
    if (provider === 'anthropic') {
      const targetModel = model || 'claude-3-7-sonnet-20250219';
      const cleanedMessages = (messages || [])
        .filter((m: { role: string }) => m.role === 'user' || m.role === 'assistant')
        .map((m: { role: string; content: string }) => ({
          role: m.role,
          content: m.content,
        }));

      const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': effectiveKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model: targetModel,
          max_tokens: outputTokens,
          system: effectivePrompt,
          messages: cleanedMessages,
          stream: true,
          temperature: 0.85,
        }),
      });

      if (!anthropicResp.ok || !anthropicResp.body) {
        const errText = await anthropicResp.text();
        res.write(`data: ${JSON.stringify({ error: errText || `Anthropic API error (${anthropicResp.status})` })}\n\n`);
        return res.end();
      }

      const reader = anthropicResp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            if (dataStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                res.write(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`);
              } else if (parsed.type === 'message_stop') {
                res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
              }
            } catch {
              // ignore json parse error
            }
          }
        }
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    // 3. OpenAI-Compatible Providers (OpenAI, xAI, Groq, DeepSeek, Z.ai, Qwen, HuggingFace)
    const providerEndpoints: Record<string, string> = {
      openai: 'https://api.openai.com/v1/chat/completions',
      xai: 'https://api.x.ai/v1/chat/completions',
      groq: 'https://api.groq.com/openai/v1/chat/completions',
      deepseek: 'https://api.deepseek.com/chat/completions',
      zai: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      huggingface: 'https://router.huggingface.co/hf-inference/v1/chat/completions',
    };

    const targetUrl = providerEndpoints[provider] || providerEndpoints.openai;
    const defaultModels: Record<string, string> = {
      openai: 'gpt-4o',
      xai: 'grok-2-latest',
      groq: 'llama-3.3-70b-versatile',
      deepseek: 'deepseek-chat',
      zai: 'glm-4-plus',
      qwen: 'qwen-max',
      huggingface: 'meta-llama/Llama-3.3-70B-Instruct',
    };

    const targetModel = model || defaultModels[provider] || 'gpt-4o';
    const cleanedHistory = (messages || [])
      .filter((m: { role: string }) => m.role !== 'system')
      .map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      }));

    const formattedMessages = [
      { role: 'system', content: effectivePrompt },
      ...cleanedHistory,
    ];

    const apiResp = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${effectiveKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: targetModel,
        messages: formattedMessages,
        max_tokens: outputTokens,
        temperature: 0.85,
        stream: true,
      }),
    });

    if (!apiResp.ok || !apiResp.body) {
      const errText = await apiResp.text();
      res.write(`data: ${JSON.stringify({ error: errText || `${provider} API error (${apiResp.status})` })}\n\n`);
      return res.end();
    }

    const reader = apiResp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            continue;
          }
          try {
            const parsed = JSON.parse(dataStr);
            const piece = parsed.choices?.[0]?.delta?.content || '';
            if (piece) {
              res.write(`data: ${JSON.stringify({ text: piece })}\n\n`);
            }
          } catch {
            // Ignore boundary chunk errors
          }
        }
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Error in external API streaming proxy';
    console.error('Provider proxy error:', errorMsg);
    if (!res.headersSent) {
      res.status(500).json({ error: errorMsg });
    } else {
      res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
      res.end();
    }
  }
});

// =====================================================================
// NeonDB Account Authentication, Profile, Redeem & Sync Routes
// =====================================================================

app.post('/api/auth/signup', async (req: Request, res: Response) => {
  try {
    const { email, password, device, fingerprint } = req.body || {};
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    if (!password || typeof password !== 'string' || password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters.' });
    }

    const userAgent = req.headers['user-agent'] || 'Web Browser';
    const result = await signUpAccount({
      email,
      password,
      device: device || String(userAgent),
      fingerprint: fingerprint || '',
    });

    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create account.';
    res.status(400).json({ error: message });
  }
});

app.post('/api/auth/signin', async (req: Request, res: Response) => {
  try {
    const { email, password, device, fingerprint } = req.body || {};
    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const userAgent = req.headers['user-agent'] || 'Web Browser';
    const result = await signInAccount({
      email,
      password,
      device: device || String(userAgent),
      fingerprint: fingerprint || '',
    });

    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to sign in.';
    res.status(401).json({ error: message });
  }
});

app.post('/api/account/profile', async (req: Request, res: Response) => {
  try {
    const { userId, username, displayName, avatarUrl, equippedOutfitId, unlockedOutfits, activeThemeId } = req.body || {};
    if (!userId || Number.isNaN(Number(userId))) {
      return res.status(400).json({ error: 'Valid userId is required.' });
    }

    const user = await updateAccountProfile({
      userId: Number(userId),
      username,
      displayName,
      avatarUrl,
      equippedOutfitId,
      unlockedOutfits,
      activeThemeId,
    });

    res.json({ user });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update profile.';
    res.status(400).json({ error: message });
  }
});

app.post('/api/account/redeem', async (req: Request, res: Response) => {
  try {
    const { userId, code } = req.body || {};
    if (!userId || Number.isNaN(Number(userId))) {
      return res.status(400).json({ error: 'Valid userId is required.' });
    }
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Redeem code is required.' });
    }

    const user = await redeemAccountCode({
      userId: Number(userId),
      code,
    });

    res.json({ user });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to redeem code.';
    res.status(400).json({ error: message });
  }
});

app.get('/api/account/sync/:userId', async (req: Request, res: Response) => {
  try {
    const userId = Number(req.params.userId);
    if (!userId || Number.isNaN(userId)) {
      return res.status(400).json({ error: 'Valid userId is required.' });
    }
    const password = typeof req.query.password === 'string' ? req.query.password : undefined;
    const data = await fetchUserSyncedData(userId, password);
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch synced data.';
    res.status(400).json({ error: message });
  }
});

app.post('/api/account/sync', async (req: Request, res: Response) => {
  try {
    const { userId, conversations, customThemes, unlockedOutfits, password } = req.body || {};
    if (!userId || Number.isNaN(Number(userId))) {
      return res.status(400).json({ error: 'Valid userId is required.' });
    }
    await syncUserConversationsAndThemes({
      userId: Number(userId),
      conversations,
      customThemes,
      unlockedOutfits,
      password,
    });
    res.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to sync account data.';
    res.status(400).json({ error: message });
  }
});

// ----------------------------------------------------
// Discord Bot Gateway / REST API Proxy
// ----------------------------------------------------
app.post('/api/discord/test', async (req: Request, res: Response) => {
  try {
    const { botToken } = req.body || {};
    const token = (botToken || '').trim();
    if (!token) {
      return res.status(400).json({ ok: false, message: 'Bot token cannot be empty.' });
    }

    const discordResp = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (discordResp.ok) {
      const data = await discordResp.json();
      return res.json({
        ok: true,
        message: `Connected successfully as @${data.username}#${data.discriminator || '0'} (ID: ${data.id})`,
        details: data,
      });
    } else {
      const err = await discordResp.json().catch(() => ({}));
      return res.status(discordResp.status).json({
        ok: false,
        message: err.message || `Discord API error: ${discordResp.status} ${discordResp.statusText}`,
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error communicating with Discord';
    res.status(500).json({ ok: false, message: msg });
  }
});

app.post('/api/discord/send', async (req: Request, res: Response) => {
  try {
    const { botToken, channelId, content, replyToMessageId } = req.body || {};
    const token = (botToken || '').trim();
    const chId = (channelId || '').trim();
    const text = (content || '').trim();

    if (!token || !chId || !text) {
      return res.status(400).json({ ok: false, error: 'Missing botToken, channelId, or content' });
    }

    const payload: Record<string, unknown> = { content: text };
    if (replyToMessageId) {
      payload.message_reference = { message_id: replyToMessageId };
    }

    const discordResp = await fetch(`https://discord.com/api/v10/channels/${chId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await discordResp.json().catch(() => ({}));
    if (discordResp.ok) {
      return res.json({ ok: true, data });
    } else {
      return res.status(discordResp.status).json({ ok: false, error: data.message || 'Failed to send message' });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error sending message to Discord';
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post('/api/discord/typing', async (req: Request, res: Response) => {
  try {
    const { botToken, channelId } = req.body || {};
    const token = (botToken || '').trim();
    const chId = (channelId || '').trim();
    if (!token || !chId) {
      return res.status(400).json({ ok: false, error: 'Missing botToken or channelId' });
    }

    await fetch(`https://discord.com/api/v10/channels/${chId}/typing`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}` },
    });
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ ok: false });
  }
});

app.post('/api/discord/interaction', async (req: Request, res: Response) => {
  try {
    const { interactionId, interactionToken, response } = req.body || {};
    if (!interactionId || !interactionToken || !response) {
      return res.status(400).json({ ok: false, error: 'Missing interactionId, interactionToken, or response' });
    }

    const discordResp = await fetch(
      `https://discord.com/api/v10/interactions/${interactionId}/${interactionToken}/callback`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response),
      }
    );

    if (discordResp.ok || discordResp.status === 204) {
      return res.json({ ok: true });
    }
    const err = await discordResp.json().catch(() => ({}));
    return res.status(discordResp.status).json({ ok: false, error: err });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Interaction proxy error';
    return res.status(500).json({ ok: false, error: msg });
  }
});

app.post('/api/discord/register-commands', async (req: Request, res: Response) => {
  try {
    const { botToken, applicationId, guildId } = req.body || {};
    const token = (botToken || '').trim();
    const appId = (applicationId || '').trim();
    if (!token || !appId) {
      return res.status(400).json({ ok: false, error: 'Missing botToken or applicationId' });
    }

    const commands = [
      {
        name: 'msg',
        description: 'Send a prompt or query to Hana AI',
        options: [
          {
            name: 'prompt',
            description: 'Your prompt or question for Hana',
            type: 3, // STRING
            required: true,
          },
        ],
      },
      {
        name: 'hana',
        description: 'Chat with Hana AI companion',
        options: [
          {
            name: 'prompt',
            description: 'Your prompt or question for Hana',
            type: 3, // STRING
            required: true,
          },
        ],
      },
      {
        name: 'ask',
        description: 'Ask Hana AI a question',
        options: [
          {
            name: 'question',
            description: 'Your question',
            type: 3, // STRING
            required: true,
          },
        ],
      },
      {
        name: 'help',
        description: 'Display Hana AI bot command guide',
      },
      {
        name: 'ping',
        description: 'Check if Hana AI Discord bot is online and responding',
      },
      {
        name: 'status',
        description: 'View current Hana AI bot and engine status',
      },
      {
        name: 'joinvc',
        description: 'Instruct Hana to join voice channel for speech synthesis',
      },
      {
        name: 'exitvc',
        description: 'Instruct Hana to disconnect from voice channel',
      },
    ];

    const endpoint = guildId
      ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
      : `https://discord.com/api/v10/applications/${appId}/commands`;

    const discordResp = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    });

    const data = await discordResp.json().catch(() => ({}));
    if (discordResp.ok) {
      return res.json({ ok: true, commands: data });
    } else {
      return res.status(discordResp.status).json({ ok: false, error: data });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error registering slash commands';
    return res.status(500).json({ ok: false, error: msg });
  }
});

// =====================================================================
// Self-Hosted Zero-API WebRTC & Real-Time Telephone PBX Switchboard
// =====================================================================
interface PbxSignalMessage {
  id: string;
  sender: 'agent' | 'callee';
  fromNumber: string;
  text: string;
  timestamp: string;
  modelUsed?: string;
}

interface PbxCallSession {
  callId: string;
  fromNumber: string;
  toNumber: string;
  status: 'ringing' | 'connected' | 'ended';
  offerSdp?: unknown;
  answerSdp?: unknown;
  callerIce: unknown[];
  calleeIce: unknown[];
  messages: PbxSignalMessage[];
  createdAt: number;
  updatedAt: number;
}

const registeredPbxLines = new Map<string, { lineNumber: string; lastSeen: number }>();
const pbxCallSessions = new Map<string, PbxCallSession>();

function normalizeDigits(raw: string): string {
  const digits = String(raw || '').replace(/[^0-9]/g, '');
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

// Register or heartbeat a local phone line number on the self-hosted PBX switchboard
app.post('/api/caller/pbx/register', (req: Request, res: Response) => {
  const rawLine = String(req.body?.lineNumber || '').trim();
  const key = normalizeDigits(rawLine);
  if (!key) {
    return res.status(400).json({ ok: false, error: 'Invalid line number' });
  }
  registeredPbxLines.set(key, { lineNumber: rawLine, lastSeen: Date.now() });
  return res.json({
    ok: true,
    lineKey: key,
    onlineLines: registeredPbxLines.size,
  });
});

// Poll for incoming calls or active call WebRTC SDP/ICE/Speech updates
app.get('/api/caller/pbx/poll', (req: Request, res: Response) => {
  const rawLine = String(req.query.lineNumber || '').trim();
  const callId = String(req.query.callId || '').trim();
  const key = normalizeDigits(rawLine);

  if (key) {
    registeredPbxLines.set(key, { lineNumber: rawLine, lastSeen: Date.now() });
  }

  // If client is already in a specific callId, return its latest session state
  if (callId && pbxCallSessions.has(callId)) {
    return res.json({
      ok: true,
      activeCall: pbxCallSessions.get(callId),
    });
  }

  // Otherwise check if anyone is currently ringing this line number
  if (key) {
    for (const session of pbxCallSessions.values()) {
      if (
        normalizeDigits(session.toNumber) === key &&
        (session.status === 'ringing' || session.status === 'connected') &&
        Date.now() - session.updatedAt < 120000
      ) {
        return res.json({
          ok: true,
          incomingCall: session,
        });
      }
    }
  }

  return res.json({ ok: true, incomingCall: null, activeCall: null });
});

// Dial a phone number on the self-hosted PBX switchboard (with optional WebRTC SDP offer)
app.post('/api/caller/pbx/dial', (req: Request, res: Response) => {
  const fromNumber = String(req.body?.fromNumber || '+1 (555) 010-1000').trim();
  const toNumber = String(req.body?.toNumber || '').trim();
  const offerSdp = req.body?.offerSdp || null;

  if (!normalizeDigits(toNumber)) {
    return res.status(400).json({ ok: false, error: 'Destination phone number required' });
  }

  const callId = `pbx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const session: PbxCallSession = {
    callId,
    fromNumber,
    toNumber,
    status: 'ringing',
    offerSdp,
    answerSdp: null,
    callerIce: [],
    calleeIce: [],
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  pbxCallSessions.set(callId, session);
  const targetOnline = registeredPbxLines.has(normalizeDigits(toNumber));

  return res.json({
    ok: true,
    callId,
    targetOnline,
    session,
  });
});

// Answer an incoming call on the self-hosted PBX switchboard (with optional WebRTC SDP answer)
app.post('/api/caller/pbx/answer', (req: Request, res: Response) => {
  const callId = String(req.body?.callId || '').trim();
  const session = pbxCallSessions.get(callId);
  if (!session) {
    return res.status(404).json({ ok: false, error: 'Call session not found' });
  }
  session.status = 'connected';
  if (req.body?.answerSdp) {
    session.answerSdp = req.body.answerSdp;
  }
  session.updatedAt = Date.now();
  return res.json({ ok: true, session });
});

// Exchange WebRTC ICE candidates or SDP between caller and callee
app.post('/api/caller/pbx/signal', (req: Request, res: Response) => {
  const callId = String(req.body?.callId || '').trim();
  const role = req.body?.role === 'callee' ? 'callee' : 'caller';
  const candidate = req.body?.candidate;
  const offerSdp = req.body?.offerSdp;
  const answerSdp = req.body?.answerSdp;

  const session = pbxCallSessions.get(callId);
  if (!session) {
    return res.status(404).json({ ok: false, error: 'Call session not found' });
  }

  if (offerSdp) session.offerSdp = offerSdp;
  if (answerSdp) {
    session.answerSdp = answerSdp;
    session.status = 'connected';
  }
  if (candidate) {
    if (role === 'caller') {
      session.callerIce.push(candidate);
    } else {
      session.calleeIce.push(candidate);
    }
  }
  session.updatedAt = Date.now();
  return res.json({ ok: true, session });
});

// Relay a spoken/transcribed message turn across the PBX call line
app.post('/api/caller/pbx/message', (req: Request, res: Response) => {
  const callId = String(req.body?.callId || '').trim();
  const session = pbxCallSessions.get(callId);
  if (!session) {
    return res.status(404).json({ ok: false, error: 'Call session not found' });
  }

  const msg: PbxSignalMessage = {
    id: String(req.body?.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`),
    sender: req.body?.sender === 'agent' ? 'agent' : 'callee',
    fromNumber: String(req.body?.fromNumber || ''),
    text: String(req.body?.text || '').trim(),
    timestamp: String(req.body?.timestamp || '00:00'),
    modelUsed: req.body?.modelUsed ? String(req.body.modelUsed) : undefined,
  };

  if (msg.text && !session.messages.some((m) => m.id === msg.id)) {
    session.messages.push(msg);
    session.updatedAt = Date.now();
  }

  return res.json({ ok: true, session });
});

// Hang up an active PBX call
app.post('/api/caller/pbx/hangup', (req: Request, res: Response) => {
  const callId = String(req.body?.callId || '').trim();
  const session = pbxCallSessions.get(callId);
  if (session) {
    session.status = 'ended';
    session.updatedAt = Date.now();
  }
  return res.json({ ok: true });
});

// Webhook endpoint (GET for Meta challenge handshake, POST for event stream)
app.all('/api/caller/webhooks/:platform', (req: Request, res: Response) => {
  const platform = req.params.platform;
  // Meta verification handshake (WhatsApp & Messenger)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && challenge) {
      console.log(`[Webhook] Verified challenge for ${platform} with token: ${token}`);
      return res.status(200).send(challenge);
    }
    return res.status(200).json({ ok: true, platform, status: 'listening' });
  }

  // Incoming webhook message or call event
  console.log(`[Webhook Event] ${platform}:`, JSON.stringify(req.body));
  return res.status(200).json({ ok: true, platform, receivedAt: Date.now() });
});

async function startServer() {
  const distIndex = path.join(__dirname, 'dist', 'index.html');
  const rootIndex = path.join(__dirname, 'index.html');

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    // Explicit SPA fallback for /chat, /app, and any non-API route on page refresh
    app.get(['/chat', '/chat/*', '/app', '/app/*', '*'], async (req: Request, res: Response, next) => {
      if (req.path.startsWith('/api/')) {
        return next();
      }
      try {
        const template = fs.readFileSync(rootIndex, 'utf-8');
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (err) {
        next(err);
      }
    });
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get(['/chat', '/chat/*', '/app', '/app/*', '*'], (req: Request, res: Response, next) => {
      if (req.path.startsWith('/api/')) {
        return next();
      }
      if (fs.existsSync(distIndex)) {
        res.sendFile(distIndex);
      } else {
        res.sendFile(rootIndex);
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`${APP_INFO.name} server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
