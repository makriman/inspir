import { defaultLanguage, type SupportedLanguage } from "@/lib/content/languages";
import {
  isPreservedTranslationLiteral,
  isValidFieldTranslation,
} from "@/lib/i18n/translation-field-validation";
import type { TranslationBundle, TranslationSource } from "@/lib/i18n/translation-types";

const reviewedTranslationPreserveValues = new Map<string, string>([
  ["Amharic\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.0fedfa66d0ac", "የstartup ሐሳቤን በግፊት ፈትን"],
  ["Amharic\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.53b7a8625771", "ostrakon ቁራጭን ፈትሽ"],
  ["Amharic\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.group-study-timer.starter.0", "የቡድን Pomodoro አቅድ"],
  ["Arabic\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.53b7a8625771", "تفقّد الأوستراكون"],
  ["Arabic\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.group-study-timer.starter.0", "خطّط لجلسة بومودورو جماعية"],
  ["Assamese\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.53b7a8625771", "ostrakon পৰীক্ষা কৰক"],
  ["Assamese\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.5876b89b7d02", "শিকাৰ বিষয়ে Hypatia"],
  ["Assamese\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.ad6a9fdf7f34", "David বিষয়ে সোধক"],
  ["Assamese\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.talk-to-a-historical-person.starter.0", "Cleopatra-ৰ সৈতে কথা পাতক"],
  ["Assamese\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.5728bdb5f3eb838312", "Trivia-ৰ ওপৰত মোক কুইজ কৰক"],
  ["Bulgarian\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.0fedfa66d0ac", "Провери под натиск идеята ми за startup"],
  ["Bulgarian\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.group-study-timer.starter.0", "Планирай групов Pomodoro"],
  ["Bulgarian\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.5728bdb5f3eb838312", "Изпитай ме с Trivia"],
  ["Bulgarian\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.d9c636955d36e0ee3a", "По-широката open-source платформа inspir."],
  ["Bengali\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.debate-with-a-personality.starter.2", "Batman-এর সঙ্গে ন্যায়বিচার নিয়ে বিতর্ক করুন"],
  ["Bengali\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.talk-to-a-historical-person.starter.0", "Cleopatra-র সঙ্গে কথা বলুন"],
  ["Bengali\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.5728bdb5f3eb838312", "Trivia নিয়ে আমাকে কুইজ করুন"],
  ["Bengali\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.d9c636955d36e0ee3a", "বৃহত্তর open-source inspir প্ল্যাটফর্ম।"],
  ["German\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.06a1b27fe4f6", "Die lernende Person zeigt Transfer."],
  ["German\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.5876b89b7d02", "Hypatia über das Lernen"],
  ["German\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.703dddc1cf94", "Fragen mit kurzem Coaching."],
  ["German\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.ad6a9fdf7f34", "Nach dem David fragen"],
  ["German\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.cd0defd8af9b", "Person oder Herausforderung"],
  ["German\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.science-lab-partner.starter.0", "Entwirf ein Experiment zum Pflanzenwachstum"],
  ["German\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.01ff1921147e28c735", "Ein kleines Quiz erstellen"],
  ["Greek\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.0fedfa66d0ac", "Δοκιμάστε την ιδέα μου για startup υπό πίεση"],
  ["Greek\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.accountability-partner.starter.1", "Γράψτε σενάριο check-in"],
  ["Greek\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.debate-with-a-personality.starter.2", "Συζητήστε για τη δικαιοσύνη με τον Batman"],
  ["Greek\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.group-study-timer.starter.0", "Σχεδιάστε ομαδικό Pomodoro"],
  ["Greek\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.3500071337b0ad334d", "Από το blog"],
  ["Greek\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.d9c636955d36e0ee3a", "Η ευρύτερη open-source πλατφόρμα inspir."],
  ["Persian\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.group-study-timer.starter.0", "یک Pomodoro گروهی برنامه ریزی کن"],
  ["Persian\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.5728bdb5f3eb838312", "از من درباره Trivia آزمون بگیر"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.53b7a8625771", "Suriin ang ostrakon"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.geography-explorer.starter.2", "Ikumpara ang India at Japan"],
  ["Filipino\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.d9c636955d36e0ee3a", "Ang mas malawak na open-source na platform ng inspir."],
  ["Gujarati\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.0444272e88dc", "Company દળોમાં અંગ્રેજી"],
  ["Gujarati\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.1f0bef28ebb0", "કેટલાક વેપારીઓમાં Sogdian"],
  ["Gujarati\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.418610cbe31b", "Ostiaએ Romeની પુરવઠા વ્યવસ્થાને સેવા આપી"],
  ["Gujarati\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.53b7a8625771", "ostrakon તપાસો"],
  ["Gujarati\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.5876b89b7d02", "શીખવા પર Hypatia"],
  ["Gujarati\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.ad6a9fdf7f34", "David વિશે પૂછો"],
  ["Gujarati\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.f86742548fbf", "Paris રાજકીય રીતે અસ્થિર હતું"],
  ["Gujarati\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.talk-to-a-historical-person.starter.0", "Cleopatra સાથે વાત કરો"],
  ["Hausa\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.90b8131b4d1f", "Renaissance Florence a 1490"],
  ["Hausa\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.ad6a9fdf7f34", "Tambayi game da David"],
  ["Hausa\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.geography-explorer.starter.2", "Kwatanta India da Japan"],
  ["Hausa\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.quiz-me-on-trivia.name", "Yi mini tambayoyin trivia"],
  ["Hausa\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.talk-to-a-historical-person.starter.0", "Yi magana da Cleopatra"],
  ["Hausa\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.5728bdb5f3eb838312", "Yi mini tambayoyin Trivia"],
  ["Hebrew\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.418610cbe31b", "Ostia שירתה את מערכת האספקה של רומא"],
  ["Hebrew\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.5876b89b7d02", "Hypatia על למידה"],
  ["Hebrew\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.a0155b7f8952", "השוק המערבי בתקופת שושלת Tang"],
  ["Hebrew\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.ad6a9fdf7f34", "שאלו על David"],
  ["Hebrew\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.debate-with-a-personality.starter.2", "ויכוח על צדק עם Batman"],
  ["Hebrew\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.group-study-timer.starter.0", "תכננו Pomodoro קבוצתי"],
  ["Hebrew\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.talk-to-a-historical-person.starter.0", "דברו עם Cleopatra"],
  ["Hebrew\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.5728bdb5f3eb838312", "בחן אותי על Trivia"],
  ["Armenian\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.0fedfa66d0ac", "Ճնշման տակ փորձարկեք իմ startup գաղափարը"],
  ["Armenian\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.418610cbe31b", "Ostia-ն ծառայում էր Հռոմի մատակարարման համակարգին"],
  ["Armenian\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.53b7a8625771", "Զննեք ostrakon-ը"],
  ["Armenian\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.debate-with-a-personality.starter.2", "Բանավիճել արդարության մասին Batman-ի հետ"],
  ["Armenian\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.group-study-timer.starter.0", "Պլանավորիր խմբային Pomodoro"],
  ["Armenian\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.language-roleplay.starter.2", "Hindi շուկայում սակարկություն"],
  ["Italian\\u0000route:mission\\u000046969c0630b4acedc5064c912b7eadffda90c595d635e6d4a3f8e6fb6c4ad753\\u0000site.70e4f8445dc3f0d14c", "tutor IA per scuole"],
  ["Japanese\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.0444272e88dc", "Company軍内の英語"],
  ["Japanese\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.5876b89b7d02", "学びについてのHypatia"],
  ["Japanese\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.debate-with-a-personality.starter.2", "Batmanと正義について討論する"],
  ["Japanese\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.talk-to-a-historical-person.starter.0", "Cleopatraと話す"],
  ["Georgian\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.0444272e88dc", "ინგლისური Company-ის ძალებში"],
  ["Georgian\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.0fedfa66d0ac", "ჩემი startup იდეა წნეხით შეამოწმე"],
  ["Georgian\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.418610cbe31b", "Ostia რომის მომარაგების სისტემას ემსახურებოდა"],
  ["Georgian\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.5876b89b7d02", "Hypatia სწავლაზე"],
  ["Georgian\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.ad6a9fdf7f34", "იკითხე David-ის შესახებ"],
  ["Georgian\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.debate-with-a-personality.starter.2", "Batman-თან სამართლიანობაზე დებატი"],
  ["Georgian\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.group-study-timer.starter.0", "დაგეგმე ჯგუფური Pomodoro"],
  ["Georgian\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.talk-to-a-historical-person.starter.0", "Cleopatra-სთან საუბარი"],
  ["Georgian\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.5728bdb5f3eb838312", "გამომკითხეთ Trivia-ზე"],
  ["Kannada\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.0fedfa66d0ac", "ನನ್ನ startup ಕಲ್ಪನೆಯನ್ನು ಒತ್ತಡ ಪರೀಕ್ಷೆಗೆ ಒಳಪಡಿಸಿ"],
  ["Kannada\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.1f0bef28ebb0", "ಕೆಲವು ವ್ಯಾಪಾರಿಗಳ ನಡುವೆ Sogdian"],
  ["Kannada\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.a0155b7f8952", "Tang ವಂಶದ ಕಾಲದ ಪಶ್ಚಿಮ ಮಾರುಕಟ್ಟೆ"],
  ["Kannada\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.ad6a9fdf7f34", "David ಬಗ್ಗೆ ಕೇಳಿ"],
  ["Kannada\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.geography-explorer.starter.1", "Himalayas ಅನ್ನು ಅನ್ವೇಷಿಸಿ"],
  ["Kannada\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.group-study-timer.starter.0", "ಗುಂಪು Pomodoro ಯೋಜಿಸಿ"],
  ["Kannada\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.5728bdb5f3eb838312", "Trivia ಬಗ್ಗೆ ನನ್ನನ್ನು ಪರೀಕ್ಷಿಸಿ"],
  ["Korean\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.0444272e88dc", "Company 부대 사이의 영어"],
  ["Korean\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.group-study-timer.starter.0", "그룹 Pomodoro 계획"],
  ["Malayalam\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.0444272e88dc", "Company സേനകളിൽ ഇംഗ്ലീഷ്"],
  ["Malayalam\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.0f626379c5a5", "Drachmae-യും obols-വും"],
  ["Malayalam\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.3d7ec899f5c7", "Athenian agora ഒരു പൗരകേന്ദ്രമായിരുന്നു"],
  ["Malayalam\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000language.prompt.english", "English ഉപയോഗിച്ച് തുടരുക"],
  ["Malayalam\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.group-study-timer.starter.0", "ഒരു ഗ്രൂപ്പ് Pomodoro ആസൂത്രണം ചെയ്യുക"],
  ["Marathi\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.0444272e88dc", "Company सैन्यात इंग्रजी"],
  ["Marathi\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.1f0bef28ebb0", "काही व्यापाऱ्यांत Sogdian"],
  ["Marathi\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.418610cbe31b", "Ostia ने Rome च्या पुरवठा व्यवस्थेला सेवा दिली"],
  ["Marathi\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.53b7a8625771", "ostrakon तपासा"],
  ["Marathi\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.5876b89b7d02", "शिकण्याबद्दल Hypatia"],
  ["Marathi\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.ad6a9fdf7f34", "David बद्दल विचारा"],
  ["Marathi\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.f86742548fbf", "Paris राजकीयदृष्ट्या अस्थिर होते"],
  ["Marathi\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.talk-to-a-historical-person.starter.0", "Cleopatra शी बोला"],
  ["Marathi\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.5728bdb5f3eb838312", "Trivia वर माझी क्विझ घ्या"],
  ["Nepali\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.5876b89b7d02", "सिकाइबारे Hypatia"],
  ["Nepali\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.ad6a9fdf7f34", "David बारे सोध्नुहोस्"],
  ["Nepali\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.talk-to-a-historical-person.starter.0", "Cleopatra सँग कुरा गर्नुहोस्"],
  ["Odia\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.5876b89b7d02", "Hypatia ଶିଖିବା ବିଷୟରେ"],
  ["Odia\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.ad6a9fdf7f34", "David ବିଷୟରେ ପଚାରନ୍ତୁ"],
  ["Odia\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.group-study-timer.starter.0", "ଗୋଷ୍ଠୀ Pomodoro ଯୋଜନା କରନ୍ତୁ"],
  ["Odia\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.5728bdb5f3eb838312", "Trivia ଉପରେ ମୋତେ କୁଇଜ୍ କରନ୍ତୁ"],
  ["Odia\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.d9c636955d36e0ee3a", "ବଡ଼ ପରିସରର open-source inspir ପ୍ଲାଟଫର୍ମ।"],
  ["Punjabi\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.53b7a8625771", "ostrakon ਦੀ ਜਾਂਚ ਕਰੋ"],
  ["Punjabi\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.5876b89b7d02", "Hypatia ਸਿੱਖਣ ਬਾਰੇ"],
  ["Punjabi\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.ad6a9fdf7f34", "David ਬਾਰੇ ਪੁੱਛੋ"],
  ["Punjabi\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.talk-to-a-historical-person.starter.0", "Cleopatra ਨਾਲ ਗੱਲ ਕਰੋ"],
  ["Punjabi\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.5728bdb5f3eb838312", "Trivia ਤੇ ਮੇਰਾ ਕਵਿਜ਼ ਲਵੋ"],
  ["Sinhala\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.0444272e88dc", "Company බලකා අතර ඉංග්‍රීසි"],
  ["Sinhala\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.0fedfa66d0ac", "මගේ startup අදහස පීඩන-පරීක්ෂා කරන්න"],
  ["Sinhala\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.1f0bef28ebb0", "සමහර වෙළෙන්දන් අතර Sogdian"],
  ["Sinhala\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.418610cbe31b", "Ostia Rome හි සැපයුම් පද්ධතියට සේවය කළේය"],
  ["Sinhala\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.53b7a8625771", "ostrakon කැබැල්ල පරීක්ෂා කරන්න"],
  ["Sinhala\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.5876b89b7d02", "Hypatia සහ ඉගෙනීම"],
  ["Sinhala\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.a0155b7f8952", "Tang රාජවංශය සමයේ West Market"],
  ["Sinhala\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.ad6a9fdf7f34", "David ගැන අහන්න"],
  ["Sinhala\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.f86742548fbf", "Paris දේශපාලනිකව අස්ථාවර විය"],
  ["Sinhala\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.debate-with-a-personality.starter.2", "Batman සමඟ යුක්තිය විවාද කරන්න"],
  ["Sinhala\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.geography-explorer.starter.1", "Himalayas ගවේෂණය කරන්න"],
  ["Sinhala\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.language-roleplay.starter.2", "Hindi වෙළඳපොළ මිල කතා කිරීම"],
  ["Sinhala\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.talk-to-a-historical-person.starter.0", "Cleopatra සමඟ කතා කරන්න"],
  ["Sinhala\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.d9c636955d36e0ee3a", "පුළුල් open-source inspir වේදිකාව."],
  ["Somali\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.geography-explorer.starter.2", "Isbarbar dhig India iyo Japan"],
  ["Serbian\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.group-study-timer.starter.0", "Планирај групни Pomodoro"],
  ["Serbian\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.d9c636955d36e0ee3a", "Шира open-source inspir платформа."],
  ["Tamil\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.0444272e88dc", "Company படைகளிடையே ஆங்கிலம்"],
  ["Tamil\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.0fedfa66d0ac", "என் startup யோசனையை அழுத்தச் சோதனை செய்"],
  ["Tamil\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.1f0bef28ebb0", "சில வணிகர்களிடையே Sogdian"],
  ["Tamil\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.418610cbe31b", "Ostia, ரோமின் வழங்கல் அமைப்பிற்கு சேவை செய்தது"],
  ["Tamil\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.ad6a9fdf7f34", "David பற்றி கேளுங்கள்"],
  ["Tamil\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.debate-with-a-personality.starter.2", "நீதி பற்றி Batman-உடன் விவாதிக்கவும்"],
  ["Tamil\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.geography-explorer.starter.1", "Himalayas-ஐ ஆராய்"],
  ["Tamil\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.group-study-timer.starter.0", "குழு Pomodoro-வைத் திட்டமிடு"],
  ["Tamil\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.language-roleplay.starter.2", "Hindi சந்தை விலைபேச்சு"],
  ["Tamil\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.talk-to-a-historical-person.starter.0", "Cleopatra-வுடன் பேசுங்கள்"],
  ["Telugu\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.1f0bef28ebb0", "కొంతమంది వ్యాపారుల మధ్య Sogdian"],
  ["Telugu\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.ad6a9fdf7f34", "David గురించి అడగండి"],
  ["Telugu\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.debate-with-a-personality.starter.2", "న్యాయం గురించి Batman‌తో వాదించండి"],
  ["Telugu\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.group-study-timer.starter.0", "సమూహ Pomodoroను ప్రణాళిక చేయండి"],
  ["Telugu\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.talk-to-a-historical-person.starter.0", "Cleopatraతో మాట్లాడండి"],
  ["Thai\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.0444272e88dc", "ภาษาอังกฤษในหมู่กองกำลัง Company"],
  ["Thai\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.1f0bef28ebb0", "ภาษา Sogdian ในหมู่พ่อค้าบางคน"],
  ["Thai\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.418610cbe31b", "Ostia ทำหน้าที่ในระบบเสบียงของ Rome"],
  ["Thai\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.53b7a8625771", "ตรวจดู ostrakon"],
  ["Thai\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.5876b89b7d02", "Hypatia ว่าด้วยการเรียนรู้"],
  ["Thai\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.a0155b7f8952", "West Market ในราชวงศ์ Tang"],
  ["Thai\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.ad6a9fdf7f34", "ถามเรื่อง David"],
  ["Thai\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.f86742548fbf", "Paris มีความผันผวนทางการเมือง"],
  ["Thai\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.geography-explorer.starter.1", "สำรวจ Himalayas"],
  ["Thai\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.talk-to-a-historical-person.starter.0", "คุยกับ Cleopatra"],
  ["Ukrainian\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.group-study-timer.starter.0", "Спланувати груповий Pomodoro"],
  ["Ukrainian\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.d9c636955d36e0ee3a", "Ширша open-source платформа inspir."],
  ["Urdu\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.5876b89b7d02", "Hypatia سیکھنے پر"],
  ["Urdu\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.ad6a9fdf7f34", "David کے بارے میں پوچھیں"],
  ["Urdu\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.talk-to-a-historical-person.starter.0", "Cleopatra سے بات کریں"],
  ["Urdu\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.5728bdb5f3eb838312", "Trivia پر میرا کوئز لیں"],
  ["Yoruba\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.26a5f8e6af94", "Awọn ọna si London Bridge"],
  ["Yoruba\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.90b8131b4d1f", "Renaissance Florence ni 1490"],
  ["Yoruba\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.a72a8f73dc11", "Awọn ọna si Red Fort"],
  ["Yoruba\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.ad6a9fdf7f34", "Beere nipa David"],
  ["Yoruba\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.geography-explorer.starter.2", "Fi India ati Japan we"],
  ["Yoruba\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.history-cause-and-effect.starter.0", "Awọn idi World War I"],
  ["Yoruba\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.quiz-me-on-trivia.name", "Ṣe ìdánwò trivia fún mi"],
  // Production-fluency review 226: exact identity/value preserves that were
  // independently adjudicated as fluent after the broad corpus audit.
  ["Arabic\\u0000legal:privacy\\u000091c1b6ff25b53cc0143c710bd821d17945a82dd164a0555c0a1311294c24106a\\u0000site.2206f606a331ff272d", "حقوقك في حماية البيانات بموجب قانون خصوصية المستهلك في ولاية كاليفورنيا (CCPA)"],
  ["Arabic\\u0000legal:privacy\\u000091c1b6ff25b53cc0143c710bd821d17945a82dd164a0555c0a1311294c24106a\\u0000site.bd07a65cbdecdff374", "حقوق حماية البيانات الخاصة بك بموجب قانون حماية الخصوصية في ولاية كاليفورنيا (CalOPPA)"],
  ["Arabic\\u0000legal:privacy\\u000091c1b6ff25b53cc0143c710bd821d17945a82dd164a0555c0a1311294c24106a\\u0000site.c94235c894769acc17", "أدوات CI/CD"],
  ["Arabic\\u0000legal:privacy\\u000091c1b6ff25b53cc0143c710bd821d17945a82dd164a0555c0a1311294c24106a\\u0000site.ec508b3fff91678bf1", "حقوقك في حماية البيانات بموجب اللائحة العامة لحماية البيانات (GDPR)"],
  ["Arabic\\u0000route:compare\\u00002616ecef457a02b8c78ede28e068f4031e4495fe09131f0bec8afe222a620a88\\u0000site.79c71876203f61d77c", "{value1} {value2}"],
  ["Spanish\\u0000route:compare\\u00002616ecef457a02b8c78ede28e068f4031e4495fe09131f0bec8afe222a620a88\\u0000site.79c71876203f61d77c", "{value1} {value2}"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.011074a0acd3", "Suriin ang token ng guild"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.0c5330d19ead", "Mas mabuti ang remote na trabaho"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.0ef451aeaa85", "Ang eksaktong mga usapan sa tavern"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.1f3b4e685d50", "Sinusuri ng AI ang iyong artifact"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.29fa1113cbe9", "Suriin ang selyo ng amphora"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.2dfa6e9d7e40", "Tanungin kung paano gumagana ang patronage"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.3a042a496dd2", "Gamitin ang prompt loop"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.418610cbe31b", "Naglingkod ang Ostia sa sistema ng suplay ng Roma"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.53ff98946c83", "Buksan ang mini-app na Historical Person bilang isang isinadulang pakikipagharap sa tauhang pangkasaysayan, na may patuloy na naia-update na dossier."],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.5aa26a431afe", "Ang AI-resolved na saklaw ng petsa"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.66325effd9f8", "Palitan ang pangalan ng variable sa lahat ng dako."],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.6b9d6a34d557", "Simulan ang loop"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.88dff25d7085", "Ang user ang nagpapasya kung ano ang ilalabas"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.8cbf31717577", "bumuo ng kapaki-pakinabang na mental na modelo"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.926364936c28", "mahigpit na kritiko at editor"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.968d8ccd3939", "Ang Tang Chang'an ay isang kosmopolitang kabisera ng imperyo na konektado sa steppe, Gitnang Asya, at mga ugnayang Budista."],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.c8937243bab0", "Ang simbolikong awtoridad ng Mughal sa ilalim ng kontrol ng mga rebelde, na pinagtatalunan ng East India Company"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.d2a52a72e732", "Lokal na barya o token"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.d5ca92bd8779", "Humingi ng isang parallel na halimbawa"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.dbdcf0dcd9e6", "Halaga = tinatayang mga free cash flow na diniskwento para sa panganib + diniskwentong terminal value."],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.e27e7173e91e", "Handa na para sa 10 minutong checkpoint"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.e6d880e891f8", "Hindi masuri ang card"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.ee1a791783a4", "Default na presyon ng aralin"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.f6de21b4dfb7", "Suriin ang isang folio ng manuskrito"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.f86742548fbf", "Ang Paris ay may mga kaguluhan sa pulitika"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.fb6b185fb00f", "Buksan ang portal"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000memory.status.off", "Naka-off para sa account na ito"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000memory.status.on", "Naka-on para sa account na ito"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000profile.account.kicker", "Account at privacy"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000profile.details.saveError", "Hindi ma-save ang profile."],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000profile.photo.updated", "Ang larawan ng profile ay na-update."],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.code-tutor.starter.1", "Tulungan akong i-debug ang error na ito"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.course-manager.starter.1", "Ayusin ang aking semester"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.debate-any-topic.starter.0", "Mapanganib ba ang social media?"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.ethics-dilemmas.subText", "Magsanay ng moral na pangangatuwiran"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.feynman-tutor.starter.2", "Tulungan mo akong gawing simple ang recursion"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.flashcard-builder.starter.1", "Gawing Q&A ang note na ito"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.grade-gpa-calculator.starter.2", "Iplano ang aking target na GPA"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.image-analysis-coach.starter.0", "Tulungan akong basahin ang diagram na ito"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.interview-coach.description", "Maghanda para sa mga panayam sa paaralan, internship, trabaho, o scholarship gamit ang makatotohanang mga tanong at feedback."],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.learn-anything.starter.2", "Tulungan mo akong maunawaan ang photosynthesis"],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.learning-game-master.description", "Gawin ang pag-aaral na parang isang laro na may mga quests, antas, puntos, hamon, at boss rounds."],
  ["Filipino\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.math-step-coach.starter.2", "Ipaliwanag ang mga derivatives hakbang-hakbang"],
  ["Filipino\\u0000marketing-shell\\u0000975a0cb9c0a4bb5df9c13ece6f77200464d7922afd2235e8d4fbecbaa2d9d0bf\\u0000site.a58f0bc12b7e451fdf", "I-play ang preview ng pag-aaral sa inspir"],
  ["Filipino\\u0000marketing-shell\\u0000975a0cb9c0a4bb5df9c13ece6f77200464d7922afd2235e8d4fbecbaa2d9d0bf\\u0000site.ac03d0786921a7ada5", "Magsimula ng isang live na sesyon sa pag-aaral."],
  ["Filipino\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.6bc1b280c55aceeb1b", "Ang susunod na henerasyong platform sa pag-aaral gamit ang AI."],
  ["Filipino\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.9219f300e6d6741265", "Subukan ang Homework Coach"],
  ["Filipino\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.94ad4463944c3f8b6b", "AI tutor para sa mahirap na mga konsepto"],
  ["Filipino\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.a58f0bc12b7e451fdf", "I-play ang preview ng pag-aaral sa inspir"],
  ["Filipino\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.ac03d0786921a7ada5", "Magsimula ng isang live na sesyon sa pag-aaral."],
  ["Filipino\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.bca473d3438d9d87b8", "Mga popular na landas ng pag-aaral ng AI"],
  ["Filipino\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.bca4abf0832cb158fb", "Maliwanag na hangganan ng privacy"],
  ["Filipino\\u0000route:home\\u0000fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce\\u0000site.f408b36efd1825ae46", "Buksan ang chat ng bisita"],
  ["Filipino\\u0000route:mission\\u000046969c0630b4acedc5064c912b7eadffda90c595d635e6d4a3f8e6fb6c4ad753\\u0000site.1687989496c04b7aad", "Media at mga pagsipi"],
  ["Filipino\\u0000route:mission\\u000046969c0630b4acedc5064c912b7eadffda90c595d635e6d4a3f8e6fb6c4ad753\\u0000site.32d85689f30d9b7dae", "Tingnan ang bawat mode"],
  ["Filipino\\u0000route:mission\\u000046969c0630b4acedc5064c912b7eadffda90c595d635e6d4a3f8e6fb6c4ad753\\u0000site.5db8abc8a39a43ed81", "Matapos maibenta ang inspir.app domain upang pondohan ang patuloy na libreng access, lumipat ang live na produkto sa inspirlearning.com."],
  ["Filipino\\u0000route:mission\\u000046969c0630b4acedc5064c912b7eadffda90c595d635e6d4a3f8e6fb6c4ad753\\u0000site.88f244e2f3ee33dd5a", "Access para sa assistant at sanggunian"],
  ["Filipino\\u0000route:mission\\u000046969c0630b4acedc5064c912b7eadffda90c595d635e6d4a3f8e6fb6c4ad753\\u0000site.92b307e5f4dca15b56", "Mga hangganan ng pagtitiwala at privacy"],
  ["Filipino\\u0000route:mission\\u000046969c0630b4acedc5064c912b7eadffda90c595d635e6d4a3f8e6fb6c4ad753\\u0000site.cc1cf401efc5eb8129", "Ang susunod na yugto ay open-source, contributor-friendly, at konektado sa mas malawak na internasyonal na pagbuo sa inspir.uk."],
  ["Filipino\\u0000route:mission\\u000046969c0630b4acedc5064c912b7eadffda90c595d635e6d4a3f8e6fb6c4ad753\\u0000site.d915c021851d2ab6be", "Gamitin ang https://inspirlearning.com para sa site, /mission para sa misyon, /topics para sa pampublikong direktoryo ng mga mode ng pag-aaral, at /chat/learn-anything para sa default na karanasan ng bisitang nag-aaral."],
  ["Hausa\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.1f0bef28ebb0", "Sogdian a tsakanin wasu 'yan kasuwa"],
  ["Hausa\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.2f7b7ad341e0", "Masanin dabarun Salt March, waiwaye daga St. Helena, ɗakin kwamitin na 1946..."],
  ["Hausa\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.418610cbe31b", "Ostia ta yi wa tsarin samar da kayayyaki na Roma hidima"],
  ["Hausa\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.98d5309ca571", "Sanskrit a cikin mahallin addinin Buddha"],
  ["Hausa\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.f86742548fbf", "Paris tana da rikici a siyasa"],
  ["Hausa\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.debate-with-a-personality.starter.2", "Yi muhawara kan adalci tare da Batman"],
  ["Hausa\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.flashcard-builder.starter.0", "Yi katunan tunawa don mitosis"],
  ["Hausa\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.habit-coach.starter.2", "Yi aiki da coding kowace rana"],
  ["Hausa\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.language-roleplay.starter.2", "Yin ciniki a kasuwa da harshen Hindi"],
  ["Hausa\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.study-guide-generator.starter.0", "Yi jagora don photosynthesis"],
  ["Hausa\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.talk-to-a-historical-person.starter.1", "Ku haɗu da Ada Lovelace"],
  ["Hindi\\u0000legal:privacy\\u000091c1b6ff25b53cc0143c710bd821d17945a82dd164a0555c0a1311294c24106a\\u0000site.2206f606a331ff272d", "कैलिफ़ोर्निया उपभोक्ता गोपनीयता अधिनियम (CCPA) के तहत आपके डेटा संरक्षण अधिकार"],
  ["Hindi\\u0000legal:privacy\\u000091c1b6ff25b53cc0143c710bd821d17945a82dd164a0555c0a1311294c24106a\\u0000site.bd07a65cbdecdff374", "कैलिफोर्निया गोपनीयता संरक्षण अधिनियम (CalOPPA) के तहत आपके डेटा संरक्षण अधिकार"],
  ["Hindi\\u0000legal:privacy\\u000091c1b6ff25b53cc0143c710bd821d17945a82dd164a0555c0a1311294c24106a\\u0000site.ec508b3fff91678bf1", "सामान्य डेटा संरक्षण विनियमन (GDPR) के तहत आपके डेटा संरक्षण अधिकार"],
  ["Hindi\\u0000route:compare\\u00002616ecef457a02b8c78ede28e068f4031e4495fe09131f0bec8afe222a620a88\\u0000site.79c71876203f61d77c", "{value1} {value2}"],
  ["Malayalam\\u0000legal:privacy\\u000091c1b6ff25b53cc0143c710bd821d17945a82dd164a0555c0a1311294c24106a\\u0000site.2206f606a331ff272d", "കാലിഫോർണിയ ഉപഭോക്തൃ സ്വകാര്യതാ നിയമം (CCPA) പ്രകാരമുള്ള നിങ്ങളുടെ ഡാറ്റാ പരിരക്ഷണ അവകാശങ്ങൾ"],
  ["Malayalam\\u0000legal:privacy\\u000091c1b6ff25b53cc0143c710bd821d17945a82dd164a0555c0a1311294c24106a\\u0000site.bd07a65cbdecdff374", "കാലിഫോർണിയ സ്വകാര്യത സംരക്ഷണ നിയമം (CalOPPA) പ്രകാരം നിങ്ങളുടെ ഡാറ്റാ പരിരക്ഷണ അവകാശങ്ങൾ"],
  ["Malayalam\\u0000legal:privacy\\u000091c1b6ff25b53cc0143c710bd821d17945a82dd164a0555c0a1311294c24106a\\u0000site.c94235c894769acc17", "CI/CD ഉപകരണങ്ങൾ"],
  ["Malayalam\\u0000legal:privacy\\u000091c1b6ff25b53cc0143c710bd821d17945a82dd164a0555c0a1311294c24106a\\u0000site.da5f872c6030bbd1c3", "മറ്റുള്ളവരുടെ ബൗദ്ധിക സ്വത്തവകാശങ്ങളെ ഞങ്ങൾ മാനിക്കുന്നു. സേവനത്തിൽ പോസ്റ്റ് ചെയ്ത ഉള്ളടക്കം ഏതെങ്കിലും വ്യക്തിയുടെയോ സ്ഥാപനത്തിന്റെയോ പകർപ്പവകാശമോ മറ്റ് ബൗദ്ധിക സ്വത്തവകാശങ്ങളോ ലംഘിക്കുന്നു (\"ലംഘനം\") എന്ന അവകാശവാദങ്ങൾക്ക് പ്രതികരിക്കുക എന്നതാണ് ഞങ്ങളുടെ നയം. നിങ്ങൾ ഒരു പകർപ്പവകാശ ഉടമയോ ഉടമയുടെ പേരിൽ പ്രവർത്തിക്കാൻ അധികാരപ്പെട്ട വ്യക്തിയോ ആണെങ്കിൽ, പകർപ്പവകാശമുള്ള കൃതി പകർപ്പവകാശലംഘനമാകുന്ന വിധത്തിൽ പകർത്തിയതായി വിശ്വസിക്കുന്നുവെങ്കിൽ, \"Copyright Infringement\" എന്ന വിഷയവരിയോടെ support@inspir.app എന്ന വിലാസത്തിലേക്ക് ഇമെയിൽ അയച്ച് നിങ്ങളുടെ അവകാശവാദം സമർപ്പിക്കുക; താഴെ \"DMCA Notice and Procedure for Copyright Infringement Claims\" എന്നതിൽ വിശദീകരിച്ചിരിക്കുന്നതുപോലെ, ആരോപിക്കപ്പെടുന്ന ലംഘനത്തിന്റെ വിശദമായ വിവരണം അവകാശവാദത്തിൽ ഉൾപ്പെടുത്തണം. സേവനത്തിലോ സേവനം വഴിയോ ലഭിക്കുന്ന ഏതെങ്കിലും ഉള്ളടക്കവുമായി ബന്ധപ്പെട്ട പകർപ്പവകാശലംഘനത്തെക്കുറിച്ചുള്ള തെറ്റായ പ്രസ്താവനകൾക്കോ ദുഷ്പ്രേരിത അവകാശവാദങ്ങൾക്കോ നഷ്ടപരിഹാരത്തിന് (ചെലവുകളും അഭിഭാഷക ഫീസും ഉൾപ്പെടെ) നിങ്ങൾ ഉത്തരവാദിയാകാം."],
  ["Malayalam\\u0000legal:privacy\\u000091c1b6ff25b53cc0143c710bd821d17945a82dd164a0555c0a1311294c24106a\\u0000site.ec508b3fff91678bf1", "പൊതു ഡാറ്റാ പ്രൊട്ടക്ഷൻ റെഗുലേഷൻ (GDPR) പ്രകാരം നിങ്ങളുടെ ഡാറ്റാ പരിരക്ഷണ അവകാശങ്ങൾ"],
  ["Malayalam\\u0000route:compare\\u00002616ecef457a02b8c78ede28e068f4031e4495fe09131f0bec8afe222a620a88\\u0000site.79c71876203f61d77c", "{value1} {value2}"],
  ["Somali\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000topic.study-guide-generator.starter.0", "Samee hage ku saabsan photosynthesis"],
  ["Yoruba\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.2f7b7ad341e0", "Olùṣètò ọgbọ́n fún Salt March, ìwòye sẹ́yìn láti St. Helena, yàrá ìgbìmọ̀ ní 1946..."],
  ["Yoruba\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.418610cbe31b", "Ọ̀nà tí wọ́n gbà ń pèsè oúnjẹ fún ìlú Róòmù ni ìlú Ostia ń gbà ṣe é"],
  ["Yoruba\\u0000main-app\\u0000fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0\\u0000component.c8937243bab0", "Agbára àmì ti Mughal lábẹ́ ìṣàkóso àwọn ọlọ̀tẹ̀, tí East India Company ń tako"],
]);

