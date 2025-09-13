// src/store/zip.js
var ZipStore = class _ZipStore {
  constructor(jszip) {
    this._zip = jszip;
  }
  // Tạo ZipStore từ ArrayBuffer chứa .epub (zip)
  // Ưu tiên lấy JSZip từ options; nếu không có, dùng window.JSZip (CDN).
  static async fromArrayBuffer(buffer, options = {}) {
    const JSZipImpl = options.JSZip || (typeof window !== "undefined" ? window.JSZip : void 0);
    if (!JSZipImpl) {
      throw new Error("JSZip is not available. Provide options.JSZip or include it via CDN.");
    }
    const zip = await JSZipImpl.loadAsync(buffer);
    return new _ZipStore(zip);
  }
  // Đọc file trong zip theo href.
  // Ở M2: trả về text theo mặc định. (Sẽ tinh chỉnh theo MIME ở các bước sau)
  async read(href, as = "text") {
    const file = this._zip.file(href);
    if (!file) {
      throw new Error(`File not found in zip: ${href}`);
    }
    if (as === "text" || as === "string") {
      return await file.async("text");
    }
    if (as === "uint8array") {
      return await file.async("uint8array");
    }
    if (as === "arraybuffer") {
      return await file.async("arraybuffer");
    }
    if (as === "blob") {
      return await file.async("blob");
    }
    return await file.async("text");
  }
};

// src/parsers/container.js
var ContainerParser = class {
  static async fromZip(zipStore) {
    const xml = await zipStore.read("META-INF/container.xml", "text");
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");
    const parserError = doc.getElementsByTagName("parsererror")[0];
    if (parserError) {
      throw new Error("Failed to parse container.xml");
    }
    let rootfiles = Array.from(doc.getElementsByTagName("rootfile"));
    if (rootfiles.length === 0 && doc.getElementsByTagNameNS) {
      rootfiles = Array.from(doc.getElementsByTagNameNS("*", "rootfile"));
    }
    if (rootfiles.length === 0) {
      throw new Error("No <rootfile> found in container.xml");
    }
    const preferred = rootfiles.find(
      (el) => el.getAttribute("media-type") === "application/oebps-package+xml"
    );
    const chosen = preferred || rootfiles[0];
    const fullPath = chosen.getAttribute("full-path");
    if (!fullPath) {
      throw new Error("Missing full-path attribute in container.xml rootfile");
    }
    return fullPath;
  }
};

// src/parsers/opf.js
var OPFParser = class {
  static parse(opfXml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(opfXml, "application/xml");
    const parserError = doc.getElementsByTagName("parsererror")[0];
    if (parserError) {
      throw new Error("Failed to parse OPF");
    }
    const metadata = this._parseMetadata(doc);
    const manifest = this._parseManifest(doc);
    const spine = this._parseSpine(doc);
    return { metadata, manifest, spine };
  }
  static _getFirst(el, localName) {
    const direct = el.getElementsByTagName(localName)[0];
    if (direct) return direct;
    if (el.getElementsByTagNameNS) {
      const anyNs = el.getElementsByTagNameNS("*", localName)[0];
      if (anyNs) return anyNs;
    }
    return null;
  }
  static _getAll(el, localName) {
    let list = Array.from(el.getElementsByTagName(localName));
    if (list.length === 0 && el.getElementsByTagNameNS) {
      list = Array.from(el.getElementsByTagNameNS("*", localName));
    }
    return list;
  }
  static _text(el) {
    return el && el.textContent ? el.textContent.trim() : "";
  }
  static _parseMetadata(doc) {
    const pkg = this._getFirst(doc, "package");
    const metadataEl = pkg ? this._getFirst(pkg, "metadata") : this._getFirst(doc, "metadata");
    const out = {
      title: null,
      language: null,
      creators: [],
      // mảng string
      publisher: null,
      identifiers: []
      // mảng string
    };
    if (!metadataEl) return out;
    const titleEl = this._getFirst(metadataEl, "title");
    if (titleEl) out.title = this._text(titleEl);
    const langEl = this._getFirst(metadataEl, "language");
    if (langEl) out.language = this._text(langEl);
    const creators = this._getAll(metadataEl, "creator");
    out.creators = creators.map((c) => this._text(c)).filter(Boolean);
    const publisherEl = this._getFirst(metadataEl, "publisher");
    if (publisherEl) out.publisher = this._text(publisherEl);
    const ids = this._getAll(metadataEl, "identifier");
    out.identifiers = ids.map((i) => this._text(i)).filter(Boolean);
    return out;
  }
  static _parseManifest(doc) {
    const manifestEl = this._getFirst(doc, "manifest");
    const map = {};
    if (!manifestEl) return map;
    const items = this._getAll(manifestEl, "item");
    for (const item of items) {
      const id = item.getAttribute("id");
      if (!id) continue;
      map[id] = {
        href: item.getAttribute("href") || "",
        mediaType: item.getAttribute("media-type") || "",
        properties: item.getAttribute("properties") || ""
      };
    }
    return map;
  }
  static _parseSpine(doc) {
    const spineEl = this._getFirst(doc, "spine");
    const list = [];
    if (!spineEl) return list;
    const itemrefs = this._getAll(spineEl, "itemref");
    for (const ref of itemrefs) {
      const idref = ref.getAttribute("idref");
      if (!idref) continue;
      const linearAttr = (ref.getAttribute("linear") || "yes").toLowerCase();
      list.push({
        idref,
        linear: linearAttr !== "no"
        // true nếu không có hoặc khác 'no'
      });
    }
    return list;
  }
};

