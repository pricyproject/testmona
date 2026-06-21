import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle, Archive, ArchiveRestore, ArrowDown, Check, Copy, Download, Globe, Link2, Lock,
  MessageSquarePlus, Pencil, Quote, RefreshCw, Search, Send, Sparkles, Square, Trash2, Wand2,
  Pin, PinOff, Save, X, Users, ShieldCheck, ExternalLink, FilePlus2, ListPlus, Bug,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { useDateFormat } from '@/hooks/useDateFormat';
import { DateField } from '@/components/ui/DateField';
import { aiManagerAPI, AIManagerStatus, AISourceType, projectAssignmentsAPI, requirementChatAPI } from '@/lib/api';
import { RequirementChatAskResponse, RequirementChatConversation, RequirementChatMessage } from '@/types';
import { useProjectStore } from '@/stores/projectStore';
import { isFeatureEnabled } from '@/lib/projectFeatures';

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
const SOURCE_TYPES: AISourceType[] = ['requirements', 'defects', 'test_plans', 'test_cases'];

// Ask AI source type -> the project feature toggle that gates it. A source whose
// entity module is disabled for the project is hidden from the scope selector
// (the backend also refuses to retrieve from it). Mirrors Advanced Search.
const SOURCE_FEATURE: Record<string, string> = {
  requirements: 'requirements',
  defects: 'defects',
  test_plans: 'test_plans',
  test_cases: 'test_cases',
  docs: 'doc_hub',
};

interface ProjectMemberOption {
  user_id: number;
  username: string;
  email?: string | null;
  full_name?: string | null;
}

const tomorrowDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