export type TranslationFieldReviewContext = {
  namespace: string;
  sourceHash: string;
  key: string;
};

export const reviewedTranslationPreserveCount = reviewedTranslationPreserveValues.size;

export function isReviewedTranslationPreserve(
  translated: string | undefined,
  language: SupportedLanguage,
  context: TranslationFieldReviewContext | undefined,
) {
  if (!translated || !context) return false;
  const identity = [language, context.namespace, context.sourceHash, context.key].join(
    "\\u0000",
  );
  return reviewedTranslationPreserveValues.get(identity) === translated;
}

const protectedTerms = new Set([
  "admin",
  "ai",
  "api",
  "csr",
  "d1",
  "github",
  "inspir",
  "json",
  "llm",
  "llms",
  "ncert",
  "openai",
  "pwa",
  "r2",
  "rag",
  "reset",
  "rss",
  "seo",
  "url",
  "urls",
  "webp",
]);

const englishLeakageWords = new Set([
  "a",
  "about",
  "access",
  "action",
  "active",
  "after",
  "all",
  "and",
  "answer",
  "answers",
  "ask",
  "back",
  "better",
  "browse",
  "built",
  "can",
  "chat",
  "check",
  "clear",
  "coding",
  "companion",
  "content",
  "custom",
  "debate",
  "design",
  "every",
  "everyone",
  "explain",
  "feedback",
  "film",
  "first",
  "flashcards",
  "for",
  "free",
  "from",
  "guide",
  "guided",
  "guides",
  "has",
  "help",
  "homework",
  "into",
  "learn",
  "learner",
  "learners",
  "learning",
  "library",
  "live",
  "map",
  "markers",
  "mode",
  "modes",
  "not",
  "of",
  "open",
  "or",
  "path",
  "page",
  "practice",
  "prompt",
  "prompts",
  "public",
  "question",
  "questions",
  "quiz",
  "quizzes",
  "read",
  "review",
  "route",
  "school",
  "schools",
  "session",
  "start",
  "study",
  "support",
  "that",
  "the",
  "text",
  "timed",
  "to",
  "tool",
  "topic",
  "topics",
  "transcript",
  "tutor",
  "use",
  "ways",
  "with",
  "without",
  "writing",
  "you",
  "your",
  "captions",
  "chapter",
]);

