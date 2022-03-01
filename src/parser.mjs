// vim: ts=4:sw=4:expandtab

import * as bin from './binary.mjs';
import * as fit from './fit.mjs';


export default class FitParser {
    constructor() {
        this.messages = [];
        this._devFields = {};
    }

    static decode(content) {
        const ab = bin.getArrayBuffer(content);
        const buf = new Uint8Array(ab);
        const dataView = new DataView(ab);
        if (buf.byteLength < 12) {
            throw new TypeError('File to small to be a FIT file');
        }
        const headerLength = dataView.getUint8(0);
        if (headerLength !== 14 && headerLength !== 12) {
            throw new TypeError('Incorrect header size');
        }
        let fileTypeString = '';
        for (let i = 8; i < 12; i++) {
            fileTypeString += String.fromCharCode(dataView.getUint8(i));
        }
        if (fileTypeString !== '.FIT') {
            throw new TypeError('Missing \'.FIT\' in header');
        }
        let hasCRCHeader;
        if (headerLength === 14) {
            const crcHeader = dataView.getUint16(12, /*LE*/ true);
            if (crcHeader) {
                hasCRCHeader = true;
                const crcHeaderCalc = bin.calculateCRC(buf, 0, 12);
                if (crcHeader !== crcHeaderCalc) {
                    throw new Error('Header CRC mismatch');
                }
            }
        }
        const dataLength = dataView.getUint32(4, /*LE*/ true);
        const dataEnd = dataLength + headerLength;
        const crcFile = dataView.getUint16(dataEnd, /*LE*/ true);
        const crcFileCalc = bin.calculateCRC(buf, hasCRCHeader ? headerLength : 0, dataEnd);
        if (crcFile !== crcFileCalc) {
            throw new Error('File CRC mismatch');
        }
        const instance = new this();
        let offt = headerLength;
        const definitions = {};
        while (offt < dataEnd) {
            const rBuf = new Uint8Array(buf.buffer, buf.byteOffset + offt);
            const msg = bin.readMessage(rBuf, definitions, instance._devFields);
            if (msg.type === 'data') {
                instance.messages.push(msg);
            }
            offt += msg.size;
        }
        return instance;
    }

    encode() {
        const estSize = Math.min(this.messages.length * 24, 256 * 1024);
        let ab = new ArrayBuffer(4096 + (Math.floor(estSize / 4096) * 4096));
        const le = true;
        let view = new DataView(ab);
        const headerSize = 14;
        const dataCRCSize = 2;
        view.setUint8(0, headerSize);
        const version_major = 1;
        const version_minor = 0;
        view.setUint8(1, version_major << 4 | version_minor);
        const profile_version_major = 20;
        const profile_version_minor = 96;
        const profile_version = profile_version_major * 100 + profile_version_minor;
        view.setUint16(2, profile_version, le);
        (new Uint8Array(ab, 8, 4)).set('.FIT'.split('').map(x => x.charCodeAt(0)));
        const dataArray = bin.writeMessages(new Uint8Array(ab, headerSize), this.messages, this._devFields);
        const dataSize = dataArray.byteLength;
        const size = headerSize + dataSize + dataCRCSize;
        ab = dataArray.buffer;  // may have been realloc'd for size
        if (ab.byteLength < size) {
            // unlikely...
            const bigger = new Uint8Array(size);
            bigger.set(new Uint8Array(ab));
            ab = bigger.buffer;
        }
        view = new DataView(ab);  // Underlying buffer may be same as initial but with header offset.
        view.setUint32(4, dataSize, le);
        const headerCRC = bin.calculateCRC(new Uint8Array(ab, 0, 12));
        view.setUint16(12, headerCRC, le);
        const dataCRC = bin.calculateCRC(dataArray);
        view.setUint16(headerSize + dataSize, dataCRC, le);
        return new Uint8Array(ab, 0, size);
    }

    addMessage(name, fields) {
        const message = fit.messagesIndex[name];
        const littleEndian = true;
        const mDef = {
            littleEndian,
            globalMessageNumber: message.id,
            fieldCount: Object.keys(fields).length,
            fieldDefs: [],
        };
        for (const key of Object.keys(fields)) {
            const attrs = message.fields[key];
            if (!attrs) {
                throw new TypeError(`Invalid field: ${name}[${key}]`);
            }
            const customType = fit.typesIndex[attrs.type];
            const baseType = fit.baseTypesIndex[customType ? customType.type : attrs.type];
            const baseTypeId = fit.typesIndex.fit_base_type.values[baseType.name];
            const endianFlag = 0x80;
            mDef.fieldDefs.push({
                attrs,
                fDefNum: attrs.defNum,
                size: undefined,  // Must be set via encoder.
                endianAbility: (baseTypeId & endianFlag) === endianFlag,
                littleEndian,
                baseTypeId,
                baseType,
            });
        }
        this.messages.push({
            type: 'data',
            name,
            size: undefined,
            mDef,
            fields,
        });
    }
}
