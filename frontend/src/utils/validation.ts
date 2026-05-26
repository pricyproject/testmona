// Project validation utilities
export interface ValidationResult {
  isValid: boolean;
  error?: string;
  warning?: string;
}

// XSS prevention - sanitize input by removing dangerous HTML tags and attributes
// Allows safe formatting tags like <b>, <i>, <u>, <p>, <br>, <strong>, <em>, etc.
export const sanitizeInput = (input: string): string => {
  let previous: string;
  let sanitized = input;

  do {
    previous = sanitized;
    sanitized = sanitized
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '') // Remove iframe tags
      .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '') // Remove object tags
      .replace(/<embed\b[^>]*>/gi, '') // Remove embed tags
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/data:/gi, '') // Remove data: protocol
      .replace(/vbscript:/gi, '') // Remove vbscript: protocol
      .replace(/on\w+\s*=/gi, '') // Remove event handlers like onclick, onload, etc.
      .trim();
  } while (sanitized !== previous);

  return sanitized;
};

// Check if project name already exists
export const checkDuplicateName = (name: string, existingProjects: Array<{ name: string; id?: number }>, currentProjectId?: number): ValidationResult => {
  const sanitizedName = sanitizeInput(name).toLowerCase();
  const duplicate = existingProjects.find(
    project => project.name.toLowerCase() === sanitizedName && project.id !== currentProjectId
  );
  
  if (duplicate) {
    return {
      isValid: false,
      error: 'A project with this name already exists'
    };
  }
  
  return { isValid: true };
};

// Validate project name for special characters and length
export const validateProjectName = (name: string): ValidationResult => {
  const sanitizedName = sanitizeInput(name);
  
  if (!sanitizedName) {
    return {
      isValid: false,
      error: 'Project name is required'
    };
  }
  
  if (sanitizedName.length < 2) {
    return {
      isValid: false,
      error: 'Project name must be at least 2 characters long'
    };
  }
  
  if (sanitizedName.length > 100) {
    return {
      isValid: false,
      error: 'Project name cannot exceed 100 characters'
    };
  }
  
  // Check for emojis and special characters (allow basic punctuation)
  const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;
  if (emojiRegex.test(sanitizedName)) {
    return {
      isValid: false,
      error: 'Project name cannot contain emojis'
    };
  }
  
  // Allow letters, numbers, spaces, hyphens, underscores, and basic punctuation
  const validCharRegex = /^[a-zA-Z0-9\s\-_.,()[\]{}'"+:;!?&@#%]+$/;
  if (!validCharRegex.test(sanitizedName)) {
    return {
      isValid: false,
      error: 'Project name contains invalid special characters'
    };
  }
  
  // Check for consecutive special characters
  const consecutiveSpecialRegex = /[^\w\s]{2,}/;
  if (consecutiveSpecialRegex.test(sanitizedName)) {
    return {
      isValid: false,
      error: 'Project name cannot contain consecutive special characters'
    };
  }
  
  return { isValid: true };
};

// Validate project description
export const validateProjectDescription = (description: string): ValidationResult => {
  const sanitizedDescription = sanitizeInput(description);
  
  if (sanitizedDescription.length > 500) {
    return {
      isValid: false,
      error: 'Project description cannot exceed 500 characters'
    };
  }
  
  // Check for emojis in description
  const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;
  if (emojiRegex.test(sanitizedDescription)) {
    return {
      isValid: false,
      warning: 'Emojis in description may not display correctly everywhere'
    };
  }
  
  return { isValid: true };
};

// Comprehensive project validation
export const validateProject = (
  name: string,
  description: string,
  existingProjects: Array<{ name: string; id?: number }>,
  currentProjectId?: number
): {
  name: ValidationResult;
  description: ValidationResult;
  isValid: boolean;
} => {
  const nameValidation = validateProjectName(name);
  const duplicateCheck = nameValidation.isValid ? checkDuplicateName(name, existingProjects, currentProjectId) : { isValid: true };
  const descriptionValidation = validateProjectDescription(description);
  
  return {
    name: duplicateCheck.isValid ? nameValidation : duplicateCheck,
    description: descriptionValidation,
    isValid: nameValidation.isValid && duplicateCheck.isValid && descriptionValidation.isValid
  };
};

// Get character count feedback
export const getCharacterCount = (text: string, maxLength: number) => {
  const length = sanitizeInput(text).length;
  return {
    current: length,
    remaining: maxLength - length,
    isOverLimit: length > maxLength,
    percentage: Math.min((length / maxLength) * 100, 100)
  };
};
