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
const DELAY_BETWEEN_TASKS = 2000;

// ==================== UTILS ====================
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomJeda() {
  return Math.floor(Math.random() * (5 * 60 * 1000 - 1 * 60 * 1000 + 1)) + 1 * 60 * 1000;
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
    console.log("\nMasukkan nomor wallet yang mau dijalanin (pisah koma, contoh: 1,3,5)");
    const input = await prompt("Pilih: ");
    const indices = input.split(",").map(n => parseInt(n.trim()) - 1);
    const selected = indices
      .filter(idx => idx >= 0 && idx < ALL_WALLETS.length)
      .map(idx => ALL_WALLETS[idx]);

    if (selected.length === 0) {
      console.error("❌ Tidak ada wallet valid yang dipilih.");
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

// ==================== PROCESS WALLET ====================
async function processWallet({ name, pk }) {
  const wallet = new ethers.Wallet(pk);
  const address = wallet.address;

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
    if (result.success) {
      log(name, address, `✅ Visit Website +${result.points} pts`);
    } else {
      log(name, address, `⚠️ Visit Website: ${result.msg}`);
    }
  } else {
    log(name, address, "⚠️ ACCESS_LINK tidak ditemukan");
  }

  // Daily checkin
  await sleep(DELAY_BETWEEN_TASKS);
  const checkin = await dailyCheckin(token);
  if (checkin.success) {
    log(name, address, `✅ Checkin +${checkin.reward} pts | Streak: ${checkin.streak}`);
  } else {
    log(name, address, `⚠️ Checkin: ${checkin.msg}`);
  }
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
