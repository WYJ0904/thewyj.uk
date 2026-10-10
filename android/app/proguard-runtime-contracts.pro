# Exact public references from FormalReleaseDeviceTest and AndroidJUnitRunner.
# Inferred using the pinned R8 TraceReferences; unrelated app code still shrinks.
# The public SDK omits Runner hidden APIs and an unused view-capture adapter;
# diagnostics are retained separately and acceptance requires actual hardware.
# No payment device-test gateway or exported component is retained.
-keep @interface androidx.annotation.ChecksSdkIntAtLeast {
  public int api();
  public int extension();
}
-keep @interface androidx.annotation.DoNotInline {
}
-keep @interface androidx.annotation.FloatRange {
  public double from();
  public double to();
}
-keep @interface androidx.annotation.GuardedBy {
  public java.lang.String value();
}
-keep @interface androidx.annotation.IntRange {
  public long from();
}
-keep @interface androidx.annotation.NonNull {
}
-keep @interface androidx.annotation.Nullable {
}
-keep @interface androidx.annotation.Px {
}
-keep @interface androidx.annotation.RequiresApi {
  public int value();
}
-keep enum androidx.annotation.RestrictTo$Scope {
  androidx.annotation.RestrictTo$Scope LIBRARY;
  androidx.annotation.RestrictTo$Scope LIBRARY_GROUP;
}
-keep @interface androidx.annotation.RestrictTo {
  public androidx.annotation.RestrictTo$Scope[] value();
}
-keep @interface androidx.annotation.VisibleForTesting {
}
-keep @interface androidx.compose.runtime.internal.StabilityInferred {
  public int parameters();
}
-keep class androidx.concurrent.futures.CallbackToFutureAdapter$Completer {
  public boolean set(java.lang.Object);
  public boolean setException(java.lang.Throwable);
}
-keep interface androidx.concurrent.futures.CallbackToFutureAdapter$Resolver {
  public java.lang.Object attachCompleter(androidx.concurrent.futures.CallbackToFutureAdapter$Completer);
}
-keep class androidx.concurrent.futures.CallbackToFutureAdapter {
  public static com.google.common.util.concurrent.ListenableFuture getFuture(androidx.concurrent.futures.CallbackToFutureAdapter$Resolver);
}
-keep enum androidx.lifecycle.Lifecycle$State {
  public static androidx.lifecycle.Lifecycle$State[] values();
  androidx.lifecycle.Lifecycle$State CREATED;
  androidx.lifecycle.Lifecycle$State DESTROYED;
  androidx.lifecycle.Lifecycle$State RESUMED;
  androidx.lifecycle.Lifecycle$State STARTED;
}
-keep class androidx.lifecycle.Lifecycle {
}
-keep class androidx.tracing.Trace {
  public static void beginSection(java.lang.String);
  public static void endSection();
  public static void forceEnableAppTracing();
}
-keep interface com.google.common.util.concurrent.ListenableFuture {
  public void addListener(java.lang.Runnable, java.util.concurrent.Executor);
}
-keep @interface kotlin.Deprecated {
  public java.lang.String message();
  public kotlin.ReplaceWith replaceWith();
}
-keep interface kotlin.Lazy {
  public java.lang.Object getValue();
}
-keep class kotlin.LazyKt {
}
-keep class kotlin.LazyKt__LazyJVMKt {
  public static kotlin.Lazy lazy(kotlin.jvm.functions.Function0);
}
-keep @interface kotlin.Metadata {
  public java.lang.String[] d1();
  public java.lang.String[] d2();
  public int k();
  public int[] mv();
  public int xi();
}
-keep class kotlin.Result$Companion {
}
-keep class kotlin.Result {
  public static java.lang.Object constructor-impl(java.lang.Object);
  kotlin.Result$Companion Companion;
}
-keep class kotlin.ResultKt {
  public static java.lang.Object createFailure(java.lang.Throwable);
  public static void throwOnFailure(java.lang.Object);
}
-keep class kotlin.Unit {
  kotlin.Unit INSTANCE;
}
-keep class kotlin.collections.ArraysKt {
}
-keep class kotlin.collections.ArraysKt___ArraysKt {
  public static java.lang.String joinToString$default(byte[], java.lang.CharSequence, java.lang.CharSequence, java.lang.CharSequence, int, java.lang.CharSequence, kotlin.jvm.functions.Function1, int, java.lang.Object);
}
-keep class kotlin.collections.CollectionsKt {
}
-keep class kotlin.collections.CollectionsKt___CollectionsKt {
  public static java.lang.String joinToString$default(java.lang.Iterable, java.lang.CharSequence, java.lang.CharSequence, java.lang.CharSequence, int, java.lang.CharSequence, kotlin.jvm.functions.Function1, int, java.lang.Object);
}
-keep interface kotlin.coroutines.Continuation {
  public void resumeWith(java.lang.Object);
}
-keep interface kotlin.coroutines.CoroutineContext {
}
-keep class kotlin.coroutines.intrinsics.IntrinsicsKt {
}
-keep class kotlin.coroutines.intrinsics.IntrinsicsKt__IntrinsicsJvmKt {
  public static kotlin.coroutines.Continuation intercepted(kotlin.coroutines.Continuation);
}
-keep class kotlin.coroutines.intrinsics.IntrinsicsKt__IntrinsicsKt {
  public static java.lang.Object getCOROUTINE_SUSPENDED();
}
-keep class kotlin.coroutines.jvm.internal.Boxing {
  public static java.lang.Integer boxInt(int);
  public static java.lang.Long boxLong(long);
}
-keep class kotlin.coroutines.jvm.internal.ContinuationImpl {
  public <init>(kotlin.coroutines.Continuation);
  protected java.lang.Object invokeSuspend(java.lang.Object);
}
-keep @interface kotlin.coroutines.jvm.internal.DebugMetadata {
  public java.lang.String c();
  public java.lang.String f();
  public int[] i();
  public int[] l();
  public java.lang.String m();
  public java.lang.String[] n();
  public java.lang.String[] s();
}
-keep class kotlin.coroutines.jvm.internal.DebugProbesKt {
  public static void probeCoroutineSuspended(kotlin.coroutines.Continuation);
}
-keep class kotlin.coroutines.jvm.internal.SpillingKt {
  public static java.lang.Object nullOutSpilledVariable(java.lang.Object);
}
-keep class kotlin.coroutines.jvm.internal.SuspendLambda {
  public <init>(int, kotlin.coroutines.Continuation);
  public kotlin.coroutines.Continuation create(java.lang.Object, kotlin.coroutines.Continuation);
  protected java.lang.Object invokeSuspend(java.lang.Object);
}
-keep class kotlin.io.CloseableKt {
  public static void closeFinally(java.io.Closeable, java.lang.Throwable);
}
-keep class kotlin.io.TextStreamsKt {
  public static java.lang.String readText(java.io.Reader);
}
-keep @interface kotlin.jvm.JvmName {
  public java.lang.String name();
}
-keep @interface kotlin.jvm.JvmStatic {
}
-keep interface kotlin.jvm.functions.Function0 {
  public java.lang.Object invoke();
}
-keep interface kotlin.jvm.functions.Function1 {
  public java.lang.Object invoke(java.lang.Object);
}
-keep interface kotlin.jvm.functions.Function2 {
  public java.lang.Object invoke(java.lang.Object, java.lang.Object);
}
-keep class kotlin.jvm.internal.DefaultConstructorMarker {
}
-keep class kotlin.jvm.internal.Intrinsics {
  public static boolean areEqual(java.lang.Object, java.lang.Object);
  public static void checkNotNull(java.lang.Object);
  public static void checkNotNull(java.lang.Object, java.lang.String);
  public static void checkNotNullExpressionValue(java.lang.Object, java.lang.String);
  public static void checkNotNullParameter(java.lang.Object, java.lang.String);
}
-keep class kotlin.jvm.internal.Lambda {
  public <init>(int);
}
-keep class kotlin.jvm.internal.Ref$ObjectRef {
  public <init>();
  java.lang.Object element;
}
-keep class kotlin.jvm.internal.Ref {
}
-keep @interface kotlin.jvm.internal.SourceDebugExtension {
  public java.lang.String[] value();
}
-keep class kotlin.jvm.internal.StringCompanionObject {
  kotlin.jvm.internal.StringCompanionObject INSTANCE;
}
-keep interface kotlin.sequences.Sequence {
  public java.util.Iterator iterator();
}
-keep class kotlin.text.Charsets {
  java.nio.charset.Charset UTF_8;
}
-keep class kotlin.text.StringsKt {
}
-keep class kotlin.text.StringsKt__StringsJVMKt {
  public static java.lang.String replace$default(java.lang.String, java.lang.String, java.lang.String, boolean, int, java.lang.Object);
}
-keep class kotlin.text.StringsKt__StringsKt {
  public static boolean contains$default(java.lang.CharSequence, java.lang.CharSequence, boolean, int, java.lang.Object);
  public static boolean isBlank(java.lang.CharSequence);
  public static kotlin.sequences.Sequence lineSequence(java.lang.CharSequence);
  public static java.util.List split$default(java.lang.CharSequence, char[], boolean, int, int, java.lang.Object);
}
-keep class kotlin.text.StringsKt___StringsKt {
  public static java.lang.String take(java.lang.String, int);
}
-keep class kotlin.time.Duration$Companion {
}
-keep class kotlin.time.Duration {
  kotlin.time.Duration$Companion Companion;
}
-keep class kotlin.time.DurationKt {
  public static long toDuration(int, kotlin.time.DurationUnit);
}
-keep enum kotlin.time.DurationUnit {
  kotlin.time.DurationUnit SECONDS;
}
-keep class kotlinx.coroutines.BuildersKt {
  public static java.lang.Object runBlocking$default(kotlin.coroutines.CoroutineContext, kotlin.jvm.functions.Function2, int, java.lang.Object);
  public static java.lang.Object runBlocking(kotlin.coroutines.CoroutineContext, kotlin.jvm.functions.Function2);
}
-keep interface kotlinx.coroutines.CancellableContinuation {
  public void resume(java.lang.Object, kotlin.jvm.functions.Function1);
}
-keep class kotlinx.coroutines.CancellableContinuationImpl {
  public <init>(kotlin.coroutines.Continuation, int);
  public java.lang.Object getResult();
  public void initCancellability();
}
-keep class kotlinx.coroutines.CoroutineDispatcher {
}
-keep interface kotlinx.coroutines.CoroutineScope {
}
-keep class kotlinx.coroutines.Dispatchers {
  public static kotlinx.coroutines.MainCoroutineDispatcher getMain();
}
-keep class kotlinx.coroutines.ExecutorsKt {
  public static kotlinx.coroutines.CoroutineDispatcher from(java.util.concurrent.Executor);
}
-keep class kotlinx.coroutines.MainCoroutineDispatcher {
}
-keep class kotlinx.coroutines.TimeoutKt {
  public static java.lang.Object withTimeout-KLykuaI(long, kotlin.jvm.functions.Function2, kotlin.coroutines.Continuation);
}
-keep @interface org.jetbrains.annotations.NotNull {
}
-keep @interface org.jetbrains.annotations.Nullable {
}
-keep class uk.thewyj.app.MainActivity {
}
-keep class uk.thewyj.app.core.auth.AccountSnapshot {
  public java.util.Set getEntitlements();
  public java.lang.String getId();
  public boolean isAdmin();
}
-keep class uk.thewyj.app.core.auth.DeviceCredentials {
  public static uk.thewyj.app.core.auth.DeviceCredentials copy$default(uk.thewyj.app.core.auth.DeviceCredentials, java.lang.String, long, java.lang.String, long, java.lang.String, uk.thewyj.app.core.auth.AccountSnapshot, java.lang.String, int, java.lang.Object);
  public long getAccessExpiresAtEpochMs();
  public java.lang.String getAccessToken();
  public uk.thewyj.app.core.auth.AccountSnapshot getAccount();
}
-keep class uk.thewyj.app.core.auth.DeviceIdentityStore {
  public <init>(android.content.Context);
  public java.lang.String getOrCreate();
}
-keep class uk.thewyj.app.core.auth.SecureCredentialStore {
  public <init>(android.content.Context, java.lang.String);
  public <init>(android.content.Context, java.lang.String, int, kotlin.jvm.internal.DefaultConstructorMarker);
  public uk.thewyj.app.core.auth.DeviceCredentials loadActive();
  public void saveActive(uk.thewyj.app.core.auth.DeviceCredentials);
}
-keep class uk.thewyj.app.core.network.ApiCall$Success {
  public java.lang.Object getValue();
}
-keep interface uk.thewyj.app.core.network.ApiCall {
}
-keep class uk.thewyj.app.core.network.ThewyjApiClient {
  public <init>(java.lang.String, int, kotlin.jvm.internal.DefaultConstructorMarker);
  public java.lang.Object currentAccount(java.lang.String, kotlin.coroutines.Continuation);
  public java.lang.Object login(java.lang.String, java.lang.String, java.lang.String, kotlin.coroutines.Continuation);
  public java.lang.Object refresh(uk.thewyj.app.core.auth.DeviceCredentials, java.lang.String, java.lang.String, kotlin.coroutines.Continuation);
  public java.lang.Object register(java.lang.String, java.lang.String, kotlin.coroutines.Continuation);
}
-keep enum uk.thewyj.app.task21.FinanceDirection {
  uk.thewyj.app.task21.FinanceDirection EXPENSE;
}
-keep class uk.thewyj.app.task21.NotificationCaptureCoordinator$CaptureAccount {
  public java.lang.String getAccountId();
}
-keep class uk.thewyj.app.task21.NotificationCaptureCoordinator {
}
-keep class uk.thewyj.app.task21.NotificationSessionProvider {
  public <init>(android.content.Context);
  public uk.thewyj.app.task21.NotificationCaptureCoordinator$CaptureAccount currentAccount();
}
-keep class uk.thewyj.app.task21.payment.AndroidPaymentRecognitionHook$Companion {
  public uk.thewyj.app.task21.payment.AndroidPaymentRecognitionHook get(android.content.Context);
}
-keep class uk.thewyj.app.task21.payment.AndroidPaymentRecognitionHook {
  public uk.thewyj.app.task21.payment.EnrichmentOutcome onAccessibilityEnrichment(java.lang.String, uk.thewyj.app.task21.payment.PaymentEnrichment, java.lang.String);
  uk.thewyj.app.task21.payment.AndroidPaymentRecognitionHook$Companion Companion;
}
-keep class uk.thewyj.app.task21.payment.AndroidPaymentStatusNotifier {
  public <init>(android.content.Context);
}
-keep class uk.thewyj.app.task21.payment.EnrichmentOutcome$Rejected {
}
-keep interface uk.thewyj.app.task21.payment.EnrichmentOutcome {
}
-keep class uk.thewyj.app.task21.payment.LocalPaymentBooking {
  public long getAmountMinor();
  public java.lang.String getDirection();
  public java.lang.String getRecognitionId();
  public java.lang.String getSyncState();
  public java.lang.String getTransactionId();
}
-keep class uk.thewyj.app.task21.payment.PaymentAccessibilityStatus {
  public boolean getConnected();
  uk.thewyj.app.task21.payment.PaymentAccessibilityStatus INSTANCE;
}
-keep class uk.thewyj.app.task21.payment.PaymentEnrichment {
  public <init>(java.lang.String, java.lang.Long, java.lang.String, uk.thewyj.app.task21.FinanceDirection, java.lang.String, java.lang.String, java.lang.String, java.lang.Long, int, uk.thewyj.app.task21.payment.PaymentEvidenceSource, int, kotlin.jvm.internal.DefaultConstructorMarker);
}
-keep enum uk.thewyj.app.task21.payment.PaymentEvidenceSource {
}
-keep class uk.thewyj.app.task21.payment.PaymentRecognitionCoordinator$Outcome {
  public java.lang.String getRecognitionId();
  public java.lang.String getTicketId();
}
-keep class uk.thewyj.app.task21.payment.PaymentRecognitionCoordinator {
  public <init>(uk.thewyj.app.task21.store.PaymentRecognitionStoreContract, uk.thewyj.app.task21.payment.PaymentTicketEngine, uk.thewyj.app.task21.payment.PaymentStatusStateMachine, uk.thewyj.app.task21.payment.PaymentStatusNotifier, kotlin.jvm.functions.Function0, int, kotlin.jvm.internal.DefaultConstructorMarker);
  public static uk.thewyj.app.task21.payment.PaymentRecognitionCoordinator$Outcome onSourceEvent$default(uk.thewyj.app.task21.payment.PaymentRecognitionCoordinator, java.lang.String, java.lang.String, uk.thewyj.app.task21.payment.PaymentSourceType, java.lang.String, java.lang.String, java.lang.String, java.lang.String, java.lang.String, java.lang.String, java.lang.String, long, int, java.lang.Object);
}
-keep class uk.thewyj.app.task21.payment.PaymentRecognitionRecord {
  public int getNotificationId();
}
-keep enum uk.thewyj.app.task21.payment.PaymentSourceType {
  uk.thewyj.app.task21.payment.PaymentSourceType NOTIFICATION;
}
-keep interface uk.thewyj.app.task21.payment.PaymentStatusNotifier {
}
-keep class uk.thewyj.app.task21.payment.PaymentStatusStateMachine {
}
-keep class uk.thewyj.app.task21.payment.PaymentTicketEngine {
}
-keep class uk.thewyj.app.task21.payment.PaymentTicketPackageSignal {
  public static void publish$default(uk.thewyj.app.task21.payment.PaymentTicketPackageSignal, java.lang.String, long, int, java.lang.Object);
  uk.thewyj.app.task21.payment.PaymentTicketPackageSignal INSTANCE;
}
-keep class uk.thewyj.app.task21.store.NotificationDatabase$Companion {
  public uk.thewyj.app.task21.store.NotificationDatabase get(android.content.Context);
}
-keep class uk.thewyj.app.task21.store.NotificationDatabase {
  uk.thewyj.app.task21.store.NotificationDatabase$Companion Companion;
}
-keep interface uk.thewyj.app.task21.store.PaymentRecognitionStoreContract {
}
-keep class uk.thewyj.app.task21.store.RoomPaymentRecognitionStore {
  public <init>(uk.thewyj.app.task21.store.NotificationDatabase);
  public java.util.List localBookings(java.lang.String);
  public uk.thewyj.app.task21.payment.PaymentRecognitionRecord recognition(java.lang.String, java.lang.String);
}
