package uk.thewyj.app.finance

import android.content.Context
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import uk.thewyj.app.BuildConfig
import uk.thewyj.app.task21.*
import uk.thewyj.app.task21.payment.*
import uk.thewyj.app.task21.store.*

/** Suggestions persist separately. This class has no write API for financial facts. */
class FinanceAiCoordinator(
    context:Context,
    private val database:FinanceAiDatabase=FinanceAiDatabase.get(context),
    private val store:PaymentRecognitionStoreContract=RoomPaymentRecognitionStore(NotificationDatabase.get(context)),
    private val transport:NotificationIngestTransport=HttpNotificationIngestTransport(BuildConfig.THEWYJ_BASE_URL),
    private val account:()->NotificationCaptureCoordinator.CaptureAccount?={NotificationSessionProvider(context.applicationContext).currentAccount()},
    private val clock:()->Long=System::currentTimeMillis,
    private val eventIdResolver:((PaymentRecognitionRecord)->String)?=null,
    private val automaticallySchedule:Boolean=true,
    private val pendingSourcePipeline:NotificationCaptureCoordinator?=null,
) {
    private val app=context.applicationContext
    private val dao get()=database.assistance()
    private fun eventId(record:PaymentRecognitionRecord):String=eventIdResolver?.invoke(record)?:record.uploadEventId.ifBlank{
        NotificationArchiveSinkFactory.forContext(app).structuredEventIdsForRecognition(record.accountId,record.sourceEventId).distinct().singleOrNull().orEmpty()
    }
    fun capture(ticket:PaymentTicket,snapshot:PaymentPageSnapshot):Boolean=runCatching {
        val current=account()?:return false
        if(!current.financeEntitled||current.accountId!=ticket.accountId)return false
        val record=store.recognition(current.accountId,ticket.recognitionId)?:return false
        val candidate=store.candidateForRecognition(current.accountId,record.recognitionId)
        val packet=FinanceAiEvidence.capture(record,ticket,candidate,snapshot,clock())?:return false
        val recordDigest=FinanceAiEvidence.recordDigest(record,candidate);val inputDigest=FinanceAiEvidence.inputDigest(packet)
        val linkedEventId=eventId(record)
        val previous=dao.observation(current.accountId,record.recognitionId)
        if(previous?.recordDigest==recordDigest&&previous.inputDigest==inputDigest&&previous.eventId==linkedEventId)return false
        var stored=false
        database.runInTransaction {
            check(account()?.accountId==current.accountId)
            val fresh=store.recognition(current.accountId,record.recognitionId)?:error("source unavailable")
            check(FinanceAiEvidence.recordDigest(fresh,store.candidateForRecognition(current.accountId,record.recognitionId))==recordDigest)
            val latest=dao.observation(current.accountId,record.recognitionId)
            if(latest!=null&&latest.capturedAtMs>=snapshot.capturedAtMs&&latest.inputDigest!=inputDigest)return@runInTransaction
            dao.put(FinanceAiObservation(current.accountId,record.recognitionId,linkedEventId,recordDigest,inputDigest,
                packet.toString(),ticket.expiresAtMs,capturedAtMs=snapshot.capturedAtMs,updatedAtMs=clock()))
            stored=true
        }
        if(!stored)return false
        PaymentReviewSignals.publish();if(automaticallySchedule)schedule(current.accountId);true
    }.getOrDefault(false)

    private fun stillCurrent(row:FinanceAiObservation,requireConsent:Boolean=false):Boolean {
        val current=account()?:return false
        if(!current.financeEntitled||current.accountId!=row.accountId||clock()>=row.expiresAtMs)return false
        if(requireConsent){val state=dao.state(row.accountId)?:return false;if(!state.available||!state.consent||state.localRevokePending)return false}
        val record=store.recognition(row.accountId,row.recognitionId)?:return false
        return FinanceAiEvidence.recordDigest(record,store.candidateForRecognition(row.accountId,row.recognitionId))==row.recordDigest
    }
    private fun post(path:String,session:String,body:JSONObject):JSONObject? {
        val response=transport.post(path,session,body.toString());return if(response.ok)runCatching{JSONObject(response.body)}.getOrNull() else null
    }
    fun refreshConfiguration(accountId:String):FinanceAiAccountState?=runCatching {
        val current=account()?.takeIf{it.financeEntitled&&it.accountId==accountId}?:return null
        val response=transport.get("/api/finance/ai/config",current.sessionToken)
        if(!response.ok)return null
        val json=JSONObject(response.body);check(json.get("available") is Boolean);val available=json.getBoolean("available")
        val modelVersion=json.optString("model_version")
        if(available)check(modelVersion.length in 1..240&&modelVersion.matches(Regex("[A-Za-z0-9._:/@-]+")))
        val consent=json.getJSONObject("consent");check(consent.get("enabled") is Int&&consent.getInt("enabled") in 0..1)
        check(consent.get("revision") is Int||consent.get("revision") is Long);val revision=consent.getLong("revision")
        check(revision>=0&&revision<=9_007_199_254_740_991L&&account()?.accountId==accountId)
        val cached=dao.state(accountId)
        if(cached!=null&&cached.consentRevision>revision)return cached
        val enabled=consent.getInt("enabled")==1
        if(cached!=null&&cached.consentRevision==revision&&!cached.localRevokePending)check(cached.consent==enabled)
        if(cached?.localRevokePending==true){
            val revoked=post("/api/finance/ai/consent",current.sessionToken,JSONObject().put("enabled",false).put("expected_revision",revision))?.optJSONObject("consent")
            if(revoked==null)return cached
            check(revoked.getInt("enabled")==0&&account()?.accountId==accountId)
            return FinanceAiAccountState(accountId,available,false,revoked.getLong("revision"),clock(),modelVersion=modelVersion).also(dao::putState)
        }
        FinanceAiAccountState(accountId,available,enabled,revision,clock(),modelVersion=modelVersion).also(dao::putState)
    }.getOrNull()

    /** Explicit opt-in/out only. Neither page recognition nor refresh grants consent. */
    fun setConsent(accountId:String,enabled:Boolean):Boolean=runCatching {
        if(!enabled){
            val current=account()?.takeIf{it.accountId==accountId&&it.financeEntitled}?:return false
            val old=dao.state(accountId)
            dao.putState(FinanceAiAccountState(accountId,old?.available?:false,false,old?.consentRevision?:0,clock(),localRevokePending=true,modelVersion=old?.modelVersion.orEmpty()))
            PaymentReviewSignals.publish()
            refreshConfiguration(current.accountId)
            return true // local withdrawal is immediate, even while offline
        }
        val state=refreshConfiguration(accountId)?:return false
        if(!state.available)return false
        val current=account()?.takeIf{it.accountId==accountId&&it.financeEntitled}?:return false
        val response=post("/api/finance/ai/consent",current.sessionToken,JSONObject().put("enabled",enabled).put("expected_revision",state.consentRevision))?:return false
        val consent=response.getJSONObject("consent");check(account()?.accountId==accountId)
        dao.putState(FinanceAiAccountState(accountId,true,consent.getInt("enabled")==1,consent.getLong("revision"),clock(),modelVersion=state.modelVersion))
        PaymentReviewSignals.publish();if(enabled&&automaticallySchedule)schedule(accountId);true
    }.getOrDefault(false)

    fun schedule(accountId:String){
        if(running.putIfAbsent(accountId,true)!=null)return
        executor.execute{try{flush(accountId)}finally{running.remove(accountId)}}
    }
    /** A known-unit amount review may have only an uploaded raw event. Publish
     * its exact pending identity through the ordinary durable pipeline, with no
     * model amount or completion. Preserve all normal receipt/archive handlers. */
    private fun ensurePendingSource(row:FinanceAiObservation,current:NotificationCaptureCoordinator.CaptureAccount):Boolean {
        val record=store.recognition(row.accountId,row.recognitionId)?:return false
        if(record.identityReviewReason!="currency_amount_unproven")return true
        if(record.currency !in CurrencyMoney.digits||record.amountMinor?.let{it>0}==true||record.providerReference.isBlank()||
            record.financialPhase.isNotBlank()||record.sourcePackage !in setOf("com.tencent.mm","com.eg.android.AlipayGphone")||!stillCurrent(row,true))return false
        val pipeline=pendingSourcePipeline?:NotificationCapturePipeline.create(app,NotificationSessionProvider(app))
        val queued=pipeline.enqueuePendingHint(current.accountId,row.eventId,record.sourceType.lowercase(),record.sourcePackage,
            record.paymentChannel,null,record.direction,"",record.currency,0,"INSUFFICIENT_INFORMATION",listOf("source_bound_amount_review"),
            "finance-ai-source-1",providerReference=record.providerReference,paymentChannel=record.paymentChannel,occurredAtMs=record.createdAtMs,
            amountExponent=CurrencyMoney.exponent(record.currency))
        if(!queued||!stillCurrent(row,true))return false
        val result=pipeline.flushDetailed()
        return !result.authenticationRequired&&result.rejected.none{it.operationId=="hint:${row.eventId}"}&&
            NotificationOfflineQueue.inDirectory(app.filesDir,current.accountId).peekRequests().none{it.operationId=="hint:${row.eventId}"}&&stillCurrent(row,true)
    }
    /** Called by ordinary successful notification sync; no timer or unbounded retry. */
    fun flush(accountId:String):Boolean=runCatching {
        val current=account()?.takeIf{it.accountId==accountId&&it.financeEntitled}?:return false
        val pending=dao.pending(accountId);if(pending.isEmpty())return true
        val configuration=refreshConfiguration(accountId)?:return false
        if(!configuration.available||!configuration.consent||configuration.localRevokePending)return false
        for(original in pending){
            var row=original
            if(!stillCurrent(row,true)){dao.publish(accountId,row.recognitionId,row.recordDigest,row.inputDigest,"stale","",clock());continue}
            if(row.eventId.isBlank()){
                val record=store.recognition(accountId,row.recognitionId)?:continue
                val linked=eventId(record);if(linked.isBlank())continue
                if(dao.linkEvent(accountId,row.recognitionId,row.recordDigest,row.inputDigest,linked)!=1)continue
                row=row.copy(eventId=linked)
            }
            val packet=JSONObject(row.packetJson)
            if(!ensurePendingSource(row,current)){dao.publish(accountId,row.recognitionId,row.recordDigest,row.inputDigest,"waiting_sync","",clock());continue}
            val evidence=post("/api/finance/ai/evidence",current.sessionToken,JSONObject().put("event_id",row.eventId).put("evidence",packet))
            if(evidence==null){dao.publish(accountId,row.recognitionId,row.recordDigest,row.inputDigest,"waiting_sync","",clock());continue}
            if(!stillCurrent(row,true))continue
            if(evidence.optString("status")!="evidence_ready"){
                dao.publish(accountId,row.recognitionId,row.recordDigest,row.inputDigest,evidence.optString("status","review"),"",clock());continue
            }
            val response=post("/api/finance/ai/suggest",current.sessionToken,JSONObject().put("event_id",row.eventId))?:continue
            if(!stillCurrent(row,true))continue
            val bound=evidence.optString("input_digest").matches(Regex("[a-f0-9]{64}"))&&response.optString("input_digest")==evidence.optString("input_digest")&&
                response.optString("model_version")==configuration.modelVersion
            val advice=if(bound)FinanceAiEvidence.validatedSuggestion(response,packet) else null
            val status=response.optString("status").takeIf{it in setOf("suggestion","review","rejected","failed","timed_out","invalidated","running","disabled","consent_required")}?:"invalid"
            val safe=JSONObject().put("status",if(advice!=null)status else if(status in setOf("suggestion","review"))"invalid" else status)
                .put("requires_manual_confirmation",true).put("model_version",response.optString("model_version").take(240))
                .put("input_digest",response.optString("input_digest").take(64))
                .put("error_code",response.optString("error_code").takeIf{it.matches(Regex("finance_ai_[a-z_]{1,70}"))}.orEmpty())
                .put("suggestion",advice?:JSONObject.NULL)
            if(dao.publish(accountId,row.recognitionId,row.recordDigest,row.inputDigest,safe.getString("status"),safe.toString(),clock())==1){
                dao.audit(FinanceAiAudit(FinanceAiEvidence.hash(accountId+row.recognitionId+safe.toString()),accountId,row.recognitionId,row.eventId,safe.toString(),clock()))
                PaymentReviewSignals.publish()
            }
        }
        true
    }.getOrDefault(false)

    fun observation(accountId:String,recognitionId:String):FinanceAiObservation?=runCatching {
        val row=dao.observation(accountId,recognitionId)?:return null
        row.takeIf{stillCurrent(it)}
    }.getOrNull()
    fun observationsForUi(accountId:String,ids:Set<String>):Map<String,FinanceAiObservation> = runCatching {
        if(account()?.accountId!=accountId)return emptyMap()
        dao.observations(accountId).filter{it.recognitionId in ids&&stillCurrent(it)}.associateBy{it.recognitionId}
    }.getOrDefault(emptyMap())
    fun advice(accountId:String,recognitionId:String):JSONObject?=observation(accountId,recognitionId)?.let {row->
        runCatching{if(!stillCurrent(row,true))return null;val response=JSONObject(row.responseJson);if(response.optString("model_version")!=dao.state(accountId)?.modelVersion)return null;FinanceAiEvidence.validatedSuggestion(response,JSONObject(row.packetJson))}.getOrNull()
    }
    fun accountState(accountId:String)=runCatching{dao.state(accountId)}.getOrNull()
    companion object {
        private val executor=Executors.newSingleThreadExecutor{r->Thread(r,"finance-ai-assistance").apply{isDaemon=true}}
        private val running=ConcurrentHashMap<String,Boolean>()
        @Volatile private var instance:FinanceAiCoordinator?=null
        fun get(context:Context)=instance?:synchronized(this){instance?:FinanceAiCoordinator(context.applicationContext).also{instance=it}}
    }
}
