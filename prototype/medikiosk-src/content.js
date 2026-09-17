/* Clinical content for the MediKiosk prototype.
   Mirrors the production contracts: the interview sequence, red-flag rules and
   capture schema follow kiosk/config/*.json; the paper extraction follows the
   Module B output shape; the read-back, alerts and SOAP follow the Module C
   renderer. The patient, papers and findings are a fixed Indian walk-in case so
   the flow is repeatable. */

const MK_PATIENT = {
  name: "Ramesh Kumar",
  age: 54,
  sex: "Male",
  abha: "12-3456-7890-1234",
  phone: "•••••• 4417",
  visit: "First visit for this problem",
  arrived: "OPD registration counter 3",
};

const MK_CONSENT_REF = "CM-2026-09-17-8F2A41";
const MK_CONSENT_ABDM = "ABDM consent reference linked to ABHA 12-3456-7890-1234";

/* Consent notice, translated. Short sentences in plain language, because the
   notice must be understood, not skimmed. Missing languages fall back to the
   English notice; the voice still speaks in the language chosen. */
const MK_CONSENT_I18N = {
  en: {
    takeTitle: "We collect",
    take: ["Your health answers", "Photos of the papers you show", "Your voice is read, then deleted"],
    neverTitle: "We never collect",
    never: ["Your Aadhaar or ID number", "Any audio recording", "Anything shared without your consent"],
    purpose: "Before you meet the doctor, this kiosk asks about your health so the doctor already knows your story.",
    retention: "Kept only for this visit. Removed after the visit unless you agree.",
    rights: "You may skip any question, see what we wrote, correct it, or ask us to erase it.",
    ref: "Consent reference",
    linked: "Records already linked to ABHA",
  },
  hi: {
    takeTitle: "हम क्या लेते हैं",
    take: ["आपकी सेहत के जवाब", "आपके दिखाए काग़ज़ों की तस्वीरें", "आपकी आवाज़ पढ़ी जाती है, फिर मिटा दी जाती है"],
    neverTitle: "हम क्या कभी नहीं लेते",
    never: ["आपका आधार या पहचान नंबर", "कोई ऑडियो रिकॉर्डिंग", "आपकी सहमति के बिना कुछ भी साझा नहीं"],
    purpose: "डॉक्टर से मिलने से पहले यह कियोस्क आपकी सेहत के बारे में पूछता है, ताकि डॉक्टर को आपकी बात पहले से पता हो।",
    retention: "सिर्फ़ इस विज़िट के लिए रखा जाता है। सहमति न हो तो विज़िट के बाद हटा दिया जाता है।",
    rights: "आप कोई भी सवाल छोड़ सकते हैं, जो लिखा है वह देख सकते हैं, ठीक कर सकते हैं, या मिटाने को कह सकते हैं।",
    ref: "सहमति संदर्भ",
    linked: "ABHA से पहले से जुड़े रिकॉर्ड",
  },
  bn: {
    takeTitle: "আমরা যা নিই",
    take: ["আপনার স্বাস্থ্যের উত্তর", "আপনার দেখানো কাগজের ছবি", "আপনার কণ্ঠ পড়া হয়, তারপর মুছে ফেলা হয়"],
    neverTitle: "আমরা কখনও যা নিই না",
    never: ["আপনার আধার বা পরিচয় নম্বর", "কোনো অডিও রেকর্ডিং", "আপনার সম্মতি ছাড়া কিছুই"],
    purpose: "ডাক্তার দেখার আগে এই কিয়স্ক আপনার স্বাস্থ্য সম্পর্কে জিজ্ঞাসা করে, যাতে ডাক্তার আপনার কথা আগেই জানেন।",
    retention: "শুধু এই ভিজিটের জন্য রাখা হয়। আপনি না চাইলে ভিজিটের পরে মুছে ফেলা হয়।",
    rights: "আপনি যেকোনো প্রশ্ন বাদ দিতে পারেন, লেখা দেখতে, ঠিক করতে বা মুছতে বলতে পারেন।",
    ref: "সম্মতির রেফারেন্স",
    linked: "ABHA-তে আগেই যুক্ত রেকর্ড",
  },
  ta: {
    takeTitle: "நாங்கள் சேகரிப்பவை",
    take: ["உங்கள் உடல்நிலை பதில்கள்", "நீங்கள் காட்டும் ஆவணங்களின் படங்கள்", "உங்கள் குரல் படிக்கப்பட்டு, பின் அழிக்கப்படும்"],
    neverTitle: "நாங்கள் ஒருபோதும் சேகரிக்காதவை",
    never: ["உங்கள் ஆதார் அல்லது அடையாள எண்", "எந்த ஒலிப் பதிவும்", "உங்கள் ஒப்புதல் இல்லாமல் எதுவும்"],
    purpose: "மருத்துவரைப் பார்ப்பதற்கு முன், இந்த கியோஸ்க் உங்கள் உடல்நிலையைப் பற்றிக் கேட்கிறது — மருத்துவர் உங்கள் நிலையை முன்பே அறிவார்.",
    retention: "இந்த வருகைக்காக மட்டுமே வைக்கப்படும். நீங்கள் ஒப்புக்கொள்ளாவிட்டால், வருகைக்குப் பின் நீக்கப்படும்.",
    rights: "எந்தக் கேள்வியையும் தவிர்க்கலாம்; எழுதியதைப் பார்க்கலாம், திருத்தலாம், அழிக்கச் சொல்லலாம்.",
    ref: "ஒப்புதல் குறிப்பு",
    linked: "ABHA-வுடன் ஏற்கனவே இணைக்கப்பட்ட பதிவுகள்",
  },
  te: {
    takeTitle: "మేము తీసుకునేది",
    take: ["మీ ఆరోగ్య సమాధానాలు", "మీరు చూపిన కాగితాల ఫోటోలు", "మీ స్వరం చదివి, తర్వాత తొలగించబడుతుంది"],
    neverTitle: "మేము ఎప్పుడూ తీసుకోనిది",
    never: ["మీ ఆధార్ లేదా గుర్తింపు నంబర్", "ఏ ఆడియో రికార్డింగ్ కూడా", "మీ అనుమతి లేకుండా ఏదీ"],
    purpose: "డాక్టర్‌ను కలిసే ముందు, ఈ కియోస్క్ మీ ఆరోగ్యం గురించి అడుగుతుంది — డాక్టర్‌కు మీ విషయం ముందే తెలుస్తుంది.",
    retention: "ఈ సందర్శన కోసమే ఉంచబడుతుంది. మీరు అంగీకరించకపోతే సందర్శన తర్వాత తొలగించబడుతుంది.",
    rights: "ఏ ప్రశ్ననైనా దాటవేయవచ్చు; రాసినది చూడవచ్చు, సరిచేయవచ్చు, తొలగించమని అడగవచ్చు.",
    ref: "అనుమతి సూచన",
    linked: "ABHA‌తో ఇప్పటికే లింక్ చేసిన రికార్డులు",
  },
  mr: {
    takeTitle: "आम्ही जे घेतो",
    take: ["तुमची आरोग्य उत्तरे", "तुम्ही दाखवलेल्या कागदांचे फोटो", "तुमचा आवाज वाचला जातो, नंतर हटवला जातो"],
    neverTitle: "आम्ही जे कधीही घेत नाही",
    never: ["तुमचा आधार किंवा ओळख क्रमांक", "कोणतेही ऑडिओ रेकॉर्डिंग", "तुमच्या संमतीशिवाय काहीही"],
    purpose: "डॉक्टरांना भेटण्यापूर्वी हे कियोस्क तुमच्या आरोग्याबद्दल विचारते, म्हणजे डॉक्टरांना तुमची माहिती आधीच समजते.",
    retention: "फक्त या भेटीसाठी ठेवले जाते. संमती नसेल तर भेटीनंतर हटवले जाते.",
    rights: "तुम्ही कोणताही प्रश्न वगळू शकता; लिहिलेले पाहू, दुरुस्त करू किंवा हटवायला सांगू शकता.",
    ref: "संमती संदर्भ",
    linked: "ABHA शी आधीच जोडलेले रेकॉर्ड",
  },
  gu: {
    takeTitle: "અમે જે લઈએ છીએ",
    take: ["તમારા સ્વાસ્થ્યના જવાબો", "તમે બતાવેલા કાગળોના ફોટા", "તમારો અવાજ વાંચવામાં આવે છે, પછી ભૂંસી નાખવામાં આવે છે"],
    neverTitle: "અમે જે ક્યારેય લેતા નથી",
    never: ["તમારો આધાર કે ઓળખ નંબર", "કોઈપણ ઓડિયો રેકોર્ડિંગ", "તમારી સંમતિ વગર કંઈ પણ"],
    purpose: "ડૉક્ટરને મળતાં પહેલાં આ કિઓસ્ક તમારા સ્વાસ્થ્ય વિશે પૂછે છે, જેથી ડૉક્ટરને તમારી વાત પહેલેથી ખબર પડે.",
    retention: "ફક્ત આ મુલાકાત માટે રાખવામાં આવે છે. સંમતિ ન હોય તો મુલાકાત પછી દૂર કરવામાં આવે છે.",
    rights: "તમે કોઈ પણ પ્રશ્ન છોડી શકો છો; લખેલું જોઈ, સુધારી કે ભૂંસવા કહી શકો છો.",
    ref: "સંમતિ સંદર્ભ",
    linked: "ABHA સાથે પહેલેથી જોડાયેલા રેકોર્ડ",
  },
  kn: {
    takeTitle: "ನಾವು ತೆಗೆದುಕೊಳ್ಳುವುದು",
    take: ["ನಿಮ್ಮ ಆರೋಗ್ಯದ ಉತ್ತರಗಳು", "ನೀವು ತೋರಿಸಿದ ಕಾಗದಗಳ ಫೋಟೋಗಳು", "ನಿಮ್ಮ ಧ್ವನಿ ಓದಿ, ನಂತರ ಅಳಿಸಲಾಗುತ್ತದೆ"],
    neverTitle: "ನಾವು ಎಂದಿಗೂ ತೆಗೆದುಕೊಳ್ಳದಿರುವುದು",
    never: ["ನಿಮ್ಮ ಆಧಾರ್ ಅಥವಾ ಗುರುತಿನ ಸಂಖ್ಯೆ", "ಯಾವುದೇ ಆಡಿಯೋ ರೆಕಾರ್ಡಿಂಗ್", "ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಇಲ್ಲದೆ ಏನೂ"],
    purpose: "ವೈದ್ಯರನ್ನು ಭೇಟಿಯಾಗುವ ಮೊದಲು ಈ ಕಿಯೋಸ್ಕ್ ನಿಮ್ಮ ಆರೋಗ್ಯದ ಬಗ್ಗೆ ಕೇಳುತ್ತದೆ — ವೈದ್ಯರಿಗೆ ನಿಮ್ಮ ವಿಷಯ ಮೊದಲೇ ತಿಳಿಯುತ್ತದೆ.",
    retention: "ಈ ಭೇಟಿಗಾಗಿ ಮಾತ್ರ ಇಡಲಾಗುತ್ತದೆ. ಒಪ್ಪಿಗೆ ಇಲ್ಲದಿದ್ದರೆ ಭೇಟಿಯ ನಂತರ ತೆಗೆದುಹಾಕಲಾಗುತ್ತದೆ.",
    rights: "ಯಾವುದೇ ಪ್ರಶ್ನೆ ಬಿಡಬಹುದು; ಬರೆದದ್ದನ್ನು ನೋಡಬಹುದು, ತಿದ್ದಬಹುದು, ಅಳಿಸಲು ಹೇಳಬಹುದು.",
    ref: "ಒಪ್ಪಿಗೆ ಉಲ್ಲೇಖ",
    linked: "ABHA ಗೆ ಈಗಾಗಲೇ ಜೋಡಿಸಿದ ದಾಖಲೆಗಳು",
  },
  ml: {
    takeTitle: "ഞങ്ങൾ എടുക്കുന്നത്",
    take: ["നിങ്ങളുടെ ആരോഗ്യ ഉത്തരങ്ങൾ", "നിങ്ങൾ കാണിക്കുന്ന കടലാസുകളുടെ ഫോട്ടോകൾ", "നിങ്ങളുടെ ശബ്ദം വായിച്ചതിന് ശേഷം മായ്ക്കുന്നു"],
    neverTitle: "ഞങ്ങൾ ഒരിക്കലും എടുക്കാത്തത്",
    never: ["നിങ്ങളുടെ ആധാർ അല്ലെങ്കിൽ തിരിച്ചറിയൽ നമ്പർ", "ഏതെങ്കിലും ഓഡിയോ റെക്കോർഡിംഗ്", "നിങ്ങളുടെ സമ്മതമില്ലാതെ ഒന്നും"],
    purpose: "ഡോക്ടറെ കാണുന്നതിന് മുമ്പ് ഈ കിയോസ്ക് നിങ്ങളുടെ ആരോഗ്യത്തെക്കുറിച്ച് ചോദിക്കുന്നു — ഡോക്ടറിന് നിങ്ങളുടെ കാര്യം മുൻകൂട്ടി അറിയാം.",
    retention: "ഈ സന്ദർശനത്തിന് മാത്രം സൂക്ഷിക്കുന്നു. സമ്മതമില്ലെങ്കിൽ സന്ദർശനത്തിന് ശേഷം നീക്കും.",
    rights: "ഏത് ചോദ്യവും ഒഴിവാക്കാം; എഴുതിയത് കാണാം, തിരുത്താം, മായ്ക്കാൻ പറയാം.",
    ref: "സമ്മത റെഫറൻസ്",
    linked: "ABHA-യിൽ മുൻപേ ബന്ധിപ്പിച്ച റെക്കോർഡുകൾ",
  },
  pa: {
    takeTitle: "ਅਸੀਂ ਕੀ ਲੈਂਦੇ ਹਾਂ",
    take: ["ਤੁਹਾਡੀ ਸਿਹਤ ਦੇ ਜਵਾਬ", "ਤੁਹਾਡੇ ਦਿਖਾਏ ਕਾਗਜ਼ਾਂ ਦੀਆਂ ਫ਼ੋਟੋਆਂ", "ਤੁਹਾਡੀ ਆਵਾਜ਼ ਪੜ੍ਹੀ ਜਾਂਦੀ ਹੈ, ਫਿਰ ਮਿਟਾ ਦਿੱਤੀ ਜਾਂਦੀ ਹੈ"],
    neverTitle: "ਅਸੀਂ ਕਦੇ ਨਹੀਂ ਲੈਂਦੇ",
    never: ["ਤੁਹਾਡਾ ਆਧਾਰ ਜਾਂ ਪਛਾਣ ਨੰਬਰ", "ਕੋਈ ਵੀ ਆਡੀਓ ਰਿਕਾਰਡਿੰਗ", "ਤੁਹਾਡੀ ਸਹਿਮਤੀ ਬਿਨਾ ਕੁਝ ਵੀ"],
    purpose: "ਡਾਕਟਰ ਨੂੰ ਮਿਲਣ ਤੋਂ ਪਹਿਲਾਂ ਇਹ ਕਿਓਸਕ ਤੁਹਾਡੀ ਸਿਹਤ ਬਾਰੇ ਪੁੱਛਦਾ ਹੈ, ਤਾਂ ਜੋ ਡਾਕਟਰ ਨੂੰ ਤੁਹਾਡੀ ਗੱਲ ਪਹਿਲਾਂ ਹੀ ਪਤਾ ਹੋਵੇ।",
    retention: "ਸਿਰਫ਼ ਇਸ ਮੁਲਾਕਾਤ ਲਈ ਰੱਖਿਆ ਜਾਂਦਾ ਹੈ। ਸਹਿਮਤੀ ਨਾ ਹੋਵੇ ਤਾਂ ਮੁਲਾਕਾਤ ਤੋਂ ਬਾਅਦ ਹਟਾ ਦਿੱਤਾ ਜਾਂਦਾ ਹੈ।",
    rights: "ਤੁਸੀਂ ਕੋਈ ਵੀ ਸਵਾਲ ਛੱਡ ਸਕਦੇ ਹੋ; ਲਿਖਿਆ ਵੇਖ, ਠੀਕ ਕਰ ਜਾਂ ਮਿਟਾਉਣ ਲਈ ਕਹਿ ਸਕਦੇ ਹੋ।",
    ref: "ਸਹਿਮਤੀ ਹਵਾਲਾ",
    linked: "ABHA ਨਾਲ ਪਹਿਲਾਂ ਹੀ ਜੁੜੇ ਰਿਕਾਰਡ",
  },
  or: {
    takeTitle: "ଆମେ ଯାହା ନେଉ",
    take: ["ଆପଣଙ୍କ ସ୍ୱାସ୍ଥ୍ୟ ଉତ୍ତର", "ଆପଣ ଦେଖାଇଥିବା କାଗଜର ଫଟୋ", "ଆପଣଙ୍କ ସ୍ୱର ପଢ଼ା ଯାଏ, ତାପରେ ବିଲୋପ ହୁଏ"],
    neverTitle: "ଆମେ କେବେ ନେଉନାହୁଁ",
    never: ["ଆପଣଙ୍କ ଆଧାର କିମ୍ବା ପରିଚୟ ନମ୍ବର", "କୌଣସି ଅଡିଓ ରେକର୍ଡିଂ", "ଆପଣଙ୍କ ସମ୍ମତି ବିନା କିଛି"],
    purpose: "ଡାକ୍ତରଙ୍କୁ ଦେଖିବା ପୂର୍ବରୁ ଏହି କିଓସ୍କ ଆପଣଙ୍କ ସ୍ୱାସ୍ଥ୍ୟ ବିଷୟରେ ପଚାରେ, ଯାହା ଫଳରେ ଡାକ୍ତର ଆପଣଙ୍କ କଥା ପୂର୍ବରୁ ଜାଣିବେ।",
    retention: "କେବଳ ଏହି ଭ୍ରମଣ ପାଇଁ ରଖା ଯାଏ। ସମ୍ମତି ନ ଥିଲେ ଭ୍ରମଣ ପରେ ହଟାଇ ଦିଆଯାଏ।",
    rights: "ଆପଣ ଯେକୌଣସି ପ୍ରଶ୍ନ ଛାଡ଼ିପାରନ୍ତି; ଲେଖା ଦେଖି, ସଠିକ କରି କିମ୍ବା ବିଲୋପ କରିବାକୁ କହିପାରନ୍ତି।",
    ref: "ସମ୍ମତି ସନ୍ଦର୍ଭ",
    linked: "ABHA ସହିତ ପୂର୍ବରୁ ସଂଯୁକ୍ତ ରେକର୍ଡ",
  },
  ur: {
    takeTitle: "ہم جو لیتے ہیں",
    take: ["آپ کی صحت کے جواب", "آپ کے دکھائے کاغذات کی تصاویر", "آپ کی آواز پڑھی جاتی ہے، پھر مٹا دی جاتی ہے"],
    neverTitle: "ہم جو کبھی نہیں لیتے",
    never: ["آپ کا آدھار یا شناختی نمبر", "کوئی آڈیو ریکارڈنگ", "آپ کی رضامندی کے بغیر کچھ بھی"],
    purpose: "ڈاکٹر سے ملنے سے پہلے یہ کیوسک آپ کی صحت کے بارے میں پوچھتا ہے، تاکہ ڈاکٹر کو آپ کی بات پہلے سے معلوم ہو۔",
    retention: "صرف اسی ملاقات کے لیے رکھا جاتا ہے۔ رضامندی نہ ہو تو ملاقات کے بعد ہٹا دیا جاتا ہے۔",
    rights: "آپ کوئی بھی سوال چھوڑ سکتے ہیں؛ لکھا ہوا دیکھ، درست کر یا مٹانے کو کہہ سکتے ہیں۔",
    ref: "رضامندی کا حوالہ",
    linked: "ABHA سے پہلے سے منسلک ریکارڈ",
  },
  as: {
    takeTitle: "আমি যি লওঁ",
    take: ["আপোনাৰ স্বাস্থ্যৰ উত্তৰ", "আপুনি দেখুওৱা কাগজৰ ফটো", "আপোনাৰ মাত পঢ়া হয়, তাৰ পিছত মচি পেলোৱা হয়"],
    neverTitle: "আমি যি কেতিয়াও নলওঁ",
    never: ["আপোনাৰ আধাৰ বা পৰিচয় নম্বৰ", "কোনো অডিঅ' ৰেকৰ্ডিং", "আপোনাৰ সন্মতি অবিহনে একো"],
    purpose: "ডাক্তৰক লগ পোৱাৰ আগতে এই কিয়স্কে আপোনাৰ স্বাস্থ্যৰ বিষয়ে সোধে, যাতে ডাক্তৰে আপোনাৰ কথা আগতেই জানে।",
    retention: "কেৱল এই ভ্ৰমণৰ বাবে ৰখা হয়। সন্মতি নাথাকিলে ভ্ৰমণৰ পিছত আঁতৰোৱা হয়।",
    rights: "আপুনি যিকোনো প্ৰশ্ন এৰি দিব পাৰে; লিখা দেখি, শুধৰাই বা মচিবলৈ ক'ব পাৰে।",
    ref: "সন্মতিৰ উল্লেখ",
    linked: "ABHA-ৰ সৈতে আগতেই সংযুক্ত ৰেকৰ্ড",
  },
  ne: {
    takeTitle: "हामी जे लिन्छौं",
    take: ["तपाईंको स्वास्थ्यका जवाफ", "तपाईंले देखाउनुभएका कागजका फोटो", "तपाईंको आवाज पढिन्छ, त्यसपछि मेटिन्छ"],
    neverTitle: "हामी जे कहिल्यै लिँदैनौं",
    never: ["तपाईंको आधार वा परिचय नम्बर", "कुनै पनि अडियो रेकर्डिङ", "तपाईंको सहमति बिना केही"],
    purpose: "डाक्टरलाई भेट्नु अघि यो कियोस्कले तपाईंको स्वास्थ्यबारे सोध्छ, ताकि डाक्टरलाई तपाईंको कुरा पहिले नै थाहा होस्।",
    retention: "यही भेटघाटका लागि मात्र राखिन्छ। सहमति नभए भेटघाटपछि हटाइन्छ।",
    rights: "तपाईं जुनसुकै प्रश्न छोड्न सक्नुहुन्छ; लेखिएको हेर्न, सुधार्न वा मेटाउन भन्न सक्नुहुन्छ।",
    ref: "सहमति सन्दर्भ",
    linked: "ABHA सँग पहिले नै जोडिएका रेकर्ड",
  },
  sa: {
    takeTitle: "वयं यत् गृह्णीमः",
    take: ["भवतः स्वास्थ्यस्य उत्तराणि", "भवता दर्शितानां पत्राणां चित्राणि", "भवतः स्वरः पठ्यते, ततः लुप्यते"],
    neverTitle: "वयं यत् न कदापि गृह्णीमः",
    never: ["भवतः आधार अथवा परिचयसंख्या", "किमपि ध्वनिमुद्रणम्", "भवतः अनुमतेः विना किमपि"],
    purpose: "वैद्यं प्रति गमनात् पूर्वम् एतत् यन्त्रं भवतः स्वास्थ्यं पृच्छति, येन वैद्यः भवतः विषयं पूर्वमेव जानाति।",
    retention: "केवलम् एतत् भ्रमणार्थं रक्ष्यते। अनुमतेः अभावे भ्रमणानन्तरं लुप्यते।",
    rights: "भवान् कमपि प्रश्नं त्यक्तुं शक्नोति; लिखितं द्रष्टुं, संशोधयितुं, लोपयितुं वा वक्तुं शक्नोति।",
    ref: "अनुमतेः सन्दर्भः",
    linked: "ABHA सह पूर्वमेव संयुक्तानि अभिलेखानि",
  },
  mai: {
    takeTitle: "हम की लैत छी",
    take: ["अहाँक स्वास्थ्यक उत्तर", "अहाँ देखाओल कागजक फोटो", "अहाँक आवाज पढ़ल जाइत अछि, तखन मेटाओल जाइत अछि"],
    neverTitle: "हम की कहियो नै लैत छी",
    never: ["अहाँक आधार वा पहचान नम्बर", "कोनो अडियो रेकर्डिंग", "अहाँक सहमति बिना कोनो चीज"],
    purpose: "डाक्टर सँ भेटवा सँ पहिने ई कियोस्क अहाँक स्वास्थ्यक बारे में पुछैत अछि, जाहि सँ डाक्टर क अहाँक बात पहिने सँ जानल रहय।",
    retention: "खाली एहि भेटक लेल राखल जाइत अछि। सहमति नहि भेल तँ भेटक बाद हटाओल जाइत अछि।",
    rights: "अहाँ कोनो प्रश्न छोड़ि सकैत छी; लिखल देखि, ठीक करि वा मेटाबै लेल कहि सकैत छी।",
    ref: "सहमतिक संदर्भ",
    linked: "ABHA सँ पहिने सँ जुड़ल रेकर्ड",
  },
  kok: {
    takeTitle: "आमी जें घेतात",
    take: ["तुमचे भलायकेचे जाप", "तुमी दाखयल्ल्या कागदांच्यो फोटो", "तुमचो आवाज वाचतात, उपरांत काडून उडयतात"],
    neverTitle: "आमी जें केन्नाच घेनात",
    never: ["तुमचो आधार वा ओळख क्रमांक", "खंयचोय ऑडियो रेकॉर्डिंग", "तुमच्या संमतीविना कांय पण"],
    purpose: "दोतोराक मेळच्या आदीं हो किऑस्क तुमच्या भलायकी विशीं विचारता, म्हणून दोतोराक तुमची गजाल आदींच कळटा.",
    retention: "फकत ह्या भेटी खातीर दवरतात. संमती नासत जाल्यार भेटी उपरांत काडून उडयतात.",
    rights: "तुमी खंयचोय प्रस्न सोडूं येता; बरयल्लें पळोवंक, दुरुस्त करूंक वा काडून उडोवंक सांगूंक येता.",
    ref: "संमती संदर्भ",
    linked: "ABHA कडेन आदींच जोडिल्ले रेकॉर्ड",
  },
  doi: {
    takeTitle: "असीं की लैंदे आं",
    take: ["तुंदे सेहत दे जवाब", "तुंदे दस्से कागजां दियां फोटोआं", "तुंदी आवाज पढ़ी जंदी ऐ, फिर मिटाई जंदी ऐ"],
    neverTitle: "असीं की कदे नेईं लैंदे",
    never: ["तुंदा आधार जां पछाण नंबर", "कोई बी ऑडियो रिकॉर्डिंग", "तुंदी स्हमति बगैर कुज्झ बी"],
    purpose: "डाक्टर कन्नै मिलने तों पैह्लें एह् कियोस्क तुंदे सेहत बारै पुच्छदा ऐ, तां जे डाक्टर गी तुंदी गल्ल पैह्लें ई पता होए।",
    retention: "सिरफ एह् मुलाकात लेई रक्खा जंदा ऐ। स्हमति नेईं होवे तां मुलाकात दे बाद हटाई दित्ता जंदा ऐ।",
    rights: "तुस कोई बी सवाल छड्डी सकदे ओ; लिख्यां देखी, ठीक करी जां मिटान आखी सकदे ओ।",
    ref: "स्हमति संदर्भ",
    linked: "ABHA कन्नै पैह्लें ई जुड़े रिकॉर्ड",
  },
};

