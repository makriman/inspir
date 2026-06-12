import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { languageConfigs, normalizeLanguage, supportedLanguages, type SupportedLanguage } from "@/lib/content/languages";
import { getMainAppSourceHash, getMainAppSourceStrings, mainAppTranslationNamespace } from "@/lib/i18n/main-app-source";
import { isValidFieldTranslation } from "@/lib/i18n/translation-field-validation";

const builtInLanguages = ["Hindi", "Kannada", "Tamil", "Malayalam", "Arabic", "Spanish", "Telugu"] as const;
const externalSeedDir = "scripts/translation-seeds/core-main-app";

const translations: Record<string, Record<string, string>> = {
  "Help inspir fit your age": {
    Hindi: "inspir को आपकी उम्र के अनुसार ढालने में मदद करें",
    Kannada: "inspir ಅನ್ನು ನಿಮ್ಮ ವಯಸ್ಸಿಗೆ ಹೊಂದಿಕೊಳ್ಳಲು ಸಹಾಯ ಮಾಡಿ",
    Tamil: "inspir உங்கள் வயதுக்கேற்ப பொருந்த உதவுங்கள்",
    Malayalam: "inspir നിങ്ങളുടെ പ്രായത്തിന് അനുയോജ്യമാകാൻ സഹായിക്കുക",
    Arabic: "ساعد inspir على التكيف مع عمرك",
    Spanish: "Ayuda a inspir a adaptarse a tu edad",
    Telugu: "inspir మీ వయస్సుకు సరిపడేలా సహాయపడండి",
  },
  "Tell us your date of birth so we can build an age-appropriate learning experience. We use it to adjust examples, tone, and safety boundaries.": {
    Hindi: "अपनी जन्मतिथि बताएं ताकि हम उम्र के अनुसार सीखने का अनुभव बना सकें। हम इसका उपयोग उदाहरण, लहजा और सुरक्षा सीमाएं समायोजित करने के लिए करते हैं।",
    Kannada: "ನಿಮ್ಮ ಜನ್ಮ ದಿನಾಂಕವನ್ನು ತಿಳಿಸಿ; ಅದರಿಂದ ನಾವು ವಯಸ್ಸಿಗೆ ತಕ್ಕ ಕಲಿಕಾ ಅನುಭವವನ್ನು ನಿರ್ಮಿಸಬಹುದು. ಉದಾಹರಣೆಗಳು, ಧ್ವನಿ ಮತ್ತು ಸುರಕ್ಷತಾ ಮಿತಿಗಳನ್ನು ಹೊಂದಿಸಲು ಅದನ್ನು ಬಳಸುತ್ತೇವೆ.",
    Tamil: "உங்கள் பிறந்த தேதியைச் சொல்லுங்கள்; அதனால் வயதுக்கு ஏற்ற கற்றல் அனுபவத்தை உருவாக்கலாம். எடுத்துக்காட்டுகள், தொனி, பாதுகாப்பு எல்லைகளைச் சரிசெய்ய அதைப் பயன்படுத்துகிறோம்.",
    Malayalam: "നിങ്ങളുടെ ജനന തീയതി അറിയിക്കൂ; പ്രായത്തിന് അനുയോജ്യമായ പഠനാനുഭവം ഒരുക്കാൻ അത് സഹായിക്കും. ഉദാഹരണങ്ങൾ, ശൈലി, സുരക്ഷാ പരിധികൾ എന്നിവ ക്രമീകരിക്കാൻ അത് ഉപയോഗിക്കുന്നു.",
    Arabic: "أخبرنا بتاريخ ميلادك حتى نبني تجربة تعلم مناسبة للعمر. نستخدمه لضبط الأمثلة والنبرة وحدود السلامة.",
    Spanish: "Dinos tu fecha de nacimiento para crear una experiencia de aprendizaje adecuada para tu edad. La usamos para ajustar ejemplos, tono y límites de seguridad.",
    Telugu: "మీ పుట్టిన తేదీని చెప్పండి; దాంతో వయస్సుకు తగిన నేర్చుకునే అనుభవాన్ని నిర్మించగలం. ఉదాహరణలు, స్వరం, భద్రతా పరిమితులను సర్దుబాటు చేయడానికి దాన్ని ఉపయోగిస్తాము.",
  },
  "Date of birth": {
    Hindi: "जन्मतिथि",
    Kannada: "ಜನ್ಮ ದಿನಾಂಕ",
    Tamil: "பிறந்த தேதி",
    Malayalam: "ജനന തീയതി",
    Arabic: "تاريخ الميلاد",
    Spanish: "Fecha de nacimiento",
    Telugu: "పుట్టిన తేదీ",
  },
  "Continue": {
    Hindi: "जारी रखें",
    Kannada: "ಮುಂದುವರಿಸಿ",
    Tamil: "தொடரவும்",
    Malayalam: "തുടരുക",
    Arabic: "متابعة",
    Spanish: "Continuar",
    Telugu: "కొనసాగించండి",
  },
  "Saving...": {
    Hindi: "सहेजा जा रहा है...",
    Kannada: "ಉಳಿಸಲಾಗುತ್ತಿದೆ...",
    Tamil: "சேமிக்கிறது...",
    Malayalam: "സംരക്ഷിക്കുന്നു...",
    Arabic: "جار الحفظ...",
    Spanish: "Guardando...",
    Telugu: "సేవ్ చేస్తోంది...",
  },
  "Please enter a valid date of birth.": {
    Hindi: "कृपया मान्य जन्मतिथि दर्ज करें।",
    Kannada: "ದಯವಿಟ್ಟು ಮಾನ್ಯ ಜನ್ಮ ದಿನಾಂಕವನ್ನು ನಮೂದಿಸಿ.",
    Tamil: "சரியான பிறந்த தேதியை உள்ளிடுங்கள்.",
    Malayalam: "ദയവായി ശരിയായ ജനന തീയതി നൽകുക.",
    Arabic: "يرجى إدخال تاريخ ميلاد صالح.",
    Spanish: "Introduce una fecha de nacimiento válida.",
    Telugu: "దయచేసి సరైన పుట్టిన తేదీని నమోదు చేయండి.",
  },
  "Age": {
    Hindi: "उम्र",
    Kannada: "ವಯಸ್ಸು",
    Tamil: "வயது",
    Malayalam: "പ്രായം",
    Arabic: "العمر",
    Spanish: "Edad",
    Telugu: "వయస్సు",
  },
  "Add your date of birth": {
    Hindi: "अपनी जन्मतिथि जोड़ें",
    Kannada: "ನಿಮ್ಮ ಜನ್ಮ ದಿನಾಂಕವನ್ನು ಸೇರಿಸಿ",
    Tamil: "உங்கள் பிறந்த தேதியைச் சேர்க்கவும்",
    Malayalam: "നിങ്ങളുടെ ജനന തീയതി ചേർക്കുക",
    Arabic: "أضف تاريخ ميلادك",
    Spanish: "Añade tu fecha de nacimiento",
    Telugu: "మీ పుట్టిన తేదీని జోడించండి",
  },
  "Open learning store": {
    Hindi: "लर्निंग स्टोर खोलें",
    Kannada: "ಕಲಿಕಾ ಸ್ಟೋರ್ ತೆರೆಯಿರಿ",
    Tamil: "கற்றல் கடையைத் திறக்கவும்",
    Malayalam: "ലേണിംഗ് സ്റ്റോർ തുറക്കുക",
    Arabic: "افتح متجر التعلم",
    Spanish: "Abrir tienda de aprendizaje",
    Telugu: "లెర్నింగ్ స్టోర్ తెరవండి",
  },
  "Search": {
    Hindi: "खोजें",
    Kannada: "ಹುಡುಕಿ",
    Tamil: "தேடுங்கள்",
    Malayalam: "തിരയുക",
    Arabic: "بحث",
    Spanish: "Buscar",
    Telugu: "వెతకండి",
  },
  "Search chats": {
    Hindi: "चैट खोजें",
    Kannada: "ಚಾಟ್‌ಗಳನ್ನು ಹುಡುಕಿ",
    Tamil: "அரட்டைகளைத் தேடுங்கள்",
    Malayalam: "ചാറ്റുകൾ തിരയുക",
    Arabic: "ابحث في المحادثات",
    Spanish: "Buscar chats",
    Telugu: "చాట్‌లను వెతకండి",
  },
  "free guest messages used": {
    Hindi: "मुफ्त अतिथि संदेश इस्तेमाल हुए",
    Kannada: "ಉಚಿತ ಅತಿಥಿ ಸಂದೇಶಗಳು ಬಳಕೆಯಾದವು",
    Tamil: "இலவச விருந்தினர் செய்திகள் பயன்படுத்தப்பட்டன",
    Malayalam: "സൗജന്യ അതിഥി സന്ദേശങ്ങൾ ഉപയോഗിച്ചു",
    Arabic: "تم استخدام رسائل الضيف المجانية",
    Spanish: "mensajes gratis de invitado usados",
    Telugu: "ఉచిత అతిథి సందేశాలు ఉపయోగించబడ్డాయి",
  },
  "Continue learning": {
    Hindi: "सीखना जारी रखें",
    Kannada: "ಕಲಿಕೆಯನ್ನು ಮುಂದುವರಿಸಿ",
    Tamil: "கற்றலைத் தொடருங்கள்",
    Malayalam: "പഠനം തുടരുക",
    Arabic: "واصل التعلم",
    Spanish: "Sigue aprendiendo",
    Telugu: "నేర్చుకోవడం కొనసాగించండి",
  },
  "Easy Google login, then inspir stores your learning history, language preference, and chats so everything is ready next time. inspir stays free to use.": {
    Hindi: "आसान Google लॉगिन के बाद inspir आपका सीखने का इतिहास, भाषा पसंद और चैट सहेजता है ताकि अगली बार सब तैयार रहे। inspir इस्तेमाल के लिए मुफ्त रहता है।",
    Kannada: "ಸರಳ Google ಲಾಗಿನ್ ನಂತರ inspir ನಿಮ್ಮ ಕಲಿಕಾ ಇತಿಹಾಸ, ಭಾಷಾ ಆದ್ಯತೆ ಮತ್ತು ಚಾಟ್‌ಗಳನ್ನು ಉಳಿಸುತ್ತದೆ; ಮುಂದಿನ ಬಾರಿ ಎಲ್ಲವೂ ಸಿದ್ಧವಾಗಿರುತ್ತದೆ. inspir ಬಳಸಲು ಉಚಿತವಾಗಿಯೇ ಇರುತ್ತದೆ.",
    Tamil: "எளிய Google உள்நுழைவுக்குப் பிறகு inspir உங்கள் கற்றல் வரலாறு, மொழி விருப்பம், அரட்டைகளைச் சேமிக்கும்; அடுத்த முறை எல்லாம் தயாராக இருக்கும். inspir இலவசமாகவே இருக்கும்.",
    Malayalam: "ലളിതമായ Google ലോഗിനിന് ശേഷം inspir നിങ്ങളുടെ പഠനചരിത്രം, ഭാഷാ മുൻഗണന, ചാറ്റുകൾ എന്നിവ സൂക്ഷിക്കും; അടുത്ത തവണ എല്ലാം തയ്യാറായിരിക്കും. inspir ഉപയോഗിക്കാൻ സൗജന്യമാണ്.",
    Arabic: "بعد تسجيل دخول Google السهل، يحفظ inspir سجل تعلمك وتفضيل اللغة والمحادثات حتى يكون كل شيء جاهزًا في المرة القادمة. يبقى inspir مجانيًا للاستخدام.",
    Spanish: "Con un inicio de sesión fácil con Google, inspir guarda tu historial de aprendizaje, preferencia de idioma y chats para que todo esté listo la próxima vez. inspir sigue siendo gratis.",
    Telugu: "సులభమైన Google లాగిన్ తర్వాత inspir మీ నేర్చుకున్న చరిత్ర, భాషా ప్రాధాన్యం, చాట్‌లను నిల్వ చేస్తుంది; తదుపరి సారి అన్నీ సిద్ధంగా ఉంటాయి. inspir ఉపయోగించడానికి ఉచితంగానే ఉంటుంది.",
  },
  "Continue with Google": {
    Hindi: "Google के साथ जारी रखें",
    Kannada: "Google ಮೂಲಕ ಮುಂದುವರಿಸಿ",
    Tamil: "Google மூலம் தொடரவும்",
    Malayalam: "Google ഉപയോഗിച്ച് തുടരുക",
    Arabic: "المتابعة باستخدام Google",
    Spanish: "Continuar con Google",
    Telugu: "Googleతో కొనసాగించండి",
  },
  "Maybe later": {
    Hindi: "शायद बाद में",
    Kannada: "ಬಹುಶಃ ನಂತರ",
    Tamil: "பிறகு பார்க்கலாம்",
    Malayalam: "പിന്നീട് നോക്കാം",
    Arabic: "ربما لاحقًا",
    Spanish: "Quizá más tarde",
    Telugu: "బహుశా తర్వాత",
  },
  "Preferred Language": {
    Hindi: "पसंदीदा भाषा",
    Kannada: "ಆದ್ಯತೆಯ ಭಾಷೆ",
    Tamil: "விருப்ப மொழி",
    Malayalam: "ഇഷ്ട ഭാഷ",
    Arabic: "اللغة المفضلة",
    Spanish: "Idioma preferido",
    Telugu: "ఇష్టమైన భాష",
  },
  "Choose your learning language": {
    Hindi: "अपनी सीखने की भाषा चुनें",
    Kannada: "ನಿಮ್ಮ ಕಲಿಕೆಯ ಭಾಷೆಯನ್ನು ಆರಿಸಿ",
    Tamil: "உங்கள் கற்றல் மொழியைத் தேர்ந்தெடுக்கவும்",
    Malayalam: "നിങ്ങളുടെ പഠന ഭാഷ തിരഞ്ഞെടുക്കുക",
    Arabic: "اختر لغة التعلم",
    Spanish: "Elige tu idioma de aprendizaje",
    Telugu: "మీ నేర్చుకునే భాషను ఎంచుకోండి",
  },
  "Use inspir in the language that feels easiest. You can change this later from your profile.": {
    Hindi: "जिस भाषा में आपको सबसे आसान लगे, उसमें inspir इस्तेमाल करें। आप इसे बाद में प्रोफ़ाइल से बदल सकते हैं।",
    Kannada: "ನಿಮಗೆ ಸುಲಭವಾಗಿರುವ ಭಾಷೆಯಲ್ಲಿ inspir ಬಳಸಿ. ಇದನ್ನು ನಂತರ ನಿಮ್ಮ ಪ್ರೊಫೈಲ್‌ನಿಂದ ಬದಲಿಸಬಹುದು.",
    Tamil: "உங்களுக்கு எளிதாக இருக்கும் மொழியில் inspir பயன்படுத்துங்கள். இதை பின்னர் உங்கள் சுயவிவரத்தில் மாற்றலாம்.",
    Malayalam: "നിങ്ങൾക്ക് എളുപ്പമെന്ന് തോന്നുന്ന ഭാഷയിൽ inspir ഉപയോഗിക്കുക. പിന്നീട് പ്രൊഫൈലിൽ നിന്ന് ഇത് മാറ്റാം.",
    Arabic: "استخدم inspir باللغة الأسهل لك. يمكنك تغيير ذلك لاحقًا من ملفك الشخصي.",
    Spanish: "Usa inspir en el idioma que te resulte más fácil. Puedes cambiarlo después desde tu perfil.",
    Telugu: "మీకు సులభంగా అనిపించే భాషలో inspir ఉపయోగించండి. తర్వాత మీ ప్రొఫైల్‌లో దీన్ని మార్చవచ్చు.",
  },
  "You can switch again later from Profile.": {
    Hindi: "आप बाद में प्रोफ़ाइल से फिर बदल सकते हैं।",
    Kannada: "ನಂತರ ಪ್ರೊಫೈಲ್‌ನಿಂದ ಮತ್ತೆ ಬದಲಿಸಬಹುದು.",
    Tamil: "பிறகு சுயவிவரத்தில் இருந்து மீண்டும் மாற்றலாம்.",
    Malayalam: "പിന്നീട് പ്രൊഫൈലിൽ നിന്ന് വീണ്ടും മാറ്റാം.",
    Arabic: "يمكنك التبديل لاحقًا من الملف الشخصي.",
    Spanish: "Puedes cambiarlo de nuevo después desde Perfil.",
    Telugu: "తర్వాత ప్రొఫైల్ నుంచి మళ్లీ మార్చవచ్చు.",
  },
  "Continue with English": {
    Hindi: "अंग्रेज़ी में जारी रखें",
    Kannada: "ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ಮುಂದುವರಿಸಿ",
    Tamil: "ஆங்கிலத்தில் தொடரவும்",
    Malayalam: "ഇംഗ്ലീഷിൽ തുടരുക",
    Arabic: "المتابعة بالإنجليزية",
    Spanish: "Continuar en inglés",
    Telugu: "ఇంగ్లీష్‌లో కొనసాగించండి",
  },
  "Age-appropriate learning": {
    Hindi: "उम्र के अनुसार सीखना",
    Kannada: "ವಯಸ್ಸಿಗೆ ತಕ್ಕ ಕಲಿಕೆ",
    Tamil: "வயதுக்கேற்ற கற்றல்",
    Malayalam: "പ്രായത്തിന് അനുയോജ്യമായ പഠനം",
    Arabic: "تعلم مناسب للعمر",
    Spanish: "Aprendizaje adecuado para la edad",
    Telugu: "వయస్సుకు తగిన అభ్యాసం",
  },
  "Add your date of birth and preferred language so inspir can adapt examples, tone, safety boundaries, and app text for your learning experience.": {
    Hindi: "अपनी जन्मतिथि और पसंदीदा भाषा जोड़ें ताकि inspir आपके सीखने के अनुभव के लिए उदाहरण, लहजा, सुरक्षा सीमाएं और ऐप टेक्स्ट अनुकूलित कर सके।",
    Kannada: "ನಿಮ್ಮ ಜನ್ಮ ದಿನಾಂಕ ಮತ್ತು ಆದ್ಯತೆಯ ಭಾಷೆಯನ್ನು ಸೇರಿಸಿ; inspir ನಿಮ್ಮ ಕಲಿಕೆಯ ಅನುಭವಕ್ಕೆ ಉದಾಹರಣೆಗಳು, ಧ್ವನಿ, ಸುರಕ್ಷತಾ ಮಿತಿಗಳು ಮತ್ತು ಆಪ್ ಪಠ್ಯವನ್ನು ಹೊಂದಿಸಬಹುದು.",
    Tamil: "உங்கள் பிறந்த தேதி மற்றும் விருப்ப மொழியைச் சேர்க்கவும்; inspir உங்கள் கற்றல் அனுபவத்திற்காக எடுத்துக்காட்டுகள், தொனி, பாதுகாப்பு எல்லைகள், பயன்பாட்டு உரையை மாற்றிக்கொள்ளும்.",
    Malayalam: "നിങ്ങളുടെ ജനന തീയതിയും ഇഷ്ട ഭാഷയും ചേർക്കുക; പഠനാനുഭവത്തിനായി inspir ഉദാഹരണങ്ങൾ, ശൈലി, സുരക്ഷാ പരിധികൾ, ആപ്പ് ടെക്സ്റ്റ് എന്നിവ ക്രമീകരിക്കും.",
    Arabic: "أضف تاريخ ميلادك ولغتك المفضلة حتى يكيّف inspir الأمثلة والنبرة وحدود السلامة ونص التطبيق لتجربة تعلمك.",
    Spanish: "Añade tu fecha de nacimiento e idioma preferido para que inspir adapte ejemplos, tono, límites de seguridad y texto de la app a tu aprendizaje.",
    Telugu: "మీ పుట్టిన తేదీ మరియు ఇష్టమైన భాషను జోడించండి; మీ అభ్యాస అనుభవానికి inspir ఉదాహరణలు, స్వరం, భద్రతా పరిమితులు, యాప్ వచనాన్ని సర్దుబాటు చేస్తుంది.",
  },
  "App text and tutoring replies will follow this setting.": {
    Hindi: "ऐप टेक्स्ट और ट्यूटरिंग जवाब इसी सेटिंग का पालन करेंगे।",
    Kannada: "ಆಪ್ ಪಠ್ಯ ಮತ್ತು ಟ್ಯೂಟರಿಂಗ್ ಉತ್ತರಗಳು ಈ ಸೆಟ್ಟಿಂಗ್ ಅನುಸರಿಸುತ್ತವೆ.",
    Tamil: "பயன்பாட்டு உரையும் பயிற்சி பதில்களும் இந்த அமைப்பைப் பின்பற்றும்.",
    Malayalam: "ആപ്പ് ടെക്സ്റ്റും ട്യൂട്ടറിംഗ് മറുപടികളും ഈ ക്രമീകരണം പിന്തുടരും.",
    Arabic: "سيتبع نص التطبيق وردود التعليم هذا الإعداد.",
    Spanish: "El texto de la app y las respuestas del tutor seguirán este ajuste.",
    Telugu: "యాప్ వచనం మరియు ట్యూటరింగ్ సమాధానాలు ఈ సెట్టింగ్‌ను అనుసరిస్తాయి.",
  },
  "Please enter your date of birth.": {
    Hindi: "कृपया अपनी जन्मतिथि दर्ज करें।",
    Kannada: "ದಯವಿಟ್ಟು ನಿಮ್ಮ ಜನ್ಮ ದಿನಾಂಕವನ್ನು ನಮೂದಿಸಿ.",
    Tamil: "உங்கள் பிறந்த தேதியை உள்ளிடுங்கள்.",
    Malayalam: "ദയവായി നിങ്ങളുടെ ജനന തീയതി നൽകുക.",
    Arabic: "يرجى إدخال تاريخ ميلادك.",
    Spanish: "Introduce tu fecha de nacimiento.",
    Telugu: "దయచేసి మీ పుట్టిన తేదీని నమోదు చేయండి.",
  },
  "Learning profile": {
    Hindi: "सीखने की प्रोफ़ाइल",
    Kannada: "ಕಲಿಕಾ ಪ್ರೊಫೈಲ್",
    Tamil: "கற்றல் சுயவிவரம்",
    Malayalam: "പഠന പ്രൊഫൈൽ",
    Arabic: "ملف التعلم",
    Spanish: "Perfil de aprendizaje",
    Telugu: "అభ్యాస ప్రొఫైల్",
  },
  "Make inspir feel like it knows how you learn.": {
    Hindi: "inspir को ऐसा बनाएं कि वह आपके सीखने का तरीका समझता हो।",
    Kannada: "ನೀವು ಹೇಗೆ ಕಲಿಯುತ್ತೀರಿ ಎಂಬುದನ್ನು inspir ತಿಳಿದಂತೆ ಅನುಭವವಾಗಲಿ.",
    Tamil: "நீங்கள் எப்படி கற்கிறீர்கள் என்பதை inspir அறிந்தது போல உணரச் செய்யுங்கள்.",
    Malayalam: "നിങ്ങൾ എങ്ങനെ പഠിക്കുന്നു എന്ന് inspir അറിയുന്നതുപോലെ അനുഭവപ്പെടട്ടെ.",
    Arabic: "اجعل inspir يبدو وكأنه يعرف كيف تتعلم.",
    Spanish: "Haz que inspir sienta cómo aprendes.",
    Telugu: "మీరు ఎలా నేర్చుకుంటారో inspir తెలుసుకున్నట్టు అనిపించండి.",
  },
  "Profile details": {
    Hindi: "प्रोफ़ाइल विवरण",
    Kannada: "ಪ್ರೊಫೈಲ್ ವಿವರಗಳು",
    Tamil: "சுயவிவர விவரங்கள்",
    Malayalam: "പ്രൊഫൈൽ വിവരങ്ങൾ",
    Arabic: "تفاصيل الملف الشخصي",
    Spanish: "Detalles del perfil",
    Telugu: "ప్రొఫైల్ వివరాలు",
  },
  "Your app identity": {
    Hindi: "आपकी ऐप पहचान",
    Kannada: "ನಿಮ್ಮ ಆಪ್ ಗುರುತು",
    Tamil: "உங்கள் ஆப் அடையாளம்",
    Malayalam: "നിങ്ങളുടെ ആപ്പ് തിരിച്ചറിയൽ",
    Arabic: "هويتك داخل التطبيق",
    Spanish: "Tu identidad en la app",
    Telugu: "మీ యాప్ గుర్తింపు",
  },
  "Display name": {
    Hindi: "दिखने वाला नाम",
    Kannada: "ಕಾಣಿಸಿಕೊಳ್ಳುವ ಹೆಸರು",
    Tamil: "காண்பிக்கும் பெயர்",
    Malayalam: "പ്രദർശന പേര്",
    Arabic: "اسم العرض",
    Spanish: "Nombre visible",
    Telugu: "ప్రదర్శన పేరు",
  },
  "Google email": {
    Hindi: "Google ईमेल",
    Kannada: "Google ಇಮೇಲ್",
    Tamil: "Google மின்னஞ்சல்",
    Malayalam: "Google ഇമെയിൽ",
    Arabic: "بريد Google الإلكتروني",
    Spanish: "Correo de Google",
    Telugu: "Google ఇమెయిల్",
  },
  "Enter a display name.": {
    Hindi: "दिखने वाला नाम दर्ज करें।",
    Kannada: "ಕಾಣಿಸಿಕೊಳ್ಳುವ ಹೆಸರನ್ನು ನಮೂದಿಸಿ.",
    Tamil: "காண்பிக்கும் பெயரை உள்ளிடுங்கள்.",
    Malayalam: "പ്രദർശന പേര് നൽകുക.",
    Arabic: "أدخل اسم عرض.",
    Spanish: "Introduce un nombre visible.",
    Telugu: "ప్రదర్శన పేరును నమోదు చేయండి.",
  },
  "Profile saved.": {
    Hindi: "प्रोफ़ाइल सहेजी गई।",
    Kannada: "ಪ್ರೊಫೈಲ್ ಉಳಿಸಲಾಗಿದೆ.",
    Tamil: "சுயவிவரம் சேமிக்கப்பட்டது.",
    Malayalam: "പ്രൊഫൈൽ സംരക്ഷിച്ചു.",
    Arabic: "تم حفظ الملف الشخصي.",
    Spanish: "Perfil guardado.",
    Telugu: "ప్రొఫైల్ సేవ్ అయింది.",
  },
  "Could not save profile.": {
    Hindi: "प्रोफ़ाइल सहेजी नहीं जा सकी।",
    Kannada: "ಪ್ರೊಫೈಲ್ ಉಳಿಸಲಾಗಲಿಲ್ಲ.",
    Tamil: "சுயவிவரத்தை சேமிக்க முடியவில்லை.",
    Malayalam: "പ്രൊഫൈൽ സംരക്ഷിക്കാൻ കഴിഞ്ഞില്ല.",
    Arabic: "تعذر حفظ الملف الشخصي.",
    Spanish: "No se pudo guardar el perfil.",
    Telugu: "ప్రొఫైల్ సేవ్ చేయలేకపోయాం.",
  },
  "Save profile": {
    Hindi: "प्रोफ़ाइल सहेजें",
    Kannada: "ಪ್ರೊಫೈಲ್ ಉಳಿಸಿ",
    Tamil: "சுயவிவரத்தை சேமிக்கவும்",
    Malayalam: "പ്രൊഫൈൽ സംരക്ഷിക്കുക",
    Arabic: "حفظ الملف الشخصي",
    Spanish: "Guardar perfil",
    Telugu: "ప్రొఫైల్ సేవ్ చేయండి",
  },
  "Change photo": {
    Hindi: "फ़ोटो बदलें",
    Kannada: "ಫೋಟೋ ಬದಲಿಸಿ",
    Tamil: "புகைப்படத்தை மாற்று",
    Malayalam: "ഫോട്ടോ മാറ്റുക",
    Arabic: "تغيير الصورة",
    Spanish: "Cambiar foto",
    Telugu: "ఫోటో మార్చండి",
  },
  "Use Google photo": {
    Hindi: "Google फ़ोटो इस्तेमाल करें",
    Kannada: "Google ಫೋಟೋ ಬಳಸಿ",
    Tamil: "Google புகைப்படத்தைப் பயன்படுத்து",
    Malayalam: "Google ഫോട്ടോ ഉപയോഗിക്കുക",
    Arabic: "استخدام صورة Google",
    Spanish: "Usar foto de Google",
    Telugu: "Google ఫోటో ఉపయోగించండి",
  },
  "Profile photo updated.": {
    Hindi: "प्रोफ़ाइल फ़ोटो अपडेट हो गई।",
    Kannada: "ಪ್ರೊಫೈಲ್ ಫೋಟೋ ನವೀಕರಿಸಲಾಗಿದೆ.",
    Tamil: "சுயவிவரப் புகைப்படம் புதுப்பிக்கப்பட்டது.",
    Malayalam: "പ്രൊഫൈൽ ഫോട്ടോ പുതുക്കി.",
    Arabic: "تم تحديث صورة الملف الشخصي.",
    Spanish: "Foto de perfil actualizada.",
    Telugu: "ప్రొఫైల్ ఫోటో అప్‌డేట్ అయింది.",
  },
  "Using your Google photo.": {
    Hindi: "आपकी Google फ़ोटो इस्तेमाल हो रही है।",
    Kannada: "ನಿಮ್ಮ Google ಫೋಟೋ ಬಳಸಲಾಗುತ್ತಿದೆ.",
    Tamil: "உங்கள் Google புகைப்படம் பயன்படுத்தப்படுகிறது.",
    Malayalam: "നിങ്ങളുടെ Google ഫോട്ടോ ഉപയോഗിക്കുന്നു.",
    Arabic: "يتم استخدام صورة Google الخاصة بك.",
    Spanish: "Usando tu foto de Google.",
    Telugu: "మీ Google ఫోటో ఉపయోగిస్తున్నాం.",
  },
  "Could not update profile photo.": {
    Hindi: "प्रोफ़ाइल फ़ोटो अपडेट नहीं हो सकी।",
    Kannada: "ಪ್ರೊಫೈಲ್ ಫೋಟೋ ನವೀಕರಿಸಲಾಗಲಿಲ್ಲ.",
    Tamil: "சுயவிவரப் புகைப்படத்தைப் புதுப்பிக்க முடியவில்லை.",
    Malayalam: "പ്രൊഫൈൽ ഫോട്ടോ പുതുക്കാൻ കഴിഞ്ഞില്ല.",
    Arabic: "تعذر تحديث صورة الملف الشخصي.",
    Spanish: "No se pudo actualizar la foto de perfil.",
    Telugu: "ప్రొఫైల్ ఫోటోను అప్‌డేట్ చేయలేకపోయాం.",
  },
  "Could not reset profile photo.": {
    Hindi: "प्रोफ़ाइल फ़ोटो रीसेट नहीं हो सकी।",
    Kannada: "ಪ್ರೊಫೈಲ್ ಫೋಟೋ ಮರುಹೊಂದಿಸಲಾಗಲಿಲ್ಲ.",
    Tamil: "சுயவிவரப் புகைப்படத்தை மீட்டமைக்க முடியவில்லை.",
    Malayalam: "പ്രൊഫൈൽ ഫോട്ടോ റീസെറ്റ് ചെയ്യാൻ കഴിഞ്ഞില്ല.",
    Arabic: "تعذر إعادة تعيين صورة الملف الشخصي.",
    Spanish: "No se pudo restablecer la foto de perfil.",
    Telugu: "ప్రొఫైల్ ఫోటోను రీసెట్ చేయలేకపోయాం.",
  },
  "Choose an image file.": {
    Hindi: "एक इमेज फ़ाइल चुनें।",
    Kannada: "ಒಂದು ಚಿತ್ರ ಫೈಲ್ ಆಯ್ಕೆಮಾಡಿ.",
    Tamil: "ஒரு படக் கோப்பைத் தேர்ந்தெடுக்கவும்.",
    Malayalam: "ഒരു ചിത്ര ഫയൽ തിരഞ്ഞെടുക്കുക.",
    Arabic: "اختر ملف صورة.",
    Spanish: "Elige un archivo de imagen.",
    Telugu: "ఒక చిత్రం ఫైల్‌ను ఎంచుకోండి.",
  },
  "Choose an image under 1 MB.": {
    Hindi: "1 MB से छोटी इमेज चुनें।",
    Kannada: "1 MB ಕ್ಕಿಂತ ಕಡಿಮೆ ಗಾತ್ರದ ಚಿತ್ರವನ್ನು ಆಯ್ಕೆಮಾಡಿ.",
    Tamil: "1 MB-க்கு குறைவான படத்தைத் தேர்ந்தெடுக்கவும்.",
    Malayalam: "1 MB-ൽ താഴെയുള്ള ചിത്രം തിരഞ്ഞെടുക്കുക.",
    Arabic: "اختر صورة أقل من 1 ميغابايت.",
    Spanish: "Elige una imagen de menos de 1 MB.",
    Telugu: "1 MB కంటే తక్కువ పరిమాణం ఉన్న చిత్రాన్ని ఎంచుకోండి.",
  },
  "Use a JPG, PNG, or WebP image.": {
    Hindi: "JPG, PNG या WebP इमेज इस्तेमाल करें।",
    Kannada: "JPG, PNG ಅಥವಾ WebP ಚಿತ್ರ ಬಳಸಿ.",
    Tamil: "JPG, PNG அல்லது WebP படத்தைப் பயன்படுத்தவும்.",
    Malayalam: "JPG, PNG, അല്ലെങ്കിൽ WebP ചിത്രം ഉപയോഗിക്കുക.",
    Arabic: "استخدم صورة JPG أو PNG أو WebP.",
    Spanish: "Usa una imagen JPG, PNG o WebP.",
    Telugu: "JPG, PNG లేదా WebP చిత్రాన్ని ఉపయోగించండి.",
  },
  "Overview": {
    Hindi: "अवलोकन",
    Kannada: "ಅವಲೋಕನ",
    Tamil: "கண்ணோட்டம்",
    Malayalam: "അവലോകനം",
    Arabic: "نظرة عامة",
    Spanish: "Resumen",
    Telugu: "అవలోకనం",
  },
  "Your learning snapshot": {
    Hindi: "आपकी सीखने की झलक",
    Kannada: "ನಿಮ್ಮ ಕಲಿಕೆಯ ಚಿತ್ರಣ",
    Tamil: "உங்கள் கற்றல் சுருக்கம்",
    Malayalam: "നിങ്ങളുടെ പഠന ചിത്രം",
    Arabic: "لمحة عن تعلمك",
    Spanish: "Tu panorama de aprendizaje",
    Telugu: "మీ అభ్యాస సంక్షిప్త చిత్రం",
  },
  "Learning score": {
    Hindi: "सीखने का स्कोर",
    Kannada: "ಕಲಿಕಾ ಅಂಕ",
    Tamil: "கற்றல் மதிப்பெண்",
    Malayalam: "പഠന സ്കോർ",
    Arabic: "درجة التعلم",
    Spanish: "Puntuación de aprendizaje",
    Telugu: "అభ్యాస స్కోర్",
  },
  "inspir'ed since": {
    Hindi: "inspir से जुड़े",
    Kannada: "inspir ಬಳಕೆ ಆರಂಭಿಸಿದ ದಿನ",
    Tamil: "inspir பயன்படுத்தத் தொடங்கியது",
    Malayalam: "inspir ഉപയോഗം ആരംഭിച്ചത്",
    Arabic: "مع inspir منذ",
    Spanish: "en inspir desde",
    Telugu: "inspirలో చేరిన తేదీ",
  },
  "What inspir can remember": {
    Hindi: "inspir क्या याद रख सकता है",
    Kannada: "inspir ಏನು ನೆನಪಿಟ್ಟುಕೊಳ್ಳಬಹುದು",
    Tamil: "inspir என்ன நினைவில் கொள்ளலாம்",
    Malayalam: "inspir എന്ത് ഓർക്കാം",
    Arabic: "ما يمكن أن يتذكره inspir",
    Spanish: "Lo que inspir puede recordar",
    Telugu: "inspir ఏమి గుర్తుంచుకోగలదు",
  },
  "Account and privacy": {
    Hindi: "खाता और गोपनीयता",
    Kannada: "ಖಾತೆ ಮತ್ತು ಗೌಪ್ಯತೆ",
    Tamil: "கணக்கு மற்றும் தனியுரிமை",
    Malayalam: "അക്കൗണ്ടും സ്വകാര്യതയും",
    Arabic: "الحساب والخصوصية",
    Spanish: "Cuenta y privacidad",
    Telugu: "ఖాతా మరియు గోప్యత",
  },
  "Control what stays with you": {
    Hindi: "आपके साथ क्या रहता है, उसे नियंत्रित करें",
    Kannada: "ನಿಮ್ಮೊಂದಿಗೆ ಉಳಿಯುವುದನ್ನು ನಿಯಂತ್ರಿಸಿ",
    Tamil: "உங்களுடன் என்ன இருக்கும் என்பதை கட்டுப்படுத்துங்கள்",
    Malayalam: "നിങ്ങളോടൊപ്പം എന്ത് നിലനിൽക്കണമെന്ന് നിയന്ത്രിക്കുക",
    Arabic: "تحكم في ما يبقى معك",
    Spanish: "Controla lo que queda contigo",
    Telugu: "మీతో ఏమి ఉండాలో నియంత్రించండి",
  },
  "Your saved chats, language preference, date of birth, and learning memory are used to make the app more useful for you.": {
    Hindi: "आपकी सहेजी गई चैट, भाषा पसंद, जन्मतिथि और सीखने की मेमोरी ऐप को आपके लिए अधिक उपयोगी बनाने में इस्तेमाल होती हैं।",
    Kannada: "ನಿಮ್ಮ ಉಳಿಸಿದ ಚಾಟ್‌ಗಳು, ಭಾಷಾ ಆದ್ಯತೆ, ಜನ್ಮ ದಿನಾಂಕ ಮತ್ತು ಕಲಿಕಾ ಸ್ಮರಣೆಗಳು ಆಪ್ ನಿಮಗೆ ಹೆಚ್ಚು ಉಪಯುಕ್ತವಾಗಲು ಬಳಸಲಾಗುತ್ತವೆ.",
    Tamil: "உங்கள் சேமித்த அரட்டைகள், மொழி விருப்பம், பிறந்த தேதி, கற்றல் நினைவுகள் ஆகியவை பயன்பாட்டை உங்களுக்கு மேலும் பயனுள்ளதாக மாற்றப் பயன்படுகின்றன.",
    Malayalam: "നിങ്ങളുടെ സൂക്ഷിച്ച ചാറ്റുകൾ, ഭാഷാ മുൻഗണന, ജനന തീയതി, പഠന ഓർമ്മകൾ എന്നിവ ആപ്പ് നിങ്ങൾക്ക് കൂടുതൽ ഉപകാരപ്രദമാക്കാൻ ഉപയോഗിക്കുന്നു.",
    Arabic: "تُستخدم محادثاتك المحفوظة وتفضيل اللغة وتاريخ الميلاد وذاكرة التعلم لجعل التطبيق أكثر فائدة لك.",
    Spanish: "Tus chats guardados, preferencia de idioma, fecha de nacimiento y memoria de aprendizaje se usan para que la app sea más útil para ti.",
    Telugu: "మీ సేవ్ చేసిన చాట్‌లు, భాషా ప్రాధాన్యం, పుట్టిన తేదీ, అభ్యాస మెమరీ యాప్‌ను మీకు మరింత ఉపయోగకరంగా చేయడానికి ఉపయోగిస్తాం.",
  },
  "Terms": {
    Hindi: "शर्तें",
    Kannada: "ನಿಯಮಗಳು",
    Tamil: "விதிமுறைகள்",
    Malayalam: "നിബന്ധനകൾ",
    Arabic: "الشروط",
    Spanish: "Términos",
    Telugu: "నిబంధనలు",
  },
  "Privacy": {
    Hindi: "गोपनीयता",
    Kannada: "ಗೌಪ್ಯತೆ",
    Tamil: "தனியுரிமை",
    Malayalam: "സ്വകാര്യത",
    Arabic: "الخصوصية",
    Spanish: "Privacidad",
    Telugu: "గోప్యత",
  },
  "Logout": {
    Hindi: "लॉग आउट",
    Kannada: "ಲಾಗ್ ಔಟ್",
    Tamil: "வெளியேறு",
    Malayalam: "ലോഗ് ഔട്ട്",
    Arabic: "تسجيل الخروج",
    Spanish: "Cerrar sesión",
    Telugu: "లాగ్ అవుట్",
  },
  "Memory": {
    Hindi: "मेमोरी",
    Kannada: "ಸ್ಮರಣೆ",
    Tamil: "நினைவகம்",
    Malayalam: "ഓർമ്മ",
    Arabic: "الذاكرة",
    Spanish: "Memoria",
    Telugu: "మెమరీ",
  },
  "On for this account": {
    Hindi: "इस खाते के लिए चालू",
    Kannada: "ಈ ಖಾತೆಗೆ ಆನ್ ಆಗಿದೆ",
    Tamil: "இந்த கணக்கில் இயக்கத்தில் உள்ளது",
    Malayalam: "ഈ അക്കൗണ്ടിൽ ഓണാണ്",
    Arabic: "مفعّل لهذا الحساب",
    Spanish: "Activada para esta cuenta",
    Telugu: "ఈ ఖాతాకు ఆన్‌లో ఉంది",
  },
  "Off for this account": {
    Hindi: "इस खाते के लिए बंद",
    Kannada: "ಈ ಖಾತೆಗೆ ಆಫ್ ಆಗಿದೆ",
    Tamil: "இந்த கணக்கில் அணைக்கப்பட்டுள்ளது",
    Malayalam: "ഈ അക്കൗണ്ടിൽ ഓഫാണ്",
    Arabic: "متوقف لهذا الحساب",
    Spanish: "Desactivada para esta cuenta",
    Telugu: "ఈ ఖాతాకు ఆఫ్‌లో ఉంది",
  },
  "Memory is on": {
    Hindi: "मेमोरी चालू है",
    Kannada: "ಸ್ಮರಣೆ ಆನ್ ಆಗಿದೆ",
    Tamil: "நினைவகம் இயக்கத்தில் உள்ளது",
    Malayalam: "ഓർമ്മ ഓണാണ്",
    Arabic: "الذاكرة مفعّلة",
    Spanish: "La memoria está activada",
    Telugu: "మెమరీ ఆన్‌లో ఉంది",
  },
  "Memory is off": {
    Hindi: "मेमोरी बंद है",
    Kannada: "ಸ್ಮರಣೆ ಆಫ್ ಆಗಿದೆ",
    Tamil: "நினைவகம் அணைக்கப்பட்டுள்ளது",
    Malayalam: "ഓർമ്മ ഓഫാണ്",
    Arabic: "الذاكرة متوقفة",
    Spanish: "La memoria está desactivada",
    Telugu: "మెమరీ ఆఫ్‌లో ఉంది",
  },
  "Used only when it helps.": {
    Hindi: "केवल तब इस्तेमाल होती है जब मदद मिले।",
    Kannada: "ಸಹಾಯವಾದಾಗ ಮಾತ್ರ ಬಳಸಲಾಗುತ್ತದೆ.",
    Tamil: "உதவியாக இருக்கும் போது மட்டுமே பயன்படுத்தப்படும்.",
    Malayalam: "സഹായകരമായാൽ മാത്രം ഉപയോഗിക്കും.",
    Arabic: "تُستخدم فقط عندما تفيد.",
    Spanish: "Se usa solo cuando ayuda.",
    Telugu: "సహాయపడినప్పుడు మాత్రమే ఉపయోగిస్తాం.",
  },
  "Nothing is saved or used.": {
    Hindi: "कुछ भी सहेजा या इस्तेमाल नहीं किया जाता।",
    Kannada: "ಯಾವುದನ್ನೂ ಉಳಿಸಲಾಗುವುದಿಲ್ಲ ಅಥವಾ ಬಳಸಲಾಗುವುದಿಲ್ಲ.",
    Tamil: "எதுவும் சேமிக்கப்படவோ பயன்படுத்தப்படவோ மாட்டாது.",
    Malayalam: "ഒന്നും സംരക്ഷിക്കുകയോ ഉപയോഗിക്കുകയോ ചെയ്യില്ല.",
    Arabic: "لا يتم حفظ أو استخدام أي شيء.",
    Spanish: "No se guarda ni se usa nada.",
    Telugu: "ఏదీ సేవ్ చేయబడదు లేదా ఉపయోగించబడదు.",
  },
  "On": {
    Hindi: "चालू",
    Kannada: "ಆನ್",
    Tamil: "ஆன்",
    Malayalam: "ഓൺ",
    Arabic: "تشغيل",
    Spanish: "Activado",
    Telugu: "ఆన్",
  },
  "Off": {
    Hindi: "बंद",
    Kannada: "ಆಫ್",
    Tamil: "ஆஃப்",
    Malayalam: "ഓഫ്",
    Arabic: "إيقاف",
    Spanish: "Desactivado",
    Telugu: "ఆఫ్",
  },
  "Saved memory": {
    Hindi: "सहेजी गई मेमोरी",
    Kannada: "ಉಳಿಸಿದ ಸ್ಮರಣೆ",
    Tamil: "சேமித்த நினைவகம்",
    Malayalam: "സംരക്ഷിച്ച ഓർമ്മ",
    Arabic: "ذاكرة محفوظة",
    Spanish: "Memoria guardada",
    Telugu: "సేవ్ చేసిన మెమరీ",
  },
  "Past chats": {
    Hindi: "पिछली चैट",
    Kannada: "ಹಿಂದಿನ ಚಾಟ್‌ಗಳು",
    Tamil: "முந்தைய அரட்டைகள்",
    Malayalam: "മുൻ ചാറ്റുകൾ",
    Arabic: "المحادثات السابقة",
    Spanish: "Chats anteriores",
    Telugu: "గత చాట్‌లు",
  },
  "Synthesis": {
    Hindi: "सार-संयोजन",
    Kannada: "ಸಂಶ್ಲೇಷಣೆ",
    Tamil: "தொகுப்பு",
    Malayalam: "സംയോജനം",
    Arabic: "التلخيص المركب",
    Spanish: "Síntesis",
    Telugu: "సంకలనం",
  },
  "Loading memory...": {
    Hindi: "मेमोरी लोड हो रही है...",
    Kannada: "ಸ್ಮರಣೆ ಲೋಡ್ ಆಗುತ್ತಿದೆ...",
    Tamil: "நினைவகம் ஏற்றப்படுகிறது...",
    Malayalam: "ഓർമ്മ ലോഡ് ചെയ്യുന്നു...",
    Arabic: "جار تحميل الذاكرة...",
    Spanish: "Cargando memoria...",
    Telugu: "మెమరీ లోడ్ అవుతోంది...",
  },
  "Memory is on for signed-in accounts.": {
    Hindi: "साइन-इन खातों के लिए मेमोरी चालू है।",
    Kannada: "ಸೈನ್ ಇನ್ ಮಾಡಿದ ಖಾತೆಗಳಿಗೆ ಸ್ಮರಣೆ ಆನ್ ಆಗಿದೆ.",
    Tamil: "உள்நுழைந்த கணக்குகளில் நினைவகம் இயக்கத்தில் உள்ளது.",
    Malayalam: "സൈൻ ഇൻ ചെയ്ത അക്കൗണ്ടുകളിൽ ഓർമ്മ ഓണാണ്.",
    Arabic: "الذاكرة مفعّلة للحسابات المسجلة.",
    Spanish: "La memoria está activada para cuentas con sesión iniciada.",
    Telugu: "సైన్ ఇన్ చేసిన ఖాతాలకు మెమరీ ఆన్‌లో ఉంది.",
  },
  "Everything Inspir remembers is shown below as editable memory cards. You can add, edit, delete, or clear them anytime.": {
    Hindi: "inspir जो कुछ याद रखता है, वह नीचे संपादन योग्य मेमोरी कार्ड के रूप में दिखता है। आप कभी भी जोड़, संपादित, मिटा या साफ कर सकते हैं।",
    Kannada: "inspir ನೆನಪಿಡುವ ಎಲ್ಲವೂ ಕೆಳಗೆ ಸಂಪಾದಿಸಬಹುದಾದ ಸ್ಮರಣೆ ಕಾರ್ಡ್‌ಗಳಾಗಿ ಕಾಣಿಸುತ್ತದೆ. ನೀವು ಯಾವಾಗ ಬೇಕಾದರೂ ಸೇರಿಸಬಹುದು, ಸಂಪಾದಿಸಬಹುದು, ಅಳಿಸಬಹುದು ಅಥವಾ ತೆರವುಗೊಳಿಸಬಹುದು.",
    Tamil: "inspir நினைவில் வைத்திருப்பவை அனைத்தும் கீழே திருத்தக்கூடிய நினைவு அட்டைகளாக காட்டப்படும். எப்போது வேண்டுமானாலும் சேர்க்க, திருத்த, நீக்க, அல்லது அழிக்கலாம்.",
    Malayalam: "inspir ഓർക്കുന്ന എല്ലാം താഴെ തിരുത്താവുന്ന ഓർമ്മ കാർഡുകളായി കാണിക്കും. നിങ്ങൾക്ക് ഏപ്പോൾ വേണമെങ്കിലും ചേർക്കാനും തിരുത്താനും ഇല്ലാതാക്കാനും വൃത്തിയാക്കാനും കഴിയും.",
    Arabic: "يظهر كل ما يتذكره inspir أدناه كبطاقات ذاكرة قابلة للتحرير. يمكنك الإضافة أو التعديل أو الحذف أو المسح في أي وقت.",
    Spanish: "Todo lo que inspir recuerda aparece abajo como tarjetas de memoria editables. Puedes añadir, editar, borrar o limpiar todo cuando quieras.",
    Telugu: "inspir గుర్తుంచుకున్న ప్రతిదీ కింద ఎడిట్ చేయగల మెమరీ కార్డులుగా కనిపిస్తుంది. మీరు ఎప్పుడైనా జోడించవచ్చు, సవరించవచ్చు, తొలగించవచ్చు లేదా క్లియర్ చేయవచ్చు.",
  },
  "Got it": {
    Hindi: "समझ गया",
    Kannada: "ಅರ್ಥವಾಯಿತು",
    Tamil: "புரிந்தது",
    Malayalam: "മനസ്സിലായി",
    Arabic: "فهمت",
    Spanish: "Entendido",
    Telugu: "అర్థమైంది",
  },
  "Memory summary": {
    Hindi: "मेमोरी सारांश",
    Kannada: "ಸ್ಮರಣೆ ಸಾರಾಂಶ",
    Tamil: "நினைவக சுருக்கம்",
    Malayalam: "ഓർമ്മ സംഗ്രഹം",
    Arabic: "ملخص الذاكرة",
    Spanish: "Resumen de memoria",
    Telugu: "మెమరీ సారాంశం",
  },
  "No summary yet": {
    Hindi: "अभी कोई सारांश नहीं",
    Kannada: "ಇನ್ನೂ ಸಾರಾಂಶ ಇಲ್ಲ",
    Tamil: "இன்னும் சுருக்கம் இல்லை",
    Malayalam: "ഇനിയും സംഗ്രഹമില്ല",
    Arabic: "لا يوجد ملخص بعد",
    Spanish: "Aún no hay resumen",
    Telugu: "ఇంకా సారాంశం లేదు",
  },
  "Correct or add what Inspir should remember.": {
    Hindi: "inspir को क्या याद रखना चाहिए, उसे सुधारें या जोड़ें।",
    Kannada: "inspir ಏನು ನೆನಪಿಡಬೇಕು ಎಂಬುದನ್ನು ಸರಿಪಡಿಸಿ ಅಥವಾ ಸೇರಿಸಿ.",
    Tamil: "inspir நினைவில் கொள்ள வேண்டியதை திருத்தவும் அல்லது சேர்க்கவும்.",
    Malayalam: "inspir ഓർക്കേണ്ടത് തിരുത്തുകയോ ചേർക്കുകയോ ചെയ്യുക.",
    Arabic: "صحح أو أضف ما يجب أن يتذكره inspir.",
    Spanish: "Corrige o añade lo que inspir debería recordar.",
    Telugu: "inspir ఏమి గుర్తుంచుకోవాలో సరిచేయండి లేదా జోడించండి.",
  },
  "No saved memories yet.": {
    Hindi: "अभी कोई सहेजी गई मेमोरी नहीं है।",
    Kannada: "ಇನ್ನೂ ಉಳಿಸಿದ ಸ್ಮರಣೆಗಳಿಲ್ಲ.",
    Tamil: "இன்னும் சேமித்த நினைவுகள் இல்லை.",
    Malayalam: "ഇനിയും സംരക്ഷിച്ച ഓർമ്മകളില്ല.",
    Arabic: "لا توجد ذكريات محفوظة بعد.",
    Spanish: "Aún no hay memorias guardadas.",
    Telugu: "ఇంకా సేవ్ చేసిన మెమరీలు లేవు.",
  },
  "saved memory": {
    Hindi: "सहेजी गई मेमोरी",
    Kannada: "ಉಳಿಸಿದ ಸ್ಮರಣೆ",
    Tamil: "சேமித்த நினைவு",
    Malayalam: "സംരക്ഷിച്ച ഓർമ്മ",
    Arabic: "ذاكرة محفوظة",
    Spanish: "memoria guardada",
    Telugu: "సేవ్ చేసిన మెమరీ",
  },
  "saved memories": {
    Hindi: "सहेजी गई मेमोरी",
    Kannada: "ಉಳಿಸಿದ ಸ್ಮರಣೆಗಳು",
    Tamil: "சேமித்த நினைவுகள்",
    Malayalam: "സംരക്ഷിച്ച ഓർമ്മകൾ",
    Arabic: "ذكريات محفوظة",
    Spanish: "memorias guardadas",
    Telugu: "సేవ్ చేసిన మెమరీలు",
  },
  "Add": {
    Hindi: "जोड़ें",
    Kannada: "ಸೇರಿಸಿ",
    Tamil: "சேர்",
    Malayalam: "ചേർക്കുക",
    Arabic: "إضافة",
    Spanish: "Añadir",
    Telugu: "జోడించండి",
  },
  "Clear all": {
    Hindi: "सब साफ़ करें",
    Kannada: "ಎಲ್ಲವನ್ನೂ ತೆರವುಗೊಳಿಸಿ",
    Tamil: "அனைத்தையும் அழிக்கவும்",
    Malayalam: "എല്ലാം വൃത്തിയാക്കുക",
    Arabic: "مسح الكل",
    Spanish: "Borrar todo",
    Telugu: "అన్నీ క్లియర్ చేయండి",
  },
  "Save": {
    Hindi: "सहेजें",
    Kannada: "ಉಳಿಸಿ",
    Tamil: "சேமி",
    Malayalam: "സംരക്ഷിക്കുക",
    Arabic: "حفظ",
    Spanish: "Guardar",
    Telugu: "సేవ్ చేయండి",
  },
  "Cancel": {
    Hindi: "रद्द करें",
    Kannada: "ರದ್ದುಮಾಡಿ",
    Tamil: "ரத்து செய்",
    Malayalam: "റദ്ദാക്കുക",
    Arabic: "إلغاء",
    Spanish: "Cancelar",
    Telugu: "రద్దు చేయండి",
  },
  "Preferences": {
    Hindi: "पसंद",
    Kannada: "ಆದ್ಯತೆಗಳು",
    Tamil: "விருப்பங்கள்",
    Malayalam: "മുൻഗണനകൾ",
    Arabic: "التفضيلات",
    Spanish: "Preferencias",
    Telugu: "ప్రాధాన్యాలు",
  },
  "Learning style": {
    Hindi: "सीखने की शैली",
    Kannada: "ಕಲಿಕೆಯ ಶೈಲಿ",
    Tamil: "கற்றல் பாணி",
    Malayalam: "പഠന ശൈലി",
    Arabic: "أسلوب التعلم",
    Spanish: "Estilo de aprendizaje",
    Telugu: "నేర్చుకునే శైలి",
  },
  "Projects": {
    Hindi: "प्रोजेक्ट",
    Kannada: "ಯೋಜನೆಗಳು",
    Tamil: "திட்டங்கள்",
    Malayalam: "പ്രോജക്ടുകൾ",
    Arabic: "المشاريع",
    Spanish: "Proyectos",
    Telugu: "ప్రాజెక్టులు",
  },
  "Goals": {
    Hindi: "लक्ष्य",
    Kannada: "ಗುರಿಗಳು",
    Tamil: "இலக்குகள்",
    Malayalam: "ലക്ഷ്യങ്ങൾ",
    Arabic: "الأهداف",
    Spanish: "Objetivos",
    Telugu: "లక్ష్యాలు",
  },
  "Knowledge": {
    Hindi: "ज्ञान",
    Kannada: "ಜ್ಞಾನ",
    Tamil: "அறிவு",
    Malayalam: "അറിവ്",
    Arabic: "المعرفة",
    Spanish: "Conocimiento",
    Telugu: "జ్ఞానం",
  },
  "Constraints": {
    Hindi: "सीमाएं",
    Kannada: "ಮಿತಿಗಳು",
    Tamil: "கட்டுப்பாடுகள்",
    Malayalam: "പരിമിതികൾ",
    Arabic: "القيود",
    Spanish: "Límites",
    Telugu: "పరిమితులు",
  },
  "Interaction": {
    Hindi: "बातचीत",
    Kannada: "ಸಂವಹನ",
    Tamil: "இணைவு",
    Malayalam: "ഇടപെടൽ",
    Arabic: "التفاعل",
    Spanish: "Interacción",
    Telugu: "పరస్పర చర్య",
  },
  "Identity": {
    Hindi: "पहचान",
    Kannada: "ಗುರುತು",
    Tamil: "அடையாளம்",
    Malayalam: "തിരിച്ചറിയൽ",
    Arabic: "الهوية",
    Spanish: "Identidad",
    Telugu: "గుర్తింపు",
  },
  "General": {
    Hindi: "सामान्य",
    Kannada: "ಸಾಮಾನ್ಯ",
    Tamil: "பொது",
    Malayalam: "പൊതുവായത്",
    Arabic: "عام",
    Spanish: "General",
    Telugu: "సాధారణం",
  },
  "Close profile": {
    Hindi: "प्रोफ़ाइल बंद करें",
    Kannada: "ಪ್ರೊಫೈಲ್ ಮುಚ್ಚಿ",
    Tamil: "சுயவிவரத்தை மூடு",
    Malayalam: "പ്രൊഫൈൽ അടയ്ക്കുക",
    Arabic: "إغلاق الملف الشخصي",
    Spanish: "Cerrar perfil",
    Telugu: "ప్రొఫైల్ మూసివేయండి",
  },
  "Close topics": {
    Hindi: "विषय बंद करें",
    Kannada: "ವಿಷಯಗಳನ್ನು ಮುಚ್ಚಿ",
    Tamil: "தலைப்புகளை மூடு",
    Malayalam: "വിഷയങ്ങൾ അടയ്ക്കുക",
    Arabic: "إغلاق المواضيع",
    Spanish: "Cerrar temas",
    Telugu: "విషయాలను మూసివేయండి",
  },
  "Copy message": {
    Hindi: "संदेश कॉपी करें",
    Kannada: "ಸಂದೇಶ ನಕಲಿಸಿ",
    Tamil: "செய்தியை நகலெடு",
    Malayalam: "സന്ദേശം പകർത്തുക",
    Arabic: "نسخ الرسالة",
    Spanish: "Copiar mensaje",
    Telugu: "సందేశాన్ని కాపీ చేయండి",
  },
  "Send message": {
    Hindi: "संदेश भेजें",
    Kannada: "ಸಂದೇಶ ಕಳುಹಿಸಿ",
    Tamil: "செய்தி அனுப்பு",
    Malayalam: "സന്ദേശം അയയ്ക്കുക",
    Arabic: "إرسال رسالة",
    Spanish: "Enviar mensaje",
    Telugu: "సందేశం పంపండి",
  },
  "No search results": {
    Hindi: "कोई खोज परिणाम नहीं",
    Kannada: "ಹುಡುಕಾಟ ಫಲಿತಾಂಶಗಳಿಲ್ಲ",
    Tamil: "தேடல் முடிவுகள் இல்லை",
    Malayalam: "തിരച്ചിൽ ഫലങ്ങളില്ല",
    Arabic: "لا توجد نتائج بحث",
    Spanish: "No hay resultados",
    Telugu: "శోధన ఫలితాలు లేవు",
  },
  "I could not answer right now. Please try again.": {
    Hindi: "मैं अभी जवाब नहीं दे सका। कृपया फिर कोशिश करें।",
    Kannada: "ಈಗ ಉತ್ತರಿಸಲಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
    Tamil: "இப்போது பதிலளிக்க முடியவில்லை. மீண்டும் முயற்சிக்கவும்.",
    Malayalam: "ഇപ്പോൾ മറുപടി നൽകാൻ കഴിഞ്ഞില്ല. വീണ്ടും ശ്രമിക്കുക.",
    Arabic: "لم أتمكن من الإجابة الآن. يرجى المحاولة مرة أخرى.",
    Spanish: "No pude responder ahora. Inténtalo de nuevo.",
    Telugu: "ఇప్పుడే సమాధానం ఇవ్వలేకపోయాను. దయచేసి మళ్లీ ప్రయత్నించండి.",
  },
  "Could not save date of birth": {
    Hindi: "जन्मतिथि सहेजी नहीं जा सकी",
    Kannada: "ಜನ್ಮ ದಿನಾಂಕವನ್ನು ಉಳಿಸಲಾಗಲಿಲ್ಲ",
    Tamil: "பிறந்த தேதியை சேமிக்க முடியவில்லை",
    Malayalam: "ജനന തീയതി സംരക്ഷിക്കാൻ കഴിഞ്ഞില്ല",
    Arabic: "تعذر حفظ تاريخ الميلاد",
    Spanish: "No se pudo guardar la fecha de nacimiento",
    Telugu: "పుట్టిన తేదీని సేవ్ చేయలేకపోయాం",
  },
  "Could not update language": {
    Hindi: "भाषा अपडेट नहीं हो सकी",
    Kannada: "ಭಾಷೆಯನ್ನು ನವೀಕರಿಸಲಾಗಲಿಲ್ಲ",
    Tamil: "மொழியைப் புதுப்பிக்க முடியவில்லை",
    Malayalam: "ഭാഷ പുതുക്കാൻ കഴിഞ്ഞില്ല",
    Arabic: "تعذر تحديث اللغة",
    Spanish: "No se pudo actualizar el idioma",
    Telugu: "భాషను అప్‌డేట్ చేయలేకపోయాం",
  },
  "Sign in to keep learning": {
    Hindi: "सीखना जारी रखने के लिए साइन इन करें",
    Kannada: "ಕಲಿಕೆಯನ್ನು ಮುಂದುವರಿಸಲು ಸೈನ್ ಇನ್ ಮಾಡಿ",
    Tamil: "கற்றலைத் தொடர உள்நுழையுங்கள்",
    Malayalam: "പഠനം തുടരാൻ സൈൻ ഇൻ ചെയ്യുക",
    Arabic: "سجّل الدخول لمواصلة التعلم",
    Spanish: "Inicia sesión para seguir aprendiendo",
    Telugu: "నేర్చుకోవడం కొనసాగించడానికి సైన్ ఇన్ చేయండి",
  },
};

