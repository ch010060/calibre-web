/* This file is part of the Calibre-Web (https://github.com/janeczku/calibre-web)
 *    Copyright (C) 2018 jkrehm
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

/* global _ */

$(function() {
    $("#have_read_form").ajaxForm();
});

$("#have_read_cb").on("change", function() {
    $.ajax({
        url: this.closest("form").action,
        method:"post",
        data: $(this).closest("form").serialize(),
        error: function(response) {
            var data = [{type:"danger", message:response.responseText}]
            // $("#flash_success").parent().remove();
            $("#flash_danger").remove();
            $(".row-fluid.text-center").remove();
            if (!jQuery.isEmptyObject(data)) {
                $("#have_read_cb").prop("checked", !$("#have_read_cb").prop("checked"));
                if($("#bookDetailsModal").is(":visible")) {
                    data.forEach(function (item) {
                        $(".modal-header").after('<div id="flash_' + item.type +
                            '" class="text-center alert alert-' + item.type + '">' + item.message + '</div>');
                    });
                } else
                {
                    data.forEach(function (item) {
                        $(".navbar").after('<div class="row-fluid text-center" >' +
                            '<div id="flash_' + item.type + '" class="alert alert-' + item.type + '">' + item.message + '</div>' +
                            '</div>');
                    });
                }
            }
        }
    });
});

$(function() {
    $("#archived_form").ajaxForm();
});

$("#archived_cb").on("change", function() {
    $(this).closest("form").submit();
});

(function() {
    var templates = {
        add: _.template(
            $("#template-shelf-add").html()
        ),
        remove: _.template(
            $("#template-shelf-remove").html()
        )
    };

    $("#add-to-shelves, #remove-from-shelves").on("click", "[data-shelf-action]", function (e) {
        e.preventDefault();
        $.ajax({
                url: $(this).data('href'),
                method:"post",
                data: {csrf_token:$("input[name='csrf_token']").val()},
            })
            .done(function() {
                var $this = $(this);
                switch ($this.data("shelf-action")) {
                    case "add":
                        $("#remove-from-shelves").append(
                            templates.remove({
                                add: $this.data('href'),
                                remove: $this.data("remove-href"),
                                content: $("<div>").text(this.textContent).html()
                            })
                        );
                        break;
                    case "remove":
                        $("#add-to-shelves").append(
                            templates.add({
                                add: $this.data("add-href"),
                                remove: $this.data('href'),
                                content: $("<div>").text(this.textContent).html(),
                            })
                        );
                        break;
                }
                this.parentNode.removeChild(this);
            }.bind(this))
            .fail(function(xhr) {
                var $msg = $("<span/>", { "class": "text-danger"}).text(xhr.responseText);
                $("#shelf-action-status").html($msg);

                setTimeout(function() {
                    $msg.remove();
                }, 10000);
            });
    });
})();

// Hover Zoom for detail cover: show original cover near cursor on hover
(function(){
    var cover = document.getElementById('detailcover');
    if (!cover) return;

    var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    var win = null, img = null;
    var src = cover.getAttribute('src');
    var offset = 16; // px from cursor

    function ensureWindow(){
        if (win) return win;
        win = document.createElement('div');
        win.className = 'hover-zoom-window';
        img = document.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        img.src = src;
        win.appendChild(img);
        document.body.appendChild(win);
        return win;
    }

    function clamp(val, min, max){ return Math.max(min, Math.min(max, val)); }

    function computeSize(){
        var vw = window.innerWidth || document.documentElement.clientWidth || 1024;
        var vh = window.innerHeight || document.documentElement.clientHeight || 768;
        var naturalW = (img && img.naturalWidth) || 600;
        var naturalH = (img && img.naturalHeight) || 900;
        var maxW = Math.floor(vw * 0.6);
        var maxH = Math.floor(vh * 0.9);
        var scale = Math.min(1, maxW / naturalW, maxH / naturalH);
        return { w: Math.floor(naturalW * scale), h: Math.floor(naturalH * scale), vw: vw, vh: vh };
    }

    function positionAt(px, py){
        if (!win || !img) return;
        var s = computeSize();
        var w = s.w, h = s.h, vw = s.vw, vh = s.vh;
        var left = px + offset;
        var top = py + offset;
        if (left + w + offset > vw) left = px - offset - w;
        left = clamp(left, 8, vw - w - 8);
        top = clamp(top, 8, vh - h - 8);
        win.style.left = left + 'px';
        win.style.top = top + 'px';
        win.style.width = w + 'px';
        win.style.height = h + 'px';
        img.style.width = '100%';
        img.style.height = '100%';
    }

    function positionNearCover(){
        if (!win || !img) return;
        var s = computeSize();
        var w = s.w, h = s.h, vw = s.vw, vh = s.vh;
        var r = cover.getBoundingClientRect();
        var preferRight = (r.right + offset + w + 8) <= vw;
        var left = preferRight ? (r.right + offset) : (r.left - offset - w);
        var top = r.top; // align to top of cover
        left = clamp(left, 8, vw - w - 8);
        top = clamp(top, 8, vh - h - 8);
        win.style.left = left + 'px';
        win.style.top = top + 'px';
        win.style.width = w + 'px';
        win.style.height = h + 'px';
        img.style.width = '100%';
        img.style.height = '100%';
    }

    function showAtPointer(e){ ensureWindow(); win.classList.add('visible'); positionAt(e.clientX, e.clientY); }
    function move(e){ if (!win) return; positionAt(e.clientX, e.clientY); }
    function showNearCover(){ ensureWindow(); win.classList.add('visible'); positionNearCover(); }
    function hide(){ if (win) win.classList.remove('visible'); }

    if (!isTouch) {
        cover.addEventListener('mouseenter', showAtPointer);
        cover.addEventListener('mousemove', move);
        cover.addEventListener('mouseleave', hide);
        cover.addEventListener('click', function(e){
            // Also show on click for non-touch; don't block fullscreen
            showAtPointer(e);
        });
    } else {
        // Touch devices: tap to toggle zoom window instead of fullscreen
        // Use capture to prevent the fullscreen.js click handler
        cover.addEventListener('click', function(e){
            e.preventDefault();
            e.stopPropagation();
            if (win && win.classList.contains('visible')) {
                hide();
            } else {
                showNearCover();
            }
        }, true);
        // Hide when tapping outside
        document.addEventListener('click', function(e){
            if (!win || !win.classList.contains('visible')) return;
            if (cover.contains(e.target)) return;
            hide();
        }, true);
    }

    window.addEventListener('scroll', hide, { passive: true });
    window.addEventListener('resize', hide);
})();

