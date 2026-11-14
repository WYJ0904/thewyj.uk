package uk.thewyj.app.finance

import androidx.room.Entity
import androidx.sqlite.db.SupportSQLiteDatabase

/** Verified units are separate from immutable original booking fields. */
@Entity(tableName = "payment_money_units", primaryKeys = ["accountId", "eventId"])
data class PaymentMoneyUnit(val accountId: String, val eventId: String, val amountExponent: Int)

object CurrencyLedgerUnits {
    fun read(db: SupportSQLiteDatabase, account: String, event: String, currency: String): Int? {
        if (db.version < 15) return CurrencyMoney.digits[currency]?.takeIf { currency != "JPY" }
        db.query("SELECT amountExponent FROM payment_money_units WHERE accountId=? AND eventId=?", arrayOf(account, event)).use {
            return if (it.moveToFirst()) it.getInt(0) else null
        }
    }
    fun stamp(db: SupportSQLiteDatabase, account: String, event: String, currency: String, exponent: Int?) {
        if (db.version < 15) return
        val verified = exponent ?: CurrencyMoney.digits[currency]?.takeIf { currency != "JPY" } ?: return
        require(verified == CurrencyMoney.exponent(currency))
        db.execSQL("INSERT OR IGNORE INTO payment_money_units(accountId,eventId,amountExponent) VALUES(?,?,?)", arrayOf<Any?>(account,event,verified))
        check(read(db,account,event,currency) == verified)
    }
}
