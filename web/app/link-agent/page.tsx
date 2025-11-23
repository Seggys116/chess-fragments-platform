'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import AnimatedBackground from '@/components/AnimatedBackground';
import { Link as LinkIcon, Code2, AlertCircle, CheckCircle, Loader2, Shield, Download, Cpu } from 'lucide-react';

export default function LinkAgentPage() {
    const [accessCode, setAccessCode] = useState('');
    const [userId, setUserId] = useState('');
    const [agentName, setAgentName] = useState('');
    const [version, setVersion] = useState('1');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [connectionScript, setConnectionScript] = useState('');
    const [agentId, setAgentId] = useState('');

    useEffect(() => {
        const stored = localStorage.getItem('fragmentarena_code');
        if (stored) {
            setAccessCode(stored);
            verifyCode(stored);
        }
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

    const handleLinkAgent = async () => {
        if (!agentName || !version) {
            setError('Please provide both agent name and version');
            return;
        }

        setLoading(true);
        setError('');
        setSuccess('');
        setConnectionScript('');

        try {
            const response = await fetch('/api/agents/attach', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessCode}`,
                },
                body: JSON.stringify({
                    name: agentName,
                    version,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to create agent link');
            }

            setAgentId(data.agentId);
            setConnectionScript(data.script);
            setSuccess('Agent linked successfully! Download the connection script below.');

        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    const handleDownloadScript = () => {
        const blob = new Blob([connectionScript], { type: 'text/x-python' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `agent_connector_${agentName.toLowerCase().replace(/\s+/g, '_')}.py`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
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
                                Please generate or enter your access code to link agents.
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
                    <div className="mb-8 text-center">
                        <div className="inline-flex items-center gap-3 mb-4">
                            <LinkIcon className="w-10 h-10 text-blue-400" />
                            <h1 className="text-5xl font-bold text-white">Link a Local Agent</h1>
                        </div>
                        <p className="text-gray-400 text-lg">
                            Keep your code private - run your agent locally while participating in matchmaking
                        </p>
                    </div>

                    <div className="bg-gray-800/50 backdrop-blur rounded-xl border border-blue-500/20 p-8 shadow-2xl mb-6">
                        <div className="mb-6 bg-blue-900/30 border border-blue-500/30 rounded-lg p-4">
                            <h3 className="text-blue-300 font-semibold mb-3 flex items-center gap-2">
                                <Cpu className="w-5 h-5" />
                                How Local Agents Work
                            </h3>
                            <ol className="text-gray-400 text-sm space-y-2">
                                <li className="flex gap-2">
                                    <span className="text-blue-400 font-semibold">1.</span>
                                    <span>Create a name and version for your agent (no code upload required)</span>
                                </li>
                                <li className="flex gap-2">
                                    <span className="text-blue-400 font-semibold">2.</span>
                                    <span>Download the secure connection script</span>
                                </li>
                                <li className="flex gap-2">
                                    <span className="text-blue-400 font-semibold">3.</span>
                                    <span>Place the script in the same directory as your agent.py</span>
                                </li>
                                <li className="flex gap-2">
                                    <span className="text-blue-400 font-semibold">4.</span>
                                    <span>Run the script - your agent enters matchmaking when connected</span>
                                </li>
                            </ol>
                        </div>

                        {!connectionScript ? (
                            <>
                                <div className="mb-6">
                                    <label className="flex items-center gap-2 text-blue-300 mb-3 font-semibold">
                                        <Code2 className="w-5 h-5" />
                                        Agent Name
                                    </label>
                                    <input
                                        type="text"
                                        value={agentName}
                                        onChange={(e) => setAgentName(e.target.value)}
                                        placeholder="e.g., MyChessBot"
                                        className="w-full px-4 py-3 bg-gray-900/50 border border-blue-500/30 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                        maxLength={100}
                                    />
                                    <p className="text-sm text-gray-500 mt-2 flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3" />
                                        Choose a unique name to identify your agent
                                    </p>
                                </div>

                                <div className="mb-6">
                                    <label className="flex items-center gap-2 text-blue-300 mb-3 font-semibold">
                                        <Code2 className="w-5 h-5" />
                                        Version
                                    </label>
                                    <input
                                        type="text"
                                        value={version}
                                        onChange={(e) => setVersion(e.target.value)}
                                        placeholder="e.g., 1, v2.0, beta-3"
                                        className="w-full px-4 py-3 bg-gray-900/50 border border-blue-500/30 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                        maxLength={50}
                                    />
                                    <p className="text-sm text-gray-500 mt-2 flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3" />
                                        Version identifier for tracking updates
                                    </p>
                                </div>

                                <div className="mb-6 bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-4">
                                    <h3 className="text-yellow-300 font-semibold mb-3 flex items-center gap-2">
                                        <Shield className="w-5 h-5" />
                                        Requirements & Rules
                                    </h3>
                                    <div className="grid md:grid-cols-2 gap-4">
                                        <div>
                                            <h4 className="text-green-400 text-sm font-semibold mb-2">Your Code Stays Local</h4>
                                            <ul className="text-gray-400 text-sm space-y-1">
                                                <li>• No code upload required</li>
                                                <li>• Runs on your machine</li>
                                                <li>• Secure WebSocket connection</li>
                                                <li>• Same timeout rules ({process.env.NEXT_PUBLIC_AGENT_TIMEOUT_SECONDS || '14'} seconds)</li>
                                            </ul>
                                        </div>
                                        <div>
                                            <h4 className="text-blue-400 text-sm font-semibold mb-2">Connection Details</h4>
                                            <ul className="text-gray-400 text-sm space-y-1">
                                                <li>• Must have agent.py with agent() function</li>
                                                <li>• Only in matchmaking when connected</li>
                                                <li>• Disconnect = forfeit current game</li>
                                                <li>• Ensures ARC Integrity</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>

                                <button
                                    onClick={handleLinkAgent}
                                    disabled={loading || !agentName || !version}
                                    className={`w-full px-6 py-4 rounded-lg font-semibold text-lg transition-all duration-300 flex items-center justify-center gap-3 ${loading || !agentName || !version
                                            ? 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                                            : 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50'
                                        }`}
                                >
                                    {loading ? (
                                        <>
                                            <Loader2 className="w-6 h-6 animate-spin" />
                                            Creating Link...
                                        </>
                                    ) : (
                                        <>
                                            <LinkIcon className="w-6 h-6" />
                                            Link Agent
                                        </>
                                    )}
                                </button>
                            </>
                        ) : (
                            <div className="space-y-6">
                                <div className="bg-green-900/30 border border-green-500/50 rounded-lg p-4 flex items-start gap-3">
                                    <CheckCircle className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" />
                                    <div className="flex-1">
                                        <p className="text-green-200 font-semibold mb-1">{success}</p>
                                        <p className="text-green-300 text-sm">Agent ID: <code className="bg-green-900/50 px-2 py-0.5 rounded">{agentId}</code></p>
                                    </div>
                                </div>

                                <div className="bg-gray-900/50 border border-blue-500/30 rounded-lg p-6">
                                    <h3 className="text-blue-300 font-semibold mb-3 flex items-center gap-2">
                                        <Download className="w-5 h-5" />
                                        Connection Script
                                    </h3>
                                    <p className="text-gray-400 text-sm mb-4">
                                        This script contains your unique authentication token. Keep it secure and do not share it.
                                    </p>
                                    <button
                                        onClick={handleDownloadScript}
                                        className="w-full px-6 py-3 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white rounded-lg font-semibold transition-all shadow-lg shadow-green-500/30 hover:shadow-green-500/50 flex items-center justify-center gap-3"
                                    >
                                        <Download className="w-5 h-5" />
                                        Download agent_connector.py
                                    </button>
                                </div>

                                <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4">
                                    <h3 className="text-blue-300 font-semibold mb-3">Next Steps:</h3>
                                    <ol className="text-gray-400 text-sm space-y-2">
                                        <li className="flex gap-2">
                                            <span className="text-blue-400 font-semibold">1.</span>
                                            <span>Place the downloaded script in the same directory as your agent.py</span>
                                        </li>
                                        <li className="flex gap-2">
                                            <span className="text-blue-400 font-semibold">2.</span>
                                            <span>Ensure your agent.py has the <code className="text-purple-400">agent(board, player, var)</code> function</span>
                                        </li>
                                        <li className="flex gap-2">
                                            <span className="text-blue-400 font-semibold">3.</span>
                                            <span>Run: <code className="bg-gray-900/70 px-2 py-0.5 rounded text-green-400">python3 agent_connector.py</code></span>
                                        </li>
                                        <li className="flex gap-2">
                                            <span className="text-blue-400 font-semibold">4.</span>
                                            <span>Your agent will automatically enter matchmaking when connected</span>
                                        </li>
                                    </ol>
                                </div>

                                <div className="flex gap-4">
                                    <button
                                        onClick={() => {
                                            setConnectionScript('');
                                            setAgentName('');
                                            setVersion('');
                                            setSuccess('');
                                            setAgentId('');
                                        }}
                                        className="flex-1 px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-semibold transition-all"
                                    >
                                        Link Another Agent
                                    </button>
                                    <Link
                                        href="/dashboard"
                                        className="flex-1 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold transition-all text-center"
                                    >
                                        Go to Dashboard
                                    </Link>
                                </div>
                            </div>
                        )}

                        {error && (
                            <div className="mt-4 bg-red-900/30 border border-red-500/50 rounded-lg p-4 flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-red-400 mt-0.5" />
                                <div>
                                    <p className="text-red-200 font-semibold mb-1">Error</p>
                                    <p className="text-red-300 text-sm">{error}</p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="bg-gray-800/50 backdrop-blur rounded-xl border border-purple-500/20 p-6 shadow-xl">
                        <h3 className="text-purple-300 font-semibold mb-3 flex items-center gap-2">
                            <Shield className="w-5 h-5" />
                            Security & Privacy
                        </h3>
                        <ul className="text-gray-400 text-sm space-y-2">
                            <li className="flex gap-2">
                                <span className="text-green-400">✓</span>
                                <span>Your code never leaves your machine</span>
                            </li>
                            <li className="flex gap-2">
                                <span className="text-green-400">✓</span>
                                <span>Unique encrypted token for secure authentication</span>
                            </li>
                            <li className="flex gap-2">
                                <span className="text-green-400">✓</span>
                                <span>Only move data is transmitted (not code)</span>
                            </li>
                            <li className="flex gap-2">
                                <span className="text-green-400">✓</span>
                                <span>Same validation rules as uploaded agents</span>
                            </li>
                            <li className="flex gap-2">
                                <span className="text-green-400">✓</span>
                                <span>Suitable for intellectual property protection</span>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}
