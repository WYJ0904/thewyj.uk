# Test-dependency Error Prone annotations reference the JDK compiler enum.
# Android has no javax.lang.model; this optional annotation is not executed.
# Applies only to the external instrumentation APK, never to the release app.
-dontwarn javax.lang.model.element.Modifier
