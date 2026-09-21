const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const GALLERY_DIR = path.join(__dirname, 'data', 'gallery-photos');
if (!fs.existsSync(GALLERY_DIR)) fs.mkdirSync(GALLERY_DIR, { recursive: true });

// Family members are fixed configuration (not user-editable data),
// so palette/name tweaks here always take effect immediately.
// 'family' is a special category for whole-household items (holidays, family outings, etc.)
const MEMBERS = [
  { id: 'ben', name: 'Ben', color: '#A9C8DE' },      // pastel blue
  { id: 'inez', name: 'Inez', color: '#CBB8DD' },    // pastel purple
  { id: 'tyler', name: 'Tyler', color: '#E6A9A0' },  // pastel red
  { id: 'miya', name: 'Miya', color: '#A9DBC0' },    // pastel mint green
  { id: 'family', name: 'Family', color: '#F0C9A0' } // pastel peach, whole-household items
];

// ---------- Simple JSON "database" ----------
function loadDB() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = {
      events: [],
      chores: [],
      lists: [],
      reminders: [],
      files: [],
      trips: [],
      budgets: [],
      gallery: [],
      googleAuth: {}
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  delete db.members; // legacy field, no longer stored here
  // Ensure any newly-added collections exist even for older data files
  ['events', 'chores', 'lists', 'reminders', 'files', 'trips', 'budgets', 'gallery'].forEach(key => {
    if (!Array.isArray(db[key])) db[key] = [];
  });
  if (typeof db.googleAuth !== 'object' || db.googleAuth === null || Array.isArray(db.googleAuth)) db.googleAuth = {};
  return db;
}

function saveDB(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function id() {
  return crypto.randomBytes(6).toString('hex');
}

// ---------- Helpers ----------
function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function serveStatic(req, res, urlPath) {
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
  filePath = path.join(PUBLIC_DIR, filePath);
  // Prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function serveGalleryPhoto(req, res, urlPath) {
  const fileName = path.basename(urlPath); // strip any path traversal attempts
  const filePath = path.join(GALLERY_DIR, fileName);
  if (!filePath.startsWith(GALLERY_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---------- Google Calendar OAuth (read-only, one-way import) ----------
// Requires the user's own Google Cloud OAuth credentials, set as Railway
// environment variables GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
function getRedirectUri(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  return `${proto}://${host}/auth/google/callback`;
}
async function handleGoogleAuthStart(req, res, query) {
  const member = query.get('member');
  if (!member) { res.writeHead(400); return res.end('Missing member'); }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    return res.end('Google Calendar isn\'t configured yet — GOOGLE_CLIENT_ID is missing on the server.');
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(req),
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    access_type: 'offline',
    prompt: 'consent',
    state: member
  });
  res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  res.end();
}
async function handleGoogleAuthCallback(req, res, query) {
  const code = query.get('code');
  const member = query.get('state');
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!code || !member || !clientId || !clientSecret) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('Google Calendar connection failed — missing code, member, or server credentials.');
  }
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: getRedirectUri(req), grant_type: 'authorization_code'
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.error_description || 'Token exchange failed');
    const db = loadDB();
    db.googleAuth[member] = {
      refreshToken: tokenData.refresh_token,
      accessToken: tokenData.access_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000)
    };
    saveDB(db);
    res.writeHead(302, { Location: '/?googleConnected=' + member });
    res.end();
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Google Calendar connection failed: ' + err.message);
  }
}
async function getFreshAccessToken(member, db) {
  const auth = db.googleAuth[member];
  if (!auth || !auth.refreshToken) return null;
  if (auth.accessToken && auth.expiresAt > Date.now() + 60000) return auth.accessToken;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: auth.refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token'
    })
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) return null;
  auth.accessToken = tokenData.access_token;
  auth.expiresAt = Date.now() + (tokenData.expires_in * 1000);
  saveDB(db);
  return auth.accessToken;
}
async function handleGoogleCalendarEvents(req, res, query) {
  const member = query.get('member');
  const start = query.get('start');
  const end = query.get('end');
  const db = loadDB();
  const accessToken = await getFreshAccessToken(member, db);
  if (!accessToken) return sendJSON(res, 200, { connected: false, events: [] });
  try {
    const params = new URLSearchParams({
      timeMin: new Date(start).toISOString(),
      timeMax: new Date(end).toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime'
    });
    const evRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const evData = await evRes.json();
    if (!evRes.ok) return sendJSON(res, 200, { connected: true, error: evData.error && evData.error.message, events: [] });
    const events = (evData.items || []).map(e => ({
      title: e.summary || '(untitled)',
      date: (e.start.date || e.start.dateTime || '').slice(0, 10),
      time: e.start.dateTime ? e.start.dateTime.slice(11, 16) : null
    }));
    return sendJSON(res, 200, { connected: true, events });
  } catch (err) {
    return sendJSON(res, 200, { connected: true, error: err.message, events: [] });
  }
}
function handleGoogleStatus(req, res) {
  const db = loadDB();
  const connected = Object.keys(db.googleAuth).filter(m => db.googleAuth[m] && db.googleAuth[m].refreshToken);
  return sendJSON(res, 200, { connected });
}

