import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { 
  GitCompare, 
  ArrowLeftRight, 
  Plus, 
  Minus, 
  Eye,
  CheckCircle,
  XCircle,
  AlertCircle,
  Edit3
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { TestCaseVersion, VersionComparisonResponse } from '../../types/versioning';

interface VersionComparisonProps {
  fromVersion: TestCaseVersion;
  toVersion: TestCaseVersion;
  comparison?: VersionComparisonResponse;
  onBack?: () => void;
  onRefresh?: () => void;
}

const fieldLabels: Record<string, string> = {
  title: 'Title',
  test_type: 'Test Type',
  preconditions: 'Preconditions',
  steps: 'Steps',
  expected_result: 'Expected Result',
  priority: 'Priority',
  tags: 'Tags'
};

export const VersionComparison: React.FC<VersionComparisonProps> = ({
  fromVersion,
  toVersion,
  comparison,
  onBack,
  onRefresh
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'side-by-side' | 'unified'>('side-by-side');

  const handleRefreshComparison = async () => {
    if (!onRefresh) return;
    
    try {
      setLoading(true);
      setError(null);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh comparison');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return formatDistanceToNow(new Date(dateString), { addSuffix: true });
  };

  const renderFieldDiff = (fieldName: string, diff: { from: any; to: any; diff?: string }) => {
    const label = fieldLabels[fieldName] || fieldName;
    const isCustomField = fieldName.startsWith('custom_');
    const displayName = isCustomField ? fieldName.replace('custom_', '') : label;

    return (
      <div key={fieldName} className="border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium">{displayName}</h4>
          <Badge variant="outline" className="text-xs">
            {isCustomField ? 'Custom Field' : 'Standard Field'}
          </Badge>
        </div>

        {viewMode === 'side-by-side' ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-red-600">
                <Minus className="h-4 w-4" />
                From ({fromVersion.version_string})
              </div>
              <div className="bg-red-50 border border-red-200 rounded p-3">
                {diff.from ? (
                  <pre className="whitespace-pre-wrap text-sm">{diff.from}</pre>
                ) : (
                  <span className="text-gray-500 italic">Empty</span>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-green-600">
                <Plus className="h-4 w-4" />
                To ({toVersion.version_string})
              </div>
              <div className="bg-green-50 border border-green-200 rounded p-3">
                {diff.to ? (
                  <pre className="whitespace-pre-wrap text-sm">{diff.to}</pre>
                ) : (
                  <span className="text-gray-500 italic">Empty</span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="bg-gray-50 border rounded p-3">
              {diff.diff ? (
                <pre className="whitespace-pre-wrap text-sm font-mono">{diff.diff}</pre>
              ) : (
                <div className="space-y-2">
                  <div className="text-red-600">
                    <span className="font-medium">- </span>
                    <span>{diff.from || '(empty)'}</span>
                  </div>
                  <div className="text-green-600">
                    <span className="font-medium">+ </span>
                    <span>{diff.to || '(empty)'}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const getSimilarityIcon = (score: number) => {
    if (score >= 90) return <CheckCircle className="h-5 w-5 text-green-600" />;
    if (score >= 70) return <AlertCircle className="h-5 w-5 text-yellow-600" />;
    return <XCircle className="h-5 w-5 text-red-600" />;
  };

  const getSimilarityColor = (score: number) => {
    if (score >= 90) return 'text-green-600 bg-green-50';
    if (score >= 70) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  if (!comparison) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-gray-500">
            No comparison data available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <GitCompare className="h-5 w-5" />
              Version Comparison
            </CardTitle>
            <div className="flex gap-2">
              {onBack && (
                <Button variant="outline" onClick={onBack}>
                  <ArrowLeftRight className="h-4 w-4 mr-2" />
                  Back to History
                </Button>
              )}
              <Button
                variant="outline"
                onClick={handleRefreshComparison}
                disabled={loading}
              >
                {loading ? 'Refreshing...' : 'Refresh'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-6">
            {/* From Version */}
            <div className="space-y-3">
              <h3 className="font-medium text-red-600">From Version</h3>
              <div className="border rounded-lg p-4 bg-red-50 border-red-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">{fromVersion.version_string}</span>
                  <Badge variant="outline">{fromVersion.status}</Badge>
                </div>
                <div className="text-sm space-y-1">
                  <div><strong>Title:</strong> {fromVersion.title}</div>
                  <div><strong>Created:</strong> {formatDate(fromVersion.created_at)}</div>
                  <div><strong>By:</strong> {fromVersion.creator?.full_name || fromVersion.creator?.username}</div>
                </div>
              </div>
            </div>

            {/* To Version */}
            <div className="space-y-3">
              <h3 className="font-medium text-green-600">To Version</h3>
              <div className="border rounded-lg p-4 bg-green-50 border-green-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">{toVersion.version_string}</span>
                  <Badge variant="outline">{toVersion.status}</Badge>
                </div>
                <div className="text-sm space-y-1">
                  <div><strong>Title:</strong> {toVersion.title}</div>
                  <div><strong>Created:</strong> {formatDate(toVersion.created_at)}</div>
                  <div><strong>By:</strong> {toVersion.creator?.full_name || toVersion.creator?.username}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Similarity Score */}
          <div className="mt-6 p-4 border rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h4 className="font-medium">Similarity Score</h4>
                {getSimilarityIcon(comparison.similarity_score)}
              </div>
              <div className={`px-3 py-1 rounded-full font-medium ${getSimilarityColor(comparison.similarity_score)}`}>
                {comparison.similarity_score}% similar
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <Card>
          <CardContent className="p-6">
            <div className="text-red-600">Error: {error}</div>
          </CardContent>
        </Card>
      )}

      {/* Comparison Results */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Comparison Results</CardTitle>
            <div className="flex gap-2">
              <Button
                variant={viewMode === 'side-by-side' ? 'default' : 'outline-solid'}
                size="sm"
                onClick={() => setViewMode('side-by-side')}
              >
                <Eye className="h-4 w-4 mr-1" />
                Side by Side
              </Button>
              <Button
                variant={viewMode === 'unified' ? 'default' : 'outline-solid'}
                size="sm"
                onClick={() => setViewMode('unified')}
              >
                Git Diff
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Modified Fields */}
          {Object.keys(comparison.modified_fields).length > 0 && (
            <div>
              <h3 className="font-medium mb-3 flex items-center gap-2">
                <Edit3 className="h-4 w-4" />
                Modified Fields ({Object.keys(comparison.modified_fields).length})
              </h3>
              <div className="space-y-3">
                {Object.entries(comparison.modified_fields).map(([fieldName, diff]) =>
                  renderFieldDiff(fieldName, diff)
                )}
              </div>
            </div>
          )}

          {/* Added Fields */}
          {Object.keys(comparison.added_fields).length > 0 && (
            <div>
              <h3 className="font-medium mb-3 flex items-center gap-2">
                <Plus className="h-4 w-4 text-green-600" />
                Added Fields ({Object.keys(comparison.added_fields).length})
              </h3>
              <div className="space-y-3">
                {Object.entries(comparison.added_fields).map(([fieldName, value]) => {
                  const label = fieldLabels[fieldName] || fieldName;
                  const isCustomField = fieldName.startsWith('custom_');
                  const displayName = isCustomField ? fieldName.replace('custom_', '') : label;

                  return (
                    <div key={fieldName} className="border rounded-lg p-4 bg-green-50 border-green-200">
                      <div className="flex items-center gap-2 mb-2">
                        <Plus className="h-4 w-4 text-green-600" />
                        <h4 className="font-medium">{displayName}</h4>
                        <Badge variant="outline" className="text-xs bg-green-100 text-green-800">
                          Added
                        </Badge>
                      </div>
                      <pre className="whitespace-pre-wrap text-sm">{value}</pre>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Removed Fields */}
          {Object.keys(comparison.removed_fields).length > 0 && (
            <div>
              <h3 className="font-medium mb-3 flex items-center gap-2">
                <Minus className="h-4 w-4 text-red-600" />
                Removed Fields ({Object.keys(comparison.removed_fields).length})
              </h3>
              <div className="space-y-3">
                {Object.entries(comparison.removed_fields).map(([fieldName, value]) => {
                  const label = fieldLabels[fieldName] || fieldName;
                  const isCustomField = fieldName.startsWith('custom_');
                  const displayName = isCustomField ? fieldName.replace('custom_', '') : label;

                  return (
                    <div key={fieldName} className="border rounded-lg p-4 bg-red-50 border-red-200">
                      <div className="flex items-center gap-2 mb-2">
                        <Minus className="h-4 w-4 text-red-600" />
                        <h4 className="font-medium">{displayName}</h4>
                        <Badge variant="outline" className="text-xs bg-red-100 text-red-800">
                          Removed
                        </Badge>
                      </div>
                      <pre className="whitespace-pre-wrap text-sm">{value}</pre>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* No Changes */}
          {Object.keys(comparison.modified_fields).length === 0 &&
           Object.keys(comparison.added_fields).length === 0 &&
           Object.keys(comparison.removed_fields).length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No differences found between these versions.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