const MK_CONSENT = MK_CONSENT_I18N.en;

function mkConsent(code) {
  const c = MK_CONSENT_I18N[code] || MK_CONSENT_I18N.en;
  return {
    purpose: c.purpose, takeTitle: c.takeTitle, take: c.take,
    neverTitle: c.neverTitle, never: c.never,
    retention: c.retention, rights: c.rights, ref: c.ref, linked: c.linked,
    artefact: MK_CONSENT_REF, abdm: MK_CONSENT_ABDM,
  };
}

/* --------------------------------------------------------------- interview */

const MK_SECTIONS = {
  story:      { en: "Your story",       hi: "आपकी बात" },
  symptoms:   { en: "Symptom details",  hi: "लक्षण विवरण" },
  safety:     { en: "Safety check",     hi: "सुरक्षा जाँच" },
  history:    { en: "Health history",   hi: "स्वास्थ्य इतिहास" },
  ros:        { en: "Other symptoms",   hi: "अन्य लक्षण" },
  ice:        { en: "Your thoughts",    hi: "आपके विचार" },
  documents:  { en: "Your papers",      hi: "आपके काग़ज़" },
};

/* Each step: id, section, kind, ask{en,hi}, optional options[], the recorded
   answer, and `say` — the words the patient speaks (used for the live
   transcript, and to match a real spoken answer). */
