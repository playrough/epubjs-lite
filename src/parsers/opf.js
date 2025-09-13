// OPFParser: parse OPF XML -> { metadata, manifest, spine }
// - metadata: các trường cơ bản từ <metadata> (title, language, creators, publisher, etc.)
// - manifest: map id -> { href, mediaType, properties }
// - spine: array itemrefs -> { idref, linear }
export class OPFParser {
    static parse(opfXml) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(opfXml, 'application/xml');

        const parserError = doc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            throw new Error('Failed to parse OPF');
        }

        const metadata = this._parseMetadata(doc);
        const manifest = this._parseManifest(doc);
        const spine = this._parseSpine(doc);

        return { metadata, manifest, spine };
    }

    static _getFirst(el, localName) {
        // Lấy phần tử đầu tiên theo localName, chấp nhận mọi namespace
        const direct = el.getElementsByTagName(localName)[0];
        if (direct) return direct;
        if (el.getElementsByTagNameNS) {
            const anyNs = el.getElementsByTagNameNS('*', localName)[0];
            if (anyNs) return anyNs;
        }
        return null;
    }

    static _getAll(el, localName) {
        // Lấy tất cả phần tử theo localName, chấp nhận mọi namespace
        let list = Array.from(el.getElementsByTagName(localName));
        if (list.length === 0 && el.getElementsByTagNameNS) {
            list = Array.from(el.getElementsByTagNameNS('*', localName));
        }
        return list;
    }

    static _text(el) {
        return (el && el.textContent) ? el.textContent.trim() : '';
        // Không decode entities thủ công vì DOMParser đã xử lý
    }

    static _parseMetadata(doc) {
        const pkg = this._getFirst(doc, 'package');
        const metadataEl = pkg ? this._getFirst(pkg, 'metadata') : this._getFirst(doc, 'metadata');
        const out = {
            title: null,
            language: null,
            creators: [], // mảng string
            publisher: null,
            identifiers: [], // mảng string
        };
        if (!metadataEl) return out;

        const titleEl = this._getFirst(metadataEl, 'title');
        if (titleEl) out.title = this._text(titleEl);

        const langEl = this._getFirst(metadataEl, 'language');
        if (langEl) out.language = this._text(langEl);

        const creators = this._getAll(metadataEl, 'creator');
        out.creators = creators.map((c) => this._text(c)).filter(Boolean);

        const publisherEl = this._getFirst(metadataEl, 'publisher');
        if (publisherEl) out.publisher = this._text(publisherEl);

        const ids = this._getAll(metadataEl, 'identifier');
        out.identifiers = ids.map((i) => this._text(i)).filter(Boolean);

        return out;
    }

    static _parseManifest(doc) {
        const manifestEl = this._getFirst(doc, 'manifest');
        const map = {};
        if (!manifestEl) return map;

        const items = this._getAll(manifestEl, 'item');
        for (const item of items) {
            const id = item.getAttribute('id');
            if (!id) continue;
            map[id] = {
                href: item.getAttribute('href') || '',
                mediaType: item.getAttribute('media-type') || '',
                properties: item.getAttribute('properties') || '',
            };
        }
        return map;
    }

    static _parseSpine(doc) {
        const spineEl = this._getFirst(doc, 'spine');
        const list = [];
        if (!spineEl) return list;

        const itemrefs = this._getAll(spineEl, 'itemref');
        for (const ref of itemrefs) {
            const idref = ref.getAttribute('idref');
            if (!idref) continue;
            const linearAttr = (ref.getAttribute('linear') || 'yes').toLowerCase();
            list.push({
                idref,
                linear: linearAttr !== 'no', // true nếu không có hoặc khác 'no'
            });
        }
        return list;
    }
}