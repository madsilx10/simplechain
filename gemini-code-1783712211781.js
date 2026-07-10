const fs = require('fs');

// ── Config ──────────────────────────────────────────────
const WALLETS_FILE = 'wallets.txt';
const CLAIM_URL    = 'https://www.simplechain.com/api/front/walletClaimRecord/save';
const DELAY_MS     = 3000; // jeda antar akun (ms)

// Pastikan port 5000 ini sama dengan port yang muncul saat lu jalanin server.py
const SOLVER_API_URL = 'http://127.0.0.1:5000/solve/turnstile'; 
const SITEKEY        = '0x4AAAAAADqBTU2jemlADVj4';
const PAGE_URL       = 'https://www.simplechain.com/developer/faucet';

// User Agent Mobile biar konsisten dan lolos filter
const SHARED_USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
// ────────────────────────────────────────────────────────

function log(msg)  { console.log(`[+] ${msg}`); }
function warn(msg) { console.log(`[!] ${msg}`); }
function err(msg)  { console.log(`[x] ${msg}`); }

// Fungsi buat minta token Turnstile ke server Python
async function getTurnstileTokenViaAPI() {
  log('Meminta token bypass Turnstile dari API Solver...');
  
  try {
    const res = await fetch(SOLVER_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sitekey: SITEKEY,
        url: PAGE_URL
      })
    });

    if (!res.ok) throw new Error(`Solver API Error! Status: ${res.status}`);
    
    const data = await res.json();
    // Mengambil token sesuai format response pada umumnya (token / solution / text)
    const token = data.token || data.solution || data.text;
    
    if (!token) throw new Error('API Solver tidak mengembalikan token yang valid bray.');
    return token;
  } catch (e) {
    throw new Error(`Gagal komunikasi dengan Solver bray: ${e.message}`);
  }
}

async function claimFaucet(wallet) {
  // Ambil token dari solver lokal tanpa buka Chromium
  const turnstileToken = await getTurnstileTokenViaAPI();
  log(`Token sukses didapat via API! (${turnstileToken.slice(0, 20)}...)`);

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