import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle, Archive, ArchiveRestore, ArrowDown, Check, Copy, Download, Globe, Link2, Lock,
  MessageSquarePlus, Pencil, Quote, RefreshCw, Search, Send, Sparkles, Square, Trash2, Wand2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { aiManagerAPI, AIManagerStatus, AISourceType, requirementChatAPI } from '@/lib/api';
import { RequirementChatAskResponse, RequirementChatConversation, RequirementChatMessage } from '@/types';

export type ChatScopeMode = 'requirements' | 'all';

interface RequirementChatProps {
  projectId: number;
  scopeMode: ChatScopeMode;
  variant: 'modal' | 'page';
  active: boolean;                       // load data when true (modal open / page mounted)
  initialPublicId?: string | null;       // deep-link target (share UUID)
  onClose?: () => void;                  // close modal before navigating away
  headerActions?: ReactNode;             // wrapper-supplied controls (fullscreen / back)
}

const STARTER_KEYS = ['reqChatStarter1', 'reqChatStarter2', 'reqChatStarter3'] as const;

export function RequirementChat({
  projectId, scopeMode, variant, active, initialPublicId, onClose, headerActions,
}: RequirementChatProps) {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [conversations, setConversations] = useState<RequirementChatConversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<RequirementChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [aiStatus, setAiStatus] = useState<AIManagerStatus | null>(null);
  const [lastResult, setLastResult] = useState<RequirementChatAskResponse | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [selectedSources, setSelectedSources] = useState<AISourceType[]>([]);
  const [search, setSearch] = useState('');
  const [atBottom, setAtBottom] = useState(true);
  const [activeConvObj, setActiveConvObj] = useState<RequirementChatConversation | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [quoteSel, setQuoteSel] = useState<{ text: string; top: number; left: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const deepLinkRef = useRef<string | null>(initialPublicId ?? null);

  const adminEnabled = aiStatus?.requirement_chat_source_types ?? [];
  // In requirements-only mode the assistant is locked to requirements regardless
  // of what the admin enabled project-wide.
  const enabledSources: AISourceType[] = scopeMode === 'requirements' ? ['requirements'] : adminEnabled;
  const showScopeSelector = scopeMode === 'all' && enabledSources.length > 1 && !readOnly;
  const canOpenFullAssistant = scopeMode === 'requirements' && adminEnabled.length > 1;

  // The active conversation may be one of the user's own (in the list) or a
  // read-only shared conversation opened via a link (not in the list).
  const activeConversation = conversations.find((c) => c.id === activeId) || activeConvObj;
  const isAbortError = (e: any) => e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError' || e?.name === 'AbortError';

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations;
  }, [conversations, search]);

  const loadConversations = (archived: boolean) =>
    requirementChatAPI.listConversations(projectId, archived)
      .then((data) => setConversations(data))
      .catch(() => { /* non-critical */ });

  useEffect(() => {
    if (!active) return;
    loadConversations(showArchived);
    aiManagerAPI.getStatus()
      .then(setAiStatus)
      .catch(() => setAiStatus({ active_provider: 'openai', available: false, reason: 'active_provider_not_configured' }));
  }, [active, projectId, showArchived]);

  // Open a deep-linked (possibly shared) conversation once, after activation.
  useEffect(() => {
    if (active && deepLinkRef.current) {
      const pid = deepLinkRef.current;
      deepLinkRef.current = null;
      openByLink(pid);
    }
  }, [active]);

  useEffect(() => {
    setSelectedSources(enabledSources);
  }, [enabledSources.join(',')]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    if (quoteSel) setQuoteSel(null);
  };
  const scrollToBottom = () => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });

  const toggleSource = (type: AISourceType) => {
    setSelectedSources((current) => {
      if (current.includes(type)) {
        const next = current.filter((s) => s !== type);
        return next.length ? next : current; // keep at least one
      }
      return enabledSources.filter((s) => current.includes(s) || s === type);
    });
  };

  const askScopes = showScopeSelector ? selectedSources : enabledSources;
  const placeholder = showScopeSelector
    ? t('reqChatPlaceholderScoped', { scopes: selectedSources.map((s) => t(`aiSource_${s}`)).join(', ') })
    : t('reqChatPlaceholder');

  const openConversation = async (id: number) => {
    if (sending) return;
    try {
      const data = await requirementChatAPI.getConversation(projectId, id);
      setActiveId(id);
      setMessages(data.messages || []);
      setActiveConvObj(data);
      setReadOnly(false);
      setLastResult(null);
      setQuoteSel(null);
    } catch {
      toast({ title: t('error'), description: t('reqChatLoadFailed'), variant: 'destructive' });
    }
  };

  const openByLink = async (publicId: string) => {
    try {
      const data = await requirementChatAPI.getConversationByLink(projectId, publicId);
      setActiveId(data.conversation.id);
      setMessages(data.conversation.messages || []);
      setActiveConvObj(data.conversation);
      setReadOnly(!!data.read_only);
      setLastResult(null);
      setQuoteSel(null);
    } catch {
      toast({ title: t('error'), description: t('reqChatLoadFailed'), variant: 'destructive' });
    }
  };

  const resetView = () => {
    setActiveId(null);
    setMessages([]);
    setLastResult(null);
    setEditingId(null);
    setActiveConvObj(null);
    setReadOnly(false);
    setQuoteSel(null);
  };

  const startNewConversation = () => {
    if (sending) return;
    resetView();
    setQuestion('');
    setShowArchived(false);
  };

  const toggleArchivedView = () => {
    if (sending) return;
    resetView();
    setShowArchived((v) => !v);
  };

  const submit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const optimistic: RequirementChatMessage = {
      id: -Date.now(), role: 'user', content: trimmed, sources: [], created_at: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    setQuestion('');
    try {
      const result: RequirementChatAskResponse = await requirementChatAPI.ask(projectId, {
        question: trimmed,
        conversation_id: activeId ?? undefined,
        source_types: scopeMode === 'requirements' ? ['requirements'] : (showScopeSelector ? selectedSources : undefined),
      }, controller.signal);
      setActiveId(result.conversation_id);
      setMessages((current) => [...current, result.message]);
      setLastResult(result);
      loadConversations(showArchived);
    } catch (error: any) {
      setMessages((current) => current.filter((m) => m.id !== optimistic.id));
      setQuestion(trimmed);
      if (!isAbortError(error)) {
        toast({ title: t('error'), description: error.response?.data?.detail || t('reqChatAskFailed'), variant: 'destructive' });
      }
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  };

  const handleStop = () => abortRef.current?.abort();

  const handleRegenerate = async () => {
    if (sending || activeId == null) return;
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result: RequirementChatAskResponse = await requirementChatAPI.regenerate(
        projectId, activeId,
        scopeMode === 'requirements' ? ['requirements'] : (showScopeSelector ? selectedSources : undefined),
        controller.signal,
      );
      setMessages((current) => {
        const next = [...current];
        for (let i = next.length - 1; i >= 0; i -= 1) {
          if (next[i].role === 'assistant') { next.splice(i, 1); break; }
        }
        return [...next, result.message];
      });
      setLastResult(result);
    } catch (error: any) {
      if (!isAbortError(error)) {
        toast({ title: t('error'), description: error.response?.data?.detail || t('reqChatAskFailed'), variant: 'destructive' });
      }
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  };

  const handleExport = () => {
    if (messages.length === 0) return;
    const title = activeConversation?.title || t('reqChatTitle');
    const lines = [`# ${title}`, ''];
    for (const m of messages) {
      lines.push(m.role === 'user' ? `## 🧑 ${t('reqChatYou')}` : `## 🤖 ${t('reqChatAssistant')}`);
      lines.push('', m.content, '');
      if (m.role === 'assistant' && m.sources.length > 0) {
        lines.push(`_${t('reqChatSources')}: ${m.sources.map((s) => s.key).join(', ')}_`, '');
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'conversation'}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const copyLink = async (publicId: string) => {
    const url = `${window.location.origin}/projects/${projectId}/ask?c=${publicId}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkedId(publicId);
      setTimeout(() => setLinkedId((cur) => (cur === publicId ? null : cur)), 1500);
    } catch {
      toast({ title: t('error'), description: t('reqChatCopyFailed'), variant: 'destructive' });
    }
  };

  const setShareScope = async (conv: RequirementChatConversation, scope: 'private' | 'project') => {
    if (conv.share_scope === scope) return;
    setSharingId(conv.id);
    try {
      const updated = await requirementChatAPI.updateConversation(projectId, conv.id, { share_scope: scope });
      setConversations((cur) => cur.map((c) => (c.id === conv.id ? { ...c, share_scope: scope } : c)));
      setActiveConvObj((cur) => (cur && cur.id === conv.id ? { ...cur, share_scope: scope } : cur));
      if (scope === 'project') copyLink(updated?.public_id || conv.public_id);
    } catch {
      toast({ title: t('error'), description: t('reqChatShareFailed'), variant: 'destructive' });
    } finally {
      setSharingId(null);
    }
  };

  // --- Select text in a response → ask about it -----------------------------
  const captureSelection = () => {
    if (readOnly || aiUnavailable) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? '';
    const container = scrollRef.current;
    if (!sel || sel.rangeCount === 0 || text.length < 3 || !container) { setQuoteSel(null); return; }
    const node = sel.anchorNode;
    const host = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null);
    // Only offer the action for selections inside an assistant message bubble.
    if (!host || !host.closest('[data-role="assistant"]') || !container.contains(host)) { setQuoteSel(null); return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const box = container.getBoundingClientRect();
    setQuoteSel({
      text: text.slice(0, 500),
      top: Math.max(4, rect.top - box.top - 34),
      left: Math.min(Math.max(4, rect.left - box.left), box.width - 130),
    });
  };

  const askAboutSelection = () => {
    if (!quoteSel) return;
    const quoted = t('reqChatQuotedPrompt', { quote: quoteSel.text });
    setQuestion((prev) => (prev ? `${quoted}\n${prev}` : `${quoted}\n`));
    setQuoteSel(null);
    window.getSelection()?.removeAllRanges();
    textareaRef.current?.focus();
  };

  const handleArchiveToggle = async (conv: RequirementChatConversation) => {
    if (sending) return;
    try {
      await requirementChatAPI.updateConversation(projectId, conv.id, { archived: !conv.archived });
      setConversations((current) => current.filter((c) => c.id !== conv.id));
      if (activeId === conv.id) startNewConversation();
    } catch {
      toast({ title: t('error'), description: t('reqChatArchiveFailed'), variant: 'destructive' });
    }
  };

  const handleDelete = async (id: number) => {
    if (sending) return;
    try {
      await requirementChatAPI.deleteConversation(projectId, id);
      setConversations((current) => current.filter((c) => c.id !== id));
      if (activeId === id) startNewConversation();
    } catch {
      toast({ title: t('error'), description: t('reqChatDeleteFailed'), variant: 'destructive' });
    }
  };

  const beginRename = (conv: RequirementChatConversation) => { setEditingId(conv.id); setEditingTitle(conv.title); };
  const commitRename = async () => {
    const id = editingId;
    const title = editingTitle.trim();
    setEditingId(null);
    if (!id || !title) return;
    try {
      await requirementChatAPI.updateConversation(projectId, id, { title });
      setConversations((current) => current.map((c) => (c.id === id ? { ...c, title } : c)));
    } catch {
      toast({ title: t('error'), description: t('reqChatRenameFailed'), variant: 'destructive' });
    }
  };

  const copyAnswer = async (m: RequirementChatMessage) => {
    try {
      await navigator.clipboard.writeText(m.content);
      setCopiedId(m.id);
      setTimeout(() => setCopiedId((cur) => (cur === m.id ? null : cur)), 1500);
    } catch {
      toast({ title: t('error'), description: t('reqChatCopyFailed'), variant: 'destructive' });
    }
  };

  const sourceHref = (s: { type?: string; id?: number | null; requirement_id?: number | null }) => {
    const id = s.id ?? s.requirement_id;
    if (id == null) return null;
    const segment = ({ defect: 'defects', test_plan: 'test-plans', test_case: 'test-cases' } as Record<string, string>)[s.type || 'requirement'] || 'requirements';
    return `/projects/${projectId}/${segment}/${id}`;
  };

  const fmtTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const featureDisabled = aiStatus !== null && aiStatus.requirement_chat_enabled === false;
  const aiUnavailable = aiStatus !== null && (!aiStatus.available || featureDisabled);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-gradient-to-r from-primary/5 to-transparent px-5 py-3.5 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold leading-tight text-slate-900 dark:text-white">{t('reqChatTitle')}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {scopeMode === 'requirements' ? t('reqChatDescription') : t('reqChatProjectDescription')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {canOpenFullAssistant && (
            <Button type="button" variant="outline" size="sm" className="hidden sm:inline-flex" onClick={() => { onClose?.(); navigate(`/projects/${projectId}/ask`); }}>
              <Wand2 className={`h-4 w-4 ${isRTL ? 'ms-0 me-1.5' : 'me-1.5'}`} />
              {t('reqChatOpenFull')}
            </Button>
          )}
          {headerActions}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside className="hidden w-60 shrink-0 flex-col border-e border-slate-200 dark:border-slate-800 sm:flex">
          <div className="flex items-center gap-1 p-2">
            <Button type="button" variant="outline" size="sm" className="flex-1 justify-start" onClick={startNewConversation}>
              <MessageSquarePlus className={`h-4 w-4 ${isRTL ? 'ms-0 me-2' : 'me-2'}`} />
              {t('reqChatNew')}
            </Button>
          </div>
          <div className="px-2 pb-1">
            <div className="relative">
              <Search className={`pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-2' : 'left-2'}`} />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('reqChatSearch')}
                className={`h-7 text-xs ${isRTL ? 'pr-7' : 'pl-7'}`}
              />
            </div>
          </div>
          <div className="flex items-center justify-between px-3 pb-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {showArchived ? t('reqChatArchivedLabel') : t('reqChatRecent')}
            </span>
            <button type="button" className="text-[11px] font-medium text-primary hover:underline" onClick={toggleArchivedView}>
              {showArchived ? t('reqChatShowActive') : t('reqChatShowArchived')}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {filteredConversations.length === 0 ? (
              <p className="px-2 py-3 text-xs text-slate-400">
                {search.trim() ? t('reqChatNoSearchResults') : showArchived ? t('reqChatNoArchived') : t('reqChatNoConversations')}
              </p>
            ) : filteredConversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm ${activeId === c.id ? 'bg-primary/10 text-primary' : 'hover:bg-slate-50 dark:hover:bg-slate-900'}`}
              >
                <button type="button" className="flex-1 truncate text-start" onClick={() => openConversation(c.id)} title={c.title}>
                  {c.title}
                </button>
                <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                  <button type="button" className="p-1 text-slate-400 hover:text-primary" onClick={() => copyLink(c.public_id)} aria-label={t('reqChatCopyLink')} title={linkedId === c.public_id ? t('reqChatLinkCopied') : t('reqChatCopyLink')}>
                    {linkedId === c.public_id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Link2 className="h-3.5 w-3.5" />}
                  </button>
                  <button type="button" className="p-1 text-slate-400 hover:text-amber-600" onClick={() => handleArchiveToggle(c)} aria-label={c.archived ? t('reqChatUnarchive') : t('reqChatArchive')} title={c.archived ? t('reqChatUnarchive') : t('reqChatArchive')}>
                    {c.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                  </button>
                  <button type="button" className="p-1 text-slate-400 hover:text-rose-500" onClick={() => handleDelete(c.id)} aria-label={t('delete')}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Conversation */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {activeConversation && (
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2 dark:border-slate-800/60">
              {editingId === activeConversation.id && !readOnly ? (
                <Input
                  autoFocus
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitRename(); } if (e.key === 'Escape') setEditingId(null); }}
                  maxLength={255}
                  className="h-7 max-w-xs px-2 py-0 text-sm"
                />
              ) : (
                <>
                  <span className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{activeConversation.title}</span>
                  {!readOnly && (
                    <button type="button" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" onClick={() => beginRename(activeConversation)} aria-label={t('reqChatRename')}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </>
              )}
              {readOnly && (
                <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                  {t('reqChatReadOnly')}
                </span>
              )}
              {!readOnly && activeConversation.archived && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  {t('reqChatArchivedLabel')}
                </span>
              )}
              <div className="ms-auto flex items-center gap-1">
                {!readOnly && (
                  <button
                    type="button"
                    disabled={sharingId === activeConversation.id}
                    onClick={() => setShareScope(activeConversation, activeConversation.share_scope === 'project' ? 'private' : 'project')}
                    className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs disabled:opacity-50 ${activeConversation.share_scope === 'project' ? 'text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200'}`}
                    title={activeConversation.share_scope === 'project' ? t('reqChatShareOn') : t('reqChatShareOff')}
                  >
                    {activeConversation.share_scope === 'project' ? <Globe className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline">{activeConversation.share_scope === 'project' ? t('reqChatShared') : t('reqChatShare')}</span>
                  </button>
                )}
                {!readOnly && (
                  <button type="button" disabled={sending || messages.length === 0} onClick={handleRegenerate} className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200" title={t('reqChatRegenerate')}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t('reqChatRegenerate')}</span>
                  </button>
                )}
                <button type="button" onClick={() => copyLink(activeConversation.public_id)} className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" title={t('reqChatCopyLink')}>
                  {linkedId === activeConversation.public_id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Link2 className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{linkedId === activeConversation.public_id ? t('reqChatLinkCopied') : t('reqChatCopyLink')}</span>
                </button>
                <button type="button" disabled={messages.length === 0} onClick={handleExport} className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200" title={t('reqChatExport')}>
                  <Download className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('reqChatExport')}</span>
                </button>
              </div>
            </div>
          )}

          {aiUnavailable && (
            <div className="m-3 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {featureDisabled ? t('reqChatDisabled') : t('aiEnabledTokenMissing')}
            </div>
          )}

          <div ref={scrollRef} onScroll={onScroll} onMouseUp={captureSelection} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {messages.length === 0 && !sending ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Sparkles className="h-6 w-6" />
                </span>
                <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{t('reqChatEmptyState')}</p>
                {!aiUnavailable && (
                  <div className="flex max-w-md flex-wrap justify-center gap-2">
                    {STARTER_KEYS.map((key) => (
                      <button key={key} type="button" onClick={() => submit(t(key))} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition-colors hover:border-primary/40 hover:text-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                        {t(key)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : messages.map((m) => (
              <div key={m.id} className={`group flex flex-col duration-300 animate-in fade-in slide-in-from-bottom-2 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div data-role={m.role} className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'}`}>
                  {m.role === 'assistant' ? (
                    <div className="prose prose-sm max-w-none break-words dark:prose-invert [&_:first-child]:mt-0 [&_:last-child]:mb-0 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  )}
                  {m.role === 'assistant' && m.sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.sources.map((s, i) => {
                        const href = sourceHref(s);
                        return (
                          <button key={`${s.key}-${i}`} type="button" disabled={!href} onClick={() => { if (href) { onClose?.(); navigate(href); } }} className="rounded bg-white/70 px-1.5 py-0.5 text-[11px] font-medium text-primary ring-1 ring-inset ring-primary/20 transition-colors hover:bg-white disabled:cursor-default disabled:opacity-70 dark:bg-slate-900/60" title={s.title}>
                            {s.key}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className={`mt-1 flex items-center gap-2 px-1 text-[10px] text-slate-400 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <span>{fmtTime(m.created_at)}</span>
                  {m.role === 'assistant' && (
                    <button type="button" onClick={() => copyAnswer(m)} className="flex items-center gap-0.5 opacity-0 transition-opacity hover:text-slate-600 group-hover:opacity-100 dark:hover:text-slate-200" aria-label={t('reqChatCopy')}>
                      {copiedId === m.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copiedId === m.id ? t('reqChatCopied') : t('reqChatCopy')}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start duration-300 animate-in fade-in">
                <div className="flex items-center gap-1.5 rounded-2xl bg-slate-100 px-4 py-3 dark:bg-slate-800">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
                </div>
              </div>
            )}
          </div>

          {!atBottom && messages.length > 0 && (
            <button type="button" onClick={scrollToBottom} aria-label={t('reqChatScrollBottom')} title={t('reqChatScrollBottom')} className="absolute bottom-28 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-md transition-colors hover:text-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <ArrowDown className="h-4 w-4" />
            </button>
          )}

          {quoteSel && !readOnly && !aiUnavailable && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={askAboutSelection}
              style={{ top: quoteSel.top, left: quoteSel.left }}
              className="absolute z-20 flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-lg duration-150 animate-in fade-in zoom-in-95"
            >
              <Quote className="h-3.5 w-3.5" />
              {t('reqChatAskSelection')}
            </button>
          )}

          {lastResult && lastResult.requirements_considered > 0 && (
            <div className="px-4 pb-1 text-[11px] text-slate-400">
              {t('reqChatAnsweredFrom', { used: lastResult.requirements_used, considered: lastResult.requirements_considered })}
              {lastResult.retrieval_truncated ? ` · ${t('reqChatTruncated')}` : ''}
              {typeof lastResult.message.prompt_tokens === 'number' ? ` · ${t('toonPromptTokens', { count: lastResult.message.prompt_tokens })}` : ''}
            </div>
          )}

          {showScopeSelector && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200 px-3 pt-2 dark:border-slate-800">
              <span className="text-[11px] font-medium text-slate-400">{t('reqChatScopeLabel')}</span>
              {enabledSources.map((type) => {
                const selected = selectedSources.includes(type);
                return (
                  <button key={type} type="button" disabled={sending} onClick={() => toggleSource(type)} aria-pressed={selected} className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${selected ? 'border-primary bg-primary/10 text-primary' : 'border-slate-300 text-slate-500 hover:border-primary/40 dark:border-slate-600 dark:text-slate-400'}`}>
                    {t(`aiSource_${type}`)}
                  </button>
                );
              })}
            </div>
          )}
          {readOnly ? (
            <div className="border-t border-slate-200 p-3 text-center text-xs text-slate-400 dark:border-slate-800">
              {t('reqChatReadOnlyHint')}
            </div>
          ) : (
            <>
              <div className={`flex items-end gap-2 p-3 ${showScopeSelector ? '' : 'border-t'} border-slate-200 dark:border-slate-800`}>
                <Textarea
                  ref={textareaRef}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(question); } }}
                  placeholder={placeholder}
                  disabled={sending || aiUnavailable}
                  rows={2}
                  maxLength={2000}
                  className="min-h-[44px] resize-none"
                />
                {sending ? (
                  <Button type="button" variant="outline" onClick={handleStop} className="shrink-0" title={t('reqChatStop')} aria-label={t('reqChatStop')}>
                    <Square className="h-4 w-4 fill-current" />
                  </Button>
                ) : (
                  <Button type="button" onClick={() => submit(question)} disabled={aiUnavailable || !question.trim()} className="shrink-0 transition-transform active:scale-95" title={t('reqChatSend')} aria-label={t('reqChatSend')}>
                    <Send className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {askScopes.length > 0 && variant === 'page' && (
                <div className="px-4 pb-2 text-[10px] text-slate-400">
                  {t('reqChatScopeLabel')} {askScopes.map((s) => t(`aiSource_${s}`)).join(' · ')}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
