'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { authenticatedFetch } from '@/lib/clientAuth';

interface ExportButtonProps {
  matchId?: string;
  agentId?: string;
  agentName?: string;
  className?: string;
}

export default function ExportButton({ matchId, agentId, agentName, className = '' }: ExportButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setLoading(true);
    setError(null);

    try {
      let url: string;
      let filename: string;

      if (matchId) {
        url = `/api/matches/${matchId}/export`;
        filename = `match_${matchId}_${Date.now()}.json`;
      } else if (agentId) {
        url = `/api/agents/${agentId}/matches/export`;
        const safeName = agentName?.replace(/[^a-zA-Z0-9]/g, '_') || 'agent';
        filename = `${safeName}_matches_${Date.now()}.json`;
      } else {
        throw new Error('Either matchId or agentId is required');
      }

      const response = await authenticatedFetch(url);

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Export failed: ${response.status}`);
      }

      // Get filename from Content-Disposition header if available
      const contentDisposition = response.headers.get('Content-Disposition');
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match) {
          filename = match[1];
        }
      }

      // Trigger download
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed';
      setError(message);
      console.error('Export error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={handleExport}
        disabled={loading}
        className={`flex items-center gap-2 bg-gray-700/50 backdrop-blur hover:bg-gray-600/50 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-semibold transition-all shadow-lg ${className}`}
        title={matchId ? 'Export match as JSON' : 'Export all matches as JSON'}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Download className="w-4 h-4" />
        )}
        {matchId ? 'Export' : 'Export All'}
      </button>
      {error && (
        <div className="absolute top-full left-0 mt-2 p-2 bg-red-900/90 border border-red-500/50 rounded-lg text-red-200 text-xs whitespace-nowrap z-50">
          {error}
        </div>
      )}
    </div>
  );
}
