package uk.thewyj.app.finance

import android.database.sqlite.SQLiteDatabase
import org.json.JSONObject
import java.io.File

/** Historical DDL comes from the unchanged exported schema, never today's entities. */
object FrozenRoomFixture {
    fun create(file: File, version: Int): SQLiteDatabase {
        val schema = JSONObject(File("schemas/uk.thewyj.app.task21.store.NotificationDatabase/$version.json").readText()).getJSONObject("database")
        val db = SQLiteDatabase.openOrCreateDatabase(file, null)
        try {
            val entities = schema.getJSONArray("entities")
            for (index in 0 until entities.length()) {
                val entity = entities.getJSONObject(index); val table = entity.getString("tableName")
                db.execSQL(entity.getString("createSql").replace("\${TABLE_NAME}", table))
                val indices = entity.optJSONArray("indices") ?: org.json.JSONArray()
                for (i in 0 until indices.length()) db.execSQL(indices.getJSONObject(i).getString("createSql").replace("\${TABLE_NAME}", table))
            }
            val setup = schema.getJSONArray("setupQueries")
            for (i in 0 until setup.length()) db.execSQL(setup.getString(i))
            db.version = version
            return db
        } catch (error: Throwable) { db.close(); throw error }
    }
}
