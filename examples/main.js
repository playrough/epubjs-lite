import { Book } from '../dist/epubjs-lite.esm.js';

const fileInput = document.getElementById('file');
const viewer = document.getElementById('viewer');
const nextBtn = document.getElementById('next');
const prevBtn = document.getElementById('prev');
let rendition = null;

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const buffer = await file.arrayBuffer();
    try {
        const book = await Book.open(buffer);
        rendition = book.renderTo(viewer, { flow: 'paginated' });
        await rendition.display(0);
    } catch (err) {
        console.error('Failed to open/display book', err);
    }
});

nextBtn.addEventListener('click', () => { if (rendition) rendition.next(); });
prevBtn.addEventListener('click', () => { if (rendition) rendition.prev(); });