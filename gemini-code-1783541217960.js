Object.defineProperty(process, 'platform', { get: () => 'linux' });

const { chromium } = require('playwright-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealthPlugin);

const fs = require('fs');
const readline = require('readline');

// ==================== KONFIGURASI BROWSERLESS ====================
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

    const browserWSEndpoint = `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}&--disable-blink-features=AutomationControlled&--start-maximized`;
    browser = await chromium.connectOverCDP(browserWSEndpoint);
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36', // Disamakan dengan screenshot lo
      viewport: { width: 1280, height: 1000 }, 
      locale: 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7' // Disamakan dengan Accept-Language lo
    });
    
    const page = await context.newPage();

    console.log(`[${address}] Membuka halaman faucet via Cloud...`);
    await page.goto('https://www.simplechain.com/developer/faucet', { waitUntil: 'networkidle', timeout: 60000 });

    // --- BYPASS / KLIK CLOUDFLARE TURNSTILE ---
    console.log(`[${address}] Mengecek Cloudflare Turnstile...`);
    try {
      const turnstileFrame = page.frameLocator('iframe[src*="challenges.cloudflare.com"]');
      const checkbox = turnstileFrame.locator('#challenge-stage, .mark, input[type="checkbox"]');
      
      await checkbox.first().waitFor({ state: 'visible', timeout: 15000 });
      console.log(`[${address}] Turnstile ditemukan, mencoba mengklik...`);
      await page.waitForTimeout(1000);
      await checkbox.first().click();
    } catch (e) {
      console.log(`[${address}] ℹ️ Turnstile dilewati.`);
    }

    // --- TUNGGU TOKEN TURNSTILE DIGENERATE WEB ---
    console.log(`[${address}] Memastikan token Turnstile ter-inject ke sistem...`);
    await page.waitForTimeout(6000); // Beri jeda mutlak biar dapet token kayak di screenshot "1.xyG..."

    // --- PROSES FILL ADDRESS ---
    console.log(`[${address}] Mengisi address...`);
    const inputWallet = page.locator('input[placeholder*="SimpleChain"], input[placeholder*="address"], input[type="text"]').first();
    await inputWallet.waitFor({ state: 'visible', timeout: 10000 });
    await inputWallet.fill(address);
    await page.waitForTimeout(1000);

    // --- PROSES CLICK SUBMIT & MELEPAS JARING RESPONS ---
    console.log(`[${address}] Klik "Send 0.1 SRW" dan mengunci API...`);
    const btn = page.getByText('Send 0.1 SRW').first();
    
    // Kita tangkap langsung secara global apa pun respons dari target URL tanpa filter ketat
    const [response] = await Promise.all([
      page.waitForResponse(res => res.url().includes('walletClaimRecord/save'), { timeout: 30000 }).catch(() => null),
      btn.click({ force: true })
    ]);

    // --- VALIDASI RESPONS BERDASARKAN SCREENSHOT KE-3 ---
    if (response) {
      const status = response.status();
      console.log(`[${address}] 🌐 HTTP Status Terdeteksi: ${status}`);
      try {
        const resJson = await response.json();
        // Sesuai isi screenshot: code 200 atau message "操作成功"
        if (resJson.code === 200 || resJson.message?.includes('成功')) {
          console.log(`[${address}] ✅ SUKSES KLAIM! TxHash: ${resJson.data?.txHash || 'Berhasil'}`);
        } else {
          console.log(`[${address}] ❌ Gagal dari Sistem Web: ${JSON.stringify(resJson)}`);
        }
      } catch (_) {
        const raw = await response.text();
        console.log(`[${address}] ❌ Gagal parse JSON. Respon teks: ${raw.substring(0, 150)}`);
      }
    } else {
      console.log(`[${address}] ⚠️ Tetap tidak mendapat respons jaringan. Fix, Cloudflare memblokir klik dari Server Cloud Browserless.`);
    }

  } catch (error) {
    console.error(`[${address}] ❌ Error: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
      console.log(`[${address}] Browser di-close, lanjut...`);
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

  for (let i = start; i < end; i++) {
    if (wallets[i]) {
      await claimFaucet(wallets[i]);
      console.log(`Jeda 5 detik sebelum pindah wallet...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  console.log('\n[SELESAI] Semua proses antrean wallet beres.');
})();