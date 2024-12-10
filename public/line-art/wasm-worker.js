import init from './line-art/pkg/line_art.js';
(async () => {
    const lineArt = await init();
    console.log('init');
    lineArt.startup();
    console.log('startup');
})();