// ------------------------------------------------------------
// Characters — هوية بصرية فقط. لا ترتبط بأي قدرة.
// الشخصيات بأسماء عربية. عدد الشخصيات يحدد أقصى عدد لاعبين (حتى 15).
//
// characterImage   : الصورة الكاملة (بطاقة الاختيار، الإقصاء، الفوز)
// characterPortrait: صورة الوجه المربعة (القوائم، الشات، التصويت)
//
// الرسومات تُولَّد بـ scripts/gen_characters.py (نفس الأسلوب لكل الشخصيات).
// لاستبدالها برسومات 3D نهائية: ضع الصور بنفس المسارات أو عدّل الحقول هنا.
// ------------------------------------------------------------
const RAW = [
  // slug, name, Arabic name, title, accent
  // ---- مستوحاة من الصور المرجعية ----
  ['saqr',    'Saqr',    'صقر',   'نظرة هادئة… وعقل لا ينام',     '#7fd6ff'],
  ['jabal',   'Jabal',   'جبل',   'قلب المخيّم، لا يهتز',          '#ffb347'],
  ['shaheen', 'Shaheen', 'شاهين', 'ضحكته تخفي الخطة',              '#ff5d7a'],
  ['hakeem',  'Hakeem',  'حكيم',  'حكيم الجزيرة',                  '#e0b872'],
  ['sultan',  'Sultan',  'سلطان', 'صاحب الكرسي والمسبحة',          '#c9a7ff'],
  ['qadi',    'Qadi',    'قاضي',  'لا تفوته كذبة',                 '#8bffcf'],
  // ---- الشلة ----
  ['dekho',       'Dekho',       'ديخو',     'ملك الفوضى الجميلة',   '#b8ff5a'],
  ['abood',       'Abood',       'عبود',     'الطيب… أو هكذا يبدو',  '#5ab8ff'],
  ['emad',        'Emad',        'عماد',     'يحسبها قبل لا يتكلم',  '#3ee6c4'],
  ['rayes',       'Al-Rayes',    'الريس',    'الكلمة الأخيرة له',    '#ffcf4a'],
  ['abdulmajeed', 'Abdulmajeed', 'عبدالمجيد', 'هدوء يسبق العاصفة',    '#b18cff'],
  ['hamdan',      'Hamdan',      'حمدان',    'لا يتراجع أبدًا',       '#4ade80'],
  ['muneer',      'Muneer',      'منير',     'ضحكته تفتح الأبواب',   '#ff9a3c'],
  ['abuhanay',    'Abu Hanay',   'ابو هناي', 'كبير المخيّم',          '#ff7a6b'],
];

const CHARACTERS = RAW.map(([slug, name, nameAr, title, accent]) => ({
  characterId: `char_${slug}`,
  characterName: name,
  nameAr,
  title,
  accent,
  characterImage: `/characters/${slug}.svg`,
  characterPortrait: `/characters/${slug}-portrait.svg`,
}));

const byId = new Map(CHARACTERS.map((c) => [c.characterId, c]));
module.exports = {
  CHARACTERS,
  isValidCharacter: (id) => typeof id === 'string' && byId.has(id),
  getCharacter: (id) => byId.get(id) || null,
};
