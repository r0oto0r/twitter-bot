FROM node:18-alpine

WORKDIR /home/root/

COPY *.json ./
RUN npm install

COPY src ./src
COPY config ./config
RUN npm run transpile

ENV TZ "Europe/Berlin"

CMD [ "node", "out/index.js" ]
