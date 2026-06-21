import { useState, useEffect, useRef } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateField } from '@/components/ui/DateField';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useParams } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, Edit, Trash2, MoreHorizontal, Settings } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { customFieldsAPI } from '@/lib/api';
import { CustomFieldDefinition } from '@/types';

export function CustomFields() {
  const { projectId: urlProjectId } = useParams();
  const { t, isRTL, language } = useTranslation();
  const { toast } = useToast();
  const { canWrite } = usePermissions();
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<CustomFieldDefinition | null>(null);
  const [initialFieldState, setInitialFieldState] = useState<CustomFieldDefinition | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [fieldToDelete, setFieldToDelete] = useState<number | null>(null);
  const fieldNameInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState('');
  const [fieldDescription, setFieldDescription] = useState('');
  const [fieldSlug, setFieldSlug] = useState('');
  const [defaultValue, setDefaultValue] = useState('');
  const [isRequired, setIsRequired] = useState(false);
  const [fieldOptions, setFieldOptions] = useState<string[]>([]);
  const [optionsInput, setOptionsInput] = useState('');
  // Which entity types this field applies to. Defaults to test_case so
  // existing admin habits keep working until they opt in to the others.
  const [entityTypes, setEntityTypes] = useState<string[]>(['test_case']);
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  
  // Validation rules state
  const [validationRules, setValidationRules] = useState<Record<string, any>>({});
  const [minLength, setMinLength] = useState('');
  const [maxLength, setMaxLength] = useState('');
  const [regexPattern, setRegexPattern] = useState('');
  const [minValue, setMinValue] = useState('');
  const [maxValue, setMaxValue] = useState('');
  const [integerOnly, setIntegerOnly] = useState(false);
  const [minDate, setMinDate] = useState('');
  const [maxDate, setMaxDate] = useState('');
  const [futureOnly, setFutureOnly] = useState(false);
  const [pastOnly, setPastOnly] = useState(false);

  const currentProjectId = urlProjectId && !isNaN(parseInt(urlProjectId)) ? parseInt(urlProjectId) : null;
  // Field definitions are project config: deletion is a manager+ action (testers
  // can create/edit but not delete).
  const { canManageProject } = useProjectPermissions(currentProjectId);

  useEffect(() => {
    if (currentProjectId) {
      loadData();
    }
  }, [currentProjectId]);

  const loadData = async () => {
    if (!currentProjectId) {
      setLoading(false);
      toast({
        title: t('error'),
        description: t('invalidProjectId'),
        variant: "destructive",
      });
      return;
    }
    
    setLoading(true);
    try {
      const fields = await customFieldsAPI.getDefinitions(currentProjectId);
      setCustomFields(fields);
    } catch (error: any) {
      console.error('Failed to load custom fields:', error);
      let errorMessage = t('failedToLoadCustomFields');
      let title = t('error');
      
      if (error.response?.status === 404) {
        title = t('projectNotFound');
        errorMessage = error.response?.data?.detail || errorMessage;
      } else if (error.response?.status === 403) {
        title = t('customFieldAccessDenied');
        errorMessage = error.response?.data?.detail || errorMessage;
      } else if (error.response?.status === 422) {
        title = t('customFieldValidationError');
        // FastAPI validation errors return detail as an array of objects or a single object
        const detail = error.response?.data?.detail;
        if (Array.isArray(detail) && detail.length > 0) {
          errorMessage = detail.map((err: any) => err.msg || err.message || JSON.stringify(err)).join(', ');
        } else if (typeof detail === 'object' && detail !== null) {
          errorMessage = detail.msg || detail.message || JSON.stringify(detail);
        } else if (typeof detail === 'string') {
          errorMessage = detail;
        }
      } else {
        errorMessage = error.response?.data?.detail || errorMessage;
      }
      
      toast({
        title,
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Auto-generate slug from name
  const generateSlug = (name: string) => {
    if (!name || !name.trim()) return 'field';
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s]+/g, '')
      .replace(/\s+/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 100) || 'field';
  };

  useEffect(() => {
    if (fieldName) {
      // Only auto-generate slug if user hasn't manually edited it
      const currentSlug = fieldSlug;
      const generatedSlug = generateSlug(fieldName);
      // If the current slug matches what would be generated from the original name, update it
      if (!editingField || currentSlug === generateSlug(editingField.name)) {
        setFieldSlug(generatedSlug);
      }
    }
  }, [fieldName, editingField]);

  // Auto-focus on name input when dialog opens
  useEffect(() => {
    if (dialogOpen && fieldNameInputRef.current) {
      setTimeout(() => fieldNameInputRef.current?.focus(), 100);
    }
  }, [dialogOpen]);

  // Track unsaved changes and validate
  useEffect(() => {
    if (editingField && initialFieldState) {
      // Compare against initial state when editing
      const hasChanges = 
        fieldName !== initialFieldState.name ||
        fieldType !== initialFieldState.field_type ||
        fieldDescription !== (initialFieldState.description || '') ||
        fieldSlug !== ((initialFieldState as any).slug || generateSlug(initialFieldState.name)) ||
        isRequired !== initialFieldState.is_required;
      setHasUnsavedChanges(hasChanges);
    } else {
      // For new fields, check if any field has content
      setHasUnsavedChanges(
        fieldName.trim() !== '' || 
        fieldDescription.trim() !== '' ||
        fieldType.trim() !== ''
      );
    }
    
    // Validate field name uniqueness
    const errors: Record<string, string> = {};
    if (fieldName.trim()) {
      const duplicateName = customFields.find(
        f => f.name.toLowerCase() === fieldName.toLowerCase() && f.id !== editingField?.id
      );
      if (duplicateName) {
        errors.fieldName = t('duplicateFieldName');
      }
    }
    
    // Validate slug uniqueness
    if (fieldSlug.trim()) {
      const duplicateSlug = customFields.find(
        f => (f as any).slug?.toLowerCase() === fieldSlug.toLowerCase() && f.id !== editingField?.id
      );
      if (duplicateSlug) {
        errors.fieldSlug = t('duplicateFieldSlug');
      }
    }
    
    setValidationErrors(errors);
  }, [fieldName, fieldSlug, fieldDescription, fieldType, isRequired, customFields, editingField, initialFieldState]);

  const handleCreateField = async () => {
    if (!currentProjectId) {
      toast({
        title: t('error'),
        description: t('invalidProjectId'),
        variant: "destructive",
      });
      return;
    }

    // Build validation rules object
    const rules: Record<string, any> = {};
    if (fieldType === 'text' || fieldType === 'select' || fieldType === 'multiselect') {
      if (minLength) rules.min_length = parseInt(minLength);
      if (maxLength) rules.max_length = parseInt(maxLength);
      if (regexPattern && fieldType === 'text') rules.regex_pattern = regexPattern;
    } else if (fieldType === 'number') {
      if (minValue) rules.min_value = parseFloat(minValue);
      if (maxValue) rules.max_value = parseFloat(maxValue);
      if (integerOnly) rules.integer_only = true;
    } else if (fieldType === 'date') {
      if (minDate) rules.min_date = minDate;
      if (maxDate) rules.max_date = maxDate;
      if (futureOnly) rules.future_only = true;
      if (pastOnly) rules.past_only = true;
    }

    try {
      setIsCreating(true);
      const newField = await customFieldsAPI.createDefinition({
        name: fieldName,
        field_type: fieldType as any,
        description: fieldDescription,
        project_id: currentProjectId,
        is_required: isRequired,
        slug: fieldSlug || generateSlug(fieldName),
        default_value: fieldType === 'boolean' && defaultValue && defaultValue !== 'none' ? defaultValue : undefined,
        options: (fieldType === 'select' || fieldType === 'multiselect') && fieldOptions.length > 0
          ? fieldOptions
          : undefined,
        validation_rules: Object.keys(rules).length > 0 ? rules : undefined,
        entity_types: entityTypes.length > 0 ? entityTypes : ['test_case'],
      });

      setCustomFields(prev => [...prev, newField]);
      resetForm();
      setHasUnsavedChanges(false);
      setDialogOpen(false);
      toast({
        title: t('success'),
        description: t('customFieldCreatedSuccess'),
      });
    } catch (error: any) {
      console.error('Failed to create field:', error);
      let errorMessage = t('failedToCreateCustomField');
      let title = t('error');
      
      if (error.response?.status === 409) {
        title = t('customFieldConflict');
        errorMessage = error.response?.data?.detail || errorMessage;
      } else if (error.response?.status === 422) {
        title = t('customFieldValidationError');
        // FastAPI validation errors return detail as an array of objects or a single object
        const detail = error.response?.data?.detail;
        if (Array.isArray(detail) && detail.length > 0) {
          errorMessage = detail.map((err: any) => err.msg || err.message || JSON.stringify(err)).join(', ');
        } else if (typeof detail === 'object' && detail !== null) {
          errorMessage = detail.msg || detail.message || JSON.stringify(detail);
        } else if (typeof detail === 'string') {
          errorMessage = detail;
        }
      } else if (error.response?.status === 403) {
        title = t('customFieldAccessDenied');
        errorMessage = error.response?.data?.detail || errorMessage;
      } else {
        errorMessage = error.response?.data?.detail || errorMessage;
      }
      
      toast({
        title,
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDialogClose = (open: boolean) => {
    if (!open && hasUnsavedChanges) {
      setShowUnsavedDialog(true);
    } else {
      setDialogOpen(open);
      if (!open) {
        resetForm();
        setHasUnsavedChanges(false);
        setTouchedFields({});
        setInitialFieldState(null);
      }
    }
  };

  const handleUnsavedConfirm = (discard: boolean) => {
    setShowUnsavedDialog(false);
    if (discard) {
      resetForm();
      setHasUnsavedChanges(false);
      setTouchedFields({});
      setDialogOpen(false);
      setInitialFieldState(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      if (editingField) {
        handleUpdateField();
      } else {
        handleCreateField();
      }
    }
  };

  const handleEditField = (field: CustomFieldDefinition) => {
    setEditingField(field);
    setInitialFieldState(field);
    setFieldName(field.name);
    setFieldType(field.field_type);
    setDefaultValue(field.default_value || '');
    setFieldDescription(field.description || '');
    setFieldSlug((field as any).slug || generateSlug(field.name));
    setIsRequired(field.is_required);
    const existingTargets = Array.isArray((field as any).entity_types) ? (field as any).entity_types : null;
    setEntityTypes(existingTargets && existingTargets.length > 0 ? existingTargets : ['test_case']);
    // Load existing options if available
    if (field.options && (field.field_type === 'select' || field.field_type === 'multiselect')) {
      const optionsValues = Array.isArray(field.options) ? field.options : [];
      setFieldOptions(optionsValues);
      setOptionsInput(optionsValues.join(', '));
    } else {
      setFieldOptions([]);
      setOptionsInput('');
    }
    // Load existing validation rules
    const rules = (field as any).validation_rules || {};
    setMinLength(rules.min_length?.toString() || '');
    setMaxLength(rules.max_length?.toString() || '');
    setRegexPattern(rules.regex_pattern || '');
    setMinValue(rules.min_value?.toString() || '');
    setMaxValue(rules.max_value?.toString() || '');
    setIntegerOnly(rules.integer_only || false);
    setMinDate(rules.min_date || '');
    setMaxDate(rules.max_date || '');
    setFutureOnly(rules.future_only || false);
    setPastOnly(rules.past_only || false);
    setDialogOpen(true);
  };

  const handleUpdateField = async () => {
    if (!editingField) return;

    // Build validation rules object
    const rules: Record<string, any> = {};
    if (fieldType === 'text' || fieldType === 'select' || fieldType === 'multiselect') {
      if (minLength) rules.min_length = parseInt(minLength);
      if (maxLength) rules.max_length = parseInt(maxLength);
      if (regexPattern && fieldType === 'text') rules.regex_pattern = regexPattern;
    } else if (fieldType === 'number') {
      if (minValue) rules.min_value = parseFloat(minValue);
      if (maxValue) rules.max_value = parseFloat(maxValue);
      if (integerOnly) rules.integer_only = true;
    } else if (fieldType === 'date') {
      if (minDate) rules.min_date = minDate;
      if (maxDate) rules.max_date = maxDate;
      if (futureOnly) rules.future_only = true;
      if (pastOnly) rules.past_only = true;
    }

    try {
      setIsUpdating(true);
      const updatedField = await customFieldsAPI.updateDefinition(editingField.id, {
        name: fieldName,
        field_type: fieldType as any,
        description: fieldDescription,
        is_required: isRequired,
        slug: fieldSlug,
        default_value: fieldType === 'boolean' && defaultValue && defaultValue !== 'none' ? defaultValue : undefined,
        options: (fieldType === 'select' || fieldType === 'multiselect') && fieldOptions.length > 0
          ? fieldOptions
          : undefined,
        validation_rules: Object.keys(rules).length > 0 ? rules : undefined,
        entity_types: entityTypes.length > 0 ? entityTypes : ['test_case'],
      });

      setCustomFields(prev => prev.map(f => f.id === editingField.id ? updatedField : f));
      resetForm();
      setDialogOpen(false);
      setEditingField(null);
      setInitialFieldState(null);
      toast({
        title: t('success'),
        description: t('customFieldUpdatedSuccess'),
      });
    } catch (error: any) {
      console.error('Failed to update field:', error);
      let errorMessage = t('failedToUpdateCustomField');
      let title = t('error');
      
      if (error.response?.status === 409) {
        title = t('customFieldConflict');
        errorMessage = error.response?.data?.detail || errorMessage;
      } else if (error.response?.status === 422) {
        title = t('customFieldValidationError');
        // FastAPI validation errors return detail as an array of objects or a single object
        const detail = error.response?.data?.detail;
        if (Array.isArray(detail) && detail.length > 0) {
          errorMessage = detail.map((err: any) => err.msg || err.message || JSON.stringify(err)).join(', ');
        } else if (typeof detail === 'object' && detail !== null) {
          errorMessage = detail.msg || detail.message || JSON.stringify(detail);
        } else if (typeof detail === 'string') {
          errorMessage = detail;
        }
      } else if (error.response?.status === 403) {
        title = t('customFieldAccessDenied');
        errorMessage = error.response?.data?.detail || errorMessage;
      } else {
        errorMessage = error.response?.data?.detail || errorMessage;
      }
      
      toast({
        title,
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteField = async (fieldId: number) => {
    setShowDeleteDialog(true);
    setFieldToDelete(fieldId);
  };

  const handleConfirmDelete = async () => {
    if (!fieldToDelete) return;

    try {
      setIsDeleting(true);
      await customFieldsAPI.deleteDefinition(fieldToDelete);
      setCustomFields(prev => prev.filter(f => f.id !== fieldToDelete));
      toast({
        title: t('success'),
        description: t('customFieldDeletedSuccess'),
      });
    } catch (error: any) {
      console.error('Failed to delete field:', error);
      let errorMessage = t('failedToDeleteCustomField');
      let title = t('error');
      
      if (error.response?.status === 409) {
        title = t('customFieldConflict');
        errorMessage = error.response?.data?.detail || errorMessage;
      } else if (error.response?.status === 422) {
        title = t('customFieldValidationError');
        // FastAPI validation errors return detail as an array of objects or a single object
        const detail = error.response?.data?.detail;
        if (Array.isArray(detail) && detail.length > 0) {
          errorMessage = detail.map((err: any) => err.msg || err.message || JSON.stringify(err)).join(', ');
        } else if (typeof detail === 'object' && detail !== null) {
          errorMessage = detail.msg || detail.message || JSON.stringify(detail);
        } else if (typeof detail === 'string') {
          errorMessage = detail;
        }
      } else if (error.response?.status === 403) {
        title = t('customFieldAccessDenied');
        errorMessage = error.response?.data?.detail || errorMessage;
      } else {
        errorMessage = error.response?.data?.detail || errorMessage;
      }
      
      toast({
        title,
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
      setFieldToDelete(null);
    }
  };

  const resetForm = () => {
    setFieldName('');
    setFieldType('');
    setFieldDescription('');
    setFieldSlug('');
    setDefaultValue('');
    setIsRequired(false);
    setFieldOptions([]);
    setOptionsInput('');
    setEntityTypes(['test_case']);
    setTouchedFields({});
    setValidationErrors({});
    // Reset validation rules
    setMinLength('');
    setMaxLength('');
    setRegexPattern('');
    setMinValue('');
    setMaxValue('');
    setIntegerOnly(false);
    setMinDate('');
    setMaxDate('');
    setFutureOnly(false);
    setPastOnly(false);
  };

  const getFieldTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      text: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      number: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      date: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
      boolean: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      select: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      multiselect: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200'
    };
    return colors[type] || 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('customFieldsTitle')}</h1>
          <p className="text-gray-600">{t('customFieldsDescription')}</p>
        </div>
      </div>

      <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>{t('customFieldDefinitions')}</CardTitle>
                <p className="text-sm text-gray-600">{t('customFieldDefinitionsDesc')}</p>
              </div>
              <Dialog open={dialogOpen} onOpenChange={handleDialogClose}>
                {canWrite && (
                  <DialogTrigger asChild>
                    <Button onClick={() => { resetForm(); setEditingField(null); }}>
                      <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                      {t('addField')}
                    </Button>
                  </DialogTrigger>
                )}
                <DialogContent isRTL={isRTL} onKeyDown={handleKeyDown} className="max-w-lg max-h-[90vh]">
                  <DialogHeader className="space-y-2 pb-4">
                    <DialogTitle id="custom-field-dialog-title" className="text-xl font-semibold">
                      {editingField ? t('editCustomField') : t('createCustomField')}
                    </DialogTitle>
                    <DialogDescription className="text-sm text-gray-500">
                      {editingField ? t('editCustomFieldDesc') : t('createCustomFieldDesc')}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2 max-h-[calc(90vh-200px)] overflow-y-auto px-4" role="form" aria-labelledby="custom-field-dialog-title">
                    {/* Field Name */}
                    <div className="space-y-2">
                      <Label htmlFor="field-name" className="text-sm font-medium">{t('customFieldName')} <span className="text-red-500">*</span></Label>
                      <Input
                        ref={fieldNameInputRef}
                        id="field-name"
                        value={fieldName}
                        onChange={(e) => setFieldName(e.target.value)}
                        onBlur={() => setTouchedFields({...touchedFields, fieldName: true})}
                        className={
                          (touchedFields.fieldName && fieldName.trim() === '') || validationErrors.fieldName
                            ? 'border-red-300 focus:border-red-500' 
                            : ''
                        }
                        placeholder={t('enterFieldName')}
                        maxLength={100}
                        aria-invalid={!!validationErrors.fieldName}
                        aria-describedby={validationErrors.fieldName ? 'field-name-error' : undefined}
                      />
                      {validationErrors.fieldName && (
                        <p id="field-name-error" className="text-xs text-red-500">
                          {validationErrors.fieldName}
                        </p>
                      )}
                      <div className="flex justify-end text-xs text-gray-500">
                        <span>{fieldName.length}/100</span>
                      </div>
                    </div>

                    {/* Field Type */}
                    <div className="space-y-2">
                      <Label htmlFor="field-type" className="text-sm font-medium">{t('customFieldType')} <span className="text-red-500">*</span></Label>
                      <Select value={fieldType} onValueChange={setFieldType}>
                        <SelectTrigger className="w-full" aria-required="true">
                          <SelectValue placeholder={t('selectFieldType')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="text">{t('textType')}</SelectItem>
                          <SelectItem value="number">{t('numberType')}</SelectItem>
                          <SelectItem value="date">{t('dateType')}</SelectItem>
                          <SelectItem value="boolean">{t('booleanType')}</SelectItem>
                          <SelectItem value="select">{t('selectType')}</SelectItem>
                          <SelectItem value="multiselect">{t('multiselectType')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Default Value for boolean - grouped with field type */}
                    {fieldType === 'boolean' && (
                      <div className="space-y-2">
                        <Label htmlFor="default-value" className="text-sm font-medium">{t('defaultValue')}</Label>
                        <Select value={defaultValue} onValueChange={setDefaultValue}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={t('selectDefaultValue')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{t('noDefaultValue')}</SelectItem>
                            <SelectItem value="true">{t('true')}</SelectItem>
                            <SelectItem value="false">{t('false')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Slug */}
                    <div className="space-y-2">
                      <Label htmlFor="field-slug" className="text-sm font-medium">{t('fieldSlug')}</Label>
                      <Input
                        id="field-slug"
                        value={fieldSlug}
                        onChange={(e) => setFieldSlug(e.target.value)}
                        onBlur={() => setTouchedFields({...touchedFields, fieldSlug: true})}
                        className={
                          validationErrors.fieldSlug ? 'border-red-300 focus:border-red-500' : ''
                        }
                        placeholder={t('fieldSlugPlaceholder')}
                        maxLength={100}
                        aria-invalid={!!validationErrors.fieldSlug}
                        aria-describedby={validationErrors.fieldSlug ? 'field-slug-error' : undefined}
                      />
                      {validationErrors.fieldSlug && (
                        <p id="field-slug-error" className="text-xs text-red-500">
                          {validationErrors.fieldSlug}
                        </p>
                      )}
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                      <Label htmlFor="field-description" className="text-sm font-medium">{t('customFieldDescLabel')}</Label>
                      <Textarea
                        id="field-description"
                        value={fieldDescription}
                        onChange={(e) => setFieldDescription(e.target.value)}
                        placeholder={t('customFieldDescPlaceholder')}
                        rows={3}
                        maxLength={500}
                        className="resize-none"
                      />
                      <div className="flex justify-end text-xs text-gray-500">
                        <span>{fieldDescription.length}/500</span>
                      </div>
                    </div>

                    {/* Options for select/multiselect */}
                    {(fieldType === 'select' || fieldType === 'multiselect') && (
                      <div className="space-y-2">
                        <Label htmlFor="field-options" className="text-sm font-medium">{t('options')} <span className="text-red-500">*</span></Label>
                        <Textarea
                          id="field-options"
                          value={optionsInput}
                          onChange={(e) => setOptionsInput(e.target.value)}
                          placeholder={t('optionsPlaceholder')}
                          rows={3}
                          onBlur={() => {
                            const options = optionsInput
                              .split(',')
                              .map(opt => opt.trim())
                              .filter(opt => opt.length > 0);
                            setFieldOptions(options);
                          }}
                          className="resize-none"
                        />
                        <p className="text-xs text-gray-500">{t('optionsHelper')}</p>
                        {fieldOptions.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {fieldOptions.map((option, index) => (
                              <span
                                key={index}
                                className="inline-flex items-center px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-medium border border-blue-200"
                              >
                                {option}
                                <button
                                  type="button"
                                  onClick={() => {
                                    const newOptions = fieldOptions.filter((_, i) => i !== index);
                                    setFieldOptions(newOptions);
                                    setOptionsInput(newOptions.join(', '));
                                  }}
                                  className={`${isRTL ? 'mr-1.5' : 'ml-1.5'} hover:text-blue-900 transition-colors`}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Validation Rules */}
                    {fieldType && fieldType !== 'boolean' && (
                      <div className="space-y-4 pt-4 border-t">
                        <Label className="text-sm font-semibold">{t('validationRules')}</Label>
                        
                        {/* Text/Select/Multiselect validation */}
                        {(fieldType === 'text' || fieldType === 'select' || fieldType === 'multiselect') && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="min-length" className="text-xs">{t('minLength')}</Label>
                              <Input
                                id="min-length"
                                type="number"
                                min="0"
                                value={minLength}
                                onChange={(e) => setMinLength(e.target.value)}
                                placeholder="0"
                                className="text-sm"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="max-length" className="text-xs">{t('maxLength')}</Label>
                              <Input
                                id="max-length"
                                type="number"
                                min="0"
                                value={maxLength}
                                onChange={(e) => setMaxLength(e.target.value)}
                                placeholder="1000"
                                className="text-sm"
                              />
                            </div>
                          </div>
                        )}

                        {/* Text regex pattern */}
                        {fieldType === 'text' && (
                          <div className="space-y-2">
                            <Label htmlFor="regex-pattern" className="text-xs">{t('regexPattern')}</Label>
                            <Input
                              id="regex-pattern"
                              value={regexPattern}
                              onChange={(e) => setRegexPattern(e.target.value)}
                              placeholder={t('regexPatternPlaceholder')}
                              className="text-sm font-mono"
                            />
                            <p className="text-xs text-gray-500">{t('regexPatternHelper')}</p>
                          </div>
                        )}

                        {/* Number validation */}
                        {fieldType === 'number' && (
                          <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label htmlFor="min-value" className="text-xs">{t('minValue')}</Label>
                                <Input
                                  id="min-value"
                                  type="number"
                                  value={minValue}
                                  onChange={(e) => setMinValue(e.target.value)}
                                  placeholder="0"
                                  className="text-sm"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="max-value" className="text-xs">{t('maxValue')}</Label>
                                <Input
                                  id="max-value"
                                  type="number"
                                  value={maxValue}
                                  onChange={(e) => setMaxValue(e.target.value)}
                                  placeholder="100"
                                  className="text-sm"
                                />
                              </div>
                            </div>
                            <div className={`flex items-center ${isRTL ? 'space-x-reverse space-x-2' : 'space-x-2'}`}>
                              <Checkbox
                                id="integer-only"
                                checked={integerOnly}
                                onCheckedChange={(checked) => setIntegerOnly(checked as boolean)}
                              />
                              <Label htmlFor="integer-only" className="text-xs">{t('integerOnly')}</Label>
                            </div>
                          </div>
                        )}

                        {/* Date validation */}
                        {fieldType === 'date' && (
                          <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label htmlFor="min-date" className="text-xs">{t('minDate')}</Label>
                                <DateField
                                  id="min-date"
                                  value={minDate}
                                  onChange={setMinDate}
                                  className="text-sm"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="max-date" className="text-xs">{t('maxDate')}</Label>
                                <DateField
                                  id="max-date"
                                  value={maxDate}
                                  onChange={setMaxDate}
                                  className="text-sm"
                                />
                              </div>
                            </div>
                            <div className={`flex items-center ${isRTL ? 'space-x-reverse space-x-4' : 'space-x-4'}`}>
                              <div className={`flex items-center ${isRTL ? 'space-x-reverse space-x-2' : 'space-x-2'}`}>
                                <Checkbox
                                  id="future-only"
                                  checked={futureOnly}
                                  onCheckedChange={(checked) => setFutureOnly(checked as boolean)}
                                />
                                <Label htmlFor="future-only" className="text-xs">{t('futureDatesOnly')}</Label>
                              </div>
                              <div className={`flex items-center ${isRTL ? 'space-x-reverse space-x-2' : 'space-x-2'}`}>
                                <Checkbox
                                  id="past-only"
                                  checked={pastOnly}
                                  onCheckedChange={(checked) => setPastOnly(checked as boolean)}
                                />
                                <Label htmlFor="past-only" className="text-xs">{t('pastDatesOnly')}</Label>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Required Checkbox */}
                    <div className={`flex items-center ${isRTL ? 'space-x-reverse space-x-2' : 'space-x-2'} pt-1`}>
                      <Checkbox
                        id="required"
                        checked={isRequired}
                        onCheckedChange={(checked) => setIsRequired(checked === true)}
                        aria-checked={isRequired}
                      />
                      <Label htmlFor="required" className="text-sm font-medium cursor-pointer">{t('thisFieldIsRequired')}</Label>
                    </div>

                    {/* Entity types this field applies to */}
                    <div className="space-y-2 pt-2 border-t">
                      <Label className="text-sm font-medium">{t('appliesTo')}</Label>
                      <p className="text-xs text-muted-foreground">{t('appliesToDescription')}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          { key: 'test_case', label: t('testCase') },
                          { key: 'test_run', label: t('testRun') },
                          { key: 'defect', label: t('defect') },
                          { key: 'requirement', label: t('requirement') },
                        ] as const).map((target) => {
                          const checked = entityTypes.includes(target.key);
                          const isLastChecked = checked && entityTypes.length === 1;
                          return (
                            <label
                              key={target.key}
                              className={`flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer ${
                                checked ? 'border-primary bg-primary/5' : 'border-input'
                              } ${isLastChecked ? 'opacity-90' : ''}`}
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(next) => {
                                  setEntityTypes((prev) => {
                                    if (next === true) {
                                      return prev.includes(target.key) ? prev : [...prev, target.key];
                                    }
                                    // Prevent deselecting the last one — every field
                                    // must apply to at least one entity.
                                    if (prev.length === 1 && prev[0] === target.key) return prev;
                                    return prev.filter((k) => k !== target.key);
                                  });
                                }}
                              />
                              <span>{target.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <DialogFooter className="flex-col sm:flex-row gap-2 pt-4">
                    <div className="text-xs text-gray-500 mb-2 sm:mb-0 sm:mr-auto">
                      {t('ctrlEnterToSubmit')}
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => handleDialogClose(false)}
                    >
                      {t('cancel')}
                    </Button>
                    <Button
                      onClick={editingField ? handleUpdateField : handleCreateField}
                      disabled={
                        !fieldName.trim() || 
                        !fieldType ||
                        isCreating || 
                        isUpdating
                      }
                    >
                      {isCreating || isUpdating ? t('saving') : (editingField ? t('updateField') : t('createField'))}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Unsaved Changes Confirmation Dialog */}
              <Dialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
                <DialogContent isRTL={isRTL} className="sm:max-w-[400px]">
                  <DialogHeader>
                    <DialogTitle>{t('unsavedChangesTitle')}</DialogTitle>
                    <DialogDescription>
                      {t('unsavedChangesModalMessage')}
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => handleUnsavedConfirm(false)}>
                      {t('keepEditingModal')}
                    </Button>
                    <Button onClick={() => handleUnsavedConfirm(true)}>
                      {t('discardChangesModal')}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Delete Confirmation Dialog */}
              <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <AlertDialogContent isRTL={isRTL} className="sm:max-w-[400px]">
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('deleteCustomField')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('deleteCustomFieldConfirm')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setShowDeleteDialog(false)} disabled={isDeleting}>
                      {t('cancel')}
                    </AlertDialogCancel>
                    <AlertDialogAction onClick={handleConfirmDelete} disabled={isDeleting} className="bg-red-600 hover:bg-red-700">
                      {isDeleting ? t('deleting') : t('delete')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex justify-center py-8" role="status" aria-live="polite" aria-busy="true">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" aria-hidden="true"></div>
                  <span className="sr-only">{t('loadingCustomFields')}</span>
                </div>
              ) : customFields.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">{t('name')}</TableHead>
                      <TableHead scope="col">{t('type')}</TableHead>
                      <TableHead scope="col">{t('description')}</TableHead>
                      <TableHead scope="col">{t('appliesTo')}</TableHead>
                      <TableHead scope="col">{t('required')}</TableHead>
                      <TableHead scope="col" className="w-12">{t('customFieldActions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customFields.map((field) => (
                      <TableRow key={field.id}>
                        <TableCell className="font-medium" scope="row">{field.name}</TableCell>
                        <TableCell>
                          <Badge className={getFieldTypeColor(field.field_type)} aria-label={`Field type: ${field.field_type}`}>
                            {field.field_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-xs truncate" title={field.description || ''}>
                          {field.description || '-'}
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const targets: string[] = Array.isArray((field as any).entity_types) && (field as any).entity_types.length > 0
                              ? (field as any).entity_types
                              : ['test_case'];
                            const labelFor: Record<string, string> = {
                              test_case: t('testCase'),
                              test_run: t('testRun'),
                              defect: t('defect'),
                              requirement: t('requirement'),
                            };
                            return (
                              <div className="flex flex-wrap gap-1">
                                {targets.map((target) => (
                                  <Badge key={target} variant="outline" className="text-[10px]">
                                    {labelFor[target] || target}
                                  </Badge>
                                ))}
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          {field.is_required && <Badge variant="secondary" aria-label={t('requiredBadge')}>
                            {t('requiredBadge')}
                          </Badge>}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="sm"
                                aria-label={`Actions for ${field.name}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem 
                                onClick={() => handleEditField(field)}
                                onSelect={(e) => e.preventDefault()}
                              >
                                <Edit className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} aria-hidden="true" />
                                {t('edit')}
                              </DropdownMenuItem>
                              {canManageProject && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => handleDeleteField(field.id)}
                                    className="text-red-600"
                                    onSelect={(e) => e.preventDefault()}
                                  >
                                    <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} aria-hidden="true" />
                                    {t('delete')}
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8" role="status" aria-live="polite">
                  <Settings className="mx-auto h-12 w-12 text-gray-400" aria-hidden="true" />
                  <h3 className="mt-2 text-sm font-semibold text-gray-900">{t('noCustomFields')}</h3>
                  <p className="mt-1 text-sm text-gray-500">{t('noCustomFieldsDesc')}</p>
                </div>
              )}
            </CardContent>
          </Card>
      </div>
    </div>
  );
}
