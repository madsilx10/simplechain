require("dotenv").config();
const { ethers } = require("ethers");

// ==================== CONFIG ====================
// Ambil PK_FIRST dulu, lalu PK_1, PK_2, dst
const PRIVATE_KEYS = [];

if (process.env.PK_FIRST) PRIVATE_KEYS.push({ name: "FIRST", pk: process.env.PK_FIRST.trim() });

let i = 1;
while (process.env[`PK_${i}`]) {
  PRIVATE_KEYS.push({ name: `ALT_${i}`, pk: process.env[`PK_${i}`].trim() });
  i++;
}

if (PRIVATE_KEYS.length === 0) {
  console.error("❌ Tidak ada PK ditemukan di .env! Format: PK_FIRST=0x... PK_1=0x...");
  process.exit(1);
}

const BASE_URL = "https://task.simplechain.com/api/v1";
const DELAY_BETWEEN_WALLETS = Math.floor(Math.random() * (5 * 60 * 1000 - 1 * 60 * 1000 + 1)) + 1 * 60 * 1000; // random 1-5 menit
const DELAY_BETWEEN_TASKS = 2000;

// ==================== UTILS ====================
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(name, address, msg) {
  const short = address.slice(0, 6) + "..." + address.slice(-4);
  console.log(`[${new Date().toLocaleTimeString()}] [${name}|${short}] ${msg}`);
}

// ==================== API ====================
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
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error("getTaskList failed: " + data.message);
  return data.data.tasks;
}

async function completeTask(token, taskId) {
  const res = await fetch(`${BASE_URL}/task/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ taskId }),
  });
  const data = await res.json();
  if (data.code !== 0) return { success: false, msg: data.message };
  return { success: true, points: data.data?.rewardPoints };
}

async function dailyCheckin(token) {
  const res = await fetch(`${BASE_URL}/campaign/checkin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await res.json();
  if (data.code !== 0) return { success: false, msg: data.message };
  return {
    success: true,
    reward: data.data?.totalReward,
    streak: data.data?.currentStreak,
  };
}

// ==================== MAIN ====================
async function processWallet({ name, pk }) {
  const wallet = new ethers.Wallet(pk);
  const address = wallet.address;

  try {
    log(name, address, "Getting nonce...");
    const { message } = await getNonce(address);

    const signature = await wallet.signMessage(message);
    log(name, address, "Signed ✓");

    await sleep(1000);
    const token = await login(address, message, signature);
    log(name, address, "Logged in ✓");

    await sleep(DELAY_BETWEEN_TASKS);
    const tasks = await getTaskList(token);
    log(name, address, `${tasks.length} tasks loaded`);

    // Complete ACCESS_LINK
    const accessTask = tasks.find(
      (t) => t.taskCode === "ACCESS_LINK" && t.status === "ACTIVE"
    );
    if (accessTask) {
      await sleep(DELAY_BETWEEN_TASKS);
      const result = await completeTask(token, accessTask.taskId);
      if (result.success) {
        log(name, address, `✅ Visit Website +${result.points} pts`);
      } else {
        log(name, address, `⚠️ Visit Website: ${result.msg}`);
      }
    } else {
      log(name, address, "⚠️ ACCESS_LINK task tidak ditemukan");
    }

    // Daily checkin
    await sleep(DELAY_BETWEEN_TASKS);
    const checkin = await dailyCheckin(token);
    if (checkin.success) {
      log(name, address, `✅ Checkin +${checkin.reward} pts | Streak: ${checkin.streak}`);
    } else {
      log(name, address, `⚠️ Checkin: ${checkin.msg}`);
    }

  } catch (err) {
    log(name, address, `❌ ${err.message}`);
  }
}

async function main() {
  console.log(`\n🚀 SimpleChain Bot — ${PRIVATE_KEYS.length} wallet(s)\n`);

  for (let i = 0; i < PRIVATE_KEYS.length; i++) {
    if (i > 0) {
    const jeda = Math.floor(Math.random() * (5 * 60 * 1000 - 1 * 60 * 1000 + 1)) + 1 * 60 * 1000;
    console.log(`\n⏳ Jeda ${Math.round(jeda / 1000)}s sebelum wallet berikutnya...`);
    await sleep(jeda);
  }
    console.log(`\n--- Wallet ${i + 1}/${PRIVATE_KEYS.length} (${PRIVATE_KEYS[i].name}) ---`);
    await processWallet(PRIVATE_KEYS[i]);
  }

  console.log("\n✅ Semua wallet selesai!");
}

main().catch(console.error);
