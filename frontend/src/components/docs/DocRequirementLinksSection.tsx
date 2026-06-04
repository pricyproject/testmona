import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2, Loader2, Plus, Unlink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { SearchableRequirementSelect } from '@/components/Defects/SearchableRequirementSelect';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { docsAPI, getApiErrorMessage, requirementsAPI } from '@/lib/api';
import type { DocRequirementLink, Requirement } from '@/types';

interface Props {
  docId: number;
  projectId?: number | null;
  canEdit: boolean;
  links: DocRequirementLink[];
  onChanged: () => void;
}

export function DocRequirementLinksSection({ docId, projectId, canEdit, links, onChanged }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [selected, setSelected] = useState('none');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const canManage = canEdit && !!projectId;

  useEffect(() => {
    if (!canManage || !projectId) return;
    let active = true;
    requirementsAPI.getAll(projectId, 0, 500)
      .then((items) => { if (active) setRequirements(Array.isArray(items) ? items : []); })
      .catch(() => { if (active) setRequirements([]); });
    return () => { active = false; };
  }, [canManage, projectId]);

  // Don't offer requirements that are already linked.
  const linkedIds = useMemo(() => new Set(links.map((l) => l.requirement_id)), [links]);
  const available = useMemo(
    () => requirements.filter((r) => !linkedIds.has(r.id)),
    [requirements, linkedIds],
  );

  const handleAdd = async () => {
    if (selected === 'none' || !selected) return;
    setAdding(true);
    try {
      await docsAPI.addRequirementLink(docId, Number(selected));
      setSelected('none');
      onChanged();
      toast({ title: t('success'), description: t('docRequirementLinked') });
    } catch (err) {
      toast({ title: t('error'), description: getApiErrorMessage(err, t('failedToLinkRequirement')), variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (requirementId: number) => {
    setRemovingId(requirementId);
    try {
      await docsAPI.removeRequirementLink(docId, requirementId);
      onChanged();
      toast({ title: t('success'), description: t('docRequirementUnlinked') });
    } catch (err) {
      toast({ title: t('error'), description: getApiErrorMessage(err, t('failedToUnlinkRequirement')), variant: 'destructive' });
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="space-y-2 rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-700">
          <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('docLinkRequirement')}
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <SearchableRequirementSelect
              id="docRequirementLink"
              value={selected}
              onChange={setSelected}
              requirements={available}
              className="flex-1"
            />
            <Button onClick={handleAdd} disabled={selected === 'none' || !selected || adding} className="sm:w-auto">
              {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              {t('docLinkRequirementAction')}
            </Button>
          </div>
        </div>
      )}

      {links.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-muted-foreground dark:border-slate-700">
          {t('docNoLinkedRequirements')}
        </div>
      ) : (
        <ul className="space-y-2">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 transition-colors hover:border-primary/40 dark:border-slate-800"
            >
              {projectId ? (
                <Link
                  to={`/projects/${projectId}/requirements/${link.requirement_id}`}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <Badge variant="outline" className="shrink-0 font-mono">{link.requirement_key || `#${link.requirement_id}`}</Badge>
                  <span className="truncate text-sm hover:underline" dir="auto">{link.requirement_title}</span>
                </Link>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Badge variant="outline" className="shrink-0 font-mono">{link.requirement_key || `#${link.requirement_id}`}</Badge>
                  <span className="truncate text-sm" dir="auto">{link.requirement_title}</span>
                </div>
              )}
              {canManage && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-rose-600"
                  onClick={() => handleRemove(link.requirement_id)}
                  disabled={removingId === link.requirement_id}
                  title={t('docUnlinkRequirement')}
                >
                  {removingId === link.requirement_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!canManage && links.length > 0 && (
        <p className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
          <Link2 className="h-3 w-3" />{t('docLinkedRequirementsHint')}
        </p>
      )}
    </div>
  );
}
