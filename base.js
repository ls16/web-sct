const EventEmitter = require('events');
const {URL} = require('url');
const {build} =  require('message-reader');
const httpGrammar = require('message-reader/examples/http/grammar.js');
const grammar = require('./grammar');
const utils = require('./utils');

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

const CLOSE_CODES = utils.CLOSE_CODES;

const DEF_MAX_DATA_LENGTH = 20 * 1024 * 1024;

const CloseError = utils.CloseError;

const masterClientInstance = build([{
  regexp: httpGrammar.regexp,
  grammar: httpGrammar.responseGrammar,
  proto: httpGrammar
}, {
  regexp: grammar.regexp,
  grammar: grammar.nonMaskedGrammar,
  proto: grammar
}], 'client');

const masterServerInstance = build([{
  regexp: httpGrammar.regexp,
  grammar: httpGrammar.requestGrammar,
  proto: httpGrammar
}, {
  regexp: grammar.regexp,
  grammar: grammar.maskedGrammar,
  proto: grammar
}]);

function getArrayBuffer(buf) {
  return buf.length == buf.buffer.length
    ? buf.buffer
    : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}

function validateCloseCode(code) {
  const codes1 = [
    CLOSE_CODES.CODE_1004,
    CLOSE_CODES.NO_STATUS_RECEIVED,
    CLOSE_CODES.ABNORMAL_CLOSURE,
    CLOSE_CODES.BAD_GATEWAY,
    CLOSE_CODES.TLS_HANDSHAKE
  ];
  if (code < CLOSE_CODES.NORMAL_CLOSURE ||
    codes1.indexOf(code) != -1 ||
    (code >= 1016 && code <= 2999)
    ) {
    throw new CloseError(CLOSE_CODES.PROTOCOL_ERROR, 'InvalidAccessError');
  }
  if (!(code === CLOSE_CODES.NORMAL_CLOSURE || (code >= 3000 && code <= 4999))) {
    throw new CloseError(code, 'InvalidAccessError');
  }
}

function validateCloseReason(reason) {
  const reasonBin = typeof(reason) == 'string'
    ? Buffer.from(reason)
    : reason;
  if (reasonBin.length > 123) {
    throw new Error('SyntaxError');
  }
}

class WebSocketBase extends EventEmitter {
  _socket = null;
  _state = -1;
  _binaryType = 'buffer';
  _bufferedAmount = 0;
  _pingData = null;
  _closeData = {};

  constructor() {
    super();

    this._changeState(CONNECTING);
  }

  get readyState() {
    return this._state;
  }

  get binaryType() {
    return this._binaryType;
  }

  set binaryType(value) {
    const types = ['buffer', 'arraybuffer'];
    if (types.indexOf(value) == -1) throw new Error('SyntaxError');
    this._binaryType = value;
  }

  get bufferedAmount() {
    return this._bufferedAmount;
  }

  _processMessage(ctx) {
    throw new Error('Not implemented');
  }

  _handleConnect(socket) {
    throw new Error('Not implemented');
  }

  _handleError(err) {
    this._error = err;
    if (this.listenerCount('error') > 0) {
      this.emit('error', err);
    }
    this._socket.end();
  }

  _handleClose(hadError) {
    let code = CLOSE_CODES.NORMAL_CLOSURE;
    let reason = '';
    if (hadError) {
      code = -1;
      reason = this._error && this._error.message;
    }
    this._changeState(CLOSED, {
      code,
      reason
    });
  }

  _changeState(newState, ...params) {
    this._state = newState;
    switch (newState) {
      case OPEN:
        this.emit('open');
        break;
      case CLOSING:
        this._closeData = {
          code: 1006,
          reason: ''
        };
        break;
      case CLOSED:
        const {code = 1006, reason = ''} = this._closeData;
        this.emit('close', {
          wasClean: !this._error ? true : false,
          code,
          reason
        });
        break;
      }
  }

