// src/utils/path.js
// Chuẩn hoá path theo chuẩn “/” trong zip (EPUB), không dính hệ điều hành.

export function dirname(path) {
    const idx = path.lastIndexOf('/');
    return idx === -1 ? '' : path.slice(0, idx + 1); // giữ dấu '/'
}

// Resolve href tương đối theo baseDir bằng URL resolver.
// Trả về path không có leading '/', và giữ nguyên hash nếu có (nếu muốn).
export function resolveHref(baseDir, href, { keepHash = false } = {}) {
    if (!href) return '';
    if (href.startsWith('/')) {
        // Xem như từ root zip -> bỏ leading '/'
        return decodeURIComponent(href.slice(1));
    }
    const url = new URL(href, 'http://x/' + (baseDir || ''));
    const path = decodeURIComponent(url.pathname.slice(1));
    return keepHash ? (path + (url.hash || '')) : path;
}