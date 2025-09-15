/*
 * kthoom.js
 *
 * Licensed under the MIT License
 *
 * Copyright(c) 2011 Google Inc.
 * Copyright(c) 2011 antimatter15
*/

/* Reference Documentation:

  * Web Workers: http://www.whatwg.org/specs/web-workers/current-work/
  * Web Workers in Mozilla: https://developer.mozilla.org/En/Using_web_workers
  * File API (FileReader): http://www.w3.org/TR/FileAPI/
  * Typed Arrays: http://www.khronos.org/registry/typedarray/specs/latest/#6

*/
/* global screenfull, bitjs, Uint8Array, opera, loadArchiveFormats, archiveOpenFile */
/* exported init, event */


if (window.opera) {
    window.console.log = function(str) {
        opera.postError(str);
    };
}

var kthoom;

// gets the element with the given id
function getElem(id) {
    if (document.documentElement.querySelector) {
        // querySelector lookup
        return document.body.querySelector("#" + id);
    }
    // getElementById lookup
    return document.getElementById(id);
}

if (typeof window.kthoom === "undefined" ) {
    kthoom = {};
}

// key codes
kthoom.Key = {
    ESCAPE: 27,
    SPACE: 32,
    LEFT: 37,
    UP: 38,
    RIGHT: 39,
    DOWN: 40,
    A: 65, B: 66, C: 67, D: 68, E: 69, F: 70, G: 71, H: 72, I: 73, J: 74, K: 75, L: 76, M: 77,
    N: 78, O: 79, P: 80, Q: 81, R: 82, S: 83, T: 84, U: 85, V: 86, W: 87, X: 88, Y: 89, Z: 90,
    QUESTION_MARK: 191,
    LEFT_SQUARE_BRACKET: 219,
    RIGHT_SQUARE_BRACKET: 221
};

// global variables
var unarchiver = null;
var currentImage = 0;
var imageFiles = [];
var imageFilenames = [];
var totalImages = 0;
var prevScrollPosition = 0;
// Keep reference to archive entries for on-demand re-decompression
var archiveEntries = null;

var settings = {
    hflip: false,
    vflip: false,
    rotateTimes: 0,
    fitMode: kthoom.Key.B,
    theme: "light",
    direction: 0, // 0 = Left to Right, 1 = Right to Left
    scrollbar: 1, // 0 = Hide Scrollbar, 1 = Show Scrollbar
    arrow: 1, // 0 = Hide Arrow, 1 = Show Arrow
    wheelflip: 0, // 0 = Disable wheel flip, 1 = Enable wheel flip
    autoClose: 0, // 0 = Disable auto close, 1 = Enable auto close
    pageDisplay: 0, // 0 = Single Page, 1 = Long Strip
    prefetch: 5, // number of pages to prefetch ahead
    upscaleMode: 'sharpened', // 'crisp' | 'smooth' | 'sharpened'
    dipMode: 'disabled' // 'disabled' | 'autocontrast' | 'autolevels'
};

kthoom.saveSettings = function() {
    localStorage.kthoomSettings = JSON.stringify(settings);
};

kthoom.loadSettings = function() {
    try {
        if (!localStorage.kthoomSettings) {
            return;
        }

        $.extend(settings, JSON.parse(localStorage.kthoomSettings));

        kthoom.setSettings();
    } catch (err) {
        alert("Error load settings");
    }
};

kthoom.setSettings = function() {
    // Set settings control values
    $.each(settings, function(key, value) {
        if (typeof value === "boolean") {
            $("input[name=" + key + "]").prop("checked", value);
        } else {
            $("input[name=" + key + "]").val([value]);
        }
    });
};

var createURLFromArray = function(array, mimeType) {
    var offset = 0; // array.byteOffset;
    var len = array.byteLength;
    var blob;

    if (mimeType === "image/xml+svg") {
        var xmlStr = new TextDecoder("utf-8").decode(array);
        return "data:image/svg+xml;UTF-8," + encodeURIComponent(xmlStr);
    }

    // TODO: Move all this browser support testing to a common place
    //     and do it just once.

    // Blob constructor, see http://dev.w3.org/2006/webapi/FileAPI/#dfn-Blob.
    if (typeof Blob === "function") {
        blob = new Blob([array], {type: mimeType});
    } else {
        throw "Browser support for Blobs is missing.";
    }

    if (blob.slice) {
        blob = blob.slice(offset, offset + len, mimeType);
    } else {
        throw "Browser support for Blobs is missing.";
    }

    if ((typeof URL !== "function" && typeof URL !== "object") ||
        typeof URL.createObjectURL !== "function") {
        throw "Browser support for Object URLs is missing";
    }

    return URL.createObjectURL(blob);
};


// Stores an image filename and its data: URI.
kthoom.ImageFile = function(file) {
    this.filename = file.filename;
    var fileExtension = file.filename.split(".").pop().toLowerCase();
    switch (fileExtension) {
        case "jpg":
        case "jpeg":
            this.mimeType = "image/jpeg";
            break;
        case "png":
            this.mimeType = "image/png";
            break;
        case "gif":
            this.mimeType = "image/gif";
            break;
        case "svg":
            this.mimeType = "image/svg+xml";
            break;
        case "webp":
            this.mimeType = "image/webp";
            break;
        case "avif":
            this.mimeType = "image/avif";
            break;
        default:
            this.mimeType = undefined;
            break;
    }

    // Reset mime type for special files originating from Apple devices
    // This folder may contain files having image extensions (for example .jpg) but those files are not actual images
    // Trying to view these files cause corrupted/empty pages in the comic reader and files should be ignored
    if (this.filename.indexOf("__MACOSX") !== -1) {
        this.mimeType = undefined;
    }

    if ( this.mimeType !== undefined) {
        this.dataURI = createURLFromArray(file.fileData, this.mimeType);
    }
    // Release original ArrayBuffer reference to allow GC
    try { file.fileData = null; } catch (e) {}
};

function initProgressClick() {
    $("#progress").click(function(e) {
        var offset = $(this).offset();
        var x = e.pageX - offset.left;
        var rate = settings.direction === 0 ? x / $(this).width() : 1 - x / $(this).width();
        currentImage = Math.max(1, Math.ceil(rate * totalImages)) - 1;
        updatePage();
    });
}

