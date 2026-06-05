# Prompt For Next Chat

Продолжаем сайт `pokladna.kvalitne.cz`.

Сначала прочитай:
`C:\Users\huquf\Documents\Codex\2026-05-16\webzdarma-cz\PROJECT_STATE.md`

Работай экономно по токенам:
- не пересказывай длинно;
- не читай весь проект без необходимости;
- делай изменения сразу;
- после JS-правок запускай `node --check www\assets\js\app.js`;
- после готовности деплой:
  `powershell -ExecutionPolicy Bypass -File .\deploy-webzdarma.ps1 -RemoteRoot /web`

Главное правило: обычный пользователь видит только свою информацию, свои часы, свои выплаты, свои документы, свой объект/фирму/склад.

