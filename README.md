# web-sct

Simple WebSocket library for Node.js.<br>
Uses [Message reader][message-reader] to read frames of [WebSocket Protocol][rfc-6455].

Testing with [Autobahn|Testsuite], standard test suite for websocket protocol:
[server][autobahn-server-report] [client][autobahn-client-report].

## Install
Node.js version 9.4.0 or higher is required
```
npm install web-sct
```

## Examples

### Server usage

```js
const {WebSocketServer} = require('web-sct');

const wss = new WebSocketServer({
  port: 5555
});

wss.on('connection', (ws) => {
  console.log('open connection');
  ws.on('message', (evt) => {
    console.log('message', evt);
    ws.send('Hello from server');
  });
  ws.on('close', (evt) => {
    console.log('close connection', evt);
  });
});
```

### Client usage

```js
const {WebSocket} = require('web-sct');

const ws = new WebSocket('ws://localhost:5555');

ws.on('open', () => {
  console.log('open connection');
});
ws.on('message', (evt) => {
  console.log('message', evt);
  ws.send('Hello from client');
});
ws.on('close', (evt) => {
  console.log('close connection', evt);
});
```

### Usage over Tls

```js
const {WebSocketServer, WebSocket} = require('web-sct');

const wss = new WebSocketServer({
  port: 5555,
  tls: true,
  cert: 'path/to/certificate.pem',
  key: 'path/to/key.pem'
});

const ws = new WebSocket('wss://localhost:5555', {
  rejectUnauthorized: true //for server self-signed certificates
});
```



[rfc-6455]: http://tools.ietf.org/html/rfc6455
[message-reader]: https://www.npmjs.com/package/message-reader
[Autobahn|Testsuite]: https://github.com/crossbario/autobahn-testsuite
[autobahn-server-report]: http://ls16.github.io/web-sct/autobahn/servers/
[autobahn-client-report]: http://ls16.github.io/web-sct/autobahn/clients/