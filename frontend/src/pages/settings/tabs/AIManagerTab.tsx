// AI Manager tab (admin-only): provider configuration, model routing, usage
// budgets and recent-action audit. Extracted from the SettingsPage monolith
// into a self-contained module. Parent gates rendering on admin.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { BrainCircuit, KeyRound, PlayCircle, ChevronDown, CornerDownRight, BookText, Loader2, RefreshCw, Trash2, TrendingUp } from 'lucide-react';
import {
  aiManagerAPI, AIManagerSettings, AIProviderConfig, AIProviderName, AIUsageLimitEntry,
  AIUsageSummary, AISourceType, AIRoutingSettings, AIRoutingTarget,
} from '@/lib/api';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';

const defaultAIProviders: AIProviderConfig[] = [
  { provider: 'openai', enabled: false, model: 'gpt-4o-mini', base_url: 'https://api.openai.com/v1', request_timeout_seconds: 60, monthly_token_limit: null },
  { provider: 'openrouter', enabled: false, model: 'openai/gpt-4o-mini', base_url: 'https://openrouter.ai/api/v1', request_timeout_seconds: 60, monthly_token_limit: null },
  { provider: 'anthropic', enabled: false, model: 'claude-3-5-haiku-latest', base_url: 'https://api.anthropic.com/v1', request_timeout_seconds: 60, monthly_token_limit: null },
  { provider: 'huggingface', enabled: false, model: 'openai/gpt-oss-20b', base_url: 'https://router.huggingface.co/v1', request_timeout_seconds: 60, monthly_token_limit: null },
  { provider: 'litellm', enabled: false, model: 'gpt-4o-mini', base_url: 'http://localhost:4000/v1', request_timeout_seconds: 60, monthly_token_limit: null },
];

