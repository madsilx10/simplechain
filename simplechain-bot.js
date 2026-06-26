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
const DELAY_BETWEEN_TASKS = 2000;

// Token addresses
const WSRW = "0xec1bF294Ea5b3271A87606B51F5465352bc19bE5";
const MERCURY = "0x8c0c42fD298623d035eeFd8b2783c94069610d2B";
const MARS = "0xFC12Ae35889A4a6D0b1cE94a6675Ef869F6eb207";

// Contract addresses
const SWAP_ROUTER = "0x43b06d73dC0dDB9214B28349a913A2b7FAAFCEe8";
const LIQUIDITY_ROUTER = "0x6E172Ba709487fd0Dc47D8A23e128C0328E0646c";

// Fee tier default
const FEE_TIER = 3000;

// Swap amount random 0.0001 - 0.005 SRW
const SWAP_MIN = ethers.parseEther("0.0001");
const SWAP_MAX = ethers.parseEther("0.005");

// ABIs
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
];

const SWAP_ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
];

const LIQUIDITY_ABI = [
  "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
];

// ==================== UTILS ====================
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function countdown(ms) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frame = 0;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const sisa = Math.round((end - Date.now()) / 1000);
    const menit = Math.floor(sisa / 60);
    const detik = sisa % 60;
    const display = menit > 0 ? `${menit}m ${detik}s` : `${detik}s`;
    process.stdout.write(`\r${frames[frame % frames.length]} Jeda ke wallet berikutnya — ${display} lagi...  `);
    await sleep(500);
    frame++;
  }
  process.stdout.write(`\r✅ Jeda selesai, lanjut!                              \n`);
}

// ==================== MENU ====================
async function showMenu() {
  console.log("\n╔══════════════════════════════════╗");
  console.log("║      🚀 SimpleChain Bot          ║");
  console.log("╚══════════════════════════════════╝");
  console.log(`\nWallet tersedia (${ALL_WALLETS.length}):`);
  ALL_WALLETS.forEach((w, idx) => {
    const addr = new ethers.Wallet(w.pk).address;
    const short = addr.slice(0, 6) + "..." + addr.slice(-4);
    console.log(`  ${idx + 1}. ${w.name} (${short})`);
  });

  console.log("\nMode:");
  console.log("  1. Semua wallet");
  console.log("  2. Pilih wallet tertentu");

  const mode = await prompt("\nPilih mode (1/2): ");

  if (mode === "1") {
    return ALL_WALLETS;
  } else if (mode === "2") {
    console.log("\nMasukkan nomor wallet (pisah koma, contoh: 1,3,5)");
    const input = await prompt("Pilih: ");
    const indices = input.split(",").map(n => parseInt(n.trim()) - 1);
    const selected = indices
      .filter(idx => idx >= 0 && idx < ALL_WALLETS.length)
      .map(idx => ALL_WALLETS[idx]);
    if (selected.length === 0) {
      console.error("❌ Tidak ada wallet valid.");
      process.exit(1);
    }
    console.log(`\n✅ Wallet dipilih: ${selected.map(w => w.name).join(", ")}`);
    return selected;
  } else {
    console.error("❌ Pilihan tidak valid.");
    process.exit(1);
  }
}

// ==================== API ====================
async function withRetry(fn, name) {
  let attempt = 1;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      console.log(`\n  ⚠️ ${name} gagal (attempt ${attempt}): ${err.message} — retry in 10s...`);
      attempt++;
      await sleep(10000);
    }
  }
}

