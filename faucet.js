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

// Samakan User-Agent untuk Browser dan API biar gak dicurigai Cloudflare
const SHARED_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
// ────────────────────────────────────────────────────────

// HTML Template dipasang otomatis dengan Sitekey target
const HTML_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <title>Turnstile Solver</title>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</head>
<body style="background-color: #111; color: white; display: flex; justify-content: center; align-items: center; height: 100vh;">
  <form>
    <div class="cf-turnstile" data-sitekey="${SITEKEY}" data-theme="dark"></div>
  </form>
</body>
</html>`;

function log(msg)  { console.log(`[+] ${msg}`); }
function warn(msg) { console.log(`[!] ${msg}`); }
function err(msg)  { console.log(`[x] ${msg}`); }

async function solveTurnstile() {
  const browser = await chromium.launch({
    executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
    headless: true, // Ubah ke false kalau mau liat proses solve-nya di VNC/X11 Termux
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--disable-blink-features=AutomationControlled' // Tambahan biar makin stealth
    ]
  });

  const context = await browser.newContext({
    userAgent: SHARED_USER_AGENT
  });
  const page = await context.newPage();

  try {
    // Trik: Load HTML bikinan sendiri, bukan web targetnya langsung
    await page.setContent(HTML_TEMPLATE);
    log('Menunggu Turnstile selesai dieksekusi...');

    // Polling token maksimal 45 detik
    let tokenValue = '';
    for (let i = 0; i < 45; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        tokenValue = await page.evaluate(() => {
          const el = document.querySelector('[name="cf-turnstile-response"]');
          return el ? el.value : '';
        });
        if (tokenValue) break;
      } catch (_) {}
    }

    if (!tokenValue) {
      // Ambil screenshot buat bahan debugging kalau gagal
      await page.screenshot({ path: 'screenshot_failed.png' });
      throw new Error('Turnstile token timeout / Gagal disolve otomatis.');
    }
    
    return tokenValue;
  } finally {
    await browser.close();
  }
}

async function claimFaucet(wallet) {
  log(`Mengajukan berkas Turnstile untuk ${wallet}...`);
  const turnstileToken = await solveTurnstile();
  log(`Token sukses didapat! (${turnstileToken.slice(0, 20)}...)`);

  const payload = {
    walletAddress: wallet,
    tokenType: 1,
    claimAmount: '0.1',
    network: 'production',
    turnstileToken
  };

  // Nembak API langsung menggunakan User-Agent yang sama dengan browser
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
    err(`File ${WALLETS_FILE} kagak ketemu bray! Bikin dulu gih.`);
    process.exit(1);
  }

  const lines = fs.readFileSync(WALLETS_FILE, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  log(`Total wallet terdaftar: ${lines.length}`);
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
      err('Baris ngaco!'); process.exit(1);
    }
    wallets = [lines[idx]];
    startLine = idx + 1;
  } else if (pilihan === '2') {
    wallets = lines;
    startLine = 1;
  } else if (pilihan === '3') {
    const baris = await prompt(`Mau mulai dari baris berapa?: `);
    const idx = parseInt(baris) - 1;
    if (isNaN(idx) || idx < 0 || idx >= lines.length) {
      err('Baris ngaco!'); process.exit(1);
    }
    wallets = lines.slice(idx);
    startLine = idx + 1;
  } else {
    err('Pilihan lu gak ada di menu!'); process.exit(1);
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
        log(`MANTEP! Sukses claim. Info: ${JSON.stringify(result.data || result)}`);
      } else {
        warn(`Ditolak sistem: ${JSON.stringify(result)}`);
      }
    } catch (e) {
      err(`Gagal diproses bray: ${e.message}`);
    }

    if (i < wallets.length - 1) {
      log(`Ngerokok dulu... Jeda ${DELAY_MS / 1000} detik biar ga kena limit.\n`);
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  log('Selesai semua bray! Kerja bagus.');
}

main();
