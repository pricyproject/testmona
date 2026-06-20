import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SearchableDefectSelect } from '@/components/Defects/SearchableDefectSelect';
import { SearchableRequirementSelect } from '@/components/Defects/SearchableRequirementSelect';
import { SearchableTestCaseSelect } from '@/components/Defects/SearchableTestCaseSelect';
import {
  AlertTriangle,
  Bug,
  ClipboardCheck,
  FileText,
  GitBranch,
  Loader2,
  ShieldCheck,
  Tag,
  UserCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { analyticsAPI, getApiErrorMessage } from '@/lib/api';

export type RcaMember = { id: number; name: string };

export type RcaFormData = {
  defects: any[];
  requirements: any[];
  testCases: any[];
  members: RcaMember[];
};

const RCA_CATEGORIES = [
  'code_defect',
  'requirement_gap',
  'test_gap',
  'environment',
  'data',
  'configuration',
  'third_party',
  'process',
  'human_error',
  'other',
] as const;

const SEVERITY_OPTIONS = ['low', 'medium', 'high', 'critical'] as const;
const STATUS_OPTIONS = ['open', 'in_progress', 'resolved', 'closed'] as const;

const SEVERITY_STYLES: Record<string, string> = {
  low: 'data-[active=true]:bg-slate-600 data-[active=true]:text-white data-[active=true]:border-slate-600',
  medium: 'data-[active=true]:bg-amber-500 data-[active=true]:text-white data-[active=true]:border-amber-500',
  high: 'data-[active=true]:bg-orange-500 data-[active=true]:text-white data-[active=true]:border-orange-500',
  critical: 'data-[active=true]:bg-red-600 data-[active=true]:text-white data-[active=true]:border-red-600',
};

const STATUS_STYLES: Record<string, string> = {
  open: 'data-[active=true]:bg-rose-600 data-[active=true]:text-white data-[active=true]:border-rose-600',
  in_progress: 'data-[active=true]:bg-blue-600 data-[active=true]:text-white data-[active=true]:border-blue-600',
  resolved: 'data-[active=true]:bg-emerald-600 data-[active=true]:text-white data-[active=true]:border-emerald-600',
  closed: 'data-[active=true]:bg-slate-500 data-[active=true]:text-white data-[active=true]:border-slate-500',
};

const STATUS_LABEL_KEY: Record<string, string> = {
  open: 'open',
  in_progress: 'inProgress',
  resolved: 'resolved',
  closed: 'closed',
};

const UNASSIGNED_VALUE = 'unassigned';

const emptyForm = {
  analysis_title: '',
  root_cause: '',
  category: '',
  severity: 'medium',
  status: 'open',
  assigned_to: '',
  impact_assessment: '',
  resolution_time_hours: '',
  fix_commit_hash: '',
  corrective_action: '',
  preventive_action: '',
  defect_id: '',
  requirement_id: '',
  test_case_id: '',
};

type FormState = typeof emptyForm;

function SectionHeading({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
      <span className="text-blue-600 dark:text-blue-400">{icon}</span>
      {title}
    </div>
  );
}

function SegmentedControl({
  options,
  value,
  onChange,
  styles,
  labelFor,
}: {
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  styles: Record<string, string>;
  labelFor: (value: string) => string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          data-active={value === option}
          onClick={() => onChange(option)}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors',
            'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
            'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800',
            styles[option],
          )}
        >
          {labelFor(option)}
        </button>
      ))}
    </div>
  );
}

