const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

    // ════════════════════════════════════════════════════════════════════════
    // ── Skill Tracker endpoints  (/st/*)  ───────────────────────────────────
    // ════════════════════════════════════════════════════════════════════════

    // Recompute Fibonacci-sphere axis directions for all active categories
    // belonging to a user. Called after any category is added or removed.
    async function recomputeAxes(userId) {
      const rows = await env.DB
        .prepare('SELECT id FROM st_categories WHERE user_id = ? AND is_active = 1 ORDER BY id')
        .bind(userId).all();
      const ids = rows.results.map(r => r.id);
      const n = ids.length;
      const golden = (1 + Math.sqrt(5)) / 2;
      const stmts = ids.map((id, i) => {
        let ax, ay, az;
        if (n === 1) {
          ax = 0; ay = 1; az = 0;
        } else {
          const theta = Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (i + 0.5) / n)));
          const phi   = 2 * Math.PI * i / golden;
          ax = Math.sin(theta) * Math.cos(phi);
          ay = Math.sin(theta) * Math.sin(phi);
          az = Math.cos(theta);
        }
        return env.DB
          .prepare('UPDATE st_categories SET axis_x=?, axis_y=?, axis_z=? WHERE id=?')
          .bind(ax, ay, az, id);
      });
      if (stmts.length) await env.DB.batch(stmts);
    }

    // Helper: build stats response for a user with an optional time filter
    async function stStats(userId, whereClause, params) {
      const sql = `
        SELECT c.id, c.name, c.axis_x, c.axis_y, c.axis_z,
               COALESCE(SUM(s.duration_seconds), 0) AS total_seconds
        FROM st_categories c
        LEFT JOIN st_sessions s ON s.category_id = c.id AND s.user_id = c.user_id
          AND s.ended_at IS NOT NULL ${whereClause}
        WHERE c.user_id = ? AND c.is_active = 1
        GROUP BY c.id`;
      const { results } = await env.DB.prepare(sql).bind(...params, userId).all();
      const total = results.reduce((a, r) => a + r.total_seconds, 0);
      return {
        categories: results.map(r => ({
          id: r.id, name: r.name,
          color: '#4ade80',
          axis: [r.axis_x, r.axis_y, r.axis_z],
          total_seconds: r.total_seconds,
          proportion: total > 0 ? r.total_seconds / total : 0,
        })),
        total_seconds: total,
      };
    }

    // ── GET /st/categories ────────────────────────────────────────────────────
    if (path === '/st/categories' && request.method === 'GET') {
      const userId = await getUserId(request, env);
      if (!userId) return err('Unauthorized', 401);
      const { results } = await env.DB
        .prepare('SELECT id, name FROM st_categories WHERE user_id=? AND is_active=1 ORDER BY id')
        .bind(userId).all();
      return json(results);
    }

    // ── POST /st/categories ───────────────────────────────────────────────────
    if (path === '/st/categories' && request.method === 'POST') {
      const userId = await getUserId(request, env);
      if (!userId) return err('Unauthorized', 401);
      let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
      const name = (body?.name ?? '').trim();
      if (!name) return err('Missing name');
      const { meta } = await env.DB
        .prepare('INSERT INTO st_categories (user_id, name) VALUES (?, ?)')
        .bind(userId, name).run();
      await recomputeAxes(userId);
      return json({ id: meta.last_row_id, name });
    }

    // ── DELETE /st/categories/:id ─────────────────────────────────────────────
    if (path.startsWith('/st/categories/') && request.method === 'DELETE') {
      const userId = await getUserId(request, env);
      if (!userId) return err('Unauthorized', 401);
      const catId = parseInt(path.split('/')[3]);
      if (!catId) return err('Invalid id');
      await env.DB
        .prepare('UPDATE st_categories SET is_active=0 WHERE id=? AND user_id=?')
        .bind(catId, userId).run();
      await recomputeAxes(userId);
      return json({ ok: true });
    }

    // ── GET /st/sessions ──────────────────────────────────────────────────────
    if (path === '/st/sessions' && request.method === 'GET') {
      const userId = await getUserId(request, env);
      if (!userId) return err('Unauthorized', 401);
      const { results } = await env.DB
        .prepare(`SELECT s.id, s.started_at, s.ended_at, s.duration_seconds,
                         c.name AS category_name
                  FROM st_sessions s JOIN st_categories c ON c.id = s.category_id
                  WHERE s.user_id=? AND s.ended_at IS NOT NULL
                  ORDER BY s.started_at DESC LIMIT 50`)
        .bind(userId).all();
      return json(results);
    }

    // ── GET /st/sessions/active ───────────────────────────────────────────────
    if (path === '/st/sessions/active' && request.method === 'GET') {
      const userId = await getUserId(request, env);
      if (!userId) return err('Unauthorized', 401);
      const row = await env.DB
        .prepare(`SELECT s.id, s.category_id, s.started_at, c.name AS category_name
                  FROM st_sessions s JOIN st_categories c ON c.id = s.category_id
                  WHERE s.user_id=? AND s.ended_at IS NULL
                  ORDER BY s.started_at DESC LIMIT 1`)
        .bind(userId).first();
      return json(row ?? null);
    }

    // ── POST /st/sessions/start ───────────────────────────────────────────────
    if (path === '/st/sessions/start' && request.method === 'POST') {
      const userId = await getUserId(request, env);
      if (!userId) return err('Unauthorized', 401);
      let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
      const catId = body?.category_id;
      if (!catId) return err('Missing category_id');
      // Auto-close any dangling open session
      await env.DB.prepare(`
        UPDATE st_sessions SET ended_at = datetime('now'),
          duration_seconds = CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER)
        WHERE user_id=? AND ended_at IS NULL`)
        .bind(userId).run();
      const now = new Date().toISOString().replace('T', ' ').split('.')[0];
      const { meta } = await env.DB
        .prepare('INSERT INTO st_sessions (user_id, category_id, started_at) VALUES (?, ?, ?)')
        .bind(userId, catId, now).run();
      return json({ id: meta.last_row_id, category_id: catId, started_at: now });
    }

    // ── POST /st/sessions/stop/:id ────────────────────────────────────────────
    if (path.startsWith('/st/sessions/stop/') && request.method === 'POST') {
      const userId = await getUserId(request, env);
      if (!userId) return err('Unauthorized', 401);
      const sessId = parseInt(path.split('/')[4]);
      if (!sessId) return err('Invalid id');
      await env.DB.prepare(`
        UPDATE st_sessions SET ended_at = datetime('now'),
          duration_seconds = CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER)
        WHERE id=? AND user_id=? AND ended_at IS NULL`)
        .bind(sessId, userId).run();
      return json({ ok: true });
    }

    // ── DELETE /st/sessions/:id ──────────────────────────────────────────────
    if (path.startsWith('/st/sessions/') && request.method === 'DELETE') {
      const userId = await getUserId(request, env);
      if (!userId) return err('Unauthorized', 401);
      const sessId = parseInt(path.split('/')[3]);
      if (!sessId) return err('Invalid id');
      await env.DB
        .prepare('DELETE FROM st_sessions WHERE id=? AND user_id=?')
        .bind(sessId, userId).run();
      return json({ ok: true });
    }

    // ── GET /st/stats/today ───────────────────────────────────────────────────
    if (path === '/st/stats/today' && request.method === 'GET') {
      const userId = await getUserId(request, env);
      if (!userId) return err('Unauthorized', 401);
      // 3am UTC cutoff; if current UTC hour < 3 use yesterday's 3am
      const now = new Date();
      const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 0, 0));
      if (now < cutoff) cutoff.setUTCDate(cutoff.getUTCDate() - 1);
      const cutoffStr = cutoff.toISOString().replace('T', ' ').split('.')[0];
      return json(await stStats(userId, "AND s.started_at >= ?", [cutoffStr]));
    }

    // ── GET /st/stats/week ────────────────────────────────────────────────────
    if (path === '/st/stats/week' && request.method === 'GET') {
      const userId = await getUserId(request, env);
      if (!userId) return err('Unauthorized', 401);
      const now = new Date();
      const day = now.getUTCDay();
      const monday = new Date(now);
      monday.setUTCDate(now.getUTCDate() - ((day + 6) % 7));
      const monStr = monday.toISOString().split('T')[0];
      return json(await stStats(userId, "AND date(s.started_at) >= ?", [monStr]));
    }

    // ── GET /st/stats/year ────────────────────────────────────────────────────
    if (path === '/st/stats/year' && request.method === 'GET') {
      const userId = await getUserId(request, env);
      if (!userId) return err('Unauthorized', 401);
      const year = new Date().getUTCFullYear().toString();
      return json(await stStats(userId, "AND strftime('%Y', s.started_at) = ?", [year]));
    }

    // ── GET /st/stats/lifetime ────────────────────────────────────────────────
    if (path === '/st/stats/lifetime' && request.method === 'GET') {
      const userId = await getUserId(request, env);
      if (!userId) return err('Unauthorized', 401);
      return json(await stStats(userId, '', []));
    }

    // ════════════════════════════════════════════════════════════════════════
    // ── GPS Tracking endpoints (/gps/*) ─────────────────────────────────────
    // ════════════════════════════════════════════════════════════════════════

    function haversineMeters(lat1, lon1, lat2, lon2) {
      const R = 6371000;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // ── POST /gps/track?key=DEVICE_KEY ───────────────────────────────────────
    // Accepts Overland GeoJSON batch format or simple { lat, lon, ... }
    if (path === '/gps/track' && request.method === 'POST') {
      const key = url.searchParams.get('key');
      if (!key) return err('Missing key', 401);

      const device = await env.DB
        .prepare('SELECT id, user_id FROM gps_devices WHERE device_key = ?')
        .bind(key).first();
      if (!device) return err('Invalid key', 401);

      let body;
      try { body = await request.json(); } catch { return err('Invalid JSON'); }

      const now = Math.floor(Date.now() / 1000);
      let positions = [];

      if (body.locations && Array.isArray(body.locations)) {
        // Overland GeoJSON batch
        for (const loc of body.locations) {
          if (loc.geometry?.type !== 'Point') continue;
          const [lon, lat, alt] = loc.geometry.coordinates;
          const props = loc.properties ?? {};
          const ts = props.timestamp
            ? Math.floor(new Date(props.timestamp).getTime() / 1000)
            : now;
          positions.push({
            lat, lon,
            altitude: alt ?? props.altitude ?? null,
            speed: props.speed ?? null,
            accuracy: props.horizontal_accuracy ?? null,
            battery: props.battery_level ?? null,
            timestamp: ts,
          });
        }
      } else if (body.lat !== undefined && body.lon !== undefined) {
        positions.push({
          lat: body.lat,
          lon: body.lon,
          altitude: body.altitude ?? null,
          speed: body.speed ?? null,
          accuracy: body.accuracy ?? null,
          battery: body.battery ?? null,
          timestamp: body.timestamp ? Math.floor(body.timestamp) : now,
        });
      }

      if (!positions.length) return json({ result: 'ok', stored: 0 });

      positions.sort((a, b) => a.timestamp - b.timestamp);

      const lastStored = await env.DB
        .prepare('SELECT lat, lon FROM gps_positions WHERE device_id = ? ORDER BY timestamp DESC LIMIT 1')
        .bind(device.id).first();

      let prevLat = lastStored?.lat;
      let prevLon = lastStored?.lon;
      const toInsert = [];

      for (const pos of positions) {
        if (prevLat !== undefined && prevLon !== undefined) {
          if (haversineMeters(prevLat, prevLon, pos.lat, pos.lon) < 100) continue;
        }
        toInsert.push(pos);
        prevLat = pos.lat;
        prevLon = pos.lon;
      }

      if (toInsert.length > 0) {
        const stmts = toInsert.map(pos =>
          env.DB.prepare(
            'INSERT INTO gps_positions (device_id, user_id, lat, lon, altitude, speed, accuracy, battery, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(device.id, device.user_id, pos.lat, pos.lon, pos.altitude, pos.speed, pos.accuracy, pos.battery, pos.timestamp)
        );
        await env.DB.batch(stmts);
      }

      const latest = positions[positions.length - 1];
      await env.DB
        .prepare('UPDATE gps_devices SET last_seen = ?, last_lat = ?, last_lon = ?, battery = ? WHERE id = ?')
        .bind(now, latest.lat, latest.lon, latest.battery, device.id).run();

      return json({ result: 'ok', stored: toInsert.length });
    }

    // ── GET /gps/devices ─────────────────────────────────────────────────────
    if (path === '/gps/devices' && request.method === 'GET') {
      const userId = await getUserId(request, env);
      if (!userId) return err('Unauthorized', 401);
      const { results } = await env.DB
        .prepare('SELECT id, name, device_key, last_seen, last_lat, last_lon, battery FROM gps_devices WHERE user_id = ? ORDER BY id')
        .bind(userId).all();
      return json(results);
    }

    // ── POST /gps/devices ─────────────────────────────────────────────────────
    // Body: { name }
    if (path === '/gps/devices' && request.method === 'POST') {
      const userId = await getUserId(request, env);
      if (!userId) return err('Unauthorized', 401);
      let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
      const name = (body?.name ?? '').trim();
      if (!name) return err('Missing name');
      const key = randomHex(24);
      const { meta } = await env.DB
        .prepare('INSERT INTO gps_devices (user_id, name, device_key) VALUES (?, ?, ?)')
        .bind(userId, name, key).run();
      return json({ id: meta.last_row_id, name, device_key: key });
    }

    // ── DELETE /gps/devices/:id ───────────────────────────────────────────────
    if (path.startsWith('/gps/devices/') && request.method === 'DELETE') {
      const userId = await getUserId(request, env);
      if (!userId) return err('Unauthorized', 401);
      const deviceId = parseInt(path.split('/')[3]);
      if (!deviceId) return err('Invalid id');
      await env.DB.batch([
        env.DB.prepare('DELETE FROM gps_positions WHERE device_id = ? AND user_id = ?').bind(deviceId, userId),
        env.DB.prepare('DELETE FROM gps_devices WHERE id = ? AND user_id = ?').bind(deviceId, userId),
      ]);
      return json({ ok: true });
    }

    // ── GET /gps/stats ────────────────────────────────────────────────────────
    if (path === '/gps/stats' && request.method === 'GET') {
      const userId = await getUserId(request, env);
      if (!userId) return err('Unauthorized', 401);
      const { results } = await env.DB.prepare(`
        SELECT p.device_id, d.name AS device_name,
               COUNT(*)            AS total_points,
               MIN(p.timestamp)   AS oldest,
               MAX(p.timestamp)   AS newest
        FROM gps_positions p
        JOIN gps_devices d ON d.id = p.device_id
        WHERE p.user_id = ?
        GROUP BY p.device_id
      `).bind(userId).all();
      return json(results);
    }

    // ── GET /gps/history?deviceId=X&hours=24 ─────────────────────────────────
    if (path === '/gps/history' && request.method === 'GET') {
      const userId = await getUserId(request, env);
      if (!userId) return err('Unauthorized', 401);
      const deviceId = parseInt(url.searchParams.get('deviceId') ?? '0');
      const hours = Math.min(168, Math.max(1, parseInt(url.searchParams.get('hours') ?? '24')));
      if (!deviceId) return err('Missing deviceId');
      const device = await env.DB
        .prepare('SELECT id FROM gps_devices WHERE id = ? AND user_id = ?')
        .bind(deviceId, userId).first();
      if (!device) return err('Device not found', 404);
      const since = Math.floor(Date.now() / 1000) - hours * 3600;
      const { results } = await env.DB
        .prepare('SELECT lat, lon, speed, battery, timestamp FROM gps_positions WHERE device_id = ? AND timestamp >= ? ORDER BY timestamp ASC LIMIT 2000')
        .bind(deviceId, since).all();
      return json(results);
    }

    return err('Not found', 404);
  },
};