const englishFunctionLeakageWords = new Set([
  "about",
  "after",
  "all",
  "are",
  "and",
  "back",
  "because",
  "before",
  "been",
  "being",
  "both",
  "can",
  "could",
  "did",
  "does",
  "each",
  "either",
  "every",
  "for",
  "from",
  "had",
  "has",
  "have",
  "here",
  "how",
  "into",
  "its",
  "may",
  "must",
  "neither",
  "not",
  "of",
  "only",
  "our",
  "should",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "under",
  "until",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "why",
  "will",
  "with",
  "without",
  "would",
  "you",
  "your",
]);

const mustTranslatePhrases = new Set([
  "Free public AI learning platform",
  "Open guest chat",
  "Practical guide",
  "Read the mission",
  "Start learning",
  "Transcript",
]);

const mustTranslateEmbeddedPhrases = [
  "Homework Coach",
  "Learn Anything",
  "Socratic Instruction",
] as const;

const protectedSourceTrigrams = new Set([
  "ada lovelace cleopatra",
  "apa mla chicago",
  "artificial intelligence and",
  "at a time",
  "b r ambedkar",
  "bahadur shah zafar",
  "cash flow and",
  "cash flow becomes",
  "cleopatra b r",
  "dailyhunt coverage of",
  "deep hack recognition",
  "east india company",
  "fatehpur sikri was",
  "free cash flow",
  "house of wisdom",
  "inspir learning community",
  "kashmere gate was",
  "kingdom of england",
  "kingdom of france",
  "lovelace cleopatra b",
  "mla chicago harvard",
  "one at a",
  "porter's five forces",
  "st paul's cathedral",
  "supply and demand",
  "terms and conditions",
]);

