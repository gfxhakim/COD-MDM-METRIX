import type { Dict } from "../core";

/** Arabic for the ⓘ explanations (help texts) of fields, cards and numbers in this part of the app. */
const ar: Dict = {
  // MDM sync page
  "MDM orders this sync saved in the app for the first time.": "طلبيات MDM التي حفظتها هذه المزامنة في التطبيق لأول مرة.",
  "Orders already in the app that this sync changed, e.g. a new MDM status or customer details.":
    "طلبيات موجودة في التطبيق غيّرتها هذه المزامنة، مثل حالة جديدة في MDM أو تفاصيل الزبون.",
  "Orders read in this sync that carry a content ID (the Meta ad ID from utm_content), so they count under that ad in Creatives.":
    "الطلبيات المقروءة في هذه المزامنة التي تحمل معرّف محتوى (content ID)، أي معرّف إعلان Meta من utm_content، فتُحسب لذلك الإعلان في صفحة «الإعلانات».",
  "Parcels the app had never seen before.": "طرود لم يرها التطبيق من قبل.",
  "Parcels already in the app with a new status, amount or fee, or a new step in their history.":
    "طرود موجودة في التطبيق لها حالة أو مبلغ أو رسوم جديدة، أو خطوة جديدة في سجلّها.",
  "Parcels read again with nothing new.": "طرود قُرئت من جديد دون أي جديد.",
  "Orders or parcels this sync could not save. The list below gives the reason for each.":
    "طلبيات أو طرود لم تستطع هذه المزامنة حفظها. القائمة أدناه تذكر سبب كل واحد منها.",
  "Parcels with an MDM status the app can't sort yet. They count as neither delivered nor returned until you map it in Settings > Status mappings.":
    "طرود بحالة في MDM لا يعرف التطبيق تصنيفها بعد. لا تُحسب مُسلَّمة ولا مرتجَعة حتى تصنّف هذه الحالة في الإعدادات > تصنيف الحالات.",
  "Parcels that could not be tied to an order. They wait under Unmatched parcels for you to link or ignore.":
    "طرود تعذّر ربطها بطلبية. تنتظر في «طرود غير مربوطة» حتى تربطها أو تتجاهلها.",
  "Search by order number, MDM order ID, tracking ID or the customer's phone, then press Link beside the right order. Syncs keep a link made by hand.":
    "ابحث برقم الطلبية أو معرّف طلبية MDM أو رقم التتبع أو هاتف الزبون، ثم اضغط «ربط» بجانب الطلبية الصحيحة. المزامنات تحتفظ بالربط اليدوي.",
  "Until linked, a parcel's COD and fees count in no order's profit. Link picks its order by hand; Ignore only takes it off this list.":
    "ما دام الطرد غير مربوط، لا يدخل مبلغ COD ولا رسومه في ربح أي طلبية. «ربط» يختار طلبيته يدويًا؛ و«تجاهل» يُخرجه من هذه القائمة فقط.",
  "Whether the app can read your MDM Express account with the workspace's API key. It only reads and never changes anything in MDM. Connected means the last connection test worked.":
    "هل يستطيع التطبيق قراءة حسابك في MDM Express بمفتاح API الخاص بمساحة العمل. هو يقرأ فقط ولا يغيّر أي شيء في MDM. «متصل» يعني أن آخر اختبار للاتصال نجح.",
  "When the last regular sync that finished began (custom syncs don't count). The next sync reads what changed in MDM since then, plus the 24 hours before.":
    "وقت بدء آخر مزامنة عادية اكتملت (المزامنات المخصَّصة لا تُحسب). المزامنة القادمة تقرأ ما تغيّر في MDM منذ ذلك الوقت، مع الـ 24 ساعة التي قبله.",
  "Worked out as: parcels whose MDM status has no match in the app yet. Map each status once in Settings > Status mappings and they count as delivered, returned and so on.":
    "طريقة الحساب: الطرود التي ليس لحالتها في MDM مقابل في التطبيق بعد. صنّف كل حالة مرة واحدة في الإعدادات > تصنيف الحالات فتُحسب مُسلَّمة أو مرتجَعة وهكذا.",
  "The last 30 syncs, newest first. Tap a row to see what it brought in and what failed; a failed or partial sync can be retried there.":
    "آخر 30 مزامنة، الأحدث أولًا. اضغط على سطر لترى ما جلبته وما فشل؛ ويمكن هناك إعادة محاولة مزامنة فاشلة أو جزئية.",

  // What to bring from MDM
  "For each product: Bring in or Don't bring, and from which order date. An order comes in when at least one of its products is brought in from that day.":
    "لكل منتج: «اجلب» أو «لا تجلب»، ومن أي تاريخ طلبية. تُجلب الطلبية إذا كان منتج واحد منها على الأقل يُجلب ابتداءً من ذلك اليوم.",
  "What the sync does with a product it sees in MDM for the first time: bring its orders in right away, or leave them out until someone picks it below.":
    "ما تفعله المزامنة بمنتج تراه في MDM لأول مرة: تجلب طلبياته فورًا، أو تتركها حتى يختاره أحد في القائمة أدناه.",

  // Custom sync
  "The days to sync, counted in the workspace's time zone, first and last day included. Pick Custom to type your own first and last day.":
    "الأيام التي تُزامَن، حسب المنطقة الزمنية لمساحة العمل، مع احتساب أول يوم وآخر يوم. اختر «مخصَّص» لتكتب أول يوم وآخر يوم بنفسك.",
  "Order date picks orders placed on those days. Latest status change picks orders whose MDM status last changed on those days, e.g. delivered last week.":
    "«تاريخ الطلبية» يختار الطلبيات الواردة في تلك الأيام. «آخر تغيير في الحالة» يختار الطلبيات التي تغيّرت حالتها في MDM آخر مرة في تلك الأيام، مثل المُسلَّمة الأسبوع الماضي.",
  "Tick a group for all its MDM statuses, or open it to pick single ones. With every status ticked, statuses MDM adds later are synced too.":
    "علِّم مجموعة لتشمل كل حالاتها في MDM، أو افتحها لتختار حالات بعينها. إذا علّمت كل الحالات، تُزامَن أيضًا الحالات التي يضيفها MDM لاحقًا.",
  "Each filter is optional. An order is synced only when it matches every filter you set here.":
    "كل خيار تصفية اختياري. لا تُزامَن الطلبية إلا إذا طابقت كل الخيارات التي تحدّدها هنا.",
  "Only orders going to the wilayas you add. Leave it empty for every wilaya.": "فقط الطلبيات المتّجهة إلى الولايات التي تضيفها. اتركه فارغًا لكل الولايات.",
  "Home: delivered to the customer's address. Stop desk: the customer collects the parcel at the carrier's desk. Any: both.":
    "المنزل: التوصيل إلى عنوان الزبون. مكتب الاستلام (Stop desk): الزبون يستلم الطرد من مكتب شركة التوصيل. الكل: الاثنان معًا.",
  "With an ad ID: orders whose link carried a Meta ad ID (utm_content). Without: orders with none. Any: both.":
    "بمعرّف إعلان: الطلبيات التي حمل رابطها معرّف إعلان Meta (utm_content). بدونه: الطلبيات التي لا تحمله. الكل: الاثنان معًا.",
  "Only orders from the stores you add, as MDM names them. Leave it empty for every store.": "فقط الطلبيات القادمة من المتاجر التي تضيفها، بالأسماء التي يستعملها MDM. اتركه فارغًا لكل المتاجر.",
  "Only orders holding at least one of the products you add, by their MDM name. Leave it empty for every product.":
    "فقط الطلبيات التي فيها منتج واحد على الأقل من المنتجات التي تضيفها، باسمها في MDM. اتركه فارغًا لكل المنتجات.",
  "Paste up to {max} MDM order IDs or store order numbers to sync just those. Capitals and a leading # don't matter, e.g. #1043 or 1043.":
    "الصق حتى {max} من معرّفات طلبيات MDM أو أرقام طلبيات المتجر لمزامنتها هي فقط. الحروف الكبيرة والعلامة # في البداية لا تهمّ، مثل #1043 أو 1043.",
  "On: after the orders, the sync re-reads their parcels too. Off: only the orders are updated, which is quicker when you only need order details.":
    "مفعَّل: بعد الطلبيات، تعيد المزامنة قراءة طرودها أيضًا. غير مفعَّل: تُحدَّث الطلبيات فقط، وهذا أسرع إذا كنت تحتاج تفاصيل الطلبيات وحدها.",

  // Meta ads filter
  "One for each Meta token saved in Settings > Meta ads. Picking one counts every ad account that token can read.":
    "واحد لكل رمز وصول (token) من Meta محفوظ في الإعدادات > إعلانات Meta. اختياره يحتسب كل حساب إعلاني يستطيع ذلك الرمز قراءته.",
  "Tick ad accounts to count only their ads. An account marked from imported spend comes from an Ads Manager export, not from a token.":
    "علِّم حسابات إعلانية لتحتسب إعلاناتها فقط. الحساب المكتوب بجانبه «من المصاريف المستوردة» جاء من ملف تصدير Ads Manager، لا من رمز وصول (token).",
  "Tick campaigns to count only their ads, in any ad account. Running means on in Meta now; Running only hides paused and off ones, except those you ticked.":
    "علِّم حملات لتحتسب إعلاناتها فقط، في أي حساب إعلاني. «نشطة» تعني أنها تعمل الآن في Meta؛ و«النشطة فقط» يُخفي الموقوفة والمتوقفة، إلا التي علّمتها.",
  "Narrows the numbers to the Meta ads you pick: only their orders, their ad spend and their share of expenses. All ads also counts orders without an ad.":
    "يحصر الأرقام في إعلانات Meta التي تختارها: طلبياتها فقط، ومصاريف إعلاناتها، ونصيبها من المصاريف. «كل الإعلانات» يحتسب أيضًا الطلبيات التي بلا إعلان.",

  // Currencies
  "Shows amounts in another currency, only for you in this browser, with the rates in Settings > Economics & currencies. Example: with 1 USD = 250 DZD, 5000 DZD shows as 20 USD.":
    "يعرض المبالغ بعملة أخرى، لك وحدك في هذا المتصفح، بأسعار الصرف المحفوظة في الإعدادات > التكاليف والعملات. مثال: إذا كان 1 USD = 250 DZD، يظهر 5000 DZD على أنه 20 USD.",
  "Exchange rate": "سعر الصرف",
  "How many {book} one {currency} cost you for this amount. Filled from Settings > Economics & currencies; change it if you paid at another rate. Reports use the amount in {book}.":
    "كم {book} كلّفك 1 {currency} في هذا المبلغ. يُملأ من الإعدادات > التكاليف والعملات؛ غيّره إذا دفعت بسعر آخر. التقارير تستعمل المبلغ بـ {book}.",

  // Sign in and sign up
  "The email of your account, the one you signed up with.": "البريد الإلكتروني لحسابك، الذي سجّلت به.",
  "The password you chose when you signed up. Capital and small letters count as different.": "كلمة المرور التي اخترتها عند التسجيل. الحروف الكبيرة والصغيرة تُعتبر مختلفة.",
  "Your own name, as your team sees it in Settings > Members & roles. Example: Amine.": "اسمك الشخصي، كما يراه فريقك في الإعدادات > الأعضاء والأدوار. مثال: أمين.",
  "You sign in with it. A workspace owner also uses it to add you to their workspace.": "تسجّل الدخول به. ويستعمله أيضًا مالك مساحة عمل ليضيفك إلى مساحة عمله.",
  "You type it with your email to sign in. Pick one you don't use on other sites.": "تكتبها مع بريدك الإلكتروني لتسجيل الدخول. اختر كلمة مرور لا تستعملها في مواقع أخرى.",
  "Your business or store name, e.g. Dz Shop. It names your workspace; you can rename it later in Settings > Workspace.":
    "اسم نشاطك التجاري أو متجرك، مثل Dz Shop. يصبح اسم مساحة عملك؛ ويمكنك تغييره لاحقًا في الإعدادات > مساحة العمل.",
};

export default ar;
