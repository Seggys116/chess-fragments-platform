'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import AnimatedBackground from '@/components/AnimatedBackground';
import { Upload, Code2, AlertCircle, CheckCircle, Loader2, FileCode, Shield, FilePlus } from 'lucide-react';

const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GiB

export default function UploadPage() {
    const [accessCode, setAccessCode] = useState('');
    const [userId, setUserId] = useState('');
    const [agentName, setAgentName] = useState('');
    const [uploadCode, setUploadCode] = useState('');
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const [uploadedFileName, setUploadedFileName] = useState('');
    const [isLargeFile, setIsLargeFile] = useState(false);
    const [fileReadProgress, setFileReadProgress] = useState(0);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [isReading, setIsReading] = useState(false);
    const [validationStatus, setValidationStatus] = useState<{
        status: string;
        position: number;
        error?: string;
        agentId?: string;
    } | null>(null);
    const [queueId, setQueueId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const [concurrencyWarning, setConcurrencyWarning] = useState('');

    useEffect(() => {
        const stored = localStorage.getItem('fragmentarena_code');
        if (stored) {
            setAccessCode(stored);
            verifyCode(stored);
        }

        return () => {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
            }
        };
    }, []);

    const verifyCode = async (code: string) => {
        try {
            const response = await fetch('/api/auth/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accessCode: code }),
            });

            const data = await response.json();
            if (response.ok) {
                setUserId(data.userId);
            }
        } catch (err) {
            console.error('Failed to verify code:', err);
        }
    };

    const handleFileRead = (file: File) => {
        if (file.name !== 'agent.py') {
            setError('File must be named "agent.py"');
            return;
        }

        if (file.size > MAX_FILE_SIZE) {
            setError(`File size exceeds maximum of ${(MAX_FILE_SIZE / (1024 * 1024 * 1024)).toFixed(1)}GiB`);
            return;
        }

        const isLarge = file.size > 1024 * 1024;
        setIsLargeFile(isLarge);
        setIsReading(true);
        setFileReadProgress(0);

        const reader = new FileReader();

        reader.onprogress = (e) => {
            if (e.lengthComputable) {
                const progress = Math.round((e.loaded / e.total) * 100);
                setFileReadProgress(progress);
            }
        };

        reader.onload = (e) => {
            const content = e.target?.result as string;
            setCode(content);
            setUploadedFileName(file.name);
            setFileReadProgress(100);
            setIsReading(false);
            setError('');
        };

        reader.onerror = () => {
            setError('Failed to read file');
            setIsReading(false);
            setFileReadProgress(0);
        };

        reader.readAsText(file);
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            handleFileRead(file);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const file = e.dataTransfer.files[0];
        if (file) {
            handleFileRead(file);
        }
    };

    const pollValidationStatus = async (id: string) => {
        try {
            const response = await fetch(`/api/agents/validation/${id}`, {
                headers: {
                    'Content-Type': 'application/json',
                    'x-access-code': accessCode,
                },
            });

            if (!response.ok) {
                throw new Error('Failed to fetch validation status');
            }

            const data = await response.json();
            setValidationStatus(data);

            if (data.status === 'passed') {
                // Validation passed - clear polling and redirect
                if (pollIntervalRef.current) {
                    clearInterval(pollIntervalRef.current);
                }
                setSuccess('Agent validated successfully.');
                setLoading(false);
                setTimeout(() => {
                    window.location.href = `/agent/${data.agentId}`;
                }, 1500);
            } else if (data.status === 'failed') {
                // Validation failed - clear polling and show error
                if (pollIntervalRef.current) {
                    clearInterval(pollIntervalRef.current);
                }
                setError(data.error || 'Validation failed');
                setLoading(false);
            }
        } catch (err) {
            console.error('Failed to poll validation status:', err);
        }
    };

    const isConcurrencyError = (message: string | undefined) => {
        if (!message) return false;
        return /multiprocess|multithread/i.test(message);
    };

    const handleUpload = async () => {
        if (!agentName || !code) {
            setError('Please provide both agent name and code');
            return;
        }

        setLoading(true);
        setError('');
        setConcurrencyWarning('');
        setSuccess('');
        setValidationStatus(null);
        setUploadProgress(0);

        return new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const progress = Math.round((e.loaded / e.total) * 100);
                    setUploadProgress(progress);
                }
            });

            xhr.addEventListener('load', () => {
                try {
                    const data = JSON.parse(xhr.responseText);

                    if (xhr.status !== 200) {
                        if (xhr.status === 429) {
                            throw new Error(
                                `Rate limit exceeded. Please wait ${data.retryAfter} seconds before uploading again.`
                            );
                        }
                        if (isConcurrencyError(data.error)) {
                            setConcurrencyWarning('You are not allowed to multithread your agent as threads are used to allow for multiple games to be played at once not to be used on one agent.');
                        }
                        throw new Error(data.error || 'Upload failed');
                    }

                    // Agent submitted for validation
                    setQueueId(data.queueId);
                    setValidationStatus({
                        status: data.status,
                        position: data.position,
                    });

                    // Clear code/name on submission
                    setCode('');
                    setAgentName('');
                    setUploadedFileName('');
                    setIsLargeFile(false);
                    setUploadProgress(0);

                    // Start polling for validation status
                    pollValidationStatus(data.queueId);
                    pollIntervalRef.current = setInterval(() => {
                        pollValidationStatus(data.queueId);
                    }, 2000);

                    resolve();
                } catch (err) {
                    setError(err instanceof Error ? err.message : 'An error occurred');
                    setLoading(false);
                    setUploadProgress(0);
                    reject(err);
                }
            });

            xhr.addEventListener('error', () => {
                setError('Network error occurred during upload');
                setLoading(false);
                setUploadProgress(0);
                reject(new Error('Network error'));
            });

            xhr.addEventListener('abort', () => {
                setError('Upload was cancelled');
                setLoading(false);
                setUploadProgress(0);
                reject(new Error('Upload cancelled'));
            });

            xhr.open('POST', '/api/agents/upload');
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify({
                userId,
                accessCode,
                name: agentName,
                code,
                uploadCode,
            }));
        });
    };

    if (!accessCode || !userId) {
        return (
            <div className="min-h-screen relative flex items-center justify-center p-4">
                <AnimatedBackground />
                <div className="relative z-10">
                    <Navigation />
                    <div className="flex items-center justify-center min-h-[calc(100vh-80px)]">
                        <div className="bg-gray-800/50 backdrop-blur rounded-lg border border-purple-500/20 p-8 max-w-md shadow-xl">
                            <div className="flex items-center gap-3 mb-4">
                                <Shield className="w-8 h-8 text-purple-400" />
                                <h2 className="text-2xl font-bold text-white">Access Required</h2>
                            </div>
                            <p className="text-gray-400 mb-6">
                                Please generate or enter your access code to upload agents.
                            </p>
                            <Link
                                href="/start"
                                className="block w-full bg-purple-600/80 backdrop-blur hover:bg-purple-700/80 text-white text-center px-6 py-3 rounded-lg font-semibold transition-all shadow-lg shadow-purple-500/20"
                            >
                                Get Access Code
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen relative">
            <AnimatedBackground />
            <div className="relative z-10">
                <Navigation />
                <div className="container mx-auto max-w-4xl py-8 px-4">
                    {/* Header */}
                    <div className="mb-8 text-center">
                        <div className="inline-flex items-center gap-3 mb-4">
                            <FileCode className="w-10 h-10 text-purple-400" />
                            <h1 className="text-5xl font-bold text-white">Upload Your Agent</h1>
                        </div>
                        <p className="text-gray-400 text-lg">Submit your chess AI agent to join the competition</p>
                    </div>

                    <div className="bg-gray-800/50 backdrop-blur rounded-xl border border-purple-500/20 p-8 shadow-2xl">
                        {/* Upload Notice */}
                        <div className="mb-6 bg-blue-900/20 border border-blue-500/30 rounded-lg p-4">
                            <h3 className="text-blue-300 font-semibold mb-2 flex items-center gap-2">
                                <AlertCircle className="w-5 h-5" />
                                Upload Code Required
                            </h3>
                            <p className="text-sm text-gray-300 mb-2">
                                Agent uploads require a rotating 6-character code for 24/7 testing access.
                                This code is only needed when <strong>creating a new agent</strong>, not for updates.
                            </p>
                            <p className="text-sm text-gray-400">
                                Contact <strong>seggy116</strong> on Discord to request an upload code.
                            </p>
                        </div>

                        {/* Agent Name */}
                        <div className="mb-6">
                            <label className="flex items-center gap-2 text-purple-300 mb-3 font-semibold">
                                <Code2 className="w-5 h-5" />
                                Agent Name
                            </label>
                            <input
                                type="text"
                                value={agentName}
                                onChange={(e) => setAgentName(e.target.value)}
                                placeholder="e.g., MyChessBot"
                                className="w-full px-4 py-3 bg-gray-900/50 border border-purple-500/30 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                                maxLength={100}
                            />
                            <p className="text-sm text-gray-500 mt-2 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" />
                                A new version will be created if this name already exists
                            </p>
                        </div>

                        {/* Upload Code */}
                        <div className="mb-6">
                            <label className="flex items-center gap-2 text-purple-300 mb-3 font-semibold">
                                <Shield className="w-5 h-5" />
                                Upload Code
                            </label>
                            <input
                                type="text"
                                value={uploadCode}
                                onChange={(e) => setUploadCode(e.target.value.toUpperCase())}
                                placeholder="ABC-123"
                                className="w-full px-4 py-3 bg-gray-900/50 border border-purple-500/30 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all font-mono text-center text-lg tracking-wider"
                                maxLength={7}
                            />
                            <p className="text-sm text-gray-500 mt-2 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" />
                                Required for new agents only • Code rotates every 30 minutes
                            </p>
                        </div>

                        {/* Drag and Drop Zone */}
                        <div className="mb-6">
                            <label className="flex items-center gap-2 text-purple-300 mb-3 font-semibold">
                                <FilePlus className="w-5 h-5" />
                                Upload File
                            </label>
                            <div
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                                onClick={() => !isReading && fileInputRef.current?.click()}
                                className={`relative border-2 border-dashed rounded-xl p-8 transition-all ${isReading ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'
                                    } ${isDragging
                                        ? 'border-purple-400 bg-purple-500/20 scale-[1.02]'
                                        : 'border-purple-500/30 bg-gray-900/30 hover:border-purple-400/50 hover:bg-purple-500/10'
                                    }`}
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".py"
                                    onChange={handleFileSelect}
                                    className="hidden"
                                    disabled={isReading}
                                />
                                <div className="flex flex-col items-center justify-center gap-3">
                                    <div className={`p-4 rounded-full transition-all ${isDragging ? 'bg-purple-500/30' : 'bg-purple-500/20'
                                        }`}>
                                        <Upload className={`w-8 h-8 transition-all ${isDragging ? 'text-purple-300 scale-110' : 'text-purple-400'
                                            } ${isReading ? 'animate-pulse' : ''}`} />
                                    </div>
                                    {isReading ? (
                                        <div className="text-center w-full">
                                            <p className="text-blue-400 font-semibold mb-3">Reading File...</p>
                                            <div className="w-full max-w-md mx-auto">
                                                <div className="bg-gray-800/50 rounded-full h-3 overflow-hidden border border-purple-500/30">
                                                    <div
                                                        className="bg-gradient-to-r from-purple-600 to-blue-600 h-full transition-all duration-300 flex items-center justify-end pr-2"
                                                        style={{ width: `${fileReadProgress}%` }}
                                                    >
                                                        <span className="text-xs font-bold text-white drop-shadow-lg">
                                                            {fileReadProgress}%
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ) : uploadedFileName ? (
                                        <div className="text-center">
                                            <p className="text-green-400 font-semibold mb-1">File Loaded</p>
                                            <p className="text-sm text-gray-400">{uploadedFileName}</p>
                                            <p className="text-xs text-purple-400 mt-2">Click or drag to replace</p>
                                        </div>
                                    ) : (
                                        <div className="text-center">
                                            <p className="text-white font-semibold mb-1">
                                                {isDragging ? 'Drop your agent.py file here' : 'Drag and drop your agent.py file'}
                                            </p>
                                            <p className="text-sm text-gray-400">or click to browse</p>
                                            <p className="text-xs text-purple-400 mt-2">Must be named &quot;agent.py&quot; • Max 1GiB</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Divider */}
                        <div className="relative mb-6">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-purple-500/20"></div>
                            </div>
                            <div className="relative flex justify-center text-sm">
                                <span className="px-4 bg-gray-800/50 text-gray-400">or paste code directly</span>
                            </div>
                        </div>

                        {/* Code Editor */}
                        <div className="mb-6">
                            <label className="flex items-center gap-2 text-purple-300 mb-3 font-semibold">
                                <FileCode className="w-5 h-5" />
                                Agent Code (Python)
                            </label>
                            {uploadedFileName ? (
                                <div className="bg-green-900/20 border border-green-500/30 rounded-lg p-8 text-center">
                                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/20 mb-4">
                                        <FileCode className="w-8 h-8 text-green-400" />
                                    </div>
                                    <p className="text-green-400 font-semibold text-lg mb-2">
                                        {isLargeFile ? 'Large File Loaded' : 'File Loaded'}
                                    </p>
                                    <p className="text-gray-400 mb-1">{uploadedFileName}</p>
                                    <p className="text-sm text-gray-500 mb-4">
                                        {code.length >= 1024 * 1024
                                            ? `${(code.length / 1024 / 1024).toFixed(2)} MB`
                                            : `${(code.length / 1024).toFixed(2)} KB`} loaded
                                    </p>
                                    <button
                                        onClick={() => {
                                            setIsLargeFile(false);
                                            setUploadedFileName('');
                                            setCode('');
                                        }}
                                        className="text-sm text-purple-400 hover:text-purple-300 underline"
                                    >
                                        Clear and paste code manually instead
                                    </button>
                                </div>
                            ) : (
                                <div className="relative">
                                    <textarea
                                        value={code}
                                        onChange={(e) => {
                                            setCode(e.target.value);
                                            setIsLargeFile(false);
                                            setUploadedFileName('');
                                        }}
                                        placeholder={`def agent(board, player, var):
    """
    Your agent implementation here
    """
    # Get legal moves
    legal_moves = list_legal_moves_for(board, player)

    if not legal_moves:
        return None, None

    # Return (piece, move)
    return legal_moves[0]`}
                                        className="w-full h-96 px-4 py-3 bg-gray-900/70 border border-purple-500/30 rounded-lg text-green-400 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm transition-all"
                                        spellCheck={false}
                                    />
                                    <div className="absolute top-2 right-2 bg-gray-800/80 backdrop-blur px-2 py-1 rounded text-xs text-gray-400">
                                        Python
                                    </div>
                                </div>
                            )}
                            <div className="flex justify-between mt-2">
                                <p className="text-sm text-gray-500">
                                    Max: 1GiB | Required: <code className="text-purple-400">def agent(board, player, var)</code>
                                </p>
                                <p className={`text-sm ${code.length > MAX_FILE_SIZE ? 'text-red-400' : 'text-gray-500'}`}>
                                    {code.length.toLocaleString()} / {MAX_FILE_SIZE.toLocaleString()} bytes
                                </p>
                            </div>
                        </div>

                        {/* Requirements */}
                        <div className="mb-6 bg-purple-900/20 border border-purple-500/30 rounded-lg p-4">
                            <h3 className="text-purple-300 font-semibold mb-3 flex items-center gap-2">
                                <Shield className="w-5 h-5" />
                                Requirements & Restrictions
                            </h3>
                            <div className="grid md:grid-cols-2 gap-4">
                                <div>
                                    <h4 className="text-green-400 text-sm font-semibold mb-2">✓ Allowed</h4>
                                    <ul className="text-gray-400 text-sm space-y-1">
                                        <li>• Standard library imports</li>
                                        <li>• chessmaker & extension modules</li>
                                        <li>• Custom helper functions</li>
                                        <li>• Global variables</li>
                                    </ul>
                                </div>
                                <div>
                                    <h4 className="text-red-400 text-sm font-semibold mb-2">✗ Restricted</h4>
                                    <ul className="text-gray-400 text-sm space-y-1">
                                        <li>• os, subprocess, socket modules</li>
                                        <li>• File I/O operations</li>
                                        <li>• Network connections</li>
                                        <li>• Move time &gt; {process.env.NEXT_PUBLIC_AGENT_TIMEOUT_SECONDS || '14'} seconds</li>
                                    </ul>
                                </div>
                            </div>
                        </div>

                        {/* Upload Button */}
                        <button
                            onClick={handleUpload}
                            disabled={loading || !agentName || !code}
                            className={`w-full px-6 py-4 rounded-lg font-semibold text-lg transition-all duration-300 flex items-center justify-center gap-3 ${loading || !agentName || !code
                                    ? 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                                    : 'bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50'
                                }`}
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="w-6 h-6 animate-spin" />
                                    Uploading Agent...
                                </>
                            ) : (
                                <>
                                    <Upload className="w-6 h-6" />
                                    Upload Agent
                                </>
                            )}
                        </button>

                        {/* Upload Progress */}
                        {loading && uploadProgress > 0 && (
                            <div className="mt-4 bg-blue-900/20 border border-blue-500/30 rounded-lg p-4">
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-blue-300 font-semibold">Upload Progress</p>
                                    <p className="text-blue-200 text-sm font-bold">{uploadProgress}%</p>
                                </div>
                                <div className="bg-gray-800/50 rounded-full h-3 overflow-hidden border border-blue-500/30">
                                    <div
                                        className="bg-gradient-to-r from-blue-600 to-purple-600 h-full transition-all duration-300 relative overflow-hidden"
                                        style={{ width: `${uploadProgress}%` }}
                                    >
                                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer"></div>
                                    </div>
                                </div>
                                <p className="text-xs text-gray-400 mt-2">
                                    {uploadProgress < 100 ? 'Uploading your agent to the server...' : 'Upload complete, processing...'}
                                </p>
                            </div>
                        )}

                        {/* Validation Status */}
                        {validationStatus && !error && !success && (
                            <div className="mt-4 bg-blue-900/30 border border-blue-500/50 rounded-lg p-4">
                                <div className="flex items-start gap-3">
                                    <Loader2 className="w-5 h-5 text-blue-400 mt-0.5 animate-spin" />
                                    <div className="flex-1">
                                        <p className="text-blue-200 font-semibold mb-2">
                                            {validationStatus.status === 'pending' && 'Queued for Validation'}
                                            {validationStatus.status === 'testing' && 'Testing Agent...'}
                                        </p>

                                        {validationStatus.status === 'pending' && validationStatus.position > 0 && (
                                            <p className="text-blue-300 text-sm">
                                                Position in queue: <span className="font-semibold">{validationStatus.position}</span>
                                            </p>
                                        )}

                                        {validationStatus.status === 'testing' && (
                                            <p className="text-blue-300 text-sm">
                                                Running validation test (max 14 seconds)...
                                            </p>
                                        )}

                                        <div className="mt-3 bg-blue-500/20 rounded-full h-2 overflow-hidden">
                                            <div className="bg-blue-500 h-full animate-pulse" style={{ width: '60%' }}></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Messages */}
                        {concurrencyWarning && (
                            <div className="mt-4 bg-amber-900/40 border border-amber-500/40 rounded-lg p-4 flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-amber-300 mt-0.5" />
                                <div>
                                    <p className="text-amber-100 text-sm">{concurrencyWarning}</p>
                                </div>
                            </div>
                        )}

                        {error && (
                            <div className="mt-4 bg-red-900/30 border border-red-500/50 rounded-lg p-4 flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-red-400 mt-0.5" />
                                <div>
                                    <p className="text-red-200 font-semibold mb-1">Validation Failed</p>
                                    <p className="text-red-300 text-sm">{error}</p>
                                    <button
                                        onClick={() => { setError(''); setValidationStatus(null); }}
                                        className="mt-3 text-sm text-red-200 hover:text-red-100 underline"
                                    >
                                        Try Again
                                    </button>
                                </div>
                            </div>
                        )}

                        {success && (
                            <div className="mt-4 bg-green-900/30 border border-green-500/50 rounded-lg p-4 flex items-start gap-3">
                                <CheckCircle className="w-5 h-5 text-green-400 mt-0.5" />
                                <div>
                                    <p className="text-green-200">{success}</p>
                                    <p className="text-green-300 mt-1 text-sm">Redirecting to agent page...</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
