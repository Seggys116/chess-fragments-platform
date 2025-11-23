export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('===========================================');
    console.log('Server instrumentation starting...');
    console.log('===========================================');

    await import('./lib/gameBufferManager');

    console.log('Server instrumentation initialized');
  }
}
