import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Camera,
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  Sparkles,
  UserCheck,
  ChevronRight,
  Shield,
  FileText,
  Award,
  Download,
  Trash2,
  Calendar,
  Send,
  Eye,
  Check,
  Copy,
  ArrowLeft,
  Settings2,
  ExternalLink,
  Info,
  Upload,
  FileUp,
  FileCheck,
  Monitor,
  RefreshCw,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { VRMCanvas } from './VRMCanvas';
import { soundManager, waitForPersonaVoice, getPersonaVoice } from '../lib/audio';
import { AI_PROFILE, SPEECH_RECOGNITION_CONFIG, OLLAMA_CONFIG } from '../constants';
import { AvatarEmotion } from '../lib/emotionDetector';
import { lipSyncManager } from '../lib/lipSync';
import { pingOllama, streamOllama } from '../lib/ollama';
import { loadCustomOllamaUrl } from '../lib/storage';
import { InterviewDashboard, InterviewDashboardRecord } from './InterviewDashboard';
import { AccountUser } from '../types';

export interface InterviewPageProps {
  onNavigateHome: () => void;
  onNavigateToChat: () => void;
  onNavigateToInterview?: (id?: string) => void;
  isPremium?: boolean;
  onRequirePremium?: () => void;
  accountUser?: AccountUser | null;
  currentPath?: string;
}

type InterviewStage = 'lobby' | 'meeting' | 'candidate_complete' | 'recruiter_review';

type MeetingPhase =
  | 'joining'
  | 'welcome'
  | 'question_1'
  | 'question_2'
  | 'task_resume'
  | 'task_written'
  | 'task_pressure'
  | 'task_snapshot'
  | 'candidate_qa'
  | 'wrapup';

interface SnapshotItem {
  id: string;
  angle: 'forward' | 'left' | 'right';
  label: string;
  dataUrl: string;
  timestamp: string;
}

interface QuestionResponse {
  phase: string;
  question: string;
  answer: string;
  timestamp: string;
  aiNotes?: string;
}

interface UploadedResume {
  fileName: string;
  fileSize: string;
  fileType: string;
  dataUrl: string;
  uploadedAt: string;
  textContent?: string;
}

const STORAGE_KEY = 'hana_interview_session_data';
const SCENARIO_CONFIG_STORAGE_KEY = 'hana_interview_scenario_config';

export interface InterviewScenarioConfig {
  openQuestionSilenceSeconds: number; // default 3.0s (as requested)
  qaSilenceSeconds: number; // default 5.0s (as requested)
  activeSilenceVoiceline: string;
  silenceVoicelineOptions: string[];
  minWordsForOpenQuestionSilence: number; // default 6 words (5-8 words demo config)
  minCharsForOpenQuestionAdvance: number;
  showHana3DModel: boolean; // Recruiter toggle for 3D model
}

const DEFAULT_SCENARIO_CONFIG: InterviewScenarioConfig = {
  openQuestionSilenceSeconds: 3.0,
  qaSilenceSeconds: 5.0,
  activeSilenceVoiceline: "I am assuming you have nothing else to say for now so let's move on to the next step.",
  silenceVoicelineOptions: [
    "I am assuming you have nothing else to say for now so let's move on to the next step.",
    "Thank you for sharing that context. Let's move on to the next step.",
    "Got it, that gives me good context. Let's continue forward.",
    "Understood. That covers this part well, let's proceed to the next step.",
    "Appreciated! I have logged those details. Let's transition to the next phase.",
    "Wonderful, thank you for walking me through that. Let's move right along.",
  ],
  minWordsForOpenQuestionSilence: 6, // 5-8 words demo config
  minCharsForOpenQuestionAdvance: 10,
  showHana3DModel: true,
};

// Varied transition voicelines to ensure unique, natural recruiter speech across phases
const TRANSITION_VOICELINES = {
  silenceAdvance: [
    "I am assuming you have nothing else to say for now so let's move on to the next step.",
    "Thank you for sharing that context. Let's move on to the next step.",
    "Got it, that gives me good context. Let's continue forward.",
    "Understood. That covers this part well, let's proceed to the next step.",
    "Appreciated! I have noted your response in the dossier. Moving right along.",
    "Wonderful, thank you for walking me through that. Let's move forward to the next part.",
  ],
  doneAcknowledgment: [
    "Got it, thank you for confirming you are finished with that answer! Let's move right along.",
    "Understood! I have logged your complete response. Let's proceed to the next step.",
    "Perfect, thank you for wrapping up that point. Let's transition to the next part.",
    "Thank you for letting me know you are done! Moving forward to our next phase.",
    "All noted! Since that covers your answer, let's continue to the next stage.",
  ],
  question1Intro: [
    "Let's begin with a quick introduction. Could you tell me a bit about yourself, your background, and what drives your passion for this role?",
    "To kick things off, I'd love to learn more about you. Could you walk me through your background and what excites you most about this opportunity?",
    "Let's start with an introduction. Tell me about your journey so far, your core strengths, and what motivates you in this field.",
  ],
  question2Intro: [
    "Thank you. Now, could you walk me through a challenging technical problem or project you tackled recently? How did you approach resolving it?",
    "Great context. Next, could you share a complex engineering challenge you faced recently and the steps you took to solve it?",
    "I appreciate that overview. For our second question, tell me about a tough technical obstacle or system problem you debugged and how you brought it to resolution.",
  ],
  taskResumeIntro: [
    "Before we proceed to written tasks, let's review your credentials. Please upload your updated resume or CV document so we have the latest version on file for our recruiting team.",
    "Now let's pull up the credentials panel. Please upload your current resume or CV on the right so our recruiting system can attach it to your session dossier.",
    "Let's transition to our first interactive task. In the panel I just opened, please upload your latest resume or CV document.",
  ],
  taskResumeDone: [
    "Thank you! I've received your updated document. Now let's move forward to the written reflection task.",
    "Awesome, your resume is securely attached to your profile. Let's switch the panel over to the written reflection exercise.",
    "Got your document on file! Let's transition to the next task on your screen: a short written reflection.",
  ],
  taskWrittenIntro: [
    "Next, we have a short written reflection task. In the spotlight panel on your right, please write down three things you like about yourself and why. Take your time, and submit when you have at least 100 characters.",
    "Here is our written reflection prompt. In the task panel, please share three qualities you value in yourself and why, using at least 100 characters.",
    "I've updated the task panel for your written reflection. Please write down three strengths or traits you appreciate about yourself and hit submit once you reach 100 characters.",
  ],
  taskWrittenDone: [
    "Excellent self-reflection. I've recorded your response. Let's move on to the situational pressure rating.",
    "Thank you for that thoughtful reflection! I've saved it to your dossier. Now let's switch to our situational pressure check.",
    "Great insights—I have logged your written response. Let's bring up the situational pressure assessment next.",
  ],
  taskPressureIntro: [
    "Great. Now we have a quick situational question. In the spotlight panel, select the rating that most accurately reflects how you perform under intense project pressure.",
    "Next up is a quick situational check. Looking at the options in the task panel, choose the statement that best matches how you handle high-pressure deadlines.",
    "I've switched the panel to our situational behavior check. Please pick the option that most honestly describes how you operate under project pressure.",
  ],
  taskPressureDone: [
    "Noted! Next up, we will do a fast visual verification sequence.",
    "Got your selection recorded! Now let's switch the panel to our final interactive step: visual identity verification.",
    "Thank you, I've logged that rating. Let's pull up the camera verification panel for three quick angle snapshots.",
  ],
  taskSnapshotIntro: [
    "For fun and identity verification, please write down your phone number on a small piece of paper. First, hold it up and look directly forward, then say 'click' or 'ready' when you're set.",
    "Here is our visual liveness check. Please hold up a small piece of paper with your phone number or test digits, face forward, and say 'click' or 'ready' to snap the first photo.",
    "Let's complete our multi-angle verification. Hold up your paper note, look straight ahead at the camera, and say 'click' whenever you are ready.",
  ],
  taskSnapshotStep2: [
    "Awesome shot. Now, keep holding up the paper, turn your head slightly to the left, and say 'click' or 'ready'.",
    "Great first frame! Next, keep the note visible, angle your head slightly to the left, and say 'click' when ready.",
    "Forward pose captured! Now turn slightly to your left while holding the paper and say 'click' or 'do it'.",
  ],
  taskSnapshotStep3: [
    "Got it! Lastly, turn your head slightly to the right while holding the paper, and say 'click' or 'do it'.",
    "Nice! For the third and final angle, turn your head slightly to the right and say 'click' or 'ready'.",
    "Left angle verified! One last shot—turn slightly to your right with the note and say 'click'.",
  ],
  taskSnapshotDone: [
    "Perfect! All three identity frames are captured and verified. Now let's open the floor for any questions you might have.",
    "All three verification angles are locked in! Let's close the task panel and move into our open Q and A session.",
    "Fantastic, visual verification is complete. Let's transition to the final Q and A portion of our interview.",
  ],
  qaIntroFallback: [
    "Thank you for completing all spotlight tasks. Now, do you have any questions for me or our recruiting team about the role or MuxAI?",
    "You have completed every assessment task! Before we wrap up, what questions do you have for me about MuxAI, our engineering team, or the role?",
    "Great job on all the tasks today. I'd love to open the floor now—do you have any questions about working at MuxAI or what comes next?",
  ],
  qaCheckMore: [
    "Is that all, or do you have any other questions for me?",
    "Do you have any other questions about the role or MuxAI, or does that cover everything?",
    "Would you like to ask anything else before we wrap up our session?",
  ],
  qaConclude: [
    "I am assuming that covers everything for now, so let's move on to conclude our interview session.",
    "Alright, it looks like we've covered all your questions! Let's wrap up our interview session.",
    "Wonderful, thank you for those thoughtful questions! Let's bring our session to a close.",
  ],
  wrapupFinal: [
    "Thank you so much for your time today. It was a pleasure speaking with you. Our recruiting team will review your session dossier and reach out with next steps soon. Have a wonderful day!",
    "Thank you again for joining me today and completing the interview! I've compiled your full evaluation dossier for our hiring team, and you'll hear back from us very soon. Take care!",
    "It was truly a pleasure interviewing you today. Your responses and tasks have been saved for our engineering leadership review. Wishing you a fantastic rest of your day!",
  ],
};

// MuxAI Company & Engineering RAG Knowledge Base for Q&A Session
interface RagDocumentChunk {
  id: string;
  title: string;
  keywords: string[];
  content: string;
}

const MUXAI_COMPANY_KNOWLEDGE_BASE: RagDocumentChunk[] = [
  {
    id: 'company_mission',
    title: 'MuxAI Company Overview & Mission',
    keywords: ['muxai', 'company', 'mission', 'vision', 'what does', 'about', 'product', 'platform', 'hana', 'who are you', 'build'],
    content:
      'MuxAI is an AI research and product engineering company building decentralized, self-hosted, and browser-native multimodal AI platforms. Our flagship companion and interviewer persona, Hana, integrates real-time 3D VRM WebGL rendering, low-latency voice synthesis, WebGPU/WASM small language models, and distributed Ollama inference nodes.',
  },
  {
    id: 'tech_stack_architecture',
    title: 'Engineering Tech Stack & System Architecture',
    keywords: ['stack', 'tech', 'technology', 'architecture', 'code', 'language', 'framework', 'react', 'three', 'webgl', 'vrm', 'database', 'backend', 'frontend', 'infrastructure', 'ai', 'llm', 'models', 'ollama'],
    content:
      'Our core stack uses TypeScript, React 19, Three.js / WebGL (@pixiv/three-vrm) for 60fps real-time 3D character animation and phoneme lip-syncing, Node.js/Express and serverless edge endpoints, Neon PostgreSQL for persistence, and a hybrid inference layer combining browser WebGPU (@huggingface/transformers) with self-hosted MuxAI Ollama GPU clusters.',
  },
  {
    id: 'engineering_culture',
    title: 'Engineering Culture, Autonomy & Day-to-Day Workflow',
    keywords: ['culture', 'day', 'daily', 'workflow', 'work', 'life', 'balance', 'hours', 'sprint', 'agile', 'autonomy', 'team', 'size', 'collaborate', 'management', 'meetings', 'environment', 'routine', 'typical'],
    content:
      'MuxAI operates with a high-ownership, low-bureaucracy engineering culture. Engineers work in small autonomous pods of 3 to 5 builders with direct ownership from architecture to production deployment. We keep synchronous meetings minimal, rely on clear RFCs and async demos, and ship to production daily.',
  },
  {
    id: 'remote_location_policy',
    title: 'Remote-First Policy, Hours & Global Collaboration',
    keywords: ['remote', 'hybrid', 'office', 'location', 'relocate', 'country', 'timezone', 'time zone', 'async', 'flexible', 'where', 'work from home', 'wfh'],
    content:
      'MuxAI is 100% remote-first across global timezones. Engineers have flexible schedules with 3 to 4 hours of core async/sync overlap for design reviews and pairing. We provide a $2,500 home office & GPU hardware setup stipend plus co-working space reimbursement.',
  },
  {
    id: 'compensation_benefits',
    title: 'Compensation, Salary, Equity & Benefits Package',
    keywords: ['salary', 'compensation', 'pay', 'money', 'equity', 'stock', 'options', 'benefits', 'health', 'insurance', 'pto', 'vacation', 'bonus', 'stipend', 'offer', 'package'],
    content:
      'MuxAI offers top-of-market base salary bands benchmarked to San Francisco/NYC tiers regardless of location, meaningful early-stage equity with flexible exercise windows, comprehensive medical/dental/vision coverage, unlimited paid time off with a mandatory 4-week minimum vacation policy, and annual learning/compute stipends.',
  },
  {
    id: 'interview_next_steps',
    title: 'Hiring Process, Timeline & Next Steps After Screening',
    keywords: ['next', 'step', 'steps', 'process', 'timeline', 'hear back', 'when', 'rounds', 'decision', 'recruiter', 'follow up', 'feedback', 'how long', 'stages', 'offer', 'after this'],
    content:
      'After this automated screening with Hana, our engineering hiring team reviews your session dossier within 24 to 48 hours. Shortlisted candidates advance to a 45-minute technical architecture deep-dive with a Staff Engineer, followed by a brief founder alignment chat and an offer decision within one week.',
  },
  {
    id: 'growth_mentorship_roadmap',
    title: 'Career Growth, Mentorship & 2026 Product Roadmap',
    keywords: ['growth', 'career', 'promotion', 'mentor', 'learning', 'roadmap', 'future', 'challenges', 'projects', 'impact', 'first 90 days', 'onboarding', 'success'],
    content:
      'In your first 30 to 90 days, you will ship core features across our real-time multimodal pipeline, 3D avatar studio, and autonomous agent runtime. Every engineer pairs with a Principal/Staff mentor, has dedicated R&D exploration Fridays, and can grow along either the Staff IC track or Engineering Leadership track.',
  },
];

function buildMuxAiQaRagPrompt(candidateQuestion: string, targetRole: string, candidateName: string): string {
  const lowerQ = candidateQuestion.toLowerCase();
  const scoredChunks = MUXAI_COMPANY_KNOWLEDGE_BASE.map((doc) => {
    let score = 0;
    for (const kw of doc.keywords) {
      if (lowerQ.includes(kw)) score += 2;
    }
    return { doc, score };
  }).sort((a, b) => b.score - a.score);

  const topDocs = scoredChunks.slice(0, 4).map((item) => `[${item.doc.title}]: ${item.doc.content}`).join('\n');

  return [
    `You are Hana, the AI Technical Recruiter and Interviewer at MuxAI, conducting the live Q&A phase of an interview for the "${targetRole}" position${candidateName ? ` with candidate ${candidateName}` : ''}.`,
    `Use the following retrieved MuxAI Company Knowledge Base (RAG Context) to answer the candidate's question accurately, smartly, and conversationally:`,
    `--- MUXAI RAG KNOWLEDGE BASE ---`,
    topDocs,
    `--- END KNOWLEDGE BASE ---`,
    `Instructions:`,
    `- Speak directly to the candidate in first-person as Hana from MuxAI.`,
    `- Keep your spoken response concise, warm, authoritative, and natural for live voice synthesis (2 to 4 sentences max, plain text only, no markdown bullets or asterisks).`,
  ].join('\n');
}

function generateSmartQaFallbackAnswer(questionText: string, targetRole: string): string {
  const lower = questionText.toLowerCase();

  if (/(salary|compensation|pay|equity|benefits|offer|package|stipend|pto|vacation|insurance)/i.test(lower)) {
    return "Compensation packages at MuxAI are top-of-market and include competitive base pay, meaningful early-stage equity grants, a dedicated home office and GPU hardware stipend, and comprehensive health and wellness benefits. Exact figures are tailored to your level during the offer phase.";
  }
  if (/(remote|location|hybrid|office|timezone|time zone|hours|schedule|flexible|work from home|wfh|async)/i.test(lower)) {
    return "We operate with a 100% remote-first, globally distributed engineering team. We prioritize asynchronous communication, clear technical RFCs, and outcome-based productivity rather than rigid office hours.";
  }
  if (/(stack|tech|technology|architecture|tools|framework|language|code|model|llm|vrm|three|webgl|database|infrastructure)/i.test(lower)) {
    return `For the ${targetRole} position, our tech stack centers around TypeScript, React 19, Three.js WebGL and 3D VRM engines, Node.js, Neon PostgreSQL, and hybrid AI inference combining browser WebGPU with our self-hosted MuxAI Ollama GPU clusters.`;
  }
  if (/(day|daily|routine|typical day|culture|team|workflow|sprint|management|autonomy|meetings|work life)/i.test(lower)) {
    return "A typical day starts with an asynchronous standup, followed by deep focus time in small autonomous pods of three to five engineers. We keep synchronous meetings minimal and empower builders to own architecture and ship to production daily.";
  }
  if (/(next step|timeline|process|hear back|when|rounds|feedback|decision|stages|after this)/i.test(lower)) {
    return "Following this session, our recruitment and engineering panel will review your completed dossier, tasks, and responses within 24 to 48 hours. Shortlisted candidates advance to a technical architecture deep-dive with a Staff Engineer.";
  }
  if (/(growth|career|mentor|onboarding|first 90|roadmap|future|project|challenge|impact)/i.test(lower)) {
    return "In your first 90 days, you will pair with a Staff mentor and ship core improvements to our real-time multimodal companion runtime and autonomous recruiting suite, with dedicated R&D time to pioneer new AI capabilities.";
  }

  return "That's a great question. At MuxAI, our engineering culture emphasizes high agency, rapid iteration, and direct ownership of autonomous multimodal agent systems. We value pragmatic architecture, transparent communication, and continuous learning.";
}

