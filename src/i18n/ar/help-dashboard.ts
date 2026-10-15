import type { Dict } from "../core";

/** Arabic for the ⓘ explanations (help texts) of fields, cards and numbers in this part of the app. */
const ar: Dict = {
  // Dashboard: cards and number tiles
  "The ad with the highest true net profit in this period, when one made a profit. An order counts for the ad whose ID is in its utm_content.":
    "الإعلان صاحب أعلى صافي ربح حقيقي في هذه الفترة، إن وُجد إعلان رابح. تُحتسب الطلبية للإعلان الذي يوجد معرّفه في utm_content الخاص بها.",
  "Advice worked out from this period's numbers: your POAS against your target, wilayas with 10 or more shipped parcels where 3 in 10 come back, and cash not paid out yet.":
    "نصائح مبنية على أرقام هذه الفترة: POAS عندك مقارنةً بهدفك، والولايات التي فيها 10 طرود مُرسَلة أو أكثر ويعود منها 3 من كل 10، والمال الذي لم يُحوَّل إليك بعد.",
  "Orders placed and parcels delivered per day, week or month, by order date. The red bar has the most deliveries. Hover or tap a bar for its numbers.":
    "الطلبيات الواردة والطرود المسلَّمة في كل يوم أو أسبوع أو شهر، حسب تاريخ الطلبية. العمود الأحمر هو الذي فيه أكثر طرود مسلَّمة. مرِّر المؤشر على عمود أو المسه لترى أرقامه.",
  "What happened to the parcels of the orders placed in this period. The strip splits shipped parcels into delivered, returned, still on the road, and lost or exchanged.":
    "ما حدث لطرود الطلبيات الواردة في هذه الفترة. يقسم الشريط الطرود المُرسَلة إلى مُسلَّمة، ومرتجَعة، وما زالت في الطريق، وضائعة أو مستبدَلة.",
  "Every order placed in this period, confirmed or not. Shipped counts parcels handed to the carrier; one order can have several parcels.":
    "كل طلبية واردة في هذه الفترة، مؤكَّدة أو لا. «مُرسَلة» تعدّ الطرود التي سُلِّمت لشركة التوصيل؛ وقد تكون للطلبية الواحدة عدة طرود.",
  "Orders your call center confirmed by phone, out of every order placed in this period. Orders still waiting for a call count as not confirmed.":
    "الطلبيات التي أكَّدها مركز الاتصال بالهاتف، من بين كل الطلبيات الواردة في هذه الفترة. الطلبيات التي ما زالت تنتظر الاتصال تُحتسب غير مؤكَّدة.",
  "How many confirmed orders really left with the carrier. Worked out as: shipped parcels ÷ confirmed orders.":
    "كم من الطلبيات المؤكَّدة خرجت فعلًا مع شركة التوصيل. طريقة الحساب: الطرود المُرسَلة ÷ الطلبيات المؤكَّدة.",
  "Parcels the customer received and paid for, out of the shipped parcels whose delivery is finished. Parcels still on the road are not counted yet.":
    "الطرود التي استلمها الزبون ودفع ثمنها، من بين الطرود المُرسَلة التي انتهى توصيلها. الطرود التي ما زالت في الطريق لا تُحتسب بعد.",
  "Return rate": "نسبة الإرجاع",
  "Your 5 ads with the most true net profit in this period, best first. Only ads with at least one order show.":
    "أفضل 5 إعلانات لديك من حيث صافي الربح الحقيقي في هذه الفترة، الأفضل أولًا. تظهر فقط الإعلانات التي لها طلبية واحدة على الأقل.",
  "The cash of the orders placed in this period. Row 1 is already paid out to you, rows 2 and 3 should still reach you, and row 4 is money lost on returns.":
    "مال الطلبيات الواردة في هذه الفترة. السطر 1 حُوِّل إليك فعلًا، والسطران 2 و3 يُنتظر أن يصلاك، والسطر 4 مال ضاع بسبب الإرجاع.",

  // Dashboard: more details
  "The amounts that add up to true net profit in this period. Revenue counts delivered parcels, or only cash already paid out to you, as picked in More filters.":
    "المبالغ التي يتكوّن منها صافي الربح الحقيقي في هذه الفترة. تحتسب المداخيل الطرود المسلَّمة، أو فقط المال الذي حُوِّل إليك، حسب اختيارك في «خيارات تصفية أكثر».",
  "Forward shipping fee on each shipped parcel once its delivery is finished: the carrier's real fee when known, else the product's cost version.":
    "رسوم التوصيل على كل طرد مُرسَل بعد انتهاء توصيله: رسوم شركة التوصيل الفعلية إن كانت معروفة، وإلا فرسوم إصدار تكلفة المنتج.",
  "Packaging fee on each shipped parcel once its delivery is finished (delivered, returned, lost or exchanged).":
    "رسوم التغليف على كل طرد مُرسَل بعد انتهاء توصيله (مُسلَّم، أو مرتجَع، أو ضائع، أو مستبدَل).",
  "Your 5 ads with the highest return rate in this period, among ads with finished parcels. Small n means too few parcels to trust the rate yet.":
    "الإعلانات الـ5 ذات أعلى نسبة إرجاع في هذه الفترة، من بين الإعلانات التي لها طرود انتهى توصيلها. «عيّنة صغيرة» تعني أن الطرود قليلة جدًا للوثوق بالنسبة بعد.",
  "These counts cover all dates, not only this period. Open a row to fix it: the fewer problems, the more you can trust the numbers.":
    "هذه الأعداد تشمل كل التواريخ، لا هذه الفترة فقط. افتح السطر لإصلاحه: كلما قلّت المشاكل، زادت ثقتك في الأرقام.",
  "Whether the app can read your orders from MDM, and when the last sync worked. Set it up in Settings > MDM Express.":
    "هل يستطيع التطبيق قراءة طلبياتك من MDM، ومتى نجحت آخر مزامنة. اضبطه في الإعدادات > MDM Express.",
  "Parcels MDM sent that the sync could not match to one of your orders. They count in no order until you link them on the MDM sync page.":
    "طرود أرسلها MDM ولم تستطع المزامنة ربطها بإحدى طلبياتك. لا تُحتسب في أي طلبية حتى تربطها في صفحة مزامنة MDM.",
  "Parcels whose MDM status the app doesn't know. They count as neither delivered nor returned until you map the status in Settings > MDM Express.":
    "طرود لا يعرف التطبيق حالتها في MDM. لا تُحتسب مُسلَّمة ولا مرتجَعة حتى تربط الحالة في الإعدادات > MDM Express.",
  "Rows an import could not read, plus items a sync could not save. Those orders or costs may be missing from the numbers.":
    "أسطر لم يستطع الاستيراد قراءتها، وعناصر لم تستطع المزامنة حفظها. قد تكون تلك الطلبيات أو التكاليف ناقصة من الأرقام.",
  "Ad spend rows whose ad ID matches no ad you know. The spend still counts in your totals, but in no ad's profit.":
    "أسطر مصاريف إعلانات لا يطابق معرّف إعلانها أي إعلان معروف. تُحتسب المصاريف في مجاميعك، لكنها لا تدخل في ربح أي إعلان.",
  "Every wilaya of the orders placed in this period, most orders first. Look for wilayas that send many parcels back, and confirm their orders twice.":
    "كل ولايات الطلبيات الواردة في هذه الفترة، الأكثر طلبيات أولًا. ابحث عن الولايات التي تُرجِع طرودًا كثيرة، وأكِّد طلبياتها مرتين.",
  "What this wilaya's orders leave after their own costs, before ads and overhead. Revenue follows the revenue basis picked in More filters.":
    "ما يتبقى من طلبيات هذه الولاية بعد تكاليفها الخاصة، قبل الإعلانات والمصاريف العامة. تتبع المداخيل أساس المداخيل المختار في «خيارات تصفية أكثر».",

  // Campaigns
  "The product this ad account sells. Its campaigns' spend then counts for that product, new campaigns too, so the product's profit and POAS include them.":
    "المنتج الذي يبيعه هذا الحساب الإعلاني. تُحتسب عندها مصاريف حملاته لهذا المنتج، حتى الحملات الجديدة، فتدخل في ربح المنتج وفي POAS الخاص به.",
  "Orders placed in this period from the ads of these campaigns, running or not. With all ad accounts, orders not linked to a campaign count too.":
    "الطلبيات الواردة في هذه الفترة من إعلانات هذه الحملات، سواء كانت تعمل أم لا. عند اختيار كل الحسابات الإعلانية، تُحتسب أيضًا الطلبيات غير المربوطة بحملة.",
  "Under each campaign: what it spent, its orders and its true net profit in this period, its verdict, and the product its spend counts for.":
    "تحت كل حملة: ما صرفته، وطلبياتها، وصافي ربحها الحقيقي في هذه الفترة، والحكم عليها، والمنتج الذي تُحتسب له مصاريفها.",

  // Creatives
  "Orders with no ad ID (utm_content), or one that matches no ad yet, so no ad can claim them. They still count in your totals.":
    "طلبيات بدون معرّف إعلان (utm_content)، أو بمعرّف لا يطابق أي إعلان بعد، فلا تُنسب إلى أي إعلان. لكنها تُحتسب في مجاميعك.",
  "Ad spend whose ad ID matches no ad you know, so no ad's profit includes it. It still counts in your totals; match it on the Imports page.":
    "مصاريف إعلانات لا يطابق معرّف إعلانها أي إعلان معروف، فلا تدخل في ربح أي إعلان. لكنها تُحتسب في مجاميعك؛ طابِقها في صفحة الاستيراد.",
  "Hides ads with fewer orders placed in this period than this number, here and in the CSV export. Example: 5 hides ads with 0 to 4 orders.":
    "يُخفي الإعلانات التي لها طلبيات واردة في هذه الفترة أقل من هذا العدد، هنا وفي تصدير CSV. مثال: 5 يُخفي الإعلانات التي لها من 0 إلى 4 طلبيات.",

  // Products: product form
  "The name you know this product by. It shows on every page, and a new MDM product with the same name is linked to it.":
    "الاسم الذي تعرف به هذا المنتج. يظهر في كل الصفحات، وأي منتج جديد من MDM بنفس الاسم يُربط به.",
  "A short code for the product: letters, digits, dot, dash or underscore. Imports and MDM match order lines to the product by this code. Example: NECK-01.":
    "رمز قصير للمنتج: حروف لاتينية، أو أرقام، أو نقطة، أو شرطة، أو شرطة سفلية. يربط الاستيراد وMDM أسطر الطلبيات بالمنتج عبر هذا الرمز. مثال: NECK-01.",
  "Untick it when you stop selling the product. It leaves the new order, simulator and import lists, but its past orders still count.":
    "أزِل التحديد عندما تتوقف عن بيع المنتج. يختفي من قوائم الطلبية الجديدة والمحاكي والاستيراد، لكن طلبياته السابقة تبقى محتسبة.",
  "Pick Buy 1, get 1 free when one order sends 2 pieces. When MDM lists fewer pieces than the offer, the offer's count is used.":
    "اختر «اشترِ 1 واحصل على 1 مجانًا» عندما ترسل الطلبية الواحدة قطعتين. إذا ذكر MDM قطعًا أقل من العرض، يُستعمل عدد قطع العرض.",
  "A campaign counts for one product only, and its own link wins over its ad account's. Ticking one here moves it from any other product.":
    "تُحتسب الحملة لمنتج واحد فقط، وربطها الخاص يتقدّم على ربط حسابها الإعلاني. تحديدها هنا ينقلها من أي منتج آخر.",

  // Products: costs
  "Used as the price of an order line that comes without one, and by the Profit tracker and Breakeven CPA. Profit counts the cash of delivered parcels. Example: 2900.":
    "يُستعمل سعرًا لسطر الطلبية الذي يأتي بدون سعر، وفي متتبّع الربح وCPA نقطة التعادل. أما الربح فيحتسب مال الطرود المسلَّمة. مثال: 2900.",
  "What one piece costs you from the supplier. It counts for each delivered piece, free offer pieces included; returned pieces go back to stock. Example: 800.":
    "ما تكلّفك القطعة الواحدة عند المورِّد. تُحتسب لكل قطعة مُسلَّمة، بما فيها القطع المجانية في العرض؛ والقطع المرتجَعة تعود إلى المخزون. مثال: 800.",
  "What the carrier charges to deliver one parcel. Profit uses it when a parcel has no real fee from the carrier. Example: 600.":
    "ما تأخذه شركة التوصيل لتوصيل طرد واحد. يستعمله حساب الربح عندما لا تكون للطرد رسوم فعلية من شركة التوصيل. مثال: 600.",
  "What the carrier charges when a parcel comes back to you, on top of the shipping fee. Profit uses it when a parcel has no real return fee. Example: 200.":
    "ما تأخذه شركة التوصيل عندما يعود إليك طرد، زيادةً على رسوم التوصيل. يستعمله حساب الربح عندما لا تكون للطرد رسوم إرجاع فعلية. مثال: 200.",
  "What your call center charges. It counts per lead, per confirmed order or per call attempt, as set in Settings > Economics & currencies. Example: 100.":
    "ما يأخذه مركز الاتصال. يُحتسب لكل طلبية واردة، أو لكل طلبية مؤكَّدة، أو لكل محاولة اتصال، حسب ما ضبطته في الإعدادات > التكاليف والعملات. مثال: 100.",
  "Box, bag and label for one parcel. It counts on each shipped parcel once its delivery is finished. Example: 50.":
    "العلبة والكيس والملصق لطرد واحد. تُحتسب على كل طرد مُرسَل بعد انتهاء توصيله. مثال: 50.",
  "The first order date these costs apply to. It must be later than the start of the current version. Example: the day the supplier's new price starts.":
    "أول تاريخ طلبية تنطبق عليه هذه التكاليف. يجب أن يكون بعد بداية الإصدار الحالي. مثال: اليوم الذي يبدأ فيه سعر المورِّد الجديد.",
  "A reminder for you of why the costs changed. It shows only in the history below.": "تذكير لك بسبب تغيُّر التكاليف. يظهر فقط في السجل أدناه.",
  "Every cost version of this product, newest first. Each order uses the version in effect on the day it was placed.":
    "كل إصدارات التكلفة لهذا المنتج، الأحدث أولًا. كل طلبية تستعمل الإصدار الساري يوم ورودها.",

  // Products: list, tags and products from MDM
  "The MDM sync made this product when MDM first sent it with your orders. Check its name and costs.":
    "أنشأت مزامنة MDM هذا المنتج عندما أرسله MDM أول مرة مع طلبياتك. راجِع اسمه وتكاليفه.",
  "It has no costs yet, so its orders count a product cost of 0 and the default fees in Settings > Economics & currencies. Add costs to see its real profit.":
    "ليست له تكاليف بعد، لذلك تُحتسب طلبياته بتكلفة منتج 0 وبالرسوم الافتراضية في الإعدادات > التكاليف والعملات. أضف التكاليف لترى ربحه الحقيقي.",
  "Forward shipping fee per shipped parcel, from the current cost version. A parcel's real carrier fee wins when known.":
    "رسوم التوصيل لكل طرد مُرسَل، من إصدار التكلفة الحالي. رسوم شركة التوصيل الفعلية للطرد تتقدّم عليها إن كانت معروفة.",
  "Call-center fee from the current cost version, counted per lead, confirmed order or call attempt as set in Settings > Economics & currencies.":
    "رسوم مركز الاتصال من إصدار التكلفة الحالي، تُحتسب لكل طلبية واردة أو طلبية مؤكَّدة أو محاولة اتصال حسب ما ضبطته في الإعدادات > التكاليف والعملات.",
  "Packaging fee per shipped parcel, from the current cost version.": "رسوم التغليف لكل طرد مُرسَل، من إصدار التكلفة الحالي.",
  "The day the current costs started, and how many cost versions the product has (v2 = 2 versions).":
    "اليوم الذي بدأت فيه التكاليف الحالية، وعدد إصدارات التكلفة للمنتج (v2 = إصداران).",
  "Linked by MDM's product ID, so renaming a product in MDM keeps it linked. A product the sync made that is left empty after a move is removed.":
    "الربط يتم عبر معرّف المنتج في MDM، فتغيير اسم المنتج في MDM لا يفك الربط. والمنتج الذي أنشأته المزامنة ويبقى فارغًا بعد النقل يُحذف.",
  "Pieces MDM listed on your order lines with this product, over all dates. Free offer pieces that MDM doesn't list are not included.":
    "القطع التي ذكرها MDM في أسطر طلبياتك لهذا المنتج، في كل التواريخ. لا تشمل القطع المجانية في العرض التي لا يذكرها MDM.",
  "The product whose costs and profit this MDM product's orders count for. Changing it moves its past order lines too.":
    "المنتج الذي تُحتسب له طلبيات منتج MDM هذا في التكاليف والربح. تغييره ينقل أسطر طلبياته السابقة أيضًا.",

  // Products: ads for this product
  "Tick an account to count every campaign in it for this product, new ones too. Ticking one marked with another product moves it here.":
    "حدِّد حسابًا لتُحتسب كل حملاته لهذا المنتج، حتى الحملات الجديدة. تحديد حساب معلَّم بمنتج آخر ينقله إلى هذا المنتج.",
  "Tick the campaigns that sell this product. Their spend and ads count for it, even when their ad account counts for another product.":
    "حدِّد الحملات التي تبيع هذا المنتج. تُحتسب مصاريفها وإعلاناتها له، حتى لو كان حسابها الإعلاني يُحتسب لمنتج آخر.",
};

export default ar;
