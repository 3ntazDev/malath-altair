# 🦅 ملاذ الطير — الرفع على GitHub والاستضافة على Vercel

**Developer: المبرمج فهد**

المطلوب ثلاث حسابات مجانية: GitHub · Vercel · Pusher (قاعدة البيانات Supabase جاهزة عندك).

---

## 1) Pusher — سرعة المحادثات (5 دقائق)
1. سجّل في https://dashboard.pusher.com ← **Channels** ← **Create app**.
2. الاسم: `malath-altair` · الـCluster: **ap2 (Mumbai)** — الأقرب للسعودية.
3. افتح **App Keys** واحتفظ بالقيم الأربع: `app_id`, `key`, `secret`, `cluster`.

> بدون Pusher تعمل اللعبة بوضع احتياطي (تحديث كل ثانيتين)، لكن الشات يكون أبطأ.

## 2) GitHub
1. https://github.com/new ← الاسم `malath-altair` ← **Private** (مستحسن) ← Create.
2. ارفع الملفات بإحدى الطرق:
   - **GitHub Desktop** (الأسهل): File ← Add local repository ← اختر المجلد ← Publish.
   - **سطر الأوامر**:
     ```bash
     git init
     git add .
     git commit -m "ملاذ الطير"
     git branch -M main
     git remote add origin https://github.com/<اسمك>/malath-altair.git
     git push -u origin main
     ```
   - **من الموقع**: "uploading an existing file" واسحب محتويات المجلد.

> ⚠️ لا ترفع ملف `.env` ولا مجلد `node_modules` أبدًا. ملف `.gitignore` يمنعهما تلقائيًا مع Git و GitHub Desktop،
> لكن عند الرفع بالسحب من الموقع تأكد أنك لم تسحبهما — `.env` فيه كلمة مرور قاعدة البيانات.

## 3) Vercel
1. https://vercel.com/new ← **Import** مستودع `malath-altair`.
2. Framework Preset: **Other** — لا تغيّر أي أوامر بناء.
3. افتح **Environment Variables** وأضف:

| Name | Value |
|---|---|
| `DATABASE_URL` | رابط Supabase **Transaction pooler** (المنفذ **6543**) |
| `PUSHER_APP_ID` | من Pusher |
| `PUSHER_KEY` | من Pusher |
| `PUSHER_SECRET` | من Pusher |
| `PUSHER_CLUSTER` | `ap2` |

رابط Supabase لمشروعك (المنفذ 6543، و `@` في كلمة المرور مكتوبة `%40`):
```
postgresql://postgres.qynreyrohhcnbgsblgdr:[PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
```

4. **Deploy**.

## 4) تأكد أن كل شيء يعمل
افتح: `https://<رابطك>.vercel.app/api/health`

المفروض يظهر:
```json
{ "database": "ok", "realtime": "pusher ✓", "region": "sin1" }
```
- `database: error` ← راجع `DATABASE_URL` (المنفذ 6543، و `%40` بدل `@`).
- `realtime: polling fallback` ← متغيرات Pusher ناقصة. أضفها ثم Deployments ← **Redeploy**.

## 5) التحديثات
أي تعديل ترفعه على GitHub ← Vercel ينشره تلقائيًا خلال دقيقة.

---

## لماذا اللعبة سريعة؟
- **الخادم بجانب قاعدة البيانات**: `vercel.json` يشغّل الخادم في سنغافورة (`sin1`) بجوار Supabase (`ap-southeast-1`).
- **الشات**: رحلتان فقط لقاعدة البيانات لكل رسالة، بدون قفل الغرفة، ثم Pusher للطرفين فقط.
- **العرض الفوري**: رسالتك تظهر عندك لحظة الضغط (🕓 ثم ✓ عند تأكيد الخادم).
- **التحديث**: قراءة واحدة من قاعدة البيانات عندما لا يتغير شيء.
- **التشغيل البارد**: فحص واحد لقاعدة البيانات بدل إعادة إنشاء الجداول.

> لأقصى سرعة للاعبين في السعودية مستقبلًا: مشروع Supabase في `eu-central-1 (Frankfurt)`
> مع تغيير `regions` في `vercel.json` إلى `fra1`.
