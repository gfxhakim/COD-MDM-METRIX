import type { Dict } from "../core";

/** Arabic for the ⓘ explanations (help texts) of fields, cards and numbers in this part of the app. */
const ar: Dict = {
  // Orders page: the filters
  "The call center's result for the order: pending, confirmed or canceled. The parcel status filter is about delivery instead.":
    "نتيجة مركز الاتصال للطلبية: قيد الانتظار أو مؤكَّدة أو ملغاة. أما خيار حالة الطرد فيخص التوصيل.",
  "Only orders going to this wilaya.": "الطلبيات المُرسَلة إلى هذه الولاية فقط.",
  "Only orders with this product on one of their lines.": "الطلبيات التي فيها هذا المنتج في أحد أسطرها فقط.",
  "Only orders with a parcel in this status, as MDM reports it: shipped, delivered, returned and so on.":
    "الطلبيات التي لها طرد في هذه الحالة فقط، كما يذكرها MDM: مُرسَلة، مُسلَّمة، مرتجَعة وغيرها.",
  "Only orders linked to this Meta ad, by the ad ID in their utm_content.": "الطلبيات المربوطة بإعلان Meta هذا فقط، عبر معرّف الإعلان في utm_content الخاص بها.",
  "Only the orders MDM marked as upsold by its call center, or only the others.": "الطلبيات التي وضع عليها MDM علامة بيع إضافي من مركز الاتصال فقط، أو الطلبيات الأخرى فقط.",

  // Orders: manual order
  "Your number for the order, e.g. #1001. An MDM parcel with the same reference links to this order by itself.":
    "رقمك لهذه الطلبية، مثلًا ‎#1001. طرد MDM الذي يحمل نفس المرجع يُربط بهذه الطلبية تلقائيًا.",
  "The day the customer ordered. Reports count the order on this day.": "اليوم الذي طلب فيه الزبون. التقارير تحسب الطلبية في هذا اليوم.",
  "The call center's result. Confirmed orders count in the confirmation rate; pending ones still wait for a call.":
    "نتيجة مركز الاتصال. الطلبيات المؤكَّدة تدخل في نسبة التأكيد، والتي قيد الانتظار ما زالت تنتظر اتصالًا.",
  "One line per product: pick it, type the pieces and the price of one piece. The price fills in from the product's sale price.":
    "سطر لكل منتج: اختره، واكتب عدد القطع وسعر القطعة الواحدة. السعر يُملأ تلقائيًا من سعر بيع المنتج.",
  "Everything the customer pays the delivery person for this order. Example: 3900.": "كل ما يدفعه الزبون لعامل التوصيل مقابل هذه الطلبية. مثال: 3900.",
  "Where the parcel goes. The dashboard uses wilayas to show where parcels come back from.":
    "الولاية التي يُرسَل إليها الطرد. لوحة القيادة تستعمل الولايات لتبيّن من أين ترجع الطرود.",
  "The customer's commune or city, shown on the order.": "بلدية الزبون أو مدينته، وتظهر في الطلبية.",
  "The customer's number. You can then find this order by phone in the Orders search.": "رقم الزبون. بعدها يمكنك إيجاد هذه الطلبية برقم الهاتف في بحث الطلبيات.",
  "The campaign name from the ad link (utm_campaign), kept on the order for your records.": "اسم الحملة من رابط الإعلان (utm_campaign)، ويُحفظ في الطلبية للرجوع إليه.",
  "The Meta ad ID from the ad link (utm_content). It links the order to its ad, so the ad's results count it.":
    "معرّف إعلان Meta من رابط الإعلان (utm_content). يربط الطلبية بإعلانها، فتُحسب في نتائج هذا الإعلان.",
  "Anything to remember about this order. Shown when you open it.": "أي شيء تريد تذكّره عن هذه الطلبية. يظهر عند فتحها.",

  // Orders: the order drawer
  "Home delivery: to the customer's door. Stop desk: the customer collects the parcel at the carrier's office.":
    "التوصيل للمنزل: حتى باب الزبون. مكتب الاستلام (Stop desk): الزبون يستلم الطرد من مكتب شركة التوصيل.",
  "The call center's result: pending, confirmed or canceled. It follows the parcels: a parcel being prepared or shipped confirms it, and all parcels canceled cancels it.":
    "نتيجة مركز الاتصال: قيد الانتظار أو مؤكَّدة أو ملغاة. وهي تتبع الطرود: طرد قيد التحضير أو مُرسَل يؤكّدها، وإلغاء كل طرودها يلغيها.",
  "The order's status in MDM's own words at the last MDM sync, with when it changed. Empty for orders MDM never received.":
    "حالة الطلبية بكلمات MDM نفسها عند آخر مزامنة MDM، مع وقت تغيّرها. تكون فارغة للطلبيات التي لم يستلمها MDM.",
  "What the customer pays the delivery person, in cash, for this order.": "ما يدفعه الزبون نقدًا لعامل التوصيل مقابل هذه الطلبية.",
  "Set it by hand after a call. For an order from MDM, the next MDM sync sets it again from MDM's status.":
    "غيّرها يدويًا بعد الاتصال. في طلبية من MDM، مزامنة MDM التالية تعيد ضبطها حسب حالة MDM.",
  "The products in this order: pieces × price of one piece, as MDM, the store or a manual order gave them. Upsell: MDM marked the order as upsold by its call center.":
    "منتجات هذه الطلبية: عدد القطع × سعر القطعة الواحدة، كما جاءت من MDM أو المتجر أو الطلبية اليدوية. بيع إضافي: وضع MDM على الطلبية علامة بيع إضافي من مركز الاتصال.",
  "Which Meta ad brought this order. The order then counts for that ad on the Creatives page.": "إعلان Meta الذي جلب هذه الطلبية. تُحسب الطلبية لهذا الإعلان في صفحة الإعلانات.",
  "The Meta ad ID found in the order's utm_content. Unattributed: the order has no ad ID, or no creative has that ID yet.":
    "معرّف إعلان Meta الموجود في utm_content الطلبية. «غير مربوطة بإعلان»: الطلبية بدون معرّف إعلان، أو لا يوجد بعد إعلان بهذا المعرّف.",
  "How the ad was found. Utm content: the ad ID in the order's link matched a creative. None: no match yet.":
    "كيف عُثر على الإعلان. «محتوى UTM»: معرّف الإعلان في رابط الطلبية طابق إعلانًا. «لا شيء»: لا توجد مطابقة بعد.",
  "How sure the link to the ad is: 100% when the ad ID matched a creative exactly, 0% when no ad is linked.":
    "مدى التأكد من الربط بالإعلان: 100% عندما يطابق معرّف الإعلان إعلانًا تمامًا، و0% عندما لا يوجد إعلان مربوط.",
  "The parcels MDM made for this order, with every status they went through. Delivery and return rates count parcels, not orders.":
    "الطرود التي أنشأها MDM لهذه الطلبية، مع كل حالة مرّت بها. نسبة التسليم ونسبة الإرجاع تحسبان الطرود لا الطلبيات.",
  "Match: how the parcel was tied to this order. Confidence: 100% by MDM order, order reference or by hand; 95% by an earlier tracking-ID link; 90% by the store order ID.":
    "الربط: كيف رُبط الطرد بهذه الطلبية. الثقة: 100% عبر طلبية MDM أو مرجع الطلبية أو يدويًا، و95% عبر ربط سابق برقم التتبع، و90% عبر رقم طلبية المتجر.",
  "For a parcel that did not link by itself. Type its tracking number; later syncs keep this link, and Unlink undoes it.":
    "لطرد لم يُربط تلقائيًا. اكتب رقم تتبعه، والمزامنات التالية تحافظ على هذا الربط، و«فك الربط» يلغيه.",

  // Orders: the export panel
  "Which days to export, counted in the workspace's time zone. The first and last days are included.":
    "الأيام التي تريد تصديرها، حسب المنطقة الزمنية لمساحة العمل. اليوم الأول واليوم الأخير محسوبان.",
  "The first day to export. Leave it empty to start from the oldest order.": "أول يوم للتصدير. اتركه فارغًا للبدء من أقدم طلبية.",
  "The last day to export. Leave it empty to go up to today.": "آخر يوم للتصدير. اتركه فارغًا للوصول حتى اليوم.",
  "Order date: orders placed in those days. Latest status change: orders whose newest status came in those days, e.g. delivered last week.":
    "تاريخ الطلبية: الطلبيات الواردة في تلك الأيام. آخر تغيير في الحالة: الطلبيات التي جاءت آخر حالة لها في تلك الأيام، مثلًا التي سُلِّمت الأسبوع الماضي.",
  "Synced from MDM: orders MDM knows, synced or with an MDM parcel. All orders also adds orders from file imports and manual orders.":
    "المُزامَنة من MDM: الطلبيات التي يعرفها MDM، المُزامَنة أو التي لها طرد في MDM. «كل الطلبيات» تضيف أيضًا الطلبيات المستوردة من الملفات والطلبيات اليدوية.",
  "The filters set on the Orders page apply to this export too. Remove one with its ×.": "خيارات التصفية في صفحة الطلبيات تنطبق على هذا التصدير أيضًا. أزل أيًّا منها بعلامة × الخاصة به.",
  "Each order counts once, under its latest MDM status: its newest parcel's, or MDM's order status when newer. Orders MDM never had use pending, confirmed or cancelled.":
    "كل طلبية تُحسب مرة واحدة، تحت آخر حالة لها في MDM: حالة أحدث طرد لها، أو حالة الطلبية في MDM إذا كانت أحدث. الطلبيات التي لم تصل إلى MDM تأخذ: قيد الانتظار أو مؤكَّدة أو ملغاة.",
  "Excel keeps numbers and dates ready to add up. CSV is plain text for other tools. Print or PDF opens a page of up to 5,000 rows.":
    "Excel يحفظ الأرقام والتواريخ جاهزة للجمع. CSV نص بسيط لأدوات أخرى. «طباعة أو PDF» تفتح صفحة حتى 5,000 سطر.",
  "The character between columns. Pick Semicolon when Excel in French opens the file with everything in one column.":
    "الرمز الذي يفصل بين الأعمدة. اختر الفاصلة المنقوطة إذا فتح Excel بالفرنسية الملف وكل شيء في عمود واحد.",
  "Pick a ready set, or tick columns one by one. Customer names, phones and addresses are offered only to owners, admins and operators.":
    "اختر مجموعة جاهزة، أو حدّد الأعمدة واحدًا واحدًا. أسماء الزبائن وهواتفهم وعناوينهم متاحة فقط للمالك والمدير والمُشغِّل.",
  "One row per product splits an order with 2 products into 2 rows. Its COD amount and fees sit on the first row only, so column totals stay right.":
    "«سطر لكل منتج» يقسم الطلبية التي فيها منتجان إلى سطرين. مبلغ COD والرسوم تكون في السطر الأول فقط، لتبقى مجاميع الأعمدة صحيحة.",
  "The currency for COD amounts, prices and fees. Other currencies are converted with the rates in Settings > Economics & currencies.":
    "عملة مبالغ COD والأسعار والرسوم. العملات الأخرى تُحوَّل بأسعار الصرف في الإعدادات > التكاليف والعملات.",
  "Adds a Totals by status table (its own sheet in Excel): orders, pieces and COD amount for each MDM status, then a total row.":
    "يضيف جدول «المجاميع حسب الحالة» (في ورقة خاصة به في Excel): الطلبيات والقطع ومبلغ COD لكل حالة في MDM، ثم سطر المجموع.",
  // Orders: what each export column holds
  "The number your store or MDM gave the order, e.g. #1001.": "الرقم الذي أعطاه متجرك أو MDM للطلبية، مثلًا ‎#1001.",
  "MDM's own number for the order. Empty for orders MDM never received.": "رقم الطلبية الخاص بـ MDM. يكون فارغًا للطلبيات التي لم يستلمها MDM.",
  "The name the customer gave, as MDM or the store sent it.": "الاسم الذي أعطاه الزبون، كما أرسله MDM أو المتجر.",
  "The customer's main phone number, in full.": "رقم الهاتف الرئيسي للزبون، كاملًا.",
  "Another number the customer gave, if any.": "رقم آخر أعطاه الزبون، إن وُجد.",
  "The delivery address the customer gave.": "عنوان التوصيل الذي أعطاه الزبون.",
  "The commune the parcel goes to.": "البلدية التي يُرسَل إليها الطرد.",
  "The wilaya the parcel goes to.": "الولاية التي يُرسَل إليها الطرد.",
  "Home: delivered to the customer's door. Stop desk: the customer collects the parcel at the carrier's office.":
    "Home: التوصيل للمنزل حتى باب الزبون. Stop desk: الزبون يستلم الطرد من مكتب شركة التوصيل.",
  "The order's latest status in MDM's own words: its newest parcel's status, or MDM's order status when that is newer.":
    "آخر حالة للطلبية بكلمات MDM نفسها: حالة أحدث طرد لها، أو حالة الطلبية في MDM إذا كانت أحدث.",
  "Which group under Statuses the MDM status falls in, e.g. With the carrier.": "المجموعة التي تنتمي إليها حالة MDM ضمن «الحالات»، مثلًا «عند شركة التوصيل» (With the carrier).",
  "When the order got its latest status.": "متى أخذت الطلبية آخر حالة لها.",
  "When the customer placed the order.": "متى قدّم الزبون الطلبية.",
  "Product names with their pieces, e.g. Watch ×2. With one row per product, one name per row.":
    "أسماء المنتجات مع عدد قطعها، مثلًا ساعة ×2. مع «سطر لكل منتج»، اسم واحد في كل سطر.",
  "Yes when MDM marked the order as upsold by its call center.": "Yes إذا وضع MDM على الطلبية علامة بيع إضافي من مركز الاتصال.",
  "The product codes of the order's lines.": "رموز المنتجات في أسطر الطلبية.",
  "Pieces in the order, all products added up. With one row per product, the pieces on that row.":
    "عدد القطع في الطلبية، لكل المنتجات معًا. مع «سطر لكل منتج»، عدد القطع في ذلك السطر.",
  "Price of one piece. With one row per order, filled only when the order has a single product.":
    "سعر القطعة الواحدة. مع «سطر لكل طلبية»، لا يُملأ إلا إذا كان في الطلبية منتج واحد.",
  "What the customer pays the delivery person for the whole order, in the currency picked below.": "ما يدفعه الزبون لعامل التوصيل مقابل الطلبية كلها، بالعملة المختارة في الأسفل.",
  "What MDM charges to deliver the order's parcels, added up.": "ما يأخذه MDM لتوصيل طرود الطلبية، مجموعًا.",
  "What MDM charges for the order's parcels that came back, added up.": "ما يأخذه MDM على طرود الطلبية التي رجعت، مجموعًا.",
  "The carrier's tracking number of each parcel, separated by commas.": "رقم تتبع كل طرد عند شركة التوصيل، مفصولة بفواصل.",
  "The store name MDM shows for the order.": "اسم المتجر الذي يُظهره MDM للطلبية.",
  "Where the order came from: MDM Express, Shopify, EasySell, Manual or Other.": "من أين جاءت الطلبية: MDM Express أو Shopify أو EasySell أو Manual (يدوية) أو Other (أخرى).",
  "The Meta ad ID that brought the order, from its utm_content.": "معرّف إعلان Meta الذي جلب الطلبية، من utm_content الخاص بها.",
  "The name of that ad on the Creatives page.": "اسم هذا الإعلان في صفحة الإعلانات.",
  "The campaign name from the ad link (utm_campaign).": "اسم الحملة من رابط الإعلان (utm_campaign).",
  "Where the visit came from, e.g. facebook (utm_source).": "مصدر الزيارة، مثلًا facebook (utm_source).",
  "When the order's first parcel left with the carrier.": "متى خرج أول طرد للطلبية مع شركة التوصيل.",
  "When the order's first parcel was delivered.": "متى سُلِّم أول طرد للطلبية.",
  "When the order's first parcel came back.": "متى رجع أول طرد للطلبية.",

  // Imports: the four kinds
  "Orders from a store file, on top of the orders MDM sync brings in. An order MDM already synced is not added again; the file only fills in its missing ad ID.":
    "طلبيات من ملف المتجر، إضافةً إلى الطلبيات التي تجلبها مزامنة MDM. الطلبية التي زامنها MDM لا تُضاف مرة ثانية، والملف يكمل فقط معرّف إعلانها إن كان ناقصًا.",
  "In Ads Manager, export at Ad level with the Ad ID column. Orders find their ad by that ID, and days the Meta connection already synced are not counted twice.":
    "في Ads Manager، صدِّر على مستوى الإعلان (Ad) مع عمود Ad ID. الطلبيات تجد إعلانها بهذا المعرّف، والأيام التي زامنها ربط Meta لا تُحسب مرتين.",
  "Each row becomes an expense on the Expenses page and comes off the real profit of its day.": "كل سطر يصبح مصروفًا في صفحة المصاريف ويُخصم من الربح الحقيقي ليومه.",
  "Use it to catch spending you never entered. Each row waits in the Bank review queue below until you make it an expense or exclude it.":
    "استعمله لالتقاط مصاريف لم تُدخلها. كل سطر ينتظر في قائمة مراجعة البنك في الأسفل حتى تجعله مصروفًا أو تستبعده.",
  // Imports: the options of the mapping step
  "How the file writes dates. 03/04/2026 is 3 April in Day/Month/Year, but 4 March in Month/Day/Year.":
    "طريقة كتابة التواريخ في الملف. 03/04/2026 هو 3 أفريل بصيغة يوم/شهر/سنة، لكنه 4 مارس بصيغة شهر/يوم/سنة.",
  "Where the file comes from. The orders keep it as their source on the Orders page and in exports.": "من أين جاء الملف. تحتفظ الطلبيات به كمصدر لها في صفحة الطلبيات وفي ملفات التصدير.",
  "Spend is saved in the workspace currency. Worked out as: amount spent × this rate, e.g. 10 USD at 250 gives 2500. The file's amount is kept too.":
    "يُحفظ الإنفاق بعملة مساحة العمل. طريقة الحساب: المبلغ المُنفَق × هذا السعر، مثلًا 10 USD بسعر 250 تعطي 2500. ويُحفظ مبلغ الملف أيضًا.",
  "A creative is one Meta ad in this app. Creating them lets each new ad ID count its own spend and orders on the Creatives page.":
    "الإعلان (creative) في هذا التطبيق هو إعلان Meta واحد. إنشاؤها يجعل كل معرّف إعلان جديد يحسب مصاريفه وطلبياته في صفحة الإعلانات.",
  "The product these new ads sell, so their spend counts for it. When the file has a Campaign ID, the campaign's product on the Campaigns page is used instead.":
    "المنتج الذي تبيعه هذه الإعلانات الجديدة، لتُحسب مصاريفها عليه. إذا كان في الملف معرّف الحملة (Campaign ID)، يُستعمل بدلًا منه منتج الحملة في صفحة الحملات.",
  // Imports: what each column of an orders file is for
  "The order's number in your store, e.g. #1001. Rows with the same number become one order, and MDM parcels link to it by this reference.":
    "رقم الطلبية في متجرك، مثلًا ‎#1001. الأسطر التي لها نفس الرقم تصبح طلبية واحدة، وطرود MDM تُربط بها عبر هذا المرجع.",
  "Used to spot orders already imported from the same source, so importing the file again skips them.":
    "يُستعمل لمعرفة الطلبيات المستوردة سابقًا من نفس المصدر، فتُتخطّى عند استيراد الملف مرة أخرى.",
  "When the customer placed the order. Reports count the order on this day.": "متى قدّم الزبون الطلبية. التقارير تحسب الطلبية في هذا اليوم.",
  "The product code on each line. It finds the product in your catalog so its costs count; when no SKU matches, the product name is tried.":
    "رمز المنتج في كل سطر. به يُعثر على المنتج في قائمة منتجاتك فتُحسب تكاليفه، وإذا لم يطابق أي رمز يُجرَّب اسم المنتج.",
  "The product name on each line. Used to find the product when there is no SKU or the SKU matches nothing.":
    "اسم المنتج في كل سطر. يُستعمل للعثور على المنتج عندما لا يوجد رمز SKU أو لا يطابق أي منتج.",
  "Pieces of the product on that line. Empty means 1.": "عدد قطع المنتج في ذلك السطر. الفراغ يعني 1.",
  "Price of one piece on that line. Empty uses the product's sale price from your catalog.": "سعر القطعة الواحدة في ذلك السطر. إذا كان فارغًا يُستعمل سعر البيع المسجَّل للمنتج.",
  "What the customer pays the delivery person for the whole order. Example: 3900.": "ما يدفعه الزبون لعامل التوصيل مقابل الطلبية كلها. مثال: 3900.",
  "Currency code of the amounts, e.g. DZD. Empty means the workspace currency; an order in another currency gets an error.":
    "رمز عملة المبالغ، مثلًا DZD. الفراغ يعني عملة مساحة العمل، والطلبية بعملة أخرى تظهر كخطأ.",
  "The call center's result. Confirmed orders count in the confirmation rate; a word the app does not know imports as pending.":
    "نتيجة مركز الاتصال. الطلبيات المؤكَّدة تدخل في نسبة التأكيد، والكلمة التي لا يعرفها التطبيق تُستورد كـ «قيد الانتظار».",
  "Your store's ID or email for the customer. Optional: you can leave it as Not in file.": "معرّف الزبون أو بريده الإلكتروني في متجرك. اختياري: يمكنك تركه على «غير موجود في الملف».",
  "The customer's phone number. You can then find the order by phone in the Orders search.": "رقم هاتف الزبون. بعدها يمكنك إيجاد الطلبية برقم الهاتف في بحث الطلبيات.",
  "The customer's wilaya. The dashboard uses wilayas to show where parcels come back from.": "ولاية الزبون. لوحة القيادة تستعمل الولايات لتبيّن من أين ترجع الطرود.",
  "Where the visit came from, e.g. facebook. Kept on the order for your records.": "مصدر الزيارة، مثلًا facebook. يُحفظ في الطلبية للرجوع إليه.",
  "The kind of traffic, e.g. paid. Kept on the order for your records.": "نوع الزيارات، مثلًا paid. يُحفظ في الطلبية للرجوع إليه.",
  "The campaign name from the ad link. Kept on the order and in exports.": "اسم الحملة من رابط الإعلان. يُحفظ في الطلبية ويظهر في ملفات التصدير.",
  "The Meta ad ID from the ad link. It links each order to its ad, so the ad's spend and orders can be compared.":
    "معرّف إعلان Meta من رابط الإعلان. يربط كل طلبية بإعلانها، فتمكن مقارنة مصاريف الإعلان بطلبياته.",
  "The page the customer ordered from, with its full link.": "الصفحة التي طلب منها الزبون، برابطها الكامل.",
  "The store's tags on the order, shown when you open it.": "وسوم المتجر على الطلبية، وتظهر عند فتحها.",
  "The store's notes or extra order details, shown when you open the order.": "ملاحظات المتجر أو تفاصيل إضافية عن الطلبية، وتظهر عند فتحها.",
  "How many times the call center called. Used for call-center cost when Settings > Economics & currencies counts it per call attempt.":
    "عدد مرات اتصال مركز الاتصال. يُستعمل في تكلفة مركز الاتصال عندما تحسبها الإعدادات > التكاليف والعملات لكل محاولة اتصال.",
  // Imports: what each column of an ad spend file is for
  "The day of the spend. Export broken down by Day, so each row is one ad on one day.": "يوم الإنفاق. صدِّر مقسَّمًا حسب اليوم (Day)، ليكون كل سطر إعلانًا واحدًا في يوم واحد.",
  "The Meta campaign name. New creatives take it, so the Creatives page shows each ad's campaign.": "اسم حملة Meta. الإعلانات الجديدة تأخذه، فتُظهر صفحة الإعلانات حملة كل إعلان.",
  "The Meta campaign ID. New creatives keep it, which links their orders to the campaign.": "معرّف حملة Meta. الإعلانات الجديدة تحتفظ به، فتُربط طلبياتها بالحملة.",
  "The Meta ad set name, kept with the spend.": "اسم المجموعة الإعلانية في Meta، ويُحفظ مع الإنفاق.",
  "The Meta ad set ID. It tells rows apart when two ad sets have the same name.": "معرّف المجموعة الإعلانية في Meta. يميّز بين الأسطر عندما تحمل مجموعتان نفس الاسم.",
  "The Meta ad name. It becomes the name of a new creative, and stands in for the creative ID when there is no ID at all.":
    "اسم إعلان Meta. يصبح اسم الإعلان الجديد، ويحلّ محلّ معرّف الإعلان عندما لا يوجد أي معرّف.",
  "The Meta ad ID. Days the Meta connection also synced are matched by this ID and not counted twice.": "معرّف إعلان Meta. الأيام التي زامنها ربط Meta أيضًا تُطابَق بهذا المعرّف ولا تُحسب مرتين.",
  "The ID that ties spend to orders. Usually the Ad ID column, since orders carry the ad ID in utm_content.":
    "المعرّف الذي يربط الإنفاق بالطلبيات. عادةً هو عمود Ad ID، لأن الطلبيات تحمل معرّف الإعلان في utm_content.",
  "What the ad cost that day. When the column name shows a currency, e.g. (USD), the exchange rate below converts it.":
    "تكلفة الإعلان في ذلك اليوم. إذا ظهرت عملة في اسم العمود، مثلًا (USD)، يحوّلها سعر الصرف في الأسفل.",
  "Currency code of the spend, e.g. USD. Empty uses the currency in the Amount spent column name, else the workspace currency.":
    "رمز عملة الإنفاق، مثلًا USD. إذا كان فارغًا تُستعمل العملة المكتوبة في اسم عمود المبلغ المُنفَق، وإلا فعملة مساحة العمل.",
  "Times the ad was shown. Rows with no spend and no impressions are skipped.": "عدد مرات ظهور الإعلان. الأسطر التي بدون إنفاق وبدون ظهور تُتخطّى.",
  "Link clicks on the ad that day, kept with the spend.": "نقرات الرابط على الإعلان في ذلك اليوم، وتُحفظ مع الإنفاق.",
  // Imports: what each column of an expenses file is for
  "The day the expense was paid. It comes off the real profit of that day.": "يوم دفع المصروف. يُخصم من الربح الحقيقي لذلك اليوم.",
  "The kind of cost, e.g. Software or Packaging. A word the app does not know imports as Other.": "نوع التكلفة، مثلًا Software أو Packaging. الكلمة التي لا يعرفها التطبيق تُستورد كـ «أخرى».",
  "What it cost, e.g. 3000. Amounts in another currency are converted with the rate in Settings > Economics & currencies.":
    "كم كلّف، مثلًا 3000. المبالغ بعملة أخرى تُحوَّل بسعر الصرف في الإعدادات > التكاليف والعملات.",
  "Currency code, e.g. EUR. Empty means the workspace currency.": "رمز العملة، مثلًا EUR. الفراغ يعني عملة مساحة العمل.",
  "What the expense was, e.g. Shopify plan. Shown on the Expenses page.": "ما هو المصروف، مثلًا اشتراك Shopify. يظهر في صفحة المصاريف.",
  "The SKU of the product this cost belongs to. It then counts only against that product's profit.": "رمز SKU للمنتج الذي تخصّه هذه التكلفة. عندها تُخصم من ربح هذا المنتج وحده.",
  "Fixed: the same each month. Variable: grows with orders. Empty means fixed. It is a label for your lists; profit counts both.":
    "ثابت (fixed): نفس المبلغ كل شهر. متغيّر (variable): يزيد مع الطلبيات. الفراغ يعني ثابت. هو تصنيف لقوائمك فقط، والربح يحسب النوعين.",
  // Imports: what each column of a bank file is for
  "The day of the bank operation.": "يوم العملية البنكية.",
  "The bank's label for the row. It is used to guess the category when you review it.": "وصف البنك للسطر. يُستعمل لتخمين الفئة عند مراجعته.",
  "One column where money in is positive and money out is negative.": "عمود واحد يكون فيه المال الداخل موجبًا والمال الخارج سالبًا.",
  "Money that left the account. Only money going out can become an expense.": "المال الذي خرج من الحساب. المال الخارج وحده يمكن أن يصبح مصروفًا.",
  "Money that came in, such as MDM payouts. You exclude these rows when you review them.": "المال الذي دخل الحساب، مثل تحويلات MDM. هذه الأسطر تستبعدها عند المراجعة.",
  "Currency code. A row in another currency than the workspace's gets an error.": "رمز العملة. السطر بعملة غير عملة مساحة العمل يظهر كخطأ.",
  "The bank's ID for the operation. It tells two equal rows apart when you import again.": "معرّف البنك للعملية. يميّز بين سطرين متشابهين عند الاستيراد من جديد.",
  // Imports: the preview counts and columns
  "Data rows read from the file, not counting the header row.": "أسطر البيانات المقروءة من الملف، دون احتساب سطر العناوين.",
  "New, valid records that will be added. An order spread over several lines counts once.": "سجلات جديدة وصالحة ستُضاف. الطلبية الموزّعة على عدة أسطر تُحسب مرة واحدة.",
  "Spend rows imported before whose amount changed in this export. The new amount replaces the old one.":
    "أسطر إنفاق استُوردت من قبل وتغيّر مبلغها في هذا الملف. المبلغ الجديد يحلّ محلّ القديم.",
  "Valid rows already here from an earlier import, so they are skipped. For orders, this includes orders MDM sync brought in.":
    "أسطر صالحة موجودة من استيراد سابق، لذلك تُتخطّى. في الطلبيات يشمل هذا الطلبيات التي جلبتها مزامنة MDM.",
  "File lines with a problem. They are skipped; the Row errors table below says why.": "أسطر في الملف فيها مشكلة. تُتخطّى، وجدول «أخطاء الأسطر» في الأسفل يبيّن السبب.",
  "Rows that will still import but need a look, such as an unknown product or status.": "أسطر ستُستورد رغم ذلك لكنها تحتاج إلى نظرة، مثل منتج أو حالة غير معروفة.",
  "What the customer pays on delivery: the order total column, or quantity × unit price when the file has none.":
    "ما يدفعه الزبون عند الاستلام: عمود مجموع الطلبية، أو الكمية × سعر القطعة إذا لم يكن في الملف.",
  "In the workspace currency. When the export is in another currency, worked out as: amount spent × exchange rate; the file's amount shows below.":
    "بعملة مساحة العمل. إذا كان الملف بعملة أخرى، طريقة الحساب: المبلغ المُنفَق × سعر الصرف، ومبلغ الملف يظهر تحته.",
  "In the workspace currency. A row in another currency is converted with the rate in Settings > Economics & currencies; the file's amount shows below.":
    "بعملة مساحة العمل. السطر بعملة أخرى يُحوَّل بسعر الصرف في الإعدادات > التكاليف والعملات، ومبلغ الملف يظهر تحته.",
  "Money in is positive, money out negative. With debit and credit columns, worked out as: credit − debit.":
    "المال الداخل موجب والمال الخارج سالب. مع عمودي المدين والدائن، طريقة الحساب: الدائن − المدين.",
  // Imports: history
  "Only files of this tab's kind are listed. View details shows a file's row errors; Delete import removes everything that file added, so you can import a corrected one.":
    "تظهر هنا ملفات هذا التبويب فقط. «عرض التفاصيل» يُظهر أخطاء أسطر الملف، و«حذف الاستيراد» يحذف كل ما أضافه الملف لتستورد ملفًا مصحَّحًا.",
  "Data rows in the file, not counting the header row.": "أسطر البيانات في الملف، دون احتساب سطر العناوين.",
  "New records this file added: orders, spend rows, expenses or bank rows. An order spread over several lines counts once.":
    "السجلات الجديدة التي أضافها هذا الملف: طلبيات أو أسطر إنفاق أو مصاريف أو أسطر بنكية. الطلبية الموزّعة على عدة أسطر تُحسب مرة واحدة.",
  "Ad spend: rows whose amount changed since an earlier import. Orders: orders MDM had already synced that got their ad ID from this file.":
    "مصاريف الإعلانات: أسطر تغيّر مبلغها منذ استيراد سابق. الطلبيات: طلبيات زامنها MDM من قبل وأخذت معرّف إعلانها من هذا الملف.",
  "Rows already here from an earlier import, or orders MDM sync brought in, so they were skipped.": "أسطر موجودة من استيراد سابق، أو طلبيات جلبتها مزامنة MDM، لذلك تُخطّيت.",
  "Rows that could not be read and were skipped. Fix them in your file and import it again.": "أسطر تعذّرت قراءتها فتُخطّيت. صحّحها في ملفك واستورده من جديد.",
  // Imports: bank review
  "Categorize makes a row an expense on the Expenses page. Exclude keeps it out of profit. Both can be undone from the Categorized and Excluded tabs.":
    "«تصنيف» يجعل السطر مصروفًا في صفحة المصاريف. «استبعاد» يُبقيه خارج حساب الربح. يمكن التراجع عن الاثنين من تبويبي «مصنَّفة» و«مستبعَدة».",
  "The kind of cost, used to group your expenses, e.g. Software. It is guessed from the bank label; change it when the guess is wrong.":
    "نوع التكلفة، ويُستعمل لتجميع مصاريفك، مثلًا البرمجيات. يُخمَّن من وصف البنك، فغيّره إذا كان التخمين خاطئًا.",
  "Fixed: the same each month, like rent. Variable: grows with orders, like packaging. It is a label for your lists; profit counts both.":
    "ثابت: نفس المبلغ كل شهر، مثل الإيجار. متغيّر: يزيد مع الطلبيات، مثل التغليف. هو تصنيف لقوائمك فقط، والربح يحسب النوعين.",
  "Global: shared across products by Overhead allocation in Settings > Economics & currencies. Specific product: counts only against that product's profit.":
    "عام: يُوزَّع على المنتجات حسب «توزيع المصاريف العامة» في الإعدادات > التكاليف والعملات. منتج محدد: يُخصم من ربح ذلك المنتج فقط.",
  "The product this cost belongs to. It comes off that product's profit only.": "المنتج الذي تخصّه هذه التكلفة. تُخصم من ربح هذا المنتج وحده.",
  "How the expense is named on the Expenses page. It starts as the bank label.": "اسم المصروف كما يظهر في صفحة المصاريف. يبدأ بوصف البنك.",
  // Imports: unmatched spend
  "Match each ID so its spend counts for the right ad and product. The total is worked out as: the sum of the Spend column.":
    "طابِق كل معرّف لتُحسب مصاريفه على الإعلان والمنتج الصحيحين. طريقة حساب المجموع: مجموع عمود «المصاريف».",
  "Worked out as: the sum of this ID's spend rows between the dates shown.": "طريقة الحساب: مجموع أسطر الإنفاق لهذا المعرّف بين التاريخين المعروضين.",
  "Create: this ID becomes a new creative (one Meta ad), and orders carrying this ID in utm_content link to it. Link: its spend joins a creative you already have.":
    "الإنشاء: يصبح هذا المعرّف إعلانًا جديدًا (إعلان Meta واحد)، وتُربط به الطلبيات التي تحمل هذا المعرّف في utm_content. الربط: تنضم مصاريفه إلى إعلان موجود عندك.",
  "A name you will recognise for this ad on the Creatives page. It starts as the ad name from the export.": "اسم تعرف به هذا الإعلان في صفحة الإعلانات. يبدأ باسم الإعلان من الملف.",
  "The product this ad sells, so its spend counts in that product's profit. Assign later leaves it without a product.":
    "المنتج الذي يبيعه هذا الإعلان، لتُحسب مصاريفه في ربح هذا المنتج. «التحديد لاحقًا» يتركه بدون منتج.",
  "The creative this spend belongs to. Every unmatched row with this ID moves to it, and counts for that ad from then on.":
    "الإعلان الذي يخصّه هذا الإنفاق. كل سطر غير مطابق بهذا المعرّف ينتقل إليه، ويُحسب لهذا الإعلان من الآن فصاعدًا.",
};

export default ar;