function loadFromArrayBuffer(ab) {
    const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    loadArchiveFormats(['rar', 'zip', 'tar'], function() {
        // Open the file as an archive
        archiveOpenFile(ab, function (archive) {
            if (!archive) return;

            console.info('Uncompressing ' + archive.archive_type + ' ...');
            const entries = archive.entries.sort((a,b) => collator.compare(a.name, b.name));
            archiveEntries = entries;
            totalImages = entries.length;

            // Prepare arrays sized to total pages
            imageFiles = new Array(totalImages);
            imageFilenames = new Array(totalImages);

            // Pre-create canvases for all pages so layout is immediate
            for (let i = 0; i < totalImages; i++) {
                drawCanvas(i);
            }

            // Sequential, lazy loader with prefetch window (adaptive)
            let loading = false;
            let loadedCount = 0;
            const loadQueue = [];
            const inQueue = new Set();
            var adaptivePrefetch = null; // null means use setting
            function getPrefetchAhead() {
                var maxn = parseInt(settings.prefetch, 10);
                if (isNaN(maxn) || maxn < 0) maxn = 5;
                if (adaptivePrefetch == null) return maxn;
                return Math.max(0, Math.min(maxn, adaptivePrefetch|0));
            }

            function processQueue() {
                if (loading) return;
                const index = loadQueue.shift();
                if (typeof index === 'undefined') return;
                inQueue.delete(index);
                loading = true;

                const e = entries[index];
                // Ensure target canvas exists
                if (!$(".mainImage")[index]) {
                    drawCanvas(index);
                }
                e.readData(function(d) {
                    try {
                        const data = { filename: e.name, fileData: d };
                        const imgFile = new kthoom.ImageFile(data);

                        imageFiles[index] = imgFile;
                        imageFilenames[index] = e.name;
                        setImage(imgFile.dataURI, $(".mainImage")[index], function() {
                            // After rendering, generate a lightweight thumbnail and revoke blob URL
                            try {
                                var mainCanvas = $(".mainImage")[index];
                                if (mainCanvas) {
                                    var tw = 160; // thumbnail width
                                    var th = Math.max(1, Math.round(mainCanvas.height * (tw / Math.max(1, mainCanvas.width))));
                                    var tcanvas = document.createElement('canvas');
                                    tcanvas.width = tw;
                                    tcanvas.height = th;
                                    var tx = tcanvas.getContext('2d');
                                    tx.drawImage(mainCanvas, 0, 0, tw, th);
                                    var thumbURL = tcanvas.toDataURL('image/jpeg', 0.7);
                                    var $thumbImg = $("#thumbnails a[data-page='" + (index + 1) + "'] img");
                                    if ($thumbImg.length) $thumbImg.attr('src', thumbURL);
                                }
                            } catch(thumbErr) { console.warn('Thumbnail generation failed', thumbErr); }

                            // Revoke blob URL and drop reference to allow GC
                            try {
                                if (typeof imgFile.dataURI === 'string' && imgFile.dataURI.indexOf('blob:') === 0) {
                                    URL.revokeObjectURL(imgFile.dataURI);
                                }
                                imgFile.dataURI = null;
                            } catch(revokeErr) { console.warn('Revoke failed', revokeErr); }
                        });

                        // Add thumbnail in correct order position (placeholder, replaced after render)
                        var liHtml = "<li>" +
                                     "<a data-page='" + (index + 1) + "'>" +
                                     "<img src='' alt='thumb'/>" +
                                     "<span>" + (index + 1) + "</span>" +
                                     "</a>" +
                                     "</li>";
                        var $thumbs = $("#thumbnails");
                        var $items = $thumbs.children("li");
                        if (index >= $items.length) {
                            $thumbs.append(liHtml);
                        } else {
                            $($items[index]).before(liHtml);
                        }

                        loadedCount++;
                        updateProgress(Math.round(loadedCount / totalImages * 100), 'Decoding…');

                        // Show first page as soon as it's ready
                        if (index === 0 && currentImage === 0) {
                            updatePage();
                        }
                    } catch (err) {
                        console.error('Failed to decode image #' + (index + 1), err);
                        setImage('error', $(".mainImage")[index]);
                    } finally {
                        loading = false;
                        setTimeout(processQueue, 0);
                    }
                });
            }

            function enqueue(index, priority) {
                if (index < 0 || index >= totalImages) return;
                if (imageFiles[index]) return; // already loaded
                if (inQueue.has(index)) return;
                if (priority) {
                    loadQueue.unshift(index);
                } else {
                    loadQueue.push(index);
                }
                inQueue.add(index);
                processQueue();
            }

            // Start from bookmarked/current page and prefetch next pages
            if (currentImage < 0) currentImage = 0;
            if (currentImage >= totalImages) currentImage = totalImages - 1;
            enqueue(currentImage, true);
            for (let k = 1, m = getPrefetchAhead(); k <= m; k++) enqueue(currentImage + k, false);

            // On page updates, prioritize current and next page
            const originalUpdatePage = updatePage;
            updatePage = function() {
                originalUpdatePage();
                enqueue(currentImage, true);
                for (let k = 1, m = getPrefetchAhead(); k <= m; k++) enqueue(currentImage + k, false);
            };

            // Ensure UI reflects the bookmarked/current page and start loading it
            updatePage();
        });
    });
}

function scrollTocToActive() {
    $(".page").text((currentImage + 1 ) + "/" + totalImages);

    // Mark the current page in the TOC
    var $active = $("#tocView a[data-page]")
        // Remove the currently active thumbnail
        .removeClass("active")
        // Find the new one
        .filter("[data-page=" + (currentImage + 1) + "]")
        // Set it to active
        .addClass("active");

    // Scroll to the thumbnail in the TOC on page change (if it exists)
    var pos = $active.position();
    if (pos) {
        $("#tocView").stop().animate({ scrollTop: pos.top }, 200);
    }
}

