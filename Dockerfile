FROM node:latest

MAINTAINER Mauricio Allende

WORKDIR /opt/app
COPY . /opt/app
RUN mkdir -p /opt/app/data

RUN npm install -g pm2
RUN npm i

CMD ["pm2-docker", "/opt/app/"]
