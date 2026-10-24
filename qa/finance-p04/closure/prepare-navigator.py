"""Build a separate UI test process; it cannot restart the finance app's services."""
from pathlib import Path
import argparse,hashlib,json,os,re,shutil,subprocess
ROOT=Path(__file__).resolve().parents[3]
parser=argparse.ArgumentParser();parser.add_argument('--name',default='navigator');args=parser.parse_args();assert re.fullmatch('[a-z0-9-]+',args.name)
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'/args.name
OUT.mkdir(exist_ok=False)
files={
 'settings.gradle':"pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\ndependencyResolutionManagement { repositories { google(); mavenCentral() } }\nrootProject.name='FinanceClosureNavigator'\ninclude ':app'\n",
 'build.gradle':"plugins { id 'com.android.application' version '9.2.1' apply false }\n",
 'gradle.properties':'android.useAndroidX=true\norg.gradle.jvmargs=-Xmx2g -Dfile.encoding=COMPAT\n',
 'local.properties':'sdk.dir=C:/Users/78252/AppData/Local/Android/Sdk\n',
 'app/build.gradle':"""plugins { id 'com.android.application' }
android { namespace 'uk.thewyj.app.qa.financep04navigator'; compileSdk 36
 defaultConfig { applicationId 'uk.thewyj.app.qa.financep04navigator'; minSdk 30; targetSdk 36; versionCode 1; versionName 'qa1'; testInstrumentationRunner 'uk.thewyj.app.qa.financep04navigator.NavigatorRunner' }
 compileOptions { sourceCompatibility JavaVersion.VERSION_17; targetCompatibility JavaVersion.VERSION_17 }
}
dependencies { implementation 'com.google.mlkit:text-recognition-chinese:16.0.1'; androidTestImplementation 'androidx.test:runner:1.7.0'; androidTestImplementation 'androidx.test.ext:junit:1.3.0' }
""",
 'app/src/main/AndroidManifest.xml':'<manifest xmlns:android="http://schemas.android.com/apk/res/android"><queries><package android:name="uk.thewyj.app.qa.financep04closure"/><package android:name="com.tencent.mm"/></queries><application android:label="FINANCE P04 Navigator QA"/></manifest>\n',
 'app/src/androidTest/java/uk/thewyj/app/qa/financep04navigator/NavigatorRunner.java':"""package uk.thewyj.app.qa.financep04navigator;
public class NavigatorRunner extends androidx.test.runner.AndroidJUnitRunner {
 @Override public android.app.UiAutomation getUiAutomation(){return super.getUiAutomation(android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);}
 @Override public android.app.UiAutomation getUiAutomation(int flags){return super.getUiAutomation(flags|android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);}
}
""",
}
for name,text in files.items():p=OUT/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text,encoding='utf8')
src=ROOT/'qa/finance-p04/closure/NavigatorTest.java'
shutil.copy2(src,OUT/'app/src/androidTest/java/uk/thewyj/app/qa/financep04navigator/NavigatorTest.java')
env=dict(os.environ,JAVA_HOME='C:/Program Files/Android/Android Studio/jbr')
command=['cmd.exe','/d','/c',str(ROOT/'android/gradlew.bat'),'-p',str(OUT),':app:assembleDebug',':app:assembleDebugAndroidTest','--no-daemon','--console=plain','--max-workers=2','--stacktrace']
with (OUT/'build.log').open('xb') as stream:result=subprocess.run(command,cwd=ROOT,env=env,stdout=stream,stderr=subprocess.STDOUT)
apks=[{'path':p.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in (OUT/'app/build/outputs/apk').rglob('*.apk')]
(OUT/'build.json').write_text(json.dumps({'command':command,'exit_code':result.returncode,'artifacts':apks,'test_source_sha256':hashlib.sha256((OUT/'app/src/androidTest/java/uk/thewyj/app/qa/financep04navigator/NavigatorTest.java').read_bytes()).hexdigest(),'scope':'Separate UiAutomation process, no financial write or pay/claim action'},indent=2),encoding='utf8')
print(json.dumps({'exit_code':result.returncode,'apks':len(apks)}));raise SystemExit(result.returncode)
