# epubjs-lite

Minimal EPUB3 reader library (vanilla JS) inspired by epub.js. Focus on reflowable EPUB3, with a simple architecture: Book, Spine, Rendition, and parsers for container.xml, OPF, and Navigation Document.

## Features (current)
- Load `.epub` from ArrayBuffer via JSZip (provided by user/CDN).
- Parse container.xml, OPF (metadata/manifest/spine), and NAV (TOC).
- Spine normalization of hrefs relative to OPF directory.
- Basic rendition: render XHTML in an iframe, inline CSS, rewrite images/fonts via Blob URLs.
- TOC with `#fragment` scroll support.
- Skip `linear="no"` spine items for next/prev.

## Install / Usage

This project is ESM-only (no build step). Use directly in browser or via bundlers.

### Browser (no bundler)
```html
<script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
<script type="module">
  import { Book } from './src/index.js';

  const input = document.querySelector('#file');
  const viewer = document.querySelector('#viewer');
  let rendition;

  input.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();

    // Provide JSZip via options if not on window
    const book = await Book.open(buffer /*, { JSZip: window.JSZip } */);
    rendition = book.renderTo(viewer, { flow: 'paginated' });
    await rendition.display(); // first linear spine item
  });
</script>
```