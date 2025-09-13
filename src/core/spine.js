import { dirname as opfDir, resolveHref } from '../utils/path.js';


// Spine: đại diện danh sách itemref (trật tự đọc) và chuẩn hóa href theo thư mục OPF.
// - opfPath: đường dẫn tới file .opf bên trong zip (vd: "OEBPS/content.opf")
// - opf: { metadata, manifest, spine } từ OPFParser.parse(opfXml)
// Kết quả: this.items = [{ index, idref, href, linear, mediaType, properties }]
export class Spine {
    constructor(opfPath, opf) {
        this.opfPath = opfPath;
        this.baseDir = opfDir(opfPath); // "OEBPS/"
        this._items = [];

        const { manifest = {}, spine = [] } = opf || {};
        spine.forEach((ref, index) => {
            const manItem = manifest[ref.idref];
            if (!manItem) {
                console.warn('[Spine] Missing manifest item for idref:', ref.idref);
                this._items.push({
                    index,
                    idref: ref.idref,
                    href: null,
                    linear: !!ref.linear,
                    mediaType: '',
                    properties: '',
                });
                return;
            }
            const resolved = resolveHref(this.baseDir, manItem.href);
            this._items.push({
                index,
                idref: ref.idref,
                href: resolved,
                linear: !!ref.linear,
                mediaType: manItem.mediaType || '',
                properties: manItem.properties || '',
            });
        });
    }

    static from(opfPath, opf) {
        return new Spine(opfPath, opf);
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
}
