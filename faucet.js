Object.defineProperty(process, 'platform', { get: () => 'linux' });

const { chromium } = require('playwright-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealthPlugin);

const fs = require('fs');
const readline = require('readline');

function readWallets(file) {
  return fs.readFileSync(file, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
}

async function claimFaucet(address) {
  const browser = await chromium.launch({
    executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    console.log(`[${address}] Membuka faucet...`);

    let capturedResponse = null;

    page.on('response', async (response) => {
      if (response.url().includes('/api/front/walletClaimRecord/save')) {
        try {
          capturedResponse = await response.json();
        } catch (_) {}
      }
    });

    await page.goto('https://www.simplechain.com/developer/faucet', { waitUntil: 'load', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(8000);

    console.log(`[${address}] Mengisi address...`);
    await page.waitForSelector('input', { timeout: 30000 });
    await page.fill('input', address);

    console.log(`[${address}] Menunggu Turnstile...`);
    await page.waitForTimeout(8000);

    const btn = await page.$('button[type="submit"]') || await page.$('button');
    if (btn) {
      await btn.click();
      console.log(`[${address}] Klik submit...`);
    }

    await page.waitForTimeout(8000);

    if (capturedResponse) {
      if (capturedResponse.code === 200) {
        console.log(`[${address}] ✅ Sukses! TxHash: ${capturedResponse.data.txHash}`);
      } else {
        console.log(`[${address}] ❌ Gagal: ${JSON.stringify(capturedResponse)}`);
      }
    } else {
      console.log(`[${address}] ⚠️ Tidak ada response dari API`);
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
    await claimFaucet(wallets[i]);
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('Semua wallet selesai.');
})();