  _pong(data) {
    const options = {
      opcode: utils.PONG,
      masking: this instanceof WebSocketConnection ? false : true
    };
    utils.sendFrame(this._socket, data, options);
  }

  ping(data) {
    const options = {
      opcode: utils.PING,
      masking: this instanceof WebSocketConnection ? false : true
    };
    this._pingData = data;
    utils.sendFrame(this._socket, data, options);
  }

  send(data) {
    if (data == null) throw new Error('No data to sent');
    if (this._state != OPEN) throw new Error('InvalidStateError');
    const len = +data.length;
    this._bufferedAmount += len;
    const options = {
      masking: this instanceof WebSocketConnection ? false : true
    };
    utils.sendFrame(this._socket, data, options, () => {
      this._bufferedAmount -= len;
    });
  }

  _internalClose(code = null, reason = null) {
    if (this._state == CLOSING || this._state == CLOSED) return;
  
    const options = {
      opcode: utils.CLOSE,
      masking: this instanceof WebSocketConnection ? false : true
    };
    let data;
    if (code != null) {
      data = Buffer.allocUnsafe(2);
      data.writeUInt16BE(code);
    } else {
      data = Buffer.from([]);
    }
    if (reason) {
      data = Buffer.concat([data, Buffer.from(reason)]);
    }
    this._changeState(CLOSING, data);
    utils.sendFrame(this._socket, data, options);
  }
 
  close(code = null, reason = null) {
    if (code !== null) {
      validateCloseCode(code);
    }
    if (reason !== null) {
      validateCloseReason(reason);
    }

    this._internalClose(code, reason);
  }
}

class WebSocket extends WebSocketBase {
  _url = null;
  _options = {};

  constructor(url, options) {
    super();

    const urlObj = new URL(url);
    if (['ws:', 'wss:'].indexOf(urlObj.protocol) == -1) {
      throw new Error(`Invalid protocol: ${urlObj.protocol}`);
    }
    if (urlObj.hostname == null) {
      throw new Error(`Undefined hostname: ${urlObj.hostname}`);
    }
    if (urlObj.port == null) {
      throw new Error(`Undefined port: ${urlObj.port}`);
    }

    let maxDataLength = DEF_MAX_DATA_LENGTH;

    this._url = url;
    if (options) {
      if (options.rejectUnauthorized != null) {
        this._options.rejectUnauthorized = options.rejectUnauthorized === true;
      }
      if (options.maxDataLength) {
        if (+options.maxDataLength < 1) {
          throw new Error(`Invalid option maxDataLength: ${options.maxDataLength}`);
        }
        maxDataLength = +options.maxDataLength;
      }
    }

    const client = masterClientInstance.clone();
    client
      .use((ctx, next) => {
        try {
          this._processMessage(ctx);
        } catch (err) {
          if (err.name == 'CloseError') {
            this._internalClose(err.code, err.message);
          } else {
            console.log(err);
          }
        }
      })
      .handler('connection', (socket) => {
        this._handleConnect(socket);
        return {maxDataLength};
      })
      .handler('errorConnection', (conn, err) => {
        this._handleError(err);
      })
      .handler('closeConnection', (conn, hadError) => {
        this._handleClose(hadError);
      });

    const tls = urlObj.protocol == 'wss:';
    const connOptions = {
      tls,
      host: urlObj.hostname,
      port: urlObj.port
    };
    if (tls) {
      if (this._options.rejectUnauthorized != null) {
        connOptions.rejectUnauthorized = this._options.rejectUnauthorized;
      }
    }
    this._socket = client.connect(connOptions);
  }

  get url() {
    return this._url;
  }

