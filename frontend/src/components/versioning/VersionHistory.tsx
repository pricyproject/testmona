import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { 
  Clock, 
  GitBranch, 
  Tag, 
  Lock, 
  Unlock, 
  Eye, 
  RotateCcw,
  GitMerge,
  GitPullRequest,
  History,
  ChevronDown,
  ChevronRight,
  User,
  Calendar
} from 'lucide-react';
import { useDateFormat } from '@/hooks/useDateFormat';
import { TestCaseVersion, VersionTag } from '../../types/versioning';
import { versioningApi } from '../../api/versioning';

interface VersionHistoryProps {
  testCaseId: number;
  onVersionSelect?: (version: TestCaseVersion) => void;
  onCompareVersions?: (fromVersion: TestCaseVersion, toVersion: TestCaseVersion) => void;
}

const statusColors = {
  draft: 'bg-gray-100 text-gray-800',
  pending_review: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  published: 'bg-green-100 text-green-800',
  archived: 'bg-red-100 text-red-800'
};

const statusIcons = {
  draft: Clock,
  pending_review: Eye,
  approved: GitPullRequest,
  published: Tag,
  archived: Lock
};

export const VersionHistory: React.FC<VersionHistoryProps> = ({
  testCaseId,
  onVersionSelect,
  onCompareVersions
}) => {
  const [versions, setVersions] = useState<TestCaseVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedVersions, setExpandedVersions] = useState<Set<number>>(new Set());
  const [selectedVersions, setSelectedVersions] = useState<TestCaseVersion[]>([]);

  useEffect(() => {
    fetchVersions();
  }, [testCaseId]);

  const fetchVersions = async () => {
    try {
      setLoading(true);
      const data = await versioningApi.getVersions(testCaseId);
      setVersions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const toggleVersionExpansion = (versionId: number) => {
    const newExpanded = new Set(expandedVersions);
    if (newExpanded.has(versionId)) {
      newExpanded.delete(versionId);
    } else {
      newExpanded.add(versionId);
    }
    setExpandedVersions(newExpanded);
  };

  const handleVersionSelect = (version: TestCaseVersion) => {
    if (onVersionSelect) {
      onVersionSelect(version);
    }
  };

  const handleVersionCompare = (version: TestCaseVersion) => {
    if (selectedVersions.length === 0) {
      setSelectedVersions([version]);
    } else if (selectedVersions.length === 1) {
      if (selectedVersions[0].id === version.id) {
        setSelectedVersions([]);
      } else {
        if (onCompareVersions) {
          onCompareVersions(selectedVersions[0], version);
        }
        setSelectedVersions([]);
      }
    }
  };

  const handleRollback = async (version: TestCaseVersion) => {
    if (!confirm(`Are you sure you want to rollback to version ${version.version_string}?`)) {
      return;
    }

    try {
      await versioningApi.rollbackToVersion(
        testCaseId, 
        version.id, 
        `Rollback to version ${version.version_string}`
      );
      await fetchVersions(); // Refresh the version list
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to rollback');
    }
  };

  const handleCreateBranch = async (version: TestCaseVersion) => {
    const input = prompt(`Enter branch name for ${version.version_string}:`);
    if (input === null) return; // user cancelled

    const branchName = input.trim();
    if (!branchName) {
      alert('Branch name cannot be empty.');
      return;
    }

    try {
      await versioningApi.createBranch(
        version.id,
        branchName,
        `Created branch from version ${version.version_string}`
      );
      await fetchVersions(); // Refresh the version list
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create branch');
    }
  };

  const isVersionSelected = (version: TestCaseVersion) => {
    return selectedVersions.some(v => v.id === version.id);
  };

  const { formatRelative } = useDateFormat();
  const formatDate = (dateString: string) => formatRelative(dateString);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="ml-2">Loading version history...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-red-600">Error: {error}</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          Version History
          <Badge variant="outline">{versions.length} versions</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {selectedVersions.length === 1 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm text-blue-800">
              Selected: {selectedVersions[0].version_string}. 
              Select another version to compare.
            </p>
          </div>
        )}

        {versions.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No versions found for this test case.
          </div>
        ) : (
          <div className="space-y-3">
            {versions.map((version) => {
              const StatusIcon = statusIcons[version.status];
              const isExpanded = expandedVersions.has(version.id);
              const isSelected = isVersionSelected(version);

              return (
                <div
                  key={version.id}
                  className={`border rounded-lg transition-all ${
                    isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                  } ${version.is_current_version ? 'ring-2 ring-green-500' : ''}`}
                >
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleVersionExpansion(version.id)}
                          className="p-1 h-6 w-6"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>

                        <div className="flex items-center gap-2">
                          {version.branch_name ? (
                            <GitBranch className="h-4 w-4 text-purple-600" />
                          ) : (
                            <Tag className="h-4 w-4 text-gray-600" />
                          )}
                          <span className="font-medium">{version.version_string}</span>
                          {version.is_current_version && (
                            <Badge variant="default" className="text-xs">
                              Current
                            </Badge>
                          )}
                        </div>

                        <Badge className={statusColors[version.status]}>
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {version.status.replace('_', ' ')}
                        </Badge>

                        {version.tags && version.tags.length > 0 && (
                          <div className="flex gap-1">
                            {version.tags.map((tag) => (
                              <Badge
                                key={tag.id}
                                variant="outline"
                                style={{ borderColor: tag.color, color: tag.color }}
                                className="text-xs"
                              >
                                {tag.tag_name}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="text-sm text-gray-500 flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {version.creator?.full_name || version.creator?.username}
                        </div>
                        <div className="text-sm text-gray-500 flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(version.created_at)}
                        </div>
                      </div>
                    </div>

                    {version.version_name && (
                      <div className="mt-2 font-medium text-gray-900">
                        {version.version_name}
                      </div>
                    )}

                    {version.change_summary && (
                      <div className="mt-1 text-sm text-gray-600">
                        {version.change_summary}
                      </div>
                    )}

                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-gray-200 space-y-3">
                        {version.description && (
                          <div>
                            <h5 className="font-medium text-sm mb-1">Description</h5>
                            <p className="text-sm text-gray-600">{version.description}</p>
                          </div>
                        )}

                        {version.change_reason && (
                          <div>
                            <h5 className="font-medium text-sm mb-1">Change Reason</h5>
                            <p className="text-sm text-gray-600">{version.change_reason}</p>
                          </div>
                        )}

                        <div className="flex gap-2 pt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleVersionSelect(version)}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleVersionCompare(version)}
                            disabled={isSelected}
                          >
                            <GitMerge className="h-4 w-4 mr-1" />
                            {isSelected ? 'Selected' : 'Compare'}
                          </Button>

                          {version.status === 'published' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRollback(version)}
                            >
                              <RotateCcw className="h-4 w-4 mr-1" />
                              Rollback
                            </Button>
                          )}

                          {!version.branch_name && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleCreateBranch(version)}
                            >
                              <GitBranch className="h-4 w-4 mr-1" />
                              Branch
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
