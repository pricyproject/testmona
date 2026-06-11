import { describe, it, expect } from 'vitest';
import {
  sanitizeInput,
  validateProjectName,
  validateProjectDescription,
  checkDuplicateName,
  validateProject,
  getCharacterCount,
  parsePositiveIntegerParam,
} from '@/utils/validation';

describe('sanitizeInput', () => {
  it('removes script tags', () => {
    expect(sanitizeInput('<script>alert(1)</script>')).toBe('');
  });

  it('removes iframe tags', () => {
    expect(sanitizeInput('<iframe src="evil.com"></iframe>')).toBe('');
  });

  it('removes javascript: protocol', () => {
    expect(sanitizeInput('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
  });

  it('removes event handlers', () => {
    expect(sanitizeInput('<div onclick="evil()">x</div>')).not.toContain('onclick');
  });

  it('preserves safe text', () => {
    expect(sanitizeInput('Hello World')).toBe('Hello World');
  });

  it('trims whitespace', () => {
    expect(sanitizeInput('  hello  ')).toBe('hello');
  });

  it('removes nested script attempts', () => {
    expect(sanitizeInput('<scr<script>ipt>alert(1)</scr</script>ipt>')).not.toContain('alert');
  });
});

describe('parsePositiveIntegerParam', () => {
  it('returns undefined for null/undefined', () => {
    expect(parsePositiveIntegerParam(undefined)).toBeUndefined();
    expect(parsePositiveIntegerParam('')).toBeUndefined();
  });

  it('parses valid positive integers', () => {
    expect(parsePositiveIntegerParam('1')).toBe(1);
    expect(parsePositiveIntegerParam('42')).toBe(42);
  });

  it('returns undefined for zero', () => {
    expect(parsePositiveIntegerParam('0')).toBeUndefined();
  });

  it('returns undefined for negative numbers', () => {
    expect(parsePositiveIntegerParam('-5')).toBeUndefined();
  });

  it('returns undefined for non-integers', () => {
    expect(parsePositiveIntegerParam('3.5')).toBeUndefined();
    expect(parsePositiveIntegerParam('abc')).toBeUndefined();
  });
});

describe('validateProjectName', () => {
  it('rejects empty name', () => {
    expect(validateProjectName('').isValid).toBe(false);
  });

  it('rejects name shorter than 2 characters', () => {
    expect(validateProjectName('A').isValid).toBe(false);
  });

  it('rejects name longer than 100 characters', () => {
    expect(validateProjectName('A'.repeat(101)).isValid).toBe(false);
  });

  it('accepts a valid name', () => {
    expect(validateProjectName('My Project').isValid).toBe(true);
  });

  it('rejects names with emojis', () => {
    expect(validateProjectName('Project 🚀').isValid).toBe(false);
  });

  it('rejects names with invalid special characters', () => {
    expect(validateProjectName('Project<Script>').isValid).toBe(false);
  });

  it('accepts names with allowed punctuation', () => {
    expect(validateProjectName('Project-1 (MVP)').isValid).toBe(true);
    expect(validateProjectName("Developer's API").isValid).toBe(true);
  });

  it('rejects consecutive special characters', () => {
    expect(validateProjectName('My--Project').isValid).toBe(false);
  });
});

describe('validateProjectDescription', () => {
  it('accepts empty description', () => {
    expect(validateProjectDescription('').isValid).toBe(true);
  });

  it('rejects description longer than 500 characters', () => {
    expect(validateProjectDescription('A'.repeat(501)).isValid).toBe(false);
  });

  it('accepts a normal description', () => {
    expect(validateProjectDescription('This is a valid description.').isValid).toBe(true);
  });

  it('warns on emojis but does not hard-fail', () => {
    const result = validateProjectDescription('Description 🎉');
    expect(result.warning).toBeTruthy();
  });
});

describe('checkDuplicateName', () => {
  const existing = [
    { name: 'Alpha', id: 1 },
    { name: 'Beta', id: 2 },
  ];

  it('rejects a duplicate name (case-insensitive)', () => {
    expect(checkDuplicateName('alpha', existing).isValid).toBe(false);
    expect(checkDuplicateName('BETA', existing).isValid).toBe(false);
  });

  it('accepts a unique name', () => {
    expect(checkDuplicateName('Gamma', existing).isValid).toBe(true);
  });

  it('allows same name when editing the same project (currentProjectId)', () => {
    expect(checkDuplicateName('Alpha', existing, 1).isValid).toBe(true);
  });

  it('rejects same name when editing a different project', () => {
    expect(checkDuplicateName('Alpha', existing, 99).isValid).toBe(false);
  });
});

describe('validateProject', () => {
  it('returns isValid true when all fields are valid', () => {
    const result = validateProject('Good Name', 'A description', []);
    expect(result.isValid).toBe(true);
    expect(result.name.isValid).toBe(true);
    expect(result.description.isValid).toBe(true);
  });

  it('returns isValid false when name is too short', () => {
    const result = validateProject('A', 'desc', []);
    expect(result.isValid).toBe(false);
    expect(result.name.isValid).toBe(false);
  });

  it('detects duplicate name in existing projects', () => {
    const result = validateProject('Existing', 'desc', [{ name: 'Existing', id: 5 }]);
    expect(result.isValid).toBe(false);
  });
});

describe('getCharacterCount', () => {
  it('counts characters after sanitization', () => {
    const result = getCharacterCount('Hello', 100);
    expect(result.current).toBe(5);
    expect(result.remaining).toBe(95);
    expect(result.isOverLimit).toBe(false);
  });

  it('detects over-limit', () => {
    const result = getCharacterCount('A'.repeat(101), 100);
    expect(result.isOverLimit).toBe(true);
    expect(result.percentage).toBe(100);
  });

  it('percentage caps at 100 when over limit', () => {
    const result = getCharacterCount('A'.repeat(200), 100);
    expect(result.percentage).toBe(100);
  });
});
