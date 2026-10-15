import type { Dict } from "../core";

/**
 * Arabic for the fixed messages the server sends back when something can't be done; the toast shows
 * them through errorMessage (src/lib/trpc/client.tsx). Messages with numbers or names in them stay
 * English for now.
 */
const ar: Dict = {
  // src/server/trpc/init.ts
  "Please sign in": "سجّل الدخول من فضلك",
  "You do not have access to this workspace": "ليس لديك وصول إلى مساحة العمل هذه",
  "You are not a member of any workspace": "لست عضوًا في أي مساحة عمل",
  "Something went wrong. The error was logged.": "حدث خطأ ما. تم تسجيل الخطأ.",
  "A record with the same unique value already exists": "يوجد سجل بنفس القيمة من قبل",
  "A workspace must keep at least one owner": "يجب أن تحتفظ مساحة العمل بمالك واحد على الأقل",

  // Not found
  "Product not found": "المنتج غير موجود",
  "Order not found": "الطلبية غير موجودة",
  "Sync job not found": "المزامنة غير موجودة",
  "Repeating expense not found": "المصروف المتكرر غير موجود",
  "Meta token not found": "رمز Meta غير موجود",
  "Import not found": "الملف المستورد غير موجود",
  "Ad account not found": "الحساب الإعلاني غير موجود",
  "Member not found": "العضو غير موجود",
  "Expense not found": "المصروف غير موجود",
  "Creative not found": "الإعلان غير موجود",
  "Category not found": "الفئة غير موجودة",
  "Campaign not found": "الحملة غير موجودة",
  "Bank row not found": "سطر البنك غير موجود",
  "Scenario not found": "السيناريو غير موجود",
  "Record not found": "السجل غير موجود",
  "Parcel not found": "الطرد غير موجود",
  "MDM product not found": "منتج MDM غير موجود",
  "No unmatched spend for that creative ID": "لا يوجد إنفاق غير مربوط بمعرّف الإعلان هذا",
  "No parcel with that tracking ID in this workspace": "لا يوجد طرد برقم التتبع هذا في مساحة العمل هذه",
  "No account with that email. Ask them to sign up first, then add them here.": "لا يوجد حساب بهذا البريد. اطلب منه التسجيل أولًا، ثم أضفه هنا.",
  "Choose a product for a product-specific expense": "اختر منتجًا للمصروف الخاص بمنتج",
  "Choose a product": "اختر منتجًا",

  // Money and inputs
  "Quantity must be an integer": "يجب أن تكون الكمية عددًا صحيحًا",
  "Exchange rate must be greater than zero": "يجب أن يكون سعر الصرف أكبر من صفر",
  "Amount is not a finite number": "المبلغ ليس رقمًا صالحًا",
  "You can have up to 100 categories of your own.": "يمكنك إنشاء 100 فئة خاصة بك كحد أقصى.",
  "Wait for this sync to finish first": "انتظر حتى تنتهي هذه المزامنة أولًا",
  "This sync already finished": "انتهت هذه المزامنة من قبل",
  "This spend has no usable creative ID": "هذا الإنفاق ليس له معرّف إعلان صالح",
  "This row was already reviewed. Reopen it first.": "تمت مراجعة هذا السطر من قبل. أعد فتحه أولًا.",
  "This custom sync's choices could not be read. Start a new custom sync.": "تعذّرت قراءة اختيارات هذه المزامنة المخصَّصة. ابدأ مزامنة مخصَّصة جديدة.",
  "The last day must be after the first day.": "يجب أن يكون اليوم الأخير بعد اليوم الأول.",
  "The last day must be after the first day": "يجب أن يكون اليوم الأخير بعد اليوم الأول",
  "The file has a header row but no data rows": "الملف فيه سطر العناوين فقط ولا توجد بيانات",
  "Pick at least one column you can export.": "اختر عمودًا واحدًا على الأقل يمكنك تصديره.",
  "Pick a creative or create one": "اختر إعلانًا أو أنشئ واحدًا",
  "Only money going out can become an expense. Exclude incoming transfers instead.": "المال الخارج فقط يمكن أن يصبح مصروفًا. استبعد التحويلات الواردة بدلًا من ذلك.",
  "Enter a status": "أدخل حالة",

  // MDM and Meta connections
  "Use the MDM host name, not an IP address": "استعمل اسم موقع MDM، وليس عنوان IP",
  "The MDM host resolves to a private address and was blocked": "عنوان MDM يشير إلى عنوان خاص وتم حظره",
  "The MDM URL must use https": "يجب أن يبدأ رابط MDM بـ https",
  "The MDM URL must not contain credentials": "يجب ألا يحتوي رابط MDM على بيانات الدخول",
  "The MDM URL must not contain a query or fragment": "يجب ألا يحتوي رابط MDM على ? أو #",
  "Custom ports are not allowed for the MDM URL": "لا يُسمح بمنفذ خاص في رابط MDM",
  "Enter a valid URL, for example https://api.mdm.express": "أدخل رابطًا صالحًا، مثلًا https://api.mdm.express",
  "That does not look like an MDM API key": "هذا لا يبدو مفتاح API لـ MDM",
  "That does not look like a Meta access token": "هذا لا يبدو رمز وصول Meta",
  "Paste a Meta access token": "الصق رمز وصول Meta",
  "Save an MDM API key in Settings first": "احفظ مفتاح API لـ MDM في الإعدادات أولًا",
  "Save an MDM API key first": "احفظ مفتاح API لـ MDM أولًا",
  "Save a Meta access token in Settings first": "احفظ رمز وصول Meta في الإعدادات أولًا",
  "Run a successful connection test in Settings before syncing": "قم باختبار اتصال ناجح في الإعدادات قبل المزامنة",
  "Run a successful connection test before syncing": "قم باختبار اتصال ناجح قبل المزامنة",
  "An MDM sync is running. Wait for it to finish, or cancel it on the MDM sync page, then try again.":
    "مزامنة MDM قيد التشغيل. انتظر حتى تنتهي أو ألغها من صفحة مزامنة MDM، ثم حاول مرة أخرى.",
  "A Meta spend sync is running. Wait a minute for it to finish, then try again.": "مزامنة إنفاق Meta قيد التشغيل. انتظر دقيقة حتى تنتهي، ثم حاول مرة أخرى.",
  "The key that encrypted this credential is not configured. Re-enter the credential.": "مفتاح التشفير الخاص بهذا الرمز غير مضبوط. أعد إدخال الرمز.",
  "Stored credential could not be decrypted. Re-enter the credential.": "تعذّر فك تشفير الرمز المحفوظ. أعد إدخاله.",
};

export default ar;
