/*
 * comics.js
 *
 * Licensed under the MIT License
 *
 * Copyright(c) 2022 oliviermaire
*/

/* 
** Inspired by kthoom.js
*/

if (window.opera) {
    window.console.log = function (str) {
        opera.postError(str);
    };
}

(function ($) {
    "use strict";

    const // key codes
        KEYS = {
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
            RIGHT_SQUARE_BRACKET: 221,
            NUM1: 49, NUM2: 50,
            F11: 122
        };

    // gets the element with the given id
    function getElem(id) {
        if (document.documentElement.querySelector) {
            // querySelector lookup
            return document.body.querySelector("#" + id);
        }
        // getElementById lookup
        return document.getElementById(id);
    }

    var ComicsReader = function (element, options) {
        this.options = options;
        this.$element = $(element);
    };

    ComicsReader.prototype = {

        constructor: function () {
            this.bookmarkUrl = "";
            this.fetchPagesUrl = "";
            this.bookInfo = {};
            this.pageInfo = [];

            if (!this.options.bookInfoUrl) {
                throw ("ComicsReader: bookInfoUrl not set in options.");
            }

            if (!this.options.settingsText) {
                this.options.settingsText = "Settings";
            }



            this.$elem = this.$element;
            // access settings with this.options...
            this.$elem.addClass(this.options.mainClassName).addClass("comics-reader-app");


            this.preferences = {
            };

            this.loadPreferences();

            if (!this.preferences.hflip)
                this.preferences.hflip = false;
            if (!this.preferences.vflip)
                this.preferences.vflip = false;
            if (!this.preferences.rotateTimes)
                this.preferences.rotateTimes = 0;
            if (!this.preferences.fitMode)
                this.preferences.fitMode = KEYS.B;
            if (!this.preferences.theme)
                this.preferences.theme = "light";
            if (!this.preferences.direction)
                this.preferences.direction = 0; // 0 = Left to Right, 1 = Right to Left
            if (!this.preferences.nextPage)
                this.preferences.nextPage = 0; // 0 = Reset to Top, 1 = Remember Position
            if (!this.preferences.scrollbar && this.preferences.scrollbar != 0)
                this.preferences.scrollbar = 1; // 0 = Hide Scrollbar, 1 = Show Scrollbar
            if (!this.preferences.pageMode)
                this.preferences.pageMode = 1;
            if (!this.preferences.preloadPageNb)
                this.preferences.preloadPageNb = 2;


            // build initial DOM
            this.initDom();

            this.savePreferences();
            this.applyScrollbarSettings();


            this.initEvents();


            // load the book

            this.loadBookInfo().then(() => {

                console.debug("book loaded, running validations.");

                if (!this.fetchPagesUrl) {
                    throw ("ComicsReader: page_url missing from downloaded info.");
                }

                this.useBookmarks = false;
                this.currentPage = 0;
                if (this.bookmarkUrl && this.options.useBookmarks == true) {
                    this.useBookmarks = true;
                    this.currentPage = parseInt(this.options.bookmark);
                }

                this.loadBook();
            });
        },
        initDom: function () {
            // create sidebar for pages list
            var div = document.createElement("div");
            $(div).addClass("pages-list");

            var aside = document.createElement("aside");
            $(aside).addClass("sidebar").addClass("closed");
            $(aside).append(div);

            this.$elem.append(aside);

            var lineProgress = document.createElement("div");
            $(lineProgress).addClass("line-progress");

            var title = document.createElement("div");
            $(title).addClass("book-title");

            var menuButton = document.createElement("div");
            $(menuButton).addClass("menu-button").addClass("icon-menu");

            var preferencesButton = document.createElement("div");
            $(preferencesButton).addClass("preferences-button").addClass("icon-cog");

            var fullscreenButton = document.createElement("div");
            $(fullscreenButton).addClass("fullscreen-button").addClass("icon-resize-full");

            var menuContent = document.createElement("div");
            $(menuContent).addClass("menu-content");
            $(menuContent).append(menuButton);
            $(menuContent).append(title);
            $(menuContent).append(preferencesButton);
            $(menuContent).append(fullscreenButton);

            var menu = document.createElement("div");
            $(menu).addClass("menu-bar");
            $(menu).append(lineProgress);
            $(menu).append(menuContent);

            var render = document.createElement("div");
            $(render).addClass("render-view");

            var left = document.createElement("div");
            $(left).addClass("arrow-left").addClass("icon-left-open");

            var right = document.createElement("div");
            $(right).addClass("arrow-right").addClass("icon-right-open");

            var pageProgress = document.createElement("div");
            $(pageProgress).addClass("page-progress");

            var pageView = document.createElement("div");
            $(pageView).addClass("page-view");
            pageView.append(render);
            pageView.append(left);
            pageView.append(right);

            var div = document.createElement("div");
            $(div).addClass("main-view");
            div.append(menu);
            div.append(pageView);
            div.append(pageProgress);

            var modal = this.preferencesDom();

            this.$elem.append(div);
            if (modal !== undefined) {
                this.$elem.append(modal);
            }


        },

        initEvents: function () {
            let self = this;
            this.$elem.find(".preferences-button").click(() =>
                self.$elem.find(".preferences-modal").addClass("md-show")
            );

            this.$elem.find(".modal .closer, .overlay").click(function () {
                self.$elem.find(".preferences-modal").removeClass("md-show");
            });

            this.$elem.find(".menu-button").click(() => {
                self.$elem.find(".sidebar").toggleClass("closed");
                self.$elem.find(".main-view").toggleClass("sidebar-opened");
            }
            );

            this.$elem.find(".arrow-left").click(() =>
                self.leftClicked()
            );
            this.$elem.find(".arrow-right").click(() =>
                self.rightClicked()
            );


            $(document).keydown(this.keyEvents.bind(this));

            this.screenfull();

            // $(window).resize(function () {
            //     updateScale(false);
            // });

        },
        keyEvents: function (event) {

            var hasModifier = event.ctrlKey || event.shiftKey || event.metaKey;
            switch (event.keyCode) {
                case KEYS.LEFT:
                    if (hasModifier) break;
                    this.leftClicked();
                    break;
                case KEYS.RIGHT:
                    if (hasModifier) break;
                    this.rightClicked();
                    break;
                case KEYS.SPACE:
                    if (event.shiftKey) {
                        event.preventDefault();
                        // If it's Shift + Space and the container is at the top of the page
                        this.gotoPrevPage();
                    } else {
                        event.preventDefault();
                        // If you're at the bottom of the page and you only pressed space
                        this.gotoNextPage();
                    }
                    break;
                case KEYS.F11:
                    if (hasModifier) break;
                    event.preventDefault();
                    this.$elem.find(".fullscreen-button").click();
                    break;
                case KEYS.B:
                    if (hasModifier) break;
                    this.preferences.fitMode = kthoom.Key.B;
                    this.savePreferences();
                    this.applyRenderScale();
                    break;
                case KEYS.W:
                    if (hasModifier) break;
                    this.preferences.fitMode = kthoom.Key.W;
                    this.savePreferences();
                    this.applyRenderScale();
                    break;
                case KEYS.H:
                    if (hasModifier) break;
                    this.preferences.fitMode = kthoom.Key.H;
                    this.savePreferences();
                    this.applyRenderScale();
                    break;
                case KEYS.N:
                    if (hasModifier) break;
                    this.preferences.fitMode = kthoom.Key.N;
                    this.savePreferences();
                    this.applyRenderScale();
                    break;
                case KEYS.L:
                    if (hasModifier) break;
                    this.preferences.rotateTimes--;
                    if (this.preferences.rotateTimes < 0) this.preferences.rotateTimes = 3;
                    this.savePreferences();
                    this.renderPage();
                    break;
                case KEYS.R:
                    if (hasModifier) break;
                    this.preferences.rotateTimes++;
                    if (this.preferences.rotateTimes > 3) this.preferences.rotateTimes = 0;
                    this.savePreferences();
                    this.renderPage();
                    break;
                case KEYS.F:
                    if (hasModifier) break;
                    if (!this.preferences.hflip && !this.preferences.vflip) {
                        this.preferences.hflip = true;
                    } else if (this.preferences.hflip === true && this.preferences.vflip === true) {
                        this.preferences.vflip = false;
                        this.preferences.hflip = false;
                    } else if (this.preferences.hflip === true) {
                        this.preferences.vflip = true;
                        this.preferences.hflip = false;
                    } else if (this.preferences.vflip === true) {
                        this.preferences.hflip = true;
                    }
                    this.savePreferences();
                    this.renderPage();
                    break;
                case KEYS.D:
                    if (hasModifier) break;
                    this.preferences.direction++;
                    if (this.preferences.direction > 1) this.preferences.direction = 0;
                    this.savePreferences();
                    break;
                case KEYS.NUM1:
                    if (hasModifier) break;
                    this.preferences.pageMode = 1;
                    this.savePreferences();
                    this.renderPage();
                    break;
                case KEYS.NUM2:
                    if (hasModifier) break;
                    this.preferences.pageMode = 2;
                    this.savePreferences();
                    this.renderPage();
                    break;
                default:
                    //console.log('KeyCode', evt.keyCode);
                    break;
            }
        },
        loadBookInfo: function () {

            return new Promise((resolve, reject) => {
                // get book info and metadata
                fetch(this.options.bookInfoUrl)
                    .then((response) => response.json())
                    .then((result) => {
                        console.log('Success:', result);
                        this.bookmarkUrl = result.bookmark_url;
                        this.fetchPagesUrl = result.page_url;
                        this.bookInfo = {
                            id: result.id,
                            title: result.title,
                            page_count: result.page_count,
                            format: result.format,
                            uncompressed_size: result.uncompressed_size,
                            publishers: result.publisher_list,
                            has_cover: result.has_cover,
                            description: result.description,
                            authors: result.author_list
                        };

                        console.log(this.bookInfo);
                        resolve();
                    })
                    .catch((error) => {
                        console.error('Error:', error);
                        reject;
                    });
            });
        },
        loadBook: async function () {
            // set title
            this.$elem.find(".book-title").text(this.bookInfo.title);

            // load some pages
            await this.loadPageRange();

            // display the current page
            this.renderPage();

        },
        renderPage: function () {

            if (this.preferences.nextPage === 0) {
                $(document).scrollTop(0);
                $(".render-view").scrollTop(0);
            } else {
                this.lastScrollPosition = $(document).scrollTop();
            }
            // render the page/pages based on the render mode
            if (this.preferences.pageMode == 1) {
                this.renderSinglePage();
            }
            else if (this.preferences.pageMode == 2) {
                if (this.pageInfo[this.currentPage].isDoublePage ||
                    this.pageInfo[this.currentPage + 1].isDoublePage) {
                    this.renderSinglePage();
                }
                else {
                    this.renderDoublePage();
                }
            }


        },
        renderSinglePage: function () {
            var canvas = document.createElement('canvas');
            var context = canvas.getContext("2d");
            let preferences = this.preferences;
            let pageInfo = this.pageInfo[this.currentPage];
            let renderView = this.$elem.find(".render-view");
            let lastScrollPosition = this.preferences.nextPage !== 0 ? this.lastScrollPosition : undefined;
            let self = this;
            return new Promise((resolve, reject) => {

                var img = new Image();
                // img.onerror = function (){

                // };
                img.onload = function () {
                    var h = img.height,
                        w = img.width,
                        sw = w,
                        sh = h;

                    // handle rotation
                    context.save();
                    if (preferences.rotateTimes % 2 === 1) {
                        sh = w;
                        sw = h;
                    }
                    canvas.height = sh;
                    canvas.width = sw;
                    context.translate(sw / 2, sh / 2);
                    context.rotate(Math.PI / 2 * preferences.rotateTimes);
                    context.translate(-w / 2, -h / 2);

                    // handle flips
                    if (preferences.vflip) {
                        context.scale(1, -1);
                        context.translate(0, -h);
                    }
                    if (preferences.hflip) {
                        context.scale(-1, 1);
                        context.translate(-w, 0);
                    }

                    // canvas.style.display = "none";
                    // scrollTo(0, 0);
                    context.drawImage(img, 0, 0);

                    // if (!currentPageIsDoublePage && settings.pageMode == 2) {
                    //     // draw shadow
                    //     x.shadowBlur = 80;
                    //     x.shadowColor = "#000000AA";
                    //     x.fillRect(canvas.width, -50, 50, canvas.height + 100);
                    // }


                    // var blockSize = 1, // only visit every 5 pixels
                    //     defaultRGB = { r: 255, g: 255, b: 255 }, // for non-supporting envs
                    //     data,
                    //     i = -4,
                    //     length,
                    //     rgb = { r: 0, g: 0, b: 0 },
                    //     count = 0;

                    // var borderColor = defaultRGB;

                    // try {
                    //     pixeldata = x.getImageData(0, 0, 10, 10);
                    //     length = pixeldata.data.length;
                    //     while ((i += blockSize * 4) < length) {
                    //         ++count;
                    //         rgb.r += pixeldata.data[i];
                    //         rgb.g += pixeldata.data[i + 1];
                    //         rgb.b += pixeldata.data[i + 2];
                    //     }

                    //     // ~~ used to floor values
                    //     rgb.r = ~~(rgb.r / count);
                    //     rgb.g = ~~(rgb.g / count);
                    //     rgb.b = ~~(rgb.b / count);

                    //     borderColor = rgb;

                    // } catch (e) {
                    //     /* security error, img on diff domain *///alert('x');
                    //     // return defaultRGB;
                    // }


                    //apply scaling
                    //   updateScale(false);

                    // canvas.style.display = "";
                    //$("body").css("overflowY", "");

                    // $("#image-left").css("background-color", "rgb(" + borderColor.r + ", " + borderColor.g + ", " + borderColor.b + ")");


                    renderView.html("");
                    renderView.append(canvas);

                    if (lastScrollPosition !== undefined) {
                        $(document).scrollTop(lastScrollPosition);
                    }

                    self.applyRenderScale();
                    context.restore();
                    resolve();

                }

                img.src = this.pageInfo[this.currentPage].blobUrl;

            });
            // scroll top
            if ($("body").css("scrollHeight") / innerHeight > 1) {
                $("body").css("overflowY", "scroll");
            }


            // page 1
            var canvas = $("#mainImage")[0];
            var x = $("#mainImage")[0].getContext("2d");
            $("#mainText").hide();

            if (currentImage === "loading") {
                updateScale(true);
                canvas.width = innerWidth / 2 - 100;
                canvas.height = 200;
                x.fillStyle = "black";
                x.textAlign = "center";
                x.font = "24px sans-serif";
                x.strokeStyle = "black";
                x.fillText("Loading Page #" + (currentImage + 1), canvas.width / 2, 100);
            } else {
                if (currentImage === "error") {
                    updateScale(true);
                    canvas.width = innerWidth / 2 - 100;
                    canvas.height = 200;
                    x.fillStyle = "black";
                    x.textAlign = "center";
                    x.font = "24px sans-serif";
                    x.strokeStyle = "black";
                    x.fillText("Unable to decompress image #" + (currentImage + 1), canvas.width / 2, 100);
                } else {
                    // scroll top
                    if ($("body").css("scrollHeight") / innerHeight > 1) {
                        $("body").css("overflowY", "scroll");
                    }

                    var img = new Image();
                    var url = imageFiles[currentImage].dataURI
                    img.onerror = function () {
                        canvas.width = innerWidth / 2 - 100;
                        canvas.height = 300;
                        updateScale(true);
                        x.fillStyle = "black";
                        x.font = "50px sans-serif";
                        x.strokeStyle = "black";
                        x.fillText("Page #" + (currentImage + 1) + " (" +
                            imageFiles[currentImage].filename + ")", canvas.width / 2, 100);
                        x.fillStyle = "black";
                        x.fillText("Is corrupt or not an image", canvas.width / 2, 200);

                        var xhr = new XMLHttpRequest();
                        if (/(html|htm)$/.test(imageFiles[currentImage].filename)) {
                            xhr.open("GET", url, true);
                            xhr.onload = function () {
                                $("#mainText").css("display", "");
                                $("#mainText").innerHTML("<iframe style=\"width:100%;height:700px;border:0\" src=\"data:text/html," + escape(xhr.responseText) + "\"></iframe>");
                            };
                            xhr.send(null);
                        } else if (!/(jpg|jpeg|png|gif|webp)$/.test(imageFiles[currentImage].filename) && imageFiles[currentImage].data.uncompressedSize < 10 * 1024) {
                            xhr.open("GET", url, true);
                            xhr.onload = function () {
                                $("#mainText").css("display", "");
                                $("#mainText").innerText(xhr.responseText);
                            };
                            xhr.send(null);
                        }
                        reject;
                        return;
                    };

                    img.onload = function () {
                        var h = img.height,
                            w = img.width,
                            sw = w,
                            sh = h;
                        settings.rotateTimes = (4 + settings.rotateTimes) % 4;
                        x.save();
                        if (settings.rotateTimes % 2 === 1) {
                            sh = w;
                            sw = h;
                        }

                        if (doublePages[currentImage] === undefined) {
                            currentPageIsDoublePage = isDoublePage(h, w);
                            doublePages[currentImage] = currentPageIsDoublePage;
                        }
                        else
                            currentPageIsDoublePage = doublePages[currentImage];

                        canvas.height = sh;
                        canvas.width = sw;
                        x.translate(sw / 2, sh / 2);
                        x.rotate(Math.PI / 2 * settings.rotateTimes);
                        x.translate(-w / 2, -h / 2);
                        if (settings.vflip) {
                            x.scale(1, -1);
                            x.translate(0, -h);
                        }
                        if (settings.hflip) {
                            x.scale(-1, 1);
                            x.translate(-w, 0);
                        }
                        canvas.style.display = "none";
                        scrollTo(0, 0);
                        x.drawImage(img, 0, 0);

                        if (!currentPageIsDoublePage && settings.pageMode == 2) {
                            // draw shadow
                            x.shadowBlur = 80;
                            x.shadowColor = "#000000AA";
                            x.fillRect(canvas.width, -50, 50, canvas.height + 100);
                        }


                        var blockSize = 1, // only visit every 5 pixels
                            defaultRGB = { r: 255, g: 255, b: 255 }, // for non-supporting envs
                            data,
                            i = -4,
                            length,
                            rgb = { r: 0, g: 0, b: 0 },
                            count = 0;

                        var borderColor = defaultRGB;

                        try {
                            pixeldata = x.getImageData(0, 0, 10, 10);
                            length = pixeldata.data.length;
                            while ((i += blockSize * 4) < length) {
                                ++count;
                                rgb.r += pixeldata.data[i];
                                rgb.g += pixeldata.data[i + 1];
                                rgb.b += pixeldata.data[i + 2];
                            }

                            // ~~ used to floor values
                            rgb.r = ~~(rgb.r / count);
                            rgb.g = ~~(rgb.g / count);
                            rgb.b = ~~(rgb.b / count);

                            borderColor = rgb;

                        } catch (e) {
                            /* security error, img on diff domain *///alert('x');
                            // return defaultRGB;
                        }

                        updateScale(false);

                        canvas.style.display = "";
                        $("body").css("overflowY", "");

                        $("#image-left").css("background-color", "rgb(" + borderColor.r + ", " + borderColor.g + ", " + borderColor.b + ")");


                        x.restore();
                        resolve();
                    };
                    img.src = url;
                }
            }
        },
        renderDoublePage: function () {
            let preferences = this.preferences;
            let pageInfo = this.pageInfo[this.currentPage];
            let renderView = this.$elem.find(".render-view");
            let lastScrollPosition = this.preferences.nextPage !== 0 ? this.lastScrollPosition : undefined;
            let self = this;
            return new Promise(async (resolve, reject) => {

                var canvas = await this.renderPageCanvas(this.currentPage);
                renderView.html("");
                renderView.append(canvas);

                if (lastScrollPosition !== undefined) {
                    $(document).scrollTop(lastScrollPosition);
                }
                self.applyRenderScale();
                resolve();
            });


        },
        renderPageCanvas: function (pageIndex) {
            var canvas = document.createElement('canvas');
            var context = canvas.getContext("2d");
            let preferences = this.preferences;
            let pageInfo = this.pageInfo[pageIndex];
            let renderView = this.$elem.find(".render-view");
            let lastScrollPosition = this.preferences.nextPage !== 0 ? this.lastScrollPosition : undefined;
            let self = this;
            return new Promise((resolve, reject) => {

                var img = new Image();
                // img.onerror = function (){

                // };
                img.onload = function () {

                    var h = img.height,
                        w = img.width,
                        sw = w,
                        sh = h;

                    // handle rotation
                    context.save();
                    if (preferences.rotateTimes % 2 === 1) {
                        sh = w;
                        sw = h;
                    }
                    canvas.height = sh;
                    canvas.width = sw;
                    context.translate(sw / 2, sh / 2);
                    context.rotate(Math.PI / 2 * preferences.rotateTimes);
                    context.translate(-w / 2, -h / 2);

                    // handle flips
                    if (preferences.vflip) {
                        context.scale(1, -1);
                        context.translate(0, -h);
                    }
                    if (preferences.hflip) {
                        context.scale(-1, 1);
                        context.translate(-w, 0);
                    }

                    // canvas.style.display = "none";
                    // scrollTo(0, 0);
                    context.drawImage(img, 0, 0);
                    context.restore();
                    resolve(canvas);

                }

                img.src = this.pageInfo[pageIndex].blobUrl;

            });
        },


        applyRenderScale: function () {
            var $canvas = this.$elem.find(".render-view canvas");
            $canvas.removeClass("fit-best");
            $canvas.removeClass("fit-width");
            $canvas.removeClass("fit-height");
            $canvas.removeClass("fit-natural");
            switch (this.preferences.fitMode) {
                case KEYS.B: // Best Mode
                    $canvas.addClass("fit-best");
                    break;
                case KEYS.W:
                    $canvas.addClass("fit-width");
                    break;
                case KEYS.H:
                    $canvas.addClass("fit-height");
                    break;
                case KEYS.N:
                    $canvas.addClass("fit-natural");
                    break;
                default:
                    break;
            }
        },
        loadPageRange: async function () {
            if (this.pageInfo[this.currentPage] === undefined) {
                await this.loadPage(this.currentPage);
            }
            var pageOffset = this.preferences.pageMode == 2 ? 1 : 0;
            for (let i = 1; i <= this.preferences.preloadPageNb + pageOffset; i++) {
                if (this.currentPage + i <= Math.max(this.bookInfo.page_count, this.pageInfo.length) && this.pageInfo[this.currentPage + i] === undefined) {
                    if (pageOffset > 0) {
                        await this.loadPage(this.currentPage + i);
                    }
                    else {
                        this.loadPage(this.currentPage + i); // do not await, run async
                    }
                }
            }
            for (let i = 1; i <= this.preferences.preloadPageNb; i++) {
                if (this.currentPage - i >= 0 && this.pageInfo[this.currentPage - i] === undefined) {
                    this.loadPage(this.currentPage - i); // do not await, run async
                }
            }

        },
        loadPage: async function (index) {
            let filename = this.fetchPagesUrl + index;
            var response = await fetch(filename);
            if (response.ok) {
                var ar = await response.arrayBuffer();
                var mimetype = response.headers.get("content-type");

                this.pageInfo[index] = {
                    id: index,
                    url: filename,
                    filetype: mimetype,
                    blobUrl: this.createBlob(ar, mimetype),
                    height: 0,
                    width: 0,
                    isDoublePage: false
                }

                await this.getImageInfo(this.pageInfo[index]);

                this.updatePagesList();


            } else {
                console.warn(request.statusText, request.responseText);
            }
        },
        getImageInfo: function (pageInfo) {
            return new Promise((resolve, reject) => {

                let rotateTimes = this.preferences.rotateTimes;
                var img = new Image();
                img.onerror = () => reject;

                img.onload = function () {
                    pageInfo.height = img.height;
                    pageInfo.width = img.width;
                    pageInfo.isDoublePage = false;

                    if (rotateTimes == 0 || rotateTimes == 2) {
                        if (pageInfo.width > pageInfo.height) {
                            pageInfo.isDoublePage = true;
                        }
                    } else if (rotateTimes == 1 || rotateTimes == 3) {
                        if (pageInfo.height > pageInfo.width) {
                            pageInfo.isDoublePage = true;
                        }
                    }
                    resolve();
                };

                img.src = pageInfo.blobUrl;

            });
        },
        createBlob: function (arrayBuffer, mimeType) {
            var offset = 0; // arrayBuffer.byteOffset;
            var len = arrayBuffer.byteLength;
            var blob;

            if (mimeType === "image/xml+svg") {
                var xmlStr = new TextDecoder("utf-8").decode(arrayBuffer);
                return "data:image/svg+xml;UTF-8," + encodeURIComponent(xmlStr);
            }

            // Blob constructor, see http://dev.w3.org/2006/webapi/FileAPI/#dfn-Blob.
            if (typeof Blob === "function") {
                blob = new Blob([arrayBuffer], { type: mimeType });
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
        },
        updatePagesList: function () {
            var pageList = this.$elem.find(".pages-list");
            pageList.html("");
            this.pageInfo.forEach(element => {
                pageList.append(
                    '<section class="page-thumbnail">' +
                    `<a data-page-nb="${element.id}">` +
                    `<img src="${element.blobUrl}" alt="page ${element.id}" />` +
                    `<span>${element.id}</span>` +
                    '</section>'
                );
            });
        },
        savePreferences: function () {
            localStorage.comicsReaderPreferences = JSON.stringify(this.preferences);
            this.applyPreferencesDom();
        },
        loadPreferences: function () {
            try {
                if (!localStorage.comicsReaderPreferences) {
                    return;
                }

                $.extend(this.preferences, JSON.parse(localStorage.comicsReaderPreferences));

            } catch (err) {
                console.log(`Error loading preferences ${err}`);
                alert("Error loading preferences");
            }
        },
        applyPreferencesDom: function () {
            // Set preferences control values
            let $elem = this.$elem;
            $.each(this.preferences, function (key, value) {
                if (typeof value === "boolean") {
                    $elem.find(".preferences-modal input[name=" + key + "]").prop("checked", value);
                } else {
                    $elem.find(".preferences-modal input[name=" + key + "]").val([value]);
                }
            });
        },
        readPreferencesDom: function (self, event) {
            var elem = event.currentTarget;
            // Get either the checked boolean or the assigned value
            var value = elem.type === "checkbox" ? elem.checked : elem.value;
            // If it's purely numeric, parse it to an integer
            value = /^\d+$/.test(value) ? parseInt(value) : value;
            self.preferences[elem.name] = value;

            self.savePreferences();
            self.applyScrollbarSettings();
            self.applyRenderScale();
            self.renderPage();
        },
        applyScrollbarSettings: function () {
            if (this.preferences.scrollbar === 0) {
                $("body").addClass("disabled-scrollbar");
                $("render-view").addClass("disabled-scrollbar");
            }
            else {
                $("body").removeClass("disabled-scrollbar");
                $("render-view").removeClass("disabled-scrollbar");

            }
        },
        leftClicked: function () {
            if (this.preferences.direction === 0) {
                this.gotoPrevPage();
            } else {
                this.gotoNextPage();
            }
        },
        rightClicked: function () {
            if (this.preferences.direction === 0) {
                this.gotoNextPage();
            } else {
                this.gotoPrevPage();
            }
        },
        gotoPrevPage: function () {
            if (this.preferences.pageMode == 1) {
                this.currentPage--;
            }
            else if (this.preferences.pageMode == 2) {
                if (this.pageInfo[this.currentPage - 1].isDoublePage ||
                    this.pageInfo[this.currentPage - 2].isDoublePage) {
                    this.currentPage--;
                }
                else {
                    this.currentPage -= 2;

                }
            }

            if (this.currentPage < 0) {
                this.currentPage = 0;
            }

            this.loadPageRange();
            this.renderPage();
        },
        gotoNextPage: function () {
            if (this.preferences.pageMode == 1) {
                this.currentPage++;
            }
            else if (this.preferences.pageMode == 2) {
                if (this.pageInfo[this.currentPage + 1].isDoublePage ||
                    this.pageInfo[this.currentPage + 2].isDoublePage) {
                    this.currentPage++;
                }
                else {
                    this.currentPage += 2;

                }
            }

            if (this.currentPage >= Math.max(this.bookInfo.page_count, this.pageInfo.length)) {
                this.currentPage = Math.max(this.bookInfo.page_count, this.pageInfo.length) - 1;
            }

            this.loadPageRange();
            this.renderPage();
        },
        // Preference Modal
        preferencesDom: function () {

            if ($("template#preferences-modal").length == 1) {
                var modal = $("template#preferences-modal").html();
                modal = $(modal);
                modal[0] = $(modal[0]).addClass("preferences-modal")[0];
                $(modal[0]).find("input").change((event) => this.readPreferencesDom(this, event));

                return modal;
            }

            return undefined;
        },
        screenfull: function () {
            // Fullscreen mode
            if (typeof screenfull !== "undefined") {
                let self = this;
                this.$elem.find(".fullscreen-button").click(() => {
                    screenfull.toggle(self.$elem.find(".main-view")[0]);
                });
                if (screenfull.raw) {
                    document.addEventListener(screenfull.raw.fullscreenchange, function () {
                        screenfull.isFullscreen
                            ? self.$elem.find(".main-view").addClass("fullscreen")
                            : self.$elem.find(".main-view").removeClass("fullscreen");
                    });
                }
            }
        },
        reset: function () {
            this.$modalTitle.text(this.options.modalTitle);
            this.$modalFooter.hide();
            this.$modalBar.addClass("progress-bar-success");
            this.$modalBar.removeClass("progress-bar-danger");
            if (this.xhr) {
                this.xhr.abort();
            }
        }
    };


    $.fn.comicsreader = function (options) {
        return this.each(function () {
            var _options = $.extend({}, $.fn.comicsreader.defaults, options);
            var comicsReader = new ComicsReader(this, _options);
            comicsReader.constructor();
        });
    };

    $.fn.comicsreader.defaults = {
        bookInfoUrl: "",
        bookmark: 0,
        useBookmarks: false,

        hflip: false,
        vflip: false,
        rotateTimes: 0,
        fitMode: KEYS.B,
        theme: "light",
        direction: 0, // 0 = Left to Right, 1 = Right to Left
        nextPage: 0, // 0 = Reset to Top, 1 = Remember Position
        scrollbar: 1, // 0 = Hide Scrollbar, 1 = Show Scrollbar
        pageMode: 1
    };


})(window.jQuery);


var kthoom;
var currentPageIsDoublePage = false;

// gets the element with the given id
function getElem(id) {
    if (document.documentElement.querySelector) {
        // querySelector lookup
        return document.body.querySelector("#" + id);
    }
    // getElementById lookup
    return document.getElementById(id);
}

if (typeof window.kthoom === "undefined") {
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
    RIGHT_SQUARE_BRACKET: 221,
    NUM1: 49, NUM2: 50
};

// global variables
var unarchiver = null;
var currentImage = 0;
var imageFiles = [];
var imageFilenames = [];
var totalImages = 0;
var doublePages = [];

var settings = {
    mainClassName: "comics-reader-main",
    hflip: false,
    vflip: false,
    rotateTimes: 0,
    fitMode: kthoom.Key.B,
    theme: "light",
    direction: 0, // 0 = Left to Right, 1 = Right to Left
    nextPage: 0, // 0 = Reset to Top, 1 = Remember Position
    scrollbar: 1, // 0 = Hide Scrollbar, 1 = Show Scrollbar
    pageMode: 1

};

kthoom.saveSettings = function () {
    localStorage.kthoomSettings = JSON.stringify(settings);
};

kthoom.loadSettings = function () {
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

kthoom.setSettings = function () {
    // Set settings control values
    $.each(settings, function (key, value) {
        if (typeof value === "boolean") {
            $("input[name=" + key + "]").prop("checked", value);
        } else {
            $("input[name=" + key + "]").val([value]);
        }
    });
};

var createURLFromArray = function (array, mimeType) {
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
        blob = new Blob([array], { type: mimeType });
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
kthoom.ImageFile = function (file, mimetype) {
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
        default:
            this.mimeType = mimetype;
            break;
    }

    // Reset mime type for special files originating from Apple devices
    // This folder may contain files having image extensions (for example .jpg) but those files are not actual images
    // Trying to view these files cause corrupted/empty pages in the comic reader and files should be ignored
    if (this.filename.indexOf("__MACOSX") !== -1) {
        this.mimeType = undefined;
    }

    if (this.mimeType !== undefined) {
        this.dataURI = createURLFromArray(file.fileData, this.mimeType);
    }
};

function initProgressClick() {
    $("#progress").click(function (e) {
        var offset = $(this).offset();
        var x = e.pageX - offset.left;
        var rate = settings.direction === 0 ? x / $(this).width() : 1 - x / $(this).width();
        currentImage = Math.max(1, Math.ceil(rate * totalImages)) - 1;
        updatePage();
    });
}

function loadPageFromArrayBuffer(d, mimetype, filename, index = 0) {
    // add any new pages based on the filename
    if (imageFilenames.indexOf(filename) === -1) {
        let data = { filename: filename, fileData: d };
        var test = new kthoom.ImageFile(data, mimetype);
        if (test.mimeType !== undefined) {
            imageFilenames[index] = filename;
            imageFiles[index] = test;
            // add thumbnails to the TOC list
            $("#thumbnails").append(
                "<li>" +
                "<a data-page='" + imageFiles.length + "'>" +
                "<img src='" + imageFiles[imageFiles.length - 1].dataURI + "'/>" +
                "<span>" + imageFiles.length + "</span>" +
                "</a>" +
                "</li>"
            );
            if (index + 1 > totalImages) {
                totalImages = index + 1;
            }
        }
    }
}


function scrollTocToActive() {
    // Scroll to the thumbnail in the TOC on page change
    $("#tocView").stop().animate({
        scrollTop: $("#tocView a.active").position()?.top
    }, 200);
}

async function updatePage() {

    // Mark the current page in the TOC
    $("#tocView a[data-page]")
        // Remove the currently active thumbnail
        .removeClass("active")
        // Find the new one
        .filter("[data-page=" + (currentImage + 1) + "]")
        // Set it to active
        .addClass("active");

    scrollTocToActive();
    updateProgress();


    if (imageFiles[currentImage]) {
        await setImage(currentImage);
    } else {
        await setImage("loading");
    }




    let pageDisplayed = settings.pageMode == 2 && !currentPageIsDoublePage ? 2 : 1;
    let textPageProgress = pageDisplayed == 1 ? (currentImage + 1) + "/" + totalImages :
        (currentImage + 1) + "-" + (currentImage + 2) + "/" + totalImages;

    $(".page").text(textPageProgress);

    $("body").toggleClass("dark-theme", settings.theme === "dark");
    $("#mainContent").toggleClass("disabled-scrollbar", settings.scrollbar === 0);

    kthoom.setSettings();
    kthoom.saveSettings();
}

function updateProgress(loadPercentage) {
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

        if (loadPercentage === 100) {
            $("#progress")
                .removeClass("loading")
                .find(".load").text("");
        }
    }
    // Set page progress bar
    $("#progress .bar-read").css({ width: totalImages === 0 ? 0 : Math.round((currentImage + 1) / totalImages * 100) + "%" });
}

async function onePageRender() {
    $("#image-right").hide();
    $(".mainImageWrapper").addClass("isdouble");

    // single page 
    await LoadImage1(currentImage);
}


function isDoublePage(h, w) {
    if (settings.rotateTimes == 0 || settings.rotateTimes == 2) {
        if (w > h) {
            return true;
        }
    } else if (settings.rotateTimes == 1 || settings.rotateTimes == 3) {
        if (h > w) {
            return true;
        }
    }
    return false;
}

function LoadImage1(currentImage) {
    return new Promise((resolve, reject) => {

        // page 1
        var canvas = $("#mainImage")[0];
        var x = $("#mainImage")[0].getContext("2d");
        $("#mainText").hide();

        if (currentImage === "loading") {
            updateScale(true);
            canvas.width = innerWidth / 2 - 100;
            canvas.height = 200;
            x.fillStyle = "black";
            x.textAlign = "center";
            x.font = "24px sans-serif";
            x.strokeStyle = "black";
            x.fillText("Loading Page #" + (currentImage + 1), canvas.width / 2, 100);
        } else {
            if (currentImage === "error") {
                updateScale(true);
                canvas.width = innerWidth / 2 - 100;
                canvas.height = 200;
                x.fillStyle = "black";
                x.textAlign = "center";
                x.font = "24px sans-serif";
                x.strokeStyle = "black";
                x.fillText("Unable to decompress image #" + (currentImage + 1), canvas.width / 2, 100);
            } else {
                // scroll top
                if ($("body").css("scrollHeight") / innerHeight > 1) {
                    $("body").css("overflowY", "scroll");
                }

                var img = new Image();
                var url = imageFiles[currentImage].dataURI
                img.onerror = function () {
                    canvas.width = innerWidth / 2 - 100;
                    canvas.height = 300;
                    updateScale(true);
                    x.fillStyle = "black";
                    x.font = "50px sans-serif";
                    x.strokeStyle = "black";
                    x.fillText("Page #" + (currentImage + 1) + " (" +
                        imageFiles[currentImage].filename + ")", canvas.width / 2, 100);
                    x.fillStyle = "black";
                    x.fillText("Is corrupt or not an image", canvas.width / 2, 200);

                    var xhr = new XMLHttpRequest();
                    if (/(html|htm)$/.test(imageFiles[currentImage].filename)) {
                        xhr.open("GET", url, true);
                        xhr.onload = function () {
                            $("#mainText").css("display", "");
                            $("#mainText").innerHTML("<iframe style=\"width:100%;height:700px;border:0\" src=\"data:text/html," + escape(xhr.responseText) + "\"></iframe>");
                        };
                        xhr.send(null);
                    } else if (!/(jpg|jpeg|png|gif|webp)$/.test(imageFiles[currentImage].filename) && imageFiles[currentImage].data.uncompressedSize < 10 * 1024) {
                        xhr.open("GET", url, true);
                        xhr.onload = function () {
                            $("#mainText").css("display", "");
                            $("#mainText").innerText(xhr.responseText);
                        };
                        xhr.send(null);
                    }
                    reject;
                    return;
                };

                img.onload = function () {
                    var h = img.height,
                        w = img.width,
                        sw = w,
                        sh = h;
                    settings.rotateTimes = (4 + settings.rotateTimes) % 4;
                    x.save();
                    if (settings.rotateTimes % 2 === 1) {
                        sh = w;
                        sw = h;
                    }

                    if (doublePages[currentImage] === undefined) {
                        currentPageIsDoublePage = isDoublePage(h, w);
                        doublePages[currentImage] = currentPageIsDoublePage;
                    }
                    else
                        currentPageIsDoublePage = doublePages[currentImage];

                    canvas.height = sh;
                    canvas.width = sw;
                    x.translate(sw / 2, sh / 2);
                    x.rotate(Math.PI / 2 * settings.rotateTimes);
                    x.translate(-w / 2, -h / 2);
                    if (settings.vflip) {
                        x.scale(1, -1);
                        x.translate(0, -h);
                    }
                    if (settings.hflip) {
                        x.scale(-1, 1);
                        x.translate(-w, 0);
                    }
                    canvas.style.display = "none";
                    scrollTo(0, 0);
                    x.drawImage(img, 0, 0);

                    if (!currentPageIsDoublePage && settings.pageMode == 2) {
                        // draw shadow
                        x.shadowBlur = 80;
                        x.shadowColor = "#000000AA";
                        x.fillRect(canvas.width, -50, 50, canvas.height + 100);
                    }


                    var blockSize = 1, // only visit every 5 pixels
                        defaultRGB = { r: 255, g: 255, b: 255 }, // for non-supporting envs
                        data,
                        i = -4,
                        length,
                        rgb = { r: 0, g: 0, b: 0 },
                        count = 0;

                    var borderColor = defaultRGB;

                    try {
                        pixeldata = x.getImageData(0, 0, 10, 10);
                        length = pixeldata.data.length;
                        while ((i += blockSize * 4) < length) {
                            ++count;
                            rgb.r += pixeldata.data[i];
                            rgb.g += pixeldata.data[i + 1];
                            rgb.b += pixeldata.data[i + 2];
                        }

                        // ~~ used to floor values
                        rgb.r = ~~(rgb.r / count);
                        rgb.g = ~~(rgb.g / count);
                        rgb.b = ~~(rgb.b / count);

                        borderColor = rgb;

                    } catch (e) {
                        /* security error, img on diff domain *///alert('x');
                        // return defaultRGB;
                    }

                    updateScale(false);

                    canvas.style.display = "";
                    $("body").css("overflowY", "");

                    $("#image-left").css("background-color", "rgb(" + borderColor.r + ", " + borderColor.g + ", " + borderColor.b + ")");


                    x.restore();
                    resolve();
                };
                img.src = url;
            }
        }
    })
}


function LoadImage2(currentImage) {
    return new Promise((resolve, reject) => {
        // page 2
        var canvas2 = $("#mainImage2")[0];
        var x2 = $("#mainImage2")[0].getContext("2d");
        $("#mainText").hide();

        if (currentImage === "loading") {
            updateScale(true);
            canvas2.width = innerWidth / 2 - 100;
            canvas2.height = 200;
            x2.fillStyle = "black";
            x2.textAlign = "center";
            x2.font = "24px sans-serif";
            x2.strokeStyle = "black";
            x2.fillText("Loading Page #" + (currentImage + 2), canvas2.width / 2, 100);
        } else {
            if (currentImage === "error") {
                updateScale(true);
                canvas2.width = innerWidth / 2 - 100;
                canvas2.height = 200;
                x2.fillStyle = "black";
                x2.textAlign = "center";
                x2.font = "24px sans-serif";
                x2.strokeStyle = "black";
                x2.fillText("Unable to decompress image #" + (currentImage + 2), canvas2.width / 2, 100);
            } else {
                // scroll top
                if ($("body").css("scrollHeight") / innerHeight > 1) {
                    $("body").css("overflowY", "scroll");
                }

                var img2 = new Image();
                var url2 = imageFiles[currentImage + 1].dataURI
                img2.onerror = function () {
                    canvas2.width = innerWidth / 2 - 100;
                    canvas2.height = 300;
                    updateScale(true);
                    x2.fillStyle = "black";
                    x2.font = "50px sans-serif";
                    x2.strokeStyle = "black";
                    x2.fillText("Page #" + (currentImage + 2) + " (" +
                        imageFiles[currentImage + 1].filename + ")", canvas2.width / 2, 100);
                    x2.fillStyle = "black";
                    x2.fillText("Is corrupt or not an image", canvas2.width / 2, 200);

                    var xhr = new XMLHttpRequest();
                    if (/(html|htm)$/.test(imageFiles[currentImage + 1].filename)) {
                        xhr.open("GET", url2, true);
                        xhr.onload = function () {
                            $("#mainText").css("display", "");
                            $("#mainText").innerHTML("<iframe style=\"width:100%;height:700px;border:0\" src=\"data:text/html," + escape(xhr.responseText) + "\"></iframe>");
                        };
                        xhr.send(null);
                    } else if (!/(jpg|jpeg|png|gif|webp)$/.test(imageFiles[currentImage + 1].filename) && imageFiles[currentImage + 1].data.uncompressedSize < 10 * 1024) {
                        xhr.open("GET", url2, true);
                        xhr.onload = function () {
                            $("#mainText").css("display", "");
                            $("#mainText").innerText(xhr.responseText);
                        };
                        xhr.send(null);
                    }
                    reject;
                    return;
                };


                img2.onload = function () {
                    var h = img2.height,
                        w = img2.width,
                        sw = w,
                        sh = h;
                    settings.rotateTimes = (4 + settings.rotateTimes) % 4;
                    x2.save();
                    if (settings.rotateTimes % 2 === 1) {
                        sh = w;
                        sw = h;
                    }

                    if (doublePages[currentImage + 1] === undefined) {
                        currentPageIsDoublePage = isDoublePage(h, w);
                        doublePages[currentImage + 1] = currentPageIsDoublePage;
                    }
                    else
                        currentPageIsDoublePage = doublePages[currentImage + 1];

                    if (currentPageIsDoublePage == true) {
                        // the second page is a double page, skip it.
                        $("#image-right").hide();
                        $(".mainImageWrapper").addClass("isdouble");

                        resolve();
                        return;
                    }

                    canvas2.height = sh;
                    canvas2.width = sw;
                    x2.translate(sw / 2, sh / 2);
                    x2.rotate(Math.PI / 2 * settings.rotateTimes);
                    x2.translate(-w / 2, -h / 2);
                    if (settings.vflip) {
                        x2.scale(1, -1);
                        x2.translate(0, -h);
                    }
                    if (settings.hflip) {
                        x2.scale(-1, 1);
                        x2.translate(-w, 0);
                    }
                    canvas2.style.display = "none";
                    scrollTo(0, 0);

                    x2.drawImage(img2, 0, 0);

                    // draw shadow
                    x2.shadowBlur = 80;
                    x2.shadowColor = "#000000AA";
                    x2.fillRect(-50, -50, 50, canvas2.height + 100);

                    var blockSize = 1, // only visit every 5 pixels
                        defaultRGB = { r: 255, g: 255, b: 255 }, // for non-supporting envs
                        i = -4,
                        length,
                        rgb = { r: 0, g: 0, b: 0 },
                        count = 0;

                    var borderColor = defaultRGB;

                    try {
                        pixeldata = x2.getImageData(sw - 10, 0, 10, 10);
                        length = pixeldata.data.length;
                        while ((i += blockSize * 4) < length) {
                            ++count;
                            rgb.r += pixeldata.data[i];
                            rgb.g += pixeldata.data[i + 1];
                            rgb.b += pixeldata.data[i + 2];
                        }

                        // ~~ used to floor values
                        rgb.r = ~~(rgb.r / count);
                        rgb.g = ~~(rgb.g / count);
                        rgb.b = ~~(rgb.b / count);

                        borderColor = rgb;

                    } catch (e) {
                        /* security error, img on diff domain *///alert('x');
                        // return defaultRGB;
                    }


                    updateScale(false);

                    canvas2.style.display = "";
                    $("body").css("overflowY", "");
                    $("#image-right").css("background-color", "rgb(" + borderColor.r + ", " + borderColor.g + ", " + borderColor.b + ")");


                    x2.restore();
                    resolve();
                };
                img2.src = url2;
            }
        }
    })
}

async function twoPagesRender(currentImage) {

    $("#image-right").show();
    $(".mainImageWrapper").removeClass("isdouble");

    // double page 
    await LoadImage1(currentImage);


    if (currentPageIsDoublePage == true) {
        // the first page is a double page, skip the next page
        $("#image-right").hide();
        $(".mainImageWrapper").addClass("isdouble");

        return;
    }

    await LoadImage2(currentImage);

}

function setImage(currentImage) {
    return new Promise(async (resolve, reject) => {

        if (settings.pageMode == 1) {
            await onePageRender(currentImage);
        }
        else {
            await twoPagesRender(currentImage);
        }
        resolve();
    });
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
    currentImage = settings.pageMode == 2 && !currentPageIsDoublePage && !doublePages[currentImage - 1] ? currentImage - 2 : currentImage - 1;
    if (currentImage < 0) {
        // Freeze on the first page.
        currentImage = 0;
    } else {
        addPageRange(calibre.fetchPageUrl, currentImage, 2, 2);
        // if (imageFiles[currentImage] === undefined) {
        //     addPage(calibre.fetchPageUrl + currentImage, currentImage);
        // }
        // updatePage();
        if (settings.nextPage === 0) {
            $("#mainContent").scrollTop(0);
        }
    }
}

function showNextPage() {
    currentImage = settings.pageMode == 2 && !currentPageIsDoublePage ? currentImage + 2 : currentImage + 1;
    if (currentImage >= Math.max(totalImages, imageFiles.length)) {
        // Freeze on the current page.
        currentImage = Math.max(totalImages, imageFiles.length) - 1;
    } else {
        addPageRange(calibre.fetchPageUrl, currentImage, 2, 2);
        // if (imageFiles[currentImage] === undefined) {
        //     addPage(calibre.fetchPageUrl + currentImage, currentImage);
        // }
        // updatePage();
        if (settings.nextPage === 0) {
            $("#mainContent").scrollTop(0);
        }
    }
}

function updateScale(clear) {
    var mainImageStyle = getElem("mainImage").style;
    var mainImageStyle2 = getElem("mainImage2").style;
    mainImageStyle.width = "";
    mainImageStyle2.width = "";
    mainImageStyle.height = "";
    mainImageStyle2.height = "";
    mainImageStyle.maxWidth = "";
    mainImageStyle2.maxWidth = "";
    mainImageStyle.maxHeight = "";
    mainImageStyle2.maxHeight = "";
    var maxheight = innerHeight - 50;

    if (!clear) {
        switch (settings.fitMode) {
            case kthoom.Key.B:
                mainImageStyle.maxWidth = "100%";
                mainImageStyle2.maxWidth = "100%";
                mainImageStyle.maxHeight = maxheight + "px";
                mainImageStyle2.maxHeight = maxheight + "px";
                break;
            case kthoom.Key.H:
                mainImageStyle.height = maxheight + "px";
                mainImageStyle2.height = maxheight + "px";
                break;
            case kthoom.Key.W:
                mainImageStyle.width = "100%";
                mainImageStyle2.width = "100%";
                break;
            default:
                break;
        }
    }

    $("#mainContent").css({ maxHeight: maxheight + 5 });
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
        case kthoom.Key.L:
            if (hasModifier) break;
            settings.rotateTimes--;
            if (settings.rotateTimes < 0) {
                settings.rotateTimes = 3;
            }
            updatePage();
            break;
        case kthoom.Key.R:
            if (hasModifier) break;
            settings.rotateTimes++;
            if (settings.rotateTimes > 3) {
                settings.rotateTimes = 0;
            }
            updatePage();
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
            break;
        case kthoom.Key.W:
            if (hasModifier) break;
            settings.fitMode = kthoom.Key.W;
            updateScale(false);
            break;
        case kthoom.Key.H:
            if (hasModifier) break;
            settings.fitMode = kthoom.Key.H;
            updateScale(false);
            break;
        case kthoom.Key.B:
            if (hasModifier) break;
            settings.fitMode = kthoom.Key.B;
            updateScale(false);
            break;
        case kthoom.Key.N:
            if (hasModifier) break;
            settings.fitMode = kthoom.Key.N;
            updateScale(false);
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
        case kthoom.Key.NUM1:
            if (hasModifier) break;
            settings.pageMode = 1;
            // updatePageMode();
            updatePage();
            break;
        case kthoom.Key.NUM2:
            if (hasModifier) break;
            settings.pageMode = 2;
            // updatePageMode();
            updatePage();
            break;

        default:
            //console.log('KeyCode', evt.keyCode);
            break;
    }
}

