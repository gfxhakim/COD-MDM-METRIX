import type { Dict } from "../core";

/** Arabic for the ⓘ explanations (help texts) of fields, cards and numbers in this part of the app. */
const ar: Dict = {
  // Profit tracker: page and every product
  "Only orders placed in these days, and the ad spend of these days, count for the rates, ads per order and real profit. Stock and product details stay the same.":
    "تُحسب النسب والإعلانات لكل طلبية والربح الحقيقي فقط من الطلبيات الواردة في هذه الأيام ومصاريف إعلانات هذه الأيام. المخزون وتفاصيل المنتج لا تتغير.",
  "One row per product, with the same numbers as its own page below. Tap a product to see how each one is worked out.":
    "سطر لكل منتج، بنفس أرقام صفحته أدناه. اضغط على منتج لترى كيف يُحسب كل رقم.",
  "What one delivered order really leaves you: its price − the product, delivery, calls, the ads it took and its share of returned and lost parcels. Before your expenses.":
    "ما تتركه لك فعلًا طلبية مُسلَّمة واحدة: سعرها − المنتج والتوصيل والمكالمات والإعلانات التي احتاجتها ونصيبها من الطرود المرتجَعة والضائعة. قبل خصم مصاريفك.",
  "What the ads cost for each order that is delivered. Worked out as: ad spend per order placed ÷ confirmation rate ÷ shipping rate ÷ delivery rate.":
    "كم تكلّف الإعلانات مقابل كل طلبية تُسلَّم. تُحسب هكذا: مصاريف الإعلانات لكل طلبية واردة ÷ نسبة التأكيد ÷ نسبة الإرسال ÷ نسبة التسليم.",
  "Ad spend counts for a product only through a campaign or ad account linked to it. This lists the spend linked to none, so you can link it.":
    "تُحسب مصاريف الإعلانات للمنتج فقط عبر حملة أو حساب إعلاني مرتبط به. هنا تجد المصاريف غير المرتبطة بأي منتج لتربطها.",

  // One product: offer, step by step, charts
  "How many pieces one order sends. The order price stays the same; the product cost is cost per piece × pieces, free pieces included.":
    "عدد القطع التي تُرسلها الطلبية الواحدة. سعر الطلبية لا يتغير، وتكلفة المنتج = تكلفة القطعة × عدد القطع، بما فيها القطع المجانية.",
  "Each bar takes one cost off the price of one order: first the order's own costs, then the ads and the returned and lost parcels each delivered order carries.":
    "كل شريط يخصم تكلفة واحدة من سعر الطلبية: أولًا تكاليف الطلبية نفسها، ثم الإعلانات والطرود المرتجَعة والضائعة التي تتحمّلها كل طلبية مُسلَّمة.",
  "The price of one delivered order as one bar: each color is a cost, green is the profit left. Each % is a share of the price.":
    "سعر طلبية مُسلَّمة واحدة في شريط واحد: كل لون تكلفة، والأخضر هو الربح المتبقّي. كل نسبة % هي حصة من السعر.",
  "One bar per day (per week or month over long periods): green is profit, red is loss, striped still has parcels on the road. Expenses are not in the bars.":
    "شريط لكل يوم (أو لكل أسبوع أو شهر في الفترات الطويلة): الأخضر ربح، والأحمر خسارة، والمخطّط فيه طرود ما زالت في الطريق. المصاريف ليست في الأشرطة.",
  "Each bar is how many orders reached that step. The % is the share of the step above; Delivered is a share of finished parcels, not of all shipped.":
    "كل شريط هو عدد الطلبيات التي وصلت إلى تلك المرحلة. النسبة % حصة من المرحلة التي قبلها، ونسبة المُسلَّمة من الطرود التي انتهى توصيلها لا من كل المُرسَلة.",

  // One product: Try other numbers (and the same fields in the stock calculator and the simulator)
  "What the customer pays for one whole order, without delivery. With Buy 1, get 1 free it is the price of both pieces together. Example: 2900.":
    "ما يدفعه الزبون مقابل طلبية كاملة، بدون التوصيل. مع «اشترِ 1 واحصل على 1 مجانًا» هو سعر القطعتين معًا. مثال: 2900.",
  "What one piece costs you from your supplier. The page multiplies it by the pieces of your offer: 2 pieces × 800 = 1600 per order.":
    "كم تكلّفك قطعة واحدة عند المورّد. تضربها الصفحة في عدد قطع عرضك: قطعتان × 800 = 1600 لكل طلبية.",
  "What ads cost for each order placed: the linked campaigns' ad spend ÷ this product's orders placed. The page turns it into ads per delivered order.":
    "كم تكلّف الإعلانات مقابل كل طلبية واردة: مصاريف الحملات المرتبطة ÷ الطلبيات الواردة لهذا المنتج. الصفحة تحوّلها إلى إعلانات لكل طلبية مُسلَّمة.",
  "The % of orders placed that the call center confirms. Your orders give it as confirmed ÷ placed.":
    "نسبة الطلبيات الواردة التي يؤكّدها مركز الاتصال، بالـ %. من طلبياتك تُحسب هكذا: المؤكَّدة ÷ الواردة.",
  "The % of confirmed orders that are really sent; the others are cancelled after the call. Your orders give it as shipped ÷ confirmed.":
    "نسبة الطلبيات المؤكَّدة التي تُرسَل فعلًا، والباقي يُلغى بعد المكالمة. من طلبياتك تُحسب هكذا: المُرسَلة ÷ المؤكَّدة.",
  "The % of shipped parcels the customer receives and pays for. Your orders give it as delivered ÷ finished parcels, so parcels still on the road don't count.":
    "نسبة الطرود المُرسَلة التي يستلمها الزبون ويدفع ثمنها. من طلبياتك تُحسب هكذا: المُسلَّمة ÷ الطرود التي انتهى توصيلها، فلا تُحسب الطرود التي ما زالت في الطريق.",
  "What MDM charges you to send one parcel. It is paid on every shipped parcel: delivered, returned or lost.":
    "ما يأخذه منك MDM لإرسال طرد واحد. يُدفع على كل طرد مُرسَل: مُسلَّمًا كان أو مرتجَعًا أو ضائعًا.",
  "What MDM charges when a parcel comes back, on top of its delivery fee.": "ما يأخذه MDM عندما يعود طرد إليك، زيادةً على رسوم توصيله.",
  "What the call center charges for one order. The calls of orders that aren't delivered are shared over the delivered ones.":
    "ما يأخذه مركز الاتصال عن طلبية واحدة. مكالمات الطلبيات التي لا تُسلَّم تتوزّع على الطلبيات المُسلَّمة.",
  "Box, bag and label for one parcel. Paid on every shipped parcel, even one that comes back.":
    "العلبة والكيس والملصق لطرد واحد. يُدفع على كل طرد مُرسَل، حتى الذي يعود.",

  // One product: its campaigns
  "What the ads cost for each order that comes in. Worked out as: this product's ad spend ÷ its orders placed.":
    "كم تكلّف الإعلانات مقابل كل طلبية تصل. تُحسب هكذا: مصاريف إعلانات هذا المنتج ÷ طلبياته الواردة.",
  "Worked out as: ads per order placed ÷ confirmation rate. The ads of cancelled orders are carried by the confirmed ones.":
    "تُحسب هكذا: الإعلانات لكل طلبية واردة ÷ نسبة التأكيد. إعلانات الطلبيات الملغاة تتحمّلها الطلبيات المؤكَّدة.",
  "Until a campaign is linked, Profit per delivered order counts no ads, so it looks higher than it really is.":
    "إلى أن تربط حملة، لا يحسب «الربح لكل طلبية مُسلَّمة» أي إعلانات، فيبدو أعلى من حقيقته.",
  "Every campaign linked to this product, added up. Their ad spend ÷ orders placed gives the ads per order, which the steps below turn into ads per delivered order.":
    "كل الحملات المرتبطة بهذا المنتج مجموعة معًا. مصاريفها ÷ الطلبيات الواردة تعطي الإعلانات لكل طلبية، والخطوات أدناه تحوّلها إلى إعلانات لكل طلبية مُسلَّمة.",
  "Confirmed ÷ orders placed from the campaign's ads. With too few finished parcels, the product's rates are used (marked Product's rates).":
    "المؤكَّدة ÷ الطلبيات الواردة من إعلانات الحملة. إذا كانت طرودها المنتهية قليلة، تُستعمل نسب المنتج (مع علامة «نسب المنتج»).",
  "One bar per linked campaign: what its ads cost per delivered order, longest on top. Black bars pass the dashed line, the most a delivered order can pay, and lose money.":
    "شريط لكل حملة مرتبطة: كم تكلّف إعلاناتها لكل طلبية مُسلَّمة، والأطول في الأعلى. الأشرطة السوداء تتجاوز الخط المتقطّع، وهو أقصى ما تستطيع الطلبية المُسلَّمة دفعه، فهي تخسر.",
  "Profit of one delivered order before ads: profit per delivered order + its ads. A campaign whose ads cost more than this per delivered order loses money.":
    "ربح طلبية مُسلَّمة واحدة قبل الإعلانات: الربح لكل طلبية مُسلَّمة + إعلاناتها. الحملة التي تكلّف إعلاناتها أكثر من هذا لكل طلبية مُسلَّمة تخسر.",

  // Stock calculator
  "Units in MDM's warehouse, ready to be sent.": "الوحدات الموجودة في مستودع MDM، جاهزة للإرسال.",
  "Units on their way to MDM's warehouse that it hasn't received yet.": "وحدات في طريقها إلى مستودع MDM ولم يستلمها بعد.",
  "Every unit of this product MDM has received so far, sold or not.": "كل وحدات هذا المنتج التي استلمها MDM حتى الآن، مَبيعة أو لا.",
  "Units in parcels that are with the carrier right now.": "وحدات في طرود موجودة الآن عند شركة التوصيل.",
  "Units in returned parcels on their way back to MDM's warehouse.": "وحدات في طرود مرتجَعة في طريق عودتها إلى مستودع MDM.",
  "Which units the calculation counts: what MDM has available, that plus what is on the way, everything MDM received, or a number you type.":
    "أي وحدات يحسبها الحساب: المتوفر عند MDM، أو المتوفر مع ما هو في الطريق، أو كل ما استلمه MDM، أو رقم تكتبه بنفسك.",
  "How many units the calculation counts. It follows MDM unless you pick A number I type.": "عدد الوحدات التي يحسبها الحساب. يتبع MDM إلا إذا اخترت «رقم أكتبه بنفسي».",
  "What one piece sells for, without delivery. With an offer it is the order price ÷ its pieces: 3800 for 2 pieces gives 1900.":
    "سعر بيع قطعة واحدة، بدون التوصيل. مع العرض هو سعر الطلبية ÷ عدد قطعها: 3800 مقابل قطعتين يعطي 1900.",
  "What one piece costs you to buy from your supplier. Example: 800.": "كم تكلّفك قطعة واحدة عند شرائها من المورّد. مثال: 800.",
  "How many pieces one order sends. Fees are paid per parcel, so more pieces per order means fewer parcels and fewer fees.":
    "عدد القطع التي تُرسلها الطلبية الواحدة. الرسوم تُدفع عن كل طرد، فكلما زادت القطع في الطلبية قلّت الطرود وقلّت الرسوم.",
  "Counted as if every order were delivered at the first try: no ads, no cancelled or returned orders. Orders = units ÷ pieces per order.":
    "تُحسب كأن كل طلبية سُلِّمت من أول مرة: بدون إعلانات ولا طلبيات ملغاة أو مرتجَعة. عدد الطلبيات = الوحدات ÷ القطع في كل طلبية.",
  "Worked out as: sale price per piece − cost per piece. What each unit earns before ads and fees.":
    "يُحسب هكذا: سعر بيع القطعة − تكلفة القطعة. ما تربحه كل وحدة قبل الإعلانات والرسوم.",
  "Delivery, packaging, call center and other MDM fees of every order, as if each were delivered at the first try. Worked out as: orders × fees per order.":
    "رسوم التوصيل والتغليف ومركز الاتصال ورسوم MDM الأخرى لكل الطلبيات، كأن كل واحدة سُلِّمت من أول مرة. تُحسب هكذا: عدد الطلبيات × رسوم الطلبية الواحدة.",
  "Worked out as: benefit before ads − fees. Still without ads, cancelled or returned orders.":
    "يُحسب هكذا: الربح قبل الإعلانات − الرسوم. ما زال بدون إعلانات ولا طلبيات ملغاة أو مرتجَعة.",
  "The % of shipped parcels that never arrive and never come back: their goods and delivery fee are lost. Your orders give it as lost ÷ finished parcels.":
    "نسبة الطرود المُرسَلة التي لا تصل ولا تعود: تضيع سلعها ورسوم توصيلها. من طلبياتك تُحسب هكذا: الضائعة ÷ الطرود التي انتهى توصيلها.",
  "The % of shipped parcels that come back. Each one pays its delivery and return fees, then goes back to stock to be sent again.":
    "نسبة الطرود المُرسَلة التي تعود. كل طرد منها يدفع رسوم التوصيل والإرجاع، ثم يعود إلى المخزون ليُرسَل من جديد.",
  "Ticked: returned = 100% − delivered − lost. Untick it to type your own returned %.":
    "عند التفعيل: المرتجَعة = 100% − المُسلَّمة − الضائعة. ألغِ التفعيل لتكتب نسبة الإرجاع بنفسك.",
  "What ads cost for each order placed. Your orders give it as this product's ad spend ÷ its orders placed. Type one if no campaign is linked yet.":
    "كم تكلّف الإعلانات مقابل كل طلبية واردة. من طلبياتك تُحسب هكذا: مصاريف إعلانات هذا المنتج ÷ طلبياته الواردة. اكتب رقمًا إن لم تكن هناك حملة مرتبطة بعد.",
  "What the call center charges for one order. Choose under Paid for each order whether every order placed pays it or only confirmed ones.":
    "ما يأخذه مركز الاتصال عن طلبية واحدة. اختر في «تُدفع عن كل طلبية» هل تُدفع عن كل طلبية واردة أم عن المؤكَّدة فقط.",
  "Placed: the call center is paid for every order that comes in. Confirmed: only for the orders it confirms. Settings > Economics & currencies sets the starting choice.":
    "واردة: يُدفع لمركز الاتصال عن كل طلبية تصل. مؤكَّدة: فقط عن الطلبيات التي يؤكّدها. الاختيار الأول يأتي من الإعدادات > التكاليف والعملات.",
  "Taken off each delivered order only. Type 0 if MDM charges nothing more.": "يُخصم من كل طلبية مُسلَّمة فقط. اكتب 0 إن كان MDM لا يأخذ شيئًا آخر.",
  "One fixed amount taken once off the whole stock's benefit, not per order.": "مبلغ ثابت يُخصم مرة واحدة من ربح المخزون كله، وليس عن كل طلبية.",
  "The most you can pay in ads per order placed before this stock loses money. Worked out as: real benefit before ads ÷ orders placed.":
    "أقصى ما يمكنك دفعه في الإعلانات لكل طلبية واردة قبل أن يبدأ هذا المخزون في الخسارة. يُحسب هكذا: الربح الحقيقي للمخزون قبل الإعلانات ÷ الطلبيات الواردة.",
  "Worked out backwards: parcels to ship = units ÷ pieces per order ÷ (delivered % + lost %), confirmed = shipped ÷ shipping rate, placed = confirmed ÷ confirmation rate.":
    "يُحسب بالعكس: الطرود المُرسَلة = الوحدات ÷ القطع في كل طلبية ÷ (نسبة التسليم % + نسبة الضياع %)، المؤكَّدة = المُرسَلة ÷ نسبة الإرسال، الواردة = المؤكَّدة ÷ نسبة التأكيد.",
  "Each bar is one cost that takes the benefit before ads down to the real benefit, biggest first. Together they make the missing benefit.":
    "كل شريط تكلفة تُنزل الربح قبل الإعلانات إلى الربح الحقيقي للمخزون، من الأكبر إلى الأصغر. مجموعها هو الربح الضائع.",
  "Pieces in the delivered parcels of the orders placed in these days, free pieces of your offer included.":
    "القطع الموجودة في الطرود المُسلَّمة من الطلبيات الواردة في هذه الأيام، بما فيها القطع المجانية في عرضك.",

  // Breakeven CPA simulator
  "The numbers the formula uses, filled from the product details and this product's orders. Change any to try it; Reset to observed brings your data back.":
    "الأرقام التي تستعملها المعادلة، مأخوذة من تفاصيل المنتج ومن طلبيات هذا المنتج. غيِّر أي رقم لتجرّبه، وزر «الرجوع إلى أرقامك الفعلية» يُعيد بياناتك.",
  "Default model: a quick formula per order confirmed and shipped. Detailed model: per placed lead, with confirmation, shipping, lost parcels, packaging and delivery paid on returns too.":
    "النموذج الافتراضي: معادلة سريعة لكل طلبية مؤكَّدة ومُرسَلة. النموذج المفصَّل: لكل طلبية واردة، مع التأكيد والإرسال والطرود الضائعة والتغليف ورسوم التوصيل على المرتجَعة أيضًا.",
  "What the customer pays for one order, without delivery. With an offer, the price of the whole order. Example: 2900.":
    "ما يدفعه الزبون مقابل طلبية واحدة، بدون التوصيل. مع العرض، هو سعر الطلبية كاملة. مثال: 2900.",
  "What the goods of one order cost you. With Buy 1, get 1 free at 800 a piece, type 1600.":
    "كم تكلّفك سلع طلبية واحدة. مع «اشترِ 1 واحصل على 1 مجانًا» بسعر 800 للقطعة، اكتب 1600.",
  "What MDM charges to deliver one parcel. The default model counts it on delivered parcels only; the detailed model on every shipped parcel.":
    "ما يأخذه MDM لتوصيل طرد واحد. النموذج الافتراضي يحسبه على الطرود المُسلَّمة فقط، والمفصَّل على كل طرد مُرسَل.",
  "What you pay for each parcel that comes back (RTO). Counted on the returned share Q.": "ما تدفعه عن كل طرد يعود إليك (RTO). يُحسب على حصة المرتجَعة Q.",
  "What the call center charges for one order. The default model counts it once per order; the detailed model follows Call-center basis.":
    "ما يأخذه مركز الاتصال عن طلبية واحدة. النموذج الافتراضي يحسبه مرة لكل طلبية، والمفصَّل حسب «طريقة حساب مركز الاتصال».",
  "The % of shipped parcels that come back. Each costs the return fee R; in the detailed model its delivery and packaging too.":
    "نسبة الطرود المُرسَلة التي تعود. كل طرد منها يكلّف رسوم الإرجاع R، وفي النموذج المفصَّل رسوم توصيله وتغليفه أيضًا.",
  "Ticked, Q is worked out for you so the shares add up to 100%. Untick it to type your own return probability.":
    "عند التفعيل، تُحسب Q تلقائيًا ليكون مجموع النسب 100%. ألغِ التفعيل لتكتب احتمال الإرجاع بنفسك.",
  "The % of shipped parcels that never arrive and never come back. You lose the goods, the delivery fee and the packaging.":
    "نسبة الطرود المُرسَلة التي لا تصل ولا تعود. تخسر السلع ورسوم التوصيل والتغليف.",
  "Per placed lead: the call center is paid for every order that comes in. Per confirmed order: only for the orders it confirms.":
    "لكل طلبية واردة: يُدفع لمركز الاتصال عن كل طلبية تصل. لكل طلبية مؤكَّدة: فقط عن الطلبيات التي يؤكّدها.",
  "What you want to keep from each order after ads. Target CPA = breakeven CPA − this. Type 0 to only break even.":
    "ما تريد أن يبقى لك من كل طلبية بعد الإعلانات. CPA المستهدف = CPA نقطة التعادل − هذا الرقم. اكتب 0 لتكتفي بنقطة التعادل.",
  "What you pay in ads now: per confirmed order in the default model, per placed lead in the detailed one. Expected profit uses it.":
    "ما تدفعه في الإعلانات الآن: لكل طلبية مؤكَّدة في النموذج الافتراضي، ولكل طلبية واردة في المفصَّل. يُستعمل لحساب الربح المتوقَّع.",
  "The most you can pay per placed lead before losing money. Worked out as: confirmation rate × shipping rate × what a shipped parcel earns on average − call-center cost per lead.":
    "أقصى ما يمكنك دفعه لكل طلبية واردة قبل أن تخسر. يُحسب هكذا: نسبة التأكيد × نسبة الإرسال × ما يربحه الطرد المُرسَل في المتوسط − تكلفة مركز الاتصال لكل طلبية واردة.",
  "What the chosen model takes for granted. Change the model or the Q tick box above to change them.":
    "ما يفترضه النموذج المختار. غيِّر النموذج أو خانة Q أعلاه لتتغير هذه الافتراضات.",
  "Each cell is the expected profit if the delivery rate were the row's and you paid the column's CPA. Green earns, red loses; ● marks your delivery rate.":
    "كل خانة هي الربح المتوقَّع لو كانت نسبة التسليم هي نسبة السطر ودفعت CPA العمود. الأخضر ربح والأحمر خسارة، و● تُشير إلى نسبة تسليمك.",
  "Named copies of these inputs for this product. Tap a name to load its numbers back into the form.":
    "نُسخ محفوظة بأسماء من هذه المُدخلات لهذا المنتج. اضغط على اسم لتعود أرقامه إلى خانات المعادلة.",
};

export default ar;
