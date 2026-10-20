import React, { useState } from 'react';
import { Copy, Check, Terminal } from 'lucide-react';

export type McpTab = 'claude' | 'cursor' | 'jsonrpc' | 'act';

interface MacTerminalViewerProps {
  activeTab: McpTab;
  onChangeTab: (tab: McpTab) => void;
}

export const MacTerminalViewer: React.FC<MacTerminalViewerProps> = ({
  activeTab,
  onChangeTab,
}) => {
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://muxai.vercel.app';

  const rawSnippets: Record<McpTab, string> = {
    claude: `{\n  "mcpServers": {\n    "ai-smash": {\n      "url": "${origin}/api/mcp/sse",\n      "transport": "sse"\n    }\n  }\n}`,
    cursor: `{\n  "mcpServers": {\n    "ai-smash": {\n      "url": "${origin}/api/mcp/sse",\n      "type": "sse"\n    }\n  }\n}`,
    jsonrpc: `curl -X POST "${origin}/api/mcp" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "jsonrpc": "2.0",\n    "id": 1,\n    "method": "tools/call",\n    "params": {\n      "name": "web_search",\n      "arguments": {"query": "latest news"}\n    }\n  }'`,
    act: `curl -X POST "${origin}/api/mcp" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "jsonrpc": "2.0",\n    "id": 1,\n    "method": "tools/call",\n    "params": {\n      "name": "avatar_act",\n      "arguments": {\n        "cues": [\n          {"name":"Greeting","text":"Hello! Welcome to the secret Act Studio.","animationKey":"wave","emotionKey":"happy","durationSec":3.5},\n          {"name":"Waiting","text":"Add any speech lines or choose any Mixamo animation below.","animationKey":"wait","emotionKey":"lovey","durationSec":4.0},\n          {"name":"Silent Action","text":"","animationKey":"yawn","emotionKey":"sleepy","durationSec":3.5},\n          {"name":"Closing","text":"I will speak your script sequentially with real-time lip sync!","animationKey":"idle","emotionKey":"silly","durationSec":3.5}\n        ]\n      }\n    }\n  }'`,
  };

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(rawSnippets[activeTab]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const tabTitles: Record<McpTab, string> = {
    claude: 'claude_desktop_config.json',
    cursor: '.cursor/mcp.json',
    jsonrpc: 'mcp-jsonrpc.sh — zsh',
    act: 'avatar-act-script.sh — zsh',
  };

  return (
    <div className="rounded-2xl overflow-hidden border border-white/15 bg-[#0d1017] shadow-2xl transition-all font-mono text-xs flex flex-col">
      {/* macOS Terminal Title Bar */}
      <div className="bg-[#161a24] px-4 py-3 border-b border-white/10 flex items-center justify-between select-none">
        {/* macOS Traffic Lights */}
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] shadow-xs" />
          <div className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] shadow-xs" />
          <div className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] shadow-xs" />
        </div>

        {/* Center Title */}
        <div className="flex items-center gap-1.5 text-neutral-400 text-[11px] font-medium tracking-wide">
          <Terminal className="w-3.5 h-3.5 text-cyan-400" />
          <span>{tabTitles[activeTab]}</span>
        </div>

        {/* Copy Button */}
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-white/10 hover:bg-white/20 text-neutral-200 hover:text-white transition-all cursor-pointer active:scale-95"
          title="Copy to clipboard"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-neutral-400" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Tab Switcher Bar */}
      <div className="bg-[#12151e] px-3 py-2 border-b border-white/5 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
        <button
          type="button"
          onClick={() => onChangeTab('claude')}
          className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
            activeTab === 'claude'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5 border border-transparent'
          }`}
        >
          Claude Desktop
        </button>
        <button
          type="button"
          onClick={() => onChangeTab('cursor')}
          className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
            activeTab === 'cursor'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5 border border-transparent'
          }`}
        >
          Cursor IDE
        </button>
        <button
          type="button"
          onClick={() => onChangeTab('jsonrpc')}
          className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
            activeTab === 'jsonrpc'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5 border border-transparent'
          }`}
        >
          cURL JSON-RPC
        </button>
        <button
          type="button"
          onClick={() => onChangeTab('act')}
          className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
            activeTab === 'act'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5 border border-transparent'
          }`}
        >
          Avatar Act Script
        </button>
      </div>

      {/* Terminal Code Viewer with colored syntax and word-wrap */}
      <div className="p-4 sm:p-5 max-h-72 overflow-y-auto leading-relaxed select-text whitespace-pre-wrap break-words font-mono text-[11.5px]">
        {activeTab === 'claude' && (
          <div>
            <span className="text-neutral-500 italic block mb-1">
              // ~/.config/Claude/claude_desktop_config.json
            </span>
            <span className="text-amber-200">{'{'}</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;</span>
            <span className="text-cyan-300">"mcpServers"</span>
            <span className="text-neutral-400">: </span>
            <span className="text-amber-200">{'{'}</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-cyan-300">"ai-smash"</span>
            <span className="text-neutral-400">: </span>
            <span className="text-amber-200">{'{'}</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-cyan-300">"url"</span>
            <span className="text-neutral-400">: </span>
            <span className="text-emerald-300">"{origin}/api/mcp/sse"</span>
            <span className="text-neutral-400">,</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-cyan-300">"transport"</span>
            <span className="text-neutral-400">: </span>
            <span className="text-emerald-300">"sse"</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-amber-200">{'}'}</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;</span>
            <span className="text-amber-200">{'}'}</span>
            <br />
            <span className="text-amber-200">{'}'}</span>
            <span className="inline-block w-2 h-3.5 bg-cyan-400 ml-1.5 animate-pulse align-middle" />
          </div>
        )}

        {activeTab === 'cursor' && (
          <div>
            <span className="text-neutral-500 italic block mb-1">
              // .cursor/mcp.json (Project or Global Settings)
            </span>
            <span className="text-amber-200">{'{'}</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;</span>
            <span className="text-cyan-300">"mcpServers"</span>
            <span className="text-neutral-400">: </span>
            <span className="text-amber-200">{'{'}</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-cyan-300">"ai-smash"</span>
            <span className="text-neutral-400">: </span>
            <span className="text-amber-200">{'{'}</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-cyan-300">"url"</span>
            <span className="text-neutral-400">: </span>
            <span className="text-emerald-300">"{origin}/api/mcp/sse"</span>
            <span className="text-neutral-400">,</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-cyan-300">"type"</span>
            <span className="text-neutral-400">: </span>
            <span className="text-emerald-300">"sse"</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-amber-200">{'}'}</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;</span>
            <span className="text-amber-200">{'}'}</span>
            <br />
            <span className="text-amber-200">{'}'}</span>
            <span className="inline-block w-2 h-3.5 bg-cyan-400 ml-1.5 animate-pulse align-middle" />
          </div>
        )}

        {activeTab === 'jsonrpc' && (
          <div>
            <span className="text-neutral-500 italic block mb-1">
              # Execute tools directly via JSON-RPC 2.0 protocol
            </span>
            <span className="text-emerald-400">muxai@macbook</span>
            <span className="text-neutral-500">:</span>
            <span className="text-cyan-400">~</span>
            <span className="text-neutral-400">$ </span>
            <span className="text-amber-300 font-bold">curl</span>
            <span className="text-neutral-300"> -X POST </span>
            <span className="text-emerald-300 font-medium">"{origin}/api/mcp"</span>
            <span className="text-neutral-400"> \</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;</span>
            <span className="text-sky-300">-H</span>
            <span className="text-neutral-300"> </span>
            <span className="text-emerald-300">"Content-Type: application/json"</span>
            <span className="text-neutral-400"> \</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;</span>
            <span className="text-sky-300">-d</span>
            <span className="text-neutral-300"> </span>
            <span className="text-amber-200">'{'{'}</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-cyan-300">"jsonrpc"</span>
            <span className="text-neutral-400">: </span>
            <span className="text-emerald-300">"2.0"</span>
            <span className="text-neutral-400">,</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-cyan-300">"id"</span>
            <span className="text-neutral-400">: </span>
            <span className="text-purple-300">1</span>
            <span className="text-neutral-400">,</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-cyan-300">"method"</span>
            <span className="text-neutral-400">: </span>
            <span className="text-emerald-300">"tools/call"</span>
            <span className="text-neutral-400">,</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-cyan-300">"params"</span>
            <span className="text-neutral-400">: </span>
            <span className="text-amber-200">{'{'}</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-cyan-300">"name"</span>
            <span className="text-neutral-400">: </span>
            <span className="text-emerald-300">"web_search"</span>
            <span className="text-neutral-400">,</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-cyan-300">"arguments"</span>
            <span className="text-neutral-400">: </span>
            <span className="text-amber-200">{'{'}</span>
            <span className="text-cyan-300">"query"</span>
            <span className="text-neutral-400">: </span>
            <span className="text-emerald-300">"latest news"</span>
            <span className="text-amber-200">{'}'}</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-amber-200">{'}'}</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;</span>
            <span className="text-amber-200">{'}\''}</span>
            <span className="inline-block w-2 h-3.5 bg-cyan-400 ml-1.5 animate-pulse align-middle" />
          </div>
        )}

        {activeTab === 'act' && (
          <div>
            <span className="text-neutral-500 italic block mb-1">
              # Trigger 3D avatar animations, emotions & lip sync sequentially
            </span>
            <span className="text-emerald-400">muxai@macbook</span>
            <span className="text-neutral-500">:</span>
            <span className="text-cyan-400">~</span>
            <span className="text-neutral-400">$ </span>
            <span className="text-amber-300 font-bold">curl</span>
            <span className="text-neutral-300"> -X POST </span>
            <span className="text-emerald-300 font-medium">"{origin}/api/mcp"</span>
            <span className="text-neutral-400"> \</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;</span>
            <span className="text-sky-300">-H</span>
            <span className="text-neutral-300"> </span>
            <span className="text-emerald-300">"Content-Type: application/json"</span>
            <span className="text-neutral-400"> \</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;</span>
            <span className="text-sky-300">-d</span>
            <span className="text-neutral-300"> </span>
            <span className="text-amber-200">'{'{'}</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-cyan-300">"jsonrpc"</span>
            <span className="text-neutral-400">: </span>
            <span className="text-emerald-300">"2.0"</span>
            <span className="text-neutral-400">,</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-cyan-300">"id"</span>
            <span className="text-neutral-400">: </span>
            <span className="text-purple-300">1</span>
            <span className="text-neutral-400">,</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-cyan-300">"method"</span>
            <span className="text-neutral-400">: </span>
            <span className="text-emerald-300">"tools/call"</span>
            <span className="text-neutral-400">,</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-cyan-300">"params"</span>
            <span className="text-neutral-400">: </span>
            <span className="text-amber-200">{'{'}</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-cyan-300">"name"</span>
            <span className="text-neutral-400">: </span>
            <span className="text-emerald-300">"avatar_act"</span>
            <span className="text-neutral-400">,</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-cyan-300">"arguments"</span>
            <span className="text-neutral-400">: </span>
            <span className="text-amber-200">{'{'}</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-cyan-300">"cues"</span>
            <span className="text-neutral-400">: [</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-amber-200">{'{'}</span>
            <span className="text-cyan-300">"name"</span>: <span className="text-emerald-300">"Greeting"</span>, <span className="text-cyan-300">"text"</span>: <span className="text-emerald-300">"Hello! Welcome to the secret Act Studio."</span>, <span className="text-cyan-300">"animationKey"</span>: <span className="text-purple-300">"wave"</span>, <span className="text-cyan-300">"emotionKey"</span>: <span className="text-pink-300">"happy"</span>, <span className="text-cyan-300">"durationSec"</span>: <span className="text-yellow-300">3.5</span>
            <span className="text-amber-200">{'}'}</span>,
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-amber-200">{'{'}</span>
            <span className="text-cyan-300">"name"</span>: <span className="text-emerald-300">"Waiting"</span>, <span className="text-cyan-300">"text"</span>: <span className="text-emerald-300">"Add any speech lines or choose any Mixamo animation below."</span>, <span className="text-cyan-300">"animationKey"</span>: <span className="text-purple-300">"wait"</span>, <span className="text-cyan-300">"emotionKey"</span>: <span className="text-pink-300">"lovey"</span>, <span className="text-cyan-300">"durationSec"</span>: <span className="text-yellow-300">4.0</span>
            <span className="text-amber-200">{'}'}</span>,
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-amber-200">{'{'}</span>
            <span className="text-cyan-300">"name"</span>: <span className="text-emerald-300">"Closing"</span>, <span className="text-cyan-300">"text"</span>: <span className="text-emerald-300">"I will speak your script sequentially with real-time lip sync!"</span>, <span className="text-cyan-300">"animationKey"</span>: <span className="text-purple-300">"idle"</span>, <span className="text-cyan-300">"emotionKey"</span>: <span className="text-pink-300">"silly"</span>, <span className="text-cyan-300">"durationSec"</span>: <span className="text-yellow-300">3.5</span>
            <span className="text-amber-200">{'}'}</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-neutral-400">]</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-amber-200">{'}'}</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span className="text-amber-200">{'}'}</span>
            <br />
            <span className="text-neutral-500">&nbsp;&nbsp;</span>
            <span className="text-amber-200">{'}\''}</span>
            <span className="inline-block w-2 h-3.5 bg-cyan-400 ml-1.5 animate-pulse align-middle" />
          </div>
        )}
      </div>
    </div>
  );
};