const citationStandardTerms = new Set(["apa", "chicago", "harvard", "mla"]);
const citationTechnicalTailTerms = new Set([
  "bibliography",
  "citation",
  "reference",
  "source",
  "website",
]);

const protectedLeakageTerms = new Set([
  ...protectedTerms,
  ...citationStandardTerms,
  "algebra",
  "amod",
  "ambedkar",
  "austerlitz",
  "bce",
  "calculus",
  "ce",
  "chatgpt",
  "css",
  "dailyhunt",
  "debug",
  "deephack",
  "drachmae",
  "demand",
  "financial",
  "fetch",
  "format",
  "gpa",
  "html",
  "ielts",
  "javascript",
  "jpg",
  "label",
  "modeling",
  "malviya",
  "napoleon",
  "nfc",
  "obols",
  "png",
  "promises",
  "project",
  "python",
  "sat",
  "sql",
  "stem",
  "supply",
  "science",
  "typescript",
  "undefined",
  "webp",
  "website",
  "white",
  "viva",
  "xp",
]);

const protectedExactTrigramTerms = new Set([
  ...protectedLeakageTerms,
  ...citationTechnicalTailTerms,
]);

const protectedShortHybridTerms = new Set([
  ...protectedLeakageTerms,
  "akbar",
  "ambedkar",
  "amphora",
  "app",
  "artificial",
  "assistant",
  "cash",
  "chat",
  "chatbot",
  "code",
  "coding",
  "data",
  "debug",
  "debrief",
  "deck",
  "deep",
  "diwan-i-khas",
  "dossier",
  "drachmae",
  "email",
  "feedback",
  "flashcard",
  "flashcards",
  "florin",
  "flow",
  "google",
  "gpa",
  "greek",
  "guild",
  "html",
  "ielts",
  "india",
  "japan",
  "javascript",
  "kashmere",
  "machine",
  "memory",
  "metic",
  "mini",
  "mla",
  "model",
  "modeling",
  "mohenjo-daro",
  "ncert",
  "obols",
  "ostia",
  "ostrakon",
  "partner",
  "portfolio",
  "prompt",
  "prompts",
  "provider",
  "python",
  "quiz",
  "quizzes",
  "rajput",
  "recall",
  "roleplay",
  "rupee",
  "sat",
  "simulation",
  "socrates",
  "socratic",
  "sogdian",
  "sparring",
  "speaking",
  "sprint",
  "sql",
  "startup",
  "stem",
  "tang",
  "terminal",
  "token",
  "tokyo",
  "typescript",
  "user",
  "value",
  "viva",
  "website",
  "weighted",
  "xp",
  "xuanzong",
]);

