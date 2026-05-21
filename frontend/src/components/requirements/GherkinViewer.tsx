import { Badge } from '@/components/ui/badge';
import { parseGherkin } from '@/components/requirements/gherkin';

interface GherkinViewerProps {
  value: string;
  emptyLabel: string;
}

export function GherkinViewer({ value, emptyLabel }: GherkinViewerProps) {
  const parsed = parseGherkin(value);

  if (!parsed.feature && parsed.blocks.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-indigo-200 bg-indigo-50/70 p-4 dark:border-indigo-900/60 dark:bg-indigo-950/30">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-indigo-600 text-white">Feature</Badge>
          {parsed.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
        </div>
        <h2 className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">{parsed.feature || 'Feature'}</h2>
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
          <h3 className="mt-3 text-lg font-semibold text-slate-950 dark:text-white">{block.title}</h3>

          <ol className="mt-4 space-y-2">
            {block.steps.map((step, stepIndex) => (
              <li key={`${step.keyword}-${stepIndex}`} className="grid gap-2 rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-950 sm:grid-cols-[72px_1fr]">
                <span className="font-mono text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
                  {step.keyword}
                </span>
                <span className="min-w-0 leading-6 text-slate-700 dark:text-slate-300">
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
            <div className="mt-4 overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
              <pre className="min-w-full whitespace-pre p-3 text-xs text-slate-700 dark:text-slate-300">{block.examples.join('\n')}</pre>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
