package uk.thewyj.app.finance

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import uk.thewyj.app.task21.payment.*

/** A finite vocabulary, never raw OCR, merchant names, contacts, OTPs or history. */
object FinanceAiEvidence {
    val phrases=listOf("本次","本笔","扣除","扣款","支付","付款","收款","到账","转账","退款","实付","实际","原价","合计","总计","金额","优惠","减免","折扣","余额","手续费","服务费","包含","另外","另列","应付","已付","已收","商户","消费","餐饮","交通","购物","医疗","教育","未知")
    private val injection=Regex("ignore.{0,30}instruction|system\\s*:|assistant\\s*:|提示词|忽略.{0,10}指令|系统指令|api.?key|验证码|密码",RegexOption.IGNORE_CASE)
    fun hash(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it)}
    fun recordDigest(record:PaymentRecognitionRecord,candidate:PaymentCandidate?)=hash(listOf(record.accountId,record.recognitionId,record.sourceEventId,record.sourcePackage,record.sourceUid,
        record.state,record.amountMinor,record.currency,record.direction,record.providerReference,record.identityReviewReason,record.financialPhase,record.updatedAtMs,candidate?.hasEdits,candidate?.updatedAtMs).joinToString("\u0000"))

    fun capture(record:PaymentRecognitionRecord,ticket:PaymentTicket,candidate:PaymentCandidate?,snapshot:PaymentPageSnapshot,clock:Long):JSONObject? {
        if(record.accountId!=ticket.accountId||record.recognitionId!=ticket.recognitionId||record.sourcePackage!=snapshot.sourcePackage||record.sourcePackage!=ticket.sourcePackage||
            !ticket.state.active||clock !in ticket.createdAtMs..ticket.expiresAtMs||record.sourceUid==null||record.sourceUid<10000||candidate?.hasEdits==true||
            record.identityReviewReason !in setOf("","currency_amount_unproven")||record.providerReference.isBlank()||record.amountMinor?.let{it>0}==true||
            listOf("AUTHOR","RELEASE","EXPIRE","CANCEL","FAIL").any{it in record.financialPhase.uppercase()}||
            record.state !in setOf("WAITING_FOR_ENRICHMENT","DETECTED_AMOUNT_UNKNOWN","FINANCE_PENDING_CONFIRMATION"))return null
        // P04's known-unit/missing-amount review is exactly a possible role
        // ambiguity. Keep that core review untouched; only source-bound advice
        // may pass here. Unknown units and actual identity conflicts still fail.
        if(record.identityReviewReason=="currency_amount_unproven"&&record.currency !in CurrencyMoney.digits)return null
        val lines=PaymentScreenshotVerifier.normalizeOcrLines(snapshot.textLines)
        if(lines.isEmpty()||lines.size>40||injection.containsMatchIn(lines.joinToString(" "))||PaymentPageEvidence.blocked(lines)||!PaymentPageEvidence.completed(lines))return null
        val references=lines.mapNotNull(PaymentText::providerReference).distinct()
        val pageReference=references.singleOrNull()
        val direction=PaymentPageEvidence.direction(lines)?.name?:return null
        // Conservative subset of the existing profile rule: exact reference AND
        // direction corroboration are required even on a shared app package.
        if(pageReference!=record.providerReference||record.direction!=direction)return null
        if(PaymentPageSemantics.extract(snapshot,null,2)?.amountMinor!=null)return null // rules already know
        val units=lines.map{CurrencyDecision.apply(ParsedPaymentMessage(PaymentRecognitionStatus.PAYMENT_LIKELY),it,null,true)}
        if(units.any{it.reviewReason in setOf("unsupported_iso_currency","currency_evidence_conflict","currency_symbol_ambiguous")})return null
        val known=units.mapNotNull{it.currency?.takeIf{unit->unit in CurrencyMoney.digits}}.distinct()
        if(known.size!=1)return null
        val unit=known.single();val candidates=JSONArray()
        if(record.currency in CurrencyMoney.digits&&record.currency!=unit)return null
        for((index,line) in lines.withIndex()){
            if(Regex("订单号|訂單號|交易号|交易單號|交易单号|时间|時間|日期|电话|電話|手机|手機").containsMatchIn(line))continue
            val value=units[index]
            if(value.currency==unit&&line.any(Char::isDigit)&&(value.amountMinor==null||value.amountMinor !in 1L..10_000_000_000_000L))return null
            if(value.currency!=unit||value.amountMinor==null)continue
            val words=phrases.filter(line::contains).take(12)
            candidates.put(JSONObject().put("id","m${candidates.length()}").put("amount_minor",value.amountMinor).put("currency",unit).put("amount_exponent",CurrencyMoney.exponent(unit))
                .put("phrases",JSONArray(words.ifEmpty{listOf("未知")})))
            if(candidates.length()>6)return null
        }
        if(candidates.length()<2)return null
        val parsed=PaymentPageAmountSelection.select(lines)
        if(parsed.reason=="conflicting_primary_amounts"||parsed.candidates.any{it.score>=900})return null
        if((0 until candidates.length()).all{candidates.getJSONObject(it).getJSONArray("phrases").let{p->p.length()==1&&p.getString(0)=="未知"}})return null
        if(snapshot.capturedAtMs !in ticket.createdAtMs..clock+5000)return null
        val brands=mapOf("McDonalds" to "麦当劳|麥當勞|McDonalds","Starbucks" to "星巴克|Starbucks","KFC" to "肯德基|KFC","Meituan" to "美团|美團|Meituan",
            "Metro" to "地铁|地鐵|Metro","Taxi" to "出租车|出租車|Taxi","Supermarket" to "超市|Supermarket","Restaurant" to "餐厅|餐廳|Restaurant","Pharmacy" to "药店|藥店|Pharmacy","Hotel" to "酒店|Hotel")
        val merchantTokens=brands.filter{(_,pattern)->Regex(pattern,RegexOption.IGNORE_CASE).containsMatchIn(lines.joinToString(" "))}.keys.take(4)
        return JSONObject().put("schema_version",1).put("source_uid",record.sourceUid).put("completion_proven",true)
            .put("direction",direction.lowercase()).put("currency",unit).put("captured_at_ms",snapshot.capturedAtMs).put("expires_at_ms",ticket.expiresAtMs)
            .put("provider_reference_hash",hash(record.providerReference)).put("candidates",candidates).put("merchant_tokens",JSONArray(merchantTokens))
    }
    fun inputDigest(packet:JSONObject):String {
        val copy=JSONObject(packet.toString());copy.remove("captured_at_ms");copy.remove("expires_at_ms")
        return hash(copy.toString())
    }
    /** Treat server/model data as untrusted again on device. Never changes a record. */
    fun validatedSuggestion(response:JSONObject,packet:JSONObject):JSONObject?=runCatching {
        if(response.optString("status")!in setOf("suggestion","review"))return null
        check(response.get("requires_manual_confirmation")==true)
        val advice=response.getJSONObject("suggestion");check(advice.getInt("schema_version")==1&&advice.get("requires_manual_confirmation")==true)
        val allowed=setOf("schema_version","decision","amount_candidates","selected_candidate_id","currency","direction","evidence_refs","confidence","refusal_reason","merchant_normalized","category","requires_manual_confirmation")
        check(advice.keys().asSequence().toSet()==allowed)
        check(advice.getString("decision") in setOf("suggest","review","reject"))
        check(advice.getString("refusal_reason") in setOf("none","ambiguous","insufficient_evidence","conflict","non_transaction","unsafe_input"))
        val categories=setOf("food","transport","shopping","housing","health","education","entertainment","income","transfer","refund","other")
        check(advice.isNull("category")||advice.getString("category") in categories)
        val brands=packet.getJSONArray("merchant_tokens");check(advice.isNull("merchant_normalized")||(0 until brands.length()).any{brands.getString(it)==advice.getString("merchant_normalized")})
        check(advice.getString("currency")==packet.getString("currency"))
        check(advice.getString("direction")==packet.getString("direction"))
        check((advice.get("confidence") is Int||advice.get("confidence") is Long)&&advice.getInt("confidence") in 0..1000)
        if(response.getString("status")=="suggestion")check(advice.getString("decision")=="suggest"&&advice.getInt("confidence")>=800)
        val source=packet.getJSONArray("candidates");val known=(0 until source.length()).associate{source.getJSONObject(it).getString("id") to source.getJSONObject(it)}
        val values=advice.getJSONArray("amount_candidates");check(values.length()<=6)
        val rootRefs=advice.getJSONArray("evidence_refs");check(rootRefs.length()<=6&&(0 until rootRefs.length()).map{rootRefs.getString(it)}.let{it.distinct().size==it.size&&it.all(known::containsKey)})
        val ids=mutableSetOf<String>()
        repeat(values.length()){i->val value=values.getJSONObject(i);check(value.keys().asSequence().toSet()==setOf("candidate_id","amount_minor","currency","role","evidence_refs"));val id=value.getString("candidate_id");check(ids.add(id));val original=known[id]?:error("unknown evidence")
            check(value.getString("role") in setOf("actual_paid","actual_received","original","discount","balance","fee","refund","unknown"))
            check(value.get("amount_minor") is Number&&value.getLong("amount_minor")==original.getLong("amount_minor")&&value.getDouble("amount_minor")==value.getLong("amount_minor").toDouble())
            check(value.getString("currency")==original.getString("currency"))
            val words=original.getJSONArray("phrases").let{p->(0 until p.length()).map(p::getString)}
            val knownRole=when{words.any{it=="余额"}->"balance";words.any{it in setOf("手续费","服务费")}->"fee";words.any{it in setOf("优惠","减免","折扣")}->"discount";"原价" in words->"original";else->null}
            if(knownRole!=null)check(value.getString("role")==knownRole)
            val refs=value.getJSONArray("evidence_refs");check(refs.length()<=6&&(0 until refs.length()).map{refs.getString(it)}.let{it.distinct().size==it.size&&it.all(known::containsKey)&&id in it})}
        val selected=advice.optString("selected_candidate_id").takeUnless{it.isBlank()||it=="null"}
        if(selected!=null)check(selected in ids)
        if(selected!=null){val value=(0 until values.length()).map(values::getJSONObject).single{it.getString("candidate_id")==selected};check(value.getString("role")==when(advice.getString("direction")){"refund"->"refund";"income"->"actual_received";else->"actual_paid"})}
        if(advice.getString("decision")=="suggest")check(selected!=null&&advice.getString("refusal_reason")=="none"&&(0 until rootRefs.length()).any{rootRefs.getString(it)==selected})
        if(selected!=null){val words=known.getValue(selected).getJSONArray("phrases");check((0 until words.length()).none{words.getString(it) in setOf("余额","手续费","服务费","优惠","减免","折扣","原价")})}
        advice
    }.getOrNull()
}