// Intercept "Read in Browser" links and open reader in an overlay iframe,
// requesting fullscreen within the same user gesture to satisfy browser policies.
(function(){
    function isModifiedClick(e){
        return e.which === 2 || e.button === 1 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
    }
    function isReadHref(href){
        try { return typeof href === 'string' && href.indexOf('/read/') === 0 || href.indexOf(window.location.origin + '/read/') === 0; } catch(_){ return false; }
    }
    function requestFS(el){
        if (!el) return false;
        try {
            // Prefer requesting on the documentElement for better compatibility
            var docEl = document.documentElement;
            var reqEl = (docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.mozRequestFullScreen || docEl.msRequestFullscreen) ? docEl : el;
            var req = reqEl.requestFullscreen || reqEl.webkitRequestFullscreen || reqEl.mozRequestFullScreen || reqEl.msRequestFullscreen;
            if (typeof req === 'function') {
                try { el.setAttribute('tabindex','-1'); el.focus(); } catch(_){}
                var r = req.call(reqEl, { navigationUI: 'hide' });
                // If Promise-like, return true and let caller ignore
                return true;
            }
        } catch(_){}
        return false;
    }
    function exitFS(){
        try {
            var ex = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
            if (typeof ex === 'function') ex.call(document);
        } catch(_){}
    }
    function openReaderOverlay(url){
        var overlay = document.createElement('div');
        overlay.className = 'reader-overlay';
        var iframe = document.createElement('iframe');
        iframe.className = 'reader-frame';
        iframe.setAttribute('allowfullscreen', '');
        iframe.setAttribute('allow', 'fullscreen');
        iframe.src = url;
        var close = document.createElement('button');
        close.className = 'reader-close';
        close.setAttribute('aria-label', 'Close');
        close.textContent = '×';
        overlay.appendChild(iframe);
        overlay.appendChild(close);
        document.body.appendChild(overlay);
        // Request fullscreen immediately while still in the same user gesture
        requestFS(overlay);

        var popped = false;
        function cleanup(){
            try { exitFS(); } catch(_){}
            try { window.removeEventListener('keydown', onKey, true); } catch(_){}
            try { window.removeEventListener('popstate', onPop, true); } catch(_){}
            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }
        function closeOverlay(pushBack){
            cleanup();
            if (pushBack && !popped) {
                try { popped = true; history.back(); } catch(_){}
            }
        }
        function onKey(e){ if (e.key === 'Escape' || e.keyCode === 27) closeOverlay(true); }
        function onPop(){ closeOverlay(false); }

        window.addEventListener('keydown', onKey, true);
        try { history.pushState({ readerOverlay: true }, '', '#reader'); } catch(_){}
        window.addEventListener('popstate', onPop, true);
        close.addEventListener('click', function(e){ e.preventDefault(); closeOverlay(true); });

        // Attempt again after wiring listeners (still within the same tick)
        requestFS(overlay);
        try { iframe.focus(); } catch(_){}
    }

    function clickHandler(e){
        var a = e.currentTarget || this;
        var href = a && a.getAttribute('href');
        if (!href) return;
        // Normalize href
        try { if (href.indexOf('http') === 0) href = new URL(href).pathname + new URL(href).search; } catch(_){ }
        if (!isReadHref(href) || isModifiedClick(e) || a.getAttribute('target') === '_blank') return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        openReaderOverlay(a.href);
    }

    // Delegate clicks for both single and dropdown read links
    document.addEventListener('click', function(e){
        var t = e.target;
        if (!t) return;
        // bubble up to anchor
        while (t && t !== document && t.tagName !== 'A') t = t.parentNode;
        if (!t || t.tagName !== 'A') return;
        var href = t.getAttribute('href') || '';
        if (!href) return;
        if (isReadHref(href)) {
            clickHandler.call(t, e);
        }
    }, true);
})();
