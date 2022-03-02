// vim: ts=4:sw=4:expandtab
/* eslint indent: "off" */
import * as fit from './fit.mjs';


function readTypedData(buf, fDef) {
    // XXX migrate to the dataSet property.  No need for inference anymore.
    const typedBuf = new fDef.baseType.TypedArray(fDef.size / fDef.baseType.size);
    const view = new DataView(buf.buffer, buf.byteOffset, fDef.size);
    const typeName = typedBuf.constructor.name.split('Array')[0];
    const isLittleEndian = fDef.endianAbility ? fDef.littleEndian : true; // XXX Not sure if we should default to true.
    for (let i = 0; i < typedBuf.length; i++) {
        // if (fDef.baseType.size > 1 && (!fDef.endianAbility || fDef.littleEndian)) { debugger; }
        typedBuf[i] = view[`get${typeName}`](i * typedBuf.BYTES_PER_ELEMENT, isLittleEndian);
    }
    return typedBuf;
}


function encodeTypedData(data, fDef, fields) {
    const type = fDef.attrs.type;
    const isArray = !!fDef.attrs.isArray;
    let customType;
    if (fit.baseTypeIdsIndex[type] === undefined) {
        customType = fit.typesIndex[type];
        if (!customType) {
            throw new TypeError(`Unsupported type: ${type}`);
        }
    }
    function encode(x) {
        if (customType) {
            if (customType.decode && !customType.encode) {
                throw new TypeError(`Type encode/decode parity mismatch: ${type}`);
            } else if (customType.encode) {
                return customType.encode(x, data, fields);
            } else if (customType.mask) {
                if (typeof x === 'number') {
                    return x;
                } else if (x && x.value != null) {
                    let value = x.value;
                    if (x.flags) {
                        for (const flag of x.flags) {
                            value |= customType.values[flag] || 0;
                        }
                    }
                    return value;
                } else {
                    throw new TypeError('Improperly configured mask value');
                }
            } else {
                if (Object.prototype.hasOwnProperty.call(customType.values, x)) {
                    return customType.values[x];
                } else {
                    return x;
                }
            }
        } else {
            switch (type) {
                case 'enum':
                case 'byte':
                case 'sint8':
                case 'sint16':
                case 'sint32':
                case 'sint64':
                case 'uint8':
                case 'uint16':
                case 'uint32':
                case 'uint64':
                case 'uint8z':
                case 'uint16z':
                case 'uint32z':
                case 'uint64z':
                    return fDef.attrs.scale ? (x - fDef.attrs.offset) * fDef.attrs.scale : x;
                case 'string': {
                    const te = new TextEncoder();
                    return te.encode(data + '\0');
                }
                default:
                    throw new TypeError(`Unhandled root type: ${type}`);
            }
        }
    }
    return isArray ? data.map(encode) : encode(data);
}


function decodeTypedData(data, fDef, fields) {
    const type = fDef.attrs.type;
    const isArray = !!fDef.attrs.isArray;
    let customType;
    if (fit.baseTypeIdsIndex[type] === undefined) {
        customType = fit.types[type];
        if (!customType) {
            throw new TypeError(`Unsupported type: ${type}`);
        }
    }
    function decode(x) {
        if (customType) {
            if (customType.decode) {
                return customType.decode(x, data, fields);
            } else if (customType.mask) {
                const result = {flags:[]};
                for (const [key, label] of Object.entries(customType)) {
                    const flag = Number(key);
                    if (Number.isNaN(flag)) {
                        continue;
                    }
                    if ((x & flag) === flag) {
                        result.flags.push(label);
                    }
                }
                if (customType.mask) {
                    result.value = x & customType.mask;
                }
                return result;
            } else {
                if (Object.prototype.hasOwnProperty.call(customType, x)) {
                    return customType[x];
                } else {
                    return x;
                }
            }
        } else {
            switch (type) {
                case 'enum':
                case 'byte':
                case 'sint8':
                case 'sint16':
                case 'sint32':
                case 'sint64':
                case 'uint8':
                case 'uint16':
                case 'uint32':
                case 'uint64':
                case 'uint8z':
                case 'uint16z':
                case 'uint32z':
                case 'uint64z':
                    return fDef.attrs.scale ? x / fDef.attrs.scale + fDef.attrs.offset : x;
                case 'string': {
                    const td = new TextDecoder();
                    const nullIndex = data.indexOf(0);
                    if (nullIndex !== -1) {
                        return td.decode(data.slice(0, nullIndex));
                    } else {
                        return td.decode(data);
                    }
                }
                default:
                    throw new TypeError(`Unhandled root type: ${type}`);
            }
        }
    }
    return isArray ? Array.from(data).map(decode) : decode(data[0]);
}


function getInvalidValue(type) {
    const bt = fit.getBaseType(fit.baseTypeIdsIndex[type]);
    if (bt === undefined) {
        throw new TypeError(`Invalid type: ${type}`);
    }
    return bt.invalid;
}


