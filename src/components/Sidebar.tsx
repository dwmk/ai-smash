import React, { useState, useRef, useEffect } from 'react';
import { Conversation, ModelCacheInfo, AccountUser } from '../types';
import {
  MessageSquare,
  Plus,
  Search,
  Trash2,
  Pin,
  PinOff,
  X,
  AlertTriangle,
  Settings,
  LogOut,
  Crown,
  Cloud,
  Sparkles,
  UserPlus,
  LogIn,
  KeyRound,
  Check,
  Loader2,
  User as UserIcon,
  Home,
} from 'lucide-react';
import {
  APP_INFO,
  THEME_COLORS,
  UI_CONFIG,
  DEFAULT_USER_AVATAR_URL,
  resolveSecretOutfitsByRedeemCode,
} from '../constants';
import {
  isUserPremium,
  loadAccountSession,
  saveAccountSession,
  loadUnlockedOutfits,
  saveUnlockedOutfits,
  getBrowserDeviceLabel,
  getOrCreateDeviceFingerprint,
  isCodeAlreadyRedeemed,
  recordRedeemedCode,
  setSessionPassword,
  clearSessionPassword,
} from '../lib/storage';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: Conversation[];
  activeId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onDeleteConversation: (id: string) => void;
  onTogglePin: (id: string) => void;
  cacheStatuses?: Record<string, ModelCacheInfo>;
  accountUser?: AccountUser | null;
  onSignUp?: (email: string, password: string) => Promise<void>;
  onSignIn?: (email: string, password: string) => Promise<void>;
  onSignOut?: () => void;
  onUpdateProfile?: (updates: {
    username: string;
    displayName: string;
    avatarUrl: string;
  }) => Promise<void>;
  onRedeemCode?: (code: string) => Promise<void>;
  externalAuthModalRequest?: number;
  onNavigateHome?: () => void;
}