const sourceStrings = getMainAppSourceStrings();
const sourceHash = getMainAppSourceHash(sourceStrings);
const sourceToKeys = new Map<string, string[]>();
for (const [key, source] of Object.entries(sourceStrings)) {
  sourceToKeys.set(source, [...(sourceToKeys.get(source) ?? []), key]);
}

const mergedTranslations = mergeSeedTranslations(translations, ...loadExternalSeedFiles());
const languages = seedLanguagesFromTranslations(mergedTranslations);

for (const language of languages) {
  const entries = Object.entries(mergedTranslations).flatMap(([source, values]) => {
    const keys = sourceToKeys.get(source) ?? [];
    const value = values[language];
    if (!value?.trim()) return [];
    if (!keys.length) throw new Error(`Missing main-app source string: ${source}`);
    if (!isValidFieldTranslation(source, value, language)) {
      throw new Error(`Invalid ${language} translation for ${source}: ${value}`);
    }
    return keys.map((key) => ({ key, source, value }));
  });

  const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
  const filePath = join(resolve(process.cwd(), "translations/curated"), locale, "main-app.json");
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        language: language satisfies SupportedLanguage,
        locale: languageConfigs[language].locale,
        namespace: mainAppTranslationNamespace,
        sourceHash,
        model: "codex-curated-core-v1",
        entries,
      },
      null,
      2,
    )}\n`,
  );
  console.log(JSON.stringify({ event: "core_main_app_translation_seeded", language, filePath, entries: entries.length }));
}

function loadExternalSeedFiles() {
  const root = resolve(process.cwd(), externalSeedDir);
  if (!existsSync(root)) return [];

  return readdirSync(root)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      const filePath = join(root, file);
      return parseSeedFile(JSON.parse(readFileSync(filePath, "utf8")) as unknown, filePath);
    });
}

function parseSeedFile(value: unknown, filePath: string) {
  const record = isRecord(value) ? value : undefined;
  const seed = isRecord(record?.translations) ? record.translations : record;
  if (!isRecord(seed)) throw new Error(`Invalid translation seed file: ${filePath}`);

  const parsed: Record<string, Record<string, string>> = {};
  for (const [source, values] of Object.entries(seed)) {
    if (!isRecord(values)) throw new Error(`Invalid translation seed source in ${filePath}: ${source}`);
    parsed[source] = {};
    for (const [language, translation] of Object.entries(values)) {
      if (typeof translation !== "string") {
        throw new Error(`Invalid ${language} translation in ${filePath}: ${source}`);
      }
      parsed[source][language] = translation;
    }
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function mergeSeedTranslations(...seedSets: Array<Record<string, Record<string, string>>>) {
  const merged: Record<string, Record<string, string>> = {};
  for (const seedSet of seedSets) {
    for (const [source, values] of Object.entries(seedSet)) {
      const target = (merged[source] ??= {});
      for (const [rawLanguage, value] of Object.entries(values)) {
        const language = normalizeLanguage(rawLanguage);
        if (!supportedLanguages.includes(language)) throw new Error(`Unsupported seed language: ${rawLanguage}`);
        if (language === "English") continue;
        if (target[language] && target[language] !== value) {
          throw new Error(`Conflicting ${language} translation for source: ${source}`);
        }
        target[language] = value;
      }
    }
  }
  return merged;
}

function seedLanguagesFromTranslations(seed: Record<string, Record<string, string>>) {
  const languageSet = new Set<SupportedLanguage>();
  for (const values of Object.values(seed)) {
    for (const rawLanguage of Object.keys(values)) {
      const language = normalizeLanguage(rawLanguage);
      if (supportedLanguages.includes(language) && language !== "English") languageSet.add(language);
    }
  }

  for (const language of builtInLanguages) languageSet.add(language);
  return supportedLanguages.filter((language) => languageSet.has(language));
}
