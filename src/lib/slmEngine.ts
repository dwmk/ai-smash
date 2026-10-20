import { pipeline, env, TextStreamer } from '@huggingface/transformers';
import { ModelSpec, DownloadProgress, HardwareDevice, Message } from '../types';
import { TOKEN_CONFIG, OLLAMA_CONFIG } from '../constants';
import { getPersonaPrompt, cleanModelResponse } from './prompts';
import { streamOllama } from './ollama';
import { loadCustomOllamaUrl, loadStoredApiKey, loadStoredProviderModel } from './storage';
import { executeTool, extractToolCalls, getToolCallingSystemPrompt } from '../tools';

// Configure Transformers.js for browser environment
if (typeof window !== 'undefined') {
  env.allowLocalModels = false;
  env.useBrowserCache = true;
}

// Active generator cache in memory
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activeGenerator: any = null;
let activeModelId: string | null = null;
let isModelLoading = false;
let cancelLoadRequested = false;
let abortController: AbortController | null = null;

export async function detectBestHardwareDevice(preference: 'auto' | 'webgpu' | 'wasm' = 'auto'): Promise<HardwareDevice> {
  if (preference === 'wasm') return 'wasm';
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const adapter = await (navigator as unknown as { gpu: { requestAdapter: () => Promise<unknown> } }).gpu.requestAdapter();
      if (adapter) return 'webgpu';
    } catch {
      return 'wasm';
    }
  }
  return 'wasm';
}

export function isModelCurrentlyLoaded(modelId: string): boolean {
  return activeGenerator !== null && activeModelId === modelId;
}

export function getActiveModelId(): string | null {
  return activeModelId;
}

export function resetActiveGenerator(): void {
  activeGenerator = null;
  activeModelId = null;
}

/**
 * Pre-warm or load an SLM model pipeline
 */
