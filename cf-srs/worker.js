const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

function randomHex(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Password hashing via PBKDF2 (Web Crypto, available in CF Workers) ──────
async function hashPassword(password) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 10_000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const saltHex = [...salt].map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${hashHex}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 10_000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const newHashHex = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
  return newHashHex === hashHex;
}

// ── Resolve bearer token → user_id (null if missing/expired) ────────────────
async function getUserId(request, env) {
  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token) return null;
  const row = await env.DB
    .prepare("SELECT user_id FROM sessions WHERE token = ? AND expires_at > datetime('now')")
    .bind(token)
    .first();
  return row ? row.user_id : null;
}

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url  = new URL(request.url);
    const path = url.pathname;

    // ── POST /signup ──────────────────────────────────────────────────────────
    // Body: { email, password }
    // Returns: { token, email }
    if (path === '/signup' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return err('Invalid JSON'); }

      const { email, password } = body ?? {};
      if (!email || !password) return err('Missing email or password');
      if (password.length < 8)  return err('Password must be at least 8 characters');

      const emailLower = email.trim().toLowerCase();
      const existing = await env.DB
        .prepare('SELECT id FROM users WHERE email = ?')
        .bind(emailLower)
        .first();
      if (existing) return err('Email already registered', 409);

      const hash    = await hashPassword(password);
      const { meta } = await env.DB
        .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
        .bind(emailLower, hash)
        .run();
      const userId = meta.last_row_id;

      const token    = randomHex(32);
      const expires  = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').split('.')[0];
      await env.DB
        .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
        .bind(token, userId, expires)
        .run();

      return json({ token, email: emailLower });
    }

    // ── POST /login ───────────────────────────────────────────────────────────
    // Body: { email, password }
    // Returns: { token, email }
    if (path === '/login' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return err('Invalid JSON'); }

      const { email, password } = body ?? {};
      if (!email || !password) return err('Missing email or password');

      const emailLower = email.trim().toLowerCase();
      const user = await env.DB
        .prepare('SELECT id, password_hash FROM users WHERE email = ?')
        .bind(emailLower)
        .first();
      if (!user) return err('Invalid email or password', 401);

      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) return err('Invalid email or password', 401);

      const token   = randomHex(32);
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').split('.')[0];
      await env.DB
        .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
        .bind(token, user.id, expires)
        .run();

      return json({ token, email: emailLower });
    }

    // ── POST /logout ──────────────────────────────────────────────────────────
    // Header: Authorization: Bearer <token>
    if (path === '/logout' && request.method === 'POST') {
      const auth  = request.headers.get('Authorization') ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
      if (token) {
        await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
      }
      return json({ ok: true });
    }

    // ── GET /cards ────────────────────────────────────────────────────────────
    // Header: Authorization: Bearer <token>
    // Returns all SRS cards for the authenticated user.
    if (path === '/cards' && request.method === 'GET') {
      const userId = await getUserId(request, env);
      if (!userId) return err('Unauthorized', 401);

      const { results } = await env.DB
        .prepare(
          'SELECT pool, korean, english, interval, ease_factor, repetitions, due_date, difficulty ' +
          'FROM cards WHERE user_id = ?'
        )
        .bind(userId)
        .all();

      return json({ cards: results });
    }

    // ── POST /review ──────────────────────────────────────────────────────────
    // Header: Authorization: Bearer <token>
    // Body: { pool, korean, english, interval, easeFactor, repetitions, dueDate }
    if (path === '/review' && request.method === 'POST') {
      const userId = await getUserId(request, env);
      if (!userId) return err('Unauthorized', 401);

      let body;
      try { body = await request.json(); } catch { return err('Invalid JSON'); }

      const { pool, korean, english, interval, easeFactor, repetitions, dueDate, difficulty } = body ?? {};
      if (!pool || !korean || !dueDate) return err('Missing required fields');

      await env.DB
        .prepare(`
          INSERT INTO cards (user_id, pool, korean, english, interval, ease_factor, repetitions, due_date, difficulty)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, pool, korean) DO UPDATE SET
            english     = excluded.english,
            interval    = excluded.interval,
            ease_factor = excluded.ease_factor,
            repetitions = excluded.repetitions,
            due_date    = excluded.due_date,
            difficulty  = excluded.difficulty
        `)
        .bind(userId, pool, korean, english ?? '', interval ?? 1, easeFactor ?? 0, repetitions ?? 0, dueDate, difficulty ?? 5.0)
        .run();

      return json({ ok: true });
    }

    // ── POST /bulk ────────────────────────────────────────────────────────────
    // Header: Authorization: Bearer <token>
    // Body: { cards: [{ pool, korean, english }] }
    if (path === '/bulk' && request.method === 'POST') {
      const userId = await getUserId(request, env);
      if (!userId) return err('Unauthorized', 401);

      let body;
      try { body = await request.json(); } catch { return err('Invalid JSON'); }

      const { cards } = body ?? {};
      if (!Array.isArray(cards)) return err('Missing required fields');
      if (!cards.length) return json({ ok: true, inserted: 0 });

      const today = new Date().toISOString().split('T')[0];
      const stmts = cards.map(c =>
        env.DB
          .prepare(
            'INSERT OR IGNORE INTO cards ' +
            '(user_id, pool, korean, english, interval, ease_factor, repetitions, due_date, difficulty) ' +
            'VALUES (?, ?, ?, ?, 1, 0, 0, ?, 5.0)'
          )
          .bind(userId, c.pool, c.korean, c.english ?? '', today)
      );

      await env.DB.batch(stmts);
      return json({ ok: true, inserted: stmts.length });
    }

    return err('Not found', 404);
  },
};
