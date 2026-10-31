package uk.thewyj.app.qa.finance
import android.app.KeyguardManager
import android.graphics.Rect
import android.os.PowerManager
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Maintenance helper, not business acceptance. Normal system UI actions only. */
@RunWith(AndroidJUnit4::class)
class FinanceFinishSettingsUiTest {
    @Test fun authorizedNormalSettingsUi(){
        val i=InstrumentationRegistry.getInstrumentation();val c=i.targetContext
        val args=InstrumentationRegistry.getArguments();val action=args.getString("qa_ui_action")?:"probe"
        val result=JSONObject().put("maintenance_only",true).put("keyguard_locked",c.getSystemService(KeyguardManager::class.java).isKeyguardLocked).put("interactive",c.getSystemService(PowerManager::class.java).isInteractive)
        val own=c.getSystemService(android.view.accessibility.AccessibilityManager::class.java).installedAccessibilityServiceList.filter{it.resolveInfo.serviceInfo.packageName==c.packageName}
        result.put("own_installed_accessibility",JSONArray(own.map{JSONObject().put("id",it.id).put("service_label",it.resolveInfo.loadLabel(c.packageManager).toString()).put("app_label",it.resolveInfo.serviceInfo.applicationInfo.loadLabel(c.packageManager).toString())}))
        if(action!="probe"){
            val root=i.uiAutomation.rootInActiveWindow?:error("No accessible system Settings window")
            val allowed=setOf("com.android.settings","com.android.permissioncontroller","com.google.android.permissioncontroller")
            check(root.packageName?.toString() in allowed){"Only system Settings/permission UI may be read; no private app fallback"}
            val nodes=mutableListOf<AccessibilityNodeInfo>();val parents=mutableListOf<Int>()
            fun visit(node:AccessibilityNodeInfo,parent:Int,depth:Int){
                if(depth>35||nodes.size>=1500)return
                val index=nodes.size;nodes+=node;parents+=parent
                for(j in 0 until node.childCount)node.getChild(j)?.let{visit(it,index,depth+1)}
            }
            visit(root,-1,0)
            if(action=="click"){
                val text=args.getString("qa_ui_text");val id=args.getString("qa_ui_id");val index=args.getString("qa_ui_index")?.toIntOrNull()
                val choices=nodes.withIndex().filter{(_,n)->(text==null||n.text?.toString()==text)&&(id==null||n.viewIdResourceName==id)}
                check(text!=null||id!=null){"Explicit observed UI text or resource required"}
                val target=if(index!=null){check(index in choices.indices);choices[index].value}else{check(choices.size==1){"Ambiguous UI target; inspect Settings nodes first"};choices.single().value}
                var click=target;repeat(5){if(!click.isClickable)click.parent?.let{p->click=p}}
                check(click.isClickable){"No normal clickable ancestor"}
                result.put("clicked",click.performAction(AccessibilityNodeInfo.ACTION_CLICK)).put("target_text",text).put("target_id",id)
            }else{
                val rows=JSONArray()
                nodes.forEachIndexed{index,n->val bounds=Rect();n.getBoundsInScreen(bounds);rows.put(JSONObject().put("index",index).put("parent",parents[index]).put("text",n.text?.toString().orEmpty()).put("description",n.contentDescription?.toString().orEmpty()).put("id",n.viewIdResourceName.orEmpty()).put("class",n.className?.toString().orEmpty()).put("clickable",n.isClickable).put("checkable",n.isCheckable).put("checked",n.isChecked).put("bounds",bounds.toShortString()))}
                result.put("settings_package",root.packageName).put("nodes",rows)
            }
        }
        val d=File(c.filesDir,"finance-p03-device");d.mkdirs();File(d,"ui-helper.json").writeText(result.toString())
        if(action=="click")assertTrue("Normal system UI action must succeed",result.getBoolean("clicked"))
    }
}