const MK_STEPS = [
  {
    id: "bodymap", section: "story", kind: "bodymap",
    ask: { en: "Show us where it hurts. Tap the body picture — no need to read or speak.",
           hi: "दिखाइए दर्द कहाँ है। शरीर की तस्वीर पर दबाइए — पढ़ने या बोलने की ज़रूरत नहीं।" },
    answer: { region: "chest", complaint: "chest" },
    say: { en: "Here — in the chest, in the middle.", hi: "यहाँ — छाती में, बीच में।" },
  },
  {
    id: "narrative", section: "story", kind: "text",
    ask: { en: "Namaste. In your own words — what problem brought you to the hospital today? Take your time.",
           hi: "नमस्ते। अपने शब्दों में बताइए — आज आप अस्पताल किस समस्या से आए हैं? आराम से बताइए।" },
    answer: { text: "I have had pain in my chest for three days. It feels heavy, and I get breathless when I walk. Sometimes I sweat too. My father also had a heart problem." },
    say: { en: "I have had pain in my chest for three days. It feels heavy, and I get breathless when I walk. Sometimes I sweat too. My father also had a heart problem.",
           hi: "मुझे तीन दिन से छाती में दर्द है। भारी लगता है, और चलने पर सांस फूलती है। कभी-कभी पसीना भी आता है। मेरे पिता को भी दिल की बीमारी थी।" },
  },
  {
    id: "cc", section: "story", kind: "cc",
    ask: { en: "We have noted your main problem as chest pain. Is that correct?",
           hi: "हमने आपकी मुख्य समस्या छाती में दर्द दर्ज की है। क्या यह सही है?" },
    answer: { value: "yes", complaint: "chest" },
    say: { en: "Yes, that is correct.", hi: "हाँ, यह सही है।" },
  },
  {
    id: "socrates.site", section: "symptoms", kind: "chips", field: "Site",
    ask: { en: "Where exactly do you feel it?", hi: "ठीक कहाँ महसूस होता है?" },
    options: [
      { v: "center", en: "Centre of the chest", hi: "छाती के बीच" },
      { v: "left", en: "Left side of the chest", hi: "छाती के बाईं ओर" },
      { v: "whole", en: "Whole chest", hi: "पूरी छाती" },
    ],
    answer: { value: "center" },
    say: { en: "In the centre of the chest.", hi: "छाती के बीच में।" },
  },
  {
    id: "socrates.onset", section: "symptoms", kind: "chips", field: "Onset",
    ask: { en: "When did it start — suddenly or gradually?", hi: "शुरूआत कब और कैसे हुई — अचानक या धीरे-धीरे?" },
    options: [
      { v: "sudden", en: "Suddenly, within minutes", hi: "अचानक, कुछ मिनटों में" },
      { v: "hours", en: "Over a few hours", hi: "कुछ घंटों में" },
      { v: "days", en: "Over a few days", hi: "कुछ दिनों में" },
    ],
    answer: { value: "days" },
    say: { en: "It started gradually, over the last three days.", hi: "धीरे-धीरे, पिछले तीन दिनों में शुरू हुआ।" },
  },
  {
    id: "socrates.character", section: "symptoms", kind: "chips", field: "Character",
    ask: { en: "What does it feel like?", hi: "यह कैसा महसूस होता है?" },
    options: [
      { v: "pressing", en: "Heavy / pressing", hi: "दबने जैसा" },
      { v: "sharp", en: "Sharp / stabbing", hi: "चुभने जैसा" },
      { v: "burning", en: "Burning", hi: "जलन" },
    ],
    answer: { value: "pressing" },
    say: { en: "It feels heavy, like something is pressing on my chest.", hi: "भारी लगता है, जैसे छाती पर दबाव है।" },
  },
  {
    id: "socrates.radiation", section: "symptoms", kind: "chips", field: "Spread",
    ask: { en: "Does it spread anywhere else?", hi: "क्या यह कहीं और फैलता है?" },
    options: [
      { v: "no_spread", en: "No — stays in one place", hi: "नहीं — एक ही जगह" },
      { v: "left_arm", en: "Goes to the left arm", hi: "बाईं बाँह तक" },
      { v: "jaw_neck", en: "Goes to jaw or neck", hi: "जबड़े या गर्दन तक" },
    ],
    answer: { value: "left_arm" },
    say: { en: "Yes, it goes down my left arm.", hi: "हाँ, बाईं बाँह तक जाता है।" },
  },
  {
    id: "socrates.associations", section: "symptoms", kind: "multi", field: "Along with it",
    ask: { en: "Along with this, do you have any of these? Choose all that apply.",
           hi: "इसके साथ और क्या-क्या है? जो लागू हो, सब चुनिए।" },
    options: [
      { v: "breathless", en: "Breathlessness", hi: "सांस फूलना" },
      { v: "sweating", en: "Sweating", hi: "पसीना आना" },
      { v: "nausea", en: "Nausea or vomiting", hi: "मतली या उल्टी" },
      { v: "dizzy", en: "Fainting or dizziness", hi: "चक्कर या बेहोशी" },
      { v: "none_assoc", en: "None of these", hi: "इनमें से कोई नहीं" },
    ],
    answer: { values: ["breathless", "sweating"] },
    say: { en: "I get breathless, and I sweat a lot.", hi: "सांस फूलती है, और बहुत पसीना आता है।" },
  },
  {
    id: "socrates.timing", section: "symptoms", kind: "chips", field: "Timing",
    ask: { en: "Is it there all the time, or does it come and go?", hi: "यह हमेशा रहता है या आता-जाता है?" },
    options: [
      { v: "constant", en: "All the time", hi: "हमेशा" },
      { v: "with_activity", en: "Only with activity", hi: "सिर्फ़ काम करते समय" },
      { v: "comes_goes", en: "Comes and goes", hi: "आता-जाता है" },
    ],
    answer: { value: "with_activity" },
    say: { en: "It comes when I walk or climb stairs.", hi: "जब मैं चलता या सीढ़ी चढ़ता हूँ, तब होता है।" },
  },
  {
    id: "socrates.exacerbating", section: "symptoms", kind: "multi", field: "Worse / better",
    ask: { en: "What makes it worse, and what makes it better?", hi: "किससे बढ़ता है और किससे कम होता है?" },
    options: [
      { v: "worse_exertion", en: "Worse on walking", hi: "चलने से बढ़ता है" },
      { v: "better_rest", en: "Better with rest", hi: "आराम से कम होता है" },
      { v: "nothing_helps", en: "Nothing helps", hi: "कुछ फ़ायदा नहीं" },
    ],
    answer: { values: ["worse_exertion", "better_rest"] },
    say: { en: "Walking makes it worse. If I sit down and rest, it becomes less.", hi: "चलने से बढ़ता है। बैठकर आराम करने से कम हो जाता है।" },
  },
  {
    id: "socrates.severity", section: "symptoms", kind: "scale", field: "Severity",
    ask: { en: "Right now — if 0 is no pain and 10 is the worst pain you can imagine, what number is it?",
           hi: "अभी — अगर 0 का मतलब दर्द नहीं और 10 सबसे बुरा दर्द, तो कौन-सा नंबर है?" },
    answer: { value: 7 },
    say: { en: "It is about seven out of ten.", hi: "लगभग सात, दस में से।" },
  },
  {
    id: "safety", section: "safety", kind: "safety",
    ask: { en: "Checking for warning signs…", hi: "चेतावनी के संकेत जाँच रहे हैं…" },
  },
  {
    id: "pmh", section: "history", kind: "multi", field: "Long-standing illness",
    ask: { en: "Do you have any long-standing illness — BP, sugar, asthma, thyroid, heart problem?",
           hi: "कोई पुरानी बीमारी है — BP, शुगर, दमा, थायराइड, दिल की बीमारी?" },
    options: [
      { v: "htn", en: "High blood pressure", hi: "उच्च रक्तचाप" },
      { v: "dm", en: "Diabetes (sugar)", hi: "शुगर" },
      { v: "asthma", en: "Asthma", hi: "दमा" },
      { v: "cardiac", en: "Heart problem", hi: "दिल की बीमारी" },
      { v: "none_pmh", en: "None of these", hi: "कोई नहीं" },
    ],
    answer: { values: ["htn", "dm"] },
    say: { en: "Yes — I have high BP and sugar for many years.", hi: "हाँ — कई सालों से BP और शुगर है।" },
  },
  {
    id: "meds", section: "history", kind: "multi", field: "Medicines",
    ask: { en: "Are you taking any medicines at present? Say the name and dose if you know.",
           hi: "क्या अभी कोई दवा ले रहे हैं? नाम और खुराक बताइए।" },
    options: [
      { v: "telmisartan", en: "Telmisartan 40 mg", hi: "टेल्मिसार्टन 40 मि.ग्रा." },
      { v: "metformin", en: "Metformin 500 mg", hi: "मेटफ़ॉर्मिन 500 मि.ग्रा." },
      { v: "no_meds", en: "No medicines right now", hi: "अभी कोई दवा नहीं" },
    ],
    answer: { values: ["telmisartan", "metformin"] },
    say: { en: "I take Telmisartan 40 mg in the morning and Metformin 500 mg twice a day.", hi: "मैं सुबह टेल्मिसार्टन 40 मि.ग्रा. और दिन में दो बार मेटफ़ॉर्मिन 500 मि.ग्रा. लेता हूँ।" },
  },
  {
    id: "allergies", section: "history", kind: "chips", field: "Allergy",
    ask: { en: "Do you have any allergy to any medicine?", hi: "किसी दवा से एलर्जी है?" },
    options: [
      { v: "no_allergy", en: "No known allergy", hi: "कोई एलर्जी नहीं" },
      { v: "unsure_allergy", en: "Not sure", hi: "पता नहीं" },
    ],
    answer: { value: "no_allergy" },
    say: { en: "No, I have no allergy to any medicine.", hi: "नहीं, किसी दवा से एलर्जी नहीं है।" },
  },
  {
    id: "family", section: "history", kind: "multi", field: "Family history",
    ask: { en: "Any illness in your close family — parents, brothers, sisters?", hi: "परिवार में किसी को बीमारी है — माता-पिता, भाई-बहन?" },
    options: [
      { v: "mi", en: "Heart attack / heart disease", hi: "दिल का दौरा" },
      { v: "dm_fam", en: "Diabetes", hi: "शुगर" },
      { v: "htn_fam", en: "High blood pressure", hi: "उच्च रक्तचाप" },
      { v: "no_family", en: "None that I know of", hi: "कोई नहीं" },
    ],
    answer: { values: ["mi", "dm_fam"] },
    say: { en: "My father had a heart attack. My mother had sugar.", hi: "मेरे पिता को दिल का दौरा हुआ था। मेरी माँ को शुगर थी।" },
  },
  {
    id: "social.smoke", section: "history", kind: "chips", field: "Tobacco",
    ask: { en: "Do you smoke or use tobacco?", hi: "सिगरेट-बीड़ी या तंबाकू का इस्तेमाल करते हैं?" },
    options: [
      { v: "never", en: "Never used", hi: "कभी नहीं" },
      { v: "former", en: "Used to — now quit", hi: "पहले करता था — अब छोड़ दिया" },
      { v: "current", en: "Yes, currently", hi: "हाँ, अभी" },
    ],
    answer: { value: "former" },
    say: { en: "I used to smoke, but I stopped two years ago.", hi: "पहले सिगरेट पीता था, दो साल पहले छोड़ दिया।" },
  },
  {
    id: "social.alcohol", section: "history", kind: "chips", field: "Alcohol",
    ask: { en: "Do you drink alcohol?", hi: "शराब पीते हैं?" },
    options: [
      { v: "no_alc", en: "No", hi: "नहीं" },
      { v: "sometimes", en: "Sometimes", hi: "कभी-कभी" },
      { v: "regular", en: "Regularly", hi: "नियमित" },
    ],
    answer: { value: "sometimes" },
    say: { en: "Only sometimes, on special occasions.", hi: "कभी-कभी, ख़ास मौकों पर।" },
  },
  {
    id: "ros.rest_breathless", section: "ros", kind: "yesno", system: "Cardio",
    ask: { en: "Are you breathless even while sitting at rest?", hi: "बैठे-बैठे भी सांस फूलती है?" },
    answer: { value: "no" }, say: { en: "No, only when I walk.", hi: "नहीं, चलने पर ही।" },
  },
  {
    id: "ros.palpitations", section: "ros", kind: "yesno", system: "Cardio",
    ask: { en: "Do you feel your heart racing or beating fast?", hi: "धड़कन तेज़ होती है?" },
    answer: { value: "yes" }, say: { en: "Yes, sometimes my heart beats fast.", hi: "हाँ, कभी-कभी धड़कन तेज़ होती है।" },
  },
  {
    id: "ros.fever_cough", section: "ros", kind: "yesno", system: "Respiratory",
    ask: { en: "Do you have fever or cough?", hi: "बुखार या खांसी है?" },
    answer: { value: "no" }, say: { en: "No fever, no cough.", hi: "बुखार नहीं, खांसी नहीं।" },
  },
  {
    id: "ros.calf", section: "ros", kind: "yesno", system: "Vascular",
    ask: { en: "Any pain or swelling in the calves?", hi: "पिंडलियों में दर्द या सूजन?" },
    answer: { value: "no" }, say: { en: "No, nothing there.", hi: "नहीं, वहाँ कुछ नहीं।" },
  },
  {
    id: "ice.worry", section: "ice", kind: "text", field: "Worry",
    ask: { en: "What worries you most about this problem?", hi: "इस समस्या को लेकर सबसे ज़्यादा चिंता किस बात की है?" },
    answer: { text: "I am worried it is a heart problem, like what happened to my father." },
    say: { en: "I am worried it is a heart problem, like what happened to my father.", hi: "मुझे डर है कि यह दिल की बीमारी है, जैसा मेरे पिता के साथ हुआ।" },
  },
  {
    id: "ice.expect", section: "ice", kind: "chips", field: "Expectation",
    ask: { en: "What do you hope the doctor will do today?", hi: "आज डॉक्टर से क्या उम्मीद है?" },
    options: [
      { v: "find_out", en: "Find out exactly what is wrong", hi: "पता चले क्या गड़बड़ है" },
      { v: "relief", en: "Relief from the pain", hi: "दर्द से राहत" },
      { v: "tests", en: "Get some tests done", hi: "कुछ जाँच करवानी है" },
    ],
    answer: { value: "relief" },
    say: { en: "I want relief from this pain, and I want to know if my heart is fine.", hi: "मुझे दर्द से राहत चाहिए, और जानना है कि दिल ठीक है या नहीं।" },
  },
];

