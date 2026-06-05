import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve('.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, '');
  }
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const baseUrl = (process.env.POKLADNA_BASE_URL || 'https://pokladna.kvalitne.cz').replace(/\/$/, '');
const botEmail = process.env.POKLADNA_BOT_EMAIL;
const botPassword = process.env.POKLADNA_BOT_PASSWORD;
const dataFile = path.resolve(process.env.BOT_DATA_FILE || './data/links.json');

if (!token || !botEmail || !botPassword) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN, POKLADNA_BOT_EMAIL or POKLADNA_BOT_PASSWORD');
}

fs.mkdirSync(path.dirname(dataFile), { recursive: true });
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, '{}');

const links = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
let offset = 0;
let cookie = '';
let csrf = '';

function saveLinks() {
  fs.writeFileSync(dataFile, JSON.stringify(links, null, 2));
}

function rememberCookies(headers) {
  const raw = headers.get('set-cookie');
  if (!raw) return;
  const pairs = raw.split(/,(?=[^;]+?=)/).map(item => item.split(';')[0]);
  const map = new Map(cookie.split('; ').filter(Boolean).map(item => item.split('=')));
  for (const pair of pairs) {
    const [key, ...rest] = pair.split('=');
    map.set(key, rest.join('='));
  }
  cookie = [...map.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

async function pokladna(pathname, options = {}) {
  const res = await fetch(`${baseUrl}/api/${pathname}`, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(csrf && options.method && options.method !== 'GET' ? { 'x-csrf-token': csrf } : {}),
      ...(options.headers || {}),
    },
  });
  rememberCookies(res.headers);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error || `Pokladna HTTP ${res.status}`);
  if (json.csrf) csrf = json.csrf;
  return json;
}

async function loginPokladna() {
  const me = await pokladna('auth/me');
  csrf = me.csrf || csrf;
  await pokladna('auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: botEmail, password: botPassword }),
  });
}

async function tg(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.description || `Telegram ${method} failed`);
  return json.result;
}

async function send(chatId, text, extra = {}) {
  return tg('sendMessage', { chat_id: chatId, text, ...extra });
}

async function employeeFor(chatId) {
  const email = links[String(chatId)]?.email;
  if (!email) throw new Error('Use /link email@example.com first.');
  const employees = await pokladna('employees?status=all');
  const normalized = email.trim().toLowerCase();
  const employee = (employees.data || []).find(row =>
    String(row.email || '').toLowerCase() === normalized ||
    String(row.warehouse_email || '').toLowerCase() === normalized
  );
  if (!employee) throw new Error(`Employee not found for ${email}`);
  return employee;
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = (message.text || '').trim();
  const key = String(chatId);

  if (message.location) {
    links[key] = {
      ...(links[key] || {}),
      lastLocation: {
        lat: message.location.latitude,
        lng: message.location.longitude,
        location_accuracy: message.location.horizontal_accuracy || '',
        location_captured_at: new Date((message.date || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      },
    };
    saveLinks();
    await send(chatId, 'GPS saved. Now send /checkin or /checkout.');
    return;
  }

  if (text === '/start') {
    await send(chatId, 'Pokladna bot. Use /link email@example.com, send location, then /checkin or /checkout 0.');
    return;
  }

  if (text.startsWith('/link ')) {
    links[key] = { ...(links[key] || {}), email: text.slice(6).trim().toLowerCase() };
    saveLinks();
    await send(chatId, `Linked to ${links[key].email}`);
    return;
  }

  if (text === '/me') {
    const employee = await employeeFor(chatId);
    await send(chatId, `${employee.name}\n${employee.company_name || '-'} / ${employee.object_name || '-'}`);
    return;
  }

  if (text === '/checkin' || text.startsWith('/checkout')) {
    const employee = await employeeFor(chatId);
    const location = links[key]?.lastLocation;
    if (!location) throw new Error('Send your Telegram location first.');
    const extraBreak = text.startsWith('/checkout') ? Number(text.split(/\s+/)[1] || 0) : 0;
    await pokladna('checkins', {
      method: 'POST',
      body: JSON.stringify({
        employee_id: employee.id,
        object_id: employee.object_id || '',
        lat: location.lat,
        lng: location.lng,
        location_accuracy: location.location_accuracy,
        location_captured_at: location.location_captured_at,
        break_minutes: 30,
        extra_break_minutes: Math.max(0, Math.min(210, extraBreak)),
        note: 'Telegram bot',
      }),
    });
    await send(chatId, text === '/checkin' ? 'Check-in saved.' : 'Check-out saved.');
    return;
  }

  await send(chatId, 'Unknown command. Use /start.');
}

await loginPokladna();
console.log('Pokladna Telegram bot started');

for (;;) {
  try {
    const updates = await tg('getUpdates', { timeout: 30, offset });
    for (const update of updates) {
      offset = update.update_id + 1;
      if (!update.message) continue;
      try {
        await handleMessage(update.message);
      } catch (error) {
        await send(update.message.chat.id, `Error: ${error.message}`);
      }
    }
  } catch (error) {
    console.error(error);
    await new Promise(resolve => setTimeout(resolve, 3000));
    try { await loginPokladna(); } catch {}
  }
}
