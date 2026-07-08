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
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/126.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      locale: 'en-US'
    });
    
    const page = await context.newPage();
    let capturedResponse = null;

    // Intersepsi network untuk nangkep response claim[cite: 1]
    page.on('response', async (response) => {
      if (response.url().includes('/api/front/walletClaimRecord/save')) {[cite: 1]
        try {
          capturedResponse = await response.json();[cite: 1]
        } catch (_) {}
      }
    });

    console.log(`[${address}] Membuka halaman faucet via Cloud...`);
    // Menggunakan 'commit' supaya gak kena ERR_ABORTED di awal oleh Cloudflare[cite: 1]
    await page.goto('https://www.simplechain.com/developer/faucet', { waitUntil: 'commit', timeout: 60000 });[cite: 1]
    await page.waitForTimeout(5000);[cite: 1]

    // --- BYPASS / KLIK CLOUDFLARE TURNSTILE ---
    console.log(`[${address}] Mengecek Cloudflare Turnstile...`);
    try {
      const turnstileFrame = page.frameLocator('iframe[src*="challenges.cloudflare.com"]');
      const checkbox = turnstileFrame.locator('#challenge-stage, .mark, input[type="checkbox"]');
      
      // Tunggu box Turnstile muncul selama 10 detik
      await checkbox.first().waitFor({ state: 'visible', timeout: 10000 });
      console.log(`[${address}] Turnstile terdeteksi, mencoba mengklik...`);
      await page.waitForTimeout(1500);
      await checkbox.first().click();
      
      // Kasih jeda biar Cloudflare nyelesaiin verifikasinya
      await page.waitForTimeout(5000); 
    } catch (e) {
      console.log(`[${address}] ℹ️ Turnstile dilewati (mungkin auto-lolos / tidak muncul).`);
    }

    // --- PROSES FILL ADDRESS ---
    console.log(`[${address}] Mengisi address...`);[cite: 1]
    // Nyari input teks yang spesifik (biar gak salah input ke elemen Turnstile)
    const inputWallet = page.locator('input[type="text"], input[placeholder*="address"], input').first();
    await inputWallet.waitFor({ state: 'visible', timeout: 15000 });[cite: 1]
    
    await inputWallet.focus();
    await page.waitForTimeout(500);
    await inputWallet.fill(address);[cite: 1]
    await page.waitForTimeout(1000);[cite: 1]

    // --- PROSES CLICK SUBMIT ---
    const btn = page.locator('button[type="submit"], button:has-text("Submit"), button:has-text("Claim")').first();
    await btn.waitFor({ state: 'visible', timeout: 10000 });
    
    console.log(`[${address}] Klik submit...`);[cite: 1]
    await btn.click();[cite: 1]

    // Menunggu respons dari API (looping max 15 detik)
    for (let i = 0; i < 15; i++) {
      if (capturedResponse) break;
      await page.waitForTimeout(1000);
    }

    // --- VALIDASI HASIL ---
    if (capturedResponse) {[cite: 1]
      if (capturedResponse.code === 200 || capturedResponse.success === true) {[cite: 1]
        console.log(`[${address}] ✅ Sukses! TxHash: ${capturedResponse.data?.txHash || 'Ok'}`);[cite: 1]
      } else {
        console.log(`[${address}] ❌ Gagal dari API: ${JSON.stringify(capturedResponse)}`);[cite: 1]
      }
    } else {
      console.log(`[${address}] ⚠️ Gak dapet respons API. Cek apa IP-nya kena limit/cooldown.`);[cite: 1]
    }

  } catch (error) {
    console.error(`[${address}] ❌ Error: ${error.message}`);[cite: 1]
  } finally {
    if (browser) {
      // WAJIB ditiup biar kuota waktu gratisan Browserless lo ga jalan terus!
      await browser.close();[cite: 1]
      console.log(`[${address}] Browser di-close, lanjut antrean...`);
    }
  }
}

// ==================== LOGIKA MENU UTAMA ====================
(async () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });[cite: 1]
  const ask = (q) => new Promise(res => rl.question(q, res));[cite: 1]

  const wallets = readWallets('wallet.txt');[cite: 1]
  const total = wallets.length;[cite: 1]
  console.log(`Total wallet terdeteksi: ${total}`);[cite: 1]

  console.log('\nPilih mode running:');[cite: 1]
  console.log('1. Jalankan 1 wallet tertentu');[cite: 1]
  console.log('2. Jalankan semua wallet');[cite: 1]
  console.log('3. Jalankan mulai dari nomor urut X sampai akhir');[cite: 1]
  const mode = (await ask('Pilihan (1/2/3): ')).trim();[cite: 1]

  let start = 0, end = total;[cite: 1]

  if (mode === '1') {[cite: 1]
    const idx = parseInt(await ask(`Nomor urut wallet (1-${total}): `)) - 1;[cite: 1]
    start = idx; end = idx + 1;[cite: 1]
  } else if (mode === '3') {[cite: 1]
    start = parseInt(await ask(`Mulai dari nomor urut (1-${total}): `)) - 1;[cite: 1]
  }

  rl.close();[cite: 1]

  // Jalankan antrean wallet
  for (let i = start; i < end; i++) {[cite: 1]
    if (wallets[i]) {
      await claimFaucet(wallets[i]);[cite: 1]
      console.log(`Jeda 5 detik sebelum pindah wallet...`);
      await new Promise(r => setTimeout(r, 5000));[cite: 1]
    }
  }

  console.log('\n[SELESAI] Semua proses antrean wallet beres.');[cite: 1]
})();