// src/utils/path.js
function dirname(path) {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx + 1);
}
function resolveHref(baseDir, href, { keepHash = false } = {}) {
  if (!href) return "";
  if (href.startsWith("/")) {
    return decodeURIComponent(href.slice(1));
  }
  const url = new URL(href, "http://x/" + (baseDir || ""));
  const path = decodeURIComponent(url.pathname.slice(1));
  return keepHash ? path + (url.hash || "") : path;
}

// src/core/spine.js
var Spine = class _Spine {
  constructor(opfPath, opf) {
    this.opfPath = opfPath;
    this.baseDir = dirname(opfPath);
    this._items = [];
    const { manifest = {}, spine = [] } = opf || {};
    spine.forEach((ref, index) => {
      const manItem = manifest[ref.idref];
      if (!manItem) {
        console.warn("[Spine] Missing manifest item for idref:", ref.idref);
        this._items.push({
          index,
          idref: ref.idref,
          href: null,
          linear: !!ref.linear,
          mediaType: "",
          properties: ""
        });
        return;
      }
      const resolved = resolveHref(this.baseDir, manItem.href);
      this._items.push({
        index,
        idref: ref.idref,
        href: resolved,
        linear: !!ref.linear,
        mediaType: manItem.mediaType || "",
        properties: manItem.properties || ""
      });
    });
  }
  static from(opfPath, opf) {
    return new _Spine(opfPath, opf);
  }
  get items() {
    return this._items;
  }
  get length() {
    return this._items.length;
  }
  get(i) {
    return this._items[i] || null;
  }
  // Trả về index đầu tiên có linear=true; nếu không có, trả về 0 nếu tồn tại, ngược lại -1
  firstLinearIndex() {
    for (let i = 0; i < this._items.length; i++) {
      if (this._items[i]?.linear && this._items[i]?.href) return i;
    }
    return this._items.length > 0 ? 0 : -1;
  }
  // Tìm index tiếp theo sau currentIndex có linear=true. Nếu không có, trả về currentIndex
  nextLinearIndex(currentIndex) {
    for (let i = currentIndex + 1; i < this._items.length; i++) {
      if (this._items[i]?.linear && this._items[i]?.href) return i;
    }
    return currentIndex;
  }
  // Tìm index trước currentIndex có linear=true. Nếu không có, trả về currentIndex
  prevLinearIndex(currentIndex) {
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (this._items[i]?.linear && this._items[i]?.href) return i;
    }
    return currentIndex;
  }
};

