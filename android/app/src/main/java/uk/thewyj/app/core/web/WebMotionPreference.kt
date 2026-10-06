package uk.thewyj.app.core.web

/** Non-sensitive presentation preference; never replaces browser media state. */
internal fun webReducedMotionScript(reduced: Boolean): String = """
    (() => {
      const root = document.documentElement;
      if (!root || root.dataset.androidReducedMotion === '$reduced') return;
      root.dataset.androidReducedMotion = '$reduced';
      document.dispatchEvent(new CustomEvent('thewyj:reduced-motion'));
    })();
""".trimIndent()
