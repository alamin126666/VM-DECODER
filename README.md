# VM Decoder Bot

Telegram bot যা obfuscated .html file নিয়ে runtime hooks (eval/Function/decodeURIComponent/String.fromCharCode) দিয়ে decode করে এবং decoded .html ফেরত দেয়। প্রতিটা step এর real-time log bot এ দেখায়।

## Setup (Railway)

### ১. Bot Token নাও
- Telegram এ @BotFather এ যাও
- `/newbot` দিয়ে নতুন bot বানাও
- টোকেন কপি করে রাখো (যেমন `123456:ABC-DEF...`)

### ২. (Optional) Owner ID নাও
- @userinfobot এ গিয়ে `/start` দিলে তোমার numeric ID পাবে
- এটা সেট করলে যেকোনো chat থেকে process করা হলেও তুমি নিজের DM-এ সব log পাবে

### ৩. GitHub এ push করো
এই পুরো folder একটা নতুন GitHub repo তে push করো:
```
git init
git add .
git commit -m "init"
git remote add origin <your-repo-url>
git push -u origin main
```

### ৪. Railway এ deploy
1. https://railway.app এ যাও, GitHub দিয়ে login
2. "New Project" → "Deploy from GitHub repo" → তোমার repo সিলেক্ট করো
3. Deploy হওয়ার পর "Variables" ট্যাবে গিয়ে এইগুলো add করো:
   - `BOT_TOKEN` = তোমার বট টোকেন
   - `OWNER_ID` = তোমার টেলিগ্রাম ID (optional)
   - `PUPPETEER_EXECUTABLE_PATH` = `/usr/bin/chromium`
   - `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` = `true`
4. Deploy logs এ "🤖 Bot started successfully." দেখলে bot লাইভ

### ৫. ব্যবহার
- Telegram এ তোমার bot খুলো
- একটা obfuscated `.html` ফাইল document হিসেবে পাঠাও
- bot স্টেপ বাই স্টেপ live log পাঠাবে (browser launch, hook inject, page load, capture, etc.)
- কাজ শেষে decoded `.html` ফাইল ফেরত পাবে

## Live Logs যা দেখাবে

- ফাইল রিসিভ ও ডাউনলোড স্ট্যাটাস
- Browser launch status
- Hook injection confirmation
- Page load status / errors (যদি obfuscated script error দেয়, সেটাও দেখাবে)
- কতগুলো code segment capture হলো
- Page এর নিজের console.log/error output (থাকলে)
- ফাইনাল রিজাল্ট (success/fail) এবং কারণ

## সীমাবদ্ধতা

- ৫MB এর বেশি ফাইল গ্রহণ করবে না
- যেসব VM eval/Function/fromCharCode/decodeURIComponent ব্যবহার করে না (যেমন custom WASM bytecode interpreter), সেগুলো decode হবে না — bot এক্ষেত্রে "no_capture" error দেখাবে
- Anti-debug / devtools-detection থাকা script headless এ crash করতে পারে — page error log এ দেখা যাবে
- শুধু নিজের ব্যবহারের জন্য — bot token কাউকে শেয়ার করো না