const SidebarComponent: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  conversations,
  activeId,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  onTogglePin,
  accountUser: propAccountUser,
  onSignUp,
  onSignIn,
  onSignOut,
  onUpdateProfile,
  onRedeemCode,
  externalAuthModalRequest = 0,
  onNavigateHome,
}) => {
  const [fallbackAccountUser, setFallbackAccountUser] = useState<AccountUser | null>(() => loadAccountSession());
  const accountUser = propAccountUser !== undefined ? propAccountUser : fallbackAccountUser;
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [holdProgress, setHoldProgress] = useState(0);

  // Auth Modal State (Sign Up / Sign In)
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'signup' | 'signin'>('signup');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);

  // Profile & Redeem Modal State
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editAvatarUrl, setEditAvatarUrl] = useState('');
  const [redeemInput, setRedeemInput] = useState('');
  const [profileStatusMsg, setProfileStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [isRedeeming, setIsRedeeming] = useState(false);

  const holdIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const holdStartTimeRef = useRef<number>(0);
  const sidebarRef = useRef<HTMLElement>(null);

  const isPremium = isUserPremium(accountUser);

  // Allow external trigger (e.g. clicking locked wardrobe item) to open Auth or Profile/Redeem modal
  useEffect(() => {
    if (externalAuthModalRequest > 0) {
      if (!accountUser) {
        setAuthMode('signup');
        setAuthError(null);
        setIsAuthModalOpen(true);
      } else {
        setEditDisplayName(accountUser.display_name || '');
        setEditUsername(accountUser.username || '');
        setEditAvatarUrl(accountUser.avatar_url || DEFAULT_USER_AVATAR_URL);
        setProfileStatusMsg(null);
        setIsProfileModalOpen(true);
      }
    }
  }, [externalAuthModalRequest, accountUser]);

  // Auto-close sidebar if clicked away from it (disabled when modals are open)
  useEffect(() => {
    if (!isOpen || Boolean(pendingDeleteId) || isAuthModalOpen || isProfileModalOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest('[data-sidebar-toggle]') ||
        target?.closest('[data-delete-modal]') ||
        target?.closest('[data-account-modal]') ||
        Boolean(pendingDeleteId)
      ) {
        return;
      }
      if (sidebarRef.current && !sidebarRef.current.contains(target as Node)) {
        onClose();
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handlePointerDown);
      document.addEventListener('touchstart', handlePointerDown);
    }, 20);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [isOpen, pendingDeleteId, isAuthModalOpen, isProfileModalOpen, onClose]);

  const filteredConversations = conversations.filter((c) =>
    (c.title || 'Untitled conversation').toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Sort pinned first, then updated recently
  const sortedConversations = [...filteredConversations].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });

  // Press and hold for 3 seconds handling
  const startHold = () => {
    if (!pendingDeleteId) return;
    holdStartTimeRef.current = Date.now();
    setHoldProgress(0);

    if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);

    holdIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - holdStartTimeRef.current;
      const progress = Math.min(100, Math.round((elapsed / UI_CONFIG.holdToDeleteDurationMs) * 100));
      setHoldProgress(progress);

      if (elapsed >= UI_CONFIG.holdToDeleteDurationMs) {
        if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
        onDeleteConversation(pendingDeleteId);
        setPendingDeleteId(null);
        setHoldProgress(0);
      }
    }, 40);
  };

  const cancelHold = () => {
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
    setHoldProgress(0);
  };

  const handleOpenAuthModal = (mode: 'signup' | 'signin') => {
    setAuthMode(mode);
    setAuthError(null);
    setAuthEmail('');
    setAuthPassword('');
    setIsAuthModalOpen(true);
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthError('Please enter both email address and password.');
      return;
    }
    setAuthError(null);
    setIsAuthSubmitting(true);
    try {
      if (authMode === 'signup') {
        if (typeof onSignUp === 'function') {
          await onSignUp(authEmail.trim(), authPassword);
        } else {
          const resp = await fetch('/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: authEmail.trim(),
              password: authPassword,
              device: getBrowserDeviceLabel(),
              fingerprint: getOrCreateDeviceFingerprint(),
            }),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || data.error) {
            throw new Error(data.error || 'Failed to create account.');
          }
          if (data.user) {
            saveAccountSession(data.user);
            setFallbackAccountUser(data.user);
            setSessionPassword(authPassword);
          }
        }
      } else {
        if (typeof onSignIn === 'function') {
          await onSignIn(authEmail.trim(), authPassword);
          setSessionPassword(authPassword);
        } else {
          const resp = await fetch('/api/auth/signin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: authEmail.trim(),
              password: authPassword,
              device: getBrowserDeviceLabel(),
              fingerprint: getOrCreateDeviceFingerprint(),
            }),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || data.error) {
            throw new Error(data.error || 'Failed to sign in.');
          }
          if (data.user) {
            saveAccountSession(data.user);
            setFallbackAccountUser(data.user);
            setSessionPassword(authPassword);
          }
        }
      }
      setIsAuthModalOpen(false);
      setAuthEmail('');
      setAuthPassword('');
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const handleOpenProfileSettings = () => {
    if (!accountUser) return;
    setEditDisplayName(accountUser.display_name || '');
    setEditUsername(accountUser.username || '');
    setEditAvatarUrl(accountUser.avatar_url || DEFAULT_USER_AVATAR_URL);
    setRedeemInput('');
    setProfileStatusMsg(null);
    setIsProfileModalOpen(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountUser) return;
    setProfileStatusMsg(null);
    setIsProfileSaving(true);
    try {
      const updates = {
        displayName: editDisplayName.trim(),
        username: editUsername.trim().replace(/^@+/, ''),
        avatarUrl: editAvatarUrl.trim() || DEFAULT_USER_AVATAR_URL,
      };
      if (typeof onUpdateProfile === 'function') {
        await onUpdateProfile(updates);
      } else {
        const resp = await fetch('/api/account/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: accountUser.id,
            ...updates,
          }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.error) {
          throw new Error(data.error || 'Failed to update profile.');
        }
        if (data.user) {
          saveAccountSession(data.user);
          setFallbackAccountUser(data.user);
        }
      }
      setProfileStatusMsg({ type: 'success', text: 'Profile updated successfully!' });
    } catch (err: unknown) {
      setProfileStatusMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update profile.',
      });
    } finally {
      setIsProfileSaving(false);
    }
  };

  const handleRedeemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawCode = redeemInput.trim();
    if (!rawCode || !accountUser) return;
    setProfileStatusMsg(null);

    if (isCodeAlreadyRedeemed(rawCode)) {
      setProfileStatusMsg({
        type: 'error',
        text: 'You have already applied this redeem code.',
      });
      return;
    }

    setIsRedeeming(true);
    try {
      const matchedSecretSkins = resolveSecretOutfitsByRedeemCode(rawCode);
      if (typeof onRedeemCode === 'function') {
        await onRedeemCode(rawCode);
      } else {
        const resp = await fetch('/api/account/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: accountUser.id,
            code: rawCode,
          }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.error) {
          throw new Error(data.error || 'Invalid redeem code.');
        }
        if (data.user) {
          saveAccountSession(data.user);
          setFallbackAccountUser(data.user);
          if (Array.isArray(data.user.unlocked_outfits)) {
            const currentLocal = loadUnlockedOutfits();
            saveUnlockedOutfits([...currentLocal, ...data.user.unlocked_outfits]);
          }
        }
      }
      recordRedeemedCode(rawCode);
      setRedeemInput('');
      if (matchedSecretSkins.length === 1) {
        setProfileStatusMsg({
          type: 'success',
          text: `Code redeemed! Unlocked "${matchedSecretSkins[0].name}" in your Wardrobe.`,
        });
      } else if (matchedSecretSkins.length > 1) {
        setProfileStatusMsg({
          type: 'success',
          text: `Code redeemed! Unlocked ${matchedSecretSkins.length} secret skins in your Wardrobe.`,
        });
      } else {
        setProfileStatusMsg({
          type: 'success',
          text: 'Code redeemed! Premium access activated.',
        });
      }
    } catch (err: unknown) {
      setProfileStatusMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Invalid redeem code.',
      });
    } finally {
      setIsRedeeming(false);
    }
  };

  const handleSignOutClick = () => {
    clearSessionPassword();
    if (typeof onSignOut === 'function') {
      onSignOut();
    } else {
      saveAccountSession(null);
      setFallbackAccountUser(null);
    }
  };

  return (
    <>
      {isOpen && (
        <>
          {/* Click-away backdrop */}
          <div
            className="fixed inset-0 bg-black/20 dark:bg-black/50 backdrop-blur-xs z-30 transition-opacity"
            onClick={onClose}
          />

          <aside
            ref={sidebarRef}
            className={`fixed top-0 bottom-0 left-0 w-72 sm:w-80 ${THEME_COLORS.tokens.sidebarBg} z-40 flex flex-col shadow-xl transition-all duration-200 border-r`}
            style={{
              backgroundColor: 'var(--theme-surface)',
              borderColor: 'var(--theme-border)',
            }}
          >
            {/* Sidebar Header */}
            <div className="p-3 border-b border-neutral-100 dark:border-neutral-800 flex items-center gap-1.5 justify-between">
              {onNavigateHome && (
                <button
                  type="button"
                  onClick={() => {
                    onNavigateHome();
                    onClose();
                  }}
                  className="p-2 rounded-xl text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.08] active:scale-95 transition-all shrink-0 cursor-pointer"
                  title="Home"
                >
                  <Home className="w-4 h-4" />
                </button>
              )}

              <button
                onClick={() => {
                  onNewChat();
                  if (window.innerWidth < 1024) onClose();
                }}
                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl ${THEME_COLORS.tokens.sidebarNewChatButton} active:scale-95 font-medium text-xs transition-all shadow-xs`}
                style={{
                  backgroundColor: 'var(--theme-accent)',
                  color: '#ffffff',
                }}
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                <span>New Chat</span>
              </button>

              <button
                onClick={onClose}
                className="p-2 rounded-xl text-neutral-400 hover:text-neutral-700 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.08] active:scale-95 transition-all shrink-0 cursor-pointer"
                title="Close sidebar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search Input */}
            <div className="px-3 pt-3 pb-1">
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 absolute left-3 text-neutral-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search conversations..."
                  className={`w-full pl-8 pr-3 py-1.5 rounded-xl ${THEME_COLORS.tokens.sidebarSearchInput} text-xs`}
                />
              </div>
            </div>

            {/* Conversations List */}
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
              {sortedConversations.length === 0 ? (
                <div className="text-center py-8 text-xs text-neutral-400">
                  No conversations found
                </div>
              ) : (
                sortedConversations.map((conv) => {
                  const isActive = conv.id === activeId;
                  return (
                    <div
                      key={conv.id}
                      className={`group relative flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all duration-100 cursor-pointer ${
                        isActive
                          ? THEME_COLORS.tokens.sidebarItemActive
                          : THEME_COLORS.tokens.sidebarItemInactive
                      }`}
                      onClick={() => {
                        onSelectConversation(conv.id);
                        if (window.innerWidth < 1024) onClose();
                      }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <MessageSquare
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isActive ? THEME_COLORS.tokens.accentText : 'text-neutral-400'
                          }`}
                        />
                        <span className="truncate">{conv.title || 'Conversation'}</span>
                      </div>

                      {/* Actions on hover */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onTogglePin(conv.id);
                          }}
                          className={`p-1 rounded hover:bg-neutral-200 dark:hover:bg-white/[0.1] text-neutral-400 ${THEME_COLORS.tokens.accentTextHover}`}
                          title={conv.pinned ? 'Unpin' : 'Pin conversation'}
                        >
                          {conv.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDeleteId(conv.id);
                            setHoldProgress(0);
                          }}
                          className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-white/[0.1] text-neutral-400 hover:text-red-500 dark:hover:text-red-400"
                          title="Delete conversation"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Pinned badge */}
                      {conv.pinned && (
                        <Pin className={`w-3 h-3 ${THEME_COLORS.tokens.accentText} shrink-0 ml-1.5`} />
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Bottom Account Section (Replaces Offline SLM Cache) */}
            <div
              className="p-3 border-t bg-neutral-50/80 dark:bg-white/[0.02] text-xs"
              style={{ borderColor: 'var(--theme-border)' }}
            >
              {!accountUser ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-neutral-800 dark:text-neutral-200">
                      <Crown className="w-3.5 h-3.5 text-amber-500" />
                      <span>Makron Account</span>
                    </span>
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold">
                      Optional
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug">
                    (Optional) Sync your conversations and customizations everywhere on other devices.
                  </p>
                  <div className="grid grid-cols-2 gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => handleOpenAuthModal('signup')}
                      className="py-2 px-3 rounded-xl font-semibold text-xs text-white flex items-center justify-center gap-1.5 shadow-xs active:scale-95 transition-all cursor-pointer"
                      style={{ backgroundColor: 'var(--theme-accent)' }}
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Sign Up</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenAuthModal('signin')}
                      className="py-2 px-3 rounded-xl font-semibold text-xs border border-black/10 dark:border-white/10 bg-white dark:bg-white/[0.05] text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.1] flex items-center justify-center gap-1.5 active:scale-95 transition-all cursor-pointer"
                    >
                      <LogIn className="w-3.5 h-3.5" />
                      <span>Sign In</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative w-9 h-9 rounded-full overflow-hidden ring-1 ring-black/10 dark:ring-white/15 shrink-0 bg-neutral-200 dark:bg-neutral-800">
                      <img
                        src={accountUser.avatar_url || DEFAULT_USER_AVATAR_URL}
                        alt={accountUser.display_name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = DEFAULT_USER_AVATAR_URL;
                        }}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-neutral-900 dark:text-white truncate">
                          {accountUser.display_name}
                        </span>
                        {isPremium ? (
                          <span className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-600 dark:text-amber-300 font-bold shrink-0">
                            PRO
                          </span>
                        ) : (
                          <span className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-neutral-200 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 font-medium shrink-0">
                            FREE
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-neutral-400 dark:text-neutral-500 font-mono truncate block">
                        @{accountUser.username}
                      </span>
                    </div>
                  </div>

                  {/* Settings Icon & Log Out Icon */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={handleOpenProfileSettings}
                      className="p-2 rounded-xl text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-200/60 dark:hover:bg-white/[0.08] active:scale-95 transition-all cursor-pointer"
                      title="Edit profile, redeem codes & account settings"
                      aria-label="Account settings"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleSignOutClick}
                      className="p-2 rounded-xl text-neutral-500 hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 active:scale-95 transition-all cursor-pointer"
                      title="Log out"
                      aria-label="Log out"
                    >
                      <LogOut className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-2.5 pt-2 border-t border-neutral-200/60 dark:border-neutral-800/80 text-center">
                <a
                  href="https://mux8.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`text-[10px] font-mono text-neutral-400 dark:text-neutral-500 ${THEME_COLORS.tokens.accentTextHover} transition-colors`}
                  title="Visit Makron"
                >
                  {APP_INFO.copyright}
                </a>
              </div>
            </div>
          </aside>
        </>
      )}

      {/* Auth Modal (Sign Up / Sign In via NeonDB with email & password only) */}
      {isAuthModalOpen && (
        <div
          data-account-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setIsAuthModalOpen(false)}
        >
          <div
            data-account-modal="true"
            className={`w-full max-w-md ${THEME_COLORS.tokens.modalBg} rounded-3xl p-6 shadow-2xl animate-in zoom-in-95 duration-150`}
            style={{
              backgroundColor: 'var(--theme-surface)',
              borderColor: 'var(--theme-border)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-9 h-9 rounded-2xl flex items-center justify-center"
                  style={{
                    backgroundColor: 'var(--theme-accent-soft)',
                    color: 'var(--theme-accent)',
                  }}
                >
                  <UserIcon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold font-heading text-neutral-900 dark:text-white">
                    {authMode === 'signup' ? 'Create AI Smash account' : 'Sign In to AI Smash'}
                  </h3>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    Having an account is totally optional.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAuthModalOpen(false)}
                className="p-2 rounded-xl text-neutral-400 hover:text-neutral-700 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.08]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Mode Switcher */}
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-neutral-100 dark:bg-white/[0.05] mb-4">
              <button
                type="button"
                onClick={() => {
                  setAuthMode('signup');
                  setAuthError(null);
                }}
                className={`py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  authMode === 'signup'
                    ? 'bg-white dark:bg-[#1c1f2e] text-neutral-900 dark:text-white shadow-xs'
                    : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
                }`}
              >
                Sign Up
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('signin');
                  setAuthError(null);
                }}
                className={`py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  authMode === 'signin'
                    ? 'bg-white dark:bg-[#1c1f2e] text-neutral-900 dark:text-white shadow-xs'
                    : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
                }`}
              >
                Sign In
              </button>
            </div>

            <form onSubmit={handleAuthSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs ${THEME_COLORS.tokens.modalInputBg} focus:outline-none`}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  required
                  minLength={4}
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••"
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs ${THEME_COLORS.tokens.modalInputBg} focus:outline-none`}
                />
              </div>

              {authError && (
                <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs">
                  {authError}
                </div>
              )}

              <button
                type="submit"
                disabled={isAuthSubmitting}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-2 shadow-sm active:scale-98 transition-all cursor-pointer disabled:opacity-50"
                style={{ backgroundColor: 'var(--theme-accent)' }}
              >
                {isAuthSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Connecting to auth server...</span>
                  </>
                ) : authMode === 'signup' ? (
                  <>
                    <UserPlus className="w-4 h-4" />
                    <span>Sign Up</span>
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    <span>Sign In</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Logged-In Profile Edit & Redeem Code Pop-out Modal */}
      {isProfileModalOpen && accountUser && (
        <div
          data-account-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setIsProfileModalOpen(false)}
        >
          <div
            data-account-modal="true"
            className={`w-full max-w-md max-h-[90vh] overflow-y-auto ${THEME_COLORS.tokens.modalBg} rounded-3xl p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150`}
            style={{
              backgroundColor: 'var(--theme-surface)',
              borderColor: 'var(--theme-border)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b pb-3.5" style={{ borderColor: 'var(--theme-border)' }}>
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-full overflow-hidden ring-2 ring-[var(--theme-accent)] shrink-0">
                  <img
                    src={editAvatarUrl || accountUser.avatar_url || DEFAULT_USER_AVATAR_URL}
                    alt={accountUser.display_name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = DEFAULT_USER_AVATAR_URL;
                    }}
                  />
                </div>
                <div>
                  <h3 className="text-base font-bold font-heading text-neutral-900 dark:text-white flex items-center gap-1.5">
                    <span>Account &amp; Profile</span>
                    {isPremium && <Crown className="w-4 h-4 text-amber-500" />}
                  </h3>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 font-mono">
                    {accountUser.email}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsProfileModalOpen(false)}
                className="p-2 rounded-xl text-neutral-400 hover:text-neutral-700 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.08]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {profileStatusMsg && (
              <div
                className={`p-3 rounded-2xl text-xs font-medium border ${
                  profileStatusMsg.type === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-400'
                    : 'bg-red-500/10 border-red-500/25 text-red-600 dark:text-red-400'
                }`}
              >
                {profileStatusMsg.text}
              </div>
            )}

            {/* Edit Profile Form */}
            <form onSubmit={handleSaveProfile} className="space-y-3">
              <h4 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
                <UserIcon className="w-3.5 h-3.5" />
                <span>Edit Profile</span>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={editDisplayName}
                    onChange={(e) => setEditDisplayName(e.target.value)}
                    placeholder="Display Name"
                    className={`w-full px-3 py-2 rounded-xl text-xs ${THEME_COLORS.tokens.modalInputBg}`}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                    placeholder="username"
                    className={`w-full px-3 py-2 rounded-xl text-xs font-mono ${THEME_COLORS.tokens.modalInputBg}`}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  Avatar URL
                </label>
                <input
                  type="url"
                  value={editAvatarUrl}
                  onChange={(e) => setEditAvatarUrl(e.target.value)}
                  placeholder="https://..."
                  className={`w-full px-3 py-2 rounded-xl text-xs ${THEME_COLORS.tokens.modalInputBg}`}
                />
              </div>

              <button
                type="submit"
                disabled={isProfileSaving}
                className="w-full py-2 px-4 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-1.5 shadow-xs active:scale-98 transition-all cursor-pointer disabled:opacity-50"
                style={{ backgroundColor: 'var(--theme-accent)' }}
              >
                {isProfileSaving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Save Profile Changes</span>
                  </>
                )}
              </button>
            </form>

            {/* Redeem Code Section */}
            <form
              onSubmit={handleRedeemSubmit}
              className="pt-4 border-t space-y-2.5"
              style={{ borderColor: 'var(--theme-border)' }}
            >
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-amber-500" />
                  <span>Redeem Premium Code</span>
                </h4>
                <span
                  className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full font-semibold ${
                    isPremium
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-neutral-200 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
                  }`}
                >
                  {isPremium ? 'Paid (Active)' : 'Free Tier'}
                </span>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={redeemInput}
                  onChange={(e) => setRedeemInput(e.target.value)}
                  placeholder="ENTER CODE"
                  className={`flex-1 px-3 py-2 rounded-xl text-xs font-mono uppercase ${THEME_COLORS.tokens.modalInputBg}`}
                />
                <button
                  type="submit"
                  disabled={isRedeeming || !redeemInput.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-neutral-950 transition-all cursor-pointer disabled:opacity-50 shrink-0"
                >
                  {isRedeeming ? 'Redeeming...' : 'Redeem'}
                </button>
              </div>
            </form>

            {/* Account Telemetry & Metadata */}
            <div
              className="p-3 rounded-2xl bg-black/[0.02] dark:bg-white/[0.02] border text-[11px] space-y-1 font-mono text-neutral-500 dark:text-neutral-400"
              style={{ borderColor: 'var(--theme-border)' }}
            >
              <div className="flex justify-between">
                <span>Account Type:</span>
                <span className="font-semibold text-neutral-800 dark:text-neutral-200 uppercase">
                  {accountUser.account_type}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Last Payment:</span>
                <span>
                  {accountUser.last_payment
                    ? new Date(accountUser.last_payment).toLocaleDateString()
                    : 'None'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Last Login:</span>
                <span>{new Date(accountUser.last_login_time).toLocaleString()}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="shrink-0">Device:</span>
                <span className="truncate">{accountUser.last_login_device}</span>
              </div>
              {Array.isArray(accountUser.unlocked_outfits) && accountUser.unlocked_outfits.length > 0 && (
                <div className="flex justify-between gap-2">
                  <span className="shrink-0">Secret Skins Unlocked:</span>
                  <span className="font-semibold text-purple-600 dark:text-purple-400">
                    {accountUser.unlocked_outfits.length}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal with 3-Second Press & Hold */}
      {pendingDeleteId && (
        <div
          data-delete-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => {
            cancelHold();
            setPendingDeleteId(null);
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              cancelHold();
              setPendingDeleteId(null);
            }
          }}
          onTouchStart={(e) => {
            if (e.target === e.currentTarget) {
              cancelHold();
              setPendingDeleteId(null);
            }
          }}
        >
          <div
            data-delete-modal="true"
            className={`w-full max-w-sm ${THEME_COLORS.tokens.modalBg} rounded-3xl p-5 shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-150`}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <div className={`w-12 h-12 rounded-full ${THEME_COLORS.tokens.dangerBadge} flex items-center justify-center mb-3`}>
              <AlertTriangle className="w-6 h-6" />
            </div>

            <h3 className="text-base font-bold text-neutral-900 dark:text-white">
              Delete Conversation?
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 mb-5 leading-relaxed">
              Press and hold the button below for <strong>{Math.round(UI_CONFIG.holdToDeleteDurationMs / 1000)} seconds</strong> to permanently delete this chat.
            </p>

            {/* Hold Button */}
            <div className="w-full flex flex-col gap-2">
              <button
                type="button"
                onMouseDown={startHold}
                onMouseUp={cancelHold}
                onMouseLeave={cancelHold}
                onTouchStart={startHold}
                onTouchEnd={cancelHold}
                className={`relative w-full py-3 rounded-2xl ${THEME_COLORS.tokens.dangerHoldBtn} font-semibold text-xs overflow-hidden select-none active:scale-[0.99] transition-transform shadow-xs cursor-pointer`}
              >
                {/* Visual Fill Progress */}
                <div
                  className={`absolute inset-y-0 left-0 ${THEME_COLORS.tokens.dangerButton} transition-all ease-linear`}
                  style={{ width: `${holdProgress}%` }}
                />

                <span className={`relative z-10 font-bold transition-colors ${holdProgress > 45 ? 'text-white' : 'text-red-700 dark:text-red-300'}`}>
                  {holdProgress > 0
                    ? `Holding... ${Math.max(1, Math.ceil((100 - holdProgress) / 33.3))}s`
                    : `Press & Hold to Delete (${Math.round(UI_CONFIG.holdToDeleteDurationMs / 1000)}s)`}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  cancelHold();
                  setPendingDeleteId(null);
                }}
                className="w-full py-2.5 rounded-2xl bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 font-medium text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const Sidebar = React.memo(SidebarComponent);