async function addPage(filename, index) {
    var response = await fetch(filename);
    if (response.status >= 200 && response.status < 300) {

        loadPageFromArrayBuffer(await response.arrayBuffer(), response.headers.get("content-type"), filename, index);
    } else {
        console.warn(request.statusText, request.responseText);
    }
    // updatePage(currentImage);
}

async function addPageRange(baseFilename, baseIndex, nbPagesBefore, nbPagesAfter) {
    if (imageFiles[baseIndex] === undefined) {
        await addPage(baseFilename + baseIndex, baseIndex);
    }
    if (settings.pageMode == 1) {
        updatePage();
    }
    else if (settings.pageMode == 2) {
        var i = 1;
        if (baseIndex + i <= Math.max(totalImages, imageFiles.length) && imageFiles[baseIndex + i] === undefined) {
            await addPage(baseFilename + (baseIndex + i), (baseIndex + i));
        }
        nbPagesAfter++;
        updatePage();
    }
    for (i = 1; i <= nbPagesAfter; i++) {
        if (baseIndex + i <= Math.max(totalImages, imageFiles.length) && imageFiles[baseIndex + i] === undefined) {
            addPage(baseFilename + (baseIndex + i), (baseIndex + i)); // not awaited
        }
    }
    for (i = 1; i <= nbPagesBefore; i++) {
        if (baseIndex - i >= 0 && imageFiles[baseIndex - i] === undefined) {
            addPage(baseFilename + (baseIndex - i), (baseIndex - i)); // not awaited
        }
    }

}

