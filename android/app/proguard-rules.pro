-keepattributes *Annotation*
-dontwarn org.json.**

# Room generates the database implementation reflectively; keep the generated
# classes and the entities they reference.
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Entity class *
-dontwarn androidx.room.paging.**

# WorkManager instantiates workers by class name from its own metadata.
-keep class * extends androidx.work.ListenableWorker
-keep class androidx.work.** { *; }
-dontwarn androidx.work.**

# The notification listener, accessibility service and SMS receiver are started
# by the system from the manifest.
-keep class uk.thewyj.app.task21.ThewyjNotificationListenerService { *; }
-keep class uk.thewyj.app.task21.payment.ThewyjPaymentAccessibilityService { *; }
-keep class uk.thewyj.app.task21.payment.BankSmsReceiver { *; }

# ML Kit discovers these registrars by class name from manifest metadata. R8
# may keep the class name but remove its no-arg constructor, which makes the
# bundled OCR graph initialize without a TextRecognizer at runtime.
-keep class com.google.mlkit.common.internal.CommonComponentRegistrar { public <init>(); }
-keep class com.google.mlkit.vision.common.internal.VisionCommonRegistrar { public <init>(); }
-keep class com.google.mlkit.vision.text.internal.TextRegistrar { public <init>(); }
