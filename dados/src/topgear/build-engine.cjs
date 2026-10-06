const fs = require('fs');
const path = require('path');

function leb(n) {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
}

function vec(items) {
  return Buffer.concat([leb(items.length), ...items]);
}

function section(id, parts) {
  const payload = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([id]), leb(payload.length), payload]);
}

function u32(n) {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
}

function name(s) {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([leb(b.length), b]);
}

const type = section(1, [vec([
  Buffer.from([0x60, 0x00, 0x01, 0x7f]),
  Buffer.from([0x60, 0x03, 0x7f, 0x7f, 0x7f, 0x00])
])]);

const func = section(3, [vec([
  Buffer.from([0x00]), Buffer.from([0x00]),
  Buffer.from([0x00]), Buffer.from([0x01]), Buffer.from([0x00])
])]);

const mem = section(5, [vec([Buffer.from([0x00, 0x01])])]);

const glob = section(6, [vec([
  Buffer.concat([Buffer.from([0x7f, 0x01, 0x41]), leb(0), Buffer.from([0x0b])])
])]);

const exp = section(7, [vec([
  Buffer.concat([name('memory'), Buffer.from([0x02, 0x00])]),
  Buffer.concat([name('seed'), Buffer.from([0x00, 0x00])]),
  Buffer.concat([name('tick'), Buffer.from([0x00, 0x01])]),
  Buffer.concat([name('frames'), Buffer.from([0x00, 0x04])])
])]);

function body(locals, instrs) {
  const b = Buffer.concat([leb(locals.length), ...locals, ...instrs]);
  return Buffer.concat([leb(b.length), b]);
}

const code = section(10, [vec([
  body([], [Buffer.from([0x41]), leb(42), Buffer.from([0x0b])]),
  body([], [Buffer.from([0x41]), leb(7), Buffer.from([0x0b])]),
  body([], [Buffer.from([0x41]), leb(123), Buffer.from([0x0b])]),
  body([], [Buffer.from([0x41]), leb(1), Buffer.from([0x24, 0x00]), Buffer.from([0x0b])]),
  body([], [Buffer.from([0x23, 0x00, 0x41, 0x01, 0x6a, 0x24, 0x00, 0x23, 0x00]), Buffer.from([0x0b])])
])]);

const wasm = Buffer.concat([
  Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
  type, func, mem, glob, exp, code
]);

const out = path.join(__dirname, 'engine', 'emulator.wasm');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, wasm);
console.log('emulator.wasm:', wasm.length, 'bytes');
