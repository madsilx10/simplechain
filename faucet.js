Object.defineProperty(process, 'platform', { get: () => 'linux' });

const { chromium } = require('playwright-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealthPlugin);

const fs = require('fs');
const readline = require('readline');

// ==================== KONFIGURASI BROWSERLESS ====================
// DAFTAR AKUN DI BROWSERLESS.IO UNTUK MENDAPATKAN TOKEN GRATIS
const BROWSERLESS_TOKEN = 'MASUKKAN_TOKEN_BROWSERLESS_LO_DI_SINI'; 
// =================================================================

function readWallets(file) {
  try {
    return fs.readFileSync(file, 'utf-8')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
  } catch (e) {
    console.error(`❌ Gagal membaca file ${file}. Pastiin filenya udah dibuat.`);
    process.exit(1);
  }
}

async function claimFaucet(address) {
  let browser;
  try {
    console.log(`\n[${address}] Menghubungkan ke Cloud Browserless.io...`);
    
    if (BROWSERLESS_TOKEN === 'MASUKKAN_TOKEN_BROWSERLESS_LO_DI_SINI') {
      console.log('❌ Error: Lu belum masukin token Browserless lo di dalam skrip!');
      return;
    }

    // Endpoint WebSocket untuk remote browser di Cloud
    const browserWSEndpoint = `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}&--disable-blink-features=AutomationControlled&--start-maximized`;

    // Connect menggunakan CDP bawaan Playwright
    browser = await chromium.connectOverCDP(browserWSEndpoint);
    
    // Buat context bersih ala Desktop biar lolos Turnstile
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 1000 }, 
      locale: 'en-US'
    });
    
    const page = await context.newPage();
    let capturedResponse = null;

    // Intersepsi network untuk nangkep response claim
    page.on('response', async (response) => {
      if (response.url().includes('/api/front/walletClaimRecord/save')) {
        try {
          capturedResponse = await response.json();
        } catch (_) {}
      }
    });

    console.log(`[${address}] Membuka halaman faucet via Cloud...`);
    await page.goto('https://www.simplechain.com/developer/faucet', { waitUntil: 'commit', timeout: 60000 });
    await page.waitForTimeout(5000);

    // --- BYPASS / KLIK CLOUDFLARE TURNSTILE ---
    console.log(`[${address}] Mengecek Cloudflare Turnstile...`);
    try {
      const turnstileFrame = page.frameLocator('iframe[src*="challenges.cloudflare.com"]');
      const checkbox = turnstileFrame.locator('#challenge-stage, .mark, input[type="checkbox"]');
      
      await checkbox.first().waitFor({ state: 'visible', timeout: 10000 });
      console.log(`[${address}] Turnstile terdeteksi, mencoba mengklik...`);
      await page.waitForTimeout(1500);
      await checkbox.first().click();
      
      await page.waitForTimeout(5000); 
    } catch (e) {
      console.log(`[${address}] ℹ️ Turnstile dilewati (mungkin auto-lolos / tidak muncul).`);
    }

    // --- PROSES FILL ADDRESS ---
    console.log(`[${address}] Mengisi address...`);
    const inputWallet = page.locator('input[placeholder*="SimpleChain"], input[placeholder*="address"], input[type="text"]').first();
    await inputWallet.waitFor({ state: 'visible', timeout: 15000 });
    
    await inputWallet.focus();
    await page.waitForTimeout(500);
    await inputWallet.fill(address);
    await page.waitForTimeout(1000);

    // --- PROSES CLICK SUBMIT (FIXED SELECTION) ---
    console.log(`[${address}] Mencari tombol "Send 0.1 SRW"...`);
    
    // Menggunakan getByText bawaan Playwright untuk mencari teks eksak di tombol toska
    const btn = page.getByText('Send 0.1 SRW').first();
    await btn.waitFor({ state: 'visible', timeout: 15000 });
    
    console.log(`[${address}] Klik submit...`);
    await btn.click({ force: true });

    // Menunggu respons dari API (looping max 15 detik)
    console.log(`[${address}] Menunggu respons API klaim...`);
    for (let i = 0; i < 15; i++) {
      if (capturedResponse) break;
      await page.waitForTimeout(1000);
    }

    // --- VALIDASI HASIL ---
    if (capturedResponse) {
      if (capturedResponse.code === 200 || capturedResponse.success === true) {
        console.log(`[${address}] ✅ Sukses! TxHash: ${capturedResponse.data?.txHash || 'Ok'}`);
      } else {
        console.log(`[${address}] ❌ Gagal dari API: ${JSON.stringify(capturedResponse)}`);
      }
    } else {
      console.log(`[${address}] ⚠️ Gak dapet respons API. Cek apa IP-nya kena limit/cooldown.`);
    }

  } catch (error) {
    console.error(`[${address}] ❌ Error: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
      console.log(`[${address}] Browser di-close, lanjut antrean...`);
    }
  }
}

// ==================== LOGIKA MENU UTAMA ====================
(async () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(res => rl.question(q, res));

  const wallets = readWallets('wallet.txt');
  const total = wallets.length;
  console.log(`Total wallet terdeteksi: ${total}`);

  console.log('\nPilih mode running:');
  console.log('1. Jalankan 1 wallet tertentu');
  console.log('2. Jalankan semua wallet');
  console.log('3. Jalankan mulai dari nomor urut X sampai akhir');
  const mode = (await ask('Pilihan (1/2/3): ')).trim();

  let start = 0, end = total;

  if (mode === '1') {
    const idx = parseInt(await ask(`Nomor urut wallet (1-${total}): `)) - 1;
    start = idx; end = idx + 1;
  } else if (mode === '3') {
    start = parseInt(await ask(`Mulai dari nomor urut (1-${total}): `)) - 1;
  }

  rl.close();

  // Jalankan antrean wallet
  for (let i = start; i < end; i++) {
    if (wallets[i]) {
      await claimFaucet(wallets[i]);
      console.log(`Jeda 5 detik sebelum pindah wallet...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log('\n[SELESAI] Semua proses antrean wallet beres.');
})();
