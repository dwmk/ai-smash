import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Crown,
  Plus,
  Play,
  Copy,
  Check,
  Trash2,
  FileText,
  Award,
  Calendar,
  Sparkles,
  ExternalLink,
  Shield,
  Upload,
  Camera,
  Layers,
  HelpCircle,
  X,
  AlertCircle,
  Eye,
  CheckCircle2,
  RefreshCw,
  Search,
  MessageSquare,
  Clock,
  ChevronRight,
  Bot,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { AccountUser } from '../types';

export interface InterviewDashboardRecord {
  id: string;
  title: string;
  target_role: string;
  company_name: string;
  description: string;
  created_by_user_id?: number | null;
  created_by_email?: string | null;
  config?: {
    openQuestionSilenceSeconds?: number;
    qaSilenceSeconds?: number;
    activeSilenceVoiceline?: string;
    showHana3DModel?: boolean;
    recruiterPersonaName?: string;
  };
  questions?: Array<{
    id: string;
    phase: string;
    prompt: string;
    description?: string;
  }>;
  tasks?: {
    requireResumeUpload?: boolean;
    requireWrittenReflection?: boolean;
    writtenPrompt?: string;
    minWrittenChars?: number;
    requirePressureRating?: boolean;
    requireSnapshotCheck?: boolean;
  };
  company_qa_knowledge?: Array<{
    title: string;
    keywords: string[];
    content: string;
  }>;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface InterviewSubmissionItem {
  id: string;
  interview_id: string;
  candidate_name: string;
  candidate_email?: string;
  status: 'completed' | 'in_progress' | 'reviewed';
  score: number;
  responses: Array<{
    phase: string;
    question: string;
    answer: string;
    timestamp: string;
  }>;
  snapshots: Array<{
    id: string;
    angle: string;
    label: string;
    dataUrl: string;
    timestamp: string;
  }>;
  resume_data?: {
    fileName: string;
    fileSize: string;
    uploadedAt: string;
  } | null;
  written_task?: string;
  pressure_rating?: string;
  ai_evaluation?: {
    strengths: string[];
    areas_for_growth: string[];
    summary: string;
    recommendation: 'Strong Hire' | 'Hire' | 'Borderline' | 'Reject';
  };
  completed_at: string;
}

interface InterviewDashboardProps {
  onNavigateHome: () => void;
  onNavigateToChat: () => void;
  onSelectInterview: (id: string) => void;
  isPremium?: boolean;
  onRequirePremium?: () => void;
  accountUser?: AccountUser | null;
}

export const InterviewDashboard: React.FC<InterviewDashboardProps> = ({
  onNavigateHome,
  onNavigateToChat,
  onSelectInterview,
  isPremium = false,
  onRequirePremium,
  accountUser,
}) => {
  const [activeTab, setActiveTab] = useState<'interviews' | 'history'>('interviews');
  const [interviews, setInterviews] = useState<InterviewDashboardRecord[]>([]);
  const [submissions, setSubmissions] = useState<InterviewSubmissionItem[]>([]);
  const [loadingInterviews, setLoadingInterviews] = useState<boolean>(true);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Upgrade Modal State for Non-Premium Users
  const [showUpgradeModal, setShowUpgradeModal] = useState<boolean>(false);
  const [upgradeFeatureName, setUpgradeFeatureName] = useState<string>('Creating and Managing Custom Interviews');

  // Interview Designer Modal State (Premium Feature)
  const [showDesignerModal, setShowDesignerModal] = useState<boolean>(false);
  const [designerStep, setDesignerStep] = useState<1 | 2 | 3 | 4>(1);
  const [isSavingInterview, setIsSavingInterview] = useState<boolean>(false);
  const [publishedInterview, setPublishedInterview] = useState<InterviewDashboardRecord | null>(null);

  // Designer Form State
  const [designerTitle, setDesignerTitle] = useState<string>('');
  const [designerRole, setDesignerRole] = useState<string>('');
  const [designerCompany, setDesignerCompany] = useState<string>('MuxAI');
  const [designerDescription, setDesignerDescription] = useState<string>('');
  const [designerRequireResume, setDesignerRequireResume] = useState<boolean>(true);
  const [designerRequireWritten, setDesignerRequireWritten] = useState<boolean>(true);
  const [designerWrittenPrompt, setDesignerWrittenPrompt] = useState<string>(
    'Please share three things you like about yourself and why. (Min 100 characters)'
  );
  const [designerMinChars, setDesignerMinChars] = useState<number>(100);
  const [designerRequirePressure, setDesignerRequirePressure] = useState<boolean>(true);
  const [designerRequireSnapshots, setDesignerRequireSnapshots] = useState<boolean>(true);
  const [designerOpenSilenceSec, setDesignerOpenSilenceSec] = useState<number>(3.0);
  const [designerQaSilenceSec, setDesignerQaSilenceSec] = useState<number>(5.0);
  const [designerShow3D, setDesignerShow3D] = useState<boolean>(true);
  const [designerQuestions, setDesignerQuestions] = useState<
    Array<{ id: string; phase: string; prompt: string; description: string }>
  >([
    {
      id: 'q1',
      phase: 'question_1',
      prompt: "Let's begin with a quick introduction. Could you tell me a bit about yourself, your background, and what drives your passion for this role?",
      description: 'Introduction & Background',
    },
    {
      id: 'q2',
      phase: 'question_2',
      prompt: 'Thank you. Now, could you walk me through a challenging technical problem or project you tackled recently? How did you approach resolving it?',
      description: 'Technical Problem Solving',
    },
  ]);

  // Candidate Dossier Detail Modal
  const [selectedSubmission, setSelectedSubmission] = useState<InterviewSubmissionItem | null>(null);
  const [zoomedSnapshot, setZoomedSnapshot] = useState<string | null>(null);

  // Fetch Interviews List from NeonDB
  const fetchInterviews = async () => {
    setLoadingInterviews(true);
    try {
      const resp = await fetch('/api/interview/list');
      const data = await resp.json();
      if (data.ok && Array.isArray(data.interviews)) {
        setInterviews(data.interviews);
      }
    } catch (err) {
      console.warn('Failed to fetch interviews:', err);
    } finally {
      setLoadingInterviews(false);
    }
  };

  // Fetch Candidate Submission History from NeonDB
  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const resp = await fetch('/api/interview-history');
      const data = await resp.json();
      if (data.ok && Array.isArray(data.submissions)) {
        setSubmissions(data.submissions);
      }
    } catch (err) {
      console.warn('Failed to fetch interview history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchInterviews();
  }, []);

  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistory();
    }
  }, [activeTab]);

  const handleCopyLink = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const url = `${window.location.origin}/interview?id=${encodeURIComponent(id)}`;
    navigator.clipboard?.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCreateClick = () => {
    if (!isPremium) {
      setUpgradeFeatureName('Interview Designer Studio & NeonDB Publishing');
      setShowUpgradeModal(true);
      return;
    }
    // Reset designer to fresh state
    setDesignerStep(1);
    setPublishedInterview(null);
    setDesignerTitle('');
    setDesignerRole('');
    setDesignerCompany(accountUser?.username ? `${accountUser.username} Labs` : 'MuxAI');
    setDesignerDescription('Autonomous screening with Hana evaluating background, technical architecture, and problem solving.');
    setShowDesignerModal(true);
  };

  const handleDeleteInterview = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isPremium) {
      setUpgradeFeatureName('Deleting & Managing Interviews');
      setShowUpgradeModal(true);
      return;
    }
    if (id === 'demo') {
      alert('The Demo template is protected and cannot be deleted.');
      return;
    }
    if (!window.confirm(`Are you sure you want to delete interview "${id}" from NeonDB?`)) {
      return;
    }

    try {
      const resp = await fetch(`/api/interview/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: accountUser?.id }),
      });
      const data = await resp.json();
      if (data.ok) {
        setInterviews((prev) => prev.filter((i) => i.id !== id));
      } else {
        alert(data.error || 'Failed to delete interview');
      }
    } catch (err: any) {
      alert(err.message || 'Error deleting interview');
    }
  };

  const handleAddQuestion = () => {
    const qIndex = designerQuestions.length + 1;
    setDesignerQuestions((prev) => [
      ...prev,
      {
        id: `q${Date.now()}`,
        phase: `question_${qIndex}`,
        prompt: 'Could you tell me about your experience with real-time systems and how you handle performance bottlenecks under load?',
        description: `Custom Question ${qIndex}`,
      },
    ]);
  };

  const handleRemoveQuestion = (id: string) => {
    if (designerQuestions.length <= 1) {
      alert('At least one screening question is required.');
      return;
    }
    setDesignerQuestions((prev) => prev.filter((q) => q.id !== id));
  };

  const handlePublishInterview = async () => {
    if (!designerTitle.trim() || !designerRole.trim()) {
      alert('Please provide an Interview Title and Target Role.');
      setDesignerStep(1);
      return;
    }

    setIsSavingInterview(true);
    try {
      // Generate clean unique ID
      const generatedId = `iv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const payload: Partial<InterviewDashboardRecord> = {
        id: generatedId,
        title: designerTitle.trim(),
        target_role: designerRole.trim(),
        company_name: designerCompany.trim() || 'MuxAI',
        description: designerDescription.trim(),
        created_by_user_id: accountUser?.id || null,
        created_by_email: accountUser?.email || null,
        config: {
          openQuestionSilenceSeconds: designerOpenSilenceSec,
          qaSilenceSeconds: designerQaSilenceSec,
          activeSilenceVoiceline: "I am assuming you have nothing else to say for now so let's move on to the next step.",
          showHana3DModel: designerShow3D,
          recruiterPersonaName: 'Hana',
        },
        questions: designerQuestions.map((q, idx) => ({
          ...q,
          phase: `question_${idx + 1}`,
        })),
        tasks: {
          requireResumeUpload: designerRequireResume,
          requireWrittenReflection: designerRequireWritten,
          writtenPrompt: designerWrittenPrompt.trim(),
          minWrittenChars: designerMinChars,
          requirePressureRating: designerRequirePressure,
          requireSnapshotCheck: designerRequireSnapshots,
        },
        company_qa_knowledge: [],
      };

      const resp = await fetch('/api/interview/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (data.ok && data.interview) {
        setPublishedInterview(data.interview);
        setInterviews((prev) => [data.interview, ...prev.filter((i) => i.id !== data.interview.id)]);
        setDesignerStep(4);
        try {
          confetti({
            particleCount: 80,
            spread: 70,
            origin: { y: 0.6 },
          });
        } catch {}
      } else {
        alert(data.error || 'Failed to save interview to NeonDB');
      }
    } catch (err: any) {
      alert(err.message || 'Error publishing interview');
    } finally {
      setIsSavingInterview(false);
    }
  };

  const filteredInterviews = interviews.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      item.target_role.toLowerCase().includes(q) ||
      item.company_name.toLowerCase().includes(q) ||
      item.id.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-[#f8fafc] text-neutral-900 font-sans flex flex-col selection:bg-sky-500/20 selection:text-sky-950">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-neutral-200 shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onNavigateHome}
              className="p-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-600 hover:text-neutral-900 transition-colors cursor-pointer"
              title="Return to Home"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-600 font-bold">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <h1 className="font-bold text-sm sm:text-base font-heading tracking-tight text-neutral-900 leading-tight">
                  Hana AI Autonomous Interviews
                </h1>
                <p className="text-[11px] text-neutral-500 hidden sm:block">
                  Recruiter Studio, Persistent NeonDB Storage &amp; Candidate History
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onSelectInterview('demo')}
              className="px-3 py-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Play className="w-3 h-3 fill-current text-sky-600" />
              <span>Launch Demo</span>
            </button>

            <button
              type="button"
              onClick={handleCreateClick}
              className="px-3.5 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm shadow-sky-500/20 transition-all cursor-pointer"
            >
              <Crown className="w-3.5 h-3.5 text-amber-300" />
              <span>Create Interview</span>
            </button>

            <button
              type="button"
              onClick={onNavigateToChat}
              className="p-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-semibold transition-colors cursor-pointer"
              title="Go to LM Chat"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-3xl p-6 sm:p-8 bg-neutral-900 border border-neutral-800 text-white overflow-hidden shadow-xl">
          <div className="relative z-10 max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-[11px] font-semibold text-sky-300">
              <Sparkles className="w-3 h-3" />
              <span>Autonomous Screening &amp; Verification</span>
            </div>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold font-heading tracking-tight leading-tight">
              Design AI Interviews &amp; Inspect Live Candidate Dossiers
            </h2>
            <p className="text-xs sm:text-sm text-neutral-300 leading-relaxed">
              Create customized screening scenarios with Hana. Generate persistent IDs stored in NeonDB, share public candidate links, and evaluate responses, resumes, written reflections, and identity verification snapshots.
            </p>

            <div className="pt-2 flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={handleCreateClick}
                className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-neutral-950 font-bold text-xs flex items-center gap-1.5 transition-all shadow-md shadow-sky-500/30 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create New Interview</span>
                {!isPremium && (
                  <span className="ml-1 px-1.5 py-0.2 rounded text-[10px] bg-amber-400/90 text-neutral-950 font-extrabold">
                    PRO
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => onSelectInterview('demo')}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Take Demo Interview</span>
              </button>
            </div>
          </div>

          {/* Decorative Background Accent */}
          <div className="absolute -right-16 -bottom-16 w-80 h-80 rounded-full bg-sky-500/20 blur-3xl pointer-events-none" />
        </div>

        {/* Tab Controls & Search Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-200 pb-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('interviews')}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                activeTab === 'interviews'
                  ? 'bg-neutral-900 text-white shadow-xs'
                  : 'bg-white text-neutral-600 hover:text-neutral-900 border border-neutral-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Interviews &amp; Public Links</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  activeTab === 'interviews' ? 'bg-white/20 text-white' : 'bg-neutral-100 text-neutral-600'
                }`}
              >
                {interviews.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                activeTab === 'history'
                  ? 'bg-neutral-900 text-white shadow-xs'
                  : 'bg-white text-neutral-600 hover:text-neutral-900 border border-neutral-200'
              }`}
            >
              <Award className="w-3.5 h-3.5" />
              <span>Candidate History &amp; Dossiers</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  activeTab === 'history' ? 'bg-white/20 text-white' : 'bg-neutral-100 text-neutral-600'
                }`}
              >
                {submissions.length}
              </span>
            </button>
          </div>

          {activeTab === 'interviews' && (
            <div className="relative max-w-xs w-full">
              <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search interviews or roles..."
                className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-white border border-neutral-200 text-xs text-neutral-900 focus:outline-none focus:border-sky-500"
              />
            </div>
          )}
        </div>

        {/* TAB 1: INTERVIEWS & PUBLIC LINKS */}
        {activeTab === 'interviews' && (
          <div className="space-y-4">
            {loadingInterviews ? (
              <div className="p-12 text-center space-y-3 bg-white rounded-3xl border border-neutral-200">
                <RefreshCw className="w-6 h-6 animate-spin text-sky-500 mx-auto" />
                <p className="text-xs text-neutral-500 font-medium">Loading interviews from NeonDB...</p>
              </div>
            ) : filteredInterviews.length === 0 ? (
              <div className="p-12 text-center space-y-3 bg-white rounded-3xl border border-neutral-200">
                <HelpCircle className="w-8 h-8 text-neutral-400 mx-auto" />
                <h3 className="font-bold text-sm text-neutral-800">No interviews found</h3>
                <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                  {searchQuery ? 'No results matched your search query.' : 'Create your first custom interview to generate public candidate links.'}
                </p>
                <button
                  type="button"
                  onClick={handleCreateClick}
                  className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold shadow-xs cursor-pointer inline-flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create Interview</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredInterviews.map((item) => {
                  const isDemo = item.id === 'demo';
                  const publicUrl = `${window.location.origin}/interview?id=${encodeURIComponent(item.id)}`;
                  const qCount = item.questions?.length || 2;
                  return (
                    <div
                      key={item.id}
                      className="rounded-3xl p-5 bg-white border border-neutral-200/90 shadow-2xs hover:shadow-md transition-all flex flex-col justify-between space-y-4 group"
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider ${
                              isDemo
                                ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                : 'bg-sky-50 text-sky-800 border border-sky-200'
                            }`}
                          >
                            ID: {item.id}
                          </span>

                          <div className="flex items-center gap-1">
                            {!isDemo && (
                              <button
                                type="button"
                                onClick={(e) => handleDeleteInterview(item.id, e)}
                                className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                title="Delete Interview"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div>
                          <h3 className="font-bold text-sm font-heading text-neutral-900 group-hover:text-sky-700 transition-colors line-clamp-1">
                            {item.title}
                          </h3>
                          <p className="text-xs text-neutral-500 mt-0.5 font-medium line-clamp-1">
                            {item.company_name} • {item.target_role}
                          </p>
                        </div>

                        {item.description && (
                          <p className="text-[11px] text-neutral-600 leading-relaxed line-clamp-2">
                            {item.description}
                          </p>
                        )}

                        {/* Task badges */}
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          <span className="px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-700 text-[10px] font-medium">
                            {qCount} Questions
                          </span>
                          {item.tasks?.requireResumeUpload !== false && (
                            <span className="px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-700 text-[10px] font-medium flex items-center gap-1">
                              <FileText className="w-2.5 h-2.5 text-neutral-500" />
                              Resume
                            </span>
                          )}
                          {item.tasks?.requireWrittenReflection !== false && (
                            <span className="px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-700 text-[10px] font-medium">
                              Written Reflection
                            </span>
                          )}
                          {item.tasks?.requireSnapshotCheck !== false && (
                            <span className="px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-700 text-[10px] font-medium flex items-center gap-1">
                              <Camera className="w-2.5 h-2.5 text-neutral-500" />
                              3-Angle ID
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Public Link Box & Action Buttons */}
                      <div className="space-y-2 pt-2 border-t border-neutral-100">
                        <div className="p-2 rounded-xl bg-neutral-50 border border-neutral-200 flex items-center justify-between gap-1.5 text-[10px] font-mono text-neutral-600">
                          <span className="truncate">/interview?id={item.id}</span>
                          <button
                            type="button"
                            onClick={(e) => handleCopyLink(item.id, e)}
                            className="text-sky-600 hover:text-sky-800 font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                          >
                            {copiedId === item.id ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-600" />
                                <span className="text-emerald-700 font-sans">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span className="font-sans">Copy</span>
                              </>
                            )}
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => onSelectInterview(item.id)}
                            className="py-1.5 px-2.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            <span>Start Session</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              window.open(publicUrl, '_blank');
                            }}
                            className="py-1.5 px-2.5 rounded-xl bg-white hover:bg-neutral-100 border border-neutral-200 text-neutral-700 text-xs font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer"
                          >
                            <ExternalLink className="w-3 h-3" />
                            <span>Open URL</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: CANDIDATE HISTORY & DOSSIERS */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            {loadingHistory ? (
              <div className="p-12 text-center space-y-3 bg-white rounded-3xl border border-neutral-200">
                <RefreshCw className="w-6 h-6 animate-spin text-sky-500 mx-auto" />
                <p className="text-xs text-neutral-500 font-medium">Fetching candidate history from NeonDB...</p>
              </div>
            ) : submissions.length === 0 ? (
              <div className="p-12 text-center space-y-3 bg-white rounded-3xl border border-neutral-200">
                <Award className="w-8 h-8 text-neutral-400 mx-auto" />
                <h3 className="font-bold text-sm text-neutral-800">No candidate submissions recorded yet</h3>
                <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                  Once candidates or test participants complete an interview session via their public link, their completed responses, resume, and photos appear here.
                </p>
                <button
                  type="button"
                  onClick={() => onSelectInterview('demo')}
                  className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-bold shadow-xs cursor-pointer inline-flex items-center gap-1.5"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>Take Demo Session</span>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {submissions.map((sub) => {
                  const rec = sub.ai_evaluation?.recommendation || 'Hire';
                  const recColors =
                    rec === 'Strong Hire'
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                      : rec === 'Hire'
                      ? 'bg-sky-100 text-sky-800 border-sky-300'
                      : 'bg-amber-100 text-amber-800 border-amber-300';

                  return (
                    <div
                      key={sub.id}
                      className="p-4 rounded-2xl bg-white border border-neutral-200/90 shadow-2xs hover:shadow-xs transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-700 font-bold text-sm shrink-0">
                          {sub.candidate_name ? sub.candidate_name.charAt(0).toUpperCase() : 'C'}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-sm text-neutral-900">{sub.candidate_name}</h4>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${recColors}`}>
                              {rec} • {sub.score}/100
                            </span>
                          </div>
                          <p className="text-xs text-neutral-500 mt-0.5">
                            Interview ID: <span className="font-mono">{sub.interview_id}</span>
                            {sub.completed_at && ` • ${new Date(sub.completed_at).toLocaleString()}`}
                          </p>

                          <div className="flex items-center gap-3 text-[11px] text-neutral-600 mt-1.5">
                            <span>{sub.responses?.length || 0} Spoken Answers</span>
                            <span>•</span>
                            <span>{sub.snapshots?.length || 0} ID Photos</span>
                            {sub.resume_data && (
                              <>
                                <span>•</span>
                                <span className="flex items-center gap-1 text-emerald-700 font-semibold">
                                  <FileText className="w-3 h-3" />
                                  Resume Attached
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => setSelectedSubmission(sub)}
                          className="px-3.5 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View Full Dossier</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* ======================================================== */}
      {/* MODAL: CANDIDATE DOSSIER INSPECTOR                        */}
      {/* ======================================================== */}
      {selectedSubmission && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 sm:p-8 shadow-2xl border border-neutral-200 space-y-6 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-4">
              <div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-sky-100 text-sky-800 uppercase">
                  Candidate Dossier • ID: {selectedSubmission.id}
                </span>
                <h3 className="text-xl font-bold font-heading text-neutral-900 mt-1">
                  {selectedSubmission.candidate_name}
                </h3>
                <p className="text-xs text-neutral-500">
                  Interview: {selectedSubmission.interview_id} • Completed at{' '}
                  {new Date(selectedSubmission.completed_at).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSubmission(null)}
                className="p-2 rounded-xl text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* AI Recommendation Card */}
            {selectedSubmission.ai_evaluation && (
              <div className="p-4 rounded-2xl bg-sky-50 border border-sky-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-sky-950 uppercase tracking-wider">
                    AI Recruiter Assessment
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-white text-sky-800 border border-sky-300">
                    {selectedSubmission.ai_evaluation.recommendation} ({selectedSubmission.score}/100)
                  </span>
                </div>
                <p className="text-xs text-neutral-800 leading-relaxed">
                  {selectedSubmission.ai_evaluation.summary}
                </p>
              </div>
            )}

            {/* Recorded Spoken Question Answers */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                Spoken Question Responses ({selectedSubmission.responses?.length || 0})
              </h4>
              <div className="space-y-2.5">
                {selectedSubmission.responses?.map((r, i) => (
                  <div key={i} className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200 space-y-1">
                    <p className="text-xs font-bold text-neutral-900">{r.question}</p>
                    <p className="text-xs text-neutral-700 leading-relaxed bg-white p-2.5 rounded-lg border border-neutral-100 mt-1">
                      &ldquo;{r.answer}&rdquo;
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Written Reflection & Pressure Rating */}
            {(selectedSubmission.written_task || selectedSubmission.pressure_rating) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                {selectedSubmission.written_task && (
                  <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200 space-y-1">
                    <h5 className="text-[11px] font-bold text-neutral-600 uppercase">Written Self-Reflection</h5>
                    <p className="text-xs text-neutral-800 leading-relaxed whitespace-pre-wrap">
                      {selectedSubmission.written_task}
                    </p>
                  </div>
                )}
                {selectedSubmission.pressure_rating && (
                  <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200 space-y-1">
                    <h5 className="text-[11px] font-bold text-neutral-600 uppercase">Situational Pressure Rating</h5>
                    <p className="text-xs text-neutral-800 leading-relaxed">
                      {selectedSubmission.pressure_rating}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Resume File */}
            {selectedSubmission.resume_data && (
              <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <FileText className="w-5 h-5 text-sky-600" />
                  <div>
                    <span className="text-xs font-bold text-neutral-900 block">
                      {selectedSubmission.resume_data.fileName}
                    </span>
                    <span className="text-[11px] text-neutral-500">
                      {selectedSubmission.resume_data.fileSize} • Uploaded during session
                    </span>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                  Verified
                </span>
              </div>
            )}

            {/* Visual Identity Snapshots */}
            {selectedSubmission.snapshots && selectedSubmission.snapshots.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                  Visual Identity Verification ({selectedSubmission.snapshots.length} angles)
                </h4>
                <div className="grid grid-cols-3 gap-2">
                  {selectedSubmission.snapshots.map((snap) => (
                    <div
                      key={snap.id}
                      onClick={() => setZoomedSnapshot(snap.dataUrl)}
                      className="aspect-video rounded-xl overflow-hidden bg-black border border-neutral-200 cursor-pointer hover:opacity-90 relative group"
                    >
                      <img
                        src={snap.dataUrl}
                        alt={snap.label}
                        className="w-full h-full object-cover transform -scale-x-100"
                      />
                      <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-black/60 text-white">
                        {snap.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedSubmission(null)}
                className="px-5 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-bold cursor-pointer"
              >
                Close Dossier
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Snapshot Zoom Lightbox */}
      {zoomedSnapshot && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-md z-60 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setZoomedSnapshot(null)}
        >
          <div className="max-w-2xl w-full rounded-2xl overflow-hidden border border-white/20">
            <img src={zoomedSnapshot} alt="Zoom" className="w-full h-auto object-contain transform -scale-x-100" />
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: UPGRADE PROMPT FOR NON-PREMIUM USERS              */}
      {/* ======================================================== */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl border border-neutral-200 text-center space-y-5 animate-in fade-in zoom-in-95">
            <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center mx-auto shadow-inner">
              <Crown className="w-7 h-7" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-xl font-bold font-heading text-neutral-900">
                Premium Recruiter Feature
              </h3>
              <p className="text-xs text-neutral-600 leading-relaxed">
                <strong className="text-neutral-900">{upgradeFeatureName}</strong> is reserved for verified Premium recruiters.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200 text-left space-y-2 text-xs text-neutral-700">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Unlimited custom interview scenarios &amp; prompts</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Persistent NeonDB storage &amp; public shareable IDs</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Automated candidate grading rubric &amp; evaluation dossiers</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>3D avatar recruiter customization with Hana</span>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowUpgradeModal(false);
                  onRequirePremium?.();
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-neutral-950 font-bold text-xs shadow-md transition-all cursor-pointer"
              >
                Upgrade to Premium
              </button>

              <button
                type="button"
                onClick={() => setShowUpgradeModal(false)}
                className="w-full py-2 text-xs text-neutral-500 hover:text-neutral-800 font-semibold cursor-pointer"
              >
                Maybe Later
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: INTERVIEW DESIGNER STUDIO (PREMIUM ONLY)          */}
      {/* ======================================================== */}
      {showDesignerModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 sm:p-8 shadow-2xl border border-neutral-200 space-y-6 animate-in fade-in zoom-in-95">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-neutral-100 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-neutral-900 font-heading">
                    Interview Designer Studio
                  </h3>
                  <p className="text-xs text-neutral-500">
                    Step {designerStep} of 4 • Configure and publish to NeonDB
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDesignerModal(false)}
                className="p-2 rounded-xl text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step Indicators */}
            <div className="grid grid-cols-4 gap-2 text-center text-[11px] font-semibold">
              <div
                className={`p-2 rounded-xl border ${
                  designerStep === 1
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : designerStep > 1
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-neutral-50 text-neutral-400 border-neutral-200'
                }`}
              >
                1. Role Details
              </div>
              <div
                className={`p-2 rounded-xl border ${
                  designerStep === 2
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : designerStep > 2
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-neutral-50 text-neutral-400 border-neutral-200'
                }`}
              >
                2. Tasks &amp; Settings
              </div>
              <div
                className={`p-2 rounded-xl border ${
                  designerStep === 3
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : designerStep > 3
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-neutral-50 text-neutral-400 border-neutral-200'
                }`}
              >
                3. Questions
              </div>
              <div
                className={`p-2 rounded-xl border ${
                  designerStep === 4
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : 'bg-neutral-50 text-neutral-400 border-neutral-200'
                }`}
              >
                4. NeonDB Publish
              </div>
            </div>

            {/* STEP 1: ROLE DETAILS */}
            {designerStep === 1 && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-neutral-700 block mb-1">
                    Interview Title *
                  </label>
                  <input
                    type="text"
                    value={designerTitle}
                    onChange={(e) => setDesignerTitle(e.target.value)}
                    placeholder="e.g. Senior Machine Learning Engineer"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-50 border border-neutral-300 text-xs text-neutral-900 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-neutral-700 block mb-1">
                      Target Role / Job Position *
                    </label>
                    <input
                      type="text"
                      value={designerRole}
                      onChange={(e) => setDesignerRole(e.target.value)}
                      placeholder="e.g. Lead Distributed Systems Engineer"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-50 border border-neutral-300 text-xs text-neutral-900 focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-neutral-700 block mb-1">
                      Company / Organization Name
                    </label>
                    <input
                      type="text"
                      value={designerCompany}
                      onChange={(e) => setDesignerCompany(e.target.value)}
                      placeholder="e.g. MuxAI Labs"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-50 border border-neutral-300 text-xs text-neutral-900 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-neutral-700 block mb-1">
                    Interview Description &amp; Screening Objectives
                  </label>
                  <textarea
                    rows={3}
                    value={designerDescription}
                    onChange={(e) => setDesignerDescription(e.target.value)}
                    placeholder="Briefly describe what this screening session evaluates..."
                    className="w-full p-3 rounded-xl bg-neutral-50 border border-neutral-300 text-xs text-neutral-900 focus:outline-none focus:border-sky-500 resize-none"
                  />
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    disabled={!designerTitle.trim() || !designerRole.trim()}
                    onClick={() => setDesignerStep(2)}
                    className="px-5 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 disabled:opacity-40 text-white font-bold text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <span>Next: Assessment Tasks</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: TASKS & SETTINGS */}
            {designerStep === 2 && (
              <div className="space-y-4">
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-600">
                    Candidate Assessment Steps
                  </h4>

                  <label className="flex items-center justify-between p-3 rounded-xl bg-neutral-50 border border-neutral-200 cursor-pointer">
                    <div>
                      <span className="text-xs font-bold text-neutral-900 block">Require Resume / CV Upload</span>
                      <span className="text-[11px] text-neutral-500 block">Candidate must attach latest credentials document</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={designerRequireResume}
                      onChange={(e) => setDesignerRequireResume(e.target.checked)}
                      className="w-4 h-4 rounded text-sky-600 cursor-pointer"
                    />
                  </label>

                  <label className="flex items-center justify-between p-3 rounded-xl bg-neutral-50 border border-neutral-200 cursor-pointer">
                    <div>
                      <span className="text-xs font-bold text-neutral-900 block">Require Written Self-Reflection</span>
                      <span className="text-[11px] text-neutral-500 block">Interactive prompt with minimum character requirement</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={designerRequireWritten}
                      onChange={(e) => setDesignerRequireWritten(e.target.checked)}
                      className="w-4 h-4 rounded text-sky-600 cursor-pointer"
                    />
                  </label>

                  {designerRequireWritten && (
                    <div className="p-3 rounded-xl bg-neutral-100/60 border border-neutral-200 space-y-2">
                      <div>
                        <label className="text-[11px] font-semibold text-neutral-700 block mb-1">
                          Written Reflection Prompt
                        </label>
                        <input
                          type="text"
                          value={designerWrittenPrompt}
                          onChange={(e) => setDesignerWrittenPrompt(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg bg-white border border-neutral-300 text-xs text-neutral-900"
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-neutral-600">Minimum Required Characters</span>
                        <input
                          type="number"
                          min={50}
                          max={500}
                          value={designerMinChars}
                          onChange={(e) => setDesignerMinChars(parseInt(e.target.value, 10) || 100)}
                          className="w-20 px-2 py-1 rounded bg-white border border-neutral-300 text-xs text-center"
                        />
                      </div>
                    </div>
                  )}

                  <label className="flex items-center justify-between p-3 rounded-xl bg-neutral-50 border border-neutral-200 cursor-pointer">
                    <div>
                      <span className="text-xs font-bold text-neutral-900 block">Require Situational Pressure Rating</span>
                      <span className="text-[11px] text-neutral-500 block">Behavioral question assessing project deadline handling</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={designerRequirePressure}
                      onChange={(e) => setDesignerRequirePressure(e.target.checked)}
                      className="w-4 h-4 rounded text-sky-600 cursor-pointer"
                    />
                  </label>

                  <label className="flex items-center justify-between p-3 rounded-xl bg-neutral-50 border border-neutral-200 cursor-pointer">
                    <div>
                      <span className="text-xs font-bold text-neutral-900 block">Require 3-Angle Camera Verification</span>
                      <span className="text-[11px] text-neutral-500 block">Forward, left, and right camera snapshots with note</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={designerRequireSnapshots}
                      onChange={(e) => setDesignerRequireSnapshots(e.target.checked)}
                      className="w-4 h-4 rounded text-sky-600 cursor-pointer"
                    />
                  </label>
                </div>

                <div className="pt-2 flex justify-between">
                  <button
                    type="button"
                    onClick={() => setDesignerStep(1)}
                    className="px-4 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-semibold cursor-pointer"
                  >
                    Back
                  </button>

                  <button
                    type="button"
                    onClick={() => setDesignerStep(3)}
                    className="px-5 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white font-bold text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <span>Next: Questions</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: QUESTIONS */}
            {designerStep === 3 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-600">
                      Screening Questions ({designerQuestions.length})
                    </h4>
                    <p className="text-[11px] text-neutral-500">
                      Spoken aloud by Hana during the live meeting phase
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddQuestion}
                    className="px-3 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-700 text-xs font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Question</span>
                  </button>
                </div>

                <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                  {designerQuestions.map((q, idx) => (
                    <div key={q.id} className="p-3.5 rounded-2xl bg-neutral-50 border border-neutral-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-neutral-800">
                          Question {idx + 1}
                        </span>
                        {designerQuestions.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveQuestion(q.id)}
                            className="text-neutral-400 hover:text-rose-600 cursor-pointer"
                            title="Remove Question"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>

                      <textarea
                        rows={2}
                        value={q.prompt}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDesignerQuestions((prev) =>
                            prev.map((item) => (item.id === q.id ? { ...item, prompt: val } : item))
                          );
                        }}
                        placeholder="Enter the question Hana will speak to the candidate..."
                        className="w-full p-2.5 rounded-xl bg-white border border-neutral-300 text-xs text-neutral-900 focus:outline-none focus:border-sky-500 leading-relaxed"
                      />
                    </div>
                  ))}
                </div>

                <div className="pt-2 flex justify-between">
                  <button
                    type="button"
                    onClick={() => setDesignerStep(2)}
                    className="px-4 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-semibold cursor-pointer"
                  >
                    Back
                  </button>

                  <button
                    type="button"
                    onClick={handlePublishInterview}
                    disabled={isSavingInterview}
                    className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md shadow-sky-500/20"
                  >
                    {isSavingInterview ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving to NeonDB...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Generate ID &amp; Publish</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* STEP 4: SUCCESS & NEONDB PUBLISHED */}
            {designerStep === 4 && publishedInterview && (
              <div className="text-center space-y-5 py-4">
                <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-inner">
                  <CheckCircle2 className="w-8 h-8" />
                </div>

                <div className="space-y-1">
                  <h3 className="text-xl font-bold font-heading text-neutral-900">
                    Interview Published to NeonDB!
                  </h3>
                  <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                    A valid unique ID has been generated and saved. Anyone can now take this interview using the public link below.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200 text-left space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-neutral-500 uppercase">Generated Interview ID</span>
                    <span className="font-mono font-bold text-sky-700">{publishedInterview.id}</span>
                  </div>

                  <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white border border-neutral-300 text-xs font-mono text-neutral-900">
                    <span className="truncate">{window.location.origin}/interview?id={publishedInterview.id}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyLink(publishedInterview.id)}
                      className="px-2.5 py-1 rounded-md bg-sky-500 text-white text-xs font-bold hover:bg-sky-400 transition-colors shrink-0 cursor-pointer"
                    >
                      {copiedId === publishedInterview.id ? 'Copied!' : 'Copy Link'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowDesignerModal(false);
                      onSelectInterview(publishedInterview.id);
                    }}
                    className="py-2.5 px-4 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Test Interview Now</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowDesignerModal(false)}
                    className="py-2.5 px-4 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-semibold text-xs cursor-pointer"
                  >
                    Return to Dashboard
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
