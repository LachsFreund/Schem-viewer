/* Minimal NBT reader (gzip or raw). Exposes global `NBT.read(arrayBuffer)`. */
const NBT = (() => {
  async function gunzip(buffer) {
    const u8 = new Uint8Array(buffer);
    if (u8[0] === 0x1f && u8[1] === 0x8b) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('This browser has no DecompressionStream support – use a current Chrome, Edge, Firefox or Safari.');
      }
      const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return u8;
  }

  function parse(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const td = new TextDecoder();
    let p = 0;

    const str = () => {
      const len = dv.getUint16(p); p += 2;
      const s = td.decode(u8.subarray(p, p + len)); p += len;
      return s;
    };

    function payload(type) {
      switch (type) {
        case 1: return dv.getInt8(p++);
        case 2: { const v = dv.getInt16(p); p += 2; return v; }
        case 3: { const v = dv.getInt32(p); p += 4; return v; }
        case 4: { const v = dv.getBigInt64(p); p += 8; return Number(v); }
        case 5: { const v = dv.getFloat32(p); p += 4; return v; }
        case 6: { const v = dv.getFloat64(p); p += 8; return v; }
        case 7: { // byte array (kept unsigned – callers handle signedness)
          const len = dv.getInt32(p); p += 4;
          const a = u8.slice(p, p + len); p += len;
          return a;
        }
        case 8: return str();
        case 9: {
          const t = dv.getUint8(p++);
          const len = dv.getInt32(p); p += 4;
          const arr = new Array(len);
          for (let i = 0; i < len; i++) arr[i] = payload(t);
          return arr;
        }
        case 10: {
          const obj = {};
          for (;;) {
            const t = dv.getUint8(p++);
            if (t === 0) break;
            const name = str();
            obj[name] = payload(t);
          }
          return obj;
        }
        case 11: {
          const len = dv.getInt32(p); p += 4;
          const a = new Int32Array(len);
          for (let i = 0; i < len; i++) { a[i] = dv.getInt32(p); p += 4; }
          return a;
        }
        case 12: {
          const len = dv.getInt32(p); p += 4;
          const a = new Array(len);
          for (let i = 0; i < len; i++) { a[i] = Number(dv.getBigInt64(p)); p += 8; }
          return a;
        }
        default: throw new Error('Unknown NBT tag type ' + type);
      }
    }

    const rootType = dv.getUint8(p++);
    if (rootType !== 10) throw new Error('Not an NBT file (root is not a compound).');
    str(); // root name
    return payload(10);
  }

  return {
    async read(arrayBuffer) {
      return parse(await gunzip(arrayBuffer));
    }
  };
})();