const protectedDistributedLeakageTerms = new Set([
  ...protectedLeakageTerms,
  "akbar",
  "bastille",
  "cathedral",
  "choice",
  "delhi",
  "google",
  "jury's",
  "paul's",
  "st",
]);

const languageProtectedDistributedLeakageTerms: Partial<
  Record<SupportedLanguage, ReadonlySet<string>>
> = {
  German: new Set(["levels", "quests"]),
};

const protectedDistributedSourcePhrases = [
  ["amod", "malviya"],
  ["bahadur", "shah", "zafar"],
  ["emperor", "xuanzong"],
  ["faubourg", "saint-antoine"],
  ["indian", "rebellion"],
  ["jury's", "choice"],
  ["mughal", "empire"],
  ["porter's", "five", "forces"],
  ["st", "paul's", "cathedral"],
  ["tang", "empire"],
] as const;

const spanishCorruptionMarkers =
  /\b(?:translation pending|traducci[oó]n pendiente|impotant|aprendered|wok|woking|wokshop|foward|conout|moe|erro|histoia|memoia|scoe|claroly|fuented|oganizad|compruebaed|concentraci[oó]ned|aprendeer|refuentes|borado|tiempod|tiempoal|deber[ií]un|son you|do you|va un|un know|pregunta fo|try primer|el persona|tu own|ese produced|correcto now|transfer un un)\b/i;

