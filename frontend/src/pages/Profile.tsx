import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';
import { useTranslation } from '@/hooks/useTranslation';
import { User, Mail, Calendar, Shield, Edit2, Save, X, AlertCircle, CheckCircle2, Undo, Redo, Lock, Camera, Trash2, Key, Upload, Download } from 'lucide-react';
import { PasswordChangeDialog } from '@/components/Profile/PasswordChangeDialog';
import { AccountDeleteDialog } from '@/components/Profile/AccountDeleteDialog';
import { TwoFactorDialog } from '@/components/Profile/TwoFactorDialog';
import { apiCallWithRetry, isOnline, setupNetworkListeners, removeNetworkListeners, validateApiResponse, acquireEditLock, releaseEditLock, checkEditLock, safeUserData, TIMEOUT_CONFIG } from '@/utils/apiHelpers';

// Validation constants
const FIELD_LIMITS = {
  username: { min: 3, max: 30 },
  email: { max: 255 },
  full_name: { max: 100 },
  bio: { max: 500 },
  location: { max: 100 },
  website: { max: 255 },
  company: { max: 100 }
};

const RESERVED_USERNAMES = [
  'admin', 'administrator', 'root', 'system', 'api', 'www', 'mail',
  'ftp', 'localhost', 'test', 'demo', 'guest', 'user', 'users',
  'support', 'help', 'info', 'contact', 'sales', 'marketing',
  'billing', 'account', 'accounts', 'login', 'logout', 'register',
  'signup', 'signin', 'auth', 'authentication', 'password', 'reset',
  'verify', 'confirm', 'settings', 'profile', 'dashboard', 'home',
  'about', 'terms', 'privacy', 'legal', 'copyright', 'license'
];

// XSS sanitization function
const sanitizeInput = (input: string): string => {
  if (!input) return input;
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
};

// Validation functions
const validateUsername = (username: string, t: any): { valid: boolean; error?: string } => {
  if (!username || username.trim().length === 0) {
    return { valid: false, error: t('usernameRequired') };
  }
  
  if (username.length < FIELD_LIMITS.username.min) {
    return { valid: false, error: t('usernameMinLength', { min: FIELD_LIMITS.username.min }) };
  }
  
  if (username.length > FIELD_LIMITS.username.max) {
    return { valid: false, error: t('usernameMaxLength', { max: FIELD_LIMITS.username.max }) };
  }
  
  // Check allowed characters (alphanumeric, underscores, hyphens)
  const usernameRegex = /^[a-zA-Z0-9_-]+$/;
  if (!usernameRegex.test(username)) {
    return { valid: false, error: t('usernameInvalidChars') };
  }
  
  // Check reserved words
  const lowerUsername = username.toLowerCase();
  if (RESERVED_USERNAMES.includes(lowerUsername)) {
    return { valid: false, error: t('usernameReserved') };
  }
  
  // Check if starts with reserved word
  if (RESERVED_USERNAMES.some(reserved => lowerUsername.startsWith(reserved + '-'))) {
    return { valid: false, error: t('usernameReservedPrefix') };
  }
  
  return { valid: true };
};

const validateEmail = (email: string, t: any): { valid: boolean; error?: string } => {
  if (!email || email.trim().length === 0) {
    return { valid: false, error: t('emailRequired') };
  }
  
  if (email.length > FIELD_LIMITS.email.max) {
    return { valid: false, error: t('emailMaxLength', { max: FIELD_LIMITS.email.max }) };
  }
  
  // More comprehensive email validation
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) {
    return { valid: false, error: t('emailInvalid') };
  }
  
  return { valid: true };
};

const validateFullName = (full_name: string, t: any): { valid: boolean; error?: string } => {
  if (!full_name || full_name.trim().length === 0) {
    return { valid: false, error: t('fullNameRequired') };
  }
  
  if (full_name.length > FIELD_LIMITS.full_name.max) {
    return { valid: false, error: t('fullNameMaxLength', { max: FIELD_LIMITS.full_name.max }) };
  }
  
  return { valid: true };
};

const validateBio = (bio: string, t: any): { valid: boolean; error?: string } => {
  if (bio.length > FIELD_LIMITS.bio.max) {
    return { valid: false, error: t('bioMaxLength', { max: FIELD_LIMITS.bio.max }) };
  }
  
  return { valid: true };
};

