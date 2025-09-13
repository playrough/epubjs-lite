import { Book } from 'https://cdn.jsdelivr.net/gh/playrough/epubjs-lite@v1.0.0/epubjs-lite.esm.js';

console.log('epubjs-lite M1 ready', { Book });

const fileInput = document.getElementById('file');
const viewer = document.getElementById('viewer');
const nextBtn = document.getElementById('next');
const prevBtn = document.getElementById('prev');
let currentRendition = null;

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // M1: chỉ kiểm thử đường đi API. Từ M2 sẽ dùng buffer này để tạo ZipStore.
    const arrayBuffer = await file.arrayBuffer();

    try {
        // M4/M5: mở sách và kiểm thử spine + toc
        const book = await Book.open(arrayBuffer);

        console.log('[M4] book.spine length:', book.spine.length);
        console.log('[M4] first 3 spine items:', book.spine.items.slice(0, 3));

        // (tùy chọn) đọc thử nội dung xhtml đầu tiên qua book.zip
        const firstSpine = book.spine.get(0);
        if (firstSpine?.href) {
            const xhtml = await book.zip.read(firstSpine.href, 'text');
            console.log('[M4] first spine xhtml length:', xhtml.length, 'href:', firstSpine.href);
        }

        // M5: kiểm thử TOC (Nav)
        console.log('[M5] toc length:', book.navigation.length);
        console.log('[M5] first 5 toc items:', book.navigation.slice(0, 5));

        // Đọc thử tài liệu đầu từ TOC (lưu ý: bỏ #hash khi đọc từ zip)
        const firstTocHref = book.navigation[0]?.href;
        const hrefNoHash = firstTocHref ? firstTocHref.split('#')[0] : null;
        if (hrefNoHash) {
            const tocDoc = await book.zip.read(hrefNoHash, 'text');
            console.log('[M5] first toc doc length:', tocDoc.length, 'href:', firstTocHref);
        }

        // Render TOC đơn giản
        const tocContainer = document.getElementById('toc');
        if (tocContainer) {
            tocContainer.innerHTML = '';
            const ul = document.createElement('ul');

            const renderItems = (items, parentUl) => {
                items.forEach(item => {
                    const li = document.createElement('li');
                    const a = document.createElement('a');
                    a.textContent = item.label || '(untitled)';
                    a.href = '#'; // ngăn điều hướng thật, ta handle click
                    a.addEventListener('click', async (ev) => {
                        ev.preventDefault();
                        if (currentRendition) {
                            await currentRendition.display(item.href);
                            console.log('[TOC-click] displayed:', item.href);
                        }
                    });
                    li.appendChild(a);
                    parentUl.appendChild(li);

                    if (item.children?.length) {
                        const childUl = document.createElement('ul');
                        renderItems(item.children, childUl);
                        li.appendChild(childUl);
                    }
                });
            };

            renderItems(book.navigation, ul);
            tocContainer.appendChild(ul);
        }

        const rendition = book.renderTo(viewer, { flow: 'paginated' });
        currentRendition = rendition;
        await rendition.display(0);
    } catch (e) {
        console.error('[M2/M5] Failed to open book or read/parse OPF/TOC', e);
    }
});

nextBtn.addEventListener('click', () => {
    if (currentRendition) currentRendition.next();
    else console.log('[M6] rendition not ready yet');
});

prevBtn.addEventListener('click', () => {
    if (currentRendition) currentRendition.prev();
    else console.log('[M6] rendition not ready yet');
});