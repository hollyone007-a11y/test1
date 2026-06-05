# Pokladna Telegram Bot

Separate Telegram bot service for Pokladna.

## What it does

- Links a Telegram chat to an employee email with `/link email@example.com`.
- Accepts Telegram location messages.
- Sends check-in / check-out to Pokladna API with GPS coordinates.
- Uses lunch deduction through `extra_break_minutes` on checkout.

## Setup

1. Create a Telegram bot with BotFather and copy the token.
2. Create a dedicated Pokladna user for the bot with permissions:
   - `employees.view`
   - `checkins.write`
   - `checkins.view`
   - `scope.all`
3. Copy `.env.example` to `.env` and fill values.
4. Run:

```bash
npm start
```

## Commands

- `/start` - help
- `/link email@example.com` - link this Telegram chat to employee email
- send location - save GPS point for the next check-in/out
- `/checkin` - start work using last sent location
- `/checkout 0` - finish work, no extra lunch
- `/checkout 30` - finish work with 30 extra lunch minutes, total lunch 60 minutes
- `/me` - show linked employee

The bot stores only chat links in `BOT_DATA_FILE`. Secrets stay in `.env`.
