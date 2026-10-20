import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  ArrowRight,
  RotateCcw,
  Copy,
  Check,
  Download,
  FileText,
  Upload,
  Volume2,
  VolumeX,
  Loader2,
} from 'lucide-react';
import {
  HumanizeResult,
  executeHumanizerPipeline,
  SAMPLE_AI_ESSAY,
} from '../lib/humanizerEngine';
import { waitForPersonaVoice } from '../lib/audio';
import { VOICE_CONFIG } from '../constants';
import { ModelSelector, ALGORITHM_MODEL_SPEC } from './ModelSelector';
import { ProviderSubmodelSelector } from './ProviderSubmodelSelector';
import { LandingNavbar } from './LandingNavbar';
import { extractDocumentText } from '../lib/documentParser';
import { ModelSpec, ModelCacheInfo } from '../types';

interface HumanizerPageProps {
  onNavigateToChat: () => void;
  onNavigateToDocs: (path?: string) => void;
  onNavigateHome: () => void;
  cacheStatuses?: Record<string, ModelCacheInfo>;
}

export const HumanizerPage: React.FC<HumanizerPageProps> = ({
  onNavigateToChat,
  onNavigateToDocs,
  onNavigateHome,
  cacheStatuses = {},
}) => {
  // ----------------------------------------------------
  // States
  // ----------------------------------------------------
  const [inputText, setInputText] = useState<string>('');
  const [activeModel, setActiveModel] = useState<ModelSpec>(ALGORITHM_MODEL_SPEC);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processProgress, setProcessProgress] = useState<number>(0);
  const [isExtractingFile, setIsExtractingFile] = useState<boolean>(false);
  const [result, setResult] = useState<HumanizeResult | null>(null);
  const [showHighlights, setShowHighlights] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const followUpTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ----------------------------------------------------
  // Sequential Voice Synthesis Engine
  // Ensures voicelines play sequentially without overlapping.
  // Mute button takes immediate effect and retains unplayed lines.
  // ----------------------------------------------------
  const soundEnabledRef = useRef<boolean>(true);
  const voiceQueueRef = useRef<string[]>([]);
  const isPlayingVoiceRef = useRef<boolean>(false);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const processNextVoiceLine = async () => {
    if (!soundEnabledRef.current) {
      isPlayingVoiceRef.current = false;
      return;
    }

    if (isPlayingVoiceRef.current) {
      return;
    }

    if (voiceQueueRef.current.length === 0) {
      isPlayingVoiceRef.current = false;
      return;
    }

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    const nextLine = voiceQueueRef.current[0];
    isPlayingVoiceRef.current = true;

    try {
      const voice = await waitForPersonaVoice(1500);

      // Check again in case muted while waiting for voice
      if (!soundEnabledRef.current) {
        isPlayingVoiceRef.current = false;
        return;
      }

      const utterance = new SpeechSynthesisUtterance(nextLine);
      if (voice) {
        utterance.voice = voice;
      }
      utterance.pitch = VOICE_CONFIG.pitch || 1.15;
      utterance.rate = VOICE_CONFIG.rate || 1.05;

      utterance.onend = () => {
        // Remove finished line from queue
        voiceQueueRef.current.shift();
        isPlayingVoiceRef.current = false;

        // Schedule next voice line sequentially
        if (soundEnabledRef.current && voiceQueueRef.current.length > 0) {
          setTimeout(() => {
            processNextVoiceLine();
          }, 350);
        }
      };

      utterance.onerror = () => {
        if (!soundEnabledRef.current) {
          // Keep line in queue if aborted due to muting
          isPlayingVoiceRef.current = false;
          return;
        }
        voiceQueueRef.current.shift();
        isPlayingVoiceRef.current = false;
        if (soundEnabledRef.current && voiceQueueRef.current.length > 0) {
          setTimeout(() => {
            processNextVoiceLine();
          }, 250);
        }
      };

      window.speechSynthesis.speak(utterance);
    } catch {
      voiceQueueRef.current.shift();
      isPlayingVoiceRef.current = false;
    }
  };

  const queueVoiceLine = (line: string) => {
    if (!line) return;
    voiceQueueRef.current.push(line);
    if (soundEnabledRef.current && !isPlayingVoiceRef.current) {
      processNextVoiceLine();
    }
  };

  const toggleSound = () => {
    const nextVal = !soundEnabled;
    setSoundEnabled(nextVal);
    soundEnabledRef.current = nextVal;

    if (!nextVal) {
      // Immediately cancel speech
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      isPlayingVoiceRef.current = false;
    } else {
      // Resumed: immediately play queued unplayed lines sequentially
      if (!isPlayingVoiceRef.current && voiceQueueRef.current.length > 0) {
        processNextVoiceLine();
      }
    }
  };

  // 1. Initial Greeting when arriving at /humanizer
  useEffect(() => {
    const now = new Date();
    const hour = now.getHours();
    let timeGreeting = 'Good morning!';
    if (hour >= 12 && hour < 17) {
      timeGreeting = 'Good afternoon!';
    } else if (hour >= 17 || hour < 5) {
      timeGreeting = 'Good evening!';
    }

    const greetingLine = `${timeGreeting} Welcome to Makron Humanizer. I am Hana. Let's check your work and see if we can make it sound human.`;

    const timer = setTimeout(() => {
      queueVoiceLine(greetingLine);
    }, 600);

    return () => {
      clearTimeout(timer);
      if (followUpTimerRef.current) clearTimeout(followUpTimerRef.current);
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // ----------------------------------------------------
  // Document Upload Handler (.txt, .md, .doc, .docx, .pdf)
  // Extracts plain readable text without raw binary bytecode
  // ----------------------------------------------------
  const processUploadedFile = async (file: File) => {
    setUploadFileName(file.name);
    setIsExtractingFile(true);
    try {
      const extractedText = await extractDocumentText(file);
      setInputText(extractedText);
    } catch (err) {
      console.error('File extraction error:', err);
      const raw = await file.text();
      setInputText(raw.replace(/[^\x20-\x7E\t\r\n]/g, ' ').replace(/\s{2,}/g, ' ').trim());
    } finally {
      setIsExtractingFile(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processUploadedFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processUploadedFile(file);
    }
  };

  // ----------------------------------------------------
  // Humanize & Detection Execution with Animated Progress Slider
  // ----------------------------------------------------
  const handleProcessHumanize = async () => {
    const trimmed = inputText.trim();
    if (!trimmed || isProcessing) return;

    setIsProcessing(true);
    setProcessProgress(8);

    // Speak initial processing line sequentially
    queueVoiceLine('Alright. The document is now being processed.');

    // Animate progress slider across the input button background
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = setInterval(() => {
      setProcessProgress((prev) => {
        if (prev < 30) return prev + 6;
        if (prev < 70) return prev + 4;
        if (prev < 90) return prev + 2;
        return prev;
      });
    }, 180);

    try {
      const humanizeResult = await executeHumanizerPipeline(trimmed, activeModel.id);

      setProcessProgress(100);
      setResult(humanizeResult);

      const originalAiPct = humanizeResult.originalDetection.aiPercentage;

      // Variable voiceline based on AI detection percentage
      let completionVoiceLine = '';
      if (originalAiPct > 65) {
        completionVoiceLine =
          "Oh dear, that's a lot of AI generated text. Luckily we have it sorted out for you.";
      } else if (originalAiPct >= 35) {
        completionVoiceLine =
          'Ah, a fair amount of AI text, huh? No worries, love, here you go. The text has been humanized!';
      } else {
        completionVoiceLine =
          'Hmm, not a lot of AI content here but we can improve that. Here. Something more organic and humanly.';
      }

      // Queue verdict line
      queueVoiceLine(completionVoiceLine);

      // Follow-up 10-second timer voiceline
      if (followUpTimerRef.current) clearTimeout(followUpTimerRef.current);
      followUpTimerRef.current = setTimeout(() => {
        queueVoiceLine(
          'Thank you for visiting! You can also come and chat with me if you want. The button is right there.'
        );
      }, 10000);
    } catch (err) {
      console.error('Humanizer processing error:', err);
    } finally {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      setTimeout(() => {
        setIsProcessing(false);
        setProcessProgress(0);
      }, 400);
    }
  };

  // Retry / Reset everything
  const handleReset = () => {
    setInputText('');
    setResult(null);
    setUploadFileName(null);
    setProcessProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (followUpTimerRef.current) clearTimeout(followUpTimerRef.current);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
  };

  // Load sample text
  const handleLoadSample = () => {
    setInputText(SAMPLE_AI_ESSAY);
    setUploadFileName(null);
  };

  // Copy output
  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.rawHumanizedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Download DOC format (.doc)
  const handleDownloadDoc = () => {
    if (!result) return;
    const header =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8"><title>Makron Humanized Document</title><style>body{font-family:Calibri,sans-serif;line-height:1.6;font-size:12pt;}h1{color:#1e2029;font-size:16pt;border-bottom:1px solid #ccc;padding-bottom:6px;}</style></head><body>' +
      '<h1>Humanized Document — Makron AI Detector & Humanizer</h1>' +
      `<p><em>AI Detection Score: ${result.humanizedText.aiPercentage}% AI</em></p><hr/>` +
      `<p>${result.rawHumanizedText.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')}</p>` +
      '</body></html>';

    const blob = new Blob([header], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `humanized_${uploadFileName ? uploadFileName.replace(/\.[^.]+$/, '') : 'document'}.doc`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Download PDF / Print Formatted View
  const handleDownloadPdf = () => {
    if (!result) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Humanized Document - Makron</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #1e2029; line-height: 1.7; font-size: 14px; }
            .header { border-bottom: 2px solid #55d2f6; padding-bottom: 12px; margin-bottom: 24px; }
            .badge { display: inline-block; padding: 4px 10px; background: #e0f2fe; color: #0369a1; border-radius: 9999px; font-weight: 600; font-size: 12px; }
            .content { white-space: pre-wrap; margin-top: 20px; font-size: 14px; }
            .footer { margin-top: 40px; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 12px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h2 style="margin:0 0 6px 0;">Makron Humanizer Document Report</h2>
            <span class="badge">AI Detection Score: ${result.humanizedText.aiPercentage}% AI</span>
          </div>
          <div class="content">${result.rawHumanizedText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
          <div class="footer">Processed by Makron AI Detector & Humanizer. Ready for academic and professional submission.</div>
          <script>window.onload = function() { window.print(); }</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Download Plain Text (.txt)
  const handleDownloadTxt = () => {
    if (!result) return;
    const blob = new Blob([result.rawHumanizedText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `humanized_${uploadFileName ? uploadFileName.replace(/\.[^.]+$/, '') : 'document'}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#f8f9fc] text-[#1e2029] font-sans selection:bg-[#55d2f6]/20 selection:text-[#1e2029]">
      {/* ----------------------------------------------------
          Intact Top Navbar from Landing Page (Shared Component)
          ---------------------------------------------------- */}
      <LandingNavbar
        onStartChat={onNavigateToChat}
        onNavigateToDocs={onNavigateToDocs}
        onNavigateHome={onNavigateHome}
      />

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Subtitle & Voice Mute/Unmute Tool */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider font-mono">
              AI Detector & Humanizer
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleSound}
              title={soundEnabled ? 'Mute Hana Voice' : 'Unmute Hana Voice'}
              className="px-2.5 py-1.5 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 text-xs font-medium text-neutral-600 transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              {soundEnabled ? (
                <>
                  <Volume2 className="w-3.5 h-3.5 text-[#0f9bc7]" />
                  <span className="hidden sm:inline">Voice On</span>
                </>
              ) : (
                <>
                  <VolumeX className="w-3.5 h-3.5 text-neutral-400" />
                  <span className="hidden sm:inline">Voice Muted</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* ----------------------------------------------------
            Split View: Before & After Analysis
            Automatically side-by-side on wide screens, top-bottom on narrow
            ---------------------------------------------------- */}
        {result ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left/Top: Original (Before Humanizing) */}
              <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm flex flex-col overflow-hidden">
                {/* Header Card */}
                <div className="px-5 py-4 border-b border-neutral-100 bg-neutral-50/70 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                    <span className="font-bold text-xs uppercase tracking-wider text-neutral-700">
                      Before
                    </span>
                  </div>
                  {/* AI Score Badge (Pill alone) */}
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                        result.originalDetection.aiPercentage > 50
                          ? 'bg-rose-100 text-rose-700 border border-rose-300'
                          : 'bg-amber-100 text-amber-700 border border-amber-300'
                      }`}
                    >
                      {result.originalDetection.aiPercentage}% AI Detected
                    </span>
                  </div>
                </div>

                {/* Turnitin Stats Bar */}
                <div className="px-5 py-2.5 bg-neutral-100/50 border-b border-neutral-100 grid grid-cols-4 gap-2 text-center text-[11px]">
                  <div>
                    <span className="text-neutral-400 block">Burstiness</span>
                    <span className="font-semibold text-neutral-800">
                      {result.originalDetection.burstinessScore}/100
                    </span>
                  </div>
                  <div>
                    <span className="text-neutral-400 block">Avg Sent. Len</span>
                    <span className="font-semibold text-neutral-800">
                      {result.originalDetection.averageSentenceLength} words
                    </span>
                  </div>
                  <div>
                    <span className="text-neutral-400 block">AI Clichés</span>
                    <span className="font-semibold text-rose-600">
                      {result.originalDetection.flaggedPhrasesCount} found
                    </span>
                  </div>
                  <div>
                    <span className="text-neutral-400 block">Word Count</span>
                    <span className="font-semibold text-neutral-800">
                      {result.originalDetection.wordCount}
                    </span>
                  </div>
                </div>

                {/* Text Container with Highlights */}
                <div className="p-5 flex-1 min-h-[280px] max-h-[480px] overflow-y-auto text-sm leading-relaxed font-sans text-neutral-800 space-y-2">
                  {showHighlights ? (
                    result.originalDetection.sentences.map((sent, idx) => (
                      <span
                        key={idx}
                        className={
                          sent.isSuspicious
                            ? 'bg-rose-100/80 text-rose-900 border-b-2 border-rose-400 px-0.5 rounded cursor-help transition-colors'
                            : ''
                        }
                        title={sent.reason || undefined}
                      >
                        {sent.text}{' '}
                      </span>
                    ))
                  ) : (
                    <p className="whitespace-pre-wrap">{inputText}</p>
                  )}
                </div>

                {/* Footer Actions */}
                <div className="px-5 py-3 border-t border-neutral-100 bg-neutral-50/50 flex items-center justify-between text-xs text-neutral-500">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showHighlights}
                      onChange={(e) => setShowHighlights(e.target.checked)}
                      className="rounded border-neutral-300 text-[#0f9bc7] focus:ring-[#0f9bc7]"
                    />
                    <span>Highlight AI Markers</span>
                  </label>
                  <span className="text-rose-600 font-medium">
                    Status: {result.originalDetection.verdict}
                  </span>
                </div>
              </div>

              {/* Right/Bottom: Humanized Result (After) */}
              <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm flex flex-col overflow-hidden">
                {/* Header Card */}
                <div className="px-5 py-4 border-b border-neutral-100 bg-emerald-50/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span className="font-bold text-xs uppercase tracking-wider text-emerald-800">
                      After
                    </span>
                  </div>
                  {/* AI Score Badge (Pill alone) */}
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-300 flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      <span>{result.humanizedText.aiPercentage}% AI</span>
                    </span>
                  </div>
                </div>

                {/* Stats Bar */}
                <div className="px-5 py-2.5 bg-emerald-50/20 border-b border-neutral-100 grid grid-cols-4 gap-2 text-center text-[11px]">
                  <div>
                    <span className="text-neutral-400 block">Burstiness</span>
                    <span className="font-semibold text-emerald-600">
                      {result.humanizedText.burstinessScore}/100 (+{result.humanizedText.burstinessScore - result.originalDetection.burstinessScore})
                    </span>
                  </div>
                  <div>
                    <span className="text-neutral-400 block">AI Reduction</span>
                    <span className="font-semibold text-emerald-600">
                      -{result.reductionPercentage}%
                    </span>
                  </div>
                  <div>
                    <span className="text-neutral-400 block">Perplexity</span>
                    <span className="font-semibold text-neutral-800">
                      {result.humanizedText.perplexityEstimate}/100
                    </span>
                  </div>
                  <div>
                    <span className="text-neutral-400 block">Engine</span>
                    <span className="font-semibold text-neutral-800 truncate" title={result.methodUsed}>
                      {result.methodUsed.split(' ')[0]}
                    </span>
                  </div>
                </div>

                {/* Humanized Output Text */}
                <div className="p-5 flex-1 min-h-[280px] max-h-[480px] overflow-y-auto text-sm leading-relaxed font-sans text-neutral-800 whitespace-pre-wrap selection:bg-emerald-100">
                  {result.rawHumanizedText}
                </div>

                {/* Footer Export & Download Toolbar */}
                <div className="px-5 py-3 border-t border-neutral-100 bg-neutral-50/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                  {/* Export Options */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700 font-semibold transition-all cursor-pointer"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-emerald-600">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleDownloadDoc}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700 font-semibold transition-all cursor-pointer"
                      title="Export as Microsoft Word (.doc)"
                    >
                      <FileText className="w-3.5 h-3.5 text-blue-600" />
                      <span>DOC</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleDownloadPdf}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700 font-semibold transition-all cursor-pointer"
                      title="Export as PDF Document Report"
                    >
                      <Download className="w-3.5 h-3.5 text-rose-600" />
                      <span>PDF</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleDownloadTxt}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700 font-medium transition-all cursor-pointer"
                      title="Export as plain text (.txt)"
                    >
                      <span>.TXT</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Prominent Try Another Button Below Result */}
            <div className="flex justify-center pt-2 pb-4">
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-neutral-900 text-white font-semibold text-sm hover:bg-neutral-800 active:scale-95 transition-all shadow-sm cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Try Another</span>
              </button>
            </div>
          </div>
        ) : (
          /* ----------------------------------------------------
              Special Chat Input Panel (Only shown when no result)
              ---------------------------------------------------- */
          <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs uppercase tracking-wider text-neutral-500 font-heading">
                  Input Text or Attach Document
                </span>
                {isExtractingFile && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-600 border border-amber-200 flex items-center gap-1 animate-pulse">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Extracting text...</span>
                  </span>
                )}
                {uploadFileName && !isExtractingFile && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-sky-50 text-[#0f9bc7] border border-sky-200 flex items-center gap-1">
                    <FileText className="w-3 h-3" />
                    <span>{uploadFileName}</span>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* Quick sample button */}
                <button
                  type="button"
                  onClick={handleLoadSample}
                  className="px-2.5 py-1 rounded-xl text-xs font-semibold text-[#0f9bc7] bg-sky-50 hover:bg-sky-100 transition-colors cursor-pointer"
                >
                  Paste Sample Essay
                </button>

                {/* Upload file trigger (.txt, .md, .doc, .docx, .pdf) */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.doc,.docx,.pdf"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2.5 py-1 rounded-xl text-xs font-semibold text-neutral-600 bg-neutral-100 hover:bg-neutral-200 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Upload className="w-3 h-3" />
                  <span>Upload Document</span>
                </button>
              </div>
            </div>

            {/* Text Area */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="relative border border-neutral-200 rounded-xl overflow-hidden focus-within:border-[var(--theme-accent,#0f9bc7)] focus-within:ring-2 focus-within:ring-[var(--theme-accent,#0f9bc7)]/20 transition-all bg-neutral-50/50"
            >
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Paste your AI-generated text or drag and drop a document here (.txt, .md, .doc, .docx, .pdf)..."
                rows={8}
                className="w-full p-4 text-sm font-sans text-neutral-900 placeholder:text-neutral-400 bg-transparent resize-y outline-none leading-relaxed"
              />

              <div className="px-4 py-2 bg-white border-t border-neutral-100 flex items-center justify-between text-[11px] text-neutral-400">
                <div className="flex items-center gap-3">
                  <span>
                    Words:{' '}
                    <strong className="text-neutral-700">
                      {inputText.trim() ? inputText.trim().split(/\s+/).length : 0}
                    </strong>
                  </span>
                  <span>
                    Characters:{' '}
                    <strong className="text-neutral-700">{inputText.length}</strong>
                  </span>
                </div>
                <span className="hidden sm:inline">
                  Supports Turnitin, GPTZero, CopyLeaks & ZeroGPT bypass
                </span>
              </div>
            </div>

            {/* Bottom Bar: Reusable Model Selector (like /chat) & Progress Slider Input Button */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
              {/* Reusable Model Selector & Submodel Selector from /chat */}
              <div className="flex items-center gap-2 flex-wrap">
                <ModelSelector
                  activeModel={activeModel}
                  cacheStatuses={cacheStatuses}
                  onSelectModel={setActiveModel}
                  disabled={isProcessing}
                  includeAlgorithmOption={true}
                  onNavigateToDocs={onNavigateToDocs}
                />

                {activeModel.family === 'api-provider' && (
                  <ProviderSubmodelSelector
                    activeModel={activeModel}
                    onUpdateModel={setActiveModel}
                    disabled={isProcessing}
                    onNavigateToDocs={onNavigateToDocs}
                  />
                )}
              </div>

              {/* Clear and Submit Button with Colored Slider Fill Progress Indicator */}
              <div className="flex items-center gap-2">
                {inputText.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={handleReset}
                    disabled={isProcessing}
                    className="px-3 py-2 rounded-xl border border-neutral-200 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Clear
                  </button>
                )}

                {/* Submit button with horizontal colored slider progress fill */}
                <button
                  type="button"
                  onClick={handleProcessHumanize}
                  disabled={!inputText.trim() || isProcessing}
                  className="relative overflow-hidden flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold bg-[#1e2029] text-white hover:bg-neutral-800 disabled:opacity-50 disabled:pointer-events-none shadow-md active:scale-95 transition-all cursor-pointer min-w-[190px]"
                >
                  {/* Horizontal Progress Slider in button background */}
                  {isProcessing && (
                    <div
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#0f9bc7] via-[#22d3ee] to-[#38bdf8] transition-all duration-300 ease-out pointer-events-none"
                      style={{ width: `${processProgress}%` }}
                    />
                  )}

                  {/* Inner button contents */}
                  <div className="relative z-10 flex items-center justify-center gap-2">
                    {isProcessing ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin shrink-0" />
                        <span>Processing... ({processProgress}%)</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-[#55d2f6]" />
                        <span>Humanize & Check AI</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
