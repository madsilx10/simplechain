require("dotenv").config();
const { ethers } = require("ethers");
const readline = require("readline");

// ==================== CONFIG ====================
const ALL_WALLETS = [];
if (process.env.PK_FIRST) ALL_WALLETS.push({ name: "FIRST", pk: process.env.PK_FIRST.trim() });
let i = 1;
while (process.env[`PK_${i}`]) {
  ALL_WALLETS.push({ name: `ALT_${i}`, pk: process.env[`PK_${i}`].trim() });
  i++;
}

if (ALL_WALLETS.length === 0) {
  console.error("❌ Tidak ada PK ditemukan di .env!");
  process.exit(1);
}

const BASE_URL = "https://task.simplechain.com/api/v1";
const RPC_URL = "https://prod-simple-abroad.qukuaicunzheng.top/rpc/";
const CHAIN_ID = 1913;
const DELAY = 2000;

const WSRW    = "0xec1bF294Ea5b3271A87606B51F5465352bc19bE5";
const MERCURY = "0x8c0c42fD298623d035eeFd8b2783c94069610d2B";
const MARS    = "0xFC12Ae35889A4a6D0b1cE94a6675Ef869F6eb207";

const SWAP_ROUTER     = "0x43b06d73dC0dDB9214B28349a913A2b7FAAFCEe8";
const LIQUIDITY_ROUTER = "0x6E172Ba709487fd0Dc47D8A23e128C0328E0646c";

const FEE_TIER  = 3000;
const SWAP_MIN  = ethers.parseEther("0.0001");
const SWAP_MAX  = ethers.parseEther("0.005");
const SWAP_COUNT = 5;

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address owner) external view returns (uint256)",
];

const SWAP_ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
];

const LIQUIDITY_ABI = [
  "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
];

const TOKENS = {
  MERCURY: { address: MERCURY, name: "MERCURY" },
  MARS:    { address: MARS,    name: "MARS" },
};

// ==================== UTILS ====================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function randomJeda() {
  return Math.floor(Math.random() * (5 * 60 * 1000 - 1 * 60 * 1000 + 1)) + 1 * 60 * 1000;
}

function randomBetween(min, max) {
  return min + BigInt(Math.floor(Math.random() * Number(max - min)));
}

function log(name, address, msg) {
  const short = address.slice(0, 6) + "..." + address.slice(-4);
  console.log(`[${new Date().toLocaleTimeString()}] [${name}|${short}] ${msg}`);
}

function prompt(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(q, a => { rl.close(); resolve(a.trim()); }));
}

async function countdown(ms) {
  const frames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
  let frame = 0;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const sisa = Math.round((end - Date.now()) / 1000);
    const m = Math.floor(sisa / 60), s = sisa % 60;
    process.stdout.write(`\r${frames[frame++ % frames.length]} Jeda — ${m > 0 ? `${m}m ` : ""}${s}s lagi...  `);
    await sleep(500);
  }
  process.stdout.write(`\r✅ Jeda selesai!                              \n`);
}

async function withRetry(fn, label) {
  let attempt = 1;
  while (true) {
    try { return await fn(); }
    catch (err) {
      console.log(`\n  ⚠️ ${label} gagal (attempt ${attempt}): ${err.message} — retry in 10s...`);
      attempt++;
      await sleep(10000);
    }
  }
}

// ==================== MENU ====================
async function selectWallets() {
  console.log(`\nWallet tersedia (${ALL_WALLETS.length}):`);
  ALL_WALLETS.forEach((w, idx) => {
    const addr = new ethers.Wallet(w.pk).address;
    console.log(`  ${idx + 1}. ${w.name} (${addr.slice(0,6)}...${addr.slice(-4)})`);
  });
  console.log("\n  1. Semua wallet");
  console.log("  2. Pilih wallet tertentu");
  const mode = await prompt("\nPilih (1/2): ");
  if (mode === "1") return ALL_WALLETS;
  const input = await prompt("Nomor wallet (pisah koma, contoh: 1,3): ");
  const selected = input.split(",")
    .map(n => ALL_WALLETS[parseInt(n.trim()) - 1])
    .filter(Boolean);
  if (!selected.length) { console.error("❌ Tidak valid."); process.exit(1); }
  console.log(`✅ Dipilih: ${selected.map(w => w.name).join(", ")}`);
  return selected;
}

async function selectTokens(label) {
  console.log(`\nToken untuk ${label}:`);
  console.log("  1. Semua token (MERCURY + MARS)");
  console.log("  2. MERCURY saja");
  console.log("  3. MARS saja");
  const pick = await prompt("Pilih (1/2/3): ");
  if (pick === "1") return [TOKENS.MERCURY, TOKENS.MARS];
  if (pick === "2") return [TOKENS.MERCURY];
  if (pick === "3") return [TOKENS.MARS];
  console.error("❌ Tidak valid."); process.exit(1);
}

