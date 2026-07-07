// ============================================================
// QingH Studio — Cloudflare Worker API
// 部署：npx wrangler deploy
// 功能：JWT认证 · 用户管理 · 聊天同步 · AI代理 · VIP校验
// ============================================================

// ---------- JWT helpers (HMAC-SHA256 via Web Crypto) ----------
let JWT_SECRET_KEY = 'qingh-jwt-secret-key-change-in-production';

async function hmacSha256(key, data) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');
}

function base64UrlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');
}

async function createJWT(payload, expiresHours = 720) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64UrlEncode(JSON.stringify({ ...payload, iat: now, exp: now + expiresHours * 3600 }));
  const sig = await hmacSha256(JWT_SECRET_KEY, `${header}.${body}`);
  return `${header}.${body}.${sig}`;
}

async function verifyJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const expectedSig = await hmacSha256(JWT_SECRET_KEY, `${parts[0]}.${parts[1]}`);
    if (expectedSig !== parts[2]) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

// ---------- Password hash (SHA-256) ----------
async function hashPassword(pw) {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(pw));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ---------- UUID generator ----------
function uuid() {
  return crypto.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ---------- CORS ----------
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json;charset=utf-8', ...corsHeaders() },
  });
}

// ---------- Auth middleware ----------
async function authUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;
  const payload = await verifyJWT(token);
  if (!payload) return null;
  // Fetch user from DB
  const user = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(payload.uid).first();
  return user || null;
}

// ==================== ROUTER ====================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      // Apply JWT secret from env
      if (env.JWT_SECRET) JWT_SECRET_KEY = env.JWT_SECRET;

      // ---- Public routes ----
      if (path === '/api/register' && method === 'POST') return handleRegister(request, env);
      if (path === '/api/login' && method === 'POST') return handleLogin(request, env);
      if (path === '/api/health') return json({ ok: true });

      // ---- Protected routes (require JWT) ----
      const user = await authUser(request, env);
      if (!user) {
        return json({ error: '请先登录', code: 'UNAUTHORIZED' }, 401);
      }

      // Sessions
      if (path === '/api/sessions') {
        if (method === 'GET') return listSessions(request, env, user);
        if (method === 'POST') return createSession(request, env, user);
      }
      if (path.startsWith('/api/sessions/') && method === 'DELETE') {
        return deleteSession(request, env, user, path.split('/')[3]);
      }

      // Messages
      if (path.startsWith('/api/sessions/') && path.includes('/messages')) {
        const sessionId = path.split('/')[3];
        if (method === 'GET') return getMessages(request, env, user, sessionId);
        if (method === 'POST') return saveMessages(request, env, user, sessionId);
      }

      // Worlds
      if (path === '/api/worlds') {
        if (method === 'GET') return getWorlds(request, env, user);
        if (method === 'POST') return saveWorlds(request, env, user);
      }

      // Characters
      if (path === '/api/characters') {
        if (method === 'GET') return getCharacters(request, env, user);
        if (method === 'POST') return saveCharacters(request, env, user);
      }

      // Supplements
      if (path.startsWith('/api/sessions/') && path.includes('/supplements')) {
        const sessionId = path.split('/')[3];
        if (method === 'GET') return getSupplements(request, env, user, sessionId);
        if (method === 'POST') return saveSupplements(request, env, user, sessionId);
      }

      // Uploaded files
      if (path.startsWith('/api/files')) {
        if (method === 'GET') return getFiles(request, env, user);
        if (method === 'POST') return uploadFile(request, env, user);
        if (method === 'DELETE' && path.split('/').length > 3) {
          return deleteFile(request, env, user, path.split('/')[3]);
        }
      }

      // AI Proxy
      if (path === '/api/ai-proxy' && method === 'POST') return aiProxy(request, env, user);

      // User profile
      if (path === '/api/user' && method === 'GET') return getUserProfile(request, env, user);
      if (path === '/api/user/api-key' && method === 'PUT') return updateApiKey(request, env, user);

      return json({ error: 'Not found' }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: e.message || '服务器错误' }, 500);
    }
  },
};

// ==================== AUTH HANDLERS ====================
async function handleRegister(request, env) {
  const { email, password } = await request.json();
  if (!email || !password) return json({ error: '邮箱和密码不能为空' }, 400);
  if (password.length < 6) return json({ error: '密码至少6位' }, 400);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email.toLowerCase().trim()).first();
  if (existing) return json({ error: '该邮箱已注册' }, 409);

  const id = uuid();
  const pwHash = await hashPassword(password);
  await env.DB.prepare(
    'INSERT INTO users (id,email,password_hash) VALUES (?,?,?)'
  ).bind(id, email.toLowerCase().trim(), pwHash).run();

  const token = await createJWT({ uid: id, email: email.toLowerCase().trim() });
  return json({ token, user: { id, email: email.toLowerCase().trim(), vip_level: 0 } });
}