function updatePage() {
    if(currentImage + 1 == totalImages){
        // Mark as read at last page
        setRead();
    }

    scrollTocToActive();
    scrollCurrentImageIntoView();
    updateProgress();
    pageDisplayUpdate();
    setTheme();

    if(settings.arrow){
        $("#left").show();
        $("#right").show();
    }
    else{
        $("#left").hide();
        $("#right").hide();
    }

    kthoom.setSettings();
    kthoom.saveSettings();

    setBookmark();
}

function setTheme() {
    $("body").toggleClass("dark-theme", settings.theme === "dark");
	$("#mainContent").toggleClass("disabled-scrollbar", settings.scrollbar === 0);
}

function pageDisplayUpdate() {
    if(settings.pageDisplay === 0) {
        $(".mainImage").addClass("hide");
        $(".mainImage").eq(currentImage).removeClass("hide");
        $("#mainContent").removeClass("long-strip");
    } else {
        $(".mainImage").removeClass("hide");
        $("#mainContent").addClass("long-strip");
        scrollCurrentImageIntoView();
    }
}

function updateProgress(loadPercentage, statusText) {
    if (settings.direction === 0) {
        $("#progress .bar-read")
            .removeClass("from-right")
            .addClass("from-left");
        $("#progress .bar-load")
            .removeClass("from-right")
            .addClass("from-left");
    } else {
        $("#progress .bar-read")
            .removeClass("from-left")
            .addClass("from-right");
        $("#progress .bar-load")
            .removeClass("from-left")
            .addClass("from-right");
    }

    // Set the load/unzip progress if it's passed in
    if (loadPercentage) {
        $("#progress .bar-load").css({ width: loadPercentage + "%" });
        if (statusText && loadPercentage < 100) {
            $("#progress .load").text(statusText);
        }

        if (loadPercentage === 100) {
            $("#progress")
                .removeClass("loading")
                .find(".load").text("");
        }
    }
    // Set page progress bar
    $("#progress .bar-read").css({ width: totalImages === 0 ? 0 : Math.round((currentImage + 1) / totalImages * 100) + "%"});
}

function setImage(url, _canvas, onRendered) {
    // Prefer provided canvas; otherwise try current page; finally last canvas
    var canvas = _canvas || $(".mainImage")[currentImage] || $(".mainImage").slice(-1)[0];
    var x = canvas.getContext("2d");

    $("#mainText").hide();
    if (url === "error") {
        x.fillStyle = "black";
        x.textAlign = "center";
        x.font = "24px sans-serif";
        x.strokeStyle = (settings.theme === "dark") ? "white" : "black";
        x.fillText("Unable to decompress image #" + (currentImage + 1), innerWidth / 2, 100);

        $(".mainImage").slice(-1).addClass("error");
    } else {
        if ($("body").css("scrollHeight") / innerHeight > 1) {
            $("body").css("overflowY", "scroll");
        }

        var img = new Image();
        img.onerror = function() {
            var dprErr = Math.min(window.devicePixelRatio || 1, 2.0);
            canvas.width = Math.max(1, Math.floor((innerWidth - 100) * dprErr));
            canvas.height = Math.max(1, Math.floor(300 * dprErr));
            if (typeof x.setTransform === 'function') {
                x.setTransform(dprErr, 0, 0, dprErr, 0, 0);
            } else {
                x.scale(dprErr, dprErr);
            }
            x.fillStyle = "black";
            x.font = "50px sans-serif";
            x.strokeStyle = "black";
            x.fillText("Page #" + (currentImage + 1) + " (" +
                imageFiles[currentImage].filename + ")", innerWidth / 2, 100);
            x.fillStyle = "black";
            x.fillText("Is corrupt or not an image", innerWidth / 2, 200);

            var xhr = new XMLHttpRequest();
            if (/(html|htm)$/.test(imageFiles[currentImage].filename)) {
                xhr.open("GET", url, true);
                xhr.onload = function() {
                    $("#mainText").css("display", "");
                    $("#mainText").innerHTML("<iframe style=\"width:100%;height:700px;border:0\" src=\"data:text/html," + escape(xhr.responseText) + "\"></iframe>");
                };
                xhr.send(null);
            } else if (!/(jpg|jpeg|png|gif|webp|avif)$/.test(imageFiles[currentImage].filename) && imageFiles[currentImage].data.uncompressedSize < 10 * 1024) {
                xhr.open("GET", url, true);
                xhr.onload = function() {
                    $("#mainText").css("display", "");
                    $("#mainText").innerText(xhr.responseText);
                };
                xhr.send(null);
            }
        };
        img.onload = function() {
            var imgW = img.width,
                imgH = img.height;

            // Normalize rotation
            settings.rotateTimes = (4 + settings.rotateTimes) % 4;

            // Natural rotated dimensions
            var natW = (settings.rotateTimes % 2 === 1) ? imgH : imgW;
            var natH = (settings.rotateTimes % 2 === 1) ? imgW : imgH;

            // Container and constraints
            var containerW = $("#mainContent").width() || innerWidth;
            var containerH = innerHeight - 50;

            // Compute target scale based on fit mode
            var scale = 1;
            switch (settings.fitMode) {
                case kthoom.Key.W: // fit width
                    scale = containerW / natW; break;
                case kthoom.Key.H: // fit height
                    scale = containerH / natH; break;
                case kthoom.Key.B: // best (fit both)
                    scale = Math.min(containerW / natW, containerH / natH); break;
                case kthoom.Key.N: // native: avoid upscaling, but clamp to container to prevent huge canvases
                default:
                    scale = Math.min(1, Math.min(containerW / natW, containerH / natH));
                    break;
            }
            if (!isFinite(scale) || scale <= 0) scale = 1;

            // Target display size
            var targetW = Math.max(1, Math.floor(natW * scale));
            var targetH = Math.max(1, Math.floor(natH * scale));

            // Clamp to safe canvas limits (iOS/Safari sensitive)
            var EDGE_LIMIT = 8192; // conservative
            var PIXEL_LIMIT = 16777216; // ~16MP
            var factor = Math.min(EDGE_LIMIT / targetW, EDGE_LIMIT / targetH, Math.sqrt(PIXEL_LIMIT / (targetW * targetH)));
            if (!isFinite(factor)) factor = 1;
            if (factor < 1) {
                targetW = Math.max(1, Math.floor(targetW * factor));
                targetH = Math.max(1, Math.floor(targetH * factor));
            }

            // HiDPI support: render at device pixel ratio for crisp output
            var dpr = Math.min(window.devicePixelRatio || 1, 2.0);
            // Keep CSS sizing controlled by layout; draw into a higher-resolution backing store
            canvas.width = Math.max(1, Math.floor(targetW * dpr));
            canvas.height = Math.max(1, Math.floor(targetH * dpr));

            x.save();
            // Map drawing units to CSS pixels
            if (typeof x.setTransform === 'function') {
                x.setTransform(dpr, 0, 0, dpr, 0, 0);
            } else {
                x.scale(dpr, dpr);
            }
            // Choose smoothing based on scaling direction: disable when upscaling to avoid blur
            // and enable with high quality when downscaling.
            // The actual smoothing toggle is applied after dispScale is known.

            // Center at display size, rotate, flip, then scale image to display size
            x.translate(targetW / 2, targetH / 2);
            x.rotate(Math.PI / 2 * settings.rotateTimes);
            if (settings.vflip) x.scale(1, -1);
            if (settings.hflip) x.scale(-1, 1);

            // Uniform scale to map natural rotated size to target size
            var dispScale = Math.min(targetW / natW, targetH / natH);
            if (!isFinite(dispScale) || dispScale <= 0) dispScale = 1;
            // Toggle smoothing strategy for upscales based on user setting
            var isUpscale = dispScale > 1.0001;
            var mode = (settings.upscaleMode || 'sharpened');
            if (isUpscale) {
                if (mode === 'crisp') {
                    x.imageSmoothingEnabled = false;
                    try { x.imageSmoothingQuality = 'low'; } catch(_) {}
                    try { canvas.style.imageRendering = 'pixelated'; } catch(_) {}
                } else if (mode === 'smooth') {
                    x.imageSmoothingEnabled = true;
                    try { x.imageSmoothingQuality = 'high'; } catch(_) {}
                    try { canvas.style.imageRendering = 'auto'; } catch(_) {}
                } else { // sharpened
                    x.imageSmoothingEnabled = true;
                    try { x.imageSmoothingQuality = 'high'; } catch(_) {}
                    try { canvas.style.imageRendering = 'auto'; } catch(_) {}
                }
            } else {
                // Downscaling
                x.imageSmoothingEnabled = true;
                try { x.imageSmoothingQuality = 'high'; } catch(_) {}
                try { canvas.style.imageRendering = 'auto'; } catch(_) {}
            }
            x.scale(dispScale, dispScale);

            // Draw centered
            x.drawImage(img, -imgW / 2, -imgH / 2, imgW, imgH);

            x.restore();

            // Optional DIP for pale scans
            if (settings.dipMode === 'autocontrast') {
                try { applyAutoContrast(canvas); } catch(e) { console.warn('contrast failed', e); }
            } else if (settings.dipMode === 'autolevels') {
                try { applyAutoLevels(canvas); } catch(e) { console.warn('autolevels failed', e); }
            }
            // Optional post-sharpen for upscales
            if (isUpscale && mode === 'sharpened') {
                try { applyLightSharpen(canvas); } catch(e) { console.warn('sharpen failed', e); }
            }

            canvas.style.display = "";
            $("body").css("overflowY", "");
            if (typeof onRendered === 'function') {
                try { onRendered(); } catch(e) { console.error(e); }
            }
        };
        img.src = url;
    }
}

