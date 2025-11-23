'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import AnimatedBackground from '@/components/AnimatedBackground';
import { storeTokens } from '@/lib/clientAuth';

export default function StartPage() {
  const [accessCode, setAccessCode] = useState('');
  const [signupCode, setSignupCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'generate' | 'verify'>('generate');
  const [signupCodeRequired, setSignupCodeRequired] = useState<boolean | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/auth/signup-required')
      .then(res => res.json())
      .then(data => setSignupCodeRequired(data.required))
      .catch(() => setSignupCodeRequired(false));
  }, []);

  const handleGenerate = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signupCode: signupCode || undefined }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate code');
      }

      localStorage.setItem('fragmentarena_code', data.accessCode);

      setAccessCode(data.accessCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Invalid access code');
      }

      if (data.accessToken) {
        storeTokens(data.accessToken, data.refreshToken, data.expiresIn || 3600);
      }
      // Also store the access code for backwards compatibility
      localStorage.setItem('fragmentarena_code', accessCode);

      // Redirect to dashboard
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(accessCode);
    alert('Access code copied to clipboard.');
  };

  return (
    <div className="min-h-screen relative">
      <AnimatedBackground />
      <div className="relative z-10">
        <Navigation />
        <div className="flex items-center justify-center p-4 min-h-[calc(100vh-4rem)]">
          <div className="max-w-2xl w-full">
            <div className="text-center mb-8">
              <h1 className="text-4xl font-bold text-white mb-2">
                Welcome to <span className="text-purple-400">FragmentArena</span>
              </h1>
              <p className="text-gray-400">Get started by generating or entering your access code</p>
            </div>

            <div className="bg-gray-800/50 backdrop-blur rounded-lg border border-purple-500/20 p-8 shadow-lg">
          {/* Mode Selector */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setMode('generate')}
              className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-colors ${
                mode === 'generate'
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
            >
              New User
            </button>
            <button
              onClick={() => setMode('verify')}
              className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-colors ${
                mode === 'verify'
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
            >
              Returning User
            </button>
          </div>

          {mode === 'generate' ? (
            <div>
              {accessCode ? (
                <div className="mb-6">
                  <label className="block text-gray-300 mb-2 font-semibold">
                    Your Access Code
                  </label>
                  <div className="bg-yellow-900 border-2 border-yellow-600 rounded-lg p-4 mb-4">
                    <p className="text-yellow-200 text-sm mb-2">
                      Save this code securely. You will need it to access your agents.
                    </p>
                    <div className="flex gap-2">
                      <code className="flex-1 bg-gray-900 p-3 rounded text-green-400 text-sm break-all">
                        {accessCode}
                      </code>
                      <button
                        onClick={copyToClipboard}
                        className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-semibold transition-colors"
                      >
                        Copy
                      </button>
                    </div>
                  </div>

                  <Link
                    href="/dashboard"
                    className="block w-full bg-purple-600 hover:bg-purple-700 text-white text-center px-6 py-3 rounded-lg font-semibold transition-colors"
                  >
                    Continue to Dashboard
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {signupCodeRequired && (
                    <div>
                      <label className="block text-gray-300 mb-2">
                        6-Digit Signup Code
                      </label>
                      <input
                        type="text"
                        value={signupCode}
                        onChange={(e) => setSignupCode(e.target.value.toUpperCase())}
                        placeholder="Enter 6-digit signup code..."
                        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-center text-lg tracking-widest"
                        maxLength={6}
                      />
                    </div>
                  )}

                  <button
                    onClick={handleGenerate}
                    disabled={loading || (signupCodeRequired === true && signupCode.length !== 6)}
                    className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
                  >
                    {loading ? 'Generating...' : 'Generate Access Code'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="mb-6">
                <label className="block text-gray-300 mb-2">
                  Enter Your Access Code
                </label>
                <input
                  type="text"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  placeholder="Paste your 64-character access code..."
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
                />
              </div>

              <button
                onClick={handleVerify}
                disabled={loading || !accessCode}
                className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
              >
                {loading ? 'Verifying...' : 'Continue'}
              </button>
            </div>
          )}

          {error && (
            <div className="mt-4 bg-red-900 border border-red-600 rounded-lg p-3">
              <p className="text-red-200 text-sm">{error}</p>
            </div>
          )}
        </div>

            <div className="mt-6 text-center">
              <Link href="/" className="text-gray-400 hover:text-gray-300">
                ← Back to Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