// ---------- API ----------
async function handleAPI(req, res, urlPath) {
  const db = loadDB();
  const parts = urlPath.split('/').filter(Boolean); // ['api', 'events', ':id']
  const resource = parts[1]; // events, chores, lists, reminders, members, files
  const itemId = parts[2];

  const collections = ['events', 'chores', 'lists', 'reminders', 'files', 'trips', 'budgets', 'gallery'];

  if (resource === 'members' && req.method === 'GET') {
    return sendJSON(res, 200, MEMBERS);
  }

  // Gallery photo upload: decode base64 image, save to disk, store metadata
  if (resource === 'gallery' && req.method === 'POST') {
    const body = await readBody(req);
    const { caption, person, imageData, fileName } = body;
    if (!imageData || !imageData.startsWith('data:image/')) {
      return sendJSON(res, 400, { error: 'imageData must be a base64 data URI (data:image/...)' });
    }
    const match = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) return sendJSON(res, 400, { error: 'Could not parse image data' });
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');
    const photoId = id();
    const savedFileName = `${photoId}.${ext}`;
    fs.writeFileSync(path.join(GALLERY_DIR, savedFileName), buffer);
    const item = { id: photoId, caption: caption || '', person: person || 'family', url: `/gallery-photos/${savedFileName}`, createdAt: new Date().toISOString() };
    db.gallery.push(item);
    saveDB(db);
    return sendJSON(res, 201, item);
  }
  // Gallery delete: also remove the photo file from disk
  if (resource === 'gallery' && itemId && req.method === 'DELETE') {
    const idx = db.gallery.findIndex(x => x.id === itemId);
    if (idx === -1) return sendJSON(res, 404, { error: 'Not found' });
    const removed = db.gallery.splice(idx, 1)[0];
    if (removed.url) {
      const filePath = path.join(GALLERY_DIR, path.basename(removed.url));
      fs.unlink(filePath, () => {}); // best-effort, ignore errors
    }
    saveDB(db);
    return sendJSON(res, 200, removed);
  }

  if (collections.includes(resource)) {
    if (req.method === 'GET') {
      return sendJSON(res, 200, db[resource]);
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const item = { id: id(), createdAt: new Date().toISOString(), ...body };
      db[resource].push(item);
      saveDB(db);
      return sendJSON(res, 201, item);
    }
    if (req.method === 'PUT' && itemId) {
      const body = await readBody(req);
      const idx = db[resource].findIndex(x => x.id === itemId);
      if (idx === -1) return sendJSON(res, 404, { error: 'Not found' });
      db[resource][idx] = { ...db[resource][idx], ...body };
      saveDB(db);
      return sendJSON(res, 200, db[resource][idx]);
    }
    if (req.method === 'DELETE' && itemId) {
      const idx = db[resource].findIndex(x => x.id === itemId);
      if (idx === -1) return sendJSON(res, 404, { error: 'Not found' });
      const removed = db[resource].splice(idx, 1);
      saveDB(db);
      return sendJSON(res, 200, removed[0]);
    }
  }

  if (resource === 'day' && itemId && req.method === 'GET') {
    // itemId here is a date string YYYY-MM-DD
    const date = itemId;
    return sendJSON(res, 200, {
      events: db.events.filter(e => date >= e.date && date <= (e.endDate || e.date)),
      chores: db.chores.filter(c => c.due === date),
      reminders: db.reminders.filter(r => r.date === date)
    });
  }

  return sendJSON(res, 404, { error: 'Unknown endpoint' });
}

// ---------- Server ----------
const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  const query = new URL(req.url, 'http://x').searchParams;
  try {
    if (urlPath === '/auth/google/start') {
      await handleGoogleAuthStart(req, res, query);
    } else if (urlPath === '/auth/google/callback') {
      await handleGoogleAuthCallback(req, res, query);
    } else if (urlPath === '/api/google-calendar/events') {
      await handleGoogleCalendarEvents(req, res, query);
    } else if (urlPath === '/api/google-calendar/status') {
      handleGoogleStatus(req, res);
    } else if (urlPath.startsWith('/gallery-photos/')) {
      serveGalleryPhoto(req, res, urlPath);
    } else if (urlPath.startsWith('/api/')) {
      await handleAPI(req, res, urlPath);
    } else {
      serveStatic(req, res, urlPath);
    }
  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Family Hub running on port ${PORT}`);
});