// Lightweight unsharp mask (single pass sharpen kernel). Skips very large canvases.
function applyLightSharpen(canvas) {
    var MAX_PIXELS = 8 * 1024 * 1024; // ~8MP safeguard
    var w = canvas.width, h = canvas.height;
    if (w * h > MAX_PIXELS) return;
    var ctx = canvas.getContext('2d');
    var src = ctx.getImageData(0, 0, w, h);
    var dst = ctx.createImageData(w, h);
    var s = src.data, d = dst.data;
    // 3x3 sharpen kernel
    var k = [ 0,-1, 0,
             -1, 5,-1,
              0,-1, 0];
    var idx = 0;
    for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++, idx += 4) {
            var r=0,g=0,b=0,a=0;
            var i = 0;
            for (var ky=-1; ky<=1; ky++) {
                var yy = Math.min(h-1, Math.max(0, y+ky));
                for (var kx=-1; kx<=1; kx++, i++) {
                    var xx = Math.min(w-1, Math.max(0, x+kx));
                    var si = (yy*w+xx)*4;
                    var kv = k[i];
                    r += s[si  ] * kv;
                    g += s[si+1] * kv;
                    b += s[si+2] * kv;
                }
            }
            d[idx  ] = Math.max(0, Math.min(255, r));
            d[idx+1] = Math.max(0, Math.min(255, g));
            d[idx+2] = Math.max(0, Math.min(255, b));
            d[idx+3] = s[idx+3];
        }
    }
    ctx.putImageData(dst, 0, 0);
}

// Auto-contrast using per-channel percentile stretch
function applyAutoContrast(canvas) {
    var MAX_PIXELS = 8 * 1024 * 1024; // ~8MP safeguard
    var w = canvas.width, h = canvas.height;
    if (w * h > MAX_PIXELS) return;
    var ctx = canvas.getContext('2d');
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data;
    var histR = new Uint32Array(256), histG = new Uint32Array(256), histB = new Uint32Array(256);
    var len = d.length;
    for (var i = 0; i < len; i += 4) {
        histR[d[i]]++;
        histG[d[i+1]]++;
        histB[d[i+2]]++;
    }
    function bounds(hist) {
        var total = w * h;
        var clip = Math.max(1, Math.floor(total * 0.005)); // 0.5% per tail
        var lo = 0, hi = 255, acc = 0;
        while (lo < 255 && (acc + hist[lo]) < clip) { acc += hist[lo++]; }
        acc = 0;
        while (hi > 0 && (acc + hist[hi]) < clip) { acc += hist[hi--]; }
        if (hi <= lo + 1) { lo = Math.max(0, lo-1); hi = Math.min(255, hi+1); }
        return [lo, hi];
    }
    var br = bounds(histR), bg = bounds(histG), bb = bounds(histB);
    var sr = 255 / Math.max(1, (br[1] - br[0]));
    var sg = 255 / Math.max(1, (bg[1] - bg[0]));
    var sb = 255 / Math.max(1, (bb[1] - bb[0]));
    for (var j = 0; j < len; j += 4) {
        var r = (d[j]   - br[0]) * sr;   d[j]   = r < 0 ? 0 : r > 255 ? 255 : r|0;
        var g = (d[j+1] - bg[0]) * sg;   d[j+1] = g < 0 ? 0 : g > 255 ? 255 : g|0;
        var b = (d[j+2] - bb[0]) * sb;   d[j+2] = b < 0 ? 0 : b > 255 ? 255 : b|0;
    }
    ctx.putImageData(img, 0, 0);
}

