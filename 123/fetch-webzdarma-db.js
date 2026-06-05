const fs = require('fs');
const path = require('path');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const root = __dirname;
const meta = JSON.parse(fs.readFileSync(path.join(root, 'ftp-meta.json'), 'utf8'));
const secretText = fs.readFileSync('C:/Users/huquf/OneDrive/Plocha/pass sqp.txt', 'utf8');
const password = (secretText.match(/^Heslo:\s*(.+)$/m) || [])[1]?.trim();
if (!password) throw new Error('FTP/admin password not found');

let cookie = '';
function remember(headers) {
  const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  if (list.length) {
    const parts = list.map(v => v.split(';')[0]);
    const map = new Map(cookie.split('; ').filter(Boolean).map(v => v.split('=')));
    for (const part of parts) {
      const [k, ...rest] = part.split('=');
      map.set(k, rest.join('='));
    }
    cookie = [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
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
    const nextOptions = res.status === 307 || res.status === 308
      ? options
      : { method: 'GET', headers: {} };
    return request(next, nextOptions);
  }
  return { res, text };
}

function inputValue(html, name) {
  const re = new RegExp(`<input[^>]+name=["']${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0] || '';
  return tag.match(/value=["']([^"']*)["']/i)?.[1] || '';
}

function formAction(html) {
  const form = html.slice(html.indexOf('<form'), html.indexOf('</form>') + 7);
  return form.match(/action=["']([^"']+)["']/i)?.[1] || '/prihlaseni/';
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

(async () => {
  const loginPage = await request('https://admin.webzdarma.cz/connections/');
  const action = new URL(formAction(loginPage.text), loginPage.res.url).toString();
  const params = new URLSearchParams({
    username: meta.user,
    password,
    _token_: inputValue(loginPage.text, '_token_'),
    _do: inputValue(loginPage.text, '_do'),
    _submit: 'Přihlásit',
  });
  const login = await request(action, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const page = login.res.url.includes('/connections/') ? login : await request('https://admin.webzdarma.cz/connections/');
  const links = [...page.text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(m => ({ href: new URL(decodeEntities(m[1]), page.res.url).toString(), text: strip(m[2]) }))
    .filter(a => /sql|mysql|php|datab/i.test(a.href + ' ' + a.text));
  let mysqlPage = page;
  const mysqlLink = links.find(a => /php-mysql/i.test(a.href)) || links[0];
  if (mysqlLink) {
    mysqlPage = await request(mysqlLink.href);
  }
  const text = strip(mysqlPage.text);
  const lower = text.toLowerCase();
  const start = Math.max(0, lower.indexOf('mysql') - 800);
  const end = Math.min(text.length, lower.indexOf('mysql') + 3000);
  const snippet = start >= 0 && lower.includes('mysql') ? text.slice(start, end) : text.slice(0, 3000);
  fs.writeFileSync(path.join(root, 'admin-db-snippet.txt'), snippet, 'utf8');
  fs.writeFileSync(path.join(root, 'admin-php-mysql-page.txt'), strip(mysqlPage.text), 'utf8');
  const forms = [...mysqlPage.text.matchAll(/<form\b[\s\S]*?<\/form>/gi)].map(formMatch => {
    const html = formMatch[0];
    return {
      action: new URL((html.match(/action=["']([^"']*)["']/i)?.[1] || mysqlPage.res.url), mysqlPage.res.url).toString(),
      method: (html.match(/method=["']([^"']*)["']/i)?.[1] || 'get').toLowerCase(),
      text: strip(html).slice(0, 500),
      inputs: [...html.matchAll(/<(input|select|button)\b[^>]*>/gi)].map(m => ({
        tag: m[1].toLowerCase(),
        type: m[0].match(/type=["']([^"']*)["']/i)?.[1] || '',
        name: m[0].match(/name=["']([^"']*)["']/i)?.[1] || '',
        value: decodeEntities(m[0].match(/value=["']([^"']*)["']/i)?.[1] || ''),
      })),
    };
  });
  fs.writeFileSync(path.join(root, 'admin-forms.json'), JSON.stringify(forms, null, 2), 'utf8');
  fs.writeFileSync(path.join(root, 'admin-login-status.json'), JSON.stringify({
    loginStatus: login.res.status,
    loginUrl: login.res.url,
    pageStatus: mysqlPage.res.status,
    pageUrl: mysqlPage.res.url,
    hasMysql: lower.includes('mysql'),
    hasSql: lower.includes('sql'),
    links,
  }, null, 2), 'utf8');
  console.log(JSON.stringify({ pageUrl: page.res.url, hasMysql: lower.includes('mysql'), hasSql: lower.includes('sql') }));
})().catch(err => {
  console.error(err);
  process.exit(1);
});
