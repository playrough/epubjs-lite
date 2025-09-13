// ZipStore là adapter bọc JSZip để core không phụ thuộc trực tiếp vào thư viện bên ngoài.
// Ở M2: chỉ hỗ trợ load từ ArrayBuffer và đọc file theo href.
// Lưu ý: JSZip phải có sẵn (qua CDN -> window.JSZip, hoặc truyền vào options).

export class ZipStore {
    constructor(jszip) {
        this._zip = jszip; // instance JSZip đã load
    }

    // Tạo ZipStore từ ArrayBuffer chứa .epub (zip)
    // Ưu tiên lấy JSZip từ options; nếu không có, dùng window.JSZip (CDN).
    static async fromArrayBuffer(buffer, options = {}) {
        const JSZipImpl = options.JSZip || (typeof window !== 'undefined' ? window.JSZip : undefined);
        if (!JSZipImpl) {
            throw new Error('JSZip is not available. Provide options.JSZip or include it via CDN.');
        }
        const zip = await JSZipImpl.loadAsync(buffer);
        return new ZipStore(zip);
    }

    // Đọc file trong zip theo href.
    // Ở M2: trả về text theo mặc định. (Sẽ tinh chỉnh theo MIME ở các bước sau)
    async read(href, as = 'text') {
        const file = this._zip.file(href);
        if (!file) {
            throw new Error(`File not found in zip: ${href}`);
        }

        // JSZip async types: 'string', 'text', 'binarystring', 'arraybuffer', 'uint8array', 'blob', 'nodebuffer'
        if (as === 'text' || as === 'string') {
            return await file.async('text');
        }
        if (as === 'uint8array') {
            return await file.async('uint8array');
        }
        if (as === 'arraybuffer') {
            return await file.async('arraybuffer');
        }
        if (as === 'blob') {
            return await file.async('blob');
        }

        // Mặc định: text
        return await file.async('text');
    }
}