const MK_YESNO = [
  { v: "yes", en: "Yes", hi: "हाँ" },
  { v: "no", en: "No", hi: "नहीं" },
  { v: "not_sure", en: "Not sure", hi: "पता नहीं" },
];

/* ------------------------------------------------------------- red flags */

const MK_RULES = [
  { id: "RF-1", en: "Sudden, very severe headache", hi: "अचानक बहुत तेज़ सिरदर्द", termsEn: "sudden + headache", termsHi: "अचानक + सिरदर्द", fire: false },
  { id: "RF-2", en: "Chest pain together with breathlessness", hi: "छाती में दर्द के साथ सांस फूलना", termsEn: "chest pain + breathless", termsHi: "छाती में दर्द + सांस फूलना", fire: true },
  { id: "RF-3", en: "Sudden weakness on one side, slurred speech, face drooping", hi: "अचानक एक तरफ़ कमज़ोरी, लड़खड़ाती बोली, चेहरा टेढ़ा", termsEn: "one side + slurred", termsHi: "एक तरफ़ + लिसडर", fire: false },
  { id: "RF-4", en: "Pain 8/10 or worse, with sweating, fainting or vomiting", hi: "दर्द 8/10 या ज़्यादा — पसीना, बेहोशी या उल्टी के साथ", termsEn: "severity 7/10", termsHi: "दर्द 7/10", fire: false },
];