  _processMessage(ctx) {
    if (ctx.request) {
      utils.validateServerResponse(this._secKey, ctx);
      this._secKey = null;
      ctx.connection.setOptions(1);
      this._changeState(OPEN);
    } else {
      switch (ctx.opcode) {
        case utils.PING:
          this._pong(ctx.data);
          break;
        case utils.PONG:
          utils.validatePongData(ctx.data, this._pingData);
          this.emit('pong', {
            data: ctx.data
          });
          break;
          case utils.CLOSE:
            const pars = utils.getCloseParams(ctx.data);
            pars.code !== 0 ? this.close(pars.code, pars.reason) : this.close();
            this._closeData = {
              code: pars.code !== 0 ? pars.code : 1005,
              reason: pars.reason
            };
            this._socket.end();
            break;
        default:
          const data = this._binaryType == 'arraybuffer'
            ? getArrayBuffer(ctx.data)
            : ctx.data;
          this.emit('message', {
            data
          });
      }
    }
  }

  _handleConnect(socket) {
    this._secKey = utils.makeSecKey();
    const urlObj = new URL(this._url);
    const origin = `${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
    socket.write(utils.makeHandshakeRequest(this._secKey, origin, urlObj.host));
  }
}

class WebSocketConnection extends WebSocketBase {
  constructor(socket) {
    super();

    this._socket = socket;
  }

  _processMessage(ctx) {
    if (ctx.request) {
      const response = utils.makeAcceptResponse(ctx.request);
      this._socket.write(response);
      ctx.connection.setOptions(1);
      this._changeState(OPEN);
    } else {
      switch (ctx.opcode) {
        case utils.PING:
          this._pong(ctx.data);
          break;
        case utils.PONG:
          utils.validatePongData(ctx.data, this._pingData);
          this.emit('pong', {
            data: ctx.data
          });
          break;
        case utils.CLOSE:
          const pars = utils.getCloseParams(ctx.data);
          pars.code !== 0 ? this.close(pars.code, pars.reason) : this.close();
          this._closeData = {
            code: pars.code !== 0 ? pars.code : 1005,
            reason: pars.reason
          };
          this._socket.end();
          break;
        default:
          const data = this._binaryType == 'arraybuffer'
            ? getArrayBuffer(ctx.data)
            : ctx.data;
          this.emit('message', {
            data
          });
      }
    }
  }

  _handleConnect(socket) {
  }
}

class WebSocketServer extends EventEmitter {
  _server = null;

  constructor(options) {
    super();

    let maxDataLength = DEF_MAX_DATA_LENGTH;

    if (options.maxDataLength) {
      if (+options.maxDataLength < 1) {
        throw new Error(`Invalid option maxDataLength: ${options.maxDataLength}`);
      }
      maxDataLength = +options.maxDataLength;
    }

    const server = masterServerInstance.clone();
    server
      .use((ctx, next) => {
        const ws = ctx.connection.webSocket;
        try {
          ws._processMessage(ctx);
        } catch (err) {
          if (err.name == 'CloseError') {
            ws._internalClose(err.code, err.message);
          } else {
            console.log(err);
          }
        }
      })
      .handler('listening', (socket) => {
        this.emit('listening');
      })
      .handler('connection', (socket) => {
        const webSocket = new WebSocketConnection(socket);
        webSocket.on('open', () => this.emit('connection', webSocket));
        webSocket._handleConnect(socket);
        return {webSocket, maxDataLength};
      })
      .handler('errorConnection', (conn, err) => {
        conn.webSocket._handleError(err);
      })
      .handler('closeConnection', (conn, hadError) => {
        conn.webSocket._handleClose(hadError);
      })
      .handler('close', () => {
        this.emit('close');
      });

      const tls = options.tls == true;
      const connOptions = {
        tls,
        port: options.port
      };
      if (tls) {
        if (options.cert) {
        connOptions.cert = options.cert;
        }
        if (options.key) {
          connOptions.key = options.key;
        }
      }

      server.listen(connOptions);

      this._server = server;
  }

  close() {
    this._server.close();
  }
}

module.exports = {
  CONNECTING,
  OPEN,
  CLOSING,
  CLOSED,
  WebSocket,
  WebSocketServer
}
