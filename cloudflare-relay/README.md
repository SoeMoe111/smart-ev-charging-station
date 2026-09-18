# October 8 Cloudflare relay preparation

ဤ branch က relay source/tests နဲ့ **5-second polling proposal** ကိုသိမ်းထားသည်။
ဤ branch ၏ `firebase-service.js` ကို live version အဖြစ် မကူးတင်ရ။
Local test PASS သည် ESP32 end-to-end test PASS ဟု မဆိုလိုပါ။

## Latest migration status — September 19, 2026 (Myanmar time)

- User phone/current network/VPN OFF မှ Worker health၊ Firebase ID-token refresh၊
  station read နဲ့ booking read လေးခုလုံး PASS ကို screenshot ဖြင့်အတည်ပြုထားသည်။
  New anonymous sign-in သို့မဟုတ် admin password login ကို သီးခြားအတည်မပြုရသေး။
- Website `main` တွင် relay URL တစ်ကြောင်းတည်းကို
  `https://smart-ev-firebase-relay.smoe49262.workers.dev/firebase` ပြောင်းတင်ထားသည်။
  Commit: `5ae06c95394f440ec82f41e76af03a7852ad95ee`။
  **Live polling သည် 2 seconds အတိုင်းဖြစ်သည်**။ Auth၊ UID၊ schema နဲ့ Rules မပြောင်းပါ။
- Exact previous website ကို `backup-pre-cloudflare-web-20260919-e5aec421` branch
  တွင်သိမ်းထားသည်။ Rollback လုပ်ရန် ဤ branch ၏ `firebase-service.js` ကိုသုံးနိုင်သည်။
- Rollout validation 9 tests က fake transport ကိုသာသုံး၍ RTDB data ကို မရေး/မဖျက်ပါ။
- User က live homepage Refresh လုပ်၍ booking display/admin access ပြန်စမ်းရန်ကျန်သည်။
- **ESP32 ကိုမ flash ရသေးပါ**။ Device သည် previous ChatGPT relay ကိုသုံးနေဆဲဖြစ်သည်။
  Website နဲ့ ESP32 က မတူသော relay URLs မှ same RTDB ကိုသုံးနိုင်သော်လည်း device ကို
  Cloudflare URL ပြောင်းပြီး hardware tests လုပ်မှ old relay dependency ဖယ်နိုင်မည်။
  ဒီမတိုင်ခင် old relay ကိုမဖျက်ရ။ ChatGPT account dependency အားလုံးပျောက်ပြီဟု မဆိုရ။

## ပြင်ထားသည့်အရာ

- Website polling: 2 seconds → 5 seconds။ ESP32 telemetry cadence နဲ့ကိုက်ပြီး
  Free relay request quota အတွက် နေရာပိုကျန်စေသည်။
  ဤပြောင်းလဲမှုသည် စမ်းသပ် branch တွင်သာရှိသည်။ Live Website က 2 seconds အတိုင်းဖြစ်သည်။
  Demo latency ကို hardware ပေါ်တွင်စမ်းပြီး user သဘောတူမှ polling ပြောင်းရန်။
- `worker.mjs`: Website နဲ့ ESP32 `v5` နှစ်ခုလုံးသုံးသော
  `/firebase/<path>.json` + `Authorization: Bearer <Firebase ID token>` protocol ကိုထိန်းထားသည်။
- Caller ID token ဖြင့် Firebase REST request ပို့သောကြောင့် **မူလ Firebase Rules
  အတိုင်း authorization စစ်သည်**။ Service account၊ admin key၊ database secret၊
  Wi-Fi password သို့မဟုတ် device password မပါ။
- Upstream သည် မူလ Singapore RTDB တစ်ခုတည်းဖြစ်သည်။ General-purpose proxy မဟုတ်။
- Project data roots လေးခုသာခွင့်ပြုသည်။ Browser CORS က GitHub Pages origin ကိုသာ
  ခွင့်ပြုသည်။ Origin မပါသော ESP32 request များကို Firebase Rules ဖြင့်စစ်သည်။
- GET/POST/PUT/PATCH/DELETE၊ CORS preflight၊ JSON body size cap၊ no-store response၊
  timeout နဲ့ credential-safe generic errors ပါသည်။

## Local verification

