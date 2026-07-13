Object.defineProperty(process, 'platform', { get: () => 'linux' });

const fs = require('fs');
const { chromium } = require('playwright-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealthPlugin);

// ── Config ──────────────────────────────────────────────
const WALLETS_FILE = 'wallets.txt';
const CLAIM_URL    = 'https://www.simplechain.com/api/front/walletClaimRecord/save';
const PAGE_URL     = 'https://www.simplechain.com/developer/faucet';
const DELAY_MS     = 5000;
const SHARED_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
// ────────────────────────────────────────────────────────

function log(msg)  { console.log(`[+] ${msg}`); }
function warn(msg) { console.log(`[!] ${msg}`); }
function err(msg)  { console.log(`[x] ${msg}`); }

async function getTurnstileToken() {
  log('Membuka browser buat solve Turnstile...');

  const browser = await chromium.launch({
    executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--no-zygote',
      '--disable-extensions',
      '--mute-audio'
    ]
  });

  const context = await browser.newContext({ userAgent: SHARED_USER_AGENT });
  const page = await context.newPage();

  try {
    await page.goto(PAGE_URL, { waitUntil: 'networkidle', timeout: 60000 });
    log('Halaman terbuka, nunggu Turnstile solve...');

    // Tunggu token Turnstile muncul (max 30 detik)
    const token = await page.waitForFunction(() => {
      const el = document.querySelector('[name="cf-turnstile-response"]');
      return el && el.value.length > 0 ? el.value : null;
    }, { timeout: 30000 });

    const tokenValue = await token.jsonValue();
    log(`Token didapat! (${tokenValue.slice(0, 20)}...)`);
    return tokenValue;

  } finally {
    await browser.close();
  }
}

async function claimFaucet(wallet) {
  const turnstileToken = await getTurnstileToken();

  const payload = {
    walletAddress: wallet,
    tokenType: 1,
    claimAmount: '0.1',
    network: 'production',
    turnstileToken
  };

  const res = await fetch(CLAIM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://www.simplechain.com',
      'Referer': PAGE_URL,
      'User-Agent': SHARED_USER_AGENT,
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error(`HTTP Error! Status: ${res.status}`);
  return res.json();
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
  if (!fs.existsSync(WALLETS_FILE)) {
    err(`File ${WALLETS_FILE} kagak ketemu bray! Bikin dulu file-nya.`);
    process.exit(1);
  }

  const lines = fs.readFileSync(WALLETS_FILE, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  log(`Total wallet terdeteksi: ${lines.length}`);
  console.log('\n[?] Pilih Mode Eksekusi:');
  console.log('  1. Satu akun aja');
  console.log('  2. Sikat semua akun');
  console.log('  3. Mulai dari baris tertentu');
  console.log('');

  const pilihan = await prompt('Pilihan lu (1/2/3): ');

  let wallets = [];
  let startLine = 1;

  if (pilihan === '1') {
    const baris = await prompt(`Masukkan nomor baris (1-${lines.length}): `);
    const idx = parseInt(baris) - 1;
    if (isNaN(idx) || idx < 0 || idx >= lines.length) {
      err('Baris ngaco bray!'); process.exit(1);
    }
    wallets = [lines[idx]];
    startLine = idx + 1;
  } else if (pilihan === '2') {
    wallets = lines;
    startLine = 1;
  } else if (pilihan === '3') {
    const baris = await prompt(`Mau mulai dari baris berapa bray?: `);
    const idx = parseInt(baris) - 1;
    if (isNaN(idx) || idx < 0 || idx >= lines.length) {
      err('Baris ngaco bray!'); process.exit(1);
    }
    wallets = lines.slice(idx);
    startLine = idx + 1;
  } else {
    err('Pilihan lu gak terdaftar di menu bray!'); process.exit(1);
  }

  console.log('');
  log(`Memproses ${wallets.length} akun, dimulai dari baris ke-${startLine}\n`);

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const lineNo = startLine + i;
    log(`[Progress ${lineNo}/${lines.length}] Wallet: ${wallet}`);

    try {
      const result = await claimFaucet(wallet);
      if (result.code === 200 || result.success === true) {
        log(`MANTEP! Sukses claim. Detail: ${JSON.stringify(result.data || result)}`);
      } else {
        warn(`Ditolak sistem faucet: ${JSON.stringify(result)}`);
      }
    } catch (e) {
      err(`Gagal diproses bray: ${e.message}`);
    }

    if (i < wallets.length - 1) {
      log(`Jeda ${DELAY_MS / 1000} detik biar gak ke-detect spam...\n`);
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  log('Selesai semua bray! Mantap.');
}

main();
