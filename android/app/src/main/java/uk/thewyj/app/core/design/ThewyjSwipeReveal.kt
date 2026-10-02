package uk.thewyj.app.core.design

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.snap
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

private class SwipeSettling { var job: Job? = null }

object ThewyjSwipePolicy {
    fun clamp(offset: Float, extent: Float, direction: Float): Float =
        if (direction < 0) offset.coerceIn(-extent, 0f) else offset.coerceIn(0f, extent)
    fun revealed(offset: Float, extent: Float): Boolean = kotlin.math.abs(offset) >= extent * 0.5f
}

/** A reveal affordance only. It never deletes data or changes row order. */
@Composable
fun ThewyjSwipeReveal(
    identity: String,
    revealed: Boolean,
    onReveal: (Boolean) -> Unit,
    onThreshold: () -> Unit,
    actions: @Composable RowScope.() -> Unit,
    content: @Composable BoxScope.() -> Unit,
) {
    val width = 80.dp
    val extent = with(LocalDensity.current) { width.toPx() }
    val direction = if (LocalLayoutDirection.current == LayoutDirection.Ltr) -1f else 1f
    var offset by remember(identity) { mutableFloatStateOf(0f) }
    val animation = remember(identity) { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val settling = remember(identity) { SwipeSettling() }
    val currentReveal by rememberUpdatedState(revealed)
    val revealCallback by rememberUpdatedState(onReveal)
    val thresholdCallback by rememberUpdatedState(onThreshold)
    val reduced by rememberUpdatedState(LocalThewyjReducedMotion.current)
    fun settle(open: Boolean) {
        settling.job?.cancel()
        settling.job = scope.launch {
            animation.snapTo(offset)
            animation.animateTo(if (open) direction * extent else 0f,
                animationSpec = if (reduced) snap() else ThewyjMotionSpecs.fastSpatial()) { offset = value }
        }
    }
    LaunchedEffect(revealed, extent, direction) { settle(revealed) }
    BackHandler(revealed) { revealCallback(false); settle(false) }
    Box(Modifier.fillMaxWidth().clipToBounds()) {
        if (offset != 0f || revealed) {
            Row(Modifier.align(Alignment.CenterEnd).width(width), verticalAlignment = Alignment.CenterVertically, content = actions)
        }
        Box(Modifier.fillMaxWidth().graphicsLayer { translationX = offset }
            .pointerInput(identity, extent, direction) {
                var thresholdSent = false
                detectHorizontalDragGestures(
                    onDragStart = { settling.job?.cancel(); thresholdSent = false },
                    onHorizontalDrag = { change, distance ->
                        change.consume()
                        offset = ThewyjSwipePolicy.clamp(offset + distance, extent, direction)
                        if (!thresholdSent && ThewyjSwipePolicy.revealed(offset, extent)) {
                            thresholdSent = true; thresholdCallback()
                        }
                    },
                    onDragEnd = { val open = ThewyjSwipePolicy.revealed(offset, extent); revealCallback(open); settle(open) },
                    onDragCancel = { settle(currentReveal) },
                )
            }, content = content)
    }
}