function msgDefSig(mDef) {
    let sig = '' + mDef.littleEndian + mDef.globalMessageNumber + mDef.fieldCount + ' ';
    for (let i = 0; i < mDef.fieldDefs.length; i++) {
        const x = mDef.fieldDefs[i];
        sig += ' ' + x.fDefNum + x.littleEndian + x.size;
    }
    return sig;
}


export function writeMessages(dataArray, msgs, devFields) {
    const localMsgIds = new Map();
    let offtDataArray = dataArray;
    for (const x of msgs) {
        offtDataArray = _writeMessage(offtDataArray, x, localMsgIds, devFields);
    }
    return new Uint8Array(offtDataArray.buffer, dataArray.byteOffset,
        offtDataArray.byteOffset - dataArray.byteOffset);
}


function grow(dataArray, minGrowth) {
    const curSize = dataArray.buffer.byteLength;
    const newSize = Math.ceil(Math.max(curSize * 1.15, curSize + minGrowth) / 4096) * 4096;
    const bigger = new Uint8Array(newSize);
    bigger.set(new Uint8Array(dataArray.buffer, 0));
    return bigger.subarray(dataArray.byteOffset);
}


function _writeMessage(dataArray, msg, localMsgIds, devFields) {
    // Prep the data and calculated sizes first...
    const encodedValues = {};
    msg.size = 1;
    for (const fDef of msg.mDef.fieldDefs) {
        const key = fDef.attrs.field;
        const nativeVal = msg.fields[key];
        const encodedVal = encodedValues[key] = nativeVal != null ?
            encodeTypedData(nativeVal, fDef, msg.fields) :
            getInvalidValue(fDef.baseType.name);
        if (encodedVal instanceof fDef.baseType.TypedArray) {
            fDef.size = encodedVal.byteLength;  // string
        } else {
            const length = fDef.attrs.isArray && nativeVal ? nativeVal.length : 1;
            fDef.size = fDef.baseType.size * length;
        }
        msg.size += fDef.size;
    }
    // Try to find a preexisting msg def to use...
    const mDefSig = msgDefSig(msg.mDef);
    let localMsgId;
    if (localMsgIds.lastSig === mDefSig) {
        localMsgId = localMsgIds.lastId;
    } else {
        localMsgId = localMsgIds.get(mDefSig);
    }
    let defBuf;
    if (localMsgId === undefined) {
        localMsgId = localMsgIds.size;
        localMsgIds.set(mDefSig, localMsgId);
        defBuf = new Uint8Array(6 + (msg.mDef.fieldDefs.length * 3)); // XXX does not support devfields
        const defView = new DataView(defBuf.buffer, defBuf.byteOffset, defBuf.byteLength);
        const definitionFlag = 0x40;
        defView.setUint8(0, (localMsgId & 0xf) | definitionFlag);
        const littleEndian = msg.mDef.littleEndian;
        defView.setUint8(2, littleEndian ? 0 : 1);
        defView.setUint16(3, msg.mDef.globalMessageNumber, littleEndian);
        defView.setUint8(5, msg.mDef.fieldDefs.length);
        let offt = 6;
        for (const fDef of msg.mDef.fieldDefs) {
            if (fDef.isDevField) {
                throw new Error("XXX dev fields not supported yet");
            }
            defView.setUint8(offt++, fDef.fDefNum);
            defView.setUint8(offt++, fDef.size);
            defView.setUint8(offt++, fDef.baseTypeId);
        }
    }
    localMsgIds.lastSig = mDefSig;
    localMsgIds.lastId = localMsgId;
    // We finally know how much data will be used.
    const sizeIncrease = (defBuf ? defBuf.byteLength : 0) + msg.size;
    const sizeAvail = dataArray.byteLength;
    if (sizeAvail < sizeIncrease) {
        dataArray = grow(dataArray, sizeIncrease);
    }
    if (defBuf) {
        dataArray.set(defBuf);
        dataArray = dataArray.subarray(defBuf.byteLength);
    }
    const view = new DataView(dataArray.buffer, dataArray.byteOffset);
    view.setUint8(0, localMsgId & 0xf);
    let offt = 1;
    for (const fDef of msg.mDef.fieldDefs) {
        const le = fDef.endianAbility ? fDef.littleEndian : true; // XXX Not sure if we should default to true.
        const data = encodedValues[fDef.attrs.field];
        if (typeof data === 'number' || typeof data === 'bigint') {
            fDef.baseType.dataSet.call(view, offt, data, le);
        } else if (data instanceof Array) {
            for (let i = 0; i < data.length; i++) {
                fDef.baseType.dataSet.call(view, offt + (i * fDef.baseType.size), data[i], le);
            }
        } else if (data instanceof fDef.baseType.TypedArray) {
            dataArray.set(data, offt);
        } else {
            throw new TypeError(`Unsupported data type: ${data}`);
        }
        offt += fDef.size;
    }
    return dataArray.subarray(msg.size);
}


export function readMessage(buf, definitions, devFields) {
    const dataView = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const recordHeader = dataView.getUint8(0);
    const localMessageType = recordHeader & 0xf;
    const definitionFlag = 0x40;
    if ((recordHeader & definitionFlag) === definitionFlag) {
        return readDefinitionMessage(dataView, recordHeader, localMessageType, definitions, devFields);
    } else {
        return readDataMessage(dataView, recordHeader, localMessageType, definitions, devFields);
    }
}


