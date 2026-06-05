const app = document.getElementById('app');
const toastBox = document.getElementById('toast');
const appVersion = '20260602-0101';
const companyFilterVersion = '20260517-all-company-default';
if (localStorage.getItem('pokladna_company_filter_version') !== companyFilterVersion) {
  localStorage.setItem('pokladna_company_filter_version', companyFilterVersion);
  localStorage.removeItem('pokladna_company');
}
const languageVersion = '20260528-cs-default';
if (localStorage.getItem('pokladna_language_version') !== languageVersion) {
  localStorage.setItem('pokladna_language_version', languageVersion);
  localStorage.setItem('pokladna_lang', 'cs');
}

const state = {
  user: null,
  csrf: '',
  view: 'dashboard',
  month: new Date().getMonth() + 1,
  year: new Date().getFullYear(),
  lang: localStorage.getItem('pokladna_lang') || 'cs',
  companyId: localStorage.getItem('pokladna_company') || '',
  cache: {},
  geoWatch: null,
  notificationsEnabled: false,
  notificationCount: 0,
  installPrompt: null,
  wakeLock: null,
  mediaTimer: null,
  isRohlikEmployee: false,
  isStavbaEmployee: false,
  stavbaObjectId: localStorage.getItem('pokladna_stavba_object') || '',
  casTab: localStorage.getItem('pokladna_cas_tab') || 'hours',
  workerTab: localStorage.getItem('pokladna_worker_tab') || 'shift',
  workerChatChannel: localStorage.getItem('pokladna_worker_chat_channel') || 'direct',
  workerChatPeerId: localStorage.getItem('pokladna_worker_chat_peer') || '',
};
const sidebarStorageKey = 'pokladna_sidebar_collapsed';
const casTabStorageKey = 'pokladna_cas_tab';
const workerTabStorageKey = 'pokladna_worker_tab';
const workerChatChannelStorageKey = 'pokladna_worker_chat_channel';
const workerChatPeerStorageKey = 'pokladna_worker_chat_peer';

async function clearOldAppCaches() {
  const versionKey = 'buildpay_app_version';
  if (localStorage.getItem(versionKey) === appVersion) return;
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith('buildpay-shell-')).map(key => caches.delete(key)));
    }
  } catch (err) {
    console.warn('Cache cleanup failed', err);
  }
  localStorage.setItem(versionKey, appVersion);
}

clearOldAppCaches();

if ('serviceWorker' in navigator) {
  let swRefreshing = false;
navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swRefreshing) return;
    swRefreshing = true;
    sessionStorage.setItem('buildpay_sw_ready', appVersion);
    toast('Nova verze je pripravena. Data zustala na obrazovce.', 'ok');
  });
  navigator.serviceWorker.register(`/sw.js?v=${appVersion}`).then(registration => {
    registration.update().catch(() => {});
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          worker.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });
  }).catch(() => {});
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  state.installPrompt = event;
});

window.addEventListener('appinstalled', () => {
  state.installPrompt = null;
  toast('Aplikace je pridana na plochu');
});

const navGroups = [
  { id: 'main', label: 'Prehled', items: [
    ['dashboard', 'Dashboard', 'D', 'dashboard.view'],
  ]},
  { id: 'people', label: 'Firma a lide', items: [
    ['companies', 'Firmy', 'F', 'companies.view'],
    ['employees', 'Dokumenty', 'D', 'employees.view'],
    ['employee_archive', 'Archiv', 'A', 'employees.view'],
    ['objects', 'Objekty', 'O', 'objects.view'],
    ['resources', 'Majetek', 'R', 'resources.view'],
    ['recruitment', 'Nabor', 'N', 'recruitment.view'],
  ]},
  { id: 'work', label: 'Prace a hodiny', items: [
    ['cas', 'Cas', 'C', 'dashboard.view'],
    ['stavba', 'Stavba', 'S', 'stavba.view'],
    ['rohlik', 'Rohlik Brno', 'R', 'rohlik.view'],
  ]},
  { id: 'money', label: 'Mzdy a finance', items: [
    ['salary', 'Mzdy / Vyplaty', 'M', 'salary.view'],
    ['accounting', 'Ucetni', 'U', 'accounting.view'],
    ['finance', 'Naklady / Prijmy', 'N', 'finance.view'],
    ['advances', 'Zalohy', 'Z', 'advances.view'],
    ['cash', 'Hotovost', 'H', 'cash.view'],
    ['monthclose', 'Uzaverka', 'X', 'monthclose.view'],
  ]},
  { id: 'system', label: 'Sprava', items: [
    ['admin_chat', 'Chat', 'C', 'chat.view'],
    ['users', 'Uzivatele', 'U', 'users.view'],
    ['logs', 'Logy', 'L', 'logs.view'],
  ]},
];
const employeeHiddenViews = new Set(['companies', 'employee_archive', 'objects', 'resources', 'recruitment', 'salary', 'payouts', 'finance', 'monthclose', 'cash', 'stavba', 'rohlik', 'rohlik_ostrava', 'warehouse', 'users', 'logs', 'admin_chat']);
const adminOnlyViews = new Set([]);

const months = ['Leden', 'Unor', 'Brezen', 'Duben', 'Kveten', 'Cerven', 'Cervenec', 'Srpen', 'Zari', 'Rijen', 'Listopad', 'Prosinec'];
const monthsUk = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
const monthsRu = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const ua = {
  'Prehled': 'Огляд',
  'Dashboard': 'Панель',
  'Firma a lide': 'Фірма і люди',
  'Firmy': 'Фірми',
  'Dokumenty': 'Документи',
  'Archiv': 'Архів',
  'Objekty': 'Об’єкти',
  'Majetek': 'Майно',
  'Nabor': 'Набір',
  'Prace a hodiny': 'Робота і час',
  'Cas': 'Час',
  'Hodiny': 'Години',
  'Check-iny': 'Чекіни',
  'Smeny': 'Зміни',
  'Stavba': 'Будівництво',
  'Rohlik Brno': 'Rohlik Brno',
  'Mzdy a finance': 'Зарплата і фінанси',
  'Mzdy': 'Зарплати',
  'Ucetni': 'Бухгалтерія',
  'Vyplaty': 'Виплати',
  'Naklady / Prijmy': 'Витрати / Доходи',
  'Finance': 'Фінанси',
  'Zalohy': 'Аванси',
  'Hotovost': 'Готівка',
  'Uzaverka': 'Закриття місяця',
  'Sprava': 'Адміністрування',
  'Admin': 'Адмін',
  'Lide': 'Люди',
  'Osobni slozka pracovnika': 'Особиста папка працівника',
  'Dotaznik JMHZ': 'Анкета JMHZ',
  'Uzivatele': 'Користувачі',
  'Logy': 'Логи',
  'Upozorneni': 'Сповіщення',
  'Heslo': 'Пароль',
  'Odhlasit': 'Вийти',
  'Cestina': 'Чеська',
  'Ukrajinstina': 'Українська',
  'Jazyk': 'Мова',
  'jazyk rozhrani': 'мова інтерфейсу',
  'Smena': 'Зміна',
  'Hlavni': 'Головна сторінка',
  'Penize': 'Гроші',
  'Chat': 'Чат',
  'Profil': 'Профіль',
  'Dobre rano': 'Доброго ранку',
  'Dnesni stavba': 'Сьогоднішнє будівництво',
  'Dnesni objekt': 'Сьогоднішній об’єкт',
  'DNESNI OBJEKT': 'СЬОГОДНІШНІЙ ОБ’ЄКТ',
  'GPS se ulozi pri startu': 'GPS збережеться при старті',
  'GPS se prubezne odesila': 'GPS надсилається автоматично',
  'poloha telefonu': 'геопозиція телефону',
  'obed 30 min auto': 'обід 30 хв автоматично',
  'START': 'СТАРТ',
  'ZACIT': 'ПОЧАТИ',
  'spusti smenu a ulozi GPS': 'запустить зміну і збереже GPS',
  'Zacit praci': 'Почати роботу',
  'Pauza': 'Пауза',
  'Ukoncit praci': 'Закінчити роботу',
  'Podrobne zadani': 'Детальніше',
  'Co jsem dnes delal': 'Що я сьогодні робив',
  'Dalsi obed / prestavka navic': 'Додаткова перерва',
  'Konverzace': 'Розмова',
  'Mistr a kancelar': 'Майстер і офіс',
  'Kontakt a zpravy': 'Контакт і повідомлення',
  'Kontakt': 'Контакт',
  'Kancelar': 'Офіс',
  'Moje skupina': 'Моя група',
  'Kolega': 'Колега',
  'Vyber kolegu z objektu': 'Виберіть колегу з об’єкта',
  'Napis zpravu...': 'Напишіть повідомлення...',
  'Zatim tu nejsou zadne zpravy. Napis prvni zpravu kancelari nebo mistrovi.': 'Тут ще немає повідомлень. Напишіть перше повідомлення офісу або майстру.',
  'schvaleni hodin, vyplaty, dokumenty': 'підтвердження годин, виплати, документи',
  'Moje hodiny': 'Мої години',
  'K VYPLATE': 'ДО ВИПЛАТИ',
  'Odpracovano': 'Відпрацьовано',
  'Sazba': 'Ставка',
  'Hrube': 'Брутто',
  'Zalohy': 'Аванси',
  'Bydleni': 'Житло',
  'Pojisteni': 'Страхування',
  'Bonus pojisteni': 'Бонус страхування',
  'Karta': 'Картка',
  'Hotovost': 'Готівка',
  'Doklady': 'Документи',
  'Nastaveni': 'Налаштування',
  'Pas': 'Паспорт',
  'platny do': 'дійсний до',
  'zadne dokumenty': 'документів немає',
  'Nahrat dokument': 'Завантажити документ',
  'pas, pojisteni, smlouva': 'паспорт, страхування, контракт',
  'nastavit': 'налаштувати',
  'zmenit prihlaseni': 'змінити вхід',
  'neni vyplnen': 'не заповнено',
  'Telefon': 'Телефон',
  'Pracovni profil': 'Робочий профіль',
  'Pracovni udaje': 'Робочі дані',
  'Objekt': 'Об’єкт',
  'Smlouva': 'Контракт',
  'Živnost': 'Підприємець',
  'Mzda': 'Зарплата',
  'Odhlasit se': 'Вийти з профілю',
  'Zavrit': 'Закрити',
  'Zrusit': 'Скасувати',
  'Ulozit': 'Зберегти',
  'Zadat hodiny': 'Додати години',
  'Check-in / out': 'Чекін / вихід',
  'Pridat smenu': 'Додати зміну',
  'Pozadat o volno': 'Запросити вихідний',
  'Plan smen': 'План змін',
  'Zadosti o volno': 'Запити на вихідний',
  'Pracovnik': 'Працівник',
  'Skupina': 'Група',
  'Stav': 'Статус',
  'Akce': 'Дії',
  'Datum': 'Дата',
  'Prichod': 'Прихід',
  'Odchod': 'Вихід',
  'Poznamka': 'Коментар',
  'Schvalit': 'Підтвердити',
  'Odmitnout': 'Відхилити',
  'Smazat': 'Видалити',
  'Upravit': 'Редагувати',
  'aktivni': 'активний',
  'approved': 'підтверджено',
  'pending': 'очікує',
  'rejected': 'відхилено',
};
const ru = {
  'Prehled': 'Обзор',
  'Dashboard': 'Панель',
  'Firma a lide': 'Фирма и люди',
  'Firmy': 'Фирмы',
  'Dokumenty': 'Документы',
  'Archiv': 'Архив',
  'Objekty': 'Объекты',
  'Majetek': 'Имущество',
  'Nabor': 'Набор',
  'Prace a hodiny': 'Работа и часы',
  'Cas': 'Время',
  'Hodiny': 'Часы',
  'Check-iny': 'Чекины',
  'Smeny': 'Смены',
  'Stavba': 'Стройка',
  'Rohlik Brno': 'Rohlik Brno',
  'Mzdy a finance': 'Зарплата и финансы',
  'Mzdy': 'Зарплаты',
  'Ucetni': 'Бухгалтерия',
  'Vyplaty': 'Выплаты',
  'Naklady / Prijmy': 'Расходы / Доходы',
  'Finance': 'Финансы',
  'Zalohy': 'Авансы',
  'Hotovost': 'Наличные',
  'Uzaverka': 'Закрытие месяца',
  'Sprava': 'Управление',
  'Admin': 'Админ',
  'Lide': 'Люди',
  'Osobni slozka pracovnika': 'Личная папка работника',
  'Dotaznik JMHZ': 'Анкета JMHZ',
  'Uzivatele': 'Пользователи',
  'Logy': 'Логи',
  'Upozorneni': 'Уведомления',
  'Heslo': 'Пароль',
  'Odhlasit': 'Выйти',
  'Cestina': 'Чешский',
  'Ukrajinstina': 'Украинский',
  'Russkij': 'Русский',
  'Jazyk': 'Язык',
  'jazyk rozhrani': 'язык интерфейса',
  'Smena': 'Смена',
  'Hlavni': 'Главная страница',
  'Penize': 'Деньги',
  'Chat': 'Чат',
  'Profil': 'Профиль',
  'Dobre rano': 'Доброе утро',
  'Dnesni stavba': 'Сегодняшняя стройка',
  'Dnesni objekt': 'Сегодняшний объект',
  'DNESNI OBJEKT': 'СЕГОДНЯШНИЙ ОБЪЕКТ',
  'GPS se ulozi pri startu': 'GPS сохранится при старте',
  'GPS se prubezne odesila': 'GPS отправляется автоматически',
  'poloha telefonu': 'геопозиция телефона',
  'obed 30 min auto': 'обед 30 мин автоматически',
  'START': 'СТАРТ',
  'ZACIT': 'НАЧАТЬ',
  'spusti smenu a ulozi GPS': 'запустит смену и сохранит GPS',
  'Zacit praci': 'Начать работу',
  'Pauza': 'Пауза',
  'Ukoncit praci': 'Закончить работу',
  'Podrobne zadani': 'Подробное задание',
  'Co jsem dnes delal': 'Что я сегодня делал',
  'Dalsi obed / prestavka navic': 'Дополнительный обед / перерыв',
  'Konverzace': 'Разговор',
  'Mistr a kancelar': 'Мастер и офис',
  'Kontakt a zpravy': 'Контакт и сообщения',
  'Kontakt': 'Контакт',
  'Kancelar': 'Офис',
  'Moje skupina': 'Моя группа',
  'Kolega': 'Коллега',
  'Vyber kolegu z objektu': 'Выберите коллегу с объекта',
  'Napis zpravu...': 'Напишите сообщение...',
  'Zatim tu nejsou zadne zpravy. Napis prvni zpravu kancelari nebo mistrovi.': 'Здесь пока нет сообщений. Напишите первое сообщение офису или мастеру.',
  'schvaleni hodin, vyplaty, dokumenty': 'подтверждение часов, выплаты, документы',
  'Moje hodiny': 'Мои часы',
  'K VYPLATE': 'К ВЫПЛАТЕ',
  'Odpracovano': 'Отработано',
  'Sazba': 'Ставка',
  'Hrube': 'Брутто',
  'Bydleni': 'Жилье',
  'Pojisteni': 'Страховка',
  'Bonus pojisteni': 'Бонус страховки',
  'Karta': 'Карта',
  'Hotovost': 'Наличные',
  'Doklady': 'Документы',
  'Nastaveni': 'Настройки',
  'Pas': 'Паспорт',
  'platny do': 'действителен до',
  'zadne dokumenty': 'документов нет',
  'Nahrat dokument': 'Загрузить документ',
  'pas, pojisteni, smlouva': 'паспорт, страховка, контракт',
  'nastavit': 'настроить',
  'zmenit prihlaseni': 'изменить вход',
  'neni vyplnen': 'не заполнено',
  'Telefon': 'Телефон',
  'Pracovni profil': 'Рабочий профиль',
  'Pracovni udaje': 'Рабочие данные',
  'Objekt': 'Объект',
  'Smlouva': 'Контракт',
  'Živnost': 'Предприниматель',
  'Mzda': 'Зарплата',
  'Odhlasit se': 'Выйти из профиля',
  'Zavrit': 'Закрыть',
  'Zrusit': 'Отмена',
  'Ulozit': 'Сохранить',
  'Zadat hodiny': 'Внести часы',
  'Check-in / out': 'Чек-ин / выход',
  'Pridat smenu': 'Добавить смену',
  'Pozadat o volno': 'Запросить выходной',
  'Plan smen': 'План смен',
  'Zadosti o volno': 'Запросы выходных',
  'Pracovnik': 'Работник',
  'Skupina': 'Группа',
  'Stav': 'Статус',
  'Akce': 'Действия',
  'Datum': 'Дата',
  'Prichod': 'Приход',
  'Odchod': 'Уход',
  'Poznamka': 'Комментарий',
  'Schvalit': 'Подтвердить',
  'Odmitnout': 'Отклонить',
  'Smazat': 'Удалить',
  'Upravit': 'Редактировать',
  'aktivni': 'активный',
  'approved': 'подтверждено',
  'pending': 'ожидает',
  'rejected': 'отклонено',
  'Data z Google tabulky': 'Данные из Google таблицы',
  'synchronizovano pro tento mesic': 'синхронизировано за этот месяц',
  'ceka na sparovani e-mailu': 'ожидает привязки e-mail',
  'AKTUALNI PROJEKT': 'ТЕКУЩИЙ ПРОЕКТ',
  'Rohlik statistika': 'Статистика Rohlik',
  'hodiny, efektivita, produktivita a denni radky': 'часы, эффективность, продуктивность и дневные строки',
  'Bonus hodiny': 'Бонусные часы',
  'Produktivita': 'Продуктивность',
  'Efektivita': 'Эффективность',
  'prumer mesice': 'среднее за месяц',
  'produktivita': 'продуктивность',
  'Posledni radky': 'Последние строки',
  'Pro tento mesic nejsou data podle e-mailu.': 'За этот месяц нет данных по e-mail.',
  'Karta / hotovost': 'Карта / наличные',
  'Vyplatni profil': 'Профиль выплат',
  'Zivnost': 'Предприниматель',
  'pracovni smlouva': 'рабочий договор',
  'potvrzeni hodin, faktury, zalohy': 'подтверждение часов, фактуры, авансы',
  'Zapnout systemova upozorneni': 'Включить системные уведомления',
  'potvrzeno': 'подтверждено',
  'bez data': 'без даты',
};
const dictionaries = { uk: ua, ru };
const navGroupState = JSON.parse(localStorage.getItem('pokladna_nav_groups') || '{}');
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
const jsArg = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const czk = value => new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 }).format(Number(value || 0));
const num = value => new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 }).format(Number(value || 0));
const today = () => new Date().toISOString().slice(0, 10);
const currentMonths = () => state.lang === 'uk' ? monthsUk : state.lang === 'ru' ? monthsRu : months;

function activeDictionary() {
  return dictionaries[state.lang] || {};
}

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u00a0\u200b-\u200d\ufeff]+/g, '');
}

function tr(text) {
  return activeDictionary()[text] || text;
}

function setLanguage(value) {
  state.lang = ['cs', 'uk', 'ru'].includes(value) ? value : 'cs';
  localStorage.setItem('pokladna_lang', state.lang);
  renderLayout();
}

function languageShortLabel(value = state.lang) {
  return ({ uk: 'UA', cs: 'CS', ru: 'RU' })[value] || 'CS';
}

function cycleWorkerLanguage() {
  const order = ['uk', 'cs', 'ru'];
  const current = order.includes(state.lang) ? state.lang : 'cs';
  setLanguage(order[(order.indexOf(current) + 1) % order.length]);
}

function translateTextValue(value) {
  const dict = activeDictionary();
  const keys = Object.keys(dict);
  if (!keys.length) return value;
  const raw = String(value ?? '');
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  if (dict[trimmed]) {
    return raw.replace(trimmed, dict[trimmed]);
  }
  let next = trimmed;
  keys
    .filter(key => key.length > 3 && next.includes(key))
    .sort((a, b) => b.length - a.length)
    .forEach(key => { next = next.split(key).join(dict[key]); });
  return next === trimmed ? raw : raw.replace(trimmed, next);
}

function translateNode(root = document) {
  if (!Object.keys(activeDictionary()).length) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || ['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'OPTION'].includes(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node => { node.nodeValue = translateTextValue(node.nodeValue); });
  root.querySelectorAll('[placeholder], [title], [aria-label]').forEach(el => {
    ['placeholder', 'title', 'aria-label'].forEach(attr => {
      if (el.hasAttribute(attr)) el.setAttribute(attr, translateTextValue(el.getAttribute(attr)));
    });
  });
}

function can(permission) {
  return state.user?.role === 'admin' || !!state.user?.permissions?.[permission];
}

function isAdminUser() {
  return state.user?.role === 'admin';
}

function isGlobalUser() {
  return state.user?.role === 'admin' || !!state.user?.permissions?.['scope.all'];
}

function canManage() {
  return isGlobalUser();
}

function roleLabel(role) {
  const labels = { admin: 'administrator', coordinator: 'koordinator', accountant: 'ucetni', user: 'pracovnik' };
  return labels[role] || role || 'uzivatel';
}

function toast(message, kind = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast-item';
  el.style.borderLeftColor = kind === 'danger' ? 'var(--danger)' : kind === 'warn' ? 'var(--warn)' : 'var(--accent)';
  el.textContent = message;
  toastBox.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const init = {
    credentials: 'same-origin',
    headers: { 'Accept': 'application/json', ...(options.headers || {}) },
    cache: ['GET', 'HEAD'].includes(method) ? 'no-store' : 'default',
    ...options,
  };
  if (init.body && !(init.body instanceof FormData)) {
    init.headers['Content-Type'] = 'application/json';
  }
  if (!['GET', 'HEAD'].includes(method)) {
    init.headers['X-CSRF-Token'] = state.csrf;
  }
  const res = await fetch(`api/${path}`, init);
  const text = await res.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { ok: false, error: text || 'Invalid response' }; }
  if (!res.ok || payload.ok === false) {
    throw new Error(payload.error || `HTTP ${res.status}`);
  }
  if (payload.csrf) state.csrf = payload.csrf;
  return payload;
}

async function init() {
  try {
    const session = await api('auth/me');
    state.user = session.user;
    state.csrf = session.csrf || state.csrf;
  } catch (err) {
    console.error(err);
  }
  if (state.user) {
    await preloadCompanies();
    await preloadEmployeeContext();
    renderLayout();
  } else {
    renderLogin();
  }
}

function renderLogin(error = '') {
  document.title = 'BuildPay - Evidence prace a vyplat';
  app.innerHTML = `
    <main class="login-page">
      <section class="login-visual">
        <div class="brand">BuildPay</div>
        <div class="login-copy">
          <h1>Prace, stavba, Rohlik a vyplaty v jednom systemu.</h1>
          <p>Timer s GPS, chat, dokumenty, zalohy, mzdy a prehled pro administratora i pracovnika.</p>
        </div>
        <div class="muted">Provozni verze pro Webzdarma.cz</div>
      </section>
      <section class="login-box">
        <form class="login-form" id="loginForm">
          <h2>Prihlaseni</h2>
          <p>Zadejte spravcovsky ucet.</p>
          ${error ? `<div class="error">${esc(error)}</div>` : ''}
          <div class="field"><label>E-mail</label><input class="input" name="email" type="text" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" enterkeyhint="next" required></div>
          <div class="field"><label>Heslo</label><input class="input" name="password" type="password" autocomplete="current-password" required></div>
          <button class="btn primary" type="submit" style="width:100%">Prihlasit</button>
        </form>
      </section>
    </main>`;
  translateNode(app);
  document.getElementById('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    data.email = normalizeEmail(data.email);
    try {
      const res = await api('auth/login', { method: 'POST', body: JSON.stringify(data) });
      state.user = res.user;
      state.csrf = res.csrf;
      await preloadCompanies();
      await preloadEmployeeContext();
      renderLayout();
    } catch (err) {
      renderLogin(err.message);
    }
  });
}

async function preloadCompanies() {
  if (!state.user || !can('companies.view')) return;
  try {
    const companies = await api('companies');
    state.cache.companies = companies.data || [];
    if (state.companyId && !state.cache.companies.some(c => String(c.id) === String(state.companyId))) {
      state.companyId = '';
      localStorage.removeItem('pokladna_company');
    }
  } catch (err) {
    console.warn(err);
  }
}

function isRohlikEmployeeRecord(employee = {}) {
  const values = [
    employee.company_name,
    employee.object_name,
    employee.email,
    employee.warehouse_email,
  ].map(value => String(value || '').toLowerCase());
  return values.some(value => value.includes('rohlik'))
    || values.some(value => value.includes('roshpit'))
    || values.some(value => value.includes('@brno1.rohlik.cz'));
}

function isStavbaEmployeeRecord(employee = {}) {
  const values = [
    employee.company_name,
    employee.object_name,
    employee.object_work_type,
  ].map(value => String(value || '').toLowerCase());
  return values.some(value => value.includes('stavba') || value.includes('fasada') || value.includes('fasГЎda'));
}

async function preloadEmployeeContext() {
  state.isRohlikEmployee = false;
  state.isStavbaEmployee = false;
  if (!state.user || isGlobalUser() || !can('employees.view')) return;
  try {
    const employees = await api('employees');
    state.cache.employees = employees.data || [];
    state.isRohlikEmployee = !!state.cache.employees.some(isRohlikEmployeeRecord);
    state.isStavbaEmployee = !!state.cache.employees.some(isStavbaEmployeeRecord);
  } catch (err) {
    console.warn(err);
  }
}

function visibleNavGroups() {
  const rohlikOnlyHidden = new Set(['timesheets', 'checkins']);
  const rohlikWorkerViews = new Set(['smeny']);
  return navGroups.map(group => ({
    ...group,
    items: orderedNavItems(group.id, group.items.filter(([id, , , perm]) => {
      if (!can(perm)) return false;
      if (adminOnlyViews.has(id) && !isAdminUser()) return false;
      if (!isGlobalUser() && rohlikWorkerViews.has(id) && !state.isRohlikEmployee) return false;
      return isGlobalUser() || (!employeeHiddenViews.has(id) && !(state.isRohlikEmployee && rohlikOnlyHidden.has(id)));
    })),
  })).filter(group => group.items.length);
}

function isCompactLayout() {
  return window.matchMedia && window.matchMedia('(max-width: 980px)').matches;
}

const navOrderStorageKey = 'pokladna_nav_order_v1';

function navOrderPrefs() {
  try {
    return JSON.parse(localStorage.getItem(navOrderStorageKey) || '{}') || {};
  } catch {
    return {};
  }
}

function navLayoutKey() {
  return isCompactLayout() ? 'mobile' : 'desktop';
}

function orderedNavItems(groupId, items) {
  const prefs = navOrderPrefs();
  const key = `${navLayoutKey()}:${groupId}`;
  const ids = items.map(item => item[0]);
  const saved = (prefs[key] || []).filter(id => ids.includes(id));
  const order = saved.concat(ids.filter(id => !saved.includes(id)));
  const byId = Object.fromEntries(items.map(item => [item[0], item]));
  return order.map(id => byId[id]).filter(Boolean);
}

function moveNavItem(groupId, id, direction) {
  const group = visibleNavGroups().find(item => item.id === groupId);
  const ids = (group?.items || []).map(item => item[0]);
  const index = ids.indexOf(id);
  const target = index + Number(direction || 0);
  if (index < 0 || target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  const prefs = navOrderPrefs();
  prefs[`${navLayoutKey()}:${groupId}`] = ids;
  localStorage.setItem(navOrderStorageKey, JSON.stringify(prefs));
  renderLayout();
}

function withCompany(path) {
  if (!isGlobalUser() || !state.companyId) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}company_id=${encodeURIComponent(state.companyId)}`;
}

function ownEmployeeField(row = {}) {
  const own = (state.cache.employees || []).find(e => Number(e.id) === Number(state.user?.employee_id)) || {};
  const employeeId = row.employee_id || state.user?.employee_id || '';
  const employeeName = row.employee_name || own.name || state.user?.name || '-';
  return `
    <input type="hidden" name="employee_id" value="${esc(employeeId)}">
    <div class="field"><label>Zamestnanec</label><input class="input" value="${esc(employeeName)}" disabled></div>`;
}

function userDisplayName() {
  return String(state.user?.name || state.user?.email || 'Uzivatel').trim();
}

function userInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  return parts.slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function employeeAvatarPath(row = {}) {
  return String(row.avatar_path || row.employee_avatar_path || '').trim();
}

function employeeAvatar(row = {}, size = 'md') {
  const name = row.name || row.employee_name || row.full_name || row.email || 'U';
  const path = employeeAvatarPath(row);
  const initials = esc(userInitials(name));
  if (path) {
    const normalized = /^(https?:)?\/\//i.test(path) || path.startsWith('/')
      ? path
      : `/${path.replace(/^\/+/, '')}`;
    return `<span class="avatar ${size}" data-fallback="${initials}"><img src="${esc(normalized)}" alt="${esc(name)}" loading="lazy" onerror="this.parentElement.textContent=this.parentElement.dataset.fallback"></span>`;
  }
  return `<span class="avatar ${size}" aria-hidden="true">${initials}</span>`;
}

function employeeNameCell(row = {}, options = {}) {
  const name = row.name || row.employee_name || row.full_name || row.email || '-';
  const meta = options.meta ?? [row.phone, row.email, row.company_name, row.object_name].filter(Boolean).join(' ');
  const extra = options.extra || '';
  return `<div class="person-cell">${employeeAvatar(row, options.size || 'md')}<div class="person-main"><strong>${esc(name)}</strong>${meta ? `<div class="muted">${esc(meta)}</div>` : ''}${extra}</div></div>`;
}

function companyFilterBarHtml() {
  if (!isGlobalUser()) return '';
  const companies = state.cache.companies || [];
  if (!companies.length) return '';
  const pills = [{ id: '', name: 'Vsechny firmy' }, ...companies];
  return `<div class="company-filter-bar" aria-label="Filtr firmy">
    ${pills.map(company => {
      const id = String(company.id || '');
      const active = String(state.companyId || '') === id;
      return `<button type="button" class="${active ? 'active' : ''}" onclick="Pokladna.companyFilter('${jsArg(id)}')">${esc(company.name)}</button>`;
    }).join('')}
  </div>`;
}

function renderLayout() {
  const yearOptions = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i);
  const displayName = userDisplayName();
  const ownEmployee = (state.cache.employees || []).find(e => Number(e.id) === Number(state.user?.employee_id));
  const storedSidebar = localStorage.getItem(sidebarStorageKey);
  const sidebarCollapsed = isCompactLayout() ? storedSidebar !== '0' : storedSidebar === '1';
  const workerShell = !isGlobalUser();
  const adminMobileShell = isGlobalUser() && isCompactLayout();
  document.title = `BuildPay - ${displayName}`;
  app.innerHTML = `
    <div class="layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${workerShell ? 'worker-app-shell' : 'admin-app-shell'} ${adminMobileShell ? 'admin-mobile-shell' : ''}">
      <div class="mobile-menu-backdrop" onclick="Pokladna.sidebar(true)"></div>
      <aside class="sidebar">
        <div class="side-brand">
          ${employeeAvatar(ownEmployee || { name: displayName }, 'nav')}
          <div><div class="side-title">${esc(displayName)}</div><div class="side-sub">BuildPay / ${esc(roleLabel(state.user.role))}</div></div>
        </div>
        <nav class="nav">
          ${visibleNavGroups().map(group => `
            <div class="nav-group">
              <button class="nav-group-title" onclick="Pokladna.toggleNav('${group.id}')"><span>${esc(group.label)}</span><span>${navGroupState[group.id] ? '+' : '-'}</span></button>
              ${navGroupState[group.id] && !isCompactLayout() ? '' : group.items.map(([id, label, glyph]) => `
                <button class="${state.view === id ? 'active' : ''}" onclick="Pokladna.go('${id}')"><span class="glyph">${glyph}</span><span>${tr(label)}</span></button>
              `).join('')}
            </div>
          `).join('')}
        </nav>
      </aside>
      <main class="main">
        <header class="topbar">
          <div class="period">
            <button class="btn sm ghost sidebar-toggle" type="button" onclick="Pokladna.sidebar()" title="${sidebarCollapsed ? 'Zobrazit menu' : 'Skryt menu'}">${sidebarCollapsed ? 'Menu' : 'Zpet'}</button>
            ${isGlobalUser() && (state.cache.companies || []).length ? `
              <label class="top-company"><span>Firma</span><select class="select" style="width:190px" onchange="Pokladna.companyFilter(this.value)">
                <option value="" ${state.companyId ? '' : 'selected'}>Vsechny firmy</option>
                ${(state.cache.companies || []).map(c => `<option value="${c.id}" ${String(state.companyId) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
              </select></label>
            ` : ''}
            <select class="select" style="width:150px" onchange="Pokladna.period('month', this.value)">
              ${currentMonths().map((m, i) => `<option value="${i + 1}" ${state.month === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}
            </select>
            <select class="select" style="width:110px" onchange="Pokladna.period('year', this.value)">
              ${yearOptions.map(y => `<option value="${y}" ${state.year === y ? 'selected' : ''}>${y}</option>`).join('')}
            </select>
          </div>
          <div class="userbar">
            <span>${esc(state.user.name || state.user.email)}</span>
            <select class="select lang-select" onchange="Pokladna.lang(this.value)">
              <option value="cs" ${state.lang === 'cs' ? 'selected' : ''}>Cestina</option>
              <option value="uk" ${state.lang === 'uk' ? 'selected' : ''}>Ukrajinstina</option>
              <option value="ru" ${state.lang === 'ru' ? 'selected' : ''}>Русский</option>
            </select>
            <button class="btn sm ghost notify-btn is-active" onclick="Pokladna.notifications()" title="Upozorneni">Upozorneni${state.notificationCount ? ` <b>${num(state.notificationCount)}</b>` : ' !'}</button>
            <button class="btn sm ghost install-btn" onclick="Pokladna.install()" title="Pridat na plochu">Ikona</button>
            <button class="btn sm ghost" onclick="Pokladna.password()">${tr('Heslo')}</button>
            <button class="btn sm ghost" onclick="Pokladna.logout()">${tr('Odhlasit')}</button>
          </div>
        </header>
        ${companyFilterBarHtml()}
        <section class="content" id="content"></section>
      </main>
    </div>`;
  translateNode(app);
  renderPage();
}

function head(title, sub, action = '') {
  return `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div><div class="actions">${action}</div></div>`;
}

function setContent(html) {
  const content = document.getElementById('content');
  content.innerHTML = isGlobalUser() && isCompactLayout() ? adminMobileShellHtml(html) : html;
  translateNode(content);
  if (document.querySelector('.worker-app-shell .buildcrew-app')) {
    activateWorkerTab(state.workerTab || 'shift');
  }
}

function syncNavActive() {
  document.querySelectorAll('.nav button').forEach(button => {
    const action = button.getAttribute('onclick') || '';
    button.classList.toggle('active', action === `Pokladna.go('${state.view}')`);
  });
}

function loading(title = 'Nacitani') {
  window.clearTimeout(state.loadingClockTimer);
  const liveTitle = String(title || '').toLowerCase() === 'dashboard' ? 'BuildPay' : title;
  const content = document.getElementById('content');
  const hasCurrentScreen = !!(content && content.children.length && !content.querySelector('.loading-live'));
  if (hasCurrentScreen) {
    const existing = document.getElementById('quickLoadingBar');
    if (existing) {
      existing.querySelector('strong').textContent = String(liveTitle || 'Aktualizuji');
      return;
    }
    content.insertAdjacentHTML('afterbegin', `
      <div class="quick-loading-bar" id="quickLoadingBar" aria-live="polite">
        <span class="buildcrew-dot"></span>
        <strong>${esc(liveTitle)}</strong>
        <small>Aktualizuji data...</small>
      </div>`);
    return;
  }
  setContent(`
    <section class="loading-live fast-loading" aria-live="polite">
      <div class="loading-live-card">
        <div class="loading-live-top">
          <span class="buildcrew-dot"></span>
          <strong>${esc(liveTitle)}</strong>
        </div>
        <div class="loading-live-fastline"></div>
        <div class="loading-live-date">Aktualizuji data...</div>
      </div>
    </section>`);
}

const menuDescriptions = {
  dashboard: 'Schvalovani, cekajici hodiny, dokumenty, zalohy a rychly prehled.',
  companies: 'Firmy, ICO, kontakty a prirazene objekty.',
  employees: 'Aktivni pracovnici, profily, dokumenty, avatar a dotaznik JMHZ.',
  employee_archive: 'Archivni pracovnici, obnova nebo trvale smazani.',
  objects: 'Objekty prace a vazba na firmy.',
  resources: 'SIM, auta, bydleni, nastroje a report koordinatora.',
  recruitment: 'Nabor, reakce, komentare a vysledek prace s kandidatem.',
  cas: 'Hodiny, check-iny a smeny v jednom pracovnim rozhrani s taby.',
  timesheets: 'Rucni hodiny, schvalovani a opravy smen.',
  checkins: 'GPS prichody a odchody, mapa a schvalovani polohy.',
  stavba: 'Stavba: check-in, rucni hodiny a celkovy vypocet.',
  rohlik: 'Rohlik Brno: Google hodiny, sazby, bonusy a ucetni souhrn.',
  rohlik_ostrava: 'Rohlik Ostrava: samostatny blok pro budouci tabulku a vypocty.',
  smeny: 'Rohlik Brno: plan smen a zadosti o volno nebo dovolenou.',
  salary: 'Finalni mzdy: hodiny, sazba, zalohy, bydleni, bonusy a netto.',
  payouts: 'Vyplatni listina, karta, hotovost, zustatek a tisk.',
  advances: 'Zadosti o zalohy a potvrzeni vydani.',
  cash: 'Hotovost, prijmy, vydaje a operace v kase.',
  monthclose: 'Uzaverka mesice a snapshot vypoctu.',
  accounting: 'Ucetni tabulka: ucet, karta, hotovost, smlouva, socialka a zdravotka.',
  users: 'Uzivatele, role a napojeni na pracovnika.',
  admin_chat: 'Centralni chat: vsechny konverzace pracovniku, objektu a kategorii.',
  logs: 'Audit akci v systemu.',
};

function renderAdminMenu() {
  if (!isAdminUser()) {
    state.view = 'dashboard';
    renderPage();
    return;
  }
  const groups = navGroups.map(group => ({
    ...group,
    items: orderedNavItems(group.id, group.items.filter(([id, , , perm]) => id !== 'menu' && can(perm))),
  })).filter(group => group.items.length);
  const sections = groups.map(group => `
    <section class="menu-section">
      <div class="menu-section-head">
        <span class="section-caret">${esc(group.items.length)}</span>
        <div><strong>${esc(group.label)}</strong><small>${esc(group.items.length)} polozek</small></div>
      </div>
      <div class="menu-card-grid">
        ${group.items.map(([id, label, glyph]) => `
          <button class="menu-card ${state.view === id ? 'active' : ''}" type="button" onclick="Pokladna.go('${id}')">
            <span class="menu-glyph">${esc(glyph)}</span>
            <span><strong>${esc(label)}</strong><small>${esc(menuDescriptions[id] || '')}</small></span>
          </button>
          <div class="actions menu-card-tools">
            <button class="btn sm ghost" type="button" onclick="Pokladna.moveNav('${group.id}', '${id}', -1)">Nahoru</button>
            <button class="btn sm ghost" type="button" onclick="Pokladna.moveNav('${group.id}', '${id}', 1)">Dolu</button>
          </div>
        `).join('')}
      </div>
    </section>`).join('');
  setContent(`${head('Admin', 'Profil, filtry a vsechny spravcovske sekce')}
    ${adminProfilePanelHtml()}
    <div class="menu-page">${sections}</div>`);
}

function exportUrl(type) {
  return `api/${withCompany(`exports?type=${type}&month=${state.month}&year=${state.year}`)}`;
}

function downloadExport(type) {
  window.location.href = exportUrl(type);
}

function exportButton(type) {
  return can('exports.view') ? `<button class="btn" onclick="Pokladna.exportCsv('${type}')">Export CSV</button>` : '';
}

const sectionPrefsKey = 'pokladna_section_prefs_v1';

function sectionPrefs() {
  try {
    return JSON.parse(localStorage.getItem(sectionPrefsKey) || '{}') || {};
  } catch {
    return {};
  }
}

function saveSectionPrefs(prefs) {
  localStorage.setItem(sectionPrefsKey, JSON.stringify(prefs));
}

function sectionPageKey(page = state.view) {
  return page || 'dashboard';
}

function sectionCollapsed(id, page = state.view) {
  const prefs = sectionPrefs();
  return !!prefs.collapsed?.[`${sectionPageKey(page)}:${id}`];
}

function orderedSections(page, sections) {
  const prefs = sectionPrefs();
  const ids = sections.map(section => section.id);
  const saved = (prefs.order?.[sectionPageKey(page)] || []).filter(id => ids.includes(id));
  const order = saved.concat(ids.filter(id => !saved.includes(id)));
  const byId = Object.fromEntries(sections.map(section => [section.id, section]));
  return order.map(id => sectionBlock(page, byId[id])).join('');
}

function sectionBlock(page, section) {
  const collapsed = sectionCollapsed(section.id, page);
  const label = collapsed ? 'Rozbalit' : 'Sbalit';
  return `<section class="section-block ${collapsed ? 'collapsed' : ''}" data-section-id="${esc(section.id)}">
    <div class="section-bar">
      <button class="section-main" type="button" onclick="Pokladna.toggleSection('${jsArg(section.id)}')">
        <span class="section-caret">${collapsed ? '+' : '-'}</span>
        <span><strong>${esc(section.title)}</strong>${section.note ? `<small>${esc(section.note)}</small>` : ''}</span>
      </button>
      <div class="section-tools">
        <button class="btn sm ghost" type="button" title="${label}" onclick="Pokladna.toggleSection('${jsArg(section.id)}')">${label}</button>
        <button class="btn sm ghost" type="button" title="Nahoru" onclick="Pokladna.moveSection('${jsArg(section.id)}', -1)">&uarr;</button>
        <button class="btn sm ghost" type="button" title="Dolu" onclick="Pokladna.moveSection('${jsArg(section.id)}', 1)">&darr;</button>
      </div>
    </div>
    <div class="section-body">${section.body}</div>
  </section>`;
}

function toggleSection(id) {
  const prefs = sectionPrefs();
  prefs.collapsed = prefs.collapsed || {};
  const key = `${sectionPageKey()}:${id}`;
  prefs.collapsed[key] = !prefs.collapsed[key];
  saveSectionPrefs(prefs);
  renderPage();
}

function moveSection(id, direction) {
  const page = sectionPageKey();
  const current = Array.from(document.querySelectorAll('[data-section-id]')).map(el => el.dataset.sectionId);
  const index = current.indexOf(id);
  const target = index + Number(direction || 0);
  if (index < 0 || target < 0 || target >= current.length) return;
  const next = current.slice();
  [next[index], next[target]] = [next[target], next[index]];
  const prefs = sectionPrefs();
  prefs.order = prefs.order || {};
  prefs.order[page] = next;
  saveSectionPrefs(prefs);
  renderPage();
}

function modal(title, body, onSave, saveText = 'Ulozit') {
  const hasSave = typeof onSave === 'function';
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><h2>${title}</h2><button class="btn sm ghost" type="button" data-close>Zavrit</button></div>
      <form>
        <div class="modal-body">${body}</div>
        <div class="modal-foot">${hasSave ? `<button class="btn ghost" type="button" data-close>Zrusit</button><button class="btn primary" type="submit">${saveText}</button>` : '<button class="btn primary" type="button" data-close>Zavrit</button>'}</div>
      </form>
    </div>`;
  document.body.appendChild(wrap);
  translateNode(wrap);
  wrap.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => wrap.remove()));
  if (!hasSave) return;
  wrap.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await onSave(data, event.currentTarget);
      wrap.remove();
      await renderPage();
      toast('Ulozeno');
    } catch (err) {
      const old = wrap.querySelector('.error');
      if (old) old.remove();
      wrap.querySelector('.modal-body').insertAdjacentHTML('afterbegin', `<div class="error">${esc(err.message)}</div>`);
    }
  });
}

function optionList(rows, selected = null, empty = 'Nevybrano') {
  return `<option value="">${empty}</option>${rows.map(r => `<option value="${r.id}" ${Number(selected) === Number(r.id) ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}`;
}

function objectOptionList(rows, selected = null, companyId = '', empty = 'Nevybrano', keepSelected = true) {
  const selectedId = Number(selected || 0);
  const selectedCompanyId = Number(companyId || 0);
  const companies = state.cache.companies || [];
  const filtered = (rows || []).filter(row => {
    if (!selectedCompanyId) return true;
    return Number(row.company_id || 0) === selectedCompanyId || (keepSelected && selectedId && Number(row.id) === selectedId);
  });
  return `<option value="">${empty}</option>${filtered.map(row => {
    const company = companies.find(c => Number(c.id) === Number(row.company_id));
    const suffix = selectedCompanyId ? '' : (company?.name ? ` / ${company.name}` : ' / bez firmy');
    return `<option value="${row.id}" ${Number(selected) === Number(row.id) ? 'selected' : ''}>${esc(row.name)}${esc(suffix)}</option>`;
  }).join('')}`;
}

function idSet(value) {
  return new Set(String(value || '').split(',').map(item => Number(item.trim())).filter(Boolean));
}

function employeeMultiSelect(rows, selectedValue = '') {
  const selected = idSet(selectedValue);
  return `<select class="select" name="occupant_ids" multiple size="7">
    ${(rows || []).map(row => `<option value="${row.id}" ${selected.has(Number(row.id)) ? 'selected' : ''}>${esc(row.name)}${row.company_name ? ` / ${esc(row.company_name)}` : ''}</option>`).join('')}
  </select>`;
}

function syncObjectSelect(form) {
  const companyId = form?.querySelector('[name="company_id"]')?.value || '';
  const objectSelect = form?.querySelector('[name="object_id"]');
  if (!objectSelect) return;
  const current = objectSelect.value;
  objectSelect.innerHTML = objectOptionList(state.cache.objects || [], current, companyId, 'Nevybrano', false);
  if (current && !Array.from(objectSelect.options).some(option => option.value === current && option.selected)) {
    objectSelect.value = '';
  }
}

function jsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function jmhzField(data, key, label, attrs = '') {
  return `<div class="field"><label>${label}</label><input class="input" name="${key}" value="${esc(data[key] || '')}" ${attrs}></div>`;
}

const jmhzProfileFields = [
  ['jmhz_first_names', 'Jmeno / jmena'],
  ['jmhz_last_name', 'Prijmeni'],
  ['jmhz_titles', 'Tituly'],
  ['jmhz_birth_surname', 'Rodne prijmeni'],
  ['jmhz_previous_surnames', 'Drivejsi prijmeni'],
  ['jmhz_gender', 'Pohlavi'],
  ['jmhz_birth_place', 'Misto narozeni'],
  ['jmhz_birth_country', 'Stat narozeni'],
  ['jmhz_citizenship', 'Statni obcanstvi'],
  ['jmhz_education_level', 'Vzdelani'],
  ['jmhz_id_document_type', 'Typ dokladu'],
  ['jmhz_id_document_number', 'Cislo dokladu'],
  ['jmhz_permanent_street', 'Trvaly pobyt - ulice'],
  ['jmhz_permanent_house_number', 'Trvaly pobyt - cislo popisne'],
  ['jmhz_permanent_orientation_number', 'Trvaly pobyt - cislo orientacni'],
  ['jmhz_permanent_zip', 'Trvaly pobyt - PSC'],
  ['jmhz_permanent_city', 'Trvaly pobyt - obec'],
  ['jmhz_permanent_country', 'Trvaly pobyt - stat'],
  ['jmhz_permanent_ruian', 'Trvaly pobyt - RUIAN'],
  ['jmhz_contact_street', 'Kontaktni adresa - ulice'],
  ['jmhz_contact_house_number', 'Kontaktni adresa - cislo popisne'],
  ['jmhz_contact_orientation_number', 'Kontaktni adresa - cislo orientacni'],
  ['jmhz_contact_zip', 'Kontaktni adresa - PSC'],
  ['jmhz_contact_city', 'Kontaktni adresa - obec'],
  ['jmhz_contact_country', 'Kontaktni adresa - stat'],
  ['jmhz_contact_ruian', 'Kontaktni adresa - RUIAN'],
  ['jmhz_data_box', 'Datova schranka'],
  ['jmhz_electronic_communication', 'Elektronicka komunikace'],
  ['jmhz_health_insurance_company', 'Zdravotni pojistovna'],
  ['jmhz_tax_residence', 'Danova rezidence'],
  ['jmhz_tax_declaration', 'Prohlaseni poplatnika'],
  ['jmhz_disability_pension', 'Invalidni duchod'],
  ['jmhz_student', 'Student'],
  ['jmhz_pension', 'Starobni duchod'],
  ['jmhz_children_count', 'Pocet deti'],
  ['jmhz_cz_isco', 'CZ-ISCO / druh prace'],
  ['jmhz_weekly_hours', 'Tydenni uvazek'],
  ['jmhz_foreigner_status', 'Cizinec - pobyt/viza'],
  ['jmhz_work_permit_number', 'Pracovni povoleni'],
  ['jmhz_work_permit_valid_until', 'Pracovni povoleni do'],
  ['jmhz_residence_permit_number', 'Povoleni k pobytu'],
  ['jmhz_residence_permit_valid_until', 'Povoleni k pobytu do'],
  ['jmhz_notes', 'JMHZ poznamka'],
];

function profileCell(label, value) {
  const display = value === 0 ? '0' : (value || '-');
  return `<div><span>${esc(label)}</span><strong>${esc(display)}</strong></div>`;
}

function profileCellHtml(label, html) {
  return `<div><span>${esc(label)}</span><strong>${html || '-'}</strong></div>`;
}

function documentStatusBadge(status = 'approved') {
  const value = status || 'approved';
  const cls = value === 'pending' ? 'warn' : value === 'rejected' ? 'danger' : 'accent';
  return `<span class="badge ${cls}">${esc(value)}</span>`;
}

function documentDownloadLink(doc) {
  return `<a class="link" href="api/documents/${doc.id}/download" target="_blank" rel="noopener">${esc(doc.original_name || doc.title || 'soubor')}</a>`;
}

function documentTypeLabel(type = 'other') {
  const labels = {
    passport: 'Pas',
    visa: 'Viza',
    residence: 'Pobyt',
    work_permit: 'Pracovni povoleni',
    insurance: 'Pojisteni',
    contract: 'Smlouva',
    photo: 'Foto',
    phone: 'Telefon',
    other: 'Ostatni',
  };
  return labels[type] || type || 'Ostatni';
}

function documentTypeOptions(selected = '') {
  const types = ['passport', 'visa', 'residence', 'work_permit', 'insurance', 'contract', 'photo', 'phone', 'other'];
  return types.map(type => `<option value="${type}" ${selected === type ? 'selected' : ''}>${esc(documentTypeLabel(type))}</option>`).join('');
}

function documentPreviewCard(doc = {}) {
  const isImage = String(doc.mime_type || '').startsWith('image/');
  const fileUrl = `api/documents/${doc.id}/download`;
  const preview = isImage
    ? `<img src="${fileUrl}" alt="${esc(doc.title || doc.original_name || 'document')}" loading="lazy">`
    : `<span>${buildcrewNavIcon('file')}</span>`;
  return `<article class="document-thumb">
    <a class="document-thumb-preview" href="${fileUrl}" target="_blank" rel="noopener">${preview}</a>
    <div>
      <strong>${esc(doc.title || doc.original_name || '-')}</strong>
      <small>${esc(documentTypeLabel(doc.document_type))} / ${esc(doc.expires_at || 'bez data')}</small>
      <div class="document-thumb-actions">${documentStatusBadge(doc.status)} ${documentDownloadLink(doc)}</div>
    </div>
  </article>`;
}

function collectNamedInputs(root) {
  const data = {};
  root?.querySelectorAll?.('input[name], select[name], textarea[name]').forEach(input => {
    if (input.type === 'file') return;
    if ((input.type === 'checkbox' || input.type === 'radio') && !input.checked) return;
    data[input.name] = input.value;
  });
  return data;
}

function jmhzEditorHtml(data = {}, employeeId = '') {
  return `<div class="jmhz-editor" id="jmhzEditor-${esc(employeeId)}">
    <div class="form-grid">
      ${jmhzField(data, 'jmhz_first_names', 'Jmeno / jmena')}
      ${jmhzField(data, 'jmhz_last_name', 'Prijmeni')}
      ${jmhzField(data, 'jmhz_titles', 'Tituly')}
      ${jmhzField(data, 'jmhz_birth_surname', 'Rodne prijmeni')}
      ${jmhzField(data, 'jmhz_previous_surnames', 'Drivejsi prijmeni')}
      <div class="field"><label>Pohlavi</label><select class="select" name="jmhz_gender"><option value="">Nevybrano</option><option value="M" ${data.jmhz_gender === 'M' ? 'selected' : ''}>muz</option><option value="F" ${data.jmhz_gender === 'F' ? 'selected' : ''}>zena</option></select></div>
      ${jmhzField(data, 'jmhz_birth_place', 'Misto narozeni')}
      ${jmhzField(data, 'jmhz_birth_country', 'Stat narozeni')}
      ${jmhzField(data, 'jmhz_citizenship', 'Statni obcanstvi')}
      ${jmhzField(data, 'jmhz_education_level', 'Nejvyssi dosazene vzdelani')}
      ${jmhzField(data, 'jmhz_id_document_type', 'Typ dokladu totoznosti')}
      ${jmhzField(data, 'jmhz_id_document_number', 'Cislo dokladu totoznosti')}
    </div>
    <div class="section-title">Trvaly pobyt</div>
    <div class="form-grid">
      ${jmhzField(data, 'jmhz_permanent_street', 'Ulice')}
      ${jmhzField(data, 'jmhz_permanent_house_number', 'Cislo popisne')}
      ${jmhzField(data, 'jmhz_permanent_orientation_number', 'Cislo orientacni')}
      ${jmhzField(data, 'jmhz_permanent_zip', 'PSC')}
      ${jmhzField(data, 'jmhz_permanent_city', 'Obec')}
      ${jmhzField(data, 'jmhz_permanent_country', 'Stat')}
      ${jmhzField(data, 'jmhz_permanent_ruian', 'Kod adresniho mista / RUIAN')}
    </div>
    <div class="section-title">Kontaktni adresa</div>
    <div class="form-grid">
      ${jmhzField(data, 'jmhz_contact_street', 'Ulice')}
      ${jmhzField(data, 'jmhz_contact_house_number', 'Cislo popisne')}
      ${jmhzField(data, 'jmhz_contact_orientation_number', 'Cislo orientacni')}
      ${jmhzField(data, 'jmhz_contact_zip', 'PSC')}
      ${jmhzField(data, 'jmhz_contact_city', 'Obec')}
      ${jmhzField(data, 'jmhz_contact_country', 'Stat')}
      ${jmhzField(data, 'jmhz_contact_ruian', 'Kod adresniho mista / RUIAN')}
    </div>
    <div class="section-title">Urad, pojisteni a pracovni registrace</div>
    <div class="form-grid">
      ${jmhzField(data, 'jmhz_data_box', 'Datova schranka')}
      ${jmhzField(data, 'jmhz_electronic_communication', 'Elektronicka komunikace')}
      ${jmhzField(data, 'jmhz_ecommunication_password', 'Heslo pro elektronickou komunikaci')}
      ${jmhzField(data, 'jmhz_health_insurance_company', 'Zdravotni pojistovna')}
      ${jmhzField(data, 'jmhz_tax_residence', 'Danova rezidence')}
      <div class="field"><label>Prohlaseni poplatnika</label><select class="select" name="jmhz_tax_declaration"><option value="">Nevybrano</option><option value="ano" ${data.jmhz_tax_declaration === 'ano' ? 'selected' : ''}>ano</option><option value="ne" ${data.jmhz_tax_declaration === 'ne' ? 'selected' : ''}>ne</option></select></div>
      ${jmhzField(data, 'jmhz_disability_pension', 'Invalidni duchod / stupen')}
      ${jmhzField(data, 'jmhz_student', 'Student')}
      ${jmhzField(data, 'jmhz_pension', 'Starobni duchod')}
      ${jmhzField(data, 'jmhz_children_count', 'Pocet deti', 'type="number" min="0"')}
      ${jmhzField(data, 'jmhz_cz_isco', 'CZ-ISCO / druh prace')}
      ${jmhzField(data, 'jmhz_weekly_hours', 'Tydenni uvazek hodin', 'type="number" step="0.01"')}
      ${jmhzField(data, 'jmhz_foreigner_status', 'Cizinec - typ pobytu/viza')}
      ${jmhzField(data, 'jmhz_work_permit_number', 'Cislo pracovniho povoleni')}
      ${jmhzField(data, 'jmhz_work_permit_valid_until', 'Pracovni povoleni platne do', 'type="date"')}
      ${jmhzField(data, 'jmhz_residence_permit_number', 'Cislo povoleni k pobytu')}
      ${jmhzField(data, 'jmhz_residence_permit_valid_until', 'Povoleni k pobytu platne do', 'type="date"')}
    </div>
    <div class="field"><label>JMHZ - poznamka</label><textarea name="jmhz_notes">${esc(data.jmhz_notes || '')}</textarea></div>
  </div>`;
}

function jmhzExportText(employee = {}, data = {}) {
  const core = [
    ['Pracovnik', employee.name],
    ['Telefon', employee.phone],
    ['E-mail', employee.email],
    ['Firma', employee.company_name],
    ['Objekt', employee.object_name],
    ['Kontrakt', employee.contract_type],
    ['Pas', employee.passport_number],
    ['Pas platny do', employee.passport_valid_until],
    ['Adresa', employee.address],
    ['Adresa bydleni', employee.residence_address],
  ];
  const jmhz = jmhzProfileFields.map(([key, label]) => [label, data[key]]);
  return [...core, ...jmhz]
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}

const contactStatusLabels = {
  pending: 'ceka',
  contacted: 'kontaktovan',
  no_answer: 'nezvedl',
  wrong_number: 'spatne cislo',
};
const workResultLabels = {
  undecided: 'nerozhodnuto',
  will_work: 'jde do prace',
  wont_work: 'nejde',
  waiting_documents: 'ceka na doklady',
  arrived: 'prijel',
};
const recruitmentReactionLabels = {
  note: 'poznamka',
  called: 'volali',
  message: 'zprava',
  no_answer: 'nezvedl',
  interview: 'pohovor',
  documents: 'doklady',
  hired: 'jde do prace',
  rejected: 'nejde',
  arrived: 'prijel',
};

function candidateBadge(value, labels) {
  const cls = ['contacted', 'will_work', 'arrived'].includes(value) ? 'accent'
    : ['no_answer', 'waiting_documents', 'pending', 'undecided'].includes(value) ? 'warn'
      : 'danger';
  return `<span class="badge ${cls}">${esc(labels[value] || value || '-')}</span>`;
}

function rohlikPositionLabel(value) {
  const raw = String(value || '').trim();
  if (raw.includes(',')) {
    return raw.split(',').map(part => rohlikPositionLabel(part)).join(', ');
  }
  const map = {
    exp: 'kompletace',
    kompletace: 'kompletace',
    inb: 'inbound',
    pre: 'pre',
  };
  return map[raw.toLowerCase()] || raw || '-';
}

function rohlikContractLabel(value) {
  const rawValue = String(value || '').trim();
  const raw = rawValue.toUpperCase();
  if (!raw) return '-';
  const normalized = rawValue.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[\s._/-]/g, '');
  if (normalized.includes('ZIVNOST') || normalized.includes('ZIVNOSTNIK') || normalized.includes('ZL') || normalized.includes('ICO')) return 'Zivnost';
  return raw;
}

function rohlikContractBadge(value) {
  const label = rohlikContractLabel(value);
  const cls = label === 'HPP' ? 'accent' : label === 'DPP' ? 'warn' : label === 'Zivnost' ? 'blue' : '';
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

function contractKind(row = {}) {
  return rohlikContractLabel(row.contract_kind || row.contract_type || '');
}

function contractBadge(row = {}) {
  return rohlikContractBadge(contractKind(row));
}

function rohlikBalanceInfo(row) {
  const net = Number(row.net_amount || 0);
  const remains = Number(row.remains_amount ?? (net - Number(row.card_amount || 0) - Number(row.cash_amount || 0)));
  if (remains > 0) {
    return { label: 'Doplatit', cls: 'warn', amount: remains, detail: 'firma dluzi' };
  }
  if (remains < 0) {
    return { label: net < 0 ? 'V minusu' : 'Preplaceno', cls: 'danger', amount: Math.abs(remains), detail: net < 0 ? 'pracovnik dluzi' : 'preplaceno' };
  }
  return { label: 'Vyrovnano', cls: 'accent', amount: 0, detail: '0' };
}

function rohlikBalanceCell(row) {
  const info = rohlikBalanceInfo(row);
  return `<span class="badge ${info.cls}">${esc(info.label)}</span><div class="muted">${info.amount ? czk(info.amount) : info.detail}</div>`;
}

function rateSourceBadge(source) {
  const map = {
    employee_card: ['Karta pracovnika', 'accent'],
    rohlik_manual: ['Rohlik rucne', 'warn'],
    stavba_manual: ['Stavba rucne', 'warn'],
    missing: ['chybi sazba', 'danger'],
  };
  const [label, cls] = map[source] || [source || '-', ''];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

const rohlikColumnStorageKey = 'pokladna_rohlik_columns_v2';
const rohlikDefaultColumns = new Set(['worker', 'contract', 'worked', 'bonus_hours', 'payable_hours', 'rate', 'client_rate', 'profit', 'employer_health', 'gross', 'advance', 'net', 'cash', 'balance']);

const rohlikClientRates = [
  { key: 'novy', label: 'novy', rate: 215 },
  { key: 'DV_plus', label: 'DV_plus', rate: 275 },
  { key: 'DV', label: 'DV', rate: 265 },
  { key: 'KV_plus', label: 'KV_plus', rate: 255 },
  { key: 'KV', label: 'KV', rate: 245 },
];

function rohlikRateLabelTokens(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\+/g, '_plus')
    .split(/[^a-z0-9_]+/)
    .filter(Boolean);
}

function rohlikClientRateInfo(row = {}) {
  const tokens = rohlikRateLabelTokens(row.rate_label || row.position || '');
  for (const rate of rohlikClientRates) {
    if (tokens.includes(rate.key.toLowerCase())) {
      return rate;
    }
  }
  return { key: 'unknown', label: row.rate_label || '-', rate: null };
}

function rohlikProfitInfo(row = {}) {
  const client = rohlikClientRateInfo(row);
  const workerRate = Number(row.hourly_rate || 0);
  const hours = Number(row.payable_hours ?? (Number(row.worked_hours || 0) + Number(row.extra_hours || 0)) ?? 0);
  if (!Number.isFinite(client.rate)) {
    return { client, workerRate, hours, diff: null, grossProfit: null, healthExpense: 0, profit: null };
  }
  const diff = Number(client.rate || 0) - workerRate;
  const grossProfit = diff * hours;
  const healthExpense = Number(row.employer_health_expense || 0);
  return { client, workerRate, hours, diff, grossProfit, healthExpense, profit: grossProfit - healthExpense };
}

function rohlikDefaultEmployerHealthAmount(contractType) {
  const label = rohlikContractLabel(contractType);
  if (label === 'HPP') return 11200;
  if (label === 'DPP' || label === 'DPC') return 3000;
  return 0;
}

function rohlikEmployerHealthAmount(row = {}) {
  const value = row.employer_health_amount;
  if (value !== null && value !== undefined && value !== '') return Number(value || 0);
  return rohlikDefaultEmployerHealthAmount(row.contract_type);
}

function rohlikEmployerHealthCell(row = {}) {
  const amount = rohlikEmployerHealthAmount(row);
  const paid = Number(row.employer_health_paid || 0) === 1;
  const cls = paid ? 'danger' : amount > 0 ? 'warn' : 'muted';
  const note = amount <= 0 ? 'bez odvodu' : paid ? 'zaplaceno - jde do profitu' : 'nezaplaceno - mimo profit';
  return `<span class="mono ${cls}">${czk(amount)}</span><div class="muted">${note}</div>`;
}

function updateRohlikHealthDefault(select) {
  const form = select.closest('form');
  const input = form?.querySelector('[name="employer_health_amount"]');
  if (!input) return;
  const next = rohlikDefaultEmployerHealthAmount(select.value);
  const previousDefault = Number(input.dataset.default || 0);
  const current = Number(String(input.value || '0').replace(',', '.')) || 0;
  if (!input.dataset.touched || Math.abs(current - previousDefault) < 0.01) {
    input.value = String(next);
    input.dataset.default = String(next);
    input.dataset.touched = '';
  }
}

function rohlikClientRateCell(row = {}) {
  const info = rohlikProfitInfo(row);
  if (!Number.isFinite(info.client.rate)) {
    return `<span class="badge">${esc(info.client.label)}</span><div class="muted">tarif neni nastaven</div>`;
  }
  return `<span class="mono blue">${czk(info.client.rate)}</span><div class="muted">${esc(info.client.label)} / rozdil ${czk(info.diff)}</div>`;
}

function rohlikProfitCell(row = {}) {
  const info = rohlikProfitInfo(row);
  if (!Number.isFinite(info.profit)) {
    return '<span class="muted">bez vypoctu</span>';
  }
  const cls = info.profit >= 0 ? 'accent' : 'danger';
  const healthNote = info.healthExpense > 0 ? ` - zdravotka ${czk(info.healthExpense)}` : '';
  return `<strong class="mono ${cls}">${czk(info.profit)}</strong><div class="muted">${czk(info.diff)} x ${num(info.hours)} h${healthNote}</div>`;
}

function isRohlikExpense(row = {}) {
  const text = [
    row.company_name,
    row.employee_name,
    row.title,
    row.note,
    row.vehicle_plate,
  ].map(value => String(value || '').toLowerCase()).join(' ');
  return text.includes('rohlik') || text.includes('roshpit');
}

function rohlikCompanyId() {
  const company = (state.cache.companies || []).find(row => {
    const name = String(row.name || '').toLowerCase();
    return name.includes('roshpit') || name.includes('rohlik');
  });
  return company?.id || '';
}

function rohlikExpensesPath(month, year) {
  const path = `resources/coordinator_expenses?month=${month}&year=${year}`;
  const companyId = rohlikCompanyId();
  if (!isGlobalUser() || !companyId) return path;
  return `${path}&company_id=${encodeURIComponent(companyId)}`;
}

function rohlikExpenseLabel(category) {
  const labels = {
    advance: 'Zaloha',
    fuel: 'Palivo',
    tool: 'Nastroje',
    housing: 'Bydleni',
    transport: 'Doprava',
    other: 'Ostatni',
  };
  return labels[category] || category || 'Ostatni';
}

function rohlikColumnState() {
  try {
    return JSON.parse(localStorage.getItem(rohlikColumnStorageKey) || '{}') || {};
  } catch {
    return {};
  }
}

function rohlikVisibleColumns(columns) {
  const saved = rohlikColumnState();
  const hasSaved = Object.keys(saved).length > 0;
  const visible = columns.filter(column => hasSaved ? saved[column.key] !== false : rohlikDefaultColumns.has(column.key));
  return visible.length ? visible : columns.slice(0, 1);
}

function rohlikColumnPicker(columns) {
  return '';
}

function setRohlikColumn(key, visible) {
  const saved = rohlikColumnState();
  saved[key] = !!visible;
  localStorage.setItem(rohlikColumnStorageKey, JSON.stringify(saved));
  renderRohlikBrno();
}

function rohlikDailyStats(dailyRows = []) {
  const byDate = {};
  (dailyRows || []).forEach(row => {
    const date = row.work_date || '';
    if (!date) return;
    if (!byDate[date]) {
      byDate[date] = { work_date: date, worked_hours: 0, billing_hours: 0, productivity: 0, efficiency: 0, count: 0 };
    }
    byDate[date].worked_hours += Number(row.worked_hours || 0);
    byDate[date].billing_hours += Number(row.billing_hours || 0);
    byDate[date].productivity += Number(row.productivity_percent || 0);
    byDate[date].efficiency += Number(row.efficiency_percent || 0);
    byDate[date].count += 1;
  });
  return Object.values(byDate).map(row => ({
    work_date: row.work_date,
    worked_hours: Math.round(row.worked_hours * 100) / 100,
    billing_hours: Math.round(row.billing_hours * 100) / 100,
    productivity_percent: row.count ? Math.round((row.productivity / row.count) * 100) / 100 : 0,
    efficiency_percent: row.count ? Math.round((row.efficiency / row.count) * 100) / 100 : 0,
  })).sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)));
}

function rohlikAverage(rows, key) {
  const values = (rows || []).map(row => Number(row[key] || 0)).filter(value => value > 0);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function rohlikShortDate(value) {
  const parts = String(value || '').split('-');
  return parts.length === 3 ? `${Number(parts[2])}.${Number(parts[1])}.` : String(value || '-');
}

function rohlikChart(title, dailyRows = []) {
  const stats = rohlikDailyStats(dailyRows);
  if (!stats.length) {
    return `<div class="card empty">${esc(title)}: zadna denni data</div>`;
  }
  const width = 640;
  const height = 250;
  const pad = { left: 42, right: 18, top: 28, bottom: 44 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const maxHours = Math.max(1, ...stats.map(row => Number(row.worked_hours || 0)));
  const maxPercent = Math.max(120, ...stats.map(row => Number(row.productivity_percent || 0)), ...stats.map(row => Number(row.efficiency_percent || 0)));
  const x = index => pad.left + (stats.length === 1 ? chartWidth / 2 : (chartWidth / (stats.length - 1)) * index);
  const yPercent = value => pad.top + chartHeight - (Math.min(Number(value || 0), maxPercent) / maxPercent) * chartHeight;
  const yHours = value => pad.top + chartHeight - (Math.min(Number(value || 0), maxHours) / maxHours) * chartHeight;
  const barWidth = Math.max(8, Math.min(28, chartWidth / Math.max(1, stats.length) * 0.48));
  const bars = stats.map((row, index) => {
    const barHeight = pad.top + chartHeight - yHours(row.worked_hours);
    return `<rect class="chart-bar" x="${x(index) - barWidth / 2}" y="${yHours(row.worked_hours)}" width="${barWidth}" height="${barHeight}" rx="4"><title>${esc(rohlikShortDate(row.work_date))}: ${num(row.worked_hours)} h</title></rect>`;
  }).join('');
  const productivityLine = stats.map((row, index) => `${x(index)},${yPercent(row.productivity_percent)}`).join(' ');
  const efficiencyLine = stats.map((row, index) => `${x(index)},${yPercent(row.efficiency_percent)}`).join(' ');
  const productivityDots = stats.map((row, index) => `<circle class="chart-dot productivity" cx="${x(index)}" cy="${yPercent(row.productivity_percent)}" r="3"><title>${esc(rohlikShortDate(row.work_date))}: produktivita ${num(row.productivity_percent)}%</title></circle>`).join('');
  const efficiencyDots = stats.map((row, index) => `<circle class="chart-dot efficiency" cx="${x(index)}" cy="${yPercent(row.efficiency_percent)}" r="3"><title>${esc(rohlikShortDate(row.work_date))}: efektivita ${num(row.efficiency_percent)}%</title></circle>`).join('');
  const labelIndexes = stats.length <= 8 ? stats.map((_, index) => index) : [0, Math.floor((stats.length - 1) / 2), stats.length - 1];
  const labels = labelIndexes.map(index => `<text class="chart-label" x="${x(index)}" y="${height - 16}" text-anchor="middle">${esc(rohlikShortDate(stats[index].work_date))}</text>`).join('');
  const avgProductivity = rohlikAverage(stats, 'productivity_percent');
  const avgEfficiency = rohlikAverage(stats, 'efficiency_percent');
  const totalHours = stats.reduce((sum, row) => sum + Number(row.worked_hours || 0), 0);
  return `<div class="card chart-card">
    <div class="chart-head">
      <div>
        <div class="section-title" style="margin:0">${esc(title)}</div>
        <div class="muted">${num(totalHours)} h / produktivita ${num(avgProductivity)}% / efektivita ${num(avgEfficiency)}%</div>
      </div>
      <div class="chart-legend">
        <span><i class="bar"></i>Hodiny</span>
        <span><i class="productivity"></i>Produktivita</span>
        <span><i class="efficiency"></i>Efektivita</span>
      </div>
    </div>
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
      <line class="chart-grid" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + chartHeight}"></line>
      <line class="chart-grid" x1="${pad.left}" y1="${pad.top + chartHeight}" x2="${width - pad.right}" y2="${pad.top + chartHeight}"></line>
      ${bars}
      <polyline class="chart-line productivity" points="${productivityLine}"></polyline>
      <polyline class="chart-line efficiency" points="${efficiencyLine}"></polyline>
      ${productivityDots}
      ${efficiencyDots}
      ${labels}
    </svg>
  </div>`;
}

function rohlikDailyCards(dailyRows = []) {
  const rows = (dailyRows || []).slice(0, 12);
  if (!rows.length) return '<div class="empty">Zadne denni radky</div>';
  return `<div class="rohlik-day-list">
    ${rows.map(row => {
      const productivity = Number(row.productivity_percent || 0);
      const efficiency = Number(row.efficiency_percent || 0);
      const productivityCls = productivity >= 100 ? 'accent' : productivity >= 90 ? 'warn' : 'danger';
      const efficiencyCls = efficiency >= 100 ? 'accent' : efficiency >= 90 ? 'warn' : 'danger';
      return `<article class="rohlik-day-card">
        <div class="rohlik-day-head">
          <strong>${esc(rohlikShortDate(row.work_date))}</strong>
          <span>${esc(rohlikPositionLabel(row.position || '-'))}</span>
        </div>
        <div class="rohlik-day-grid">
          <div><span>Dochazka</span><b>${num(row.attendance_hours || 0)} h</b></div>
          <div><span>Odprac.</span><b>${num(row.worked_hours || 0)} h</b></div>
          <div><span>Bonus</span><b class="warn">${num(row.extra_hours || 0)}</b></div>
          <div><span>Produkt.</span><b class="${productivityCls}">${num(productivity)}%</b></div>
          <div><span>Efektiv.</span><b class="${efficiencyCls}">${num(efficiency)}%</b></div>
        </div>
      </article>`;
    }).join('')}
  </div>`;
}

function workerShiftCards(checkins = []) {
  const rows = (checkins || []).slice(0, 6);
  if (!rows.length) return '<div class="empty">Zadne smeny</div>';
  return `<div class="worker-shift-list">
    ${rows.map(row => {
      const active = !row.time_out;
      return `<article class="worker-shift-card">
        <div>
          <span>${active ? 'Aktivni smena' : 'Smena'}</span>
          <strong>${esc(row.time_in || '-')}</strong>
          <small>${esc(row.time_out || 'bezi')}</small>
        </div>
        <b class="mono ${active ? 'accent' : ''}">${active ? 'LIVE' : `${num(row.duration_hours || 0)} h`}</b>
        ${row.note ? `<p>${esc(row.note)}</p>` : ''}
      </article>`;
    }).join('')}
  </div>`;
}

function rohlikTopWorkers(rows = []) {
  const topRows = (rows || [])
    .filter(row => Number(row.avg_productivity || 0) > 0 || Number(row.worked_hours || 0) > 0)
    .sort((a, b) => (Number(b.avg_productivity || 0) - Number(a.avg_productivity || 0)) || (Number(b.worked_hours || 0) - Number(a.worked_hours || 0)))
    .slice(0, 5);
  if (!topRows.length) {
    return '<div class="card empty">Zatim neni top 5 pro tento mesic</div>';
  }
  return `<div class="card top-list">
    ${topRows.map((row, index) => `<div class="top-list-row">
      <div class="top-rank">${index + 1}</div>
      <div class="top-person">
        <strong>${esc(row.employee_name || row.email)}</strong>
        <span>${esc(rohlikPositionLabel(row.position))}</span>
      </div>
      <div class="top-metric accent">${num(row.avg_productivity)}%</div>
      <div class="top-sub">
        <span>${num(row.worked_hours)} h</span>
        <span>${num(row.avg_efficiency)}% eff.</span>
      </div>
    </div>`).join('')}
  </div>`;
}

function splitPersonName(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  return {
    first: parts[0] || '',
    last: parts.slice(1).join(' '),
  };
}

function canUploadDocuments(employeeId) {
  return can('documents.write') && (canManage() || Number(employeeId) === Number(state.user?.employee_id));
}

function jmhzProfileGrid(data) {
  const rows = jmhzProfileFields
    .filter(([key]) => data[key] !== undefined && data[key] !== null && String(data[key]).trim() !== '')
    .map(([key, label]) => profileCell(label, data[key]));
  return rows.length ? `<div class="profile-grid profile-grid-2">${rows.join('')}</div>` : '<div class="card empty">Dotaznik zatim neni vyplnen</div>';
}

function dateTimeLocal(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dateTimeInputValue(value) {
  return value ? String(value).replace(' ', 'T').slice(0, 16) : '';
}

function dateTimeLabel(value) {
  if (!value) return '-';
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('cs-CZ');
}

function timeRangeLabel(start, end) {
  if (!start || !end) return '-';
  return `${String(start).slice(11, 16)} - ${String(end).slice(11, 16)}`;
}

let shiftTimer = null;

function shiftTimerLabel(startValue) {
  if (!startValue) return '00:00:00';
  const start = new Date(String(startValue).replace(' ', 'T'));
  if (!Number.isFinite(start.getTime())) return '00:00:00';
  const total = Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000));
  const hours = String(Math.floor(total / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function startShiftTimers() {
  clearInterval(shiftTimer);
  const timers = Array.from(document.querySelectorAll('[data-shift-start]'));
  if (!timers.length) return;
  const tick = () => timers.forEach(el => { el.textContent = shiftTimerLabel(el.dataset.shiftStart); });
  tick();
  shiftTimer = setInterval(tick, 1000);
}

async function requestShiftWakeLock() {
  if (!('wakeLock' in navigator) || state.wakeLock) return;
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
    state.wakeLock.addEventListener?.('release', () => { state.wakeLock = null; });
  } catch (err) {
    console.warn('Wake lock failed', err);
  }
}

async function releaseShiftWakeLock() {
  const lock = state.wakeLock;
  state.wakeLock = null;
  try {
    await lock?.release?.();
  } catch {}
}

function updateShiftMediaSession(activeShift = null, objectName = '') {
  if (!('mediaSession' in navigator) || !activeShift) return;
  const timer = shiftTimerLabel(activeShift.time_in);
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `BuildPay - ${objectName || 'Smena'}`,
      artist: `Timer ${timer}`,
      album: 'Pracovni smena',
      artwork: [
        { src: '/assets/icons/buildpay-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/assets/icons/buildpay-512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
    navigator.mediaSession.playbackState = 'playing';
  } catch (err) {
    console.warn('MediaSession failed', err);
  }
}

function startShiftPresence(activeShift = null, objectName = '') {
  if (!activeShift) {
    stopShiftPresence();
    return;
  }
  requestShiftWakeLock();
  updateShiftMediaSession(activeShift, objectName);
  clearInterval(state.mediaTimer);
  state.mediaTimer = setInterval(() => updateShiftMediaSession(activeShift, objectName), 30000);
}

function stopShiftPresence() {
  clearInterval(state.mediaTimer);
  state.mediaTimer = null;
  releaseShiftWakeLock();
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.metadata = null;
    } catch {}
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && document.querySelector('[data-shift-start]')) {
    requestShiftWakeLock();
  }
});

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function enableNotifications() {
  if (!('Notification' in window)) {
    toast('Upozorneni nejsou v tomto prohlizeci dostupna', 'warn');
    return;
  }
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  state.notificationsEnabled = Notification.permission === 'granted';
  if (state.notificationsEnabled && 'serviceWorker' in navigator && 'PushManager' in window) {
    try {
      const config = await api('push');
      if (config.public_key) {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        const subscription = existing || await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.public_key),
        });
        await api('push', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }) });
        api('push/test', { method: 'POST', body: '{}' }).catch(() => {});
        toast('Systemova push upozorneni jsou zapnuta');
        return;
      }
      toast('Upozorneni jsou zapnuta v prohlizeci. Serverovy push klic zatim neni nastaven.', 'warn');
    } catch (err) {
      console.warn(err);
      toast('Upozorneni jsou zapnuta, ale push registrace se nepodarila.', 'warn');
      return;
    }
  }
  toast(state.notificationsEnabled ? 'Upozorneni jsou zapnuta' : 'Upozorneni nejsou povolena', state.notificationsEnabled ? 'ok' : 'warn');
}

function notificationStatusBadge(status) {
  const value = status || 'info';
  const cls = value === 'approved' ? 'accent' : value === 'rejected' ? 'danger' : value === 'pending' ? 'warn' : 'blue';
  return `<span class="badge ${cls}">${esc(value)}</span>`;
}

function notificationItem(type, title, detail, status = 'info', action = '') {
  return `<div class="notification-item">
    <span class="notification-icon">${buildcrewNavIcon(type)}</span>
    <div><strong>${esc(title)}</strong><small>${esc(detail || '')}</small></div>
    <div class="notification-side">${notificationStatusBadge(status)}${action}</div>
  </div>`;
}

async function notificationItems() {
  const items = [];
  if (isGlobalUser()) {
    const payload = await api(withCompany(`dashboard?month=${state.month}&year=${state.year}`));
    const queue = payload.data?.queue || {};
    (queue.timesheets || []).forEach(row => items.push(notificationItem('hours', 'Hodiny cekaji', `${row.employee_name || '-'} / ${row.work_date || '-'} / ${num(row.hours || 0)} h`, 'pending', `<button class="btn sm primary" onclick="Pokladna.approveTimesheet(${Number(row.id)})">Schvalit</button>`)));
    (queue.checkins || []).forEach(row => items.push(notificationItem('map', 'Check-in ke kontrole', `${row.employee_name || '-'} / ${row.object_name || '-'} / ${row.time_in || ''}`, 'pending', `<button class="btn sm primary" onclick="Pokladna.approveCheckin(${Number(row.id)})">Schvalit</button>`)));
    (queue.advances || []).forEach(row => items.push(notificationItem('wallet', 'Zadost o zalohu', `${row.employee_name || '-'} / ${czk(row.amount || 0)}`, 'pending', `<button class="btn sm primary" onclick="Pokladna.approveAdvance(${Number(row.id)})">Vydat</button>`)));
    (queue.documents || []).forEach(row => items.push(notificationItem('file', 'Dokument ke schvaleni', `${row.employee_name || '-'} / ${row.title || row.document_type || '-'}`, 'pending', `<button class="btn sm primary" onclick="Pokladna.approveDocument(${Number(row.id)})">Schvalit</button>`)));
    return items;
  }
  const employeeId = state.user?.employee_id || '';
  const calls = [
    can('timesheets.view') ? api(`timesheets?month=${state.month}&year=${state.year}`).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
    can('checkins.view') ? api('checkins').catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
    can('advances.view') ? api(`advances?month=${state.month}&year=${state.year}`).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
    can('documents.view') && employeeId ? api(`documents?employee_id=${employeeId}`).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
  ];
  const [timesheets, checkins, advances, documents] = await Promise.all(calls);
  (timesheets.data || []).slice(0, 8).forEach(row => items.push(notificationItem('hours', 'Hodiny', `${row.work_date || '-'} / ${num(row.hours || 0)} h`, row.status || 'approved')));
  (checkins.data || []).slice(0, 8).forEach(row => items.push(notificationItem('map', row.time_out ? 'Smena ukoncena' : 'Smena bezi', `${row.object_name || row.location_name || '-'} / ${num(row.duration_hours || 0)} h`, row.status || 'approved')));
  (advances.data || []).slice(0, 8).forEach(row => items.push(notificationItem('wallet', 'Zaloha', `${czk(row.amount || 0)} / ${row.date || '-'}`, row.status || 'pending')));
  (documents.data || []).slice(0, 8).forEach(row => items.push(notificationItem('file', 'Dokument', `${row.title || row.document_type || '-'} / ${row.expires_at || 'bez data'}`, row.status || 'approved')));
  return items;
}

async function openNotifications() {
  modal('Upozorneni', '<div class="notification-list"><div class="empty">Nacitam upozorneni...</div></div>');
  const body = document.querySelector('.modal-backdrop .notification-list');
  try {
    const items = await notificationItems();
    state.notificationCount = items.filter(html => html.includes('pending') || html.includes('rejected')).length;
    if (body) {
      body.innerHTML = `
        <div class="notification-actions">
          <button class="btn primary" type="button" onclick="Pokladna.notificationPermission()">Zapnout systemova upozorneni</button>
          ${isGlobalUser() ? `<button class="btn" type="button" onclick="document.querySelector('.modal-backdrop')?.remove(); Pokladna.go('salary')">Mzdy / Vyplaty</button>` : ''}
        </div>
        ${items.length ? items.join('') : '<div class="empty">Zadne nove udalosti. Hodiny, zalohy, dokumenty a vyplaty jsou bez cekajicich akci.</div>'}`;
      translateNode(body);
    }
  } catch (err) {
    if (body) body.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
}

async function installApp() {
  if (state.installPrompt) {
    const promptEvent = state.installPrompt;
    state.installPrompt = null;
    promptEvent.prompt();
    await promptEvent.userChoice.catch(() => null);
    return;
  }
  toast('V prohlizeci zvolte Pridat na plochu / Add to Home Screen.', 'warn');
}

async function notifyUser(title, body = '') {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (registration?.showNotification) {
      await registration.showNotification(title, { body, icon: '/assets/icons/buildpay.svg', badge: '/assets/icons/buildpay.svg' });
      return;
    }
  } catch {}
  try {
    new Notification(title, { body, icon: '/assets/icons/buildpay.svg' });
  } catch {}
}

function updateTimesheetHours(input) {
  const form = input?.closest ? input.closest('form') : input;
  if (!form?.elements) return;
  const start = form.elements.work_start_at?.value;
  const end = form.elements.work_end_at?.value;
  const hoursInput = form.elements.hours;
  if (!start || !end || !hoursInput) return;
  const startDate = new Date(start);
  let endDate = new Date(end);
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) return;
  if (endDate <= startDate) {
    endDate = new Date(endDate.getTime() + 24 * 60 * 60 * 1000);
  }
  const hours = (endDate - startDate) / 3600000;
  if (hours > 0 && hours <= 24) {
    hoursInput.value = hours.toFixed(2);
  }
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function payoutCashRemainder(net, cardAmount) {
  return Math.max(0, roundMoney(Number(net || 0) - Number(cardAmount || 0)));
}

function payoutCashRemainderWithDebt(net, cardAmount, debtAmount = 0) {
  return Math.max(0, roundMoney(Number(net || 0) - Number(cardAmount || 0) - Number(debtAmount || 0)));
}

function payoutDefaultInsuranceAmount(row = {}) {
  return rohlikDefaultEmployerHealthAmount(row.contract_type || row.contract_kind || '');
}

function updatePayoutPreview(input) {
  const form = input?.closest ? input.closest('form') : input;
  const preview = form?.querySelector?.('.payout-preview');
  if (!form?.elements || !preview) return;
  const value = name => Number(String(form.elements[name]?.value || 0).replace(',', '.')) || 0;
  const gross = Number(preview.dataset.gross || 0);
  const advances = Number(preview.dataset.advances || 0);
  const net = roundMoney(gross + value('bonus_amount') + value('insurance_amount') - value('deduction_amount') - advances - value('housing'));
  const debtAmount = value('debt_amount');
  const cashInput = form.elements.cash_amount;
  let cashAmount = value('cash_amount');
  if (input?.name !== 'cash_amount') {
    cashAmount = payoutCashRemainderWithDebt(net, value('card_amount'), debtAmount);
    if (cashInput) cashInput.value = cashAmount.toFixed(2);
  }
  const remains = roundMoney(net - value('card_amount') - cashAmount - debtAmount);
  const setMoney = (selector, amount, positiveClass = 'accent') => {
    const el = form.querySelector(selector);
    if (!el) return;
    el.textContent = czk(amount);
    el.classList.remove('accent', 'blue', 'warn', 'danger');
    el.classList.add(amount < 0 ? 'danger' : positiveClass);
  };
  setMoney('[data-payout-insurance]', value('insurance_amount'), 'accent');
  setMoney('[data-payout-debt]', debtAmount, 'danger');
  setMoney('[data-payout-net]', net, 'accent');
  setMoney('[data-payout-remains]', remains, remains === 0 ? 'accent' : 'warn');
}

function currentGpsPosition() {
  if (!navigator.geolocation) {
    return Promise.reject(new Error('GPS neni dostupne'));
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, err => reject(err), {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  });
}

function gpsPayload(pos) {
  return {
    lat: pos.coords.latitude.toFixed(7),
    lng: pos.coords.longitude.toFixed(7),
    location_accuracy: pos.coords.accuracy !== undefined && pos.coords.accuracy !== null ? Number(pos.coords.accuracy).toFixed(2) : '',
    location_captured_at: new Date(pos.timestamp || Date.now()).toISOString(),
    location_source: 'browser_gps',
  };
}

function coord(value, precision = 7) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(precision) : '';
}

function hasCoords(lat, lng) {
  return coord(lat) !== '' && coord(lng) !== '';
}

function mapExternalUrl(lat, lng) {
  return `https://www.google.com/maps?q=${coord(lat)},${coord(lng)}`;
}

function osmEmbedUrl(lat, lng) {
  const la = Number(lat);
  const lo = Number(lng);
  const pad = 0.003;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${(lo - pad).toFixed(6)},${(la - pad).toFixed(6)},${(lo + pad).toFixed(6)},${(la + pad).toFixed(6)}&layer=mapnik&marker=${la.toFixed(7)},${lo.toFixed(7)}`;
}

function locationMapHtml(lat, lng, accuracy = '', capturedAt = '', compact = false) {
  if (!hasCoords(lat, lng)) {
    return '<div class="map-preview empty">GPS poloha zatim neni nactena</div>';
  }
  const coords = `${coord(lat)}, ${coord(lng)}`;
  const accuracyText = accuracy !== '' && accuracy !== null && accuracy !== undefined ? `Presnost ${num(accuracy)} m` : 'Presnost neznama';
  const captured = capturedAt ? String(capturedAt).replace('T', ' ').slice(0, 19) : '';
  const frame = `
    <div class="map-preview ${compact ? 'compact' : ''}">
      <iframe class="map-frame" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${esc(osmEmbedUrl(lat, lng))}"></iframe>
      <div class="map-coordinates">
        <span class="mono">${esc(coords)}</span>
        <span>${esc(accuracyText)}</span>
        ${captured ? `<span>${esc(captured)}</span>` : ''}
        <a class="link" href="${esc(mapExternalUrl(lat, lng))}" target="_blank" rel="noopener">Otevrit mapu</a>
      </div>
    </div>`;
  if (!compact) return frame;
  return `<details class="map-details"><summary><span class="mono">${esc(coords)}</span><span class="muted">${esc(accuracyText)}</span></summary>${frame}</details>`;
}

function setLocationFormState(form, payload) {
  if (!form?.elements) return;
  Object.entries(payload).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value;
  });
  const preview = form.querySelector('[data-gps-preview]');
  if (preview) {
    preview.outerHTML = locationMapHtml(payload.lat, payload.lng, payload.location_accuracy, payload.location_captured_at);
  }
}

async function captureGpsForForm(form, button = null) {
  const oldText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = 'Nacitam GPS...';
  }
  try {
    const payload = gpsPayload(await currentGpsPosition());
    setLocationFormState(form, payload);
    return payload;
  } catch (err) {
    throw new Error(err?.message || 'GPS polohu se nepodarilo nacist');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = oldText;
    }
  }
}

async function renderPage() {
  if (!isGlobalUser() && state.isRohlikEmployee && ['timesheets', 'checkins'].includes(state.view)) {
    state.view = 'dashboard';
  }
  if (state.view === 'menu') {
    return renderAdminMenu();
  }
  if (state.view === 'dashboard') return renderDashboard();
  if (state.view === 'companies') return renderCompanies();
  if (state.view === 'employees') return renderEmployees();
  if (state.view === 'employee_archive') return renderEmployeeArchive();
  if (state.view === 'objects') return renderObjects();
  if (state.view === 'cas') return renderCas();
  if (state.view === 'timesheets') return renderTimesheets();
  if (state.view === 'salary') return renderSalary();
  if (state.view === 'accounting') return renderAccounting();
  if (state.view === 'payouts') return renderPayouts();
  if (state.view === 'finance') return renderFinance();
  if (state.view === 'monthclose') return renderMonthClose();
  if (state.view === 'advances') return renderAdvances();
  if (state.view === 'cash') return renderCash();
  if (state.view === 'checkins') return renderCheckins();
  if (state.view === 'resources') return renderResources();
  if (state.view === 'recruitment') return renderRecruitment();
  if (state.view === 'stavba') return renderStavba();
  if (state.view === 'rohlik') return renderRohlikBrno();
  if (state.view === 'rohlik_ostrava') return renderRohlikOstrava();
  if (state.view === 'smeny') return renderRohlikShifts();
  if (state.view === 'warehouse') return renderWarehouse();
  if (state.view === 'admin_chat') return renderAdminChat();
  if (state.view === 'users') return renderUsers();
  if (state.view === 'logs') return renderLogs();
}

function normalizeCasTab(tab) {
  return ['hours', 'checkins', 'smeny'].includes(tab) ? tab : 'hours';
}

function casTabsHtml(active) {
  const tabs = [
    ['hours', 'Hodiny', 'timesheets.view'],
    ['checkins', 'Check-iny', 'checkins.view'],
    ['smeny', 'Smeny', 'rohlik_shifts.view'],
  ].filter(([, , perm]) => can(perm));
  return `<div class="cas-tabs" role="tablist" aria-label="Cas">
    ${tabs.map(([id, label]) => `<button type="button" class="${active === id ? 'active' : ''}" onclick="Pokladna.casTab('${id}')">${esc(label)}</button>`).join('')}
  </div>`;
}

async function renderCas() {
  let active = normalizeCasTab(state.casTab);
  const allowed = {
    hours: can('timesheets.view'),
    checkins: can('checkins.view'),
    smeny: can('rohlik_shifts.view'),
  };
  if (!allowed[active]) {
    active = Object.keys(allowed).find(key => allowed[key]) || 'hours';
    state.casTab = active;
  }
  localStorage.setItem(casTabStorageKey, active);
  loading('Cas');

  if (active === 'checkins') {
    const [employees, objects, checkins] = await Promise.all([api(withCompany('employees')), api(withCompany('objects')).catch(() => ({ data: [] })), api(withCompany('checkins'))]);
    state.cache.employees = employees.data;
    state.cache.objects = objects.data;
    const rows = checkins.data.map(c => [
      esc(c.employee_name),
      esc(c.time_in),
      esc(c.time_out || 'aktivni'),
      `<span class="mono">${num(c.duration_hours || 0)}</span>`,
      `<span class="badge ${c.status === 'pending' ? 'warn' : c.status === 'rejected' ? 'danger' : 'accent'}">${esc(c.status || 'approved')}</span>`,
      `<div>${esc(c.object_name || c.location_name || '-')}</div>${locationMapHtml(c.lat, c.lng, c.location_accuracy, c.location_captured_at || c.last_seen_at, true)}<div class="muted">${esc(c.last_seen_at || '')}${c.movement_points ? ` / ${num(c.movement_points)} GPS` : ''}</div>`,
      esc(c.note || ''),
      can('checkins.write') && canManage() ? `${c.status === 'pending' ? `<button class="btn sm primary" onclick="Pokladna.approveCheckin(${c.id})">Schvalit</button>` : ''} <button class="btn sm danger" onclick="Pokladna.deleteCheckin(${c.id})">Smazat</button>` : '<span class="muted">Zadano</span>',
    ]);
    setContent(`${head('Cas', `${currentMonths()[state.month - 1]} ${state.year}`, can('checkins.write') ? '<button class="btn primary" onclick="Pokladna.checkin()">Check-in / out</button>' : '')}
      ${casTabsHtml(active)}
      ${rows.length ? table(['Zamestnanec','Prichod','Odchod','Hodiny','Stav','Poloha','Poznamka','Akce'], rows) : '<div class="card empty">Zadne check-iny</div>'}`);
    return;
  }

  if (active === 'smeny') {
    let payload;
    try {
      payload = await api(withCompany(`rohlik-shifts?month=${state.month}&year=${state.year}`));
    } catch (err) {
      setContent(`${head('Cas', 'Smeny Rohlik Brno')}${casTabsHtml(active)}<div class="card empty">${esc(err.message)}</div>`);
      return;
    }
    const data = payload.data || {};
    const shifts = data.shifts || [];
    const requests = data.requests || [];
    state.cache.rohlikShifts = shifts;
    state.cache.rohlikShiftRequests = requests;
    state.cache.rohlikShiftEmployees = data.employees || [];
    const shiftRows = shifts.map(row => [
      `<strong>${esc(row.work_date || '-')}</strong>`,
      `<span class="badge">${esc(rohlikShiftDepartment(row.department))}</span>`,
      `<span class="mono">${esc(rohlikShiftTime(row))}</span>`,
      employeeNameCell(row, { meta: `${row.company_name || '-'} / ${row.object_name || '-'}`, size: 'sm' }),
      `<strong>${esc(row.shift_label || '-')}</strong>`,
      rohlikShiftStatusBadge(row.status),
      can('rohlik_shifts.write') ? `<button class="btn sm" onclick="Pokladna.rohlikShift(${row.id})">Upravit</button> <button class="btn sm danger" onclick="Pokladna.deleteRohlikShift(${row.id})">Smazat</button>` : '',
    ]);
    const requestRows = requests.map(row => [
      rohlikShiftRange(row),
      rohlikShiftRequestLabel(row.request_type),
      employeeNameCell(row, { meta: row.created_by_name || '', size: 'sm' }),
      rohlikShiftRequestBadge(row.status),
      esc(row.note || row.rejection_note || ''),
      can('rohlik_shifts.write') ? `${row.status === 'pending' ? `<button class="btn sm primary" onclick="Pokladna.approveRohlikShiftRequest(${row.id})">Schvalit</button> <button class="btn sm danger" onclick="Pokladna.rejectRohlikShiftRequest(${row.id})">Odmitnout</button>` : ''} <button class="btn sm danger" onclick="Pokladna.deleteRohlikShiftRequest(${row.id})">Smazat</button>` : '<span class="muted">Odeslano</span>',
    ]);
    const actions = `${can('rohlik_shifts.write') ? '<button class="btn primary" onclick="Pokladna.rohlikShift()">Pridat smenu</button>' : ''} ${can('rohlik_shifts.request') ? '<button class="btn primary" onclick="Pokladna.rohlikShiftRequest()">Pozadat o volno</button>' : ''}`;
    setContent(`${head('Cas', `Smeny / ${currentMonths()[state.month - 1]} ${state.year}`, actions)}
      ${casTabsHtml(active)}
      <div class="grid grid-3" style="margin-bottom:14px">
        <div class="stat"><div class="stat-label">Smeny</div><div class="stat-value blue">${num(shifts.length)}</div></div>
        <div class="stat"><div class="stat-label">Zadosti</div><div class="stat-value warn">${num(requests.filter(row => row.status === 'pending').length)}</div></div>
        <div class="stat"><div class="stat-label">Pracovnici</div><div class="stat-value">${num((data.employees || []).length)}</div></div>
      </div>
      <div class="section-title">Plan smen</div>
      ${shiftRows.length ? table(['Datum','Oddeleni','Cas','Pracovnik','Smena','Stav','Akce'], shiftRows, 'compact-table') : '<div class="card empty">Zadne smeny pro tento mesic</div>'}
      <div class="section-title">Zadosti o volno</div>
      ${requestRows.length ? table(['Obdobi','Typ','Pracovnik','Stav','Poznamka','Akce'], requestRows, 'compact-table') : '<div class="card empty">Zadne zadosti</div>'}`);
    return;
  }

  const [employees, timesheets] = await Promise.all([api(withCompany('employees')), api(withCompany(`timesheets?month=${state.month}&year=${state.year}`))]);
  state.cache.employees = employees.data;
  state.cache.timesheets = timesheets.data;
  const rows = timesheets.data.map(t => [
    esc(t.employee_name),
    esc(t.work_date || '-'),
    esc(timeRangeLabel(t.work_start_at, t.work_end_at)),
    `<span class="mono">${num(t.hours)}</span>`,
    `<span class="mono">${czk(Number(t.hours) * Number(t.hourly_rate))}</span>`,
    `<span class="badge ${t.status === 'pending' ? 'warn' : t.status === 'rejected' ? 'danger' : 'accent'}">${esc(t.status || 'approved')}</span>`,
    esc(t.note || ''),
    `${can('timesheets.write') && canManage() ? `<button class="btn sm" onclick="Pokladna.timesheet(${t.id})">Upravit</button> <button class="btn sm danger" onclick="Pokladna.deleteTimesheet(${t.id})">Smazat</button>` : '<span class="muted">Odeslano</span>'} ${can('timesheets.approve') && t.status !== 'approved' ? `<button class="btn sm primary" onclick="Pokladna.approveTimesheet(${t.id})">Schvalit</button>` : ''} ${can('timesheets.approve') && t.status !== 'rejected' ? `<button class="btn sm danger" onclick="Pokladna.rejectTimesheet(${t.id})">Odmitnout</button>` : ''}`,
  ]);
  setContent(`${head('Cas', `${currentMonths()[state.month - 1]} ${state.year}`, can('timesheets.write') ? '<button class="btn primary" onclick="Pokladna.timesheet()">Zadat hodiny</button>' : '')}
    ${casTabsHtml(active)}
    ${rows.length ? table(['Zamestnanec','Datum','Cas','Hodiny','Hrube','Stav','Poznamka','Akce'], rows) : '<div class="card empty">Zadne hodiny</div>'}`);
}

function setCasTab(tab) {
  state.casTab = normalizeCasTab(tab);
  localStorage.setItem(casTabStorageKey, state.casTab);
  state.view = 'cas';
  renderPage();
}

function buildcrewKpi(label, value, note = '', tone = '') {
  return `<div class="buildcrew-kpi ${tone}">
    <span>${esc(label)}</span>
    <strong>${value}</strong>
    ${note ? `<small>${esc(note)}</small>` : ''}
  </div>`;
}

function buildcrewNavIcon(id) {
  const icons = {
    shift: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9 21v-6h6v6"/></svg>',
    hours: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-5"/><path d="M12 16V8"/><path d="M16 16v-7"/></svg>',
    money: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 10h.01"/><path d="M17 14h.01"/><circle cx="12" cy="12" r="3"/></svg>',
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.5-4.5A8 8 0 1 1 21 12Z"/><path d="M8 12h8"/><path d="M8 9h5"/></svg>',
    profile: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14"/><path d="M16 5v14"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1"/></svg>',
    warehouse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21V8l9-5 9 5v13"/><path d="M7 21v-8h10v8"/><path d="M9 17h6"/></svg>',
    map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3Z"/><path d="M9 3v15"/><path d="M15 6v15"/></svg>',
    contract: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8l3 3v15H5V3Z"/><path d="M16 3v4h4"/><path d="M8 12h8"/><path d="M8 16h6"/></svg>',
    wallet: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7H5a2 2 0 0 1 0-4h13"/><path d="M4 7v12a2 2 0 0 0 2 2h14V7"/><path d="M16 14h4"/></svg>',
    upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/></svg>',
    bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
    smile: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.4 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/></svg>',
    paperclip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21.4 11.6-8.5 8.5a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>',
    file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>',
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7A2 2 0 0 1 22 16.9Z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20"/><path d="M12 2a15 15 0 0 0 0 20"/></svg>',
    logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M21 3v18"/></svg>',
    admin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 7v5c0 5 3.4 8 8 9 4.6-1 8-4 8-9V7Z"/><path d="M9 12l2 2 4-4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 15H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  };
  return icons[id] || '';
}

function buildcrewBottomNav() {
  const active = normalizeWorkerTab(state.workerTab);
  const items = [
    ['shift', 'Hlavni', 'shift'],
    ['hours', 'Hodiny', 'hours'],
    ['money', 'Zalohy', 'wallet'],
    ['chat', 'Chat', 'chat'],
    ['profile', 'Profil', 'profile'],
  ];
  return `<nav class="buildcrew-bottom-nav" aria-label="BuildCrew navigace">
    ${items.map(([id, label, icon]) => `<button type="button" class="${active === id ? 'active' : ''}" aria-current="${active === id ? 'page' : 'false'}" onclick="Pokladna.workerTab('${id}')"><span>${buildcrewNavIcon(icon)}</span><strong>${esc(tr(label))}</strong></button>`).join('')}
  </nav>`;
}

function buildWorkerHeader(employee = {}, options = {}) {
  const active = !!options.activeShift;
  const incident = !!options.incident;
  const statusClass = incident ? 'incident' : active ? 'active' : 'idle';
  const title = options.title || employee.object_name || employee.company_name || 'BuildPay';
  const name = employee.name || employee.employee_name || state.user?.name || state.user?.email || 'Pracovnik';
  const meta = options.meta || employee.object_name || employee.company_name || roleLabel(state.user?.role);
  return `
    <div class="buildcrew-topbar worker-header">
      <div class="buildcrew-person worker-header-person">
        <span class="worker-avatar-ring ${statusClass}">${employeeAvatar(employee, 'md')}</span>
        <div class="worker-header-copy">
          <span>${esc(tr(title))}</span>
          <strong>${esc(name)}</strong>
          <small>${esc(meta || '')}</small>
        </div>
      </div>
      <div class="worker-header-actions">
        ${buildcrewIconButton('bell', 'Upozorneni', 'Pokladna.notifications()')}
        <button class="worker-lang-toggle" type="button" onclick="Pokladna.cycleLang()" title="Jazyk">${esc(languageShortLabel())}</button>
        <button class="worker-logout-icon" type="button" onclick="Pokladna.confirmLogout()" title="Odhlasit se">${buildcrewNavIcon('logout')}<span class="sr-only">Odhlasit se</span></button>
      </div>
    </div>`;
}

function buildcrewTodayPanel(options = {}) {
  const active = !!options.activeShift;
  const objectName = options.objectName || 'Objekt neni prirazen';
  const start = options.activeShift?.time_in || '-';
  const hours = Number(options.hours || 0);
  const money = Number(options.money || 0);
  const shifts = Number(options.shifts || 0);
  return `<div class="worker-today-panel ${active ? 'active' : ''}">
    <div class="worker-today-main">
      <span>${active ? 'Smena bezi' : 'Pripraveno ke startu'}</span>
      <strong>${active ? 'Prace je spustena' : 'Zacit praci jednim tlacitkem'}</strong>
      <small>${active ? `Start ${esc(start)} / GPS aktivni` : 'Po START se automaticky ulozi GPS a spusti timer'}</small>
    </div>
    <div class="worker-today-grid">
      <div><span>Objekt</span><b>${esc(objectName)}</b></div>
      <div><span>Mesic</span><b>${num(hours)} h</b></div>
      <div><span>K vyplate</span><b>${czk(money)}</b></div>
      <div><span>Smeny</span><b>${num(shifts)}</b></div>
    </div>
  </div>`;
}

function adminMobileSection(view = state.view) {
  if (['companies', 'employees', 'employee_archive', 'objects', 'resources', 'recruitment'].includes(view)) return 'admin';
  if (['cas', 'timesheets', 'checkins', 'stavba', 'rohlik', 'rohlik_ostrava', 'smeny', 'warehouse'].includes(view)) return 'work';
  if (['accounting'].includes(view)) return 'accounting';
  if (['salary', 'payouts', 'finance', 'advances', 'cash', 'monthclose'].includes(view)) return 'money';
  if (['admin_chat'].includes(view)) return 'chat';
  if (['menu', 'users', 'logs'].includes(view)) return 'admin';
  return 'home';
}

function buildAdminMobileTopbar() {
  const displayName = userDisplayName();
  const ownEmployee = (state.cache.employees || []).find(e => Number(e.id) === Number(state.user?.employee_id));
  return `
    <div class="buildcrew-topbar admin-mobile-topbar">
      <div class="buildcrew-person">
        ${employeeAvatar(ownEmployee || { name: displayName }, 'lg')}
        <div>
          <span>BuildPay</span>
          <strong>${esc(displayName)}</strong>
          <small>${esc(currentMonths()[state.month - 1])} ${state.year}</small>
        </div>
      </div>
      ${buildcrewIconButton('bell', 'Upozorneni', 'Pokladna.notifications()')}
    </div>`;
}

function adminProfilePanelHtml() {
  const yearOptions = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i);
  const displayName = userDisplayName();
  const ownEmployee = (state.cache.employees || []).find(e => Number(e.id) === Number(state.user?.employee_id));
  const companySelect = (state.cache.companies || []).length ? `
    <div class="field"><label>Firma</label><select class="select" onchange="Pokladna.companyFilter(this.value)" aria-label="Firma">
      <option value="" ${state.companyId ? '' : 'selected'}>Vsechny firmy</option>
      ${(state.cache.companies || []).map(c => `<option value="${c.id}" ${String(state.companyId) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
    </select></div>` : '';
  return `<section class="admin-profile-panel">
    <div class="buildcrew-profile-hero admin-profile-hero">
      ${employeeAvatar(ownEmployee || { name: displayName }, 'xl')}
      <div>
        <strong>${esc(displayName)}</strong>
        <span>BuildPay / ${esc(roleLabel(state.user?.role))}</span>
        <small>${esc(currentMonths()[state.month - 1])} ${state.year}</small>
      </div>
    </div>
    <div class="admin-profile-controls">
      ${companySelect}
      <div class="field"><label>Mesic</label><select class="select" onchange="Pokladna.period('month', this.value)" aria-label="Mesic">
        ${currentMonths().map((m, i) => `<option value="${i + 1}" ${state.month === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}
      </select></div>
      <div class="field"><label>Rok</label><select class="select" onchange="Pokladna.period('year', this.value)" aria-label="Rok">
        ${yearOptions.map(y => `<option value="${y}" ${state.year === y ? 'selected' : ''}>${y}</option>`).join('')}
      </select></div>
      <div class="field"><label>Jazyk</label><select class="select" onchange="Pokladna.lang(this.value)" aria-label="Jazyk">
        <option value="cs" ${state.lang === 'cs' ? 'selected' : ''}>Cestina</option>
        <option value="uk" ${state.lang === 'uk' ? 'selected' : ''}>Ukrajinstina</option>
        <option value="ru" ${state.lang === 'ru' ? 'selected' : ''}>Русский</option>
      </select></div>
    </div>
    <div class="admin-profile-actions">
      <button class="btn" type="button" onclick="Pokladna.notifications()">Upozorneni</button>
      <button class="btn" type="button" onclick="Pokladna.install()">Ikona aplikace</button>
      <button class="btn" type="button" onclick="Pokladna.password()">Heslo</button>
      <button class="btn danger" type="button" onclick="Pokladna.logout()">Odhlasit</button>
    </div>
  </section>`;
}

function buildAdminMobileNav() {
  const active = adminMobileSection();
  const items = [
    ['home', 'dashboard', 'Hlavni', 'shift', 'dashboard.view'],
    ['accounting', 'accounting', 'Ucetni', 'file', 'accounting.view'],
    ['work', 'cas', 'Cas', 'hours', 'dashboard.view'],
    ['money', 'finance', 'Finance', 'money', 'finance.view'],
    ['chat', 'admin_chat', 'Chat', 'chat', 'chat.view'],
    ['admin', 'menu', 'Admin', 'admin', 'dashboard.view'],
  ].filter(([section, , , , perm]) => (section !== 'admin' || isAdminUser()) && can(perm));
  return `<nav class="buildcrew-bottom-nav admin-mobile-nav" aria-label="Admin navigace">
    ${items.map(([section, view, label, icon]) => `<button type="button" class="${active === section ? 'active' : ''}" aria-current="${active === section ? 'page' : 'false'}" onclick="Pokladna.go('${view}')"><span>${buildcrewNavIcon(icon)}</span><strong>${label}</strong></button>`).join('')}
  </nav>`;
}

function adminMobileShellHtml(html) {
  return `<section class="buildcrew-app admin-mobile-app">
    ${buildAdminMobileTopbar()}
    <section class="admin-mobile-body">${html}</section>
    ${buildAdminMobileNav()}
  </section>`;
}

function buildcrewIconButton(icon, label, onclick) {
  const badge = icon === 'bell' ? (state.notificationCount ? num(state.notificationCount) : '!') : '';
  return `<button class="buildcrew-icon-btn ${icon === 'bell' ? 'is-active' : ''}" type="button" onclick="${onclick}" title="${esc(label)}">${buildcrewNavIcon(icon)}<span class="sr-only">${esc(label)}</span>${badge ? `<b>${badge}</b>` : ''}</button>`;
}

function buildcrewSettingRow(icon, label, value, attrs = '') {
  const inner = `
    <span class="buildcrew-setting-icon">${buildcrewNavIcon(icon)}</span>
    <span class="buildcrew-setting-copy"><b>${esc(label)}</b><small>${esc(value || '-')}</small></span>
    <span class="buildcrew-setting-chevron">${buildcrewNavIcon('chevron')}</span>`;
  return attrs
    ? `<button class="buildcrew-setting-row" type="button" ${attrs}>${inner}</button>`
    : `<div class="buildcrew-setting-row">${inner}</div>`;
}

function buildcrewLanguageRow() {
  return `<div class="buildcrew-setting-row buildcrew-language-row">
    <span class="buildcrew-setting-icon">${buildcrewNavIcon('globe')}</span>
    <span class="buildcrew-setting-copy"><b>Jazyk</b><small>jazyk rozhrani</small></span>
    <select class="select" onchange="Pokladna.lang(this.value)" aria-label="Jazyk">
      <option value="cs" ${state.lang === 'cs' ? 'selected' : ''}>Cestina</option>
      <option value="uk" ${state.lang === 'uk' ? 'selected' : ''}>Ukrajinstina</option>
      <option value="ru" ${state.lang === 'ru' ? 'selected' : ''}>Русский</option>
    </select>
  </div>`;
}

function buildcrewProfilePanel(employee, documents = [], options = {}) {
  const docsCount = documents.length ? `${documents.length} dokumentu` : 'zadne dokumenty';
  const passportLabel = employee.passport_valid_until ? `platny do ${employee.passport_valid_until}` : 'neni vyplnen';
  const contract = options.contract || employee.contract_type || 'kontrakt neni vyplnen';
  const phoneAction = employee.phone ? `onclick="window.location.href='tel:${jsArg(employee.phone)}'"` : '';
  const mailTarget = employee.email || employee.warehouse_email || '';
  const mailAction = mailTarget ? `onclick="window.location.href='mailto:${jsArg(mailTarget)}'"` : '';
  return `
    <div class="buildcrew-profile-hero">
        ${employeeAvatar(employee, 'xl')}
      <div>
        <strong>${esc(employee.name || state.user?.name || '-')}</strong>
        <span>${esc(contract)}${options.rate ? ` / ${czk(options.rate)}/h` : ''}</span>
      </div>
    </div>
    <div class="buildcrew-profile-section-title">Doklady</div>
    <div class="buildcrew-settings-list">
      ${buildcrewSettingRow('file', 'Pas', passportLabel, `onclick="Pokladna.profile(${Number(employee.id)})"`)}
      ${can('documents.view') ? buildcrewSettingRow('file', 'Dokumenty', docsCount, `onclick="Pokladna.documents(${Number(employee.id)})"`) : ''}
      ${can('documents.write') ? buildcrewSettingRow('upload', 'Nahrat dokument', 'pas, pojisteni, smlouva', `onclick="Pokladna.documents(${Number(employee.id)})"`) : ''}
      ${buildcrewSettingRow('phone', 'Telefon', employee.phone || '-', phoneAction)}
      ${buildcrewSettingRow('profile', 'Pracovni profil', mailTarget || '-', mailAction)}
    </div>
    <div class="buildcrew-profile-section-title">Pracovni udaje</div>
    <div class="buildcrew-settings-list">
      ${buildcrewSettingRow('map', 'Objekt', employee.object_name || '-', `onclick="Pokladna.workerTab('shift')"`) }
      ${buildcrewSettingRow('contract', 'Smlouva', contract, `onclick="Pokladna.profile(${Number(employee.id)})"`)}
      ${buildcrewSettingRow('wallet', 'Mzda', options.rate ? `${czk(options.rate)}/h` : 'neni vyplneno', `onclick="Pokladna.workerTab('money')"`) }
      ${can('advances.write') ? buildcrewSettingRow('wallet', 'Zadost o zalohu', 'odeslat administratorovi', `onclick="Pokladna.advanceFor(${Number(employee.id)})"`) : ''}
    </div>
    <div class="buildcrew-profile-section-title">Nastaveni</div>
    <div class="buildcrew-settings-list">
      ${buildcrewSettingRow('profile', 'Moje udaje', 'telefon, e-mail, IBAN, adresa', `onclick="Pokladna.selfProfile()"`)}
      ${buildcrewSettingRow('bell', 'Upozorneni', state.notificationsEnabled ? 'zapnuto' : 'nastavit', `onclick="Pokladna.notifications()"`)}
      ${buildcrewLanguageRow()}
      ${buildcrewSettingRow('lock', 'Heslo', 'zmenit prihlaseni', `onclick="Pokladna.password()"`)}
    </div>
    <button class="buildcrew-logout-btn" type="button" onclick="Pokladna.logout()">${buildcrewNavIcon('logout')}<span>Odhlasit se</span></button>`;
}

function openSelfProfile() {
  const employeeId = Number(state.user?.employee_id || 0);
  const employee = (state.cache.employees || []).find(row => Number(row.id) === employeeId) || {};
  const j = jsonObject(employee.jmhz_questionnaire);
  if (!employeeId) {
    toast('Profil pracovnika neni napojen na uzivatele', 'danger');
    return;
  }
  modal('Moje udaje', `
    <div class="card subtle-card">
      <strong>Osobni udaje a dotaznik</strong>
      <div class="muted">Hodiny a hodinovou sazbu muze menit jen kancelar nebo administrator.</div>
    </div>
    <div class="form-grid">
      <div class="field"><label>Jmeno</label><input class="input" name="name" value="${esc(employee.name || '')}" autocomplete="name" required></div>
      <div class="field"><label>Telefon</label><input class="input" name="phone" value="${esc(employee.phone || '')}" autocomplete="tel"></div>
      <div class="field"><label>E-mail</label><input class="input" name="email" type="email" value="${esc(employee.email || '')}" autocomplete="email"></div>
      <div class="field"><label>Datum narozeni</label><input class="input" name="birth_date" type="date" value="${esc(employee.birth_date || '')}"></div>
      <div class="field"><label>Rodne cislo</label><input class="input" name="personal_id_number" value="${esc(employee.personal_id_number || '')}"></div>
      <div class="field"><label>Pas</label><input class="input" name="passport_number" value="${esc(employee.passport_number || '')}"></div>
      <div class="field"><label>Pas platny do</label><input class="input" name="passport_valid_until" type="date" value="${esc(employee.passport_valid_until || '')}"></div>
      <div class="field"><label>IBAN / ucet</label><input class="input" name="bank_account" value="${esc(employee.bank_account || '')}" autocomplete="off"></div>
      <div class="field"><label>Nouzovy kontakt</label><input class="input" name="emergency_contact" value="${esc(employee.emergency_contact || '')}"></div>
    </div>
    <div class="field"><label>Adresa</label><textarea name="address">${esc(employee.address || '')}</textarea></div>
    <div class="field"><label>Adresa bydleni</label><textarea name="residence_address">${esc(employee.residence_address || '')}</textarea></div>
    <div class="section-title">Dotaznik JMHZ</div>
    ${jmhzEditorHtml(j, 'self')}`,
    async data => {
      await api(`employees/${employeeId}/self`, { method: 'PATCH', body: JSON.stringify(data) });
      await preloadEmployeeContext();
    },
    'Ulozit udaje');
}

function normalizeWorkerTab(tab) {
  return ['shift', 'hours', 'money', 'chat', 'profile'].includes(tab) ? tab : 'shift';
}

function workerTabForElement(el) {
  const map = {
    'buildcrew-shift': 'shift',
    'buildcrew-hours': 'hours',
    'buildcrew-money': 'money',
    'buildcrew-chat': 'chat',
    'buildcrew-profile': 'profile',
  };
  return el.dataset.workerTab || map[el.id] || '';
}

function activateWorkerTab(tab = 'shift') {
  const next = normalizeWorkerTab(tab);
  state.workerTab = next;
  localStorage.setItem(workerTabStorageKey, next);
  document.querySelectorAll('.worker-app-shell .buildcrew-screen').forEach(panel => {
    const panelTab = workerTabForElement(panel);
    if (!panelTab) return;
    panel.dataset.workerTab = panelTab;
    panel.classList.add('buildcrew-tab-panel');
    panel.classList.toggle('active', panelTab === next);
  });
  document.querySelectorAll('.worker-app-shell .buildcrew-bottom-nav button').forEach(button => {
    const match = button.getAttribute('onclick')?.match(/workerTab\('([^']+)'/);
    const buttonTab = match ? match[1] : '';
    const active = buttonTab === next;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  const appEl = document.querySelector('.worker-app-shell .buildcrew-app');
  if (appEl) appEl.scrollTo({ top: 0, behavior: 'smooth' });
  if (next === 'chat') {
    loadWorkerChat();
  }
}

function chatComposerHtml(options = {}) {
  const formId = options.formId || 'chatForm';
  const inputId = options.inputId || 'chatInput';
  const textareaAttrs = options.textareaAttrs || '';
  const submitAttrs = options.submitAttrs || '';
  const buttonType = options.buttonType || 'submit';
  const employeeId = options.employeeId || '';
  const channel = options.channel || 'direct';
  const placeholder = options.placeholder || 'Napis zpravu...';
  return `
    <form class="buildcrew-chat-form" id="${esc(formId)}" data-employee-id="${esc(employeeId)}" data-channel="${esc(channel)}" ${options.formAttrs || ''}>
      <textarea class="buildcrew-chat-input" id="${esc(inputId)}" name="message" rows="2" placeholder="${esc(placeholder)}" ${textareaAttrs}></textarea>
      <div class="chat-tools">
        <label class="chat-tool-btn chat-file-btn" title="Pripojit soubor">
          ${buildcrewNavIcon('paperclip')}
          <input type="file" name="attachment" onchange="Pokladna.chatAttachmentLabel(this)">
        </label>
        <button class="buildcrew-chat-send" type="${esc(buttonType)}" ${submitAttrs} title="Odeslat">${buildcrewNavIcon('send')}</button>
      </div>
      <div class="chat-file-name" data-file-name></div>
    </form>`;
}

function buildcrewChatPanel(employeeId, title, subtitle) {
  const activeChannel = ['category', 'peer'].includes(state.workerChatChannel) ? state.workerChatChannel : 'direct';
  return `
    <div class="buildcrew-section-title">
      <div><span>Konverzace</span><strong>${esc(title || 'Chat')}</strong></div>
      <small>${esc(subtitle || 'kancelar')}</small>
    </div>
    <div class="buildcrew-chat-switch" role="tablist" aria-label="Chat kanal">
      <button type="button" class="${activeChannel === 'direct' ? 'active' : ''}" onclick="Pokladna.workerChatChannel('direct')">Kancelar</button>
      <button type="button" class="${activeChannel === 'category' ? 'active' : ''}" onclick="Pokladna.workerChatChannel('category')">Moje skupina</button>
      <button type="button" class="${activeChannel === 'peer' ? 'active' : ''}" onclick="Pokladna.workerChatChannel('peer')">Kolega</button>
    </div>
    <div class="buildcrew-peer-row" id="workerChatPeerRow" ${activeChannel === 'peer' ? '' : 'hidden'}>
      <select class="select" id="workerChatPeer" onchange="Pokladna.workerChatPeer(this.value)" aria-label="Vyber kolegu z objektu">
        <option value="">Nacitam kolegy...</option>
      </select>
    </div>
    <div class="chat-clear-row">
      <button class="btn sm ghost" type="button" onclick="Pokladna.clearChat('worker')">${buildcrewNavIcon('trash')} Vymazat muj chat</button>
    </div>
    <div class="buildcrew-chat-thread" id="workerChatThread" data-employee-id="${esc(employeeId)}" data-channel="${esc(activeChannel)}">
      <div class="empty">Nacitani chatu...</div>
    </div>
    ${chatComposerHtml({
      formId: 'workerChatForm',
      inputId: 'workerChatInput',
      employeeId,
      channel: activeChannel,
      formAttrs: 'onsubmit="Pokladna.workerChatSend(event)"',
      placeholder: 'Napis zpravu nebo pridej soubor...',
    })}
    <button class="buildcrew-chat-row compact" type="button" onclick="Pokladna.notifications()">
      <span class="menu-glyph">${buildcrewNavIcon('bell')}</span>
      <b>Upozorneni</b>
      <small>schvaleni hodin, vyplaty, dokumenty</small>
    </button>`;
}

function chatTimeLabel(value) {
  const raw = String(value || '').replace(' ', 'T');
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return value || '';
  return date.toLocaleString('cs-CZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function chatAttachmentLabel(input) {
  const form = input.closest('form');
  const label = form?.querySelector('[data-file-name]');
  if (label) label.textContent = input.files?.[0]?.name || '';
}

function chatAttachmentHtml(message) {
  const name = message.attachment_name || '';
  if (!name) return '';
  return `<a class="chat-attachment" href="api/chat/${Number(message.id)}/download" target="_blank" rel="noopener">
    ${buildcrewNavIcon('paperclip')}
    <span>${esc(name)}</span>
    ${message.attachment_size ? `<small>${num(Math.max(1, Math.round(Number(message.attachment_size) / 1024)))} KB</small>` : ''}
  </a>`;
}

function chatMessageHtml(message) {
  const mine = !!message.is_mine;
  return `<div class="buildcrew-message ${mine ? 'me' : 'them'}">
    <div class="buildcrew-message-bubble">
      ${message.message ? `<div>${esc(message.message || '')}</div>` : ''}
      ${chatAttachmentHtml(message)}
      <small>${esc(message.sender_label || (mine ? 'Ja' : 'Kancelar'))} - ${esc(chatTimeLabel(message.created_at))}</small>
    </div>
  </div>`;
}

function setWorkerChatChannel(channel = 'direct') {
  const next = ['category', 'peer'].includes(channel) ? channel : 'direct';
  state.workerChatChannel = next;
  localStorage.setItem(workerChatChannelStorageKey, next);
  document.querySelectorAll('.buildcrew-chat-switch button').forEach(button => {
    const active = button.getAttribute('onclick')?.includes(`'${next}'`);
    button.classList.toggle('active', !!active);
  });
  document.querySelectorAll('#workerChatThread, .buildcrew-chat-form').forEach(el => {
    el.dataset.channel = next;
  });
  const peerRow = document.getElementById('workerChatPeerRow');
  if (peerRow) peerRow.hidden = next !== 'peer';
  loadWorkerChat();
}

function setWorkerChatPeer(peerId = '') {
  state.workerChatPeerId = String(peerId || '');
  localStorage.setItem(workerChatPeerStorageKey, state.workerChatPeerId);
  loadWorkerChat();
}

async function loadWorkerChatPeers(employeeId) {
  const select = document.getElementById('workerChatPeer');
  if (!select) return [];
  if (state.cache.workerChatPeersEmployeeId === String(employeeId) && Array.isArray(state.cache.workerChatPeers)) {
    return state.cache.workerChatPeers;
  }
  select.innerHTML = '<option value="">Nacitam kolegy...</option>';
  try {
    const payload = await api(`chat?employee_id=${encodeURIComponent(employeeId)}&peers=1`);
    const peers = payload.data || [];
    state.cache.workerChatPeers = peers;
    state.cache.workerChatPeersEmployeeId = String(employeeId);
    if (state.workerChatPeerId && !peers.some(row => String(row.id) === String(state.workerChatPeerId))) {
      state.workerChatPeerId = '';
      localStorage.removeItem(workerChatPeerStorageKey);
    }
    select.innerHTML = `<option value="">Vyber kolegu z objektu</option>${peers.map(row => `<option value="${esc(row.id)}" ${String(row.id) === String(state.workerChatPeerId) ? 'selected' : ''}>${esc(row.name || row.email || 'Kolega')} - ${esc(row.object_name || row.company_name || '')}</option>`).join('')}`;
    return peers;
  } catch (err) {
    select.innerHTML = `<option value="">${esc(err.message)}</option>`;
    return [];
  }
}

function chatThreadHtml(messages) {
  if (!messages || !messages.length) {
    return '<div class="buildcrew-chat-empty">Zatim tu nejsou zadne zpravy. Napis prvni zpravu kancelari nebo mistrovi.</div>';
  }
  return messages.map(chatMessageHtml).join('');
}

async function loadWorkerChat(employeeId = null) {
  const thread = document.getElementById('workerChatThread');
  if (!thread) return;
  const id = employeeId || thread.dataset.employeeId || '';
  const channel = thread.dataset.channel || state.workerChatChannel || 'direct';
  const peerRow = document.getElementById('workerChatPeerRow');
  if (peerRow) peerRow.hidden = channel !== 'peer';
  thread.innerHTML = '<div class="empty">Nacitani chatu...</div>';
  try {
    const params = new URLSearchParams();
    if (id) params.set('employee_id', id);
    if (channel === 'category') params.set('channel', 'category');
    if (channel === 'peer') {
      await loadWorkerChatPeers(id);
      if (!state.workerChatPeerId) {
        thread.innerHTML = '<div class="buildcrew-chat-empty">Vyber kolegu z objektu a otevri konverzaci.</div>';
        return;
      }
      params.set('channel', 'peer');
      params.set('peer_employee_id', state.workerChatPeerId);
    }
    const payload = await api(`chat${params.toString() ? `?${params.toString()}` : ''}`);
    thread.innerHTML = chatThreadHtml(payload.data || []);
    thread.scrollTop = thread.scrollHeight;
  } catch (err) {
    thread.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
}

async function workerChatSend(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = form.querySelector('[name="message"]');
  const message = String(input?.value || '').trim();
  const fileInput = form.querySelector('[name="attachment"]');
  const hasFile = !!fileInput?.files?.length;
  const employeeId = form.dataset.employeeId || '';
  const channel = form.dataset.channel || state.workerChatChannel || 'direct';
  const peerEmployeeId = channel === 'peer' ? state.workerChatPeerId : '';
  if (!message && !hasFile) return;
  if (channel === 'peer' && !peerEmployeeId) {
    toast('Vyber kolegu z objektu.', 'warn');
    return;
  }
  const button = form.querySelector('.buildcrew-chat-send');
  if (button) button.disabled = true;
  try {
    let body;
    if (hasFile) {
      body = new FormData(form);
      body.set('employee_id', employeeId);
      body.set('channel', channel);
      if (peerEmployeeId) body.set('peer_employee_id', peerEmployeeId);
    } else {
      body = JSON.stringify({ employee_id: employeeId, message, channel, peer_employee_id: peerEmployeeId });
    }
    await api('chat', { method: 'POST', body });
    if (input) input.value = '';
    if (fileInput) {
      fileInput.value = '';
      chatAttachmentLabel(fileInput);
    }
    await loadWorkerChat(employeeId);
  } catch (err) {
    toast(err.message, 'danger');
  } finally {
    if (button) button.disabled = false;
    input?.focus();
  }
}

async function loadAdminChat(employeeId, channel = null, channelKey = '', channelLabel = '') {
  const thread = document.getElementById('adminChatThread');
  if (!thread) return;
  const activeChannel = channel || thread.dataset.channel || 'direct';
  const activeKey = channelKey || thread.dataset.channelKey || '';
  thread.dataset.channel = activeChannel;
  thread.dataset.channelKey = activeKey;
  thread.dataset.channelLabel = channelLabel || thread.dataset.channelLabel || '';
  thread.dataset.employeeId = String(employeeId || thread.dataset.employeeId || '');
  thread.innerHTML = '<div class="empty">Nacitani chatu...</div>';
  try {
    const params = new URLSearchParams({ employee_id: String(employeeId) });
    if (activeKey) {
      params.set('channel_key', activeKey);
      if (channelLabel) params.set('channel_label', channelLabel);
    } else if (activeChannel === 'category') {
      params.set('channel', 'category');
    }
    const payload = await api(`chat?${params.toString()}`);
    thread.dataset.channelKey = payload.channel?.key || activeKey || '';
    thread.dataset.channelLabel = payload.channel?.label || channelLabel || '';
    thread.innerHTML = chatThreadHtml(payload.data || []);
    thread.scrollTop = thread.scrollHeight;
    const form = document.getElementById('adminChatForm');
    if (form) {
      form.dataset.employeeId = String(employeeId || '');
      form.dataset.channel = activeChannel;
      form.dataset.channelKey = thread.dataset.channelKey || '';
      form.dataset.channelLabel = thread.dataset.channelLabel || '';
    }
  } catch (err) {
    thread.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
}

function setAdminChatChannel(employeeId, channel = 'direct') {
  const next = channel === 'category' ? 'category' : 'direct';
  document.querySelectorAll('.admin-chat-switch button').forEach(button => {
    const active = button.getAttribute('onclick')?.includes(`'${next}'`);
    button.classList.toggle('active', !!active);
  });
  loadAdminChat(employeeId, next, '', '');
}

async function renderAdminChat() {
  loading('Chat');
  const payload = await api(withCompany('chat?all=1'));
  const conversations = payload.data || [];
  state.cache.adminChatInbox = conversations;
  const selectedKey = state.cache.adminChatSelectedKey || conversations[0]?.key || '';
  const selected = conversations.find(row => row.key === selectedKey) || conversations[0] || null;
  if (selected) state.cache.adminChatSelectedKey = selected.key;
  const unread = conversations.reduce((total, row) => total + Number(row.unread || 0), 0);
  const selector = conversations.length ? `
    <label class="admin-chat-select-wrap">
      <span>Vyber pracovnika / chat</span>
      <select class="select" onchange="Pokladna.adminChatPick(this.value)">
        ${conversations.map(row => `<option value="${esc(row.key)}" ${selected?.key === row.key ? 'selected' : ''}>${esc(row.title || row.employee_name || 'Chat')} - ${esc(row.subtitle || row.last_message || '')}</option>`).join('')}
      </select>
    </label>` : '';
  const list = conversations.map(row => `
    <button class="admin-chat-conversation ${selected?.key === row.key ? 'active' : ''}" type="button" onclick="Pokladna.adminChatOpen(${Number(row.employee_id)}, '${jsArg(row.channel_key || '')}', '${jsArg(row.channel_label || '')}')">
      ${employeeAvatar({ name: row.employee_name, employee_avatar_path: row.employee_avatar_path }, 'md')}
      <span>
        <strong>${esc(row.title || row.employee_name || 'Chat')}</strong>
        <small>${esc(row.subtitle || row.last_message || '')}</small>
      </span>
      ${row.unread ? `<b>${num(row.unread)}</b>` : ''}
    </button>`).join('');
  setContent(`${head('Chat', `${num(conversations.length)} konverzaci / ${num(unread)} neprectenych`)}
    <section class="admin-chat-inbox">
      <aside class="admin-chat-list">
        <div class="admin-chat-list-head">
          <strong>Konverzace</strong>
          <span>${num(unread)} nove</span>
        </div>
        ${selector}
        ${list || '<div class="card empty">Zatim nejsou zadne zpravy.</div>'}
      </aside>
      <div class="admin-chat-panel">
        ${selected ? `
          <div class="buildcrew-profile-card admin-chat-person">
            ${employeeAvatar({ name: selected.employee_name, employee_avatar_path: selected.employee_avatar_path }, 'lg')}
            <div>
              <strong>${esc(selected.title || selected.employee_name || 'Chat')}</strong>
              <span>${esc(selected.company_name || '-')} / ${esc(selected.object_name || '-')}</span>
              <small>${esc(selected.channel_label || 'Pracovnik')}</small>
            </div>
          </div>
          <div class="buildcrew-chat-thread admin-chat-thread" id="adminChatThread" data-employee-id="${esc(selected.employee_id)}" data-channel="${selected.channel_key ? 'custom' : 'direct'}" data-channel-key="${esc(selected.channel_key || '')}" data-channel-label="${esc(selected.channel_label || '')}">
            <div class="empty">Nacitani chatu...</div>
          </div>
          <div class="chat-clear-row">
            <button class="btn sm danger" type="button" onclick="Pokladna.clearChat('admin')">${buildcrewNavIcon('trash')} Vymazat chat vsem</button>
          </div>
          ${chatComposerHtml({
            formId: 'adminChatForm',
            inputId: 'adminChatInput',
            employeeId: selected.employee_id,
            channel: selected.channel_key ? 'custom' : 'direct',
            formAttrs: 'onsubmit="Pokladna.adminChatSend(event)"',
            placeholder: 'Odpovedet pracovnikovi nebo skupine...',
          })}
        ` : '<div class="card empty">Vyberte konverzaci.</div>'}
      </div>
    </section>`);
  if (selected) {
    await loadAdminChat(selected.employee_id, selected.channel_key ? 'custom' : 'direct', selected.channel_key || '', selected.channel_label || '');
  }
}

function openAdminChatConversation(employeeId, channelKey = '', channelLabel = '') {
  state.cache.adminChatSelectedKey = channelKey || `direct:${employeeId}`;
  renderAdminChat();
}

function pickAdminChat(key = '') {
  const conversations = state.cache.adminChatInbox || [];
  const selected = conversations.find(row => row.key === key);
  if (!selected) return;
  state.cache.adminChatSelectedKey = selected.key;
  renderAdminChat();
}

async function openEmployeeChat(employeeId) {
  let row = (state.cache.employees || []).find(e => Number(e.id) === Number(employeeId));
  if (!row) {
    const employees = await api(withCompany('employees?status=all'));
    state.cache.employees = employees.data || [];
    row = state.cache.employees.find(e => Number(e.id) === Number(employeeId));
  }
  modal(`Chat: ${esc(row?.name || 'pracovnik')}`, `
    <div class="employee-chat-modal">
      <div class="buildcrew-profile-card admin-chat-person">
        ${employeeAvatar(row || { name: 'Pracovnik' }, 'lg')}
        <div>
          <strong>${esc(row?.name || 'Pracovnik')}</strong>
          <span>${esc(row?.company_name || '-')} / ${esc(row?.object_name || '-')}</span>
          <small>${esc(row?.phone || row?.email || '')}</small>
        </div>
      </div>
      <div class="buildcrew-chat-switch admin-chat-switch" role="tablist" aria-label="Chat kanal">
        <button type="button" class="active" onclick="Pokladna.adminChatChannel(${Number(employeeId)}, 'direct')">Pracovnik</button>
        <button type="button" onclick="Pokladna.adminChatChannel(${Number(employeeId)}, 'category')">Skupina</button>
      </div>
      <div class="buildcrew-chat-thread admin-chat-thread" id="adminChatThread" data-employee-id="${esc(employeeId)}" data-channel="direct">
        <div class="empty">Nacitani chatu...</div>
      </div>
      <div class="chat-clear-row">
        <button class="btn sm danger" type="button" onclick="Pokladna.clearChat('admin')">${buildcrewNavIcon('trash')} Vymazat chat vsem</button>
      </div>
      ${chatComposerHtml({
        formId: 'adminChatForm',
        inputId: 'adminChatInput',
        employeeId,
        channel: 'direct',
        formAttrs: 'onsubmit="Pokladna.adminChatSend(event)"',
        placeholder: 'Napis zpravu pracovnikovi...',
      })}
    </div>`);
  await loadAdminChat(employeeId);
}

async function adminChatSend(eventOrEmployeeId = null) {
  if (eventOrEmployeeId?.preventDefault) eventOrEmployeeId.preventDefault();
  const form = eventOrEmployeeId?.currentTarget || document.getElementById('adminChatForm');
  const thread = document.getElementById('adminChatThread');
  const input = form?.querySelector('[name="message"]') || document.getElementById('adminChatInput');
  const message = String(input?.value || '').trim();
  const fileInput = form?.querySelector('[name="attachment"]');
  const hasFile = !!fileInput?.files?.length;
  if (!message && !hasFile) return;
  const employeeId = Number(form?.dataset.employeeId || thread?.dataset.employeeId || eventOrEmployeeId || 0);
  const channel = form?.dataset.channel || thread?.dataset.channel || 'direct';
  const channelKey = form?.dataset.channelKey || thread?.dataset.channelKey || '';
  const channelLabel = form?.dataset.channelLabel || thread?.dataset.channelLabel || '';
  const button = form?.querySelector('.buildcrew-chat-send');
  if (button) button.disabled = true;
  try {
    let body;
    if (hasFile) {
      body = new FormData(form);
      body.set('employee_id', String(employeeId));
      body.set('channel', channel);
      if (channelKey) body.set('channel_key', channelKey);
      if (channelLabel) body.set('channel_label', channelLabel);
    } else {
      body = JSON.stringify({ employee_id: employeeId, message, channel, channel_key: channelKey, channel_label: channelLabel });
    }
    await api('chat', { method: 'POST', body });
    if (input) input.value = '';
    if (fileInput) {
      fileInput.value = '';
      chatAttachmentLabel(fileInput);
    }
    await loadAdminChat(employeeId, channel, channelKey, channelLabel);
    input?.focus();
  } catch (err) {
    toast(err.message, 'danger');
  } finally {
    if (button) button.disabled = false;
  }
}

async function clearChat(scope = 'worker') {
  const isAdminScope = scope === 'admin';
  const thread = document.getElementById(isAdminScope ? 'adminChatThread' : 'workerChatThread');
  const form = document.getElementById(isAdminScope ? 'adminChatForm' : 'workerChatForm');
  if (!thread && !form) return;
  if (!confirm('Vymazat tento chat pro vsechny ucastniky? Zpravy zmizi adminovi i pracovnikum.')) return;
  const employeeId = Number(form?.dataset.employeeId || thread?.dataset.employeeId || state.user?.employee_id || 0);
  const channel = form?.dataset.channel || thread?.dataset.channel || (isAdminScope ? 'direct' : state.workerChatChannel || 'direct');
  const body = {
    employee_id: employeeId,
    channel,
    channel_key: form?.dataset.channelKey || thread?.dataset.channelKey || '',
    channel_label: form?.dataset.channelLabel || thread?.dataset.channelLabel || '',
    peer_employee_id: state.workerChatPeerId || '',
  };
  await api('chat/clear', { method: 'DELETE', body: JSON.stringify(body) });
  if (isAdminScope) {
    await loadAdminChat(employeeId, channel, body.channel_key, body.channel_label);
  } else {
    await loadWorkerChat(employeeId);
  }
  toast('Chat byl vymazan pro vsechny ucastniky', 'warn');
}

function isZivnostContract(row = {}) {
  return contractKind(row) === 'Zivnost';
}

function sumRows(rows, key) {
  return (rows || []).reduce((total, row) => total + Number(row[key] || 0), 0);
}

async function renderDashboard() {
  loading('Dashboard');
  const { data } = await api(withCompany(`dashboard?month=${state.month}&year=${state.year}`));
  if (!isGlobalUser() && can('employees.view')) {
    const [own, checkins, rohlikPayload] = await Promise.all([
      api('employees').catch(() => ({ data: [] })),
      api('checkins').catch(() => ({ data: [] })),
      api(`rohlik/me?month=${state.month}&year=${state.year}`).catch(() => ({ data: { row: null, daily: [] } })),
    ]);
    const e = own.data?.[0];
    state.cache.employees = own.data || [];
    if (e) {
      const docs = can('documents.view') ? await api(`documents?employee_id=${e.id}`).catch(() => ({ data: [] })) : { data: [] };
      const activeShift = (checkins.data || []).find(c => !c.time_out);
      const rohlik = rohlikPayload.data || {};
      const rohlikRow = rohlik.row || null;
      const isRohlikPerson = !!rohlikRow || isRohlikEmployeeRecord(e);
      const isStavbaPerson = isStavbaEmployeeRecord(e);
      if (isRohlikPerson && !state.isRohlikEmployee) {
        state.isRohlikEmployee = true;
        renderLayout();
        return;
      }
      if (isStavbaPerson) {
        state.isStavbaEmployee = true;
      }
      const stavbaSalary = isStavbaPerson ? (data.stavba_salary || {}) : {};
      const panelHours = rohlikRow ? Number(rohlikRow.payable_hours || rohlikRow.worked_hours || 0) : (isStavbaPerson ? Number(stavbaSalary.payable_hours || 0) : Number(data.hours || 0));
      const panelRate = rohlikRow && Number(rohlikRow.hourly_rate || 0) > 0 ? Number(rohlikRow.hourly_rate || 0) : Number(e.hourly_rate || 0);
      const gross = rohlikRow ? Number(rohlikRow.gross_amount || 0) : (isStavbaPerson ? Number(stavbaSalary.gross || 0) : panelHours * panelRate);
      const advanceAmount = rohlikRow ? Number(rohlikRow.advance_amount || 0) : (isStavbaPerson ? Number(stavbaSalary.advances || 0) : Number(data.advances || 0));
      const housingAmount = isStavbaPerson ? Number(stavbaSalary.housing ?? e.housing_cost ?? 0) : Number(data.housing ?? e.housing_cost ?? 0);
      const insuranceAmount = isStavbaPerson ? Number(stavbaSalary.insurance_amount || 0) : Number(data.insurance_amount || 0);
      const netAmount = isStavbaPerson ? Number(stavbaSalary.net ?? (gross + insuranceAmount - advanceAmount - housingAmount)) : Number(data.salary_net ?? (gross + insuranceAmount - advanceAmount - housingAmount));
      const debtBanner = Number(data.debt_amount || 0) > 0 ? `
        <div class="buildcrew-debt-banner">
          <span class="buildcrew-dot red-dot"></span>
          <div>
            <strong>Aktivni dluh: ${czk(data.debt_amount)}</strong>
            <small>${esc(data.debt_note || 'bude srazen z vyplaty')}</small>
          </div>
        </div>` : '';
      const docsRows = (docs.data || []).map(d => {
        const expired = d.expires_at && d.expires_at < today();
        const status = d.expires_at ? (expired ? '<span class="badge danger">propadlo</span>' : '<span class="badge accent">platne</span>') : '<span class="badge">bez data</span>';
        return [
          esc(d.document_type),
          `<strong>${esc(d.title)}</strong><div class="muted">${esc(d.original_name || '')}</div>`,
          esc(d.expires_at || '-'),
          status,
        ];
      });
      const recentRows = (checkins.data || []).slice(0, 5).map(c => [
        esc(c.time_in),
        esc(c.time_out || 'aktivni'),
        `<span class="mono">${num(c.duration_hours || 0)}</span>`,
        esc(c.note || ''),
      ]);
      const rohlikDailyRows = (rohlik.daily || []).slice(0, 8).map(r => [
        esc(r.work_date || '-'),
        esc(rohlikPositionLabel(r.position)),
        `<span class="mono">${num(r.attendance_hours || 0)}</span>`,
        `<span class="mono">${num(r.worked_hours || 0)}</span>`,
        `<span class="mono warn">${num(r.extra_hours || 0)}</span>`,
        `<strong class="${Number(r.productivity_percent || 0) >= 100 ? 'accent' : Number(r.productivity_percent || 0) >= 90 ? 'warn' : 'danger'}">${num(r.productivity_percent || 0)}%</strong>`,
        `<span class="${Number(r.efficiency_percent || 0) >= 100 ? 'accent' : Number(r.efficiency_percent || 0) >= 90 ? 'warn' : 'danger'}">${num(r.efficiency_percent || 0)}%</span>`,
      ]);
      const rohlikBlock = isRohlikPerson ? (rohlikRow ? `
        <div class="section-title">Moje Rohlik Brno</div>
        <div class="grid grid-4">
          <div class="stat"><div class="stat-label">Odpracovano</div><div class="stat-value blue">${num(rohlikRow.worked_hours)}</div><div class="stat-note">${num(rohlikRow.days)} dni</div></div>
          <div class="stat"><div class="stat-label">Bonus hodiny ciste</div><div class="stat-value warn">${num(rohlikRow.bonus_hours ?? rohlikRow.extra_hours ?? 0)}</div><div class="stat-note">${esc(rohlikPositionLabel(rohlikRow.position))}</div></div>
          <div class="stat"><div class="stat-label">Produktivita</div><div class="stat-value ${Number(rohlikRow.avg_productivity || 0) >= 100 ? 'accent' : Number(rohlikRow.avg_productivity || 0) >= 90 ? 'warn' : 'danger'}">${num(rohlikRow.avg_productivity || 0)}%</div><div class="stat-note">prumer za mesic</div></div>
          <div class="stat"><div class="stat-label">Efektivita</div><div class="stat-value ${Number(rohlikRow.avg_efficiency || 0) >= 100 ? 'accent' : Number(rohlikRow.avg_efficiency || 0) >= 90 ? 'warn' : 'danger'}">${num(rohlikRow.avg_efficiency || 0)}%</div><div class="stat-note">prumer za mesic</div></div>
          <div class="stat"><div class="stat-label">Zaloha</div><div class="stat-value warn">${czk(rohlikRow.advance_amount)}</div><div class="stat-note">zadosti ${czk(rohlikRow.requested_advance_amount || 0)} + rucne ${czk(rohlikRow.manual_advance_amount || 0)}</div></div>
          <div class="stat"><div class="stat-label">K vyplate</div><div class="stat-value accent">${czk(rohlikRow.net_amount)}</div><div class="stat-note">po zalohach</div></div>
        </div>
        <div style="margin-top:16px">
          ${rohlikChart('Moje produktivita a hodiny', rohlik.daily || [])}
        </div>
        <div style="margin-top:16px">
          ${rohlikDailyRows.length ? table(['Datum','Pozice','Dochazka','Odprac.','Bonus ciste','Produktivita','Efektivita'], rohlikDailyRows) : '<div class="card empty">Zadne denni radky</div>'}
        </div>
        <div class="muted" style="margin-top:10px">Hodiny se nacitaji automaticky z tabulky Rohlik Brno.</div>
      ` : `
        <div class="section-title">Moje Rohlik Brno</div>
        <div class="card empty">Pro tento mesic nejsou data Rohlik Brno podle vaseho e-mailu. Administrator muze doplnit Sklad e-mail nebo sparovat radek v Rohlik Brno.</div>
      `) : '';
      const quickShiftCard = isRohlikPerson ? '' : `
          <div class="card quick-shift ${isStavbaPerson ? 'stavba-timer-card' : ''}">
            <div class="section-title" style="margin-top:0">${isStavbaPerson ? 'Stavba timer' : 'Pracovni smena'}</div>
            <div class="profile-grid compact-profile">
              <div><span>Stav</span><strong class="${activeShift ? 'accent' : ''}">${activeShift ? 'Smena bezi' : 'Bez aktivni smeny'}</strong></div>
              <div><span>Zacatek</span><strong>${esc(activeShift?.time_in || '-')}</strong></div>
              <div class="timer-tile"><span>Timer</span><strong class="accent mono" ${activeShift ? `data-shift-start="${esc(activeShift.time_in)}"` : ''}>${activeShift ? shiftTimerLabel(activeShift.time_in) : '00:00:00'}</strong></div>
              <div><span>Obed</span><strong>30 min automaticky</strong></div>
              <div><span>GPS</span><strong>${activeShift ? 'zamceno' : 'pri startu'}</strong></div>
            </div>
            ${activeShift ? locationMapHtml(activeShift.lat, activeShift.lng, activeShift.location_accuracy, activeShift.location_captured_at || activeShift.last_seen_at, true) : '<div class="map-preview empty">Pri startu se automaticky ulozi GPS poloha</div>'}
            <div class="field" style="margin-top:14px"><label>Dalsi obed / prestavka navic (min)</label><input class="input" id="quickShiftExtraBreak" type="number" min="0" max="210" value="0"></div>
            <div class="field" style="margin-top:14px"><label>${isStavbaPerson ? 'Co jsem dnes delal' : 'Poznamka pro administratora'}</label><textarea id="quickShiftNote" ${isStavbaPerson ? 'required' : ''} placeholder="${isStavbaPerson ? 'napr. fasada, uklid, priprava materialu' : 'napr. objekt, ukol nebo zmena casu'}"></textarea></div>
            <div class="actions shift-actions">
              <button class="btn primary shift-start" ${activeShift ? 'disabled' : ''} onclick="Pokladna.quickShift('start')">Zacit praci</button>
              <button class="btn danger shift-end" ${activeShift ? '' : 'disabled'} onclick="Pokladna.quickShift('end')">Ukoncit praci</button>
              ${isStavbaPerson ? '' : '<button class="btn" onclick="Pokladna.timesheet()">Odeslat hodiny</button>'}
              <button class="btn" onclick="Pokladna.checkin()">Podrobne zadani</button>
            </div>
            ${isStavbaPerson ? '<div class="muted" style="margin-top:10px">Cas a GPS se berou automaticky. Pracovnik nemuze zpetne menit ani mazat zaznam.</div>' : ''}
          </div>`;
      const recentShiftSection = isRohlikPerson ? '' : `
          <div>
            <div class="section-title">Posledni smeny</div>
            ${workerShiftCards(checkins.data || [])}
          </div>`;
      if (isRohlikPerson) {
        const moneyNet = rohlikRow ? Number(rohlikRow.net_amount || 0) : netAmount;
        const productivity = rohlikRow ? Number(rohlikRow.avg_productivity || 0) : 0;
        const efficiency = rohlikRow ? Number(rohlikRow.avg_efficiency || 0) : 0;
        const rawHours = rohlikRow ? Number(rohlikRow.raw_hours || rohlikRow.billing_hours || rohlikRow.payable_hours || panelHours || 0) : panelHours;
        const deductionPct = rohlikRow ? Number(rohlikRow.hour_deduction_pct || 0) : 0;
        const deductedHours = Math.max(0, roundMoney(rawHours - Number(panelHours || 0)));
        setContent(`
          <section class="buildcrew-app rohlik-worker-app">
            ${buildWorkerHeader(e, {
              title: 'Rohlik Brno',
              meta: `${e.company_name || 'ROSHPIT'} / ${contractKind(rohlikRow || e)}`,
            })}
            ${debtBanner}

            <section class="buildcrew-screen rohlik-hero" id="buildcrew-shift">
              <div class="buildcrew-location">
                <span class="buildcrew-dot blue-dot"></span>
                <strong>Data z Google tabulky</strong>
                <small>${rohlikRow ? 'synchronizovano pro tento mesic' : 'ceka na sparovani e-mailu'}</small>
              </div>
              <div class="buildcrew-object">
                <span>AKTUALNI PROJEKT</span>
                <strong>Rohlik Brno</strong>
                <small>${esc(e.company_name || 'ROSHPIT')} / ${esc(contractKind(rohlikRow || e))} / ${esc(rohlikPositionLabel(rohlikRow?.position || ''))}</small>
              </div>
              <button class="buildcrew-rohlik-cta" type="button" onclick="Pokladna.workerTab('hours')">
                <span>${buildcrewNavIcon('warehouse')}</span>
                <div><strong>Rohlik statistika</strong><small>hodiny, efektivita, produktivita a denni radky</small></div>
              </button>
              <div class="buildcrew-kpi-grid rohlik-worker-kpis">
                ${buildcrewKpi(deductionPct > 0 ? 'Hodiny ciste' : 'Odpracovano', `${num(panelHours)} h`, deductionPct > 0 ? `-${num(deductionPct)}% Rohlik` : `${num(rohlikRow?.days || 0)} dni`, 'info')}
                ${deductionPct > 0 ? buildcrewKpi('Hodiny brutto', `${num(rawHours)} h`, 'pred srazkou', 'warn') : ''}
                ${buildcrewKpi('Bonus hodiny', `${num(rohlikRow?.bonus_hours ?? rohlikRow?.extra_hours ?? 0)}`, 'produktivita', 'warn')}
                ${buildcrewKpi('Produktivita', `${num(productivity)}%`, 'prumer mesice', productivity >= 100 ? 'ok' : 'warn')}
                ${buildcrewKpi('Efektivita', `${num(efficiency)}%`, 'prumer mesice', efficiency >= 100 ? 'ok' : 'warn')}
              </div>
            </section>

            <section class="buildcrew-screen" id="buildcrew-hours">
              <div class="buildcrew-section-title">
                <strong>Moje hodiny</strong>
                <span>${currentMonths()[state.month - 1]} ${state.year}</span>
              </div>
              ${rohlikRow ? rohlikChart('Produktivita a hodiny', rohlik.daily || []) : '<div class="empty">Pro tento mesic nejsou data podle e-mailu.</div>'}
              <div class="buildcrew-list">
                <div class="buildcrew-list-title">Posledni radky</div>
                ${rohlikDailyCards(rohlik.daily || [])}
              </div>
            </section>

            <section class="buildcrew-screen" id="buildcrew-money">
              <div class="buildcrew-money-hero">
                <span>K VYPLATE</span>
                <strong>${czk(moneyNet)}</strong>
                <small>po zalohach a rucnich upravach</small>
              </div>
              <div class="buildcrew-kpi-grid">
                ${buildcrewKpi('Hrube', czk(gross), 'hodiny x sazba', 'info')}
                ${buildcrewKpi('Zalohy', czk(advanceAmount), `zadosti ${czk(rohlikRow?.requested_advance_amount || 0)}`, 'warn')}
                ${buildcrewKpi('Karta', czk(rohlikRow?.card_amount || 0), 'nastaveno adminem', 'info')}
                ${buildcrewKpi('Hotovost', czk(rohlikRow?.cash_amount || 0), 'nastaveno adminem', 'ok')}
              </div>
              ${deductionPct > 0 ? `
                <div class="rohlik-deduction-info">
                  <div class="buildcrew-list-title">Pocet hodin</div>
                  <div class="deduction-row"><span>Brutto hodiny</span><strong class="raw-hours">${num(rawHours)} h</strong></div>
                  <div class="deduction-row"><span>Srazka Rohlik (-${num(deductionPct)}%)</span><strong class="danger">-${num(deductedHours)} h</strong></div>
                  <div class="deduction-row accent-row"><span>Ciste hodiny</span><strong class="accent">${num(panelHours)} h</strong></div>
                </div>` : ''}
              <div class="actions buildcrew-inline-actions">
                ${can('advances.write') ? `<button class="btn primary" type="button" onclick="Pokladna.advanceFor(${e.id})">Pozadat o zalohu</button>` : ''}
                <button class="btn" type="button" onclick="Pokladna.go('advances')">Moje zalohy</button>
              </div>
            </section>

            <section class="buildcrew-screen" id="buildcrew-chat">
              ${buildcrewChatPanel(e.id, 'Kontakt a zpravy', 'ROSHPIT / Rohlik Brno')}
            </section>

            <section class="buildcrew-screen" id="buildcrew-profile">
              ${buildcrewProfilePanel(e, docs.data || [], { contract: contractKind(rohlikRow || e), rate: panelRate })}
            </section>
            ${buildcrewBottomNav('rohlik')}
          </section>`);
        return;
      }
      if (isStavbaPerson) {
        const objectName = activeShift?.object_name || e.object_name || 'Objekt neni prirazen';
        const shiftRunning = !!activeShift;
        const timerValue = shiftRunning ? shiftTimerLabel(activeShift.time_in) : '00:00:00';
        const gpsLabel = shiftRunning ? 'GPS se prubezne odesila' : 'GPS se ulozi pri startu';
        setContent(`
          <section class="buildcrew-app">
            ${buildWorkerHeader(e, {
              title: 'Dnesni stavba',
              meta: objectName,
              activeShift: shiftRunning,
            })}
            ${debtBanner}

            <section class="buildcrew-screen" id="buildcrew-shift">
              <div class="buildcrew-location">
                <span class="buildcrew-dot"></span>
                <strong>${esc(gpsLabel)}</strong>
                <small>${esc(activeShift?.location_accuracy ? `${num(activeShift.location_accuracy)} m` : 'poloha telefonu')}</small>
              </div>

              <div class="buildcrew-object">
                <span>DNESNI OBJEKT</span>
                <strong>${esc(objectName)}</strong>
                <small>${esc(e.company_name || 'Firma neni prirazena')} / obed 30 min auto</small>
              </div>
              ${buildcrewTodayPanel({ activeShift, objectName, hours: panelHours, money: netAmount, shifts: (checkins.data || []).length })}

              ${shiftRunning ? `
                <div class="buildcrew-timer-box active-shift-box">
                  <span>SMENA BEZI</span>
                  <strong class="mono" data-shift-start="${esc(activeShift.time_in)}">${esc(timerValue)}</strong>
                  <small>start ${esc(activeShift.time_in || '-')}</small>
                  <div class="buildcrew-mini-row">
                    <b>${czk(panelRate)}/h</b>
                    <b>${czk(gross)}</b>
                  </div>
                  <div class="buildcrew-shift-controls">
                    <button class="btn warn" type="button" onclick="Pokladna.shiftPause()">${buildcrewNavIcon('pause')} Pauza</button>
                    <button class="btn danger" type="button" onclick="Pokladna.quickShift('end')">${buildcrewNavIcon('stop')} Konec</button>
                  </div>
                </div>
              ` : `
                <button class="buildcrew-start-orb" type="button" onclick="Pokladna.quickShift('start')">
                  <span class="orb-ring ring-1"></span>
                  <span class="orb-ring ring-2"></span>
                  <span class="orb-ring ring-3"></span>
                  <span class="buildcrew-start-icon">${buildcrewNavIcon('play')}</span>
                  <span class="buildcrew-play">START</span>
                  <strong>ZACIT</strong>
                  <small>spusti smenu a ulozi GPS</small>
                </button>
              `}

              ${shiftRunning ? locationMapHtml(activeShift.lat, activeShift.lng, activeShift.location_accuracy, activeShift.location_captured_at || activeShift.last_seen_at, true) : ''}

              <div class="buildcrew-field-grid">
                <div class="field"><label>Dalsi obed / prestavka navic</label><input class="input" id="quickShiftExtraBreak" type="number" min="0" max="210" value="0"></div>
                <div class="field"><label>Co jsem dnes delal</label><textarea id="quickShiftNote" required placeholder="napr. fasada, uklid, priprava materialu">${esc(activeShift?.note || '')}</textarea></div>
              </div>

              <div class="buildcrew-action-grid">
                <button class="btn warn" ${shiftRunning ? '' : 'disabled'} type="button" onclick="Pokladna.shiftPause()">Pauza</button>
                <button class="btn danger" ${shiftRunning ? '' : 'disabled'} type="button" onclick="Pokladna.quickShift('end')">Ukoncit praci</button>
                <button class="btn" type="button" onclick="Pokladna.checkin()">Podrobne zadani</button>
              </div>
            </section>

            <section class="buildcrew-screen" id="buildcrew-hours">
              <div class="buildcrew-section-title">
                <strong>Moje hodiny</strong>
                <span>${currentMonths()[state.month - 1]} ${state.year}</span>
              </div>
              <div class="buildcrew-kpi-grid">
                ${buildcrewKpi('Odpracovano', `${num(panelHours)} h`, 'timer + rucni hodiny', 'info')}
                ${buildcrewKpi('Sazba', czk(panelRate), 'za hodinu')}
                ${buildcrewKpi('Hrube', czk(gross), 'pred srazkami', 'ok')}
                ${buildcrewKpi('Zalohy', czk(advanceAmount), 'schvalene + rucni', 'warn')}
              </div>
              <div class="buildcrew-list">
                <div class="buildcrew-list-title">Posledni smeny</div>
                ${workerShiftCards(checkins.data || [])}
              </div>
            </section>

            <section class="buildcrew-screen" id="buildcrew-money">
              <div class="buildcrew-money-hero">
                <span>K VYPLATE</span>
                <strong>${czk(netAmount)}</strong>
                <small>po zalohach, bydleni + bonus pojisteni</small>
              </div>
              <div class="buildcrew-kpi-grid">
                ${buildcrewKpi('Bydleni', czk(housingAmount), e.accommodation_name || 'srazka', 'warn')}
                ${buildcrewKpi('Bonus pojisteni', czk(insuranceAmount), 'pricteno k vyplate', 'ok')}
                ${buildcrewKpi('Karta', czk(stavbaSalary.card_amount || 0), 'vyplaceno na kartu', 'info')}
                ${buildcrewKpi('Hotovost', czk(stavbaSalary.cash_amount || 0), 'hotove', 'ok')}
              </div>
              <div class="actions buildcrew-inline-actions">
                ${can('advances.write') ? `<button class="btn primary" type="button" onclick="Pokladna.advanceFor(${e.id})">Pozadat / zadat zalohu</button>` : ''}
                <button class="btn" type="button" onclick="Pokladna.go('advances')">Zalohy</button>
              </div>
            </section>

            <section class="buildcrew-screen" id="buildcrew-chat">
              ${buildcrewChatPanel(e.id, 'Mistr a kancelar', objectName)}
            </section>

            <section class="buildcrew-screen" id="buildcrew-profile">
              ${buildcrewProfilePanel(e, docs.data || [], { contract: e.contract_type || 'kontrakt neni vyplnen', rate: panelRate })}
            </section>

            ${buildcrewBottomNav()}
          </section>`);
        startShiftTimers();
        if (activeShift) {
          startLocationWatch();
          startShiftPresence(activeShift, objectName);
        } else {
          stopShiftPresence();
        }
        return;
      }
      setContent(`
        <section class="buildcrew-app generic-worker-app">
          ${buildWorkerHeader(e, {
            title: 'Dobre rano',
            meta: e.object_name || e.company_name || roleLabel(state.user?.role),
            activeShift,
          })}
          ${debtBanner}

          <section class="buildcrew-screen" id="buildcrew-shift">
            <div class="buildcrew-location">
              <span class="buildcrew-dot"></span>
              <span>${activeShift ? 'Smena bezi' : 'GPS pri startu'}</span>
              <small>${activeShift ? 'zamceno' : 'pripraveno'}</small>
            </div>
            <div class="buildcrew-object">
              <span>Dnesni objekt</span>
              <strong>${esc(e.object_name || e.company_name || 'Prace')}</strong>
              <small>${esc(e.company_name || '-')} / ${esc(e.contract_type || 'kontrakt neni vyplnen')}</small>
            </div>
            ${buildcrewTodayPanel({ activeShift, objectName: e.object_name || e.company_name || 'Prace', hours: panelHours, money: netAmount, shifts: (checkins.data || []).length })}
            ${activeShift ? `
              <div class="buildcrew-timer-box active-shift-box">
                <span>Smena bezi</span>
                <strong class="mono" data-shift-start="${esc(activeShift.time_in)}">${shiftTimerLabel(activeShift.time_in)}</strong>
                <small>zacatek ${esc(activeShift.time_in || '-')} / obed 30 min auto</small>
                <div class="buildcrew-mini-row">
                  <b>${czk(panelRate)}/h</b>
                  <b>${czk(gross)}</b>
                </div>
                <div class="buildcrew-shift-controls">
                  <button class="btn warn" type="button" onclick="Pokladna.shiftPause()">${buildcrewNavIcon('pause')} Pauza</button>
                  <button class="btn danger" type="button" onclick="Pokladna.quickShift('end')">${buildcrewNavIcon('stop')} Konec</button>
                </div>
              </div>
            ` : `
              <button class="buildcrew-start-orb" type="button" onclick="Pokladna.quickShift('start')">
                <span class="orb-ring ring-1"></span>
                <span class="orb-ring ring-2"></span>
                <span class="orb-ring ring-3"></span>
                <span class="buildcrew-start-icon">${buildcrewNavIcon('play')}</span>
                <span class="buildcrew-play">START</span>
                <strong>ZACIT</strong>
                <small>klepnutim spustis smenu</small>
              </button>
            `}
            <div class="buildcrew-field-grid">
              <div class="field"><label>Dalsi obed / prestavka navic (min)</label><input class="input" id="quickShiftExtraBreak" type="number" min="0" max="210" value="0"></div>
              <div class="field"><label>Poznamka pro administratora</label><textarea id="quickShiftNote" placeholder="napr. objekt, ukol nebo zmena casu"></textarea></div>
            </div>
            <div class="buildcrew-action-grid">
              <button class="btn warn" ${activeShift ? '' : 'disabled'} onclick="Pokladna.shiftPause()">Pauza</button>
              <button class="btn danger" ${activeShift ? '' : 'disabled'} onclick="Pokladna.quickShift('end')">Ukoncit praci</button>
              <button class="btn" onclick="Pokladna.timesheet()">Odeslat hodiny</button>
            </div>
          </section>

          <section class="buildcrew-screen" id="buildcrew-hours">
            <div class="buildcrew-section-title"><div><span>Moje hodiny</span><strong>${currentMonths()[state.month - 1]} ${state.year}</strong></div></div>
            <div class="buildcrew-kpi-grid">
              ${buildcrewKpi('Odpracovano', `${num(panelHours)} h`, 'odeslane za mesic', 'info')}
              ${buildcrewKpi('Sazba', czk(panelRate), 'za hodinu')}
              ${buildcrewKpi('Vydelano', czk(gross), 'hodiny x sazba', 'ok')}
              ${buildcrewKpi('Zalohy', czk(advanceAmount), 'vybrane v obdobi', 'warn')}
            </div>
            <div class="buildcrew-list">
              <div class="buildcrew-list-title">Posledni smeny</div>
              ${workerShiftCards(checkins.data || [])}
            </div>
          </section>

          <section class="buildcrew-screen" id="buildcrew-money">
            <div class="buildcrew-money-hero">
              <span>K VYPLATE</span>
              <strong>${czk(netAmount)}</strong>
              <small>po zalohach, bydleni + bonus pojisteni</small>
            </div>
            <div class="buildcrew-kpi-grid">
              ${buildcrewKpi('Bydleni', czk(housingAmount), e.accommodation_name || 'srazka', 'warn')}
              ${buildcrewKpi('Bonus pojisteni', czk(insuranceAmount), 'pricteno k vyplate', 'ok')}
            </div>
            <div class="actions buildcrew-inline-actions">
              ${can('advances.write') ? `<button class="btn primary" type="button" onclick="Pokladna.advanceFor(${e.id})">Pozadat o zalohu</button>` : ''}
              <button class="btn" type="button" onclick="Pokladna.go('advances')">Moje zalohy</button>
            </div>
          </section>

          <section class="buildcrew-screen" id="buildcrew-chat">
            ${buildcrewChatPanel(e.id, 'Kontakt', e.object_name || e.company_name || 'kancelar')}
          </section>

          <section class="buildcrew-screen" id="buildcrew-profile">
            ${buildcrewProfilePanel(e, docs.data || [], { contract: e.contract_type || 'kontrakt neni vyplnen', rate: panelRate })}
          </section>
          ${buildcrewBottomNav()}
        </section>`);
      startShiftTimers();
      if (activeShift) {
        startLocationWatch();
        startShiftPresence(activeShift, e.object_name || e.company_name || 'Smena');
      } else {
        stopShiftPresence();
      }
      return;
    }
  }
  const queue = data.queue || { timesheets: [], documents: [], checkins: [], advances: [] };
  const hourRows = (queue.timesheets || []).map(t => [
    `<strong>${esc(t.employee_name)}</strong><div class="muted">${esc(t.submitted_by_name || '')}</div>`,
    esc(t.work_date || '-'),
    esc(timeRangeLabel(t.work_start_at, t.work_end_at)),
    `<span class="mono">${num(t.hours)}</span>`,
    `<span class="mono">${czk(Number(t.hours || 0) * Number(t.hourly_rate || 0))}</span>`,
    esc(t.note || ''),
    can('timesheets.approve') ? `<button class="btn sm primary" onclick="Pokladna.approveTimesheet(${t.id})">Schvalit</button> <button class="btn sm danger" onclick="Pokladna.rejectTimesheet(${t.id})">Odmitnout</button>` : '<span class="muted">Ke kontrole administratora</span>',
  ]);
  const documentRows = (queue.documents || []).map(d => [
    `<strong>${esc(d.employee_name)}</strong><div class="muted">${esc(d.uploaded_by_name || '')}</div>`,
    esc(d.document_type || '-'),
    `<strong>${esc(d.title)}</strong><div class="muted">${esc(d.original_name || '')}</div>`,
    esc(d.expires_at || '-'),
    can('documents.write') ? `<button class="btn sm primary" onclick="Pokladna.approveDocument(${d.id})">Schvalit</button> <button class="btn sm danger" onclick="Pokladna.rejectDocument(${d.id})">Odmitnout</button>` : '<span class="muted">Ke kontrole administratora</span>',
  ]);
  const checkinRows = (queue.checkins || []).map(c => [
    `<strong>${esc(c.employee_name)}</strong><div class="muted">${esc(c.object_name || c.location_name || '-')}</div>`,
    esc(c.time_in),
    esc(c.time_out || 'aktivni'),
    `<span class="mono">${num(c.duration_hours || 0)}</span>`,
    locationMapHtml(c.lat, c.lng, c.location_accuracy, c.location_captured_at || c.last_seen_at, true),
    esc(c.note || ''),
    can('checkins.write') ? `<button class="btn sm primary" onclick="Pokladna.approveCheckin(${c.id})">Schvalit start</button> <button class="btn sm danger" onclick="Pokladna.rejectCheckin(${c.id})">Odmitnout</button>` : '<span class="muted">Ke kontrole administratora</span>',
  ]);
  const advanceRows = (queue.advances || []).map(a => [
    `<strong>${esc(a.employee_name)}</strong><div class="muted">${esc(a.created_by_name || '')}</div>`,
    `<span class="mono">${czk(a.amount)}</span>`,
    esc(a.date || '-'),
    esc(a.note || ''),
    can('advances.write') ? `<button class="btn sm primary" onclick="Pokladna.approveAdvance(${a.id})">Vydat</button> <button class="btn sm danger" onclick="Pokladna.rejectAdvance(${a.id})">Odmitnout</button>` : '<span class="muted">Ke kontrole administratora</span>',
  ]);
  const queueTotal = hourRows.length + documentRows.length + checkinRows.length + advanceRows.length;
  const dashboardSections = orderedSections('dashboard', [
    { id: 'advances', title: 'Zadosti o zalohu', note: `${advanceRows.length} zaznamu`, body: advanceRows.length ? table(['Zamestnanec','Castka','Datum','Poznamka','Akce'], advanceRows) : '<div class="card empty">Zadne zalohy ke schvaleni</div>' },
    { id: 'hours', title: 'Hodiny ke schvaleni', note: `${hourRows.length} zaznamu`, body: hourRows.length ? table(['Zamestnanec','Datum','Cas','Hodiny','Hrube','Poznamka','Akce'], hourRows) : '<div class="card empty">Zadne hodiny ke schvaleni</div>' },
    { id: 'documents', title: 'Aktualizovane dokumenty', note: `${documentRows.length} zaznamu`, body: documentRows.length ? table(['Zamestnanec','Typ','Dokument','Platne do','Akce'], documentRows) : '<div class="card empty">Zadne dokumenty ke schvaleni</div>' },
    { id: 'checkins', title: 'Zacatek prace', note: `${checkinRows.length} zaznamu`, body: checkinRows.length ? table(['Zamestnanec','Start','Konec','Hodiny','Poloha','Poznamka','Akce'], checkinRows) : '<div class="card empty">Zadne starty ke schvaleni</div>' },
  ]);
  setContent(`
    ${head('Dashboard', `${currentMonths()[state.month - 1]} ${state.year}`)}
    ${adminPLHeroCard(data)}
    <section class="admin-command">
      <div class="admin-command-main">
        <span>Command centrum</span>
        <strong>Dnes resit: ${num(queueTotal)} ukolu</strong>
        <small>Prakticky tok: nejdrive schvalit starty a hodiny, potom zalohy a dokumenty, nakonec mzdy a vyplaty.</small>
      </div>
      <div class="admin-action-grid">
        <button class="btn primary" type="button" onclick="Pokladna.go('stavba')">Stavba</button>
        <button class="btn" type="button" onclick="Pokladna.go('rohlik')">Rohlik</button>
        <button class="btn" type="button" onclick="Pokladna.go('salary')">Mzdy / Vyplaty</button>
        <button class="btn" type="button" onclick="Pokladna.go('finance')">Naklady / Prijmy</button>
      </div>
    </section>
    <section class="workflow-grid">
      <button type="button" onclick="Pokladna.go('checkins')"><b>1</b><span>GPS starty</span><strong>${num(checkinRows.length)}</strong></button>
      <button type="button" onclick="Pokladna.go('timesheets')"><b>2</b><span>Hodiny</span><strong>${num(hourRows.length)}</strong></button>
      <button type="button" onclick="Pokladna.go('advances')"><b>3</b><span>Zalohy</span><strong>${num(advanceRows.length)}</strong></button>
      <button type="button" onclick="Pokladna.go('salary')"><b>4</b><span>Mzdy / Vyplaty</span><strong>${czk(data.salary_net)}</strong></button>
    </section>
    <div class="grid grid-4">
      <div class="stat"><div class="stat-label">Zamestnanci</div><div class="stat-value accent">${num(data.employees)}</div><div class="stat-note">aktivni</div></div>
      <div class="stat"><div class="stat-label">Hodiny</div><div class="stat-value blue">${num(data.hours)}</div><div class="stat-note">za obdobi</div></div>
      <div class="stat"><div class="stat-label">Mzdy k vyplate</div><div class="stat-value warn">${czk(data.salary_net)}</div><div class="stat-note">po zalohach, bydleni + bonus pojisteni</div></div>
      <div class="stat"><div class="stat-label">Pokladna</div><div class="stat-value ${data.cash_balance < 0 ? 'danger' : 'accent'}">${czk(data.cash_balance)}</div><div class="stat-note">prijmy minus vydaje</div></div>
    </div>
    <div class="grid grid-3" style="margin-top:16px">
      <div class="stat"><div class="stat-label">Ke schvaleni</div><div class="stat-value ${queueTotal ? 'warn' : 'accent'}">${num(queueTotal)}</div><div class="stat-note">celkem zadosti</div></div>
      <div class="stat"><div class="stat-label">Hodiny</div><div class="stat-value blue">${num(hourRows.length)}</div><div class="stat-note">cekaji na potvrzeni</div></div>
      <div class="stat"><div class="stat-label">Dokumenty/start/zalohy</div><div class="stat-value warn">${num(documentRows.length + checkinRows.length + advanceRows.length)}</div><div class="stat-note">nove udalosti</div></div>
    </div>
    ${dashboardSections}`);
}

function table(headers, rows, className = '') {
  return `<div class="table-wrap ${esc(className)}"><table data-sortable-table><thead><tr>${headers.map((h, i) => `<th><button class="table-sort" type="button" onclick="Pokladna.sortTable(this, ${i})"><span>${esc(h)}</span><b></b></button></th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, i) => `<td data-label="${esc(headers[i] || '')}">${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function adminPLHeroCard(data = {}) {
  const income = Number(data.dashboard_income ?? data.cash_income ?? 0);
  const expenses = Number(data.dashboard_expense ?? (Number(data.cash_expense || 0) + Number(data.salary_paid_expense || data.salary_net || 0)));
  const profitValue = data.dashboard_profit === null || data.dashboard_profit === undefined ? null : Number(data.dashboard_profit);
  const payout = Number(data.salary_paid_expense || 0);
  const incomeMissing = !!data.dashboard_income_missing || income <= 0;
  const ratio = income > 0 && Number.isFinite(profitValue) ? Math.max(0, Math.min(100, (profitValue / income) * 100)) : 0;
  const company = state.companyId
    ? (state.cache.companies || []).find(c => String(c.id) === String(state.companyId))?.name || 'Vybrana firma'
    : 'Vsechny firmy';
  return `<section class="pl-hero-card">
    <div class="pl-hero-main">
      <span>${incomeMissing ? 'P&L ceka na prijem' : 'Cisty profit'} · ${esc(company)}</span>
      <strong class="${incomeMissing ? 'is-missing warn' : profitValue < 0 ? 'danger' : ''}">${incomeMissing ? 'Zadat prijem' : czk(profitValue)}</strong>
      <div class="pl-progress" aria-hidden="true"><i style="width:${ratio}%"></i></div>
      ${incomeMissing ? `<small class="pl-hero-note">Do pokladny neni vlozen prijem za obdobi, proto system neukazuje falesny minus.</small>${can('cash.write') ? '<button class="btn sm primary pl-income-btn" type="button" onclick="Pokladna.cash()">Zadat prijem do pokladny</button>' : ''}` : ''}
    </div>
    <div class="pl-hero-grid">
      <div><b class="blue">${czk(income)}</b><small>Prijem</small></div>
      <div><b class="danger">${czk(expenses)}</b><small>Vydaj</small></div>
      <div><b class="warn">${czk(payout)}</b><small>Vyplaceno</small></div>
    </div>
  </section>`;
}

function sortValue(text) {
  const raw = String(text || '').trim();
  const compact = raw.replace(/\s+/g, ' ');
  const numberCandidate = compact.replace(/[^\d,.\-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (/\d/.test(numberCandidate) && numberCandidate !== '-' && Number.isFinite(Number(numberCandidate))) {
    return { type: 'number', value: Number(numberCandidate) };
  }
  const date = Date.parse(compact.replace(/^(\d{2})\.(\d{2})\.(\d{4})/, '$3-$2-$1'));
  if (Number.isFinite(date) && /\d{4}|\d{1,2}\.\d{1,2}\./.test(compact)) {
    return { type: 'number', value: date };
  }
  return { type: 'text', value: compact.toLocaleLowerCase('cs-CZ') };
}

function sortTable(button, index) {
  const tableEl = button.closest('table');
  const tbody = tableEl?.querySelector('tbody');
  if (!tbody) return;
  const dir = button.dataset.dir === 'asc' ? 'desc' : 'asc';
  tableEl.querySelectorAll('.table-sort').forEach(btn => {
    btn.dataset.dir = '';
    const marker = btn.querySelector('b');
    if (marker) marker.textContent = '';
  });
  button.dataset.dir = dir;
  const icon = button.querySelector('b');
  if (icon) icon.textContent = dir === 'asc' ? '\u2191' : '\u2193';
  const rows = Array.from(tbody.querySelectorAll('tr'));
  rows.sort((a, b) => {
    const av = sortValue(a.children[index]?.textContent || '');
    const bv = sortValue(b.children[index]?.textContent || '');
    const compare = av.type === 'number' && bv.type === 'number'
      ? av.value - bv.value
      : String(av.value).localeCompare(String(bv.value), 'cs');
    return dir === 'asc' ? compare : -compare;
  });
  rows.forEach(row => tbody.appendChild(row));
}

async function renderCompanies() {
  loading('Firmy');
  const [companies, objects] = await Promise.all([
    api('companies'),
    api('objects').catch(() => ({ data: [] })),
  ]);
  const data = companies.data || [];
  state.cache.companies = data;
  state.cache.objects = objects.data || [];
  const rows = data.map(c => {
    const objectNames = c.object_names || (state.cache.objects || [])
      .filter(o => Number(o.company_id) === Number(c.id) && o.status !== 'archived')
      .map(o => o.name)
      .join(', ');
    return [
    `<button class="link link-button" type="button" onclick="Pokladna.companyProfile(${c.id})"><strong>${esc(c.name)}</strong></button><div class="muted">${esc(c.ico || '')} ${esc(c.dic || '')}</div>`,
    `<span class="mono">${num(c.objects_count || 0)}</span><div class="muted">${esc(objectNames || '-')}</div>`,
    esc(c.address || '-'),
    `<div>${esc(c.contact_person || '-')}</div><div class="muted">${esc(c.phone || '')} ${esc(c.email || '')}</div>`,
    `<span class="mono">${num(c.employees_count)}</span>`,
    `<button class="btn sm" onclick="Pokladna.companyProfile(${c.id})">Detail</button> ${can('companies.write') ? `<button class="btn sm" onclick="Pokladna.company(${c.id})">Upravit</button> <button class="btn sm danger" onclick="Pokladna.deleteCompany(${c.id})">Smazat</button>` : ''}`,
    ];
  });
  setContent(`${head('Firmy', `${data.length} zaznamu`, can('companies.write') ? '<button class="btn primary" onclick="Pokladna.company()">Nova firma</button>' : '')}${rows.length ? table(['Firma','Objekty','Adresa','Kontakt','Lide','Akce'], rows) : '<div class="card empty">Zadne firmy</div>'}`);
}

async function openCompanyProfile(id) {
  const company = (state.cache.companies || []).find(c => Number(c.id) === Number(id)) || {};
  const [employees, objects, sim, vehicles, tools, housing] = await Promise.all([
    api(`employees?status=all&company_id=${id}`).catch(() => ({ data: [] })),
    api(`objects?company_id=${id}`).catch(() => ({ data: [] })),
    api(`resources/sim_cards?company_id=${id}`).catch(() => ({ data: [] })),
    api(`resources/vehicles?company_id=${id}`).catch(() => ({ data: [] })),
    api(`resources/tools?company_id=${id}`).catch(() => ({ data: [] })),
    api(`resources/accommodations?company_id=${id}`).catch(() => ({ data: [] })),
  ]);
  const activeEmployees = (employees.data || []).filter(e => e.status !== 'archived');
  const employeeRows = activeEmployees.map(e => [
    employeeNameCell(e, { meta: `${e.object_name || '-'} / ${czk(e.hourly_rate || 0)}`, size: 'sm' }),
    esc(e.phone || '-'),
    esc(e.email || '-'),
    `<button class="btn sm" onclick="document.querySelector('.modal-backdrop')?.remove(); Pokladna.profile(${e.id})">Profil</button>`,
  ]);
  const objectRows = (objects.data || []).map(o => [
    `<button class="link link-button" type="button" onclick="document.querySelector('.modal-backdrop')?.remove(); Pokladna.objectProfile(${o.id})"><strong>${esc(o.name)}</strong></button>`,
    esc(o.work_type || 'general'),
    `<span class="mono">${num(o.employees_count || 0)}</span>`,
    esc(o.address || '-'),
  ]);
  const assetRows = [
    ...(sim.data || []).map(r => ['SIM', esc(r.phone_number || '-'), esc(r.employee_name || r.registered_to || '-'), esc(r.status || '-')]),
    ...(vehicles.data || []).map(r => ['Auto', esc(r.plate_number || '-'), esc(r.employee_name || '-'), esc(r.status || '-')]),
    ...(tools.data || []).map(r => ['Nastroj', esc(r.name || '-'), esc(r.employee_name || '-'), esc(r.status || '-')]),
    ...(housing.data || []).map(r => ['Bydleni', esc(r.name || '-'), esc(r.occupant_names || '-'), `${num(r.occupants_count || 0)} lidi`]),
  ];
  modal(`Firma: ${esc(company.name || '')}`, `
    <div class="grid grid-4" style="margin-bottom:16px">
      <div class="stat"><div class="stat-label">Pracovnici</div><div class="stat-value accent">${num(activeEmployees.length)}</div><div class="stat-note">aktivni</div></div>
      <div class="stat"><div class="stat-label">Objekty</div><div class="stat-value blue">${num((objects.data || []).length)}</div><div class="stat-note">skupiny a mista</div></div>
      <div class="stat"><div class="stat-label">Majetek</div><div class="stat-value warn">${num(assetRows.length)}</div><div class="stat-note">SIM, auta, nastroje, bydleni</div></div>
      <div class="stat"><div class="stat-label">Kontakt</div><div class="stat-value">${esc(company.contact_person || '-')}</div><div class="stat-note">${esc(company.phone || company.email || '')}</div></div>
    </div>
    <div class="section-title">Pracovnici firmy</div>
    ${employeeRows.length ? table(['Pracovnik','Telefon','E-mail','Akce'], employeeRows, 'compact-table') : '<div class="card empty">Zadni pracovnici</div>'}
    <div class="section-title">Objekty a skupiny</div>
    ${objectRows.length ? table(['Objekt','Typ','Lide','Adresa'], objectRows, 'compact-table') : '<div class="card empty">Zadne objekty</div>'}
    <div class="section-title">Majetek a bydleni</div>
    ${assetRows.length ? table(['Typ','Nazev','Vazba','Stav'], assetRows, 'compact-table') : '<div class="card empty">Zadny majetek navazany na firmu</div>'}
  `);
}

function openCompany(id) {
  const row = id ? state.cache.companies.find(c => Number(c.id) === Number(id)) : {};
  const assignedObjectIds = new Set((state.cache.objects || [])
    .filter(o => Number(o.company_id) === Number(id))
    .map(o => Number(o.id)));
  const objectChoices = (state.cache.objects || []).length
    ? `<div class="section-title">Objekty firmy</div>
      <div class="permission-grid">
        ${(state.cache.objects || []).map(o => {
          const currentCompany = (state.cache.companies || []).find(c => Number(c.id) === Number(o.company_id));
          return `<label class="checkline"><input type="checkbox" name="object_ids[]" value="${o.id}" ${assignedObjectIds.has(Number(o.id)) ? 'checked' : ''}> <span>${esc(o.name)}<small>${esc(currentCompany?.name ? ` / ${currentCompany.name}` : ' / bez firmy')}</small></span></label>`;
        }).join('')}
      </div>`
    : '<div class="card empty">Nejdrive vytvorte objekty v sekci Objekty</div>';
  modal(id ? 'Upravit firmu' : 'Nova firma', `
    <div class="form-grid">
      <div class="field"><label>Nazev</label><input class="input" name="name" value="${esc(row.name)}" required></div>
      <div class="field"><label>ICO</label><input class="input" name="ico" value="${esc(row.ico)}"></div>
      <div class="field"><label>DIC</label><input class="input" name="dic" value="${esc(row.dic)}"></div>
      <div class="field"><label>Kontakt</label><input class="input" name="contact_person" value="${esc(row.contact_person)}"></div>
      <div class="field"><label>Telefon</label><input class="input" name="phone" value="${esc(row.phone)}"></div>
      <div class="field"><label>E-mail</label><input class="input" name="email" type="email" value="${esc(row.email)}"></div>
    </div>
    <div class="field"><label>Adresa</label><textarea name="address">${esc(row.address)}</textarea></div>
    <div class="field"><label>Poznamka</label><textarea name="notes">${esc(row.notes)}</textarea></div>
    ${objectChoices}`,
    (_data, form) => {
      const formData = new FormData(form);
      const data = Object.fromEntries(formData);
      data.object_ids = formData.getAll('object_ids[]').map(Number).filter(Boolean);
      delete data['object_ids[]'];
      return api(id ? `companies/${id}` : 'companies', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
    });
}

async function renderEmployees() {
  loading('Dokumenty');
  const [employees, objects, companies, accommodations] = await Promise.all([
    api(withCompany('employees')),
    api(withCompany('objects')).catch(() => ({ data: [] })),
    api('companies').catch(() => ({ data: [] })),
    api(withCompany('resources/accommodations')).catch(() => ({ data: [] })),
  ]);
  state.cache.employees = employees.data;
  state.cache.objects = objects.data;
  state.cache.companies = companies.data;
  state.cache.accommodations = accommodations.data;
  const rows = employees.data.map(e => [
    employeeNameCell(e),
    esc(e.company_name || '-'),
    esc(e.object_name || '-'),
    esc(e.contract_type || '-'),
    `<span class="mono">${czk(e.hourly_rate)}</span>`,
    `<span class="badge">${esc(e.status)}</span>`,
    `<button class="btn sm" onclick="Pokladna.profile(${e.id})">Profil</button> <button class="btn sm" onclick="Pokladna.employeeChat(${e.id})">Chat</button> ${can('documents.view') ? `<button class="btn sm primary" onclick="Pokladna.documents(${e.id}, 'personal')">Slozka</button> <button class="btn sm" onclick="Pokladna.documents(${e.id}, 'jmhz')">Dotaznik JMHZ</button>` : ''} ${can('employees.write') ? `<button class="btn sm" onclick="Pokladna.employee(${e.id})">Upravit</button> <button class="btn sm danger" onclick="Pokladna.archiveEmployee(${e.id})">Archiv</button>` : ''}`,
  ]);
  const actions = `${exportButton('employees')} ${can('employees.write') ? '<button class="btn primary" onclick="Pokladna.employee()">Novy zamestnanec</button>' : ''}`;
  const intro = `<div class="document-mode-grid">
    <button class="document-mode-card document-mode-action" type="button" onclick="Pokladna.documentQuick('personal')">
      <span>${buildcrewNavIcon('file')}</span>
      <div><strong>Osobni slozka pracovnika</strong><small>foto, pas, viza, pojisteni, smlouva, telefon, adresa a interni poznamky.</small></div>
    </button>
    <button class="document-mode-card document-mode-action" type="button" onclick="Pokladna.documentQuick('jmhz')">
      <span>${buildcrewNavIcon('contract')}</span>
      <div><strong>Dotaznik JMHZ</strong><small>samostatna cast pro udaje, ktere se pripravuji a kopiruji pro urad.</small></div>
    </button>
  </div>`;
  setContent(`${head('Dokumenty', `${employees.data.length} aktivnich zamestnancu`, actions)}${intro}${rows.length ? table(['Jmeno','Firma','Objekt','Kontrakt','Sazba','Stav','Akce'], rows) : '<div class="card empty">Zadne aktivni zaznamy</div>'}`);
}

async function renderEmployeeArchive() {
  loading('Archiv zamestnancu');
  const [employees, objects, companies, accommodations] = await Promise.all([
    api(withCompany('employees?status=archived')),
    api(withCompany('objects')).catch(() => ({ data: [] })),
    api('companies').catch(() => ({ data: [] })),
    api(withCompany('resources/accommodations')).catch(() => ({ data: [] })),
  ]);
  state.cache.employees = employees.data;
  state.cache.objects = objects.data;
  state.cache.companies = companies.data;
  state.cache.accommodations = accommodations.data;
  const rows = employees.data.map(e => [
    employeeNameCell(e),
    esc(e.company_name || '-'),
    esc(e.object_name || '-'),
    esc(e.contract_type || '-'),
    `<span class="mono">${czk(e.hourly_rate)}</span>`,
    esc(e.archived_at || '-'),
    `<button class="btn sm" onclick="Pokladna.profile(${e.id})">Profil</button> ${can('employees.write') ? `<button class="btn sm" onclick="Pokladna.employee(${e.id})">Upravit</button> <button class="btn sm primary" onclick="Pokladna.restoreEmployee(${e.id})">Obnovit</button> <button class="btn sm danger" onclick="Pokladna.deleteEmployeeForce(${e.id})">Smazat</button>` : ''} ${can('documents.view') ? `<button class="btn sm" onclick="Pokladna.documents(${e.id})">Dokumenty</button>` : ''}`,
  ]);
  const actions = `${exportButton('employee_archive')} <button class="btn" onclick="Pokladna.go('employees')">Aktivni zamestnanci</button>`;
  setContent(`${head('Archiv zamestnancu', `${employees.data.length} archivnich`, actions)}${rows.length ? table(['Jmeno','Firma','Objekt','Kontrakt','Sazba','Archivovano','Akce'], rows) : '<div class="card empty">Archiv je prazdny</div>'}`);
}

function employeeForm(row = {}) {
  const j = jsonObject(row.jmhz_questionnaire);
  return `
    <div class="form-grid">
      <div class="field"><label>Jmeno</label><input class="input" name="name" value="${esc(row.name)}" required></div>
      <div class="field"><label>Telefon</label><input class="input" name="phone" value="${esc(row.phone)}"></div>
      <div class="field"><label>E-mail</label><input class="input" name="email" type="email" value="${esc(row.email)}"></div>
      <div class="field"><label>Sklad e-mail</label><input class="input" name="warehouse_email" type="email" value="${esc(row.warehouse_email)}"></div>
      <div class="field"><label>Hodinova sazba</label><input class="input" name="hourly_rate" type="number" step="0.01" value="${esc(row.hourly_rate || 0)}"></div>
      <div class="field"><label>Bydleni</label><input class="input" name="housing_cost" type="number" step="0.01" value="${esc(row.housing_cost || 0)}"></div>
      <div class="field"><label>Firma</label><select class="select" name="company_id" onchange="Pokladna.syncObjectSelect(this.form)">${optionList(state.cache.companies || [], row.company_id)}</select></div>
      <div class="field"><label>Objekt</label><select class="select" name="object_id">${objectOptionList(state.cache.objects || [], row.object_id, row.company_id)}</select></div>
      <div class="field"><label>Bydleni</label><select class="select" name="accommodation_id">${optionList(state.cache.accommodations || [], row.accommodation_id)}</select></div>
      <div class="field"><label>Stav</label><select class="select" name="status"><option value="active" ${row.status !== 'archived' ? 'selected' : ''}>active</option><option value="archived" ${row.status === 'archived' ? 'selected' : ''}>archived</option></select></div>
      <div class="field"><label>Datum narozeni</label><input class="input" name="birth_date" type="date" value="${esc(row.birth_date)}"></div>
      <div class="field"><label>Rodne cislo</label><input class="input" name="personal_id_number" value="${esc(row.personal_id_number)}"></div>
      <div class="field"><label>Pas</label><input class="input" name="passport_number" value="${esc(row.passport_number)}"></div>
      <div class="field"><label>Pas platny do</label><input class="input" name="passport_valid_until" type="date" value="${esc(row.passport_valid_until)}"></div>
      <div class="field"><label>Nouzovy kontakt</label><input class="input" name="emergency_contact" value="${esc(row.emergency_contact)}"></div>
      <div class="field"><label>Bankovni ucet</label><input class="input" name="bank_account" value="${esc(row.bank_account)}"></div>
      <div class="field"><label>Kontrakt</label><input class="input" name="contract_type" list="contractTypeOptions" value="${esc(row.contract_type)}" placeholder="HPP / DPP / DPC / Zivnost"><datalist id="contractTypeOptions"><option value="HPP"><option value="DPP"><option value="DPC"><option value="Zivnost"></datalist></div>
      <div class="field"><label>Cislo kontraktu</label><input class="input" name="contract_number" value="${esc(row.contract_number)}"></div>
      <div class="field"><label>Kontrakt od</label><input class="input" name="contract_start" type="date" value="${esc(row.contract_start)}"></div>
      <div class="field"><label>Kontrakt do</label><input class="input" name="contract_end" type="date" value="${esc(row.contract_end)}"></div>
    </div>
    <div class="field"><label>Adresa</label><textarea name="address">${esc(row.address)}</textarea></div>
    <div class="field"><label>Adresa bydleni</label><textarea name="residence_address">${esc(row.residence_address)}</textarea></div>
    <div class="section-title">Osobni dotaznik zamestnance pro registraci a JMHZ</div>
    <div class="form-grid">
      ${jmhzField(j, 'jmhz_first_names', 'Jmeno / jmena')}
      ${jmhzField(j, 'jmhz_last_name', 'Prijmeni')}
      ${jmhzField(j, 'jmhz_titles', 'Tituly')}
      ${jmhzField(j, 'jmhz_birth_surname', 'Rodne prijmeni')}
      ${jmhzField(j, 'jmhz_previous_surnames', 'Drivejsi prijmeni')}
      <div class="field"><label>Pohlavi</label><select class="select" name="jmhz_gender"><option value="">Nevybrano</option><option value="M" ${j.jmhz_gender === 'M' ? 'selected' : ''}>muz</option><option value="F" ${j.jmhz_gender === 'F' ? 'selected' : ''}>zena</option></select></div>
      ${jmhzField(j, 'jmhz_birth_place', 'Misto narozeni')}
      ${jmhzField(j, 'jmhz_birth_country', 'Stat narozeni')}
      ${jmhzField(j, 'jmhz_citizenship', 'Statni obcanstvi')}
      ${jmhzField(j, 'jmhz_education_level', 'Nejvyssi dosazene vzdelani')}
      ${jmhzField(j, 'jmhz_id_document_type', 'Typ dokladu totoznosti')}
      ${jmhzField(j, 'jmhz_id_document_number', 'Cislo dokladu totoznosti')}
    </div>
    <div class="section-title">Trvaly pobyt</div>
    <div class="form-grid">
      ${jmhzField(j, 'jmhz_permanent_street', 'Ulice')}
      ${jmhzField(j, 'jmhz_permanent_house_number', 'Cislo popisne')}
      ${jmhzField(j, 'jmhz_permanent_orientation_number', 'Cislo orientacni')}
      ${jmhzField(j, 'jmhz_permanent_zip', 'PSC')}
      ${jmhzField(j, 'jmhz_permanent_city', 'Obec')}
      ${jmhzField(j, 'jmhz_permanent_country', 'Stat')}
      ${jmhzField(j, 'jmhz_permanent_ruian', 'Kod adresniho mista / RUIAN')}
    </div>
    <div class="section-title">Kontaktni adresa</div>
    <div class="form-grid">
      ${jmhzField(j, 'jmhz_contact_street', 'Ulice')}
      ${jmhzField(j, 'jmhz_contact_house_number', 'Cislo popisne')}
      ${jmhzField(j, 'jmhz_contact_orientation_number', 'Cislo orientacni')}
      ${jmhzField(j, 'jmhz_contact_zip', 'PSC')}
      ${jmhzField(j, 'jmhz_contact_city', 'Obec')}
      ${jmhzField(j, 'jmhz_contact_country', 'Stat')}
      ${jmhzField(j, 'jmhz_contact_ruian', 'Kod adresniho mista / RUIAN')}
    </div>
    <div class="section-title">Registrace, pojisteni a JMHZ</div>
    <div class="form-grid">
      ${jmhzField(j, 'jmhz_data_box', 'Datova schranka')}
      ${jmhzField(j, 'jmhz_electronic_communication', 'Elektronicka komunikace')}
      ${jmhzField(j, 'jmhz_ecommunication_password', 'Heslo pro elektronickou komunikaci')}
      ${jmhzField(j, 'jmhz_health_insurance_company', 'Zdravotni pojistovna')}
      ${jmhzField(j, 'jmhz_tax_residence', 'Danova rezidence')}
      <div class="field"><label>Prohlaseni poplatnika</label><select class="select" name="jmhz_tax_declaration"><option value="">Nevybrano</option><option value="ano" ${j.jmhz_tax_declaration === 'ano' ? 'selected' : ''}>ano</option><option value="ne" ${j.jmhz_tax_declaration === 'ne' ? 'selected' : ''}>ne</option></select></div>
      ${jmhzField(j, 'jmhz_disability_pension', 'Invalidni duchod / stupen')}
      ${jmhzField(j, 'jmhz_student', 'Student')}
      ${jmhzField(j, 'jmhz_pension', 'Starobni duchod')}
      ${jmhzField(j, 'jmhz_children_count', 'Pocet deti', 'type="number" min="0"')}
      ${jmhzField(j, 'jmhz_cz_isco', 'CZ-ISCO / druh prace')}
      ${jmhzField(j, 'jmhz_weekly_hours', 'Tydenni uvazek hodin', 'type="number" step="0.01"')}
      ${jmhzField(j, 'jmhz_foreigner_status', 'Cizinec - typ pobytu/viza')}
      ${jmhzField(j, 'jmhz_work_permit_number', 'Cislo pracovniho povoleni')}
      ${jmhzField(j, 'jmhz_work_permit_valid_until', 'Pracovni povoleni platne do', 'type="date"')}
      ${jmhzField(j, 'jmhz_residence_permit_number', 'Cislo povoleni k pobytu')}
      ${jmhzField(j, 'jmhz_residence_permit_valid_until', 'Povoleni k pobytu platne do', 'type="date"')}
    </div>
    <div class="field"><label>JMHZ - poznamka</label><textarea name="jmhz_notes">${esc(j.jmhz_notes || '')}</textarea></div>
    <div class="field"><label>Dokumenty - poznamka</label><textarea name="documents_note">${esc(row.documents_note)}</textarea></div>
    <div class="field"><label>Poznamka</label><textarea name="notes">${esc(row.notes)}</textarea></div>`;
}

async function openEmployee(id) {
  const row = id ? state.cache.employees.find(e => Number(e.id) === Number(id)) : {};
  modal(id ? 'Upravit zamestnance' : 'Novy zamestnanec', employeeForm(row), data => api(id ? `employees/${id}` : 'employees', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) }));
}

function openAvatar(employeeId) {
  const employee = (state.cache.employees || []).find(e => Number(e.id) === Number(employeeId)) || {};
  modal('Avatar pracovnika', `
    <div class="avatar-upload-preview">${employeeAvatar(employee, 'xl')}</div>
    <input type="hidden" name="employee_id" value="${employeeId}">
    <div class="field"><label>Fotka</label><input class="input" name="file" type="file" accept="image/jpeg,image/png,image/webp" required></div>
    <div class="muted">JPG, PNG nebo WEBP do 4 MB. Avatar uvidi administrator u jmena a pracovnik ve svem kabinetu.</div>`,
    async (_data, form) => {
      await api(`employees/${employeeId}/avatar`, { method: 'POST', body: new FormData(form) });
      await preloadEmployeeContext();
    },
    'Nahrat avatar');
}

async function openEmployeeProfile(id) {
  let row = (state.cache.employees || []).find(e => Number(e.id) === Number(id));
  if (!row) {
    const employees = await api(withCompany('employees?status=all'));
    state.cache.employees = employees.data || [];
    row = state.cache.employees.find(e => Number(e.id) === Number(id));
  }
  if (!row) {
    toast('Zamestnanec nenalezen', 'danger');
    return;
  }
  const docsResult = can('documents.view')
    ? await api(`documents?employee_id=${id}`).catch(err => ({ data: [], error: err.message }))
    : { data: [], error: '' };
  const advancesResult = can('advances.view')
    ? await api(`advances?employee_id=${id}&all=1`).catch(() => ({ data: [] }))
    : { data: [] };
  const docs = docsResult.data || [];
  const advances = advancesResult.data || [];
  const j = jsonObject(row.jmhz_questionnaire);
  const isOwnProfile = Number(id) === Number(state.user?.employee_id);
  const canEditProfile = can('employees.write') && canManage();
  const canEditSelf = isOwnProfile;
  const canOpenDocs = can('documents.view');
  const actions = [
    canEditProfile ? `<button class="btn sm" type="button" onclick="document.querySelector('.modal-backdrop')?.remove(); Pokladna.employee(${id})">Upravit udaje</button>` : '',
    !canEditProfile && canEditSelf ? `<button class="btn sm" type="button" onclick="document.querySelector('.modal-backdrop')?.remove(); Pokladna.selfProfile()">Upravit moje udaje</button>` : '',
    (canEditProfile || canEditSelf) ? `<button class="btn sm" type="button" onclick="document.querySelector('.modal-backdrop')?.remove(); Pokladna.avatar(${id})">Nahrat avatar</button>` : '',
    isGlobalUser() ? `<button class="btn sm" type="button" onclick="document.querySelector('.modal-backdrop')?.remove(); Pokladna.employeeChat(${id})">Chat</button>` : '',
    canOpenDocs ? `<button class="btn sm" type="button" onclick="document.querySelector('.modal-backdrop')?.remove(); Pokladna.documents(${id})">${canUploadDocuments(id) ? 'Dokumenty / nahrat' : 'Dokumenty'}</button>` : '',
    can('advances.write') ? `<button class="btn sm primary" type="button" onclick="document.querySelector('.modal-backdrop')?.remove(); Pokladna.advanceFor(${id})">Dat zalohu</button>` : '',
  ].filter(Boolean).join(' ');
  const docsRows = docs.map(d => [
    esc(d.document_type || '-'),
    `<strong>${esc(d.title || '-')}</strong><div class="muted">${esc(d.note || '')}</div>`,
    `${esc(d.issued_at || '-')} - ${esc(d.expires_at || '-')}`,
    documentStatusBadge(d.status),
    documentDownloadLink(d),
    esc(d.uploaded_by_name || '-'),
  ]);
  const docsHtml = docsResult.error
    ? `<div class="error">${esc(docsResult.error)}</div>`
    : docsRows.length ? table(['Typ','Nazev','Platnost','Stav','Soubor','Nahral'], docsRows) : '<div class="card empty">Zadne dokumenty</div>';
  const advanceRows = advances.map(a => [
    esc(a.date || '-'),
    `<span class="mono warn">${czk(a.amount)}</span>`,
    `<span class="badge ${a.status === 'approved' ? 'accent' : a.status === 'rejected' ? 'danger' : 'warn'}">${esc(a.status || '-')}</span>`,
    esc(a.paid_at || '-'),
    esc(a.note || ''),
  ]);
  modal(`Profil: ${esc(row.name || '')}`, `
    <div class="profile-head">
      <div class="person-cell profile-person">
        ${employeeAvatar(row, 'xl')}
        <div class="person-main">
          <div class="profile-name">${esc(row.name || '-')}</div>
          <div class="muted">${esc(row.company_name || '-')} / ${esc(row.object_name || '-')}</div>
        </div>
      </div>
      <div class="actions">${actions}</div>
    </div>
    <div class="section-title">Osobni informace</div>
    <div class="profile-grid profile-grid-3">
      ${profileCell('Jmeno', row.name)}
      ${profileCell('Stav', row.status)}
      ${profileCell('Firma', row.company_name)}
      ${profileCell('Objekt', row.object_name)}
      ${profileCell('Bydleni', row.accommodation_name || row.residence_address)}
      ${profileCell('Telefon', row.phone)}
      ${profileCell('E-mail', row.email)}
      ${profileCell('Sklad e-mail', row.warehouse_email)}
      ${profileCell('Hodinova sazba', czk(row.hourly_rate))}
      ${profileCell('Cena bydleni', czk(row.housing_cost))}
      ${profileCell('Datum narozeni', row.birth_date)}
      ${profileCell('Rodne cislo', row.personal_id_number)}
    </div>
    <div class="section-title">Doklady a smlouva</div>
    <div class="profile-grid profile-grid-3">
      ${profileCell('Pas', row.passport_number)}
      ${profileCell('Pas platny do', row.passport_valid_until)}
      ${profileCell('Nouzovy kontakt', row.emergency_contact)}
      ${profileCell('Bankovni ucet', row.bank_account)}
      ${profileCell('Kontrakt', row.contract_type)}
      ${profileCell('Cislo kontraktu', row.contract_number)}
      ${profileCell('Kontrakt od', row.contract_start)}
      ${profileCell('Kontrakt do', row.contract_end)}
      ${profileCell('Adresa', row.address)}
      ${profileCell('Adresa bydleni', row.residence_address)}
      ${profileCell('Dokumenty - poznamka', row.documents_note)}
      ${profileCell('Poznamka', row.notes)}
    </div>
    <div class="section-title">Osobni dotaznik zamestnance pro registraci a JMHZ</div>
    ${jmhzProfileGrid(j)}
    <div class="section-title">Zalohy a historie</div>
    ${advanceRows.length ? table(['Datum','Castka','Stav','Vyplaceno','Poznamka'], advanceRows, 'compact-table') : '<div class="card empty">Zadne zalohy</div>'}
    <div class="section-title">Dokumenty</div>
    ${docsHtml}
  `);
}

async function openDocuments(employeeId, focus = 'personal') {
  let employee = state.cache.employees?.find(e => Number(e.id) === Number(employeeId));
  if (!employee) {
    const employees = await api(withCompany('employees?status=all')).catch(() => ({ data: [] }));
    state.cache.employees = employees.data || [];
    employee = state.cache.employees.find(e => Number(e.id) === Number(employeeId));
  }
  employee = employee || { id: employeeId };
  const docs = await api(`documents?employee_id=${employeeId}`);
  const canUpload = canUploadDocuments(employeeId);
  const isOwnEmployee = Number(employeeId) === Number(state.user?.employee_id);
  const canEditJmhz = can('employees.write') || isOwnEmployee;
  const j = jsonObject(employee.jmhz_questionnaire);
  const docsData = docs.data || [];
  const docRows = docsData.map(d => [
    esc(documentTypeLabel(d.document_type)),
    `<strong>${esc(d.title)}</strong><div class="muted">${esc(d.note || d.original_name || '')}</div>`,
    `${esc(d.issued_at || '-')} - ${esc(d.expires_at || '-')}`,
    documentStatusBadge(d.status),
    documentDownloadLink(d),
    can('documents.write') && canManage() ? `<button type="button" class="btn sm danger" onclick="Pokladna.deleteDocument(${d.id}, ${employeeId})">Smazat</button>` : '',
  ]);
  const uploadHtml = canUpload ? `
    <div class="document-upload-panel" id="documentUpload-${esc(employeeId)}">
      <div class="section-title">Nahrat do osobni slozky</div>
      <input type="hidden" name="employee_id" value="${esc(employeeId)}">
      <div class="form-grid">
        <div class="field"><label>Typ</label><select class="select" name="document_type">${documentTypeOptions()}</select></div>
        <div class="field"><label>Nazev</label><input class="input" name="title" required placeholder="napr. Viza, pas, pojisteni"></div>
        <div class="field"><label>Vydano</label><input class="input" name="issued_at" type="date"></div>
        <div class="field"><label>Platne do</label><input class="input" name="expires_at" type="date"></div>
      </div>
      <div class="field"><label>Soubor / foto dokumentu</label><input class="input" name="file" type="file" accept="image/*,.pdf,.doc,.docx" required></div>
      <div class="field"><label>Poznamka</label><textarea name="note"></textarea></div>
      <button class="btn primary" type="button" onclick="Pokladna.uploadDocument(${Number(employeeId)})">Nahrat dokument</button>
    </div>` : '<div class="card empty">Nemate opravneni nahravat dokumenty.</div>';
  const jmhzFilled = jmhzProfileFields.filter(([key]) => String(j[key] || '').trim() !== '').length;
  const activeFocus = focus === 'jmhz' ? 'jmhz' : 'personal';
  const documentModeSwitcher = `
    <div class="document-mode-grid document-mode-switcher">
      <button class="document-mode-card document-mode-action ${activeFocus === 'personal' ? 'active' : ''}" type="button" onclick="Pokladna.documentMode(${Number(employeeId)}, 'personal')">
        <span>${buildcrewNavIcon('file')}</span>
        <div><strong>Osobni slozka pracovnika</strong><small>${num(docsData.length)} souboru, ulozene osobni udaje a doklady.</small></div>
      </button>
      <button class="document-mode-card document-mode-action ${activeFocus === 'jmhz' ? 'active' : ''}" type="button" onclick="Pokladna.documentMode(${Number(employeeId)}, 'jmhz')">
        <span>${buildcrewNavIcon('contract')}</span>
        <div><strong>Dotaznik JMHZ</strong><small>${num(jmhzFilled)} vyplnenych poli pro urad.</small></div>
      </button>
    </div>`;
  modal(`Dokumenty: ${esc(employee.name || '')}`, `
    <div class="document-dashboard" data-focus="${esc(activeFocus)}">
      <section class="document-person-card">
        <div class="person-cell profile-person">
          ${employeeAvatar(employee, 'xl')}
          <div class="person-main">
            <div class="profile-name">${esc(employee.name || '-')}</div>
            <div class="muted">${esc(employee.company_name || '-')} / ${esc(employee.object_name || '-')}</div>
            <div class="muted">${esc(employee.contract_type || '-')} / ${czk(employee.hourly_rate || 0)}/h</div>
          </div>
        </div>
        <div class="document-person-actions">
          ${can('employees.write') && canManage() ? `<button class="btn sm" type="button" onclick="document.querySelector('.modal-backdrop')?.remove(); Pokladna.employee(${Number(employeeId)})">Upravit kartu</button>` : ''}
          ${!canManage() && isOwnEmployee ? `<button class="btn sm" type="button" onclick="document.querySelector('.modal-backdrop')?.remove(); Pokladna.selfProfile()">Moje udaje</button>` : ''}
          ${(canManage() || isOwnEmployee) ? `<button class="btn sm" type="button" onclick="document.querySelector('.modal-backdrop')?.remove(); Pokladna.avatar(${Number(employeeId)})">Foto profilu</button>` : ''}
          <button class="btn sm" type="button" onclick="Pokladna.copyJmhz(${Number(employeeId)})">Kopirovat JMHZ</button>
        </div>
      </section>
      ${documentModeSwitcher}

      <section class="document-block document-panel" id="personalFolder-${esc(employeeId)}" data-document-panel="personal" ${activeFocus === 'personal' ? '' : 'hidden'}>
        <div class="document-block-head">
          <div><span>1</span><strong>Osobni slozka pracovnika</strong><small>foto, pas, viza, pojisteni, smlouva a kontaktni informace.</small></div>
          <b>${num(docsData.length)} souboru</b>
        </div>
        <div class="profile-grid profile-grid-3">
          ${profileCell('Telefon', employee.phone)}
          ${profileCell('E-mail', employee.email)}
          ${profileCell('Datum narozeni', employee.birth_date)}
          ${profileCell('Rodne cislo', employee.personal_id_number)}
          ${profileCell('Pas', employee.passport_number)}
          ${profileCell('Pas platny do', employee.passport_valid_until)}
          ${profileCell('Adresa', employee.address)}
          ${profileCell('Bydleni', employee.residence_address || employee.accommodation_name)}
          ${profileCell('Nouzovy kontakt', employee.emergency_contact)}
          ${profileCell('Bankovni ucet', employee.bank_account)}
          ${profileCell('Kontrakt', employee.contract_type)}
          ${profileCell('Cislo kontraktu', employee.contract_number)}
        </div>
        <div class="document-preview-grid">
          ${docsData.length ? docsData.map(documentPreviewCard).join('') : '<div class="card empty">Zadne nahrane dokumenty</div>'}
        </div>
        ${docRows.length ? table(['Typ','Nazev','Platnost','Stav','Soubor','Akce'], docRows, 'compact-table') : ''}
        ${uploadHtml}
      </section>

      <section class="document-block jmhz-block document-panel" id="jmhzFolder-${esc(employeeId)}" data-document-panel="jmhz" ${activeFocus === 'jmhz' ? '' : 'hidden'}>
        <div class="document-block-head">
          <div><span>2</span><strong>Dotaznik JMHZ pro urad</strong><small>samostatne udaje pro pripravu odeslani na urad bez michani s fotkami dokladu.</small></div>
          <b>${num(jmhzFilled)} poli</b>
        </div>
        ${jmhzProfileGrid(j)}
        ${canEditJmhz ? `
          <hr class="sep">
          ${jmhzEditorHtml(j, employeeId)}
          ${canManage() ? `<div class="field"><label>Dokumenty - interni poznamka</label><textarea id="documentsNote-${esc(employeeId)}">${esc(employee.documents_note || '')}</textarea></div>` : ''}
          <div class="actions jmhz-actions">
            <button class="btn primary" type="button" onclick="Pokladna.saveJmhz(${Number(employeeId)})">Ulozit dotaznik JMHZ</button>
            <button class="btn" type="button" onclick="Pokladna.copyJmhz(${Number(employeeId)})">Kopirovat pro urad</button>
          </div>` : ''}
      </section>
    </div>`);
  setTimeout(() => selectDocumentMode(employeeId, activeFocus, false), 80);
}

function openDocumentQuickMode(mode = 'personal') {
  const employees = state.cache.employees || [];
  if (employees.length === 1) {
    openDocuments(employees[0].id, mode);
    return;
  }
  toast('Vyberte pracovnika v seznamu a otevri Slozka nebo Dotaznik JMHZ.', 'warn');
  document.querySelector('.table-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function selectDocumentMode(employeeId, mode = 'personal', scroll = true) {
  const active = mode === 'jmhz' ? 'jmhz' : 'personal';
  const dashboard = document.querySelector('.document-dashboard');
  if (dashboard) dashboard.dataset.focus = active;
  document.querySelectorAll('.document-mode-action').forEach(button => {
    const isActive = button.getAttribute('onclick')?.includes(`'${active}'`);
    button.classList.toggle('active', !!isActive);
  });
  document.querySelectorAll('[data-document-panel]').forEach(panel => {
    panel.hidden = panel.dataset.documentPanel !== active;
  });
  if (scroll) {
    const target = active === 'jmhz' ? `jmhzFolder-${employeeId}` : `personalFolder-${employeeId}`;
    document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function uploadDocument(employeeId) {
  const box = document.getElementById(`documentUpload-${employeeId}`);
  const fileInput = box?.querySelector('[name="file"]');
  const file = fileInput?.files?.[0];
  if (!box || !file) {
    toast('Vyberte soubor dokumentu', 'warn');
    return;
  }
  const fd = new FormData();
  Object.entries(collectNamedInputs(box)).forEach(([key, value]) => fd.append(key, value));
  fd.append('employee_id', employeeId);
  fd.append('file', file);
  await api('documents', { method: 'POST', body: fd });
  document.querySelector('.modal-backdrop')?.remove();
  await openDocuments(employeeId, 'personal');
  toast('Dokument nahran');
}

async function saveEmployeeJmhz(employeeId) {
  const editor = document.getElementById(`jmhzEditor-${employeeId}`);
  if (!editor) return;
  const data = collectNamedInputs(editor);
  const documentsNote = document.getElementById(`documentsNote-${employeeId}`);
  if (documentsNote) {
    data.documents_note = documentsNote.value || '';
  }
  await api(`employees/${employeeId}/jmhz`, { method: 'PUT', body: JSON.stringify(data) });
  const employees = await api(withCompany('employees?status=all')).catch(() => ({ data: [] }));
  state.cache.employees = employees.data || state.cache.employees || [];
  document.querySelector('.modal-backdrop')?.remove();
  await openDocuments(employeeId, 'jmhz');
  toast('Dotaznik JMHZ ulozen');
}

async function copyEmployeeJmhz(employeeId) {
  const employee = (state.cache.employees || []).find(e => Number(e.id) === Number(employeeId)) || {};
  const editor = document.getElementById(`jmhzEditor-${employeeId}`);
  const data = editor ? collectNamedInputs(editor) : jsonObject(employee.jmhz_questionnaire);
  const text = jmhzExportText(employee, data);
  if (!text) {
    toast('Dotaznik je prazdny', 'warn');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('JMHZ udaje zkopirovany pro urad');
  } catch {
    modal('JMHZ pro urad', `<textarea class="input" style="min-height:360px">${esc(text)}</textarea>`);
  }
}

async function deleteDocument(id, employeeId) {
  if (!canManage()) {
    toast('Mazat dokumenty muze pouze administrator', 'warn');
    return;
  }
  if (!confirm('Smazat dokument?')) return;
  await api(`documents/${id}`, { method: 'DELETE' });
  document.querySelector('.modal-backdrop')?.remove();
  await renderPage();
  await openDocuments(employeeId);
}

async function approveDocument(id) {
  await api(`documents/${id}/approve`, { method: 'PUT', body: '{}' });
  await renderPage();
  toast('Dokument schvalen');
}

function rejectDocument(id) {
  modal('Odmitnout dokument', `<div class="field"><label>Duvod</label><textarea name="rejection_note"></textarea></div>`,
    data => api(`documents/${id}/reject`, { method: 'PUT', body: JSON.stringify(data) }), 'Odmitnout');
}

async function renderObjects() {
  loading('Objekty');
  const [{ data }, companies, employees] = await Promise.all([api(withCompany('objects')), api('companies').catch(() => ({ data: [] })), api(withCompany('employees')).catch(() => ({ data: [] }))]);
  state.cache.objects = data;
  state.cache.companies = companies.data;
  state.cache.employees = employees.data || [];
  const rows = data.map(o => [
    `<button class="link" type="button" onclick="Pokladna.objectProfile(${o.id})"><strong>${esc(o.name)}</strong></button><div class="muted">${esc(o.work_type || 'general')}</div>`,
    esc(o.company_name || '-'),
    esc(o.address || '-'),
    `<span class="mono">${num(o.employees_count)}</span><div class="muted">${(state.cache.employees || []).filter(e => Number(e.object_id) === Number(o.id) && e.status !== 'archived').slice(0, 4).map(e => esc(e.name)).join(', ') || '-'}</div>`,
    `<button class="btn sm" onclick="Pokladna.objectProfile(${o.id})">Detail</button> ${can('objects.write') ? `<button class="btn sm" onclick="Pokladna.object(${o.id})">Upravit</button> <button class="btn sm danger" onclick="Pokladna.deleteObject(${o.id})">Smazat</button>` : ''}`,
  ]);
  setContent(`${head('Objekty', `${data.length} staveb`, can('objects.write') ? '<button class="btn primary" onclick="Pokladna.object()">Novy objekt</button>' : '')}${rows.length ? table(['Nazev','Firma','Adresa','Lide','Akce'], rows) : '<div class="card empty">Zadne objekty</div>'}`);
}

function openObject(id) {
  const row = id ? state.cache.objects.find(o => Number(o.id) === Number(id)) : {};
  modal(id ? 'Upravit objekt' : 'Novy objekt', `
    <div class="field"><label>Nazev</label><input class="input" name="name" value="${esc(row.name)}" required></div>
    <div class="field"><label>Firma</label><select class="select" name="company_id">${optionList(state.cache.companies || [], row.company_id)}</select></div>
    <div class="field"><label>Typ / skupina</label><select class="select" name="work_type"><option value="general" ${(row.work_type || 'general') === 'general' ? 'selected' : ''}>general</option><option value="stavba" ${row.work_type === 'stavba' ? 'selected' : ''}>stavba</option><option value="rohlik_brno" ${row.work_type === 'rohlik_brno' ? 'selected' : ''}>rohlik_brno</option><option value="rohlik_ostrava" ${row.work_type === 'rohlik_ostrava' ? 'selected' : ''}>rohlik_ostrava</option></select></div>
    <div class="field"><label>Stav</label><select class="select" name="status"><option value="active" ${row.status !== 'archived' ? 'selected' : ''}>active</option><option value="archived" ${row.status === 'archived' ? 'selected' : ''}>archived</option></select></div>
    <div class="field"><label>Adresa</label><textarea name="address">${esc(row.address)}</textarea></div>
    <div class="field"><label>Poznamka</label><textarea name="notes">${esc(row.notes)}</textarea></div>`,
    data => api(id ? `objects/${id}` : 'objects', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) }));
}

async function openObjectProfile(id) {
  const object = (state.cache.objects || []).find(o => Number(o.id) === Number(id)) || {};
  if (!(state.cache.employees || []).length) {
    const employees = await api('employees?status=all').catch(() => ({ data: [] }));
    state.cache.employees = employees.data || [];
  }
  const people = (state.cache.employees || []).filter(e => Number(e.object_id) === Number(id) && e.status !== 'archived');
  const rows = people.map(e => [
    employeeNameCell(e, { meta: `${e.company_name || '-'} / ${czk(e.hourly_rate || 0)}`, size: 'sm' }),
    esc(e.phone || '-'),
    esc(e.email || '-'),
    esc(e.contract_type || '-'),
    `<button class="btn sm" onclick="document.querySelector('.modal-backdrop')?.remove(); Pokladna.profile(${e.id})">Profil</button>`,
  ]);
  modal(`Objekt: ${esc(object.name || '')}`, `
    <div class="profile-grid profile-grid-3">
      ${profileCell('Firma', object.company_name || '-')}
      ${profileCell('Typ', object.work_type || 'general')}
      ${profileCell('Pracovnici', num(people.length))}
      ${profileCell('Adresa', object.address || '-')}
      ${profileCell('Stav', object.status || '-')}
      ${profileCell('Poznamka', object.notes || '-')}
    </div>
    <div class="section-title">Kdo tady pracuje</div>
    ${rows.length ? table(['Pracovnik','Telefon','E-mail','Smlouva','Akce'], rows, 'compact-table') : '<div class="card empty">Na objektu nejsou aktivni pracovnici</div>'}
  `);
}

async function renderTimesheets() {
  loading('Hodiny');
  const [employees, timesheets] = await Promise.all([api(withCompany('employees')), api(withCompany(`timesheets?month=${state.month}&year=${state.year}`))]);
  state.cache.employees = employees.data;
  const rows = timesheets.data.map(t => [
    esc(t.employee_name),
    esc(t.work_date || '-'),
    esc(timeRangeLabel(t.work_start_at, t.work_end_at)),
    `<span class="mono">${num(t.hours)}</span>`,
    `<span class="mono">${czk(Number(t.hours) * Number(t.hourly_rate))}</span>`,
    `<span class="badge ${t.status === 'pending' ? 'warn' : t.status === 'rejected' ? 'danger' : 'accent'}">${esc(t.status || 'approved')}</span>`,
    esc(t.note || ''),
    `${can('timesheets.write') && canManage() ? `<button class="btn sm" onclick="Pokladna.timesheet(${t.id})">Upravit</button> <button class="btn sm danger" onclick="Pokladna.deleteTimesheet(${t.id})">Smazat</button>` : '<span class="muted">Odeslano</span>'} ${can('timesheets.approve') && t.status !== 'approved' ? `<button class="btn sm primary" onclick="Pokladna.approveTimesheet(${t.id})">Schvalit</button>` : ''} ${can('timesheets.approve') && t.status !== 'rejected' ? `<button class="btn sm danger" onclick="Pokladna.rejectTimesheet(${t.id})">Odmitnout</button>` : ''}`,
  ]);
  state.cache.timesheets = timesheets.data;
  setContent(`${head('Hodiny', `${currentMonths()[state.month - 1]} ${state.year}`, can('timesheets.write') ? '<button class="btn primary" onclick="Pokladna.timesheet()">Zadat hodiny</button>' : '')}${rows.length ? table(['Zamestnanec','Datum','Cas','Hodiny','Hrube','Stav','Poznamka','Akce'], rows) : '<div class="card empty">Zadne hodiny</div>'}`);
}

function openTimesheet(id) {
  if (!isGlobalUser() && state.isRohlikEmployee) {
    toast('Rohlik Brno nacita hodiny automaticky z tabulky.', 'warn');
    return;
  }
  if (id && !canManage()) {
    toast('Upravit odeslane hodiny muze pouze administrator', 'warn');
    return;
  }
  const row = id ? state.cache.timesheets.find(t => Number(t.id) === Number(id)) : { month: state.month, year: state.year, work_date: today() };
  const employeeField = canManage()
    ? `<div class="field"><label>Zamestnanec</label><select class="select" name="employee_id" required>${optionList(state.cache.employees || [], row.employee_id, 'Vyberte')}</select></div>`
    : ownEmployeeField(row);
  const rangeRequired = canManage() ? '' : 'required';
  const hoursReadonly = canManage() ? '' : 'readonly';
  modal(id ? 'Upravit hodiny' : 'Zadat hodiny', `
    <div class="form-grid">
      ${employeeField}
      <div class="field"><label>Datum</label><input class="input" name="work_date" type="date" value="${esc(row.work_date || today())}" required></div>
      <div class="field"><label>Zacatek prace</label><input class="input" name="work_start_at" type="datetime-local" value="${esc(dateTimeInputValue(row.work_start_at))}" ${rangeRequired} oninput="Pokladna.updateTimesheetHours(this)"></div>
      <div class="field"><label>Konec prace</label><input class="input" name="work_end_at" type="datetime-local" value="${esc(dateTimeInputValue(row.work_end_at))}" ${rangeRequired} oninput="Pokladna.updateTimesheetHours(this)"></div>
      <div class="field"><label>Hodiny</label><input class="input" name="hours" type="number" step="0.01" min="0" value="${esc(row.hours || 0)}" ${hoursReadonly} required></div>
      <input type="hidden" name="month" value="${state.month}"><input type="hidden" name="year" value="${state.year}">
    </div>
    <div class="field"><label>Poznamka</label><textarea name="note">${esc(row.note)}</textarea></div>`,
    data => api(id ? `timesheets/${id}` : 'timesheets', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) }));
}

async function approveTimesheet(id) {
  await api(`timesheets/${id}/approve`, { method: 'PUT', body: '{}' });
  await renderPage();
  toast('Schvaleno');
}

function rejectTimesheet(id) {
  modal('Odmitnout hodiny', `<div class="field"><label>Duvod</label><textarea name="rejection_note"></textarea></div>`,
    data => api(`timesheets/${id}/reject`, { method: 'PUT', body: JSON.stringify(data) }), 'Odmitnout');
}

function salaryHoursCell(row, detail = '') {
  const raw = Number(row.raw_hours ?? row.payable_hours ?? row.hours ?? 0);
  const clean = Number(row.payable_hours ?? row.hours ?? 0);
  const pct = Number(row.hour_deduction_pct || 0);
  if (pct > 0 && raw > clean) {
    return `<strong class="mono clean-hours">${num(clean)} h</strong><div class="muted"><span class="raw-hours">${num(raw)} h</span> <span class="badge warn">-${num(pct)}%</span>${detail ? ` / ${detail}` : ''}</div>`;
  }
  return `<strong class="mono accent">${num(clean)} h</strong>${detail ? `<div class="muted">${detail}</div>` : ''}`;
}

async function renderSalary() {
  loading('Mzdy');
  const { data, totals, stavba = [], stavba_totals: stavbaTotals = {} } = await api(withCompany(`salary?month=${state.month}&year=${state.year}`));
  state.cache.payouts = [...(data || []), ...(stavba || [])];
  const printAllUrl = `api/${withCompany(`salary/print?month=${state.month}&year=${state.year}`)}`;
  const baseRows = data || [];
  const rohlikRows = baseRows.filter(r => r.source === 'rohlik' && !isZivnostContract(r));
  const zivnostRows = baseRows.filter(isZivnostContract);
  const otherRows = baseRows.filter(r => r.source !== 'rohlik' && !isZivnostContract(r));
  const moneyClass = value => Number(value || 0) < 0 ? 'danger' : 'accent';
  const sectionTotals = rows => ({
    people: rows.length,
    payable_hours: sumRows(rows, 'payable_hours') || sumRows(rows, 'hours'),
    gross: sumRows(rows, 'gross'),
    deductions: sumRows(rows, 'advances') + sumRows(rows, 'housing'),
    net: sumRows(rows, 'net'),
    card: sumRows(rows, 'card_amount'),
    cash: sumRows(rows, 'cash_amount'),
    remains: sumRows(rows, 'remains'),
  });
  const sourceBadge = r => {
    if (r.source === 'rohlik') return '<span class="badge accent">Rohlik</span>';
    if (r.source === 'stavba') return '<span class="badge warn">Stavba</span>';
    return '<span class="badge blue">Hodiny</span>';
  };
  const payoutActions = r => `${can('payouts.write') ? `<button class="btn sm primary" type="button" onclick="Pokladna.payout(${r.employee_id})">Vyplata</button> ` : ''}<button class="btn sm" type="button" onclick="Pokladna.profile(${r.employee_id})">Karta</button> <a class="btn sm" target="_blank" rel="noopener" href="api/${withCompany(`salary/${r.employee_id}/print?month=${state.month}&year=${state.year}`)}">Tisk</a>`;
  const compactRow = r => [
    employeeNameCell(r, { meta: `${r.company_name || '-'} / ${r.object_name || '-'}`, extra: `<div class="muted">${esc(r.accommodation_name || '')}</div>` }),
    contractBadge(r),
    sourceBadge(r),
    salaryHoursCell(r, `zaklad ${num(r.hours || 0)} / bonus ${num(r.bonus_hours || 0)}`),
    `<span class="mono">${czk(r.hourly_rate)}</span><div class="muted">${rateSourceBadge(r.rate_source)}</div>`,
    `<span class="mono">${czk(r.gross)}</span>`,
    `<span class="mono">${czk(Number(r.bonus_amount || 0) + Number(r.insurance_amount || 0) - Number(r.deduction_amount || 0))}</span><div class="muted">zalohy ${czk(r.advances)} / bydleni ${czk(r.housing)} / pojisteni bonus ${czk(r.insurance_amount || 0)}</div>`,
    `<strong class="mono ${moneyClass(r.net)}">${czk(r.net)}</strong>`,
    `<div class="pay-split"><b class="blue">Karta ${czk(r.card_amount || 0)}</b><b class="warn">Hotovost ${czk(r.cash_amount || 0)}</b>${Number(r.debt_amount || 0) > 0 ? `<b class="danger">Dluh -${czk(r.debt_amount)}</b>` : ''}<small class="${Number(r.remains || 0) < 0 ? 'danger' : Number(r.remains || 0) === 0 ? 'accent' : 'warn'}">Zustava ${czk(r.remains || 0)}</small></div>`,
    payoutActions(r),
  ];
  const compactStavbaRow = r => [
    employeeNameCell(r, { meta: `${r.company_name || '-'} / ${r.object_name || '-'}`, extra: `<div class="muted">${esc(r.accommodation_name || '')}</div>` }),
    contractBadge(r),
    '<span class="badge warn">Stavba</span>',
    salaryHoursCell(r, `timer ${num(r.checkin_hours || 0)} / rucne ${num(r.manual_hours || 0)} / hodiny ${num(r.timesheet_hours || 0)}`),
    `<span class="mono">${czk(r.hourly_rate)}</span><div class="muted">${rateSourceBadge(r.rate_source)}</div>`,
    `<span class="mono">${czk(r.gross)}</span>`,
    `<span class="mono">${czk(Number(r.bonus_amount || 0) + Number(r.insurance_amount || 0) - Number(r.deduction_amount || 0))}</span><div class="muted">zalohy ${czk(r.advances)} / bydleni ${czk(r.housing)} / pojisteni bonus ${czk(r.insurance_amount || 0)}</div>`,
    `<strong class="mono ${moneyClass(r.net)}">${czk(r.net)}</strong>`,
    `<div class="pay-split"><b class="blue">Karta ${czk(r.card_amount || 0)}</b><b class="warn">Hotovost ${czk(r.cash_amount || 0)}</b>${Number(r.debt_amount || 0) > 0 ? `<b class="danger">Dluh -${czk(r.debt_amount)}</b>` : ''}<small class="${Number(r.remains || 0) < 0 ? 'danger' : Number(r.remains || 0) === 0 ? 'accent' : 'warn'}">Zustava ${czk(r.remains || 0)}</small></div>`,
    payoutActions(r),
  ];
  const salaryMobileCards = (list, isStavba = false) => (list || []).map(r => `
    <article class="salary-mobile-card">
      <div class="salary-mobile-head">
        ${employeeAvatar(r, 'md')}
        <div>
          <strong>${esc(r.employee_name || '-')}</strong>
          <small>${esc(r.company_name || '-')} / ${esc(r.object_name || '-')}</small>
        </div>
        <b class="mono ${moneyClass(r.net)}">${czk(r.net || 0)}</b>
      </div>
      <div class="salary-mobile-tags">
        ${contractBadge(r)}
        ${isStavba ? '<span class="badge warn">Stavba</span>' : sourceBadge(r)}
      </div>
      <div class="salary-mobile-grid">
        <div><span>Hodiny</span>${salaryHoursCell(r, isStavba ? `timer ${num(r.checkin_hours || 0)} / rucne ${num(r.manual_hours || 0)}` : `zaklad ${num(r.hours || 0)} / bonus ${num(r.bonus_hours || 0)}`)}</div>
        <div><span>Sazba</span><strong>${czk(r.hourly_rate || 0)}</strong><small>${rateSourceBadge(r.rate_source)}</small></div>
        <div><span>Hrube</span><strong>${czk(r.gross || 0)}</strong></div>
        <div><span>Srazky</span><strong class="warn">${czk(Number(r.advances || 0) + Number(r.housing || 0))}</strong><small>zalohy + bydleni</small></div>
        <div><span>Pojisteni</span><strong class="accent">${czk(r.insurance_amount || 0)}</strong><small>bonus</small></div>
        ${Number(r.debt_amount || 0) > 0 ? `<div><span>Dluh</span><strong class="danger">-${czk(r.debt_amount)}</strong></div>` : ''}
        <div><span>Zustava</span><strong class="${Number(r.remains || 0) < 0 ? 'danger' : Number(r.remains || 0) === 0 ? 'accent' : 'warn'}">${czk(r.remains || 0)}</strong></div>
      </div>
      <div class="salary-mobile-money">
        <span>Karta <b class="blue">${czk(r.card_amount || 0)}</b></span>
        <span>Hotovost <b class="warn">${czk(r.cash_amount || 0)}</b></span>
      </div>
      <div class="actions salary-mobile-actions">${payoutActions(r)}</div>
    </article>`).join('');
  const salaryMobileSection = (title, list, note, tone = '', isStavba = false) => {
    const t = sectionTotals(list);
    return `<section class="salary-mobile-section ${tone}">
      <div class="salary-mobile-section-head">
        <div><span>${esc(note)}</span><strong>${esc(title)}</strong></div>
        <b>${num(t.people)} / ${num(t.payable_hours)} h / ${czk(t.net)}</b>
      </div>
      <div class="salary-mobile-list">${salaryMobileCards(list, isStavba) || '<div class="card empty">Zadne zaznamy v tomto bloku</div>'}</div>
    </section>`;
  };
  if (isCompactLayout()) {
    const allSalaryRows = [...baseRows, ...(stavba || [])];
    const mobileTotals = sectionTotals(allSalaryRows);
    setContent(`${head('Mzdy / Vyplaty', `${currentMonths()[state.month - 1]} ${state.year}`, `<a class="btn primary" target="_blank" rel="noopener" href="${printAllUrl}">Tisk</a>`)}
      <section class="salary-mobile-summary">
        <div><span>Lide</span><strong>${num(mobileTotals.people)}</strong></div>
        <div><span>Hodiny</span><strong>${num(mobileTotals.payable_hours)} h</strong></div>
        <div><span>Karta</span><strong class="blue">${czk(mobileTotals.card)}</strong></div>
        <div><span>Hotovost</span><strong class="warn">${czk(mobileTotals.cash)}</strong></div>
        <div class="wide"><span>K vyplate</span><strong class="accent">${czk(mobileTotals.net)}</strong></div>
      </section>
      ${salaryMobileSection('Rohlik Brno', rohlikRows, 'sklad / Google hodiny', 'rohlik-block')}
      ${salaryMobileSection('Zivnost', zivnostRows, 'ICO / ZL / zivnostnik', 'zivnost-block')}
      ${salaryMobileSection('Ostatni mzdy', otherRows, 'bez Rohliku a bez Stavby')}
      ${salaryMobileSection('Stavba', stavba || [], 'timer / GPS / rucni hodiny', 'stavba-block', true)}`);
    return;
  }
  const sectionBlock = (title, rows, note, tone = '') => {
    const t = sectionTotals(rows);
    return `<section class="salary-block ${tone}">
      <div class="salary-block-head">
        <div><span>${esc(note)}</span><strong>${esc(title)}</strong></div>
        <div class="salary-mini-stats">
          <b>${num(t.people)} lidi</b><b>${num(t.payable_hours)} h</b><b>${czk(t.net)}</b>
        </div>
      </div>
      ${rows.length ? table(['Pracovnik','Typ','Zdroj','Hodiny','Sazba','Hrube','Srazky','K vyplate','Vyplaceno','Akce'], rows.map(compactRow), 'salary-compact-table') : '<div class="card empty">Zadne zaznamy v tomto bloku</div>'}
    </section>`;
  };
  const stavbaTableRows = (stavba || []).map(compactStavbaRow);
  setContent(`${head('Mzdy / Vyplaty', `${currentMonths()[state.month - 1]} ${state.year}`, `<a class="btn primary" target="_blank" rel="noopener" href="${printAllUrl}">Tisk vsech</a> ${exportButton('salary')}`)}
    <section class="salary-command">
      <div><span>Mzdy podle reality prace</span><strong>Rohlik, Zivnost, ostatni a Stavba jsou oddelene</strong><small>Stavba se nepocita dohromady se skladem. Hotovost, karta, bydleni, bonusy a pojisteni jako plus se tahnou do vyplat.</small></div>
      <div class="salary-command-grid">
        <b>${num((totals || {}).payable_hours || (totals || {}).hours || 0)} h</b>
        <b>${czk((totals || {}).net || 0)}</b>
        <b>${num((stavba || []).length)} stavba</b>
        <b>${num(zivnostRows.length)} zivnost</b>
      </div>
    </section>
    ${sectionBlock('Rohlik Brno', rohlikRows, 'sklad / google hodiny', 'rohlik-block')}
    ${sectionBlock('Zivnost', zivnostRows, 'ICO / ZL / zivnostnik', 'zivnost-block')}
    ${sectionBlock('Ostatni mzdy', otherRows, 'bez Rohliku a bez Stavby')}
    <section class="salary-block stavba-block">
      <div class="salary-block-head">
        <div><span>stavba / timer / GPS</span><strong>Stavba - samostatny vypocet</strong></div>
        <div class="salary-mini-stats">
          <b>${num((stavba || []).length)} lidi</b><b>${num(stavbaTotals.payable_hours || 0)} h</b><b>${czk(stavbaTotals.net || 0)}</b>
        </div>
      </div>
      <div class="grid grid-4 salary-kpis">
        <div class="stat"><div class="stat-label">Timer / GPS</div><div class="stat-value blue">${num(stavbaTotals.checkin_hours || 0)}</div><div class="stat-note">check-in smeny</div></div>
        <div class="stat"><div class="stat-label">Rucne + hodiny</div><div class="stat-value warn">${num(Number(stavbaTotals.manual_hours || 0) + Number(stavbaTotals.timesheet_hours || 0))}</div></div>
        <div class="stat"><div class="stat-label">Bonus pojisteni</div><div class="stat-value accent">${czk(stavbaTotals.insurance_amount || 0)}</div></div>
        <div class="stat"><div class="stat-label">K vyplate</div><div class="stat-value accent">${czk(stavbaTotals.net || 0)}</div></div>
      </div>
      ${stavbaTableRows.length ? table(['Pracovnik','Typ','Zdroj','Hodiny','Sazba','Hrube','Srazky','K vyplate','Vyplaceno','Akce'], stavbaTableRows, 'salary-compact-table') : '<div class="card empty">Zadne mzdy Stavba</div>'}
    </section>
    <div class="section-title">Soubor pro tisk</div>
    <div class="card">
      <div class="person-cell">
        <span class="menu-glyph">M</span>
        <div class="person-main">
          <strong>Obecna mzdova sestava</strong>
          <div class="muted">Obsahuje vsechny pracovniky, hrube mzdy, zalohy, bydleni, pojisteni jako bonus, final k vyplate, kartu, hotovost a zustatek.</div>
        </div>
      </div>
      <div class="actions" style="margin-top:12px"><a class="btn primary" target="_blank" rel="noopener" href="${printAllUrl}">Otevrit tisk vsech pracovniku</a></div>
    </div>`);
}

function accountingPaidMark(value, label) {
  const paid = Number(value || 0) === 1;
  return `<span class="accounting-paid ${paid ? 'ok' : 'no'}"><i></i><b>${paid ? 'ano' : 'ne'}</b><small>${esc(label)}</small></span>`;
}

async function renderAccounting() {
  loading('Ucetni');
  const { data, totals = {}, stavba = [], stavba_totals: stavbaTotals = {} } = await api(withCompany(`salary?month=${state.month}&year=${state.year}`));
  const rowsData = [...(data || []), ...(stavba || [])];
  const totalsAll = {
    people: rowsData.length,
    card: Number(totals.card_amount || 0) + Number(stavbaTotals.card_amount || 0),
    cash: Number(totals.cash_amount || 0) + Number(stavbaTotals.cash_amount || 0),
    net: Number(totals.net || 0) + Number(stavbaTotals.net || 0),
    social: rowsData.filter(row => Number(row.social_paid || 0) === 1).length,
    health: rowsData.filter(row => Number(row.health_paid || 0) === 1).length,
  };
  const rows = rowsData.map(r => [
    employeeNameCell(r, { meta: `${r.company_name || '-'} / ${r.object_name || '-'}` }),
    `<span class="mono">${esc(r.bank_account || '-')}</span>`,
    `<strong class="mono blue">${czk(r.card_amount || 0)}</strong>`,
    `<strong class="mono warn">${czk(r.cash_amount || 0)}</strong>`,
    `<span class="mono">${esc(r.contract_number || '-')}</span>`,
    `${contractBadge(r)}<div class="muted">${esc(r.contract_type || '-')}</div>`,
    accountingPaidMark(r.social_paid, 'socialka'),
    accountingPaidMark(r.health_paid, 'zdravotka'),
    `<strong class="mono accent">${czk(r.net || 0)}</strong>`,
    `<button class="btn sm" type="button" onclick="Pokladna.profile(${r.employee_id})">Karta</button> ${can('payouts.write') ? `<button class="btn sm primary" type="button" onclick="Pokladna.payout(${r.employee_id})">Vyplata</button>` : ''} <a class="btn sm" target="_blank" rel="noopener" href="api/${withCompany(`salary/${r.employee_id}/print?month=${state.month}&year=${state.year}`)}">Tisk</a>`,
  ]);
  const accountingMobileCards = rowsData.map(r => `
    <article class="accounting-mobile-card">
      <div class="accounting-mobile-head">
        ${employeeAvatar(r, 'md')}
        <div>
          <strong>${esc(r.employee_name || '-')}</strong>
          <small>${esc(r.company_name || '-')} / ${esc(r.object_name || '-')}</small>
        </div>
        <b class="mono accent">${czk(r.net || 0)}</b>
      </div>
      <div class="accounting-mobile-account">
        <span>Cislo uctu</span>
        <strong class="mono">${esc(r.bank_account || '-')}</strong>
      </div>
      <div class="accounting-mobile-grid">
        <div><span>Na ucet</span><strong class="blue">${czk(r.card_amount || 0)}</strong></div>
        <div><span>Hotovost</span><strong class="warn">${czk(r.cash_amount || 0)}</strong></div>
        <div><span>Smlouva</span><strong class="mono">${esc(r.contract_number || '-')}</strong></div>
        <div><span>Dohoda</span><strong>${esc(r.contract_type || '-')}</strong></div>
      </div>
      <div class="accounting-mobile-paid">
        ${accountingPaidMark(r.social_paid, 'socialka')}
        ${accountingPaidMark(r.health_paid, 'zdravotka')}
      </div>
      <div class="actions accounting-mobile-actions">
        <button class="btn sm" type="button" onclick="Pokladna.profile(${r.employee_id})">Karta</button>
        ${can('payouts.write') ? `<button class="btn sm primary" type="button" onclick="Pokladna.payout(${r.employee_id})">Vyplata</button>` : ''}
        <a class="btn sm" target="_blank" rel="noopener" href="api/${withCompany(`salary/${r.employee_id}/print?month=${state.month}&year=${state.year}`)}">Tisk</a>
      </div>
    </article>`).join('');
  if (isCompactLayout()) {
    setContent(`${head('Ucetni', `${currentMonths()[state.month - 1]} ${state.year}`, `${exportButton('accounting')} <button class="btn" type="button" onclick="Pokladna.go('salary')">Mzdy / Vyplaty</button>`)}
      <section class="salary-mobile-summary accounting-mobile-summary">
        <div><span>Lide</span><strong>${num(totalsAll.people)}</strong></div>
        <div><span>Na ucet</span><strong class="blue">${czk(totalsAll.card)}</strong></div>
        <div><span>Hotovost</span><strong class="warn">${czk(totalsAll.cash)}</strong></div>
        <div><span>Final</span><strong class="accent">${czk(totalsAll.net)}</strong></div>
        <div><span>Socialka</span><strong class="${totalsAll.social === totalsAll.people ? 'accent' : 'warn'}">${num(totalsAll.social)}/${num(totalsAll.people)}</strong></div>
        <div><span>Zdravotka</span><strong class="${totalsAll.health === totalsAll.people ? 'accent' : 'warn'}">${num(totalsAll.health)}/${num(totalsAll.people)}</strong></div>
      </section>
      <section class="accounting-mobile-list">${accountingMobileCards || '<div class="card empty">Zadne zaznamy pro ucetni</div>'}</section>`);
    return;
  }
  setContent(`${head('Ucetni', `${currentMonths()[state.month - 1]} ${state.year}`, `${exportButton('accounting')} <button class="btn" type="button" onclick="Pokladna.go('salary')">Mzdy / Vyplaty</button>`)}
    <div class="grid grid-4 accounting-kpis">
      <div class="stat"><div class="stat-label">Pracovnici</div><div class="stat-value accent">${num(totalsAll.people)}</div></div>
      <div class="stat"><div class="stat-label">Na ucet</div><div class="stat-value blue">${czk(totalsAll.card)}</div></div>
      <div class="stat"><div class="stat-label">Hotovost</div><div class="stat-value warn">${czk(totalsAll.cash)}</div></div>
      <div class="stat"><div class="stat-label">Final</div><div class="stat-value accent">${czk(totalsAll.net)}</div></div>
      <div class="stat"><div class="stat-label">Socialka</div><div class="stat-value ${totalsAll.social === totalsAll.people ? 'accent' : 'warn'}">${num(totalsAll.social)}/${num(totalsAll.people)}</div><div class="stat-note">zelena = zaplaceno</div></div>
      <div class="stat"><div class="stat-label">Zdravotka</div><div class="stat-value ${totalsAll.health === totalsAll.people ? 'accent' : 'warn'}">${num(totalsAll.health)}/${num(totalsAll.people)}</div><div class="stat-note">cervena = chybi</div></div>
    </div>
    <div class="section-title">Tabulka pro ucetni</div>
    ${rows.length ? table(['Jmeno a prijmeni','Cislo uctu','Na ucet','Hotovost','Cislo smlouvy','Dohoda','Socialka','Zdravotka','Final','Akce'], rows, 'accounting-table') : '<div class="card empty">Zadne zaznamy pro ucetni</div>'}`);
}

async function renderPayouts() {
  loading('Vyplaty');
  const { data, totals, stavba = [], stavba_totals: stavbaTotals = {} } = await api(withCompany(`payouts?month=${state.month}&year=${state.year}`));
  state.cache.payouts = [...(data || []), ...(stavba || [])];
  const payoutRows = (rows, isStavba = false) => rows.map(r => [
    `<strong>${esc(r.employee_name)}</strong><div class="muted">${esc(r.company_name || '')} ${esc(r.object_name || '')}</div>`,
    isStavba
      ? `<span class="mono">${num(r.payable_hours || 0)}</span><div class="muted">timer ${num(r.checkin_hours || 0)} / rucne ${num(r.manual_hours || 0)}</div>`
      : `<span class="mono">${num(r.payable_hours || r.hours)}</span><div class="muted">${num(r.hours)} + ${num(r.bonus_hours || 0)}</div>`,
    `<span class="mono">${czk(r.hourly_rate)}</span>`,
    `<span class="mono">${czk(r.gross)}</span>`,
    `<span class="mono">${czk(Number(r.bonus_amount || 0) - Number(r.deduction_amount || 0))}</span><div class="muted">+${czk(r.bonus_amount || 0)} / -${czk(r.deduction_amount || 0)}</div>`,
    `<span class="mono warn">${czk(r.advances)}</span>`,
    `<span class="mono warn">${czk(r.housing)}</span><div class="muted">${esc(r.accommodation_name || 'manual')}</div>`,
    `<span class="mono accent">${czk(r.insurance_amount || 0)}</span>`,
    `<span class="mono">${czk(r.net)}</span>`,
    `<span class="mono blue">${czk(r.card_amount)}</span>`,
    `<span class="mono warn">${czk(r.cash_amount)}</span>`,
    `<strong class="mono ${Number(r.remains) < 0 ? 'danger' : 'accent'}">${czk(r.remains)}</strong>`,
    Number(r.debt_amount || 0) > 0 ? `<strong class="mono danger">-${czk(r.debt_amount)}</strong><div class="muted">${esc(r.debt_note || '')}${Number(r.debt_carried_over || 0) ? ' / preveden' : ''}</div>` : '<span class="muted">-</span>',
    esc(r.paid_at || '-'),
    can('payouts.write') ? `<button class="btn sm" onclick="Pokladna.payout(${r.employee_id})">Upravit</button> ${r.payout_id ? `<button class="btn sm danger" onclick="Pokladna.deletePayout(${r.payout_id})">Smazat</button>` : ''}` : '',
  ]);
  const rows = payoutRows(data || []);
  const stavbaRows = payoutRows(stavba || [], true);
  const print = `<a class="btn" target="_blank" href="api/${withCompany(`payouts/print?month=${state.month}&year=${state.year}`)}">Soubor pro tisk</a>`;
  const payoutMobileCards = (list, isStavba = false) => (list || []).map(r => `
    <article class="payout-mobile-card">
      <div class="payout-mobile-head">
        ${employeeAvatar(r, 'md')}
        <div>
          <strong>${esc(r.employee_name || '-')}</strong>
          <small>${esc(r.company_name || '-')} / ${esc(r.object_name || '-')}</small>
        </div>
        <b class="${Number(r.net || 0) < 0 ? 'danger' : 'accent'}">${czk(r.net || 0)}</b>
      </div>
      <div class="payout-mobile-grid">
        <div><span>Hodiny</span>${salaryHoursCell(r)}</div>
        <div><span>Sazba</span><strong>${czk(r.hourly_rate || 0)}</strong></div>
        <div><span>Hrube</span><strong>${czk(r.gross || 0)}</strong></div>
        <div><span>Bonus pojisteni</span><strong class="accent">${czk(r.insurance_amount || 0)}</strong></div>
        <div><span>Zalohy</span><strong class="warn">${czk(r.advances || 0)}</strong></div>
        <div><span>Bydleni</span><strong class="warn">${czk(r.housing || 0)}</strong></div>
        ${Number(r.debt_amount || 0) > 0 ? `<div><span>Dluh</span><strong class="danger">-${czk(r.debt_amount)}</strong><small>${Number(r.debt_carried_over || 0) ? 'preveden' : esc(r.debt_note || '')}</small></div>` : ''}
      </div>
      <div class="payout-mobile-split">
        <span>Karta <b class="blue">${czk(r.card_amount || 0)}</b></span>
        <span>Hotovost <b class="warn">${czk(r.cash_amount || 0)}</b></span>
        <span>Zustava <b class="${Number(r.remains || 0) < 0 ? 'danger' : Number(r.remains || 0) === 0 ? 'accent' : 'warn'}">${czk(r.remains || 0)}</b></span>
      </div>
      <div class="actions payout-mobile-actions">
        ${can('payouts.write') ? `<button class="btn sm primary" onclick="Pokladna.payout(${r.employee_id})">Upravit vyplatu</button>` : ''}
        <button class="btn sm" onclick="Pokladna.profile(${r.employee_id})">Karta</button>
        <a class="btn sm" target="_blank" rel="noopener" href="api/${withCompany(`salary/${r.employee_id}/print?month=${state.month}&year=${state.year}`)}">Tisk</a>
      </div>
      ${isStavba ? `<div class="muted payout-mobile-note">Stavba: timer ${num(r.checkin_hours || 0)} h / rucne ${num(r.manual_hours || 0)} h</div>` : ''}
    </article>`).join('');
  if (isCompactLayout()) {
    setContent(`${head('Vyplaty', `${currentMonths()[state.month - 1]} ${state.year}`, `${print} ${exportButton('salary')}`)}
      <section class="payout-mobile-summary">
        <div><span>Ostatni</span><strong>${czk(totals.net || 0)}</strong><small>${num(totals.payable_hours || 0)} h</small></div>
        <div><span>Stavba</span><strong>${czk(stavbaTotals.net || 0)}</strong><small>${num(stavbaTotals.payable_hours || 0)} h</small></div>
      </section>
      <div class="section-title">Ostatni vyplaty</div>
      <section class="payout-mobile-list">${payoutMobileCards(data || []) || '<div class="card empty">Zadne vyplaty</div>'}</section>
      <div class="section-title">Stavba - samostatne vyplaty</div>
      <section class="payout-mobile-list">${payoutMobileCards(stavba || [], true) || '<div class="card empty">Zadne vyplaty Stavba</div>'}</section>`);
    return;
  }
  setContent(`${head('Vyplaty', `${currentMonths()[state.month - 1]} ${state.year}`, `${print} ${exportButton('salary')}`)}
    <div class="section-title">Ostatni vyplaty</div>
    <div class="grid grid-4" style="margin-bottom:16px">
      <div class="stat"><div class="stat-label">Hodiny</div><div class="stat-value blue">${num(totals.payable_hours || 0)}</div></div>
      <div class="stat"><div class="stat-label">Hrube</div><div class="stat-value blue">${czk(totals.gross || 0)}</div></div>
      <div class="stat"><div class="stat-label">Bonus / srazka</div><div class="stat-value ${Number(totals.bonus_amount || 0) - Number(totals.deduction_amount || 0) < 0 ? 'danger' : 'accent'}">${czk(Number(totals.bonus_amount || 0) - Number(totals.deduction_amount || 0))}</div></div>
      <div class="stat"><div class="stat-label">Bydleni</div><div class="stat-value warn">${czk(totals.housing || 0)}</div></div>
      <div class="stat"><div class="stat-label">Bonus pojisteni</div><div class="stat-value accent">${czk(totals.insurance_amount || 0)}</div></div>
      <div class="stat"><div class="stat-label">K vyplate</div><div class="stat-value accent">${czk(totals.net)}</div></div>
      <div class="stat"><div class="stat-label">Karta</div><div class="stat-value blue">${czk(totals.card_amount)}</div></div>
      <div class="stat"><div class="stat-label">Hotovost</div><div class="stat-value warn">${czk(totals.cash_amount)}</div></div>
      <div class="stat"><div class="stat-label">Zustava</div><div class="stat-value ${Number(totals.remains) < 0 ? 'danger' : 'accent'}">${czk(totals.remains)}</div></div>
    </div>
    ${rows.length ? table(['Zamestnanec','Hodiny','Sazba','Hrube','Bonusy','Zalohy','Bydleni','Bonus pojisteni','K vyplate','Karta','Hotovost','Zustava','Dluh','Datum','Akce'], rows) : '<div class="card empty">Zadne vyplaty</div>'}
    <div class="section-title">Stavba - samostatne vyplaty</div>
    <div class="grid grid-4" style="margin-bottom:16px">
      <div class="stat"><div class="stat-label">Timer / GPS</div><div class="stat-value blue">${num(stavbaTotals.checkin_hours || 0)}</div></div>
      <div class="stat"><div class="stat-label">Celkem hodin</div><div class="stat-value accent">${num(stavbaTotals.payable_hours || 0)}</div></div>
      <div class="stat"><div class="stat-label">Hrube</div><div class="stat-value blue">${czk(stavbaTotals.gross || 0)}</div></div>
      <div class="stat"><div class="stat-label">Bonus pojisteni</div><div class="stat-value accent">${czk(stavbaTotals.insurance_amount || 0)}</div></div>
      <div class="stat"><div class="stat-label">K vyplate</div><div class="stat-value accent">${czk(stavbaTotals.net || 0)}</div></div>
      <div class="stat"><div class="stat-label">Karta</div><div class="stat-value blue">${czk(stavbaTotals.card_amount || 0)}</div></div>
      <div class="stat"><div class="stat-label">Hotovost</div><div class="stat-value warn">${czk(stavbaTotals.cash_amount || 0)}</div></div>
      <div class="stat"><div class="stat-label">Zustava</div><div class="stat-value ${Number(stavbaTotals.remains || 0) < 0 ? 'danger' : 'accent'}">${czk(stavbaTotals.remains || 0)}</div></div>
    </div>
    ${stavbaRows.length ? table(['Zamestnanec','Hodiny','Sazba','Hrube','Bonusy','Zalohy','Bydleni','Bonus pojisteni','K vyplate','Karta','Hotovost','Zustava','Dluh','Datum','Akce'], stavbaRows) : '<div class="card empty">Zadne vyplaty Stavba</div>'}`);
}

const financeCategories = [
  ['fuel', 'Pohonne hmoty'],
  ['rent', 'Najem'],
  ['accountant', 'Ucetni'],
  ['tax', 'Dane'],
  ['tools', 'Naradi'],
  ['clothing', 'Pracovni odevy'],
  ['sim', 'SIM / telefony'],
  ['transport', 'Doprava'],
  ['other', 'Ostatni'],
  ['custom', 'Vlastni'],
];

function financeCategoryLabel(value) {
  return financeCategories.find(([id]) => id === value)?.[1] || value || 'Ostatni';
}

async function renderFinance() {
  loading('Naklady / Prijmy');
  const [summary, employees] = await Promise.all([
    api(withCompany(`finance/summary?month=${state.month}&year=${state.year}`)),
    can('employees.view') ? api(withCompany('employees')).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
  ]);
  state.cache.employees = employees.data || state.cache.employees || [];
  const totals = summary.totals || {};
  const auto = summary.auto || {};
  const expenses = summary.expenses || [];
  const revenues = summary.revenues || [];
  const margins = summary.employee_margins || [];
  const profitClass = Number(totals.profit || 0) >= 0 ? 'accent' : 'danger';
  const expenseRows = expenses.map(row => [
    `<strong>${esc(row.label || financeCategoryLabel(row.category))}</strong><div class="muted">${esc(financeCategoryLabel(row.category))}${Number(row.is_recurring || 0) ? ' / mesicne' : ''}</div>`,
    `<span class="mono danger">${czk(row.amount)}</span>`,
    esc(row.notes || '-'),
    row.receipt_path ? `<a class="btn sm" target="_blank" rel="noopener" href="${esc(row.receipt_path)}">Uctenka</a>` : `<label class="btn sm">Nahrat<input type="file" accept="image/*,application/pdf" hidden onchange="Pokladna.uploadReceipt(${Number(row.id)}, this)"></label>`,
    can('finance.write') && Number(row.is_auto || 0) !== 1 ? `<button class="btn sm danger" onclick="Pokladna.deleteExpense(${Number(row.id)})">Smazat</button>` : '<span class="muted">auto</span>',
  ]);
  const revenueRows = revenues.map(row => [
    `<strong>${esc(row.label || row.employee_name || 'Prijem')}</strong><div class="muted">${esc(row.source_type || 'manual')}</div>`,
    `<span class="mono accent">${czk(row.billed_amount)}</span>`,
    `<span class="mono warn">${czk(row.cost_amount)}</span>`,
    `<strong class="mono ${Number(row.billed_amount || 0) - Number(row.cost_amount || 0) >= 0 ? 'accent' : 'danger'}">${czk(Number(row.billed_amount || 0) - Number(row.cost_amount || 0))}</strong>`,
    esc(row.notes || '-'),
  ]);
  const marginRows = margins.map(row => {
    const billed = Number(row.billed_amount || 0);
    const cost = Number(row.total_cost || 0);
    const margin = billed - cost;
    const pct = billed > 0 ? Math.round((margin / billed) * 100) : 0;
    return [
      `<strong>${esc(row.employee_name || 'Manual')}</strong>`,
      `<span class="mono accent">${czk(billed)}</span>`,
      `<span class="mono warn">${czk(cost)}</span>`,
      `<strong class="mono ${margin >= 0 ? 'accent' : 'danger'}">${czk(margin)}</strong>`,
      `<span class="badge ${margin >= 0 ? 'accent' : 'danger'}">${num(pct)}%</span>`,
    ];
  });
  setContent(`${head('Naklady / Prijmy', `${currentMonths()[state.month - 1]} ${state.year}`, `${can('finance.write') ? '<button class="btn primary" onclick="Pokladna.addExpense()">Novy naklad</button> <button class="btn" onclick="Pokladna.addRevenue()">Novy prijem</button>' : ''} <button class="btn" onclick="Pokladna.financePdf()">PDF / tisk</button>`)}
    <div class="grid grid-3 finance-summary">
      <div class="stat"><div class="stat-label">Prijmy celkem</div><div class="stat-value accent">${czk(totals.revenues || 0)}</div></div>
      <div class="stat"><div class="stat-label">Naklady celkem</div><div class="stat-value danger">${czk(totals.expenses || 0)}</div><div class="stat-note">vyplacene mzdy + manual + naklady prijmu</div></div>
      <div class="stat"><div class="stat-label">Profit</div><div class="stat-value ${profitClass}">${czk(totals.profit || 0)}</div></div>
      <div class="stat"><div class="stat-label">Mzdy vyplacene auto</div><div class="stat-value blue">${czk(auto.salary_total || 0)}</div><div class="stat-note">karta + hotovost podle vyplat</div></div>
      <div class="stat"><div class="stat-label">Pojisteni zaplacene</div><div class="stat-value warn">${czk(auto.insurance_total || 0)}</div><div class="stat-note">do profitu jde jen zaplacene</div></div>
      <div class="stat"><div class="stat-label">Ceka k vyplate</div><div class="stat-value warn">${czk(auto.salary_open_total || 0)}</div><div class="stat-note">neodecita se, dokud neni vyplaceno</div></div>
    </div>
    <section class="card finance-card">
      <div class="card-tabs">
        <button class="card-tab active" type="button" onclick="Pokladna.financeTab('expenses', this)">Naklady</button>
        <button class="card-tab" type="button" onclick="Pokladna.financeTab('revenues', this)">Prijmy</button>
        <button class="card-tab" type="button" onclick="Pokladna.financeTab('margins', this)">Marze</button>
      </div>
      <div id="finance-tab-expenses">${expenseRows.length ? table(['Nazev','Castka','Poznamka','Uctenka','Akce'], expenseRows, 'finance-table') : '<div class="card empty">Zadne rucni naklady</div>'}</div>
      <div id="finance-tab-revenues" style="display:none">${revenueRows.length ? table(['Nazev','Fakturovano','Naklad','Marze','Poznamka'], revenueRows, 'finance-table') : '<div class="card empty">Zadne prijmy</div>'}</div>
      <div id="finance-tab-margins" style="display:none">${marginRows.length ? table(['Zamestnanec','Fakturovano','Naklady','Marze','%'], marginRows, 'finance-table') : '<div class="card empty">Zadne marze</div>'}</div>
    </section>`);
}

function financeTab(tab, button) {
  document.querySelectorAll('.card-tab').forEach(btn => btn.classList.remove('active'));
  button?.classList.add('active');
  ['expenses', 'revenues', 'margins'].forEach(id => {
    const el = document.getElementById(`finance-tab-${id}`);
    if (el) el.style.display = id === tab ? '' : 'none';
  });
}

function addExpense() {
  modal('Novy naklad', `
    <div class="form-grid">
      <div class="field"><label>Kategorie</label><select class="select" name="category">${financeCategories.map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}</select></div>
      <div class="field"><label>Nazev</label><input class="input" name="label" placeholder="volitelne"></div>
      <div class="field"><label>Castka</label><input class="input" name="amount" type="number" step="0.01" required></div>
      <label class="checkline"><input type="checkbox" name="is_recurring" value="1"> Opakovat kazdy mesic</label>
    </div>
    <div class="field"><label>Poznamka</label><textarea name="notes"></textarea></div>`,
    data => api(withCompany(`finance/expenses?month=${state.month}&year=${state.year}`), { method: 'POST', body: JSON.stringify(data) }));
}

async function deleteExpense(id) {
  if (!confirm('Smazat naklad?')) return;
  await api(withCompany(`finance/expenses/${id}`), { method: 'DELETE' });
  await renderPage();
  toast('Naklad smazan');
}

async function uploadReceipt(expenseId, input) {
  const file = input?.files?.[0];
  if (!file) return;
  const data = new FormData();
  data.append('receipt', file);
  await api(`finance-receipt?expense_id=${Number(expenseId)}`, { method: 'POST', body: data });
  await renderPage();
  toast('Uctenka nahrana');
}

function financePdf() {
  window.open(`api/${withCompany(`finance/pdf?month=${state.month}&year=${state.year}`)}`, '_blank', 'noopener');
}

function addRevenue() {
  modal('Novy prijem', `
    <div class="form-grid">
      <div class="field"><label>Zamestnanec</label><select class="select" name="source_id">${optionList(state.cache.employees || [], '', 'Manual / bez zamestnance')}</select></div>
      <div class="field"><label>Popis</label><input class="input" name="label"></div>
      <div class="field"><label>Fakturovano klientovi</label><input class="input" name="billed_amount" type="number" step="0.01" required></div>
      <div class="field"><label>Naklad na zdroj</label><input class="input" name="cost_amount" type="number" step="0.01"></div>
    </div>
    <div class="field"><label>Poznamka</label><textarea name="notes"></textarea></div>`,
    data => {
      data.source_type = data.source_id ? 'employee' : 'manual';
      return api(withCompany(`finance/revenues?month=${state.month}&year=${state.year}`), { method: 'POST', body: JSON.stringify(data) });
    });
}

async function openPayout(employeeId) {
  if (!Array.isArray(state.cache.payouts) || !state.cache.payouts.some(p => Number(p.employee_id) === Number(employeeId))) {
    const payoutPayload = await api(withCompany(`payouts?month=${state.month}&year=${state.year}`));
    state.cache.payouts = [...(payoutPayload.data || []), ...(payoutPayload.stavba || [])];
  }
  const row = state.cache.payouts.find(p => Number(p.employee_id) === Number(employeeId)) || {};
  const defaultInsurance = payoutDefaultInsuranceAmount(row);
  const savedInsurance = Number(row.insurance_amount || 0);
  const insuranceAmount = savedInsurance > 0 || Number(row.payout_id || 0) > 0 ? savedInsurance : defaultInsurance;
  const netWithInsurance = roundMoney(Number(row.net || 0) - savedInsurance + insuranceAmount);
  const initialCash = Number(row.cash_amount || 0) || payoutCashRemainderWithDebt(netWithInsurance, row.card_amount, row.debt_amount);
  const remains = roundMoney(netWithInsurance - Number(row.card_amount || 0) - initialCash - Number(row.debt_amount || 0));
  modal('Vyplata', `
    <input type="hidden" name="employee_id" value="${employeeId}">
    <input type="hidden" name="month" value="${state.month}">
    <input type="hidden" name="year" value="${state.year}">
    <input type="hidden" name="hourly_rate" value="${esc(row.hourly_rate || 0)}">
    <input type="hidden" name="auto_cash" value="1">
    <div class="profile-grid compact-profile payout-preview" data-gross="${esc(row.gross || 0)}" data-advances="${esc(row.advances || 0)}" style="margin-bottom:14px">
      <div><span>Zamestnanec</span><strong>${esc(row.employee_name)}</strong></div>
      <div><span>Hrube</span><strong>${czk(row.gross)}</strong></div>
      <div><span>Zalohy</span><strong class="warn">${czk(row.advances)}</strong></div>
      <div><span>Bonus pojisteni</span><strong class="accent" data-payout-insurance>${czk(insuranceAmount)}</strong></div>
      <div><span>Dluh</span><strong class="danger" data-payout-debt>${czk(row.debt_amount || 0)}</strong></div>
      <div><span>K vyplate</span><strong class="${netWithInsurance < 0 ? 'danger' : 'accent'}" data-payout-net>${czk(netWithInsurance)}</strong></div>
      <div><span>Zustava</span><strong class="${remains < 0 ? 'danger' : remains === 0 ? 'accent' : 'warn'}" data-payout-remains>${czk(remains)}</strong></div>
    </div>
    <div class="form-grid">
      <div class="field"><label>Bonus</label><input class="input" name="bonus_amount" type="number" step="0.01" value="${esc(row.bonus_amount || 0)}" oninput="Pokladna.updatePayoutPreview(this)"></div>
      <div class="field"><label>Srazka</label><input class="input" name="deduction_amount" type="number" step="0.01" value="${esc(row.deduction_amount || 0)}" oninput="Pokladna.updatePayoutPreview(this)"></div>
      <div class="field"><label>Bydleni</label><input class="input" name="housing" type="number" step="0.01" value="${esc(row.housing || 0)}" oninput="Pokladna.updatePayoutPreview(this)"></div>
      <div class="field"><label>Bonus za pojisteni</label><input class="input" name="insurance_amount" type="number" step="0.01" value="${esc(insuranceAmount)}" oninput="Pokladna.updatePayoutPreview(this)"><small>DPP/DPC 3000 Kc, HPP 11200 Kc; castku muzes zmenit rucne.</small></div>
      <div class="field"><label>Dluh</label><input class="input" name="debt_amount" type="number" step="0.01" value="${esc(row.debt_amount || 0)}" oninput="Pokladna.updatePayoutPreview(this)"></div>
      <div class="field"><label>Duvod dluhu</label><input class="input" name="debt_note" value="${esc(row.debt_note || '')}" placeholder="napr. skoda, prebytecna zaloha"></div>
      ${Number(row.debt_carried_over || 0) ? '<div class="badge warn">Preveden z minuleho mesice</div>' : ''}
      <label class="checkline payout-check"><input type="checkbox" name="social_paid" value="1" ${Number(row.social_paid || 0) === 1 ? 'checked' : ''}> Socialka zaplacena</label>
      <label class="checkline payout-check"><input type="checkbox" name="health_paid" value="1" ${Number(row.health_paid || 0) === 1 ? 'checked' : ''}> Zdravotka zaplacena</label>
      <div class="field"><label>Karta</label><input class="input" name="card_amount" type="number" step="0.01" value="${esc(row.card_amount || 0)}" oninput="Pokladna.updatePayoutPreview(this)"></div>
      <div class="field"><label>Hotovost</label><input class="input" name="cash_amount" type="number" step="0.01" value="${esc(initialCash)}" oninput="Pokladna.updatePayoutPreview(this)"></div>
      <div class="field"><label>Datum</label><input class="input" name="paid_at" type="date" value="${esc(row.paid_at || today())}"></div>
    </div>
    <div class="field"><label>Poznamka</label><textarea name="note">${esc(row.payout_note)}</textarea></div>`,
    data => api('payouts', { method: 'POST', body: JSON.stringify(data) }));
}

async function renderMonthClose() {
  loading('Uzaverka');
  const { data, preview } = await api(withCompany(`monthclose?month=${state.month}&year=${state.year}`));
  const closed = !!data;
  const totals = closed ? data.snapshot.totals : preview.totals;
  const rows = (closed ? data.snapshot.rows : preview.rows).map(r => [
    `<strong>${esc(r.employee_name)}</strong><div class="muted">${esc(r.company_name || '')} ${esc(r.object_name || '')}</div>`,
    `<span class="mono">${num(r.payable_hours || r.hours)}</span>`,
    `<span class="mono">${czk(r.hourly_rate)}</span>`,
    `<span class="mono">${czk(r.gross)}</span>`,
    `<span class="mono">${czk(Number(r.bonus_amount || 0) - Number(r.deduction_amount || 0))}</span>`,
    `<span class="mono">${czk(r.advances)}</span>`,
    `<span class="mono">${czk(r.housing)}</span>`,
    `<strong class="mono ${Number(r.net) < 0 ? 'danger' : 'accent'}">${czk(r.net)}</strong>`,
  ]);
  const action = closed
    ? `${exportButton('salary')} ${can('monthclose.write') ? '<button class="btn danger" onclick="Pokladna.reopenMonth()">Otevrit mesic</button>' : ''}`
    : `${exportButton('salary')} ${can('monthclose.write') ? '<button class="btn primary" onclick="Pokladna.closeMonth()">Zavrit mesic</button>' : ''}`;
  setContent(`${head('Mesicni uzaverka', `${currentMonths()[state.month - 1]} ${state.year}`, action)}
    <div class="grid grid-4" style="margin-bottom:16px">
      <div class="stat"><div class="stat-label">Stav</div><div class="stat-value ${closed ? 'accent' : 'warn'}">${closed ? 'Zavreno' : 'Otevreno'}</div><div class="stat-note">${closed ? `uzavrel ${esc(data.closed_by_name || '-')}` : 'data jsou stale ziva'}</div></div>
      <div class="stat"><div class="stat-label">Hrube</div><div class="stat-value blue">${czk(totals.gross)}</div></div>
      <div class="stat"><div class="stat-label">Srazky</div><div class="stat-value warn">${czk(Number(totals.advances) + Number(totals.housing))}</div></div>
      <div class="stat"><div class="stat-label">K vyplate</div><div class="stat-value accent">${czk(totals.net)}</div></div>
    </div>
    ${closed && data.notes ? `<div class="card" style="margin-bottom:16px"><strong>Poznamka</strong><div class="muted" style="margin-top:6px">${esc(data.notes)}</div></div>` : ''}
    ${rows.length ? table(['Zamestnanec','Hodiny','Sazba','Hrube','Bonusy','Zalohy','Bydleni','Netto'], rows) : '<div class="card empty">Zadne mzdy k uzavreni</div>'}`);
}

async function renderAdvances() {
  loading('Zalohy');
  const [employees, advances] = await Promise.all([api(withCompany('employees')), api(withCompany(`advances?month=${state.month}&year=${state.year}`))]);
  state.cache.employees = employees.data;
  state.cache.advances = advances.data;
  const rows = advances.data.map(a => [
    esc(a.employee_name),
    `<span class="mono">${czk(a.amount)}</span>`,
    esc(a.date),
    `<span class="badge ${a.status === 'pending' ? 'warn' : a.status === 'rejected' ? 'danger' : 'accent'}">${esc(a.status || 'approved')}</span><div class="muted">${a.paid_at ? `vydano ${esc(a.paid_at)}` : ''}</div>`,
    esc(a.note || ''),
    canManage() ? `${a.status === 'pending' ? `<button class="btn sm primary" onclick="Pokladna.approveAdvance(${a.id})">Vydat</button> <button class="btn sm danger" onclick="Pokladna.rejectAdvance(${a.id})">Odmitnout</button>` : ''} <button class="btn sm" onclick="Pokladna.advance(${a.id})">Upravit</button> <button class="btn sm danger" onclick="Pokladna.deleteAdvance(${a.id})">Smazat</button>` : '<span class="muted">Zadost odeslana</span>',
  ]);
  setContent(`${head('Zalohy', `${advances.data.length} zaznamu`, can('advances.write') ? `<button class="btn primary" onclick="Pokladna.advance()">${canManage() ? 'Nova zaloha' : 'Zadost o zalohu'}</button>` : '')}${rows.length ? table(['Zamestnanec','Castka','Datum','Stav','Poznamka','Akce'], rows) : '<div class="card empty">Zadne zalohy</div>'}`);
}

function openAdvance(id, presetEmployeeId = '') {
  if (id && !canManage()) {
    toast('Upravit zalohu muze pouze administrator', 'warn');
    return;
  }
  const row = id ? state.cache.advances.find(a => Number(a.id) === Number(id)) : { date: today(), employee_id: presetEmployeeId };
  const employeeField = canManage()
    ? `<div class="field"><label>Zamestnanec</label><select class="select" name="employee_id" required>${optionList(state.cache.employees || [], row.employee_id, 'Vyberte')}</select></div>`
    : ownEmployeeField(row);
  modal(id ? 'Upravit zalohu' : 'Nova zaloha', `
    <div class="form-grid">
      ${employeeField}
      <div class="field"><label>Castka</label><input class="input" name="amount" type="number" step="0.01" value="${esc(row.amount || 0)}" required></div>
      <div class="field"><label>Datum</label><input class="input" name="date" type="date" value="${esc(row.date || today())}" required></div>
      ${canManage() ? `<div class="field"><label>Stav</label><select class="select" name="status"><option value="pending" ${row.status === 'pending' ? 'selected' : ''}>pending</option><option value="approved" ${(row.status || 'approved') === 'approved' ? 'selected' : ''}>approved</option><option value="rejected" ${row.status === 'rejected' ? 'selected' : ''}>rejected</option></select></div><div class="field"><label>Vydano dne</label><input class="input" name="paid_at" type="date" value="${esc(row.paid_at || '')}"></div>` : ''}
      <input type="hidden" name="month" value="${state.month}"><input type="hidden" name="year" value="${state.year}">
    </div>
    <div class="field"><label>Poznamka</label><textarea name="note">${esc(row.note)}</textarea></div>`,
    data => api(id ? `advances/${id}` : 'advances', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) }));
}

async function openAdvanceForEmployee(employeeId) {
  if (!(state.cache.employees || []).length) {
    const employees = await api('employees?status=all').catch(() => ({ data: [] }));
    state.cache.employees = employees.data || [];
  }
  openAdvance(null, employeeId);
}

function approveAdvance(id) {
  modal('Vydat zalohu', `<div class="field"><label>Datum vydani</label><input class="input" name="paid_at" type="date" value="${today()}" required></div>`,
    data => api(`advances/${id}/approve`, { method: 'PUT', body: JSON.stringify(data) }), 'Vydat');
}

function rejectAdvance(id) {
  modal('Odmitnout zalohu', `<div class="field"><label>Duvod</label><textarea name="rejection_note"></textarea></div>`,
    data => api(`advances/${id}/reject`, { method: 'PUT', body: JSON.stringify(data) }), 'Odmitnout');
}

async function renderCash() {
  loading('Hotovost');
  const [objects, cash] = await Promise.all([api(withCompany('objects')), api(withCompany('cash'))]);
  state.cache.objects = objects.data;
  state.cache.cash = cash.data;
  const rows = cash.data.map(r => [
    `<span class="badge">${r.type === 'income' ? 'Prijem' : 'Vydaj'}</span>`,
    `<span class="mono ${r.type === 'income' ? 'accent' : 'danger'}">${czk(r.amount)}</span>`,
    esc(r.description),
    esc(r.object_name || '-'),
    esc(r.date),
    can('cash.write') ? `<button class="btn sm" onclick="Pokladna.cash(${r.id})">Upravit</button> <button class="btn sm danger" onclick="Pokladna.deleteCash(${r.id})">Smazat</button>` : '',
  ]);
  const actions = `${exportButton('cash')} ${can('cash.write') ? '<button class="btn primary" onclick="Pokladna.cash()">Nova operace</button>' : ''}`;
  setContent(`${head('Hotovost', `${cash.data.length} operaci`, actions)}${rows.length ? table(['Typ','Castka','Popis','Objekt','Datum','Akce'], rows) : '<div class="card empty">Zadne operace</div>'}`);
}

function openCash(id) {
  const row = id ? state.cache.cash.find(c => Number(c.id) === Number(id)) : { type: 'income', date: today() };
  modal(id ? 'Upravit operaci' : 'Nova operace', `
    <div class="form-grid">
      <div class="field"><label>Typ</label><select class="select" name="type"><option value="income" ${row.type !== 'expense' ? 'selected' : ''}>Prijem</option><option value="expense" ${row.type === 'expense' ? 'selected' : ''}>Vydaj</option></select></div>
      <div class="field"><label>Castka</label><input class="input" name="amount" type="number" step="0.01" value="${esc(row.amount || 0)}" required></div>
      <div class="field"><label>Datum</label><input class="input" name="date" type="date" value="${esc(row.date || today())}" required></div>
      <div class="field"><label>Objekt</label><select class="select" name="object_id">${optionList(state.cache.objects || [], row.object_id)}</select></div>
    </div>
    <div class="field"><label>Popis</label><textarea name="description" required>${esc(row.description)}</textarea></div>`,
    data => api(id ? `cash/${id}` : 'cash', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) }));
}

async function renderResources() {
  loading('Majetek');
  const [companies, employees, users, sim, vehicles, tools, housing, expenses] = await Promise.all([
    api('companies').catch(() => ({ data: [] })),
    api(withCompany('employees')).catch(() => ({ data: [] })),
    api('users').catch(() => ({ data: [] })),
    api(withCompany('resources/sim_cards')),
    api(withCompany('resources/vehicles')),
    api(withCompany('resources/tools')),
    api(withCompany('resources/accommodations')),
    api(withCompany(`resources/coordinator_expenses?month=${state.month}&year=${state.year}`)),
  ]);
  state.cache.companies = companies.data;
  state.cache.employees = employees.data;
  state.cache.users = users.data;
  state.cache.simCards = sim.data;
  state.cache.vehicles = vehicles.data;
  state.cache.tools = tools.data;
  state.cache.accommodations = housing.data;
  state.cache.coordinatorExpenses = expenses.data;
  const simRows = sim.data.map(r => [esc(r.phone_number), esc(r.operator || '-'), esc(r.company_name || '-'), esc(r.employee_name || r.registered_to || '-'), `<span class="badge">${esc(r.status)}</span>`, can('resources.write') ? `<button class="btn sm" onclick="Pokladna.resource('sim_cards', ${r.id})">Upravit</button> <button class="btn sm danger" onclick="Pokladna.deleteResource('sim_cards', ${r.id})">Smazat</button>` : '']);
  const carRows = vehicles.data.map(r => [esc(r.plate_number), esc(r.brand_model || '-'), esc(r.company_name || '-'), esc(r.employee_name || '-'), esc(r.stk_until || '-'), `<span class="badge">${esc(r.status)}</span>`, can('resources.write') ? `<button class="btn sm" onclick="Pokladna.resource('vehicles', ${r.id})">Upravit</button> <button class="btn sm danger" onclick="Pokladna.deleteResource('vehicles', ${r.id})">Smazat</button>` : '']);
  const toolRows = tools.data.map(r => [
    `<strong>${esc(r.name)}</strong><div class="muted">${esc(r.category || '')} ${esc(r.inventory_number || '')}</div>`,
    esc(r.company_name || '-'),
    r.employee_name ? employeeNameCell({ employee_name: r.employee_name, employee_avatar_path: r.employee_avatar_path, company_name: r.company_name }, { meta: r.company_name || '', size: 'sm' }) : '<span class="muted">Na sklade</span>',
    `<span class="mono">${czk(r.purchase_price || 0)}</span>`,
    esc(r.issued_at || '-'),
    `<span class="badge">${esc(r.status)}</span>`,
    can('resources.write') ? `<button class="btn sm" onclick="Pokladna.resource('tools', ${r.id})">Upravit</button> <button class="btn sm danger" onclick="Pokladna.deleteResource('tools', ${r.id})">Smazat</button>` : '',
  ]);
  const houseRows = housing.data.map(r => [
    esc(r.name),
    esc(r.company_name || '-'),
    esc(r.address || '-'),
    `${num(r.occupants_count || 0)} / ${num(r.capacity || 0)}`,
    `<span class="mono">${czk(r.monthly_cost)}</span>`,
    `<div>${esc(r.occupant_names || '-')}</div><div class="muted">tato castka jde do karty pracovnika jako srazka</div>`,
    can('resources.write') ? `<button class="btn sm" onclick="Pokladna.resource('accommodations', ${r.id})">Upravit</button> <button class="btn sm danger" onclick="Pokladna.deleteResource('accommodations', ${r.id})">Smazat</button>` : '',
  ]);
  const expenseTotals = expenses.data.reduce((acc, row) => {
    const key = row.category || 'other';
    acc[key] = (acc[key] || 0) + Number(row.amount || 0);
    acc.total = (acc.total || 0) + Number(row.amount || 0);
    return acc;
  }, {});
  const expenseRows = expenses.data.map(r => [
    esc(r.expense_date || '-'),
    `<span class="badge">${esc(r.category || 'other')}</span>`,
    `<strong>${esc(r.title || '-')}</strong><div class="muted">${esc(r.note || '')}</div>`,
    `<span class="mono warn">${czk(r.amount)}</span>`,
    esc(r.company_name || '-'),
    r.employee_name ? employeeNameCell(r, { meta: r.vehicle_plate ? `auto ${r.vehicle_plate}` : '', size: 'sm' }) : esc(r.vehicle_plate || '-'),
    esc(r.coordinator_name || r.created_by_name || '-'),
    can('resources.write') ? `<button class="btn sm" onclick="Pokladna.resource('coordinator_expenses', ${r.id})">Upravit</button> <button class="btn sm danger" onclick="Pokladna.deleteResource('coordinator_expenses', ${r.id})">Smazat</button>` : '',
  ]);
  const expenseSummary = `
    <div class="grid grid-4" style="margin-bottom:12px">
      <div class="stat"><div class="stat-label">Celkem</div><div class="stat-value warn">${czk(expenseTotals.total || 0)}</div></div>
      <div class="stat"><div class="stat-label">Zalohy</div><div class="stat-value">${czk(expenseTotals.advance || 0)}</div></div>
      <div class="stat"><div class="stat-label">Palivo</div><div class="stat-value blue">${czk(expenseTotals.fuel || 0)}</div></div>
      <div class="stat"><div class="stat-label">Nastroje</div><div class="stat-value accent">${czk(expenseTotals.tool || 0)}</div></div>
    </div>`;
  const resourceSections = orderedSections('resources', [
    { id: 'sim', title: 'SIM karty', note: `${simRows.length} zaznamu`, body: simRows.length ? table(['Cislo','Operator','Firma','Prirazeno','Stav','Akce'], simRows) : '<div class="card empty">Zadne SIM</div>' },
    { id: 'cars', title: 'Automobily', note: `${carRows.length} zaznamu`, body: carRows.length ? table(['SPZ','Model','Firma','Ridic','STK','Stav','Akce'], carRows) : '<div class="card empty">Zadna auta</div>' },
    { id: 'tools', title: 'Nastroje', note: `${toolRows.length} kusu`, body: toolRows.length ? table(['Nazev','Firma','Prirazeno','Cena','Vydano','Stav','Akce'], toolRows) : '<div class="card empty">Zadne nastroje</div>' },
    { id: 'housing', title: 'Bydleni', note: `${houseRows.length} zaznamu`, body: houseRows.length ? table(['Nazev','Firma','Adresa','Obsazeno','Cena','Kdo bydli','Akce'], houseRows) : '<div class="card empty">Zadne bydleni</div>' },
    { id: 'coordinator', title: 'Report koordinatora', note: `${expenseRows.length} vydaju`, body: `${expenseSummary}${expenseRows.length ? table(['Datum','Kategorie','Popis','Castka','Firma','Vazba','Koordinator','Akce'], expenseRows) : '<div class="card empty">Zadne vydaje koordinatora</div>'}` },
  ]);
  setContent(`${head('Majetek', 'SIM, auta, nastroje, bydleni a report koordinatora', can('resources.write') ? '<button class="btn primary" onclick="Pokladna.resource(\'sim_cards\')">SIM</button><button class="btn primary" onclick="Pokladna.resource(\'vehicles\')">Auto</button><button class="btn primary" onclick="Pokladna.resource(\'tools\')">Nastroj</button><button class="btn primary" onclick="Pokladna.resource(\'accommodations\')">Bydleni</button><button class="btn primary" onclick="Pokladna.resource(\'coordinator_expenses\')">Vydaj</button>' : '')}
    ${resourceSections}`);
}

function openResource(type, id) {
  const cache = type === 'sim_cards' ? state.cache.simCards
    : type === 'vehicles' ? state.cache.vehicles
      : type === 'tools' ? state.cache.tools
        : type === 'coordinator_expenses' ? state.cache.coordinatorExpenses
          : state.cache.accommodations;
  const row = id ? cache.find(r => Number(r.id) === Number(id)) : {};
  const common = `
    <div class="field"><label>Firma</label><select class="select" name="company_id">${optionList(state.cache.companies || [], row.company_id)}</select></div>
    <div class="field"><label>Poznamka</label><textarea name="notes">${esc(row.notes)}</textarea></div>`;
  let body = '';
  if (type === 'sim_cards') {
    body = `<div class="form-grid"><div class="field"><label>Cislo</label><input class="input" name="phone_number" value="${esc(row.phone_number)}" required></div><div class="field"><label>Operator</label><input class="input" name="operator" value="${esc(row.operator)}"></div><div class="field"><label>ICCID</label><input class="input" name="iccid" value="${esc(row.iccid)}"></div><div class="field"><label>Registrovano na</label><input class="input" name="registered_to" value="${esc(row.registered_to)}"></div><div class="field"><label>Zamestnanec</label><select class="select" name="assigned_employee_id">${optionList(state.cache.employees || [], row.assigned_employee_id)}</select></div><div class="field"><label>Mesicni cena</label><input class="input" name="monthly_cost" type="number" step="0.01" value="${esc(row.monthly_cost || 0)}"></div><div class="field"><label>Stav</label><select class="select" name="status"><option value="active">active</option><option value="inactive">inactive</option><option value="lost">lost</option></select></div></div>${common}`;
  } else if (type === 'vehicles') {
    body = `<div class="form-grid"><div class="field"><label>SPZ</label><input class="input" name="plate_number" value="${esc(row.plate_number)}" required></div><div class="field"><label>Model</label><input class="input" name="brand_model" value="${esc(row.brand_model)}"></div><div class="field"><label>VIN</label><input class="input" name="vin" value="${esc(row.vin)}"></div><div class="field"><label>Ridic</label><select class="select" name="assigned_employee_id">${optionList(state.cache.employees || [], row.assigned_employee_id)}</select></div><div class="field"><label>Pojistka do</label><input class="input" name="insurance_until" type="date" value="${esc(row.insurance_until)}"></div><div class="field"><label>STK do</label><input class="input" name="stk_until" type="date" value="${esc(row.stk_until)}"></div><div class="field"><label>Stav</label><select class="select" name="status"><option value="active">active</option><option value="service">service</option><option value="inactive">inactive</option></select></div></div>${common}`;
  } else if (type === 'tools') {
    body = `<div class="form-grid">
      <div class="field"><label>Nazev</label><input class="input" name="name" value="${esc(row.name)}" required></div>
      <div class="field"><label>Kategorie</label><input class="input" name="category" value="${esc(row.category)}" placeholder="napr. vrtacka, PPE, meridlo"></div>
      <div class="field"><label>Inventarni cislo</label><input class="input" name="inventory_number" value="${esc(row.inventory_number)}"></div>
      <div class="field"><label>Seriove cislo</label><input class="input" name="serial_number" value="${esc(row.serial_number)}"></div>
      <div class="field"><label>Zamestnanec</label><select class="select" name="assigned_employee_id">${optionList(state.cache.employees || [], row.assigned_employee_id)}</select></div>
      <div class="field"><label>Cena</label><input class="input" name="purchase_price" type="number" step="0.01" value="${esc(row.purchase_price || 0)}"></div>
      <div class="field"><label>Vydano</label><input class="input" name="issued_at" type="date" value="${esc(row.issued_at || '')}"></div>
      <div class="field"><label>Stav</label><select class="select" name="status">
        <option value="available" ${row.status === 'available' ? 'selected' : ''}>available</option>
        <option value="assigned" ${row.status === 'assigned' ? 'selected' : ''}>assigned</option>
        <option value="service" ${row.status === 'service' ? 'selected' : ''}>service</option>
        <option value="lost" ${row.status === 'lost' ? 'selected' : ''}>lost</option>
        <option value="written_off" ${row.status === 'written_off' ? 'selected' : ''}>written_off</option>
      </select></div>
    </div>${common}`;
  } else if (type === 'coordinator_expenses') {
    const categoryOptions = ['advance', 'fuel', 'tool', 'housing', 'transport', 'other'].map(v => `<option value="${v}" ${row.category === v ? 'selected' : ''}>${v}</option>`).join('');
    const paymentOptions = ['cash', 'card', 'bank', 'other'].map(v => `<option value="${v}" ${row.payment_method === v ? 'selected' : ''}>${v}</option>`).join('');
    const coordinatorUsers = (state.cache.users || []).length ? state.cache.users : [{ id: state.user?.id, name: state.user?.name || state.user?.email || 'Koordinator' }];
    body = `<div class="form-grid">
      <div class="field"><label>Datum</label><input class="input" name="expense_date" type="date" value="${esc(row.expense_date || today())}" required></div>
      <div class="field"><label>Kategorie</label><select class="select" name="category">${categoryOptions}</select></div>
      <div class="field"><label>Nazev vydaje</label><input class="input" name="title" value="${esc(row.title)}" placeholder="napr. zaloha, tankovani, rukavice" required></div>
      <div class="field"><label>Castka</label><input class="input" name="amount" type="number" step="0.01" value="${esc(row.amount || 0)}"></div>
      <div class="field"><label>Koordinator</label><select class="select" name="coordinator_user_id">${optionList(coordinatorUsers, row.coordinator_user_id || state.user?.id)}</select></div>
      <div class="field"><label>Zamestnanec</label><select class="select" name="employee_id">${optionList(state.cache.employees || [], row.employee_id)}</select></div>
      <div class="field"><label>Auto</label><select class="select" name="vehicle_id">${optionList((state.cache.vehicles || []).map(v => ({ id: v.id, name: `${v.plate_number} ${v.brand_model || ''}` })), row.vehicle_id)}</select></div>
      <div class="field"><label>Platba</label><select class="select" name="payment_method">${paymentOptions}</select></div>
      <div class="field"><label>Doklad / cislo</label><input class="input" name="receipt_number" value="${esc(row.receipt_number)}"></div>
    </div>${common.replace('name="notes"', 'name="note"')}`;
  } else {
    body = `<div class="form-grid"><div class="field"><label>Nazev</label><input class="input" name="name" value="${esc(row.name)}" required></div><div class="field"><label>Kapacita</label><input class="input" name="capacity" type="number" value="${esc(row.capacity || 0)}"></div><div class="field"><label>Mesicni cena</label><input class="input" name="monthly_cost" type="number" step="0.01" value="${esc(row.monthly_cost || 0)}"></div><div class="field"><label>Kontakt</label><input class="input" name="contact_person" value="${esc(row.contact_person)}"></div><div class="field"><label>Telefon</label><input class="input" name="contact_phone" value="${esc(row.contact_phone)}"></div><div class="field"><label>Stav</label><select class="select" name="status"><option value="active" ${row.status !== 'inactive' ? 'selected' : ''}>active</option><option value="inactive" ${row.status === 'inactive' ? 'selected' : ''}>inactive</option></select></div></div><div class="field"><label>Kdo zde bydli</label>${employeeMultiSelect(state.cache.employees || [], row.occupant_ids)}</div><div class="muted" style="margin-bottom:12px">Pri ulozeni se vybranym lidem zapise bydleni a cena jako srazka ze mzdy.</div><div class="field"><label>Adresa</label><textarea name="address">${esc(row.address)}</textarea></div>${common}`;
  }
  modal(id ? 'Upravit' : 'Novy zaznam', body, (_data, form) => {
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    if (type === 'accommodations') {
      data.occupant_ids = formData.getAll('occupant_ids').map(Number).filter(Boolean);
    }
    return api(id ? `resources/${type}/${id}` : `resources/${type}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
  });
}

async function renderCheckins() {
  loading('Check-iny');
  const [employees, objects, checkins] = await Promise.all([api(withCompany('employees')), api(withCompany('objects')).catch(() => ({ data: [] })), api(withCompany('checkins'))]);
  state.cache.employees = employees.data;
  state.cache.objects = objects.data;
  const rows = checkins.data.map(c => [
    esc(c.employee_name),
    esc(c.time_in),
    esc(c.time_out || 'aktivni'),
    `<span class="mono">${num(c.duration_hours || 0)}</span>`,
    `<span class="badge ${c.status === 'pending' ? 'warn' : c.status === 'rejected' ? 'danger' : 'accent'}">${esc(c.status || 'approved')}</span>`,
    `<div>${esc(c.object_name || c.location_name || '-')}</div>${locationMapHtml(c.lat, c.lng, c.location_accuracy, c.location_captured_at || c.last_seen_at, true)}<div class="muted">${esc(c.last_seen_at || '')}${c.movement_points ? ` / ${num(c.movement_points)} GPS` : ''}</div>`,
    esc(c.note || ''),
    can('checkins.write') && canManage() ? `${c.status === 'pending' ? `<button class="btn sm primary" onclick="Pokladna.approveCheckin(${c.id})">Schvalit</button>` : ''} <button class="btn sm danger" onclick="Pokladna.deleteCheckin(${c.id})">Smazat</button>` : '<span class="muted">Zadano</span>',
  ]);
  setContent(`${head('Check-iny', `${checkins.data.length} zaznamu`, can('checkins.write') ? '<button class="btn primary" onclick="Pokladna.checkin()">Check-in / out</button>' : '')}${rows.length ? table(['Zamestnanec','Prichod','Odchod','Hodiny','Stav','Poloha','Poznamka','Akce'], rows) : '<div class="card empty">Zadne check-iny</div>'}`);
}

function openCheckin() {
  if (!isGlobalUser() && state.isRohlikEmployee) {
    toast('Rohlik Brno nepouziva check-in v Pokladne.', 'warn');
    return;
  }
  const employeeField = canManage()
    ? `<div class="field"><label>Zamestnanec</label><select class="select" name="employee_id" required>${optionList(state.cache.employees || [], state.user.employee_id, 'Vyberte')}</select></div>`
    : ownEmployeeField();
  modal('Check-in / check-out', `
    ${employeeField}
    <div class="field"><label>Objekt</label><select class="select" name="object_id">${optionList(state.cache.objects || [], '', 'Nevybrano')}</select></div>
    ${canManage() ? `<div class="form-grid">
      <div class="field"><label>Prichod</label><input class="input" name="time_in" type="datetime-local" value="${dateTimeLocal()}"></div>
      <div class="field"><label>Odchod</label><input class="input" name="time_out" type="datetime-local"></div>
    </div>` : '<div class="card empty">Cas prichodu a odchodu se bere automaticky ze serveru. Pracovnik ho nemuze upravit.</div>'}
    <div class="form-grid">
      <div class="field"><label>Obed automaticky</label><input class="input" name="break_minutes" type="number" min="0" max="240" value="30" ${canManage() ? '' : 'readonly'}></div>
      <div class="field"><label>Dalsi obed / prestavka navic (min)</label><input class="input" name="extra_break_minutes" type="number" min="0" max="210" value="0"></div>
    </div>
    <input type="hidden" name="lat"><input type="hidden" name="lng">
    <input type="hidden" name="location_accuracy"><input type="hidden" name="location_captured_at"><input type="hidden" name="location_source">
    <div class="gps-lock">
      <div><strong>GPS poloha</strong><span>pouze aktualni poloha z telefonu / prohlizece</span></div>
      <button class="btn sm" type="button" onclick="Pokladna.fillLocation(this)">Nacist presnou GPS</button>
    </div>
    <div class="map-preview empty" data-gps-preview>GPS poloha zatim neni nactena</div>
    <div class="field"><label>Poznamka</label><textarea name="note"></textarea></div>`,
    async (data, form) => {
      if (!isGlobalUser() && (!data.lat || !data.lng)) {
        Object.assign(data, await captureGpsForForm(form));
      }
      await api('checkins', { method: 'POST', body: JSON.stringify(data) });
      startLocationWatch();
    }, 'Potvrdit');
}

async function fillLocation(button) {
  try {
    await captureGpsForForm(button.closest('form'), button);
    toast('Poloha nactena');
  } catch (err) {
    toast(err.message, 'danger');
  }
}

async function approveCheckin(id) {
  await api(`checkins/${id}/approve`, { method: 'PUT', body: '{}' });
  await renderPage();
  toast('Start prace schvalen');
}

function rejectCheckin(id) {
  modal('Odmitnout start prace', `<div class="field"><label>Duvod</label><textarea name="rejection_note"></textarea></div>`,
    data => api(`checkins/${id}/reject`, { method: 'PUT', body: JSON.stringify(data) }), 'Odmitnout');
}

function startLocationWatch() {
  if (!navigator.geolocation || state.geoWatch) return;
  state.geoWatch = navigator.geolocation.watchPosition(pos => {
    api('checkins/location', {
      method: 'POST',
      body: JSON.stringify({
        lat: pos.coords.latitude.toFixed(7),
        lng: pos.coords.longitude.toFixed(7),
        location_accuracy: pos.coords.accuracy !== undefined && pos.coords.accuracy !== null ? Number(pos.coords.accuracy).toFixed(2) : '',
        location_captured_at: new Date(pos.timestamp || Date.now()).toISOString(),
        location_source: 'browser_gps',
      }),
    }).catch(() => {});
  }, () => {}, { enableHighAccuracy: true, maximumAge: 45000, timeout: 15000 });
}

async function renderUsers() {
  loading('Uzivatele');
  const [users, employees, blocks] = await Promise.all([api('users'), api('employees'), api('blocks').catch(() => ({ data: [] }))]);
  state.cache.users = users.data;
  state.cache.permissions = users.permissions;
  state.cache.employees = employees.data;
  state.cache.blocks = blocks.data || [];
  const rows = users.data.map(u => [
    `<strong>${esc(u.name)}</strong><div class="muted">${esc(u.email)}</div>`,
    `<span class="badge">${esc(u.role)}</span>`,
    esc(u.employee_name || '-'),
    esc(u.last_login_at || '-'),
    `<button class="btn sm" onclick="Pokladna.user(${u.id})">Upravit</button> <button class="btn sm" onclick="Pokladna.permissions(${u.id})">Opravneni</button> ${Number(u.id) !== Number(state.user.id) ? `<button class="btn sm danger" onclick="Pokladna.deleteUser(${u.id})">Smazat</button>` : ''}`,
  ]);
  const blockRows = state.cache.blocks.map(b => [
    `<strong>${esc(b.name)}</strong><div class="muted">${esc(b.description || '')}</div>`,
    esc((b.permissions || []).join(', ')),
    `<button class="btn sm" onclick="Pokladna.block(${b.id})">Upravit</button> <button class="btn sm" onclick="Pokladna.applyBlock(${b.id})">Pouzit</button> <button class="btn sm danger" onclick="Pokladna.deleteBlock(${b.id})">Smazat</button>`,
  ]);
  const userSections = orderedSections('users', [
    { id: 'accounts', title: 'Uzivatelske ucty', note: `${rows.length} uctu`, body: rows.length ? table(['Uzivatel','Role','Zamestnanec','Posledni login','Akce'], rows) : '<div class="card empty">Zadne ucty</div>' },
    { id: 'blocks', title: 'Bloky opravneni', note: `${blockRows.length} bloku`, body: blockRows.length ? table(['Blok','Opravneni','Akce'], blockRows) : '<div class="card empty">Zadne bloky opravneni</div>' },
  ]);
  setContent(`${head('Uzivatele', `${users.data.length} uctu`, can('users.write') ? '<button class="btn primary" onclick="Pokladna.user()">Novy uzivatel</button><button class="btn" onclick="Pokladna.block()">Novy blok</button>' : '')}${userSections}`);
}

async function renderRecruitment() {
  loading('Nabor');
  const { data } = await api('recruitment');
  state.cache.recruitment = data;
  const rows = data.map(r => [
    `<strong>${esc(r.name)}</strong><div class="muted">${esc(r.phone || '')} ${esc(r.email || '')}</div>`,
    esc(r.desired_position || '-'),
    `<span class="badge">${esc(r.status)}</span>`,
    candidateBadge(r.contacted_status || 'pending', contactStatusLabels),
    candidateBadge(r.work_result || 'undecided', workResultLabels),
    esc(r.arrival_date || '-'),
    esc(r.source || '-'),
    `<div>${esc(r.next_contact_at || '-')}</div><div class="muted">posledni: ${esc(r.last_contact_at || '-')}</div>`,
    `<div>${candidateBadge(r.last_reaction || 'note', recruitmentReactionLabels)}</div><div class="muted">${esc(r.last_comment || r.result_note || r.feedback || '')}</div><div class="muted">${num(r.comments_count || 0)} komentaru</div>`,
    can('recruitment.write') ? `<button class="btn sm primary" onclick="Pokladna.recruitmentActivity(${r.id})">Reakce</button> <button class="btn sm" onclick="Pokladna.candidate(${r.id})">Upravit</button> <button class="btn sm danger" onclick="Pokladna.deleteCandidate(${r.id})">Smazat</button>` : `<button class="btn sm" onclick="Pokladna.recruitmentActivity(${r.id})">Historie</button>`,
  ]);
  const recruitmentSections = orderedSections('recruitment', [
    { id: 'candidates', title: 'Kandidati', note: `${data.length} kandidatu`, body: rows.length ? table(['Kandidat','Pozice','Stav','Kontakt','Vysledek','Prijezd','Zdroj','Kontaktovat','Reakce','Akce'], rows) : '<div class="card empty">Zadni kandidati</div>' },
  ]);
  setContent(`${head('Nabor', `${data.length} kandidatu`, can('recruitment.write') ? '<button class="btn primary" onclick="Pokladna.candidate()">Novy kandidat</button>' : '')}${recruitmentSections}`);
}

async function openRecruitmentActivity(id) {
  const row = (state.cache.recruitment || []).find(r => Number(r.id) === Number(id)) || {};
  const { data } = await api(`recruitment/${id}/comments`);
  const history = (data || []).map(item => `
    <div class="timeline-item">
      <div class="timeline-head">
        ${candidateBadge(item.reaction || 'note', recruitmentReactionLabels)}
        ${candidateBadge(item.contacted_status || 'pending', contactStatusLabels)}
        ${candidateBadge(item.work_result || 'undecided', workResultLabels)}
      </div>
      <div class="timeline-text">${esc(item.comment || '')}</div>
      <div class="muted">${esc(item.created_at || '')} / ${esc(item.created_by_name || '-')}</div>
      ${item.next_contact_at || item.arrival_date ? `<div class="muted">kontakt: ${esc(item.next_contact_at || '-')} / prijezd: ${esc(item.arrival_date || '-')}</div>` : ''}
    </div>`).join('');
  const form = can('recruitment.write') ? `
    <div class="section-title" style="margin-top:0">Nova reakce</div>
    <div class="form-grid">
      <div class="field"><label>Reakce</label><select class="select" name="reaction">${Object.entries(recruitmentReactionLabels).map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join('')}</select></div>
      <div class="field"><label>Kontakt</label><select class="select" name="contacted_status">${Object.entries(contactStatusLabels).map(([value, label]) => `<option value="${value}" ${(row.contacted_status || 'pending') === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></div>
      <div class="field"><label>Vysledek</label><select class="select" name="work_result">${Object.entries(workResultLabels).map(([value, label]) => `<option value="${value}" ${(row.work_result || 'undecided') === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></div>
      <div class="field"><label>Prijede</label><input class="input" name="arrival_date" type="date" value="${esc(row.arrival_date)}"></div>
      <div class="field"><label>Dalsi kontakt</label><input class="input" name="next_contact_at" type="datetime-local" value="${row.next_contact_at ? esc(row.next_contact_at.replace(' ', 'T').slice(0, 16)) : ''}"></div>
    </div>
    <div class="field"><label>Komentar prace s kandidatem</label><textarea name="comment" placeholder="Co jsme udelali, co rekl kandidat, domluveny dalsi krok"></textarea></div>` : '';
  modal(`Reakce: ${esc(row.name || '')}`, `
    ${form}
    <div class="section-title">Historie</div>
    <div class="timeline">${history || '<div class="card empty">Zatim bez komentaru</div>'}</div>`,
    can('recruitment.write') ? data => api(`recruitment/${id}/comments`, { method: 'POST', body: JSON.stringify(data) }) : null,
    'Pridat reakci');
}

function openCandidate(id) {
  const row = id ? state.cache.recruitment.find(r => Number(r.id) === Number(id)) : { status: 'new' };
  modal(id ? 'Upravit kandidata' : 'Novy kandidat', `
    <div class="form-grid">
      <div class="field"><label>Jmeno</label><input class="input" name="name" value="${esc(row.name)}" required></div>
      <div class="field"><label>Telefon</label><input class="input" name="phone" value="${esc(row.phone)}"></div>
      <div class="field"><label>E-mail</label><input class="input" name="email" type="email" value="${esc(row.email)}"></div>
      <div class="field"><label>Zdroj</label><input class="input" name="source" value="${esc(row.source)}"></div>
      <div class="field"><label>Pozice</label><input class="input" name="desired_position" value="${esc(row.desired_position)}"></div>
      <div class="field"><label>Stav</label><select class="select" name="status">${['new','called','no_answer','interview','rejected','hired','blacklist'].map(s => `<option value="${s}" ${row.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label>Kontakt</label><select class="select" name="contacted_status">${Object.entries(contactStatusLabels).map(([value, label]) => `<option value="${value}" ${(row.contacted_status || 'pending') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
      <div class="field"><label>Vysledek</label><select class="select" name="work_result">${Object.entries(workResultLabels).map(([value, label]) => `<option value="${value}" ${(row.work_result || 'undecided') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
      <div class="field"><label>Prijede</label><input class="input" name="arrival_date" type="date" value="${esc(row.arrival_date)}"></div>
      <div class="field"><label>Posledni kontakt</label><input class="input" name="last_contact_at" type="datetime-local" value="${row.last_contact_at ? esc(row.last_contact_at.replace(' ', 'T').slice(0, 16)) : ''}"></div>
      <div class="field"><label>Kontaktovat</label><input class="input" name="next_contact_at" type="datetime-local" value="${row.next_contact_at ? esc(row.next_contact_at.replace(' ', 'T').slice(0, 16)) : ''}"></div>
    </div>
    <div class="field"><label>Feedback</label><textarea name="feedback">${esc(row.feedback)}</textarea></div>
    <div class="field"><label>Vysledek / domluva</label><textarea name="result_note">${esc(row.result_note)}</textarea></div>`,
    data => api(id ? `recruitment/${id}` : 'recruitment', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) }));
}

async function renderStavba() {
  loading('Stavba');
  const groupParam = state.stavbaObjectId ? `&object_id=${encodeURIComponent(state.stavbaObjectId)}` : '';
  const { data } = await api(withCompany(`stavba?month=${state.month}&year=${state.year}${groupParam}`));
  state.cache.stavbaEmployees = data.employees || [];
  state.cache.stavbaManual = data.manual || [];
  state.cache.stavbaGroups = data.groups || [];
  const totals = data.totals || {};
  const selectedGroup = (state.cache.stavbaGroups || []).find(g => Number(g.id) === Number(state.stavbaObjectId));
  const groupButtons = `
    <div class="actions" style="margin-bottom:16px">
      <button class="btn sm ${state.stavbaObjectId ? '' : 'primary'}" onclick="Pokladna.stavbaGroup('')">Vsechny skupiny</button>
      ${(state.cache.stavbaGroups || []).map(g => `<button class="btn sm ${Number(g.id) === Number(state.stavbaObjectId) ? 'primary' : ''}" onclick="Pokladna.stavbaGroup(${g.id})">${esc(g.name)}<span class="muted">${num(g.employees_count || 0)}</span></button>`).join('')}
      ${can('objects.write') ? '<button class="btn sm" onclick="Pokladna.object()">Nova skupina / objekt</button>' : ''}
    </div>`;
  const summaryRows = (data.summary || []).map(r => [
    `<strong>${esc(r.employee_name)}</strong><div class="muted">${esc(r.company_name || '')} ${esc(r.object_name || '')}</div>`,
    `<span class="mono blue">${num(r.checkin_hours || 0)}</span><div class="muted">${num(r.checkin_count || 0)} check-in</div>`,
    `<span class="mono accent">${num(r.timesheet_hours || 0)}</span><div class="muted">${num(r.timesheet_count || 0)} hodiny</div>`,
    `<span class="mono warn">${num(r.manual_hours || 0)}</span><div class="muted">${num(r.manual_count || 0)} rucne</div>`,
    `<strong class="mono accent">${num(r.total_hours || 0)}</strong>`,
    `<span class="mono">${czk(r.hourly_rate || 0)}</span>`,
    `<strong class="mono">${czk(r.gross_amount || 0)}</strong>`,
    `<div>${esc(r.last_checkin_at || '-')}</div><div class="muted">hodiny: ${esc(r.last_timesheet_date || '-')}</div><div class="muted">rucne: ${esc(r.last_manual_date || '-')}</div>`,
    can('stavba.write') ? `<button class="btn sm" onclick="Pokladna.stavbaManual(${r.employee_id})">Pridat hodiny</button>` : '',
  ]);
  const manualRows = (data.manual || []).map(m => [
    esc(m.work_date || '-'),
    `<strong>${esc(m.employee_name)}</strong><div class="muted">${esc(m.company_name || '')} ${esc(m.object_name || '')}</div>`,
    `<span class="mono warn">${num(m.hours || 0)}</span>`,
    esc(m.note || ''),
    esc(m.created_by_name || '-'),
    can('stavba.write') ? `<button class="btn sm danger" onclick="Pokladna.deleteStavbaManual(${m.id})">Smazat</button>` : '',
  ]);
  const stavbaSections = orderedSections('stavba', [
    { id: 'summary', title: 'Souhrn Stavba', note: `${summaryRows.length} pracovniku`, body: summaryRows.length ? table(['Pracovnik','Check-in','Hodiny','Rucne','Celkem','Sazba','Hrube','Posledni zaznam','Akce'], summaryRows) : '<div class="card empty">Zadne hodiny pro Stavbu</div>' },
    { id: 'manual', title: 'Rucni hodiny', note: `${manualRows.length} zaznamu`, body: manualRows.length ? table(['Datum','Pracovnik','Hodiny','Poznamka','Zadal','Akce'], manualRows) : '<div class="card empty">Zadne rucni hodiny</div>' },
  ]);
  const activeTimerPeople = (data.summary || []).filter(r => Number(r.checkin_count || 0) > 0).length;
  setContent(`${head('Stavba', `${currentMonths()[state.month - 1]} ${state.year}${selectedGroup ? ` / ${esc(selectedGroup.name)}` : ''}`, can('stavba.write') ? '<button class="btn primary" onclick="Pokladna.stavbaManual()">Pridat rucni hodiny</button>' : '')}
    <section class="stavba-control">
      <div class="stavba-control-main">
        <span>BuildCrew Stavba</span>
        <strong>Ridici panel pro stavby, GPS smeny a vyplaty</strong>
        <small>Poradi prace: pracovnik startuje smenu v telefonu, GPS se ulozi automaticky, po ukonceni doplni komentar, administrator kontroluje a doplnuje rucni korekce.</small>
      </div>
      <div class="stavba-control-flow">
        <div><b>1</b><span>Check-in + GPS</span></div>
        <div><b>2</b><span>Timer a komentar</span></div>
        <div><b>3</b><span>Kontrola hodin</span></div>
        <div><b>4</b><span>Mzda a vyplata</span></div>
      </div>
    </section>
    ${groupButtons}
    <div class="grid grid-4" style="margin-bottom:16px">
      <div class="stat"><div class="stat-label">Lide</div><div class="stat-value accent">${num(totals.people || 0)}</div><div class="stat-note">s hodinami</div></div>
      <div class="stat"><div class="stat-label">GPS aktivni</div><div class="stat-value accent">${num(activeTimerPeople)}</div><div class="stat-note">pracovnici s check-inem</div></div>
      <div class="stat"><div class="stat-label">Check-in</div><div class="stat-value blue">${num(totals.checkin_hours || 0)}</div><div class="stat-note">schvalene smeny</div></div>
      <div class="stat"><div class="stat-label">Hodiny</div><div class="stat-value accent">${num(totals.timesheet_hours || 0)}</div><div class="stat-note">schvalene zadosti</div></div>
      <div class="stat"><div class="stat-label">Rucne</div><div class="stat-value warn">${num(totals.manual_hours || 0)}</div><div class="stat-note">doplnene hodiny</div></div>
      <div class="stat"><div class="stat-label">Celkem</div><div class="stat-value accent">${num(totals.total_hours || 0)}</div><div class="stat-note">${czk(totals.gross_amount || 0)}</div></div>
    </div>
    ${stavbaSections}`);
}

function setStavbaGroup(id) {
  state.stavbaObjectId = String(id || '');
  localStorage.setItem('pokladna_stavba_object', state.stavbaObjectId);
  renderPage();
}

function openStavbaManual(employeeId = '') {
  modal('Stavba - rucni hodiny', `
    <div class="form-grid">
      <div class="field"><label>Zamestnanec</label><select class="select" name="employee_id" required>${optionList(state.cache.stavbaEmployees || [], employeeId, 'Vyberte')}</select></div>
      <div class="field"><label>Datum</label><input class="input" name="work_date" type="date" value="${today()}" required></div>
      <div class="field"><label>Hodiny</label><input class="input" name="hours" type="number" step="0.01" min="0" value="0" required></div>
    </div>
    <div class="field"><label>Poznamka</label><textarea name="note" placeholder="napr. stavba, ukol, korekce"></textarea></div>`,
    data => api('stavba/manual', { method: 'POST', body: JSON.stringify(data) }), 'Ulozit hodiny');
}

async function deleteStavbaManual(id) {
  if (!confirm('Smazat rucni hodiny Stavba?')) return;
  await api(`stavba/manual/${id}`, { method: 'DELETE' });
  await renderPage();
  toast('Rucni hodiny smazany', 'warn');
}

function rohlikShiftTime(row = {}) {
  const start = String(row.shift_start || '').slice(0, 5);
  const end = String(row.shift_end || '').slice(0, 5);
  if (start && end) return `${start} - ${end}`;
  if (start) return `od ${start}`;
  return row.shift_label ? '-' : 'cas neurcen';
}

const rohlikShiftDepartments = ['Kompletace', 'Expedice', 'Prijem'];
const rohlikShiftPresets = {
  Kompletace: [
    { start: '02:30', end: '13:00', label: 'S1' },
    { start: '03:00', end: '13:00', label: 'S1' },
    { start: '04:00', end: '16:00', label: 'S2' },
    { start: '03:00', end: '16:00', label: 'S2' },
    { start: '09:00', end: '19:00', label: 'S3' },
    { start: '03:00', end: '09:00', label: 'S11' },
    { start: '11:00', end: '17:00', label: 'S5' },
    { start: '12:00', end: '22:30', label: 'S4' },
    { start: '14:00', end: '20:00', label: 'S12' },
    { start: '06:00', end: '12:00', label: 'S9' },
    { start: '12:00', end: '18:00', label: 'S10' },
  ],
  Expedice: [
    { start: '03:30', end: '08:30', label: '' },
    { start: '03:30', end: '10:00', label: '' },
    { start: '04:00', end: '17:30', label: 'S2' },
    { start: '03:00', end: '17:30', label: 'S2' },
    { start: '04:00', end: '11:00', label: 'S4' },
    { start: '11:00', end: '18:00', label: 'S5' },
    { start: '10:00', end: '20:00', label: 'S3' },
  ],
  Prijem: [],
};

function rohlikShiftDepartment(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'expedice') return 'Expedice';
  if (text === 'prijem') return 'Prijem';
  return 'Kompletace';
}

function rohlikShiftPresetKey(preset = {}) {
  return `${preset.start || ''}|${preset.end || ''}|${preset.label || ''}`;
}

function rohlikShiftPresetLabel(preset = {}) {
  const time = `${preset.start || '--:--'} - ${preset.end || '--:--'}`;
  return preset.label ? `${time} ${preset.label}` : time;
}

function rohlikShiftPresetOptions(department, row = {}) {
  const dept = rohlikShiftDepartment(department);
  const selected = rohlikShiftPresetKey({
    start: String(row.shift_start || '').slice(0, 5),
    end: String(row.shift_end || '').slice(0, 5),
    label: row.shift_label || '',
  });
  const empty = dept === 'Prijem' ? 'Rucne zadat zacatek a konec' : 'Vyberte smenu';
  return `<option value="">${empty}</option>${(rohlikShiftPresets[dept] || []).map(preset => {
    const key = rohlikShiftPresetKey(preset);
    return `<option value="${esc(key)}" ${key === selected ? 'selected' : ''}>${esc(rohlikShiftPresetLabel(preset))}</option>`;
  }).join('')}`;
}

function applyRohlikShiftDepartment(select) {
  const form = select.closest('form');
  const preset = form?.querySelector('[name="shift_preset"]');
  if (!preset) return;
  preset.innerHTML = rohlikShiftPresetOptions(select.value);
  if (rohlikShiftDepartment(select.value) === 'Prijem') {
    preset.value = '';
  }
}

function applyRohlikShiftPreset(select) {
  const value = String(select.value || '');
  if (!value) return;
  const [start, end, label] = value.split('|');
  const form = select.closest('form');
  if (!form) return;
  const startInput = form.querySelector('[name="shift_start"]');
  const endInput = form.querySelector('[name="shift_end"]');
  const labelInput = form.querySelector('[name="shift_label"]');
  if (startInput) startInput.value = start || '';
  if (endInput) endInput.value = end || '';
  if (labelInput) labelInput.value = label || '';
}

function rohlikShiftStatusBadge(status) {
  const value = status || 'planned';
  const cls = value === 'cancelled' ? 'danger' : 'accent';
  return `<span class="badge ${cls}">${esc(value)}</span>`;
}

function rohlikShiftRequestLabel(type) {
  return type === 'vacation' ? 'Dovolena' : 'Volno';
}

function rohlikShiftRequestBadge(status) {
  const value = status || 'pending';
  const cls = value === 'approved' ? 'accent' : value === 'rejected' ? 'danger' : 'warn';
  return `<span class="badge ${cls}">${esc(value)}</span>`;
}

function rohlikShiftRange(row = {}) {
  const from = row.date_from || '';
  const to = row.date_to || from;
  return from === to ? esc(from || '-') : `${esc(from)} - ${esc(to)}`;
}

async function renderRohlikShifts() {
  loading('Smeny');
  let payload;
  try {
    payload = await api(withCompany(`rohlik-shifts?month=${state.month}&year=${state.year}`));
  } catch (err) {
    setContent(`${head('Smeny', 'Rohlik Brno')}<div class="card empty">${esc(err.message)}</div>`);
    return;
  }
  const data = payload.data || {};
  const shifts = data.shifts || [];
  const requests = data.requests || [];
  const employees = data.employees || [];
  state.cache.rohlikShifts = shifts;
  state.cache.rohlikShiftRequests = requests;
  state.cache.rohlikShiftEmployees = employees;
  const todayText = today();
  const upcoming = shifts.filter(row => String(row.work_date || '') >= todayText && row.status !== 'cancelled');
  const pendingRequests = requests.filter(row => row.status === 'pending');
  const departmentTotals = rohlikShiftDepartments.reduce((acc, department) => {
    acc[department] = shifts.filter(row => rohlikShiftDepartment(row.department) === department).length;
    return acc;
  }, {});
  const shiftRows = shifts.map(row => [
    `<strong>${esc(row.work_date || '-')}</strong>`,
    `<span class="badge">${esc(rohlikShiftDepartment(row.department))}</span>`,
    `<span class="mono">${esc(rohlikShiftTime(row))}</span>`,
    employeeNameCell(row, { meta: `${row.company_name || '-'} / ${row.object_name || '-'}`, size: 'sm' }),
    `<strong>${esc(row.shift_label || '-')}</strong>`,
    esc(row.workplace || 'Rohlik Brno'),
    rohlikShiftStatusBadge(row.status),
    esc(row.note || ''),
    can('rohlik_shifts.write') ? `<button class="btn sm" onclick="Pokladna.rohlikShift(${row.id})">Upravit</button> <button class="btn sm danger" onclick="Pokladna.deleteRohlikShift(${row.id})">Smazat</button>` : '',
  ]);
  const requestRows = requests.map(row => [
    rohlikShiftRange(row),
    rohlikShiftRequestLabel(row.request_type),
    employeeNameCell(row, { meta: row.created_by_name || '', size: 'sm' }),
    rohlikShiftRequestBadge(row.status),
    esc(row.note || row.rejection_note || ''),
    esc(row.reviewed_by_name || '-'),
    can('rohlik_shifts.write') ? `${row.status === 'pending' ? `<button class="btn sm primary" onclick="Pokladna.approveRohlikShiftRequest(${row.id})">Schvalit</button> <button class="btn sm danger" onclick="Pokladna.rejectRohlikShiftRequest(${row.id})">Odmitnout</button>` : ''} <button class="btn sm danger" onclick="Pokladna.deleteRohlikShiftRequest(${row.id})">Smazat</button>` : '<span class="muted">Odeslano</span>',
  ]);
  const actions = `${can('rohlik_shifts.write') ? '<button class="btn primary" onclick="Pokladna.rohlikShift()">Pridat smenu</button>' : ''} ${can('rohlik_shifts.request') ? '<button class="btn primary" onclick="Pokladna.rohlikShiftRequest()">Pozadat o volno</button>' : ''}`;
  const sections = orderedSections('smeny', [
    { id: 'plan', title: 'Plan smen', note: `${shiftRows.length} smen`, body: shiftRows.length ? table(['Datum','Oddeleni','Cas','Pracovnik','Smena','Misto','Stav','Poznamka','Akce'], shiftRows, 'compact-table') : '<div class="card empty">Zadne smeny pro tento mesic</div>' },
    { id: 'requests', title: 'Zadosti o volno', note: `${requestRows.length} zadosti`, body: requestRows.length ? table(['Obdobi','Typ','Pracovnik','Stav','Poznamka','Vyresil','Akce'], requestRows, 'compact-table') : '<div class="card empty">Zadne zadosti</div>' },
  ]);
  setContent(`${head('Smeny', `Rohlik Brno / ${currentMonths()[state.month - 1]} ${state.year}`, actions)}
    <div class="grid grid-4" style="margin-bottom:16px">
      <div class="stat"><div class="stat-label">Smeny</div><div class="stat-value blue">${num(shifts.length)}</div><div class="stat-note">v mesici</div></div>
      <div class="stat"><div class="stat-label">Nejblizsi</div><div class="stat-value accent">${num(upcoming.length)}</div><div class="stat-note">od dneska</div></div>
      <div class="stat"><div class="stat-label">Zadosti</div><div class="stat-value ${pendingRequests.length ? 'warn' : 'accent'}">${num(pendingRequests.length)}</div><div class="stat-note">cekaji na potvrzeni</div></div>
      <div class="stat"><div class="stat-label">Pracovnici</div><div class="stat-value">${num(employees.length)}</div><div class="stat-note">Rohlik Brno</div></div>
      <div class="stat"><div class="stat-label">Kompletace</div><div class="stat-value">${num(departmentTotals.Kompletace || 0)}</div><div class="stat-note">smeny</div></div>
      <div class="stat"><div class="stat-label">Expedice</div><div class="stat-value">${num(departmentTotals.Expedice || 0)}</div><div class="stat-note">smeny</div></div>
      <div class="stat"><div class="stat-label">Prijem</div><div class="stat-value">${num(departmentTotals.Prijem || 0)}</div><div class="stat-note">rucne zadavane</div></div>
    </div>
    ${sections}`);
}

function openRohlikShift(id) {
  const row = id ? (state.cache.rohlikShifts || []).find(item => Number(item.id) === Number(id)) : { department: 'Kompletace', status: 'planned', work_date: today(), workplace: 'Rohlik Brno' };
  const department = rohlikShiftDepartment(row.department);
  const departmentOptions = rohlikShiftDepartments.map(value => `<option value="${value}" ${department === value ? 'selected' : ''}>${value}</option>`).join('');
  modal(id ? 'Upravit smenu' : 'Nova smena', `
    <div class="form-grid">
      <div class="field"><label>Pracovnik</label><select class="select" name="employee_id" required>${optionList(state.cache.rohlikShiftEmployees || [], row.employee_id, 'Vyberte')}</select></div>
      <div class="field"><label>Oddeleni</label><select class="select" name="department" onchange="Pokladna.rohlikShiftDepartment(this)">${departmentOptions}</select></div>
      <div class="field"><label>Sablona smeny</label><select class="select" name="shift_preset" onchange="Pokladna.rohlikShiftPreset(this)">${rohlikShiftPresetOptions(department, row)}</select></div>
      <div class="field"><label>Datum</label><input class="input" name="work_date" type="date" value="${esc(row.work_date || today())}" required></div>
      <div class="field"><label>Zacatek</label><input class="input" name="shift_start" type="time" value="${esc(String(row.shift_start || '').slice(0, 5))}"></div>
      <div class="field"><label>Konec</label><input class="input" name="shift_end" type="time" value="${esc(String(row.shift_end || '').slice(0, 5))}"></div>
      <div class="field"><label>Smena</label><input class="input" name="shift_label" value="${esc(row.shift_label || '')}" placeholder="napr. ranni, odpoledni, nocni"></div>
      <div class="field"><label>Misto</label><input class="input" name="workplace" value="${esc(row.workplace || 'Rohlik Brno')}"></div>
      <div class="field"><label>Stav</label><select class="select" name="status"><option value="planned" ${row.status !== 'cancelled' ? 'selected' : ''}>planned</option><option value="cancelled" ${row.status === 'cancelled' ? 'selected' : ''}>cancelled</option></select></div>
    </div>
    <div class="field"><label>Poznamka</label><textarea name="note">${esc(row.note || '')}</textarea></div>`,
    data => api(id ? `rohlik-shifts/${id}` : 'rohlik-shifts', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) }));
}

function openRohlikShiftRequest() {
  const ownEmployee = (state.cache.rohlikShiftEmployees || state.cache.employees || []).find(e => Number(e.id) === Number(state.user?.employee_id)) || {};
  const canPickEmployee = can('rohlik_shifts.write') && isGlobalUser();
  const employeeField = canPickEmployee
    ? `<div class="field"><label>Pracovnik</label><select class="select" name="employee_id">${optionList(state.cache.rohlikShiftEmployees || [], ownEmployee.id || state.user?.employee_id, 'Vyberte')}</select></div>`
    : `<input type="hidden" name="employee_id" value="${esc(state.user?.employee_id || '')}"><div class="field"><label>Pracovnik</label><input class="input" value="${esc(ownEmployee.name || state.user?.name || state.user?.email || '-')}" disabled></div>`;
  modal('Zadost o volno / dovolenou', `
    <div class="form-grid">
      ${employeeField}
      <div class="field"><label>Typ</label><select class="select" name="request_type"><option value="day_off">Volno</option><option value="vacation">Dovolena</option></select></div>
      <div class="field"><label>Od</label><input class="input" name="date_from" type="date" value="${today()}" required></div>
      <div class="field"><label>Do</label><input class="input" name="date_to" type="date" value="${today()}" required></div>
    </div>
    <div class="field"><label>Poznamka</label><textarea name="note" placeholder="duvod nebo domluva"></textarea></div>`,
    data => api('rohlik-shifts/request', { method: 'POST', body: JSON.stringify(data) }), 'Odeslat zadost');
}

async function approveRohlikShiftRequest(id) {
  await api(`rohlik-shifts/requests/${id}/approve`, { method: 'PUT', body: '{}' });
  await renderPage();
  toast('Zadost schvalena');
}

function rejectRohlikShiftRequest(id) {
  modal('Odmitnout zadost', `<div class="field"><label>Duvod</label><textarea name="rejection_note"></textarea></div>`,
    data => api(`rohlik-shifts/requests/${id}/reject`, { method: 'PUT', body: JSON.stringify(data) }), 'Odmitnout');
}

async function renderRohlikBrno() {
  loading('Rohlik Brno');
  const [rohlikPayload, expensePayload] = await Promise.all([
    api(`rohlik?month=${state.month}&year=${state.year}`),
    can('resources.view') ? api(rohlikExpensesPath(state.month, state.year)).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
  ]);
  const { data } = rohlikPayload;
  state.cache.rohlikRows = data.rows || [];
  state.cache.rohlikEmployees = data.employees || [];
  const totals = data.totals || {};
  const archive = data.archive || {};
  const archiveFixedAt = archive.is_archived ? dateTimeLabel(archive.fixed_at || archive.updated_at) : '';
  const archiveLabel = archive.is_archived ? `Fix archiv ${archiveFixedAt}` : 'Zive z Google tabulky';
  const archiveAction = can('rohlik.write')
    ? `<button class="btn primary" onclick="Pokladna.fixRohlikArchive()">${archive.is_archived ? 'Prepsat fix archiv' : 'Fixovat mesic'}</button>`
    : '';
  const rohlikRows = data.rows || [];
  const expenseSource = archive.is_archived && Array.isArray(data.other_expenses)
    ? data.other_expenses
    : (Array.isArray(data.other_expenses) ? data.other_expenses : (expensePayload.data || []));
  const otherExpenses = expenseSource.filter(isRohlikExpense);
  const otherExpenseTotal = otherExpenses.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const profitRows = rohlikRows.map(rohlikProfitInfo).filter(row => Number.isFinite(row.profit));
  const totalHourProfit = profitRows.reduce((sum, row) => sum + Number(row.grossProfit || 0), 0);
  const paidEmployerHealthTotal = profitRows.reduce((sum, row) => sum + Number(row.healthExpense || 0), 0);
  const cleanRohlikProfit = profitRows.reduce((sum, row) => sum + Number(row.profit || 0), 0);
  const totalClientAmount = profitRows.reduce((sum, row) => sum + Number(row.client.rate || 0) * Number(row.hours || 0), 0);
  const totalWorkerAmount = profitRows.reduce((sum, row) => sum + Number(row.workerRate || 0) * Number(row.hours || 0), 0);
  const finalProfit = cleanRohlikProfit - otherExpenseTotal;
  const payoutExpense = Number(totals.card_amount || 0) + Number(totals.cash_amount || 0);
  const unmappedRows = rohlikRows.length - profitRows.length;
  const periodButtons = (data.periods || []).slice(0, 12).map(p =>
    `<button class="btn sm ${Number(p.month) === Number(state.month) && Number(p.year) === Number(state.year) ? 'primary' : ''}" onclick="Pokladna.rohlikPeriod(${p.month}, ${p.year})">${currentMonths()[Number(p.month) - 1]} ${p.year}<span class="muted"> ${num(p.worked_hours)}</span>${p.archived ? '<span class="badge accent">fix</span>' : ''}</button>`
  ).join('');
  const remainsOf = r => Number(r.remains_amount ?? (Number(r.net_amount || 0) - Number(r.card_amount || 0) - Number(r.cash_amount || 0)));
  const accounting = {};
  (data.rows || []).forEach(r => {
    const type = rohlikContractLabel(r.contract_type);
    const key = type === '-' ? 'Bez typu' : type;
    if (!accounting[key]) {
      accounting[key] = { type: key, people: 0, worked_hours: 0, bonus_hours: 0, payable_hours: 0, gross_amount: 0, advance_amount: 0, manual_advance_amount: 0, requested_advance_amount: 0, net_amount: 0, card_amount: 0, cash_amount: 0, employer_health_amount: 0, employer_health_expense: 0, employer_health_paid_people: 0, remains_amount: 0, company_owes_amount: 0, employee_owes_amount: 0 };
    }
    const balance = rohlikBalanceInfo(r);
    accounting[key].people += 1;
    accounting[key].worked_hours += Number(r.worked_hours || 0);
    accounting[key].bonus_hours += Number(r.bonus_hours ?? r.extra_hours ?? 0);
    accounting[key].payable_hours += Number(r.payable_hours ?? (Number(r.worked_hours || 0) + Number(r.extra_hours || 0)));
    accounting[key].gross_amount += Number(r.gross_amount || 0);
    accounting[key].advance_amount += Number(r.advance_amount || 0);
    accounting[key].manual_advance_amount += Number(r.manual_advance_amount || 0);
    accounting[key].requested_advance_amount += Number(r.requested_advance_amount || 0);
    accounting[key].net_amount += Number(r.net_amount || 0);
    accounting[key].card_amount += Number(r.card_amount || 0);
    accounting[key].cash_amount += Number(r.cash_amount || 0);
    accounting[key].employer_health_amount += rohlikEmployerHealthAmount(r);
    accounting[key].employer_health_expense += Number(r.employer_health_expense || 0);
    if (Number(r.employer_health_paid || 0) === 1) accounting[key].employer_health_paid_people += 1;
    accounting[key].remains_amount += remainsOf(r);
    if (remainsOf(r) > 0) accounting[key].company_owes_amount += balance.amount;
    if (remainsOf(r) < 0) accounting[key].employee_owes_amount += balance.amount;
  });
  const accountingRows = Object.values(accounting).map(r => [
    r.type === 'Bez typu' ? '<span class="badge">Bez typu</span>' : rohlikContractBadge(r.type),
    `<span class="mono">${num(r.people)}</span>`,
    `<span class="mono">${num(r.worked_hours)}</span>`,
    `<span class="mono warn">${num(r.bonus_hours)}</span>`,
    `<span class="mono blue">${num(r.payable_hours)}</span>`,
    `<span class="mono">${czk(r.gross_amount)}</span>`,
    `<span class="mono warn">${czk(r.advance_amount)}</span><div class="muted">zadosti ${czk(r.requested_advance_amount)} / rucne ${czk(r.manual_advance_amount)}</div>`,
    `<span class="mono ${r.employer_health_expense > 0 ? 'danger' : 'warn'}">${czk(r.employer_health_expense)}</span><div class="muted">z ${czk(rohlikEmployerHealthAmount(r))} / zaplaceno ${num(r.employer_health_paid_people)}</div>`,
    `<strong class="mono accent">${czk(r.net_amount)}</strong>`,
    `<span class="mono blue">${czk(r.card_amount)}</span>`,
    `<span class="mono warn">${czk(r.cash_amount)}</span>`,
    `<strong class="mono warn">${czk(r.company_owes_amount)}</strong>`,
    `<strong class="mono danger">${czk(r.employee_owes_amount)}</strong>`,
    `<strong class="mono ${Number(r.remains_amount) === 0 ? 'accent' : 'danger'}">${czk(r.remains_amount)}</strong>`,
  ]);
  if (accountingRows.length) {
    accountingRows.push([
      '<strong>Celkem</strong>',
      `<strong class="mono">${num(totals.people || 0)}</strong>`,
      `<strong class="mono">${num(totals.worked_hours || 0)}</strong>`,
      `<strong class="mono warn">${num(totals.bonus_hours || totals.extra_hours || 0)}</strong>`,
      `<strong class="mono blue">${num(totals.payable_hours || (Number(totals.worked_hours || 0) + Number(totals.extra_hours || 0)))}</strong>`,
      `<strong class="mono">${czk(totals.gross_amount || 0)}</strong>`,
      `<strong class="mono warn">${czk(totals.advance_amount || 0)}</strong><div class="muted">zadosti ${czk(totals.requested_advance_amount || 0)} / rucne ${czk(totals.manual_advance_amount || 0)}</div>`,
      `<strong class="mono danger">${czk(totals.employer_health_expense || 0)}</strong><div class="muted">z ${czk(totals.employer_health_amount || 0)} / zaplaceno ${num(totals.employer_health_paid_people || 0)}</div>`,
      `<strong class="mono accent">${czk(totals.net_amount || 0)}</strong>`,
      `<strong class="mono blue">${czk(totals.card_amount || 0)}</strong>`,
      `<strong class="mono warn">${czk(totals.cash_amount || 0)}</strong>`,
      `<strong class="mono warn">${czk(totals.company_owes_amount || 0)}</strong>`,
      `<strong class="mono danger">${czk(totals.employee_owes_amount || 0)}</strong>`,
      `<strong class="mono ${Number(totals.remains_amount || 0) === 0 ? 'accent' : 'danger'}">${czk(totals.remains_amount || 0)}</strong>`,
    ]);
  }
  const rohlikColumnDefs = [
    { key: 'worker', label: 'Pracovnik', cell: (r, i) => `${can('rohlik.write') ? `<button class="btn sm" style="margin-bottom:6px" onclick="Pokladna.rohlikAdjustment(${i})">Upravit info</button>` : ''}${employeeNameCell(r, { meta: r.matched ? 'sparovano' : 'bez karty zamestnance', size: 'sm' })}` },
    { key: 'email', label: 'Email', cell: r => `<span class="mono">${esc(r.email)}</span>` },
    { key: 'contract', label: 'Typ', cell: r => rohlikContractBadge(r.contract_type) },
    { key: 'position', label: 'Pozice', cell: r => `${esc(rohlikPositionLabel(r.position))}<div class="muted">${esc(r.rate_label || '')}</div>` },
    { key: 'days', label: 'Dni', cell: r => `<span class="mono">${num(r.days)}</span>` },
    { key: 'attendance', label: 'Dochazka', cell: r => `<span class="mono blue">${num(r.attendance_hours)}</span>` },
    { key: 'worked', label: 'Odprac.', cell: r => `<span class="mono">${num(r.worked_hours)}</span>` },
    { key: 'bonus_hours', label: 'Bonus hodiny', cell: r => `<span class="mono warn">${num(r.bonus_hours ?? r.extra_hours ?? 0)}</span>` },
    { key: 'payable_hours', label: 'Hod. k vypl.', cell: r => `<span class="mono blue">${num(r.payable_hours ?? (Number(r.worked_hours || 0) + Number(r.extra_hours || 0)))}</span>` },
    { key: 'billing', label: 'Bonus ciste', cell: r => `<span class="mono warn">${num(r.bonus_hours ?? r.extra_hours ?? 0)}</span>` },
    { key: 'productivity', label: 'Produktivita', cell: r => `<strong class="${Number(r.avg_productivity) >= 100 ? 'accent' : Number(r.avg_productivity) >= 90 ? 'warn' : 'danger'}">${num(r.avg_productivity)}%</strong>` },
    { key: 'efficiency', label: 'Efektivita', cell: r => `<strong class="${Number(r.avg_efficiency) >= 100 ? 'accent' : Number(r.avg_efficiency) >= 90 ? 'warn' : 'danger'}">${num(r.avg_efficiency)}%</strong>` },
    { key: 'rate', label: 'Sazba', cell: r => `<span class="mono">${czk(r.hourly_rate)}</span><div class="muted">${rateSourceBadge(r.rate_source)}</div>${r.rate_mismatch ? `<div class="muted danger">v Rohlik rucne ${czk(r.manual_hourly_rate || 0)}</div>` : ''}` },
    { key: 'client_rate', label: 'Tarif Rohlik', cell: r => rohlikClientRateCell(r) },
    { key: 'profit', label: 'Cisty profit', cell: r => rohlikProfitCell(r) },
    { key: 'employer_health', label: 'Zdravotka', cell: r => rohlikEmployerHealthCell(r) },
    { key: 'gross', label: 'Hrube', cell: r => `<span class="mono">${czk(r.gross_amount)}</span>` },
    { key: 'advance', label: 'Zaloha', cell: r => `<span class="mono warn">${czk(r.advance_amount)}</span><div class="muted">zadosti ${czk(r.requested_advance_amount || 0)} / rucne ${czk(r.manual_advance_amount || 0)}</div>` },
    { key: 'bonus', label: 'Bonus/srazka', cell: r => `<span class="mono">${czk(Number(r.bonus_amount || 0) - Number(r.deduction_amount || 0))}</span>` },
    { key: 'net', label: 'K vyplate', cell: r => `<strong class="${Number(r.net_amount) >= 0 ? 'accent' : 'danger'}">${czk(r.net_amount)}</strong><div class="muted">${esc(r.note || '')}</div>` },
    { key: 'card', label: 'Karta', cell: r => `<span class="mono blue">${czk(r.card_amount)}</span>` },
    { key: 'cash', label: 'Hotovost', cell: r => `<span class="mono warn">${czk(r.cash_amount)}</span>` },
    { key: 'balance', label: 'Stav', cell: r => rohlikBalanceCell(r) },
    { key: 'remains', label: 'Zbyva', cell: r => `<strong class="mono ${remainsOf(r) === 0 ? 'accent' : 'danger'}">${czk(remainsOf(r))}</strong>` },
  ];
  const visibleRohlikColumns = rohlikVisibleColumns(rohlikColumnDefs);
  const rows = (data.rows || []).map((r, i) => visibleRohlikColumns.map(column => column.cell(r, i)));
  const expenseRows = otherExpenses.map(row => [
    esc(row.expense_date || '-'),
    `<span class="badge">${esc(rohlikExpenseLabel(row.category))}</span>`,
    `<strong>${esc(row.title || '-')}</strong><div class="muted">${esc(row.note || '')}</div>`,
    `<span class="mono warn">${czk(row.amount || 0)}</span>`,
    esc(row.payment_method || '-'),
    row.employee_name ? employeeNameCell(row, { meta: row.vehicle_plate ? `auto ${row.vehicle_plate}` : '', size: 'sm' }) : esc(row.vehicle_plate || '-'),
  ]);
  setContent(`${head('Rohlik Brno', `${esc(data.company)} / ${currentMonths()[state.month - 1]} ${state.year} / ${esc(archiveLabel)}`, `${archiveAction}<button class="btn" onclick="Pokladna.go('rohlik')">Obnovit</button>`)}
    <div class="grid grid-4" style="margin-bottom:16px">
      <div class="stat"><div class="stat-label">Prijem Rohlik</div><div class="stat-value blue">${czk(totalClientAmount)}</div><div class="stat-note">${num(totals.payable_hours || 0)} h podle tarifu</div></div>
      <div class="stat"><div class="stat-label">Vydaj pracovnici</div><div class="stat-value warn">${czk(totalWorkerAmount)}</div><div class="stat-note">sazba pracovnika x hodiny</div></div>
      <div class="stat"><div class="stat-label">Profit z hodin</div><div class="stat-value ${totalHourProfit >= 0 ? 'accent' : 'danger'}">${czk(totalHourProfit)}</div><div class="stat-note">pred zdravotkou / odvody</div></div>
      <div class="stat"><div class="stat-label">Zdravotka zaplacena</div><div class="stat-value danger">${czk(paidEmployerHealthTotal)}</div><div class="stat-note">${num(totals.employer_health_paid_people || 0)} lidi / neplaceno ${num(totals.employer_health_unpaid_people || 0)}</div></div>
      <div class="stat"><div class="stat-label">Ostatni vydaje</div><div class="stat-value danger">${czk(otherExpenseTotal)}</div><div class="stat-note">${num(otherExpenses.length)} zaznamu koordin./vydaju</div></div>
      <div class="stat"><div class="stat-label">Cisty profit</div><div class="stat-value ${finalProfit >= 0 ? 'accent' : 'danger'}">${czk(finalProfit)}</div><div class="stat-note">profit - zaplacene odvody - vydaje</div></div>
      <div class="stat"><div class="stat-label">Vyplatit</div><div class="stat-value warn">${czk(payoutExpense)}</div><div class="stat-note">karta ${czk(totals.card_amount || 0)} / hotovost ${czk(totals.cash_amount || 0)}</div></div>
      <div class="stat"><div class="stat-label">Zalohy</div><div class="stat-value warn">${czk(totals.advance_amount || 0)}</div><div class="stat-note">zadosti ${czk(totals.requested_advance_amount || 0)} / rucne ${czk(totals.manual_advance_amount || 0)}</div></div>
      <div class="stat"><div class="stat-label">Bez tarifu</div><div class="stat-value ${unmappedRows ? 'danger' : 'accent'}">${num(unmappedRows)}</div><div class="stat-note">radky bez KV/DV/novy</div></div>
    </div>
    <div class="grid grid-4" style="margin-bottom:16px">
      <div class="stat"><div class="stat-label">Lide</div><div class="stat-value accent">${num(totals.people || 0)}</div><div class="stat-note">e-maily v mesici</div></div>
      <div class="stat"><div class="stat-label">Hodiny</div><div class="stat-value blue">${num(totals.worked_hours || 0)}</div><div class="stat-note">+ ${num(totals.bonus_hours || totals.extra_hours || 0)} bonus</div></div>
      <div class="stat"><div class="stat-label">Doplatit lidem</div><div class="stat-value warn">${czk(totals.company_owes_amount || 0)}</div><div class="stat-note">${num(totals.company_owes_people || 0)} lidi</div></div>
      <div class="stat"><div class="stat-label">V minusu</div><div class="stat-value danger">${czk(totals.employee_owes_amount || 0)}</div><div class="stat-note">${num(totals.employee_owes_people || 0)} lidi</div></div>
      <div class="stat"><div class="stat-label">Archiv</div><div class="stat-value ${archive.is_archived ? 'accent' : 'warn'}">${archive.is_archived ? 'FIX' : 'LIVE'}</div><div class="stat-note">${archive.is_archived ? `ulozeno ${esc(archiveFixedAt)}` : 'mesic jeste neni fixovany'}</div></div>
    </div>
    <div class="section-title">Archiv mesicu</div>
    <div class="actions">${periodButtons || '<span class="muted">Zadne mesice z Google tabulky</span>'}</div>
    ${rohlikColumnPicker(rohlikColumnDefs)}
    <div class="section-title">Vypocet Rohlik Brno</div>
    ${rows.length ? table(visibleRohlikColumns.map(column => column.label), rows, 'rohlik-table compact-table') : '<div class="card empty">V tomto mesici nejsou data Rohlik Brno</div>'}
    <div class="section-title">Ostatni vydaje Rohlik</div>
    ${expenseRows.length ? table(['Datum','Typ','Popis','Castka','Platba','Vazba'], expenseRows, 'compact-table') : '<div class="card empty">Zadne ostatni vydaje Rohlik / ROSHPIT v tomto mesici</div>'}
    <div class="section-title">Souhrn smluv</div>
    ${accountingRows.length ? table(['Typ','Lide','Hodiny','Navic','Hod. k vypl.','Hrube','Zalohy','Zdravotka','K vyplate','Karta','Hotovost','Doplatit','V minusu','Zbyva'], accountingRows) : '<div class="card empty">Zadny souhrn pro ucetni</div>'}`);
}

function renderRohlikOstrava() {
  setContent(`${head('Rohlik Ostrava', `${currentMonths()[state.month - 1]} ${state.year}`)}
    <div class="grid grid-4" style="margin-bottom:16px">
      <div class="stat"><div class="stat-label">Stav</div><div class="stat-value warn">READY</div><div class="stat-note">samostatny blok je pripraveny</div></div>
      <div class="stat"><div class="stat-label">Data</div><div class="stat-value">0</div><div class="stat-note">cekame na Google tabulku Ostrava</div></div>
      <div class="stat"><div class="stat-label">Firma</div><div class="stat-value">Rohlik</div><div class="stat-note">oddeleno od Brno</div></div>
      <div class="stat"><div class="stat-label">Vypocet</div><div class="stat-value blue">OK</div><div class="stat-note">bude stejne oddeleny jako Brno</div></div>
    </div>
    <div class="card empty">Rohlik Ostrava je pridany jako samostatny bod menu. Jakmile bude jasna Google tabulka a sloupce pro Ostravu, napoji se sem samostatny import bez michani s Rohlik Brno.</div>`);
}

function openRohlikAdjustment(index) {
  const row = state.cache.rohlikRows?.[index];
  if (!row) return;
  const remains = Number(row.remains_amount ?? (Number(row.net_amount || 0) - Number(row.card_amount || 0) - Number(row.cash_amount || 0)));
  const contractOptions = ['', 'HPP', 'DPP', 'DPC', 'Zivnost'].map(value => `<option value="${value}" ${rohlikContractLabel(row.contract_type) === (value || '-') ? 'selected' : ''}>${value || 'Nevybrano'}</option>`).join('');
  const employerHealthAmount = rohlikEmployerHealthAmount(row);
  const employerHealthDefault = rohlikDefaultEmployerHealthAmount(row.contract_type);
  modal('Rohlik Brno - vypocet pracovnika', `
    <input type="hidden" name="email" value="${esc(row.email)}">
    <input type="hidden" name="month" value="${state.month}">
    <input type="hidden" name="year" value="${state.year}">
    <div class="profile-grid compact-profile" style="margin-bottom:14px">
      <div><span>Email</span><strong>${esc(row.email)}</strong></div>
      <div><span>Odpracovano</span><strong>${num(row.worked_hours)} h</strong></div>
      <div><span>K vyplate</span><strong>${czk(row.net_amount)}</strong></div>
      <div><span>Zbyva rozdelit</span><strong class="${remains === 0 ? 'accent' : 'danger'}">${czk(remains)}</strong></div>
    </div>
    <div class="form-grid">
      <div class="field"><label>Zamestnanec</label><select class="select" name="employee_id">${optionList(state.cache.rohlikEmployees || [], row.employee_id, 'Bez parovani')}</select></div>
      <div class="field"><label>Jmeno v Rohliku</label><input class="input" name="full_name" value="${esc(row.employee_name || '')}"></div>
      <div class="field"><label>Typ smlouvy</label><select class="select" name="contract_type" onchange="Pokladna.rohlikHealthDefault(this)">${contractOptions}</select></div>
      <div class="field"><label>Sazba / hod</label><input class="input" name="hourly_rate" type="number" step="0.01" value="${esc(row.hourly_rate || 0)}"></div>
      <div class="field"><label>Rucni zaloha</label><input class="input" name="advance_amount" type="number" step="0.01" value="${esc(row.manual_advance_amount ?? row.advance_amount ?? 0)}"></div>
      <div class="field"><label>Zalohy ze zadosti</label><input class="input" value="${esc(czk(row.requested_advance_amount || 0))}" disabled></div>
      <div class="field"><label>Bonus</label><input class="input" name="bonus_amount" type="number" step="0.01" value="${esc(row.bonus_amount || 0)}"></div>
      <div class="field"><label>Srazka</label><input class="input" name="deduction_amount" type="number" step="0.01" value="${esc(row.deduction_amount || 0)}"></div>
      <div class="field"><label>Zdravotka / odvody firmy</label><input class="input" name="employer_health_amount" type="number" step="0.01" data-default="${esc(employerHealthDefault)}" value="${esc(employerHealthAmount)}" oninput="this.dataset.touched='1'"></div>
      <label class="checkline payout-check"><input type="checkbox" name="employer_health_paid" value="1" ${Number(row.employer_health_paid || 0) === 1 ? 'checked' : ''}> Zdravotka zaplacena - odecist z profitu</label>
      <div class="field"><label>Na kartu</label><input class="input" name="card_amount" type="number" step="0.01" value="${esc(row.card_amount || 0)}"></div>
      <div class="field"><label>Hotovost</label><input class="input" name="cash_amount" type="number" step="0.01" value="${esc(row.cash_amount || 0)}"></div>
    </div>
    <div class="field"><label>Poznamka</label><textarea name="note">${esc(row.note || '')}</textarea></div>`,
    data => api('rohlik/adjustment', { method: 'POST', body: JSON.stringify(data) }), 'Ulozit vypocet');
}

function rohlikPeriod(month, year) {
  state.month = Number(month);
  state.year = Number(year);
  renderPage();
}

async function fixRohlikArchive() {
  const label = `${currentMonths()[state.month - 1]} ${state.year}`;
  if (!confirm(`Fixovat archiv Rohlik Brno za ${label}? Tento mesic se ulozi jako pevny snimek.`)) return;
  await api('rohlik/archive', { method: 'POST', body: JSON.stringify({ month: state.month, year: state.year }) });
  await renderPage();
  toast('Mesic je ulozeny ve fix archivu');
}

async function renderWarehouse() {
  loading('Sklad');
  const [{ data }, employees] = await Promise.all([api(withCompany(`warehouse?month=${state.month}&year=${state.year}`)), api(withCompany('employees')).catch(() => ({ data: [] }))]);
  state.cache.employees = employees.data;
  const summary = data.summary || [];
  const totals = summary.reduce((acc, r) => {
    acc.worked += Number(r.worked_hours || 0);
    acc.attendance += Number(r.attendance_hours || 0);
    acc.submitted += Number(r.submitted_hours || 0);
    acc.extra += Number(r.extra_hours || 0);
    acc.billing += Number(r.billing_hours || 0);
    acc.eff += Number(r.avg_efficiency || 0);
    return acc;
  }, { worked: 0, attendance: 0, submitted: 0, extra: 0, billing: 0, eff: 0 });
  const summaryRows = summary.map(r => [
    `<strong>${esc(r.employee_name || r.email)}</strong><div class="muted">${esc(r.email)}</div>`,
    `${esc(r.position || '-')}<div class="muted">${r.source_key === 'manual' ? 'manual' : r.source_key === 'checkins' ? 'check-in' : r.source_key === 'timesheets' ? 'schvalene hodiny' : 'SUMA'}</div>`,
    `<span class="mono">${num(r.worked_hours)}</span>`,
    `<span class="mono accent">${num(r.submitted_hours || 0)}</span>`,
    `<span class="mono blue">${num(r.attendance_hours || 0)}</span>`,
    `<span class="mono">${num(r.extra_hours)}</span>`,
    `<span class="mono">${num(r.billing_hours)}</span>`,
    `<strong class="${Number(r.avg_efficiency) >= 100 ? 'accent' : Number(r.avg_efficiency) >= 90 ? 'warn' : 'danger'}">${num(r.avg_efficiency)}%</strong>`,
    `<span class="muted">${esc(r.period_start || '')} - ${esc(r.period_end || '')}</span>`,
  ]);
  const last = data.last_sync ? `${esc(data.last_sync.started_at || '')} ${esc(data.last_sync.status || '')}` : 'bez synchronizace';
  setContent(`${head('Sklad', `SUMA + manual | ${last}`, can('warehouse.sync') ? '<button class="btn primary" onclick="Pokladna.syncWarehouse()">Synchronizovat</button><button class="btn" onclick="Pokladna.warehouseManual()">Pridat hodiny</button>' : '')}
    <div class="grid grid-4" style="margin-bottom:16px">
      <div class="stat"><div class="stat-label">Odpracovano</div><div class="stat-value blue">${num(totals.worked)}</div></div>
      <div class="stat"><div class="stat-label">Schvalene hodiny</div><div class="stat-value accent">${num(totals.submitted)}</div></div>
      <div class="stat"><div class="stat-label">Check-in hodiny</div><div class="stat-value blue">${num(totals.attendance)}</div></div>
      <div class="stat"><div class="stat-label">Hodiny navic</div><div class="stat-value warn">${num(totals.extra)}</div></div>
    </div>
    <div class="section-title">SUMA + schvalene hodiny + dochazka</div>${summaryRows.length ? table(['Pracovnik','Pozice','Hodiny','Schvalene','Check-in','Navic','Bonus ciste','Efektivita','Obdobi'], summaryRows) : '<div class="card empty">Zadne skladove souhrny</div>'}`);
}

function openWarehouseManual() {
  modal('Sklad - hodiny pracovnika', `
    <div class="form-grid">
      <div class="field"><label>Zamestnanec</label><select class="select" name="employee_id" required>${optionList(state.cache.employees || [], '', 'Vyberte')}</select></div>
      <div class="field"><label>Pozice</label><input class="input" name="position" placeholder="exp / inb / pre"></div>
      <div class="field"><label>Od</label><input class="input" name="period_start" type="date" value="${state.year}-${String(state.month).padStart(2, '0')}-01" required></div>
      <div class="field"><label>Do</label><input class="input" name="period_end" type="date" value="${today()}" required></div>
      <div class="field"><label>Hodiny</label><input class="input" name="worked_hours" type="number" step="0.01" value="0"></div>
      <div class="field"><label>Hodiny navic</label><input class="input" name="extra_hours" type="number" step="0.01" value="0"></div>
      <div class="field"><label>Bonus hodiny ciste</label><input class="input" name="billing_hours" type="number" step="0.01" value="0"></div>
      <div class="field"><label>Produktivita %</label><input class="input" name="productivity_percent" type="number" step="0.01" value="0"></div>
      <div class="field"><label>Efektivita %</label><input class="input" name="efficiency_percent" type="number" step="0.01" placeholder="auto"></div>
    </div>
    <div class="field"><label>Poznamka</label><textarea name="note"></textarea></div>`,
    data => api('warehouse/manual', { method: 'POST', body: JSON.stringify(data) }));
}

async function syncWarehouse() {
  toast('Synchronizuji sklad...');
  await api('warehouse/sync', { method: 'POST', body: '{}' });
  await renderPage();
  toast('Sklad synchronizovan');
}

function shiftPause() {
  const input = document.getElementById('quickShiftExtraBreak');
  const current = Math.max(0, Number(input?.value || 0));
  if (input) input.value = String(Math.min(210, current + 30));
  document.querySelectorAll('.buildcrew-timer-box').forEach(el => el.classList.add('paused'));
  toast('Pauza 30 min je pripravena k odectu pri ukonceni smeny.', 'warn');
}

async function quickShift(mode) {
  const isStart = mode === 'start';
  const controls = Array.from(document.querySelectorAll('.buildcrew-start-orb, .shift-start, .shift-end, .buildcrew-action-grid .btn'));
  const startOrb = document.querySelector('.buildcrew-start-orb');
  const startLabel = startOrb?.querySelector('strong');
  const startSmall = startOrb?.querySelector('small');
  const originalLabel = startLabel?.textContent || '';
  const originalSmall = startSmall?.textContent || '';
  controls.forEach(button => { button.disabled = true; });
  if (isStart && startOrb) {
    startOrb.classList.add('starting');
    if (startLabel) startLabel.textContent = 'GPS';
    if (startSmall) startSmall.textContent = 'hledam polohu...';
  }
  if (!isGlobalUser() && state.isRohlikEmployee) {
    toast('Rohlik Brno nepouziva check-in v Pokladne.', 'warn');
    controls.forEach(button => { button.disabled = false; });
    if (startOrb) startOrb.classList.remove('starting');
    return;
  }
  const note = document.getElementById('quickShiftNote')?.value || '';
  if (state.isStavbaEmployee && mode === 'end' && !note.trim()) {
    toast('Napis, co jsi dnes delal.', 'warn');
    document.getElementById('quickShiftNote')?.focus();
    controls.forEach(button => { button.disabled = false; });
    if (startOrb) startOrb.classList.remove('starting');
    return;
  }
  const extraBreak = document.getElementById('quickShiftExtraBreak')?.value || '0';
  const own = (state.cache.employees || []).find(e => Number(e.id) === Number(state.user?.employee_id)) || {};
  const data = { employee_id: state.user?.employee_id || '', object_id: own.object_id || '', note, break_minutes: 30, extra_break_minutes: extraBreak };
  try {
    Object.assign(data, gpsPayload(await currentGpsPosition()));
    if (isStart && startSmall) startSmall.textContent = 'spoustim smenu...';
  } catch (err) {
    toast(err?.message || 'GPS polohu se nepodarilo nacist', 'danger');
    controls.forEach(button => { button.disabled = false; });
    if (startOrb) {
      startOrb.classList.remove('starting');
      if (startLabel) startLabel.textContent = originalLabel;
      if (startSmall) startSmall.textContent = originalSmall;
    }
    return;
  }
  if (mode === 'end') {
    data.time_out = dateTimeLocal();
  } else {
    data.time_in = dateTimeLocal();
  }
  try {
    await api('checkins', { method: 'POST', body: JSON.stringify(data) });
  } catch (err) {
    toast(err?.message || 'Smenu se nepodarilo ulozit', 'danger');
    controls.forEach(button => { button.disabled = false; });
    if (startOrb) {
      startOrb.classList.remove('starting');
      if (startLabel) startLabel.textContent = originalLabel;
      if (startSmall) startSmall.textContent = originalSmall;
    }
    return;
  }
  if (mode === 'start') {
    startLocationWatch();
    startShiftPresence({ time_in: data.time_in }, own.object_name || own.company_name || 'Smena');
    notifyUser('Prace zacala', 'Timer bezi a GPS poloha se odesila.');
  } else if (state.geoWatch && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.geoWatch);
    state.geoWatch = null;
    stopShiftPresence();
    notifyUser('Prace ukoncena', 'Hodiny byly odeslany do Stavba vypoctu.');
  } else if (mode === 'end') {
    stopShiftPresence();
  }
  await renderDashboard();
  toast(mode === 'end' ? 'Smena odeslana administratorovi' : 'Smena zahajena');
}

function openUser(id) {
  const row = id ? state.cache.users.find(u => Number(u.id) === Number(id)) : { role: 'user' };
  modal(id ? 'Upravit uzivatele' : 'Novy uzivatel', `
    <div class="form-grid">
      <div class="field"><label>Jmeno</label><input class="input" name="name" value="${esc(row.name)}" required></div>
      <div class="field"><label>E-mail</label><input class="input" name="email" type="email" value="${esc(row.email)}" required></div>
      <div class="field"><label>Role</label><select class="select" name="role"><option value="user" ${row.role === 'user' || !row.role ? 'selected' : ''}>user</option><option value="coordinator" ${row.role === 'coordinator' ? 'selected' : ''}>coordinator</option><option value="accountant" ${row.role === 'accountant' ? 'selected' : ''}>ucetni</option><option value="admin" ${row.role === 'admin' ? 'selected' : ''}>admin</option></select></div>
      <div class="field"><label>Zamestnanec</label><select class="select" name="employee_id">${optionList(state.cache.employees || [], row.employee_id)}</select></div>
      <div class="field"><label>${id ? 'Nove heslo' : 'Heslo'}</label><input class="input" name="password" type="password" ${id ? '' : 'required'} minlength="8"></div>
    </div>`,
    data => {
      if (id && !data.password) delete data.password;
      return api(id ? `users/${id}` : 'users', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
    });
}

function openPermissions(id) {
  const row = state.cache.users.find(u => Number(u.id) === Number(id));
  const labels = state.cache.permissions || {};
  modal(`Opravneni: ${esc(row.name)}`, `<div class="permission-grid">${Object.entries(labels).map(([key, label]) => `
    <label class="checkline"><input type="checkbox" name="${esc(key)}" value="1" ${row.permissions?.[key] ? 'checked' : ''}> ${esc(label)}</label>`).join('')}</div>`,
    data => api(`users/${id}/permissions`, { method: 'PUT', body: JSON.stringify(data) }));
}

function openBlock(id) {
  const row = id ? state.cache.blocks.find(b => Number(b.id) === Number(id)) : { permissions: [] };
  const labels = state.cache.permissions || {};
  modal(id ? 'Upravit blok' : 'Novy blok', `
    <div class="field"><label>Nazev</label><input class="input" name="name" value="${esc(row.name)}" required></div>
    <div class="field"><label>Popis</label><textarea name="description">${esc(row.description)}</textarea></div>
    <div class="permission-grid">${Object.entries(labels).map(([key, label]) => `
      <label class="checkline"><input type="checkbox" name="${esc(key)}" value="1" ${(row.permissions || []).includes(key) ? 'checked' : ''}> ${esc(label)}</label>`).join('')}</div>`,
    data => api(id ? `blocks/${id}` : 'blocks', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) }));
}

function applyBlock(id) {
  const options = (state.cache.users || []).map(u => `<option value="${u.id}">${esc(u.name)} (${esc(u.email)})</option>`).join('');
  modal('Pouzit blok', `<div class="field"><label>Uzivatel</label><select class="select" name="user_id">${options}</select></div>`,
    data => api(`blocks/${id}/apply`, { method: 'PUT', body: JSON.stringify(data) }), 'Pouzit');
}

function openPassword() {
  modal('Zmenit heslo', `
    <div class="field"><label>Stavajici heslo</label><input class="input" name="current_password" type="password" autocomplete="current-password" required></div>
    <div class="field"><label>Nove heslo</label><input class="input" name="new_password" type="password" autocomplete="new-password" minlength="8" required></div>`,
    data => api('auth/password', { method: 'POST', body: JSON.stringify(data) }), 'Zmenit heslo');
}

function closeMonth() {
  modal('Zavrit mesic', `
    <div class="error" style="border-color:rgba(231,184,77,.35);background:rgba(231,184,77,.12);color:#ffe0a0">Uzaverka ulozi pevny snapshot mezd pro aktualni obdobi.</div>
    <input type="hidden" name="month" value="${state.month}">
    <input type="hidden" name="year" value="${state.year}">
    <div class="field"><label>Poznamka k uzaverce</label><textarea name="notes"></textarea></div>`,
    data => api('monthclose', { method: 'POST', body: JSON.stringify(data) }), 'Zavrit mesic');
}

async function reopenMonth() {
  if (!confirm('Otevrit uzavreny mesic? Snapshot uzaverky bude odstranen.')) return;
  await api(`monthclose?month=${state.month}&year=${state.year}`, { method: 'DELETE' });
  await renderPage();
  toast('Mesic je znovu otevren', 'warn');
}

async function renderLogs() {
  loading('Logy');
  const { data } = await api('logs');
  const rows = data.map(l => [
    esc(l.created_at),
    esc(l.user_name || '-'),
    esc(l.action),
    esc(l.entity),
    esc(l.ip_address || '-'),
  ]);
  setContent(`${head('Logy', `${data.length} poslednich zaznamu`)}${rows.length ? table(['Cas','Uzivatel','Akce','Entita','IP'], rows) : '<div class="card empty">Zadne logy</div>'}`);
}

async function removeEntity(path, message) {
  if (!confirm(message || 'Opravdu smazat?')) return;
  await api(path, { method: 'DELETE' });
  await renderPage();
  toast('Hotovo', 'warn');
}

function scrollPageTop() {
  const behavior = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  requestAnimationFrame(() => window.scrollTo({ top: 0, behavior }));
}

function toggleSidebar(forceClosed = false) {
  if (forceClosed) {
    localStorage.setItem(sidebarStorageKey, '1');
    renderLayout();
    return;
  }
  const stored = localStorage.getItem(sidebarStorageKey);
  const collapsed = isCompactLayout() ? stored !== '0' : stored === '1';
  localStorage.setItem(sidebarStorageKey, collapsed ? '0' : '1');
  renderLayout();
}

async function restoreEmployee(id) {
  if (!confirm('Vratit zamestnance mezi aktivni?')) return;
  await api(`employees/${id}/restore`, { method: 'PUT', body: '{}' });
  await renderPage();
  toast('Zamestnanec obnoven');
}

async function deleteEmployeeForce(id) {
  if (!confirm('Trvale smazat archivniho zamestnance vcetne dokumentu a avataru?')) return;
  await api(`employees/${id}/force`, { method: 'DELETE' });
  await renderPage();
  toast('Zamestnanec trvale smazan', 'warn');
}

async function logoutUser() {
  try {
    await api('auth/logout', { method: 'POST', body: '{}' });
  } catch (err) {
    console.warn(err);
  }
  state.user = null;
  state.cache = {};
  state.view = 'dashboard';
  renderLogin();
}

function confirmLogout() {
  if (confirm(`${tr('Odhlasit se')}?`)) {
    logoutUser();
  }
}

window.Pokladna = {
  go(view) {
    state.view = view;
    const hasLayout = !!document.getElementById('content');
    if (isCompactLayout()) {
      localStorage.setItem(sidebarStorageKey, '1');
      document.querySelector('.layout')?.classList.add('sidebar-collapsed');
    }
    syncNavActive();
    if (hasLayout) renderPage();
    else renderLayout();
  },
  sidebar: toggleSidebar,
  notifications: openNotifications,
  notificationPermission: enableNotifications,
  install: installApp,
  period(key, value) { state[key] = Number(value); renderPage(); },
  toggleNav(id) {
    navGroupState[id] = !navGroupState[id];
    localStorage.setItem('pokladna_nav_groups', JSON.stringify(navGroupState));
    renderLayout();
  },
  companyFilter(id) {
    state.companyId = String(id || '');
    localStorage.setItem('pokladna_company', state.companyId);
    renderPage();
  },
  lang: setLanguage,
  cycleLang: cycleWorkerLanguage,
  logout: logoutUser,
  confirmLogout,
  password: openPassword,
  exportCsv: downloadExport,
  sortTable,
  moveNav: moveNavItem,
  toggleSection,
  moveSection,
  casTab: setCasTab,
  workerTab: activateWorkerTab,
  workerChatChannel: setWorkerChatChannel,
  workerChatPeer: setWorkerChatPeer,
  workerChatSend,
  clearChat,
  chatAttachmentLabel,
  employeeChat: openEmployeeChat,
  adminChatOpen: openAdminChatConversation,
  adminChatPick: pickAdminChat,
  adminChatChannel: setAdminChatChannel,
  adminChatSend,
  syncObjectSelect,
  company: openCompany,
  companyProfile: openCompanyProfile,
  deleteCompany: id => removeEntity(`companies/${id}`, 'Smazat firmu?'),
  profile: openEmployeeProfile,
  employee: openEmployee,
  avatar: openAvatar,
  selfProfile: openSelfProfile,
  documents: openDocuments,
  documentQuick: openDocumentQuickMode,
  uploadDocument,
  saveJmhz: saveEmployeeJmhz,
  copyJmhz: copyEmployeeJmhz,
  documentMode: selectDocumentMode,
  deleteDocument,
  approveDocument,
  rejectDocument,
  archiveEmployee: id => removeEntity(`employees/${id}`, 'Archivovat zamestnance?'),
  restoreEmployee,
  deleteEmployeeForce,
  object: openObject,
  objectProfile: openObjectProfile,
  deleteObject: id => removeEntity(`objects/${id}`, 'Smazat objekt?'),
  timesheet: openTimesheet,
  updateTimesheetHours,
  updatePayoutPreview,
  approveTimesheet,
  rejectTimesheet,
  deleteTimesheet: id => removeEntity(`timesheets/${id}`, 'Smazat hodiny?'),
  payout: openPayout,
  deletePayout: id => removeEntity(`payouts/${id}`, 'Smazat vyplatu?'),
  financeTab,
  addExpense,
  deleteExpense,
  uploadReceipt,
  financePdf,
  addRevenue,
  advance: openAdvance,
  advanceFor: openAdvanceForEmployee,
  approveAdvance,
  rejectAdvance,
  deleteAdvance: id => removeEntity(`advances/${id}`, 'Smazat zalohu?'),
  cash: openCash,
  deleteCash: id => removeEntity(`cash/${id}`, 'Smazat operaci?'),
  resource: openResource,
  deleteResource: (type, id) => removeEntity(`resources/${type}/${id}`, 'Smazat zaznam?'),
  candidate: openCandidate,
  recruitmentActivity: openRecruitmentActivity,
  deleteCandidate: id => removeEntity(`recruitment/${id}`, 'Smazat kandidata?'),
  stavbaManual: openStavbaManual,
  stavbaGroup: setStavbaGroup,
  deleteStavbaManual,
  rohlikAdjustment: openRohlikAdjustment,
  rohlikHealthDefault: updateRohlikHealthDefault,
  rohlikPeriod,
  fixRohlikArchive,
  rohlikColumn: setRohlikColumn,
  rohlikShift: openRohlikShift,
  rohlikShiftRequest: openRohlikShiftRequest,
  rohlikShiftDepartment: applyRohlikShiftDepartment,
  rohlikShiftPreset: applyRohlikShiftPreset,
  approveRohlikShiftRequest,
  rejectRohlikShiftRequest,
  deleteRohlikShift: id => removeEntity(`rohlik-shifts/${id}`, 'Smazat smenu?'),
  deleteRohlikShiftRequest: id => removeEntity(`rohlik-shifts/requests/${id}`, 'Smazat zadost?'),
  syncWarehouse,
  warehouseManual: openWarehouseManual,
  quickShift,
  shiftPause,
  closeMonth,
  reopenMonth,
  checkin: openCheckin,
  fillLocation,
  approveCheckin,
  rejectCheckin,
  deleteCheckin: id => removeEntity(`checkins/${id}`, 'Smazat check-in?'),
  user: openUser,
  permissions: openPermissions,
  block: openBlock,
  applyBlock,
  deleteBlock: id => removeEntity(`blocks/${id}`, 'Smazat blok?'),
  deleteUser: id => removeEntity(`users/${id}`, 'Smazat uzivatele?'),
};

init();

let compactResizeTimer = null;
let lastCompactLayout = isCompactLayout();
window.addEventListener('resize', () => {
  if (!state.user || document.querySelector('.modal-backdrop')) return;
  const compactNow = isCompactLayout();
  if (compactNow === lastCompactLayout) return;
  lastCompactLayout = compactNow;
  clearTimeout(compactResizeTimer);
  compactResizeTimer = setTimeout(() => renderLayout(), 180);
});
