import { describe, it, expect } from 'vitest';
import {
  isGherkinText,
  parseGherkin,
  formatGherkin,
  lintGherkin,
  summarizeGherkin,
} from '@/components/requirements/gherkin';

// ---------------------------------------------------------------------------
// Sample fixtures
// ---------------------------------------------------------------------------

const SIMPLE_FEATURE = `Feature: Login

  Scenario: Successful login
    Given I am on the login page
    When I enter valid credentials
    Then I should be logged in`;

// ---------------------------------------------------------------------------
// isGherkinText
// ---------------------------------------------------------------------------

describe('isGherkinText', () => {
  it('detects Feature keyword', () => expect(isGherkinText('Feature: My feature')).toBe(true));
  it('detects Scenario keyword', () => expect(isGherkinText('Scenario: My scenario')).toBe(true));
  it('detects Given keyword', () => expect(isGherkinText('Given I am logged in')).toBe(true));
  it('detects When keyword', () => expect(isGherkinText('When I click Submit')).toBe(true));
  it('detects Then keyword', () => expect(isGherkinText('Then I see a success message')).toBe(true));
  it('detects Background keyword', () => expect(isGherkinText('Background:')).toBe(true));
  it('is case-insensitive', () => expect(isGherkinText('feature: Foo')).toBe(true));
  it('returns false for plain prose', () => expect(isGherkinText('This is just a description')).toBe(false));
  it('returns false for null', () => expect(isGherkinText(null)).toBe(false));
  it('returns false for undefined', () => expect(isGherkinText(undefined)).toBe(false));
  it('returns false for empty string', () => expect(isGherkinText('')).toBe(false));
});

// ---------------------------------------------------------------------------
// parseGherkin
// ---------------------------------------------------------------------------

describe('parseGherkin', () => {
  it('extracts the feature title', () => {
    expect(parseGherkin(SIMPLE_FEATURE).feature).toBe('Login');
  });

  it('parses a single Scenario block', () => {
    const result = parseGherkin(SIMPLE_FEATURE);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe('Scenario');
    expect(result.blocks[0].title).toBe('Successful login');
  });

  it('parses steps with the correct keywords', () => {
    const steps = parseGherkin(SIMPLE_FEATURE).blocks[0].steps;
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ keyword: 'Given', text: 'I am on the login page' });
    expect(steps[1]).toMatchObject({ keyword: 'When', text: 'I enter valid credentials' });
    expect(steps[2]).toMatchObject({ keyword: 'Then', text: 'I should be logged in' });
  });

  it('parses feature-level tags', () => {
    const text = '@smoke @regression\nFeature: Tagged\n  Scenario: S\n    Given step';
    const result = parseGherkin(text);
    expect(result.tags).toContain('@smoke');
    expect(result.tags).toContain('@regression');
  });

  it('parses a Background block', () => {
    const text = 'Feature: BG\n  Background:\n    Given setup\n  Scenario: S\n    When action';
    const bg = parseGherkin(text).blocks.find((b) => b.type === 'Background');
    expect(bg).toBeDefined();
    expect(bg!.steps[0].keyword).toBe('Given');
  });

  it('parses Scenario Outline with Examples', () => {
    const text = [
      'Feature: Outline',
      '  Scenario Outline: With <value>',
      '    Given value is <value>',
      '  Examples:',
      '    | value |',
      '    | 1     |',
    ].join('\n');
    const result = parseGherkin(text);
    expect(result.blocks[0].type).toBe('Scenario Outline');
    expect(result.blocks[0].examples.length).toBeGreaterThan(0);
  });

  it('ignores comment lines', () => {
    const text = 'Feature: Comments\n  # This is a comment\n  Scenario: S\n    Given step';
    expect(parseGherkin(text).blocks[0].steps).toHaveLength(1);
  });

  it('returns empty feature and no blocks for empty input', () => {
    const result = parseGherkin('');
    expect(result.feature).toBe('');
    expect(result.blocks).toHaveLength(0);
  });

  it('handles multiple scenarios', () => {
    const text = [
      'Feature: Multi',
      '  Scenario: A',
      '    Given A',
      '  Scenario: B',
      '    Given B',
    ].join('\n');
    expect(parseGherkin(text).blocks).toHaveLength(2);
  });

  it('Rule keyword resets the current block', () => {
    const text = [
      'Feature: With Rule',
      '  Rule: Group',
      '  Scenario: Inside rule',
      '    Given step',
    ].join('\n');
    const result = parseGherkin(text);
    expect(result.blocks[0].title).toBe('Inside rule');
  });
});

// ---------------------------------------------------------------------------
// formatGherkin
// ---------------------------------------------------------------------------

