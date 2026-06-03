import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { markdownToHtml } from '@/components/ui/content-editor';
import { Badge } from '@/components/ui/badge';
import { sanitizeHtml } from '@/lib/sanitize';
import { docsAPI } from '@/lib/api';
import { useTranslation } from '@/hooks/useTranslation';
import type { DocPublicView } from '@/types';

export function PublicDoc() {
  const { publicId } = useParams<{ publicId: string }>();
  const { t, isRTL } = useTranslation();
  const [doc, setDoc] = useState<DocPublicView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!publicId) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const data = await docsAPI.getPublic(publicId);
        if (!cancelled) setDoc(data);
      } catch {
        if (!cancelled) setDoc(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [publicId]);

  const html = useMemo(() => sanitizeHtml(markdownToHtml(doc?.content_markdown || '')), [doc]);
  const tags = useMemo(() => doc?.tags?.split(',').map((tag) => tag.trim()).filter(Boolean) || [], [doc]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (!doc) {
    return <div className="p-8 text-center text-muted-foreground">{t('docNotFound')}</div>;
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8" dir={isRTL ? 'rtl' : 'ltr'}>
      <h1 className="text-3xl font-bold tracking-tight" dir="auto">{doc.title}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">{t(`docStatus_${doc.status}` as any)}</Badge>
        {doc.classification && <Badge variant="secondary">{doc.classification}</Badge>}
        {tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
        <span>v{doc.current_version}</span>
      </div>
      <div data-rich-text-editor className="mt-6">
        <article
          className="rich-text-preview max-w-none"
          dir={doc.dir === 'rtl' ? 'rtl' : doc.dir === 'ltr' ? 'ltr' : 'auto'}
          style={{ unicodeBidi: 'plaintext', textAlign: 'start' }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </main>
  );
}
