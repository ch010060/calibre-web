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

  async function head(url) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (!res.ok) return null;
      const len = parseInt(res.headers.get("content-length") || "0", 10);
      const ar = (res.headers.get("accept-ranges") || "").toLowerCase().includes("bytes");
      return { length: len, acceptRanges: ar };
    } catch (e) {
      return null;
    }
  }

  async function fetchRange(url, start, endExclusive) {
    const end = endExclusive - 1;
    const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
    if (!(res.status === 206 || res.status === 200)) throw new Error("Range fetch failed");
    const buf = await res.arrayBuffer();
    const u8 = new Uint8Array(buf);
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
    if (typeof DecompressionStream === "undefined") throw new Error("DecompressionStream not supported");

    // deflate-raw for ZIP payloads
    const ds = new DecompressionStream("deflate-raw");
    const rs = new Response(new Blob([compBytes]).stream().pipeThrough(ds));
    const ab = await rs.arrayBuffer();
    return ab;
  }

  async function open(url) {
    // Probe
    const meta = await head(url);
    if (!meta || !meta.acceptRanges || !meta.length || typeof fetch === "undefined") return null;
    totalLenForProgress = meta.length;

    // Read last 64 KiB to find EOCD
    const tailSize = Math.min(65536 + 22, meta.length);
    const tail = await fetchRange(url, meta.length - tailSize, meta.length);
    const eocdOffInTail = findEOCD(tail);
    if (eocdOffInTail < 0) return null;
    const eocdAbsOff = meta.length - tailSize + eocdOffInTail;
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
        const locAbs = meta.length - tailSize + locIndex;
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
    const entries = parseCentralDirectory(cd, cdOffset);

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