const knownOrthographyCorruptionMarkers: Partial<Record<SupportedLanguage, RegExp>> = {
  French: /\bmemoire\b/i,
  German: /\b(?:ergaenze|hinzufuegen|loeschen)\b/i,
  Italian: /\bcio\b/i,
  Portuguese: /\b(?:cartoes|editaveis)\b/i,
};

const hindiEnglishWrapper = /^\s*(?:समझें|हिंदी में)\s*:\s*[A-Za-z]/u;

const predominantlyNonLatinLanguages = new Set<SupportedLanguage>([
  "Hindi",
  "Russian",
  "Ukrainian",
  "Greek",
  "Arabic",
  "Hebrew",
  "Persian",
  "Urdu",
  "Bengali",
  "Tamil",
  "Telugu",
  "Marathi",
  "Gujarati",
  "Kannada",
  "Malayalam",
  "Punjabi",
  "Odia",
  "Assamese",
  "Nepali",
  "Sinhala",
  "Chinese",
  "Japanese",
  "Korean",
  "Thai",
  "Amharic",
  "Serbian",
  "Bulgarian",
  "Georgian",
  "Armenian",
]);

const strictLatinHybridLanguages = new Set<SupportedLanguage>([
  "Czech",
  "Filipino",
  "German",
  "Hausa",
  "Italian",
  "Somali",
  "Turkish",
  "Yoruba",
]);

const strictLatinHybridTargetWords: Partial<
  Record<SupportedLanguage, ReadonlySet<string>>
> = {
  Czech: new Set(["cíl", "nejprve", "režim", "veřejné", "vyzkoušet", "zpětná"]),
  Filipino: new Set(["ang", "at", "gawing", "maliit", "na"]),
  German: new Set([
    "aktives",
    "abrufen",
    "debatte",
    "ein",
    "fragen",
    "lernen",
    "lernende",
    "oder",
    "rollenspiel",
  ]),
  Hausa: new Set([
    "a",
    "aini",
    "ana",
    "cikin",
    "da",
    "dole",
    "don",
    "gano",
    "gina",
    "kafin",
    "karɓi",
    "ko",
    "liƙa",
    "masu",
    "muke",
    "na",
    "ne",
    "saita",
    "ta",
    "wane",
    "waɗanne",
    "ya",
    "yi",
    "zane",
  ]),
  Italian: new Set(["genitori", "insegnanti", "scuole"]),
  Somali: new Set(["abaabul", "ama", "deji", "iyo", "kee", "naqshadee", "samee"]),
  Turkish: new Set(["destek", "müfredat", "okul", "veya"]),
  Yoruba: new Set([
    "ati",
    "awọn",
    "bi",
    "di",
    "gbogbo",
    "fun",
    "gba",
    "jẹ",
    "ju",
    "ka",
    "kan",
    "kekere",
    "kọ",
    "ko",
    "ku",
    "labẹ",
    "le",
    "lẹyin",
    "loye",
    "lọ",
    "lati",
    "mi",
    "n",
    "ni",
    "nipa",
    "ninu",
    "oni",
    "pada",
    "pẹlu",
    "ranti",
    "rẹ",
    "ri",
    "ṣe",
    "ṣiṣẹ",
    "ṣaaju",
    "ṣeto",
    "si",
    "tabi",
    "ti",
    "titi",
    "to",
    "tumọ",
    "wulo",
    "wo",
    "yanju",
    "yara",
    "yarayara",
    "yẹ",
    "yi",
    "yoo",
  ]),
};