// Auto-levels using simple per-channel min/max stretch (no clipping)
function applyAutoLevels(canvas) {
    var MAX_PIXELS = 8 * 1024 * 1024; // ~8MP safeguard
    var w = canvas.width, h = canvas.height;
    if (w * h > MAX_PIXELS) return;
    var ctx = canvas.getContext('2d');
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data;
    var minR=255, minG=255, minB=255, maxR=0, maxG=0, maxB=0;
    for (var i=0;i<d.length;i+=4){
        var r=d[i], g=d[i+1], b=d[i+2];
        if (r<minR) minR=r; if (r>maxR) maxR=r;
        if (g<minG) minG=g; if (g>maxG) maxG=g;
        if (b<minB) minB=b; if (b>maxB) maxB=b;
    }
    var sr = 255 / Math.max(1, (maxR - minR));
    var sg = 255 / Math.max(1, (maxG - minG));
    var sb = 255 / Math.max(1, (maxB - minB));
    for (var j=0;j<d.length;j+=4){
        var r=(d[j]-minR)*sr;   d[j]  = r<0?0:r>255?255:r|0;
        var g=(d[j+1]-minG)*sg; d[j+1]= g<0?0:g>255?255:g|0;
        var b=(d[j+2]-minB)*sb; d[j+2]= b<0?0:b>255?255:b|0;
    }
    ctx.putImageData(img,0,0);
}

// reloadImages is a slow process when multiple images are involved. Only used when rotating/mirroring
function reloadImages() {
    for (var i = 0; i < imageFiles.length; i++) {
        if (!imageFiles[i]) continue; // Skip not-yet-loaded placeholders
        if (imageFiles[i].dataURI) {
            setImage(imageFiles[i].dataURI, $(".mainImage")[i]);
        } else if (archiveEntries && archiveEntries[i]) {
            // Re-decompress on demand, then draw (setImage will revoke after render)
            (function(idx){
                archiveEntries[idx].readData(function(d){
                    try {
                        var tmp = new kthoom.ImageFile({ filename: imageFilenames[idx], fileData: d });
                        imageFiles[idx].dataURI = tmp.dataURI;
                        setImage(imageFiles[idx].dataURI, $(".mainImage")[idx], function(){ /* revoked inside setImage callback path */});
                    } catch(e) { console.error('Failed to reload image', e); }
                });
            })(i);
        }
    }
}

function showLeftPage() {
    if (settings.direction === 0) {
        showPrevPage();
    } else {
        showNextPage();
    }
}

function showRightPage() {
    if (settings.direction === 0) {
        showNextPage();
    } else {
        showPrevPage();
    }
}

function showPrevPage() {
    currentImage--;
    if (currentImage < 0) {
        // Freeze on the current page.
        currentImage++;
    } else {
        updatePage();
    }
}

function showNextPage() {
    currentImage++;
    if (currentImage >= totalImages) {
        // Freeze on the current page.
        currentImage--;
        // Close window at the end of the book
        if(settings.autoClose){
            window.close();
        }
    } else {
        updatePage();
    }
}

function scrollCurrentImageIntoView() {
    if(settings.pageDisplay == 0) {
        // This will scroll all the way up when Single Page is selected
		$("#mainContent").scrollTop(0);
    } else {
        // This will scroll to the image when Long Strip is selected
        $("#mainContent").stop().animate({
            scrollTop: $(".mainImage").eq(currentImage).offset().top + $("#mainContent").scrollTop() - $("#mainContent").offset().top
        }, 200);
    }
}

function updateScale() {
    var canvasArray = $("#mainContent > canvas");
    var maxheight = innerHeight - 50;

    canvasArray.css("width", "");
    canvasArray.css("height", "");
    canvasArray.css("maxWidth", "");
    canvasArray.css("maxHeight", "");

    if(settings.pageDisplay === 0) {
        canvasArray.addClass("hide");
        pageDisplayUpdate();
    }

    switch (settings.fitMode) {
        case kthoom.Key.B:
            canvasArray.css("maxWidth", "100%");
            canvasArray.css("maxHeight", maxheight + "px");
            break;
        case kthoom.Key.H:
            canvasArray.css("maxHeight", maxheight + "px");
            break;
        case kthoom.Key.W:
            canvasArray.css("width", "100%");
            break;
        default:
            break;
    }

    $("#mainContent > canvas.error").css("width", innerWidth - 100);
    $("#mainContent > canvas.error").css("height", 200);

    $("#mainContent").css({maxHeight: maxheight + 5});
    kthoom.setSettings();
    kthoom.saveSettings();
}

