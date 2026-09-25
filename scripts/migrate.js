require('./env');
// إنشاء الجداول يدويًا (يحدث تلقائيًا أيضًا عند أول طلب)
const db = require('../lib/db');
db.migrate().then(() => { console.log('✅ database ready'); return db.close(); }).catch((e) => { console.error(e); process.exit(1); });
