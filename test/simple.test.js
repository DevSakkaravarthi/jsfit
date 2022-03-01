import * as fit from '../src/fit.mjs';

const fileIdMsg = new Uint8Array([
      14, 16, 48,   8,  18,   0, 0,   0, 46,
      70, 73, 84, 132, 111,  64, 0,   0,  0,
       0,  2,  0,   1,   0,   4, 4, 134,  0,
       4, 10, 50, 129,  60, 241, 7
]);

test('parser init', () => {
    new fit.FitParser();
});

test('encode empty', async () => {
    const p = new fit.FitParser();
    const buf = p.encode();
    expect(buf[0]).toEqual(14);
    expect(buf.byteLength).toEqual(16);
});

test('encode one msg', async () => {
    const p = new fit.FitParser();
    p.addMessage('file_id', {type: 'activity', time_created: new Date()});
    const buf = p.encode();
    expect(buf.byteLength).toEqual(34);
});

test('decode one msg', async () => {
    const p = fit.FitParser.decode(fileIdMsg);
    expect(p.messages.length).toEqual(1);
    const {name, fields} = p.messages[0];
    expect(name).toEqual('file_id');
    expect(fields.type).toEqual('activity');
    expect(fields.time_created.getTime()).toEqual(1646165514000);
});

test('ouroboros one msg bin', async () => {
    const p = fit.FitParser.decode(fileIdMsg);
    const buf = p.encode();
    expect(buf).toEqual(fileIdMsg);
});

test('ouroboros one msg field desc', async () => {
    const p = fit.FitParser.decode(fileIdMsg);
    const {name, fields} = p.messages[0];
    const p2 = new fit.FitParser();
    p2.addMessage(name, {...fields});
    const buf = p.encode();
    expect(buf).toEqual(fileIdMsg);
});
