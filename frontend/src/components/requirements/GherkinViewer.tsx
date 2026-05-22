import { Badge } from '@/components/ui/badge';
import { parseGherkin } from '@/components/requirements/gherkin';

interface GherkinViewerProps {
  value: string;
  emptyLabel: string;
}

const getStepKeywordTone = (keyword: string): string => {
  switch (keyword.toLowerCase()) {
    case 'given':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
    case 'when':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
    case 'then':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
    default:
      return 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  }
};

export function GherkinViewer({ value, emptyLabel }: GherkinViewerProps) {
  const parsed = parseGherkin(value);

  if (!parsed.feature && parsed.blocks.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-indigo-200 bg-indigo-50/70 p-4 dark:border-indigo-900/60 dark:bg-indigo-950/30">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-indigo-600 text-white hover:bg-indigo-600">Feature</Badge>
          {parsed.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
        </div>
        <h3 className="mt-3 break-words text-lg font-semibold text-slate-950 dark:text-white">{parsed.feature || 'Feature'}</h3>
        {parsed.description.length > 0 && (
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">
            {parsed.description.join('\n')}
          </p>
        )}
      </div>

      {parsed.blocks.map((block, index) => (
        <section key={`${block.type}-${block.title}-${index}`} className="rounded-md border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={block.type === 'Background' ? 'secondary' : 'outline'}>{block.type}</Badge>
            {block.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
          </div>
          <h4 className="mt-3 break-words text-base font-semibold text-slate-950 dark:text-white">{block.title}</h4>

          <ol className="mt-3 space-y-1.5">
            {block.steps.map((step, stepIndex) => (
              <li key={`${step.keyword}-${stepIndex}`} className="flex flex-col gap-2 rounded-md bg-slate-50 p-2.5 text-sm dark:bg-slate-950/60 sm:flex-row sm:items-start sm:gap-3">
                <span className={`inline-flex shrink-0 items-center justify-center rounded px-2 py-0.5 font-mono text-xs font-semibold uppercase tracking-wide sm:w-16 ${getStepKeywordTone(step.keyword)}`}>
                  {step.keyword}
                </span>
                <span className="min-w-0 break-words leading-6 text-slate-700 [overflow-wrap:anywhere] dark:text-slate-300">
                  {step.text}
                  {step.argument.length > 0 && (
                    <pre className="mt-2 overflow-x-auto rounded-md border border-slate-200 bg-white p-2 text-xs leading-5 dark:border-slate-800 dark:bg-slate-900">
                      {step.argument.join('\n')}
                    </pre>
                  )}
                </span>
              </li>
            ))}
          </ol>

          {block.examples.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
              <pre className="min-w-full whitespace-pre p-3 text-xs leading-5 text-slate-700 dark:text-slate-300">{block.examples.join('\n')}</pre>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
