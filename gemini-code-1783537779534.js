Object.defineProperty(process, 'platform', { get: () => 'linux' });

const { chromium } = require('playwright-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealthPlugin);

const fs = require('fs');
const readline = require('readline');

function readWallets(file) {
  try {
    return fs.readFileSync(file, 'utf-8')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
  } catch (e) {
    console.error(`❌ Gagal membaca file ${file}. Pastiin filenya ada.`);
    process.exit(1);
  }
}

async function claimFaucet(address) {
  const browser = await chromium.launch({
    executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
    headless: true, // Ubah ke false kalau lo pake VNC/X11 di Termux biar keliatan
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--blink-settings=imagesEnabled=true' // Turnstile butuh render gambar/canvas kadang
    ]
  });

  // Buat context dengan custom viewport & locale biar makin mirip manusia
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    locale: 'id-ID'
  });
  
  const page = await context.newPage();

  try {
    console.log(`\n[${address}] Membuka faucet...`);

    let capturedResponse = null;

    page.on('response', async (response) => {
      if (response.url().includes('/api/front/walletClaimRecord/save')) {
        try {
          capturedResponse = await response.json();
        } catch (_) {}
      }
    });

    // Pindah ke url tujuan
    await page.goto('https://www.simplechain.com/developer/faucet', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    // --- PROSES MENANGANI TURNSTILE ---
    console.log(`[${address}] Mengecek Cloudflare Turnstile...`);
    try {
      // Cari iframe milik Cloudflare Turnstile
      const turnstileFrame = page.frameLocator('iframe[src*="challenges.cloudflare.com"]');
      const checkbox = turnstileFrame.locator('#challenge-stage, .mark, input[type="checkbox"]');
      
      // Tunggu sampai checkbox turnstile muncul (max 15 detik)
      await checkbox.first().waitFor({ state: 'visible', timeout: 15000 });
      console.log(`[${address}] Turnstile ditemukan, mencoba bypass/klik...`);
      await page.waitForTimeout(2000);
      await checkbox.first().click();
      await page.waitForTimeout(5000); // Tunggu proses verifikasi selesai
    } catch (e) {
      console.log(`[${address}] ℹ️ Turnstile tidak muncul/sudah auto-lolos.`);
    }

    // --- PROSES INPUT WALLET ADDRESS ---
    console.log(`[${address}] Mengisi address...`);
    // Menggunakan selector yang lebih spesifik agar tidak bentrok dengan input Turnstile
    const inputWallet = page.locator('input[type="text"], input[placeholder*="address"], input').first();
    await inputWallet.waitFor({ state: 'visible', timeout: 15000 });
    
    await inputWallet.focus();
    await page.waitForTimeout(500);
    // Ketik manual per karakter biar gak kedetect instan bot
    await inputWallet.fill(address); 
    await page.waitForTimeout(1000);

    // --- PROSES SUBMIT ---
    const btn = page.locator('button[type="submit"], button:has-text("Submit"), button:has-text("Claim")').first();
    await btn.waitFor({ state: 'visible', timeout: 10000 });
    
    console.log(`[${address}] Klik submit...`);
    await btn.click();

    // Tunggu respons API maksimal 15 detik
    for (let i = 0; i < 15; i++) {
      if (capturedResponse) break;
      await page.waitForTimeout(1000);
    }

    if (capturedResponse) {
      if (capturedResponse.code === 200 || capturedResponse.success === true) {
        console.log(`[${address}] ✅ Sukses! TxHash: ${capturedResponse.data?.txHash || 'Ok'}`);
      } else {
        console.log(`[${address}] ❌ Gagal dari API: ${JSON.stringify(capturedResponse)}`);
      }
    } else {
      console.log(`[${address}] ⚠️ Tidak ada response dari API (Cek apakah IP/Wallet limit)`);
    }

  } catch (error) {
    console.error(`[${address}] ❌ Error: ${error.message}`);
  } finally {
    await browser.close();
  }
}

(async () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(res => rl.question(q, res));

  const wallets = readWallets('wallet.txt');
  const total = wallets.length;
  console.log(`Total wallet: ${total}`);

  console.log('\nPilih mode:');
  console.log('1. 1 wallet tertentu');
  console.log('2. Semua wallet');
  console.log('3. Dari wallet X sampai akhir');
  const mode = (await ask('Pilihan (1/2/3): ')).trim();

  let start = 0, end = total;

  if (mode === '1') {
    const idx = parseInt(await ask(`Nomor wallet (1-${total}): `)) - 1;
    start = idx; end = idx + 1;
  } else if (mode === '3') {
    start = parseInt(await ask(`Mulai dari wallet nomor (1-${total}): `)) - 1;
  }

  rl.close();

  for (let i = start; i < end; i++) {
    if (wallets[i]) {
      await claimFaucet(wallets[i]);
      // Kasih jeda waktu antar wallet lebih lama dikit biar gak dicurigai spamming IP
      console.log(`Menunggu 5 detik sebelum wallet berikutnya...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log('\nSemua wallet selesai.');
})();