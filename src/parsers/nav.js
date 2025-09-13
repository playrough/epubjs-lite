import { resolveHref } from '../utils/path.js';

// NavParser: parse EPUB3 nav.xhtml (TOC) -> [{ label, href, children }]
// - parse(xhtml, baseDir): baseDir là thư mục chứa file nav (để resolve href đúng).
export class NavParser {
    static parse(xhtml, baseDir = '') {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xhtml, 'application/xhtml+xml');

        const parserError = doc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            throw new Error('Failed to parse nav.xhtml');
        }

        const navEl = this._getTocNavElement(doc);
        if (!navEl) {
            throw new Error('No <nav> with toc found in nav.xhtml');
        }

        const ol = navEl.querySelector('ol');
        if (!ol) return [];

        return this._extractList(ol, baseDir);
    }

    // Tìm <nav epub:type="toc">, hoặc role="doc-toc", hoặc id="toc"
    static _getTocNavElement(doc) {
        const navs = Array.from(doc.getElementsByTagName('nav'));
        // Ưu tiên epub:type="toc"
        for (const n of navs) {
            const et = n.getAttribute('epub:type');
            if (et && et.toLowerCase().includes('toc')) return n;
        }
        // Sau đó role="doc-toc"
        for (const n of navs) {
            const role = n.getAttribute('role');
            if (role && role.toLowerCase() === 'doc-toc') return n;
        }
        // Cuối cùng id="toc"
        for (const n of navs) {
            if ((n.getAttribute('id') || '').toLowerCase() === 'toc') return n;
        }
        return null;
    }

    static _extractList(ol, baseDir) {
        const items = [];
        const lis = Array.from(ol.children).filter((el) => el.tagName.toLowerCase() === 'li');
        for (const li of lis) {
            // Tìm link chính trong li
            const a = li.querySelector(':scope > a, :scope > span > a') || li.querySelector('a');
            if (!a) continue;

            const label = (a.textContent || '').trim();
            const rawHref = a.getAttribute('href') || '';
            const href = resolveHref(baseDir, rawHref, { keepHash: true });

            // Con (nếu có)
            const childOl = li.querySelector(':scope > ol');
            const children = childOl ? this._extractList(childOl, baseDir) : [];

            items.push({ label, href, children });
        }
        return items;
    }
}