async function getNonce(address) {
  const res = await fetch(`${BASE_URL}/get/nonce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error("getNonce failed: " + data.message);
  return data.data;
}

async function login(address, message, signature) {
  const res = await fetch(`${BASE_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, message, signature }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error("Login failed: " + data.message);
  const token =
    res.headers.get("authorization")?.replace("Bearer ", "") ||
    data.data?.token ||
    data.data?.accessToken ||
    data.token;
  if (!token) throw new Error("Token tidak ditemukan di response login");
  return token;
}

async function getTaskList(token) {
  const res = await fetch(`${BASE_URL}/task/list`, {
    method: "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error("getTaskList failed: " + data.message);
  return data.data.tasks;
}

async function completeTask(token, taskId) {
  const res = await fetch(`${BASE_URL}/task/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ taskId }),
  });
  const data = await res.json();
  if (data.code !== 0) return { success: false, msg: data.message };
  return { success: true, points: data.data?.rewardPoints };
}

async function dailyCheckin(token) {
  const res = await fetch(`${BASE_URL}/campaign/checkin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) return { success: false, msg: data.message };
  return { success: true, reward: data.data?.totalReward, streak: data.data?.currentStreak };
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

async function doAddLiquidity(signer, token0, token1, amount0, amount1, name, address) {
  const posManager = new ethers.Contract(LIQUIDITY_ROUTER, LIQUIDITY_ABI, signer);

  // sort token addresses (Uniswap V3 requires token0 < token1)
  let t0 = token0, t1 = token1, a0 = amount0, a1 = amount1;
  if (token0.toLowerCase() > token1.toLowerCase()) {
    [t0, t1] = [token1, token0];
    [a0, a1] = [amount1, amount0];
  }

  await withRetry(() => ensureApproval(signer, t0, LIQUIDITY_ROUTER, a0), "approve liq token0");
  await withRetry(() => ensureApproval(signer, t1, LIQUIDITY_ROUTER, a1), "approve liq token1");

  const deadline = Math.floor(Date.now() / 1000) + 600;
  // tick range lebar buat simplicity
  const tickLower = -887220;
  const tickUpper = 887220;

  const tx = await posManager.mint({
    token0: t0,
    token1: t1,
    fee: FEE_TIER,
    tickLower,
    tickUpper,
    amount0Desired: a0,
    amount1Desired: a1,
    amount0Min: 0n,
    amount1Min: 0n,
    recipient: signer.address,
    deadline,
  });
  const receipt = await tx.wait();
  log(name, address, `✅ Add liquidity tx: ${receipt.hash}`);
  return receipt;
}

// ==================== PROCESS WALLET ====================
async function processWallet({ name, pk }) {
  const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);
  const wallet = new ethers.Wallet(pk, provider);
  const address = wallet.address;

  // --- Task API ---
  log(name, address, "Getting nonce...");
  const { message } = await withRetry(() => getNonce(address), "getNonce");
  const signature = await wallet.signMessage(message);
  log(name, address, "Signed ✓");

  await sleep(1000);
  const token = await withRetry(() => login(address, message, signature), "login");
  log(name, address, "Logged in ✓");

  await sleep(DELAY_BETWEEN_TASKS);
  const tasks = await withRetry(() => getTaskList(token), "getTaskList");
  log(name, address, `${tasks.length} tasks loaded`);

  // ACCESS_LINK
  const accessTask = tasks.find((t) => t.taskCode === "ACCESS_LINK" && t.status === "ACTIVE");
  if (accessTask) {
    await sleep(DELAY_BETWEEN_TASKS);
    const result = await completeTask(token, accessTask.taskId);
    log(name, address, result.success ? `✅ Visit Website +${result.points} pts` : `⚠️ Visit Website: ${result.msg}`);
  }

  // --- ON-CHAIN: SWAP ---
  const swapTasks = tasks.filter((t) => t.taskCode === "SWAP_TOKEN" && t.status === "ACTIVE");
  if (swapTasks.length > 0) {
    log(name, address, `${swapTasks.length} swap task(s) — mulai on-chain swap...`);

    // Get WSRW balance dulu
    const wsrwContract = new ethers.Contract(WSRW, ERC20_ABI, wallet);

    // Swap SRW → MERCURY (5x)
    for (let s = 1; s <= 5; s++) {
      const amountMercury = randomBetween(SWAP_MIN, SWAP_MAX);
      log(name, address, `[/5] Swap ${ethers.formatEther(amountMercury)} SRW → MERCURY`);
      await withRetry(() => doSwap(wallet, MERCURY, amountMercury, name, address), "swap MERCURY");
      await sleep(3000);
    }

    // Swap SRW → MARS (5x)
    for (let s = 1; s <= 5; s++) {
      const amountMars = randomBetween(SWAP_MIN, SWAP_MAX);
      log(name, address, `[/5] Swap ${ethers.formatEther(amountMars)} SRW → MARS`);
      await withRetry(() => doSwap(wallet, MARS, amountMars, name, address), "swap MARS");
      await sleep(3000);
    }

    // Complete swap tasks
    for (const swapTask of swapTasks) {
      await sleep(DELAY_BETWEEN_TASKS);
      const result = await completeTask(token, swapTask.taskId);
      log(name, address, result.success ? `✅ ${swapTask.taskName} +${result.points} pts` : `⚠️ ${swapTask.taskName}: ${result.msg}`);
    }
  }

  // --- ON-CHAIN: ADD LIQUIDITY ---
  const liquidityTasks = tasks.filter((t) => t.taskCode === "PROVIDE_LIQUIDITY" && t.status === "ACTIVE");
  if (liquidityTasks.length > 0) {
    log(name, address, `${liquidityTasks.length} liquidity task(s) — mulai on-chain add liquidity...`);

    const mercuryContract = new ethers.Contract(MERCURY, ERC20_ABI, wallet);
    const marsContract = new ethers.Contract(MARS, ERC20_ABI, wallet);

    // Ambil balance Mercury & MARS, pake 5-25% random
    const mercuryBal = await mercuryContract.balanceOf(address);
    const marsBal = await marsContract.balanceOf(address);

    const pctMercury = BigInt(Math.floor(Math.random() * 21) + 5); // 5-25%
    const pctMars = BigInt(Math.floor(Math.random() * 21) + 5);

    const mercuryAmount = (mercuryBal * pctMercury) / 100n;
    const marsAmount = (marsBal * pctMars) / 100n;

    // Add MERCURY + MARS liquidity
    if (mercuryAmount > 0n && marsAmount > 0n) {
      log(name, address, `Add liquidity ${ethers.formatEther(mercuryAmount)} MERCURY + ${ethers.formatEther(marsAmount)} MARS (${pctMercury}%/${pctMars}%)`);
      await withRetry(() => doAddLiquidity(wallet, MERCURY, MARS, mercuryAmount, marsAmount, name, address), "add liquidity");
      await sleep(3000);
    } else {
      log(name, address, "⚠️ Balance MERCURY/MARS kosong, skip add liquidity");
    }

    // Complete liquidity tasks
    for (const liqTask of liquidityTasks) {
      await sleep(DELAY_BETWEEN_TASKS);
      const result = await completeTask(token, liqTask.taskId);
      log(name, address, result.success ? `✅ ${liqTask.taskName} +${result.points} pts` : `⚠️ ${liqTask.taskName}: ${result.msg}`);
    }
  }

  // Daily checkin
  await sleep(DELAY_BETWEEN_TASKS);
  const checkin = await dailyCheckin(token);
  log(name, address, checkin.success ? `✅ Checkin +${checkin.reward} pts | Streak: ${checkin.streak}` : `⚠️ Checkin: ${checkin.msg}`);
}

// ==================== MAIN ====================
async function main() {
  const wallets = await showMenu();
  console.log(`\n🚀 Mulai — ${wallets.length} wallet(s)\n`);

  for (let i = 0; i < wallets.length; i++) {
    if (i > 0) {
      const jeda = randomJeda();
      await countdown(jeda);
    }
    console.log(`\n--- Wallet ${i + 1}/${wallets.length} (${wallets[i].name}) ---`);
    await processWallet(wallets[i]);
  }

  console.log("\n✅ Semua wallet selesai!");
}

main().catch(console.error);