function keyHandler(evt) {
    var hasModifier = evt.ctrlKey || evt.shiftKey || evt.metaKey;
    switch (evt.keyCode) {
        case kthoom.Key.LEFT:
            if (hasModifier) break;
            showLeftPage();
            break;
        case kthoom.Key.RIGHT:
            if (hasModifier) break;
            showRightPage();
            break;
        case kthoom.Key.S:
            if (hasModifier) break;
            settings.pageDisplay = 0;
            pageDisplayUpdate();
            kthoom.setSettings();
            kthoom.saveSettings();
            break;
        case kthoom.Key.O:
            if (hasModifier) break;
            settings.pageDisplay = 1;
            pageDisplayUpdate();
            kthoom.setSettings();
            kthoom.saveSettings();
            break;
        case kthoom.Key.L:
            if (hasModifier) break;
            settings.rotateTimes--;
            if (settings.rotateTimes < 0) {
                settings.rotateTimes = 3;
            }
            updatePage();
			reloadImages();
            break;
        case kthoom.Key.R:
            if (hasModifier) break;
            settings.rotateTimes++;
            if (settings.rotateTimes > 3) {
                settings.rotateTimes = 0;
            }
            updatePage();
			reloadImages();
            break;
        case kthoom.Key.F:
            if (hasModifier) break;
            if (!settings.hflip && !settings.vflip) {
                settings.hflip = true;
            } else if (settings.hflip === true && settings.vflip === true) {
                settings.vflip = false;
                settings.hflip = false;
            } else if (settings.hflip === true) {
                settings.vflip = true;
                settings.hflip = false;
            } else if (settings.vflip === true) {
                settings.hflip = true;
            }
            updatePage();
			reloadImages();
            break;
        case kthoom.Key.W:
            if (hasModifier) break;
            settings.fitMode = kthoom.Key.W;
            updateScale();
            break;
        case kthoom.Key.H:
            if (hasModifier) break;
            settings.fitMode = kthoom.Key.H;
            updateScale();
            break;
        case kthoom.Key.B:
            if (hasModifier) break;
            settings.fitMode = kthoom.Key.B;
            updateScale();
            break;
        case kthoom.Key.N:
            if (hasModifier) break;
            settings.fitMode = kthoom.Key.N;
            updateScale();
            break;
        case kthoom.Key.SPACE:
            if (evt.shiftKey) {
                evt.preventDefault();
                // If it's Shift + Space and the container is at the top of the page
                showPrevPage();
            } else {
                evt.preventDefault();
                // If you're at the bottom of the page and you only pressed space
                showNextPage();
            }
            break;
        default:
            //console.log('KeyCode', evt.keyCode);
            break;
    }
}

function drawCanvas(index) {
    var maxheight = innerHeight - 50;
    var canvasElement = $("<canvas></canvas>");
    var x = canvasElement[0].getContext("2d");
    canvasElement.addClass("mainImage");

    switch (settings.fitMode) {
        case kthoom.Key.B:
            canvasElement.css("maxWidth", "100%");
            canvasElement.css("maxHeight", maxheight + "px");
            break;
        case kthoom.Key.H:
            canvasElement.css("maxHeight", maxheight + "px");
            break;
        case kthoom.Key.W:
            canvasElement.css("width", "100%");
            break;
        default:
            break;
    }

    if(settings.pageDisplay === 0) {
        canvasElement.addClass("hide");
    }

    // Placeholder text. setImage will override this
    var dpr = Math.min(window.devicePixelRatio || 1, 2.0);
    canvasElement.width = Math.max(1, Math.floor((innerWidth - 100) * dpr));
    canvasElement.height = Math.max(1, Math.floor(200 * dpr));
    if (typeof x.setTransform === 'function') {
        x.setTransform(dpr, 0, 0, dpr, 0, 0);
    } else {
        x.scale(dpr, dpr);
    }
    x.fillStyle = "black";
    x.textAlign = "center";
    x.font = "24px sans-serif";
    x.strokeStyle = (settings.theme === "dark") ? "white" : "black";
    var pageNum = (typeof index === 'number') ? (index + 1) : (currentImage + 1);
    x.fillText("Loading Page #" + pageNum, innerWidth / 2, 100);

    $("#mainContent").append(canvasElement);
}

function setRead() {
      // get csrf_token
      let csrf_token = $("input[name='csrf_token']").val();
      //This sends a read status update to calibreweb.
      $.ajax(calibre.togglereadUrl, {
        method: "post",
        data: {
          csrf_token: csrf_token,
          read_status: true
        }
      }).fail(function (xhr, status, error) {
        console.error(error);
      });
}