export async function loadModelPipeline(
  model: ModelSpec,
  devicePref: 'auto' | 'webgpu' | 'wasm',
  onProgress?: (prog: DownloadProgress) => void
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  if (model.family === 'cloud' || model.family === 'ollama' || model.family === 'api-provider') {
    return { cloud: true };
  }

  if (activeGenerator && activeModelId === model.id) {
    onProgress?.({
      modelId: model.id,
      status: 'ready',
      progress: 100,
      loadedBytes: 0,
      totalBytes: 0,
    });
    return activeGenerator;
  }

  if (isModelLoading) {
    throw new Error('Another model is currently initializing. Please wait a moment.');
  }

  isModelLoading = true;
  cancelLoadRequested = false;
  onProgress?.({
    modelId: model.id,
    status: 'downloading',
    progress: 0,
    loadedBytes: 0,
    totalBytes: 0,
  });

  const device = await detectBestHardwareDevice(devicePref);

  try {
    // Pipeline creation with progress callback
    const generator = await pipeline('text-generation', model.hfRepo, {
      device: device === 'webgpu' ? 'webgpu' : 'wasm',
      dtype: model.defaultDtype,
      progress_callback: (item: { status?: string; progress?: number; loaded?: number; total?: number; file?: string }) => {
        if (cancelLoadRequested) {
          isModelLoading = false;
          throw new Error('Model loading and caching was cancelled.');
        }
        if (!onProgress) return;
        const progressNum = typeof item.progress === 'number' ? Math.round(item.progress) : 0;
        onProgress({
          modelId: model.id,
          status: item.status === 'done' || item.status === 'ready' ? 'ready' : 'downloading',
          progress: progressNum,
          loadedBytes: item.loaded || 0,
          totalBytes: item.total || 0,
          fileName: item.file,
        });
      },
    });

    if (cancelLoadRequested) {
      isModelLoading = false;
      throw new Error('Model loading and caching was cancelled.');
    }

    activeGenerator = generator;
    activeModelId = model.id;
    isModelLoading = false;

    onProgress?.({
      modelId: model.id,
      status: 'ready',
      progress: 100,
      loadedBytes: 0,
      totalBytes: 0,
    });

    return generator;
  } catch (error: unknown) {
    isModelLoading = false;
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to load ${model.name} with ${device}:`, msg);

    // If webgpu failed, try fallback to wasm
    if (device === 'webgpu') {
      try {
        console.log('Attempting fallback to WASM runtime...');
        onProgress?.({
          modelId: model.id,
          status: 'downloading',
          progress: 10,
          loadedBytes: 0,
          totalBytes: 0,
          fileName: 'Retrying on CPU/WASM...',
        });

        const fallbackGenerator = await pipeline('text-generation', model.hfRepo, {
          device: 'wasm',
          dtype: 'q4',
          progress_callback: (item: { status?: string; progress?: number; loaded?: number; total?: number; file?: string }) => {
            if (!onProgress) return;
            const progressNum = typeof item.progress === 'number' ? Math.round(item.progress) : 0;
            onProgress({
              modelId: model.id,
              status: item.status === 'done' || item.status === 'ready' ? 'ready' : 'downloading',
              progress: progressNum,
              loadedBytes: item.loaded || 0,
              totalBytes: item.total || 0,
              fileName: item.file || 'Downloading CPU tensors...',
            });
          },
        });

        activeGenerator = fallbackGenerator;
        activeModelId = model.id;
        isModelLoading = false;
        onProgress?.({
          modelId: model.id,
          status: 'ready',
          progress: 100,
          loadedBytes: 0,
          totalBytes: 0,
        });
        return fallbackGenerator;
      } catch (wasmErr) {
        console.error('WASM fallback also failed:', wasmErr);
      }
    }

    isModelLoading = false;
    onProgress?.({
      modelId: model.id,
      status: 'error',
      progress: 0,
      loadedBytes: 0,
      totalBytes: 0,
      error: msg,
    });
    throw new Error(msg);
  }
}

/**
 * Check for direct user command triggers for tools
 */
export async function checkDirectToolInvocation(userMessage: string): Promise<string | null> {
  const trimmed = userMessage.trim();
  if (/^!(?:humanize|human|detector|detect|turnitin)\b(?:\s+(.+))?/is.test(trimmed)) {
    const match = trimmed.match(/^!(?:humanize|human|detector|detect|turnitin)\b(?:\s+([\s\S]+))?/i);
    const text = match?.[1] || '';
    const res = await executeTool('ai_humanizer', { text });
    return res.renderedSummary || null;
  }
  if (/^!(?:weather|w)\s+(.+)/i.test(trimmed)) {
    const match = trimmed.match(/^!(?:weather|w)\s+(.+)/i);
    const city = match?.[1] || '';
    const res = await executeTool('weather_info', { city });
    return res.renderedSummary || null;
  }
  if (/^!(?:search|google|web)\s+(.+)/i.test(trimmed)) {
    const match = trimmed.match(/^!(?:search|google|web)\s+(.+)/i);
    const query = match?.[1] || '';
    const res = await executeTool('web_search', { query });
    return res.renderedSummary || null;
  }
  if (/^!(?:wiki|wikipedia)\s+(.+)/i.test(trimmed)) {
    const match = trimmed.match(/^!(?:wiki|wikipedia)\s+(.+)/i);
    const query = match?.[1] || '';
    const res = await executeTool('wikipedia', { query });
    return res.renderedSummary || null;
  }
  if (/^!(?:location|loc|whereami)\b/i.test(trimmed)) {
    const res = await executeTool('location_info', {});
    return res.renderedSummary || null;
  }
  if (/^!(?:device|specs|system|hardware)\b/i.test(trimmed)) {
    const res = await executeTool('device_info', {});
    return res.renderedSummary || null;
  }
  return null;
}

async function resolveToolCallsInResponse(
  text: string,
  onTokenUpdate?: (tokenPiece: string, fullAccumulated: string) => void
): Promise<string> {
  const toolCalls = extractToolCalls(text);
  if (toolCalls.length === 0) return text;

  let resolved = text;
  for (const call of toolCalls) {
    try {
      const toolRes = await executeTool(call.toolName, call.args);
      const output = toolRes.renderedSummary || JSON.stringify(toolRes.result, null, 2);
      resolved = resolved.replace(call.rawMatch, `\n\n${output}\n\n`);
    } catch (err: unknown) {
      resolved = resolved.replace(call.rawMatch, `\n\n[Tool execution failed: ${String(err)}]\n\n`);
    }
  }

  const cleaned = cleanModelResponse(resolved);
  onTokenUpdate?.('', cleaned);
  return cleaned;
}

/**
 * Stream conversational completion from persona model
 */
export async function streamPersonaResponse({
  model,
  history,
  userMessage,
  devicePref,
  maxTokens = TOKEN_CONFIG.defaultTokens,
  customSystemPrompt,
  onToken,
  onTelemetry,
  onProgress,
}: {
  model: ModelSpec;
  history: Message[];
  userMessage: string;
  devicePref: 'auto' | 'webgpu' | 'wasm';
  maxTokens?: number;
  customSystemPrompt?: string;
  onToken: (token: string, fullAccumulated: string) => void;
  onTelemetry?: (stats: {
    ttftMs: number;
    tokensPerSec: number;
    totalMs: number;
    tokenCount: number;
    device: HardwareDevice;
  }) => void;
  onProgress?: (prog: DownloadProgress) => void;
}): Promise<string> {
  // Check for direct tool shortcuts first (!weather, !search, !wiki, !location, !device)
  const directToolResult = await checkDirectToolInvocation(userMessage);
  if (directToolResult) {
    onToken(directToolResult, directToolResult);
    onTelemetry?.({
      ttftMs: 20,
      tokensPerSec: 50,
      totalMs: 40,
      tokenCount: directToolResult.length,
      device: 'wasm',
    });
    return directToolResult;
  }

  const startTime = performance.now();
  let firstTokenTime: number | null = null;
  let tokenCount = 0;
  let accumulatedText = '';
  abortController = new AbortController();

  // If Cloud Model (Gemini 3.8 Flash)
  if (model.family === 'cloud') {
    const systemPrompt = customSystemPrompt || (getPersonaPrompt(false) + getToolCallingSystemPrompt());
    const messagesPayload = [
      ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMessage },
    ];

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messagesPayload,
        systemPrompt,
        maxTokens,
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error || `Server error: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body stream not available');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.text) {
              if (firstTokenTime === null) {
                firstTokenTime = performance.now();
              }
              tokenCount++;
              accumulatedText += data.text;
              onToken(data.text, cleanModelResponse(accumulatedText));

              const now = performance.now();
              const elapsedSec = (now - startTime) / 1000;
              const tps = elapsedSec > 0 ? Math.round((tokenCount / elapsedSec) * 10) / 10 : 0;
              onTelemetry?.({
                ttftMs: Math.round(firstTokenTime - startTime),
                tokensPerSec: tps,
                totalMs: Math.round(now - startTime),
                tokenCount,
                device: 'cloud',
              });
            }
          } catch {
            // Ignore parse errors on SSE boundary
          }
        }
      }
    }

    const cleanedFinal = await resolveToolCallsInResponse(cleanModelResponse(accumulatedText), (p, full) => onToken(p, full));
    return cleanedFinal;
  }

  // If External AI Model API Provider (OpenAI, Gemini, Anthropic, xAI, Groq, Z.ai, DeepSeek, Qwen, HuggingFace)
  if (model.family === 'api-provider') {
    const providerId = model.providerId || 'openai';
    const apiKey = loadStoredApiKey(providerId);
    const configuredSubmodel = loadStoredProviderModel(providerId) || model.customModel || '';

    if (!apiKey && providerId !== 'gemini') {
      throw new Error(
        `API Key required for ${model.name}. Please enter your ${model.name} API key in the Model Selector dropdown.`
      );
    }

    const systemPrompt = customSystemPrompt || (getPersonaPrompt(false) + getToolCallingSystemPrompt());
    const messagesPayload = [
      ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMessage },
    ];

    let response = await fetch('/api/chat/provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: providerId,
        apiKey,
        model: configuredSubmodel,
        messages: messagesPayload,
        systemPrompt,
        maxTokens,
      }),
      signal: abortController.signal,
    }).catch(() => null);

    // Fallback: If server proxy is unavailable or returned 404, fall back to direct browser fetch for CORS-capable providers (Groq, OpenAI, etc.)
    if (!response || response.status === 404) {
      const directEndpoints: Record<string, string> = {
        groq: 'https://api.groq.com/openai/v1/chat/completions',
        openai: 'https://api.openai.com/v1/chat/completions',
        deepseek: 'https://api.deepseek.com/chat/completions',
        xai: 'https://api.x.ai/v1/chat/completions',
      };
      const directUrl = directEndpoints[providerId];
      if (directUrl && apiKey) {
        const defaultModels: Record<string, string> = {
          groq: 'llama-3.3-70b-versatile',
          openai: 'gpt-4o',
          deepseek: 'deepseek-chat',
          xai: 'grok-2-latest',
        };
        const directModel = configuredSubmodel || defaultModels[providerId] || 'llama-3.3-70b-versatile';
        const formattedMessages = [
          { role: 'system', content: systemPrompt },
          ...messagesPayload,
        ];
        response = await fetch(directUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: directModel,
            messages: formattedMessages,
            max_tokens: Math.min(Math.max(Number(maxTokens) || 512, 64), 4096),
            temperature: 0.85,
            stream: true,
          }),
          signal: abortController.signal,
        });
      }
    }

    if (!response || !response.ok) {
      const errJson = response ? await response.json().catch(() => ({})) : {};
      const statusStr = response ? ` (${response.status})` : '';
      const detail = errJson.error?.message || errJson.error || `${model.name} request failed${statusStr}`;
      throw new Error(detail);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response stream not readable');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const rawData = trimmed.slice(6).trim();
          if (rawData === '[DONE]') continue;
          try {
            const data = JSON.parse(rawData);
            if (data.error) {
              const errMsg = typeof data.error === 'string' ? data.error : data.error?.message || 'API error';
              throw new Error(errMsg);
            }
            // Support both internal proxy format ({ text: "..." }) and direct OpenAI/Groq SSE format ({ choices: [{ delta: { content: "..." } }] })
            const incomingText = data.text !== undefined ? data.text : (data.choices?.[0]?.delta?.content || '');
            if (incomingText) {
              if (firstTokenTime === null) {
                firstTokenTime = performance.now();
              }
              tokenCount++;
              accumulatedText += incomingText;
              onToken(incomingText, cleanModelResponse(accumulatedText));

              const now = performance.now();
              const elapsedSec = (now - startTime) / 1000;
              const tps = elapsedSec > 0 ? Math.round((tokenCount / elapsedSec) * 10) / 10 : 0;
              onTelemetry?.({
                ttftMs: Math.round(firstTokenTime - startTime),
                tokensPerSec: tps,
                totalMs: Math.round(now - startTime),
                tokenCount,
                device: 'api-provider',
              });
            }
          } catch (jsonErr) {
            if (jsonErr instanceof Error && jsonErr.message.includes('API')) {
              throw jsonErr;
            }
          }
        }
      }
    }

    const cleanedFinal = await resolveToolCallsInResponse(cleanModelResponse(accumulatedText), (p, full) => onToken(p, full));
    return cleanedFinal;
  }

  // If Cloud Ollama Model (Makron + Ollama or Self-hosted Ollama)
  if (model.family === 'ollama') {
    const endpointUrl = model.isCustomOllama
      ? loadCustomOllamaUrl()
      : (model.endpointUrl || OLLAMA_CONFIG.muxAiEndpoint);

    const targetModel = model.detectedModel || model.customModel || '';

    return await streamOllama({
      url: endpointUrl,
      model: targetModel,
      history,
      userMessage,
      maxTokens,
      customSystemPrompt,
      onToken,
      onTelemetry: (stats) => {
        onTelemetry?.({
          ttftMs: stats.ttftMs,
          tokensPerSec: stats.tokensPerSec,
          totalMs: stats.totalMs,
          tokenCount: stats.tokenCount,
          device: 'ollama',
        });
      },
    });
  }

  // In-Browser SLM (Transformers.js)
  const generator = await loadModelPipeline(model, devicePref, onProgress);
  const device = await detectBestHardwareDevice(devicePref);
  const personaPrompt = customSystemPrompt || getPersonaPrompt(model.isSmallModel);

  // Build structured chat prompt
  const conversationMessages = [
    { role: 'system', content: personaPrompt },
    ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  // Custom text streamer
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (piece: string) => {
      if (!piece) return;
      if (firstTokenTime === null) {
        firstTokenTime = performance.now();
      }
      tokenCount++;
      accumulatedText += piece;
      onToken(piece, cleanModelResponse(accumulatedText));

      const now = performance.now();
      const elapsedSec = (now - startTime) / 1000;
      const tps = elapsedSec > 0 ? Math.round((tokenCount / elapsedSec) * 10) / 10 : 0;
      onTelemetry?.({
        ttftMs: firstTokenTime ? Math.round(firstTokenTime - startTime) : 0,
        tokensPerSec: tps,
        totalMs: Math.round(now - startTime),
        tokenCount,
        device,
      });
    },
  });

  try {
    await generator(conversationMessages, {
      max_new_tokens: Math.min(maxTokens || (model.isSmallModel ? 256 : TOKEN_CONFIG.defaultTokens), TOKEN_CONFIG.sliderMax),
      temperature: 0.75,
      top_p: 0.9,
      do_sample: true,
      streamer,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('Generation error in browser SLM:', errorMsg);
    // If browser SLM crashed (e.g. out of memory or abort), provide friendly fallback
    if (accumulatedText.length === 0) {
      throw err;
    }
  }

  const finalResult = await resolveToolCallsInResponse(cleanModelResponse(accumulatedText), (p, full) => onToken(p, full));
  return finalResult;
}

export function stopCurrentGeneration(): void {
  cancelLoadRequested = true;
  isModelLoading = false;
  if (abortController) {
    try {
      abortController.abort();
    } catch {}
    abortController = null;
  }
}
