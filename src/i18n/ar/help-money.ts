import type { Dict } from "../core";

/** Arabic for the ⓘ explanations (help texts) of fields, cards and numbers in this part of the app. */
const ar: Dict = {
  // Expenses: new or edited expense
  "Once counts on its date only. A repeating one counts a share every day from its first day to its last day, never past today. Example: rent every month.":
    "«مرة واحدة» يُحتسب في تاريخه فقط. المصروف المتكرر تُحتسب حصة منه كل يوم من أول يوم إلى آخر يوم، ولا يتجاوز اليوم أبدًا. مثال: الكراء كل شهر.",
  "Who gets this pay, so each person has a line of their own. Add one repeating expense per employee.":
    "من يتقاضى هذا الأجر، ليكون لكل شخص سطره الخاص. أضف مصروفًا متكررًا لكل عامل.",
  "A short name to find it in Repeating expenses and in the search. Example: Shop rent.": "اسم قصير لتجده في «المصاريف المتكررة» وفي البحث. مثال: كراء المحل.",
  "The first day it counts. A past day adds what it cost since then, for example the day you started paying rent.":
    "أول يوم يُحتسب فيه. إذا اخترت يومًا ماضيًا يُضاف ما كلّفه منذ ذلك اليوم، مثلًا اليوم الذي بدأت فيه دفع الكراء.",
  "The day you paid it. It counts in the profit of any days that include this date.": "اليوم الذي دفعته فيه. يُحتسب في ربح أي فترة تشمل هذا التاريخ.",
  "The last day it counts, that day included. Example: the last day of a rental contract.": "آخر يوم يُحتسب فيه، وهذا اليوم داخل في الحساب. مثال: آخر يوم في عقد الكراء.",
  "What you pay each time. It is spread over the days: a monthly amount ÷ the days of that month, a weekly one ÷ 7, a yearly one ÷ the days of the year.":
    "ما تدفعه في كل مرة. يُوزَّع على الأيام: المبلغ الشهري ÷ أيام ذلك الشهر، والأسبوعي ÷ 7، والسنوي ÷ أيام السنة.",
  "What you paid. Paid in another currency? Pick it beside the amount and check the exchange rate: profit uses the converted amount. Example: 15000.":
    "المبلغ الذي دفعته. دفعته بعملة أخرى؟ اخترها بجانب المبلغ وتحقّق من سعر الصرف: الربح يستعمل المبلغ بعد التحويل. مثال: 15000.",
  "Groups your costs in the By category totals and the export. Pick ＋ New category… to make your own, such as Influencers.":
    "تجمع تكاليفك في مجاميع «حسب الفئة» وفي التصدير. اختر «＋ فئة جديدة…» لتنشئ فئتك الخاصة، مثل المؤثرين.",
  "A label to sort and filter your expenses. Profit counts fixed and variable expenses the same way.": "تصنيف لترتيب مصاريفك وتصفيتها. الربح يحتسب المصاريف الثابتة والمتغيّرة بالطريقة نفسها.",
  "Your own category, for costs the built-in list doesn't cover. Press Add and it shows in every category list. Example: Fuel.":
    "فئتك الخاصة، للتكاليف التي لا تغطيها القائمة الأساسية. اضغط «إضافة» فتظهر في كل قوائم الفئات. مثال: وقود.",
  "The whole business: shared across your products by the Overhead allocation rule in Settings > Economics & currencies. One product: counted only in that product's profit.":
    "النشاط كله: يُوزَّع على منتجاتك حسب قاعدة «توزيع المصاريف العامة» في الإعدادات > التكاليف والعملات. منتج واحد: يُحتسب في ربح هذا المنتج فقط.",
  "The product this cost belongs to, for example a photo shoot for it. Products you stopped selling are in the list too.":
    "المنتج الذي تخصّه هذه التكلفة، مثلًا جلسة تصوير له. المنتجات التي توقفت عن بيعها موجودة في القائمة أيضًا.",
  "A note to recognise it later, such as the supplier or the invoice number. The search box finds expenses by these words.":
    "ملاحظة لتتعرّف عليه لاحقًا، مثل اسم المورّد أو رقم الفاتورة. خانة البحث تجد المصاريف بهذه الكلمات.",

  // Expenses: totals, cards and columns
  "Everything the business spent in these days, with your filters. Worked out as: one-off expenses dated in these days + each repeating expense's share of them, up to today.":
    "كل ما صرفه النشاط في هذه الأيام، مع التصفية التي اخترتها. طريقة الحساب: المصاريف لمرة واحدة المؤرَّخة في هذه الأيام + حصة كل مصروف متكرر منها، حتى اليوم.",
  "Each row's big number is its share of the days you picked, counted day by day up to today. ≈ /month is its cost in an average month.":
    "الرقم الكبير في كل سطر هو حصته من الأيام التي اخترتها، محسوبة يومًا بيوم حتى اليوم. و«≈ في الشهر» هو ما يكلّفه في شهر متوسط.",
  "Expenses entered once, newest first, each counted on its own date. An amount paid in another currency shows the original under the converted one.":
    "المصاريف المسجَّلة لمرة واحدة، الأحدث أولًا، وكل منها يُحتسب في تاريخه. المبلغ المدفوع بعملة أخرى يُظهر المبلغ الأصلي تحت المبلغ المحوَّل.",
  "Worked out as: one-off expenses + repeating shares in these days, added up per category. The % is each category's part of the total.":
    "طريقة الحساب: المصاريف لمرة واحدة + حصص المتكررة في هذه الأيام، مجموعة حسب الفئة. والنسبة % هي حصة كل فئة من المجموع.",
  "Only expenses set to count for one product, added up per product in these days. The % is each product's part of these product expenses.":
    "المصاريف المخصّصة لمنتج واحد فقط، مجموعة لكل منتج في هذه الأيام. والنسبة % هي حصة كل منتج من مصاريف المنتجات هذه.",
  "Your expenses month by month, newest first, to spot a month that cost more than usual.": "مصاريفك شهرًا بشهر، الأحدث أولًا، لتلاحظ الشهر الذي كلّف أكثر من المعتاد.",
  "The repeating expenses' share of that month: a share for each day of it inside your days, up to today.":
    "حصة المصاريف المتكررة من ذلك الشهر: حصة عن كل يوم منه داخل الأيام التي اخترتها، حتى اليوم.",
  "Worked out as: one-off expenses dated in that month + the repeating share.": "طريقة الحساب: المصاريف لمرة واحدة المؤرَّخة في ذلك الشهر + حصة المتكررة.",

  // Money & stock: wallet and payouts
  "What MDM owes you and has paid you: ready to collect, on hold and paid. It shows once a sync can read your MDM wallet.":
    "ما تدين لك به MDM وما دفعته لك: الجاهز للتحصيل، والمحجوز، والمدفوع. يظهر بعد أن تتمكن المزامنة من قراءة محفظتك في MDM.",
  "The latest 50, newest first, with MDM's own status. Green means MDM confirmed it paid. Each sync reads new and changed payouts.":
    "آخر 50 دفعة، الأحدث أولًا، مع حالتها عند MDM. الأخضر يعني أن MDM أكّدت أنها دفعتها. كل مزامنة تقرأ الدفعات الجديدة والتي تغيّرت.",

  // Money & stock: money and fees per order
  "Worked out as: every line of this kind in these days, added up. Red took money from your account, green added money to it.":
    "طريقة الحساب: كل أسطر هذا النوع في هذه الأيام، مجموعة. الأحمر أخذ مالًا من حسابك، والأخضر أضاف إليه مالًا.",
  "The part of Amount already put into a payout by MDM. Worked out as: Amount − With MDM.": "الجزء من «المبلغ» الذي وضعته MDM في دفعة. طريقة الحساب: المبلغ − عند MDM.",
  "Worked out as: the lines of this kind not in any payout yet, added up. MDM settles them in a later payout.":
    "طريقة الحساب: أسطر هذا النوع التي لم تدخل أي دفعة بعد، مجموعة. تسوّيها MDM في دفعة لاحقة.",

  // Money & stock: stock
  "MDM's counts per product, read with every sync. The Profit tracker takes its stock from here: Available at MDM by default, changed per product in Stock to count.":
    "أعداد MDM لكل منتج، تُقرأ مع كل مزامنة. متتبّع الربح يأخذ مخزونه من هنا: «المتوفر عند MDM» افتراضيًا، ويمكن تغييره لكل منتج في «المخزون الذي تريد حسابه».",
  "Units in MDM's warehouse, ready to send for new orders. The amount under them is what they are worth at your purchase price in MDM.":
    "الوحدات في مستودع MDM، الجاهزة للإرسال لطلبيات جديدة. المبلغ تحتها هو قيمتها بسعر الشراء المسجَّل لديك في MDM.",
  "Units MDM has taken for orders it is preparing to send.": "وحدات أخذتها MDM لطلبيات تحضّرها للإرسال.",
  "Units in parcels on their way to your customers.": "وحدات في طرود في الطريق إلى زبائنك.",
  "Units in returned parcels still on their way back to MDM's warehouse.": "وحدات في طرود مرتجَعة ما زالت في طريق العودة إلى مستودع MDM.",
  "Units MDM marked as lost, and what they were worth.": "وحدات سجّلتها MDM ضائعة، وقيمتها.",
  "Every unit that ever entered MDM's warehouse for you, whatever happened to it after.": "كل وحدة دخلت مستودع MDM لحسابك منذ البداية، مهما حدث لها بعد ذلك.",
  "The latest 30. Expected is what you declared, Received what MDM counted in, Damaged what it found broken. Check any gap with MDM.":
    "آخر 30. «المنتظَر» هو ما صرّحت به، و«المستلَم» ما عدّته MDM عند الاستلام، و«التالف» ما وجدته مكسورًا. راجع أي فرق مع MDM.",

  // Money & stock: MDM price list
  "Read about once a day. Profit doesn't use this list: it takes each parcel's fees from MDM, and other costs from your products or Settings > Economics & currencies.":
    "تُقرأ مرة في اليوم تقريبًا. الربح لا يستعمل هذه القائمة: يأخذ رسوم كل طرد من MDM، وباقي التكاليف من منتجاتك أو من الإعدادات > التكاليف والعملات.",
  "What MDM's call center charges to call your customers and confirm their orders. Only the prices MDM set for you are shown.":
    "ما يقتطعه مركز الاتصال لدى MDM مقابل الاتصال بزبائنك وتأكيد طلبياتهم. تظهر فقط الأسعار التي حدّدتها لك MDM.",
  "What MDM charges to pick, pack and send your parcels from its warehouse, plus extra for orders with many items.":
    "ما تقتطعه MDM مقابل تجهيز طرودك وتغليفها وإرسالها من مستودعها، مع مبلغ إضافي للطلبيات ذات القطع الكثيرة.",
  "Per parcel, by the customer's wilaya. Home: home delivery. Stop desk: the customer collects it at a desk. Return: the parcel comes back. Exchange: an item is swapped.":
    "لكل طرد، حسب ولاية الزبون. المنزل: التوصيل للمنزل. مكتب الاستلام (Stop desk): يستلمه الزبون من مكتب. الإرجاع: الطرد يعود. الاستبدال: تُستبدل قطعة.",
};

export default ar;
