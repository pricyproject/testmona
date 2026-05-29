import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Save } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { customFieldsAPI, getApiErrorMessage, type CustomFieldEntityType } from '@/lib/api';
import { CustomFieldDefinition } from '@/types';

interface ValueRow {
  id: number;
  field_definition_id: number;
  value: string | null;
}

interface Props {
  projectId: number;
  entityType: CustomFieldEntityType;
  entityId: number;
  /** Disables every input + save when the parent says read-only. */
  readOnly?: boolean;
  hideWhenEmpty?: boolean;
  className?: string;
}

const NO_SELECT_VALUE = '__none__';

const parseOptions = (raw: CustomFieldDefinition['options']): string[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'object' && Array.isArray((raw as any).values)) {
    return (raw as any).values.map(String);
  }
  return [];
};

const splitMultiselect = (value: string | null | undefined): string[] => {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
};

export function CustomFieldsPanel({ projectId, entityType, entityId, readOnly = false, hideWhenEmpty = false, className }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [definitions, setDefinitions] = useState<CustomFieldDefinition[]>([]);
  const [values, setValues] = useState<ValueRow[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingFieldId, setSavingFieldId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [defs, vals] = await Promise.all([
          customFieldsAPI.getDefinitions(projectId, entityType),
          customFieldsAPI.listEntityValues(entityType, entityId),
        ]);
        if (cancelled) return;
        const definitionsList = Array.isArray(defs) ? defs : [];
        const valuesList = Array.isArray(vals) ? vals : [];
        setDefinitions(definitionsList);
        setValues(valuesList);
        const seed: Record<number, string> = {};
        for (const v of valuesList) {
          seed[v.field_definition_id] = v.value ?? '';
        }
        setDrafts(seed);
      } catch (err) {
        if (!cancelled) setError(getApiErrorMessage(err, t('failedToLoadCustomFields')));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, entityType, entityId, t]);

  const valuesByFieldId = useMemo(() => {
    const map = new Map<number, ValueRow>();
    for (const v of values) map.set(v.field_definition_id, v);
    return map;
  }, [values]);

  const setDraft = (fieldId: number, next: string) => {
    setDrafts((prev) => ({ ...prev, [fieldId]: next }));
  };

  const handleSave = async (field: CustomFieldDefinition) => {
    const existing = valuesByFieldId.get(field.id);
    const draft = drafts[field.id] ?? '';
    const normalizedDraft = draft.trim();
    const isClearing = normalizedDraft === '' && (field.field_type !== 'boolean');

    setSavingFieldId(field.id);
    try {
      if (existing && isClearing) {
        await customFieldsAPI.deleteEntityValue(entityType, entityId, existing.id);
        setValues((prev) => prev.filter((row) => row.id !== existing.id));
        setDrafts((prev) => ({ ...prev, [field.id]: '' }));
        toast({ title: t('success'), description: t('customFieldCleared', { name: field.name }) });
        return;
      }
      if (existing) {
        const updated = await customFieldsAPI.updateEntityValue(entityType, entityId, existing.id, draft);
        setValues((prev) => prev.map((row) => (row.id === existing.id ? { ...row, value: updated.value } : row)));
      } else if (!isClearing) {
        const created = await customFieldsAPI.createEntityValue(entityType, entityId, field.id, draft);
        setValues((prev) => [...prev, { id: created.id, field_definition_id: field.id, value: created.value }]);
      } else {
        // Nothing to do — empty draft on a previously-empty field.
        return;
      }
      toast({ title: t('success'), description: t('customFieldSaved', { name: field.name }) });
    } catch (err) {
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToSaveCustomField')),
        variant: 'destructive',
      });
    } finally {
      setSavingFieldId(null);
    }
  };

  const renderInput = (field: CustomFieldDefinition) => {
    const draft = drafts[field.id] ?? '';
    const disabled = readOnly || savingFieldId === field.id;
    const fieldType = String(field.field_type);
    if (fieldType === 'boolean') {
      const checked = draft.toLowerCase() === 'true';
      return (
        <div className="flex items-center gap-2">
          <Checkbox
            checked={checked}
            disabled={disabled}
            onCheckedChange={(next) => setDraft(field.id, next === true ? 'true' : 'false')}
            aria-label={field.name}
          />
          <span className="text-sm text-muted-foreground">
            {checked ? t('yes') : t('no')}
          </span>
        </div>
      );
    }
    if (fieldType === 'select') {
      const options = parseOptions(field.options);
      return (
        <Select
          value={draft || NO_SELECT_VALUE}
          onValueChange={(next) => setDraft(field.id, next === NO_SELECT_VALUE ? '' : next)}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder={t('selectAValue')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SELECT_VALUE}>{t('clearValue')}</SelectItem>
            {options.map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (fieldType === 'multiselect') {
      const options = parseOptions(field.options);
      const selected = new Set(splitMultiselect(draft));
      return (
        <div className="flex flex-wrap gap-1.5 rounded-md border p-2">
          {options.length === 0 ? (
            <span className="text-xs text-muted-foreground">{t('noOptionsConfigured')}</span>
          ) : (
            options.map((opt) => {
              const active = selected.has(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    const next = new Set(selected);
                    if (active) next.delete(opt);
                    else next.add(opt);
                    setDraft(field.id, Array.from(next).join(', '));
                  }}
                  className={`rounded-full px-2.5 py-1 text-xs ring-1 transition ${
                    active
                      ? 'bg-primary text-primary-foreground ring-primary'
                      : 'bg-muted text-foreground ring-transparent hover:bg-muted/70'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {opt}
                </button>
              );
            })
          )}
        </div>
      );
    }
    if (fieldType === 'number') {
      return (
        <Input
          type="number"
          value={draft}
          onChange={(e) => setDraft(field.id, e.target.value)}
          disabled={disabled}
        />
      );
    }
    if (fieldType === 'date') {
      return (
        <Input
          type="date"
          value={draft}
          onChange={(e) => setDraft(field.id, e.target.value)}
          disabled={disabled}
        />
      );
    }
    return (
      <Input
        value={draft}
        onChange={(e) => setDraft(field.id, e.target.value)}
        disabled={disabled}
      />
    );
  };

  if (!isLoading && !error && hideWhenEmpty && definitions.length === 0) {
    return null;
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">{t('customFields')}</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('loading')}
          </div>
        ) : definitions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noCustomFieldsForEntity')}</p>
        ) : (
          <div className="space-y-4">
            {definitions.map((field) => {
              const existing = valuesByFieldId.get(field.id);
              const draft = drafts[field.id] ?? '';
              const original = existing?.value ?? '';
              const isDirty = draft !== original;
              return (
                <div key={field.id} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-sm font-medium">
                      {field.name}
                      {field.is_required && <span className="text-red-500 ml-1">*</span>}
                    </Label>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {String(field.field_type)}
                      </Badge>
                      {!readOnly && (
                        <Button
                          size="sm"
                          variant={isDirty ? 'default' : 'ghost'}
                          onClick={() => handleSave(field)}
                          disabled={savingFieldId === field.id || !isDirty}
                          className="gap-1"
                        >
                          {savingFieldId === field.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          {t('save')}
                        </Button>
                      )}
                    </div>
                  </div>
                  {field.description && (
                    <p className="text-xs text-muted-foreground">{field.description}</p>
                  )}
                  {renderInput(field)}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
