export type GherkinStep = {
  keyword: string;
  text: string;
  argument: string[];
};

export type GherkinBlock = {
  type: 'Background' | 'Scenario' | 'Scenario Outline';
  title: string;
  tags: string[];
  steps: GherkinStep[];
  examples: string[];
};

export type ParsedGherkin = {
  feature: string;
  description: string[];
  tags: string[];
  blocks: GherkinBlock[];
};

const KEYWORDS = ['Given', 'When', 'Then', 'And', 'But'];

export const isGherkinText = (value?: string | null): boolean =>
  Boolean(value && /^\s*(Feature|Rule|Background|Scenario|Scenario Outline|Given|When|Then|And|But):?\b/im.test(value));

export const parseGherkin = (value: string): ParsedGherkin => {
  const parsed: ParsedGherkin = {
    feature: '',
    description: [],
    tags: [],
    blocks: [],
  };

  let pendingTags: string[] = [];
  let currentBlock: GherkinBlock | null = null;
  let currentStep: GherkinStep | null = null;
  let inExamples = false;
  let inDocString = false;

  value.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;

    if (line.startsWith('@')) {
      pendingTags = line.split(/\s+/).filter(Boolean);
      if (!parsed.feature && parsed.tags.length === 0) parsed.tags = pendingTags;
      return;
    }

    const featureMatch = line.match(/^Feature:\s*(.*)$/i);
    if (featureMatch) {
      parsed.feature = featureMatch[1]?.trim() || 'Feature';
      parsed.tags = pendingTags;
      pendingTags = [];
      currentBlock = null;
      currentStep = null;
      inExamples = false;
      return;
    }

    // 'Rule:' groups scenarios but is not itself a scenario — reset the
    // current block so its following lines are not mis-attached as steps.
    if (/^Rule:/i.test(line)) {
      parsed.tags = parsed.tags.length ? parsed.tags : pendingTags;
      pendingTags = [];
      currentBlock = null;
      currentStep = null;
      inExamples = false;
      return;
    }

    const blockMatch = line.match(/^(Background|Scenario Outline|Scenario|Example):\s*(.*)$/i);
    if (blockMatch) {
      const blockType = blockMatch[1].toLowerCase() === 'background'
        ? 'Background'
        : blockMatch[1].toLowerCase() === 'scenario outline'
          ? 'Scenario Outline'
          : 'Scenario';
      currentBlock = {
        type: blockType,
        title: blockMatch[2]?.trim() || blockType,
        tags: pendingTags,
        steps: [],
        examples: [],
      };
      parsed.blocks.push(currentBlock);
      pendingTags = [];
      currentStep = null;
      inExamples = false;
      return;
    }

    // Accept named Examples too (e.g. `Examples: happy path`).
    if (/^Examples:/i.test(line)) {
      inExamples = true;
      currentStep = null;
      return;
    }

    if (line.startsWith('"""') || line.startsWith('```')) {
      inDocString = !inDocString;
      if (currentStep) currentStep.argument.push(line);
      return;
    }

    if ((inDocString || line.startsWith('|')) && currentStep) {
      currentStep.argument.push(line);
      return;
    }

    const stepKeyword = KEYWORDS.find((keyword) => line.toLowerCase().startsWith(`${keyword.toLowerCase()} `));
    if (stepKeyword && currentBlock) {
      currentStep = {
        keyword: stepKeyword,
        text: line.slice(stepKeyword.length).trim(),
        argument: [],
      };
      currentBlock.steps.push(currentStep);
      inExamples = false;
      return;
    }

    if (inExamples && currentBlock) {
      currentBlock.examples.push(line);
      return;
    }

    if (currentBlock) {
      currentStep = { keyword: 'And', text: line, argument: [] };
      currentBlock.steps.push(currentStep);
      return;
    }

    parsed.description.push(line);
  });

  return parsed;
};

// ---------------------------------------------------------------------------
// Authoring helpers used by the interactive Gherkin editor
// ---------------------------------------------------------------------------

