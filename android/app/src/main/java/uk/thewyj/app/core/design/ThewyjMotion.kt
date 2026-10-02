package uk.thewyj.app.core.design

import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonElevation
import androidx.compose.material3.IconButtonColors
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest

object ThewyjMotion {
    const val PressedMillis = 80
    const val FastMillis = 140
    const val ExpandMillis = 200
    const val PageMillis = 220
    const val SheetMillis = 280
    const val PressedScale = 0.985f
    const val PressedOpacity = 0.92f
    val StandardEasing = CubicBezierEasing(0.2f, 0f, 0f, 1f)
    fun releaseDelay(started: Long, now: Long): Long = (PressedMillis - (now - started).coerceAtLeast(0)).coerceAtLeast(0)
}

val LocalThewyjReducedMotion = compositionLocalOf { false }

@Composable
fun rememberThewyjReducedMotion(): Boolean {
    val context = LocalContext.current.applicationContext
    fun read() = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    var reduced by remember(context) { mutableStateOf(read()) }
    DisposableEffect(context) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) { reduced = read() }
        }
        context.contentResolver.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, observer)
        onDispose { context.contentResolver.unregisterContentObserver(observer) }
    }
    return reduced
}

object ThewyjMotionSpecs {
    fun <T> spatial(): FiniteAnimationSpec<T> = spring(dampingRatio = 1f, stiffness = 650f)
    fun <T> fastSpatial(): FiniteAnimationSpec<T> = spring(dampingRatio = 1f, stiffness = 900f)
    fun <T> effects(): FiniteAnimationSpec<T> = tween(ThewyjMotion.ExpandMillis, easing = ThewyjMotion.StandardEasing)
}

enum class ThewyjHapticEvent { Destination, Tab, SwipeThreshold, LongPressSelection, ImportantToggle, Confirmation }

/** No progress/scroll event exists. Use normal View feedback so system disable is respected. */
class ThewyjHapticPolicy(private val now: () -> Long = SystemClock::uptimeMillis) {
    private var last = Long.MIN_VALUE
    fun perform(view: View, event: ThewyjHapticEvent): Boolean {
        val at = now()
        if (last != Long.MIN_VALUE && at - last < 80) return false
        val kind = when (event) {
            ThewyjHapticEvent.Destination, ThewyjHapticEvent.Tab -> HapticFeedbackConstants.CLOCK_TICK
            ThewyjHapticEvent.SwipeThreshold -> HapticFeedbackConstants.CONTEXT_CLICK
            ThewyjHapticEvent.LongPressSelection -> HapticFeedbackConstants.LONG_PRESS
            ThewyjHapticEvent.ImportantToggle -> HapticFeedbackConstants.VIRTUAL_KEY
            ThewyjHapticEvent.Confirmation -> HapticFeedbackConstants.CONFIRM
        }
        last = at
        return view.performHapticFeedback(kind)
    }
}

@Composable
fun Modifier.thewyjPressedFeedback(source: MutableInteractionSource, surfaceOnly: Boolean = false): Modifier {
    var pressed by remember(source) { mutableStateOf(false) }
    var started by remember(source) { mutableStateOf(0L) }
    LaunchedEffect(source) {
        source.interactions.collectLatest { interaction ->
            when (interaction) {
                is PressInteraction.Press -> { started = SystemClock.uptimeMillis(); pressed = true }
                is PressInteraction.Release -> { delay(ThewyjMotion.releaseDelay(started, SystemClock.uptimeMillis())); pressed = false }
                is PressInteraction.Cancel -> pressed = false
            }
        }
    }
    val reduced = LocalThewyjReducedMotion.current
    val scale = animateFloatAsState(
        targetValue = if (pressed && !surfaceOnly && !reduced) ThewyjMotion.PressedScale else 1f,
        animationSpec = if (reduced) snap() else if (pressed) tween(ThewyjMotion.PressedMillis, easing = ThewyjMotion.StandardEasing) else spring(dampingRatio = 1f, stiffness = 900f),
        label = "control-pressed-scale",
    )
    val opacity = animateFloatAsState(
        targetValue = if (pressed) ThewyjMotion.PressedOpacity else 1f,
        animationSpec = if (reduced) snap() else tween(ThewyjMotion.PressedMillis, easing = ThewyjMotion.StandardEasing),
        label = "control-pressed-opacity",
    )
    return graphicsLayer { scaleX = scale.value; scaleY = scale.value; alpha = opacity.value }
}

@Composable
fun ThewyjButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    shape: Shape = ButtonDefaults.shape, colors: ButtonColors = ButtonDefaults.buttonColors(),
    elevation: ButtonElevation? = ButtonDefaults.buttonElevation(), border: BorderStroke? = null,
    contentPadding: PaddingValues = ButtonDefaults.ContentPadding, interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) {
    val source = interactionSource ?: remember { MutableInteractionSource() }
    androidx.compose.material3.Button(onClick, modifier.thewyjPressedFeedback(source), enabled, shape, colors, elevation, border, contentPadding, source, content)
}

@Composable
fun ThewyjOutlinedButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    shape: Shape = ButtonDefaults.outlinedShape, colors: ButtonColors = ButtonDefaults.outlinedButtonColors(),
    elevation: ButtonElevation? = null, border: BorderStroke? = ButtonDefaults.outlinedButtonBorder(enabled),
    contentPadding: PaddingValues = ButtonDefaults.ContentPadding, interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) {
    val source = interactionSource ?: remember { MutableInteractionSource() }
    androidx.compose.material3.OutlinedButton(onClick, modifier.thewyjPressedFeedback(source), enabled, shape, colors, elevation, border, contentPadding, source, content)
}

@Composable
fun ThewyjTextButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    shape: Shape = ButtonDefaults.textShape, colors: ButtonColors = ButtonDefaults.textButtonColors(),
    elevation: ButtonElevation? = null, border: BorderStroke? = null,
    contentPadding: PaddingValues = ButtonDefaults.TextButtonContentPadding, interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) {
    val source = interactionSource ?: remember { MutableInteractionSource() }
    androidx.compose.material3.TextButton(onClick, modifier.thewyjPressedFeedback(source), enabled, shape, colors, elevation, border, contentPadding, source, content)
}

@Composable
fun ThewyjIconButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    colors: IconButtonColors = IconButtonDefaults.iconButtonColors(), interactionSource: MutableInteractionSource? = null,
    content: @Composable () -> Unit,
) {
    val source = interactionSource ?: remember { MutableInteractionSource() }
    androidx.compose.material3.IconButton(onClick = onClick, modifier = modifier.thewyjPressedFeedback(source), enabled = enabled, colors = colors, interactionSource = source, content = content)
}