async function handleLogin(request, env) {
  const { email, password } = await request.json();
  if (!email || !password) return json({ error: '邮箱和密码不能为空' }, 400);

  const user = await env.DB.prepare('SELECT * FROM users WHERE email=?')
    .bind(email.toLowerCase().trim()).first();
  if (!user) return json({ error: '用户不存在' }, 404);

  const pwHash = await hashPassword(password);
  if (pwHash !== user.password_hash) return json({ error: '密码错误' }, 401);

  const token = await createJWT({ uid: user.id, email: user.email });
  return json({
    token,
    user: {
      id: user.id,
      email: user.email,
      api_key: user.api_key || '',
      api_provider: user.api_provider || 'anthropic',
      model: user.model || 'claude-sonnet-4-6',
      vip_level: user.vip_level,
      vip_expires_at: user.vip_expires_at,
    }
  });
}

// ==================== SESSION HANDLERS ====================
async function listSessions(request, env, user) {
  const sessions = await env.DB.prepare(
    'SELECT * FROM sessions WHERE user_id=? ORDER BY updated_at DESC LIMIT 50'
  ).bind(user.id).all();
  return json(sessions.results);
}

async function createSession(request, env, user) {
  const { title, mode } = await request.json();
  const id = uuid();
  await env.DB.prepare(
    'INSERT INTO sessions (id,user_id,title,mode) VALUES (?,?,?,?)'
  ).bind(id, user.id, title || '新的对话', mode || 'chat').run();
  return json({ id, title: title || '新的对话', mode: mode || 'chat' }, 201);
}

async function deleteSession(request, env, user, sessionId) {
  const ses = await env.DB.prepare('SELECT id FROM sessions WHERE id=? AND user_id=?')
    .bind(sessionId, user.id).first();
  if (!ses) return json({ error: '会话不存在' }, 404);
  // Cascade: delete messages + supplements first, then session
  await env.DB.prepare('DELETE FROM messages WHERE session_id=?').bind(sessionId).run();
  await env.DB.prepare('DELETE FROM supplements WHERE session_id=?').bind(sessionId).run();
  await env.DB.prepare('DELETE FROM sessions WHERE id=? AND user_id=?').bind(sessionId, user.id).run();
  return json({ ok: true });
}

// ==================== MESSAGE HANDLERS ====================
async function getMessages(request, env, user, sessionId) {
  const ses = await env.DB.prepare('SELECT id FROM sessions WHERE id=? AND user_id=?')
    .bind(sessionId, user.id).first();
  if (!ses) return json({ error: '会话不存在' }, 404);

  const msgs = await env.DB.prepare(
    'SELECT role, content FROM messages WHERE session_id=? ORDER BY id ASC'
  ).bind(sessionId).all();
  return json(msgs.results);
}

async function saveMessages(request, env, user, sessionId) {
  const ses = await env.DB.prepare('SELECT id FROM sessions WHERE id=? AND user_id=?')
    .bind(sessionId, user.id).first();
  if (!ses) return json({ error: '会话不存在' }, 404);

  const { messages } = await request.json();
  if (!Array.isArray(messages)) return json({ error: 'messages 必须是数组' }, 400);

  // Delete old messages & insert new ones (full replace)
  await env.DB.prepare('DELETE FROM messages WHERE session_id=?').bind(sessionId).run();
  const stmt = env.DB.prepare('INSERT INTO messages (session_id,role,content) VALUES (?,?,?)');
  // Use batched inserts
  const batch = messages.map(m => stmt.bind(sessionId, m.role, m.content));
  for (const b of batch) await b.run();

  // Update session updated_at
  await env.DB.prepare('UPDATE sessions SET updated_at=datetime(\'now\') WHERE id=?').bind(sessionId).run();

  return json({ ok: true, count: messages.length });
}

// ==================== WORLD HANDLERS ====================
async function getWorlds(request, env, user) {
  const worlds = await env.DB.prepare(
    'SELECT * FROM worlds WHERE user_id=? ORDER BY created_at ASC'
  ).bind(user.id).all();
  return json(worlds.results);
}

