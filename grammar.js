const {hash} = require('message-reader');
const {TEXT, maskingData, CloseError, CLOSE_CODES} = require('./utils');

const fin_opcode = hash('fin_opcode');
const payload_len_16_1 = hash('payload_len_16_1');
const payload_len_63_1 = hash('payload_len_63_1');
const masking_key_data = hash('masking_key_data');

const tooBigMsg = 'Message is too big';

const regexp = `
  octet [\\x00-\\xFF]
`;

const grammar = (isMasked) => {
  const maskingKey = isMasked ? 'masking_key' : '';

  return `
    start: message;

    message: message_1 fin_frame;
    message_1: message_1 frame;
    message_1: ;

    fin_frame: fin_frame_1 {this.doFrame()};
    fin_frame_1: fin_opcode payload_len ${maskingKey} 'octet' 'payload_data';
    fin_frame_1: fin_opcode payload_len 'octet' 'masking_key_data';
    fin_frame_1: fin_opcode payload_len 'payload_data_zero';

    frame: frame_1 {this.doFrame()};
    frame_1: opcode payload_len ${maskingKey} 'octet' 'payload_data';
    frame_1: opcode payload_len 'octet' 'masking_key_data';
    frame_1: opcode payload_len 'payload_data_zero';

    masking_key: 'octet' 'octet' 'octet' 'octet' {this.maskingKey = Buffer.concat([get(3), get(2), get(1), get(0)]); this.frameData = Buffer.from(lookup()); this.readPayloadData(push_after)};

    payload_len: payload_len_8 | payload_len_16 | payload_len_63 {this.doReadPayloadLen(push_after)};
    payload_len_63: payload_len_63_1 'octet' 'octet' 'octet' 'octet' 'octet' 'octet' 'octet' 'octet' {this.doReadPayloadLen63(get, lookup, push_after)};
    payload_len_16: payload_len_16_1 'octet' 'octet' {this.doReadPayloadLen16(get, lookup, push_after)};
    payload_len_8: 'octet' {this.doReadPayloadLen8(get, lookup, set_name_from_hash, push_after)};

    opcode: 'octet' {this.doReadOpcode(get, lookup, push_after, set_name_from_hash)};
  `;
};

const maskedGrammar = grammar(true);

const nonMaskedGrammar = grammar(false);

function doTknData(tknName, tknData, end) {
  if (tknName == masking_key_data) {
    this.frameData = Buffer.from([]);
    return;
  }

  if (!this.frameData) {
    this.frameData = Buffer.from(tknData);
  } else {
    this.frameData = Buffer.concat([this.frameData, tknData]);
  }

  if (this.frameData.length > this.connection.maxDataLength) {
    throw new CloseError(CLOSE_CODES.MESSAGE_TOO_BIG, tooBigMsg);
  }
}

function doReadOpcode(get, lookup, push_after, set_name_from_hash) {
  const octet = get(0)[0];
  const opcode = octet & 0x7F;
  this.isFin = (octet & 0x80) == 0x80;
  !this.opcode && (this.opcode = opcode);
  const lookupOctet = lookup()[0];
  this.isMasked = (lookupOctet & 0x80) == 0x80;
  if (lookupOctet == 0) {
    push_after('', 'payload_data_zero');
  }
  if (this.isFin) {
    set_name_from_hash(fin_opcode);
  }
}

function doReadPayloadLen8(get, lookup, set_name_from_hash, push_after) {
  const octet = get(0)[0];
  const len = octet & 0x7F;
  switch (len) {
    case 0x7E:
      set_name_from_hash(payload_len_16_1);
      break;
    case 0x7F:
      set_name_from_hash(payload_len_63_1);
      break;
    default:
      this.payloadLen = Buffer.from([len]);
      if (!this.isMasked) {
        switch (len) {
          case 0:
            this.frameData = Buffer.from([]);
            this.isFin && push_after('');
            break;
          case 1:
            this.frameData = Buffer.from(lookup());
            this.readPayloadData(push_after);
            break;
          default:
            this.frameData = Buffer.from(lookup());
            this.readPayloadData(push_after)
        }
      }
  }
}

function doReadPayloadLen16(get, lookup, push_after) {
  this.payloadLen = Buffer.concat([get(1), get(0)]);
  this.frameData = Buffer.from(lookup());

  if (!this.isMasked) {
    this.readPayloadData(push_after);
  }
}

function doReadPayloadLen63(get, lookup, push_after) {
  this.payloadLen = Buffer.concat([get(7), get(6), get(5), get(4), get(3), get(2), get(1), get(0)]);
  this.frameData = Buffer.from(lookup());

  if (!this.isMasked) {
    this.readPayloadData(push_after);
  }
}

function doReadPayloadLen(push_after) {
  if (this.payloadLen.length == 1 && this.payloadLen[0] == 0) {
    if (this.isMasked) {
      push_after('', 'masking_key_data', null, 3);
      push_after('masking_key_data');
    }
  }
}

function readPayloadData(push_after) {
  const buf = Buffer.from(this.payloadLen);
  let size;
  switch (buf.length) {
    case 1:
      size = buf.readUInt8();
      break;
    case 2:
      size = buf.readUInt16BE();
      break;
    default:
      size = Number(buf.readBigUInt64BE());
  }

  if (size > 1) {
    push_after('', 'payload_data', null, size - 1);
  } else {
    push_after('', 'payload_data');
  }
  if (this.isFin) {
    size > 1 ? push_after('payload_data') : push_after('');
  }
}

function doFrame() {
  if (this.isMasked) {
    this.frameData = maskingData(this.frameData, this.maskingKey);
  }

  if (!this.data) {
    this.data = this.frameData;
  } else {
    this.data = Buffer.concat([this.data, this.frameData]);
  }

  if (this.data.length > this.connection.maxDataLength) {
    throw new CloseError(CLOSE_CODES.MESSAGE_TOO_BIG, tooBigMsg);
  }
}

function onAfterParse() {
  if (this.opcode == TEXT) {
    try {
      const td = new TextDecoder('utf8', {fatal: true});
      this.data = td.decode(this.data);
    } catch (err) {
      throw new CloseError(CLOSE_CODES.INVALID_FRAME_PAYLOAD_DATA, err.message);
    }
  }
}

module.exports = {
  regexp,
  maskedGrammar,
  nonMaskedGrammar,
  onAfterParse,
  onTknData: doTknData,
  doReadOpcode,
  doReadPayloadLen8,
  doReadPayloadLen16,
  doReadPayloadLen63,
  doReadPayloadLen,
  doFrame,
  readPayloadData
};