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

    const blockMatch = line.match(/^(Background|Scenario Outline|Scenario):\s*(.*)$/i);
    if (blockMatch) {
      const blockType = blockMatch[1].toLowerCase() === 'background'
        ? 'Background'
        : blockMatch[1].toLowerCase() === 'scenario outline-solid'
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

    if (/^Examples:\s*$/i.test(line)) {
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
