import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { VersionHistory } from './VersionHistory';
import { VersionComparison } from './VersionComparison';
import { 
  History, 
  GitCompare, 
  Plus, 
  RotateCcw,
  GitBranch,
  Tag,
  Lock,
  Settings
} from 'lucide-react';
import { TestCaseVersion, VersionComparisonResponse } from '../../types/versioning';
import { versioningApi } from '../../api/versioning';

interface VersionManagerProps {
  testCaseId: number;
  testCaseTitle: string;
  onVersionCreated?: () => void;
}

export const VersionManager: React.FC<VersionManagerProps> = ({
  testCaseId,
  testCaseTitle,
  onVersionCreated
}) => {
  const [activeTab, setActiveTab] = useState('history');
  const [selectedVersions, setSelectedVersions] = useState<[TestCaseVersion | null, TestCaseVersion | null]>([null, null]);
  const [comparison, setComparison] = useState<VersionComparisonResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const handleVersionSelect = (_version: TestCaseVersion) => {
    // Placeholder: a future enhancement could open a modal to view version details.
  };

  const handleCompareVersions = async (fromVersion: TestCaseVersion, toVersion: TestCaseVersion) => {
    setLoading(true);
    try {
      const comparisonData = await versioningApi.compareVersions(fromVersion.id, toVersion.id);
      setComparison(comparisonData);
      setSelectedVersions([fromVersion, toVersion]);
      setActiveTab('comparison');
    } catch (error) {
      console.error('Error comparing versions:', error);
      alert('Failed to compare versions');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNewVersion = async () => {
    try {
      await versioningApi.createVersion(testCaseId, {
        version_name: `New version - ${new Date().toLocaleDateString()}`,
        change_summary: 'Created new version',
        change_reason: 'Manual version creation'
      });

      if (onVersionCreated) {
        onVersionCreated();
      }
      
      // Refresh the version history
      setActiveTab('history');
    } catch (error) {
      console.error('Error creating version:', error);
      alert('Failed to create version');
    }
  };

  const handleRefreshComparison = async () => {
    if (!selectedVersions[0] || !selectedVersions[1]) return;
    
    await handleCompareVersions(selectedVersions[0], selectedVersions[1]);
  };

  const handleBackToHistory = () => {
    setActiveTab('history');
    setSelectedVersions([null, null]);
    setComparison(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Version Management
              </CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Test Case: {testCaseTitle}
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreateNewVersion}>
                <Plus className="h-4 w-4 mr-2" />
                Create Version
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="history" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Version History
          </TabsTrigger>
          <TabsTrigger value="comparison" className="flex items-center gap-2">
            <GitCompare className="h-4 w-4" />
            Comparison
          </TabsTrigger>
          <TabsTrigger value="operations" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Operations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="space-y-4">
          <VersionHistory
            testCaseId={testCaseId}
            onVersionSelect={handleVersionSelect}
            onCompareVersions={handleCompareVersions}
          />
        </TabsContent>

        <TabsContent value="comparison" className="space-y-4">
          {selectedVersions[0] && selectedVersions[1] ? (
            <VersionComparison
              fromVersion={selectedVersions[0]}
              toVersion={selectedVersions[1]}
              comparison={comparison}
              onBack={handleBackToHistory}
              onRefresh={handleRefreshComparison}
            />
          ) : (
            <Card>
              <CardContent className="p-6">
                <div className="text-center text-gray-500">
                  <GitCompare className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                  <p>Select two versions from the history tab to compare them.</p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => setActiveTab('history')}
                  >
                    Go to Version History
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="operations" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 border rounded-lg">
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    Create Version
                  </h4>
                  <p className="text-sm text-gray-600 mb-3">
                    Create a new version of this test case
                  </p>
                  <Button size="sm" onClick={handleCreateNewVersion}>
                    Create New Version
                  </Button>
                </div>

                <div className="p-4 border rounded-lg">
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <GitBranch className="h-4 w-4" />
                    Create Branch
                  </h4>
                  <p className="text-sm text-gray-600 mb-3">
                    Create a branch from an existing version
                  </p>
                  <Button size="sm" variant="outline">
                    Select Version to Branch
                  </Button>
                </div>

                <div className="p-4 border rounded-lg">
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <RotateCcw className="h-4 w-4" />
                    Rollback
                  </h4>
                  <p className="text-sm text-gray-600 mb-3">
                    Rollback to a previous version
                  </p>
                  <Button size="sm" variant="outline">
                    Select Version to Rollback
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Version Statistics */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Version Statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <VersionStats testCaseId={testCaseId} />
              </CardContent>
            </Card>
          </div>

          {/* Version Operations Guide */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Version Operations Guide</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <Tag className="h-4 w-4" />
                    Version Control Features
                  </h4>
                  <ul className="space-y-2 text-sm text-gray-600">
                    <li>• <strong>Semantic Versioning:</strong> v1.0.0 format with major.minor.patch</li>
                    <li>• <strong>Branching:</strong> Create feature branches from any version</li>
                    <li>• <strong>Merging:</strong> Merge branches back to main line</li>
                    <li>• <strong>Rollback:</strong> Revert to any previous version</li>
                    <li>• <strong>Comparison:</strong> Detailed diff between versions</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <Lock className="h-4 w-4" />
                    Workflow & Security
                  </h4>
                  <ul className="space-y-2 text-sm text-gray-600">
                    <li>• <strong>Draft Status:</strong> Work on versions before publishing</li>
                    <li>• <strong>Review Process:</strong> Optional review before approval</li>
                    <li>• <strong>Version Locking:</strong> Prevent conflicts during editing</li>
                    <li>• <strong>Access Control:</strong> Role-based permissions</li>
                    <li>• <strong>Audit Trail:</strong> Complete history of changes</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

// Component for version statistics
const VersionStats: React.FC<{ testCaseId: number }> = ({ testCaseId }) => {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await versioningApi.getVersionStats(testCaseId);
        setStats(data);
      } catch (error) {
        console.error('Error fetching stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [testCaseId]);

  if (loading) {
    return <div className="text-center py-4">Loading statistics...</div>;
  }

  if (!stats) {
    return <div className="text-center py-4 text-gray-500">No statistics available</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="text-center p-3 bg-blue-50 rounded">
          <div className="text-2xl font-bold text-blue-600">{stats.total_versions}</div>
          <div className="text-sm text-gray-600">Total Versions</div>
        </div>
        <div className="text-center p-3 bg-green-50 rounded">
          <div className="text-2xl font-bold text-green-600">{stats.published_versions}</div>
          <div className="text-sm text-gray-600">Published</div>
        </div>
        <div className="text-center p-3 bg-yellow-50 rounded">
          <div className="text-2xl font-bold text-yellow-600">{stats.draft_versions}</div>
          <div className="text-sm text-gray-600">Drafts</div>
        </div>
        <div className="text-center p-3 bg-purple-50 rounded">
          <div className="text-2xl font-bold text-purple-600">{stats.branches}</div>
          <div className="text-sm text-gray-600">Branches</div>
        </div>
      </div>
      
      {stats.current_version && (
        <div className="text-center p-3 bg-gray-50 rounded">
          <div className="text-sm text-gray-600">Current Version</div>
          <div className="font-medium">{stats.current_version}</div>
        </div>
      )}
    </div>
  );
};
