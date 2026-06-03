import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Link2, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { docsAPI } from '@/lib/api';
import type { DocRelatedLink, DocSuggestion } from '@/types';

interface Props {
  docId: number;
  canEdit: boolean;
}

const docHref = (projectId: number | null | undefined, id: number) =>
  projectId ? `/projects/${projectId}/docs/${id}` : `/docs/${id}`;

/**
 * Bottom-of-page section combining manually-linked **related** docs with smart,
 * auto-computed **suggested** docs (tag/title/body similarity). Self-contained:
 * it owns its own loading + add/remove so the detail page just drops it in.
 */
export function DocRelatedSection({ docId, canEdit }: Props) {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const [related, setRelated] = useState<DocRelatedLink[]>([]);
  const [suggestions, setSuggestions] = useState<DocSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [rel, sug] = await Promise.all([
      docsAPI.listRelated(docId).catch(() => []),
      docsAPI.suggestions(docId, 6).catch(() => []),
    ]);
    setRelated(rel);
    setSuggestions(sug);
    setLoading(false);
  }, [docId]);

  useEffect(() => { load(); }, [load]);

  const addRelated = async (relatedDocId: number) => {
    try {
      setBusyId(relatedDocId);
      await docsAPI.addRelated(docId, relatedDocId);
      // Drop it from suggestions immediately, then refresh both lists.
      setSuggestions((items) => items.filter((s) => s.id !== relatedDocId));
      const [rel, sug] = await Promise.all([docsAPI.listRelated(docId), docsAPI.suggestions(docId, 6)]);
      setRelated(rel);
      setSuggestions(sug);
    } catch (e: any) {
      toast({ title: t('error'), description: e?.response?.data?.detail || t('docRelatedFailed'), variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const removeRelated = async (relatedDocId: number) => {
    try {
      setBusyId(relatedDocId);
      await docsAPI.removeRelated(docId, relatedDocId);
      setRelated((items) => items.filter((r) => r.related_doc_id !== relatedDocId));
      // It may resurface as a suggestion now that it's unlinked.
      docsAPI.suggestions(docId, 6).then(setSuggestions).catch(() => undefined);
    } catch (e: any) {
      toast({ title: t('error'), description: e?.response?.data?.detail || t('docRelatedFailed'), variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="mt-10 flex items-center gap-2 border-t border-slate-200 pt-6 text-sm text-muted-foreground dark:border-slate-800">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
      </div>
    );
  }

  if (related.length === 0 && suggestions.length === 0) return null;

  return (
    <section className="mt-10 space-y-6 border-t border-slate-200 pt-6 dark:border-slate-800" dir={isRTL ? 'rtl' : 'ltr'}>
      {related.length > 0 && (
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Link2 className="h-4 w-4 text-primary" /> {t('docRelatedDocs')}
            <Badge variant="secondary">{related.length}</Badge>
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {related.map((link) => (
              <li key={link.id} className="group relative">
                <Link
                  to={docHref(link.related_doc_project_id, link.related_doc_id)}
                  className="flex h-full items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">
                    {link.related_doc_title || `#${link.related_doc_id}`}
                  </span>
                </Link>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => void removeRelated(link.related_doc_id)}
                    disabled={busyId === link.related_doc_id}
                    title={t('remove')}
                    className={`absolute top-2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 dark:hover:bg-rose-950 ${isRTL ? 'left-2' : 'right-2'}`}
                  >
                    {busyId === link.related_doc_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {suggestions.length > 0 && (
        <div>
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" /> {t('docSuggestedDocs')}
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">{t('docSuggestedHint')}</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {suggestions.map((sug) => (
              <li key={sug.id}>
                <div className="flex h-full flex-col rounded-lg border border-slate-200 bg-white p-3 transition-all hover:border-primary/40 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <Link to={docHref(sug.project_id, sug.id)} className="group flex items-start gap-2">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium group-hover:text-primary" dir="auto">{sug.title}</span>
                      {sug.excerpt && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground" dir="auto">{sug.excerpt}</span>}
                    </span>
                  </Link>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {sug.matched_tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">#{tag}</Badge>
                    ))}
                    {sug.classification && <Badge variant="outline" className="text-[10px]">{sug.classification}</Badge>}
                    <span className="flex-1" />
                    {canEdit && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-primary hover:bg-primary/10"
                        disabled={busyId === sug.id}
                        onClick={() => void addRelated(sug.id)}
                      >
                        {busyId === sug.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className={`h-3.5 w-3.5 ${isRTL ? 'ml-1' : 'mr-1'}`} />}
                        {t('docAddRelated')}
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