async function showMenu() {
  console.log("\n╔══════════════════════════════════╗");
  console.log("║      🚀 SimpleChain Bot          ║");
  console.log("╚══════════════════════════════════╝");
  console.log("\nMode:");
  console.log("  1. Task web (visit website + checkin)");
  console.log("  2. On-chain (swap & add liquidity)");
  const mode = await prompt("\nPilih mode (1/2): ");

  if (mode === "1") {
    const wallets = await selectWallets();
    return { mode: "web", wallets };
  }

  if (mode === "2") {
    console.log("\nAksi on-chain:");
    console.log("  1. Swap & Add Liquidity");
    console.log("  2. Swap saja");
    console.log("  3. Add Liquidity saja");
    const aksi = await prompt("Pilih (1/2/3): ");

    let swapTokens = [], liqTokens = [];

    if (aksi === "1" || aksi === "2") {
      swapTokens = await selectTokens("Swap");
    }
    if (aksi === "1" || aksi === "3") {
      liqTokens = await selectTokens("Add Liquidity");
    }

    const wallets = await selectWallets();
    return { mode: "onchain", wallets, swapTokens, liqTokens };
  }

  console.error("❌ Pilihan tidak valid."); process.exit(1);
}

// ==================== API ====================
async function getNonce(address) {
  const res = await fetch(`${BASE_URL}/get/nonce`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error("getNonce: " + data.message);
  return data.data;
}

async function loginApi(address, message, signature) {
  const res = await fetch(`${BASE_URL}/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, message, signature }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error("Login: " + data.message);
  const token = res.headers.get("authorization")?.replace("Bearer ", "") ||
    data.data?.token || data.data?.accessToken || data.token;
  if (!token) throw new Error("Token tidak ditemukan");
  return token;
}

async function getTaskList(token) {
  const res = await fetch(`${BASE_URL}/task/list`, {
    method: "GET", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error("getTaskList: " + data.message);
  return data.data.tasks;
}

async function completeTask(token, taskId) {
  const res = await fetch(`${BASE_URL}/task/complete`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ taskId }),
  });
  const data = await res.json();
  if (data.code !== 0) return { success: false, msg: data.message };
  return { success: true, points: data.data?.rewardPoints };
}

async function dailyCheckin(token) {
  const res = await fetch(`${BASE_URL}/campaign/checkin`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) return { success: false, msg: data.message };
  return { success: true, reward: data.data?.totalReward, streak: data.data?.currentStreak };
}

async function getApiToken(wallet, name, address) {
  const { message } = await withRetry(() => getNonce(address), "getNonce");
  const signature = await wallet.signMessage(message);
  log(name, address, "Signed ✓");
  await sleep(1000);
  const token = await withRetry(() => loginApi(address, message, signature), "login");
  log(name, address, "Logged in ✓");
  return token;
}

// ==================== ON-CHAIN ====================
async function ensureApproval(signer, tokenAddress, spender, amount) {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const allowance = await token.allowance(signer.address, spender);
  if (allowance < amount) {
    const tx = await token.approve(spender, ethers.MaxUint256);
    await tx.wait();
  }
}

async function doSwap(signer, tokenOut, amountIn, name, address) {
  const router = new ethers.Contract(SWAP_ROUTER, SWAP_ROUTER_ABI, signer);
  const tx = await router.exactInputSingle(
    {
      tokenIn: WSRW,
      tokenOut,
      fee: FEE_TIER,
      recipient: signer.address,
      amountIn,
      amountOutMinimum: 0n,
      sqrtPriceLimitX96: 0n,
    },
    { value: amountIn }
  );
  const receipt = await tx.wait();
  log(name, address, `✅ Swap tx: ${receipt.hash}`);
  return receipt;
}

async function doAddLiquidity(signer, tokenAddress, tokenName, name, address) {
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const bal = await tokenContract.balanceOf(signer.address);

  if (bal === 0n) {
    log(name, address, `⚠️ Balance ${tokenName} kosong, skip`);
    return;
  }

  // Random 50-100% dari balance (min 0.5x)
  const pct = BigInt(Math.floor(Math.random() * 51) + 50); // 50-100%
  const amount = (bal * pct) / 100n;

  // Sort tokens (Uniswap V3: token0 < token1)
  let t0, t1, a0, a1;
  if (WSRW.toLowerCase() < tokenAddress.toLowerCase()) {
    t0 = WSRW; t1 = tokenAddress; a0 = 0n; a1 = amount;
  } else {
    t0 = tokenAddress; t1 = WSRW; a0 = amount; a1 = 0n;
  }

  await withRetry(() => ensureApproval(signer, tokenAddress, LIQUIDITY_ROUTER, amount), `approve ${tokenName}`);

  const posManager = new ethers.Contract(LIQUIDITY_ROUTER, LIQUIDITY_ABI, signer);
  const deadline = Math.floor(Date.now() / 1000) + 600;

  const tx = await posManager.mint({
    token0: t0, token1: t1,
    fee: FEE_TIER,
    tickLower: -887160, tickUpper: 887160,
    amount0Desired: a0, amount1Desired: a1,
    amount0Min: 0n, amount1Min: 0n,
    recipient: signer.address,
    deadline,
  });
  const receipt = await tx.wait();
  log(name, address, `✅ Add liquidity ${tokenName} (${pct}%) tx: ${receipt.hash}`);
}

// ==================== PROCESS MODES ====================
async function processWebMode(wallet, name, address) {
  const token = await getApiToken(wallet, name, address);

  await sleep(DELAY);
  const tasks = await withRetry(() => getTaskList(token), "getTaskList");
  log(name, address, `${tasks.length} tasks loaded`);

  // Visit website
  const accessTask = tasks.find(t => t.taskCode === "ACCESS_LINK" && t.status === "ACTIVE");
  if (accessTask) {
    await sleep(DELAY);
    const r = await completeTask(token, accessTask.taskId);
    log(name, address, r.success ? `✅ Visit Website +${r.points} pts` : `⚠️ Visit: ${r.msg}`);
  }

  // Complete SWAP_TOKEN tasks
  const swapTasks = tasks.filter(t => t.taskCode === "SWAP_TOKEN" && t.status === "ACTIVE");
  for (const t of swapTasks) {
    await sleep(DELAY);
    const r = await completeTask(token, t.taskId);
    log(name, address, r.success ? `✅ ${t.taskName} +${r.points} pts` : `⚠️ ${t.taskName}: ${r.msg}`);
  }

  // Complete PROVIDE_LIQUIDITY tasks
  const liqTasks = tasks.filter(t => t.taskCode === "PROVIDE_LIQUIDITY" && t.status === "ACTIVE");
  for (const t of liqTasks) {
    await sleep(DELAY);
    const r = await completeTask(token, t.taskId);
    log(name, address, r.success ? `✅ ${t.taskName} +${r.points} pts` : `⚠️ ${t.taskName}: ${r.msg}`);
  }

  // Daily checkin
  await sleep(DELAY);
  const checkin = await dailyCheckin(token);
  log(name, address, checkin.success ? `✅ Checkin +${checkin.reward} pts | Streak: ${checkin.streak}` : `⚠️ Checkin: ${checkin.msg}`);
}

async function processOnchainMode(wallet, name, address, swapTokens, liqTokens) {
  const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);
  const signer = new ethers.Wallet(wallet.pk, provider);

  const token = await getApiToken(signer, name, address);
  await sleep(DELAY);
  const tasks = await withRetry(() => getTaskList(token), "getTaskList");

  // SWAP
  if (swapTokens.length > 0) {
    const swapTasks = tasks.filter(t => t.taskCode === "SWAP_TOKEN" && t.status === "ACTIVE");
    for (const tok of swapTokens) {
      log(name, address, `Swap SRW → ${tok.name} (${SWAP_COUNT}x)`);
      for (let s = 1; s <= SWAP_COUNT; s++) {
        const amount = randomBetween(SWAP_MIN, SWAP_MAX);
        log(name, address, `[${s}/${SWAP_COUNT}] Swap ${ethers.formatEther(amount)} SRW → ${tok.name}`);
        await withRetry(() => doSwap(signer, tok.address, amount, name, address), `swap ${tok.name}`);
        await sleep(3000);
      }
    }
    // Complete swap tasks
    for (const t of swapTasks) {
      await sleep(DELAY);
      const r = await completeTask(token, t.taskId);
      log(name, address, r.success ? `✅ ${t.taskName} +${r.points} pts` : `⚠️ ${t.taskName}: ${r.msg}`);
    }
  }

  // ADD LIQUIDITY
  if (liqTokens.length > 0) {
    const liqTasks = tasks.filter(t => t.taskCode === "PROVIDE_LIQUIDITY" && t.status === "ACTIVE");
    for (const tok of liqTokens) {
      log(name, address, `Add liquidity ${tok.name}...`);
      await withRetry(() => doAddLiquidity(signer, tok.address, tok.name, name, address), `add liq ${tok.name}`);
      await sleep(3000);
    }
    // Complete liquidity tasks
    for (const t of liqTasks) {
      await sleep(DELAY);
      const r = await completeTask(token, t.taskId);
      log(name, address, r.success ? `✅ ${t.taskName} +${r.points} pts` : `⚠️ ${t.taskName}: ${r.msg}`);
    }
  }
}

// ==================== MAIN ====================
async function main() {
  const menu = await showMenu();
  const { wallets } = menu;
  console.log(`\n🚀 Mulai — ${wallets.length} wallet(s)\n`);

  for (let i = 0; i < wallets.length; i++) {
    if (i > 0) {
      const jeda = randomJeda();
      await countdown(jeda);
    }
    const { name, pk } = wallets[i];
    const w = new ethers.Wallet(pk);
    const address = w.address;
    console.log(`\n--- Wallet ${i + 1}/${wallets.length} (${name}) ---`);

    try {
      if (menu.mode === "web") {
        await processWebMode(w, name, address);
      } else {
        await processOnchainMode(wallets[i], name, address, menu.swapTokens, menu.liqTokens);
      }
    } catch (err) {
      log(name, address, `❌ Error: ${err.message}`);
    }
  }

  console.log("\n✅ Semua wallet selesai!");
}

main().catch(console.error);
