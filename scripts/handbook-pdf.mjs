import { chromium } from 'playwright';
import path from 'node:path';

const [srcHtml, outPdf] = process.argv.slice(2);

const browser = await chromium.launch({ args: ['--use-mock-keychain', '--font-render-hinting=none'] });
const page = await browser.newPage();
await page.goto('file://' + path.resolve(srcHtml), { waitUntil: 'networkidle' });
await page.emulateMedia({ media: 'print' });

const foot = `
<div style="width:100%;font:8pt -apple-system,'Helvetica Neue',Arial,sans-serif;color:#8a807c;
            padding:0 16mm;display:flex;justify-content:space-between;align-items:center;">
  <span style="letter-spacing:.06em;">IITR CAMPUS DASHBOARD · DEVELOPER HANDBOOK</span>
  <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;

const opts = {
  path: outPdf,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: foot,
  margin: { top: '18mm', right: '16mm', bottom: '20mm', left: '16mm' },
};

// `outline` builds the PDF bookmark sidebar from the heading tree and `tagged`
// preserves internal anchor links. Both are recent Playwright options — fall
// back rather than fail if this version predates them.
try {
  await page.pdf({ ...opts, tagged: true, outline: true });
  console.log('rendered with tagged + outline (PDF bookmarks enabled)');
} catch (e) {
  console.warn('outline/tagged unsupported (' + e.message.split('\n')[0] + ') — plain render');
  await page.pdf(opts);
}

await browser.close();
