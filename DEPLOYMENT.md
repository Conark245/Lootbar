# 🚀 Deployment Guide (Railway, VPS & Vercel)

ဤ Application ကို **Railway.app**, **VPS Server** (Ubuntu/Debian) ပေါ်တွင်ဖြစ်စေ၊ **Vercel** ပေါ်တွင်ဖြစ်စေ အလွယ်တကူ Deploy လုပ်နိုင်ရန် ပြင်ဆင်ပေးထားပါသည်။

---

## 1. 🚂 Railway.app ပေါ်တွင် တင်နည်း (Most Recommended & Easiest)

Railway သည် Cloud VPS ပုံစံဖြစ်ပြီး Server Configuration များ ကိုယ်တိုင်လုပ်စရာမလိုဘဲ **Telegram Bot (Long-Polling 24/7)** နှင့် **Admin Web Dashboard** နှစ်ခုလုံးကို အလွယ်ကူဆုံး တစ်ပြိုင်နက် Run ပေးနိုင်ပါသည်။

### Step 1: GitHub သို့ Code Push လုပ်ပါ
- သင့် Code များကို GitHub Repository တစ်ခုသို့ Push လုပ်ထားပါ။

### Step 2: Railway တွင် Project ဖန်တီးပါ
1. [Railway.app](https://railway.app) သို့ သွားပြီး Sign in / Login ဝင်ပါ။
2. **`+ New Project`** -> **`Deploy from GitHub repo`** ကို ရွေးပြီး သင့် Repository ကို ရွေးပါ။

### Step 3: Environment Variables ထည့်သွင်းပါ
Railway Dashboard ရှိ **Variables** Tab သို့သွားပြီး အောက်ပါ Environment Variables များကို Add ပြုလုပ်ပါ:
- `MONGODB_URI` : သင့် MongoDB Atlas Connection String
- `TELEGRAM_BOT_TOKEN` : သင့် Telegram Bot Token
- `ADMIN_CHAT_ID` : သင့် Admin Telegram Chat ID
- `LOOTBAR_NICKNAME` : သင့် LootBar Reseller UID
- `LOOTBAR_EMAIL` : သင့် LootBar Email
- `LOOTBAR_PASSWORD` : သင့် LootBar Password
- `APP_URL` : Railway မှ ပေးမည့် Public Domain URL (ဥပမာ: `https://xxx.up.railway.app`)

### Step 4: Public Networking (Domain) ဖွင့်ပါ
1. Railway Dashboard -> သင့် Service ပေါ်ကို နှိပ်ပါ။
2. **Settings** Tab သို့ သွားပြီး **Networking** အောက်ရှိ **`Generate Domain`** ကို နှိပ်ပါ။
3. ထွက်လာသော Domain (ဥပမာ `https://xxx.up.railway.app`) ကို အပေါ်က `APP_URL` variable နေရာတွင် ပြန်ထည့်ပေးပါ။

> 💡 **မှတ်ချက်:** Railway ပေါ်တွင် Bot သည် Long-polling mode ဖြင့် အလိုအလျောက် ၂၄ နာရီ run နေမည်ဖြစ်ပြီး Webhook URL ထည့်စရာ မလိုပါ။

---

## 2. 🖥️ VPS ပေါ်တွင် တင်နည်း (PM2 / Docker)

VPS ပေါ်တွင် Telegram Bot သည် Long-Polling mode ဖြင့် ၂၄ နာရီ မနားတမ်း အလုပ်လုပ်နိုင်ပြီး LootBar Real-time Order Sync လည်း အမြဲတမ်း ပုံမှန် အလုပ်လုပ်ပါသည်။

### Option A: PM2 ဖြင့် တင်နည်း (အလွယ်ကူဆုံး)

#### Step 1: VPS ထဲ Node.js & PM2 သွင်းပါ
```bash
# Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo npm install -g pm2
```

#### Step 2: Code ကို Clone လုပ်ပြီး Dependency သွင်းပါ
```bash
git clone <your-repository-url>
cd <repository-folder>
npm install
```

#### Step 3: `.env` ဖိုင် ပြင်ဆင်ပါ
```bash
cp .env.example .env
nano .env
```
*(သင့် MONGODB_URI, TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID, LOOTBAR အချက်အလက်များ ထည့်သွင်းပါ)*

#### Step 4: Build & PM2 ဖြင့် Run ပါ
```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

---

### Option B: Docker / Docker Compose ဖြင့် တင်နည်း

#### Step 1: `.env` ဖိုင် ပြင်ဆင်ပါ
```bash
cp .env.example .env
nano .env
```

#### Step 2: Docker Compose ဖြင့် Run ပါ
```bash
docker compose up -d --build
```
Log များကြည့်ရန်: `docker compose logs -f`

---

## 2. ⚡ Vercel ပေါ်တွင် တင်နည်း (Serverless & Web Dashboard)

Vercel ပေါ်တွင် တင်ပါက Serverless Architecture ဖြစ်သောကြောင့် Telegram Webhook ဖြင့် ချိတ်ဆက်ရပါမည်။

### Step 1: Vercel သို့ Import လုပ်ပါ
1. GitHub Repository သို့ Push လုပ်ပါ။
2. [Vercel Dashboard](https://vercel.com) သို့ သွားပြီး Project ကို Import လုပ်ပါ။

### Step 2: Environment Variables ထည့်သွင်းပါ
Vercel Project Settings -> **Environment Variables** တွင် အောက်ပါတို့ကို ထည့်ပါ:
- `MONGODB_URI` : သင့် MongoDB Atlas Connection String
- `TELEGRAM_BOT_TOKEN` : သင့် Telegram Bot Token
- `ADMIN_CHAT_ID` : သင့် Admin Telegram Chat ID
- `LOOTBAR_NICKNAME` : သင့် LootBar Reseller UID
- `LOOTBAR_EMAIL` : သင့် LootBar Email
- `LOOTBAR_PASSWORD` : သင့် LootBar Password
- `APP_URL` : သင့် Vercel App URL (ဥပမာ: `https://your-app.vercel.app`)
- `TELEGRAM_WEBHOOK_URL` : `https://your-app.vercel.app/api/telegram-webhook`

### Step 3: Deploy
- **Deploy** ခလုတ်ကို နှိပ်ပါ။ Vercel သည် `vercel.json` နှင့် `api/index.ts` ကို အလိုအလျောက် သုံး၍ Frontend နှင့် API ကို တစ်ပြိုင်နက် Deploy လုပ်ပေးပါမည်။

---

## 🛠️ Summary Comparison

| Feature | VPS (PM2 / Docker) | Vercel (Serverless) |
|---|---|---|
| **Bot Mode** | Long-Polling (No Webhook / SSL setup needed) | Webhook (`TELEGRAM_WEBHOOK_URL`) |
| **Realtime Sync** | အမြဲတမ်း Background Loop (8s) | Webhook Request တိုင်းတွင် Sync |
| **Admin Web Dashboard** | ✅ အပြည့်အဝ အလုပ်လုပ်သည် | ✅ အပြည့်အဝ အလုပ်လုပ်သည် |
| **Setup ခက်ခဲမှု** | အလွန်လွယ်ကူ (`pm2 start`) | Environment Variable ထည့်ရုံသာ |
