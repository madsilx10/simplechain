Object.defineProperty(process, 'platform', { get: () => 'linux' });

const { chromium } = require('playwright-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');

chromium.use(stealthPlugin);

// ── Config ──────────────────────────────────────────────
const WALLETS_FILE = 'wallets.txt';
const SITEKEY      = '0x4AAAAAADqBTU2jemlADVj4';
const CLAIM_URL    = 'https://www.simplechain.com/api/front/walletClaimRecord/save';
const DELAY_MS     = 3000; // jeda antar akun (ms)

// Pake User Agent Chrome Mobile asli biar dikira beneran pake HP bray
const SHARED_USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
// ────────────────────────────────────────────────────────

function log(msg)  { console.log(`[+] ${msg}`); }
function warn(msg) { console.log(`[!] ${msg}`); }
function err(msg)  { console.log(`[x] ${msg}`); }

async function solveTurnstile() {
  const browser = await chromium.launch({
    executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
    headless: true, // Tetap di latar belakang
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--disable-blink-features=AutomationControlled',
      '--ignore-certificate-errors',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });

  const context = await browser.newContext({
    userAgent: SHARED_USER_AGENT,
    viewport: { width: 375, height: 667 }, // Set ukuran layar HP standar biar gak dicurigai bot
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();

  try {
    // Blokir cuma gambar, font, dan iklan/analytics. CSS WAJIB masuk biar turnstile kagak error.
    await page.route('**/*', route => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media'].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    log('Membuka halaman faucet asli...');
    
    // Buka halaman faucet
    await page.goto('https://www.simplechain.com/developer/faucet', { 
      waitUntil: 'networkidle', // Tunggu sampai jaringan agak tenang biar tokennya ke-load
      timeout: 60000 
    });

    log('Menunggu Turnstile memproses token otomatis (Max 45 detik)...');

    let tokenValue = '';
    // Polling token pelan-pelan
    for (let i = 0; i < 45; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        tokenValue = await page.evaluate(() => {
          const el = document.querySelector('[name="cf-turnstile-response"]');
          return el ? el.value : '';
        });
        if (tokenValue) break;
      } catch (_) {
        break; 
      }
    }

    if (!tokenValue) {
      throw new Error('Cloudflare mendeteksi bot / minta klik manual. Coba ganti jaringan (pake kuota HP/VPN).');
    }
    
    return tokenValue;
  } finally {
    try { await browser.close(); } catch(_) {}
  }
}

async function claimFaucet(wallet) {
  log(`Memulai proses Turnstile untuk ${wallet}...`);
  const turnstileToken = await solveTurnstile();
  log(`Token sukses didapat! (${turnstileToken.slice(0, 20)}...)`);

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
      'Referer': 'https://www.simplechain.com/developer/faucet',
      'User-Agent': SHARED_USER_AGENT,
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error(`HTTP Error! Status: ${res.status}`);
  }

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
    err(`File ${WALLETS_FILE} kagak ada bray! Bikin dulu file-nya.`);
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