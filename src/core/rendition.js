import { dirname as pathDirname, resolveHref } from '../utils/path.js';

export class Rendition {
    constructor(book, elementOrSelector, options = {}) {
        this.book = book;
        this.options = options;
        this.container = this._resolveElement(elementOrSelector);
        if (!this.container) {
            throw new Error('[Rendition] container element not found');
        }
        this.index = 0; // current spine index (best-effort)
        this._blobUrls = []; // quản lý các ObjectURL của ảnh để revoke khi chuyển chương
        this._iframe = null; // iframe hiển thị nội dung
        this._doc = null;    // document của iframe
    }

    _resolveElement(elOrSelector) {
        if (typeof elOrSelector === 'string') {
            return document.querySelector(elOrSelector);
        }
        return elOrSelector;
    }

    _ensureIframe() {
        // Tạo iframe nếu chưa có, hoặc nếu container vừa bị thay đổi
        if (!this._iframe || !this._iframe.contentDocument) {
            // Clear container và tạo iframe
            this.container.innerHTML = '';
            const iframe = document.createElement('iframe');
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = '0';
            iframe.style.display = 'block';
            this.container.appendChild(iframe);
            this._iframe = iframe;
        }

        // Lấy document của iframe
        this._doc = this._iframe.contentDocument || this._iframe.contentWindow?.document;

        // Bơm skeleton HTML tối giản (mỗi lần hiển thị chương sẽ xây lại)
        this._doc.open();
        this._doc.write('<!doctype html><html><head><meta charset="utf-8"><style>body { margin: 16px; font-family: system-ui, Arial, sans-serif; } img { max-width: 100%; height: auto; } figure { margin: 0; }</style></head><body></body></html>');
        this._doc.close();
    }

