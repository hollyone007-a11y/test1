const fs = require('fs');
const path = require('path');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const root = __dirname;
const meta = JSON.parse(fs.readFileSync(path.join(root, 'ftp-meta.json'), 'utf8'));
const secretText = fs.readFileSync('C:/Users/huquf/OneDrive/Plocha/pass sqp.txt', 'utf8');
const adminPassword = (secretText.match(/^Heslo:\s*(.+)$/m) || [])[1]?.trim();
if (!adminPassword) throw new Error('Admin password not found');

const mysqlPassword = 'Px9!kV7sQ2m#Z4rT';
let cookie = '';

function remember(headers) {
  const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  if (!list.length) return;
  const map = new Map(cookie.split('; ').filter(Boolean).map(v => v.split('=')));
  for (const item of list) {
    const [k, ...rest] = item.split(';')[0].split('=');
    map.set(k, rest.join('='));
  }
  cookie = [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function request(url, options = {}) {
  const res = await fetch(url, {
    redirect: 'manual',
    ...options,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(options.headers || {}),
    },
  });
  remember(res.headers);
  const text = await res.text();
  if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get('location')) {
    const next = new URL(res.headers.get('location'), url).toString();
    return request(next, res.status === 307 || res.status === 308 ? options : { method: 'GET', headers: {} });
  }
  return { res, text };
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function strip(html) {
  return decodeEntities(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function inputValue(html, name) {
  const re = new RegExp(`<input[^>]+name=["']${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0] || '';
  return decodeEntities(tag.match(/value=["']([^"']*)["']/i)?.[1] || '');
}

function formAction(html) {
  const form = html.slice(html.indexOf('<form'), html.indexOf('</form>') + 7);
  return form.match(/action=["']([^"']+)["']/i)?.[1] || '/prihlaseni/';
}

(async () => {
  const loginPage = await request('https://admin.webzdarma.cz/connections/');
  const loginAction = new URL(formAction(loginPage.text), loginPage.res.url).toString();
  const loginBody = new URLSearchParams({
    username: meta.user,
    password: adminPassword,
    _token_: inputValue(loginPage.text, '_token_'),
    _do: inputValue(loginPage.text, '_do'),
    _submit: 'Přihlásit',
  });
  await request(loginAction, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: loginBody.toString(),
  });

  const mysqlPage = await request('https://admin.webzdarma.cz/php-mysql/');
  const text = strip(mysqlPage.text);
  const dbHost = (text.match(/Server:\s*([A-Za-z0-9_.-]+)/i) || [])[1];
  const dbName = (text.match(/datab\S*ze:\s*([A-Za-z0-9_]+)/i) || [])[1];
  const dbUser = (text.match(/jm\S*no:\s*([A-Za-z0-9_]+)/i) || [])[1];
  if (!dbHost || !dbName || !dbUser) {
    throw new Error('Could not parse MySQL connection data');
  }

  const formHtml = (mysqlPage.text.match(/<form\b[\s\S]*?webadmin-mysql-formSettings-submit[\s\S]*?<\/form>/i) || [])[0];
  if (!formHtml) throw new Error('Password form not found');
  const formBody = new URLSearchParams({
    password: mysqlPassword,
    passwordRepeat: mysqlPassword,
    _token_: inputValue(formHtml, '_token_'),
    _do: inputValue(formHtml, '_do'),
    _submit: 'Uložit nastavení',
  });
  await request('https://admin.webzdarma.cz/php-mysql/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody.toString(),
  });

  fs.writeFileSync(path.join(root, 'mysql-meta.json'), JSON.stringify({
    db_host: dbHost,
    db_name: dbName,
    db_user: dbUser,
    db_pass: mysqlPassword,
  }, null, 2), 'utf8');
  console.log(JSON.stringify({ ok: true, db_host: dbHost, db_name: dbName, db_user: dbUser }));
})().catch(err => {
  console.error(err);
  process.exit(1);
});
