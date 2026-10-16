import type { Dict } from "../core";

/** Arabic for the ⓘ explanations (help texts) of fields, cards and numbers in this part of the app. */
const ar: Dict = {
  // Profit tracker: page and every product
  "What one delivered order really leaves you: its price − the product, delivery, calls, the ads it took and its share of returned and lost parcels. Before your expenses.":
    "ما تتركه لك فعلًا طلبية مُسلَّمة واحدة: سعرها − المنتج والتوصيل والمكالمات والإعلانات التي احتاجتها ونصيبها من الطرود المرتجَعة والضائعة. قبل خصم مصاريفك.",
  "What the ads cost for each order that is delivered. Worked out as: ad spend per order placed ÷ confirmation rate ÷ shipping rate ÷ delivery rate.":
    "كم تكلّف الإعلانات مقابل كل طلبية تُسلَّم. تُحسب هكذا: مصاريف الإعلانات لكل طلبية واردة ÷ نسبة التأكيد ÷ نسبة الإرسال ÷ نسبة التسليم.",
  "Ad spend counts for a product only through a campaign or ad account linked to it. This lists the spend linked to none, so you can link it.":
    "تُحسب مصاريف الإعلانات للمنتج فقط عبر حملة أو حساب إعلاني مرتبط به. هنا تجد المصاريف غير المرتبطة بأي منتج لتربطها.",

  // One product: offer, step by step, charts
  "How many pieces one order sends. The order price stays the same; the product cost is cost per piece × pieces, free pieces included.":
    "عدد القطع التي تُرسلها الطلبية الواحدة. سعر الطلبية لا يتغير، وتكلفة المنتج = تكلفة القطعة × عدد القطع، بما فيها القطع المجانية.",


  // One product: its campaigns
  "Until a campaign is linked, Profit per delivered order counts no ads, so it looks higher than it really is.":
    "إلى أن تربط حملة، لا يحسب «الربح لكل طلبية مُسلَّمة» أي إعلانات، فيبدو أعلى من حقيقته.",
  "Confirmed ÷ orders placed from the campaign's ads. With too few finished parcels, the product's rates are used (marked Product's rates).":
    "المؤكَّدة ÷ الطلبيات الواردة من إعلانات الحملة. إذا كانت طرودها المنتهية قليلة، تُستعمل نسب المنتج (مع علامة «نسب المنتج»).",
  "One bar per linked campaign: what its ads cost per delivered order, longest on top. Black bars pass the dashed line, the most a delivered order can pay, and lose money.":
    "شريط لكل حملة مرتبطة: كم تكلّف إعلاناتها لكل طلبية مُسلَّمة، والأطول في الأعلى. الأشرطة السوداء تتجاوز الخط المتقطّع، وهو أقصى ما تستطيع الطلبية المُسلَّمة دفعه، فهي تخسر.",
  "Profit of one delivered order before ads: profit per delivered order + its ads. A campaign whose ads cost more than this per delivered order loses money.":
    "ربح طلبية مُسلَّمة واحدة قبل الإعلانات: الربح لكل طلبية مُسلَّمة + إعلاناتها. الحملة التي تكلّف إعلاناتها أكثر من هذا لكل طلبية مُسلَّمة تخسر.",


  // The Profit tracker rebuilt
  "The orders placed in these days: their real profit (what delivered parcels collected, minus Meta, the product, MDM's fees and your expenses) plus what their orders not finished yet should still bring at your rates.": "الطلبيات الواردة في هذه الأيام: ربحها الحقيقي (ما حصّلته الطرود المُسلَّمة، ناقص Meta والمنتج ورسوم MDM ومصاريفك) مع ما يُنتظر أن تجلبه طلبياتها التي لم تنتهِ بعد حسب نسبك.",
  "Money already settled: what the delivered parcels of these orders collected, minus every cost and the ads of these days.": "المال المحسوم: ما حصّلته الطرود المُسلَّمة من هذه الطلبيات، ناقص كل التكاليف وإعلانات هذه الأيام.",
  "What the orders not finished yet should bring: on the road × delivery rate, being prepared × shipping rate, waiting for the call × confirmation rate, each minus its product and fees.": "ما يُنتظر أن تجلبه الطلبيات التي لم تنتهِ بعد: التي في الطريق × نسبة التسليم، التي قيد التحضير × نسبة الإرسال، التي تنتظر المكالمة × نسبة التأكيد، كلٌّ منها ناقص منتجه ورسومه.",
  "What Meta cost for each order placed: the ad spend of the campaigns linked to this product ÷ its orders placed. The bar shows how close it is to the most an order can cost before you lose money.": "كم كلّفت Meta مقابل كل طلبية واردة: مصاريف الحملات المرتبطة بهذا المنتج ÷ طلبياته الواردة. الشريط يُظهر مدى قربها من أقصى ما يمكن أن تكلّفه الطلبية قبل أن تخسر.",
  "The % of orders the call center confirms. Worked out as: confirmed ÷ orders whose call is answered; orders still waiting for the call are left out until then.": "نسبة الطلبيات التي يؤكّدها مركز الاتصال. تُحسب هكذا: المؤكَّدة ÷ الطلبيات التي حُسمت مكالمتها؛ الطلبيات التي ما زالت تنتظر المكالمة لا تُحسب حتى ذلك الحين.",
  "The % of finished parcels the customer received and paid. Worked out as: delivered ÷ finished (delivered + returned + lost); parcels on the road count once they finish.": "نسبة الطرود المنتهية التي استلمها الزبون ودفع ثمنها. تُحسب هكذا: المُسلَّمة ÷ المنتهية (المُسلَّمة + المرتجَعة + الضائعة)؛ الطرود التي في الطريق تُحسب عندما تنتهي.",
  "What one delivered order leaves you, from its price down to its profit.": "ما تتركه لك طلبية مُسلَّمة واحدة، من سعرها نزولًا إلى ربحها.",
  "Each column takes one cost off the price of one order: first the order's own costs, then the ads and the returned and lost parcels each delivered order carries.": "كل عمود يخصم تكلفة واحدة من سعر الطلبية: أولًا تكاليف الطلبية نفسها، ثم الإعلانات والطرود المرتجَعة والضائعة التي تتحمّلها كل طلبية مُسلَّمة.",
  "Each bar is how many orders reached that step; the % is the share of the step above. Then where the shipped orders are now. Tap a number to see those orders.": "كل شريط هو عدد الطلبيات التي وصلت إلى تلك المرحلة؛ والنسبة % حصة من المرحلة التي قبلها. ثم أين الطلبيات المُرسَلة الآن. اضغط على رقم لترى تلك الطلبيات.",
  "Every campaign linked to this product, added up. Their ad spend ÷ orders placed gives the ads per order, which the delivery and confirmation rates turn into ads per delivered order.": "كل الحملات المرتبطة بهذا المنتج مجموعة معًا. مصاريفها ÷ الطلبيات الواردة تعطي الإعلانات لكل طلبية، ونسبتا التسليم والتأكيد تحوّلانها إلى إعلانات لكل طلبية مُسلَّمة.",
  "Each number the page works with, its value and where it was read. Numbers from MDM and Meta update at every sync; the others come from your product details and Settings.": "كل رقم تعمل به الصفحة، وقيمته ومن أين قُرئ. أرقام MDM وMeta تتحدّث مع كل مزامنة، والباقي من تفاصيل منتجك والإعدادات.",
  "what delivered parcels collected − Meta − the pieces delivered × cost of one piece − delivery and packaging of every finished parcel − return fees − call center − your expenses.": "ما حصّلته الطرود المُسلَّمة − Meta − القطع المُسلَّمة × تكلفة القطعة − التوصيل والتغليف لكل طرد انتهى − رسوم الإرجاع − مركز الاتصال − مصاريفك.",
  "for each order not finished: its price × delivery rate − its pieces × cost × delivery rate − its delivery and packaging − its return fee × return rate; times the shipping rate if not sent yet, and the confirmation rate if not confirmed yet.": "لكل طلبية لم تنتهِ: سعرها × نسبة التسليم − قطعها × التكلفة × نسبة التسليم − توصيلها وتغليفها − رسوم إرجاعها × نسبة الإرجاع؛ مضروبًا في نسبة الإرسال إن لم تُرسَل بعد، وفي نسبة التأكيد إن لم تُؤكَّد بعد.",
  "price − product − delivery − calls − Meta per order ÷ (confirmation × shipping × delivery rate) − the returns each delivered order carries.": "السعر − المنتج − التوصيل − المكالمات − Meta لكل طلبية ÷ (نسبة التأكيد × الإرسال × التسليم) − المرتجَعات التي تتحمّلها كل طلبية مُسلَّمة.",
  "One bar per day (per week or month over long periods) for the orders placed that day: green is profit, red is loss, striped is still expected from orders not finished yet. Expenses are not in the bars.": "شريط لكل يوم (أو لكل أسبوع أو شهر في الفترات الطويلة) للطلبيات الواردة في ذلك اليوم: الأخضر ربح، والأحمر خسارة، والمخطّط ما زال متوقَّعًا من طلبيات لم تنتهِ بعد. المصاريف ليست في الأشرطة.",
  "The orders placed in these days: their real profit plus what their orders not finished yet should still bring.": "الطلبيات الواردة في هذه الأيام: ربحها الحقيقي مع ما يُنتظر أن تجلبه طلبياتها التي لم تنتهِ بعد.",
  "What Meta cost for each order placed: the ad spend of the campaigns linked to this product ÷ its orders placed.": "كم كلّفت Meta مقابل كل طلبية واردة: مصاريف الحملات المرتبطة بهذا المنتج ÷ طلبياته الواردة.",
  "One row per product, with the same numbers as its own page below. Tap a product to open it.": "سطر لكل منتج، بنفس أرقام صفحته أدناه. اضغط على منتج لتفتحه.",
  "Only orders placed in these days, and the ad spend of these days, count. Rates come from these days once enough of their parcels have finished, else from all your orders.": "تُحسب فقط الطلبيات الواردة في هذه الأيام ومصاريف إعلانات هذه الأيام. النسب تأتي من هذه الأيام عندما ينتهي عدد كافٍ من طرودها، وإلا فمن كل طلبياتك.",
  "Starts from this product's real numbers. Move a slider to see what a month would leave you: for example a cheaper Meta cost, or a better delivery rate. Nothing here is saved.": "يبدأ من الأرقام الحقيقية لهذا المنتج. حرّك مؤشرًا لترى كم سيترك لك شهر: مثلًا تكلفة Meta أرخص، أو نسبة تسليم أفضل. لا شيء هنا يُحفظ.",
  "What Meta costs for each order placed. Starts at what the linked campaigns cost in these days.": "كم تكلّف Meta مقابل كل طلبية واردة. يبدأ من تكلفة الحملات المرتبطة في هذه الأيام.",
  "Orders placed each day. Starts at this product's average in these days.": "الطلبيات الواردة كل يوم. يبدأ من متوسط هذا المنتج في هذه الأيام.",
  "The % of orders the call center confirms.": "نسبة الطلبيات التي يؤكّدها مركز الاتصال.",
  "The % of shipped parcels the customer receives and pays.": "نسبة الطرود المُرسَلة التي يستلمها الزبون ويدفع ثمنها.",
  "What the customer pays for one order. Starts at what MDM really collected on your delivered orders.": "ما يدفعه الزبون مقابل طلبية واحدة. يبدأ ممّا حصّله MDM فعلًا على طلبياتك المُسلَّمة.",
  "What one piece costs you, free pieces included in the offer.": "كم تكلّفك القطعة الواحدة، والقطع المجانية في العرض محسوبة.",
  "How many pieces one order sends. Changing it here doesn't change the product.": "عدد القطع التي تُرسلها الطلبية الواحدة. تغييره هنا لا يغيّر المنتج.",
  "What MDM charges to deliver one parcel.": "ما يأخذه MDM لتوصيل طرد واحد.",
  "What MDM charges for a parcel that comes back.": "ما يأخذه MDM عن طرد يعود.",
  "What the call center charges for one order.": "ما يأخذه مركز الاتصال عن طلبية واحدة.",
  "Box, bag and label for one parcel.": "العلبة والكيس والملصق لطرد واحد.",
  "Rent, pay and the other expenses this product carries in a month. Starts at its share of your expenses in these days.": "الإيجار والأجور والمصاريف الأخرى التي يتحمّلها هذا المنتج في الشهر. يبدأ من حصته من مصاريفك في هذه الأيام.",
  "Orders per day × 30 ÷ orders placed for each delivered one × profit per delivered order − your expenses per month.": "الطلبيات في اليوم × 30 ÷ الطلبيات الواردة مقابل كل مُسلَّمة × الربح لكل طلبية مُسلَّمة − مصاريفك في الشهر.",
  "Each box is a month's profit at that confirmation rate (rows) and delivery rate (columns), with everything else as set above. The ringed box is closest to the rates set above.": "كل خانة هي ربح شهر بنسبة التأكيد تلك (الأسطر) ونسبة التسليم تلك (الأعمدة)، وكل الباقي كما ضبطته أعلاه. الخانة المحاطة بإطار هي الأقرب إلى النسب المضبوطة أعلاه.",
};

export default ar;
