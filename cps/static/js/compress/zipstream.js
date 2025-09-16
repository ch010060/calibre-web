"use strict";

// Minimal ZIP streaming reader using HTTP Range and DecompressionStream (no workers)
// Supports non-ZIP64 archives; falls back if ZIP64 detected or features missing.

(function () {
  const SIG_EOCD = 0x06054b50;      // End of Central Directory
  const SIG_CEN = 0x02014b50;       // Central directory file header
  const SIG_LOC = 0x04034b50;       // Local file header
  const SIG_ZIP64_EOCD_LOC = 0x07064b50; // ZIP64 EOCD locator (unsupported here)
  const SIG_ZIP64_EOCD = 0x06064b50;     // ZIP64 EOCD record
  const DEF_COMP = 8;
  const STORED = 0;

  let progressCb = null;
  let totalLenForProgress = 0;

  // We no longer rely on HEAD; use suffix ranges and Content-Range parsing

  async function fetchRange(url, start, endExclusive) {
    const end = endExclusive - 1;
    let res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
    // Fallbacks for servers that ignore or reject ranges
    if (res.status === 416) {
      // Requested range not satisfiable: fetch full file and slice
      res = await fetch(url);
    }
    if (!(res.status === 206 || res.status === 200)) throw new Error("Range fetch failed");
    const buf = await res.arrayBuffer();
    let u8 = new Uint8Array(buf);
    // If full content returned, slice the requested range
    if (res.status === 200) {
      const total = u8.length;
      const s = Math.max(0, Math.min(start, total));
      const e = Math.max(s, Math.min(endExclusive, total));
      u8 = u8.subarray(s, e);
    }
    try { if (progressCb && totalLenForProgress) progressCb(u8.byteLength, totalLenForProgress); } catch(_) {}
    return u8;
  }

  function findEOCD(u8) {
    // scan backwards for EOCD signature within buffer
    for (let i = u8.length - 22; i >= 0; i--) { // min EOCD size 22
      if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) {
        return i;
      }
    }
    return -1;
  }

  function readEOCD(u8, off) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const diskNo = dv.getUint16(off + 4, true);
    const diskWithCd = dv.getUint16(off + 6, true);
    const entriesOnDisk = dv.getUint16(off + 8, true);
    const totalEntries = dv.getUint16(off + 10, true);
    const cdSize = dv.getUint32(off + 12, true);
    const cdOffset = dv.getUint32(off + 16, true);
    const commentLen = dv.getUint16(off + 20, true);
    return { diskNo, diskWithCd, entriesOnDisk, totalEntries, cdSize, cdOffset, commentLen };
  }

  function parseCentralDirectory(u8, cdOffset) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let off = 0;
    const entries = [];
    while (off + 46 <= u8.length) {
      const sig = dv.getUint32(off, true);
      if (sig !== SIG_CEN) break;
      const version = dv.getUint16(off + 4, true);
      const gpFlag = dv.getUint16(off + 8, true);
      const compMethod = dv.getUint16(off + 10, true);
      const lastModTime = dv.getUint16(off + 12, true);
      const lastModDate = dv.getUint16(off + 14, true);
      const crc32 = dv.getUint32(off + 16, true);
      let compSize = dv.getUint32(off + 20, true);
      let uncompSize = dv.getUint32(off + 24, true);
      const fnameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commentLen = dv.getUint16(off + 32, true);
      const diskStart = dv.getUint16(off + 34, true);
      const intAttr = dv.getUint16(off + 36, true);
      const extAttr = dv.getUint32(off + 38, true);
      let relOffLocalHdr = dv.getUint32(off + 42, true);
      const nameBytes = u8.subarray(off + 46, off + 46 + fnameLen);
      const name = new TextDecoder("utf-8").decode(nameBytes);

      // Parse extra for ZIP64 sizes/offset if needed
      if (extraLen > 0 && (compSize === 0xFFFFFFFF || uncompSize === 0xFFFFFFFF || relOffLocalHdr === 0xFFFFFFFF)) {
        let eoff = off + 46 + fnameLen;
        const extraEnd = eoff + extraLen;
        while (eoff + 4 <= extraEnd) {
          const headerId = dv.getUint16(eoff, true); eoff += 2;
          const dataSize = dv.getUint16(eoff, true); eoff += 2;
          if (headerId === 0x0001) { // ZIP64 extended info
            let p = eoff;
            function readU64() {
              const lo = dv.getUint32(p, true), hi = dv.getUint32(p + 4, true); p += 8;
              const val = hi * 0x100000000 + lo;
              return val;
            }
            if (uncompSize === 0xFFFFFFFF && p + 8 <= eoff + dataSize) uncompSize = readU64();
            if (compSize === 0xFFFFFFFF && p + 8 <= eoff + dataSize) compSize = readU64();
            if (relOffLocalHdr === 0xFFFFFFFF && p + 8 <= eoff + dataSize) relOffLocalHdr = readU64();
            break;
          } else {
            eoff += dataSize;
          }
        }
      }

      entries.push({
        name,
        compMethod,
        compSize,
        uncompSize,
        relOffLocalHdr,
        gpFlag,
        cdOffset: cdOffset + off
      });
      off += 46 + fnameLen + extraLen + commentLen;
    }
    return entries;
  }

  function isImageName(name) {
    if (!name || name.endsWith('/')) return false;
    const lower = name.toLowerCase();
    // Exclude system/hidden artifacts from macOS and Windows
    if (lower.indexOf('__macosx/') === 0) return false;
    if (lower.endsWith('thumbs.db')) return false; // Windows thumbnail cache
    if (lower.endsWith('desktop.ini')) return false; // Windows folder config
    if (lower.split('/').some(seg => seg === '.ds_store')) return false; // macOS folder metadata
    if (lower.split('/').some(seg => seg.startsWith('._'))) return false; // AppleDouble resource forks
    return (
      lower.endsWith('.jpg') || lower.endsWith('.jpeg') ||
      lower.endsWith('.png') || lower.endsWith('.gif') ||
      lower.endsWith('.webp') || lower.endsWith('.avif') ||
      lower.endsWith('.svg')
    );
  }

  function readZip64Locator(u8, absBase) {
    // u8 is a slice containing the locator at some offset; return relative info
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    // structure: sig(4), diskStart(4), zip64eocdRelOff(8), totalDisks(4)
    const diskStart = dv.getUint32(4, true);
    const relOff = Number(dv.getUint32(12, true) + dv.getUint32(16, true) * 0x100000000);
    const totalDisks = dv.getUint32(20, true);
    return { diskStart, zip64eocdOffset: relOff, totalDisks };
  }

  function readZip64EOCD(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    // signature at 0, then size (8), then version fields… we only need CD size/offset and totals
    const sig = dv.getUint32(0, true);
    if (sig !== SIG_ZIP64_EOCD) throw new Error("Invalid ZIP64 EOCD");
    const size = Number(dv.getUint32(4, true) + dv.getUint32(8, true) * 0x100000000);
    // fields positions based on spec; CD size and offset at fixed positions
    // Offset of central directory (8) is at 48; size (8) at 40; total entries (8) at 32
    const totalEntries = Number(dv.getUint32(32, true) + dv.getUint32(36, true) * 0x100000000);
    const cdSize = Number(dv.getUint32(40, true) + dv.getUint32(44, true) * 0x100000000);
    const cdOffset = Number(dv.getUint32(48, true) + dv.getUint32(52, true) * 0x100000000);
    return { size, totalEntries, cdSize, cdOffset };
  }

  async function fetchLocalHeader(url, relOffLocalHdr) {
    // Read 30 bytes + variable fname/extra lengths
    const head = await fetchRange(url, relOffLocalHdr, relOffLocalHdr + 30);
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const sig = dv.getUint32(0, true);
    if (sig !== SIG_LOC) throw new Error("Invalid local header signature");
    const gpFlag = dv.getUint16(6, true);
    const compMethod = dv.getUint16(8, true);
    const fnameLen = dv.getUint16(26, true);
    const extraLen = dv.getUint16(28, true);
    const total = 30 + fnameLen + extraLen;
    return { total, compMethod };
  }

  async function fetchEntryData(url, entry) {
    const { relOffLocalHdr, compSize, compMethod } = entry;
    const loc = await fetchLocalHeader(url, relOffLocalHdr);
    const dataStart = relOffLocalHdr + loc.total;
    const compBytes = await fetchRange(url, dataStart, dataStart + compSize);

    if (compMethod === STORED) {
      return compBytes.buffer.slice(compBytes.byteOffset, compBytes.byteOffset + compBytes.byteLength);
    }
    if (compMethod !== DEF_COMP) throw new Error("Unsupported compression method: " + compMethod);
    if (typeof DecompressionStream === "undefined") {
      // Fallback: try inflate via built-in browser APIs (Response + 'deflate' sometimes works) else throw
      try {
        const ds = new DecompressionStream("deflate");
        const rs = new Response(new Blob([compBytes]).stream().pipeThrough(ds));
        const ab = await rs.arrayBuffer();
        return ab;
      } catch (e) {
        throw new Error("DecompressionStream not supported");
      }
    }

    // deflate-raw for ZIP payloads
    try {
      const ds = new DecompressionStream("deflate-raw");
      const rs = new Response(new Blob([compBytes]).stream().pipeThrough(ds));
      const ab = await rs.arrayBuffer();
      return ab;
    } catch (e) {
      // Some Chrome builds may prefer 'deflate' wrapper; try it as fallback
      const ds = new DecompressionStream("deflate");
      const rs = new Response(new Blob([compBytes]).stream().pipeThrough(ds));
      const ab = await rs.arrayBuffer();
      return ab;
    }
  }

  async function open(url) {
    if (typeof fetch === "undefined") return null;

    // Fetch tail via suffix range to locate EOCD; works without HEAD
    const tailWanted = 65536 + 22;
    let tailRes = await fetch(url, { headers: { Range: `bytes=-${tailWanted}` } });
    if (tailRes.status === 416) {
      // Fallback: server rejected suffix range, fetch whole file
      tailRes = await fetch(url);
    }
    if (!(tailRes.status === 206 || tailRes.status === 200)) return null;
    const tailBuf = new Uint8Array(await tailRes.arrayBuffer());
    // Determine total length from Content-Range or Content-Length
    let totalLen = 0;
    const cr = tailRes.headers.get('content-range');
    if (cr) {
      // e.g., bytes 12345-67890/99999
      const m = cr.match(/\/(\d+)$/);
      if (m) totalLen = parseInt(m[1], 10);
    }
    if (!totalLen) {
      const cl = tailRes.headers.get('content-length');
      if (cl) totalLen = parseInt(cl, 10);
      else totalLen = tailBuf.length; // fallback
    }
    totalLenForProgress = totalLen || 0;

    // If we got the whole file in response to a range (status 200), keep only the last tailWanted slice
    const tail = tailBuf.length > tailWanted ? tailBuf.subarray(tailBuf.length - tailWanted) : tailBuf;
    const eocdOffInTail = findEOCD(tail);
    if (eocdOffInTail < 0) return null;
    const eocdAbsOff = totalLen - tail.length + eocdOffInTail;
    const eocd = readEOCD(tail, eocdOffInTail);

    let cdOffset = eocd.cdOffset;
    let cdSize = eocd.cdSize;
    let totalEntries = eocd.totalEntries;

    // Detect ZIP64 by placeholder values and try to resolve via locator/ZIP64 EOCD
    if (totalEntries === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) {
      // Search for ZIP64 locator within tail (should be just before EOCD typically)
      let locIndex = -1;
      for (let i = eocdOffInTail - 4; i >= 0; i--) {
        if (tail[i] === 0x50 && tail[i+1] === 0x4b && tail[i+2] === 0x06 && tail[i+3] === 0x07) { locIndex = i; break; }
      }
      if (locIndex >= 0) {
        const locAbs = totalLen - tail.length + locIndex;
        const locatorSlice = tail.subarray(locIndex, locIndex + 20 + 4); // 20 bytes locator
        const locator = readZip64Locator(locatorSlice, locAbs);
        // Fetch ZIP64 EOCD record
        const eocd64Head = await fetchRange(url, locator.zip64eocdOffset, locator.zip64eocdOffset + 56);
        const eocd64 = readZip64EOCD(eocd64Head);
        cdOffset = eocd64.cdOffset;
        cdSize = eocd64.cdSize;
        totalEntries = eocd64.totalEntries;
      } else {
        // can't resolve ZIP64, fallback
        return null;
      }
    }

    // Fetch central directory
    const cd = await fetchRange(url, cdOffset, cdOffset + cdSize);
    const allEntries = parseCentralDirectory(cd, cdOffset);
    const entries = allEntries.filter(e => isImageName(e.name));

    // Wrap entries with async readData(cb)
    const wrapped = entries.map((e) => ({
      name: e.name,
      is_file: true,
      size_compressed: e.compSize >>> 0,
      size_uncompressed: e.uncompSize >>> 0,
      _raw: e,
      readData: function (cb) {
        // async; mirror existing API with cb(ab, err)
        fetchEntryData(url, e).then(
          (ab) => cb(ab, null),
          (err) => cb(null, err)
        );
      }
    }));

    return { entries: wrapped };
  }

  // Export
  if (typeof window !== "undefined") {
    window.ZipStream = { open, onProgress: function (cb) { progressCb = cb; } };
  } else if (typeof self !== "undefined") {
    self.ZipStream = { open, onProgress: function (cb) { progressCb = cb; } };
  }
})();
