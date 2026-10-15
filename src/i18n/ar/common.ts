import type { Dict } from "../core";

/** Arabic for the texts shared by every page: menus, buttons, forms, dates. Keys are the English texts exactly as in the code. */
const ar: Dict = {
  Language: "اللغة",
  never: "أبدًا",
  "just now": "الآن",
  "{n} min ago": "منذ {n} دقيقة",
  "{n} h ago": "منذ {n} ساعة",
  "{n} days ago": "منذ {n} يوم",

  // Menu (components/app/nav.ts)
  Dashboard: "لوحة القيادة",
  "Profit tracker": "متتبّع الربح",
  Expenses: "المصاريف",
  Products: "المنتجات",
  "Orders & parcels": "الطلبيات والطرود",
  Creatives: "الإعلانات",
  Campaigns: "الحملات",
  "Money & stock": "المال والمخزون",
  "MDM sync": "مزامنة MDM",
  "Breakeven CPA": "CPA نقطة التعادل",
  Imports: "الاستيراد",
  Settings: "الإعدادات",

  // Shell: header, phone menu, bottom bar, computer dock, account menu
  "COD Flow dashboard": "لوحة قيادة COD Flow",
  Main: "القائمة الرئيسية",
  Pages: "الصفحات",
  Workspaces: "مساحات العمل",
  demo: "تجريبية",
  "Account and workspace: {name}": "الحساب ومساحة العمل: {name}",
  "New workspace": "مساحة عمل جديدة",
  "Sign out": "تسجيل الخروج",
  Menu: "القائمة",
  "Close menu": "إغلاق القائمة",
  "Open menu": "فتح القائمة",
  Shortcuts: "اختصارات",
  "All pages": "كل الصفحات",
  "Skip to content": "انتقل إلى المحتوى",
  "DEMO DATA · Synthetic workspace. Nothing here is a real business or real MDM data.": "بيانات تجريبية · مساحة عمل مصطنعة. لا شيء هنا نشاط تجاري حقيقي أو بيانات MDM حقيقية.",
  "Application dock": "شريط الصفحات",

  // Data freshness (header)
  "Checking data…": "جارٍ فحص البيانات…",
  "Last successful MDM sync: {when}": "آخر مزامنة ناجحة مع MDM: {when}",
  "MDM Express is not connected. Parcel data may be missing or stale.": "MDM Express غير مربوط. قد تكون بيانات الطرود ناقصة أو قديمة.",
  "synced {ago}": "تمت المزامنة {ago}",
  "connected, not synced yet": "مربوط، لم تتم المزامنة بعد",
  error: "خطأ",
  "not connected": "غير مربوط",
  "{unmatched} unmatched records, {unknown} parcels with unknown status, {failed} failed sync items.": "{unmatched} سجلات غير مطابقة، {unknown} طرود بحالة غير معروفة، {failed} عناصر مزامنة فاشلة.",
  "need review": "تحتاج مراجعة",

  // Currency picker and amounts in another currency
  Currency: "العملة",
  "e.g. 250": "مثلًا 250",
  Amount: "المبلغ",
  "{label} cannot be negative": "لا يمكن أن يكون {label} سالبًا",
  "Enter how many {book} one {currency} costs": "أدخل قيمة 1 {currency} بعملة {book}",
  "Amounts are kept in {book}.": "المبالغ محفوظة بعملة {book}.",
  "Converted from {book} at your Settings rate: 1 {view} = {rate} {book}. Stored amounts don't change.": "محوَّلة من {book} بسعر الصرف المحفوظ في الإعدادات: 1 {view} = {rate} {book}. المبالغ المحفوظة لا تتغير.",
  "Show in": "العرض بعملة",
  "Show amounts in": "عرض المبالغ بعملة",
  "Add a rate…": "إضافة سعر صرف…",

  // Small shared pieces
  "Not enough data": "بيانات غير كافية",
  Close: "إغلاق",
  Loading: "جارٍ التحميل",
  "What is {label}?": "ما معنى {label}؟",
  "What is this?": "ما معنى هذا؟",
  "More details": "تفاصيل أكثر",
  "Fewer details": "تفاصيل أقل",
  "More filters": "خيارات تصفية أكثر",
  "Fewer filters": "خيارات تصفية أقل",
  "More {what}": "عرض المزيد ({what})",
  "Fewer {what}": "عرض أقل ({what})",
  "Arrives in Milestone {n}": "متوفر في المرحلة {n}",

  // Parcel and order statuses
  Pending: "قيد الانتظار",
  Confirmed: "مؤكَّدة",
  Shipped: "مُرسَلة",
  Delivered: "مُسلَّمة",
  Returned: "مرتجَعة",
  Lost: "ضائعة",
  Canceled: "ملغاة",
  Exchanged: "مستبدَلة",
  "Unknown ⚠": "غير معروفة ⚠",

  // Verdicts
  Kill: "أوقِف",
  "Bad traffic": "زيارات سيئة",
  Scale: "وسِّع",
  Watch: "راقِب",

  // Offers (domain/offers.ts, offer picker)
  "No offer": "بدون عرض",
  "1 piece per order": "قطعة واحدة في كل طلبية",
  "Buy 1, get 1 free": "اشترِ 1 واحصل على 1 مجانًا",
  "2 pieces per order": "قطعتان في كل طلبية",
  "Buy 2, get 1 free": "اشترِ 2 واحصل على 1 مجانًا",
  "3 pieces per order": "3 قطع في كل طلبية",
  "Buy 2, get 2 free": "اشترِ 2 واحصل على 2 مجانًا",
  "4 pieces per order": "4 قطع في كل طلبية",
  "{n} pieces per order": "{n} قطع في كل طلبية",
  "Another number of pieces…": "عدد آخر من القطع…",
  "Pieces per order": "عدد القطع في كل طلبية",

  // Quick date ranges and short month names (lib/dateRanges.ts)
  Today: "اليوم",
  Yesterday: "أمس",
  "Last 7 days": "آخر 7 أيام",
  "Last 30 days": "آخر 30 يومًا",
  "This month": "هذا الشهر",
  "Last month": "الشهر الماضي",
  "All dates": "كل التواريخ",
  Custom: "مخصَّص",
  Jan: "جانفي",
  Feb: "فيفري",
  Mar: "مارس",
  Apr: "أفريل",
  May: "ماي",
  Jun: "جوان",
  Jul: "جويلية",
  Aug: "أوت",
  Sep: "سبتمبر",
  Oct: "أكتوبر",
  Nov: "نوفمبر",
  Dec: "ديسمبر",

  // Expense categories (lib/labels.ts)
  "My pay": "أجري",
  "Employee pay": "أجور العمال",
  "AI Tools": "أدوات الذكاء الاصطناعي",
  Software: "البرمجيات",
  Office: "المكتب",
  "Domains/Proxies": "النطاقات/البروكسي",
  "Bank Fees": "رسوم البنك",
  "Call Center": "مركز الاتصال",
  Packaging: "التغليف",
  Warehouse: "المستودع",
  "Other ads (TikTok, Google…)": "إعلانات أخرى (TikTok، Google…)",
  "Content & creatives": "المحتوى والإعلانات",
  Transport: "النقل",
  Taxes: "الضرائب",
  Other: "أخرى",

  // Metric definitions (lib/definitions.ts)
  "Cash the carrier has actually remitted to you (REMITTED cash events) for orders placed in this period. Differs from delivered revenue until remittances arrive.":
    "المال الذي حوّله لك الناقل فعلًا (عمليات الدفع REMITTED) عن الطلبيات الواردة في هذه الفترة. يختلف عن مداخيل الطلبيات المسلَّمة إلى أن تصل التحويلات.",
  "COD value of parcels that have shipped but are not yet delivered, returned or lost (including dispatched parcels with an unknown status). Not yet yours.":
    "قيمة الدفع عند الاستلام (COD) للطرود المُرسَلة التي لم تُسلَّم ولم تُرجَع ولم تضِع بعد (ومنها الطرود المُرسَلة بحالة غير معروفة). ليست ملكك بعد.",
  "COD value of parcels with a delivered status. Delivered is not the same as remitted.":
    "قيمة الدفع عند الاستلام (COD) للطرود المسلَّمة. التسليم لا يعني أن المال قد حُوِّل إليك.",
  "Ad spend in the period. Includes spend whose creative ID could not be matched.":
    "مصاريف الإعلانات في هذه الفترة. تشمل المصاريف التي لم يُعثر على إعلانها (creative ID).",
  "Money burned on returned parcels: forward shipping + RTO fee + packaging.":
    "المال الضائع على الطرود المرتجَعة: تكلفة الإرسال + رسوم الإرجاع (RTO) + التغليف.",
  "Revenue (delivered or remitted, per the selected view) − ad spend − COGS − outbound shipping − RTO fees − call-center cost − packaging − allocated overhead. A parcel still with the carrier counts once it is delivered or returned.":
    "المداخيل (المسلَّمة أو المحوَّلة، حسب العرض المختار) − مصاريف الإعلانات − تكلفة المنتجات (COGS) − تكلفة الإرسال − رسوم الإرجاع (RTO) − تكلفة مركز الاتصال − التغليف − حصة المصاريف العامة. الطرد الذي ما زال عند الناقل يُحتسب عندما يُسلَّم أو يُرجَع.",
  "True net profit ÷ ad spend. 0 means breakeven after all costs; 0.3 means 30% profit on top of ad spend.":
    "صافي الربح الحقيقي ÷ مصاريف الإعلانات. 0 يعني نقطة التعادل بعد كل التكاليف؛ 0.3 يعني ربحًا بنسبة 30% فوق مصاريف الإعلانات.",
  "Ad spend ÷ placed orders. Cheap leads can still lose money.":
    "مصاريف الإعلانات ÷ الطلبيات الواردة. الطلبيات الرخيصة قد تبقى خاسرة.",
  "Cost per confirmed order: ad spend ÷ confirmed orders.": "تكلفة الطلبية المؤكَّدة: مصاريف الإعلانات ÷ الطلبيات المؤكَّدة.",
  "Cost per delivered order: ad spend ÷ delivered parcels.": "تكلفة الطلبية المسلَّمة: مصاريف الإعلانات ÷ الطرود المسلَّمة.",
  "Confirmed ÷ placed orders.": "الطلبيات المؤكَّدة ÷ الطلبيات الواردة.",
  "Delivered ÷ parcels whose delivery is finished (delivered, returned or lost). Parcels still with the carrier are left out until they finish.":
    "الطرود المسلَّمة ÷ الطرود التي انتهى توصيلها (مسلَّمة أو مرتجَعة أو ضائعة). الطرود التي ما زالت عند الناقل لا تُحتسب حتى ينتهي توصيلها.",
  "Returned (RTO) ÷ parcels whose delivery is finished. Parcels still with the carrier are left out until they finish.":
    "الطرود المرتجَعة (RTO) ÷ الطرود التي انتهى توصيلها. الطرود التي ما زالت عند الناقل لا تُحتسب حتى ينتهي توصيلها.",
  "Delivered quantity × sourcing cost from the cost version in effect on the order date. Returned goods go back to stock.":
    "الكمية المسلَّمة × تكلفة المنتج حسب التكلفة المعمول بها في تاريخ الطلبية. البضاعة المرتجَعة تعود إلى المخزون.",
  "Expenses in the period. At business level all of them count; per product/creative they are allocated by your overhead policy.":
    "المصاريف في هذه الفترة. على مستوى النشاط كله تُحتسب كلها؛ ولكل منتج أو إعلان تُوزَّع حسب طريقة توزيع المصاريف العامة التي اخترتها.",
  "KILL: losing money with enough data. BAD TRAFFIC: cheap orders that don't deliver. SCALE: POAS at or above target with enough orders. WATCH: enough data, below target. INSUFFICIENT DATA: too few orders.":
    "أوقِف: يخسر المال مع بيانات كافية. زيارات سيئة: طلبيات رخيصة لا تُسلَّم. وسِّع: POAS عند الهدف أو أعلى مع طلبيات كافية. راقِب: بيانات كافية لكن تحت الهدف. بيانات غير كافية: طلبيات قليلة جدًا.",

  // Meta ads filter
  "All ads": "كل الإعلانات",
  "1 campaign": "حملة واحدة",
  "one campaign": "حملة واحدة",
  "{n} campaigns": "{n} حملات",
  "1 ad account": "حساب إعلاني واحد",
  "one ad account": "حساب إعلاني واحد",
  "{n} ad accounts": "{n} حسابات إعلانية",
  "1 Business Manager": "حساب Business Manager واحد",
  "one Business Manager": "حساب Business Manager واحد",
  "{n} Business Managers": "{n} حسابات Business Manager",
  "Counts {what}.": "يحتسب {what}.",
  "Counts every ad, and orders without an ad.": "يحتسب كل الإعلانات، والطلبيات التي بدون إعلان.",
  "Filter by Meta ads": "تصفية حسب إعلانات Meta",
  "Pick Business Managers, ad accounts, or campaigns from any ad accounts. The pick follows you to the dashboard, Profit tracker, orders, creatives and campaigns.":
    "اختر حسابات Business Manager أو حسابات إعلانية أو حملات من أي حساب إعلاني. يبقى اختيارك معك في لوحة القيادة ومتتبّع الربح والطلبيات والإعلانات والحملات.",
  "No ad accounts or campaigns yet. Connect Meta in Settings → Meta ads, or import an Ads Manager export, and they show up here.":
    "لا توجد حسابات إعلانية أو حملات بعد. اربط Meta من الإعدادات ← إعلانات Meta، أو استورد ملف تصدير من Ads Manager، وستظهر هنا.",
  "Campaigns you pick count on their own. Without campaigns, the ad accounts you pick count, or else every ad account of the Business Managers you pick.":
    "الحملات التي تختارها تُحتسب وحدها. وإن لم تختر حملات، تُحتسب الحسابات الإعلانية التي تختارها، وإلا فكل الحسابات الإعلانية في حسابات Business Manager التي تختارها.",
  "Business Managers": "حسابات Business Manager",
  Clear: "مسح",
  "Ad accounts": "الحسابات الإعلانية",
  "Ad accounts · {n} picked": "الحسابات الإعلانية · {n} مختارة",
  "Campaigns · {n} picked": "الحملات · {n} مختارة",
  "from imported spend": "من المصاريف المستوردة",
  "No ad account in these Business Managers yet.": "لا يوجد حساب إعلاني في حسابات Business Manager هذه بعد.",
  "Search campaigns": "ابحث عن حملة",
  "Running only": "النشطة فقط",
  "No ad account (imported)": "بدون حساب إعلاني (مستوردة)",
  Running: "نشطة",
  Paused: "متوقفة مؤقتًا",
  Off: "متوقفة",
  "No campaign matches.": "لا توجد حملة مطابقة.",
  "Show all ads": "إظهار كل الإعلانات",
  "Show results": "إظهار النتائج",
  "Meta ads: {ads}": "إعلانات Meta: {ads}",

  // Sign in and sign up
  "Sign in": "تسجيل الدخول",
  "See which products and creatives make delivered profit.": "اعرف أي المنتجات والإعلانات تحقق ربحًا من الطلبيات المسلَّمة.",
  Email: "البريد الإلكتروني",
  Password: "كلمة المرور",
  "Signing in…": "جارٍ تسجيل الدخول…",
  "New here? {link}": "جديد هنا؟ {link}",
  "Create a workspace": "أنشئ مساحة عمل",
  "Development demo: {email} / {password}": "حساب تجريبي للتطوير: {email} / {password}",
  "Create your workspace": "أنشئ مساحة عملك",
  "One workspace per business. You become its owner.": "مساحة عمل واحدة لكل نشاط تجاري. ستكون أنت مالكها.",
  "Your name": "اسمك",
  "At least 10 characters.": "10 أحرف على الأقل.",
  "Business name": "اسم النشاط التجاري",
  "Creating…": "جارٍ الإنشاء…",
  "Create workspace": "إنشاء مساحة عمل",
  "Already have an account? {link}": "لديك حساب؟ {link}",
  "Enter a valid email and password.": "أدخل بريدًا إلكترونيًا وكلمة مرور صحيحين.",
  "Too many attempts. Try again in {n}s.": "محاولات كثيرة. حاول مجددًا بعد {n} ثانية.",
  "Email or password is incorrect.": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  "Too small: expected string to have >=2 characters": "قصير جدًا: يجب أن يحتوي على حرفين على الأقل",
  "Too big: expected string to have <=80 characters": "طويل جدًا: يجب ألا يتجاوز 80 حرفًا",
  "Too big: expected string to have <=200 characters": "طويل جدًا: يجب ألا يتجاوز 200 حرف",
  "Invalid email address": "البريد الإلكتروني غير صالح",
  "Password must be at least 10 characters": "يجب أن تتكون كلمة المرور من 10 أحرف على الأقل",
  "Check the form fields.": "تحقّق من خانات الاستمارة.",
  "An account with this email already exists. Sign in instead.": "يوجد حساب بهذا البريد الإلكتروني. سجّل الدخول بدلًا من ذلك.",
  "You are not a member of that workspace": "لست عضوًا في مساحة العمل هذه",
};

export default ar;