Phone မှ read-only preflight ကို သီးခြားဖွင့်နိုင်သည်:

[Cloudflare Read Check](https://soemoe111.github.io/smart-ev-charging-station/cloudflare-check.html)

`RUN TEST` နှိပ်မှ Worker health၊ Firebase ID-token refresh၊ station read နဲ့
booking read ကို တစ်ခါစစ်သည်။ Polling မရှိ၊ RTDB data မရေး/မဖျက်ပါ။ Existing
login session ကိုမပယ်ပါ။ Session မရှိလျှင် anonymous Auth user အသစ်ဖြစ်နိုင်သည်။
Public config ကို text အဖြစ်သာဖတ်၍ RFID hotfix modules ကိုမ execute လုပ်ပါ။
Token၊ password၊ UID နဲ့ database payload ကိုမပြပါ။ Read PASS သည် browser/network
test သာဖြစ်ပြီး admin/device write၊ ESP32 online၊ charging နဲ့ safety test မဟုတ်ပါ။
ဤ test page files နှစ်ခုကို သီးခြားထည့်သည့်အဆင့်တွင် existing code ကိုမပြောင်းခဲ့ပါ။
နောက်ပိုင်း live relay URL ပြောင်းထားသည့်အခြေအနေကို အပေါ်က Latest migration status တွင်ကြည့်ရန်။
GitHub Pages build ပြီးမှ page အသစ်ရနိုင်သည်။

Repository root မှ run ရန်:

```bash
node --check firebase-service.js
node --check cloudflare-relay/worker.mjs
node --test cloudflare-relay/worker.test.mjs
node --test cloudflare-relay/cloudflare-check.test.mjs
```

Tests က fake upstream နဲ့ fake JWT-shaped token ကိုသာသုံးသည်။ Firebase data ကို
တကယ်ဖတ်/ရေး/ဖျက်ခြင်း မရှိပါ။

## Deploy နဲ့ switch လုပ်ပုံ

1. Cloudflare ကို Project owner ၏ **အမြဲတမ်း account** အောက်တွင်သုံးရန်။
2. `worker.mjs` ကို Module Worker အဖြစ်တင်ရန်။ `wrangler.toml` က CLI deployment
   configuration ဖြစ်သည်။ Existing configured Cloudflare credentials ရှိသော
   laptop တွင် `cloudflare-relay` directory မှ `npx wrangler deploy` သုံးနိုင်သည်။
   Google password/OTP/API token ကို ChatGPT message သို့မဟုတ် public GitHub မတင်ရ။
   Phone dashboard code editor တွင် `worker.js` အဟောင်းကို Select all လုပ်ပြီး
   ဤ `worker.mjs` အပြည့်အစုံဖြင့်အစားထိုး၊ Deploy နှိပ်နိုင်သည်။ Import/binding မလိုပါ။
3. Deploy result မှ **အမှန်တကယ်ရသည့်** Worker URL ကိုယူရန်။ URL မခန့်မှန်းရ။
4. `/health` သို့မဟုတ် root URL ဖွင့်ခြင်းသည် Worker ကိုသာစစ်သည်။ Firebase Auth၊ Rules နဲ့ RTDB access
   ကောင်းသည်ဟု အတည်မပြုနိုင်သေး။
5. VPN OFF၊ October 8 တွင်သုံးမည့် network ပေါ်တွင် Anonymous sign-in၊ bookings read၊
   station read၊ admin login၊ ခွင့်မရှိသော write denial တို့ကိုသီးသန့်စမ်းရန်။
   စမ်းသပ် data ရေး/ဖျက်မည်ဆိုပါက owner က disposable test data ကိုသတ်မှတ်ပြီးမှစမ်းရန်။
6. Test ပြီးမှ Website `FIREBASE_RELAY_URL` ကို deployed Worker URL + `/firebase`
   ပြောင်းရန်။ GitHub Pages URL နဲ့ QR code ပြောင်းစရာမလို။
7. **ESP32 ကျောင်းမှပြန်ရပြီးမှ** `v5` firmware relay URL ကိုပြောင်း၊ flash၊
   power-cycle၊ RFID/booking/telemetry/E-stop/fault tests အားလုံးပြန်လုပ်ရန်။
   Device auth UID၊ password၊ Rules နဲ့ database schema ကို ဒီ migration အတွက်
   မပြောင်းရ။ Credentials rotation လိုပါက သီးခြားစီပြုလုပ်ပြီး ပြန်စမ်းရန်။
8. ပြောင်းခါနီး current RTDB JSON export နဲ့ exact working firmware ကို private
   external backup သိမ်းရန်။ Password ပါသော firmware ကို public repository မတင်ရ။

## Demo အတွက် မပြီးသေးသော verification

- Authentication Authorized domains မှ `soemoe111.github.io` ရှိ/မရှိ။
- Live deployed Rules အပြည့်အစုံနဲ့ device/admin UID permissions။
  Rules screenshots အပေါ်/အောက်ပိုင်းသာဖြင့် Rules အားလုံး PASS ဟု မဆိုနိုင်။
- Firebase Authentication သည် **တိုက်ရိုက် Google endpoint** ကိုသုံးနေဆဲဖြစ်သည်။
  RTDB relay ပြောင်းခြင်းက blocked Auth endpoint ကို မဖြေရှင်းပေး။
- ကျောင်း Wi-Fi/hotspot နှစ်မျိုး၊ ESP32 2.4 GHz၊ VPN OFF၊ backup network စမ်းသပ်ရန်။
- Network fault ရှိနေစဉ် E-stop response latency ကို Hardware ပေါ်တွင်တိုင်းရန်။
  Firmware ၏ synchronous HTTPS calls ကြောင့် software safety response ကို
  ချက်ချင်းဖြစ်သည်ဟု မယူဆရ။ Fuse/BMS/physical disconnect ကိုမပယ်ရ။
- Website local fallback သည် interface demo သာဖြစ်သည်။ Physical charging အတွက်
  offline mode ရှိပြီးသားဟု မဆိုနိုင်။
- October 6–7 full rehearsal၊ working code freeze၊ demo video၊ USB/data cable၊
  Internet backup နဲ့ private firmware backup ပြင်ဆင်ရန်။

## Quota နဲ့ rollback

Live 2-second website read streams နှစ်ခု၏ zero-latency baseline က 86,400
requests/day ဖြစ်သည်။ ESP32 telemetry 5-second baseline 17,280 နဲ့ပေါင်းလျှင်
103,680 ဖြစ်နိုင်သည်။ တကယ့် cadence တွင် network latency ပါဝင်ပြီး admin၊ device
read/actions၊ retries နဲ့ tabs များက ထပ်ပေါင်းမည်။ Free quota ဖြင့် demo မတိုင်ခင်
usage ကိုစစ်ရမည်၊ မလိုသော website tabs ကိုနေ့ညမဖွင့်ထားရ။ အောက်က 5-second budget
သည် proposal အတွက်သာဖြစ်ပြီး live polling ပြောင်းပြီးသားဟု မယူဆရ။

5-second polling အတွက် ပုံမှန် Website tab တစ်ခု၏ read streams နှစ်ခုသည်
တစ်ရက်ခန့်မှန်းအများဆုံး 34,560 requests ဖြစ်သည်။ 5-second ESP32 telemetry baseline က
17,280 requests/day ဖြစ်သည်။ RFID၊ booking actions၊ extra tabs/devices၊ admin
polling၊ retries နဲ့ OPTIONS requests များက ထပ်ပေါင်းသုံးစွဲမည်။
Cloudflare Workers Free current limit က 100,000 requests/day ဖြစ်သောကြောင့်
demo မတိုင်ခင် account usage ကိုစစ်ပြီး မလိုသော tabs မဖွင့်ထားရ။

ပြောင်းပြီး network ပြဿနာဖြစ်လျှင် saved working relay URL သို့ client constants
ပြန်ပြောင်းပြီး verified previous version ကိုပြန် deploy/flash လုပ်ရန်။ Database
data delete/reset လုပ်စရာမလို။ Current relay ကို demo ပြီးသည်အထိ မဖျက်ရ။
No relay/provider သည် မြန်မာနိုင်ငံ ISP အားလုံးအတွက် VPN မလိုဘဲအလုပ်လုပ်မည်ဟု
အာမခံမပေးနိုင်။ Same-network test နဲ့ offline presentation fallback လိုအပ်သည်။

## Primary references

- [Firebase REST authentication](https://firebase.google.com/docs/database/rest/auth)
- [Cloudflare Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