export function isTranslationBundleCompleteAndFluent(
  source: TranslationSource,
  bundle: TranslationBundle | null,
  language: SupportedLanguage,
) {
  if (language === defaultLanguage) return true;
  if (!bundle || !isTranslationBundleFieldValid(source, bundle, language)) return false;
  if (hasSuspiciousTranslationReuse(source, bundle)) return false;

  return Object.entries(source.sourceStrings).every(([key, sourceText]) => {
    const translated = bundle.strings[key];
    return isTranslationFieldLikelyFluent(sourceText, translated, language, {
      namespace: source.namespace,
      sourceHash: source.sourceHash,
      key,
    });
  });
}

export function isTranslationBundleFieldValid(
  source: TranslationSource,
  bundle: TranslationBundle | null,
  language: SupportedLanguage,
) {
  if (!bundle || bundle.sourceHash !== source.sourceHash || bundle.language !== language) return false;

  return Object.entries(source.sourceStrings).every(([key, sourceText]) => {
    const translated = bundle.strings[key];
    if (typeof translated !== "string" || translated !== translated.normalize("NFC")) return false;
    return language === defaultLanguage
      ? translated === sourceText
      : isValidFieldTranslation(sourceText, translated, language, key);
  });
}

function hasSuspiciousTranslationReuse(source: TranslationSource, bundle: TranslationBundle) {
  const sourcesByTranslation = new Map<string, Set<string>>();
  for (const [key, sourceText] of Object.entries(source.sourceStrings)) {
    const translated = bundle.strings[key]?.trim();
    if (!translated) continue;
    const normalized = comparableText(translated);
    if (!normalized) continue;
    const sourceTexts = sourcesByTranslation.get(normalized) ?? new Set<string>();
    sourceTexts.add(comparableText(sourceText));
    if (sourceTexts.size >= 3) return true;
    sourcesByTranslation.set(normalized, sourceTexts);
  }
  return false;
}

export function isTranslationFieldLikelyFluent(
  sourceText: string,
  translated: string | undefined,
  language: SupportedLanguage,
  context?: TranslationFieldReviewContext,
) {
  if (language === defaultLanguage) return Boolean(translated?.trim());
  if (!translated?.trim()) return false;
  if (!isValidFieldTranslation(sourceText, translated, language, context?.key)) return false;
  if (hasStructuralTranslationCorruption(sourceText, translated, language)) return false;
  if (isReviewedTranslationPreserve(translated, language, context)) return true;

  const normalizedSource = comparableText(sourceText);
  const normalizedTranslated = comparableText(translated);
  if (!normalizedTranslated) return false;
  if (isPreservedTranslationLiteral(sourceText, translated, language)) return true;
  if (normalizedSource === normalizedTranslated && shouldTranslateSourceText(sourceText)) return false;
  if (
    mustTranslateEmbeddedPhrases.some(
      (phrase) => sourceText.includes(phrase) && translated.includes(phrase),
    )
  ) {
    return false;
  }

  if (hasConservativeSourceLeakage(sourceText, translated, language)) return false;

  return !hasLikelyEnglishLeakage(sourceText, translated, language);
}

function hasStructuralTranslationCorruption(
  sourceText: string,
  translated: string,
  language: SupportedLanguage,
) {
  if (translated.includes("\u00ad")) return true;

  if (
    hasConsecutiveTokenRun(translated, 3) &&
    !hasConsecutiveTokenRun(sourceText, 3)
  ) {
    return true;
  }

  const sourceLetters = sourceText.match(/\p{L}/gu)?.length ?? 0;
  const translatedLetters = translated.match(/\p{L}/gu)?.length ?? 0;
  if (sourceLetters >= 8 && translatedLetters < 2) return true;

  if (hasUnbalancedDelimiters(translated) && !hasUnbalancedDelimiters(sourceText)) {
    return true;
  }

  return (
    language === "Spanish" &&
    hasMalformedSpanishPunctuation(translated) &&
    !hasMalformedSpanishPunctuation(sourceText)
  );
}

function hasConsecutiveTokenRun(value: string, minimumRun: number) {
  const tokens =
    maskProtectedTranslationLiterals(value)
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu) ?? [];
  let run = 1;
  for (let index = 1; index < tokens.length; index += 1) {
    run = tokens[index] === tokens[index - 1] ? run + 1 : 1;
    if (run >= minimumRun) return true;
  }
  return false;
}

function hasUnbalancedDelimiters(value: string) {
  for (const [opening, closing] of [
    ["(", ")"],
    ["[", "]"],
  ] as const) {
    if (countOccurrences(value, opening) !== countOccurrences(value, closing)) return true;
  }
  return countOccurrences(value, '"') % 2 !== 0;
}

function countOccurrences(value: string, token: string) {
  return value.split(token).length - 1;
}

function hasMalformedSpanishPunctuation(value: string) {
  return /\s+[,.!?;:](?!\d)/u.test(value) || /[¿¡]\s/u.test(value);
}

function hasConservativeSourceLeakage(
  sourceText: string,
  translated: string,
  language: SupportedLanguage,
) {
  if (knownOrthographyCorruptionMarkers[language]?.test(translated)) return true;
  if (language === "Spanish" && spanishCorruptionMarkers.test(translated)) return true;
  if (hasUntranslatedSourceTrigram(sourceText, translated)) return true;
  if (hasDistributedSourceWordLeakage(sourceText, translated, language)) return true;
  return hasShortNonLatinSourceOverlap(sourceText, translated, language);
}

function hasUntranslatedSourceTrigram(sourceText: string, translated: string) {
  const sourceWords = caseAwareLatinWordTokens(sourceText);
  const translatedText = ` ${caseAwareLatinWordTokens(translated)
    .map((word) => word.normalized)
    .join(" ")} `;

  for (let index = 0; index <= sourceWords.length - 3; index += 1) {
    const words = sourceWords.slice(index, index + 3);
    const trigram = words.map((word) => word.normalized).join(" ");
    const capitalizedWords = words.filter((word) => /^[A-Z]/.test(word.raw)).length;
    if (
      capitalizedWords >= 2 ||
      protectedSourceTrigrams.has(trigram) ||
      words.some((word) => protectedExactTrigramTerms.has(word.normalized))
    ) {
      continue;
    }
    if (
      !isMostlyNonLatinText(translated) &&
      !words.some((word) => englishFunctionLeakageWords.has(word.normalized))
    ) {
      continue;
    }
    if (translatedText.includes(` ${trigram} `)) return true;
  }
  return false;
}

function hasShortNonLatinSourceOverlap(
  sourceText: string,
  translated: string,
  language: SupportedLanguage,
) {
  if (!predominantlyNonLatinLanguages.has(language) || countNonLatinLetters(translated) < 2) {
    return false;
  }
  if (language === "Hindi" && hindiEnglishWrapper.test(translated)) return true;

  const rawSourceWords = caseAwareLatinWordTokens(sourceText);
  const sourceWords = rawSourceWords.filter((word, index) => {
    if (word.normalized.length < 2 || protectedShortHybridTerms.has(word.normalized)) return false;
    if (!/^[A-Z]/.test(word.raw)) return true;
    const previousCapitalized =
      index > 0 &&
      /^[A-Z]/.test(rawSourceWords[index - 1]?.raw ?? "") &&
      /^\s+$/.test(word.separatorBefore);
    const nextCapitalized =
      index + 1 < rawSourceWords.length &&
      /^[A-Z]/.test(rawSourceWords[index + 1]?.raw ?? "") &&
      /^\s+$/.test(rawSourceWords[index + 1]?.separatorBefore ?? "");
    return !previousCapitalized && !nextCapitalized;
  });
  if (sourceWords.length === 0 || sourceWords.length > 4) return false;

  const translatedWords = new Set(
    caseAwareLatinWordTokens(translated).map((word) => word.normalized),
  );
  const leakedWords = new Set(
    sourceWords
      .filter((word) => translatedWords.has(word.normalized))
      .map((word) => word.normalized),
  );
  if (sourceWords.length <= 2) {
    return Array.from(leakedWords).some((word) => word.length >= 4);
  }
  return leakedWords.size >= 2 && leakedWords.size / sourceWords.length >= 0.5;
}