function readDefinitionMessage(dataView, recordHeader, localMessageType, definitions, devFields) {
    const devDataFlag = 0x20;
    const hasDevData = (recordHeader & devDataFlag) === devDataFlag;
    const littleEndian = dataView.getUint8(2) === 0;
    const endianFlag = 0x80;
    const fieldCount = dataView.getUint8(5);
    const devFieldCount = hasDevData ?  dataView.getUint8(5 + (fieldCount * 3) + 1) : 0;
    const mDef = {
        littleEndian,
        globalMessageNumber: dataView.getUint16(3, littleEndian),
        fieldCount: fieldCount + devFieldCount,
        fieldDefs: [],
    };
    const message = fit.messages[mDef.globalMessageNumber];
    for (let i = 0; i < fieldCount; i++) {
        const fDefIndex = 6 + (i * 3);
        const fDefNum = dataView.getUint8(fDefIndex);
        const baseTypeId = dataView.getUint8(fDefIndex + 2);
        const baseType = fit.getBaseType(baseTypeId);
        if (!baseType) {
            console.error("Unexpected basetype:", baseTypeId);
            continue;
        }
        let attrs = message && message[fDefNum];
        if (!attrs) {
            attrs = {
                field: `UNDOCUMENTED[${fDefNum}]`,
                type: baseType.name
            };
            console.warn(`Undocumented field: (${baseType.name}) ${message && message.name}[${fDefNum}]`);
        }
        mDef.fieldDefs.push({
            attrs,
            fDefNum,
            size: dataView.getUint8(fDefIndex + 1),
            endianAbility: (baseTypeId & endianFlag) === endianFlag,
            littleEndian,
            baseTypeId,
            baseType,
        });
    }
    for (let i = 0; i < devFieldCount; i++) {
        const fDefIndex = 6 + (fieldCount * 3) + 1 + (i * 3);
        const fDefNum = dataView.getUint8(fDefIndex);
        const size = dataView.getUint8(fDefIndex + 1);
        const devDataIndex = dataView.getUint8(fDefIndex + 2);
        const devDef = devFields[devDataIndex][fDefNum];
        const baseTypeId = devDef.fit_base_type_id;
        mDef.fieldDefs.push({
            attrs: {
                field: devDef.field_name,
                scale: devDef.scale,
                offset: devDef.offset,
                type: fit.types.fit_base_type[baseTypeId],
            },
            fDefNum,
            size,
            endianAbility: (baseTypeId & endianFlag) === endianFlag,
            littleEndian,
            baseTypeId,
            baseType: fit.getBaseType(baseTypeId),
            devDataIndex: devDataIndex,
            isDevField: true,
        });
    }
    definitions[localMessageType] = mDef;
    const size = 6 + (mDef.fieldCount * 3) + (hasDevData ? 1 : 0);
    return {
        type: 'definition',
        mDef,
        size,
    };
}

function readDataMessage(dataView, recordHeader, localMessageType, definitions, devFields) {
    const mDef = definitions[localMessageType] || definitions[0];
    const compressedFlag = 0x80;
    if ((recordHeader & compressedFlag) === compressedFlag) {
        // TODO: handle compressed header
        throw new TypeError("Compressed header not supported");
    }
    let offt = 1;
    let size = 1;
    const fields = {};
    const message = fit.messages[mDef.globalMessageNumber];
    if (!message) {
        console.warn(`Invalid message number: ${mDef.globalMessageNumber}`);
    }
    for (let i = 0; i < mDef.fieldDefs.length; i++) {
        const fDef = mDef.fieldDefs[i];
        const fBuf = new Uint8Array(dataView.buffer, dataView.byteOffset + offt, fDef.size);
        const typedDataArray = readTypedData(fBuf, fDef);
        if (getInvalidValue(fDef.baseType.name) !== typedDataArray[0]) {
            fields[fDef.attrs.field] = decodeTypedData(typedDataArray, fDef, fields);
        }
        offt += fDef.size;
        size += fDef.size;
    }
    if (message && message.name === 'field_description') {
        devFields[fields.developer_data_index] = devFields[fields.developer_data_index] || {};
        devFields[fields.developer_data_index][fields.field_definition_number] = fields;
    }
    return {
        type: 'data',
        name: message.name,
        size,
        mDef,
        fields,
    };
}


export function calculateCRC(buf, start, end) {
    const crcTable = [
        0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
        0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
    ];
    let crc = 0;
    for (let i = (start || 0); i < (end || buf.byteLength); i++) {
        const byte = buf[i];
        let tmp = crcTable[crc & 0xF];
        crc = (crc >> 4) & 0x0FFF;
        crc = crc ^ tmp ^ crcTable[byte & 0xF];
        tmp = crcTable[crc & 0xF];
        crc = (crc >> 4) & 0x0FFF;
        crc = crc ^ tmp ^ crcTable[(byte >> 4) & 0xF];
    }
    return crc;
}