// src/parsers/nav.js
var NavParser = class {
  static parse(xhtml, baseDir = "") {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xhtml, "application/xhtml+xml");
    const parserError = doc.getElementsByTagName("parsererror")[0];
    if (parserError) {
      throw new Error("Failed to parse nav.xhtml");
    }
    const navEl = this._getTocNavElement(doc);
    if (!navEl) {
      throw new Error("No <nav> with toc found in nav.xhtml");
    }
    const ol = navEl.querySelector("ol");
    if (!ol) return [];
    return this._extractList(ol, baseDir);
  }
  // Tìm <nav epub:type="toc">, hoặc role="doc-toc", hoặc id="toc"
  static _getTocNavElement(doc) {
    const navs = Array.from(doc.getElementsByTagName("nav"));
    for (const n of navs) {
      const et = n.getAttribute("epub:type");
      if (et && et.toLowerCase().includes("toc")) return n;
    }
    for (const n of navs) {
      const role = n.getAttribute("role");
      if (role && role.toLowerCase() === "doc-toc") return n;
    }
    for (const n of navs) {
      if ((n.getAttribute("id") || "").toLowerCase() === "toc") return n;
    }
    return null;
  }
  static _extractList(ol, baseDir) {
    const items = [];
    const lis = Array.from(ol.children).filter((el) => el.tagName.toLowerCase() === "li");
    for (const li of lis) {
      const a = li.querySelector(":scope > a, :scope > span > a") || li.querySelector("a");
      if (!a) continue;
      const label = (a.textContent || "").trim();
      const rawHref = a.getAttribute("href") || "";
      const href = resolveHref(baseDir, rawHref, { keepHash: true });
      const childOl = li.querySelector(":scope > ol");
      const children = childOl ? this._extractList(childOl, baseDir) : [];
      items.push({ label, href, children });
    }
    return items;
  }
};