/* -------------------------------------------------------- papers (Module B) */

const MK_PAPERS = [
  {
    id: "rx1", kind: "printed", type: { en: "Prescription", hi: "पर्चा" },
    title: "Dr. A. K. Sharma, MBBS, MD (Medicine)",
    meta: "Sharma Clinic, Civil Lines, Kanpur · Reg. 48291 · 12-03-2026",
    body:
`Name: Ramesh Kumar        Age: 54 / M
Rx
  Tab Telmisartan 40 mg  —  1 tablet in the morning    × 30 days
  Tab Metformin 500 mg   —  1 tablet twice daily       × 30 days
  Tab Atorvastatin 10 mg —  1 tablet at night          × 30 days
Advice: low salt diet, check sugar and BP weekly.`,
  },
  {
    id: "lab1", kind: "printed", type: { en: "Laboratory report", hi: "जाँच रिपोर्ट" },
    title: "Sanjeevani Diagnostics, Kanpur",
    meta: "Collected 10-03-2026 · Reported 11-03-2026",
    body:
`HAEMOGLOBIN            11.2 g/dL      (13.0 - 17.0)   LOW
TOTAL LEUCOCYTE COUNT  8,400 /uL      (4,000 - 11,000)
PLATELET COUNT         2.1 lakh /uL   (1.5 - 4.1)
FASTING BLOOD SUGAR    168 mg/dL      (70 - 100)       HIGH
HbA1c                  8.4 %          (< 5.7)          HIGH
TOTAL CHOLESTEROL      212 mg/dL
LDL CHOLESTEROL        142 mg/dL      (< 100)          HIGH
SERUM CREATININE       1.1 mg/dL      (0.7 - 1.3)
TSH                    3.2 uIU/mL     (0.4 - 4.0)`,
  },
  {
    id: "ecg1", kind: "printed", type: { en: "ECG report", hi: "ई.सी.जी. रिपोर्ट" },
    title: "R. K. Heart Centre, Kanpur",
    meta: "14-03-2026 · Resting 12-lead ECG",
    body:
`Rhythm            : Sinus rhythm, rate 88/min
Axis              : Normal
ST-T changes      : T-wave inversion in leads V4 - V6
                    ST depression 1 mm in V5 - V6
Impression        : Ischaemic changes - clinical correlation advised.
                    Please review with treating physician.`,
  },
  {
    id: "rx2", kind: "handwritten", type: { en: "Handwritten prescription", hi: "हाथ से लिखा पर्चा" },
    title: "Local clinic slip (handwritten)",
    meta: "Date unclear · script partly illegible",
    body:
`Rx
  Tab Sorbit___ 5 mg   SOS   (writing unclear)
  ___id  1 tab          at night
  Follow up after 5 days
                         [doctor's signature]`,
  },
];

