const crypto = require('crypto');

const WSGUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const CONT = 0x0;
const TEXT = 0x1;
const BINARY = 0x2;
const CLOSE = 0x8;
const PING = 0x9;
const PONG = 0xA;

// Close event codes
const CLOSE_CODES = {
  NORMAL_CLOSURE: 1000,
  PROTOCOL_ERROR: 1002,
  CODE_1004: 1004,
  NO_STATUS_RECEIVED: 1005,
  ABNORMAL_CLOSURE: 1006,
  INVALID_FRAME_PAYLOAD_DATA: 1007,
  BAD_GATEWAY: 1014,
  TLS_HANDSHAKE: 1015
};

class CloseError extends Error {
  constructor(code, message) {
    super(message);

    this.code = code;
    this.name = 'CloseError';
  }
}

function makeSecKey() {
  return crypto.randomBytes(16).toString('base64');
}

function makeHandshakeRequest(secKey, origin, host) {
  let request = `GET ${origin} HTTP/1.1\r\n`;
  const headers = {
    'Host': host,
    'Upgrade': 'websocket',
    'Connection': 'Upgrade',
    'Sec-WebSocket-Key': secKey,
    'Sec-WebSocket-Version': 13,
    'Content-Length': 0
  };
  for (let key in headers) {
    request += `${key}: ${headers[key]}\r\n`
  }
  request += '\r\n';
  return request;
}

function makeAcceptKey(key) {
  const sha1 = crypto.createHash('sha1');
  sha1.update(key + WSGUID);
  return sha1.digest('base64');
}

function makeAcceptResponse(request) {
  const key = request.headers['sec-websocket-key'];
  let response = 'HTTP/1.1 101 Switching Protocols\r\n';
  const headers = {
    'Upgrade': 'websocket',
    'Connection': 'Upgrade',
    'Sec-WebSocket-Accept': makeAcceptKey(key),
    'Content-Length': 0
  };
  for (let key in headers) {
    response += `${key}: ${headers[key]}\r\n`
  }
  response += '\r\n';
  return response;
}

function toLower(str) {
  str = typeof(str) == 'string' ? str : '';
  return str.toLowerCase();
}

function validateServerResponse(secKey, ctx) {
  const message = 'Fail the WebSocket Connection';
  const status = ctx.status;
  const response = ctx.request;
  if (status != 101) {
    throw new Error(message);
  }
  if (toLower(response.headers['upgrade']) != 'websocket') {
    throw new Error(message);
  }
  if (toLower(response.headers['connection']) != 'upgrade') {
    throw new Error(message);
  }
  const accKey = makeAcceptKey(secKey);
  if (response.headers['sec-websocket-accept'] != accKey) {
    throw new Error(message);
  }
}

function validatePongData(pongData, pingData) {
  if (pongData.length > 125) {
    throw new CloseError(CLOSE_CODES.PROTOCOL_ERROR, 'Too long pong data');
  }
  if (pongData.compare(pingData) != 0) {
    throw new CloseError(CLOSE_CODES.PROTOCOL_ERROR, 'Invalid pong data');
  }
}

function validateFrame(opcode, data) {
  switch (opcode) {
    case PING:
    case PONG:
    case CLOSE:
      if (data.length > 125) {
        throw new CloseError(CLOSE_CODES.PROTOCOL_ERROR, 'Too long control frame data');
      }
      break;
  }
}

/**
 * @typedef {Object} MakeFrameOptions
 * @property {Number} [opcode]
 * @property {boolean} [fin]
 * @property {boolean} [masking]
 */

/**
 * Makes protocol RFC 6455 frame
 * @param {String | Buffer | ArrayBuffer} data - data for transmission
 * @param {MakeFrameOptions} options
 */
function makeFrame(data, options = {}) {
  const isTextData = typeof(data) == 'string';
  const opcode = options.opcode != null ? options.opcode : (isTextData ? TEXT : BINARY);
  data = Buffer.from(data);
  const fin = options.fin == null ? true : options.fin;
  const frameBytes = [ fin ? (0x80 | opcode) : opcode];

  validateFrame(opcode, data);

  const len = data != null ? data.length : 0;
  if (len <= 125) {
    frameBytes.push(options.masking ? (0x80 | len) : len);
  } else if (len <= 0xFFFF) {
    frameBytes.push(options.masking ? (0x80 | 126) : 126);
    frameBytes.push(len >>> 8);
    frameBytes.push(len & 0xFF);
  } else {
    frameBytes.push(options.masking ? (0x80 | 127) : 127);
    const lenBytes = Buffer.allocUnsafe(8);
    lenBytes.writeBigUInt64BE(BigInt(len));
    for (let i = 0; i < lenBytes.length; i++) {
      frameBytes.push(lenBytes[i]);
    }
  }
  let frame = Buffer.from(frameBytes);
  if (options.masking) {
    const maskingKey = crypto.randomBytes(4);
    data = maskingData(data, maskingKey);
    frame = Buffer.concat([frame, maskingKey, data]);
  } else {
    frame = Buffer.concat([frame, data]);
  }

  return frame;
}

function sendFrame(socket, data, options, cb) {
  socket.write(makeFrame(data, options), cb);
}

function maskingData(data, maskingKey) {
  for (let i = 0; i < data.length; i++) {
    data[i] = data[i] ^ maskingKey[i & 3];
  }
  return data;
}

function getCloseParams(data) {
  const code = data != null && data.length > 0 ? data.readUInt16BE() : 0;
  const reason = data != null  && data.length > 0 ? data.slice(2).toString() : '';
  return {
    code,
    reason
  }
}

module.exports = {
  CONT,
  TEXT,
  BINARY,
  CLOSE,
  PING,
  PONG,
  CLOSE_CODES,
  CloseError,
  makeSecKey,
  makeHandshakeRequest,
  makeAcceptResponse,
  validateServerResponse,
  validatePongData,
  sendFrame,
  maskingData,
  getCloseParams
}
