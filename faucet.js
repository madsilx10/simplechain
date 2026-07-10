Object.defineProperty(process, 'platform', { get: () => 'linux' });

const { chromium } = require('playwright-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');
const axios = require('axios');

chromium.use(stealthPlugin);

// ── Config ──────────────────────────────────────────────
const WALLETS_FILE = 'wallets.txt';
const START_FROM   = parseInt(process.argv[2]) || 1; // node script.js 5 → mulai dari baris ke-5
const SITEKEY      = '0x4AAAAAADqBTU2jemlADVj4';
const PAGE_URL     = 'https://www.simplechain.com/developer/faucet';
const CLAIM_URL    = 'https://www.simplechain.com/api/front/walletClaimRecord/save';
const DELAY_MS     = 3000; // jeda antar akun (ms)
// ────────────────────────────────────────────────────────

const HTML_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</head>
<body>
  <form>
    <div class="cf-turnstile"
         data-sitekey="${SITEKEY}"
         data-theme="dark">
    </div>
  </form>
</body>
</html>`;

function log(msg)  { console.log(`[+] ${msg}`); }
function warn(msg) { console.log(`[!] ${msg}`); }
function err(msg)  { console.log(`[x] ${msg}`); }

async function solveTurnstile() {
  const browser = await chromium.launch({
    executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process'
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    // intercept request ke faucet page, serve fake HTML dengan widget turnstile
    await page.route('https://www.simplechain.com/**', route => {
      route.fulfill({ status: 200, contentType: 'text/html', body: HTML_TEMPLATE });
    });

    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // tunggu token muncul, max 60 detik
    const token = await page.waitForFunction(() => {
      const el = document.querySelector('[name="cf-turnstile-response"]');
      return el && el.value ? el.value : null;
    }, { timeout: 60000 });

    const tokenValue = await token.jsonValue();
    return tokenValue;
  } finally {
    await browser.close();
  }
}

async function claimFaucet(wallet) {
  log(`Solving turnstile untuk ${wallet}...`);
  const turnstileToken = await solveTurnstile();
  log(`Token didapat (${turnstileToken.slice(0, 30)}...)`);

  const payload = {
    walletAddress: wallet,
    tokenType: 1,
    claimAmount: '0.1',
    network: 'production',
    turnstileToken
  };

  const res = await axios.post(CLAIM_URL, payload, {
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://www.simplechain.com',
      'Referer': 'https://www.simplechain.com/developer/faucet',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
      'X-Requested-With': 'XMLHttpRequest'
    }
  });

  return res.data;
}

function prompt(question) {
  return new Promise(resolve => {
    process.stdout.write(question);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');
    process.stdin.once('data', data => {
      process.stdin.pause();
      resolve(data.trim());
    });
  });
}

async function main() {
  const lines = fs.readFileSync(WALLETS_FILE, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  log(`Total wallet di file: ${lines.length}`);
  console.log('');
  console.log('[?] Pilih mode:');
  console.log('  1. Satu akun');
  console.log('  2. Semua akun');
  console.log('  3. Dari baris X sampai akhir');
  console.log('');

  const pilihan = await prompt('Pilihan: ');

  let wallets = [];
  let startLine = 1;

  if (pilihan === '1') {
    const baris = await prompt(`Masukkan nomor baris (1-${lines.length}): `);
    const idx = parseInt(baris) - 1;
    if (isNaN(idx) || idx < 0 || idx >= lines.length) {
      err('Nomor baris tidak valid'); process.exit(1);
    }
    wallets = [lines[idx]];
    startLine = idx + 1;
  } else if (pilihan === '2') {
    wallets = lines;
    startLine = 1;
  } else if (pilihan === '3') {
    const baris = await prompt(`Mulai dari baris: `);
    const idx = parseInt(baris) - 1;
    if (isNaN(idx) || idx < 0 || idx >= lines.length) {
      err('Nomor baris tidak valid'); process.exit(1);
    }
    wallets = lines.slice(idx);
    startLine = idx + 1;
  } else {
    err('Pilihan tidak valid'); process.exit(1);
  }

  console.log('');
  log(`Proses ${wallets.length} akun, mulai baris ${startLine}\n`);

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const lineNo = startLine + i;
    log(`[${lineNo}/${lines.length}] ${wallet}`);

    try {
      const result = await claimFaucet(wallet);
      if (result.code === 200) {
        log(`Sukses! txHash: ${result.data?.txHash}`);
      } else {
        warn(`Gagal: ${JSON.stringify(result)}`);
      }
    } catch (e) {
      err(`Error: ${e.response?.data ? JSON.stringify(e.response.data) : e.message}`);
    }

    if (i < wallets.length - 1) {
      log(`Jeda ${DELAY_MS / 1000}s...\n`);
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  log('Selesai!');
}

main();
