const assert = require('assert');
const fs = require('fs');
const {test, run} = require('./func');
const {CONNECTING, OPEN, CLOSING, CLOSED, WebSocket, WebSocketServer} = require('../index');
const {CLOSE_CODES} = require('../utils');

function randomInt(min, max) {
  return min + Math.floor(Math.random() * Math.floor(max - min));
}

function createClient(tls) {
  const url = `${tls ? 'wss:' : 'ws:'}//localhost:5555`;
  const options = {};
  if (tls) {
    options.rejectUnauthorized = false;
  }
  return new WebSocket(url, options);
}

const timeout = 5000;

function testEvent(evtName, func, client) {
  if (!client) {
    client = createClient();
  }
  return new Promise((resolve, reject) => {
    const timerId = setTimeout(() => reject(), timeout);
    client.on(evtName, async (evt) => {
      try {
        await func(client, evt);
        resolve();
      } catch (err) {
        reject(err);
      }
      client.close();
      clearTimeout(timerId);
    });
    if (evtName == 'message') {
      client.on('close', () => {
        clearTimeout(timerId);
        reject();
      });
    }
    client.on('error', (err) => {
      clearTimeout(timerId);
      reject(err);
    });
  });
}

function createServer(tls) {
  const options = {
    port: 5555,
    tls
  };
  if (tls) {
    options.cert = fs.readFileSync('./test/fixtures/cert.pem');
    options.key = fs.readFileSync('./test/fixtures/key.pem');
  }
  return new WebSocketServer(options);
}

function setServerHandlers(server) {
  server.on('connection', (ws) => {
    ws.on('message', (evt) => {
      const responseData = (typeof(evt.data) == 'string')
        ? evt.data + evt.data
        : Buffer.concat([evt.data, evt.data]);
      ws.send(responseData);
    });
  });
}

let server;

test('Create Server', () => {
  server = createServer();
  setServerHandlers(server);
});

test('WS open event', async () => {
  await testEvent('open', () => {});
});

test('WS message event (data is empty string)', async () => {
  await testEvent('open', async (client) => {
    const message = '';
    client.send(message);
    await testEvent('message', (client, evt) => {
      assert.strictEqual(evt.data, message + message);
    }, client);
  });
});

test('WS message event (short length data)', async () => {
  await testEvent('open', async (client) => {
    const message = 'hello';
    client.send(message);
    await testEvent('message', (client, evt) => {
      assert.strictEqual(evt.data, message + message);
    }, client);
  });
});

test('WS message event (16-bit length data)', async () => {
  await testEvent('open', async (client) => {
    let message = '';
    const count = 12345;
    for (let i = 0; i < count; i++) {
      message += String.fromCharCode(randomInt(65, 90));
    }
    client.send(message);
    await testEvent('message', (client, evt) => {
      assert.strictEqual(evt.data, message + message);
    }, client);
  });
});

test('WS message event (63-bit length data)', async () => {
  await testEvent('open', async (client) => {
    let message = '';
    const count = 454321;
    for (let i = 0; i < count; i++) {
      message += String.fromCharCode(randomInt(65, 90));
    }
    client.send(message);
    await testEvent('message', (client, evt) => {
      assert.strictEqual(evt.data, message + message);
    }, client);
  });
});

test('Too long data length', async () => {
  await testEvent('open', async (client) => {
    const count = 1050 * 1024;
    const message = Buffer.alloc(count, 'A');
    client.send(message);
    let isException;
    try {
      await testEvent('message', (client, evt) => {
      }, client);
      isException = false;
    } catch (err) {
      isException = true;
    }
    if (!isException) {
      throw new Error('Test failed');
    }
  });
});

test('WS close event', async () => {
  const code = CLOSE_CODES.NORMAL_CLOSURE;
  const reason = 'message reason';
  await testEvent('open', async (client) => {
    client.close(code, reason);
    await testEvent('close', (client, evt) => {
      assert.strictEqual(evt.code, code);
      assert.strictEqual(evt.reason, reason);
    }, client);
  });
});

test('ping pong', async () => {
  await testEvent('open', async (client) => {
    const data = Buffer.from('PING');
    client.ping(data);
    await testEvent('pong', (client, evt) => {
      assert.ok(Buffer.compare(evt.data, data) === 0);
    }, client);
  });
});

test('readyState', async () => {
  const client = createClient();
  assert.strictEqual(client.readyState, CONNECTING);
  await testEvent('open', async (client) => {
    assert.strictEqual(client.readyState, OPEN);
    client.close();
    assert.strictEqual(client.readyState, CLOSING);
    await testEvent('close', (client, evt) => {
      assert.strictEqual(client.readyState, CLOSED);
    }, client);
  }, client);
});

test('binaryType', async () => {
  await testEvent('open', (client) => {
    const data = Buffer.from('BINARY MESSAGE');
    return new Promise(async (resolve, reject) => {
      const timerId = setTimeout(() => reject(), timeout);
      client.send(data);
      client.on('message', (evt) => {
        if (client.binaryType == 'arraybuffer') {
          clearTimeout(timerId);
          if (!(evt.data instanceof ArrayBuffer)) {
            reject(`Data ${evt.data} is not ArrayBuffer instance`);
          } else {
            resolve();
          }
        } else if (client.binaryType == 'buffer') {
          if (!(evt.data instanceof Buffer)) {
            reject(`Data ${evt.data} is not Buffer instance`);
          }
          client.binaryType = 'arraybuffer';
          client.send(data);
        }
      });
    });
  });
});

test('bufferedAmount', async () => {
  await testEvent('open', async (client) => {
    const data = Buffer.from('BINARY MESSAGE');
    client.send(data);
    assert.strictEqual(client.bufferedAmount, data.length);
    await testEvent('message', (client, evt) => {
      assert.strictEqual(client.bufferedAmount, 0);
    }, client);
  });
});

test('Close Server', () => {
  return new Promise((resolve, reject) => {
    const timerId = setTimeout(() => reject(), timeout);
    server.on('close', () => {
      clearTimeout(timerId);
      resolve();
    });
    server.close();
  });
});

test('Tls', () => {
  return new Promise((resolve, reject) => {
    const tls = true;
    const server = createServer(tls);
    const timerId = setTimeout(() => {
      server.close();
      reject();
    }, timeout);
    setServerHandlers(server);
    server.on('listening', () => {
      const client = createClient(tls);
      client.on('open', () => {
        const data = 'TEXT MESSAGE';
        client.send(data);
        testEvent('message', (client, evt) => {
          if (`${data}${data}` !== evt.data) {
          reject('Data mismatch');
          }
          server.close();
        }, client);
        server.on('close', () => {
          clearTimeout(timerId);
          resolve();
        });
      });
    });
  });
});


run();
