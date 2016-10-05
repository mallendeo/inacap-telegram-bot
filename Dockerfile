FROM node:latest

MAINTAINER Mauricio Allende

RUN npm install -g pm2
RUN git clone https://github.com/mallendeo/inacap-telegram-bot
RUN cd inacap-telegram-bot && npm i

CMD ["pm2-docker", "./inacap-telegram-bot/index.js"]
