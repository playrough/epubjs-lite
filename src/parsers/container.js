// ContainerParser: đọc META-INF/container.xml để tìm OPF rootfile.
// Trả về đường dẫn OPF (full-path).
export class ContainerParser {
    static async fromZip(zipStore) {
        // EPUB quy định container.xml nằm tại META-INF/container.xml
        const xml = await zipStore.read('META-INF/container.xml', 'text');

        // Parse XML bằng DOMParser có sẵn của browser (vanilla JS)
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'application/xml');

        // Kiểm tra lỗi parse (trường hợp XML hỏng)
        const parserError = doc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            throw new Error('Failed to parse container.xml');
        }

        // Tìm tất cả rootfile, ưu tiên media-type = application/oebps-package+xml
        // Dùng cả getElementsByTagNameNS để an toàn với namespace khác nhau.
        let rootfiles = Array.from(doc.getElementsByTagName('rootfile'));
        if (rootfiles.length === 0 && doc.getElementsByTagNameNS) {
            rootfiles = Array.from(doc.getElementsByTagNameNS('*', 'rootfile'));
        }

        if (rootfiles.length === 0) {
            throw new Error('No <rootfile> found in container.xml');
        }

        const preferred = rootfiles.find(
            (el) => el.getAttribute('media-type') === 'application/oebps-package+xml'
        );
        const chosen = preferred || rootfiles[0];

        const fullPath = chosen.getAttribute('full-path');
        if (!fullPath) {
            throw new Error('Missing full-path attribute in container.xml rootfile');
        }

        return fullPath; // ví dụ: "OEBPS/content.opf"
    }
}