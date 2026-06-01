import { useState, useEffect, useCallback, useId } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Search, ExternalLink, X } from 'lucide-react';
import { requirementsAPI } from '@/lib/api';
import { Requirement } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';

interface ReferenceFieldProps {
  value: string;
  onChange: (value: string) => void;
  projectId?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function ReferenceField({
  value,
  onChange,
  projectId,
  placeholder,
  disabled = false,
  className = ""
}: ReferenceFieldProps) {
  const { t, isRTL } = useTranslation();
  const inputId = useId();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Requirement[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  
  const finalPlaceholder = placeholder || t('referencePlaceholder');

  // Initialize searchQuery when value prop changes
  useEffect(() => {
    if (value && !searchQuery) {
      setSearchQuery(value);
    }
  }, [value, searchQuery]);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Search for requirements when debounced query changes
  useEffect(() => {
    if (debouncedQuery && projectId && debouncedQuery.startsWith('req')) {
      searchRequirements(debouncedQuery);
    } else {
      setSearchResults([]);
      setShowResults(false);
    }
  }, [debouncedQuery, projectId]);

  const searchRequirements = useCallback(async (query: string) => {
    if (!projectId) return;

    setIsSearching(true);
    try {
      // Extract search term after 'req'
      const searchTerm = query.replace('req', '').trim();
      
      // Get all requirements for the project
      const requirements = await requirementsAPI.getAll(projectId, 0, 50);
      
      // Filter requirements based on search term
      const filtered = requirements.filter(req => 
        req.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        req.requirement_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (req.tags && req.tags.toLowerCase().includes(searchTerm.toLowerCase()))
      );

      setSearchResults(filtered);
      setShowResults(true);
    } catch (error) {
      console.error('Failed to search requirements:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [projectId]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setSearchQuery(newValue);
    onChange(newValue);
  };

  const selectRequirement = (requirement: Requirement) => {
    const referenceValue = requirement.requirement_id;
    onChange(referenceValue);
    setSearchQuery(referenceValue);
    setShowResults(false);
  };

  const clearInput = () => {
    onChange('');
    setSearchQuery('');
    setSearchResults([]);
    setShowResults(false);
  };

  const isJiraLink = (value: string) => {
    if (/^[A-Z]+-\d+$/.test(value)) {
      return true;
    }

    try {
      const parsedUrl = new URL(value);
      const host = parsedUrl.hostname.toLowerCase();
      const isHttp = parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
      const isAtlassianHost = host === 'atlassian.net' || host.endsWith('.atlassian.net');
      const isJiraHost = host === 'jira' || host.includes('.jira.');

      return isHttp && (isAtlassianHost || isJiraHost);
    } catch {
      return false;
    }
  };

  const renderJiraLink = (value: string) => {
    if (value.includes('http')) {
      return (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 underline flex items-center gap-1"
        >
          {value}
          <ExternalLink className="h-3 w-3" />
        </a>
      );
    }
    // For JIRA ticket IDs like PROJ-123
    if (/^[A-Z]+-\d+$/.test(value)) {
      return (
        <span className="font-mono text-blue-600 bg-blue-50 px-2 py-1 rounded">
          {value}
        </span>
      );
    }
    return <span>{value}</span>;
  };

  return (
    <div className={`relative ${className}`} dir={isRTL ? 'rtl' : 'ltr'}>
      <Label htmlFor={inputId} className="text-sm font-medium">
        {t('reference')}
      </Label>
      <div className="relative mt-1">
        <Input
          id={inputId}
          value={searchQuery || value}
          onChange={handleInputChange}
          placeholder={finalPlaceholder}
          disabled={disabled}
          className={isRTL ? 'pl-8 pr-3' : 'pr-8'}
        />
        {(value || searchQuery) && !disabled && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearInput}
            className={`absolute top-1/2 transform -translate-y-1/2 h-6 w-6 p-0 ${isRTL ? 'left-1' : 'right-1'}`}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Search Results Dropdown */}
      {showResults && (
        <Card className="absolute z-10 w-full mt-1 max-h-60 overflow-y-auto">
          <CardContent className="p-0">
            {isSearching ? (
              <div className="p-3 text-center text-sm text-gray-500">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mx-auto mb-2"></div>
                {t('searchingRequirements')}
              </div>
            ) : searchResults.length > 0 ? (
              <div className="py-1">
                {searchResults.map((requirement) => (
                  <div
                    key={requirement.id}
                    onClick={() => selectRequirement(requirement)}
                    className="px-3 py-2 hover:bg-gray-50 cursor-pointer border-b last:border-b-0"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {requirement.requirement_id}
                          </Badge>
                          <span className="font-medium text-sm truncate">
                            {requirement.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge 
                            className={`text-xs ${
                              requirement.priority === 'critical' ? 'bg-red-100 text-red-800' :
                              requirement.priority === 'high' ? 'bg-orange-100 text-orange-800' :
                              requirement.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {t(requirement.priority)}
                          </Badge>
                          <Badge 
                            className={`text-xs ${
                              requirement.status === 'approved' ? 'bg-green-100 text-green-800' :
                              requirement.status === 'reviewed' ? 'bg-blue-100 text-blue-800' :
                              requirement.status === 'draft' ? 'bg-gray-100 text-gray-800' :
                              'bg-purple-100 text-purple-800'
                            }`}
                          >
                            {t(requirement.status)}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : searchQuery.startsWith('req') ? (
              <div className="p-3 text-center text-sm text-gray-500">
                {t('noRequirementsFound')}
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* Display current reference value */}
      {value && !searchQuery && (
        <div className="mt-2">
          {isJiraLink(value) ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{t('jiraLink')}</span>
              {renderJiraLink(value)}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{t('reference')}:</span>
              <Badge variant="outline" className="text-xs">
                {value}
              </Badge>
            </div>
          )}
        </div>
      )}

      {/* Help text */}
      <div className="mt-1 text-xs text-gray-500">
        {t('referenceHelp')}
      </div>
    </div>
  );
}
