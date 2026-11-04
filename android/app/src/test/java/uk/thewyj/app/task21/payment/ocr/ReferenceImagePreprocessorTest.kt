package uk.thewyj.app.task21.payment.ocr

import android.graphics.Bitmap
import android.graphics.Color
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = android.app.Application::class)
class ReferenceImagePreprocessorTest {
    @Test fun paddingClampsToFrameWithoutChangingTheInputBox() {
        val box = ReferenceBox(3, 5, 90, 20)
        assertEquals(ReferenceBox(0, 0, 100, 35), ReferenceImagePreprocessor.padded(box, 100, 80))
        assertEquals(ReferenceBox(3, 5, 90, 20), box)
        assertNull(ReferenceImagePreprocessor.padded(ReferenceBox(-1, 0, 90, 20), 100, 80))
    }

    @Test fun symbolsMustReconstructTheRawLineBeforeLabelIsRemoved() {
        val line = ReferenceLine("交易号 A0O123", ReferenceBox(10, 10, 200, 40))
        val symbols = "交易号A0O123".mapIndexed { i, c -> ReferenceLine(c.toString(), ReferenceBox(10 + i * 15, 10, 25 + i * 15, 40)) }
        assertEquals(ReferenceBox(55, 10, 145, 40), ReferenceImagePreprocessor.valueBox(line, symbols))
        assertNull(ReferenceImagePreprocessor.valueBox(line, symbols.dropLast(1)))
        assertNull(ReferenceImagePreprocessor.valueBox(line, emptyList()))
    }

    @Test fun valuePaddingDoesNotRecaptureTheNeighboringLabel() {
        assertEquals(ReferenceBox(252, 780, 908, 924),
            ReferenceImagePreprocessor.paddedValue(ReferenceBox(260, 828, 900, 876), 1080, 2200))
    }

    @Test fun transformsOwnPixelsAndNeverRecycleCallerBitmap() {
        val source = Bitmap.createBitmap(100, 60, Bitmap.Config.ARGB_8888)
        source.eraseColor(Color.WHITE)
        for (y in 15..40) for (x in 15..70) source.setPixel(x, y, Color.BLACK)
        for (treatment in ReferenceImagePreprocessor.Treatment.entries) {
            val image = ReferenceImagePreprocessor.render(source, ReferenceBox(0, 0, 100, 60), 26, treatment)
            assertNotSame(source, image)
            assertFalse(source.isRecycled)
            image.recycle()
            assertEquals(Color.BLACK, source.getPixel(30, 30))
        }
        source.recycle()
    }

    @Test fun transparentPixelsAreCompositedBeforeThresholding() {
        val source = Bitmap.createBitmap(40, 40, Bitmap.Config.ARGB_8888)
        source.eraseColor(Color.TRANSPARENT)
        val image = ReferenceImagePreprocessor.render(source, ReferenceBox(0, 0, 40, 40), 20, ReferenceImagePreprocessor.Treatment.GRAY)
        assertEquals(Color.WHITE, image.getPixel(20, 20))
        image.recycle(); source.recycle()
    }
}
