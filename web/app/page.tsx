'use client';

import Link from 'next/link';
import Navigation from '@/components/Navigation';
import AnimatedBackground from '@/components/AnimatedBackground';

export default function HomePage() {

    return (
        <div className="min-h-screen relative">
            <AnimatedBackground />
            <div className="relative z-10">
                <Navigation />
                <div className="container mx-auto px-4 py-16">
                    {/* Hero Section */}
                    <div className="text-center mb-24">
                        <div className="inline-block mb-6">
                            <div className="flex items-center gap-4 bg-purple-900/30 backdrop-blur border border-purple-500/30 rounded-full px-6 py-2">
                                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                                <span className="text-sm text-purple-300 font-semibold">5x5 Chess AI Arena</span>
                            </div>
                        </div>

                        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight">
                            Chess AI <span className="text-purple-400">Arena</span>
                        </h1>

                        <p className="text-lg sm:text-xl md:text-2xl text-gray-300 mb-4 max-w-3xl mx-auto px-4">
                            A competitive platform for 5x5 chess AI agents
                        </p>

                        <p className="text-base sm:text-lg text-gray-400 max-w-2xl mx-auto mb-10 px-4">
                            Write your Python chess AI, upload it to the arena, and watch it compete in real-time matches.
                            Track your ELO rating on the global leaderboard.
                        </p>

                        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12 px-4">
                            <Link
                                href="/start"
                                className="bg-purple-600/80 backdrop-blur hover:bg-purple-700/80 text-white px-10 py-4 rounded-lg font-semibold text-lg transition-all duration-200 shadow-lg shadow-purple-500/20"
                            >
                                Get Started
                            </Link>
                            <Link
                                href="/live"
                                className="bg-green-600/80 backdrop-blur hover:bg-green-700/80 text-white px-10 py-4 rounded-lg font-semibold text-lg transition-all duration-200 shadow-lg shadow-green-500/20 flex items-center gap-2"
                            >
                                <span className="w-2 h-2 bg-white rounded-full"></span>
                                Live Matches
                            </Link>
                            <Link
                                href="/leaderboard"
                                className="bg-gray-700/80 backdrop-blur hover:bg-gray-600/80 text-white px-10 py-4 rounded-lg font-semibold text-lg transition-all duration-200 shadow-lg shadow-gray-500/20"
                            >
                                Leaderboard
                            </Link>
                        </div>

                        {/* Quick Stats */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-3xl mx-auto px-4">
                            <div className="bg-gray-800/50 backdrop-blur p-4 rounded-lg border border-purple-500/20">
                                <div className="text-2xl font-bold text-purple-400">5x5</div>
                                <div className="text-gray-400 text-sm">Board Size</div>
                            </div>
                            <div className="bg-gray-800/50 backdrop-blur p-4 rounded-lg border border-purple-500/20">
                                <div className="text-2xl font-bold text-purple-400">{process.env.NEXT_PUBLIC_AGENT_TIMEOUT_SECONDS || '14'}s</div>
                                <div className="text-gray-400 text-sm">Move Timeout</div>
                            </div>
                            <div className="bg-gray-800/50 backdrop-blur p-4 rounded-lg border border-purple-500/20">
                                <div className="text-2xl font-bold text-purple-400">1GiB</div>
                                <div className="text-gray-400 text-sm">Max Code Size</div>
                            </div>
                            <div className="bg-gray-800/50 backdrop-blur p-4 rounded-lg border border-purple-500/20">
                                <div className="text-2xl font-bold text-purple-400">512MB</div>
                                <div className="text-gray-400 text-sm">Memory Limit</div>
                            </div>
                        </div>
                    </div>

                    {/* How to Upload Section */}
                    <div className="mb-24 px-4">
                        <div className="text-center mb-12">
                            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">How to Get Started</h2>
                            <p className="text-gray-400 text-base sm:text-lg">From code to competition in 4 steps</p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                            <div className="relative bg-gray-800/50 backdrop-blur p-8 rounded-lg border border-purple-500/20 shadow-lg hover:shadow-purple-500/20 transition-all duration-300 hover:border-purple-500/40">
                                <div className="absolute -top-4 -left-4 w-12 h-12 bg-purple-600 rounded-full flex items-center justify-center font-bold text-xl shadow-lg shadow-purple-500/50">
                                    1
                                </div>
                                <div className="mb-4 text-purple-400">
                                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                    </svg>
                                </div>
                                <h3 className="text-xl font-bold text-white mb-2">Generate Access Code</h3>
                                <p className="text-gray-400">
                                    Create your unique 256-bit access code. No email or password required.
                                </p>
                            </div>

                            <div className="relative bg-gray-800/50 backdrop-blur p-8 rounded-lg border border-purple-500/20 shadow-lg hover:shadow-purple-500/20 transition-all duration-300 hover:border-purple-500/40">
                                <div className="absolute -top-4 -left-4 w-12 h-12 bg-purple-600 rounded-full flex items-center justify-center font-bold text-xl shadow-lg shadow-purple-500/50">
                                    2
                                </div>
                                <div className="mb-4 text-purple-400">
                                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                                    </svg>
                                </div>
                                <h3 className="text-xl font-bold text-white mb-2">Write Your AI</h3>
                                <p className="text-gray-400">
                                    Implement your strategy in Python with our simple API. Use any algorithm you want.
                                </p>
                            </div>

                            <div className="relative bg-gray-800/50 backdrop-blur p-8 rounded-lg border border-purple-500/20 shadow-lg hover:shadow-purple-500/20 transition-all duration-300 hover:border-purple-500/40">
                                <div className="absolute -top-4 -left-4 w-12 h-12 bg-purple-600 rounded-full flex items-center justify-center font-bold text-xl shadow-lg shadow-purple-500/50">
                                    3
                                </div>
                                <div className="mb-4 text-purple-400">
                                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                    </svg>
                                </div>
                                <h3 className="text-xl font-bold text-white mb-2">Link or Upload to Arena</h3>
                                <p className="text-gray-400">
                                    Upload your code to run on our servers, or link your agent to run locally while keeping your code private.
                                </p>
                            </div>

                            <div className="relative bg-gray-800/50 backdrop-blur p-8 rounded-lg border border-purple-500/20 shadow-lg hover:shadow-purple-500/20 transition-all duration-300 hover:border-purple-500/40">
                                <div className="absolute -top-4 -left-4 w-12 h-12 bg-purple-600 rounded-full flex items-center justify-center font-bold text-xl shadow-lg shadow-purple-500/50">
                                    4
                                </div>
                                <div className="mb-4 text-purple-400">
                                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                </div>
                                <h3 className="text-xl font-bold text-white mb-2">Compete</h3>
                                <p className="text-gray-400">
                                    Your AI battles others in real-time. Track wins, losses, and ELO rating.
                                </p>
                            </div>
                        </div>

                        <div className="mt-8 text-center">
                            <Link
                                href="/start"
                                className="inline-block bg-purple-600/80 backdrop-blur hover:bg-purple-700/80 text-white px-8 py-3 rounded-lg font-semibold text-lg transition-all duration-200 shadow-lg shadow-purple-500/20"
                            >
                                Get Started
                            </Link>
                        </div>
                    </div>

                    {/* Local Agent Execution Section */}
                    <div className="mb-24 px-4">
                        <div className="bg-gradient-to-br from-blue-900/30 to-gray-900/30 backdrop-blur p-6 sm:p-8 md:p-12 rounded-lg border border-blue-500/30 shadow-2xl">
                            <div className="flex items-center gap-3 mb-6">
                                <svg className="w-10 h-10 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                </svg>
                                <h2 className="text-4xl font-bold text-white">Run Agents Locally</h2>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 mb-8">
                                <div className="space-y-6">
                                    <div>
                                        <h3 className="text-xl font-semibold text-blue-300 mb-3">Keep Your Code Private</h3>
                                        <p className="text-gray-300 leading-relaxed">
                                            Essential for maintaining Academic Responsibility Code (ARC) integrity. Run your agent on your own machine
                                            while still participating in platform matchmaking - your code never leaves your computer.
                                        </p>
                                    </div>

                                    <div>
                                        <h3 className="text-xl font-semibold text-blue-300 mb-3">How It Works</h3>
                                        <ul className="text-gray-300 space-y-2">
                                            <li className="flex items-start gap-2">
                                                <span className="text-blue-400 mt-1">→</span>
                                                <span>Link your agent (name + version only, no code upload)</span>
                                            </li>
                                            <li className="flex items-start gap-2">
                                                <span className="text-blue-400 mt-1">→</span>
                                                <span>Download a secure connection script</span>
                                            </li>
                                            <li className="flex items-start gap-2">
                                                <span className="text-blue-400 mt-1">→</span>
                                                <span>Run the script alongside your agent.py</span>
                                            </li>
                                            <li className="flex items-start gap-2">
                                                <span className="text-blue-400 mt-1">→</span>
                                                <span>Agent enters matchmaking when connected</span>
                                            </li>
                                        </ul>
                                    </div>
                                </div>

                                <div className="space-y-6">
                                    <div>
                                        <h3 className="text-xl font-semibold text-blue-300 mb-3">Temporary Testing</h3>
                                        <p className="text-gray-300 leading-relaxed">
                                            Useful for testing new strategies without uploading them to the server. Connect and disconnect at will
                                            - your agent only competes when you're online. Same timeout rules ({process.env.NEXT_PUBLIC_AGENT_TIMEOUT_SECONDS || '14'} seconds) and disconnects count as forfeits.
                                        </p>
                                    </div>

                                    <div>
                                        <h3 className="text-xl font-semibold text-blue-300 mb-3">Secure Connection</h3>
                                        <p className="text-gray-300 leading-relaxed">
                                            Each agent gets a unique encrypted token. WebSocket connection with automatic reconnection,
                                            heartbeat monitoring, and timeout enforcement. Only move decisions are transmitted - never your code.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <Link
                                    href="/link-agent"
                                    className="block p-6 bg-blue-600/20 hover:bg-blue-600/30 rounded-lg border border-blue-500/30 hover:border-blue-500/50 transition-all duration-300"
                                >
                                    <div className="flex items-center gap-3 mb-2">
                                        <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                        </svg>
                                        <h4 className="text-lg font-semibold text-white">Link a Local Agent</h4>
                                    </div>
                                    <p className="text-gray-400 text-sm">
                                        Create an agent entry and get your connection script (no code upload required)
                                    </p>
                                </Link>

                                <Link
                                    href="/upload"
                                    className="block p-6 bg-purple-600/20 hover:bg-purple-600/30 rounded-lg border border-purple-500/30 hover:border-purple-500/50 transition-all duration-300"
                                >
                                    <div className="flex items-center gap-3 mb-2">
                                        <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                        </svg>
                                        <h4 className="text-lg font-semibold text-white">Upload to Server</h4>
                                    </div>
                                    <p className="text-gray-400 text-sm">
                                        Traditional upload - agent runs 24/7 on our secure servers
                                    </p>
                                </Link>
                            </div>
                        </div>
                    </div>

                    {/* Security Section */}
                    <div className="mb-24 px-4">
                        <div className="bg-gradient-to-br from-purple-900/30 to-gray-900/30 backdrop-blur p-6 sm:p-8 md:p-12 rounded-lg border border-purple-500/30 shadow-2xl">
                            <div className="flex items-center gap-3 mb-6">
                                <svg className="w-10 h-10 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                                <h2 className="text-4xl font-bold text-white">Server Upload Security</h2>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
                                <div className="space-y-6">
                                    <div>
                                        <h3 className="text-xl font-semibold text-purple-300 mb-3">Your Code is Protected</h3>
                                        <p className="text-gray-300 leading-relaxed">
                                            Agent code is stored securely in an isolated PostgreSQL database that is not accessible outside the private Docker network.
                                            API endpoints require authentication and verify ownership before allowing code access.
                                        </p>
                                    </div>

                                    <div>
                                        <h3 className="text-xl font-semibold text-purple-300 mb-3">No Public Code Access</h3>
                                        <p className="text-gray-300 leading-relaxed">
                                            Other users cannot view your agent&apos;s source code. Public endpoints (leaderboard, analytics, match history)
                                            only expose metadata like agent name, version, and statistics - never the code itself.
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-6">
                                    <div>
                                        <h3 className="text-xl font-semibold text-purple-300 mb-3">Isolated Execution</h3>
                                        <p className="text-gray-300 leading-relaxed">
                                            Each match runs in a sandboxed Docker container with strict resource limits (512MB memory, {process.env.NEXT_PUBLIC_AGENT_TIMEOUT_SECONDS || '14'}s timeout).
                                            Code is loaded from the database into the executor, executed, then immediately discarded. No persistent file storage.
                                        </p>
                                    </div>

                                    <div>
                                        <h3 className="text-xl font-semibold text-purple-300 mb-3">Plagiarism Prevention</h3>
                                        <p className="text-gray-300 leading-relaxed">
                                            Since agent code is never publicly accessible and the database is secured behind Docker networking,
                                            plagiarism requires you to explicitly share your code. The only way someone gets your code is if you give it to them.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-8 p-6 bg-gray-900/50 rounded-lg border border-purple-500/20">
                                <div className="flex items-start gap-4">
                                    <svg className="w-6 h-6 text-purple-400 flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <div>
                                        <h4 className="text-lg font-semibold text-white mb-2">Database Access</h4>
                                        <p className="text-gray-400 leading-relaxed">
                                            The database containing agent code is only accessible to the backend executor service within the private Docker network.
                                            The web interface and all public APIs have no direct database access for code retrieval - they must authenticate through protected endpoints.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Features Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 sm:gap-8 mb-16 px-4">
                        <div className="bg-gray-800/50 backdrop-blur p-6 rounded-lg border border-purple-500/20 shadow-lg hover:shadow-purple-500/20 transition-all duration-300">
                            <div className="text-sm font-semibold text-purple-400 mb-4">[AUTH]</div>
                            <h3 className="text-xl font-bold text-white mb-2">Code-Based Auth</h3>
                            <p className="text-gray-400">
                                No passwords needed. Generate a secure 256-bit access code to start competing.
                            </p>
                        </div>

                        <div className="bg-gray-800/50 backdrop-blur p-6 rounded-lg border border-purple-500/20 shadow-lg hover:shadow-purple-500/20 transition-all duration-300">
                            <div className="text-sm font-semibold text-purple-400 mb-4">[SANDBOX]</div>
                            <h3 className="text-xl font-bold text-white mb-2">Sandboxed Execution</h3>
                            <p className="text-gray-400">
                                Your agents run in isolated Docker containers with strict resource limits and security measures.
                            </p>
                        </div>

                        <div className="bg-gray-800/50 backdrop-blur p-6 rounded-lg border border-purple-500/20 shadow-lg hover:shadow-purple-500/20 transition-all duration-300">
                            <div className="text-sm font-semibold text-purple-400 mb-4">[RANKINGS]</div>
                            <h3 className="text-xl font-bold text-white mb-2">ELO Rankings</h3>
                            <p className="text-gray-400">
                                Dynamic rankings based on match performance. Track your agent on the global leaderboard.
                            </p>
                        </div>

                        <div className="bg-gray-800/50 backdrop-blur p-6 rounded-lg border border-purple-500/20 shadow-lg hover:shadow-purple-500/20 transition-all duration-300">
                            <div className="text-sm font-semibold text-purple-400 mb-4">[MATCHES]</div>
                            <h3 className="text-xl font-bold text-white mb-2">Live Matches</h3>
                            <p className="text-gray-400">
                                Watch agents battle in real-time with move-by-move visualization and evaluation scores.
                            </p>
                        </div>

                        <div className="bg-gray-800/50 backdrop-blur p-6 rounded-lg border border-purple-500/20 shadow-lg hover:shadow-purple-500/20 transition-all duration-300">
                            <div className="text-sm font-semibold text-purple-400 mb-4">[REPLAY]</div>
                            <h3 className="text-xl font-bold text-white mb-2">Game Replay</h3>
                            <p className="text-gray-400">
                                Review completed matches with step-through controls and detailed move analysis.
                            </p>
                        </div>

                        <div className="bg-gray-800/50 backdrop-blur p-6 rounded-lg border border-purple-500/20 shadow-lg hover:shadow-purple-500/20 transition-all duration-300">
                            <div className="text-sm font-semibold text-purple-400 mb-4">[ANALYTICS]</div>
                            <h3 className="text-xl font-bold text-white mb-2">Analytics</h3>
                            <p className="text-gray-400">
                                Track performance metrics, win rates, and computation time statistics for all agents.
                            </p>
                        </div>
                    </div>

                    {/* How It Works */}
                    <div className="bg-gray-800/50 backdrop-blur p-6 sm:p-8 rounded-lg border border-purple-500/20 mb-16 shadow-lg mx-4">
                        <h2 className="text-3xl font-bold text-white mb-6">How It Works</h2>
                        <div className="space-y-4 text-gray-300">
                            <div className="flex gap-4">
                                <div className="flex-shrink-0 w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center font-bold">
                                    1
                                </div>
                                <div>
                                    <h4 className="font-semibold text-white mb-1">Generate Access Code</h4>
                                    <p className="text-gray-400">Create a secure 256-bit access code to identify your agents.</p>
                                </div>
                            </div>
                            <div className="flex gap-4">
                                <div className="flex-shrink-0 w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center font-bold">
                                    2
                                </div>
                                <div>
                                    <h4 className="font-semibold text-white mb-1">Upload Your Agent</h4>
                                    <p className="text-gray-400">Write a Python agent with the required function signature and upload it.</p>
                                </div>
                            </div>
                            <div className="flex gap-4">
                                <div className="flex-shrink-0 w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center font-bold">
                                    3
                                </div>
                                <div>
                                    <h4 className="font-semibold text-white mb-1">Automatic Validation</h4>
                                    <p className="text-gray-400">Your code is validated for security and tested in a sandbox environment.</p>
                                </div>
                            </div>
                            <div className="flex gap-4">
                                <div className="flex-shrink-0 w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center font-bold">
                                    4
                                </div>
                                <div>
                                    <h4 className="font-semibold text-white mb-1">Compete</h4>
                                    <p className="text-gray-400">Your agent automatically battles others in round-robin matches and earns ELO rating.</p>
                                </div>
                            </div>
                        </div>
                    </div>


                    {/* Footer */}
                    <div className="text-center text-gray-500 text-sm">
                        <p>Built for the University of Southampton COMP2321 Coursework</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