export function RequirementChat({
  projectId, scopeMode, variant, active, initialPublicId, onClose, headerActions,
}: RequirementChatProps) {
  const { t, isRTL } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [conversations, setConversations] = useState<RequirementChatConversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<RequirementChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [aiStatus, setAiStatus] = useState<AIManagerStatus | null>(null);
  const [aiStatusLoading, setAiStatusLoading] = useState(false);
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
  const [deleteTarget, setDeleteTarget] = useState<RequirementChatConversation | null>(null);
  const [shareTarget, setShareTarget] = useState<RequirementChatConversation | null>(null);
  const [shareScope, setShareScopeState] = useState<'project' | 'restricted'>('project');
  const [shareExpiry, setShareExpiry] = useState('');
  const [shareRecipients, setShareRecipients] = useState<number[]>([]);
  const [projectMembers, setProjectMembers] = useState<ProjectMemberOption[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const deepLinkRef = useRef<string | null>(initialPublicId ?? null);

  // Restrict the admin-enabled sources to entity modules that are enabled for
  // this project, so disabled features never appear as a selectable scope.
  const projects = useProjectStore((s) => s.projects);
  const projectFeatures = useMemo(
    () => projects.find((p) => p.id === projectId)?.features,
    [projects, projectId],
  );
  const adminEnabled = useMemo(
    () => (aiStatus?.requirement_chat_source_types ?? []).filter(
      (s) => isFeatureEnabled(projectFeatures, SOURCE_FEATURE[s] ?? s),
    ),
    [aiStatus, projectFeatures],
  );
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

  const loadConversations = (archived: boolean) => {
    setConversationsLoading(true);
    return requirementChatAPI.listConversations(projectId, archived)
      .then((data) => setConversations(data))
      .catch(() => { /* non-critical */ })
      .finally(() => setConversationsLoading(false));
  };

  useEffect(() => {
    if (!active) return;
    loadConversations(showArchived);
    setAiStatusLoading(true);
    aiManagerAPI.getStatus()
      .then(setAiStatus)
      .catch(() => setAiStatus({ active_provider: 'openai', available: false, reason: 'active_provider_not_configured' }))
      .finally(() => setAiStatusLoading(false));
  }, [active, projectId, showArchived]);

  useEffect(() => {
    if (!active) return;
    setMembersLoading(true);
    projectAssignmentsAPI.listMembers(projectId)
      .then((members) => setProjectMembers((members as ProjectMemberOption[]).filter((m) => !!m.user_id)))
      .catch(() => setProjectMembers([]))
      .finally(() => setMembersLoading(false));
  }, [active, projectId]);

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

  // Auto-grow the composer with its content, capped so it never eats the
  // conversation. Runs on reset to '' too, snapping back to one row.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [question]);

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
  const selectedScopeLabels = askScopes.map((s) => t(`aiSource_${s}`));
  const starterPrompts = useMemo(() => {
    if (scopeMode === 'requirements' || askScopes.length === 0 || askScopes.includes('requirements')) {
      return STARTER_KEYS.map((key) => t(key));
    }
    if (askScopes.includes('defects')) {
      return [t('reqChatStarterDefects1'), t('reqChatStarterDefects2'), t('reqChatStarterDefects3')];
    }
    if (askScopes.includes('test_plans')) {
      return [t('reqChatStarterPlans1'), t('reqChatStarterPlans2'), t('reqChatStarterPlans3')];
    }
    return [t('reqChatStarterCases1'), t('reqChatStarterCases2'), t('reqChatStarterCases3')];
  }, [askScopes.join(','), scopeMode, t]);

  const sourceCountSummary = (counts?: Record<string, number>) => SOURCE_TYPES
    .filter((type) => (counts?.[type] || 0) > 0)
    .map((type) => `${t(`aiSource_${type}`)} ${counts?.[type] || 0}`)
    .join(' · ');

  const memberLabel = (member: ProjectMemberOption) =>
    member.full_name || member.username || member.email || `#${member.user_id}`;

  const aiUnavailableDescription = () => {
    if (featureDisabled) return t('reqChatDisabled');
    if (aiStatusLoading) return t('reqChatCheckingStatus');
    if (aiStatus?.reason === 'token_missing') return t('reqChatTokenMissingDesc');
    if (aiStatus?.reason === 'active_provider_disabled') return t('reqChatProviderDisabledDesc');
    return t('reqChatProviderMissingDesc');
  };

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

  const copySharedLink = (conv: RequirementChatConversation) => {
    if (conv.share_scope === 'private') {
      openShareDialog(conv);
      toast({ title: t('reqChatPrivateLinkTitle'), description: t('reqChatPrivateLinkDesc') });
      return;
    }
    copyLink(conv.public_id);
  };

  const openShareDialog = (conv: RequirementChatConversation) => {
    setShareTarget(conv);
    setShareScopeState(conv.share_scope === 'restricted' ? 'restricted' : 'project');
    setShareExpiry(conv.share_expires_at ? conv.share_expires_at.slice(0, 10) : '');
    setShareRecipients(conv.share_allowed_user_ids || []);
  };

  const saveShareSettings = async () => {
    if (!shareTarget) return;
    if (shareScope === 'restricted' && shareRecipients.length === 0) {
      toast({ title: t('error'), description: t('reqChatRestrictedRecipientsRequired'), variant: 'destructive' });
      return;
    }
    setSharingId(shareTarget.id);
    try {
      const updated = await requirementChatAPI.updateConversation(projectId, shareTarget.id, {
        share_scope: shareScope,
        share_expires_at: shareExpiry ? new Date(`${shareExpiry}T23:59:59`).toISOString() : null,
        share_allowed_user_ids: shareScope === 'restricted' ? shareRecipients : [],
      });
      setConversations((cur) => cur.map((c) => (c.id === shareTarget.id ? { ...c, ...updated } : c)));
      setActiveConvObj((cur) => (cur && cur.id === shareTarget.id ? { ...cur, ...updated } : cur));
      setShareTarget(null);
      copyLink(updated.public_id || shareTarget.public_id);
    } catch (error: any) {
      toast({ title: t('error'), description: error.response?.data?.detail || t('reqChatShareFailed'), variant: 'destructive' });
    } finally {
      setSharingId(null);
    }
  };

  const revokeShare = async (conv: RequirementChatConversation) => {
    setSharingId(conv.id);
    try {
      const updated = await requirementChatAPI.updateConversation(projectId, conv.id, {
        share_scope: 'private',
        share_expires_at: null,
        share_allowed_user_ids: [],
      });
      setConversations((cur) => cur.map((c) => (c.id === conv.id ? { ...c, ...updated } : c)));
      setActiveConvObj((cur) => (cur && cur.id === conv.id ? { ...cur, ...updated } : cur));
      setShareTarget(null);
    } catch (error: any) {
      toast({ title: t('error'), description: error.response?.data?.detail || t('reqChatShareFailed'), variant: 'destructive' });
    } finally {
      setSharingId(null);
    }
  };

  const togglePinned = async (conv: RequirementChatConversation) => {
    if (sending) return;
    try {
      const updated = await requirementChatAPI.updateConversation(projectId, conv.id, { pinned: !conv.pinned });
      setConversations((cur) => cur.map((c) => (c.id === conv.id ? { ...c, ...updated } : c)));
      setActiveConvObj((cur) => (cur && cur.id === conv.id ? { ...cur, ...updated } : cur));
    } catch {
      toast({ title: t('error'), description: t('reqChatPinFailed'), variant: 'destructive' });
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
    } finally {
      setDeleteTarget(null);
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
  const cancelRename = () => {
    setEditingId(null);
    setEditingTitle('');
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

  // Per-type display metadata for a cited source: the icon shown on the chip,
  // the scope key for its label, and the honest "open" verb. The chip itself is
  // the action (clicking it navigates via sourceHref), so there is no separate
  // mislabeled secondary button.
  const sourceMeta = (type?: string) => {
    switch (type) {
      case 'defect':
        return { icon: Bug, scope: 'defects' as AISourceType, openLabel: t('reqChatOpenDefect') };
      case 'test_plan':
        return { icon: ListPlus, scope: 'test_plans' as AISourceType, openLabel: t('reqChatOpenTestPlan') };
      case 'test_case':
        return { icon: ExternalLink, scope: 'test_cases' as AISourceType, openLabel: t('reqChatOpenTestCase') };
      default:
        return { icon: FilePlus2, scope: 'requirements' as AISourceType, openLabel: t('reqChatOpenRequirement') };
    }
  };

  const fmtTime = (iso: string) =>
    formatDateTime(iso, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const featureDisabled = aiStatus !== null && aiStatus.requirement_chat_enabled === false;
  const aiUnavailable = aiStatus !== null && (!aiStatus.available || featureDisabled);

  return (
    <>
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
        <aside className="hidden w-72 shrink-0 flex-col border-e border-slate-200 dark:border-slate-800 lg:w-80 sm:flex">
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
            {conversationsLoading ? (
              <div className="space-y-2 px-1 py-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-8 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
                ))}
              </div>
            ) : filteredConversations.length === 0 ? (
              <p className="px-2 py-3 text-xs text-slate-400">
                {search.trim() ? t('reqChatNoSearchResults') : showArchived ? t('reqChatNoArchived') : t('reqChatNoConversations')}
              </p>
            ) : filteredConversations.map((c) => (
              <div
                key={c.id}
                className={`group rounded-md px-2 py-2 text-sm ${activeId === c.id ? 'bg-primary/10 text-primary' : 'hover:bg-slate-50 dark:hover:bg-slate-900'}`}
              >
                <button type="button" className="flex w-full min-w-0 items-center gap-1 text-start" onClick={() => openConversation(c.id)} title={c.title}>
                  {c.pinned && <Pin className="h-3 w-3 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
                  {c.share_scope !== 'private' && <Globe className="h-3 w-3 shrink-0 text-emerald-500" />}
                  {c.archived && <Archive className="h-3 w-3 shrink-0 text-amber-500" />}
                </button>
                <div className="mt-1.5 flex shrink-0 items-center justify-end gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  <button type="button" className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-primary dark:hover:bg-slate-800" onClick={() => togglePinned(c)} aria-label={c.pinned ? t('reqChatUnpin') : t('reqChatPin')} title={c.pinned ? t('reqChatUnpin') : t('reqChatPin')}>
                    {c.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                  </button>
                  <button type="button" className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-primary dark:hover:bg-slate-800" onClick={() => copySharedLink(c)} aria-label={t('reqChatCopyLink')} title={linkedId === c.public_id ? t('reqChatLinkCopied') : c.share_scope === 'private' ? t('reqChatShareOff') : t('reqChatCopyLink')}>
                    {linkedId === c.public_id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Link2 className="h-3.5 w-3.5" />}
                  </button>
                  <button type="button" className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-950/30" onClick={() => handleArchiveToggle(c)} aria-label={c.archived ? t('reqChatUnarchive') : t('reqChatArchive')} title={c.archived ? t('reqChatUnarchive') : t('reqChatArchive')}>
                    {c.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                  </button>
                  <button type="button" className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/30" onClick={() => setDeleteTarget(c)} aria-label={t('delete')} title={t('delete')}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Conversation */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="border-b border-slate-200 p-2 dark:border-slate-800 sm:hidden">
            <div className="mb-2 flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="flex-1 justify-start" onClick={startNewConversation}>
                <MessageSquarePlus className="me-2 h-4 w-4" />
                {t('reqChatNew')}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={toggleArchivedView}>
                {showArchived ? t('reqChatShowActive') : t('reqChatShowArchived')}
              </Button>
            </div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('reqChatSearch')}
              className="mb-2 h-8 text-xs"
            />
            <div className="flex gap-2 overflow-x-auto pb-1">
              {conversationsLoading ? [0, 1, 2].map((i) => (
                <div key={i} className="h-8 w-32 shrink-0 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
              )) : filteredConversations.length === 0 ? (
                <span className="px-1 text-xs text-slate-400">
                  {showArchived ? t('reqChatNoArchived') : t('reqChatNoConversations')}
                </span>
              ) : filteredConversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => openConversation(c.id)}
                  className={`flex w-56 max-w-[78vw] shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs ${activeId === c.id ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}
                  title={c.title}
                >
                  {c.pinned && <Pin className="h-3 w-3 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate text-start">{c.title}</span>
                  {c.share_scope !== 'private' && <Globe className="h-3 w-3 shrink-0 text-emerald-500" />}
                  {c.archived && <Archive className="h-3 w-3 shrink-0 text-amber-500" />}
                </button>
              ))}
            </div>
          </div>
          {activeConversation && (
            <div className="flex flex-col gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800/60 sm:flex-row sm:items-start sm:justify-between sm:px-4">
              <div className="min-w-0 flex-1">
                {editingId === activeConversation.id && !readOnly ? (
                  <div className="flex w-full min-w-0 items-center gap-1 sm:max-w-md">
                    <Input
                      autoFocus
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitRename(); } if (e.key === 'Escape') cancelRename(); }}
                      maxLength={255}
                      className="h-8 min-w-0 flex-1 px-2 py-0 text-sm"
                    />
                    <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-emerald-600 hover:bg-emerald-50" onClick={commitRename} aria-label={t('save')} title={t('save')}>
                      <Save className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100" onClick={cancelRename} aria-label={t('cancel')} title={t('cancel')}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-200" title={activeConversation.title}>{activeConversation.title}</span>
                    {!readOnly && (
                      <button type="button" className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" onClick={() => beginRename(activeConversation)} aria-label={t('reqChatRename')} title={t('reqChatRename')}>
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
                {(readOnly || (!readOnly && activeConversation.archived)) && (
                  <div className="mt-1 flex flex-wrap gap-1">
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
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                {!readOnly && (
                  <button type="button" disabled={sending} onClick={() => togglePinned(activeConversation)} className="inline-flex h-8 items-center justify-center gap-1 rounded px-2 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200" title={activeConversation.pinned ? t('reqChatUnpin') : t('reqChatPin')}>
                    {activeConversation.pinned ? <PinOff className="h-3.5 w-3.5 shrink-0" /> : <Pin className="h-3.5 w-3.5 shrink-0" />}
                    <span className="hidden xl:inline">{activeConversation.pinned ? t('reqChatUnpin') : t('reqChatPin')}</span>
                  </button>
                )}
                {!readOnly && (
                  <button
                    type="button"
                    disabled={sharingId === activeConversation.id}
                    onClick={() => activeConversation.share_scope === 'private' ? openShareDialog(activeConversation) : revokeShare(activeConversation)}
                    className={`inline-flex h-8 items-center justify-center gap-1 rounded px-2 text-xs disabled:opacity-50 ${activeConversation.share_scope === 'project' ? 'text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200'}`}
                    title={activeConversation.share_scope === 'private' ? t('reqChatShareOff') : t('reqChatRevokeShare')}
                  >
                    {activeConversation.share_scope === 'private' ? <Lock className="h-3.5 w-3.5 shrink-0" /> : activeConversation.share_scope === 'restricted' ? <Users className="h-3.5 w-3.5 shrink-0" /> : <Globe className="h-3.5 w-3.5 shrink-0" />}
                    <span className="hidden xl:inline">{activeConversation.share_scope === 'private' ? t('reqChatShare') : t('reqChatRevoke')}</span>
                  </button>
                )}
                {!readOnly && (
                  <button type="button" disabled={sending || messages.length === 0} onClick={handleRegenerate} className="inline-flex h-8 items-center justify-center gap-1 rounded px-2 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200" title={t('reqChatRegenerate')}>
                    <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                    <span className="hidden xl:inline">{t('reqChatRegenerate')}</span>
                  </button>
                )}
                <button type="button" onClick={() => copySharedLink(activeConversation)} className="inline-flex h-8 items-center justify-center gap-1 rounded px-2 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" title={activeConversation.share_scope === 'private' ? t('reqChatShareOff') : t('reqChatCopyLink')}>
                  {linkedId === activeConversation.public_id ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> : <Link2 className="h-3.5 w-3.5 shrink-0" />}
                  <span className="hidden xl:inline">{linkedId === activeConversation.public_id ? t('reqChatLinkCopied') : t('reqChatCopyLink')}</span>
                </button>
                <button type="button" disabled={messages.length === 0} onClick={handleExport} className="inline-flex h-8 items-center justify-center gap-1 rounded px-2 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200" title={t('reqChatExport')}>
                  <Download className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden xl:inline">{t('reqChatExport')}</span>
                </button>
              </div>
            </div>
          )}

          {aiStatusLoading && (
            <div className="m-3 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
              <div className="h-4 w-4 animate-pulse rounded-full bg-slate-300 dark:bg-slate-700" />
              <div className="h-4 w-64 max-w-full animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
            </div>
          )}

          {aiUnavailable && !aiStatusLoading && (
            <div className="m-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{featureDisabled ? t('reqChatDisabled') : t('reqChatUnavailable')}</div>
                <div className="mt-0.5 text-xs">{aiUnavailableDescription()}</div>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => navigate('/settings')}>
                <ShieldCheck className="me-1.5 h-4 w-4" />
                {t('reqChatOpenSettings')}
              </Button>
            </div>
          )}

          <div ref={scrollRef} onScroll={onScroll} onMouseUp={captureSelection} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {messages.length === 0 && !sending ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Sparkles className="h-6 w-6" />
                </span>
                <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
                  {scopeMode === 'all'
                    ? t('reqChatEmptyStateProject', { scopes: selectedScopeLabels.join(', ') || t('reqChatSelectedSources') })
                    : t('reqChatEmptyState')}
                </p>
                {!aiUnavailable && (
                  <div className="flex max-w-md flex-wrap justify-center gap-2">
                    {starterPrompts.map((prompt) => (
                      <button key={prompt} type="button" onClick={() => submit(prompt)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition-colors hover:border-primary/40 hover:text-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                        {prompt}
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
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {m.sources.map((s, i) => {
                        const href = sourceHref(s);
                        const meta = sourceMeta(s.type);
                        const TypeIcon = meta.icon;
                        return (
                          <span key={`${s.key}-${i}`} className="group/source relative inline-flex">
                            <button
                              type="button"
                              disabled={!href}
                              onClick={() => { if (href) { onClose?.(); navigate(href); } }}
                              className="inline-flex items-center gap-1 rounded-md bg-white/70 px-1.5 py-0.5 text-[11px] font-medium text-primary ring-1 ring-inset ring-primary/20 transition-all duration-150 hover:-translate-y-0.5 hover:bg-white hover:shadow-sm disabled:cursor-default disabled:opacity-70 dark:bg-slate-900/60"
                              title={href ? meta.openLabel : s.title}
                            >
                              <TypeIcon className="h-3 w-3" />
                              {s.key}
                            </button>
                            {/* Hover preview — type, title, content excerpt, and the open hint. */}
                            <div className={`pointer-events-none absolute bottom-full z-30 mb-2 hidden w-72 rounded-lg border border-slate-200 bg-white p-3 text-start shadow-xl group-hover/source:block dark:border-slate-700 dark:bg-slate-900 ${isRTL ? 'right-0' : 'left-0'}`}>
                              <div className="mb-1.5 flex items-center gap-1.5">
                                <span className="inline-flex shrink-0 items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                  <TypeIcon className="h-3 w-3" />
                                  {t(`aiSource_${meta.scope}`)}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{s.title}</span>
                              </div>
                              {s.excerpt ? (
                                <p className="line-clamp-4 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{s.excerpt}</p>
                              ) : (
                                <p className="text-xs italic text-slate-400">{t('reqChatNoSourcePreview')}</p>
                              )}
                              {href && (
                                <div className="mt-2 flex items-center gap-1 border-t border-slate-100 pt-1.5 text-[11px] font-medium text-primary dark:border-slate-800">
                                  <ExternalLink className="h-3 w-3" />
                                  {meta.openLabel}
                                </div>
                              )}
                            </div>
                          </span>
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
            <button type="button" onClick={scrollToBottom} aria-label={t('reqChatScrollBottom')} title={t('reqChatScrollBottom')} className={`absolute bottom-28 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-md transition-colors hover:text-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 ${isRTL ? 'left-4' : 'right-4'}`}>
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

          {lastResult && (lastResult.items_considered ?? lastResult.requirements_considered) > 0 && (
            <div className="space-y-1 px-4 pb-1 text-[11px] text-slate-400">
              <div>
                {t('reqChatAnsweredFromItems', { used: lastResult.items_used ?? lastResult.requirements_used, considered: lastResult.items_considered ?? lastResult.requirements_considered })}
                {lastResult.confidence ? ` · ${t(`reqChatConfidence_${lastResult.confidence}`)}` : ''}
                {lastResult.retrieval_truncated ? ` · ${t('reqChatTruncated')}` : ''}
                {typeof lastResult.message.prompt_tokens === 'number' ? ` · ${t('toonPromptTokens', { count: lastResult.message.prompt_tokens })}` : ''}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {sourceCountSummary(lastResult.source_counts) && <span>{t('reqChatSearchedSources')}: {sourceCountSummary(lastResult.source_counts)}</span>}
                {sourceCountSummary(lastResult.selected_source_counts) && <span>{t('reqChatUsedSources')}: {sourceCountSummary(lastResult.selected_source_counts)}</span>}
              </div>
              {lastResult.coverage_note && (
                <div className={lastResult.insufficient_context ? 'text-amber-600 dark:text-amber-300' : ''}>
                  {lastResult.coverage_note}
                </div>
              )}
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
              <div className={`p-3 ${showScopeSelector ? '' : 'border-t'} border-slate-200 dark:border-slate-800`}>
                {/* Unified composer: the textarea and send/stop control share one
                    rounded, focus-highlighted surface so the button reads as part
                    of the field rather than a detached element. */}
                <div className={`flex items-end gap-2 rounded-2xl border border-slate-300 bg-white px-3 py-2 shadow-sm transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 ${aiUnavailable ? 'opacity-60' : ''}`}>
                  <Textarea
                    ref={textareaRef}
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(question); } }}
                    placeholder={placeholder}
                    disabled={sending || aiUnavailable}
                    rows={1}
                    maxLength={2000}
                    className="max-h-40 min-h-[28px] flex-1 resize-none border-0 bg-transparent px-0 py-1 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  {sending ? (
                    <Button type="button" variant="outline" size="icon" onClick={handleStop} className="h-9 w-9 shrink-0 rounded-xl" title={t('reqChatStop')} aria-label={t('reqChatStop')}>
                      <Square className="h-4 w-4 fill-current" />
                    </Button>
                  ) : (
                    <Button type="button" size="icon" onClick={() => submit(question)} disabled={aiUnavailable || !question.trim()} className="h-9 w-9 shrink-0 rounded-xl transition-transform active:scale-95" title={t('reqChatSend')} aria-label={t('reqChatSend')}>
                      <Send className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-2 px-1 text-[10px] text-slate-400">
                  {variant === 'page' && askScopes.length > 0 ? (
                    <span className="min-w-0 truncate">{t('reqChatScopeLabel')} {askScopes.map((s) => t(`aiSource_${s}`)).join(' · ')}</span>
                  ) : (
                    <span className="hidden min-w-0 truncate sm:inline">{t('reqChatComposerHint')}</span>
                  )}
                  <span className={`ms-auto shrink-0 tabular-nums ${question.length >= 2000 ? 'text-red-500' : ''}`}>{question.length}/2000</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
    <Dialog open={!!shareTarget} onOpenChange={(open) => { if (!open) setShareTarget(null); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('reqChatShareManageTitle')}</DialogTitle>
          <DialogDescription>{t('reqChatShareManageDesc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setShareScopeState('project')} className={`rounded-md border p-3 text-start text-sm ${shareScope === 'project' ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 dark:border-slate-700'}`}>
              <Globe className="mb-2 h-4 w-4" />
              <div className="font-medium">{t('reqChatShareProject')}</div>
              <div className="mt-1 text-xs text-slate-500">{t('reqChatShareProjectDesc')}</div>
            </button>
            <button type="button" onClick={() => setShareScopeState('restricted')} className={`rounded-md border p-3 text-start text-sm ${shareScope === 'restricted' ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 dark:border-slate-700'}`}>
              <Users className="mb-2 h-4 w-4" />
              <div className="font-medium">{t('reqChatShareRestricted')}</div>
              <div className="mt-1 text-xs text-slate-500">{t('reqChatShareRestrictedDesc')}</div>
            </button>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">{t('reqChatShareExpiry')}</label>
            <DateField min={tomorrowDate()} value={shareExpiry} onChange={setShareExpiry} />
          </div>
          {shareScope === 'restricted' && (
            <div>
              <div className="mb-2 text-xs font-medium text-slate-500">{t('reqChatShareRecipients')}</div>
              <div className="max-h-44 space-y-2 overflow-y-auto rounded-md border border-slate-200 p-2 dark:border-slate-700">
                {membersLoading ? (
                  <div className="h-8 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                ) : projectMembers.length === 0 ? (
                  <div className="text-xs text-slate-400">{t('reqChatNoShareRecipients')}</div>
                ) : projectMembers.map((member) => (
                  <label key={member.user_id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                    <Checkbox
                      checked={shareRecipients.includes(member.user_id)}
                      onCheckedChange={(checked) => setShareRecipients((cur) => checked ? [...cur, member.user_id] : cur.filter((id) => id !== member.user_id))}
                    />
                    <span className="min-w-0 flex-1 truncate">{memberLabel(member)}</span>
                    {member.email && <span className="hidden truncate text-xs text-slate-400 sm:inline">{member.email}</span>}
                  </label>
                ))}
              </div>
            </div>
          )}
          {shareTarget && shareTarget.share_scope !== 'private' && (
            <Button type="button" variant="outline" onClick={() => shareTarget && copyLink(shareTarget.public_id)}>
              <Link2 className="me-1.5 h-4 w-4" />
              {linkedId === shareTarget.public_id ? t('reqChatLinkCopied') : t('reqChatCopyLink')}
            </Button>
          )}
        </div>
        <DialogFooter>
          {shareTarget && shareTarget.share_scope !== 'private' && (
            <Button type="button" variant="outline" onClick={() => shareTarget && revokeShare(shareTarget)} disabled={sharingId === shareTarget?.id}>
              {t('reqChatRevokeShare')}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setShareTarget(null)}>{t('cancel')}</Button>
          <Button type="button" onClick={saveShareSettings} disabled={sharingId === shareTarget?.id}>
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('reqChatDeleteConfirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('reqChatDeleteConfirmDesc', { title: deleteTarget?.title || t('reqChatTitle') })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => deleteTarget && handleDelete(deleteTarget.id)}>
            {t('delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
