package uk.thewyj.app.core.design

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object ThewyjColors {
    val Canvas = Color(0xFFF3F2EF)
    val Surface = Color(0xFFFFFFFF)
    val SurfaceSubtle = Color(0xFFF8FAFC)
    val Text = Color(0xFF18212F)
    val TextSecondary = Color(0xFF475569)
    val Border = Color(0xFFD8DEE7)
    val Brand = Color(0xFF2563EB)
    val BrandPressed = Color(0xFF1E40AF)
    val BrandSoft = Color(0xFFEDF4FF)
    val Success = Color(0xFF147A46)
    val SuccessSoft = Color(0xFFEAF8F0)
    val Warning = Color(0xFF9A5708)
    val WarningSoft = Color(0xFFFFF5DE)
    val Error = Color(0xFFC23333)
    val ErrorSoft = Color(0xFFFFF0F0)

    val DarkCanvas = Color(0xFF161715)
    val DarkSurface = Color(0xFF1B1E24)
    val DarkSurfaceSubtle = Color(0xFF22262D)
    val DarkText = Color(0xFFF4F6F8)
    val DarkTextSecondary = Color(0xFFCBD2DC)
    val DarkBorder = Color(0xFF363D48)
}

object ThewyjSpacing {
    val Xs = 4.dp
    val Sm = 8.dp
    val Md = 12.dp
    val Lg = 16.dp
    val Xl = 24.dp
    val Xxl = 32.dp
}

object ThewyjRadius {
    val Small = RoundedCornerShape(6.dp)
    val Medium = RoundedCornerShape(8.dp)
    val Large = RoundedCornerShape(12.dp)
}

object ThewyjTouch {
    val Minimum = 48.dp
}

private val LightColors = lightColorScheme(
    primary = ThewyjColors.Brand,
    onPrimary = Color.White,
    primaryContainer = ThewyjColors.BrandSoft,
    onPrimaryContainer = ThewyjColors.BrandPressed,
    background = ThewyjColors.Canvas,
    onBackground = ThewyjColors.Text,
    surface = ThewyjColors.Surface,
    onSurface = ThewyjColors.Text,
    surfaceVariant = ThewyjColors.SurfaceSubtle,
    onSurfaceVariant = ThewyjColors.TextSecondary,
    outline = ThewyjColors.Border,
    error = ThewyjColors.Error,
    onError = Color.White,
    errorContainer = ThewyjColors.ErrorSoft,
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF8CB4FF),
    onPrimary = Color(0xFF072F70),
    primaryContainer = Color(0xFF183B71),
    onPrimaryContainer = Color(0xFFDCE8FF),
    background = ThewyjColors.DarkCanvas,
    onBackground = ThewyjColors.DarkText,
    surface = ThewyjColors.DarkSurface,
    onSurface = ThewyjColors.DarkText,
    surfaceVariant = ThewyjColors.DarkSurfaceSubtle,
    onSurfaceVariant = ThewyjColors.DarkTextSecondary,
    outline = ThewyjColors.DarkBorder,
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF551219),
)

private val ThewyjTypography = Typography(
    displaySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 36.sp,
        lineHeight = 42.sp,
    ),
    headlineMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 26.sp,
        lineHeight = 34.sp,
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 20.sp,
        lineHeight = 28.sp,
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 24.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontSize = 16.sp,
        lineHeight = 25.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontSize = 14.sp,
        lineHeight = 22.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
)

@Composable
fun ThewyjTheme(
    darkTheme: Boolean,
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = ThewyjTypography,
        shapes = androidx.compose.material3.Shapes(
            extraSmall = ThewyjRadius.Small,
            small = ThewyjRadius.Medium,
            medium = ThewyjRadius.Large,
            large = ThewyjRadius.Large,
        ),
        content = content,
    )
}

@Composable
fun ThewyjCard(
    modifier: Modifier = Modifier,
    shape: Shape = ThewyjRadius.Large,
    content: @Composable () -> Unit,
) {
    Card(
        modifier = modifier,
        shape = shape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) { content() }
}

@Composable
fun ThewyjPrimaryButton(
    text: @Composable () -> Unit,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    contentPadding: PaddingValues = ButtonDefaults.ContentPadding,
) {
    Button(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        shape = ThewyjRadius.Medium,
        contentPadding = contentPadding,
        content = { text() },
    )
}

fun statusContainerColor(colorScheme: ColorScheme, kind: String): Color = when (kind) {
    "success" -> if (colorScheme.background == ThewyjColors.Canvas) ThewyjColors.SuccessSoft else Color(0xFF153626)
    "warning" -> if (colorScheme.background == ThewyjColors.Canvas) ThewyjColors.WarningSoft else Color(0xFF3C2B12)
    "error" -> colorScheme.errorContainer
    else -> colorScheme.primaryContainer
}

fun statusContentColor(colorScheme: ColorScheme, kind: String): Color = when (kind) {
    "success" -> if (colorScheme.background == ThewyjColors.Canvas) ThewyjColors.Success else Color(0xFF78D8A7)
    "warning" -> if (colorScheme.background == ThewyjColors.Canvas) ThewyjColors.Warning else Color(0xFFF0C674)
    "error" -> colorScheme.error
    else -> colorScheme.onPrimaryContainer
}
