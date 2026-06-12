const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = process.env.OWNER_ID; // your telegram user id, for log streaming

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN environment variable not set!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

const TMP_DIR = path.join(__dirname, 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

// ===== Logger =====
// Sends real-time logs to console AND to owner's telegram chat (if OWNER_ID set)
async function log(ctx, msg, level = 'info') {
  const time = new Date().toISOString().split('T')[1].split('.')[0];
  const icons = { info: 'ℹ️', success: '✅', error: '❌', warn: '⚠️', step: '🔹' };
  const line = `${icons[level] || 'ℹ️'} [${time}] ${msg}`;
  console.log(line);

  // Send to current chat (live status updates)
  if (ctx) {
    try {
      await ctx.reply(line);
    } catch (e) {
      console.error('Failed to send log to chat:', e.message);
    }
  }

  // Also mirror to owner if configured and different from current chat
  if (OWNER_ID && (!ctx || String(ctx.chat.id) !== String(OWNER_ID))) {
    try {
      await bot.telegram.sendMessage(OWNER_ID, line);
    } catch (e) {
      console.error('Failed to send log to owner:', e.message);
    }
  }
}

// ===== The hook script injected into the page before any script runs =====
const HOOK_SCRIPT = `
window._decodedCode = [];

// 1. eval() hook
const _origEval = window.eval;
window.eval = function(code) {
  try {
    if (typeof code === 'string' && code.length > 50) {
      window._decodedCode.push(code);
    }
  } catch (e) {}
  return _origEval.apply(this, arguments);
};

// 2. Function constructor hook
const _origFunc = Function;
window.Function = function(...args) {
  try {
    const code = args[args.length - 1];
    if (typeof code === 'string' && code.length > 50) {
      window._decodedCode.push(code);
    }
  } catch (e) {}
  return _origFunc.apply(this, args);
};
Function.prototype = _origFunc.prototype;

// 3. String.fromCharCode hook
const _origFromChar = String.fromCharCode;
String.fromCharCode = function(...args) {
  const result = _origFromChar.apply(String, args);
  try {
    if (result.length > 100 && /function|var |const |let /.test(result)) {
      window._decodedCode.push(result);
    }
  } catch (e) {}
  return result;
};

// 4. decodeURIComponent hook
const _origDecode = decodeURIComponent;
window.decodeURIComponent = function(str) {
  const result = _origDecode.apply(this, arguments);
  try {
    if (result.length > 100 && /function|var |const |let /.test(result)) {
      window._decodedCode.push(result);
    }
  } catch (e) {}
  return result;
};
`;

// ===== Core decode function =====
async function decodeHtmlFile(inputPath, ctx) {
  await log(ctx, 'Launching headless browser (Chromium)...', 'step');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  await log(ctx, 'Browser launched successfully.', 'success');

  const page = await browser.newPage();

  // Capture page console logs and errors -> forward as real-time logs
  page.on('console', async (msg) => {
    const text = msg.text();
    await log(ctx, `Page console: ${text.slice(0, 300)}`, 'info');
  });

  page.on('pageerror', async (err) => {
    await log(ctx, `Page JS error: ${err.message.slice(0, 300)}`, 'warn');
  });

  page.on('error', async (err) => {
    await log(ctx, `Page crashed: ${err.message}`, 'error');
  });

  try {
    await log(ctx, 'Injecting decode hooks (eval, Function, fromCharCode, decodeURIComponent)...', 'step');
    await page.evaluateOnNewDocument(HOOK_SCRIPT);

    const fileUrl = 'file://' + path.resolve(inputPath);
    await log(ctx, `Loading target file: ${path.basename(inputPath)}`, 'step');

    await page.goto(fileUrl, { waitUntil: 'load', timeout: 30000 }).catch(async (e) => {
      await log(ctx, `Page load warning (continuing anyway): ${e.message}`, 'warn');
    });

    await log(ctx, 'Page loaded. Waiting for VM to execute and decode...', 'step');

    // Wait a bit for async/obfuscated code to run
    await new Promise(r => setTimeout(r, 6000));

    await log(ctx, 'Collecting captured decoded segments...', 'step');

    const captured = await page.evaluate(() => window._decodedCode || []);
    const bodyHtml = await page.evaluate(() => document.body.innerHTML);

    await log(ctx, `Captured ${captured.length} decoded code segment(s).`, captured.length > 0 ? 'success' : 'warn');

    await browser.close();
    await log(ctx, 'Browser closed.', 'step');

    if (captured.length === 0) {
      return { success: false, reason: 'no_capture' };
    }

    const cleanJS = captured
      .filter(c => c.length > 20)
      .join('\n\n// ==================\n\n');

    const cleanBody = bodyHtml.replace(/<script[\s\S]*?<\/script>/gi, '');

    const outputHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Decoded Page</title>
</head>
<body>

<!-- Original HTML (without obfuscated scripts) -->
${cleanBody}

<!-- Decoded JavaScript -->
<script>
// ======= DECODED BY VM HOOK BOT =======
// Total captured segments: ${captured.length}

${cleanJS}
</script>
</body>
</html>`;

    return { success: true, html: outputHtml, count: captured.length };

  } catch (err) {
    await browser.close().catch(() => {});
    await log(ctx, `Fatal error during decode: ${err.message}`, 'error');
    return { success: false, reason: 'error', error: err.message };
  }
}

// ===== Bot handlers =====

bot.start((ctx) => {
  ctx.reply(
    '👋 VM Decoder Bot\n\n' +
    'Send me an obfuscated .html file and I\'ll try to decode it using runtime hooks (eval/Function/decodeURIComponent/fromCharCode).\n\n' +
    'You\'ll see real-time logs as it processes.'
  );
});

bot.on('document', async (ctx) => {
  const doc = ctx.message.document;

  if (!doc.file_name.toLowerCase().endsWith('.html') && !doc.file_name.toLowerCase().endsWith('.htm')) {
    return ctx.reply('❌ Please send an .html or .htm file.');
  }

  if (doc.file_size > 5 * 1024 * 1024) {
    return ctx.reply('❌ File too large (max 5MB).');
  }

  const sessionId = Date.now();
  const inputPath = path.join(TMP_DIR, `input_${sessionId}.html`);
  const outputPath = path.join(TMP_DIR, `decoded_${sessionId}.html`);

  try {
    await log(ctx, `Received file: ${doc.file_name} (${(doc.file_size / 1024).toFixed(1)} KB)`, 'info');
    await log(ctx, 'Downloading file from Telegram...', 'step');

    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    const res = await fetch(fileLink.href);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(inputPath, buffer);

    await log(ctx, 'File downloaded. Starting decode process...', 'success');

    const result = await decodeHtmlFile(inputPath, ctx);

    if (!result.success) {
      if (result.reason === 'no_capture') {
        await log(ctx, 'No eval/Function/decode activity was captured. This VM may use a different obfuscation method, or it needs more wait time.', 'error');
      } else {
        await log(ctx, `Decode failed: ${result.error || 'unknown error'}`, 'error');
      }
      return;
    }

    fs.writeFileSync(outputPath, result.html);

    await log(ctx, `Decode successful! ${result.count} segment(s) captured. Sending file...`, 'success');

    await ctx.replyWithDocument({ source: outputPath, filename: `decoded_${doc.file_name}` });

    await log(ctx, 'Done. ✅', 'success');

  } catch (err) {
    await log(ctx, `Unexpected error: ${err.message}`, 'error');
  } finally {
    // Cleanup
    [inputPath, outputPath].forEach(p => {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
  }
});

bot.on('text', (ctx) => {
  ctx.reply('📎 Please send an .html file as a document (not as text).');
});

bot.launch();
console.log('🤖 Bot started successfully.');

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
