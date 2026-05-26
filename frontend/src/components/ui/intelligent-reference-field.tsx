import { useState, useEffect, useRef, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Search, ExternalLink, Check, X, Loader2 } from 'lucide-react';
import { requirementsAPI } from '@/lib/api';
import { Requirement } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';

interface IntelligentReferenceFieldProps {
  value: string;
  onChange: (value: string) => void;
  projectId: number;
  placeholder?: string;
  className?: string;
}

interface ReferenceSuggestion {
  type: 'requirement' | 'jira';
  id: string;
  title: string;
  subtitle: string;
  url?: string;
}

export function IntelligentReferenceField({
  value,
  onChange,
  projectId,
  placeholder = "e.g., REQ-001 or (req)search term",
  className = ""
}: IntelligentReferenceFieldProps) {
  const { isRTL } = useTranslation();
  const [suggestions, setSuggestions] = useState<ReferenceSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedType, setSelectedType] = useState<'text' | 'requirement' | 'jira'>('text');
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Detect reference type based on input
  const detectReferenceType = useCallback((input: string): 'text' | 'requirement' | 'jira' => {
    if (input.startsWith('(req)')) {
      return 'requirement';
    }

    try {
      const hostname = new URL(input).hostname.toLowerCase();
      const isJiraHost =
        hostname === 'jira.com' ||
        hostname.endsWith('.jira.com') ||
        hostname === 'atlassian.net' ||
        hostname.endsWith('.atlassian.net');

      if (isJiraHost) {
        return 'jira';
      }
    } catch {
      // Not a valid absolute URL; treat as plain text.
    }

    return 'text';
  }, []);

  // Validate Jira URL format
  const isValidJiraUrl = (url: string): boolean => {
    const jiraUrlPatterns = [
      /^https?:\/\/[a-zA-Z0-9-]+\.atlassian\.net\/browse\/[A-Z]+-\d+/,
      /^https?:\/\/jira\.[a-zA-Z0-9-]+\.[a-zA-Z]+\/browse\/[A-Z]+-\d+/
    ];
    return jiraUrlPatterns.some(pattern => pattern.test(url));
  };

  // Format Jira URL to get issue key
  const getJiraIssueKey = (url: string): string => {
    const match = url.match(/\/browse\/([A-Z]+-\d+)/);
    return match ? match[1] : '';
  };

  // Search requirements with debouncing
  const searchRequirements = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      setSuggestions([]);
      return;
    }

    setIsLoading(true);
    try {
      const requirements = await requirementsAPI.getAll(projectId, 0, 50);
      const filteredRequirements = requirements.filter(req =>
        req.title.toLowerCase().includes(query.toLowerCase()) ||
        req.requirement_id.toLowerCase().includes(query.toLowerCase()) ||
        (req.description && req.description.toLowerCase().includes(query.toLowerCase()))
      );

      const requirementSuggestions: ReferenceSuggestion[] = filteredRequirements.map(req => ({
        type: 'requirement',
        id: req.id.toString(),
        title: req.title,
        subtitle: `REQ-${req.requirement_id}`,
        url: undefined
      }));

      setSuggestions(requirementSuggestions);
    } catch (error) {
      console.error('Failed to search requirements:', error);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  // Handle input change with type detection
  const handleInputChange = (inputValue: string) => {
    onChange(inputValue);
    const detectedType = detectReferenceType(inputValue);
    setSelectedType(detectedType);

    if (detectedType === 'requirement') {
      const query = inputValue.replace('(req)', '').trim();
      setSearchQuery(query);
      
      // Clear existing timeout
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      // Debounce search
      if (query.length >= 2) {
        searchTimeoutRef.current = setTimeout(() => {
          searchRequirements(query);
        }, 300);
      } else {
        setSuggestions([]);
      }
      setIsOpen(true);
    } else if (detectedType === 'jira') {
      setIsOpen(false);
      // Validate Jira URL and show feedback
      if (isValidJiraUrl(inputValue)) {
        const issueKey = getJiraIssueKey(inputValue);
        const jiraSuggestion: ReferenceSuggestion = {
          type: 'jira',
          id: issueKey,
          title: `Jira Issue ${issueKey}`,
          subtitle: 'Valid Jira link detected',
          url: inputValue
        };
        setSuggestions([jiraSuggestion]);
        setIsOpen(true);
      } else {
        setSuggestions([]);
      }
    } else {
      setIsOpen(false);
      setSuggestions([]);
      setSearchQuery('');
    }
  };

  // Handle suggestion selection
  const handleSuggestionSelect = (suggestion: ReferenceSuggestion) => {
    if (suggestion.type === 'requirement') {
      onChange(suggestion.subtitle);
    } else if (suggestion.type === 'jira') {
      onChange(suggestion.url || '');
    }
    setIsOpen(false);
    setSuggestions([]);
    setSearchQuery('');
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
          inputRef.current && !inputRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder={placeholder}
          className={`pl-10 ${
            selectedType === 'requirement' ? 'border-blue-300 focus:border-blue-500' :
            selectedType === 'jira' ? 'border-green-300 focus:border-green-500' :
            'border-gray-300'
          }`}
        />
        
        {/* Status indicator */}
        <div className="absolute left-3 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
          {selectedType === 'requirement' && (
            <Search className="h-4 w-4 text-blue-500" />
          )}
          {selectedType === 'jira' && (
            <div className="flex items-center gap-1">
              {isValidJiraUrl(value) ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <X className="h-4 w-4 text-red-500" />
              )}
            </div>
          )}
          {isLoading && (
            <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
          )}
        </div>
      </div>

      {/* Type hints */}
      <div className="mt-1 flex gap-2 text-xs text-gray-500">
        {selectedType === 'requirement' && (
          <Badge variant="outline" className="text-blue-600 border-blue-300">
            Searching requirements...
          </Badge>
        )}
        {selectedType === 'jira' && (
          <Badge variant="outline" className={isValidJiraUrl(value) ? "text-green-600 border-green-300" : "text-red-600 border-red-300"}>
            {isValidJiraUrl(value) ? 'Valid Jira link' : 'Invalid Jira format'}
          </Badge>
        )}
      </div>

      {/* Suggestions dropdown */}
      {isOpen && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto"
        >
          <div className="p-2">
            <div className="text-xs font-medium text-gray-500 mb-2">
              {selectedType === 'requirement' ? 'Matching Requirements:' : 'Jira Issue:'}
            </div>
            {suggestions.map((suggestion) => (
              <div
                key={`${suggestion.type}-${suggestion.id}`}
                className="p-2 hover:bg-gray-50 cursor-pointer rounded-md transition-colors"
                onClick={() => handleSuggestionSelect(suggestion)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {suggestion.type === 'requirement' && (
                        <Badge variant="secondary" className="text-xs">REQ</Badge>
                      )}
                      {suggestion.type === 'jira' && (
                        <Badge variant="secondary" className="text-xs">JIRA</Badge>
                      )}
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {suggestion.title}
                      </p>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {suggestion.subtitle}
                    </p>
                  </div>
                  {suggestion.type === 'jira' && suggestion.url && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-2 p-1 h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(suggestion.url, '_blank');
                      }}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Help text */}
      <div className="mt-2 text-xs text-gray-500">
        <div className="space-y-1">
          <div>• Type <code className="bg-gray-100 px-1 rounded">(req)</code> followed by search term to find requirements</div>
          <div>• Paste Jira issue URLs directly (e.g., https://your-domain.atlassian.net/browse/PROJ-123)</div>
          <div>• Or enter manual reference text</div>
        </div>
      </div>
    </div>
  );
}
