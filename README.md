# Inacap Telegram bot

## Install

```bash
$ git clone https://github.com/mallendeo/inacap-telegram-bot
$ cd inacap-telegram-bot
$ npm i
$ TELEGRAM_TOKEN="token" SECRET_KEY="random" npm start
```

## Docker
```bash
$ docker build -t "inacap-telegram-bot:dockerfile" .
$ docker run -d -e TELEGRAM_TOKEN="token" -e SECRET_KEY="random" inacap-telegram-bot:dockerfile
```

# License

MIT