const MK_EXTRACTION = {
  medicines: [
    { name: "Telmisartan", dose: "40 mg", freq: "once daily (morning)", conf: 0.98, flag: "clear", source: "Prescription · Sharma Clinic", prov: "doc:rx1#line1" },
    { name: "Metformin", dose: "500 mg", freq: "twice daily", conf: 0.97, flag: "clear", source: "Prescription · Sharma Clinic", prov: "doc:rx1#line2" },
    { name: "Atorvastatin", dose: "10 mg", freq: "at night", conf: 0.96, flag: "clear", source: "Prescription · Sharma Clinic", prov: "doc:rx1#line3" },
    { name: "Sorbitrate", dose: "5 mg", freq: "SOS (as needed)", conf: 0.61, flag: "verify", source: "Handwritten slip (partly illegible)", prov: "doc:rx2#line1" },
  ],
  labs: [
    { name: "Haemoglobin", value: "11.2 g/dL", range: "13.0 - 17.0", state: "low", conf: 0.99, prov: "doc:lab1#line1" },
    { name: "Fasting blood sugar", value: "168 mg/dL", range: "70 - 100", state: "high", conf: 0.99, prov: "doc:lab1#line2" },
    { name: "HbA1c", value: "8.4 %", range: "< 5.7", state: "high", conf: 0.98, prov: "doc:lab1#line3" },
    { name: "LDL cholesterol", value: "142 mg/dL", range: "< 100", state: "high", conf: 0.97, prov: "doc:lab1#line4" },
    { name: "Serum creatinine", value: "1.1 mg/dL", range: "0.7 - 1.3", state: "normal", conf: 0.96, prov: "doc:lab1#line5" },
    { name: "Platelet count", value: "2.1 lakh /µL", range: "1.5 - 4.1", state: "normal", conf: 0.95, prov: "doc:lab1#line6" },
  ],
  findings: [
    { name: "Ischaemic changes on ECG (T-wave inversion V4–V6)", conf: 0.94, flag: "verify", prov: "doc:ecg1#line1" },
    { name: "Known hypertension", conf: 0.99, flag: "clear", prov: "doc:rx1#line1" },
    { name: "Known type 2 diabetes", conf: 0.98, flag: "clear", prov: "doc:lab1#line2" },
  ],
};