    _writeSkeleton(bodyHtml) {
        if (!this._doc) this._ensureIframe();

        // Ngăn auto-load ảnh: chuyển src -> data-epub-src trước khi gắn vào DOM
        const safeHtml = (bodyHtml || '').replace(/\ssrc=(["'])/gi, ' data-epub-src=$1');

        this._doc.body.innerHTML = safeHtml;
    }

    // Public API: Scroll to top of current content
    scrollToTop(options = {}) {
        return this._scrollToTop(options);
    }

    // Internal helper for scrolling logic
    _scrollToTop({ behavior = 'auto' } = {}) {
        try {
            const win = this._iframe?.contentWindow;
            if (win && typeof win.scrollTo === 'function') {
                win.scrollTo({ top: 0, left: 0, behavior });
            }
            const doc = this._doc;
            if (doc) {
                const docEl = doc.documentElement || doc.getElementsByTagName('html')?.[0];
                if (docEl) docEl.scrollTop = 0;
                if (doc.body) doc.body.scrollTop = 0;
            }
        } catch (_) { /* no-op */ }
        try { if (this.container) this.container.scrollTop = 0; } catch (_) { /* no-op */ }
    }

    async display(hrefOrIndex) {
        try {
            const { spine, zip } = this.book;

            let targetHref = null;
            let targetIndex = -1;
            let targetHash = null;

            if (typeof hrefOrIndex === 'number') {
                // Display by spine index
                const item = spine.get(hrefOrIndex);
                if (!item || !item.href) throw new Error(`[Rendition] Invalid spine index: ${hrefOrIndex}`);
                targetHref = item.href;
                targetIndex = hrefOrIndex;
            } else if (typeof hrefOrIndex === 'string') {
                // Display by href (may include #hash)
                const raw = hrefOrIndex;
                const hashIdx = raw.indexOf('#');
                const hrefNoHash = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
                targetHash = hashIdx >= 0 ? raw.slice(hashIdx + 1) : null;

                // Novel use-case: skip pure-hash TOC entries (href starts with '#')
                if (!hrefNoHash || hrefNoHash.trim() === '') {
                    // skip pure-hash TOC link
                    return;
                }

                targetHref = hrefNoHash;
                // Try map to spine index for next/prev
                targetIndex = this._findSpineIndexByHref(hrefNoHash);
            } else {
                // default: first linear spine item
                const first = spine.firstLinearIndex();
                const item = spine.get(first);
                targetHref = item?.href || null;
                targetIndex = first;
            }

            if (!targetHref) throw new Error('[Rendition] No target href to display');

            // Trước khi đọc/chèn nội dung chương mới
            this._revokeBlobUrls();

            const xhtml = await zip.read(targetHref, 'text');
            const bodyHtml = this._extractBodyHtml(xhtml);
            this._ensureIframe();
            this._writeSkeleton(bodyHtml);

            await this._inlineStylesFromXhtml(xhtml, targetHref);
            await this._rewriteImages(targetHref);

            // Scroll to top when chapter changes (unless navigating to an in-document fragment)
            if (!targetHash && (this.options?.scrollToTopOnChapterChange !== false)) {
                this._scrollToTop({ behavior: 'auto' });
            }

            if (targetIndex >= 0) this.index = targetIndex;

            // Scroll to in-document fragment if provided (e.g., from TOC)
            if (targetHash && this._doc) {
                try {
                    const elById = this._doc.getElementById(targetHash);
                    const elByName = elById ? null : this._doc.querySelector(`[name="${targetHash}"]`);
                    const el = elById || elByName;
                    if (el && typeof el.scrollIntoView === 'function') {
                        el.scrollIntoView({ block: 'start' });
                    }
                } catch (_) { /* no-op */ }
            }
        } catch (e) {
            console.warn('[Rendition] Failed to display content:', e);
            this.container.innerHTML = `<div style="padding:12px;color:#b00;">Failed to display content: ${e.message || e}</div>`;
        }
    }

    next() {
        const { spine } = this.book;
        const nextIndex = spine.nextLinearIndex(this.index);
        if (nextIndex !== this.index) {
            return this.display(nextIndex);
        }
        // reached end of spine
    }

    prev() {
        const { spine } = this.book;
        const prevIndex = spine.prevLinearIndex(this.index);
        if (prevIndex !== this.index) {
            return this.display(prevIndex);
        }
        // reached beginning of spine
    }

    _extractBodyHtml(xhtmlText) {
        // Minimal parsing to extract <body> content. This does not rewrite assets/CSS.
        const parser = new DOMParser();
        // Try XHTML first, fallback to text/html
        let doc = parser.parseFromString(xhtmlText, 'application/xhtml+xml');
        if (doc.getElementsByTagName('parsererror').length > 0) {
            doc = parser.parseFromString(xhtmlText, 'text/html');
        }
        const body = doc.body || doc.getElementsByTagName('body')[0] || doc.documentElement;
        return body ? body.innerHTML : xhtmlText;
    }

    _findSpineIndexByHref(hrefNoHash) {
        const items = this.book.spine.items;
        const normalized = hrefNoHash;
        for (let i = 0; i < items.length; i++) {
            if (items[i].href === normalized) return i;
        }
        return -1;
    }

    // Revoke tất cả blob URL đã tạo ở lần hiển thị trước
    _revokeBlobUrls() {
        if (this._blobUrls && this._blobUrls.length) {
            this._blobUrls.forEach((u) => {
                try { URL.revokeObjectURL(u); } catch (_) { }
            });
        }
        this._blobUrls = [];
    }

    // Rewrite tất cả <img> trong container sang blob URL đọc từ zip
    async _rewriteImages(chapterHref) {
        try {
            const baseDir = pathDirname(chapterHref);
            const root = this._doc || this.container; // ưu tiên iframe document
            const imgs = Array.from(root.querySelectorAll('img[data-epub-src], img[src]'));
            if (!imgs.length) return;

            // Dọn URL cũ trước khi gán mới
            // this._revokeBlobUrls();

            for (const img of imgs) {
                const src = (img.getAttribute('data-epub-src') || img.getAttribute('src') || '').trim();
                if (!src) continue;

                // Bỏ qua nếu là tuyệt đối/http(s)/data/blob
                const lower = src.toLowerCase();
                if (
                    lower.startsWith('http://') ||
                    lower.startsWith('https://') ||
                    lower.startsWith('data:') ||
                    lower.startsWith('blob:')
                ) {
                    continue;
                }

                // Resolve và đọc blob từ zip
                const resolved = resolveHref(baseDir, src);
                try {
                    const blob = await this.book.zip.read(resolved, 'blob');
                    const url = URL.createObjectURL(blob);
                    img.removeAttribute('data-epub-src');
                    img.src = url;
                    this._blobUrls.push(url);
                } catch (e) {
                    console.warn('[Rendition] Failed to load image from zip:', resolved, e);
                }
            }
        } catch (e) {
            console.warn('[Rendition] _rewriteImages failed:', e);
        }
    }

    async _inlineStylesFromXhtml(xhtml, chapterHref) {
        try {
            // Parse xhtml gốc để lấy link/style
            const parser = new DOMParser();
            let doc = parser.parseFromString(xhtml, 'application/xhtml+xml');
            if (doc.getElementsByTagName('parsererror').length > 0) {
                doc = parser.parseFromString(xhtml, 'text/html');
            }

            const chapterDir = pathDirname(chapterHref);

            // 1) Xử lý <link rel="stylesheet" href="...">
            const links = Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'));
            for (const link of links) {
                const href = (link.getAttribute('href') || '').trim();
                if (!href) continue;

                const lower = href.toLowerCase();
                if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('data:') || lower.startsWith('blob:')) {
                    // Bỏ qua link tuyệt đối
                    continue;
                }

                // Resolve đường dẫn CSS theo chương
                const cssPath = resolveHref(chapterDir, href);
                try {
                    const cssText = await this.book.zip.read(cssPath, 'text');

                    // Quan trọng: baseDir cho url(...) trong CSS là thư mục chứa file CSS
                    const cssBaseDir = pathDirname(cssPath);
                    const rewritten = await this._rewriteCssUrls(cssText, cssBaseDir);

                    const styleEl = this._doc.createElement('style');
                    styleEl.textContent = rewritten;
                    this._doc.head.appendChild(styleEl);
                } catch (e) {
                    console.warn('[Rendition] Failed to inline CSS:', cssPath, e);
                }
            }

            // 2) (Tuỳ chọn) Xử lý <style> inline trong xhtml (url(...) tương đối theo chương)
            const styleTags = Array.from(doc.getElementsByTagName('style'));
            for (const st of styleTags) {
                const type = (st.getAttribute('type') || '').trim().toLowerCase();
                if (type && type !== 'text/css') continue; // chỉ nhận CSS
                const cssText = st.textContent || '';
                if (!cssText.trim()) continue;

                const rewritten = await this._rewriteCssUrls(cssText, chapterDir);
                const styleEl = this._doc.createElement('style');
                styleEl.textContent = rewritten;
                this._doc.head.appendChild(styleEl);
            }
        } catch (e) {
            console.warn('[Rendition] _inlineStylesFromXhtml failed:', e);
        }
    }

    async _rewriteCssUrls(cssText, baseDir) {
        // Tìm url(...) và replace bằng blob URL nếu là đường dẫn tương đối
        const urlRegex = /url\(\s*(['"]?)([^'"\)]+)\1\s*\)/g;

        const replacements = [];
        const tasks = [];
        let match;

        while ((match = urlRegex.exec(cssText)) !== null) {
            const orig = match[0];
            const rawUrl = match[2].trim();
            const lower = rawUrl.toLowerCase();

            if (!rawUrl || lower.startsWith('data:') || lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('blob:')) {
                continue; // bỏ qua tuyệt đối/data/blob
            }

            const resolved = resolveHref(baseDir, rawUrl);
            tasks.push(
                this.book.zip.read(resolved, 'blob').then((blob) => {
                    const objUrl = URL.createObjectURL(blob);
                    this._blobUrls.push(objUrl);
                    replacements.push({ orig, repl: `url('${objUrl}')` });
                }).catch((e) => {
                    console.warn('[Rendition] Failed to load CSS asset:', resolved, e);
                })
            );
        }

        await Promise.all(tasks);

        // Áp dụng thay thế
        let out = cssText;
        for (const { orig, repl } of replacements) {
            out = out.split(orig).join(repl);
        }
        return out;
    }
}