const normalizeMonthlyTokenLimit = (value: unknown): number | null => {
  if (value === '' || value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : null;
};

const defaultRequirementChatSettings = {
  enabled: true,
  max_context_requirements: 40,
  history_turns: 6,
  source_types: ['requirements'] as AISourceType[],
};

const defaultRoutingSettings: AIRoutingSettings = {
  qa: { provider: null, model: null },
  generation: { provider: null, model: null },
  assistant: { provider: null, model: null },
  docs: { provider: null, model: null },
  doc_impact: { provider: null, model: null },
  doc_release_notes: { provider: null, model: null },
  doc_convert: { provider: null, model: null },
};

const defaultAIManagerSettings: AIManagerSettings = {
  active_provider: 'openai',
  per_project_monthly_token_limit: null,
  requirement_chat: defaultRequirementChatSettings,
  system_prompt: '',
  compact_payload_default: true,
  test_case_generation: { default_count: 5, max_tokens: 3000 },
  routing: defaultRoutingSettings,
  fallback: { enabled: false, order: [] },
  providers: defaultAIProviders,
};

const AI_SOURCE_TYPES: AISourceType[] = ['requirements', 'defects', 'test_plans', 'test_cases', 'docs'];
const AI_ROUTING_TASKS: Array<keyof AIRoutingSettings> = ['qa', 'generation', 'assistant'];
const AI_DOC_ROUTING_SUBTASKS: Array<keyof AIRoutingSettings> = ['doc_impact', 'doc_release_notes', 'doc_convert'];

const aiProviderLabels: Record<AIProviderName, string> = {
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  anthropic: 'Claude',
  huggingface: 'Hugging Face',
  litellm: 'LiteLLM',
};

const aiOperationLabel = (operation: string, t: (k: string) => string): string => {
  if (operation === 'requirement_project_qa') return t('opRequirementQa');
  if (operation === 'requirement_test_case_generation') return t('opTestCaseGeneration');
  if (operation.startsWith('test_case_assistant') || operation.startsWith('test_case_draft_assistant')) return t('opTestCaseAssistant');
  if (operation === 'doc_change_impact') return t('opDocChangeImpact');
  if (operation === 'doc_release_notes') return t('opDocReleaseNotes');
  if (operation === 'doc_convert_enhance') return t('opDocConvertEnhance');
  if (operation === 'connection_test') return t('opConnectionTest');
  if (operation === 'completion') return t('opCompletion');
  return operation;
};

const aggregateAISpend = (
  rows: Array<{ operation: string; requests: number; failures: number; total_tokens: number }>,
  t: (k: string) => string,
): Array<{ label: string; requests: number; failures: number; total_tokens: number }> => {
  const map = new Map<string, { label: string; requests: number; failures: number; total_tokens: number }>();
  for (const row of rows) {
    const label = aiOperationLabel(row.operation, t);
    const entry = map.get(label) || { label, requests: 0, failures: 0, total_tokens: 0 };
    entry.requests += row.requests || 0;
    entry.failures += row.failures || 0;
    entry.total_tokens += row.total_tokens || 0;
    map.set(label, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.total_tokens - a.total_tokens);
};

function AIRoutingRow({
  label, target, providers, inheritLabel, indented = false, onChange, t,
}: {
  label: string;
  target: AIRoutingTarget;
  providers: AIProviderConfig[];
  inheritLabel: string;
  indented?: boolean;
  onChange: (next: AIRoutingTarget) => void;
  t: (k: string) => string;
}) {
  return (
    <div className={`grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)_minmax(0,1fr)] sm:items-center ${indented ? 'sm:ps-5' : ''}`}>
      <Label className="flex items-center gap-1.5 text-sm">
        {indented && <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        {label}
      </Label>
      <Select
        value={target.provider ?? 'inherit'}
        onValueChange={(value) => onChange(value === 'inherit'
          ? { provider: null, model: null }
          : { provider: value as AIProviderName, model: target.model })}
      >
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="inherit">{inheritLabel}</SelectItem>
          {providers.map((p) => (
            <SelectItem key={p.provider} value={p.provider}>{aiProviderLabels[p.provider]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={target.model ?? ''}
        disabled={!target.provider}
        placeholder={t('aiRoutingModelPlaceholder')}
        onChange={(event) => onChange({ provider: target.provider, model: event.target.value || null })}
      />
    </div>
  );
}

export function AIManagerTab() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [aiManagerSettings, setAIManagerSettings] = useState<AIManagerSettings>(defaultAIManagerSettings);
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});
  const [routingExpanded, setRoutingExpanded] = useState(false);
  const [docRoutingExpanded, setDocRoutingExpanded] = useState(false);
  const [aiUsage, setAIUsage] = useState<AIUsageSummary | null>(null);
  const [loadingAIManager, setLoadingAIManager] = useState(false);
  const [savingAIManager, setSavingAIManager] = useState(false);
  const [resettingAIUsage, setResettingAIUsage] = useState(false);
  const [clearingAIRecentActions, setClearingAIRecentActions] = useState(false);
  const [testingAIProvider, setTestingAIProvider] = useState<AIProviderName | null>(null);
  const [aiTestPrompt, setAITestPrompt] = useState('Reply with exactly: TestMona AI is ready.');
  const [aiTestResult, setAITestResult] = useState<any>(null);
  const [aiActionStatusFilter, setAIActionStatusFilter] = useState('all');
  const [aiActionProviderFilter, setAIActionProviderFilter] = useState('all');
  const [aiActionPage, setAIActionPage] = useState(1);
  const [resetAIUsageConfirmOpen, setResetAIUsageConfirmOpen] = useState(false);
  const [clearAIRecentActionsConfirmOpen, setClearAIRecentActionsConfirmOpen] = useState(false);

  const showSuccessToast = (description: string) => toast({ title: t('success'), description });
  const showErrorToast = (description: string) => toast({ title: t('error'), description, variant: 'destructive' });
  const getErrorDetail = (error: unknown, fallback: string): string => {
    const apiError = error as any;
    const detail = apiError?.response?.data?.detail;
    if (Array.isArray(detail)) {
      const messages = detail.map((item) => (typeof item === 'string' ? item : item?.msg ? String(item.msg) : '')).filter(Boolean);
      if (messages.length) return messages.join(', ');
    }
    return (typeof detail === 'string' && detail) || apiError?.message || fallback;
  };

  const loadAIManager = async () => {
    setLoadingAIManager(true);
    try {
      const [settings, usage] = await Promise.all([aiManagerAPI.getSettings(), aiManagerAPI.getUsage()]);
      setAIManagerSettings({
        active_provider: settings.active_provider,
        per_project_monthly_token_limit: settings.per_project_monthly_token_limit ?? null,
        requirement_chat: settings.requirement_chat ?? defaultRequirementChatSettings,
        system_prompt: settings.system_prompt ?? '',
        compact_payload_default: settings.compact_payload_default ?? true,
        test_case_generation: settings.test_case_generation ?? defaultAIManagerSettings.test_case_generation,
        routing: settings.routing ?? defaultRoutingSettings,
        fallback: settings.fallback ?? { enabled: false, order: [] },
        providers: defaultAIProviders.map((defaults) => ({
          ...defaults,
          ...(settings.providers.find((provider) => provider.provider === defaults.provider) || {}),
          api_key: '',
        })),
      });
      setAIUsage(usage);
    } catch (error) {
      console.error('Failed to load AI manager:', error);
      showErrorToast(getErrorDetail(error, t('failedToLoadAIManager')));
    } finally {
      setLoadingAIManager(false);
    }
  };

  useEffect(() => { loadAIManager(); }, []);
  useEffect(() => { setAIActionPage(1); }, [aiActionStatusFilter, aiActionProviderFilter]);

  const updateAIProvider = (providerName: AIProviderName, updates: Partial<AIProviderConfig>) => {
    setAIManagerSettings((current) => ({
      ...current,
      providers: current.providers.map((provider) =>
        provider.provider === providerName ? { ...provider, ...updates } : provider),
    }));
  };

  const handleSaveAIManager = async () => {
    setSavingAIManager(true);
    try {
      const payload: AIManagerSettings = {
        active_provider: aiManagerSettings.active_provider,
        per_project_monthly_token_limit: normalizeMonthlyTokenLimit(aiManagerSettings.per_project_monthly_token_limit),
        requirement_chat: aiManagerSettings.requirement_chat ?? defaultRequirementChatSettings,
        system_prompt: aiManagerSettings.system_prompt ?? '',
        compact_payload_default: aiManagerSettings.compact_payload_default ?? true,
        test_case_generation: aiManagerSettings.test_case_generation ?? defaultAIManagerSettings.test_case_generation,
        routing: aiManagerSettings.routing ?? defaultRoutingSettings,
        fallback: aiManagerSettings.fallback ?? { enabled: false, order: [] },
        providers: aiManagerSettings.providers.map((provider) => ({
          ...provider,
          api_key: provider.api_key?.trim() || undefined,
          monthly_token_limit: normalizeMonthlyTokenLimit(provider.monthly_token_limit),
        })),
      };
      const savedSettings = await aiManagerAPI.updateSettings(payload);
      setAIManagerSettings({
        active_provider: savedSettings.active_provider,
        per_project_monthly_token_limit: savedSettings.per_project_monthly_token_limit ?? null,
        requirement_chat: savedSettings.requirement_chat ?? defaultRequirementChatSettings,
        system_prompt: savedSettings.system_prompt ?? '',
        compact_payload_default: savedSettings.compact_payload_default ?? true,
        test_case_generation: savedSettings.test_case_generation ?? defaultAIManagerSettings.test_case_generation,
        routing: savedSettings.routing ?? defaultRoutingSettings,
        fallback: savedSettings.fallback ?? { enabled: false, order: [] },
        providers: defaultAIProviders.map((defaults) => ({
          ...defaults,
          ...(savedSettings.providers.find((provider) => provider.provider === defaults.provider) || {}),
          api_key: '',
        })),
      });
      showSuccessToast(t('aiManagerSaved'));
    } catch (error) {
      console.error('Failed to save AI manager:', error);
      showErrorToast(getErrorDetail(error, t('failedToSaveAIManager')));
    } finally {
      setSavingAIManager(false);
    }
  };

  const handleTestAIProvider = async (provider: AIProviderName) => {
    setTestingAIProvider(provider);
    setAITestResult(null);
    try {
      const result = await aiManagerAPI.testProvider(provider, aiTestPrompt.trim() || undefined);
      setAITestResult(result);
      const usage = await aiManagerAPI.getUsage();
      setAIUsage(usage);
      showSuccessToast(t('aiConnectionTestPassed', { provider: aiProviderLabels[provider] }));
    } catch (error) {
      console.error('AI connection test failed:', error);
      showErrorToast(getErrorDetail(error, t('aiConnectionTestFailed')));
    } finally {
      setTestingAIProvider(null);
    }
  };

  const handleResetAIUsage = async () => {
    setResettingAIUsage(true);
    try {
      const usage = await aiManagerAPI.resetUsage();
      setAIUsage(usage);
      setAIActionPage(1);
      showSuccessToast(t('aiUsageResetSuccess'));
    } catch (error) {
      console.error('Failed to reset AI usage:', error);
      showErrorToast(getErrorDetail(error, t('aiUsageResetFailed')));
    } finally {
      setResettingAIUsage(false);
      setResetAIUsageConfirmOpen(false);
    }
  };

  const handleClearAIRecentActions = async () => {
    setClearingAIRecentActions(true);
    try {
      const usage = await aiManagerAPI.clearRecentActions();
      setAIUsage(usage);
      setAIActionPage(1);
      showSuccessToast(t('aiRecentActionsCleared'));
    } catch (error) {
      console.error('Failed to clear AI recent actions:', error);
      showErrorToast(getErrorDetail(error, t('aiRecentActionsClearFailed')));
    } finally {
      setClearingAIRecentActions(false);
      setClearAIRecentActionsConfirmOpen(false);
    }
  };

  const aiRecentEvents = Array.isArray(aiUsage?.recent_events) ? aiUsage.recent_events : [];
  const filteredAIRecentEvents = aiRecentEvents.filter((event: any) => {
    const statusMatches = aiActionStatusFilter === 'all'
      || (aiActionStatusFilter === 'succeeded' && event.success)
      || (aiActionStatusFilter === 'failed' && !event.success);
    const providerMatches = aiActionProviderFilter === 'all' || event.provider === aiActionProviderFilter;
    return statusMatches && providerMatches;
  });
  const aiActionPageSize = 8;
  const aiActionTotalPages = Math.max(1, Math.ceil(filteredAIRecentEvents.length / aiActionPageSize));
  const normalizedAIActionPage = Math.min(aiActionPage, aiActionTotalPages);
  const visibleAIRecentEvents = filteredAIRecentEvents.slice(
    (normalizedAIActionPage - 1) * aiActionPageSize,
    normalizedAIActionPage * aiActionPageSize,
  );
  const activeAIProvider = aiManagerSettings.providers.find((provider) => provider.provider === aiManagerSettings.active_provider);
  const aiUsageLimits = aiUsage?.limits;
  const activeProviderLimit = aiUsageLimits?.active_provider_limit || null;
  const projectMonthlyLimit = aiUsageLimits?.project_monthly_limit;
  const providerLimitBlocksBeforeProject = Boolean(
    activeProviderLimit?.status === 'exceeded'
    && activeProviderLimit.limit
    && projectMonthlyLimit?.limit
    && projectMonthlyLimit.limit > activeProviderLimit.limit,
  );
  const formatAIUsageNumber = (value?: number | null) => Number(value || 0).toLocaleString();
  const getAIUsagePercent = (limit?: AIUsageLimitEntry | null) => Math.min(100, Math.max(0, Math.round(limit?.percent_used || 0)));
  const getAIUsageProgressClass = (status?: AIUsageLimitEntry['status']) => {
    if (status === 'exceeded') return 'bg-destructive';
    if (status === 'warning') return 'bg-amber-500';
    if (status === 'ok') return 'bg-emerald-600';
    return 'bg-muted-foreground';
  };
  const getAIUsageBadgeVariant = (status?: AIUsageLimitEntry['status']) => status === 'exceeded' ? 'destructive' : 'outline';
  const getAIUsageStatusLabel = (status?: AIUsageLimitEntry['status']) => {
    if (status === 'exceeded') return t('aiUsageLimitExceeded');
    if (status === 'warning') return t('aiUsageLimitNear');
    if (status === 'ok') return t('aiUsageLimitHealthy');
    return t('aiUsageLimitUnlimited');
  };
  const getAIUsageLimitLabel = (limit?: AIUsageLimitEntry | null) => limit?.limit
    ? t('aiUsageVsLimit', { used: formatAIUsageNumber(limit.used_tokens), limit: formatAIUsageNumber(limit.limit) })
    : t('aiUsageUnlimitedUsed', { used: formatAIUsageNumber(limit?.used_tokens || 0) });

  return (
    <div className="space-y-6">
            <Card>
              <CardHeader className="border-b border-gray-100 dark:border-gray-800">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center space-x-2 rtl:space-x-reverse">
                    <BrainCircuit className="h-5 w-5 text-indigo-600" />
                    <div>
                      <CardTitle>{t('aiManager')}</CardTitle>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('aiManagerDesc')}</p>
                    </div>
                  </div>
                  <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3 md:w-auto md:justify-end">
                    <Button className="w-full" variant="outline" onClick={loadAIManager} disabled={loadingAIManager}>
                      <RefreshCw className={`h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 ${loadingAIManager ? 'animate-spin' : ''}`} />
                      {t('refresh')}
                    </Button>
                    <Button className="w-full" variant="outline" onClick={() => setResetAIUsageConfirmOpen(true)} disabled={resettingAIUsage || loadingAIManager}>
                      {resettingAIUsage ? <Loader2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />}
                      {t('resetAIUsage')}
                    </Button>
                    <Button className="w-full" onClick={handleSaveAIManager} disabled={savingAIManager}>
                      {savingAIManager ? <Loader2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 animate-spin" /> : <KeyRound className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />}
                      {savingAIManager ? t('saving') : t('saveAIManager')}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('aiTotalRequests')}</p>
                    <p className="mt-1 text-2xl font-semibold">{aiUsage?.totals?.requests ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('aiTotalTokens')}</p>
                    <p className="mt-1 text-2xl font-semibold">{aiUsage?.totals?.total_tokens ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('aiPromptTokens')}</p>
                    <p className="mt-1 text-2xl font-semibold">{aiUsage?.totals?.prompt_tokens ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('aiFailures')}</p>
                    <p className="mt-1 text-2xl font-semibold">{aiUsage?.totals?.failures ?? 0}</p>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-slate-50 p-4 dark:border-gray-700 dark:bg-slate-950">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('activeAIProviderStatus')}</p>
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                        {activeAIProvider
                          ? `${aiProviderLabels[activeAIProvider.provider]} · ${activeAIProvider.model || t('model')}`
                          : t('aiTokenMissing')}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={activeAIProvider?.enabled ? 'outline' : 'destructive'}>
                        {activeAIProvider?.enabled ? t('enabled') : t('disabled')}
                      </Badge>
                      <Badge variant={activeAIProvider?.token_configured || activeAIProvider?.api_key_required === false ? 'outline' : 'destructive'}>
                        {activeAIProvider?.token_configured
                          ? t('aiTokenConfiguredShort')
                          : activeAIProvider?.api_key_required === false
                            ? t('aiTokenOptional')
                            : t('aiTokenMissing')}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-emerald-600" />
                        <h3 className="font-semibold">{t('providerMonthlyUsageLimitIndicator')}</h3>
                        <Badge variant={getAIUsageBadgeVariant(activeProviderLimit?.status)}>
                          {getAIUsageStatusLabel(activeProviderLimit?.status)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                        {t('providerMonthlyUsageLimitSummary', {
                          provider: activeAIProvider ? aiProviderLabels[activeAIProvider.provider] : t('unknown'),
                          month: aiUsageLimits?.current_month || t('currentMonth'),
                        })}
                      </p>
                      {providerLimitBlocksBeforeProject && activeAIProvider && (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                          {t('providerLimitBlocksProjectLimit', {
                            provider: aiProviderLabels[activeAIProvider.provider],
                            providerLimit: formatAIUsageNumber(activeProviderLimit.limit),
                            projectLimit: formatAIUsageNumber(projectMonthlyLimit?.limit),
                          })}
                        </p>
                      )}
                      <div className="mt-3">
                        <div className="mb-1 flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
                          <span>{getAIUsageLimitLabel(activeProviderLimit)}</span>
                          <span>{activeProviderLimit?.limit ? t('aiUsagePercentUsed', { percent: getAIUsagePercent(activeProviderLimit) }) : t('unlimited')}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                          <div
                            className={`h-full rounded-full ${getAIUsageProgressClass(activeProviderLimit?.status)}`}
                            style={{ width: `${activeProviderLimit?.limit ? getAIUsagePercent(activeProviderLimit) : 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 lg:w-72">
                      <p className="font-medium">{t('projectMonthlyTokenLimit')}</p>
                      <p className="mt-1 text-gray-600 dark:text-gray-400">
                        {projectMonthlyLimit?.limit
                          ? t('projectUsageLimitSummary', {
                              limit: formatAIUsageNumber(projectMonthlyLimit.limit),
                              projects: projectMonthlyLimit.total_projects,
                            })
                          : t('projectUsageLimitDisabled')}
                      </p>
                      {(projectMonthlyLimit?.projects_over_limit || projectMonthlyLimit?.projects_near_limit) ? (
                        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                          {t('projectUsageLimitAlerts', {
                            near: projectMonthlyLimit.projects_near_limit,
                            over: projectMonthlyLimit.projects_over_limit,
                          })}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div className="space-y-2">
                    <Label>{t('activeAIProvider')}</Label>
                    <Select value={aiManagerSettings.active_provider} onValueChange={(value) => setAIManagerSettings((current) => ({ ...current, active_provider: value as AIProviderName }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {aiManagerSettings.providers.map((provider) => (
                          <SelectItem key={provider.provider} value={provider.provider}>
                            {aiProviderLabels[provider.provider]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('projectMonthlyTokenLimit')}</Label>
                    <Input
                      type="number"
                      min={1}
                      value={aiManagerSettings.per_project_monthly_token_limit ?? ''}
                      onChange={(event) => setAIManagerSettings((current) => ({
                        ...current,
                        per_project_monthly_token_limit: normalizeMonthlyTokenLimit(event.target.value),
                      }))}
                      placeholder={t('unlimited')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('aiTestPrompt')}</Label>
                    <Input value={aiTestPrompt} onChange={(event) => setAITestPrompt(event.target.value)} maxLength={1000} />
                  </div>
                </div>

                {/* Requirement AI assistant (project-wide Q&A) settings */}
                <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{t('reqChatSettingsTitle')}</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{t('reqChatSettingsDesc')}</p>
                    </div>
                    <Switch
                      checked={aiManagerSettings.requirement_chat?.enabled ?? true}
                      onCheckedChange={(checked) => setAIManagerSettings((current) => ({
                        ...current,
                        requirement_chat: { ...(current.requirement_chat ?? defaultRequirementChatSettings), enabled: checked },
                      }))}
                    />
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>{t('reqChatMaxRequirements')}</Label>
                      <Input
                        type="number"
                        min={1}
                        max={200}
                        disabled={!(aiManagerSettings.requirement_chat?.enabled ?? true)}
                        value={aiManagerSettings.requirement_chat?.max_context_requirements ?? 40}
                        onChange={(event) => setAIManagerSettings((current) => ({
                          ...current,
                          requirement_chat: {
                            ...(current.requirement_chat ?? defaultRequirementChatSettings),
                            max_context_requirements: Math.min(200, Math.max(1, Number(event.target.value) || 40)),
                          },
                        }))}
                      />
                      <p className="text-xs text-slate-400">{t('reqChatMaxRequirementsHint')}</p>
                    </div>
                    <div className="space-y-2">
                      <Label>{t('reqChatHistoryTurns')}</Label>
                      <Input
                        type="number"
                        min={0}
                        max={20}
                        disabled={!(aiManagerSettings.requirement_chat?.enabled ?? true)}
                        value={aiManagerSettings.requirement_chat?.history_turns ?? 6}
                        onChange={(event) => setAIManagerSettings((current) => ({
                          ...current,
                          requirement_chat: {
                            ...(current.requirement_chat ?? defaultRequirementChatSettings),
                            history_turns: Math.min(20, Math.max(0, Number(event.target.value) || 0)),
                          },
                        }))}
                      />
                      <p className="text-xs text-slate-400">{t('reqChatHistoryTurnsHint')}</p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2">
                    <Label>{t('aiSourceScope')}</Label>
                    <p className="text-xs text-slate-400">{t('aiSourceScopeHint')}</p>
                    <div className="flex flex-wrap gap-2">
                      {AI_SOURCE_TYPES.map((type) => {
                        const selected = (aiManagerSettings.requirement_chat?.source_types ?? ['requirements']).includes(type);
                        const isRequirements = type === 'requirements';
                        return (
                          <button
                            key={type}
                            type="button"
                            disabled={isRequirements}
                            onClick={() => setAIManagerSettings((current) => {
                              const chat = current.requirement_chat ?? defaultRequirementChatSettings;
                              const set = new Set(chat.source_types ?? ['requirements']);
                              if (selected) set.delete(type); else set.add(type);
                              set.add('requirements'); // always keep requirements
                              return { ...current, requirement_chat: { ...chat, source_types: AI_SOURCE_TYPES.filter((t2) => set.has(t2)) } };
                            })}
                            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${selected ? 'border-primary bg-primary/10 text-primary' : 'border-gray-300 text-gray-600 hover:border-primary/40 dark:border-gray-600 dark:text-gray-300'} ${isRequirements ? 'opacity-70' : ''}`}
                          >
                            {t(`aiSource_${type}`)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Org guidance / custom system prompt */}
                <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                  <Label>{t('aiOrgGuidance')}</Label>
                  <p className="mb-2 text-xs text-slate-400">{t('aiOrgGuidanceHint')}</p>
                  <Textarea
                    value={aiManagerSettings.system_prompt ?? ''}
                    onChange={(event) => setAIManagerSettings((current) => ({ ...current, system_prompt: event.target.value }))}
                    placeholder={t('aiOrgGuidancePlaceholder')}
                    maxLength={2000}
                    rows={3}
                  />
                </div>

                {/* Test-case generation defaults + global compact payload */}
                <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{t('aiTestCaseGenTitle')}</h4>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>{t('aiTestCaseGenCount')}</Label>
                      <Input
                        type="number" min={1} max={20}
                        value={aiManagerSettings.test_case_generation?.default_count ?? 5}
                        onChange={(event) => setAIManagerSettings((current) => ({
                          ...current,
                          test_case_generation: {
                            default_count: Math.min(20, Math.max(1, Number(event.target.value) || 5)),
                            max_tokens: current.test_case_generation?.max_tokens ?? 3000,
                          },
                        }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('aiTestCaseGenMaxTokens')}</Label>
                      <Input
                        type="number" min={256} max={4000}
                        value={aiManagerSettings.test_case_generation?.max_tokens ?? 3000}
                        onChange={(event) => setAIManagerSettings((current) => ({
                          ...current,
                          test_case_generation: {
                            default_count: current.test_case_generation?.default_count ?? 5,
                            max_tokens: Math.min(4000, Math.max(256, Number(event.target.value) || 3000)),
                          },
                        }))}
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div>
                      <Label>{t('aiCompactDefault')}</Label>
                      <p className="text-xs text-slate-400">{t('aiCompactDefaultHint')}</p>
                    </div>
                    <Switch
                      checked={aiManagerSettings.compact_payload_default ?? true}
                      onCheckedChange={(checked) => setAIManagerSettings((current) => ({ ...current, compact_payload_default: checked }))}
                    />
                  </div>
                </div>

                {/* Per-task model routing (collapsed by default) */}
                <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setRoutingExpanded((v) => !v)}
                    aria-expanded={routingExpanded}
                    className="flex w-full items-center justify-between gap-3 text-start"
                  >
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{t('aiRoutingTitle')}</h4>
                      <p className="text-xs text-slate-400">{t('aiRoutingHint')}</p>
                    </div>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${routingExpanded ? '' : '-rotate-90'}`} />
                  </button>
                  {routingExpanded && (() => {
                    const routing = aiManagerSettings.routing ?? defaultRoutingSettings;
                    const setRoute = (task: keyof AIRoutingSettings, next: AIRoutingTarget) =>
                      setAIManagerSettings((current) => ({
                        ...current,
                        routing: { ...(current.routing ?? defaultRoutingSettings), [task]: next },
                      }));
                    const docsHasProvider = !!routing.docs?.provider;
                    // How many Doc Hub features have an explicit provider (shown on the collapsed header).
                    const docOverrides = (['docs', ...AI_DOC_ROUTING_SUBTASKS] as Array<keyof AIRoutingSettings>)
                      .filter((task) => routing[task]?.provider).length;
                    return (
                      <div className="mt-3 space-y-3">
                        {AI_ROUTING_TASKS.map((task) => (
                          <AIRoutingRow
                            key={task}
                            label={t(`aiRouting_${task}`)}
                            target={routing[task] ?? { provider: null, model: null }}
                            providers={aiManagerSettings.providers}
                            inheritLabel={t('aiRoutingUseActive')}
                            onChange={(next) => setRoute(task, next)}
                            t={t}
                          />
                        ))}

                        {/* Doc Hub: general provider + optional per-feature overrides (collapsed by default) */}
                        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                          <button
                            type="button"
                            onClick={() => setDocRoutingExpanded((v) => !v)}
                            aria-expanded={docRoutingExpanded}
                            className="flex w-full items-center justify-between gap-3 text-start"
                          >
                            <div className="flex items-center gap-2">
                              <BookText className="h-4 w-4 shrink-0 text-primary" />
                              <span className="text-sm font-semibold text-slate-900 dark:text-white">{t('aiRoutingDocHubTitle')}</span>
                              {docOverrides > 0 && (
                                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{docOverrides}</span>
                              )}
                            </div>
                            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${docRoutingExpanded ? '' : '-rotate-90'}`} />
                          </button>
                          {docRoutingExpanded && (
                            <div className="mt-3">
                              <p className="mb-3 text-xs text-slate-400">{t('aiRoutingDocHubHint')}</p>
                              <div className="space-y-3">
                                <AIRoutingRow
                                  label={t('aiRouting_docs')}
                                  target={routing.docs ?? { provider: null, model: null }}
                                  providers={aiManagerSettings.providers}
                                  inheritLabel={t('aiRoutingUseActive')}
                                  onChange={(next) => setRoute('docs', next)}
                                  t={t}
                                />
                                {AI_DOC_ROUTING_SUBTASKS.map((task) => (
                                  <AIRoutingRow
                                    key={task}
                                    label={t(`aiRouting_${task}`)}
                                    target={routing[task] ?? { provider: null, model: null }}
                                    providers={aiManagerSettings.providers}
                                    // Sub-features inherit the general Doc Hub provider when set,
                                    // otherwise the active provider.
                                    inheritLabel={docsHasProvider ? t('aiRoutingUseDocHub') : t('aiRoutingUseActive')}
                                    indented
                                    onChange={(next) => setRoute(task, next)}
                                    t={t}
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Fallback provider chain */}
                <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{t('aiFallbackTitle')}</h4>
                      <p className="text-xs text-slate-400">{t('aiFallbackHint')}</p>
                    </div>
                    <Switch
                      checked={aiManagerSettings.fallback?.enabled ?? false}
                      onCheckedChange={(checked) => setAIManagerSettings((current) => ({
                        ...current,
                        fallback: { enabled: checked, order: current.fallback?.order ?? [] },
                      }))}
                    />
                  </div>
                  {(aiManagerSettings.fallback?.enabled ?? false) && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-slate-400">{t('aiFallbackOrderHint')}</p>
                      <div className="flex flex-wrap gap-2">
                        {aiManagerSettings.providers.map((p) => {
                          const order = aiManagerSettings.fallback?.order ?? [];
                          const idx = order.indexOf(p.provider);
                          const selected = idx >= 0;
                          return (
                            <button
                              key={p.provider}
                              type="button"
                              onClick={() => setAIManagerSettings((current) => {
                                const cur = current.fallback?.order ?? [];
                                const next = selected ? cur.filter((x) => x !== p.provider) : [...cur, p.provider];
                                return { ...current, fallback: { enabled: current.fallback?.enabled ?? true, order: next } };
                              })}
                              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${selected ? 'border-primary bg-primary/10 text-primary' : 'border-gray-300 text-gray-600 hover:border-primary/40 dark:border-gray-600 dark:text-gray-300'}`}
                            >
                              {selected ? `${idx + 1}. ` : ''}{aiProviderLabels[p.provider]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Spend by feature */}
                <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{t('aiSpendTitle')}</h4>
                  <p className="mb-3 text-xs text-slate-400">{t('aiSpendHint')}</p>
                  {(() => {
                    const spendRows = aggregateAISpend(aiUsageLimits?.by_operation ?? [], t);
                    if (spendRows.length === 0) {
                      return <p className="text-xs text-slate-400">{t('aiSpendEmpty')}</p>;
                    }
                    return (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                              <th className="py-1 pe-4 font-medium">{t('aiSpendFeature')}</th>
                              <th className="py-1 pe-4 font-medium">{t('aiSpendRequests')}</th>
                              <th className="py-1 font-medium">{t('aiSpendTokens')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {spendRows.map((row) => (
                              <tr key={row.label} className="border-t border-gray-100 dark:border-gray-800">
                                <td className="py-1.5 pe-4">{row.label}</td>
                                <td className="py-1.5 pe-4 tabular-nums">{row.requests}{row.failures ? ` (${row.failures} ${t('failed')})` : ''}</td>
                                <td className="py-1.5 tabular-nums">{formatAIUsageNumber(row.total_tokens)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>

                <div className="space-y-4">
                  {aiManagerSettings.providers.map((provider) => {
                    const providerUsage: Record<string, number> = aiUsage?.providers?.[provider.provider] || {};
                    const providerLimit = aiUsageLimits?.providers?.[provider.provider] || null;
                    const expanded = expandedProviders[provider.provider] ?? provider.enabled;
                    return (
                      <div key={provider.provider} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={provider.enabled}
                              onCheckedChange={(checked) => updateAIProvider(provider.provider, { enabled: checked })}
                            />
                            <div>
                              <h3 className="font-semibold">{aiProviderLabels[provider.provider]}</h3>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {provider.token_configured
                                  ? t('aiTokenConfigured', { token: provider.api_key_masked || '' })
                                  : provider.api_key_required === false
                                    ? t('aiTokenOptional')
                                    : t('aiTokenMissing')}
                              </p>
                            </div>
                          </div>
                          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end md:w-auto">
                            <Badge variant="outline">{t('aiProviderTokens', { count: providerUsage.total_tokens ?? 0 })}</Badge>
                            <Badge variant={getAIUsageBadgeVariant(providerLimit?.status)}>
                              {getAIUsageStatusLabel(providerLimit?.status)}
                            </Badge>
                            {expanded && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full sm:w-auto sm:min-w-36"
                                onClick={() => handleTestAIProvider(provider.provider)}
                                disabled={testingAIProvider === provider.provider || !provider.enabled}
                              >
                                {testingAIProvider === provider.provider ? <Loader2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />}
                                {t('testAIProvider')}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="shrink-0"
                              onClick={() => setExpandedProviders((current) => ({ ...current, [provider.provider]: !expanded }))}
                              aria-expanded={expanded}
                              aria-label={expanded ? t('collapse') : t('expand')}
                              title={expanded ? t('collapse') : t('expand')}
                            >
                              <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? '' : '-rotate-90'}`} />
                            </Button>
                          </div>
                        </div>

                        {expanded && (
                        <>
                        <div className="mt-4 rounded-md bg-slate-50 p-3 dark:bg-slate-950">
                          <div className="mb-1 flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
                            <span>{t('monthlyUsage')}</span>
                            <span>{getAIUsageLimitLabel(providerLimit)}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                            <div
                              className={`h-full rounded-full ${getAIUsageProgressClass(providerLimit?.status)}`}
                              style={{ width: `${providerLimit?.limit ? getAIUsagePercent(providerLimit) : 100}%` }}
                            />
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                          <div className="space-y-2 xl:col-span-2">
                            <Label>{t('apiToken')}</Label>
                            <Input
                              type="password"
                              value={provider.api_key || ''}
                              onChange={(event) => updateAIProvider(provider.provider, { api_key: event.target.value })}
                              placeholder={provider.token_configured ? t('leaveBlankToKeepToken') : provider.api_key_required === false ? t('optionalApiToken') : t('enterApiToken')}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>{t('model')}</Label>
                            <Input value={provider.model} onChange={(event) => updateAIProvider(provider.provider, { model: event.target.value })} />
                          </div>
                          <div className="space-y-2">
                            <Label>{t('requestTimeoutSeconds')}</Label>
                            <Input
                              type="number"
                              min={5}
                              max={300}
                              value={provider.request_timeout_seconds}
                              onChange={(event) => updateAIProvider(provider.provider, { request_timeout_seconds: Number(event.target.value) || 60 })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>{t('monthlyTokenLimit')}</Label>
                            <Input
                              type="number"
                              min={1}
                              value={provider.monthly_token_limit ?? ''}
                              onChange={(event) => updateAIProvider(provider.provider, { monthly_token_limit: normalizeMonthlyTokenLimit(event.target.value) })}
                              placeholder={t('unlimited')}
                            />
                          </div>
                          <div className="space-y-2 md:col-span-2 xl:col-span-5">
                            <Label>{t('baseUrl')}</Label>
                            <Input value={provider.base_url} onChange={(event) => updateAIProvider(provider.provider, { base_url: event.target.value })} />
                          </div>
                        </div>
                        </>
                        )}
                      </div>
                    );
                  })}
                </div>

                {aiTestResult && (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-200">
                    <p className="font-medium">{t('latestAITestResult')}</p>
                    <p className="mt-1">{aiTestResult.message}</p>
                    <p className="mt-2 text-xs">
                      {aiProviderLabels[aiTestResult.provider as AIProviderName] || aiTestResult.provider} · {aiTestResult.model} · {t('aiProviderTokens', { count: aiTestResult.usage?.total_tokens ?? 0 })}
                    </p>
                  </div>
                )}

                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h3 className="font-semibold">{t('recentAIActions')}</h3>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {t('recentAIActionsRetention', { count: aiRecentEvents.length })}
                      </p>
                    </div>
                    <div className="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:items-center lg:justify-end">
                      <div className="grid gap-2 sm:grid-cols-2 lg:w-[360px]">
                        <Select value={aiActionStatusFilter} onValueChange={setAIActionStatusFilter}>
                          <SelectTrigger>
                            <SelectValue placeholder={t('status')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">{t('allStatuses')}</SelectItem>
                            <SelectItem value="succeeded">{t('aiActionSucceeded')}</SelectItem>
                            <SelectItem value="failed">{t('aiActionFailed')}</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={aiActionProviderFilter} onValueChange={setAIActionProviderFilter}>
                          <SelectTrigger>
                            <SelectValue placeholder={t('provider')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">{t('allProviders')}</SelectItem>
                            {aiManagerSettings.providers.map((provider) => (
                              <SelectItem key={provider.provider} value={provider.provider}>
                                {aiProviderLabels[provider.provider]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full lg:w-auto lg:min-w-48"
                        onClick={() => setClearAIRecentActionsConfirmOpen(true)}
                        disabled={clearingAIRecentActions || aiRecentEvents.length === 0}
                      >
                        {clearingAIRecentActions ? <Loader2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />}
                        {t('clearRecentAIActions')}
                      </Button>
                    </div>
                  </div>
                  {visibleAIRecentEvents.length > 0 ? (
                    <>
                      <div className="overflow-hidden rounded-md border border-gray-200 dark:border-gray-700">
                        <div className="hidden grid-cols-[1fr_140px_120px_170px] gap-3 border-b border-gray-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-gray-500 dark:border-gray-700 dark:bg-slate-950 md:grid">
                          <span>{t('action')}</span>
                          <span>{t('provider')}</span>
                          <span>{t('tokens')}</span>
                          <span>{t('created')}</span>
                        </div>
                        {visibleAIRecentEvents.map((event: any, index: number) => (
                          <div key={`${event.created_at || index}-${event.operation || 'ai'}`} className="grid gap-2 border-b border-gray-100 px-3 py-3 text-sm last:border-b-0 dark:border-gray-800 md:grid-cols-[1fr_140px_120px_170px] md:items-center">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant={event.success ? 'outline' : 'destructive'}>
                                  {event.success ? t('aiActionSucceeded') : t('aiActionFailed')}
                                </Badge>
                                <span className="font-medium capitalize">{String(event.operation || 'completion').replace(/_/g, ' ')}</span>
                              </div>
                              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                {event.project_id ? `${t('projectIdLabel')}: ${event.project_id}` : t('global')}
                                {event.user_id ? ` · ${t('userIdLabel')}: ${event.user_id}` : ''}
                              </p>
                              {!event.success && event.error && (
                                <p className="mt-1 truncate text-xs text-red-600 dark:text-red-400" title={event.error}>{event.error}</p>
                              )}
                            </div>
                            <span className="text-sm text-gray-700 dark:text-gray-300">
                              {aiProviderLabels[event.provider as AIProviderName] || event.provider || t('unknown')}
                            </span>
                            <span className="text-sm text-gray-700 dark:text-gray-300">
                              {t('aiProviderTokens', { count: event.total_tokens ?? 0 })}
                            </span>
                            <time className="text-xs text-gray-500 dark:text-gray-400">
                              {event.created_at ? new Date(event.created_at).toLocaleString() : t('unknown')}
                            </time>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-col gap-2 text-xs text-gray-500 dark:text-gray-400 sm:flex-row sm:items-center sm:justify-between">
                        <span>{t('showingRecentAIActions', { shown: visibleAIRecentEvents.length, total: filteredAIRecentEvents.length })}</span>
                        <div className="flex items-center gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => setAIActionPage((current) => Math.max(1, current - 1))} disabled={normalizedAIActionPage <= 1}>
                            {t('previous')}
                          </Button>
                          <span>{t('paginationPage', { page: normalizedAIActionPage, total: aiActionTotalPages })}</span>
                          <Button type="button" variant="outline" size="sm" onClick={() => setAIActionPage((current) => Math.min(aiActionTotalPages, current + 1))} disabled={normalizedAIActionPage >= aiActionTotalPages}>
                            {t('next')}
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-md border border-dashed border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                      {t('noRecentAIActions')}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
            <AlertDialog open={resetAIUsageConfirmOpen} onOpenChange={setResetAIUsageConfirmOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('resetAIUsageConfirmTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('resetAIUsageConfirmDesc')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={resettingAIUsage}>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleResetAIUsage} disabled={resettingAIUsage}>
                    {resettingAIUsage ? <Loader2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 animate-spin" /> : null}
                    {t('resetAIUsage')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <AlertDialog open={clearAIRecentActionsConfirmOpen} onOpenChange={setClearAIRecentActionsConfirmOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('clearRecentAIActionsConfirmTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('clearRecentAIActionsConfirmDesc')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={clearingAIRecentActions}>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClearAIRecentActions} disabled={clearingAIRecentActions || aiRecentEvents.length === 0}>
                    {clearingAIRecentActions ? <Loader2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2 animate-spin" /> : null}
                    {t('clearRecentAIActions')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

    </div>
  );
}

export default AIManagerTab;
