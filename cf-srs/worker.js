const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

function randomKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url  = new URL(request.url);
    const path = url.pathname;

    // ── POST /init ───────────────────────────────────────────────
    // Create a new sync key, or validate an existing one.
    // Body: {} → create new | { syncKey: "..." } → validate existing
    if (path === '/init' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}

      if (body.syncKey) {
        const row = await env.DB
          .prepare('SELECT sync_key FROM sync_keys WHERE sync_key = ?')
          .bind(body.syncKey)
          .first();
        if (!row) return err('Sync key not found', 404);
        return json({ syncKey: body.syncKey, created: false });
      }

      const key = randomKey();
      await env.DB
        .prepare('INSERT INTO sync_keys (sync_key) VALUES (?)')
        .bind(key)
        .run();
      return json({ syncKey: key, created: true });
    }

    // ── GET /cards?syncKey=X ─────────────────────────────────────
    // Return all SRS cards for the given sync key.
    if (path === '/cards' && request.method === 'GET') {
      const syncKey = url.searchParams.get('syncKey');
      if (!syncKey) return err('Missing syncKey');

      const valid = await env.DB
        .prepare('SELECT sync_key FROM sync_keys WHERE sync_key = ?')
        .bind(syncKey)
        .first();
      if (!valid) return err('Sync key not found', 404);

      const { results } = await env.DB
        .prepare(
          'SELECT pool, korean, english, interval, ease_factor, repetitions, due_date ' +
          'FROM cards WHERE sync_key = ?'
        )
        .bind(syncKey)
        .all();

      return json({ cards: results });
    }

    // ── POST /review ─────────────────────────────────────────────
    // Upsert a single card (used after rating a card or adding one).
    // Body: { syncKey, pool, korean, english, interval, easeFactor, repetitions, dueDate }
    if (path === '/review' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return err('Invalid JSON'); }

      const { syncKey, pool, korean, english, interval, easeFactor, repetitions, dueDate } = body ?? {};
      if (!syncKey || !pool || !korean || !dueDate) return err('Missing required fields');

      await env.DB
        .prepare(`
          INSERT INTO cards (sync_key, pool, korean, english, interval, ease_factor, repetitions, due_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(sync_key, pool, korean) DO UPDATE SET
            english     = excluded.english,
            interval    = excluded.interval,
            ease_factor = excluded.ease_factor,
            repetitions = excluded.repetitions,
            due_date    = excluded.due_date
        `)
        .bind(syncKey, pool, korean, english ?? '', interval ?? 1, easeFactor ?? 2.5, repetitions ?? 0, dueDate)
        .run();

      return json({ ok: true });
    }

    // ── POST /bulk ───────────────────────────────────────────────
    // Insert multiple new cards, ignoring ones that already exist.
    // Body: { syncKey, cards: [{ pool, korean, english }] }
    if (path === '/bulk' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return err('Invalid JSON'); }

      const { syncKey, cards } = body ?? {};
      if (!syncKey || !Array.isArray(cards)) return err('Missing required fields');
      if (!cards.length) return json({ ok: true, inserted: 0 });

      const today = new Date().toISOString().split('T')[0];
      const stmts = cards.map(c =>
        env.DB
          .prepare(
            'INSERT OR IGNORE INTO cards ' +
            '(sync_key, pool, korean, english, interval, ease_factor, repetitions, due_date) ' +
            'VALUES (?, ?, ?, ?, 1, 2.5, 0, ?)'
          )
          .bind(syncKey, c.pool, c.korean, c.english ?? '', today)
      );

      await env.DB.batch(stmts);
      return json({ ok: true, inserted: stmts.length });
    }

    return err('Not found', 404);
  },
};