const validateLocation = (location: string, t: any): { valid: boolean; error?: string } => {
  if (location.length > FIELD_LIMITS.location.max) {
    return { valid: false, error: t('locationMaxLength', { max: FIELD_LIMITS.location.max }) };
  }
  
  return { valid: true };
};

const validateWebsite = (website: string, t: any): { valid: boolean; error?: string } => {
  if (!website || website.trim().length === 0) {
    return { valid: true }; // Optional field
  }
  
  if (website.length > FIELD_LIMITS.website.max) {
    return { valid: false, error: t('websiteMaxLength', { max: FIELD_LIMITS.website.max }) };
  }
  
  // Comprehensive URL validation
  try {
    const url = new URL(website);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, error: t('websiteProtocol') };
    }
  } catch {
    return { valid: false, error: t('websiteInvalid') };
  }
  
  return { valid: true };
};

const validateCompany = (company: string, t: any): { valid: boolean; error?: string } => {
  if (company.length > FIELD_LIMITS.company.max) {
    return { valid: false, error: t('companyMaxLength', { max: FIELD_LIMITS.company.max }) };
  }
  
  return { valid: true };
};

export function Profile() {
  const { user, setUser } = useAuthStore();
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [emailAvailable, setEmailAvailable] = useState<boolean | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [show2FADialog, setShow2FADialog] = useState(false);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [statistics, setStatistics] = useState({
    test_cases_created: 0,
    test_runs_executed: 0,
    defects_reported: 0,
    success_rate: 0
  });
  const [statisticsLoading, setStatisticsLoading] = useState(false);
  const [isOffline, setIsOffline] = useState(!isOnline());
  const [concurrentEditWarning, setConcurrentEditWarning] = useState(false);
  const [editLockAcquired, setEditLockAcquired] = useState(false);
  
  // Undo/redo state
  const [history, setHistory] = useState<any[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  // Draft state
  const [draftData, setDraftData] = useState<any>(null);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Debounce timer for input changes
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Ref for cleanup
  const cleanupRef = useRef<(() => void) | null>(null);
  
  const [formData, setFormData] = useState({
    username: user?.username || '',
    email: user?.email || '',
    full_name: user?.full_name || '',
    bio: 'Software testing enthusiast with 5+ years of experience in QA automation and manual testing.',
    location: 'San Francisco, CA',
    website: 'https://example.com',
    company: 'TechCorp Inc.',
    role: 'tester'
  });
  
  const [originalFormData, setOriginalFormData] = useState({ ...formData });

  // Update formData when user changes (e.g., after login or profile update)
  useEffect(() => {
    if (user) {
      const newFormData = {
        username: safeUserData(user.username, ''),
        email: safeUserData(user.email, ''),
        full_name: safeUserData(user.full_name, ''),
        bio: safeUserData(user.bio, 'Software testing enthusiast with 5+ years of experience in QA automation and manual testing.'),
        location: safeUserData(user.location, 'San Francisco, CA'),
        website: safeUserData(user.website, 'https://example.com'),
        company: safeUserData(user.company, 'TechCorp Inc.'),
        role: safeUserData(user.role, 'tester')
      };
      setFormData(newFormData);
      setOriginalFormData(newFormData);
      // Reset validation states
      setFieldErrors({});
      setUsernameAvailable(null);
      setEmailAvailable(null);
      setHasUnsavedChanges(false);
      setHistory([newFormData]);
      setHistoryIndex(0);
    }
  }, [user]);
  
  // Load draft from localStorage on mount
  useEffect(() => {
    const savedDraft = localStorage.getItem('profileDraft');
    if (savedDraft && !isEditing) {
      try {
        setDraftData(JSON.parse(savedDraft));
      } catch (e) {
        console.error('Failed to load draft:', e);
      }
    }
  }, [isEditing]);
  
  // Network status monitoring
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      setError(null);
    };
    
    const handleOffline = () => {
      setIsOffline(true);
      setError(t('offlineMessage'));
    };
    
    setupNetworkListeners(handleOnline, handleOffline);
    
    cleanupRef.current = () => {
      removeNetworkListeners(handleOnline, handleOffline);
    };
    
    return cleanupRef.current;
  }, []);
  
  // Fetch user statistics on mount
  useEffect(() => {
    const fetchStatistics = async () => {
      if (isOffline) {
        setError(t('cannotSaveOffline'));
        return;
      }
      
      setStatisticsLoading(true);
      try {
        const response = await apiCallWithRetry(() => api.get('/users/me/statistics'));
        const validatedData = validateApiResponse(response.data, ['test_cases_created', 'test_runs_executed', 'defects_reported', 'success_rate']);
        setStatistics(validatedData as any);
      } catch (err: any) {
        console.error('Failed to fetch statistics:', err);
        if (err.message?.includes('timeout')) {
          setError(t('requestTimeout'));
        } else if (err.message?.includes('offline')) {
          setError(t('offlineMessage'));
        } else {
          setError(t('failedToSaveProfile'));
        }
      } finally {
        setStatisticsLoading(false);
      }
    };
    
    fetchStatistics();
  }, [isOffline]);
  
  // Auto-save draft to localStorage
  useEffect(() => {
    if (isEditing && hasUnsavedChanges) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      autoSaveTimerRef.current = setTimeout(() => {
        localStorage.setItem('profileDraft', JSON.stringify(formData));
      }, 2000);
    }
    
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [formData, isEditing, hasUnsavedChanges]);

  // Debounced username uniqueness check
  const checkUsernameAvailability = useCallback(async (username: string) => {
    if (!username || username === user?.username) {
      setUsernameAvailable(null);
      return;
    }

    const validation = validateUsername(username, t);
    if (!validation.valid) {
      setUsernameAvailable(false);
      return;
    }

    if (isOffline) {
      setError(t('cannotCheckUsernameOffline'));
      return;
    }

    setIsCheckingUsername(true);
    try {
      const response = await apiCallWithRetry(() => api.get(`/users/check-username/${encodeURIComponent(username)}`));
      const validatedData = validateApiResponse(response.data, ['available']);
      setUsernameAvailable((validatedData as any).available);
    } catch (err: any) {
      console.error('Error checking username availability:', err);
      if (err.message?.includes('timeout')) {
        setError(t('requestTimeout'));
      }
      setUsernameAvailable(null);
    } finally {
      setIsCheckingUsername(false);
    }
  }, [user?.username, isOffline]);

  // Debounced email uniqueness check
  const checkEmailAvailability = useCallback(async (email: string) => {
    if (!email || email === user?.email) {
      setEmailAvailable(null);
      return;
    }

    const validation = validateEmail(email, t);
    if (!validation.valid) {
      setEmailAvailable(false);
      return;
    }

    if (isOffline) {
      setError(t('cannotCheckEmailOffline'));
      return;
    }

    setIsCheckingEmail(true);
    try {
      const response = await apiCallWithRetry(() => api.get(`/users/check-email/${encodeURIComponent(email)}`));
      const validatedData = validateApiResponse(response.data, ['available']);
      setEmailAvailable((validatedData as any).available);
    } catch (err: any) {
      console.error('Error checking email availability:', err);
      if (err.message?.includes('timeout')) {
        setError(t('requestTimeout'));
      }
      setEmailAvailable(null);
    } finally {
      setIsCheckingEmail(false);
    }
  }, [user?.email, isOffline]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      checkUsernameAvailability(formData.username);
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [formData.username, checkUsernameAvailability]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      checkEmailAvailability(formData.email);
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [formData.email, checkEmailAvailability]);

  const handleSave = async () => {
    // Check for concurrent edits
    if (editLockAcquired) {
      const lockStatus = checkEditLock();
      if (lockStatus.locked && lockStatus.userId !== user?.id) {
        setError(t('concurrentEditWarning'));
        return;
      }
    }
    
    // Validate all fields
    const errors: Record<string, string> = {};
    
    const usernameValidation = validateUsername(formData.username, t);
    if (!usernameValidation.valid) {
      errors.username = usernameValidation.error!;
    } else if (usernameAvailable === false && formData.username !== user?.username) {
      errors.username = t('usernameTaken');
    }
    
    const emailValidation = validateEmail(formData.email, t);
    if (!emailValidation.valid) {
      errors.email = emailValidation.error!;
    } else if (emailAvailable === false && formData.email !== user?.email) {
      errors.email = t('emailTaken');
    }
    
    const fullNameValidation = validateFullName(formData.full_name, t);
    if (!fullNameValidation.valid) {
      errors.full_name = fullNameValidation.error!;
    }
    
    const bioValidation = validateBio(formData.bio, t);
    if (!bioValidation.valid) {
      errors.bio = bioValidation.error!;
    }
    
    const locationValidation = validateLocation(formData.location, t);
    if (!locationValidation.valid) {
      errors.location = locationValidation.error!;
    }
    
    const websiteValidation = validateWebsite(formData.website, t);
    if (!websiteValidation.valid) {
      errors.website = websiteValidation.error!;
    }
    
    const companyValidation = validateCompany(formData.company, t);
    if (!companyValidation.valid) {
      errors.company = companyValidation.error!;
    }
    
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError(t('fixValidationErrors'));
      return;
    }
    
    if (isOffline) {
      setError(t('cannotSaveOffline'));
      return;
    }
    
    try {
      setError(null);
      setSuccess(null);
      setFieldErrors({});
      setIsSaving(true);
      
      // Sanitize all inputs before sending to backend
      const sanitizedFormData = {
        username: sanitizeInput(formData.username.trim()),
        email: sanitizeInput(formData.email.trim().toLowerCase()),
        full_name: sanitizeInput(formData.full_name.trim()),
        bio: sanitizeInput(formData.bio.trim()),
        location: sanitizeInput(formData.location.trim()),
        website: sanitizeInput(formData.website.trim()),
        company: sanitizeInput(formData.company.trim())
      };
      
      const response = await apiCallWithRetry(() => api.put('/users/me', sanitizedFormData));
      const validatedData = validateApiResponse(response.data, ['username', 'email']);
      
      // Update the user in the auth store with the response data
      if (user) {
        setUser({
          ...user,
          username: (validatedData as any).username || sanitizedFormData.username,
          email: (validatedData as any).email || sanitizedFormData.email,
          full_name: (validatedData as any).full_name || sanitizedFormData.full_name,
          bio: (validatedData as any).bio || sanitizedFormData.bio,
          location: (validatedData as any).location || sanitizedFormData.location,
          website: (validatedData as any).website || sanitizedFormData.website,
          company: (validatedData as any).company || sanitizedFormData.company,
        });
      }
      
      // Clear draft on successful save
      localStorage.removeItem('profileDraft');
      setDraftData(null);
      setHasUnsavedChanges(false);
      setOriginalFormData({ ...formData });
      
      // Release edit lock
      if (editLockAcquired && user) {
        releaseEditLock(user.id);
        setEditLockAcquired(false);
      }
      
      setSuccess(t('profileUpdated'));
      setTimeout(() => setSuccess(null), 3000);
      
      setIsEditing(false);
    } catch (error: any) {
      console.error('Failed to save profile:', error);
      let errorMessage = t('failedToSaveProfile');
      
      if (error.message?.includes('timeout')) {
        errorMessage = t('requestTimeout');
      } else if (error.message?.includes('offline')) {
        errorMessage = t('offlineMessage');
      } else if (error.response?.data?.detail) {
        errorMessage = error.response.data.detail;
      }
      
      setError(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    // Release edit lock if acquired
    if (editLockAcquired && user) {
      releaseEditLock(user.id);
      setEditLockAcquired(false);
    }
    
    if (hasUnsavedChanges) {
      setShowCancelConfirm(true);
    } else {
      performCancel();
    }
  };
  
  const performCancel = () => {
    setError(null);
    setSuccess(null);
    setFieldErrors({});
    setUsernameAvailable(null);
    setEmailAvailable(null);
    setHasUnsavedChanges(false);
    setShowCancelConfirm(false);
    setConcurrentEditWarning(false);
    
    // Use safeUserData to handle null/undefined
    setFormData({
      username: safeUserData(user?.username, ''),
      email: safeUserData(user?.email, ''),
      full_name: safeUserData(user?.full_name, ''),
      bio: safeUserData(user?.bio, 'Software testing enthusiast with 5+ years of experience in QA automation and manual testing.'),
      location: safeUserData(user?.location, 'San Francisco, CA'),
      website: safeUserData(user?.website, 'https://example.com'),
      company: safeUserData(user?.company, 'TechCorp Inc.'),
      role: safeUserData(user?.role, 'tester')
    });
    setOriginalFormData({
      username: safeUserData(user?.username, ''),
      email: safeUserData(user?.email, ''),
      full_name: safeUserData(user?.full_name, ''),
      bio: safeUserData(user?.bio, 'Software testing enthusiast with 5+ years of experience in QA automation and manual testing.'),
      location: safeUserData(user?.location, 'San Francisco, CA'),
      website: safeUserData(user?.website, 'https://example.com'),
      company: safeUserData(user?.company, 'TechCorp Inc.'),
      role: safeUserData(user?.role, 'tester')
    });
    setIsEditing(false);
  };
  
  const loadDraft = () => {
    if (draftData) {
      setFormData(draftData);
      setHasUnsavedChanges(true);
      setShowCancelConfirm(false);
      
      // Acquire edit lock when loading draft
      if (user && !editLockAcquired) {
        const lockAcquired = acquireEditLock(user.id);
        if (!lockAcquired) {
          setConcurrentEditWarning(true);
        } else {
          setEditLockAcquired(true);
        }
      }
    }
  };
  
  const undo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setFormData({ ...history[newIndex] });
      setHasUnsavedChanges(true);
    }
  };
  
  const redo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setFormData({ ...history[newIndex] });
      setHasUnsavedChanges(true);
    }
  };
  
  const addToHistory = (newData: any) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ ...newData });
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };
  
  const handlePasswordChange = async (oldPassword: string, newPassword: string) => {
    if (isOffline) {
      setError(t('cannotChangePasswordOffline'));
      return;
    }
    
    try {
      setError(null);
      const response = await apiCallWithRetry(() => api.post('/users/me/change-password', {
        old_password: oldPassword,
        new_password: newPassword
      }));
      const validatedData = validateApiResponse(response.data, ['message']);
      setSuccess(t('passwordChanged'));
      setTimeout(() => setSuccess(null), 3000);
      setShowPasswordDialog(false);
    } catch (error: any) {
      console.error('Failed to change password:', error);
      let errorMessage = t('failedToChangePassword');
      
      if (error.message?.includes('timeout')) {
        errorMessage = t('requestTimeout');
      } else if (error.message?.includes('offline')) {
        errorMessage = t('offlineMessage');
      } else if (error.response?.data?.detail) {
        errorMessage = error.response.data.detail;
      }
      
      setError(errorMessage);
    }
  };
  
  const handleAvatarUpload = async (file: File) => {
    if (isOffline) {
      setError(t('cannotUploadAvatarOffline'));
      return;
    }
    
    try {
      setError(null);
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await apiCallWithRetry(
        () => api.post('/users/me/avatar', formData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        }),
        TIMEOUT_CONFIG.upload
      );
      const validatedData = validateApiResponse(response.data, ['avatar_url']);
      
      // Update user in store
      if (user) {
        setUser({
          ...user,
          avatar_url: (validatedData as any).avatar_url
        });
      }
      
      setSuccess(t('avatarUpdated'));
      setTimeout(() => setSuccess(null), 3000);
    } catch (error: any) {
      console.error('Failed to upload avatar:', error);
      let errorMessage = t('failedToUploadAvatar');
      
      if (error.message?.includes('timeout')) {
        errorMessage = t('uploadTimeout');
      } else if (error.message?.includes('offline')) {
        errorMessage = t('offlineMessage');
      } else if (error.response?.data?.detail) {
        errorMessage = error.response.data.detail;
      }
      
      setError(errorMessage);
    }
  };
  
  const handleAccountDelete = async (password: string) => {
    if (isOffline) {
      setError(t('cannotDeleteAccountOffline'));
      return;
    }
    
    try {
      setError(null);
      await apiCallWithRetry(() => api.delete('/users/me', {
        data: {
          password: password,
          confirm_text: 'DELETE MY ACCOUNT'
        }
      }));
      
      // Clear tokens and redirect to login
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      window.location.href = '/login';
    } catch (error: any) {
      console.error('Failed to delete account:', error);
      let errorMessage = t('failedToDeleteAccount');
      
      if (error.message?.includes('timeout')) {
        errorMessage = t('requestTimeout');
      } else if (error.message?.includes('offline')) {
        errorMessage = t('offlineMessage');
      } else if (error.response?.data?.detail) {
        errorMessage = error.response.data.detail;
      }
      
      setError(errorMessage);
    }
  };

  const handleInputChange = (field: keyof typeof formData, value: string) => {
    // Update formData immediately for responsive typing
    const newFormData = { ...formData, [field]: value };
    setFormData(newFormData);
    
    // Clear field error when user starts typing
    if (fieldErrors[field]) {
      setFieldErrors({ ...fieldErrors, [field]: '' });
    }
    
    // Validate field immediately for better UX
    let validation;
    switch (field) {
      case 'username':
        validation = validateUsername(value, t);
        break;
      case 'email':
        validation = validateEmail(value, t);
        break;
      case 'full_name':
        validation = validateFullName(value, t);
        break;
      case 'bio':
        validation = validateBio(value, t);
        break;
      case 'location':
        validation = validateLocation(value, t);
        break;
      case 'website':
        validation = validateWebsite(value, t);
        break;
      case 'company':
        validation = validateCompany(value, t);
        break;
      default:
        validation = { valid: true };
    }
    
    if (!validation.valid && validation.error) {
      setFieldErrors(prev => ({ ...prev, [field]: validation.error! }));
    }
    
    // Debounce expensive operations (unsaved changes check and history tracking)
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    debounceTimerRef.current = setTimeout(() => {
      // Check for unsaved changes (expensive JSON.stringify)
      setHasUnsavedChanges(JSON.stringify(newFormData) !== JSON.stringify(originalFormData));
      
      // Add to history for undo/redo (expensive array operations)
      addToHistory(newFormData);
    }, 300);
  };

  const getRoleColor = (role: string) => {
    switch (role.toLowerCase()) {
      case 'admin': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'manager': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'tester': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
    }
  };

  const handleEditableFieldKeyDown = (e: React.KeyboardEvent) => {
    if (
      !isEditing ||
      isSaving ||
      e.key !== 'Enter' ||
      e.shiftKey ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey
    ) {
      return;
    }

    const target = e.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();
    if (tagName === 'textarea' || tagName === 'button' || target.isContentEditable) {
      return;
    }

    e.preventDefault();
    handleSave();
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{t('profileTitle')}</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            {t('profileDescription')}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {isEditing && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={undo}
                disabled={historyIndex <= 0}
                title={t('undo')}
              >
                <Undo className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={redo}
                disabled={historyIndex >= history.length - 1}
                title={t('redo')}
              >
                <Redo className="h-4 w-4" />
              </Button>
            </>
          )}
          <Button
            onClick={() => isEditing ? handleSave() : setIsEditing(true)}
            className={isEditing ? 'bg-green-600 hover:bg-green-700' : ''}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <Save className="mr-2 h-4 w-4 animate-spin" />
                {t('saving')}
              </>
            ) : isEditing ? (
              <>
                <Save className="mr-2 h-4 w-4" />
                {t('saveChanges')}
              </>
            ) : (
              <>
                <Edit2 className="mr-2 h-4 w-4" />
                {t('editProfile')}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      {/* Offline Alert */}
      {isOffline && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {t('profileOfflineMessage')}
          </AlertDescription>
        </Alert>
      )}
      
      {/* Concurrent Edit Warning */}
      {concurrentEditWarning && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {t('profileBeingEdited')}
          </AlertDescription>
        </Alert>
      )}
      
      {/* Success Alert */}
      {success && (
        <Alert className="bg-green-50 border-green-200 text-green-800">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Overview */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="text-center">
              <div className="flex justify-center relative">
                <Avatar className="h-24 w-24">
                  <AvatarImage src={user?.avatar_url || ''} alt={user?.username || 'User'} />
                  <AvatarFallback className="bg-blue-600 text-white text-2xl">
                    {(user?.username || 'U').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <label htmlFor="avatar-upload" className="absolute bottom-0 right-0 bg-white dark:bg-gray-700 rounded-full p-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 shadow-lg">
                  <Camera className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                </label>
                <input
                  id="avatar-upload"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleAvatarUpload(file);
                  }}
                />
              </div>
              <CardTitle className="mt-4">{user?.full_name || user?.username}</CardTitle>
              <Badge className={`mt-2 ${getRoleColor(formData.role)}`}>
                {formData.role.charAt(0).toUpperCase() + formData.role.slice(1)}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                <Mail className="mr-2 h-4 w-4" />
                {formData.email}
              </div>
              <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                <User className="mr-2 h-4 w-4" />
                @{formData.username}
              </div>
              <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                <Calendar className="mr-2 h-4 w-4" />
                Joined {user?.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'N/A'}
              </div>
              <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                <Shield className="mr-2 h-4 w-4" />
                {user?.is_active ? t('accountActive') : t('accountInactive')}
              </div>
              <div className="pt-4 space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setShowPasswordDialog(true)}
                >
                  <Lock className="mr-2 h-4 w-4" />
                  {t('changePassword')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setShow2FADialog(true)}
                >
                  <Key className="mr-2 h-4 w-4" />
                  {t('twoFactorAuth')}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('deleteAccount')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Profile Details */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('profileInformation')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6" onKeyDown={handleEditableFieldKeyDown}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="username">{t('username')} *</Label>
                  <Input
                    id="username"
                    value={formData.username}
                    onChange={(e) => handleInputChange('username', e.target.value)}
                    disabled={!isEditing}
                    maxLength={FIELD_LIMITS.username.max}
                    className={fieldErrors.username ? 'border-red-500' : ''}
                  />
                  {isEditing && (
                    <div className="text-xs text-gray-500">
                      {formData.username.length}/{FIELD_LIMITS.username.max} {t('characters')}
                      {isCheckingUsername && ` (${t('checking')})`}
                      {usernameAvailable === false && formData.username !== user?.username && (
                        <span className="text-red-500 ml-2">{t('usernameAlreadyTaken')}</span>
                      )}
                      {usernameAvailable === true && formData.username !== user?.username && (
                        <span className="text-green-500 ml-2">{t('available')}</span>
                      )}
                    </div>
                  )}
                  {fieldErrors.username && (
                    <p className="text-sm text-red-500">{fieldErrors.username}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">{t('profileEmail')} *</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    disabled={!isEditing}
                    maxLength={FIELD_LIMITS.email.max}
                    className={fieldErrors.email ? 'border-red-500' : ''}
                  />
                  {isEditing && (
                    <div className="text-xs text-gray-500">
                      {formData.email.length}/{FIELD_LIMITS.email.max} {t('characters')}
                      {isCheckingEmail && ` (${t('checking')})`}
                      {emailAvailable === false && formData.email !== user?.email && (
                        <span className="text-red-500 ml-2">{t('emailAlreadyTaken')}</span>
                      )}
                      {emailAvailable === true && formData.email !== user?.email && (
                        <span className="text-green-500 ml-2">{t('available')}</span>
                      )}
                    </div>
                  )}
                  {fieldErrors.email && (
                    <p className="text-sm text-red-500">{fieldErrors.email}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="full_name">{t('fullName')} *</Label>
                <Input
                  id="full_name"
                  value={formData.full_name}
                  onChange={(e) => handleInputChange('full_name', e.target.value)}
                  disabled={!isEditing}
                  maxLength={FIELD_LIMITS.full_name.max}
                  className={fieldErrors.full_name ? 'border-red-500' : ''}
                />
                {isEditing && (
                  <div className="text-xs text-gray-500">
                    {formData.full_name.length}/{FIELD_LIMITS.full_name.max} {t('characters')}
                  </div>
                )}
                {fieldErrors.full_name && (
                  <p className="text-sm text-red-500">{fieldErrors.full_name}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="bio">{t('profileBio')}</Label>
                <Textarea
                  id="bio"
                  value={formData.bio}
                  onChange={(e) => handleInputChange('bio', e.target.value)}
                  disabled={!isEditing}
                  rows={3}
                  maxLength={FIELD_LIMITS.bio.max}
                  className={fieldErrors.bio ? 'border-red-500' : ''}
                />
                {isEditing && (
                  <div className="text-xs text-gray-500">
                    {formData.bio.length}/{FIELD_LIMITS.bio.max} {t('characters')}
                  </div>
                )}
                {fieldErrors.bio && (
                  <p className="text-sm text-red-500">{fieldErrors.bio}</p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="company">{t('profileCompany')}</Label>
                  <Input
                    id="company"
                    value={formData.company}
                    onChange={(e) => handleInputChange('company', e.target.value)}
                    disabled={!isEditing}
                    maxLength={FIELD_LIMITS.company.max}
                    className={fieldErrors.company ? 'border-red-500' : ''}
                  />
                  {isEditing && (
                    <div className="text-xs text-gray-500">
                      {formData.company.length}/{FIELD_LIMITS.company.max} {t('characters')}
                    </div>
                  )}
                  {fieldErrors.company && (
                    <p className="text-sm text-red-500">{fieldErrors.company}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location">{t('profileLocation')}</Label>
                  <Input
                    id="location"
                    value={formData.location}
                    onChange={(e) => handleInputChange('location', e.target.value)}
                    disabled={!isEditing}
                    maxLength={FIELD_LIMITS.location.max}
                    className={fieldErrors.location ? 'border-red-500' : ''}
                  />
                  {isEditing && (
                    <div className="text-xs text-gray-500">
                      {formData.location.length}/{FIELD_LIMITS.location.max} {t('characters')}
                    </div>
                  )}
                  {fieldErrors.location && (
                    <p className="text-sm text-red-500">{fieldErrors.location}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="website">{t('profileWebsite')}</Label>
                <Input
                  id="website"
                  type="url"
                  value={formData.website}
                  onChange={(e) => handleInputChange('website', e.target.value)}
                  disabled={!isEditing}
                  maxLength={FIELD_LIMITS.website.max}
                  className={fieldErrors.website ? 'border-red-500' : ''}
                />
                {isEditing && (
                  <div className="text-xs text-gray-500">
                    {formData.website.length}/{FIELD_LIMITS.website.max} {t('characters')}
                  </div>
                )}
                {fieldErrors.website && (
                  <p className="text-sm text-red-500">{fieldErrors.website}</p>
                )}
              </div>

              {isEditing && (
                <div className="flex space-x-2 pt-4">
                  <Button 
                    onClick={handleSave} 
                    className="bg-green-600 hover:bg-green-700"
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <>
                        <Save className="mr-2 h-4 w-4 animate-spin" />
                        {t('saving')}
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        {t('saveChanges')}
                      </>
                    )}
                  </Button>
                  <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
                    <X className="mr-2 h-4 w-4" />
                    {t('cancel')}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      
      {/* Cancel Confirmation Dialog */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4" onKeyDown={handleEditableFieldKeyDown}>
            <h3 className="text-lg font-semibold mb-4">{t('unsavedChanges')}</h3>
            <p className="text-gray-600 dark:text-gray-400 mb-2">
              {t('unsavedChangesMessage')}
            </p>
            {draftData && (
              <p className="text-sm text-gray-500 dark:text-gray-500 mb-4">
                {t('draftAvailable')}
              </p>
            )}
            <div className="flex flex-col space-y-2">
              <Button 
                onClick={handleSave} 
                className="bg-green-600 hover:bg-green-700 w-full"
                disabled={isSaving}
              >
                {isSaving ? t('saving') : t('saveChanges')}
              </Button>
              {draftData && (
                <Button 
                  variant="outline" 
                  onClick={loadDraft}
                  className="w-full"
                >
                  {t('loadDraft')}
                </Button>
              )}
              <Button 
                variant="destructive" 
                onClick={performCancel}
                className="w-full"
              >
                {t('discardChanges')}
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setShowCancelConfirm(false)}
                className="w-full"
              >
                {t('continueEditing')}
              </Button>
            </div>
          </div>
        </div>
      )}
      
      {/* Password Change Dialog */}
      {showPasswordDialog && (
        <PasswordChangeDialog
          isOpen={showPasswordDialog}
          onClose={() => setShowPasswordDialog(false)}
          onSubmit={handlePasswordChange}
        />
      )}
      
      {/* Account Delete Dialog */}
      {showDeleteDialog && (
        <AccountDeleteDialog
          isOpen={showDeleteDialog}
          onClose={() => setShowDeleteDialog(false)}
          onSubmit={handleAccountDelete}
        />
      )}
      
      {/* 2FA Settings Dialog */}
      {show2FADialog && (
        <TwoFactorDialog
          isOpen={show2FADialog}
          onClose={() => setShow2FADialog(false)}
          enabled={twoFactorEnabled}
          onToggle={() => setTwoFactorEnabled(!twoFactorEnabled)}
        />
      )}

      {/* Account Statistics */}
      <Card>
        <CardHeader>
          <CardTitle>{t('accountStatistics')}</CardTitle>
        </CardHeader>
        <CardContent>
          {statisticsLoading ? (
            <div className="text-center py-4 text-gray-500">{t('loadingStatistics')}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{statistics.test_cases_created}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">{t('testCasesCreated')}</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{statistics.test_runs_executed}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">{t('testRunsExecuted')}</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{statistics.defects_reported}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">{t('defectsReported')}</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">{statistics.success_rate}%</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">{t('successRate')}</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
