import { ZipStore } from '../store/zip.js';
import { ContainerParser } from '../parsers/container.js';
import { OPFParser } from '../parsers/opf.js';
import { Spine } from './spine.js';
import { NavParser } from '../parsers/nav.js';
import { Rendition } from './rendition.js';
import { dirname as pathDirname, resolveHref } from '../utils/path.js';

// Lớp trung tâm điều phối toàn bộ vòng đời của EPUB
// M1: chỉ là stub an toàn để cố định API sớm.
// M2+ sẽ dần thay thế các phần stub bằng triển khai thật (ZipStore, Parsers, Rendition...).
export class Book {
    constructor(options = {}) {
        this.options = options;
        this._navigation = []; // khởi tạo sớm cho an toàn
    }

    // API mở sách thống nhất cho nhiều loại input (ArrayBuffer | File | URL trong tương lai)
    // Ở M1: chỉ trả về instance rỗng, để example có thể gọi mà không crash.
    static async open(input, options = {}) {
        // M4: hiện tại chỉ hỗ trợ ArrayBuffer (ví dụ chọn file trong demo)
        if (!(input instanceof ArrayBuffer)) {
            console.warn('[M4] Book.open: only ArrayBuffer is supported at this stage');
        }

        // 1) Tạo ZipStore từ ArrayBuffer
        const zipStore = await ZipStore.fromArrayBuffer(input, options);

        // 2) Tìm OPF path qua container.xml
        const opfPath = await ContainerParser.fromZip(zipStore);

        // 3) Đọc và parse OPF
        const opfXml = await zipStore.read(opfPath, 'text');
        const opf = OPFParser.parse(opfXml);

        // 4) Tạo Spine (chuẩn hóa href theo thư mục OPF)
        const spine = Spine.from(opfPath, opf);

        // 5) Tạo instance Book và gắn model
        const book = new Book(options);
        book.zip = zipStore;
        book.opfPath = opfPath;
        book.opf = opf;
        book.spine = spine;

        // M5: Parse navigation (TOC) if present
        try {
            // baseDir của OPF để resolve đường tới navItem từ manifest
            const baseDir = pathDirname(opfPath);

            const navItem = Object.values(opf.manifest || {}).find((i) => {
                const props = (i.properties || '').toLowerCase().split(/\s+/);
                return props.includes('nav');
            });

            if (navItem?.href) {
                // Resolve đường tới nav.xhtml tương đối theo OPF
                const navPath = resolveHref(baseDir, navItem.href);

                const navXhtml = await zipStore.read(navPath, 'text');

                // LƯU Ý: baseDir cho NavParser phải là thư mục chứa nav.xhtml
                const navDir = pathDirname(navPath);

                book._navigation = NavParser.parse(navXhtml, navDir);
            } else {
                book._navigation = [];
            }
        } catch (e) {
            console.warn('[M5] Failed to load/parse navigation (toc):', e);
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
}