describe('formatGherkin', () => {
  it('returns unchanged input for whitespace-only strings', () => {
    expect(formatGherkin('   ')).toBe('   ');
  });

  it('normalises Feature to zero indentation', () => {
    expect(formatGherkin('  Feature: My Feature')).toMatch(/^Feature:/);
  });

  it('indents Scenario to 2 spaces', () => {
    const out = formatGherkin('Feature: F\nScenario: S\nGiven step');
    expect(out).toContain('  Scenario: S');
  });

  it('indents steps to 4 spaces', () => {
    const out = formatGherkin('Feature: F\nScenario: S\nGiven step');
    expect(out).toContain('    Given step');
  });

  it('indents Examples to 4 spaces', () => {
    const out = formatGherkin('Feature: F\nScenario Outline: S\nGiven <v>\nExamples:\n| v |\n| 1 |');
    expect(out).toContain('    Examples:');
  });

  it('aligns pipe-table columns so both rows have equal width', () => {
    const out = formatGherkin('Feature: F\nScenario: S\nGiven a table\n| col |\n| val |');
    const rows = out.split('\n').filter((l) => l.includes('|'));
    expect(rows).toHaveLength(2);
    expect(rows[0].length).toBe(rows[1].length);
  });

  it('converts tabs to spaces', () => {
    const out = formatGherkin('Feature: F\n\tScenario: S\n\t\tGiven step');
    expect(out).not.toContain('\t');
  });

  it('strips trailing blank lines', () => {
    const out = formatGherkin('Feature: F\nScenario: S\nGiven step\n\n\n');
    expect(out).not.toMatch(/\n\s*$/);
  });
});

// ---------------------------------------------------------------------------
// lintGherkin
// ---------------------------------------------------------------------------

describe('lintGherkin', () => {
  it('returns no issues for valid Gherkin', () => {
    expect(lintGherkin(SIMPLE_FEATURE)).toEqual([]);
  });

  it('returns no issues for empty input', () => {
    expect(lintGherkin('')).toEqual([]);
  });

  it('warns (noFeature) when the Feature keyword is missing', () => {
    const issues = lintGherkin('Scenario: S\n  Given step');
    expect(issues.some((i) => i.code === 'noFeature')).toBe(true);
  });

  it('raises an error (stepOutsideScenario) for a step before any Scenario block', () => {
    const issues = lintGherkin('Feature: F\nGiven orphan step');
    const issue = issues.find((i) => i.code === 'stepOutsideScenario');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('error');
  });

  it('warns (emptyScenario) for a Scenario with no steps', () => {
    const issues = lintGherkin('Feature: F\n  Scenario: Empty');
    expect(issues.some((i) => i.code === 'emptyScenario')).toBe(true);
  });

  it('warns (outlineNoExamples) for Scenario Outline without an Examples table', () => {
    const issues = lintGherkin('Feature: F\n  Scenario Outline: No examples\n    Given <value>');
    expect(issues.some((i) => i.code === 'outlineNoExamples')).toBe(true);
  });

  it('warns (conjunctionFirst) when And opens a scenario', () => {
    const issues = lintGherkin('Feature: F\n  Scenario: S\n    And step without prior');
    expect(issues.some((i) => i.code === 'conjunctionFirst')).toBe(true);
  });

  it('warns (conjunctionFirst) when But opens a scenario', () => {
    const issues = lintGherkin('Feature: F\n  Scenario: S\n    But step without prior');
    expect(issues.some((i) => i.code === 'conjunctionFirst')).toBe(true);
  });

  it('warns (undefinedPlaceholder) when a placeholder has no matching Examples column', () => {
    const text = [
      'Feature: F',
      '  Scenario Outline: With <missing>',
      '    Given value is <missing>',
      '  Examples:',
      '    | other |',
      '    | val   |',
    ].join('\n');
    expect(lintGherkin(text).some((i) => i.code === 'undefinedPlaceholder')).toBe(true);
  });

  it('does NOT warn undefinedPlaceholder when the placeholder exists in Examples', () => {
    const text = [
      'Feature: F',
      '  Scenario Outline: With <value>',
      '    Given value is <value>',
      '  Examples:',
      '    | value |',
      '    | 1     |',
    ].join('\n');
    expect(lintGherkin(text).some((i) => i.code === 'undefinedPlaceholder')).toBe(false);
  });

  it('warns (examplesMismatch) when an Examples data row has different column count', () => {
    const text = [
      'Feature: F',
      '  Scenario Outline: S',
      '    Given <a> and <b>',
      '  Examples:',
      '    | a | b |',
      '    | 1 |',
    ].join('\n');
    expect(lintGherkin(text).some((i) => i.code === 'examplesMismatch')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// summarizeGherkin
// ---------------------------------------------------------------------------

describe('summarizeGherkin', () => {
  it('counts one scenario and three steps for the simple fixture', () => {
    const result = summarizeGherkin(SIMPLE_FEATURE);
    expect(result.scenarios).toBe(1);
    expect(result.steps).toBe(3);
  });

  it('returns zeros for empty input', () => {
    const result = summarizeGherkin('');
    expect(result.scenarios).toBe(0);
    expect(result.steps).toBe(0);
  });

  it('excludes Background from the scenario count', () => {
    const text = [
      'Feature: F',
      '  Background:',
      '    Given setup',
      '  Scenario: One',
      '    When action',
      '  Scenario: Two',
      '    Then result',
    ].join('\n');
    const result = summarizeGherkin(text);
    expect(result.scenarios).toBe(2);
    expect(result.steps).toBe(3); // setup + action + result
  });

  it('counts steps across multiple scenarios', () => {
    const text = [
      'Feature: Multi',
      '  Scenario: A',
      '    Given one',
      '    When two',
      '  Scenario: B',
      '    Then three',
    ].join('\n');
    expect(summarizeGherkin(text).steps).toBe(3);
  });
});
