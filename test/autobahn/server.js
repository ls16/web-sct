const {WebSocketServer} = require('../../');

const port = process.argv.length > 2 ? process.argv[2] : 5555;

console.log(`port: ${port}`);

const wss = new WebSocketServer({port});

wss.on('connection', (ws) => {
  ws.on('message', (msg) => ws.send(msg.data));
  ws.on('error', (err) => console.error(err));
});