const STEP_KEYWORD_RE = /^(Given|When|Then|And|But|\*)\b\s*(.*)$/i;
const BLOCK_KEYWORD_RE = /^(Background|Scenario Outline|Scenario|Example|Rule):\s*(.*)$/i;
const FENCE_RE = /^("""|```)/;

const splitTableCells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

/**
 * Re-indent a Gherkin document to the canonical two-space ladder
 * (Feature → 0, Scenario/Background → 2, steps/Examples → 4, tables/doc
 * strings → 6) and pretty-print pipe tables with aligned columns. Doc-string
 * bodies are preserved verbatim so embedded payloads keep their formatting.
 */
export const formatGherkin = (value: string): string => {
  if (!value.trim()) return value;
  const FEATURE = '';
  const BLOCK = '  ';
  const STEP = '    ';
  const INNER = '      ';

  const lines = value.replace(/\t/g, '  ').split(/\r?\n/);
  const out: string[] = [];
  let featureSeen = false;
  let inDoc = false;
  let tableBuffer: string[] = [];

  const flushTable = () => {
    if (tableBuffer.length === 0) return;
    const rows = tableBuffer.map(splitTableCells);
    const colCount = Math.max(...rows.map((row) => row.length));
    const widths = Array.from({ length: colCount }, (_, col) =>
      Math.max(...rows.map((row) => (row[col] || '').length))
    );
    rows.forEach((row) => {
      const cells = widths.map((width, col) => (row[col] || '').padEnd(width));
      out.push(`${INNER}| ${cells.join(' | ')} |`);
    });
    tableBuffer = [];
  };

  for (const raw of lines) {
    const trimmed = raw.trim();

    if (inDoc) {
      if (FENCE_RE.test(trimmed)) {
        out.push(`${INNER}${trimmed}`);
        inDoc = false;
      } else {
        out.push(raw.replace(/\s+$/, ''));
      }
      continue;
    }

    if (trimmed.startsWith('|')) {
      tableBuffer.push(trimmed);
      continue;
    }
    flushTable();

    if (!trimmed) {
      out.push('');
      continue;
    }
    if (FENCE_RE.test(trimmed)) {
      out.push(`${INNER}${trimmed}`);
      inDoc = true;
      continue;
    }
    if (trimmed.startsWith('#') || trimmed.startsWith('@')) {
      out.push(`${featureSeen ? BLOCK : FEATURE}${trimmed}`);
      continue;
    }
    if (/^Feature:/i.test(trimmed)) {
      featureSeen = true;
      out.push(`${FEATURE}${trimmed}`);
      continue;
    }
    if (/^Examples:/i.test(trimmed)) {
      out.push(`${STEP}${trimmed}`);
      continue;
    }
    if (BLOCK_KEYWORD_RE.test(trimmed)) {
      out.push(`${BLOCK}${trimmed}`);
      continue;
    }
    if (STEP_KEYWORD_RE.test(trimmed)) {
      out.push(`${STEP}${trimmed}`);
      continue;
    }
    out.push(`${featureSeen ? STEP : BLOCK}${trimmed}`);
  }
  flushTable();

  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
};

export type GherkinIssueCode =
  | 'noFeature'
  | 'stepOutsideScenario'
  | 'emptyScenario'
  | 'outlineNoExamples'
  | 'examplesMismatch'
  | 'conjunctionFirst'
  | 'undefinedPlaceholder';

export interface GherkinIssue {
  line: number; // 1-based line number the issue points at
  severity: 'error' | 'warning';
  code: GherkinIssueCode;
  params?: Record<string, string | number>;
}

interface LintBlock {
  type: string;
  title: string;
  line: number;
  steps: number;
  hasExamples: boolean;
  inExamples: boolean;
  exampleCols: number | null;
  exampleHeader: string[] | null;
  placeholders: Map<string, number>;
}

/**
 * Lightweight Gherkin linter — surfaces the mistakes that silently break a
 * BDD spec (missing Feature, steps outside a scenario, empty scenarios,
 * outlines without Examples, ragged Examples tables, scenarios that open with
 * And/But, and outline placeholders with no matching Examples column).
 */
export const lintGherkin = (value: string): GherkinIssue[] => {
  const issues: GherkinIssue[] = [];
  if (!value.trim()) return issues;

  const lines = value.split(/\r?\n/);
  let featureSeen = false;
  let inDoc = false;
  let block: LintBlock | null = null;

  const finishBlock = () => {
    if (!block) return;
    const isScenario = /scenario|example/i.test(block.type);
    if (isScenario && block.steps === 0) {
      issues.push({ line: block.line, severity: 'warning', code: 'emptyScenario', params: { title: block.title || block.type } });
    }
    if (/outline/i.test(block.type) && !block.hasExamples) {
      issues.push({ line: block.line, severity: 'warning', code: 'outlineNoExamples', params: { title: block.title || block.type } });
    }
    if (/outline/i.test(block.type) && block.exampleHeader) {
      const header = new Set(block.exampleHeader);
      block.placeholders.forEach((lineNo, name) => {
        if (!header.has(name)) {
          issues.push({ line: lineNo, severity: 'warning', code: 'undefinedPlaceholder', params: { name } });
        }
      });
    }
    block = null;
  };

  lines.forEach((raw, index) => {
    const lineNo = index + 1;
    const trimmed = raw.trim();

    if (inDoc) {
      if (FENCE_RE.test(trimmed)) inDoc = false;
      return;
    }
    if (FENCE_RE.test(trimmed)) {
      inDoc = true;
      return;
    }
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('@')) return;

    if (/^Feature:/i.test(trimmed)) {
      featureSeen = true;
      finishBlock();
      return;
    }
    if (/^Rule:/i.test(trimmed)) {
      finishBlock();
      return;
    }

    const blockMatch = trimmed.match(BLOCK_KEYWORD_RE);
    if (blockMatch) {
      finishBlock();
      block = {
        type: blockMatch[1],
        title: (blockMatch[2] || '').trim(),
        line: lineNo,
        steps: 0,
        hasExamples: false,
        inExamples: false,
        exampleCols: null,
        exampleHeader: null,
        placeholders: new Map(),
      };
      return;
    }

    if (/^Examples:/i.test(trimmed)) {
      if (block) {
        block.hasExamples = true;
        block.inExamples = true;
        block.exampleCols = null;
      }
      return;
    }

    if (trimmed.startsWith('|')) {
      const cells = splitTableCells(trimmed);
      if (block && block.inExamples) {
        if (block.exampleCols === null) {
          block.exampleCols = cells.length;
          block.exampleHeader = cells;
        } else if (cells.length !== block.exampleCols) {
          issues.push({ line: lineNo, severity: 'warning', code: 'examplesMismatch', params: { got: cells.length, want: block.exampleCols } });
        }
      }
      return;
    }
    if (block) block.inExamples = false;

    const stepMatch = trimmed.match(STEP_KEYWORD_RE);
    if (stepMatch) {
      if (!block) {
        issues.push({ line: lineNo, severity: 'error', code: 'stepOutsideScenario' });
        return;
      }
      block.steps += 1;
      if (block.steps === 1 && /^(and|but)$/i.test(stepMatch[1])) {
        issues.push({ line: lineNo, severity: 'warning', code: 'conjunctionFirst', params: { title: block.title || block.type } });
      }
      const placeholders = (stepMatch[2] || '').match(/<([^<>]+)>/g);
      if (placeholders) {
        placeholders.forEach((token) => {
          const name = token.slice(1, -1);
          if (!block!.placeholders.has(name)) block!.placeholders.set(name, lineNo);
        });
      }
    }
  });

  finishBlock();
  if (!featureSeen) issues.unshift({ line: 1, severity: 'warning', code: 'noFeature' });
  return issues;
};

export interface GherkinSummary {
  scenarios: number;
  steps: number;
}

/** Count scenarios (excluding Background) and total steps for the status bar. */
export const summarizeGherkin = (value: string): GherkinSummary => {
  const parsed = parseGherkin(value);
  const scenarioBlocks = parsed.blocks.filter((blockItem) => blockItem.type !== 'Background');
  const steps = parsed.blocks.reduce((total, blockItem) => total + blockItem.steps.length, 0);
  return { scenarios: scenarioBlocks.length, steps };
};
