package uk.thewyj.app.qa.finance

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/** Only the pinned, loopback QA origin; credentials never leave memory/storage. */
object FinanceDeviceSupport {
    const val ORIGIN="https://localhost:19443"
    const val OWNER="synthetic-p03-device-owner"
    fun api(path:String,body:JSONObject?=null):JSONObject {
        require(path.startsWith("/__qa/"))
        val conn=URL(ORIGIN+path).openConnection() as HttpsURLConnection
        conn.connectTimeout=5000;conn.readTimeout=5000
        if(body!=null){conn.requestMethod="POST";conn.doOutput=true;conn.setRequestProperty("Content-Type","application/json");conn.outputStream.use{it.write(body.toString().toByteArray())}}
        check(conn.responseCode==200){"Local QA control HTTP ${conn.responseCode}"}
        return conn.inputStream.use{JSONObject(it.bufferedReader().readText())}.also{conn.disconnect()}
    }
    fun record(c:Context,case:String,details:JSONObject){
        val dir=File(c.filesDir,"finance-p03-device");dir.mkdirs()
        File(dir,"tests.ndjson").appendText(JSONObject().put("case_id",case).put("synthetic_only",true).put("details",details).toString()+"\n")
    }
}