/* --------------------------------------------------- merge / alerts (Module C) */

const MK_ALERTS = [
  { kind: "red-flag", title: "Red flag RF-2", detail: "Chest pain together with breathlessness — matched on \"chest pain\" + \"breathless\". Priority triage." },
  { kind: "verify", title: "Handwritten medicine needs a check", detail: "\"Sorbitrate 5 mg SOS\" read at 61% confidence (doc:rx2). The patient did not list this medicine." },
  { kind: "abnormal", title: "4 abnormal laboratory values", detail: "HbA1c 8.4% (high) · Fasting glucose 168 mg/dL (high) · LDL 142 mg/dL (high) · Haemoglobin 11.2 g/dL (low)." },
  { kind: "abnormal", title: "ECG finding to correlate", detail: "T-wave inversion in V4–V6 with ST depression — reported by the lab, for the physician to correlate." },
];

const MK_MED_MERGE = [
  { name: "Telmisartan 40 mg", source: "Patient + document", conflict: false },
  { name: "Metformin 500 mg", source: "Patient + document", conflict: false },
  { name: "Atorvastatin 10 mg", source: "Document", conflict: false },
  { name: "Sorbitrate 5 mg SOS", source: "Document (handwritten, unverified)", conflict: true },
];

/* -------------------------------------------------------------- read-back */