async function init() {
    var response = await fetch(calibre.statsUrl);
    var stats = await response.json();
    totalImages = stats?.page_count;
    initProgressClick();
    document.body.className += /AppleWebKit/.test(navigator.userAgent) ? " webkit" : "";
    kthoom.loadSettings();
    updateScale(true);

    $(document).keydown(keyHandler);

    $(window).resize(function () {
        updateScale(false);
    });

    // Open TOC menu
    $("#slider").click(function () {
        $("#sidebar").toggleClass("open");
        $("#main").toggleClass("closed");
        $(this).toggleClass("icon-menu icon-right");

        // We need this in a timeout because if we call it during the CSS transition, IE11 shakes the page ¯\_(ツ)_/¯
        setTimeout(function () {
            // Focus on the TOC or the main content area, depending on which is open
            $("#main:not(.closed) #mainContent, #sidebar.open #tocView").focus();
            scrollTocToActive();
        }, 500);
    });

    // Open Settings modal
    $("#setting").click(function () {
        $("#settings-modal").toggleClass("md-show");
    });

    // On Settings input change
    $("#settings input").on("change", function () {
        // Get either the checked boolean or the assigned value
        var value = this.type === "checkbox" ? this.checked : this.value;

        // If it's purely numeric, parse it to an integer
        value = /^\d+$/.test(value) ? parseInt(value) : value;

        settings[this.name] = value;
        updatePage();
        updateScale(false);
    });

    // Close modal
    $(".closer, .overlay").click(function () {
        $(".md-show").removeClass("md-show");
    });

    // TOC thumbnail pagination
    $("#thumbnails").on("click", "a", function () {
        currentImage = $(this).data("page") - 1;
        updatePage();
        if (settings.nextPage === 0) {
            $("#mainContent").scrollTop(0);
        }
    });

    // Fullscreen mode
    if (typeof screenfull !== "undefined") {
        $("#fullscreen").click(function () {
            screenfull.toggle($("#container")[0]);
        });

        if (screenfull.raw) {
            var $button = $("#fullscreen");
            document.addEventListener(screenfull.raw.fullscreenchange, function () {
                screenfull.isFullscreen
                    ? $button.addClass("icon-resize-small").removeClass("icon-resize-full")
                    : $button.addClass("icon-resize-full").removeClass("icon-resize-small");
            });
        }
    }

    // Focus the scrollable area so that keyboard scrolling work as expected
    $("#mainContent").focus();

    $("#mainContent").swipe({
        swipeRight: function () {
            showLeftPage();
        },
        swipeLeft: function () {
            showRightPage();
        },
    });
    $("#mainImageWrapper").click(function (evt) {
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
        var clickedLeft = false;
        switch (settings.rotateTimes) {
            case 0:
                clickedLeft = clickX < (comicWidth / 2);
                break;
            case 1:
                clickedLeft = clickY < (comicHeight / 2);
                break;
            case 2:
                clickedLeft = clickX > (comicWidth / 2);
                break;
            case 3:
                clickedLeft = clickY > (comicHeight / 2);
                break;
        }
        if (clickedLeft) {
            showLeftPage();
        } else {
            showRightPage();
        }
    });
}

