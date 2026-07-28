
    import { runSeed } from './_seed-utils.mjs';
    let opIndex = 0;
    let cleanupHung = false;
    globalThis.fetch = async (url, opts = {}) => {
      const body = opts?.body ? (() => { try { return JSON.parse(opts.body); } catch { return opts.body; } })() : null;
      let shape = 'other';
      if (Array.isArray(body)) {
        if (Array.isArray(body[0])) {
          shape = body[0][0] === 'EXPIRE' ? 'pipeline-EXPIRE' : 'pipeline-other';
        } else if (body[0] === 'EVAL') {
          shape = 'EVAL';
        } else {
          shape = 'cmd-' + body[0];
        }
      }
      const idx = opIndex++;
      console.error('FETCH_OP idx=' + idx + ' shape=' + shape + ' body=' + JSON.stringify(body));
      // acquireLock SET NX → return OK (lock free)
      if (Array.isArray(body) && body[0] === 'SET' && body[3] === 'NX') {
        return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
      }
      // First EVAL is the catch block's manual releaseLock — HANG it so
      // SIGTERM has a deterministic window. Subsequent EVALs (e.g. from
      // the handler firing) must succeed so the handler can complete
      // and exit 143.
      if (shape === 'EVAL' && !cleanupHung) {
        cleanupHung = true;
        setInterval(() => {}, 10_000);
        setImmediate(() => console.log('FETCH_FAILURE_CLEANUP_HUNG'));
        return new Promise(() => {});  // never resolves
      }
      // Subsequent EVALs (handler-issued) succeed.
      if (shape === 'EVAL') {
        return new Response(JSON.stringify({ result: 1 }), { status: 200 });
      }
      // Pipeline-EXPIRE (handler's extendExistingTtl) — succeed.
      if (Array.isArray(body) && Array.isArray(body[0])) {
        return new Response(JSON.stringify(body.map(() => ({ result: 1 }))), { status: 200 });
      }
      return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
    };
    // fetchFn rejects so runSeed enters the fetch-failure catch path.
    const failingFetch = async () => { throw new Error('synthetic upstream failure'); };
    await runSeed('test-domain', 'fetch-fail', 'data:test:fetch-fail:v1', failingFetch, {
      ttlSeconds: 900,
      lockTtlMs: 60_000,
      maxRetries: 0,  // fail fast — no withRetry retries
    });
  