// src/core/rendition.js
var Rendition = class {
  constructor(book, elementOrSelector, options = {}) {
    this.book = book;
    this.options = options;
    this.container = this._resolveElement(elementOrSelector);
    if (!this.container) {
      throw new Error("[Rendition] container element not found");
    }
    this.index = 0;
    this._blobUrls = [];
    this._iframe = null;
    this._doc = null;
  }
  _resolveElement(elOrSelector) {
    if (typeof elOrSelector === "string") {
      return document.querySelector(elOrSelector);
    }
    return elOrSelector;
  }
  _ensureIframe() {
    if (!this._iframe || !this._iframe.contentDocument) {
      this.container.innerHTML = "";
      const iframe = document.createElement("iframe");
      iframe.style.width = "100%";
      iframe.style.height = "100%";
      iframe.style.border = "0";
      iframe.style.display = "block";
      this.container.appendChild(iframe);
      this._iframe = iframe;
    }
    this._doc = this._iframe.contentDocument || this._iframe.contentWindow?.document;
    this._doc.open();
    this._doc.write('<!doctype html><html><head><meta charset="utf-8"><style>body { margin: 16px; font-family: system-ui, Arial, sans-serif; } img { max-width: 100%; height: auto; } figure { margin: 0; }</style></head><body></body></html>');
    this._doc.close();
  }
  _writeSkeleton(bodyHtml) {
    if (!this._doc) this._ensureIframe();
    const safeHtml = (bodyHtml || "").replace(/\ssrc=(["'])/gi, " data-epub-src=$1");
    this._doc.body.innerHTML = safeHtml;
  }
  // Public API: Scroll to top of current content
  scrollToTop(options = {}) {
    return this._scrollToTop(options);
  }
  // Internal helper for scrolling logic
  _scrollToTop({ behavior = "auto" } = {}) {
    try {
      const win = this._iframe?.contentWindow;
      if (win && typeof win.scrollTo === "function") {
        win.scrollTo({ top: 0, left: 0, behavior });
      }
      const doc = this._doc;
      if (doc) {
        const docEl = doc.documentElement || doc.getElementsByTagName("html")?.[0];
        if (docEl) docEl.scrollTop = 0;
        if (doc.body) doc.body.scrollTop = 0;
      }
    } catch (_) {
    }
    try {
      if (this.container) this.container.scrollTop = 0;
    } catch (_) {
    }
  }
  async display(hrefOrIndex) {
    try {
      const { spine, zip } = this.book;
      let targetHref = null;
      let targetIndex = -1;
      let targetHash = null;
      if (typeof hrefOrIndex === "number") {
        const item = spine.get(hrefOrIndex);
        if (!item || !item.href) throw new Error(`[Rendition] Invalid spine index: ${hrefOrIndex}`);
        targetHref = item.href;
        targetIndex = hrefOrIndex;
      } else if (typeof hrefOrIndex === "string") {
        const raw = hrefOrIndex;
        const hashIdx = raw.indexOf("#");
        const hrefNoHash = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
        targetHash = hashIdx >= 0 ? raw.slice(hashIdx + 1) : null;
        if (!hrefNoHash || hrefNoHash.trim() === "") {
          return;
        }
        targetHref = hrefNoHash;
        targetIndex = this._findSpineIndexByHref(hrefNoHash);
      } else {
        const first = spine.firstLinearIndex();
        const item = spine.get(first);
        targetHref = item?.href || null;
        targetIndex = first;
      }
      if (!targetHref) throw new Error("[Rendition] No target href to display");
      this._revokeBlobUrls();
      const xhtml = await zip.read(targetHref, "text");
      const bodyHtml = this._extractBodyHtml(xhtml);
      this._ensureIframe();
      this._writeSkeleton(bodyHtml);
      await this._inlineStylesFromXhtml(xhtml, targetHref);
      await this._rewriteImages(targetHref);
      if (!targetHash && this.options?.scrollToTopOnChapterChange !== false) {
        this._scrollToTop({ behavior: "auto" });
      }
      if (targetIndex >= 0) this.index = targetIndex;
      if (targetHash && this._doc) {
        try {
          const elById = this._doc.getElementById(targetHash);
          const elByName = elById ? null : this._doc.querySelector(`[name="${targetHash}"]`);
          const el = elById || elByName;
          if (el && typeof el.scrollIntoView === "function") {
            el.scrollIntoView({ block: "start" });
          }
        } catch (_) {
        }
      }
    } catch (e) {
      console.warn("[Rendition] Failed to display content:", e);
      this.container.innerHTML = `<div style="padding:12px;color:#b00;">Failed to display content: ${e.message || e}</div>`;
    }
  }
  next() {
    const { spine } = this.book;
    const nextIndex = spine.nextLinearIndex(this.index);
    if (nextIndex !== this.index) {
      return this.display(nextIndex);
    }
  }
  prev() {
    const { spine } = this.book;
    const prevIndex = spine.prevLinearIndex(this.index);
    if (prevIndex !== this.index) {
      return this.display(prevIndex);
    }
  }
  _extractBodyHtml(xhtmlText) {
    const parser = new DOMParser();
    let doc = parser.parseFromString(xhtmlText, "application/xhtml+xml");
    if (doc.getElementsByTagName("parsererror").length > 0) {
      doc = parser.parseFromString(xhtmlText, "text/html");
    }
    const body = doc.body || doc.getElementsByTagName("body")[0] || doc.documentElement;
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
        try {
          URL.revokeObjectURL(u);
        } catch (_) {
        }
      });
    }
    this._blobUrls = [];
  }
  // Rewrite tất cả <img> trong container sang blob URL đọc từ zip
  async _rewriteImages(chapterHref) {
    try {
      const baseDir = dirname(chapterHref);
      const root = this._doc || this.container;
      const imgs = Array.from(root.querySelectorAll("img[data-epub-src], img[src]"));
      if (!imgs.length) return;
      for (const img of imgs) {
        const src = (img.getAttribute("data-epub-src") || img.getAttribute("src") || "").trim();
        if (!src) continue;
        const lower = src.toLowerCase();
        if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("data:") || lower.startsWith("blob:")) {
          continue;
        }
        const resolved = resolveHref(baseDir, src);
        try {
          const blob = await this.book.zip.read(resolved, "blob");
          const url = URL.createObjectURL(blob);
          img.removeAttribute("data-epub-src");
          img.src = url;
          this._blobUrls.push(url);
        } catch (e) {
          console.warn("[Rendition] Failed to load image from zip:", resolved, e);
        }
      }
    } catch (e) {
      console.warn("[Rendition] _rewriteImages failed:", e);
    }
  }
  async _inlineStylesFromXhtml(xhtml, chapterHref) {
    try {
      const parser = new DOMParser();
      let doc = parser.parseFromString(xhtml, "application/xhtml+xml");
      if (doc.getElementsByTagName("parsererror").length > 0) {
        doc = parser.parseFromString(xhtml, "text/html");
      }
      const chapterDir = dirname(chapterHref);
      const links = Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'));
      for (const link of links) {
        const href = (link.getAttribute("href") || "").trim();
        if (!href) continue;
        const lower = href.toLowerCase();
        if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("data:") || lower.startsWith("blob:")) {
          continue;
        }
        const cssPath = resolveHref(chapterDir, href);
        try {
          const cssText = await this.book.zip.read(cssPath, "text");
          const cssBaseDir = dirname(cssPath);
          const rewritten = await this._rewriteCssUrls(cssText, cssBaseDir);
          const styleEl = this._doc.createElement("style");
          styleEl.textContent = rewritten;
          this._doc.head.appendChild(styleEl);
        } catch (e) {
          console.warn("[Rendition] Failed to inline CSS:", cssPath, e);
        }
      }
      const styleTags = Array.from(doc.getElementsByTagName("style"));
      for (const st of styleTags) {
        const type = (st.getAttribute("type") || "").trim().toLowerCase();
        if (type && type !== "text/css") continue;
        const cssText = st.textContent || "";
        if (!cssText.trim()) continue;
        const rewritten = await this._rewriteCssUrls(cssText, chapterDir);
        const styleEl = this._doc.createElement("style");
        styleEl.textContent = rewritten;
        this._doc.head.appendChild(styleEl);
      }
    } catch (e) {
      console.warn("[Rendition] _inlineStylesFromXhtml failed:", e);
    }
  }
  async _rewriteCssUrls(cssText, baseDir) {
    const urlRegex = /url\(\s*(['"]?)([^'"\)]+)\1\s*\)/g;
    const replacements = [];
    const tasks = [];
    let match;
    while ((match = urlRegex.exec(cssText)) !== null) {
      const orig = match[0];
      const rawUrl = match[2].trim();
      const lower = rawUrl.toLowerCase();
      if (!rawUrl || lower.startsWith("data:") || lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("blob:")) {
        continue;
      }
      const resolved = resolveHref(baseDir, rawUrl);
      tasks.push(
        this.book.zip.read(resolved, "blob").then((blob) => {
          const objUrl = URL.createObjectURL(blob);
          this._blobUrls.push(objUrl);
          replacements.push({ orig, repl: `url('${objUrl}')` });
        }).catch((e) => {
          console.warn("[Rendition] Failed to load CSS asset:", resolved, e);
        })
      );
    }
    await Promise.all(tasks);
    let out = cssText;
    for (const { orig, repl } of replacements) {
      out = out.split(orig).join(repl);
    }
    return out;
  }
};

// src/core/book.js
var Book = class _Book {
  constructor(options = {}) {
    this.options = options;
    this._navigation = [];
  }
  // API mở sách thống nhất cho nhiều loại input (ArrayBuffer | File | URL trong tương lai)
  // Ở M1: chỉ trả về instance rỗng, để example có thể gọi mà không crash.
  static async open(input, options = {}) {
    if (!(input instanceof ArrayBuffer)) {
      console.warn("[M4] Book.open: only ArrayBuffer is supported at this stage");
    }
    const zipStore = await ZipStore.fromArrayBuffer(input, options);
    const opfPath = await ContainerParser.fromZip(zipStore);
    const opfXml = await zipStore.read(opfPath, "text");
    const opf = OPFParser.parse(opfXml);
    const spine = Spine.from(opfPath, opf);
    const book = new _Book(options);
    book.zip = zipStore;
    book.opfPath = opfPath;
    book.opf = opf;
    book.spine = spine;
    try {
      const baseDir = dirname(opfPath);
      const navItem = Object.values(opf.manifest || {}).find((i) => {
        const props = (i.properties || "").toLowerCase().split(/\s+/);
        return props.includes("nav");
      });
      if (navItem?.href) {
        const navPath = resolveHref(baseDir, navItem.href);
        const navXhtml = await zipStore.read(navPath, "text");
        const navDir = dirname(navPath);
        book._navigation = NavParser.parse(navXhtml, navDir);
      } else {
        book._navigation = [];
      }
    } catch (e) {
      console.warn("[M5] Failed to load/parse navigation (toc):", e);
      book._navigation = [];
    }
    return book;
  }
  // Gắn Book vào một container để hiển thị (iframe-based ở các milestone sau)
  // Ở M1: trả về một "rendition" stub với các method trống nhưng có cảnh báo rõ ràng.
  renderTo(elementOrSelector, options = {}) {
    return new Rendition(this, elementOrSelector, options);
  }
  // Navigation (toc) sẽ có ở M5; M1 chỉ để sẵn getter để ổn định API.
  get navigation() {
    return this._navigation || [];
  }
};
export {
  Book,
  ContainerParser,
  NavParser,
  OPFParser,
  Rendition,
  Spine,
  ZipStore
};