async function init(filename) {
    var request = new XMLHttpRequest();
    // Try streaming open first for large CBZ when range + DecompressionStream are available
    try {
        if (typeof ZipStream !== 'undefined' && typeof DecompressionStream !== 'undefined') {
            // Wire network progress into load bar before decoding starts
            let netFetched = 0;
            ZipStream.onProgress(function(delta, total) {
                try {
                    netFetched += (typeof delta === 'number' ? delta : 0);
                    if (total > 0) {
                        const pct = Math.min(99, Math.round((netFetched / total) * 100));
                        updateProgress(pct, 'Streaming…');
                        // crude bandwidth-based adaptive prefetch: bytes/sec over last tick
                        // here we just use average so far
                        var secs = (performance.now() - startTimeMs) / 1000;
                        if (secs > 0.5) {
                            var bps = netFetched / secs;
                            // map bandwidth to prefetch window (capped by user setting later)
                            // <1 Mbps -> 1, <5 Mbps -> 2, <20 Mbps -> 3, else 5
                            var mbps = bps / (1024*1024);
                            if (mbps < 1) adaptivePrefetch = 1;
                            else if (mbps < 5) adaptivePrefetch = 2;
                            else if (mbps < 20) adaptivePrefetch = 3;
                            else adaptivePrefetch = 5;
                        }
                    }
                } catch(_) {}
            });
            const startTimeMs = performance.now();
            const streamed = await ZipStream.open(filename);
            if (streamed && streamed.entries && streamed.entries.length) {
                // Initialize settings and UI first
                kthoom.loadSettings();
                setTheme();
                updateScale();
                initProgressClick();
                document.body.className += /AppleWebKit/.test(navigator.userAgent) ? " webkit" : "";

                // Start with streaming entries (reuse existing pipeline)
                const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
                const entries = streamed.entries.sort((a,b) => collator.compare(a.name, b.name));
                totalImages = entries.length;

                // Prepare arrays
                imageFiles = new Array(totalImages);
                imageFilenames = new Array(totalImages);
                for (let i = 0; i < totalImages; i++) drawCanvas(i);

                // Use same queueing logic as full-download path
                (function setupQueue() {
                    let loading = false;
                    let loadedCount = 0;
                    const loadQueue = [];
                    const inQueue = new Set();
                    function getPrefetchAhead() {
                        var n = parseInt(settings.prefetch, 10);
                        if (isNaN(n) || n < 0) return 5;
                        return n;
                    }
                    function processQueue() {
                        if (loading) return;
                        const index = loadQueue.shift();
                        if (typeof index === 'undefined') return;
                        inQueue.delete(index);
                        loading = true;
                        const e = entries[index];
                        if (!$(".mainImage")[index]) drawCanvas(index);
                        e.readData(function(d) {
                            try {
                                const data = { filename: e.name, fileData: d };
                                const imgFile = new kthoom.ImageFile(data);
                                imageFiles[index] = imgFile;
                                imageFilenames[index] = e.name;
                                setImage(imgFile.dataURI, $(".mainImage")[index], function() {
                                    try {
                                        var mainCanvas = $(".mainImage")[index];
                                        if (mainCanvas) {
                                            var tw = 160;
                                            var th = Math.max(1, Math.round(mainCanvas.height * (tw / Math.max(1, mainCanvas.width))));
                                            var tcanvas = document.createElement('canvas');
                                            tcanvas.width = tw; tcanvas.height = th;
                                            var tx = tcanvas.getContext('2d');
                                            tx.drawImage(mainCanvas, 0, 0, tw, th);
                                            var thumbURL = tcanvas.toDataURL('image/jpeg', 0.7);
                                            var $thumbImg = $("#thumbnails a[data-page='" + (index + 1) + "'] img");
                                            if ($thumbImg.length) $thumbImg.attr('src', thumbURL);
                                        }
                                    } catch(thumbErr) { console.warn('Thumbnail generation failed', thumbErr); }
                                    try { if (imgFile.dataURI && imgFile.dataURI.indexOf('blob:') === 0) URL.revokeObjectURL(imgFile.dataURI); imgFile.dataURI = null; } catch(e) {}
                                });
                                // Insert thumbnail placeholder in order if not present
                                var $thumbs = $("#thumbnails");
                                var $items = $thumbs.children("li");
                                if ($items.length <= index) {
                                    $thumbs.append("<li><a data-page='" + (index + 1) + "'>" +
                                                   "<img src='' alt='thumb'/><span>" + (index + 1) + "</span></a></li>");
                                } else if (!$items.eq(index).length) {
                                    $($items[index]).before("<li><a data-page='" + (index + 1) + "'>" +
                                                           "<img src='' alt='thumb'/><span>" + (index + 1) + "</span></a></li>");
                                }
                                loadedCount++;
                        updateProgress(Math.round(loadedCount / totalImages * 100), 'Decoding…');
                                if (index === 0 && currentImage === 0) updatePage();
                            } catch (err) {
                                console.error('Failed to decode image #' + (index + 1), err);
                                setImage('error', $(".mainImage")[index]);
                            } finally {
                                loading = false;
                                setTimeout(processQueue, 0);
                            }
                        });
                    }
                    function enqueue(index, priority) {
                        if (index < 0 || index >= totalImages) return;
                        if (imageFiles[index]) return;
                        if (inQueue.has(index)) return;
                        if (priority) loadQueue.unshift(index); else loadQueue.push(index);
                        inQueue.add(index);
                        processQueue();
                    }
                    if (currentImage < 0) currentImage = 0;
                    if (currentImage >= totalImages) currentImage = totalImages - 1;
                    enqueue(currentImage, true);
                    for (let k = 1, m = getPrefetchAhead(); k <= m; k++) enqueue(currentImage + k, false);
                    const originalUpdatePage = updatePage;
                    updatePage = function() {
                        originalUpdatePage();
                        enqueue(currentImage, true);
                        for (let k = 1, m = getPrefetchAhead(); k <= m; k++) enqueue(currentImage + k, false);
                    };
                    updatePage();
                })();

                // Hook events and handlers as usual
                $(document).keydown(keyHandler);
                $(window).resize(function() { updateScale(); });
                $("#slider").click(function() {
                    $("#sidebar").toggleClass("open");
                    $("#main").toggleClass("closed");
                    $(this).toggleClass("icon-menu icon-right");
                    setTimeout(function() {
                        $("#main:not(.closed) #mainContent, #sidebar.open #tocView").focus();
                        scrollTocToActive();
                    }, 500);
                });
                $("#setting").click(function() { $("#settings-modal").toggleClass("md-show"); });
                $("#settings input").on("change", function() {
                    var value = this.type === "checkbox" ? this.checked : this.value;
                    value = /^\d+$/.test(value) ? parseInt(value) : value;
                    settings[this.name] = value;
                    if(["hflip", "vflip", "rotateTimes"].includes(this.name)) {
                        reloadImages();
                    } else if(this.name === "direction") {
                        return updateProgress();
                    }
                    updatePage();
                    updateScale();
                });
                $(".closer, .overlay").click(function() { $(".md-show").removeClass("md-show"); $("#mainContent").focus(); });
                $("#mainContent").focus();
                $("#mainContent").swipe({ swipeRight: function(){showLeftPage();}, swipeLeft: function(){showRightPage();} });
                return; // streamed path handled, don't use XHR
            }
        }
    } catch (e) {
        console.warn('Streaming open failed, falling back:', e);
    }

    request.open("GET", filename);
    request.responseType = "arraybuffer";
    // Show download progress when falling back to full download
    try {
        request.onprogress = function (e) {
            if (e && e.lengthComputable) {
                var pct = Math.min(99, Math.round(e.loaded / e.total * 100));
                updateProgress(pct, 'Downloading…');
            }
        };
    } catch(_) {}
    request.addEventListener("load", function() {
        if (request.status >= 200 && request.status < 300) {
            loadFromArrayBuffer(request.response);
        } else {
            console.warn(request.statusText, request.responseText);
        }
    });
    kthoom.loadSettings();
    setTheme();
    updateScale();
    request.send();
    initProgressClick();
    document.body.className += /AppleWebKit/.test(navigator.userAgent) ? " webkit" : "";

    $(document).keydown(keyHandler);

    $(window).resize(function() {
        updateScale();
    });

    // Open TOC menu
    $("#slider").click(function() {
        $("#sidebar").toggleClass("open");
        $("#main").toggleClass("closed");
        $(this).toggleClass("icon-menu icon-right");

        // We need this in a timeout because if we call it during the CSS transition, IE11 shakes the page ¯\_(ツ)_/¯
        setTimeout(function() {
            // Focus on the TOC or the main content area, depending on which is open
            $("#main:not(.closed) #mainContent, #sidebar.open #tocView").focus();
            scrollTocToActive();
        }, 500);
    });

    // Open Settings modal
    $("#setting").click(function() {
        $("#settings-modal").toggleClass("md-show");
    });

    // On Settings input change
    $("#settings input").on("change", function() {
        // Get either the checked boolean or the assigned value
        var value = this.type === "checkbox" ? this.checked : this.value;

        // If it's purely numeric, parse it to an integer
        value = /^\d+$/.test(value) ? parseInt(value) : value;

        settings[this.name] = value;

        if(["hflip", "vflip", "rotateTimes"].includes(this.name)) {
            reloadImages();
        } else if(this.name === "direction") {
            return updateProgress();
        }

        updatePage();
        updateScale();
    });

    // Close modal
    $(".closer, .overlay").click(function() {
        $(".md-show").removeClass("md-show");
		$("#mainContent").focus(); // focus back on the main container so you use up/down keys without having to click on it
    });

    // TOC thumbnail pagination
    $("#thumbnails").on("click", "a", function() {
        currentImage = $(this).data("page") - 1;
        updatePage();
    });

    // Fullscreen mode
    if (typeof screenfull !== "undefined") {
        $("#fullscreen").click(function() {
            screenfull.toggle($("#container")[0]);
			// Focus on main container so you can use up/down keys immediately after fullscreen
			$("#mainContent").focus();
        });

        if (screenfull.raw) {
            var $button = $("#fullscreen");
            document.addEventListener(screenfull.raw.fullscreenchange, function() {
                screenfull.isFullscreen
                    ? $button.addClass("icon-resize-small").removeClass("icon-resize-full")
                    : $button.addClass("icon-resize-full").removeClass("icon-resize-small");
            });
        }
    }

    // Focus the scrollable area so that keyboard scrolling work as expected
    $("#mainContent").focus();

    // Bind settings changes to live-update rendering
    $(document).on('change', '#settings input', function(){
        var name = this.name;
        var val;
        if (this.type === 'checkbox') {
            val = this.checked;
        } else if (this.type === 'number') {
            val = parseInt(this.value, 10) || 0;
        } else {
            // radio/text
            // try parse int, else keep string
            var iv = parseInt(this.value, 10);
            val = (''+iv === this.value) ? iv : this.value;
        }
        settings[name] = val;
        // Persist and refresh view depending on setting
        if (name === 'fitMode') {
            updateScale();
        } else if (name === 'pageDisplay') {
            pageDisplayUpdate();
        } else if (name === 'rotateTimes' || name === 'vflip' || name === 'hflip' || name === 'dipMode' || name === 'upscaleMode') {
            reloadImages();
        } else if (name === 'theme' || name === 'scrollbar' || name === 'direction' || name === 'arrow') {
            updatePage();
        }
        kthoom.saveSettings();
    });

    $("#mainContent").swipe( {
        swipeRight:function() {
            showLeftPage();
        },
        swipeLeft:function() {
            showRightPage();
        },
    });
    $("#mainContent").click(function(evt) {
        // Firefox does not support offsetX/Y so we have to manually calculate
        // where the user clicked in the image.
        var mainContentWidth = $("#mainContent").width();
        var mainContentHeight = $("#mainContent").height();
        var comicWidth = evt.target.clientWidth;
        var comicHeight = evt.target.clientHeight;
        var offsetX = (mainContentWidth - comicWidth) / 2;
        var offsetY = (mainContentHeight - comicHeight) / 2;
        var clickX = evt.offsetX ? evt.offsetX : (evt.clientX - offsetX);
        var clickY = evt.offsetY ? evt.offsetY : (evt.clientY - offsetY);

        // Determine if the user clicked/tapped the left side or the
        // right side of the page.
        // 1. flip left/right in single page mode
        // 2. flip up/down in long-strip page mode
        var clickedLeft = false;
        switch (settings.rotateTimes) {
            case 0:
                if(settings.pageDisplay === 0) {
                    clickedLeft = clickX < (comicWidth / 2);
                }
                else {
                    clickedLeft = clickY < (comicWidth / 2);
                }
                break;
            case 1:
                if(settings.pageDisplay === 0) {
                    clickedLeft = clickY < (comicHeight / 2);
                }
                else {
                    clickedLeft = clickX > (comicHeight / 2);
                }
                break;
            case 2:
                if(settings.pageDisplay === 0) {
                    clickedLeft = clickX > (comicWidth / 2);
                }
                else {
                    clickedLeft = clickY > (comicWidth / 2);
                }
                break;
            case 3:
                if(settings.pageDisplay === 0) {
                    clickedLeft = clickY > (comicHeight / 2);
                }
                else {
                    clickedLeft = clickX < (comicHeight / 2);
                }
                break;
        }
        if(settings.pageDisplay === 0) {
            if (clickedLeft) {
                showLeftPage();
            } else {
                showRightPage();
            }
        }
        else {
            if (clickedLeft) {
                showPrevPage();
            } else {
                showNextPage();
            }
        }
    });

    // Scrolling up/down will update current image if a new image is into view (for Long Strip Display)
    $("#mainContent").scroll(function(){
        var scroll = $("#mainContent").scrollTop();
        if(settings.pageDisplay === 0) {
            // Don't trigger the scroll for Single Page
        } else if(scroll > prevScrollPosition) {
            //Scroll Down
            if(currentImage + 1 < totalImages) {
                if(currentImageOffset(currentImage + 1) <= 1) {
                    currentImage++;
                    scrollTocToActive();
                    updateProgress();
                }
            }
        } else {
            //Scroll Up
            if(currentImage - 1 > -1 ) {
                if(currentImageOffset(currentImage - 1) >= 0) {
                    currentImage--;
                    scrollTocToActive();
                    updateProgress();
                }
            }
        }

        // Update scroll position
        prevScrollPosition = scroll;
    });
}

function currentImageOffset(imageIndex) {
    return $(".mainImage").eq(imageIndex).offset().top - $("#mainContent").position().top
}
