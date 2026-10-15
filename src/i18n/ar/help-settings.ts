import type { Dict } from "../core";

/** Arabic for the ⓘ explanations (help texts) of fields, cards and numbers in this part of the app. */
const ar: Dict = {
  // Settings > Workspace
  "Everything here belongs to one business: its orders, products, ads, members and settings. Switch between your businesses from the account menu.":
    "كل ما هنا يخص نشاطًا تجاريًا واحدًا: طلبياته ومنتجاته وإعلاناته وأعضاؤه وإعداداته. انتقل بين أنشطتك التجارية من قائمة الحساب.",
  "The name shown in the account menu, so you can tell your businesses apart. Example: Bella Shop.": "الاسم الذي يظهر في قائمة الحساب، لتفرّق بين أنشطتك التجارية. مثال: Bella Shop.",
  "The currency every page opens in, for everyone in this workspace. Each person can still pick another one for themselves with the currency picker at the top of the page.":
    "العملة التي تُفتح بها كل الصفحات لكل أعضاء مساحة العمل هذه. ويمكن لكل شخص أن يختار عملة أخرى لنفسه من قائمة العملات أعلى الصفحة.",
  "Decides when each day starts and ends in reports and date filters, so a late-night order counts on the right day. It can't be changed here.":
    "تحدّد متى يبدأ كل يوم وينتهي في التقارير والتصفية بالتاريخ، حتى تُحتسب طلبية آخر الليل في يومها الصحيح. لا يمكن تغييرها من هنا.",
  "Use it for a second brand or shop that you track apart. It starts empty and needs its own MDM key and Meta tokens.":
    "استعملها لعلامة تجارية أو متجر ثانٍ تتابعه على حدة. تبدأ فارغة وتحتاج إلى مفتاح MDM ورموز وصول Meta خاصة بها.",
  "The name of the new business, for example your second brand. You can rename it later in Settings > Workspace.":
    "اسم النشاط التجاري الجديد، مثلًا علامتك التجارية الثانية. يمكنك تغييره لاحقًا من الإعدادات ← مساحة العمل.",

  // Settings > Members & roles
  "Everyone who can open this workspace, each with their own login and role. Only an owner can add people, remove them or change their role.":
    "كل من يستطيع فتح مساحة العمل هذه، ولكل واحد حسابه ودوره. المالك وحده يستطيع إضافة الأعضاء أو إزالتهم أو تغيير أدوارهم.",
  "What each member may see and change. An owner can change it here, and it applies at once. The Roles card explains each one.":
    "ما يستطيع كل عضو رؤيته وتغييره. يمكن للمالك تغييره هنا، ويُطبَّق فورًا. بطاقة «الأدوار» تشرح كل دور.",
  "The email they used to sign up to this app. They need their own account first; once added, this workspace shows in their account menu.":
    "البريد الإلكتروني الذي سجّل به في هذا التطبيق. يجب أن يكون له حساب أولًا؛ وبعد إضافته تظهر مساحة العمل هذه في قائمة حسابه.",
  "What the new member may see and do. Pick Analyst for someone who only reads reports, Operator for someone who handles orders. The Roles card explains each one.":
    "ما يستطيع العضو الجديد رؤيته وفعله. اختر «محلّل» لمن يقرأ التقارير فقط، و«مُشغِّل» لمن يتابع الطلبيات. بطاقة «الأدوار» تشرح كل دور.",
  "Also: Operators don't see Money & stock, and Analysts see customer names and phones partly hidden, without addresses. A workspace always keeps at least one owner.":
    "وأيضًا: «المُشغِّل» لا يرى «المال والمخزون»، و«المحلّل» يرى أسماء الزبائن وهواتفهم مخفية جزئيًا، وبدون عناوينهم. ويجب أن يبقى في كل مساحة عمل مالك واحد على الأقل.",

  // Settings > Economics & currencies: exchange rates
  "Pick a currency in Add a currency, type what one unit costs you in {cur}, then press Save exchange rates. Example: 1 USD = 250.":
    "اختر العملة من «إضافة عملة»، واكتب كم {cur} تدفع مقابل وحدة واحدة منها، ثم اضغط «حفظ أسعار الصرف». مثال: 1 USD = 250.",
  "{currency} rate": "سعر صرف {currency}",
  "How many {cur} you pay for 1 {currency}, for example at the bank or exchange office. Update it when the price you pay changes.":
    "كم {cur} تدفع مقابل 1 {currency}، مثلًا في البنك أو عند الصرّاف. حدِّثه عندما يتغيّر السعر الذي تدفعه.",

  // Settings > Economics & currencies: economics defaults
  "The four fees are used only when a product has no cost for the order's date and MDM sends none. The three choices apply to every report.":
    "الرسوم الأربع لا تُستعمل إلا عندما لا تكون للمنتج تكلفة لتاريخ الطلبية ولا يرسل MDM قيمتها. أما الاختيارات الثلاثة فتُطبَّق على كل التقارير.",
  "What the carrier charges to take one parcel to the customer. Counted on every parcel that finished its trip: delivered, returned or lost. Example: 600.":
    "ما يأخذه الناقل لإيصال طرد واحد إلى الزبون. يُحتسب على كل طرد انتهت رحلته: مُسلَّم أو مرتجَع أو ضائع. مثال: 600.",
  "Extra fee the carrier charges when a parcel comes back to you, on top of the delivery fee. Counted on every returned parcel. Example: 200.":
    "رسوم إضافية يأخذها الناقل عندما يعود إليك طرد، فوق رسوم التوصيل. تُحتسب على كل طرد مرتجَع. مثال: 200.",
  "What the call center charges to call a customer and confirm the order. How often it counts is set in Call-center cost basis. Example: 100.":
    "ما يأخذه مركز الاتصال للاتصال بالزبون وتأكيد الطلبية. عدد مرات احتسابه يُحدَّد في «طريقة حساب تكلفة مركز الاتصال». مثال: 100.",
  "Cost of the box or bag, tape and label for one parcel. Counted on every parcel that finished its trip: delivered, returned or lost. Example: 50.":
    "تكلفة العلبة أو الكيس، والشريط اللاصق والملصق لطرد واحد. تُحتسب على كل طرد انتهت رحلته: مُسلَّم أو مرتجَع أو ضائع. مثال: 50.",
  "How many times the call-center fee is counted: once for every order placed, once per confirmed order, or once per call attempt recorded on the order.":
    "كم مرة تُحتسب رسوم مركز الاتصال: مرة لكل طلبية واردة، أو مرة لكل طلبية مؤكَّدة، أو مرة لكل محاولة اتصال مسجَّلة على الطلبية.",
  "How shared expenses like rent or salaries are split between products and ads: by delivered orders, by delivered revenue, or not split. Business totals always count them all.":
    "طريقة تقسيم المصاريف المشتركة مثل الكراء أو الأجور بين المنتجات والإعلانات: حسب الطلبيات المسلَّمة، أو حسب مداخيل الطلبيات المسلَّمة، أو بدون تقسيم. مجاميع النشاط كله تحتسبها كلها دائمًا.",
  "Which money profit counts by default: the COD value of delivered parcels, or only the cash the carrier has actually paid you. Dashboard, Creatives and Campaigns can switch it.":
    "المال الذي يحتسبه الربح افتراضيًا: قيمة الدفع عند الاستلام (COD) للطرود المسلَّمة، أو فقط المبلغ الذي حوّله لك الناقل فعلًا. يمكن تغييره في «لوحة القيادة» و«الإعلانات» و«الحملات».",

  // Settings > Economics & currencies: verdict thresholds
  "Placed orders an ad needs before it can get SCALE or WATCH. With fewer it shows Not enough data, unless it already counts as KILL or BAD TRAFFIC. Example: 20.":
    "عدد الطلبيات الواردة الذي يحتاجه الإعلان قبل أن يحصل على «وسِّع» (SCALE) أو «راقِب» (WATCH). بأقل من ذلك يظهر «بيانات غير كافية»، إلا إذا كان أصلًا «أوقِف» (KILL) أو «زيارات سيئة» (BAD TRAFFIC). مثال: 20.",
  "POAS = true net profit ÷ ad spend. An ad at or above this target, with enough orders, gets SCALE. Example: 0.3 means 30% profit on top of what the ads cost.":
    "POAS = صافي الربح الحقيقي ÷ مصاريف الإعلانات. الإعلان الذي يبلغ هذا الهدف أو يتجاوزه، مع طلبيات كافية، يحصل على «وسِّع» (SCALE). مثال: 0.3 يعني ربحًا بنسبة 30% فوق تكلفة الإعلانات.",
  "If an ad's placed CPA is acceptable but its delivery rate (delivered ÷ finished parcels) is under this, it gets BAD TRAFFIC once 10 parcels have finished. Example: 55.":
    "إذا كان CPA الطلبيات الواردة للإعلان مقبولًا لكن نسبة التسليم (المسلَّمة ÷ الطرود المنتهية) أقل من هذا، يحصل على «زيارات سيئة» (BAD TRAFFIC) بعد أن ينتهي 10 طرود. مثال: 55.",
  "If an ad's placed CPA is acceptable but its return rate (returned ÷ finished parcels) is above this, it gets BAD TRAFFIC once 10 parcels have finished. Example: 30.":
    "إذا كان CPA الطلبيات الواردة للإعلان مقبولًا لكن نسبة الإرجاع (المرتجَعة ÷ الطرود المنتهية) أعلى من هذا، يحصل على «زيارات سيئة» (BAD TRAFFIC) بعد أن ينتهي 10 طرود. مثال: 30.",
  "Placed CPA = ad spend ÷ placed orders. At or under this, orders count as cheap for BAD TRAFFIC. An ad losing money after spending minimum sample × this gets KILL. Example: 800.":
    "CPA الطلبيات الواردة = مصاريف الإعلانات ÷ الطلبيات الواردة. عند هذا الحد أو أقل، تُعتبر الطلبيات رخيصة في حكم «زيارات سيئة» (BAD TRAFFIC). والإعلان الخاسر بعد أن يصرف أقل عدد من الطلبيات × هذا المبلغ يحصل على «أوقِف» (KILL). مثال: 800.",

  // Settings > Audit log
  "Use it to check who changed what and when, for example who changed a role or removed a key. It shows the latest 100 actions.":
    "استعمله لتعرف مَن غيّر ماذا ومتى، مثلًا مَن غيّر دورًا أو أزال مفتاحًا. يعرض آخر 100 إجراء.",

  // Settings > MDM Express
  "MDM Express holds your orders and parcels. Once connected, MDM sync brings them in, so delivery rate and profit fill in by themselves, without files.":
    "MDM Express يحتفظ بطلبياتك وطرودك. بعد الربط، تجلبها «مزامنة MDM»، فتُحسب نسبة التسليم والربح وحدها، دون ملفات.",
  "Connected: MDM accepted the key and syncs run. Saved, not verified: press Test connection. Error: read the message below, then check or replace the key.":
    "متصل: قَبِل MDM المفتاح والمزامنة تعمل. محفوظ، لم يُتحقَّق منه بعد: اضغط «اختبار الاتصال». خطأ: اقرأ الرسالة في الأسفل، ثم تحقَّق من المفتاح أو استبدله.",
  "Your saved key with all but its last 4 characters hidden, so you can check which key is in use.": "مفتاحك المحفوظ، مخفيًا ما عدا آخر 4 أحرف منه، لتتأكد أي مفتاح مستعمَل.",
  "When Test connection last ran. Run it again after you replace the key, or when syncs start failing.":
    "آخر مرة شُغِّل فيها «اختبار الاتصال». أعِد تشغيله بعد استبدال المفتاح، أو عندما تبدأ المزامنة في الفشل.",
  "When MDM sync last finished with no error. Orders and statuses that changed in MDM after that are not in your numbers yet.":
    "آخر مرة انتهت فيها «مزامنة MDM» دون خطأ. الطلبيات والحالات التي تغيّرت في MDM بعد ذلك ليست في أرقامك بعد.",
  "The secret code that lets this app read your MDM orders, parcels and statuses, never change them. Paste it only in this field, never in a chat.":
    "الرمز السري الذي يسمح لهذا التطبيق بقراءة طلبياتك وطرودك وحالاتها في MDM، دون تغييرها أبدًا. الصقه في هذا الحقل فقط، ولا ترسله أبدًا في محادثة.",
  "Leave it empty to use the normal MDM address. Fill it in only if MDM tells you to use another one.": "اتركه فارغًا لاستعمال عنوان MDM العادي. لا تملأه إلا إذا طلب منك MDM استعمال عنوان آخر.",
  "Only owners and admins can save, test or remove the key. Remove key stops every sync at once; what was already synced stays.":
    "المالك والمدير فقط يستطيعان حفظ المفتاح واختباره وإزالته. «إزالة المفتاح» توقف كل مزامنة فورًا، وما تمت مزامنته يبقى.",
  "How often new and changed MDM orders are read by themselves. Shorter keeps statuses fresher. Sync now on the MDM sync page still works at any time.":
    "كم مرة تُقرأ تلقائيًا طلبيات MDM الجديدة والمتغيّرة. الوتيرة الأقصر تُبقي الحالات أحدث. ويبقى زر «زامِن الآن» في صفحة «مزامنة MDM» متاحًا في أي وقت.",

  // Settings > Status mappings
  "Pick what each status really means. Example: one saying the customer paid → delivered, one saying the parcel is on its way back → returned.":
    "اختر ما تعنيه كل حالة فعلًا. مثال: حالة تقول إن الزبون دفع ← مُسلَّمة، وحالة تقول إن الطرد في طريق العودة ← مرتجَعة.",
  "How many of your parcels have this MDM status now. They all change at once when you save its mapping.": "عدد طرودك التي لها حالة MDM هذه الآن. تتغيّر كلها دفعة واحدة عندما تحفظ تصنيفها.",
  "The status this app counts it as. Delivered and returned change your delivery rate and profit; shipped counts as on the road.":
    "الحالة التي يحتسبها التطبيق مكانها. «مُسلَّمة» و«مرتجَعة» تغيّران نسبة التسليم والربح؛ أما «مُرسَلة» فتُحتسب في الطريق.",
  "Statuses this workspace has its own mapping for, including the ones you mapped above. When a status is in both lists, this one wins.":
    "الحالات التي لمساحة العمل هذه تصنيف خاص بها، ومنها التي صنّفتها في الأعلى. إذا كانت الحالة في القائمتين، يُعتمد هذا التصنيف.",
  "The built-in meaning of each MDM status name. A status that is in neither list counts as unknown until you map it.":
    "المعنى المدمج لكل اسم حالة في MDM. الحالة التي ليست في أي من القائمتين تُحتسب غير معروفة حتى تصنّفها.",

  // Settings > Meta ads
  "Example: Main brand. Left empty, it is called Business Manager 1, 2 and so on. It is never sent to Meta.":
    "مثال: العلامة الرئيسية. إذا تركته فارغًا يُسمّى Business Manager 1 ثم 2 وهكذا. لا يُرسَل أبدًا إلى Meta.",
  "A long code made in Meta Business Settings for a system user, with ads_read. It lets this app read your ad spend, never change your ads. Paste it only here.":
    "رمز طويل يُنشأ في Meta Business Settings لمستخدم نظام (System user) مع صلاحية ads_read. يسمح لهذا التطبيق بقراءة مصاريف إعلاناتك، ولا يغيّر إعلاناتك أبدًا. الصقه هنا فقط.",
  "Profit, POAS and cost per order all need your ad spend. Once a token passes its test, spend comes in by itself, with no files to upload.":
    "الربح وPOAS وتكلفة الطلبية كلها تحتاج إلى مصاريف إعلاناتك. بعد نجاح رمز وصول في اختباره، تصل المصاريف وحدها، دون أي ملف ترفعه.",
  "Connected: at least one token passed Test connection and spend syncs run. Needs attention: a token failed; read its message. Saved, not verified: press Test connection.":
    "متصل: رمز وصول واحد على الأقل نجح في «اختبار الاتصال» ومزامنة المصاريف تعمل. يحتاج إلى انتباه: فشل رمز وصول، اقرأ رسالته. محفوظ، لم يُتحقَّق منه بعد: اضغط «اختبار الاتصال».",
  "Saved: the tokens you added. Working: tokens that passed their test and that Meta still accepts. Only working tokens are used to read spend.":
    "محفوظ: رموز الوصول التي أضفتها. يعمل: الرموز التي نجحت في اختبارها وما زالت Meta تقبلها. لا تُستعمل لقراءة المصاريف إلا الرموز التي تعمل.",
  "When the last spend sync finished with no error. Spend after that is not in your numbers yet; press Sync spend now to bring it in.":
    "وقت انتهاء آخر مزامنة للمصاريف دون خطأ. المصاريف بعد ذلك ليست في أرقامك بعد؛ اضغط «زامِن المصاريف الآن» لجلبها.",
  "A Business Manager is the Meta account that owns your ad accounts. Add one token for each of yours, then press Test connection on it.":
    "الـ Business Manager هو حساب Meta الذي تتبع له حساباتك الإعلانية. أضف رمز وصول واحدًا لكل واحد منها، ثم اضغط «اختبار الاتصال» عليه.",
  "An ad account is where Meta bills your ads. Each one is listed under the Business Manager whose token reads it.":
    "الحساب الإعلاني هو المكان الذي تفوتر فيه Meta إعلاناتك. يظهر كل حساب تحت الـ Business Manager الذي يقرؤه رمز وصوله.",
  "Ticked: this account's spend is read at every sync. Unticked: no new spend is read from it; spend already read stays in your numbers.":
    "محدَّد: تُقرأ مصاريف هذا الحساب في كل مزامنة. غير محدَّد: لا تُقرأ منه مصاريف جديدة، والمصاريف المقروءة سابقًا تبقى في أرقامك.",
  "What the most recent spend sync read. Check it after Sync spend now to see if new days and spend came in.":
    "ما قرأته آخر مزامنة للمصاريف. راجِعه بعد «زامِن المصاريف الآن» لترى هل وصلت أيام ومصاريف جديدة.",
  "The first and last day this sync asked Meta for, across all ad accounts.": "أول يوم وآخر يوم طلبتهما هذه المزامنة من Meta، في كل الحسابات الإعلانية.",
  "Switched-on ad accounts this sync read with a working token.": "الحسابات الإعلانية المفعَّلة التي قرأتها هذه المزامنة برمز وصول يعمل.",
  "One row is one ad on one day. New: read for the first time. Updated: Meta changed its numbers since the last read.":
    "السطر الواحد هو إعلان واحد في يوم واحد. جديد: قُرئ لأول مرة. محدَّث: غيّرت Meta أرقامه منذ آخر قراءة.",
  "Worked out as: the spend of every ad and day this sync read, changed or not, added up. Spend billed in another currency is converted with your exchange rates.":
    "طريقة الحساب: مجموع مصاريف كل إعلان وكل يوم قرأته هذه المزامنة، تغيّرت أو لم تتغيّر. المصاريف المفوترة بعملة أخرى تُحوَّل بأسعار الصرف التي أدخلتها.",
  "Only owners and admins can add, test or remove tokens. To cut access at once, press Remove on the token, or delete the system user in Meta Business Settings.":
    "المالك والمدير فقط يستطيعان إضافة رموز الوصول واختبارها وإزالتها. لقطع الوصول فورًا، اضغط «إزالة» على الرمز، أو احذف مستخدم النظام (System user) في Meta Business Settings.",
  "Orders and spend meet on the ad ID. If an ad's link doesn't send its ID as utm_content, its orders can't be matched to its spend.":
    "الطلبيات والمصاريف تلتقي عند معرّف الإعلان. إذا كان رابط الإعلان لا يرسل معرّفه في utm_content، فلا يمكن ربط طلبياته بمصاريفه.",
  "How often spend is read by itself. Shorter keeps today's spend fresher in your reports. Sync spend now still works at any time.":
    "كم مرة تُقرأ المصاريف تلقائيًا. الوتيرة الأقصر تُبقي مصاريف اليوم أحدث في تقاريرك. ويبقى زر «زامِن المصاريف الآن» متاحًا في أي وقت.",

  // Settings > Your data
  "Use it to clear test data or start over. Each Delete first lists what goes and what stays, and asks you to type DELETE.":
    "استعمله لمسح بيانات التجربة أو للبدء من جديد. كل زر «حذف» يعرض أولًا ما سيُحذف وما سيبقى، ثم يطلب منك كتابة DELETE.",
  "Orders and parcels MDM sync brought in, plus the wallet, payouts and stock shown on Money & stock. Orders from imported files are not part of it.":
    "الطلبيات والطرود التي جلبتها «مزامنة MDM»، مع المحفظة والدفعات والمخزون الظاهرة في «المال والمخزون». طلبيات الملفات المستورَدة ليست منها.",
  "Ad spend the Meta spend sync read, one row per ad per day. Spend from imported files is not part of it.":
    "مصاريف الإعلانات التي قرأتها مزامنة مصاريف Meta، بسطر واحد لكل إعلان في كل يوم. مصاريف الملفات المستورَدة ليست منها.",
  "Files you uploaded on the Imports page. Data synced from MDM or Meta and what you typed in yourself are not part of it.":
    "الملفات التي رفعتها في صفحة «الاستيراد». البيانات المُزامَنة من MDM أو Meta، وما أدخلته بنفسك، ليست منها.",
  "Expenses you typed on the Expenses page, repeating ones like rent included. Profit subtracts them, so deleting them makes profit higher.":
    "المصاريف التي أدخلتها في صفحة «المصاريف»، ومنها المتكررة مثل الكراء. الربح يطرحها، لذلك حذفها يجعل الربح أعلى.",
  "Each price and cost version holds a product's prices and costs from one date on, so old orders keep the costs of their day. Profit needs them.":
    "كل نسخة من السعر والتكلفة تحفظ أسعار المنتج وتكاليفه ابتداءً من تاريخ معيّن، فتحتفظ الطلبيات القديمة بتكاليف يومها. والربح يحتاج إليها.",
  "For a full restart, for example after trying the app with test data. Exchange rates, status mappings and the audit log stay too.":
    "لإعادة البدء من الصفر، مثلًا بعد تجربة التطبيق ببيانات تجريبية. أسعار الصرف وتصنيف الحالات وسجل النشاط تبقى أيضًا.",
  "Ticked: the key is deleted too, and no sync runs until you save a key again. Not ticked: the next sync brings back what MDM still has.":
    "إذا حدّدتها: يُحذف المفتاح أيضًا، ولا تعمل أي مزامنة حتى تحفظ مفتاحًا من جديد. إذا لم تحدّدها: المزامنة القادمة تُرجع ما زال موجودًا في MDM.",
  "Ticked: the tokens are deleted too, and no spend sync runs until you add one again. Not ticked: the next spend sync reads the last 180 days again.":
    "إذا حدّدتها: تُحذف رموز الوصول أيضًا، ولا تعمل مزامنة المصاريف حتى تضيف رمزًا من جديد. إذا لم تحدّدها: مزامنة المصاريف القادمة تعيد قراءة آخر 180 يومًا.",
  "Ticked: the MDM key and Meta tokens are deleted too, so nothing comes back by itself. Not ticked: the next syncs bring back what MDM and Meta still have.":
    "إذا حدّدتها: يُحذف أيضًا مفتاح MDM ورموز الوصول لـ Meta، فلا يعود أي شيء وحده. إذا لم تحدّدها: المزامنات القادمة تُرجع ما زال موجودًا في MDM وMeta.",
  "A safety step so nothing is deleted by mistake. Type the English word DELETE, in capitals or not, then press Delete.":
    "خطوة أمان حتى لا يُحذف أي شيء بالخطأ. اكتب الكلمة الإنجليزية DELETE، بحروف كبيرة أو صغيرة، ثم اضغط «حذف».",
};

export default ar;