async function saveWorlds(request, env, user) {
  const { worlds } = await request.json();
  if (!Array.isArray(worlds)) return json({ error: '格式错误' }, 400);

  await env.DB.prepare('DELETE FROM worlds WHERE user_id=?').bind(user.id).run();
  const stmt = env.DB.prepare(
    'INSERT INTO worlds (id,user_id,name,color,description,created_at) VALUES (?,?,?,?,?,?)'
  );
  for (const w of worlds) {
    await stmt.bind(w.id, user.id, w.name, w.color || '#7c5cfc', w.description || '', w.createdAt || new Date().toISOString()).run();
  }
  return json({ ok: true, count: worlds.length });
}

// ==================== CHARACTER HANDLERS ====================
async function getCharacters(request, env, user) {
  const chars = await env.DB.prepare(
    'SELECT * FROM characters WHERE user_id=? ORDER BY created_at ASC'
  ).bind(user.id).all();
  return json(chars.results);
}

async function saveCharacters(request, env, user) {
  const { characters } = await request.json();
  if (!Array.isArray(characters)) return json({ error: '格式错误' }, 400);

  await env.DB.prepare('DELETE FROM characters WHERE user_id=?').bind(user.id).run();
  const stmt = env.DB.prepare(
    'INSERT INTO characters (id,user_id,world_id,name,description,created_at) VALUES (?,?,?,?,?,?)'
  );
  for (const c of characters) {
    await stmt.bind(c.id, user.id, c.worldId || '', c.name, c.description || '', c.createdAt || new Date().toISOString()).run();
  }
  return json({ ok: true, count: characters.length });
}

// ==================== SUPPLEMENT HANDLERS ====================
async function getSupplements(request, env, user, sessionId) {
  const sups = await env.DB.prepare(
    'SELECT content FROM supplements WHERE user_id=? AND session_id=? ORDER BY id ASC'
  ).bind(user.id, sessionId).all();
  return json(sups.results.map(s => s.content));
}

async function saveSupplements(request, env, user, sessionId) {
  const { notes } = await request.json();
  if (!Array.isArray(notes)) return json({ error: '格式错误' }, 400);

  await env.DB.prepare('DELETE FROM supplements WHERE user_id=? AND session_id=?')
    .bind(user.id, sessionId).run();
  const stmt = env.DB.prepare(
    'INSERT INTO supplements (user_id,session_id,content) VALUES (?,?,?)'
  );
  for (const n of notes) {
    if (n.trim()) await stmt.bind(user.id, sessionId, n).run();
  }
  return json({ ok: true, count: notes.length });
}

// ==================== FILE HANDLERS ====================
async function getFiles(request, env, user) {
  const files = await env.DB.prepare(
    'SELECT id,name,size,created_at FROM uploaded_files WHERE user_id=? ORDER BY created_at DESC'
  ).bind(user.id).all();
  return json(files.results);
}

async function uploadFile(request, env, user) {
  const { name, content, size } = await request.json();
  if (!name || !content) return json({ error: '文件信息不完整' }, 400);
  // Limit content to 500KB for free users
  const maxSize = user.vip_level >= 1 ? 2000000 : 500000;
  if (content.length > maxSize) {
    return json({ error: `文件内容过大（最大${maxSize/1000}KB）` }, 413);
  }
  const id = uuid();
  await env.DB.prepare(
    'INSERT INTO uploaded_files (id,user_id,name,content,size) VALUES (?,?,?,?,?)'
  ).bind(id, user.id, name, content.slice(0, maxSize), size || 0).run();
  return json({ id, name, size: size || 0 }, 201);
}

async function deleteFile(request, env, user, fileId) {
  await env.DB.prepare('DELETE FROM uploaded_files WHERE id=? AND user_id=?')
    .bind(fileId, user.id).run();
  return json({ ok: true });
}