const MK_READBACK = {
  en: [
    { field: "Main problem", text: "Chest pain, in the centre of the chest, for three days." },
    { field: "What it feels like", text: "Heavy and pressing. It goes down the left arm. It comes when you walk and gets better with rest." },
    { field: "Along with it", text: "Breathlessness and sweating. Heart sometimes beats fast." },
    { field: "Severity now", text: "7 out of 10." },
    { field: "Illnesses you told us", text: "High blood pressure and diabetes for many years." },
    { field: "Medicines", text: "Telmisartan 40 mg in the morning, Metformin 500 mg twice a day." },
    { field: "Allergies", text: "No known allergy." },
    { field: "Family", text: "Father had a heart attack; mother had diabetes." },
    { field: "Your worry", text: "You are worried this may be a heart problem, like your father's." },
    { field: "Your papers", text: "4 papers read: a prescription, a blood report, an ECG report and a handwritten slip." },
  ],
  hi: [
    { field: "मुख्य समस्या", text: "छाती में दर्द, बीच में, तीन दिन से।" },
    { field: "कैसा महसूस होता है", text: "भारी और दबने जैसा। बाईं बाँह तक जाता है। चलने पर होता है, आराम से कम होता है।" },
    { field: "साथ में", text: "सांस फूलना और पसीना। कभी-कभी धड़कन तेज़ होती है।" },
    { field: "अभी दर्द", text: "10 में से 7।" },
    { field: "बताई गई बीमारियाँ", text: "कई सालों से उच्च रक्तचाप और शुगर।" },
    { field: "दवाइयाँ", text: "सुबह टेल्मिसार्टन 40 मि.ग्रा., दिन में दो बार मेटफ़ॉर्मिन 500 मि.ग्रा." },
    { field: "एलर्जी", text: "कोई एलर्जी नहीं।" },
    { field: "परिवार", text: "पिता को दिल का दौरा; माँ को शुगर थी।" },
    { field: "आपकी चिंता", text: "आपको डर है कि यह दिल की बीमारी हो सकती है, जैसा आपके पिता के साथ हुआ।" },
    { field: "आपके काग़ज़", text: "4 काग़ज़ पढ़े गए: एक पर्चा, एक ख़ून रिपोर्ट, एक ई.सी.जी. रिपोर्ट और एक हाथ से लिखा पर्चा।" },
  ],
};

/* ------------------------------------------------------------ physician SOAP */

const MK_SOAP = {
  s: [
    { text: "54-year-old man, 3 days of central chest pain — heavy, pressing, radiating to the left arm. Worse on exertion, relieved by rest.", prov: "voice:socrates" },
    { text: "Associated breathlessness and sweating; occasional palpitations. No fever, no cough, no calf pain.", prov: "voice:socrates + ros" },
    { text: "Severity 7/10. Pain now with activity.", prov: "voice:socrates.severity" },
    { text: "Known hypertension and type 2 diabetes. Former smoker (quit 2 years). Occasional alcohol. Father had a myocardial infarction.", prov: "voice:pmh/family/social" },
    { text: "Patient's stated worry: \"that it is a heart problem, like my father's\".", prov: "voice:ice.worry" },
  ],
  o: [
    { text: "Documents: prescription (Telmisartan 40 mg OD, Metformin 500 mg BD, Atorvastatin 10 mg HS).", prov: "doc:rx1" },
    { text: "Laboratory: HbA1c 8.4% (H), fasting glucose 168 mg/dL (H), LDL 142 mg/dL (H), Hb 11.2 g/dL (L).", prov: "doc:lab1" },
    { text: "ECG report: T-wave inversion V4–V6, ST depression V5–V6 — ischaemic changes, clinical correlation advised.", prov: "doc:ecg1" },
    { text: "Handwritten slip: \"Sorbitrate 5 mg SOS\" read at 61% confidence — needs confirmation against the paper.", prov: "doc:rx2 (needs review)" },
    { text: "Vitals not captured at the kiosk (no BP/pulse/SpO2 device attached).", prov: "kiosk:not-captured" },
  ],
};

const MK_FHIR = {
  profile: "OPConsultRecord (NRCeS) · ndhm.in#6.5.0",
  snomed: "371530004 — Clinical consultation",
  attester: "Practitioner slot (unsigned at kiosk; physician attests)",
  counts: "1 Patient · 1 Practitioner slot · 3 Observations · 4 MedicationRequests · 1 DocumentReference",
  sections: "Chief complaint · History of present illness · Past history · Medication · Allergy · Family history · Social history · Investigations · Review of systems",
};

/* ------------------------------------------------------------ physician list */

const MK_WORKLIST = [
  { id: "MK-2F41", name: "Ramesh Kumar", age: 54, problem: "Chest pain + breathlessness", flag: "red-flag", queue: "Priority triage" },
  { id: "MK-9A17", name: "Sunita Devi", age: 42, problem: "Knee pain", flag: "", queue: "Routine OPD" },
  { id: "MK-6C08", name: "Abdul Rahman", age: 61, problem: "Breathlessness", flag: "", queue: "Routine OPD" },
];