function hasDistributedSourceWordLeakage(
  sourceText: string,
  translated: string,
  language: SupportedLanguage,
) {
  const hasTargetScriptEvidence =
    predominantlyNonLatinLanguages.has(language) && countNonLatinLetters(translated) >= 2;
  const hasStrictLatinTargetEvidence =
    strictLatinHybridLanguages.has(language) && hasStrictLatinTargetWords(translated, language);
  if (!hasTargetScriptEvidence && !hasStrictLatinTargetEvidence) return false;

  const rawSourceWords = caseAwareLatinWordTokens(sourceText);
  const protectedPhraseWordIndexes = distributedProtectedWordIndexes(rawSourceWords);
  const sourceWords = new Set(
    rawSourceWords
      .filter((word, index) => {
        if (
          protectedPhraseWordIndexes.has(index) ||
          word.normalized.length < 2 ||
          protectedDistributedLeakageTerms.has(word.normalized) ||
          languageProtectedDistributedLeakageTerms[language]?.has(word.normalized)
        ) {
          return false;
        }
        if (hasStrictLatinTargetEvidence || !/^[A-Z]/.test(word.raw)) return true;
        const previousCapitalized =
          index > 0 &&
          /^[A-Z]/.test(rawSourceWords[index - 1]?.raw ?? "") &&
          /^\s+$/.test(word.separatorBefore);
        const nextCapitalized =
          index + 1 < rawSourceWords.length &&
          /^[A-Z]/.test(rawSourceWords[index + 1]?.raw ?? "") &&
          /^\s+$/.test(rawSourceWords[index + 1]?.separatorBefore ?? "");
        return !previousCapitalized && !nextCapitalized;
      })
      .map((word) => word.normalized),
  );
  if (sourceWords.size < 3) return false;

  const translatedWords = new Set(
    caseAwareLatinWordTokens(translated).map((word) => word.normalized),
  );
  const leakedWords = new Set(
    Array.from(sourceWords).filter((word) => translatedWords.has(word)),
  );
  const shortHybridSource =
    (hasTargetScriptEvidence || hasStrictLatinTargetEvidence) && sourceWords.size <= 4;
  if (
    shortHybridSource &&
    Array.from(leakedWords).some((word) => word.length >= 4)
  ) {
    return true;
  }
  const minimumLeakedWords = shortHybridSource ? 2 : 3;
  const minimumLeakageRatio = shortHybridSource
    ? 0.5
    : hasTargetScriptEvidence
      ? 0.18
      : 0.2;
  return (
    leakedWords.size >= minimumLeakedWords &&
    leakedWords.size / sourceWords.size >= minimumLeakageRatio
  );
}

function distributedProtectedWordIndexes(
  sourceWords: ReturnType<typeof caseAwareLatinWordTokens>,
) {
  const indexes = new Set<number>();
  for (const phrase of protectedDistributedSourcePhrases) {
    for (let start = 0; start <= sourceWords.length - phrase.length; start += 1) {
      if (
        phrase.every((expectedWord, offset) =>
          sourceWords[start + offset]?.normalized === expectedWord,
        )
      ) {
        for (let offset = 0; offset < phrase.length; offset += 1) {
          indexes.add(start + offset);
        }
      }
    }
  }
  return indexes;
}

function hasStrictLatinTargetWords(translated: string, language: SupportedLanguage) {
  const targetWords = strictLatinHybridTargetWords[language];
  if (!targetWords) return false;
  return unicodeWordTokens(translated).some((word) => targetWords.has(word));
}

function shouldTranslateSourceText(sourceText: string) {
  if (mustTranslatePhrases.has(sourceText.trim())) return true;
  const sourceWords = latinWordTokens(sourceText).filter((word) => !protectedTerms.has(word));
  return sourceWords.length >= 4;
}

function hasLikelyEnglishLeakage(
  sourceText: string,
  translated: string,
  language: SupportedLanguage,
) {
  const visibleSource = maskProtectedTranslationLiterals(sourceText);
  const visibleTranslated = maskProtectedTranslationLiterals(translated);
  const sourceWords = latinWordTokens(visibleSource).filter((word) => !protectedTerms.has(word));
  const translatedWords = latinWordTokens(visibleTranslated).filter((word) => !protectedTerms.has(word));
  if (sourceWords.length < 5) return false;

  if (
    predominantlyNonLatinLanguages.has(language) &&
    hasUnexpectedLatinDominance(visibleTranslated)
  ) {
    return true;
  }
  if (translatedWords.length < 5) return false;

  const sourceEnglishCount = sourceWords.filter((word) => englishLeakageWords.has(word)).length;
  if (sourceEnglishCount < 3) return false;

  const sourceEnglishWords = new Set(sourceWords.filter((word) => englishLeakageWords.has(word)));
  const leakedWords = translatedWords.filter((word) => sourceEnglishWords.has(word));
  const leakedFunctionWords = leakedWords.filter((word) => englishFunctionLeakageWords.has(word));
  const leakageRatio = leakedWords.length / translatedWords.length;
  if (!isMostlyNonLatinText(visibleTranslated)) {
    const functionLeakageRatio = leakedFunctionWords.length / translatedWords.length;
    return new Set(leakedFunctionWords).size >= 2 && functionLeakageRatio >= 0.1;
  }
  return new Set(leakedWords).size >= 3 && leakageRatio >= 0.18;
}

function hasUnexpectedLatinDominance(value: string) {
  const latin = value.match(/[A-Za-z]/g)?.length ?? 0;
  const nonLatin = value.match(/[^\u0000-\u024f\s\d\p{P}\p{S}]/gu)?.length ?? 0;
  return latin >= 24 && latin > nonLatin;
}

function isMostlyNonLatinText(value: string) {
  const latin = value.match(/[A-Za-z]/g)?.length ?? 0;
  const nonLatin = value.match(/[^\u0000-\u024f\s\d\p{P}\p{S}]/gu)?.length ?? 0;
  return nonLatin > latin;
}

function comparableText(value: string) {
  return value
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "")
    .replace(/\{[a-zA-Z0-9_]+\}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function latinWordTokens(value: string) {
  const words =
    maskProtectedTranslationLiterals(value)
      .toLowerCase()
      .match(/\p{L}+(?:['’-]\p{L}+)*/gu) ?? [];
  return words.filter((word) => /^[a-z]+(?:['-][a-z]+)*$/.test(word));
}

function unicodeWordTokens(value: string) {
  return (
    maskProtectedTranslationLiterals(value)
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/\p{L}+(?:['’-]\p{L}+)*/gu) ?? []
  );
}

function caseAwareLatinWordTokens(value: string) {
  const visibleText = maskProtectedTranslationLiterals(value);
  let previousEnd = 0;
  return Array.from(visibleText.matchAll(/[A-Za-z]+(?:['-][A-Za-z]+)*/g), (match) => {
    const start = match.index ?? previousEnd;
    const word = {
      raw: match[0],
      normalized: match[0].toLowerCase(),
      separatorBefore: visibleText.slice(previousEnd, start),
    };
    previousEnd = start + match[0].length;
    return word;
  });
}

function maskProtectedTranslationLiterals(value: string) {
  return value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/(?:mailto:|tel:)[^\s<>"']+/gi, " ")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, " ")
    .replace(/\b(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,63}\b/gi, " ")
    .replace(/`[^`\n]+`/g, " ")
    .replace(/\\u[0-9a-fA-F]{4}/g, " ")
    .replace(
      /(?<![\p{L}\p{N}_])\/(?:[a-z_][a-z0-9_.-]*\/)*(?:[a-z_][a-z0-9_.?=&%#-]*)/giu,
      " ",
    )
    .replace(/\{[a-zA-Z0-9_]+\}/g, " ")
    .replace(/\binspir\b/gi, " ");
}

function countNonLatinLetters(value: string) {
  return value.match(/[^\u0000-\u024f\s\d\p{P}\p{S}]/gu)?.length ?? 0;
}