export function RootCauseAnalysisModal({
  open,
  onClose,
  onSaved,
  editing,
  projectId,
  formData,
  formDataLoading,
  lockedDefectId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing: any | null;
  projectId: number;
  formData: RcaFormData;
  formDataLoading: boolean;
  /** When set, the defect link is pre-filled and locked (defect-detail context). */
  lockedDefectId?: number;
}) {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const isEdit = editing != null;

  useEffect(() => {
    if (!open) return;
    if (editing) {
      const data = editing.analysis_data || {};
      setForm({
        analysis_title: editing.analysis_title || '',
        root_cause: editing.root_cause || '',
        category: data.category || '',
        severity: editing.severity || 'medium',
        status: editing.status || 'open',
        assigned_to: editing.assigned_to != null ? String(editing.assigned_to) : '',
        impact_assessment: editing.impact_assessment || '',
        resolution_time_hours:
          editing.resolution_time_hours != null ? String(editing.resolution_time_hours) : '',
        fix_commit_hash: editing.fix_commit_hash || '',
        corrective_action: data.corrective_action || '',
        preventive_action: data.preventive_action || '',
        defect_id: editing.defect_id != null ? String(editing.defect_id) : '',
        requirement_id: editing.requirement_id != null ? String(editing.requirement_id) : '',
        test_case_id: editing.test_case_id != null ? String(editing.test_case_id) : '',
      });
    } else {
      setForm({ ...emptyForm, defect_id: lockedDefectId != null ? String(lockedDefectId) : '' });
    }
  }, [open, editing, lockedDefectId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const titleValid = form.analysis_title.trim().length > 0;
  const rootCauseValid = form.root_cause.trim().length > 0;
  const canSave = titleValid && rootCauseValid && !saving;

  const memberOptions = useMemo(() => formData.members ?? [], [formData.members]);

  const categoryLabel = (value: string) => t(`rca_cat_${value}`);

  // The searchable selects use different "cleared" sentinels ('' vs 'none'), so
  // only treat a positive-integer string as a real link id.
  const toId = (value: string): number | null => (/^\d+$/.test(value) ? Number(value) : null);

  const handleSave = async () => {
    if (!canSave) return;
    const analysisData: Record<string, string> = {};
    if (form.category) analysisData.category = form.category;
    if (form.corrective_action.trim()) analysisData.corrective_action = form.corrective_action.trim();
    if (form.preventive_action.trim()) analysisData.preventive_action = form.preventive_action.trim();

    const payload: Record<string, unknown> = {
      project_id: projectId,
      analysis_title: form.analysis_title.trim(),
      root_cause: form.root_cause.trim(),
      severity: form.severity,
      status: form.status,
      assigned_to: toId(form.assigned_to),
      impact_assessment: form.impact_assessment.trim() || null,
      resolution_time_hours: form.resolution_time_hours ? Number(form.resolution_time_hours) : null,
      fix_commit_hash: form.fix_commit_hash.trim() || null,
      defect_id: toId(form.defect_id),
      requirement_id: toId(form.requirement_id),
      test_case_id: toId(form.test_case_id),
      analysis_data: Object.keys(analysisData).length ? analysisData : null,
    };

    setSaving(true);
    try {
      if (isEdit) {
        await analyticsAPI.updateRootCauseAnalysis(editing.id, payload);
      } else {
        await analyticsAPI.createRootCauseAnalysis(payload);
      }
      toast({
        title: isEdit ? t('reports_toast_analysisUpdated') : t('reports_toast_analysisAdded'),
        description: isEdit
          ? t('reports_toast_analysisUpdatedDesc', { title: form.analysis_title.trim() })
          : t('reports_toast_analysisAddedDesc', { title: form.analysis_title.trim() }),
      });
      onSaved();
      onClose();
    } catch (err) {
      console.error('Failed to save root cause analysis:', err);
      toast({
        title: isEdit ? t('reports_toast_couldNotUpdateAnalysis') : t('reports_toast_couldNotAddAnalysis'),
        description: getApiErrorMessage(err, t('reports_toast_analysisSaveFailed')),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent isRTL={isRTL} className="sm:max-w-2xl p-0 overflow-hidden gap-0">
        <DialogHeader className="space-y-1 border-b bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 text-white">
          <DialogTitle className="flex items-center gap-2 text-white">
            <GitBranch className="h-5 w-5" />
            {isEdit ? t('editRootCauseAnalysis') : t('addRootCauseAnalysis')}
          </DialogTitle>
          <p className="text-sm text-blue-100">{t('reports_rcaSubtitle')}</p>
        </DialogHeader>

        <div className="space-y-6 max-h-[65vh] overflow-y-auto px-6 py-5">
          {/* Overview */}
          <section className="space-y-3">
            <SectionHeading icon={<FileText className="h-4 w-4" />} title={t('rca_sectionOverview')} />
            <div>
              <Label className="mb-1 block">
                {t('analysisTitle')} <span className="text-red-500">*</span>
              </Label>
              <Input
                value={form.analysis_title}
                onChange={(e) => set('analysis_title', e.target.value)}
                placeholder={t('enterAnalysisTitle')}
                maxLength={200}
                className={!titleValid && form.analysis_title.length > 0 ? 'border-red-400' : ''}
              />
            </div>
            <div>
              <Label className="mb-1 block">
                {t('rootCause')} <span className="text-red-500">*</span>
              </Label>
              <Textarea
                value={form.root_cause}
                onChange={(e) => set('root_cause', e.target.value)}
                placeholder={t('describeRootCause')}
                rows={3}
              />
            </div>
            <div>
              <Label className="mb-1 flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5 text-gray-400" />
                {t('rca_category')}
              </Label>
              <Select value={form.category || 'none'} onValueChange={(v) => set('category', v === 'none' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('rca_categoryPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('rca_none')}</SelectItem>
                  {RCA_CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {categoryLabel(category)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>

          {/* Classification */}
          <section className="space-y-3 border-t pt-5">
            <SectionHeading icon={<AlertTriangle className="h-4 w-4" />} title={t('rca_sectionClassification')} />
            <div>
              <Label className="mb-1.5 block">{t('severity')}</Label>
              <SegmentedControl
                options={SEVERITY_OPTIONS}
                value={form.severity}
                onChange={(v) => set('severity', v)}
                styles={SEVERITY_STYLES}
                labelFor={(v) => t(v)}
              />
            </div>
            <div>
              <Label className="mb-1.5 block">{t('status')}</Label>
              <SegmentedControl
                options={STATUS_OPTIONS}
                value={form.status}
                onChange={(v) => set('status', v)}
                styles={STATUS_STYLES}
                labelFor={(v) => t(STATUS_LABEL_KEY[v])}
              />
            </div>
            <div>
              <Label className="mb-1 flex items-center gap-1.5">
                <UserCircle className="h-3.5 w-3.5 text-gray-400" />
                {t('rca_assignee')}
              </Label>
              <Select
                value={form.assigned_to || UNASSIGNED_VALUE}
                onValueChange={(v) => set('assigned_to', v === UNASSIGNED_VALUE ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('rca_assigneeUnassigned')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED_VALUE}>{t('rca_assigneeUnassigned')}</SelectItem>
                  {memberOptions.map((member) => (
                    <SelectItem key={member.id} value={String(member.id)}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>

          {/* Impact & resolution */}
          <section className="space-y-3 border-t pt-5">
            <SectionHeading icon={<ClipboardCheck className="h-4 w-4" />} title={t('rca_sectionImpact')} />
            <div>
              <Label className="mb-1 block">{t('impactAssessment')}</Label>
              <Textarea
                value={form.impact_assessment}
                onChange={(e) => set('impact_assessment', e.target.value)}
                rows={2}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="mb-1 block">{t('resolutionTimeHours')}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.resolution_time_hours}
                  onChange={(e) => set('resolution_time_hours', e.target.value)}
                />
              </div>
              <div>
                <Label className="mb-1 block">{t('fixCommitHash')}</Label>
                <Input
                  value={form.fix_commit_hash}
                  onChange={(e) => set('fix_commit_hash', e.target.value)}
                  placeholder="a1b2c3d"
                  className="font-mono"
                />
              </div>
            </div>
          </section>

          {/* Linked items */}
          <section className="space-y-3 border-t pt-5">
            <SectionHeading icon={<Bug className="h-4 w-4" />} title={t('rca_sectionLinks')} />
            {formDataLoading ? (
              <div className="flex items-center gap-2 py-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('loading')}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="rca-defect" className="mb-1 block">
                    {t('rca_linkedDefect')}
                  </Label>
                  <SearchableDefectSelect
                    id="rca-defect"
                    value={form.defect_id}
                    onChange={(v) => set('defect_id', v)}
                    defects={formData.defects}
                    disabled={lockedDefectId != null}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="rca-requirement" className="mb-1 block">
                      {t('rca_linkedRequirement')}
                    </Label>
                    <SearchableRequirementSelect
                      id="rca-requirement"
                      value={form.requirement_id}
                      onChange={(v) => set('requirement_id', v)}
                      requirements={formData.requirements}
                    />
                  </div>
                  <div>
                    <Label htmlFor="rca-testcase" className="mb-1 block">
                      {t('rca_linkedTestCase')}
                    </Label>
                    <SearchableTestCaseSelect
                      id="rca-testcase"
                      value={form.test_case_id}
                      onChange={(v) => set('test_case_id', v)}
                      testCases={formData.testCases}
                    />
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Corrective & preventive actions */}
          <section className="space-y-3 border-t pt-5">
            <SectionHeading icon={<ShieldCheck className="h-4 w-4" />} title={t('rca_sectionActions')} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="mb-1 block">{t('rca_correctiveAction')}</Label>
                <Textarea
                  value={form.corrective_action}
                  onChange={(e) => set('corrective_action', e.target.value)}
                  placeholder={t('rca_correctiveActionPlaceholder')}
                  rows={3}
                />
              </div>
              <div>
                <Label className="mb-1 block">{t('rca_preventiveAction')}</Label>
                <Textarea
                  value={form.preventive_action}
                  onChange={(e) => set('preventive_action', e.target.value)}
                  placeholder={t('rca_preventiveActionPlaceholder')}
                  rows={3}
                />
              </div>
            </div>
          </section>
        </div>

        <DialogFooter className="gap-2 border-t bg-gray-50 px-6 py-4 dark:bg-gray-900/50">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {saving ? t('saving') : isEdit ? t('save') : t('add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
