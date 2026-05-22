import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Check, 
  X, 
  AlertTriangle, 
  ChevronDown, 
  ChevronUp,
  FileText,
  Download,
  Upload
} from 'lucide-react';

interface ProjectImportPreviewProps {
  file: File;
  validationResult: any;
  onConfirm: (mergeStrategy: string, partialImport: boolean, selectedRows: number[]) => Promise<void>;
  onCancel: () => void;
}

export function ProjectImportPreview({ file, validationResult, onConfirm, onCancel }: ProjectImportPreviewProps) {
  const [mergeStrategy, setMergeStrategy] = useState<'skip' | 'update' | 'merge'>('skip');
  const [partialImport, setPartialImport] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [showOnlyConflicts, setShowOnlyConflicts] = useState(false);
  const [showOnlyInvalid, setShowOnlyInvalid] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [isImporting, setIsImporting] = useState(false);

  const { preview_data, conflicts, total_rows, valid_rows, invalid_rows, errors, warnings } = validationResult;

  // Auto-select all valid rows by default
  useEffect(() => {
    const validRowNumbers = new Set<number>(
      preview_data
        .filter((row: any) => row.valid)
        .map((row: any) => row.row)
    );
    setSelectedRows(validRowNumbers);
  }, [preview_data]);

  const filteredData = preview_data.filter((row: any) => {
    if (showOnlyConflicts && !row.has_conflict) return false;
    if (showOnlyInvalid && row.valid) return false;
    return true;
  });

  const toggleRowExpansion = (rowNum: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(rowNum)) {
      newExpanded.delete(rowNum);
    } else {
      newExpanded.add(rowNum);
    }
    setExpandedRows(newExpanded);
  };

  const toggleRowSelection = (rowNum: number) => {
    const newSelected = new Set(selectedRows);
    if (newSelected.has(rowNum)) {
      newSelected.delete(rowNum);
    } else {
      newSelected.add(rowNum);
    }
    setSelectedRows(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedRows.size === filteredData.filter((r: any) => r.valid).length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(filteredData.filter((r: any) => r.valid).map((r: any) => r.row)));
    }
  };

  const handleConfirm = async () => {
    setIsImporting(true);
    try {
      await onConfirm(mergeStrategy, partialImport, Array.from(selectedRows));
    } finally {
      setIsImporting(false);
    }
  };

  const mergeStrategyDescriptions = {
    skip: 'Skip existing projects and only import new ones',
    update: 'Update existing projects with data from import file',
    merge: 'Create new projects with suffix (e.g., "Project (imported)")'
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="p-3 bg-blue-100 rounded-full">
            <FileText className="h-6 w-6 text-blue-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Project Import Preview</h2>
        </div>
        <p className="text-gray-600 max-w-2xl mx-auto">
          Review the project data before importing. Configure conflict resolution and select which rows to import.
        </p>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="border-0 shadow-md bg-gradient-to-br from-blue-50 to-blue-100">
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-blue-700 mb-1">{total_rows}</div>
            <div className="text-sm font-medium text-blue-600">Total Rows</div>
          </CardContent>
        </Card>
        
        <Card className="border-0 shadow-md bg-gradient-to-br from-green-50 to-green-100">
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-green-700 mb-1">{valid_rows}</div>
            <div className="text-sm font-medium text-green-600">Valid Rows</div>
          </CardContent>
        </Card>
        
        <Card className="border-0 shadow-md bg-gradient-to-br from-red-50 to-red-100">
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-red-700 mb-1">{invalid_rows}</div>
            <div className="text-sm font-medium text-red-600">Invalid Rows</div>
          </CardContent>
        </Card>
        
        <Card className="border-0 shadow-md bg-gradient-to-br from-yellow-50 to-yellow-100">
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-yellow-700 mb-1">{conflicts.length}</div>
            <div className="text-sm font-medium text-yellow-600">Conflicts</div>
          </CardContent>
        </Card>
      </div>

      {/* Conflict Resolution */}
      {conflicts.length > 0 && (
        <Alert className="border-yellow-200 bg-yellow-50">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-yellow-800">
            <div className="font-semibold mb-2">Conflicts Detected</div>
            <p className="text-sm mb-3">
              {conflicts.length} project(s) already exist. Choose how to handle these conflicts:
            </p>
            <div className="space-y-2">
              {['skip', 'update', 'merge'].map((strategy) => (
                <div key={strategy} className="flex items-start gap-3 p-2 rounded hover:bg-yellow-100 cursor-pointer" onClick={() => setMergeStrategy(strategy as any)}>
                  <Checkbox
                    checked={mergeStrategy === strategy}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="font-medium capitalize">{strategy}</div>
                    <div className="text-xs text-gray-600">{mergeStrategyDescriptions[strategy as keyof typeof mergeStrategyDescriptions]}</div>
                  </div>
                </div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={showOnlyConflicts}
            onCheckedChange={(checked) => checked !== "indeterminate" && setShowOnlyConflicts(checked)}
          />
          Show only conflicts
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={showOnlyInvalid}
            onCheckedChange={(checked) => checked !== "indeterminate" && setShowOnlyInvalid(checked)}
          />
          Show only invalid
        </label>
      </div>

      {/* Data Preview Table */}
      <Card className="shadow-lg">
        <CardHeader className="bg-gradient-to-r from-gray-50 to-gray-100 border-b">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Data Preview</CardTitle>
              <p className="text-sm text-gray-600">
                Showing {filteredData.length} of {total_rows} rows
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={toggleSelectAll}
              >
                {selectedRows.size === filteredData.filter((r: any) => r.valid).length ? 'Deselect All' : 'Select All Valid'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-3">
            {filteredData.map((row: any) => (
              <div
                key={row.row}
                className={`border-2 rounded-xl p-4 transition-all ${
                  row.valid 
                    ? row.has_conflict 
                      ? 'border-yellow-200 bg-yellow-50' 
                      : 'border-green-200 bg-green-50'
                    : 'border-red-200 bg-red-50'
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Selection Checkbox */}
                  {row.valid && (
                    <Checkbox
                      checked={selectedRows.has(row.row)}
                      onCheckedChange={() => toggleRowSelection(row.row)}
                      className="mt-1"
                    />
                  )}
                  
                  {!row.valid && (
                    <div className="w-5 h-5 mt-1" />
                  )}

                  {/* Status Icon */}
                  <div className={`p-2 rounded-lg ${
                    row.valid 
                      ? row.has_conflict 
                        ? 'bg-yellow-100' 
                        : 'bg-green-100'
                      : 'bg-red-100'
                  }`}>
                    {row.valid ? (
                      row.has_conflict ? (
                        <AlertTriangle className="h-4 w-4 text-yellow-600" />
                      ) : (
                        <Check className="h-4 w-4 text-green-600" />
                      )
                    ) : (
                      <X className="h-4 w-4 text-red-600" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">Row {row.row}</span>
                        {row.has_conflict && (
                          <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">
                            Conflict
                          </Badge>
                        )}
                        {!row.valid && (
                          <Badge variant="destructive">
                            Invalid
                          </Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleRowExpansion(row.row)}
                      >
                        {expandedRows.has(row.row) ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </div>

                    {/* Summary */}
                    <div className="text-sm text-gray-700 mb-2">
                      <span className="font-medium">Project:</span> {row.data.name || 'N/A'}
                    </div>

                    {/* Errors/Warnings */}
                    {row.errors.length > 0 && (
                      <div className="space-y-1 mb-2">
                        {row.errors.map((error: string, idx: number) => (
                          <div key={idx} className="text-xs text-red-600 flex items-center gap-1">
                            <X className="h-3 w-3" />
                            {error}
                          </div>
                        ))}
                      </div>
                    )}

                    {row.warnings.length > 0 && (
                      <div className="space-y-1 mb-2">
                        {row.warnings.map((warning: string, idx: number) => (
                          <div key={idx} className="text-xs text-yellow-600 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {warning}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Expanded Details */}
                    {expandedRows.has(row.row) && (
                      <div className="mt-3 p-3 bg-white rounded-lg border">
                        <pre className="text-xs text-gray-700 overflow-x-auto">
                          {JSON.stringify(row.data, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Partial Import Option */}
      {invalid_rows > 0 && (
        <Alert className="border-blue-200 bg-blue-50">
          <AlertDescription className="text-blue-800">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold mb-1">Partial Import Available</div>
                <p className="text-sm">
                  Enable partial import to skip invalid rows and import only valid data.
                </p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={partialImport}
                  onCheckedChange={(checked) => checked !== "indeterminate" && setPartialImport(checked)}
                />
                <span className="text-sm font-medium">Enable Partial Import</span>
              </label>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Action Buttons */}
      <div className="flex justify-between items-center pt-4">
        <div className="text-sm text-gray-600">
          {selectedRows.size} row(s) selected for import
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isImporting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isImporting || selectedRows.size === 0}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isImporting ? (
              <>
                <Upload className="h-4 w-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Import {selectedRows.size} Project(s)
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
