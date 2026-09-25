# 🦅 ملاذ الطير

**Developer: المبرمج فهد**

لعبة استنتاج اجتماعي جماعية أونلاين (4–15 لاعبًا) — تعمل من أي جهاز وأي شبكة عبر رابط Vercel واحد.

## المعمارية

```
المتصفح (public/)  ──HTTPS──▶  Vercel Function (api/index.js → lib/api.js)
      ▲                              │  BEGIN · SELECT … FOR UPDATE · قواعد اللعبة · COMMIT
      │                              ▼
      └──── Pusher (قناة خاصة لكل لاعب) ◀── نشر الإشعارات      Postgres (Neon/Supabase)
```

- **الخادم هو مصدر الحقيقة**: كل قاعدة (الانضمام، السعة 15، الأصوات، القدرات، الرسائل، الفوز) تُتحقق في `lib/game/engine.js`.
- **Postgres**: حالة الغرفة (JSONB) تُقفل صفيًا في كل Action، مع جداول: users, characters, games, game_players, rounds, messages, votes, abilities, ability_uses, game_events.
- **المؤقتات بدون خادم دائم**: الانتقال بين المراحل يحدث عند أول طلب بعد انتهاء الوقت (وقت الخادم فقط). المتصفحات تطلب `/api/sync` عند انتهاء العداد وكل 15 ثانية (نبضة الحضور).
- **الخصوصية**: لا توجد قناة مشتركة. كل لاعب يشترك في `private-user-<id>` فقط (يتحقق الخادم من الهوية). الرسالة الخاصة تُنشر للمرسل والمستقبل فقط، و`/api/sync` يعيد نسخة مفلترة لكل لاعب (`lib/game/views.js`).
- **Reconnect**: الجلسة Token محفوظ (hash في DB). فتح الرابط من جهاز/تبويب جديد بنفس الجلسة يعيد اللاعب لغرفته بكامل حالته ورسائله المصرح بها.

## التشغيل محليًا
```bash
npm install
npm start          # http://localhost:3000
```
ملف `.env` (لا يُرفع على GitHub) يحتوي `DATABASE_URL` — انظر `.env.example`.

## النشر على GitHub + Vercel
انظر **[docs/DEPLOY.md](docs/DEPLOY.md)** — خطوة بخطوة. بعد النشر افتح `/api/health` للتأكد.

## الشخصيات
`lib/characters.js` — 26 شخصية بنفس الأسلوب (characterId, characterName, nameAr, title, accent, characterImage, characterPortrait).
- 6 مستوحاة من الصور المرجعية: **Saqr، Jabal، Shaheen، Hakeem، Sultan، Qadi**.
- 8 من الشلة: **ديخو، عبود، عماد، الريس، عبدالمجيد، حمدان، منير، ابو هناي**.
- 12 ناجين أصليين: Riven، Kael، Mira، Nox، Ayla، Raven، Kairo، Luna، Zane، Vera، Sora، Ember.

الرسومات تُولَّد من `scripts/gen_characters.py` (رسم أنمي بظل Cel وإضاءة حافة). لتعديل شخصية غيّر خصائصها في `ROSTER` ثم:
`python3 scripts/gen_characters.py`. لاستبدالها برسومات 3D جاهزة ضع الصور بنفس المسارات في `public/characters/`.
الشخصية هوية بصرية فقط ولا ترتبط بأي قدرة.

## الجزيرة (شاشة اللعب)
- الشخصيات واقفة حول النار، و"أنت" في المقدمة. اضغط أي شخصية: محادثة خاصة / الملف / اختيار للتصويت.
- الوقت يتغير كل جولة: غروب → ليل → فجر → نهار.
- التصويت: اضغط الشخصية ثم **CONFIRM VOTE**. الإقصاء: الكاميرا تقترب، الاسم يظهر، والشخصية تختفي في الضباب.

## الـHost = لاعب + مشرف الغرفة
قبل البدء: الإعدادات، الطرد، الإغلاق، البدء. أثناء اللعب (زر ⚙️ إدارة): **END GAME** (بدون فائزين)، إزالة لاعب، إيقاف/استئناف، حالة الاتصال.
كل إجراءات الـHost يتحقق منها الخادم (غير الـHost يحصل على **403**) وتُسجّل في جدول `host_actions`.
الـHost لا يرى أي أسرار (أصوات، قدرات، محادثات).

## الملفات
```
api/index.js              Vercel Function (كل /api/*)
lib/api.js                المسارات + الجلسات
lib/rooms.js              Transactions + قفل الغرفة + النشر بعد COMMIT
lib/game/engine.js        كل قواعد اللعبة
lib/game/views.js         ما يراه كل لاعب
lib/game/abilities/       SPY, LAST STAND (قابلة للتوسعة)
lib/realtime/             pusher (إنتاج) · sse (محلي)
lib/schema.sql            قاعدة البيانات (تُنشأ تلقائيًا)
public/                   الواجهة (mobile-first)
scripts/dev.js            خادم التطوير
test/e2e.js               اختبار شامل عبر HTTP + Postgres + Realtime
```