// Smart layer of decision-making: detects when candidate explicitly says they are done or finished
function detectCandidateFinishedIntent(text: string, phase: MeetingPhase): boolean {
  const clean = text.trim().toLowerCase();
  if (!clean) return false;

  const explicitDoneRegex =
    /\b(i'?m done|i am done|that'?s all|that is all|that'?s it|that is it|that'?s everything|that is everything|nothing else|no more to say|i have finished|i'?ve finished|that concludes my answer|that covers it|that'?s my answer|that is my answer|all done|done speaking|i'?m finished|i am finished|finished answering|move on|next question please|ready for the next question|that wraps it up)\b/i;

  if (phase === 'candidate_qa') {
    const qaDoneRegex =
      /\b(no|nope|nah|none|nothing|not right now|i'?m good|i am good|all good|no questions|no more questions|that'?s all|that is all|no that'?s all|that'?s it|i don'?t have any|i do not have any|we are good|we'?re good|no thank you|no thanks|nothing from me|nothing further|i'?m all set|i am all set|done with questions|no other questions)\b/i;
    const hasQuestionWord = /\b(what|how|when|where|why|who|which|can you|could you|tell me|is there|are there|do you|does the)\b/i.test(clean);
    if ((qaDoneRegex.test(clean) || explicitDoneRegex.test(clean)) && (!clean.includes('?') && (!hasQuestionWord || clean.length < 48))) {
      return true;
    }
    return false;
  }

  return explicitDoneRegex.test(clean);
}

// Lenient fuzzy matching so candidate can naturally say ready/agree phrases
function calculateAgreementMatch(spoken: string): number {
  const cleanSpoken = spoken.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleanSpoken) return 0;

  // Exact or very close
  if (
    cleanSpoken.includes('ready to start my interview') ||
    cleanSpoken.includes('ready to start') ||
    cleanSpoken.includes('i agree to the rules') ||
    cleanSpoken.includes('agree to the rules') ||
    cleanSpoken.includes('ready')
  ) {
    if (cleanSpoken.includes('ready') && (cleanSpoken.includes('interview') || cleanSpoken.includes('agree') || cleanSpoken.includes('start'))) {
      return 100;
    }
  }

  const targetWords = ['i', 'am', 'ready', 'to', 'start', 'my', 'interview', 'and', 'agree', 'rules'];
  const spokenWords = cleanSpoken.split(' ');

  let matchCount = 0;
  for (const word of targetWords) {
    if (spokenWords.includes(word)) {
      matchCount++;
    }
  }

  const ratio = Math.round((matchCount / targetWords.length) * 100);
  if (spokenWords.includes('ready') && (spokenWords.includes('start') || spokenWords.includes('interview'))) {
    return Math.max(85, ratio);
  }
  return ratio;
}

export const InterviewPage: React.FC<InterviewPageProps> = ({
  onNavigateHome,
  onNavigateToChat,
  onNavigateToInterview,
  isPremium = false,
  onRequirePremium,
  accountUser,
  currentPath,
}) => {
  // Web Speech API browser compatibility check
  const isWebSpeechSupported = typeof window !== 'undefined' && Boolean(
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  );

  // Extract ID from currentPath prop or window.location.search
  const getParsedInterviewId = useCallback(() => {
    if (typeof window === 'undefined') return null;
    let search = window.location.search;
    if (currentPath && currentPath.includes('?')) {
      search = '?' + currentPath.split('?')[1];
    }
    const params = new URLSearchParams(search);
    const val = params.get('id');
    return val && val.trim() ? val.trim() : null;
  }, [currentPath]);

  // Active Interview ID state
  // When no ?id= param is present, the Interview Dashboard is displayed!
  const [activeInterviewId, setActiveInterviewId] = useState<string | null>(getParsedInterviewId);

  // Sync activeInterviewId whenever currentPath prop changes
  useEffect(() => {
    const nextId = getParsedInterviewId();
    if (nextId !== activeInterviewId) {
      setActiveInterviewId(nextId);
      if (!nextId) {
        setStage('lobby');
        setCustomInterviewData(null);
      }
    }
  }, [currentPath, getParsedInterviewId, activeInterviewId]);

  // Also listen for popstate events & URL search alterations
  useEffect(() => {
    const handleUrlChange = () => {
      const nextId = getParsedInterviewId();
      if (nextId !== activeInterviewId) {
        setActiveInterviewId(nextId);
        if (!nextId) {
          setStage('lobby');
          setCustomInterviewData(null);
        }
      }
    };
    window.addEventListener('popstate', handleUrlChange);
    const interval = setInterval(handleUrlChange, 200);
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      clearInterval(interval);
    };
  }, [getParsedInterviewId, activeInterviewId]);

  const [customInterviewData, setCustomInterviewData] = useState<InterviewDashboardRecord | null>(null);

  // Meeting ID string for session execution (defaults to activeInterviewId || 'demo')
  const interviewId = activeInterviewId || 'demo';

  // ----------------------------------------------------
  // Stage State
  // ----------------------------------------------------
  const [stage, setStage] = useState<InterviewStage>('lobby');
  const stageRef = useRef<InterviewStage>('lobby');
  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);
  const [activePov, setActivePov] = useState<'candidate' | 'recruiter'>('candidate');

  // Candidate Profile Information (blank by default with placeholder e.g. Dewan Mukto)
  const [candidateName, setCandidateName] = useState<string>('');
  const [targetRole, setTargetRole] = useState<string>('Senior Full Stack & AI Systems Engineer');

  // Load Interview configuration from NeonDB if activeInterviewId is present
  useEffect(() => {
    if (!activeInterviewId) return;
    fetch(`/api/interview/${encodeURIComponent(activeInterviewId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.interview) {
          setCustomInterviewData(data.interview);
          if (data.interview.target_role) {
            setTargetRole(data.interview.target_role);
          }
        }
      })
      .catch((err) => console.warn('Failed to fetch interview from NeonDB:', err));
  }, [activeInterviewId]);

  // Candidate Resume Document
  const [uploadedResume, setUploadedResume] = useState<UploadedResume | null>(null);
  const [isUploadingResume, setIsUploadingResume] = useState<boolean>(false);
  const [resumeSubmitted, setResumeSubmitted] = useState<boolean>(false);

  // Lobby Speech Agreement ("I am ready to start my interview and I agree to the rules")
  const [hasAgreedToRules, setHasAgreedToRules] = useState<boolean>(false);
  const [lobbySpokenText, setLobbySpokenText] = useState<string>('');
  const [lobbyMatchPercent, setLobbyMatchPercent] = useState<number>(0);
  const [lobbySpeechError, setLobbySpeechError] = useState<string | null>(null);
  const [isLobbyListening, setIsLobbyListening] = useState<boolean>(false);

  // Media Devices & Streams
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');
  const [selectedAudioId, setSelectedAudioId] = useState<string>('');
  const [isCameraActive, setIsCameraActive] = useState<boolean>(true);
  const [isMicActive, setIsMicActive] = useState<boolean>(true);
  const [hasPermissions, setHasPermissions] = useState<boolean>(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  // Audio Testing in Lobby (Latching mic input checkmark once detected to prevent blinking/glitching)
  const [micVolume, setMicVolume] = useState<number>(0);
  const [hasDetectedMicOnce, setHasDetectedMicOnce] = useState<boolean>(false);
  const [isSpeakerTesting, setIsSpeakerTesting] = useState<boolean>(false);

  // Active stream state so React renders video elements reliably
  const [activeMediaStream, setActiveMediaStream] = useState<MediaStream | null>(null);

  // Refs for Media Streams & Recorders
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const spotlightVideoRef = useRef<HTMLVideoElement | null>(null);
  const lobbyVideoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micAnimFrameRef = useRef<number | null>(null);

  // Screen & Audio Recording System (Canvas composite + Web Audio mix or displayMedia)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [isRecordingFinalizing, setIsRecordingFinalizing] = useState<boolean>(false);
  const [videoPlaybackError, setVideoPlaybackError] = useState<boolean>(false);
  const [recordedDuration, setRecordedDuration] = useState<number>(0);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Meeting Progression State
  const [meetingPhase, setMeetingPhase] = useState<MeetingPhase>('joining');
  const [hanaEntered, setHanaEntered] = useState<boolean>(false);
  // Hana's default mood and expression is strictly neutral (no smiling or grinning)
  const [hanaEmotion, setHanaEmotion] = useState<AvatarEmotion>('neutral');
  const [hanaIsSpeaking, setHanaIsSpeaking] = useState<boolean>(false);
  const [hanaReactionText, setHanaReactionText] = useState<string>('');
  const [taskClarificationNotice, setTaskClarificationNotice] = useState<string | null>(null);

  // 3D Model Loading State: Show Camera Off avatar panel first, then fade in 3D
  const [isHana3DReady, setIsHana3DReady] = useState<boolean>(false);

  // Subtle Nodding Animation Trigger for 3D model (manual affirmative nodding when candidate responds)
  const [nodCount, setNodCount] = useState<number>(0);

  // Recruiter Interview Scenario Configurations (Configurable silence wait durations & voicelines)
  const [scenarioConfig, setScenarioConfig] = useState<InterviewScenarioConfig>(() => {
    try {
      const saved = localStorage.getItem(SCENARIO_CONFIG_STORAGE_KEY);
      if (saved) return { ...DEFAULT_SCENARIO_CONFIG, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_SCENARIO_CONFIG;
  });
  const [isConfigModalOpen, setIsConfigModalOpen] = useState<boolean>(false);

  const updateScenarioConfig = (updates: Partial<InterviewScenarioConfig>) => {
    setScenarioConfig((prev) => {
      const next = { ...prev, ...updates };
      try {
        localStorage.setItem(SCENARIO_CONFIG_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // Echo & Reverb Grace Period Cooldown (strictly disables microphone recognition right after Hana speaks)
  const speechCooldownUntilRef = useRef<number>(0);

  // Candidate Q&A Voice-First State
  const qaSilenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const resetSilenceTimerRef = useRef<() => void>(() => {});
  const [qaStageState, setQaStageState] = useState<
    'idle' | 'hinting' | 'listening' | 'answering' | 'waiting_5s' | 'asking_that_is_all' | 'waiting_final_5s' | 'concluded'
  >('listening');

  // MuxAI Ollama Server Online Status for RAG Q&A
  const [isMuxAiServerOnline, setIsMuxAiServerOnline] = useState<boolean>(false);
  const muxAiServerOnlineRef = useRef<boolean>(false);

  // Custom Mixamo Animation Trigger & 3D Look Target Offset towards Task Panel
  const [customAnimationTrigger, setCustomAnimationTrigger] = useState<{
    clipFileName: string;
    triggerId: number;
    loopOnce?: boolean;
  } | null>(null);
  const [hanaLookTarget, setHanaLookTarget] = useState<{ yaw: number; pitch: number } | null>(null);
  const lookResetTimeoutRef = useRef<any>(null);

  // Voiceline variance memory so Hana never repeats the exact same transition line back-to-back
  const lastUsedVoicelineMapRef = useRef<Record<string, number>>({});

  const pickUniqueVoiceline = useCallback((category: keyof typeof TRANSITION_VOICELINES): string => {
    const list = TRANSITION_VOICELINES[category];
    if (!list || list.length === 0) return '';
    if (list.length === 1) return list[0];
    const lastIdx = lastUsedVoicelineMapRef.current[category] ?? -1;
    let nextIdx = Math.floor(Math.random() * list.length);
    if (nextIdx === lastIdx) {
      nextIdx = (lastIdx + 1) % list.length;
    }
    lastUsedVoicelineMapRef.current[category] = nextIdx;
    return list[nextIdx];
  }, []);

  const triggerHanaAnimation = useCallback((clipFileName: string, loopOnce: boolean = true) => {
    setCustomAnimationTrigger({
      clipFileName,
      triggerId: Date.now() + Math.floor(Math.random() * 1000),
      loopOnce,
    });
  }, []);

  const triggerTaskPanelInteraction = useCallback(
    (durationMs: number = 3400, playButtonPush: boolean = true) => {
      if (playButtonPush) {
        triggerHanaAnimation('mixamo_buttonpush.fbx', true);
      }
      // Orient 3D model's head/neck/torso towards the spotlight task panel
      setHanaLookTarget({ yaw: 0.44, pitch: -0.06 });
      if (lookResetTimeoutRef.current) {
        clearTimeout(lookResetTimeoutRef.current);
      }
      lookResetTimeoutRef.current = setTimeout(() => {
        setHanaLookTarget(null);
      }, durationMs);
    },
    [triggerHanaAnimation]
  );

  // Candidate live subtitle marquee scroll container refs
  const candidateSubtitleScrollRef = useRef<HTMLDivElement | null>(null);
  const spotlightSubtitleScrollRef = useRef<HTMLDivElement | null>(null);

  // Probe MuxAI Ollama server status on mount & when entering Q&A
  const refreshMuxAiServerStatus = useCallback(async (): Promise<boolean> => {
    try {
      const baseUrl = loadCustomOllamaUrl() || OLLAMA_CONFIG.muxAiEndpoint;
      const result = await pingOllama(baseUrl);
      muxAiServerOnlineRef.current = result.online;
      setIsMuxAiServerOnline(result.online);
      return result.online;
    } catch {
      muxAiServerOnlineRef.current = false;
      setIsMuxAiServerOnline(false);
      return false;
    }
  }, []);

  useEffect(() => {
    refreshMuxAiServerStatus();
  }, [refreshMuxAiServerStatus]);

  // Edge case: User interruption detection & resume prefix
  const hanaIsSpeakingRef = useRef<boolean>(false);
  const currentHanaLineRef = useRef<string>('');
  const wasInterruptedRef = useRef<boolean>(false);
  const speechResumeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const meetingPhaseRef = useRef<MeetingPhase>('joining');
  const lastTaskReExplainTimeRef = useRef<number>(0);

  useEffect(() => {
    meetingPhaseRef.current = meetingPhase;
  }, [meetingPhase]);

  // Recruiter Keyboard Shortcut (Ctrl+Shift+S / Cmd+Shift+S) to open scenario settings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        e.preventDefault();
        setIsConfigModalOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Speech Recognition (Candidate speech to text with silence detection auto-send)
  const [candidateLiveTranscript, setCandidateLiveTranscript] = useState<string>('');
  const [isCandidateSpeaking, setIsCandidateSpeaking] = useState<boolean>(false);
  const recognitionRef = useRef<any>(null);
  const candidateTranscriptRef = useRef<string>('');
  const candidateFinalTranscriptRef = useRef<string>('');
  const candidateInterimTranscriptRef = useRef<string>('');
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const advanceToPhaseRef = useRef<(nextPhase: MeetingPhase) => void>(() => {});

  /**
   * Deduplicates repeated adjacent phrases, sentences, and interim echoes
   * so the candidate spoken output on recruiter evaluation dossier is pristine.
   */
  const cleanDeduplicatedTranscript = useCallback((rawText: string): string => {
    if (!rawText) return '';
    const text = rawText.trim().replace(/\s+/g, ' ');
    const words = text.split(' ');
    if (words.length <= 1) return text;

    let cleaned = [...words];
    let changed = true;
    let iterations = 0;

    while (changed && iterations < 6) {
      changed = false;
      iterations++;
      const len = cleaned.length;
      for (let phraseLen = Math.min(25, Math.floor(len / 2)); phraseLen >= 1; phraseLen--) {
        for (let i = 0; i <= cleaned.length - phraseLen * 2; i++) {
          const first = cleaned.slice(i, i + phraseLen).join(' ').toLowerCase();
          const second = cleaned.slice(i + phraseLen, i + phraseLen * 2).join(' ').toLowerCase();
          if (first === second) {
            cleaned.splice(i + phraseLen, phraseLen);
            changed = true;
            break;
          }
        }
        if (changed) break;
      }
    }

    return cleaned.join(' ');
  }, []);

  const clearCandidateTranscript = useCallback(() => {
    candidateTranscriptRef.current = '';
    candidateFinalTranscriptRef.current = '';
    candidateInterimTranscriptRef.current = '';
    setCandidateLiveTranscript('');
  }, []);

  // Auto-scroll candidate live word subtitles like a marquee to always show most recent words
  useEffect(() => {
    if (candidateSubtitleScrollRef.current) {
      candidateSubtitleScrollRef.current.scrollLeft = candidateSubtitleScrollRef.current.scrollWidth;
    }
    if (spotlightSubtitleScrollRef.current) {
      spotlightSubtitleScrollRef.current.scrollLeft = spotlightSubtitleScrollRef.current.scrollWidth;
    }
  }, [candidateLiveTranscript]);

  // Spotlight Tasks Data
  // Task 1: Resume Document Upload (handled via uploadedResume)
  // Task 2: Written assessment (>= 100 characters)
  const [writtenText, setWrittenText] = useState<string>('');
  const [writtenSubmitted, setWrittenSubmitted] = useState<boolean>(false);
  const writtenTextRef = useRef<string>('');
  useEffect(() => {
    writtenTextRef.current = writtenText;
  }, [writtenText]);

  // Task 3: Situational assessment (Radio buttons)
  const [pressureRating, setPressureRating] = useState<string>('');
  const [pressureSubmitted, setPressureSubmitted] = useState<boolean>(false);
  const pressureRatingRef = useRef<string>('');
  useEffect(() => {
    pressureRatingRef.current = pressureRating;
  }, [pressureRating]);

  const uploadedResumeRef = useRef<UploadedResume | null>(null);
  useEffect(() => {
    uploadedResumeRef.current = uploadedResume;
  }, [uploadedResume]);

  // Task 4: Visual Identity Snapshots (Forward, Left, Right via trigger words "click", "do it", "okay", "ready")
  const [snapshotStep, setSnapshotStep] = useState<0 | 1 | 2 | 3>(0); // 0: not started, 1: forward, 2: left, 3: right
  const snapshotStepRef = useRef<0 | 1 | 2 | 3>(0);
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [isListeningForTrigger, setIsListeningForTrigger] = useState<boolean>(false);
  const isListeningForTriggerRef = useRef<boolean>(false);
  const [lastDetectedTrigger, setLastDetectedTrigger] = useState<string | null>(null);
  const isTriggerLockedRef = useRef<boolean>(false);

  useEffect(() => {
    isListeningForTriggerRef.current = isListeningForTrigger;
  }, [isListeningForTrigger]);

  useEffect(() => {
    snapshotStepRef.current = snapshotStep;
  }, [snapshotStep]);

  // Candidate Q&A
  const [candidateQuestionInput, setCandidateQuestionInput] = useState<string>('');
  const [qaHistory, setQaHistory] = useState<Array<{ sender: 'candidate' | 'hana'; text: string }>>([]);

  // Log of all responses for Recruiter Review
  const [recordedResponses, setRecordedResponses] = useState<QuestionResponse[]>([]);

  // Recruiter Dashboard State
  const [candidateStatus, setCandidateStatus] = useState<'under_review' | 'shortlisted' | 'rejected'>('under_review');
  const [recruiterActiveTab, setRecruiterActiveTab] = useState<'recording' | 'responses' | 'resume'>('recording');
  const [recordingPlaybackSpeed, setRecordingPlaybackSpeed] = useState<number>(1);
  const reviewVideoPlayerRef = useRef<HTMLVideoElement | null>(null);
  const [isReviewPlaying, setIsReviewPlaying] = useState<boolean>(false);
  const [reviewCurrentTime, setReviewCurrentTime] = useState<number>(0);
  const [selectedSnapshotModal, setSelectedSnapshotModal] = useState<string | null>(null);

  // Page Refresh Recovery Modal state
  const [hasSavedSession, setHasSavedSession] = useState<boolean>(false);
  const [savedSessionData, setSavedSessionData] = useState<any>(null);

  // Helper for displaying candidate name gracefully
  const effectiveCandidateName = candidateName.trim() || 'Candidate';
  const effectiveDossierName = candidateName.trim() || 'Dewan Mukto';

  // ----------------------------------------------------
  // Edge Case: Check for Saved Session on Refresh
  // ----------------------------------------------------
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && (parsed.stage === 'meeting' || parsed.stage === 'candidate_complete' || parsed.stage === 'recruiter_review')) {
          setHasSavedSession(true);
          setSavedSessionData(parsed);
        }
      }
    } catch {
      // ignore JSON parse errors
    }
  }, []);

  const restoreSession = () => {
    if (!savedSessionData) return;
    try {
      setCandidateName(savedSessionData.candidateName || '');
      setMeetingPhase(savedSessionData.meetingPhase || 'question_1');
      setWrittenText(savedSessionData.writtenText || '');
      setWrittenSubmitted(Boolean(savedSessionData.writtenSubmitted));
      setPressureRating(savedSessionData.pressureRating || '');
      setPressureSubmitted(Boolean(savedSessionData.pressureSubmitted));
      setSnapshots(savedSessionData.snapshots || []);
      setRecordedResponses(savedSessionData.recordedResponses || []);
      setQaHistory(savedSessionData.qaHistory || []);
      if (savedSessionData.uploadedResume) {
        setUploadedResume(savedSessionData.uploadedResume);
        setResumeSubmitted(true);
      }
      setHanaEntered(true);
      setIsHana3DReady(true);
      setStage(savedSessionData.stage || 'meeting');
      setHasSavedSession(false);
      startCameraStream();
    } catch (e) {
      console.warn('Could not restore session', e);
      setHasSavedSession(false);
    }
  };

  const discardSavedSession = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    setHasSavedSession(false);
    setSavedSessionData(null);
  };

  // Persist session snapshot to sessionStorage whenever critical interview states change
  useEffect(() => {
    if (stage === 'meeting' || stage === 'candidate_complete' || stage === 'recruiter_review') {
      try {
        const stateToSave = {
          stage,
          meetingPhase,
          candidateName,
          writtenText,
          writtenSubmitted,
          pressureRating,
          pressureSubmitted,
          snapshots,
          recordedResponses,
          qaHistory,
          uploadedResume,
          timestamp: Date.now(),
        };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
      } catch {
        // storage quota exceeded or disabled
      }
    }
  }, [
    stage,
    meetingPhase,
    candidateName,
    writtenText,
    writtenSubmitted,
    pressureRating,
    pressureSubmitted,
    snapshots,
    recordedResponses,
    qaHistory,
    uploadedResume,
  ]);

  // ----------------------------------------------------
  // Initialize Media Devices & Stream
  // ----------------------------------------------------
  const startCameraStream = useCallback(async (vDeviceId?: string, aDeviceId?: string) => {
    try {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }

      const constraints: MediaStreamConstraints = {
        video: vDeviceId ? { deviceId: { exact: vDeviceId } } : { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: aDeviceId ? { deviceId: { exact: aDeviceId } } : true,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;
      setActiveMediaStream(stream);

      if (lobbyVideoRef.current) {
        lobbyVideoRef.current.srcObject = stream;
      }
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      setHasPermissions(true);
      setPermissionError(null);

      // Setup audio analysis for live mic volume meter
      setupAudioMeter(stream);

      // Enumerate available devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const vDevs = devices.filter((d) => d.kind === 'videoinput');
      const aDevs = devices.filter((d) => d.kind === 'audioinput');
      setVideoDevices(vDevs);
      setAudioDevices(aDevs);

      if (!selectedVideoId && vDevs[0]) setSelectedVideoId(vDevs[0].deviceId);
      if (!selectedAudioId && aDevs[0]) setSelectedAudioId(aDevs[0].deviceId);
    } catch (err: any) {
      console.warn('Media permission error:', err);
      setPermissionError(err?.message || 'Camera or microphone access denied');
      setHasPermissions(false);
    }
  }, [selectedVideoId, selectedAudioId]);

  // Make sure whenever activeMediaStream changes, video refs attach correctly
  useEffect(() => {
    if (activeMediaStream) {
      if (lobbyVideoRef.current && lobbyVideoRef.current.srcObject !== activeMediaStream) {
        lobbyVideoRef.current.srcObject = activeMediaStream;
      }
      if (localVideoRef.current && localVideoRef.current.srcObject !== activeMediaStream) {
        localVideoRef.current.srcObject = activeMediaStream;
      }
    }
  }, [activeMediaStream, stage, isCameraActive]);

  const setupAudioMeter = (stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new AudioCtx();
      }

      const audioCtx = audioContextRef.current;
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateMeter = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const normalized = Math.min(100, Math.round((avg / 128) * 100));
        setMicVolume(normalized);

        // Latch once detected so the checkmark stays green and does not glitch/flicker
        if (normalized > 10) {
          setHasDetectedMicOnce(true);
        }

        micAnimFrameRef.current = requestAnimationFrame(updateMeter);
      };

      updateMeter();
    } catch {
      // AudioContext meter fallback
    }
  };

  useEffect(() => {
    startCameraStream();
    return () => {
      if (micAnimFrameRef.current) cancelAnimationFrame(micAnimFrameRef.current);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (recordingStreamRef.current) {
        recordingStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  // ------------------------------------------------------------------
  // Live Lobby Speech Detection for Meeting Agreement Phrase
  // Uses continuous recognition with robust error recovery (similar to /chat)
  // ------------------------------------------------------------------
  useEffect(() => {
    if (stage !== 'lobby') return;

    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      setLobbySpeechError('Web Speech API is not supported in this browser. Please use Chrome, Edge, or a compatible browser.');
      return;
    }

    let isDisposed = false;
    let recognition: any = null;

    const initRecognition = () => {
      if (isDisposed) return;
      try {
        recognition = new SpeechRec();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
          if (!isDisposed) {
            setIsLobbyListening(true);
            setLobbySpeechError(null);
          }
        };

        recognition.onresult = (event: any) => {
          if (isDisposed) return;
          let sessionFinal = '';
          let sessionInterim = '';

          for (let i = 0; i < event.results.length; i++) {
            const item = event.results[i];
            if (item.isFinal) {
              sessionFinal += item[0].transcript + ' ';
            } else {
              sessionInterim += item[0].transcript;
            }
          }

          const combined = (sessionFinal + sessionInterim).trim();
          if (combined) {
            setLobbySpokenText(combined);
            setHasDetectedMicOnce(true);
            const score = calculateAgreementMatch(combined);
            setLobbyMatchPercent(score);

            if (score >= 80) {
              setHasAgreedToRules(true);
              soundManager.playSend();
            }
          }
        };

        recognition.onerror = (e: any) => {
          if (isDisposed) return;
          console.warn('Lobby speech recognition error:', e.error);
          if (e.error === 'not-allowed') {
            setLobbySpeechError('Microphone permission required for speech verification.');
          } else if (e.error === 'audio-capture') {
            setLobbySpeechError('No microphone detected. Please check your audio input.');
          }
          // Do not treat transient 'no-speech' or 'aborted' as fatal
        };

        recognition.onend = () => {
          if (!isDisposed && stage === 'lobby' && !hasAgreedToRules) {
            setTimeout(() => {
              if (!isDisposed && stage === 'lobby' && !hasAgreedToRules) {
                try {
                  recognition.start();
                } catch {
                  // restart retry
                }
              }
            }, 250);
          } else {
            setIsLobbyListening(false);
          }
        };

        recognition.start();
      } catch (err: any) {
        console.warn('Lobby speech recognition start error:', err);
        setLobbySpeechError(err?.message || 'Speech recognition initialization failed.');
      }
    };

    // Small delay to allow getUserMedia to acquire microphone stream first
    const timer = setTimeout(() => {
      initRecognition();
    }, 400);

    return () => {
      isDisposed = true;
      clearTimeout(timer);
      try {
        recognition?.stop();
      } catch {}
    };
  }, [stage, hasAgreedToRules]);

  // Speaker audio test
  const handleTestSpeaker = () => {
    setIsSpeakerTesting(true);
    soundManager.playReceive();
    try {
      const uttr = new SpeechSynthesisUtterance('Audio output test successful. Welcome to your interview with Hana.');
      uttr.rate = 1.0;
      uttr.pitch = 1.15;
      const voice = getPersonaVoice();
      if (voice) uttr.voice = voice;
      uttr.onend = () => setIsSpeakerTesting(false);
      uttr.onerror = () => setIsSpeakerTesting(false);
      window.speechSynthesis?.speak(uttr);
    } catch {
      setIsSpeakerTesting(false);
    }
  };

  // Toggle local tracks
  const toggleCamera = () => {
    if (mediaStreamRef.current) {
      const videoTrack = mediaStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraActive(videoTrack.enabled);
      }
    }
  };

  // ----------------------------------------------------
  // Speech Synthesis & Interruption Logic (Hana Voice)
  // Default mood is neutral (no smiling or grinning)
  // Connects directly to 3D VRM lip sync
  // ----------------------------------------------------
  const speakHanaLine = useCallback(
    async (text: string, onDone?: () => void, emotion: AvatarEmotion = 'neutral') => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        onDone?.();
        return;
      }

      window.speechSynthesis.cancel();
      lipSyncManager.endSpeech();
      currentHanaLineRef.current = text;
      hanaIsSpeakingRef.current = true;
      setHanaIsSpeaking(true);
      setHanaEmotion(emotion);

      // Disable candidate speech recognition immediately while Hana is speaking!
      // This prevents Hana's voice from being captured, echoed, or auto-triggering tasks.
      speechCooldownUntilRef.current = Date.now() + 99999999;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
      setCandidateLiveTranscript('');
      candidateTranscriptRef.current = '';
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      if (qaSilenceTimerRef.current) {
        clearTimeout(qaSilenceTimerRef.current);
        qaSilenceTimerRef.current = null;
      }

      // Synchronous voice resolution if available, otherwise short fallback
      const voice = getPersonaVoice() || (await waitForPersonaVoice(250));
      const utterance = new SpeechSynthesisUtterance(text);
      if (voice) utterance.voice = voice;
      utterance.pitch = 1.15;
      utterance.rate = 1.0;

      utterance.onstart = () => {
        lipSyncManager.startSpeech(text);
      };

      // Real-time phoneme & word boundary events for fine lip syncing
      utterance.onboundary = (event: any) => {
        try {
          if (event.name === 'word' || typeof event.charIndex === 'number') {
            const idx = event.charIndex || 0;
            const len = event.charLength || 6;
            const word = text.slice(idx, idx + len);
            lipSyncManager.onBoundary(word);
          }
        } catch {}
      };

      let hasFinished = false;
      const finish = () => {
        if (hasFinished) return;
        hasFinished = true;
        lipSyncManager.endSpeech();
        hanaIsSpeakingRef.current = false;
        setHanaIsSpeaking(false);
        setHanaEmotion('neutral');
        // 1-second echo & reverb grace period cooldown so room echo is never captured into transcript
        speechCooldownUntilRef.current = Date.now() + 1000;

        setTimeout(() => {
          if (!hanaIsSpeakingRef.current && !(window.speechSynthesis?.speaking) && stageRef.current === 'meeting') {
            try {
              recognitionRef.current?.start();
            } catch {}
          }
        }, 1100);

        onDone?.();
      };

      utterance.onend = () => finish();

      utterance.onerror = (e) => {
        // If canceled or interrupted by another utterance, don't finish if this is an old utterance!
        if (currentHanaLineRef.current !== text) return;
        if (e.error !== 'interrupted' && e.error !== 'canceled') {
          console.warn('Hana speech error:', e);
        }
        finish();
      };

      // Watchdog timeout to prevent getting stuck if onend doesn't fire
      const wordCount = text.split(' ').length;
      const estimatedDurationMs = Math.max(3000, (wordCount / 2.2) * 1000 + 2500);
      setTimeout(() => {
        if (hanaIsSpeakingRef.current && currentHanaLineRef.current === text) {
          finish();
        }
      }, estimatedDurationMs);

      // Trigger lipsync right away so mouth movement starts promptly
      lipSyncManager.startSpeech(text);
      try {
        window.speechSynthesis.resume();
      } catch {}
      window.speechSynthesis.speak(utterance);
    },
    []
  );

  const lastMuteNoticeTimeRef = useRef<number>(0);

  const notifyCandidateIfMuted = useCallback(() => {
    const now = Date.now();
    if (now - lastMuteNoticeTimeRef.current < 20000) return;
    if (stageRef.current !== 'meeting' || hanaIsSpeakingRef.current) return;
    lastMuteNoticeTimeRef.current = now;
    speakHanaLine(
      "It looks like your microphone is currently muted. Please unmute yourself whenever you are ready so I can hear your response.",
      undefined,
      'neutral'
    );
  }, [speakHanaLine]);

  // Periodic active check during meeting to notify user if they remain muted
  useEffect(() => {
    if (stage !== 'meeting') return;
    const interval = setInterval(() => {
      if (
        !isMicActive &&
        stageRef.current === 'meeting' &&
        !hanaIsSpeakingRef.current &&
        meetingPhaseRef.current !== 'joining' &&
        meetingPhaseRef.current !== 'wrapup'
      ) {
        notifyCandidateIfMuted();
      }
    }, 7000);
    return () => clearInterval(interval);
  }, [isMicActive, notifyCandidateIfMuted, stage]);

  const toggleMic = () => {
    if (mediaStreamRef.current) {
      const audioTrack = mediaStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicActive(audioTrack.enabled);
        if (!audioTrack.enabled && stageRef.current === 'meeting') {
          setTimeout(() => {
            if (!audioTrack.enabled) {
              notifyCandidateIfMuted();
            }
          }, 800);
        }
      }
    }
  };

  // Active question prompt text for candidate reclarification / repeat requests
  const getCurrentQuestionText = useCallback((phase: MeetingPhase): string => {
    switch (phase) {
      case 'welcome':
        return "Can you hear and see me clearly?";
      case 'question_1':
        return "Could you tell me a bit about yourself, your background, and what drives your passion for this role?";
      case 'question_2':
        return "Could you walk me through a challenging technical problem or project you tackled recently, and how you approached resolving it?";
      case 'task_resume':
        return "Please upload your updated resume or CV document so our recruiting team has your latest credentials on file.";
      case 'task_written':
        return "In the reflection panel, please write down three things you like about yourself and why, reaching at least 100 characters.";
      case 'task_pressure':
        return "Please select the situational option that most accurately reflects how you perform under intense project pressure.";
      case 'task_snapshot':
        return "Please hold up your paper with your phone number or test digits, look directly forward, and say 'click' when you're set.";
      case 'candidate_qa':
        return "Do you have any questions for me or our recruiting team about the role or MuxAI?";
      default:
        return "Please proceed with the current interview question.";
    }
  }, []);

  // Situational query capturing across interview phases
  const handleSituationalQuery = useCallback(
    (lower: string, phase: MeetingPhase): boolean => {
      if (hanaIsSpeakingRef.current) return false;

      // 0. Global Question Repeat Request (candidate asks Hana to repeat the question anytime)
      const isRepeatRequest =
        /\b(repeat the question|repeat question|can you repeat the question|could you repeat the question|what was the question|what is the question|say that again|can you say that again|could you say that again|pardon|pardon me|repeat that|what did you ask|ask again|could you repeat please|can you repeat please|say again|what is the task|what was the task|can you rephrase|could you rephrase|rephrase the question|rephrase|what did you say|what was that)\b/i.test(
          lower
        ) ||
        /^(repeat|repeat please|what was the question\??|can you repeat\??|say again|pardon\??|what\??)$/i.test(lower);

      if (isRepeatRequest) {
        setNodCount((c) => c + 1);
        const questionPrompt = getCurrentQuestionText(phase);
        speakHanaLine(
          `Certainly! Here is the question again: ${questionPrompt}`,
          () => {
            setCandidateLiveTranscript('');
            candidateTranscriptRef.current = '';
            if (phase === 'question_1' || phase === 'question_2') {
              resetSilenceTimerRef.current?.();
            }
          },
          'neutral'
        );
        return true;
      }

      // 1. Snapshot Task: Question about phone number on paper or photo taking
      if (phase === 'task_snapshot') {
        const isPhoneQuestion =
          /(phone|number|phone\s*number|my\s*number|why\s*phone|paper|why\s*paper|no\s*paper|don'?t\s*have\s*paper|write\s*on\s*paper|without\s*phone|personal\s*number)/i.test(
            lower
          );
        if (isPhoneQuestion) {
          setIsListeningForTrigger(false);
          isListeningForTriggerRef.current = false;
          setNodCount((c) => c + 1);
          setTaskClarificationNotice('Answering your question regarding the handwritten phone number check...');
          const explanation =
            "Great question! We ask you to write your phone number on paper as an anti-deepfake timestamp and physical liveness check to confirm candidate authenticity. If you prefer not to share your personal number, you can write your initials, a random six-digit number, or today's date on the paper instead! Whenever you are ready, hold it up and say 'click'.";
          speakHanaLine(
            explanation,
            () => {
              setTaskClarificationNotice(null);
              setTimeout(() => {
                setIsListeningForTrigger(true);
                isListeningForTriggerRef.current = true;
              }, 600);
            },
            'neutral'
          );
          return true;
        }

        const isPoseQuestion =
          /(how\s*to\s*pose|which\s*direction|which\s*way|look\s*left|look\s*right|where\s*to\s*look|turn\s*head)/i.test(
            lower
          );
        if (isPoseQuestion) {
          setIsListeningForTrigger(false);
          isListeningForTriggerRef.current = false;
          setNodCount((c) => c + 1);
          const explanation =
            "Simply face directly forward first, then turn slightly to your left and right when prompted. Just say 'click' whenever you are in position.";
          speakHanaLine(
            explanation,
            () => {
              setTimeout(() => {
                setIsListeningForTrigger(true);
                isListeningForTriggerRef.current = true;
              }, 600);
            },
            'neutral'
          );
          return true;
        }

        const isTriggerQuestion =
          /(what\s*to\s*say|what\s*should\s*i\s*say|keyword|trigger|how\s*to\s*take|how\s*to\s*snap)/i.test(
            lower
          );
        if (isTriggerQuestion) {
          setIsListeningForTrigger(false);
          isListeningForTriggerRef.current = false;
          setNodCount((c) => c + 1);
          const explanation =
            "You can say 'click', 'ready', or 'do it'—or tap the Take Photo button on your screen.";
          speakHanaLine(
            explanation,
            () => {
              setTimeout(() => {
                setIsListeningForTrigger(true);
                isListeningForTriggerRef.current = true;
              }, 600);
            },
            'neutral'
          );
          return true;
        }
      }

      // 2. Resume Task Questions
      if (phase === 'task_resume') {
        const isDocQuestion =
          /(what\s*format|pdf|docx|word|linkedin|file\s*type|no\s*resume|don'?t\s*have\s*resume|can\s*i\s*upload)/i.test(
            lower
          );
        if (isDocQuestion) {
          setNodCount((c) => c + 1);
          setTaskClarificationNotice('Answering your question about resume formats...');
          const explanation =
            "We accept PDF, Word documents, text files, or image scans up to 10MB. If you don't have your full resume on this device, you can upload an exported profile or a text summary of your background, then click 'Confirm & Proceed'.";
          speakHanaLine(
            explanation,
            () => setTaskClarificationNotice(null),
            'neutral'
          );
          return true;
        }
      }

      // 3. Written Task Questions
      if (phase === 'task_written') {
        const isLengthQuestion =
          /(how\s*many\s*characters|how\s*long|word\s*count|what\s*should\s*i\s*write|example|hints)/i.test(
            lower
          );
        if (isLengthQuestion) {
          setNodCount((c) => c + 1);
          setTaskClarificationNotice('Answering your question about written reflection...');
          const explanation =
            "You just need at least 100 characters. You can mention three qualities—such as technical problem-solving, debugging persistence, or empathetic teamwork. Take your time, then click submit.";
          speakHanaLine(
            explanation,
            () => setTaskClarificationNotice(null),
            'neutral'
          );
          return true;
        }
      }

      // 4. Pressure Task Questions
      if (phase === 'task_pressure') {
        const isScoreQuestion =
          /(right\s*answer|wrong\s*answer|which\s*option|best\s*choice|is\s*there\s*a\s*correct)/i.test(
            lower
          );
        if (isScoreQuestion) {
          setNodCount((c) => c + 1);
          const explanation =
            "There is no wrong answer! Simply choose the option that most honestly reflects your personal approach to tight deadlines, then click confirm.";
          speakHanaLine(explanation, undefined, 'neutral');
          return true;
        }
      }

      return false;
    },
    [speakHanaLine]
  );

  // Re-explain current task if candidate expresses confusion or asks what to do
  const reExplainCurrentTask = useCallback(
    (phase: MeetingPhase) => {
      const now = Date.now();
      if (now - lastTaskReExplainTimeRef.current < 6500) return;
      if (hanaIsSpeakingRef.current) return;
      lastTaskReExplainTimeRef.current = now;

      soundManager.playReceive();
      setHanaEmotion('neutral');
      setTaskClarificationNotice('Interviewer is re-explaining the task instructions...');

      let textToSay = '';
      if (phase === 'task_resume') {
        textToSay =
          "No problem! Please click the upload area on your screen to upload a copy of your updated resume or CV in PDF, DOCX, or text format. Once selected, click 'Confirm & Proceed'.";
      } else if (phase === 'task_written') {
        textToSay =
          "To clarify: In the spotlight reflection area on your screen, please write down three things you like about yourself and why, reaching at least 100 characters. Then click submit.";
      } else if (phase === 'task_pressure') {
        textToSay =
          "Sure! Review the four situational options on your screen, select the answer that best describes your approach under pressure, and click confirm.";
      } else if (phase === 'task_snapshot') {
        textToSay =
          "Here are the instructions: Please hold up your paper with your phone number, look towards the camera, and say 'click' or 'ready' — or simply tap the 'Take Photo' button on your screen.";
      }

      if (textToSay) {
        speakHanaLine(
          textToSay,
          () => {
            setTimeout(() => {
              setTaskClarificationNotice(null);
            }, 3000);
          },
          'neutral'
        );
      }
    },
    [speakHanaLine]
  );

  // Submit Answer to Questions
  const handleSaveResponse = useCallback(
    (phase: string, question: string, answer: string, nextPhase: MeetingPhase) => {
      const cleanAnswer = cleanDeduplicatedTranscript(answer.trim());
      setRecordedResponses((prev) => [
        ...prev,
        {
          phase,
          question,
          answer: cleanAnswer || '[Spoken answer recorded via microphone stream]',
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      clearCandidateTranscript();
      advanceToPhaseRef.current?.(nextPhase);
    },
    [cleanDeduplicatedTranscript, clearCandidateTranscript]
  );

  // Candidate Q&A voice-first handlers
  const concludeQaSession = useCallback(() => {
    if (qaSilenceTimerRef.current) {
      clearTimeout(qaSilenceTimerRef.current);
      qaSilenceTimerRef.current = null;
    }
    setQaStageState('concluded');
    const wrapupPrompt = pickUniqueVoiceline('qaConclude');
    speakHanaLine(
      wrapupPrompt,
      () => {
        advanceToPhase('wrapup');
      },
      'neutral'
    );
  }, [speakHanaLine, pickUniqueVoiceline]);

  const startQa5sSilenceTimer = useCallback(() => {
    if (qaSilenceTimerRef.current) {
      clearTimeout(qaSilenceTimerRef.current);
    }

    const waitDurationMs = scenarioConfig.qaSilenceSeconds * 1000;

    qaSilenceTimerRef.current = setTimeout(() => {
      if (meetingPhaseRef.current !== 'candidate_qa' || hanaIsSpeakingRef.current) return;

      // 5 seconds elapsed without candidate speaking!
      // Hana asks if that is all with varied voiceline:
      setQaStageState('asking_that_is_all');
      setNodCount((c) => c + 1);
      const followUp = pickUniqueVoiceline('qaCheckMore');

      speakHanaLine(
        followUp,
        () => {
          setQaStageState('waiting_final_5s');
          if (qaSilenceTimerRef.current) clearTimeout(qaSilenceTimerRef.current);

          qaSilenceTimerRef.current = setTimeout(() => {
            if (meetingPhaseRef.current !== 'candidate_qa' || hanaIsSpeakingRef.current) return;
            concludeQaSession();
          }, scenarioConfig.qaSilenceSeconds * 1000);
        },
        'neutral'
      );
    }, waitDurationMs);
  }, [scenarioConfig.qaSilenceSeconds, speakHanaLine, pickUniqueVoiceline, concludeQaSession]);

  const answerCandidateQaQuestion = useCallback(
    async (qText: string) => {
      const trimmed = cleanDeduplicatedTranscript(qText.trim());
      if (!trimmed || hanaIsSpeakingRef.current) return;

      if (qaSilenceTimerRef.current) {
        clearTimeout(qaSilenceTimerRef.current);
        qaSilenceTimerRef.current = null;
      }

      setQaHistory((prev) => [...prev, { sender: 'candidate', text: trimmed }]);
      clearCandidateTranscript();
      soundManager.playSend();
      setNodCount((c) => c + 1);
      setQaStageState('answering');

      let answer = '';
      // Connect to MuxAI Ollama server's LLM with RAG system prompt if found to be online
      const isOnline = muxAiServerOnlineRef.current || (await refreshMuxAiServerStatus());
      if (isOnline) {
        try {
          setHanaReactionText('Consulting MuxAI company knowledge base...');
          const ragSystemPrompt = buildMuxAiQaRagPrompt(trimmed, targetRole, candidateName.trim());
          const baseUrl = loadCustomOllamaUrl() || OLLAMA_CONFIG.muxAiEndpoint;
          const llmResponse = await streamOllama({
            url: baseUrl,
            model: OLLAMA_CONFIG.defaultFallbackModel,
            history: qaHistory.slice(-4).map((item, idx) => ({
              id: `qa_${idx}`,
              role: (item.sender === 'candidate' ? 'user' : 'assistant') as 'user' | 'assistant',
              content: item.text,
              timestamp: Date.now(),
            })),
            userMessage: `${ragSystemPrompt}\n\nCandidate Question: "${trimmed}"\n\nHana's Spoken Recruiter Response:`,
            maxTokens: 220,
            onToken: () => {},
          });
          const cleaned = llmResponse
            .replace(/[*#`_~]+/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          if (cleaned.length > 15) {
            answer = cleaned;
          }
        } catch (err) {
          console.warn('MuxAI Ollama Q&A RAG fallback triggered:', err);
        } finally {
          setHanaReactionText('');
        }
      }

      // Fallback to smart local Q&A engine if MuxAI Ollama server is offline or unreachable
      if (!answer) {
        answer = generateSmartQaFallbackAnswer(trimmed, targetRole);
      }

      setQaHistory((prev) => [...prev, { sender: 'hana', text: answer }]);

      speakHanaLine(
        answer,
        () => {
          // After answering, wait 5 seconds in silence!
          setQaStageState('waiting_5s');
          startQa5sSilenceTimer();
        },
        'neutral'
      );
    },
    [
      speakHanaLine,
      startQa5sSilenceTimer,
      refreshMuxAiServerStatus,
      targetRole,
      candidateName,
      qaHistory,
    ]
  );

  // Reset / Trigger Silence Auto-Send for Open Questions
  // Uses configurable silence seconds, varied voicelines, min word count, and smart done-intent detection
  const resetSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    const curPhase = meetingPhaseRef.current;
    if (curPhase !== 'question_1' && curPhase !== 'question_2') {
      return;
    }

    const currentText = candidateTranscriptRef.current.trim();
    const isExplicitlyDone = detectCandidateFinishedIntent(currentText, curPhase);
    const wordCount = currentText ? currentText.split(/\s+/).filter(Boolean).length : 0;
    const minWords = scenarioConfig.minWordsForOpenQuestionSilence ?? 6;

    // Minimum number of words needed when listening during open questions before checking for silence (e.g. 5-8 words)
    if (!isExplicitlyDone && wordCount < minWords) {
      return;
    }

    // Configurable duration (default 3.0s, or faster 1.0s if candidate explicitly stated they are done)
    const waitDurationMs = isExplicitlyDone ? 1000 : scenarioConfig.openQuestionSilenceSeconds * 1000;

    silenceTimerRef.current = setTimeout(() => {
      const text = candidateTranscriptRef.current.trim();
      const phaseNow = meetingPhaseRef.current;
      const doneNow = detectCandidateFinishedIntent(text, phaseNow);

      if (!hanaIsSpeakingRef.current && (phaseNow === 'question_1' || phaseNow === 'question_2')) {
        soundManager.playSend();
        setIsCandidateSpeaking(false);
        setNodCount((c) => c + 1);

        // Hana speaks varied voicelines (or explicit done acknowledgment) before proceeding
        const voiceline = doneNow
          ? pickUniqueVoiceline('doneAcknowledgment')
          : pickUniqueVoiceline('silenceAdvance') ||
            scenarioConfig.activeSilenceVoiceline ||
            "I am assuming you have nothing else to say for now so let's move on to the next step.";

        if (phaseNow === 'question_1') {
          speakHanaLine(
            voiceline,
            () => {
              setTimeout(() => {
                handleSaveResponse(
                  'question_1',
                  'Could you tell me a bit about yourself, your background, and what drives your passion for this role?',
                  text || '[No verbal response provided]',
                  'question_2'
                );
              }, 450);
            },
            'neutral'
          );
        } else if (phaseNow === 'question_2') {
          // Transition directly to task_resume so taskResumeIntro is the single transition voiceline before task panels arrive
          setTimeout(() => {
            handleSaveResponse(
              'question_2',
              'Walk me through a challenging technical problem or project you tackled recently.',
              text || '[No verbal response provided]',
              'task_resume'
            );
          }, 450);
        }
      }
      silenceTimerRef.current = null;
    }, waitDurationMs);
  }, [
    handleSaveResponse,
    scenarioConfig.activeSilenceVoiceline,
    scenarioConfig.openQuestionSilenceSeconds,
    scenarioConfig.minWordsForOpenQuestionSilence,
    speakHanaLine,
    pickUniqueVoiceline,
  ]);

  useEffect(() => {
    resetSilenceTimerRef.current = resetSilenceTimer;
  }, [resetSilenceTimer]);

  // ----------------------------------------------------
  // Candidate Speech Recognition during Live Meeting
  // Re-uses continuous pattern with strict conditionals
  // ----------------------------------------------------
  useEffect(() => {
    if (stage !== 'meeting') return;

    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) return;

    let isDisposed = false;
    let recognition: any = null;

    const initMeetingRecognition = () => {
      if (isDisposed) return;
      try {
        recognition = new SpeechRec();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
          if (!isDisposed) {
            setIsCandidateSpeaking(false);
          }
        };

        recognition.onresult = (event: any) => {
          if (isDisposed) return;

          // CRITICAL: Disable candidate speech-to-text completely while Hana is speaking or during echo cooldown!
          // This prevents Hana's own voice from mixing in, auto-triggering buttons, or cancelling her speech.
          if (
            hanaIsSpeakingRef.current ||
            (typeof window !== 'undefined' && window.speechSynthesis?.speaking) ||
            Date.now() < speechCooldownUntilRef.current
          ) {
            return;
          }

          // Separate final chunks from interim chunks so phrases are never repeatedly appended!
          let finalChunk = '';
          let interimChunk = '';

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const piece = event.results[i][0]?.transcript || '';
            if (event.results[i].isFinal) {
              finalChunk += piece + ' ';
            } else {
              interimChunk += piece;
            }
          }

          const cleanFinal = finalChunk.trim();
          const cleanInterim = interimChunk.trim();

          if (!cleanFinal && !cleanInterim) return;

          if (cleanFinal) {
            candidateFinalTranscriptRef.current = (
              candidateFinalTranscriptRef.current
                ? candidateFinalTranscriptRef.current + ' ' + cleanFinal
                : cleanFinal
            ).trim();
          }

          candidateInterimTranscriptRef.current = cleanInterim;

          const currentUtterance = (cleanFinal || cleanInterim);
          const fullRawTranscript = (
            candidateFinalTranscriptRef.current +
            (candidateInterimTranscriptRef.current ? ' ' + candidateInterimTranscriptRef.current : '')
          ).trim();

          const deduplicatedFull = cleanDeduplicatedTranscript(fullRawTranscript);
          candidateTranscriptRef.current = deduplicatedFull;

          const curPhase = meetingPhaseRef.current;
          const lower = currentUtterance.toLowerCase().trim();

          // 0. Situational questions and repeat request interception across ALL phases
          if (handleSituationalQuery(lower, curPhase)) {
            clearCandidateTranscript();
            return;
          }

          // Voice-driven command to conclude / exit meeting hands-free (zero buttons required)
          const isEndMeetingVoice = /\b(end interview|end the interview|leave meeting|leave the meeting|exit meeting|exit the meeting|finish interview|conclude interview|terminate interview)\b/i.test(lower);
          if (isEndMeetingVoice && !hanaIsSpeakingRef.current) {
            speakHanaLine(
              "Understood. Concluding our interview session now and compiling your evaluation dossier.",
              () => {
                handleEndMeetingAndReview();
              },
              'neutral'
            );
            return;
          }

          // Welcome phase affirmation
          if (curPhase === 'welcome') {
            setCandidateLiveTranscript(currentUtterance);
            const isAffirmative = /\b(yes|yeah|yep|i can|hear you|loud and clear|see you|hello|hi|ready|sure)\b/i.test(lower);
            if (isAffirmative && !hanaIsSpeakingRef.current) {
              setNodCount((c) => c + 1);
              setTimeout(() => {
                advanceToPhase('question_1');
              }, 400);
            }
            return;
          }

          // 1. OPEN QUESTIONS (question_1, question_2)
          if (curPhase === 'question_1' || curPhase === 'question_2') {
            setCandidateLiveTranscript(deduplicatedFull);
            setIsCandidateSpeaking(true);

            // Smart decision-making layer: detect when candidate explicitly says they are done
            const isDoneEarly =
              detectCandidateFinishedIntent(lower, curPhase) ||
              detectCandidateFinishedIntent(deduplicatedFull, curPhase);
            if (isDoneEarly && deduplicatedFull.length >= 8 && !hanaIsSpeakingRef.current) {
              if (silenceTimerRef.current) {
                clearTimeout(silenceTimerRef.current);
                silenceTimerRef.current = null;
              }
              soundManager.playSend();
              setIsCandidateSpeaking(false);
              setNodCount((c) => c + 1);
              const voiceline = pickUniqueVoiceline('doneAcknowledgment');
              const text = cleanDeduplicatedTranscript(deduplicatedFull);
              if (curPhase === 'question_1') {
                speakHanaLine(voiceline, () => {
                  setTimeout(() => {
                    handleSaveResponse('question_1', 'Introduction and background', text, 'question_2');
                  }, 450);
                }, 'neutral');
              } else {
                // For question_2 transitioning to task_resume, proceed directly to task_resume so only 1 transition voiceline is spoken
                setTimeout(() => {
                  handleSaveResponse('question_2', 'Challenging technical problem', text, 'task_resume');
                }, 450);
              }
              return;
            }

            // Contextual subtle reactions from Hana while candidate is answering
            if (deduplicatedFull.length > 25 && !hanaIsSpeakingRef.current) {
              const reactions = ['Hmm...', 'I see', 'Got it', 'Understood', 'Noted'];
              const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
              setHanaReactionText(randomReaction);
              setHanaEmotion('neutral');
            }

            // Start silence detection timer (auto-proceeds when no new words detected for duration)
            resetSilenceTimer();
          }

          // 2. CANDIDATE Q&A SESSION (Voice-First, Connected to MuxAI Ollama RAG + Smart Fallback)
          else if (curPhase === 'candidate_qa') {
            const isFinishedPhrase =
              detectCandidateFinishedIntent(lower, 'candidate_qa') ||
              detectCandidateFinishedIntent(deduplicatedFull, 'candidate_qa');

            if (
              isFinishedPhrase &&
              (qaStageState === 'waiting_5s' ||
                qaStageState === 'waiting_final_5s' ||
                qaStageState === 'listening' ||
                qaStageState === 'hinting')
            ) {
              concludeQaSession();
              return;
            }

            setCandidateLiveTranscript(deduplicatedFull);
            setIsCandidateSpeaking(true);

            // Candidate is speaking a question
            if (qaSilenceTimerRef.current) {
              clearTimeout(qaSilenceTimerRef.current);
            }

            // Wait 2.0s silence after candidate finishes asking question before Hana responds
            qaSilenceTimerRef.current = setTimeout(() => {
              const qText = cleanDeduplicatedTranscript(candidateTranscriptRef.current.trim());
              if (!qText || hanaIsSpeakingRef.current) return;
              if (detectCandidateFinishedIntent(qText, 'candidate_qa')) {
                concludeQaSession();
              } else if (qText.length >= 5) {
                answerCandidateQaQuestion(qText);
              }
            }, 2000);
          }

          // 3. TASK PHASES (Resume, Written, Pressure, Snapshot)
          else if (
            curPhase === 'task_resume' ||
            curPhase === 'task_written' ||
            curPhase === 'task_pressure' ||
            curPhase === 'task_snapshot'
          ) {
            setCandidateLiveTranscript(currentUtterance);
            setIsCandidateSpeaking(true);

            // First check situational questions (e.g. asking about phone number during snapshot task)
            if (handleSituationalQuery(lower, curPhase)) {
              clearCandidateTranscript();
              return;
            }

            // Check for general task confusion
            const confusionKeywords = [
              'what should i do',
              'what do i do',
              'what am i supposed to do',
              'what to do',
              'can you repeat',
              'could you repeat',
              'repeat that',
              'repeat please',
              'say that again',
              'explain again',
              'explain that again',
              'could you explain',
              'can you explain',
              'what does this mean',
              'what do you mean',
              'i am confused',
              "i'm confused",
              'i do not understand',
              "i don't understand",
              'help me',
              'need help',
              'how do i do this',
            ];

            const foundConfusion = confusionKeywords.find((k) => lower.includes(k));
            if (foundConfusion && !hanaIsSpeakingRef.current) {
              reExplainCurrentTask(curPhase);
              clearCandidateTranscript();
              return;
            }

            // A. TASK RESUME VOICE ADVANCE
            if (curPhase === 'task_resume') {
              const isResumeDoneIntent = /\b(done|finished|submit|next|proceed|uploaded|uploaded my resume|uploaded the resume|ready|continue|that is my resume)\b/i.test(lower);
              if (isResumeDoneIntent && !hanaIsSpeakingRef.current) {
                if (uploadedResumeRef.current) {
                  handleSubmitResumeTaskRef.current?.();
                  clearCandidateTranscript();
                } else {
                  speakHanaLine(
                    "Please select or drop your resume document first into the upload area, then say ready or done!",
                    undefined,
                    'neutral'
                  );
                }
                return;
              }
            }

            // B. TASK WRITTEN VOICE ADVANCE
            else if (curPhase === 'task_written') {
              const isWrittenDoneIntent = /\b(done|finished|submit|next|proceed|ready|i am done|i'm done|completed|all written)\b/i.test(lower);
              if (isWrittenDoneIntent && !hanaIsSpeakingRef.current) {
                if (writtenTextRef.current.trim().length >= 100) {
                  handleSubmitWrittenTaskRef.current?.();
                  clearCandidateTranscript();
                } else {
                  const currentChars = writtenTextRef.current.trim().length;
                  speakHanaLine(
                    `You currently have ${currentChars} characters. Please write at least 100 characters in the reflection box before submitting!`,
                    undefined,
                    'neutral'
                  );
                }
                return;
              }
            }

            // C. TASK PRESSURE VOICE ADVANCE
            else if (curPhase === 'task_pressure') {
              let matchedPressure: string | null = null;
              if (/\b(not at all|avoid)\b/i.test(lower)) {
                matchedPressure = 'Not at all - I avoid such situations';
              } else if (/\b(moderate|as long as the team|team does too)\b/i.test(lower)) {
                matchedPressure = 'Moderate - I can work as long as the team does, too';
              } else if (/\b(comfortable|exciting|find challenging)\b/i.test(lower)) {
                matchedPressure = 'Comfortable - I find challenging situations very exciting for me';
              } else if (/\b(hell yeah|pressure fears me|do not fear pressure)\b/i.test(lower)) {
                matchedPressure = 'HELL YEAH - I do not fear pressure; pressure fears me';
              }

              if (matchedPressure && !hanaIsSpeakingRef.current) {
                setPressureRating(matchedPressure);
                triggerTaskPanelInteraction(2200, false);
                setTimeout(() => {
                  handleSubmitPressureRatingRef.current?.(matchedPressure!);
                }, 400);
                clearCandidateTranscript();
                return;
              }

              const isConfirmIntent = /\b(ready|done|submit|next|confirm|that is my answer)\b/i.test(lower);
              if (isConfirmIntent && pressureRatingRef.current && !hanaIsSpeakingRef.current) {
                handleSubmitPressureRatingRef.current?.();
                clearCandidateTranscript();
                return;
              }
            }

            // D. VOICE TRIGGER FOR SNAPSHOT STEP
            else if (curPhase === 'task_snapshot') {
              const isCandidateAskingQuestion = /(\?|what|how|why|where|should i|can i|do i|is it|is this|which|phone|paper|explain)/i.test(lower);

              const isSkipIntent = /\b(skip|skip photo|next task|skip snapshot)\b/i.test(lower);
              if (isSkipIntent && !hanaIsSpeakingRef.current) {
                advanceToPhase('candidate_qa');
                setCandidateLiveTranscript('');
                candidateTranscriptRef.current = '';
                return;
              }

              const snapshotTriggers = [
                'take photo',
                'take a photo',
                'take picture',
                'take a picture',
                'say cheese',
                'okay click',
                'yes click',
                'click',
                'cheese',
                'snap',
                'capture',
                'shoot',
                'ready',
                'do it',
                'photo',
                'picture',
                'pose',
              ];

              const foundTrigger = snapshotTriggers.find((t) => {
                const rx = new RegExp(`\\b${t}\\b`, 'i');
                return rx.test(lower) || lower.includes(t);
              });

              if (foundTrigger && !isTriggerLockedRef.current && !isCandidateAskingQuestion && !hanaIsSpeakingRef.current) {
                isTriggerLockedRef.current = true;
                setLastDetectedTrigger(foundTrigger);
                handleTakeSnapshotTriggerRef.current?.();
                setCandidateLiveTranscript('');
                candidateTranscriptRef.current = '';
                setTimeout(() => {
                  isTriggerLockedRef.current = false;
                }, 2400);
              }
            }
          }
        };

        recognition.onerror = (e: any) => {
          if (e.error === 'not-allowed') {
            console.warn('Meeting mic access denied in speech rec');
          }
        };

        recognition.onend = () => {
          setIsCandidateSpeaking(false);
          if (!isDisposed && stageRef.current === 'meeting') {
            if (
              !hanaIsSpeakingRef.current &&
              !(typeof window !== 'undefined' && window.speechSynthesis?.speaking) &&
              Date.now() >= speechCooldownUntilRef.current
            ) {
              setTimeout(() => {
                if (
                  !isDisposed &&
                  stageRef.current === 'meeting' &&
                  !hanaIsSpeakingRef.current &&
                  !(window.speechSynthesis?.speaking)
                ) {
                  try {
                    recognition.start();
                  } catch {}
                }
              }, 300);
            }
          }
        };

        recognition.start();
        recognitionRef.current = recognition;
      } catch (e) {
        console.warn('SpeechRecognition start failed:', e);
      }
    };

    initMeetingRecognition();

    return () => {
      isDisposed = true;
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
      if (qaSilenceTimerRef.current) {
        clearTimeout(qaSilenceTimerRef.current);
      }
      try {
        recognition?.stop();
      } catch {}
    };
  }, [
    stage,
    handleSituationalQuery,
    reExplainCurrentTask,
    resetSilenceTimer,
    answerCandidateQaQuestion,
    concludeQaSession,
    qaStageState,
  ]);

  // ----------------------------------------------------
  // Video Recording Engine (Full Screen / Meeting Capture)
  // Records the interview session with audio & video
  // ----------------------------------------------------
  const startRecordingSession = async () => {
    try {
      recordedChunksRef.current = [];
      setVideoPlaybackError(false);

      const streamToRecord = mediaStreamRef.current;
      if (!streamToRecord) {
        console.warn('Waiting for mediaStream to initiate session recorder');
        return;
      }

      // Detect best supported format
      let mimeType = 'video/webm;codecs=vp8,opus';
      if (typeof MediaRecorder !== 'undefined') {
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          if (MediaRecorder.isTypeSupported('video/webm')) {
            mimeType = 'video/webm';
          } else if (MediaRecorder.isTypeSupported('video/mp4')) {
            mimeType = 'video/mp4';
          } else {
            mimeType = '';
          }
        }
      }

      let recorder: MediaRecorder;
      try {
        recorder = mimeType ? new MediaRecorder(streamToRecord, { mimeType }) : new MediaRecorder(streamToRecord);
      } catch {
        recorder = new MediaRecorder(streamToRecord);
      }

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        if (recordedChunksRef.current.length > 0) {
          try {
            const format = recorder.mimeType || mimeType || 'video/webm';
            const fullBlob = new Blob(recordedChunksRef.current, { type: format });
            const videoUrl = URL.createObjectURL(fullBlob);
            setRecordedVideoUrl(videoUrl);
          } catch (err) {
            console.warn('Failed to build recording blob:', err);
          }
        }
        setIsRecordingFinalizing(false);
      };

      // Gather chunks every 500ms so data is continually captured
      recorder.start(500);
      mediaRecorderRef.current = recorder;

      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      setRecordedDuration(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordedDuration((prev) => prev + 1);
      }, 1000);
    } catch (e) {
      console.warn('MediaRecorder error:', e);
    }
  };

  const stopRecordingSession = (): Promise<string | null> => {
    return new Promise((resolve) => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        if (recordedChunksRef.current.length > 0 && !recordedVideoUrl) {
          try {
            const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            setRecordedVideoUrl(url);
            resolve(url);
            return;
          } catch {}
        }
        resolve(recordedVideoUrl);
        return;
      }

      setIsRecordingFinalizing(true);

      const finalize = () => {
        try {
          if (recordedChunksRef.current.length > 0) {
            const blob = new Blob(recordedChunksRef.current, {
              type: recorder.mimeType || 'video/webm',
            });
            const url = URL.createObjectURL(blob);
            setRecordedVideoUrl(url);
            setIsRecordingFinalizing(false);
            resolve(url);
            return;
          }
        } catch (e) {
          console.warn('Error creating video blob from recorder:', e);
        }
        setIsRecordingFinalizing(false);
        resolve(null);
      };

      recorder.onstop = () => {
        finalize();
      };

      try {
        recorder.requestData();
      } catch {}

      try {
        recorder.stop();
      } catch {
        finalize();
      }
    });
  };

  // ----------------------------------------------------
  // Enter Meeting & Start Phases
  // ----------------------------------------------------
  const handleJoinMeeting = () => {
    // If Web Speech API is not supported, block proceeding with clear prompt
    if (!isWebSpeechSupported) {
      return;
    }

    setStage('meeting');
    setActivePov('candidate');
    setMeetingPhase('joining');

    // Ensure candidate video element is attached
    setTimeout(() => {
      if (localVideoRef.current && mediaStreamRef.current) {
        localVideoRef.current.srcObject = mediaStreamRef.current;
      }
    }, 100);

    startRecordingSession();
    soundManager.playSend();

    // Hana enters shortly (within 3 seconds)
    setTimeout(() => {
      setHanaEntered(true);
      soundManager.playReceive();

      // Hana welcomes the candidate with neutral professional tone
      setMeetingPhase('welcome');
      const nameGreeting = candidateName.trim() ? `, ${candidateName.trim()}` : '';
      const welcomeText = `Hello! Welcome to your interview with MuxAI. I'm Hana, your interviewer today. It's great to meet you${nameGreeting}. Can you hear and see me clearly?`;
      speakHanaLine(
        welcomeText,
        () => {
          setTimeout(() => {
            if (meetingPhaseRef.current === 'welcome' && !hanaIsSpeakingRef.current) {
              advanceToPhase('question_1');
            }
          }, 4500);
        },
        'neutral'
      );
    }, 2400);
  };

  // Unified phase advance with vocal instructions, Mixamo animations, and 3D gaze towards task panels
  const advanceToPhase = (nextPhase: MeetingPhase) => {
    setMeetingPhase(nextPhase);
    clearCandidateTranscript();

    if (nextPhase === 'question_1') {
      setHanaLookTarget(null);
      const q1 = pickUniqueVoiceline('question1Intro');
      speakHanaLine(
        q1,
        () => {
          resetSilenceTimer();
        },
        'neutral'
      );
    } else if (nextPhase === 'question_2') {
      setHanaLookTarget(null);
      const q2 = pickUniqueVoiceline('question2Intro');
      speakHanaLine(
        q2,
        () => {
          resetSilenceTimer();
        },
        'neutral'
      );
    } else if (nextPhase === 'task_resume') {
      triggerTaskPanelInteraction(3800, true);
      const prompt = pickUniqueVoiceline('taskResumeIntro');
      speakHanaLine(prompt, undefined, 'neutral');
    } else if (nextPhase === 'task_written') {
      triggerTaskPanelInteraction(3800, true);
      const prompt = pickUniqueVoiceline('taskWrittenIntro');
      speakHanaLine(prompt, undefined, 'neutral');
    } else if (nextPhase === 'task_pressure') {
      triggerTaskPanelInteraction(3800, true);
      const prompt = pickUniqueVoiceline('taskPressureIntro');
      speakHanaLine(prompt, undefined, 'neutral');
    } else if (nextPhase === 'task_snapshot') {
      triggerTaskPanelInteraction(3800, true);
      setSnapshotStep(1);
      snapshotStepRef.current = 1;
      setIsListeningForTrigger(false);
      isListeningForTriggerRef.current = false;
      const prompt = pickUniqueVoiceline('taskSnapshotIntro');
      speakHanaLine(
        prompt,
        () => {
          setTimeout(() => {
            setIsListeningForTrigger(true);
            isListeningForTriggerRef.current = true;
          }, 600);
        },
        'neutral'
      );
    } else if (nextPhase === 'candidate_qa') {
      setHanaLookTarget(null);
      setQaStageState('listening');
      // Check if MuxAI Ollama server is online; if online, run the required hinting phase
      refreshMuxAiServerStatus().then((online) => {
        if (online) {
          setQaStageState('hinting');
          const hintingLine =
            'Okay, I have all the information ready from the company. Feel free to ask any questions now';
          speakHanaLine(
            hintingLine,
            () => {
              setQaStageState('waiting_5s');
              startQa5sSilenceTimer();
            },
            'neutral'
          );
        } else {
          const prompt = pickUniqueVoiceline('qaIntroFallback');
          speakHanaLine(
            prompt,
            () => {
              setQaStageState('waiting_5s');
              startQa5sSilenceTimer();
            },
            'neutral'
          );
        }
      });
    } else if (nextPhase === 'wrapup') {
      setHanaLookTarget(null);
      // Play "mixamo_thankful.fbx" for the final wrapup
      triggerHanaAnimation('mixamo_thankful.fbx', true);
      const wrapup = pickUniqueVoiceline('wrapupFinal');
      speakHanaLine(
        wrapup,
        () => {
          setTimeout(() => {
            handleEndMeetingAndReview();
          }, 1500);
        },
        'neutral'
      );
    }
  };
  advanceToPhaseRef.current = advanceToPhase;

  // Handle Resume File Upload (with automatic voice-first advance upon upload)
  const handleResumeFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingResume(true);
    soundManager.playSend();
    // Look towards the task panel when candidate modifies/uploads document
    triggerTaskPanelInteraction(2600, false);

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const fileSizeKb = `${(file.size / 1024).toFixed(1)} KB`;
      const uploaded: UploadedResume = {
        fileName: file.name,
        fileSize: fileSizeKb,
        fileType: file.type || 'application/octet-stream',
        dataUrl,
        uploadedAt: new Date().toLocaleTimeString(),
      };

      if (file.type.includes('text') || file.name.endsWith('.txt')) {
        const textReader = new FileReader();
        textReader.onload = () => {
          uploaded.textContent = textReader.result as string;
          setUploadedResume(uploaded);
          uploadedResumeRef.current = uploaded;
          setIsUploadingResume(false);
          soundManager.playReceive();
          // Auto-advance seamlessly without requiring manual buttons
          setTimeout(() => {
            handleSubmitResumeTask(uploaded);
          }, 1100);
        };
        textReader.readAsText(file);
      } else {
        setUploadedResume(uploaded);
        uploadedResumeRef.current = uploaded;
        setIsUploadingResume(false);
        soundManager.playReceive();
        // Auto-advance seamlessly without requiring manual buttons
        setTimeout(() => {
          handleSubmitResumeTask(uploaded);
        }, 1100);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitResumeTask = (docToSubmit?: UploadedResume) => {
    const doc = docToSubmit || uploadedResumeRef.current || uploadedResume;
    if (!doc) return;
    setResumeSubmitted(true);
    soundManager.playReceive();
    triggerTaskPanelInteraction(2800, true);

    setRecordedResponses((prev) => [
      ...prev,
      {
        phase: 'task_resume',
        question: 'Credentials Document Verification',
        answer: `Uploaded: ${doc.fileName} (${doc.fileSize})`,
        timestamp: new Date().toLocaleTimeString(),
        aiNotes: 'Document uploaded and attached to candidate dossier for recruiter evaluation.',
      },
    ]);

    // Hana speaks varied transition verbal feedback
    const transitionText = pickUniqueVoiceline('taskResumeDone');
    speakHanaLine(
      transitionText,
      () => {
        setTimeout(() => {
          advanceToPhase('task_written');
        }, 900);
      },
      'neutral'
    );
  };

  // Submit Written Task
  const handleSubmitWrittenTask = () => {
    const textVal = writtenTextRef.current || writtenText;
    if (textVal.trim().length < 100) return;
    setWrittenSubmitted(true);
    soundManager.playSend();
    triggerTaskPanelInteraction(2800, true);

    setRecordedResponses((prev) => [
      ...prev,
      {
        phase: 'task_written',
        question: 'Write down 3 things you like about yourself and why.',
        answer: textVal,
        timestamp: new Date().toLocaleTimeString(),
        aiNotes: 'Exceeds length threshold. Structured answers showing self-awareness and confidence.',
      },
    ]);

    // Hana varied verbal feedback and advance
    const feedback = pickUniqueVoiceline('taskWrittenDone');
    speakHanaLine(
      feedback,
      () => {
        setTimeout(() => {
          advanceToPhase('task_pressure');
        }, 900);
      },
      'neutral'
    );
  };

  // Submit Pressure Rating Task
  const handleSubmitPressureRating = (val?: string) => {
    const chosen = val || pressureRatingRef.current || pressureRating;
    if (!chosen) return;
    setPressureRating(chosen);
    setPressureSubmitted(true);
    soundManager.playSend();
    triggerTaskPanelInteraction(2800, true);

    setRecordedResponses((prev) => [
      ...prev,
      {
        phase: 'task_pressure',
        question: 'How well do you perform under pressure?',
        answer: chosen,
        timestamp: new Date().toLocaleTimeString(),
        aiNotes: `Candidate selected: "${chosen}". Demonstrates high resilience and initiative.`,
      },
    ]);

    const feedback = pickUniqueVoiceline('taskPressureDone');
    speakHanaLine(
      feedback,
      () => {
        setTimeout(() => {
          advanceToPhase('task_snapshot');
        }, 900);
      },
      'neutral'
    );
  };

  // Capture Image From Camera Video Feed (Guaranteed non-null frame)
  const captureCameraFrame = (): string => {
    try {
      const videoEl = spotlightVideoRef.current || localVideoRef.current || lobbyVideoRef.current;
      const canvas = document.createElement('canvas');
      const w = videoEl?.videoWidth || 640;
      const h = videoEl?.videoHeight || 480;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No 2d context');

      if (videoEl && videoEl.readyState >= 2) {
        // Mirror horizontally to match self-view
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      } else {
        // High fidelity fallback snapshot card
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, '#0f172a');
        grad.addColorStop(1, '#1e293b');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('IDENTITY VERIFICATION FRAME', w / 2, h / 2 - 20);
        ctx.fillStyle = '#ffffff';
        ctx.font = '16px monospace';
        ctx.fillText(candidateName.trim() || 'Verified Candidate', w / 2, h / 2 + 15);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '13px sans-serif';
        ctx.fillText(new Date().toLocaleTimeString(), w / 2, h / 2 + 45);
      }
      return canvas.toDataURL('image/jpeg', 0.88);
    } catch {
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#0f172a"/><text x="50%" y="50%" fill="#38bdf8" font-size="20" font-family="sans-serif" text-anchor="middle">Verification Snapshot</text></svg>');
    }
  };

  // Snapshot Step Trigger Handler
  const handleTakeSnapshotTrigger = () => {
    soundManager.playReceive();
    const frame = captureCameraFrame();
    const currentStep = snapshotStepRef.current || 1;
    // Look towards task panel & trigger button push when snapshot step updates
    triggerTaskPanelInteraction(2800, true);

    if (currentStep === 1) {
      setSnapshots((prev) => [
        ...prev,
        {
          id: 'snap-1',
          angle: 'forward',
          label: 'Forward Pose + Phone on Paper',
          dataUrl: frame,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      snapshotStepRef.current = 2;
      setSnapshotStep(2);
      setIsListeningForTrigger(false);
      isListeningForTriggerRef.current = false;
      const nextPrompt = pickUniqueVoiceline('taskSnapshotStep2');
      speakHanaLine(
        nextPrompt,
        () => {
          setTimeout(() => {
            setIsListeningForTrigger(true);
            isListeningForTriggerRef.current = true;
          }, 600);
        },
        'neutral'
      );
    } else if (currentStep === 2) {
      setSnapshots((prev) => [
        ...prev,
        {
          id: 'snap-2',
          angle: 'left',
          label: 'Left Angle Pose',
          dataUrl: frame,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      snapshotStepRef.current = 3;
      setSnapshotStep(3);
      setIsListeningForTrigger(false);
      isListeningForTriggerRef.current = false;
      const nextPrompt = pickUniqueVoiceline('taskSnapshotStep3');
      speakHanaLine(
        nextPrompt,
        () => {
          setTimeout(() => {
            setIsListeningForTrigger(true);
            isListeningForTriggerRef.current = true;
          }, 600);
        },
        'neutral'
      );
    } else if (currentStep >= 3) {
      setSnapshots((prev) => [
        ...prev,
        {
          id: 'snap-3',
          angle: 'right',
          label: 'Right Angle Pose',
          dataUrl: frame,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      snapshotStepRef.current = 0;
      setSnapshotStep(0);
      setIsListeningForTrigger(false);
      isListeningForTriggerRef.current = false;

      setRecordedResponses((prev) => [
        ...prev,
        {
          phase: 'task_snapshot',
          question: 'Visual Identity & Multi-Angle Verification',
          answer: '3 angles captured (Forward, Left, Right) via voice triggers with held note.',
          timestamp: new Date().toLocaleTimeString(),
          aiNotes: 'Identity verification images confirmed with clear orientation check.',
        },
      ]);

      const finishedText = pickUniqueVoiceline('taskSnapshotDone');
      speakHanaLine(
        finishedText,
        () => {
          setTimeout(() => {
            advanceToPhase('candidate_qa');
          }, 1200);
        },
        'neutral'
      );
    }
  };

  // Keep fresh function references accessible by speech recognition without closure staleness
  const handleSubmitResumeTaskRef = useRef(handleSubmitResumeTask);
  useEffect(() => {
    handleSubmitResumeTaskRef.current = handleSubmitResumeTask;
  });

  const handleSubmitWrittenTaskRef = useRef(handleSubmitWrittenTask);
  useEffect(() => {
    handleSubmitWrittenTaskRef.current = handleSubmitWrittenTask;
  });

  const handleSubmitPressureRatingRef = useRef(handleSubmitPressureRating);
  useEffect(() => {
    handleSubmitPressureRatingRef.current = handleSubmitPressureRating;
  });

  const handleTakeSnapshotTriggerRef = useRef(handleTakeSnapshotTrigger);
  useEffect(() => {
    handleTakeSnapshotTriggerRef.current = handleTakeSnapshotTrigger;
  });

  // Active watcher: even if keywords appear anywhere in candidate's live subtitles during snapshot task, act upon it!
  useEffect(() => {
    if (meetingPhase !== 'task_snapshot') return;
    if (isTriggerLockedRef.current || hanaIsSpeakingRef.current) return;
    const lower = candidateLiveTranscript.toLowerCase().trim();
    if (!lower) return;

    const isQuestion = /(\?|what|how|why|where|should i|can i|explain)/i.test(lower);
    if (isQuestion) return;

    const snapshotKeywords = [
      'take photo',
      'take a photo',
      'take picture',
      'take a picture',
      'say cheese',
      'okay click',
      'yes click',
      'click',
      'cheese',
      'snap',
      'capture',
      'shoot',
      'ready',
      'do it',
      'photo',
      'picture',
      'pose',
    ];

    const matched = snapshotKeywords.find((kw) => {
      const rx = new RegExp(`\\b${kw}\\b`, 'i');
      return rx.test(lower) || lower.includes(kw);
    });

    if (matched) {
      isTriggerLockedRef.current = true;
      setLastDetectedTrigger(matched);
      handleTakeSnapshotTriggerRef.current?.();
      setCandidateLiveTranscript('');
      candidateTranscriptRef.current = '';
      setTimeout(() => {
        isTriggerLockedRef.current = false;
      }, 1800);
    }
  }, [candidateLiveTranscript, meetingPhase]);

  // Candidate Q&A handling (manual text input fallback if used)
  const handleSendCandidateQuestion = () => {
    const qText = candidateQuestionInput.trim();
    if (!qText) return;
    setCandidateQuestionInput('');
    answerCandidateQaQuestion(qText);
  };

  const handleFinishQaNoQuestions = () => {
    concludeQaSession();
  };

  // ----------------------------------------------------
  // End Meeting & Transition to Recruiter Review Mode
  // ----------------------------------------------------
  const handleEndMeetingAndReview = async () => {
    window.speechSynthesis?.cancel();
    lipSyncManager.endSpeech();
    await stopRecordingSession();
    setStage('candidate_complete');
    setActivePov('candidate');
    try {
      confetti({
        particleCount: 75,
        spread: 70,
        origin: { y: 0.6 },
      });
    } catch {
      // ignore
    }

    // Submit completed candidate session to NeonDB
    try {
      const subId = `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      fetch(`/api/interview/${encodeURIComponent(interviewId)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: subId,
          candidate_name: effectiveCandidateName,
          candidate_email: accountUser?.email || '',
          score: 88,
          responses: recordedResponses,
          snapshots: snapshots,
          resume_data: uploadedResume
            ? {
                fileName: uploadedResume.fileName,
                fileSize: uploadedResume.fileSize,
                uploadedAt: uploadedResume.uploadedAt,
              }
            : null,
          written_task: writtenText,
          pressure_rating: pressureRating,
          ai_evaluation: {
            strengths: ['Articulate communication', 'High engineering agency and technical resilience'],
            areas_for_growth: ['Continue elaborating on distributed systems edge cases'],
            summary: 'Candidate successfully completed all autonomous screening phases and assessment tasks.',
            recommendation: 'Strong Hire',
          },
        }),
      }).catch((err) => console.warn('Failed to submit interview to NeonDB:', err));
    } catch {}
  };

  const handleGoToRecruiterReview = () => {
    setStage('recruiter_review');
    setActivePov('recruiter');
  };

  // Recruiter actions
  const handleShortlistCandidate = () => {
    setCandidateStatus('shortlisted');
    soundManager.playReceive();
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 },
    });
  };

  const handleRejectCandidate = () => {
    setCandidateStatus('rejected');
    soundManager.playSend();
  };

  const handleDiscardRecording = () => {
    if (confirm('Are you sure you want to discard this interview recording?')) {
      if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
      setRecordedVideoUrl(null);
      recordedChunksRef.current = [];
    }
  };

  const formatSeconds = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const remaining = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${remaining.toString().padStart(2, '0')}`;
  };

  // ----------------------------------------------------
  // Recruiter Flow & Scenario Configuration Modal
  // ----------------------------------------------------
  const renderScenarioConfigModal = () => {
    if (!isConfigModalOpen) return null;
    return (
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-neutral-200 animate-in fade-in zoom-in-95">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-4 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-sky-100 text-sky-600 flex items-center justify-center">
                <Settings2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-neutral-900 font-heading">
                  Recruiter Flow &amp; Scenario Settings
                </h3>
                <p className="text-xs text-neutral-500">
                  Configure candidate voice thresholds, silence timeouts &amp; voicelines
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsConfigModalOpen(false)}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors cursor-pointer"
            >
              <XCircle className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-4 text-xs text-neutral-700 max-h-[70vh] overflow-y-auto pr-1">
            {/* Setting 1: Open-Ended Question Silence Wait */}
            <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200">
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-bold text-neutral-900 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-sky-600" />
                  <span>Open Questions Silence Timeout</span>
                </label>
                <span className="font-mono font-bold text-sky-600 bg-sky-50 px-2.5 py-0.5 rounded border border-sky-200">
                  {scenarioConfig.openQuestionSilenceSeconds} seconds
                </span>
              </div>
              <p className="text-[11px] text-neutral-500 mb-3">
                How long Hana continues recording during candidate response before detecting silence (Default: 3.0s).
              </p>
              <input
                type="range"
                min="2.0"
                max="6.0"
                step="0.5"
                value={scenarioConfig.openQuestionSilenceSeconds}
                onChange={(e) =>
                  updateScenarioConfig({ openQuestionSilenceSeconds: parseFloat(e.target.value) })
                }
                className="w-full accent-sky-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-neutral-400 font-mono mt-1">
                <span>2.0s</span>
                <span>3.0s (default)</span>
                <span>6.0s</span>
              </div>
            </div>

            {/* Setting 2: Silence Transition Voiceline */}
            <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200">
              <label className="font-bold text-neutral-900 block mb-1.5 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-sky-600" />
                <span>Silence Transition Voiceline</span>
              </label>
              <p className="text-[11px] text-neutral-500 mb-3">
                Varied voiceline spoken by Hana when candidate finishes speaking before advancing to the next step.
              </p>
              <div className="space-y-2">
                {scenarioConfig.silenceVoicelineOptions.map((line, idx) => (
                  <label
                    key={idx}
                    className={`flex items-start gap-2.5 p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                      scenarioConfig.activeSilenceVoiceline === line
                        ? 'bg-sky-50 border-sky-500 text-neutral-900 font-medium'
                        : 'bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="silenceVoiceline"
                      checked={scenarioConfig.activeSilenceVoiceline === line}
                      onChange={() => updateScenarioConfig({ activeSilenceVoiceline: line })}
                      className="mt-0.5 accent-sky-500"
                    />
                    <span className="leading-relaxed">&ldquo;{line}&rdquo;</span>
                  </label>
                ))}
              </div>
              <div className="mt-3 pt-2.5 border-t border-neutral-200">
                <label className="text-[11px] font-semibold text-neutral-700 block mb-1">
                  Or enter custom voiceline:
                </label>
                <input
                  type="text"
                  value={scenarioConfig.activeSilenceVoiceline}
                  onChange={(e) => updateScenarioConfig({ activeSilenceVoiceline: e.target.value })}
                  placeholder="e.g. Thank you for your answer, let us proceed..."
                  className="w-full px-3 py-1.5 rounded-xl border border-neutral-200 bg-white text-neutral-900 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
            </div>

            {/* Setting 3: Q&A Silence Timeout */}
            <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200">
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-bold text-neutral-900 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-sky-600" />
                  <span>Q&amp;A Session Silence Timeout</span>
                </label>
                <span className="font-mono font-bold text-sky-600 bg-sky-50 px-2.5 py-0.5 rounded border border-sky-200">
                  {scenarioConfig.qaSilenceSeconds} seconds
                </span>
              </div>
              <p className="text-[11px] text-neutral-500 mb-3">
                How long Hana waits in silence before asking &ldquo;Is that all, or do you have any other questions for me?&rdquo; (Default: 5.0s).
              </p>
              <input
                type="range"
                min="3.0"
                max="8.0"
                step="0.5"
                value={scenarioConfig.qaSilenceSeconds}
                onChange={(e) =>
                  updateScenarioConfig({ qaSilenceSeconds: parseFloat(e.target.value) })
                }
                className="w-full accent-sky-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-neutral-400 font-mono mt-1">
                <span>3.0s</span>
                <span>5.0s (default)</span>
                <span>8.0s</span>
              </div>
            </div>

            {/* Setting 4: Minimum Words Before Silence Check */}
            <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200">
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-bold text-neutral-900 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-sky-600" />
                  <span>Minimum Words Before Silence Check</span>
                </label>
                <span className="font-mono font-bold text-sky-600 bg-sky-50 px-2.5 py-0.5 rounded border border-sky-200">
                  {scenarioConfig.minWordsForOpenQuestionSilence} words
                </span>
              </div>
              <p className="text-[11px] text-neutral-500 mb-3">
                Minimum number of words the candidate must speak during open questions before Hana initiates the silence countdown (e.g. 5–8 words).
              </p>
              <input
                type="range"
                min="3"
                max="12"
                step="1"
                value={scenarioConfig.minWordsForOpenQuestionSilence}
                onChange={(e) =>
                  updateScenarioConfig({ minWordsForOpenQuestionSilence: parseInt(e.target.value, 10) })
                }
                className="w-full accent-sky-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-neutral-400 font-mono mt-1">
                <span>3 words</span>
                <span>6 words (demo default)</span>
                <span>12 words</span>
              </div>
            </div>

            {/* Setting 4: 3D Model in Meeting Room Toggle */}
            <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200">
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-bold text-neutral-900 flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-sky-600" />
                  <span>Show 3D Model in Meeting</span>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    updateScenarioConfig({ showHana3DModel: !scenarioConfig.showHana3DModel })
                  }
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-colors cursor-pointer border ${
                    scenarioConfig.showHana3DModel
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-neutral-200 text-neutral-600 border-neutral-300'
                  }`}
                >
                  {scenarioConfig.showHana3DModel ? 'Enabled (Yes)' : 'Disabled (No)'}
                </button>
              </div>
              <p className="text-[11px] text-neutral-500">
                Choose whether to display the 3D VRM Hana model or a clean static avatar image in the interview room.
              </p>
            </div>

            {/* Candidate Voice Strictness Notice */}
            <div className="p-3.5 rounded-2xl bg-sky-50 border border-sky-200 text-sky-800 text-[11px] leading-relaxed flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 text-sky-600 mt-0.5" />
              <div>
                <strong className="block font-semibold">Strict Audio Isolation Active</strong>
                <span>
                  Microphone recognition is automatically disabled whenever Hana speaks to prevent her voice from feeding back into speech-to-text. Snapshot triggers require exact keyword confirmation after Hana finishes speaking.
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-neutral-100 pt-4 mt-4">
            <button
              type="button"
              onClick={() => {
                updateScenarioConfig(DEFAULT_SCENARIO_CONFIG);
              }}
              className="text-xs text-neutral-500 hover:text-neutral-800 flex items-center gap-1 cursor-pointer transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Defaults</span>
            </button>

            <button
              type="button"
              onClick={() => setIsConfigModalOpen(false)}
              className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-bold text-xs shadow-md shadow-sky-500/20 cursor-pointer transition-colors"
            >
              Save &amp; Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ----------------------------------------------------
  // INTERVIEW DASHBOARD (WHEN NO ?id= QUERY PARAM)
  // ----------------------------------------------------
  if (!activeInterviewId) {
    return (
      <InterviewDashboard
        onNavigateHome={onNavigateHome}
        onNavigateToChat={onNavigateToChat}
        onSelectInterview={(id) => {
          if (onNavigateToInterview) {
            onNavigateToInterview(id);
          } else {
            const nextUrl = id ? `/interview?id=${encodeURIComponent(id)}` : '/interview';
            window.history.pushState({}, '', nextUrl);
            setActiveInterviewId(id ? id.trim() : null);
          }
        }}
        isPremium={isPremium}
        onRequirePremium={onRequirePremium}
        accountUser={accountUser}
      />
    );
  }

  // ----------------------------------------------------
  // STAGE 1: LOBBY & PRE-INTERVIEW SETUP (LIGHT THEME)
  // ----------------------------------------------------
  if (stage === 'lobby') {
    return (
      <div className="min-h-screen bg-[#f8fafc] text-neutral-900 flex flex-col font-sans select-none">
        {/* Refresh Recovery Modal Banner if found */}
        {hasSavedSession && (
          <div className="bg-sky-600 text-white px-4 py-3 border-b border-sky-700 shadow-md flex items-center justify-between z-40">
            <div className="flex items-center gap-2 text-xs sm:text-sm font-medium">
              <RefreshCw className="w-4 h-4 animate-spin text-white" />
              <span>We noticed you were in an active interview session. Would you like to resume where you left off?</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={restoreSession}
                className="px-3 py-1 bg-white text-blue-700 rounded-lg text-xs font-bold hover:bg-neutral-100 shadow transition-colors cursor-pointer"
              >
                Resume Interview
              </button>
              <button
                type="button"
                onClick={discardSavedSession}
                className="px-3 py-1 bg-black/20 text-white rounded-lg text-xs font-medium hover:bg-black/30 transition-colors cursor-pointer"
              >
                Start Fresh
              </button>
            </div>
          </div>
        )}

        {/* Top Navigation */}
        <header className="h-16 border-b border-neutral-200 px-6 flex items-center justify-between bg-white/90 backdrop-blur-md sticky top-0 z-30 shadow-xs">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (onNavigateToInterview) {
                  onNavigateToInterview();
                } else {
                  window.history.pushState({}, '', '/interview');
                  setActiveInterviewId(null);
                }
              }}
              className="px-3 py-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Return to Interviews Dashboard"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Dashboard</span>
            </button>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <h1 className="font-bold text-sm sm:text-base font-heading tracking-tight text-neutral-900">
                {customInterviewData?.title || 'Hana Interview Session'} • ID: {interviewId}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const url = `${window.location.origin}/interview?id=${encodeURIComponent(interviewId)}`;
                navigator.clipboard?.writeText(url);
                alert('Copied public interview link: ' + url);
              }}
              className="px-2.5 py-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors"
              title="Copy Public Link"
            >
              <Copy className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Copy Link</span>
            </button>
          </div>
        </header>

        {/* Main Lobby Container */}
        <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col justify-center">
          <div className="mb-8 text-center sm:text-left">
            <h2 className="text-2xl sm:text-4xl font-bold font-heading text-neutral-900 tracking-tight">
              Get ready for your interview
            </h2>
            <p className="text-neutral-600 text-sm sm:text-base mt-2 max-w-2xl">
              Let&apos;s check if your camera and microphone are working properly before joining the meeting room.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left 7 cols: Live Camera Feed & Device Selectors */}
            <div className="lg:col-span-7 space-y-4">
              <div className="relative aspect-video rounded-3xl overflow-hidden bg-neutral-900 border border-neutral-200 shadow-xl flex items-center justify-center group">
                <video
                  ref={lobbyVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover transform -scale-x-100 ${!isCameraActive ? 'hidden' : ''}`}
                />

                {!isCameraActive && (
                  <div className="flex flex-col items-center gap-3 text-neutral-400">
                    <VideoOff className="w-12 h-12 stroke-[1.5]" />
                    <span className="text-sm">Camera is currently turned off</span>
                  </div>
                )}

                {permissionError && (
                  <div className="absolute inset-0 bg-neutral-900/90 backdrop-blur-sm p-6 flex flex-col items-center justify-center text-center">
                    <AlertCircle className="w-10 h-10 text-amber-400 mb-3" />
                    <h4 className="font-semibold text-white text-sm">Media Access Required</h4>
                    <p className="text-xs text-neutral-300 max-w-sm mt-1 mb-4">{permissionError}</p>
                    <button
                      type="button"
                      onClick={() => startCameraStream()}
                      className="px-4 py-2 rounded-xl bg-white text-neutral-900 text-xs font-bold hover:bg-neutral-100 cursor-pointer shadow-sm"
                    >
                      Retry Camera &amp; Mic Access
                    </button>
                  </div>
                )}

                {/* Floating Quick Action Overlay */}
                <div className="absolute bottom-4 inset-x-4 flex items-center justify-between z-10 pointer-events-auto">
                  <div className="px-3.5 py-1.5 rounded-full bg-neutral-900/80 backdrop-blur-md border border-white/20 text-xs font-semibold text-white">
                    {effectiveCandidateName} (Preview)
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={toggleCamera}
                      className={`p-3 rounded-full backdrop-blur-md border transition-all cursor-pointer ${
                        isCameraActive
                          ? 'bg-neutral-900/80 border-white/20 text-white hover:bg-neutral-800'
                          : 'bg-red-500 border-red-400 text-white'
                      }`}
                      title={isCameraActive ? 'Turn off camera' : 'Turn on camera'}
                    >
                      {isCameraActive ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={toggleMic}
                      className={`p-3 rounded-full backdrop-blur-md border transition-all cursor-pointer ${
                        isMicActive
                          ? 'bg-neutral-900/80 border-white/20 text-white hover:bg-neutral-800'
                          : 'bg-red-500 border-red-400 text-white'
                      }`}
                      title={isMicActive ? 'Mute microphone' : 'Unmute microphone'}
                    >
                      {isMicActive ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Hardware Device Selection Selectors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="p-3.5 rounded-2xl bg-white border border-neutral-200 shadow-xs space-y-1">
                  <label className="text-xs font-semibold text-neutral-600 block">Camera Source</label>
                  <select
                    value={selectedVideoId}
                    onChange={(e) => {
                      setSelectedVideoId(e.target.value);
                      startCameraStream(e.target.value, selectedAudioId);
                    }}
                    className="w-full text-xs bg-neutral-50 border border-neutral-300 rounded-xl px-3 py-2 text-neutral-800 focus:outline-none focus:border-sky-500"
                  >
                    {videoDevices.map((d, i) => (
                      <option key={d.deviceId || i} value={d.deviceId} className="bg-white text-neutral-900">
                        {d.label || `Camera ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="p-3.5 rounded-2xl bg-white border border-neutral-200 shadow-xs space-y-1">
                  <label className="text-xs font-semibold text-neutral-600 block">Microphone Source</label>
                  <select
                    value={selectedAudioId}
                    onChange={(e) => {
                      setSelectedAudioId(e.target.value);
                      startCameraStream(selectedVideoId, e.target.value);
                    }}
                    className="w-full text-xs bg-neutral-50 border border-neutral-300 rounded-xl px-3 py-2 text-neutral-800 focus:outline-none focus:border-sky-500"
                  >
                    {audioDevices.map((d, i) => (
                      <option key={d.deviceId || i} value={d.deviceId} className="bg-white text-neutral-900">
                        {d.label || `Microphone ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Real-time Voice Agreement Prompt Row */}
              <div className="p-4 rounded-2xl bg-white border border-neutral-200 shadow-xs space-y-2">
                <p className="text-xs text-neutral-700 leading-relaxed">
                  To start the meeting, please say{' '}
                  <strong className="text-neutral-950 font-bold">I am ready to start my interview</strong> and I agree to the rules.
                </p>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 text-xs font-mono">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        isLobbyListening ? 'bg-emerald-500 animate-ping' : 'bg-neutral-400'
                      }`}
                    />
                    <span className="text-neutral-600 truncate">
                      {lobbySpokenText ? `Heard: "${lobbySpokenText}"` : 'Listening...'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                        hasAgreedToRules
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : lobbyMatchPercent > 0
                          ? 'bg-amber-100 text-amber-800 border border-amber-300'
                          : 'bg-neutral-100 text-neutral-600'
                      }`}
                    >
                      {lobbyMatchPercent}% Match
                    </span>
                  </div>
                </div>

                {!isWebSpeechSupported ? (
                  <div className="pt-2 border-t border-neutral-200 flex items-center gap-2 text-xs text-rose-600 font-medium">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                    <span>Web Speech API is required for this screening room. Please use Chrome, Edge, or a supported browser.</span>
                  </div>
                ) : lobbySpeechError ? (
                  <div className="pt-2 border-t border-neutral-200 flex items-center gap-1.5 text-xs text-amber-700">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                    <span>{lobbySpeechError}</span>
                  </div>
                ) : (
                  <div className="pt-2 border-t border-neutral-200 flex items-center justify-between text-xs text-neutral-500">
                    <span className="flex items-center gap-1.5">
                      <Mic className="w-3.5 h-3.5 text-sky-600 animate-pulse" />
                      <span>Speak &ldquo;I am ready to start&rdquo; to proceed</span>
                    </span>
                    <span className="font-mono text-[11px] text-neutral-400">Voice required</span>
                  </div>
                )}
              </div>
            </div>

            {/* Right 5 cols: Readiness Checklist & Join Button */}
            <div className="lg:col-span-5 space-y-5">
              <div className="p-6 rounded-3xl bg-white border border-neutral-200 shadow-md space-y-6">
                <div>
                  <h3 className="text-lg font-bold font-heading text-neutral-900">Interview Readiness</h3>
                  <p className="text-xs text-neutral-500 mt-1">
                    Please make sure you are ready before you begin.
                  </p>
                </div>

                {/* Candidate Info Input (Blank with placeholder e.g. Dewan Mukto) */}
                <div className="space-y-3 pt-2">
                  <div>
                    <label className="text-xs font-semibold text-neutral-700 block mb-1">Your Full Name</label>
                    <input
                      type="text"
                      value={candidateName}
                      onChange={(e) => setCandidateName(e.target.value)}
                      placeholder="e.g. Dewan Mukto"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-50 border border-neutral-300 text-neutral-900 text-sm focus:outline-none focus:border-sky-500 placeholder:text-neutral-400"
                    />
                  </div>
                </div>

                {/* Live Mic Volume Test Meter */}
                <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-neutral-700 flex items-center gap-1.5">
                      <Mic className="w-3.5 h-3.5 text-sky-600" />
                      <span>Microphone Input Level</span>
                    </span>
                    <span className="font-mono text-neutral-500">
                      {hasDetectedMicOnce || micVolume > 8 ? 'Detected' : 'Speak to Test'}
                    </span>
                  </div>
                  <div className="h-2 w-full bg-neutral-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-75 rounded-full ${
                        micVolume > 60 ? 'bg-emerald-500' : micVolume > 10 ? 'bg-sky-500' : 'bg-neutral-400'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(hasDetectedMicOnce ? 35 : 0, micVolume * 1.5))}%` }}
                    />
                  </div>
                </div>

                {/* Speaker Audio Output Test */}
                <div className="flex items-center justify-between p-3.5 rounded-2xl bg-neutral-50 border border-neutral-200">
                  <div className="flex items-center gap-2.5">
                    <Volume2 className="w-4 h-4 text-neutral-600" />
                    <div>
                      <span className="text-xs font-semibold text-neutral-900 block">Speaker Audio Test</span>
                      <span className="text-[11px] text-neutral-500 block">Hear sample AI recruiter tone</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleTestSpeaker}
                    disabled={isSpeakerTesting}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-neutral-200 hover:bg-neutral-300 text-neutral-800 transition-colors cursor-pointer shrink-0"
                  >
                    {isSpeakerTesting ? 'Playing Sound...' : 'Test Sound'}
                  </button>
                </div>

                {/* Checklist Badges with Red X and Green Checkmark indicators (Non-flickering) */}
                <div className="space-y-2.5 pt-2 border-t border-neutral-200">
                  <div className="flex items-center gap-2 text-xs">
                    {hasPermissions && isCameraActive ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                    )}
                    <span
                      className={
                        hasPermissions && isCameraActive ? 'text-neutral-700 font-medium' : 'text-red-600 font-medium'
                      }
                    >
                      Camera stream connected &amp; ready
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    {hasPermissions && isMicActive && (hasDetectedMicOnce || micVolume > 8 || lobbySpokenText.length > 0) ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                    )}
                    <span
                      className={
                        hasPermissions && isMicActive && (hasDetectedMicOnce || micVolume > 8 || lobbySpokenText.length > 0)
                          ? 'text-neutral-700 font-medium'
                          : 'text-red-600 font-medium'
                      }
                    >
                      Microphone input detected
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    {hasAgreedToRules ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                    )}
                    <span className={hasAgreedToRules ? 'text-neutral-700 font-medium' : 'text-red-600 font-medium'}>
                      Agreement with meeting policies
                    </span>
                  </div>
                </div>

                {/* Join Interview Button / Change your browser button */}
                {!isWebSpeechSupported ? (
                  <button
                    type="button"
                    disabled
                    className="w-full py-4 rounded-2xl text-sm font-bold bg-neutral-200 text-neutral-500 cursor-not-allowed flex items-center justify-center gap-2 border border-neutral-300 shadow-sm"
                  >
                    <AlertCircle className="w-4 h-4 text-amber-500" />
                    <span>Change your browser</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleJoinMeeting}
                    disabled={
                      !hasPermissions ||
                      !isCameraActive ||
                      !isMicActive ||
                      !(hasDetectedMicOnce || micVolume > 8 || lobbySpokenText.length > 0) ||
                      !hasAgreedToRules
                    }
                    className="w-full py-4 rounded-2xl text-sm font-bold bg-sky-500 text-white hover:bg-sky-400 active:scale-95 transition-all shadow-md shadow-sky-500/20 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <span>Enter Video Screening Room</span>
                    <ChevronRight className="w-4 h-4 stroke-[3]" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ----------------------------------------------------
  // STAGE 2: LIVE VIDEO MEETING ROOM (LIGHT THEME)
  // ----------------------------------------------------
  if (stage === 'meeting') {
    const isSpotlightActive =
      meetingPhase === 'task_resume' ||
      meetingPhase === 'task_written' ||
      meetingPhase === 'task_pressure' ||
      meetingPhase === 'task_snapshot';

    return (
      <div className="h-screen w-screen bg-[#f1f5f9] text-neutral-900 flex flex-col font-sans overflow-hidden select-none">
        {/* Meeting Header Bar */}
        <header className="h-14 border-b border-neutral-200 px-4 sm:px-6 flex items-center justify-between bg-white shrink-0 z-30 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-red-50 border border-red-200 text-red-600 text-xs font-mono font-bold">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
              <span>REC {formatSeconds(recordedDuration)}</span>
            </div>
            <div className="hidden sm:block">
              <span className="text-xs font-semibold text-neutral-900 block">
                Hana Interview Session • ID: demo
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-neutral-100 border border-neutral-200 text-neutral-600 text-xs font-mono">
              <Mic className="w-3.5 h-3.5 text-sky-500 animate-pulse" />
              <span>End Interview</span>
            </div>
          </div>
        </header>

        {/* Video Conference Layout */}
        <main className="flex-1 p-3 sm:p-4 overflow-hidden flex flex-col min-h-0 relative">
          {/* Re-explaining Banner Toast */}
          {taskClarificationNotice && (
            <div className="absolute top-2 inset-x-4 z-40 pointer-events-none">
              <div className="px-4 py-2 rounded-2xl bg-sky-600 text-white text-xs font-semibold text-center shadow-lg max-w-md mx-auto flex items-center justify-center gap-2">
                <Info className="w-4 h-4 shrink-0 text-white animate-pulse" />
                <span>{taskClarificationNotice}</span>
              </div>
            </div>
          )}

          <div
            className={`flex-1 grid gap-4 min-h-0 h-full overflow-hidden transition-all duration-300 ${
              isSpotlightActive ? 'grid-cols-1 lg:grid-cols-12' : 'grid-cols-1 md:grid-cols-2'
            }`}
          >
            {/* Unified Participant Tiles: ALWAYS MOUNTED (Eliminates VRM recreation / blank panel bugs) */}
            <div
              className={`min-h-0 flex gap-4 transition-all duration-300 ${
                isSpotlightActive
                  ? 'lg:col-span-4 flex-col'
                  : 'col-span-1 md:col-span-2 grid grid-cols-1 md:grid-cols-2'
              }`}
            >
              {/* Tile 1: Hana (AI Interviewer) */}
              <div
                className={`relative rounded-3xl bg-neutral-900 border border-neutral-300 shadow-lg overflow-hidden flex flex-col items-center justify-center transition-all duration-300 ${
                  isSpotlightActive ? 'flex-1 min-h-[160px]' : 'h-full min-h-0'
                }`}
              >
                {!hanaEntered ? (
                  <div className="flex flex-col items-center gap-4 text-center p-6 animate-pulse">
                    <div className="w-20 h-20 rounded-full bg-sky-500/20 border border-sky-400 flex items-center justify-center text-sky-400">
                      <UserCheck className="w-10 h-10" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-white font-heading">
                        Interviewer is entering the meeting...
                      </h3>
                      <p className="text-xs text-neutral-400 mt-1">Connecting AI interviewer</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Initial Camera Off view of Hana's panel while 3D model loads in background */}
                    <div
                      className={`absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10 transition-opacity duration-700 bg-neutral-900 ${
                        isHana3DReady ? 'opacity-0 pointer-events-none' : 'opacity-100'
                      }`}
                    >
                      <div className="relative mb-4">
                        <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden border-2 border-white/20 shadow-2xl relative">
                          <img
                            src="/Thumbnail.png"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).src = 'https://muxai.vercel.app/logo_Hana.png';
                            }}
                            alt="Hana"
                            className="w-full h-full object-cover"
                          />
                        </div>
                        {hanaIsSpeaking && (
                          <span className="absolute -inset-2 rounded-full border-2 border-sky-400 animate-ping opacity-75 pointer-events-none" />
                        )}
                      </div>

                      <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-black/60 border border-white/10 text-xs text-neutral-300 font-medium mb-1">
                        <VideoOff className="w-3.5 h-3.5 text-neutral-400" />
                        <span>Camera Off • Interviewer</span>
                      </div>
                      <p className="text-[11px] text-neutral-400 font-mono">
                        Connecting...
                      </p>
                    </div>

                    {/* Live 3D VRM Canvas (Avatar interaction touching disabled, neutral emotion default) */}
                    <div
                      className={`w-full h-full relative pointer-events-none select-none transition-opacity duration-700 ${
                        isHana3DReady ? 'opacity-100' : 'opacity-0'
                      }`}
                    >
                      <VRMCanvas
                        interactive={false}
                        isSpeaking={hanaIsSpeaking}
                        emotion={hanaEmotion}
                        modelFileName="hana_v1.2_interviewer_vrm1.vrm"
                        enablePointerTracking={false}
                        disableIdleWaitingAnimations={true}
                        nodTrigger={nodCount}
                        customAnimationTrigger={customAnimationTrigger}
                        lookTargetOffset={hanaLookTarget}
                        onLoaded={() => {
                          setTimeout(() => {
                            setIsHana3DReady(true);
                          }, 1200);
                        }}
                      />
                    </div>

                    {/* Speaking Glow Halo */}
                    {hanaIsSpeaking && (
                      <div className="absolute inset-0 pointer-events-none ring-2 ring-sky-400/50 rounded-3xl animate-pulse" />
                    )}

                    {/* Reaction Tag */}
                    {hanaReactionText && !hanaIsSpeaking && (
                      <div className="absolute top-4 left-4 px-3 py-1 rounded-full bg-black/70 backdrop-blur-md border border-white/20 text-xs text-sky-400 font-mono animate-in fade-in z-20">
                        {hanaReactionText}
                      </div>
                    )}
                  </>
                )}

                {/* Tile Label */}
                <div className="absolute bottom-4 left-4 px-3.5 py-1.5 rounded-full bg-black/70 backdrop-blur-md border border-white/20 flex items-center gap-2 z-20">
                  <span className={`w-2 h-2 rounded-full ${hanaIsSpeaking ? 'bg-sky-400 animate-pulse' : 'bg-emerald-400'}`} />
                  <span className="text-xs font-semibold text-white">Interviewer</span>
                </div>
              </div>

              {/* Tile 2: Candidate Video Feed (Always active in interview feed) */}
              <div
                className={`relative rounded-3xl bg-neutral-900 border border-neutral-300 shadow-lg overflow-hidden flex items-center justify-center transition-all duration-300 ${
                  isSpotlightActive ? 'flex-1 min-h-[160px]' : 'h-full min-h-0'
                }`}
              >
                <video
                  ref={(el) => {
                    localVideoRef.current = el;
                    spotlightVideoRef.current = el;
                    if (el && mediaStreamRef.current && el.srcObject !== mediaStreamRef.current) {
                      el.srcObject = mediaStreamRef.current;
                    }
                  }}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover transform -scale-x-100 ${!isCameraActive ? 'hidden' : ''}`}
                />

                {!isCameraActive && (
                  <div className="flex flex-col items-center gap-2 text-neutral-400">
                    <VideoOff className="w-10 h-10" />
                    <span className="text-xs">Camera Turned Off</span>
                  </div>
                )}

                {/* Live speech auto-scrolling marquee subtitle indicator */}
                {candidateLiveTranscript && (
                  <div className="absolute top-4 left-4 right-4 z-20 pointer-events-none">
                    <div className="px-3.5 py-2 rounded-2xl bg-black/80 backdrop-blur-md border border-white/20 text-white text-xs leading-relaxed max-w-lg mx-auto shadow-xl flex items-center gap-3 overflow-hidden">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
                      <div
                        ref={candidateSubtitleScrollRef}
                        className="flex-1 overflow-x-auto whitespace-nowrap scroll-smooth flex items-center justify-end [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                      >
                        <span className="inline-block pl-2 font-medium">
                          &ldquo;{candidateLiveTranscript.split(/\s+/).slice(-18).join(' ')}&rdquo;
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Candidate Tile Label & Controls (Clean voice status, no manual buttons required) */}
                <div className="absolute bottom-4 inset-x-4 flex items-center justify-between z-10">
                  <div className="px-3.5 py-1.5 rounded-full bg-black/70 backdrop-blur-md border border-white/20 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${isCandidateSpeaking ? 'bg-sky-400 animate-ping' : 'bg-emerald-400'}`} />
                    <span className="text-xs font-semibold text-white">
                      {candidateName.trim() ? `${candidateName.trim()} (You)` : 'You'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[11px] font-mono text-neutral-300">
                      {isMicActive ? 'Mic Active' : 'Mic Muted'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Spotlight Dynamic Layout (Tasks: Resume Upload, Written, Pressure, Snapshots) - VOICE ORIENTED, NO MANUAL BUTTONS */}
            {isSpotlightActive && (
              <div className="lg:col-span-8 rounded-3xl bg-white border border-neutral-200 p-6 shadow-md flex flex-col justify-between overflow-y-auto animate-in fade-in zoom-in-95 duration-300">
                {/* TASK 1: Resume / CV Document Upload */}
                {meetingPhase === 'task_resume' && (
                  <div className="space-y-4 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-100 text-sky-700 text-xs font-semibold mb-2">
                        <FileUp className="w-3.5 h-3.5" />
                        <span>Credentials Document Upload</span>
                      </div>
                      <h3 className="text-xl sm:text-2xl font-bold font-heading text-neutral-900">
                        Upload your updated resume or CV
                      </h3>
                      <p className="text-xs sm:text-sm text-neutral-600 mt-1">
                        Select or drag your document here. Once loaded, the system automatically indexes it and proceeds by voice.
                      </p>
                    </div>

                    <div className="flex-1 flex flex-col justify-center">
                      {!uploadedResume ? (
                        <label className="border-2 border-dashed border-neutral-300 hover:border-sky-500 rounded-3xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all bg-neutral-50/60 hover:bg-sky-50/40 group">
                          <input
                            type="file"
                            accept=".pdf,.docx,.doc,.txt,.png,.jpg"
                            onChange={handleResumeFileUpload}
                            className="hidden"
                          />
                          <div className="w-16 h-16 rounded-2xl bg-sky-100 text-sky-600 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                            <Upload className="w-8 h-8" />
                          </div>
                          <h4 className="text-base font-bold text-neutral-900">
                            {isUploadingResume ? 'Processing document...' : 'Click to select or drag and drop your resume'}
                          </h4>
                          <p className="text-xs text-neutral-500 mt-1.5 max-w-sm">
                            Supported formats: PDF, DOCX, TXT, PNG, or JPG (max 10MB)
                          </p>
                        </label>
                      ) : (
                        <div className="p-6 rounded-2xl bg-sky-50 border border-sky-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="flex items-center gap-3.5">
                            <div className="w-12 h-12 rounded-xl bg-sky-500 text-white flex items-center justify-center">
                              <FileCheck className="w-6 h-6" />
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-neutral-900">{uploadedResume.fileName}</h4>
                              <div className="flex items-center gap-2 text-xs text-neutral-600 mt-0.5">
                                <span>{uploadedResume.fileSize}</span>
                                <span>•</span>
                                <span className="text-emerald-700 font-semibold flex items-center gap-1">
                                  <Check className="w-3.5 h-3.5" /> Indexed &amp; Ready
                                </span>
                              </div>
                            </div>
                          </div>

                          <label className="text-xs text-sky-600 hover:text-sky-800 font-semibold cursor-pointer underline self-start sm:self-center">
                            <input
                              type="file"
                              accept=".pdf,.docx,.doc,.txt,.png,.jpg"
                              onChange={handleResumeFileUpload}
                              className="hidden"
                            />
                            Replace file
                          </label>
                        </div>
                      )}
                    </div>

                    {/* Voice Direction Indicator (No manual buttons) */}
                    <div className="p-4 rounded-2xl bg-sky-50/70 border border-sky-200 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                        <span className="text-xs font-semibold text-neutral-800">
                          Let the interviewer know when you're done
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-neutral-500 hidden sm:inline">
                        Auto-advancing on upload
                      </span>
                    </div>
                  </div>
                )}

                {/* TASK 2: Written Self-Reflection (>= 100 chars) */}
                {meetingPhase === 'task_written' && (
                  <div className="space-y-4 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-100 text-sky-700 text-xs font-semibold mb-2">
                        <FileText className="w-3.5 h-3.5" />
                        <span>Written Reflection Spotlight</span>
                      </div>
                      <h3 className="text-xl sm:text-2xl font-bold font-heading text-neutral-900">
                        Write down 3 things you like about yourself and why.
                      </h3>
                      <p className="text-xs sm:text-sm text-neutral-600 mt-1">
                        Reflect on your personal strengths, values, or technical curiosity. Minimum 100 characters required. When finished, say &quot;I am done&quot; or &quot;submit&quot;.
                      </p>
                    </div>

                    <div className="space-y-2 flex-1 flex flex-col">
                      <textarea
                        rows={6}
                        value={writtenText}
                        onChange={(e) => {
                          setWrittenText(e.target.value);
                          if (e.target.value.length % 25 === 1) {
                            triggerTaskPanelInteraction(1800, false);
                          }
                        }}
                        placeholder="1. I love diving deep into architectural puzzles because...&#10;2. I value empathetic communication with team members...&#10;3. I am resilient and relentless when debugging critical edge cases..."
                        className="w-full flex-1 p-4 rounded-2xl bg-neutral-50 border border-neutral-300 text-neutral-900 text-sm focus:outline-none focus:border-sky-500 resize-none leading-relaxed placeholder:text-neutral-400"
                      />
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span
                          className={
                            writtenText.trim().length >= 100
                              ? 'text-emerald-600 font-bold'
                              : 'text-amber-600 font-medium'
                          }
                        >
                          {writtenText.trim().length} / 100 characters minimum
                        </span>
                        {writtenText.trim().length >= 100 && (
                          <span className="text-emerald-600 font-semibold flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" /> Ready for submission
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Voice Direction Indicator (No manual buttons) */}
                    <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            writtenText.trim().length >= 100 ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'
                          }`}
                        />
                        <span className="text-xs font-semibold text-neutral-800">
                          {writtenText.trim().length >= 100
                            ? 'Let the interviewer know when you are done'
                            : 'Reach 100 characters, then we can proceed'}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-neutral-500 hidden sm:inline">
                        
                      </span>
                    </div>
                  </div>
                )}

                {/* TASK 3: Situational Pressure Rating */}
                {meetingPhase === 'task_pressure' && (
                  <div className="space-y-6 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-100 text-sky-700 text-xs font-semibold mb-2">
                        <Award className="w-3.5 h-3.5" />
                        <span>Situational Behavior Check</span>
                      </div>
                      <h3 className="text-xl sm:text-2xl font-bold font-heading text-neutral-900">
                        How well do you perform under pressure?
                      </h3>
                      <p className="text-xs sm:text-sm text-neutral-600 mt-1">
                        Select your option or state your choice aloud (&quot;hell yeah&quot;, &quot;comfortable&quot;, &quot;moderate&quot;, &quot;not at all&quot;).
                      </p>
                    </div>

                    <div className="space-y-3">
                      {[
                        'Not at all - I avoid such situations',
                        'Moderate - I can work as long as the team does, too',
                        'Comfortable - I find challenging situations very exciting for me',
                        'HELL YEAH - I do not fear pressure; pressure fears me',
                      ].map((opt) => (
                        <label
                          key={opt}
                          className={`flex items-center gap-3.5 p-4 rounded-2xl border transition-all cursor-pointer ${
                            pressureRating === opt
                              ? 'bg-sky-50 border-sky-500 text-neutral-900 shadow-xs'
                              : 'bg-neutral-50 border-neutral-200 hover:border-neutral-300 text-neutral-700'
                          }`}
                        >
                          <input
                            type="radio"
                            name="pressure"
                            checked={pressureRating === opt}
                            onChange={() => {
                              setPressureRating(opt);
                              triggerTaskPanelInteraction(2200, false);
                              setTimeout(() => {
                                handleSubmitPressureRating(opt);
                              }, 600);
                            }}
                            className="accent-sky-500 w-4 h-4"
                          />
                          <span className="text-sm font-medium">{opt}</span>
                        </label>
                      ))}
                    </div>

                    {/* Voice Direction Indicator (No manual buttons) */}
                    <div className="p-4 rounded-2xl bg-sky-50/70 border border-sky-200 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                        <span className="text-xs font-semibold text-neutral-800">
                          Let the interviewer know your choice or select on your own
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-neutral-500 hidden sm:inline">
                        Auto-confirms on selection
                      </span>
                    </div>
                  </div>
                )}

                {/* TASK 4: Camera Feed Snapshots via Voice Triggers (NO MANUAL BUTTONS) */}
                {meetingPhase === 'task_snapshot' && (
                  <div className="space-y-4 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-100 text-sky-700 text-xs font-semibold mb-2">
                        <Camera className="w-3.5 h-3.5" />
                        <span>Voice-Activated Visual Identity Verification</span>
                      </div>
                      <h3 className="text-xl sm:text-2xl font-bold font-heading text-neutral-900">
                        Hold your written phone number up &amp; pose
                      </h3>
                      <p className="text-xs sm:text-sm text-neutral-600 mt-1">
                        Or ask the interviewer for any clarifications.
                      </p>
                    </div>

                    {/* Pose Progress Tracker */}
                    <div className="grid grid-cols-3 gap-3">
                      <div
                        className={`p-3.5 rounded-2xl border text-center transition-all ${
                          snapshotStep === 1
                            ? 'bg-sky-50 border-sky-500 text-sky-800 ring-2 ring-sky-300'
                            : snapshots.length >= 1
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                            : 'bg-neutral-50 border-neutral-200 text-neutral-400'
                        }`}
                      >
                        <span className="text-[11px] font-bold uppercase tracking-wider block">Step 1</span>
                        <span className="text-xs font-semibold mt-1 block">Look Forward</span>
                        {snapshots.length >= 1 && <span className="text-[10px] text-emerald-600 mt-1 block font-mono">Captured</span>}
                      </div>

                      <div
                        className={`p-3.5 rounded-2xl border text-center transition-all ${
                          snapshotStep === 2
                            ? 'bg-sky-50 border-sky-500 text-sky-800 ring-2 ring-sky-300'
                            : snapshots.length >= 2
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                            : 'bg-neutral-50 border-neutral-200 text-neutral-400'
                        }`}
                      >
                        <span className="text-[11px] font-bold uppercase tracking-wider block">Step 2</span>
                        <span className="text-xs font-semibold mt-1 block">Look Left</span>
                        {snapshots.length >= 2 && <span className="text-[10px] text-emerald-600 mt-1 block font-mono">Captured</span>}
                      </div>

                      <div
                        className={`p-3.5 rounded-2xl border text-center transition-all ${
                          snapshotStep === 3
                            ? 'bg-sky-50 border-sky-500 text-sky-800 ring-2 ring-sky-300'
                            : snapshots.length >= 3
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                            : 'bg-neutral-50 border-neutral-200 text-neutral-400'
                        }`}
                      >
                        <span className="text-[11px] font-bold uppercase tracking-wider block">Step 3</span>
                        <span className="text-xs font-semibold mt-1 block">Look Right</span>
                        {snapshots.length >= 3 && <span className="text-[10px] text-emerald-600 mt-1 block font-mono">Captured</span>}
                      </div>
                    </div>

                    {/* Live Listener Monitor (NO MANUAL BUTTONS) */}
                    <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="w-3 h-3 rounded-full bg-emerald-500 animate-ping" />
                        <div>
                          <span className="text-xs font-semibold text-neutral-900 block">
                            Tell the interviewer when to take your photo
                          </span>
                          <span className="text-[11px] text-neutral-500 font-mono block">
                            {lastDetectedTrigger ? `Detected: "${lastDetectedTrigger}" • Captured pose` : 'Let the interviewer know when to click the photo'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="px-3.5 py-1.5 rounded-full bg-sky-100 text-sky-800 text-xs font-mono font-semibold">
                          Pose {snapshotStep || 1} of 3
                        </span>
                      </div>
                    </div>

                    {/* Display Captured Gallery */}
                    {snapshots.length > 0 && (
                      <div className="flex gap-3 overflow-x-auto pb-1">
                        {snapshots.map((snap) => (
                          <div key={snap.id} className="relative w-24 h-18 rounded-xl overflow-hidden border border-neutral-200 shrink-0 shadow-xs">
                            <img src={snap.dataUrl} alt={snap.label} className="w-full h-full object-cover transform -scale-x-100" />
                            <span className="absolute bottom-1 inset-x-1 text-[9px] bg-black/70 text-white text-center rounded px-1 truncate">
                              {snap.angle}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        {/* Meeting Bottom Toolbar (CLEAN, NO MANUAL ADVANCE BUTTONS) */}
        <footer className="h-16 border-t border-neutral-200 px-4 sm:px-6 flex items-center justify-between bg-white shrink-0 z-30 shadow-xs">
          {/* Phase Indicators */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider font-mono">Phase:</span>
            <span className="text-xs font-bold text-sky-600 bg-sky-50 px-2.5 py-1 rounded-full border border-sky-200">
              {meetingPhase.replace('_', ' ').toUpperCase()}
            </span>
          </div>

          {/* Voice status info indicator */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs font-mono text-neutral-600">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Connected</span>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-neutral-500 font-mono pl-3 border-l border-neutral-200">
              <Mic className={`w-3.5 h-3.5 ${isCandidateSpeaking ? 'text-emerald-500 animate-bounce' : 'text-neutral-400'}`} />
              <span>{isCandidateSpeaking ? 'Candidate Speaking' : hanaIsSpeaking ? 'Hana Speaking' : 'Listening...'}</span>
            </div>
          </div>
        </footer>
      </div>
    );
  }

  // ----------------------------------------------------
  // STAGE 2.5: CANDIDATE POV INTERVIEW CONCLUDED SCREEN
  // ----------------------------------------------------
  if (stage === 'candidate_complete') {
    return (
      <div className="min-h-screen bg-[#f8fafc] text-neutral-900 flex flex-col font-sans select-none">
        {/* Header Bar */}
        <header className="h-16 border-b border-neutral-200 px-4 sm:px-6 flex items-center justify-between bg-white/95 backdrop-blur-md sticky top-0 z-30 shadow-xs">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onNavigateHome}
              className="p-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-600 hover:text-neutral-900 transition-colors cursor-pointer"
              title="Return to Home"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h1 className="font-bold text-sm sm:text-base font-heading text-neutral-900 flex items-center gap-2">
                <span>Interview Completed</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-mono font-semibold">
                  Candidate POV
                </span>
              </h1>
              <span className="text-[11px] text-neutral-500">
                MuxAI Autonomous Hiring Assessment • {targetRole}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                if (onNavigateToInterview) {
                  onNavigateToInterview();
                } else {
                  window.history.pushState({}, '', '/interview');
                  setActiveInterviewId(null);
                }
              }}
              className="px-3.5 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-200 text-xs font-semibold text-sky-800 transition-colors cursor-pointer"
            >
              Interviews Dashboard
            </button>
            <button
              type="button"
              onClick={() => {
                sessionStorage.removeItem(STORAGE_KEY);
                setStage('lobby');
                setMeetingPhase('joining');
                setHanaEntered(false);
                setIsHana3DReady(false);
                recordedChunksRef.current = [];
                setRecordedVideoUrl(null);
              }}
              className="px-3.5 py-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 border border-neutral-200 text-xs font-semibold text-neutral-700 transition-colors cursor-pointer"
            >
              Start New Session
            </button>
          </div>
        </header>

        {/* Candidate Completion Body */}
        <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-8 flex flex-col items-center justify-center space-y-6">
          {/* Hero Celebration Card */}
          <div className="w-full bg-white rounded-3xl border border-neutral-200 p-6 sm:p-10 shadow-md text-center flex flex-col items-center">
            <div className="w-20 h-20 rounded-3xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mb-5 shadow-sm">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold mb-3">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              <span>Assessment Completed &amp; Submitted</span>
            </span>

            <h2 className="text-2xl sm:text-3xl font-bold font-heading text-neutral-900 mb-2">
              Thank You, {effectiveDossierName}!
            </h2>
            <p className="text-sm sm:text-base text-neutral-600 max-w-xl mx-auto leading-relaxed">
              Your interview with Hana for the <span className="font-semibold text-neutral-900">{targetRole}</span> position is complete. All responses, documents, and evaluation data have been safely compiled and forwarded to the recruiting team.
            </p>

            {/* Checklist of Completed Steps */}
            <div className="w-full mt-8 pt-8 border-t border-neutral-100 grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
              <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-neutral-50 border border-neutral-200/80">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <div className="text-xs">
                  <div className="font-semibold text-neutral-900">Background &amp; Technical Q&amp;A</div>
                  <div className="text-neutral-500 text-[11px]">2 core open responses recorded</div>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-neutral-50 border border-neutral-200/80">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <div className="text-xs">
                  <div className="font-semibold text-neutral-900">Credentials Document</div>
                  <div className="text-neutral-500 text-[11px] truncate max-w-[200px]">
                    {uploadedResume ? uploadedResume.fileName : 'Resume document on file'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-neutral-50 border border-neutral-200/80">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <div className="text-xs">
                  <div className="font-semibold text-neutral-900">Written Reflection</div>
                  <div className="text-neutral-500 text-[11px]">
                    {writtenText.trim().length > 0 ? `${writtenText.trim().length} characters submitted` : 'Completed'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-neutral-50 border border-neutral-200/80">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <div className="text-xs">
                  <div className="font-semibold text-neutral-900">Situational Performance Check</div>
                  <div className="text-neutral-500 text-[11px]">
                    {pressureRating ? `Rated: ${pressureRating}` : 'Response logged'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-neutral-50 border border-neutral-200/80">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <div className="text-xs">
                  <div className="font-semibold text-neutral-900">Multi-Angle Identity Check</div>
                  <div className="text-neutral-500 text-[11px]">
                    {snapshots.length} photo angles captured
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-neutral-50 border border-neutral-200/80">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <div className="text-xs">
                  <div className="font-semibold text-neutral-900">Open Q&amp;A Session</div>
                  <div className="text-neutral-500 text-[11px]">
                    {qaHistory.length} dialogue turns archived
                  </div>
                </div>
              </div>
            </div>

            {/* Optional Video Playback */}
            {recordedVideoUrl && (
              <div className="w-full mt-6 text-left">
                <h4 className="text-xs font-semibold text-neutral-700 mb-2 flex items-center gap-1.5">
                  <Video className="w-3.5 h-3.5 text-sky-600" />
                  <span>Session Video Recording</span>
                </h4>
                <video
                  src={recordedVideoUrl}
                  controls
                  className="w-full max-h-56 rounded-2xl bg-black object-cover border border-neutral-200"
                />
              </div>
            )}
          </div>

          {/* Bottom Action Area: "See Recruiter's Side" */}
          <div className="w-full bg-gradient-to-br from-sky-50 via-white to-sky-50/50 rounded-3xl border border-sky-200/80 p-6 sm:p-8 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-800 text-[11px] font-semibold mb-1 font-mono">
                DEMO CONFIGURATION
              </div>
              <h3 className="text-base sm:text-lg font-bold text-neutral-900 font-heading">
                Ready to review the evaluation?
              </h3>
              <p className="text-xs sm:text-sm text-neutral-600 max-w-md">
                Switch perspective to see how the hiring team evaluates candidate dossiers, AI scores, and verification assets.
              </p>
            </div>

            <button
              type="button"
              onClick={handleGoToRecruiterReview}
              className="px-8 py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-bold text-sm sm:text-base shadow-md shadow-sky-500/25 transition-all transform hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center gap-2 cursor-pointer shrink-0"
            >
              <span>See Recruiter&apos;s Side</span>
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </main>
      </div>
    );
  }

  // ----------------------------------------------------
  // STAGE 3: RECRUITER POV EVALUATION DOSSIER (LIGHT THEME)
  // ----------------------------------------------------
  return (
    <div className="min-h-screen bg-[#f8fafc] text-neutral-900 flex flex-col font-sans select-none">
      {/* Dossier Header Bar */}
      <header className="h-16 border-b border-neutral-200 px-6 flex items-center justify-between bg-white/95 backdrop-blur-md sticky top-0 z-30 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (onNavigateToInterview) {
                onNavigateToInterview();
              } else {
                window.history.pushState({}, '', '/interview');
                setActiveInterviewId(null);
              }
            }}
            className="p-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-600 hover:text-neutral-900 transition-colors cursor-pointer"
            title="Return to Interviews Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="font-bold text-sm sm:text-base font-heading text-neutral-900">
              Recruiter Evaluation Dossier
            </h1>
            <span className="text-[11px] text-neutral-500">
              Autonomous AI Hiring Assessment • Hana Interview
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              if (onNavigateToInterview) {
                onNavigateToInterview();
              } else {
                window.history.pushState({}, '', '/interview');
                setActiveInterviewId(null);
              }
            }}
            className="px-3.5 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-200 text-xs font-semibold text-sky-800 transition-colors cursor-pointer"
          >
            Interviews Dashboard
          </button>
          <button
            type="button"
            onClick={() => {
              setStage('candidate_complete');
              setActivePov('candidate');
            }}
            className="px-3.5 py-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 border border-neutral-200 text-xs font-semibold text-neutral-700 transition-colors cursor-pointer flex items-center gap-1.5"
            title="Inspect Candidate POV End Screen"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Candidate POV Screen</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setStage('meeting');
              setActivePov('candidate');
            }}
            className="px-3.5 py-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 border border-neutral-200 text-xs font-semibold text-neutral-700 transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Return to Candidate Meeting</span>
          </button>

          <button
            type="button"
            onClick={() => {
              sessionStorage.removeItem(STORAGE_KEY);
              setStage('lobby');
              setMeetingPhase('joining');
              setHanaEntered(false);
              setIsHana3DReady(false);
              recordedChunksRef.current = [];
              setRecordedVideoUrl(null);
            }}
            className="px-3.5 py-1.5 rounded-xl bg-sky-500 text-white hover:bg-sky-400 text-xs font-bold transition-colors cursor-pointer shadow-xs"
          >
            New Interview Session
          </button>
        </div>
      </header>

      {/* Main Dossier Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Candidate Profile Header Card */}
        <div className="p-6 rounded-3xl bg-white border border-neutral-200 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 text-white flex items-center justify-center font-bold text-2xl font-heading shadow-md shadow-sky-500/20">
              {effectiveDossierName.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl sm:text-2xl font-bold font-heading text-neutral-900">
                  {effectiveDossierName}
                </h2>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-semibold capitalize ${
                    candidateStatus === 'shortlisted'
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : candidateStatus === 'rejected'
                      ? 'bg-red-100 text-red-800 border border-red-300'
                      : 'bg-amber-100 text-amber-800 border border-amber-300'
                  }`}
                >
                  {candidateStatus.replace('_', ' ')}
                </span>
              </div>
              <p className="text-sm text-neutral-600 mt-0.5">{targetRole}</p>
              <div className="flex items-center gap-3 text-xs text-neutral-500 mt-2">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Session Length: {formatSeconds(recordedDuration)}</span>
                </span>
                <span>•</span>
                <span>Interviewer: Hana</span>
              </div>
            </div>
          </div>

          {/* Action Buttons: Shortlist / Reject */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRejectCandidate}
              className={`px-4 py-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                candidateStatus === 'rejected'
                  ? 'bg-red-500 text-white border-red-600 shadow-sm'
                  : 'bg-white hover:bg-red-50 text-red-600 border-red-200'
              }`}
            >
              Reject Candidate
            </button>
            <button
              type="button"
              onClick={handleShortlistCandidate}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer ${
                candidateStatus === 'shortlisted'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-emerald-500/20'
              }`}
            >
              Shortlist for Next Round
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-neutral-200 pb-3">
          <button
            type="button"
            onClick={() => setRecruiterActiveTab('recording')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              recruiterActiveTab === 'recording'
                ? 'bg-sky-500 text-white shadow-sm'
                : 'bg-white text-neutral-600 hover:bg-neutral-100 border border-neutral-200'
            }`}
          >
            <Play className="w-3.5 h-3.5" />
            <span>Session Recording &amp; Identity Frames</span>
          </button>
          <button
            type="button"
            onClick={() => setRecruiterActiveTab('responses')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              recruiterActiveTab === 'responses'
                ? 'bg-sky-500 text-white shadow-sm'
                : 'bg-white text-neutral-600 hover:bg-neutral-100 border border-neutral-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Candidate Responses &amp; Tasks</span>
          </button>
          <button
            type="button"
            onClick={() => setRecruiterActiveTab('resume')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              recruiterActiveTab === 'resume'
                ? 'bg-sky-500 text-white shadow-sm'
                : 'bg-white text-neutral-600 hover:bg-neutral-100 border border-neutral-200'
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            <span>Candidate Resume / CV</span>
            {uploadedResume && (
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            )}
          </button>
        </div>

        {/* TAB 1: Session Video Recording Player & Captured Snapshots */}
        {recruiterActiveTab === 'recording' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left 8 cols: Video Player */}
              <div className="lg:col-span-8 rounded-3xl bg-neutral-900 border border-neutral-200 p-4 shadow-xl space-y-3">
                <div className="relative aspect-video rounded-2xl overflow-hidden bg-black flex items-center justify-center">
                  {recordedVideoUrl && !videoPlaybackError ? (
                    <video
                      ref={reviewVideoPlayerRef}
                      src={recordedVideoUrl}
                      controls
                      playsInline
                      onError={() => setVideoPlaybackError(true)}
                      className="w-full h-full object-contain"
                    />
                  ) : isRecordingFinalizing ? (
                    <div className="flex flex-col items-center gap-3 text-neutral-300 p-6 text-center">
                      <RefreshCw className="w-8 h-8 animate-spin text-sky-400" />
                      <p className="text-sm font-semibold text-white">Finalizing interview recording...</p>
                      <span className="text-xs text-neutral-400">Processing video and audio stream</span>
                    </div>
                  ) : snapshots.length > 0 ? (
                    <div className="w-full h-full p-4 flex flex-col justify-between bg-neutral-900 text-white">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-sky-400 flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4" /> Visual Identity Frames Recorded ({snapshots.length} angles)
                        </span>
                        <span className="text-xs font-mono text-neutral-400">Duration: {formatSeconds(recordedDuration)}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-3 my-auto">
                        {snapshots.map((s) => (
                          <div key={s.id} className="relative rounded-xl overflow-hidden border border-neutral-700 aspect-video">
                            <img src={s.dataUrl} alt={s.label} className="w-full h-full object-cover transform -scale-x-100" />
                            <span className="absolute bottom-1 inset-x-1 text-[10px] bg-black/75 text-center text-white rounded px-1 truncate">
                              {s.angle.toUpperCase()}
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[11px] text-neutral-400 text-center">
                        Identity verification frames confirmed. Video session log archived for recruiter evaluation.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3 text-neutral-400 p-6 text-center">
                      <Video className="w-10 h-10 stroke-[1.5]" />
                      <p className="text-xs text-neutral-400">
                        Interview recording is processed automatically when session concludes.
                      </p>
                    </div>
                  )}
                </div>

                {recordedVideoUrl && (
                  <div className="flex items-center justify-between pt-1 px-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-neutral-400">Speed:</span>
                      {[1, 1.25, 1.5, 2].map((spd) => (
                        <button
                          key={spd}
                          type="button"
                          onClick={() => {
                            setRecordingPlaybackSpeed(spd);
                            if (reviewVideoPlayerRef.current) reviewVideoPlayerRef.current.playbackRate = spd;
                          }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
                            recordingPlaybackSpeed === spd
                              ? 'bg-sky-500 text-white'
                              : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                          }`}
                        >
                          {spd}x
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-2">
                      <a
                        href={recordedVideoUrl}
                        download={`interview-${effectiveDossierName.toLowerCase().replace(/\s+/g, '-')}-session.webm`}
                        className="px-3.5 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-semibold transition-colors flex items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download Recording</span>
                      </a>
                      <button
                        type="button"
                        onClick={handleDiscardRecording}
                        className="px-3.5 py-1.5 rounded-xl bg-red-950/60 hover:bg-red-900/80 text-red-300 text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Discard</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Right 4 cols: Visual Identity Snapshots Gallery */}
              <div className="lg:col-span-4 rounded-3xl bg-white border border-neutral-200 p-5 shadow-md space-y-4">
                <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
                  <div>
                    <h3 className="font-bold text-sm text-neutral-900 font-heading">
                      Identity Verification Frames
                    </h3>
                    <p className="text-[11px] text-neutral-500">
                      Multi-angle camera snapshots
                    </p>
                  </div>
                  <span className="text-xs font-mono font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-md border border-sky-200">
                    {snapshots.length} / 3
                  </span>
                </div>

                {snapshots.length === 0 ? (
                  <div className="p-6 text-center text-neutral-400 text-xs">
                    No camera snapshots recorded during this test run.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {snapshots.map((snap) => (
                      <div
                        key={snap.id}
                        onClick={() => setSelectedSnapshotModal(snap.dataUrl)}
                        className="p-2.5 rounded-2xl bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 flex items-center gap-3 transition-colors cursor-pointer group"
                      >
                        <div className="w-20 h-14 rounded-xl overflow-hidden bg-black shrink-0 relative">
                          <img
                            src={snap.dataUrl}
                            alt={snap.label}
                            className="w-full h-full object-cover transform -scale-x-100"
                          />
                          <div className="absolute inset-0 bg-black/30 group-hover:bg-transparent transition-colors flex items-center justify-center">
                            <Eye className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="text-xs font-bold text-neutral-900 block truncate">
                            {snap.label}
                          </span>
                          <span className="text-[11px] text-neutral-500 block">
                            Angle: {snap.angle.toUpperCase()} • {snap.timestamp}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Responses & Tasks Details */}
        {recruiterActiveTab === 'responses' && (
          <div className="space-y-4">
            {recordedResponses.length === 0 ? (
              <div className="p-12 text-center rounded-3xl bg-white border border-neutral-200 text-neutral-500 text-sm shadow-xs">
                Candidate has not yet submitted responses. Run an interview session to generate records.
              </div>
            ) : (
              recordedResponses.map((res, index) => (
                <div
                  key={index}
                  className="p-6 rounded-3xl bg-white border border-neutral-200 shadow-sm space-y-3"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-sky-600 font-bold uppercase tracking-wider bg-sky-50 px-2.5 py-0.5 rounded-full border border-sky-200">
                      {res.phase.replace('_', ' ')}
                    </span>
                    <span className="text-neutral-500 font-mono">{res.timestamp}</span>
                  </div>

                  <h3 className="font-bold text-base text-neutral-900">{res.question}</h3>

                  <div className="p-4 rounded-2xl bg-neutral-100 border border-neutral-200 text-sm leading-relaxed text-neutral-950 font-medium whitespace-pre-wrap">
                    {cleanDeduplicatedTranscript(res.answer)}
                  </div>

                  {res.aiNotes && (
                    <div className="flex items-start gap-2 pt-1 text-xs text-neutral-700">
                      <Sparkles className="w-3.5 h-3.5 text-sky-600 shrink-0 mt-0.5" />
                      <span>
                        <strong className="text-neutral-900">AI Recruiter Observation:</strong> {res.aiNotes}
                      </span>
                    </div>
                  )}
                </div>
              ))
            )}

            {/* Q&A Transcripts */}
            {qaHistory.length > 0 && (
              <div className="p-6 rounded-3xl bg-white border border-neutral-200 shadow-sm space-y-4">
                <h3 className="font-bold text-base text-neutral-900 font-heading">
                  Candidate Q&amp;A Session History
                </h3>
                <div className="space-y-3">
                  {qaHistory.map((qa, i) => (
                    <div
                      key={i}
                      className={`p-3.5 rounded-2xl text-xs sm:text-sm ${
                        qa.sender === 'candidate'
                          ? 'bg-sky-50 border border-sky-200 text-neutral-950 font-medium ml-6'
                          : 'bg-neutral-100 border border-neutral-200 text-neutral-950 mr-6'
                      }`}
                    >
                      <span className="text-[10px] font-bold block mb-1 uppercase tracking-wider text-neutral-600">
                        {qa.sender === 'candidate' ? `${effectiveDossierName} (Candidate)` : 'Hana (AI Recruiter)'}
                      </span>
                      <p className="leading-relaxed text-neutral-950">{cleanDeduplicatedTranscript(qa.text)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: Candidate Resume / CV Document View */}
        {recruiterActiveTab === 'resume' && (
          <div className="space-y-6">
            {uploadedResume ? (
              <div className="p-6 sm:p-8 rounded-3xl bg-white border border-neutral-200 shadow-md space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-neutral-200 gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-sky-100 text-sky-600 flex items-center justify-center">
                      <FileCheck className="w-7 h-7" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold font-heading text-neutral-900">
                        {uploadedResume.fileName}
                      </h3>
                      <div className="flex items-center gap-3 text-xs text-neutral-500 mt-1">
                        <span>Size: {uploadedResume.fileSize}</span>
                        <span>•</span>
                        <span>Type: {uploadedResume.fileType}</span>
                        <span>•</span>
                        <span>Uploaded at: {uploadedResume.uploadedAt}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold border border-emerald-300">
                      Uploaded during Live Interview
                    </span>
                    <a
                      href={uploadedResume.dataUrl}
                      download={uploadedResume.fileName}
                      className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download File</span>
                    </a>
                  </div>
                </div>

                {/* Document Display / Preview */}
                <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4 min-h-[400px] flex items-center justify-center overflow-hidden">
                  {uploadedResume.fileType.includes('pdf') || uploadedResume.fileName.endsWith('.pdf') ? (
                    <iframe
                      src={uploadedResume.dataUrl}
                      className="w-full h-[650px] rounded-xl border border-neutral-200 bg-white"
                      title="Uploaded Candidate Resume PDF"
                    />
                  ) : uploadedResume.fileType.includes('image') ||
                    uploadedResume.fileName.endsWith('.png') ||
                    uploadedResume.fileName.endsWith('.jpg') ? (
                    <img
                      src={uploadedResume.dataUrl}
                      alt="Uploaded Candidate Resume"
                      className="max-h-[650px] mx-auto object-contain rounded-xl shadow-md border border-neutral-200"
                    />
                  ) : (
                    <div className="w-full bg-white p-6 rounded-2xl border border-neutral-200 shadow-xs space-y-4">
                      <div className="flex items-center gap-2 text-xs font-semibold text-neutral-600">
                        <FileText className="w-4 h-4 text-sky-600" />
                        <span>Document Content Preview:</span>
                      </div>
                      <pre className="text-xs font-mono text-neutral-800 whitespace-pre-wrap leading-relaxed max-h-[500px] overflow-auto p-4 bg-neutral-50 rounded-xl border border-neutral-200">
                        {uploadedResume.textContent || 'Binary document content verified. Click "Download File" to view full original.'}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Fallback if no resume uploaded during test run */
              <div className="max-w-4xl mx-auto p-8 rounded-3xl bg-white text-neutral-900 shadow-md border border-neutral-200 space-y-6 font-sans">
                <div className="border-b border-neutral-200 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-bold font-heading text-neutral-900">{effectiveDossierName}</h2>
                    <p className="text-sm font-semibold text-sky-600 mt-0.5">{targetRole}</p>
                    <p className="text-xs text-neutral-500 mt-1">
                      {candidateName ? `${candidateName.toLowerCase().replace(/\s+/g, '.')}@example.com` : 'candidate@example.com'} • Verified Candidate Dossier
                    </p>
                  </div>
                  <label className="px-3.5 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 self-start shadow-xs">
                    <input
                      type="file"
                      accept=".pdf,.docx,.doc,.txt,.png,.jpg"
                      onChange={handleResumeFileUpload}
                      className="hidden"
                    />
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload Resume Now</span>
                  </label>
                </div>

                <div className="space-y-4">
                  <div>
                    <h4 className="text-xs font-bold font-heading uppercase tracking-wider text-neutral-500 mb-1.5">
                      Professional Summary
                    </h4>
                    <p className="text-xs leading-relaxed text-neutral-700">
                      Full Stack Engineer with 6+ years specializing in distributed systems, real-time WebSockets, WebGL / Three.js 3D pipelines, and multi-agent AI architectures. Passionate about autonomous workflows and intuitive interactive experiences.
                    </p>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold font-heading uppercase tracking-wider text-neutral-500 mb-2">
                      Core Technical Skills
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        'TypeScript',
                        'React 19',
                        'Node.js & Express',
                        'Three.js / WebGL',
                        'Web Speech API',
                        'MediaRecorder API',
                        'PostgreSQL / NeonDB',
                        'Gemini API & LLMs',
                        'WebSockets / WebRTC',
                        'Tailwind CSS',
                      ].map((s) => (
                        <span key={s} className="px-2.5 py-1 rounded-md bg-neutral-100 text-neutral-800 text-xs font-medium">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold font-heading uppercase tracking-wider text-neutral-500 mb-3">
                      Experience History
                    </h4>
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-neutral-900">Staff Engineer • Autonomous Interactive Systems</span>
                          <span className="text-neutral-500">2022 - Present</span>
                        </div>
                        <p className="text-xs text-neutral-600 mt-1">
                          Architected high-throughput AI companion runtime with sub-200ms latency, handling multimodal vision, voice synthesis, and low-latency browser streaming.
                        </p>
                      </div>
                      <div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-neutral-900">Senior Software Engineer • Realtime Cloud Labs</span>
                          <span className="text-neutral-500">2019 - 2022</span>
                        </div>
                        <p className="text-xs text-neutral-600 mt-1">
                          Built video conferencing infrastructure, client media recording pipelines, and reactive canvas interaction systems.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold font-heading uppercase tracking-wider text-neutral-500 mb-1.5">
                      Education &amp; Credentials
                    </h4>
                    <p className="text-xs text-neutral-700">
                      B.S. in Computer Science • University of California, Berkeley
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Snapshot Zoom Lightbox Modal */}
      {selectedSnapshotModal && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setSelectedSnapshotModal(null)}
        >
          <div className="max-w-3xl w-full rounded-2xl overflow-hidden shadow-2xl border border-white/20 bg-black">
            <img
              src={selectedSnapshotModal}
              alt="Snapshot Zoom"
              className="w-full h-auto object-contain transform -scale-x-100"
            />
          </div>
        </div>
      )}
    </div>
  );
};