// ==================== AI PROXY ====================
async function aiProxy(request, env, user) {
  const body = await request.json();
  const { provider, model, messages, apiKey, secretKey, customUrl } = body;

  if (!provider || !model || !messages) {
    return json({ error: '缺少参数: provider, model, messages' }, 400);
  }

  // Use user's own API key (stored or passed)
  const key = apiKey || user.api_key;
  if (!key) return json({ error: '请先在设置中填写 API Key' }, 400);

  try {
    let result;

    switch (provider) {
      case 'anthropic': {
        const sys = messages.find(m => m.role === 'system');
        const userMsgs = messages.filter(m => m.role !== 'system');
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 8192,
            system: sys?.content || '',
            messages: userMsgs.map(m => ({
              role: m.role,
              content: [{ type: 'text', text: m.content }],
            })),
          }),
        });
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({}));
          throw new Error(`Anthropic ${resp.status}: ${e.error?.message || '错误'}`);
        }
        const d = await resp.json();
        result = d.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
        break;
      }

      case 'google': {
        const sys = messages.find(m => m.role === 'system');
        const body = {
          contents: messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
        };
        if (sys) body.systemInstruction = { parts: [{ text: sys.content }] };
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        );
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({}));
          throw new Error(`Gemini ${resp.status}: ${e.error?.message || '错误'}`);
        }
        const d = await resp.json();
        result = d.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
        break;
      }

      case 'baidu': {
        const secret = secretKey || user.baidu_secret_key || '';
        if (!secret) throw new Error('百度需要 Secret Key');
        const tr = await fetch(
          `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(key)}&client_secret=${encodeURIComponent(secret)}`,
          { method: 'POST' }
        );
        const td = await tr.json();
        if (td.error) throw new Error(`百度OAuth: ${td.error_description || td.error}`);
        const sys = messages.find(m => m.role === 'system');
        const reqBody = { messages: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })) };
        if (sys) reqBody.system = sys.content;
        const resp = await fetch(
          `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${model}?access_token=${td.access_token}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody) }
        );
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({}));
          throw new Error(`百度 ${resp.status}: ${e.error_msg || '错误'}`);
        }
        const d = await resp.json();
        if (d.error_msg) throw new Error(d.error_msg);
        result = d.result || '';
        break;
      }

      default: { // OpenAI-compatible
        let apiUrl;
        switch (provider) {
          case 'deepseek': apiUrl = 'https://api.deepseek.com/v1/chat/completions'; break;
          case 'moonshot': apiUrl = 'https://api.moonshot.cn/v1/chat/completions'; break;
          case 'zhipu': apiUrl = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'; break;
          case 'bytedance': apiUrl = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'; break;
          case 'alibaba': apiUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'; break;
          case 'xai': apiUrl = 'https://api.x.ai/v1/chat/completions'; break;
          case 'siliconflow': apiUrl = 'https://api.siliconflow.cn/v1/chat/completions'; break;
          case 'openai': apiUrl = 'https://api.openai.com/v1/chat/completions'; break;
          case 'custom': apiUrl = customUrl || user.custom_api_url || 'https://api.openai.com/v1/chat/completions'; break;
          default: apiUrl = 'https://api.openai.com/v1/chat/completions';
        }
        const resp = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
          body: JSON.stringify({ model, messages, max_tokens: 8192 }),
        });
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({}));
          throw new Error(`${resp.status}: ${e.error?.message || '错误'}`);
        }
        const d = await resp.json();
        result = d.choices?.[0]?.message?.content || '';
      }
    }

    if (!result) throw new Error('AI 返回空内容');
    return json({ content: result });
  } catch (e) {
    console.error('AI Proxy error:', e);
    return json({ error: e.message || 'AI 请求失败' }, 502);
  }
}

// ==================== USER HANDLERS ====================
async function getUserProfile(request, env, user) {
  return json({
    id: user.id,
    email: user.email,
    api_key: user.api_key ? '••••' + user.api_key.slice(-4) : '',
    api_provider: user.api_provider,
    model: user.model,
    vip_level: user.vip_level,
    vip_expires_at: user.vip_expires_at,
    created_at: user.created_at,
  });
}

async function updateApiKey(request, env, user) {
  const { api_key, api_provider, model, baidu_secret_key, custom_api_url } = await request.json();
  const updates = [];
  const params = [];

  if (api_key !== undefined) { updates.push('api_key=?'); params.push(api_key); }
  if (api_provider !== undefined) { updates.push('api_provider=?'); params.push(api_provider); }
  if (model !== undefined) { updates.push('model=?'); params.push(model); }
  if (baidu_secret_key !== undefined) { updates.push('baidu_secret_key=?'); params.push(baidu_secret_key); }
  if (custom_api_url !== undefined) { updates.push('custom_api_url=?'); params.push(custom_api_url); }

  if (updates.length === 0) return json({ error: '无更新内容' }, 400);

  updates.push('updated_at=datetime(\'now\')');
  params.push(user.id);
  await env.DB.prepare(`UPDATE users SET ${updates.join(',')} WHERE id=?`).bind(...params).run();

  return json({ ok: true });
}
